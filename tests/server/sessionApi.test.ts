import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/http/createApp.js";
import type { ServerConfig } from "../../src/server/config.js";
import { createDatabase } from "../../src/server/db.js";
import type { AgentGateway } from "../../src/server/agent/AgentGateway.js";

let dir: string | null = null;
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("session API", () => {
  it("kills the tmux session and marks the session killed when deleting a workspace session", async () => {
    const { baseUrl, cookie, db, agent, workspace } = await startApp();
    const session = db.createSession({ workspaceId: workspace.id, name: "Codex", type: "codex", tmuxName: "rd_codex" });
    db.updateSessionStatus(session.id, "running");

    const response = await fetch(`${baseUrl}/api/workspaces/${workspace.id}/sessions/${session.id}`, {
      method: "DELETE",
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(agent.killedTmuxNames).toEqual(["rd_codex"]);
    expect(db.getSession(session.id)?.status).toBe("killed");
    expect(db.listAuditEvents()[0]).toEqual(expect.objectContaining({
      type: "session.kill",
      metadata: { sessionId: session.id, workspaceId: workspace.id },
    }));
  });

  it("does not kill a session through the wrong workspace", async () => {
    const { baseUrl, cookie, db, agent, workspace } = await startApp();
    const otherWorkspace = db.upsertWorkspace({ name: "other", rootPath: join(dir ?? "", "other") });
    const session = db.createSession({ workspaceId: workspace.id, name: "shell", type: "bash", tmuxName: "rd_shell" });

    const response = await fetch(`${baseUrl}/api/workspaces/${otherWorkspace.id}/sessions/${session.id}`, {
      method: "DELETE",
      headers: { cookie },
    });

    expect(response.status).toBe(404);
    expect(agent.killedTmuxNames).toEqual([]);
    expect(db.getSession(session.id)?.status).toBe("starting");
  });

  it("serves the Vite-transformed client shell when a dev client is provided", async () => {
    const { baseUrl } = await startApp({
      middlewares: (_req, _res, next) => next(),
      async transformIndexHtml(path, html) {
        return `${html}\n<!-- transformed:${path} -->`;
      },
    });

    const response = await fetch(`${baseUrl}/some/client/route`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<!-- transformed:/some/client/route -->");
  });
});

interface FakeDevClient {
  middlewares: (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => void;
  transformIndexHtml: (path: string, html: string) => Promise<string>;
}

async function startApp(devClient?: FakeDevClient) {
  dir = mkdtempSync(join(tmpdir(), "remote-dev-session-api-"));
  const db = createDatabase(join(dir, "state.db"));
  const workspace = db.upsertWorkspace({ name: "demo", rootPath: dir });
  const agent = new FakeAgent();
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    workspacePath: dir,
    workspaceName: "demo",
    dataDir: dir,
    authToken: "dev-password",
  };
  const app = await createApp({ config, db, agent, devClient });
  servers.push(app);
  const port = await listen(app);
  const baseUrl = `http://127.0.0.1:${port}`;
  const login = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "dev-password" }),
  });
  const cookie = login.headers.get("set-cookie") ?? "";
  return { agent, baseUrl, cookie, db, workspace };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing server address");
      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

class FakeAgent implements AgentGateway {
  readonly killedTmuxNames: string[] = [];

  async listFiles(): Promise<never[]> {
    return [];
  }

  async readFile(): Promise<never> {
    throw new Error("not used");
  }

  async writeFile(): Promise<never> {
    throw new Error("not used");
  }

  async gitStatus() {
    return { changes: [] };
  }

  async gitHistory() {
    return { branch: "main", commits: [] };
  }

  async gitBranches() {
    return { baseBranch: "main", branches: [] };
  }

  async gitSwitchBranch(): Promise<void> {}

  async gitSetFileStaged(): Promise<void> {}

  async gitCommitFiles() {
    return { commitId: "0000000", files: [] };
  }

  async gitDiff(): Promise<string> {
    return "";
  }

  async gitFileDiff(): Promise<never> {
    throw new Error("not used");
  }

  async gitCommitFileDiff(): Promise<never> {
    throw new Error("not used");
  }

  async createTerminalSession() {
    return { tmuxName: "rd_created" };
  }

  async captureScrollback(): Promise<string> {
    return "";
  }

  async terminalSessionExists(): Promise<boolean> {
    return true;
  }

  async killSession(tmuxName: string): Promise<void> {
    this.killedTmuxNames.push(tmuxName);
  }

  async createPreview(workspaceId: string) {
    return {
      id: "preview",
      workspaceId,
      port: 3000,
      pathPrefix: "/preview/preview",
      status: "active" as const,
      createdAt: "2026-06-27T00:00:00.000Z",
    };
  }
}
