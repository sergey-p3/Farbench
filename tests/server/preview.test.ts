import http, { type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket, { WebSocketServer } from "ws";
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
    dir = mkdtempSync(join(tmpdir(), "farbench-preview-"));
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
    dir = mkdtempSync(join(tmpdir(), "farbench-preview-"));
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

  it("leaves non-terminal websocket upgrades available for dev tooling", async () => {
    dir = mkdtempSync(join(tmpdir(), "farbench-preview-"));
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
    const devSocketServer = new WebSocketServer({ noServer: true });
    app.on("upgrade", (req, socket, head) => {
      if (req.url !== "/vite-hmr") return;
      devSocketServer.handleUpgrade(req, socket, head, (ws) => {
        devSocketServer.emit("connection", ws, req);
      });
    });
    devSocketServer.on("connection", (socket) => {
      socket.on("message", () => {
        socket.send("dev socket ready");
      });
    });
    servers.push(app);
    const appPort = await listen(app);

    try {
      const socket = await openWebSocket(`ws://127.0.0.1:${appPort}/vite-hmr`);
      const ready = new Promise<void>((resolve, reject) => {
        socket.once("message", (message) => {
          try {
            expect(message.toString()).toBe("dev socket ready");
            resolve();
          } catch (error) {
            reject(error);
          }
        });
        socket.once("error", reject);
      });
      socket.send("ping");
      await ready;
      await closeWebSocket(socket);
    } finally {
      devSocketServer.close();
    }
  });

  it("returns a stable bad gateway when the preview target is unavailable", async () => {
    dir = mkdtempSync(join(tmpdir(), "farbench-preview-"));
    const deadTarget = http.createServer();
    const deadPort = await listen(deadTarget);
    await close(deadTarget);

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
    const createPreview = await fetch(`${baseUrl}/api/workspaces/${workspace.id}/previews`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ port: deadPort }),
    });
    const { preview } = (await createPreview.json()) as { preview: PortPreview };

    const response = await fetch(`${baseUrl}${preview.pathPrefix}/`, {
      headers: { cookie },
    });

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("preview target unavailable");
  });

  it("keeps common absolute HTML assets and redirects inside the preview prefix", async () => {
    dir = mkdtempSync(join(tmpdir(), "farbench-preview-"));
    const target = http.createServer((req, res) => {
      if (req.url === "/redirect") {
        res.statusCode = 302;
        res.setHeader("location", "/next");
        res.end();
        return;
      }
      if (req.url === "/src/main.js") {
        res.setHeader("content-type", "application/javascript");
        res.end("window.previewAsset = true;");
        return;
      }

      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end('<!doctype html><script src="/src/main.js"></script><a href="/next">next</a>');
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
    const createPreview = await fetch(`${baseUrl}/api/workspaces/${workspace.id}/previews`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ port: targetPort }),
    });
    const { preview } = (await createPreview.json()) as { preview: PortPreview };

    const html = await fetch(`${baseUrl}${preview.pathPrefix}/`, { headers: { cookie } });
    expect(await html.text()).toContain(`src="${preview.pathPrefix}/src/main.js"`);

    const redirect = await fetch(`${baseUrl}${preview.pathPrefix}/redirect`, {
      headers: { cookie },
      redirect: "manual",
    });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe(`${preview.pathPrefix}/next`);
  });
});
