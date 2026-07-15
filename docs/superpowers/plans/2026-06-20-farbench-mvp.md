# Farbench MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first self-hosted browser control plane that can launch from a dev machine, expose a browser URL, authenticate one owner, manage tmux-backed terminal sessions, inspect/edit files, show git diffs, and manually proxy one local preview port.

**Architecture:** Use one deployable TypeScript app with explicit boundaries: `ControlPlane` HTTP/WebSocket server, `AgentGateway` interface, `LocalAgent` implementation, and a React browser client. The MVP runs all server-side pieces in one Node process while preserving a clean internal contract for future relay-connected workspace agents.

**Tech Stack:** Node.js 22+, TypeScript, Express, ws, better-sqlite3, node-pty, tmux, React, Vite, xterm.js, Monaco Editor, Vitest, Playwright.

---

## Scope Check

This plan implements the approved MVP as one vertical product slice. It intentionally keeps collaboration, hosted relay, containers, automatic port detection, WebSocket preview forwarding, staging/committing, transcript parsing, PWA packaging, and native wrappers out of the build.

## File Structure

- Create: `package.json` - workspace scripts and dependencies.
- Modify: `.gitignore` - ignored dependencies, build output, reports, and local runtime state.
- Create: `tsconfig.json` - shared TypeScript settings.
- Create: `vite.config.ts` - Vite client build and Vitest browser-side defaults.
- Create: `playwright.config.ts` - E2E runner config.
- Create: `src/shared/types.ts` - API/domain types used by server and client.
- Create: `src/server/cli.ts` - `farbench serve` entrypoint.
- Create: `src/server/config.ts` - CLI/config parsing and URL printing helpers.
- Create: `src/server/db.ts` - SQLite schema and typed metadata access.
- Create: `src/server/auth.ts` - single-user session cookie auth.
- Create: `src/server/pathPolicy.ts` - workspace path normalization and boundary enforcement.
- Create: `src/server/agent/AgentGateway.ts` - interface for workspace capabilities.
- Create: `src/server/agent/LocalAgent.ts` - tmux, files, git, and preview target implementation.
- Create: `src/server/terminal/TmuxManager.ts` - tmux session lifecycle and pty attachment.
- Create: `src/server/http/createApp.ts` - Express app, HTTP APIs, static serving, preview proxy.
- Create: `src/server/ws/terminalSocket.ts` - terminal WebSocket attach protocol.
- Create: `src/client/main.tsx` - React entrypoint.
- Create: `src/client/App.tsx` - application shell and routing state.
- Create: `src/client/api.ts` - typed browser API client.
- Create: `src/client/layoutStore.ts` - per-browser layout persistence.
- Create: `src/client/components/Login.tsx` - owner login form.
- Create: `src/client/components/Dashboard.tsx` - workspace/session/history dashboard.
- Create: `src/client/components/TerminalPane.tsx` - xterm.js terminal attachment.
- Create: `src/client/components/FilePanel.tsx` - file tree, viewer, editor-lite.
- Create: `src/client/components/GitPanel.tsx` - git status and diff display.
- Create: `src/client/components/PreviewPanel.tsx` - manual port preview UI.
- Create: `src/client/styles.css` - responsive app styling.
- Create: `tests/server/pathPolicy.test.ts` - path boundary tests.
- Create: `tests/server/sessionState.test.ts` - session lifecycle persistence tests.
- Create: `tests/server/fileConflict.test.ts` - editor conflict tests.
- Create: `tests/server/git.test.ts` - git status/diff integration tests.
- Create: `tests/server/preview.test.ts` - HTTP preview proxy integration tests.
- Create: `tests/e2e/mvp.spec.ts` - primary acceptance demo.

## Task 1: Project Scaffold and Shared Types

**Files:**
- Create: `package.json`
- Modify: `.gitignore`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `playwright.config.ts`
- Create: `src/shared/types.ts`

- [ ] **Step 1: Create the package manifest**

Create `package.json` with:

```json
{
  "name": "farbench",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "farbench": "dist/server/cli.js"
  },
  "scripts": {
    "dev": "tsx src/server/cli.ts serve --host 127.0.0.1 --port 3000 --workspace .",
    "build": "vite build && tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@monaco-editor/react": "^4.7.0",
    "@vitejs/plugin-react": "^4.7.0",
    "better-sqlite3": "^11.8.1",
    "cookie": "^1.0.2",
    "express": "^4.21.2",
    "nanoid": "^5.1.0",
    "node-pty": "^1.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "ws": "^8.18.0",
    "xterm": "^5.3.0",
    "xterm-addon-fit": "^0.8.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.1",
    "@types/better-sqlite3": "^7.6.12",
    "@types/cookie": "^0.6.0",
    "@types/express": "^4.17.25",
    "@types/node": "^22.10.2",
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "@types/ws": "^8.5.13",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vite": "^6.0.5",
    "vitest": "^2.1.8"
  }
}
```

Update `.gitignore` to contain:

```gitignore
.superpowers/
node_modules/
dist/
coverage/
playwright-report/
test-results/
.farbench/
*.log
```

- [ ] **Step 2: Create TypeScript and test config files**

Create `tsconfig.json` with:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["node_modules", "dist"]
}
```

Create `vite.config.ts` with:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: "src/client",
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true
  },
  test: {
    environment: "node",
    include: ["../../tests/**/*.test.ts"]
  }
});
```

Create `playwright.config.ts` with:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry"
  },
  webServer: {
    command: "npm run build && npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 30_000
  }
});
```

- [ ] **Step 3: Define shared domain types**

Create `src/shared/types.ts` with:

```ts
export type SessionType = "bash" | "codex" | "claude";
export type SessionStatus = "starting" | "running" | "idle" | "disconnected" | "exited" | "crashed" | "killed" | "unknown";

export interface User {
  id: string;
  username: string;
}

export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  status: "available" | "unavailable";
}

export interface Session {
  id: string;
  workspaceId: string;
  name: string;
  type: SessionType;
  tmuxName: string;
  status: SessionStatus;
  createdAt: string;
  lastAttachedAt: string | null;
  lastActivityAt: string | null;
  endedAt: string | null;
}

export interface BrowserLayout {
  selectedWorkspaceId: string | null;
  selectedSessionId: string | null;
  openEditorPaths: string[];
  split: "terminal" | "files" | "git" | "preview";
}

export interface FileResource {
  path: string;
  type: "file" | "directory";
  size: number;
  mtimeMs: number;
  isBinary: boolean;
  canWrite: boolean;
}

export interface FileReadResponse {
  resource: FileResource;
  content: string;
  version: string;
}

export interface GitChange {
  path: string;
  status: string;
  staged: boolean;
  diffAvailable: boolean;
}

export interface GitStatusResponse {
  changes: GitChange[];
}

