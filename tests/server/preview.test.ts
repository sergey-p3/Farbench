import http, { type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/http/createApp.js";
import type { ServerConfig } from "../../src/server/config.js";
import { createDatabase } from "../../src/server/db.js";
import type { PortPreview } from "../../src/shared/types.js";

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

function openWebSocket(url: string, headers?: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
    socket.once("unexpected-response", (_request, response) => {
      reject(new Error(`unexpected response ${response.statusCode}`));
    });
  });
}

function rejectWebSocket(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => {
      socket.close();
      reject(new Error("websocket opened"));
    });
    socket.once("error", () => resolve());
    socket.once("unexpected-response", (_request, response) => {
      if (response.statusCode === 401) resolve();
      else reject(new Error(`unexpected response ${response.statusCode}`));
    });
  });
}

function closeWebSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    socket.once("close", () => resolve());
    socket.close();
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(close));
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("manual preview proxy", () => {
  it("creates an authenticated preview and proxies requests to the stored local port", async () => {
    dir = mkdtempSync(join(tmpdir(), "remote-dev-preview-"));
    let observedCookie: string | undefined;
    const target = http.createServer((_req, res) => {
      observedCookie = _req.headers.cookie;
      res.setHeader("set-cookie", "preview_session=leaked");
      res.end("preview ok");
    });
    servers.push(target);
    const targetPort = await listen(target);

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

    const workspaces = await fetch(`${baseUrl}/api/workspaces`, {
      headers: { cookie },
    });
    expect(workspaces.status).toBe(200);

    const createPreview = await fetch(`${baseUrl}/api/workspaces/${workspace.id}/previews`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ port: targetPort }),
    });
    expect(createPreview.status).toBe(200);
    const { preview } = (await createPreview.json()) as { preview: PortPreview };

    const unauthenticated = await fetch(`${baseUrl}${preview.pathPrefix}/`);
    expect(unauthenticated.status).toBe(401);

    const proxied = await fetch(`${baseUrl}${preview.pathPrefix}/`, {
      headers: { cookie },
    });
    expect(proxied.status).toBe(200);
    expect(observedCookie).toBeUndefined();
    expect(proxied.headers.get("set-cookie")).toBeNull();
    expect(await proxied.text()).toBe("preview ok");
  });

  it("requires authentication for terminal websocket upgrades", async () => {
    dir = mkdtempSync(join(tmpdir(), "remote-dev-preview-"));
    const db = createDatabase(join(dir, "state.db"));
    db.upsertWorkspace({ name: "demo", rootPath: dir });
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
    const wsUrl = `ws://127.0.0.1:${appPort}/ws/terminal`;

    await expect(rejectWebSocket(wsUrl)).resolves.toBeUndefined();

    const login = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "dev-password" }),
    });
    const cookie = login.headers.get("set-cookie") ?? "";

    const socket = await openWebSocket(wsUrl, { cookie });
    await closeWebSocket(socket);
  });
});
