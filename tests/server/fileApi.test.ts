import { type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/http/createApp.js";
import type { ServerConfig } from "../../src/server/config.js";
import { createDatabase } from "../../src/server/db.js";

let dir: string | null = null;
const servers: Server[] = [];

function listen(server: Server): Promise<number> {
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

async function login(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "dev-password" }),
  });
  return response.headers.get("set-cookie") ?? "";
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(close));
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("file api", () => {
  it("returns 409 when a save uses a stale file version", async () => {
    dir = mkdtempSync(join(tmpdir(), "farbench-file-api-"));
    writeFileSync(join(dir, "note.txt"), "first");
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
    const cookie = await login(baseUrl);

    const read = await fetch(`${baseUrl}/api/workspaces/${workspace.id}/file?path=note.txt`, {
      headers: { cookie },
    });
    const initial = (await read.json()) as { version: string };
    writeFileSync(join(dir, "note.txt"), "changed elsewhere");

    const save = await fetch(`${baseUrl}/api/workspaces/${workspace.id}/file`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ path: "note.txt", content: "browser edit", expectedVersion: initial.version }),
    });

    expect(save.status).toBe(409);
    expect(await save.json()).toEqual({ error: "File changed on disk" });
  });
});