export interface PortPreview {
  id: string;
  workspaceId: string;
  port: number;
  pathPrefix: string;
  status: "active" | "failed";
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  type: string;
  createdAt: string;
  metadata: Record<string, string | number | boolean | null>;
}
```

- [ ] **Step 4: Install dependencies**

Run:

```bash
npm install
```

Expected: dependencies install and `package-lock.json` is created.

- [ ] **Step 5: Verify type configuration**

Run:

```bash
npm run typecheck
```

Expected: FAIL because no server/client entrypoints exist yet. The failure confirms TypeScript is wired and should mention no inputs or missing project files.

- [ ] **Step 6: Commit scaffold**

```bash
git add .gitignore package.json package-lock.json tsconfig.json vite.config.ts playwright.config.ts src/shared/types.ts
git commit -m "chore: scaffold remote dev app"
```

## Task 2: CLI, Config, Database, and Auth

**Files:**
- Create: `src/server/config.ts`
- Create: `src/server/db.ts`
- Create: `src/server/auth.ts`
- Create: `src/server/cli.ts`
- Create: `tests/server/sessionState.test.ts`

- [ ] **Step 1: Write session metadata persistence tests**

Create `tests/server/sessionState.test.ts` with:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/server/db.js";

let dir: string | null = null;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("metadata database", () => {
  it("stores active and closed sessions for reconnect/history views", () => {
    dir = mkdtempSync(join(tmpdir(), "farbench-db-"));
    const db = createDatabase(join(dir, "state.db"));
    const workspace = db.upsertWorkspace({ name: "demo", rootPath: dir });
    const session = db.createSession({ workspaceId: workspace.id, name: "Codex", type: "codex", tmuxName: "rd_demo" });

    db.updateSessionStatus(session.id, "running");
    db.updateSessionStatus(session.id, "exited");

    const history = db.listSessions(workspace.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.status).toBe("exited");
    expect(history[0]?.endedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the failing database test**

Run:

```bash
npm test -- tests/server/sessionState.test.ts
```

Expected: FAIL with module resolution error for `src/server/db.js`.

- [ ] **Step 3: Implement SQLite metadata access**

Create `src/server/db.ts` with:

```ts
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { Session, SessionStatus, SessionType, Workspace } from "../shared/types.js";

interface WorkspaceInput {
  name: string;
  rootPath: string;
}

interface SessionInput {
  workspaceId: string;
  name: string;
  type: SessionType;
  tmuxName: string;
}

export interface MetadataDb {
  upsertWorkspace(input: WorkspaceInput): Workspace;
  listWorkspaces(): Workspace[];
  createSession(input: SessionInput): Session;
  updateSessionStatus(id: string, status: SessionStatus): void;
  touchSessionAttachment(id: string): void;
  listSessions(workspaceId: string): Session[];
  getSession(id: string): Session | null;
}

