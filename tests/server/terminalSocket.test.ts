import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as pty from "node-pty";
import WebSocket, { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/server/db.js";
import type { TmuxManager } from "../../src/server/terminal/TmuxManager.js";
import { registerTerminalSocket } from "../../src/server/ws/terminalSocket.js";

let dir: string | null = null;
let server: WebSocketServer | null = null;
let socket: WebSocket | null = null;

afterEach(async () => {
  if (socket && socket.readyState !== WebSocket.CLOSED) {
    await new Promise<void>((resolve) => {
      socket?.once("close", () => resolve());
      socket?.close();
    });
  }
  socket = null;
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
  server = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("terminal websocket", () => {
  it("routes terminal scroll requests to the attached tmux session", async () => {
    dir = mkdtempSync(join(tmpdir(), "remote-dev-terminal-"));
    const db = createDatabase(join(dir, "state.db"));
    const workspace = db.upsertWorkspace({ name: "demo", rootPath: dir });
    const session = db.createSession({ workspaceId: workspace.id, name: "bash", type: "bash", tmuxName: "rd_demo" });
    const scrolls: Array<{ tmuxName: string; direction: "up" | "down" }> = [];
    const fakeTerminal = {
      kill() {},
      onData() {},
      onExit() {},
      resize() {},
      write() {},
    } as unknown as pty.IPty;
    const fakeTmux = {
      attach: () => fakeTerminal,
      capture: async () => "",
      scroll: async (tmuxName: string, direction: "up" | "down") => {
        scrolls.push({ tmuxName, direction });
      },
    } as unknown as TmuxManager;

    server = new WebSocketServer({ port: 0 });
    registerTerminalSocket(server, db, fakeTmux);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing websocket address");
    socket = await openWebSocket(`ws://127.0.0.1:${address.port}`);

    socket.send(JSON.stringify({ type: "attach", sessionId: session.id, cols: 80, rows: 24 }));
    await nextMessage(socket);
    socket.send(JSON.stringify({ type: "scroll", direction: "up" }));
    socket.send(JSON.stringify({ type: "scroll", direction: "down" }));

    await expect.poll(() => scrolls).toEqual([
      { tmuxName: "rd_demo", direction: "up" },
      { tmuxName: "rd_demo", direction: "down" },
    ]);
  });
});

function openWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
  });
}
