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
  it("returns structured text content and patch for an unstaged tracked file", async () => {
    dir = mkdtempSync(join(tmpdir(), "remote-dev-git-"));
    git(["init"], dir);
    git(["config", "user.email", "dev@example.com"], dir);
    git(["config", "user.name", "Dev"], dir);
    writeFileSync(join(dir, "app.txt"), "one\n");
    git(["add", "app.txt"], dir);
    git(["commit", "-m", "initial"], dir);

    writeFileSync(join(dir, "app.txt"), "two\n");

    const agent = new LocalAgent();
    const diff = await agent.gitFileDiff(dir, "app.txt");

    expect(diff).toMatchObject({
      path: "app.txt",
      kind: "text",
      original: "one\n",
      current: "two\n",
      message: null,
    });
    expect(diff.patch).toContain("-one");
    expect(diff.patch).toContain("+two");
  });

  it("returns structured text content for a staged-only tracked file", async () => {
    dir = mkdtempSync(join(tmpdir(), "remote-dev-git-"));
    git(["init"], dir);
    git(["config", "user.email", "dev@example.com"], dir);
    git(["config", "user.name", "Dev"], dir);
    writeFileSync(join(dir, "app.txt"), "one\n");
    git(["add", "app.txt"], dir);
    git(["commit", "-m", "initial"], dir);

    writeFileSync(join(dir, "app.txt"), "two\n");
    git(["add", "app.txt"], dir);

    const agent = new LocalAgent();
    const diff = await agent.gitFileDiff(dir, "app.txt");

    expect(diff).toMatchObject({
      path: "app.txt",
      kind: "text",
      original: "one\n",
      current: "two\n",
      message: null,
    });
  });

  it("uses index content as original for a staged-added file with unstaged edits", async () => {
    dir = mkdtempSync(join(tmpdir(), "remote-dev-git-"));
    git(["init"], dir);
    git(["config", "user.email", "dev@example.com"], dir);
    git(["config", "user.name", "Dev"], dir);

    writeFileSync(join(dir, "app.txt"), "one\n");
    git(["add", "app.txt"], dir);
    writeFileSync(join(dir, "app.txt"), "two\n");

    const agent = new LocalAgent();
    const diff = await agent.gitFileDiff(dir, "app.txt");

    expect(diff).toMatchObject({
      path: "app.txt",
      kind: "text",
      original: "one\n",
      current: "two\n",
      message: null,
    });
    expect(diff.patch).toContain("-one");
    expect(diff.patch).toContain("+two");
  });

  it("returns structured text content for added and deleted files", async () => {
    dir = mkdtempSync(join(tmpdir(), "remote-dev-git-"));
    git(["init"], dir);
    git(["config", "user.email", "dev@example.com"], dir);
    git(["config", "user.name", "Dev"], dir);
    writeFileSync(join(dir, "deleted.txt"), "gone\n");
    git(["add", "deleted.txt"], dir);
    git(["commit", "-m", "initial"], dir);

    writeFileSync(join(dir, "added.txt"), "new\n");
    git(["add", "added.txt"], dir);
    git(["rm", "deleted.txt"], dir);

    const agent = new LocalAgent();
    const added = await agent.gitFileDiff(dir, "added.txt");
    const deleted = await agent.gitFileDiff(dir, "deleted.txt");

    expect(added).toMatchObject({
      path: "added.txt",
      kind: "text",
      original: "",
      current: "new\n",
      message: null,
    });
    expect(deleted).toMatchObject({
      path: "deleted.txt",
      kind: "text",
      original: "gone\n",
      current: "",
      message: null,
    });
  });

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

  it("returns a staged diff when a tracked file has only staged changes", async () => {
    dir = mkdtempSync(join(tmpdir(), "remote-dev-git-"));
    git(["init"], dir);
    git(["config", "user.email", "dev@example.com"], dir);
    git(["config", "user.name", "Dev"], dir);
    writeFileSync(join(dir, "app.txt"), "one\n");
    git(["add", "app.txt"], dir);
    git(["commit", "-m", "initial"], dir);

    writeFileSync(join(dir, "app.txt"), "two\n");
    git(["add", "app.txt"], dir);

    const agent = new LocalAgent();
    const status = await agent.gitStatus(dir);
    const appChange = status.changes.find((change) => change.path === "app.txt");
    const diff = await agent.gitDiff(dir, "app.txt");

    expect(appChange?.staged).toBe(true);
    expect(appChange?.diffAvailable).toBe(true);
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

  it("preserves leading and trailing spaces in git file diff paths", async () => {
    dir = mkdtempSync(join(tmpdir(), "remote-dev-git-"));
    git(["init"], dir);
    git(["config", "user.email", "dev@example.com"], dir);
    git(["config", "user.name", "Dev"], dir);
    const spacedPath = " app.txt ";
    writeFileSync(join(dir, spacedPath), "one\n");
    git(["add", spacedPath], dir);
    git(["commit", "-m", "initial"], dir);
    writeFileSync(join(dir, spacedPath), "two\n");

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
    const params = new URLSearchParams({ path: spacedPath });

    const response = await fetch(`${baseUrl}/api/workspaces/${workspace.id}/git/file-diff?${params}`, {
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      path: spacedPath,
      kind: "text",
      original: "one\n",
      current: "two\n",
      message: null,
    });
  });
});