export function createDatabase(path: string): MetadataDb {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    create table if not exists workspaces (
      id text primary key,
      name text not null,
      root_path text not null unique,
      status text not null
    );
    create table if not exists sessions (
      id text primary key,
      workspace_id text not null,
      name text not null,
      type text not null,
      tmux_name text not null,
      status text not null,
      created_at text not null,
      last_attached_at text,
      last_activity_at text,
      ended_at text,
      foreign key(workspace_id) references workspaces(id)
    );
  `);

  const mapWorkspace = (row: any): Workspace => ({
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    status: row.status
  });

  const mapSession = (row: any): Session => ({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    type: row.type,
    tmuxName: row.tmux_name,
    status: row.status,
    createdAt: row.created_at,
    lastAttachedAt: row.last_attached_at,
    lastActivityAt: row.last_activity_at,
    endedAt: row.ended_at
  });

  return {
    upsertWorkspace(input) {
      const existing = db.prepare("select * from workspaces where root_path = ?").get(input.rootPath) as any;
      if (existing) return mapWorkspace(existing);
      const id = nanoid();
      db.prepare("insert into workspaces (id, name, root_path, status) values (?, ?, ?, 'available')")
        .run(id, input.name, input.rootPath);
      return mapWorkspace(db.prepare("select * from workspaces where id = ?").get(id));
    },
    listWorkspaces() {
      return db.prepare("select * from workspaces order by name").all().map(mapWorkspace);
    },
    createSession(input) {
      const id = nanoid();
      const now = new Date().toISOString();
      db.prepare(`
        insert into sessions (id, workspace_id, name, type, tmux_name, status, created_at)
        values (?, ?, ?, ?, ?, 'starting', ?)
      `).run(id, input.workspaceId, input.name, input.type, input.tmuxName, now);
      return mapSession(db.prepare("select * from sessions where id = ?").get(id));
    },
    updateSessionStatus(id, status) {
      const endedAt = ["exited", "crashed", "killed"].includes(status) ? new Date().toISOString() : null;
      db.prepare("update sessions set status = ?, ended_at = coalesce(?, ended_at), last_activity_at = ? where id = ?")
        .run(status, endedAt, new Date().toISOString(), id);
    },
    touchSessionAttachment(id) {
      db.prepare("update sessions set last_attached_at = ?, status = 'running' where id = ?")
        .run(new Date().toISOString(), id);
    },
    listSessions(workspaceId) {
      return db.prepare("select * from sessions where workspace_id = ? order by created_at desc")
        .all(workspaceId)
        .map(mapSession);
    },
    getSession(id) {
      const row = db.prepare("select * from sessions where id = ?").get(id);
      return row ? mapSession(row) : null;
    }
  };
}
```

- [ ] **Step 4: Implement config and auth helpers**

Create `src/server/config.ts` with:

```ts
import { mkdirSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { basename, resolve } from "node:path";

export interface ServerConfig {
  host: string;
  port: number;
  workspacePath: string;
  workspaceName: string;
  dataDir: string;
  authToken: string;
}

export function parseServeArgs(argv: string[]): ServerConfig {
  const get = (flag: string, fallback: string): string => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };
  const workspacePath = resolve(get("--workspace", "."));
  const dataDir = resolve(get("--data-dir", `${homedir()}/.farbench`));
  mkdirSync(dataDir, { recursive: true });
  return {
    host: get("--host", "127.0.0.1"),
    port: Number(get("--port", "3000")),
    workspacePath,
    workspaceName: get("--workspace-name", basename(workspacePath)),
    dataDir,
    authToken: get("--auth-token", "dev-password")
  };
}

export function lanAddress(): string | null {
  for (const values of Object.values(networkInterfaces())) {
    for (const value of values ?? []) {
      if (value.family === "IPv4" && !value.internal) return value.address;
    }
  }
  return null;
}
```

Create `src/server/auth.ts` with:

```ts
import type { NextFunction, Request, Response } from "express";
import { parse, serialize } from "cookie";
import { createHash, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "farbench_session";

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createAuth(authToken: string) {
  const expected = tokenHash(authToken);

  function isValid(req: Request): boolean {
    const cookies = parse(req.headers.cookie ?? "");
    const actual = cookies[COOKIE_NAME];
    if (!actual) return false;
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
  }

  return {
    requireAuth(req: Request, res: Response, next: NextFunction) {
      if (isValid(req)) {
        next();
        return;
      }
      res.status(401).json({ error: "unauthorized" });
    },
    login(req: Request, res: Response) {
      if (req.body?.token !== authToken) {
        res.status(401).json({ error: "invalid token" });
        return;
      }
      res.setHeader("Set-Cookie", serialize(COOKIE_NAME, expected, {
        httpOnly: true,
        sameSite: "lax",
        path: "/"
      }));
      res.json({ ok: true });
    },
    isValid
  };
}
```

- [ ] **Step 5: Add the CLI entrypoint**

Create `src/server/cli.ts` with:

```ts
#!/usr/bin/env node
import { join } from "node:path";
import { createDatabase } from "./db.js";
import { lanAddress, parseServeArgs } from "./config.js";
import { createApp } from "./http/createApp.js";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "serve") {
    console.error("Usage: farbench serve [--host 127.0.0.1] [--port 3000] [--workspace .]");
    process.exit(1);
  }

  const config = parseServeArgs(args);
  const db = createDatabase(join(config.dataDir, "state.db"));
  const workspace = db.upsertWorkspace({ name: config.workspaceName, rootPath: config.workspacePath });
  const server = await createApp({ config, db });

  server.listen(config.port, config.host, () => {
    const localUrl = `http://localhost:${config.port}`;
    const lan = config.host === "0.0.0.0" ? lanAddress() : null;
    console.log("Farbench is running:");
    console.log(`Workspace: ${workspace.name} (${workspace.rootPath})`);
    console.log(`Local: ${localUrl}`);
    if (lan) console.log(`LAN:   http://${lan}:${config.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 6: Run the database test**

Run:

```bash
npm test -- tests/server/sessionState.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit CLI, database, and auth**

```bash
git add src/server/config.ts src/server/db.ts src/server/auth.ts src/server/cli.ts tests/server/sessionState.test.ts
git commit -m "feat: add local control plane metadata"
```

## Task 3: Workspace Path Policy and LocalAgent File API

**Files:**
- Create: `src/server/pathPolicy.ts`
- Create: `src/server/agent/AgentGateway.ts`
- Create: `src/server/agent/LocalAgent.ts`
- Create: `tests/server/pathPolicy.test.ts`
- Create: `tests/server/fileConflict.test.ts`

- [ ] **Step 1: Write path boundary tests**

Create `tests/server/pathPolicy.test.ts` with:

```ts
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveWorkspacePath } from "../../src/server/pathPolicy.js";

let root: string | null = null;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe("resolveWorkspacePath", () => {
  it("allows paths inside the workspace", () => {
    root = mkdtempSync(join(tmpdir(), "farbench-root-"));
    writeFileSync(join(root, "a.txt"), "hello");
    expect(resolveWorkspacePath(root, "a.txt").absolutePath).toBe(join(root, "a.txt"));
  });

  it("blocks traversal outside the workspace", () => {
    root = mkdtempSync(join(tmpdir(), "farbench-root-"));
    expect(() => resolveWorkspacePath(root, "../secret.txt")).toThrow("Path escapes workspace");
  });

  it("blocks symlinks that resolve outside the workspace", () => {
    root = mkdtempSync(join(tmpdir(), "farbench-root-"));
    const outside = mkdtempSync(join(tmpdir(), "farbench-outside-"));
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"));
    expect(() => resolveWorkspacePath(root, "link.txt")).toThrow("Path escapes workspace");
    rmSync(outside, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Write file conflict tests**

Create `tests/server/fileConflict.test.ts` with:

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAgent } from "../../src/server/agent/LocalAgent.js";

let root: string | null = null;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe("LocalAgent files", () => {
  it("blocks save when file version changed after read", async () => {
    root = mkdtempSync(join(tmpdir(), "farbench-files-"));
    const path = join(root, "note.txt");
    writeFileSync(path, "first");
    const agent = new LocalAgent();
    const read = await agent.readFile({ rootPath: root, path: "note.txt" });

    writeFileSync(path, "changed elsewhere");

    await expect(agent.writeFile({
      rootPath: root,
      path: "note.txt",
      content: "browser edit",
      expectedVersion: read.version
    })).rejects.toThrow("File changed on disk");
  });
});
```

- [ ] **Step 3: Run failing file tests**

Run:

```bash
npm test -- tests/server/pathPolicy.test.ts tests/server/fileConflict.test.ts
```

Expected: FAIL with missing module errors.

- [ ] **Step 4: Implement workspace path policy**

Create `src/server/pathPolicy.ts` with:

```ts
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";

export interface ResolvedWorkspacePath {
  absolutePath: string;
  relativePath: string;
}

export function resolveWorkspacePath(rootPath: string, requestedPath: string): ResolvedWorkspacePath {
  const root = realpathSync(rootPath);
  const requestedAbsolute = resolve(root, requestedPath);
  const realParent = realpathSync(dirname(requestedAbsolute));
  const realCandidate = existsSync(requestedAbsolute)
    ? realpathSync(requestedAbsolute)
    : resolve(realParent, basename(requestedAbsolute));
  const rel = relative(root, realCandidate);
  if (rel.startsWith("..") || rel === ".." || resolve(root, rel) !== realCandidate) {
    throw new Error("Path escapes workspace");
  }
  return { absolutePath: realCandidate, relativePath: rel };
}
```

- [ ] **Step 5: Define AgentGateway**

Create `src/server/agent/AgentGateway.ts` with:

```ts
import type { FileReadResponse, FileResource, GitStatusResponse, PortPreview, Session, SessionType } from "../../shared/types.js";

export interface CreateSessionInput {
  workspaceId: string;
  rootPath: string;
  name: string;
  type: SessionType;
}

export interface WriteFileInput {
  rootPath: string;
  path: string;
  content: string;
  expectedVersion: string;
}

export interface AgentGateway {
  listFiles(rootPath: string, path: string): Promise<FileResource[]>;
  readFile(input: { rootPath: string; path: string }): Promise<FileReadResponse>;
  writeFile(input: WriteFileInput): Promise<FileReadResponse>;
  gitStatus(rootPath: string): Promise<GitStatusResponse>;
  gitDiff(rootPath: string, path: string): Promise<string>;
  createTerminalSession(input: CreateSessionInput): Promise<{ tmuxName: string }>;
  captureScrollback(tmuxName: string): Promise<string>;
  killSession(tmuxName: string): Promise<void>;
  createPreview(workspaceId: string, port: number): Promise<PortPreview>;
}
```

- [ ] **Step 6: Implement LocalAgent file methods**

Create `src/server/agent/LocalAgent.ts` with:

```ts
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { nanoid } from "nanoid";
import type { FileReadResponse, FileResource, GitStatusResponse, PortPreview } from "../../shared/types.js";
import type { AgentGateway, CreateSessionInput, WriteFileInput } from "./AgentGateway.js";
import { resolveWorkspacePath } from "../pathPolicy.js";

function versionFor(content: Buffer, mtimeMs: number): string {
  return createHash("sha256").update(content).update(String(mtimeMs)).digest("hex");
}

function isBinary(buffer: Buffer): boolean {
  return buffer.includes(0);
}

export class LocalAgent implements AgentGateway {
  async listFiles(rootPath: string, path: string): Promise<FileResource[]> {
    const resolved = resolveWorkspacePath(rootPath, path);
    const entries = await readdir(resolved.absolutePath, { withFileTypes: true });
    const resources = await Promise.all(entries.map(async (entry) => {
      const childPath = path ? `${path}/${entry.name}` : entry.name;
      const child = resolveWorkspacePath(rootPath, childPath);
      const info = await stat(child.absolutePath);
      return {
        path: child.relativePath,
        type: entry.isDirectory() ? "directory" as const : "file" as const,
        size: info.size,
        mtimeMs: info.mtimeMs,
        isBinary: false,
        canWrite: entry.isFile()
      };
    }));
    return resources.sort((a, b) => a.type === b.type ? a.path.localeCompare(b.path) : a.type === "directory" ? -1 : 1);
  }

  async readFile(input: { rootPath: string; path: string }): Promise<FileReadResponse> {
    const resolved = resolveWorkspacePath(input.rootPath, input.path);
    const info = await stat(resolved.absolutePath);
    const content = await readFile(resolved.absolutePath);
    if (isBinary(content)) throw new Error("Binary files cannot be edited");
    return {
      resource: {
        path: resolved.relativePath,
        type: "file",
        size: info.size,
        mtimeMs: info.mtimeMs,
        isBinary: false,
        canWrite: true
      },
      content: content.toString("utf8"),
      version: versionFor(content, info.mtimeMs)
    };
  }

  async writeFile(input: WriteFileInput): Promise<FileReadResponse> {
    const current = await this.readFile({ rootPath: input.rootPath, path: input.path });
    if (current.version !== input.expectedVersion) throw new Error("File changed on disk");
    const resolved = resolveWorkspacePath(input.rootPath, input.path);
    await mkdir(dirname(resolved.absolutePath), { recursive: true });
    await writeFile(resolved.absolutePath, input.content, "utf8");
    return this.readFile({ rootPath: input.rootPath, path: input.path });
  }

  async gitStatus(_rootPath: string): Promise<GitStatusResponse> {
    return { changes: [] };
  }

  async gitDiff(_rootPath: string, _path: string): Promise<string> {
    return "";
  }

  async createTerminalSession(_input: CreateSessionInput): Promise<{ tmuxName: string }> {
    return { tmuxName: `rd_${nanoid()}` };
  }

  async captureScrollback(_tmuxName: string): Promise<string> {
    return "";
  }

  async killSession(_tmuxName: string): Promise<void> {
  }

  async createPreview(workspaceId: string, port: number): Promise<PortPreview> {
    return {
      id: nanoid(),
      workspaceId,
      port,
      pathPrefix: "",
      status: "active",
      createdAt: new Date().toISOString()
    };
  }
}
```

- [ ] **Step 7: Run file and path tests**

Run:

```bash
npm test -- tests/server/pathPolicy.test.ts tests/server/fileConflict.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit file API foundation**

```bash
git add src/server/pathPolicy.ts src/server/agent/AgentGateway.ts src/server/agent/LocalAgent.ts tests/server/pathPolicy.test.ts tests/server/fileConflict.test.ts
git commit -m "feat: add workspace file boundary enforcement"
```

## Task 4: tmux Terminal Lifecycle and WebSocket Attach

**Files:**
- Create: `src/server/terminal/TmuxManager.ts`
- Create: `src/server/ws/terminalSocket.ts`
- Modify: `src/server/agent/LocalAgent.ts`

- [ ] **Step 1: Add tmux manager**

Create `src/server/terminal/TmuxManager.ts` with:

```ts
import { spawn, spawnSync } from "node:child_process";
import * as pty from "node-pty";
import { nanoid } from "nanoid";
import type { IPty } from "node-pty";
import type { SessionType } from "../../shared/types.js";

export class TmuxManager {
  assertAvailable(): void {
    const result = spawnSync("tmux", ["-V"], { encoding: "utf8" });
    if (result.status !== 0) throw new Error("tmux is required");
  }

  commandFor(type: SessionType): string {
    if (type === "codex") return "codex";
    if (type === "claude") return "claude";
    return process.env.SHELL ?? "bash";
  }

  async create(rootPath: string, type: SessionType): Promise<string> {
    this.assertAvailable();
    const tmuxName = `farbench_${nanoid(10)}`;
    const command = this.commandFor(type);
    await new Promise<void>((resolve, reject) => {
      const child = spawn("tmux", ["new-session", "-d", "-s", tmuxName, "-c", rootPath, command], { stdio: "pipe" });
      child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`tmux new-session failed with ${code}`)));
      child.on("error", reject);
    });
    return tmuxName;
  }

  attach(tmuxName: string, cols: number, rows: number): IPty {
    return pty.spawn("tmux", ["attach-session", "-t", tmuxName], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: process.cwd(),
      env: process.env
    });
  }

  async capture(tmuxName: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("tmux", ["capture-pane", "-p", "-S", "-2000", "-t", tmuxName], { stdio: "pipe" });
      let output = "";
      let error = "";
      child.stdout.on("data", (chunk) => output += chunk);
      child.stderr.on("data", (chunk) => error += chunk);
      child.on("exit", (code) => code === 0 ? resolve(output) : reject(new Error(error || `capture failed with ${code}`)));
      child.on("error", reject);
    });
  }

  async kill(tmuxName: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("tmux", ["kill-session", "-t", tmuxName], { stdio: "pipe" });
      child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`tmux kill-session failed with ${code}`)));
      child.on("error", reject);
    });
  }
}
```

- [ ] **Step 2: Wire LocalAgent to tmux**

Modify `src/server/agent/LocalAgent.ts`:

```ts
import { TmuxManager } from "../terminal/TmuxManager.js";
```

Change the class constructor and terminal methods:

```ts
export class LocalAgent implements AgentGateway {
  constructor(private readonly tmux = new TmuxManager()) {}

