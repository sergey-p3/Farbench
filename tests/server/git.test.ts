import { execFileSync } from "node:child_process";
import http, { type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAgent } from "../../src/server/agent/LocalAgent.js";
import { createApp } from "../../src/server/http/createApp.js";
import type { ServerConfig } from "../../src/server/config.js";
import { createDatabase } from "../../src/server/db.js";

let dir: string | null = null;
const servers: Server[] = [];

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing server address");
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(close));
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("LocalAgent git integration", () => {
  it("reports tracked file changes and returns a path-scoped diff", async () => {
    dir = mkdtempSync(join(tmpdir(), "remote-dev-git-"));
    git(["init"], dir);
    git(["config", "user.email", "dev@example.com"], dir);
    git(["config", "user.name", "Dev"], dir);
    writeFileSync(join(dir, "app.txt"), "one\n");
    git(["add", "app.txt"], dir);
    git(["commit", "-m", "initial"], dir);

    writeFileSync(join(dir, "app.txt"), "two\n");

    const agent = new LocalAgent();
    const status = await agent.gitStatus(dir);
    const diff = await agent.gitDiff(dir, "app.txt");

    expect(status.changes.some((change) => change.path === "app.txt")).toBe(true);
    expect(diff).toContain("-one");
    expect(diff).toContain("+two");
  });

  it("returns a stable bad request when git diff path is missing", async () => {
    dir = mkdtempSync(join(tmpdir(), "remote-dev-git-"));
    const db = createDatabase(join(dir, "state.db"));
    const workspace = db.upsertWorkspace({ name: "demo", rootPath: dir });
    const config: ServerConfig = {
      host: "127.0.0.1",
      port: 0,
      workspacePath: dir,
      workspaceName: "demo",
      dataDir: dir,
      authToken: "dev-password",
    };
    const app = await createApp({ config, db });
    servers.push(app);
    const appPort = await listen(app);
    const baseUrl = `http://127.0.0.1:${appPort}`;
    const login = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "dev-password" }),
    });
    const cookie = login.headers.get("set-cookie") ?? "";

    const response = await fetch(`${baseUrl}/api/workspaces/${workspace.id}/git/diff`, {
      headers: { cookie },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "missing path" });
  });
});