  async createTerminalSession(input: CreateSessionInput): Promise<{ tmuxName: string }> {
    return { tmuxName: await this.tmux.create(input.rootPath, input.type) };
  }

  async captureScrollback(tmuxName: string): Promise<string> {
    return this.tmux.capture(tmuxName);
  }

  async killSession(tmuxName: string): Promise<void> {
    await this.tmux.kill(tmuxName);
  }
}
```

- [ ] **Step 3: Implement terminal WebSocket protocol**

Create `src/server/ws/terminalSocket.ts` with:

```ts
import type { IncomingMessage } from "node:http";
import type { WebSocketServer, WebSocket } from "ws";
import type { MetadataDb } from "../db.js";
import { TmuxManager } from "../terminal/TmuxManager.js";

interface AttachMessage {
  type: "attach";
  sessionId: string;
  cols: number;
  rows: number;
}

interface InputMessage {
  type: "input";
  data: string;
}

interface ResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

type TerminalMessage = AttachMessage | InputMessage | ResizeMessage;

export function registerTerminalSocket(server: WebSocketServer, db: MetadataDb, tmux = new TmuxManager()) {
  server.on("connection", (socket: WebSocket, _request: IncomingMessage) => {
    let terminal: ReturnType<TmuxManager["attach"]> | null = null;

    socket.on("message", async (raw) => {
      const message = JSON.parse(raw.toString()) as TerminalMessage;
      if (message.type === "attach") {
        const session = db.getSession(message.sessionId);
        if (!session) {
          socket.send(JSON.stringify({ type: "error", error: "session not found" }));
          return;
        }
        const scrollback = await tmux.capture(session.tmuxName).catch(() => "");
        socket.send(JSON.stringify({ type: "scrollback", data: scrollback }));
        terminal = tmux.attach(session.tmuxName, message.cols, message.rows);
        db.touchSessionAttachment(session.id);
        terminal.onData((data) => socket.send(JSON.stringify({ type: "output", data })));
        terminal.onExit(() => {
          db.updateSessionStatus(session.id, "exited");
          socket.send(JSON.stringify({ type: "exit" }));
        });
        return;
      }
      if (message.type === "input" && terminal) terminal.write(message.data);
      if (message.type === "resize" && terminal) terminal.resize(message.cols, message.rows);
    });

    socket.on("close", () => {
      terminal?.kill();
      terminal = null;
    });
  });
}
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: FAIL only because `createApp` is not implemented yet. Fix any type errors in tmux files before continuing.

- [ ] **Step 5: Commit terminal backend**

```bash
git add src/server/terminal/TmuxManager.ts src/server/ws/terminalSocket.ts src/server/agent/LocalAgent.ts
git commit -m "feat: add tmux terminal attachment backend"
```

## Task 5: HTTP API, Git, and Manual Preview Proxy

**Files:**
- Create: `src/server/http/createApp.ts`
- Modify: `src/server/agent/LocalAgent.ts`
- Create: `tests/server/git.test.ts`
- Create: `tests/server/preview.test.ts`

- [ ] **Step 1: Write git integration test**

Create `tests/server/git.test.ts` with:

```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAgent } from "../../src/server/agent/LocalAgent.js";

let root: string | null = null;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe("LocalAgent git", () => {
  it("returns changed files and diffs", async () => {
    root = mkdtempSync(join(tmpdir(), "farbench-git-"));
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.local"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    writeFileSync(join(root, "app.txt"), "one\n");
    execFileSync("git", ["add", "app.txt"], { cwd: root });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: root });
    writeFileSync(join(root, "app.txt"), "two\n");

    const agent = new LocalAgent();
    const status = await agent.gitStatus(root);
    const diff = await agent.gitDiff(root, "app.txt");

    expect(status.changes[0]?.path).toBe("app.txt");
    expect(diff).toContain("-one");
    expect(diff).toContain("+two");
  });
});
```

- [ ] **Step 2: Implement git methods in LocalAgent**

Modify `src/server/agent/LocalAgent.ts` to add imports:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
```

Replace `gitStatus` and `gitDiff` with:

```ts
  async gitStatus(rootPath: string): Promise<GitStatusResponse> {
    const { stdout } = await exec("git", ["status", "--porcelain=v1"], { cwd: rootPath });
    const changes = stdout.split("\n").filter(Boolean).map((line) => {
      const stagedStatus = line.slice(0, 1);
      const worktreeStatus = line.slice(1, 2);
      const path = line.slice(3);
      return {
        path,
        status: `${stagedStatus}${worktreeStatus}`.trim(),
        staged: stagedStatus !== " " && stagedStatus !== "?",
        diffAvailable: !path.endsWith("/")
      };
    });
    return { changes };
  }

  async gitDiff(rootPath: string, path: string): Promise<string> {
    const resolved = resolveWorkspacePath(rootPath, path);
    const { stdout } = await exec("git", ["diff", "--", resolved.relativePath], { cwd: rootPath, maxBuffer: 5_000_000 });
    return stdout;
  }
```

- [ ] **Step 3: Implement HTTP app and preview proxy**

Create `src/server/http/createApp.ts` with:

```ts
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { request } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import type { PortPreview } from "../../shared/types.js";
import type { ServerConfig } from "../config.js";
import type { MetadataDb } from "../db.js";
import { createAuth } from "../auth.js";
import { LocalAgent } from "../agent/LocalAgent.js";
import { registerTerminalSocket } from "../ws/terminalSocket.js";

interface CreateAppInput {
  config: ServerConfig;
  db: MetadataDb;
}

export async function createApp(input: CreateAppInput) {
  const app = express();
  const auth = createAuth(input.config.authToken);
  const agent = new LocalAgent();
  const previews = new Map<string, PortPreview>();

  app.use(express.json({ limit: "2mb" }));
  app.post("/api/login", auth.login);
  app.use("/api", auth.requireAuth);

  app.get("/api/workspaces", (_req, res) => {
    res.json({ workspaces: input.db.listWorkspaces() });
  });

  app.get("/api/workspaces/:workspaceId/sessions", (req, res) => {
    res.json({ sessions: input.db.listSessions(req.params.workspaceId) });
  });

  app.post("/api/workspaces/:workspaceId/sessions", async (req, res, next) => {
    try {
      const workspace = input.db.listWorkspaces().find((item) => item.id === req.params.workspaceId);
      if (!workspace) {
        res.status(404).json({ error: "workspace not found" });
        return;
      }
      const terminal = await agent.createTerminalSession({
        workspaceId: workspace.id,
        rootPath: workspace.rootPath,
        name: req.body.name,
        type: req.body.type
      });
      const session = input.db.createSession({
        workspaceId: workspace.id,
        name: req.body.name,
        type: req.body.type,
        tmuxName: terminal.tmuxName
      });
      input.db.updateSessionStatus(session.id, "running");
      res.json({ session });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/workspaces/:workspaceId/files", async (req, res, next) => {
    try {
      const workspace = input.db.listWorkspaces().find((item) => item.id === req.params.workspaceId);
      if (!workspace) {
        res.status(404).json({ error: "workspace not found" });
        return;
      }
      res.json({ files: await agent.listFiles(workspace.rootPath, String(req.query.path ?? "")) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/workspaces/:workspaceId/file", async (req, res, next) => {
    try {
      const workspace = input.db.listWorkspaces().find((item) => item.id === req.params.workspaceId);
      if (!workspace) {
        res.status(404).json({ error: "workspace not found" });
        return;
      }
      res.json(await agent.readFile({ rootPath: workspace.rootPath, path: String(req.query.path ?? "") }));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/workspaces/:workspaceId/file", async (req, res, next) => {
    try {
      const workspace = input.db.listWorkspaces().find((item) => item.id === req.params.workspaceId);
      if (!workspace) {
        res.status(404).json({ error: "workspace not found" });
        return;
      }
      res.json(await agent.writeFile({
        rootPath: workspace.rootPath,
        path: req.body.path,
        content: req.body.content,
        expectedVersion: req.body.expectedVersion
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/workspaces/:workspaceId/git/status", async (req, res, next) => {
    try {
      const workspace = input.db.listWorkspaces().find((item) => item.id === req.params.workspaceId);
      if (!workspace) {
        res.status(404).json({ error: "workspace not found" });
        return;
      }
      res.json(await agent.gitStatus(workspace.rootPath));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/workspaces/:workspaceId/git/diff", async (req, res, next) => {
    try {
      const workspace = input.db.listWorkspaces().find((item) => item.id === req.params.workspaceId);
      if (!workspace) {
        res.status(404).json({ error: "workspace not found" });
        return;
      }
      res.type("text/plain").send(await agent.gitDiff(workspace.rootPath, String(req.query.path ?? "")));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/workspaces/:workspaceId/previews", async (req, res, next) => {
    try {
      const port = Number(req.body.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        res.status(400).json({ error: "invalid port" });
        return;
      }
      const preview = await agent.createPreview(req.params.workspaceId, port);
      res.json({ preview: { ...preview, pathPrefix: `/preview/${preview.id}` } });
      previews.set(preview.id, preview);
    } catch (error) {
      next(error);
    }
  });

  app.use("/preview/:previewId", auth.requireAuth, (req, res) => {
    const preview = previews.get(req.params.previewId);
    if (!preview) {
      res.status(404).send("preview not found");
      return;
    }
    const proxy = request({
      host: "127.0.0.1",
      port: preview.port,
      path: req.originalUrl.replace(`/preview/${req.params.previewId}`, "") || "/",
      method: req.method,
      headers: req.headers
    }, (upstream) => {
      res.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(res);
    });
    req.pipe(proxy);
    proxy.on("error", () => res.status(502).send("preview target unavailable"));
  });

  const clientDist = join(dirname(fileURLToPath(import.meta.url)), "../../client");
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get("*", (_req, res) => res.sendFile(join(clientDist, "index.html")));
  }

  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error.message });
  });

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws/terminal" });
  registerTerminalSocket(wss, input.db);
  return server;
}
```

- [ ] **Step 4: Write preview proxy integration test**

Create `tests/server/preview.test.ts` with:

```ts
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/http/createApp.js";
import { createDatabase } from "../../src/server/db.js";

let dir: string | null = null;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address) resolve(address.port);
    });
  });
}

describe("preview proxy", () => {
  it("proxies an authenticated preview by generated preview id", async () => {
    dir = mkdtempSync(join(tmpdir(), "farbench-preview-"));
    const target = createServer((_req, res) => res.end("preview ok"));
    const targetPort = await listen(target);

    const db = createDatabase(join(dir, "state.db"));
    db.upsertWorkspace({ name: "demo", rootPath: dir });
    const app = await createApp({
      db,
      config: {
        host: "127.0.0.1",
        port: 0,
        workspacePath: dir,
        workspaceName: "demo",
        dataDir: dir,
        authToken: "dev-password"
      }
    });
    const appPort = await listen(app);

    const login = await fetch(`http://127.0.0.1:${appPort}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "dev-password" })
    });
    const cookie = login.headers.get("set-cookie") ?? "";
    const workspaces = await fetch(`http://127.0.0.1:${appPort}/api/workspaces`, { headers: { cookie } }).then((res) => res.json() as Promise<any>);
    const preview = await fetch(`http://127.0.0.1:${appPort}/api/workspaces/${workspaces.workspaces[0].id}/previews`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ port: targetPort })
    }).then((res) => res.json() as Promise<any>);

    const proxied = await fetch(`http://127.0.0.1:${appPort}${preview.preview.pathPrefix}/`, { headers: { cookie } }).then((res) => res.text());
    expect(proxied).toBe("preview ok");

    await new Promise<void>((resolve) => app.close(() => resolve()));
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });
});
```

- [ ] **Step 5: Run git, preview, and typecheck**

Run:

```bash
npm test -- tests/server/git.test.ts
npm test -- tests/server/preview.test.ts
npm run typecheck
```

Expected: all commands PASS.

- [ ] **Step 6: Commit HTTP API**

```bash
git add src/server/http/createApp.ts src/server/agent/LocalAgent.ts tests/server/git.test.ts tests/server/preview.test.ts
git commit -m "feat: add workspace HTTP APIs"
```

## Task 6: Browser App Shell, Auth, Dashboard, and Layout Memory

**Files:**
- Create: `src/client/index.html`
- Create: `src/client/main.tsx`
- Create: `src/client/App.tsx`
- Create: `src/client/api.ts`
- Create: `src/client/layoutStore.ts`
- Create: `src/client/components/Login.tsx`
- Create: `src/client/components/Dashboard.tsx`
- Create: `src/client/styles.css`

- [ ] **Step 1: Create client HTML and entrypoint**

Create `src/client/index.html` with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Farbench</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

Create `src/client/main.tsx` with:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 2: Create API and layout helpers**

Create `src/client/api.ts` with:

```ts
import type { FileReadResponse, GitStatusResponse, Session, SessionType, Workspace } from "../shared/types.js";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export const api = {
  login(token: string) {
    return json<{ ok: true }>("/api/login", { method: "POST", body: JSON.stringify({ token }) });
  },
  workspaces() {
    return json<{ workspaces: Workspace[] }>("/api/workspaces");
  },
  sessions(workspaceId: string) {
    return json<{ sessions: Session[] }>(`/api/workspaces/${workspaceId}/sessions`);
  },
  createSession(workspaceId: string, type: SessionType, name: string) {
    return json<{ session: Session }>(`/api/workspaces/${workspaceId}/sessions`, {
      method: "POST",
      body: JSON.stringify({ type, name })
    });
  },
  files(workspaceId: string, path = "") {
    return json<{ files: any[] }>(`/api/workspaces/${workspaceId}/files?path=${encodeURIComponent(path)}`);
  },
  readFile(workspaceId: string, path: string) {
    return json<FileReadResponse>(`/api/workspaces/${workspaceId}/file?path=${encodeURIComponent(path)}`);
  },
  saveFile(workspaceId: string, path: string, content: string, expectedVersion: string) {
    return json<FileReadResponse>(`/api/workspaces/${workspaceId}/file`, {
      method: "PUT",
      body: JSON.stringify({ path, content, expectedVersion })
    });
  },
  gitStatus(workspaceId: string) {
    return json<GitStatusResponse>(`/api/workspaces/${workspaceId}/git/status`);
  },
  gitDiff(workspaceId: string, path: string) {
    return fetch(`/api/workspaces/${workspaceId}/git/diff?path=${encodeURIComponent(path)}`, { credentials: "include" }).then((res) => res.text());
  },
  createPreview(workspaceId: string, port: number) {
    return json<{ preview: { id: string; port: number; pathPrefix: string } }>(`/api/workspaces/${workspaceId}/previews`, {
      method: "POST",
      body: JSON.stringify({ port })
    });
  }
};
```

Create `src/client/layoutStore.ts` with:

```ts
import type { BrowserLayout } from "../shared/types.js";

const KEY = "farbench-layout";

export const defaultLayout: BrowserLayout = {
  selectedWorkspaceId: null,
  selectedSessionId: null,
  openEditorPaths: [],
  split: "terminal"
};

export function loadLayout(): BrowserLayout {
  const raw = localStorage.getItem(KEY);
  if (!raw) return defaultLayout;
  try {
    return { ...defaultLayout, ...JSON.parse(raw) };
  } catch {
    return defaultLayout;
  }
}

export function saveLayout(layout: BrowserLayout): void {
  localStorage.setItem(KEY, JSON.stringify(layout));
}
```

- [ ] **Step 3: Create Login and Dashboard components**

Create `src/client/components/Login.tsx` with:

```tsx
import { useState } from "react";
import { api } from "../api.js";

export function Login({ onLogin }: { onLogin: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  return (
    <form className="login" onSubmit={async (event) => {
      event.preventDefault();
      setError("");
      try {
        await api.login(token);
        onLogin();
      } catch {
        setError("Invalid token");
      }
    }}>
      <h1>Farbench</h1>
      <label>
        Access token
        <input value={token} onChange={(event) => setToken(event.target.value)} type="password" />
      </label>
      <button type="submit">Connect</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
```

Create `src/client/components/Dashboard.tsx` with:

```tsx
import type { Session, SessionType, Workspace } from "../../shared/types.js";
import { api } from "../api.js";

export function Dashboard({
  workspaces,
  sessions,
  selectedWorkspace,
  selectedSessionId,
  onSelectWorkspace,
  onSelectSession,
  onSessionsChanged
}: {
  workspaces: Workspace[];
  sessions: Session[];
  selectedWorkspace: Workspace | null;
  selectedSessionId: string | null;
  onSelectWorkspace: (workspace: Workspace) => void;
  onSelectSession: (session: Session) => void;
  onSessionsChanged: () => void;
}) {
  async function start(type: SessionType) {
    if (!selectedWorkspace) return;
    await api.createSession(selectedWorkspace.id, type, type);
    onSessionsChanged();
  }

  return (
    <aside className="dashboard">
      <h2>Workspaces</h2>
      {workspaces.map((workspace) => (
        <button key={workspace.id} className={workspace.id === selectedWorkspace?.id ? "active" : ""} onClick={() => onSelectWorkspace(workspace)}>
          {workspace.name}
        </button>
      ))}
      <h2>Sessions</h2>
      <div className="buttonRow">
        <button onClick={() => start("bash")}>bash</button>
        <button onClick={() => start("codex")}>Codex</button>
        <button onClick={() => start("claude")}>Claude</button>
      </div>
      {sessions.map((session) => (
        <button key={session.id} className={session.id === selectedSessionId ? "active" : ""} onClick={() => onSelectSession(session)}>
          <span>{session.name}</span>
          <small>{session.status}</small>
        </button>
      ))}
    </aside>
  );
}
```

- [ ] **Step 4: Create App shell and styling**

Create `src/client/App.tsx` with:

```tsx
import { useEffect, useMemo, useState } from "react";
import type { BrowserLayout, Session, Workspace } from "../shared/types.js";
import { api } from "./api.js";
import { Dashboard } from "./components/Dashboard.js";
import { Login } from "./components/Login.js";
import { loadLayout, saveLayout } from "./layoutStore.js";

export function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [layout, setLayout] = useState<BrowserLayout>(() => loadLayout());
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);

  const selectedWorkspace = useMemo(() => workspaces.find((workspace) => workspace.id === layout.selectedWorkspaceId) ?? workspaces[0] ?? null, [workspaces, layout.selectedWorkspaceId]);
  const selectedSession = useMemo(() => sessions.find((session) => session.id === layout.selectedSessionId) ?? null, [sessions, layout.selectedSessionId]);

  function updateLayout(next: BrowserLayout) {
    setLayout(next);
    saveLayout(next);
  }

  async function refresh() {
    const workspaceResponse = await api.workspaces();
    setWorkspaces(workspaceResponse.workspaces);
    const workspace = workspaceResponse.workspaces.find((item) => item.id === layout.selectedWorkspaceId) ?? workspaceResponse.workspaces[0];
    if (workspace) {
      const sessionResponse = await api.sessions(workspace.id);
      setSessions(sessionResponse.sessions);
      if (!layout.selectedWorkspaceId) updateLayout({ ...layout, selectedWorkspaceId: workspace.id });
    }
  }

  useEffect(() => {
    if (authenticated) void refresh();
  }, [authenticated]);

  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;

  return (
    <div className="app">
      <Dashboard
        workspaces={workspaces}
        sessions={sessions}
        selectedWorkspace={selectedWorkspace}
        selectedSessionId={selectedSession?.id ?? null}
        onSelectWorkspace={(workspace) => updateLayout({ ...layout, selectedWorkspaceId: workspace.id, selectedSessionId: null })}
        onSelectSession={(session) => updateLayout({ ...layout, selectedSessionId: session.id, split: "terminal" })}
        onSessionsChanged={refresh}
      />
      <main className="main">
        <nav className="tabs">
          {(["terminal", "files", "git", "preview"] as const).map((split) => (
            <button key={split} className={layout.split === split ? "active" : ""} onClick={() => updateLayout({ ...layout, split })}>{split}</button>
          ))}
        </nav>
        <section className="panel">
          <p>{selectedWorkspace ? selectedWorkspace.name : "No workspace"}</p>
          <p>{selectedSession ? selectedSession.name : "Select or start a session"}</p>
        </section>
      </main>
    </div>
  );
}
```

Create `src/client/styles.css` with:

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #111318; color: #eef1f6; }
button, input { font: inherit; }
button { border: 1px solid #343945; background: #1a1f2a; color: #eef1f6; padding: 8px 10px; border-radius: 6px; cursor: pointer; text-align: left; }
button.active { border-color: #62a0ff; background: #19304f; }
.login { min-height: 100vh; display: grid; place-content: center; gap: 12px; }
.login input { min-width: 280px; border: 1px solid #343945; background: #0d1016; color: #eef1f6; padding: 10px; border-radius: 6px; }
.error { color: #ff8585; }
.app { min-height: 100vh; display: grid; grid-template-columns: 280px 1fr; }
.dashboard { border-right: 1px solid #2a2f3a; padding: 12px; display: flex; flex-direction: column; gap: 8px; overflow: auto; }
.dashboard h2 { font-size: 13px; text-transform: uppercase; color: #9aa4b2; margin: 12px 0 4px; }
.dashboard small { display: block; color: #9aa4b2; }
.buttonRow { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.main { min-width: 0; display: grid; grid-template-rows: auto 1fr; }
.tabs { display: flex; gap: 8px; padding: 10px; border-bottom: 1px solid #2a2f3a; }
.tabs button { text-transform: capitalize; }
.panel { min-height: 0; padding: 12px; overflow: auto; }
@media (max-width: 760px) {
  .app { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .dashboard { border-right: 0; border-bottom: 1px solid #2a2f3a; max-height: 42vh; }
}
```

- [ ] **Step 5: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit client shell**

```bash
git add src/client
git commit -m "feat: add browser shell and layout memory"
```

## Task 7: Terminal, Files, Git, and Preview UI

**Files:**
- Create: `src/client/components/TerminalPane.tsx`
- Create: `src/client/components/FilePanel.tsx`
- Create: `src/client/components/GitPanel.tsx`
- Create: `src/client/components/PreviewPanel.tsx`
- Modify: `src/client/App.tsx`
- Modify: `src/client/styles.css`

- [ ] **Step 1: Create terminal component**

Create `src/client/components/TerminalPane.tsx` with:

```tsx
import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

export function TerminalPane({ sessionId }: { sessionId: string | null }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current || !sessionId) return;
    const term = new Terminal({ cursorBlink: true, convertEol: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    fit.fit();

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws/terminal`);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "attach", sessionId, cols: term.cols, rows: term.rows }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "scrollback") term.write(message.data);
      if (message.type === "output") term.write(message.data);
      if (message.type === "error") term.write(`\r\n${message.error}\r\n`);
    });
    term.onData((data) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: "input", data })));
    const onResize = () => {
      fit.fit();
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      socket.close();
      term.dispose();
    };
  }, [sessionId]);

  if (!sessionId) return <div className="empty">Select a session</div>;
  return <div className="terminal" ref={ref} />;
}
```

- [ ] **Step 2: Create file editor panel**

Create `src/client/components/FilePanel.tsx` with:

```tsx
import Editor from "@monaco-editor/react";
import { useEffect, useState } from "react";
import type { FileReadResponse, FileResource, Workspace } from "../../shared/types.js";
import { api } from "../api.js";

export function FilePanel({ workspace }: { workspace: Workspace | null }) {
  const [files, setFiles] = useState<FileResource[]>([]);
  const [open, setOpen] = useState<FileReadResponse | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    if (!workspace) return;
    const response = await api.files(workspace.id);
    setFiles(response.files);
  }

  async function openFile(path: string) {
    if (!workspace) return;
    setError("");
    const response = await api.readFile(workspace.id, path);
    setOpen(response);
    setContent(response.content);
    setDirty(false);
  }

  async function save() {
    if (!workspace || !open) return;
    setError("");
    try {
      const response = await api.saveFile(workspace.id, open.resource.path, content, open.version);
      setOpen(response);
      setContent(response.content);
      setDirty(false);
    } catch {
      setError("File changed on disk. Reload before saving.");
    }
  }

  useEffect(() => { void refresh(); }, [workspace?.id]);

  return (
    <div className="filePanel">
      <div className="fileTree">
        {files.map((file) => (
          <button key={file.path} disabled={file.type !== "file"} onClick={() => openFile(file.path)}>{file.path}</button>
        ))}
      </div>
      <div className="editorPanel">
        <div className="editorBar">
          <span>{open?.resource.path ?? "No file open"}</span>
          <button disabled={!dirty} onClick={save}>Save</button>
        </div>
        {error && <p className="error">{error}</p>}
        {open && <Editor height="100%" theme="vs-dark" value={content} onChange={(value) => { setContent(value ?? ""); setDirty(true); }} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create git and preview panels**

Create `src/client/components/GitPanel.tsx` with:

```tsx
import { useEffect, useState } from "react";
import type { GitChange, Workspace } from "../../shared/types.js";
import { api } from "../api.js";

export function GitPanel({ workspace }: { workspace: Workspace | null }) {
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [diff, setDiff] = useState("");

  async function refresh() {
    if (!workspace) return;
    const status = await api.gitStatus(workspace.id);
    setChanges(status.changes);
  }

  async function select(path: string) {
    if (!workspace) return;
    setDiff(await api.gitDiff(workspace.id, path));
  }

  useEffect(() => { void refresh(); }, [workspace?.id]);

  return (
    <div className="gitPanel">
      <div className="changeList">
        <button onClick={refresh}>Refresh</button>
        {changes.map((change) => <button key={change.path} onClick={() => select(change.path)}>{change.status} {change.path}</button>)}
      </div>
      <pre className="diff">{diff}</pre>
    </div>
  );
}
```

Create `src/client/components/PreviewPanel.tsx` with:

```tsx
import { useState } from "react";
import type { Workspace } from "../../shared/types.js";
import { api } from "../api.js";

export function PreviewPanel({ workspace }: { workspace: Workspace | null }) {
  const [port, setPort] = useState("3000");
  const [url, setUrl] = useState("");

  async function expose() {
    if (!workspace) return;
    const response = await api.createPreview(workspace.id, Number(port));
    setUrl(response.preview.pathPrefix);
  }

  return (
    <div className="previewPanel">
      <label>
        Port
        <input value={port} onChange={(event) => setPort(event.target.value)} inputMode="numeric" />
      </label>
      <button onClick={expose}>Expose</button>
      {url && <iframe title="preview" src={url} />}
      {url && <a href={url} target="_blank" rel="noreferrer">Open in new tab</a>}
    </div>
  );
}
```

- [ ] **Step 4: Wire panels into App**

Modify `src/client/App.tsx` imports:

```tsx
import { FilePanel } from "./components/FilePanel.js";
import { GitPanel } from "./components/GitPanel.js";
import { PreviewPanel } from "./components/PreviewPanel.js";
import { TerminalPane } from "./components/TerminalPane.js";
```

Replace the `<section className="panel">...</section>` content with:

```tsx
<section className="panel">
  {layout.split === "terminal" && <TerminalPane sessionId={selectedSession?.id ?? null} />}
  {layout.split === "files" && <FilePanel workspace={selectedWorkspace} />}
  {layout.split === "git" && <GitPanel workspace={selectedWorkspace} />}
  {layout.split === "preview" && <PreviewPanel workspace={selectedWorkspace} />}
</section>
```

- [ ] **Step 5: Add panel CSS**

Append to `src/client/styles.css`:

```css
.terminal { height: 100%; min-height: 360px; background: #000; }
.empty { color: #9aa4b2; padding: 24px; }
.filePanel, .gitPanel { height: 100%; display: grid; grid-template-columns: 260px 1fr; gap: 12px; min-height: 0; }
.fileTree, .changeList { min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
.editorPanel { min-height: 0; display: grid; grid-template-rows: auto auto 1fr; }
.editorBar { display: flex; justify-content: space-between; align-items: center; padding-bottom: 8px; }
.diff { margin: 0; padding: 12px; overflow: auto; background: #0d1016; border: 1px solid #2a2f3a; border-radius: 6px; }
.previewPanel { display: grid; grid-template-rows: auto auto 1fr auto; gap: 10px; height: 100%; }
.previewPanel label { display: flex; gap: 8px; align-items: center; }
.previewPanel input { border: 1px solid #343945; background: #0d1016; color: #eef1f6; padding: 8px; border-radius: 6px; width: 120px; }
.previewPanel iframe { width: 100%; height: 100%; min-height: 360px; border: 1px solid #2a2f3a; background: white; }
@media (max-width: 760px) {
  .filePanel, .gitPanel { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .fileTree, .changeList { max-height: 180px; }
}
```

- [ ] **Step 6: Build and smoke run**

Run:

```bash
npm run build
npm run dev
```

Expected: server prints `Farbench is running:` with a local URL. Stop it with `Ctrl-C` after the browser loads.

- [ ] **Step 7: Commit browser MVP panels**

```bash
git add src/client
git commit -m "feat: add terminal file git and preview panels"
```

## Task 8: E2E Acceptance Path

**Files:**
- Create: `tests/e2e/mvp.spec.ts`
- Modify: `playwright.config.ts`

- [ ] **Step 1: Write the E2E test**

Create `tests/e2e/mvp.spec.ts` with:

```ts
import { test, expect } from "@playwright/test";

test("owner can open workspace and see durable session UI", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Access token").fill("dev-password");
  await page.getByRole("button", { name: "Connect" }).click();

  await expect(page.getByText("Workspaces")).toBeVisible();
  await expect(page.getByText("Sessions")).toBeVisible();

  await page.getByRole("button", { name: "bash" }).click();
  await expect(page.getByText("bash")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Workspaces")).toBeVisible();
  await expect(page.getByText("Sessions")).toBeVisible();

  await page.getByRole("button", { name: "files" }).click();
  await expect(page.getByText("No file open")).toBeVisible();

  await page.getByRole("button", { name: "git" }).click();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();

  await page.getByRole("button", { name: "preview" }).click();
  await expect(page.getByRole("button", { name: "Expose" })).toBeVisible();
});
```

- [ ] **Step 2: Run E2E test**

Run:

```bash
npm run test:e2e
```

Expected: PASS on machines with tmux installed. If tmux is missing, install tmux and rerun.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Expected: all commands PASS.

- [ ] **Step 4: Commit E2E coverage**

```bash
git add tests/e2e/mvp.spec.ts playwright.config.ts
git commit -m "test: cover remote dev mvp acceptance path"
```

## Task 9: Documentation and Manual LAN Smoke Test

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README**

Create `README.md` with:

```md
# Farbench

Browser-first control plane for durable terminal coding-agent sessions on a trusted dev machine.

## Run

```bash
npm install
npm run build
npx tsx src/server/cli.ts serve --host 127.0.0.1 --port 3000 --workspace .
```

For LAN access:

```bash
npx tsx src/server/cli.ts serve --host 0.0.0.0 --port 3000 --workspace .
```

Default development access token:

```text
dev-password
```

## MVP Capabilities

- Single-owner login.
- Local workspace dashboard.
- tmux-backed `bash`, `codex`, and `claude` sessions.
- Browser reconnect after refresh/device switch.
- File tree and editor-lite with conflict detection.
- Git status and diffs.
- Manual authenticated HTTP preview for a local port.

## Requirements

- Node.js 22 or newer.
- tmux.
- git.
- Codex and Claude Code binaries when using those session types.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```
```

- [ ] **Step 2: Run manual LAN smoke test**

Run:

```bash
npx tsx src/server/cli.ts serve --host 0.0.0.0 --port 3000 --workspace .
```

Expected: output includes `LAN: http://<lan-ip>:3000`.

From another LAN device:

1. Open the LAN URL.
2. Log in with `dev-password`.
3. Start a `bash` session.
4. Refresh the browser.
5. Reopen the same session from the dashboard.
6. Open the Files panel.
7. Open and save a small text file.
8. Open the Preview panel and expose a known local HTTP server port.

- [ ] **Step 3: Commit docs**

```bash
git add README.md
git commit -m "docs: add mvp runbook"
```

## Final Verification

- [ ] **Step 1: Check working tree**

Run:

```bash
git status --short
```

Expected: no uncommitted files except local runtime data ignored by `.gitignore`.

- [ ] **Step 2: Run all verification commands**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Expected: all commands PASS.

- [ ] **Step 3: Confirm acceptance demo**

Run the primary demo from the design spec:

1. Launch server on the dev machine.
2. Open browser URL.
3. Log in.
4. Start terminal session.
5. Refresh/close browser.
6. Reconnect.
7. Inspect git diff.
8. Save a file edit.
9. Expose preview port.

Expected: each step completes without losing the tmux-backed session.
