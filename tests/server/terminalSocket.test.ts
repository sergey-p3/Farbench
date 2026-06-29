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

  it("forwards terminal input to the attached pty", async () => {
    dir = mkdtempSync(join(tmpdir(), "remote-dev-terminal-"));
    const db = createDatabase(join(dir, "state.db"));
    const workspace = db.upsertWorkspace({ name: "demo", rootPath: dir });
    const session = db.createSession({ workspaceId: workspace.id, name: "bash", type: "bash", tmuxName: "rd_demo" });
    const writes: string[] = [];
    const fakeTerminal = {
      kill() {},
      onData() {},
      onExit() {},
      resize() {},
      write(data: string) {
        writes.push(data);
      },
    } as unknown as pty.IPty;
    const fakeTmux = {
      attach: () => fakeTerminal,
      capture: async () => "",
      scroll: async () => {},
    } as unknown as TmuxManager;

    server = new WebSocketServer({ port: 0 });
    registerTerminalSocket(server, db, fakeTmux);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing websocket address");
    socket = await openWebSocket(`ws://127.0.0.1:${address.port}`);

    socket.send(JSON.stringify({ type: "attach", sessionId: session.id, cols: 80, rows: 24 }));
    await nextMessage(socket);
    socket.send(JSON.stringify({ type: "input", data: "echo typed\r" }));

    await expect.poll(() => writes).toEqual(["echo typed\r"]);
  });

  it("falls back to usable terminal dimensions when attach receives zero geometry", async () => {
    dir = mkdtempSync(join(tmpdir(), "remote-dev-terminal-"));
    const db = createDatabase(join(dir, "state.db"));
    const workspace = db.upsertWorkspace({ name: "demo", rootPath: dir });
    const session = db.createSession({ workspaceId: workspace.id, name: "bash", type: "bash", tmuxName: "rd_demo" });
    const attaches: Array<{ cols: number; rows: number }> = [];
    const fakeTerminal = {
      kill() {},
      onData() {},
      onExit() {},
      resize() {},
      write() {},
    } as unknown as pty.IPty;
    const fakeTmux = {
      attach: (_tmuxName: string, cols: number, rows: number) => {
        attaches.push({ cols, rows });
        return fakeTerminal;
      },
      capture: async () => "",
      scroll: async () => {},
    } as unknown as TmuxManager;

    server = new WebSocketServer({ port: 0 });
    registerTerminalSocket(server, db, fakeTmux);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing websocket address");
    socket = await openWebSocket(`ws://127.0.0.1:${address.port}`);

    socket.send(JSON.stringify({ type: "attach", sessionId: session.id, cols: 0, rows: 0 }));
    await nextMessage(socket);

    await expect.poll(() => attaches).toEqual([{ cols: 80, rows: 24 }]);
  });

  it("attaches the live terminal without waiting for scrollback capture", async () => {
    dir = mkdtempSync(join(tmpdir(), "remote-dev-terminal-"));
    const db = createDatabase(join(dir, "state.db"));
    const workspace = db.upsertWorkspace({ name: "demo", rootPath: dir });
    const session = db.createSession({ workspaceId: workspace.id, name: "bash", type: "bash", tmuxName: "rd_demo" });
    const writes: string[] = [];
    let attachCount = 0;
    const fakeTerminal = {
      kill() {},
      onData() {},
      onExit() {},
      resize() {},
      write(data: string) {
        writes.push(data);
      },
    } as unknown as pty.IPty;
    const fakeTmux = {
      attach: () => {
        attachCount += 1;
        return fakeTerminal;
      },
      capture: () => new Promise<string>(() => {}),
      scroll: async () => {},
    } as unknown as TmuxManager;

    server = new WebSocketServer({ port: 0 });
    registerTerminalSocket(server, db, fakeTmux);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing websocket address");
    socket = await openWebSocket(`ws://127.0.0.1:${address.port}`);

    socket.send(JSON.stringify({ type: "attach", sessionId: session.id, cols: 80, rows: 24 }));
    await expect.poll(() => attachCount).toBe(1);
    socket.send(JSON.stringify({ type: "input", data: "echo typed\r" }));

    await expect.poll(() => writes).toEqual(["echo typed\r"]);
  });

  it("strips codex alt-screen and mouse-tracking sequences from replay and live output while preserving live colors", async () => {
    dir = mkdtempSync(join(tmpdir(), "remote-dev-terminal-"));
    const db = createDatabase(join(dir, "state.db"));
    const workspace = db.upsertWorkspace({ name: "demo", rootPath: dir });
    const session = db.createSession({ workspaceId: workspace.id, name: "codex", type: "codex", tmuxName: "rd_codex" });
    let onData: ((data: string) => void) | null = null;
    const fakeTerminal = {
      kill() {},
      onData(callback: (data: string) => void) {
        onData = callback;
      },
      onExit() {},
      resize() {},
      write() {},
    } as unknown as pty.IPty;
    const fakeTmux = {
      attach: () => fakeTerminal,
      capture: async () => "before\x1b[31mred\x1b[0m\x1b[?1049h\x1b[?1006h\x1b[3Jafter",
      scroll: async () => {},
    } as unknown as TmuxManager;

    server = new WebSocketServer({ port: 0 });
    registerTerminalSocket(server, db, fakeTmux);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing websocket address");
    socket = await openWebSocket(`ws://127.0.0.1:${address.port}`);

    const replayMessage = nextMessage(socket);
    socket.send(JSON.stringify({ type: "attach", sessionId: session.id, cols: 80, rows: 24 }));
    await expect(replayMessage).resolves.toEqual({ type: "scrollback", data: "before\x1b[31mred\x1b[0mafter" });
    await expect.poll(() => onData).not.toBeNull();

    const liveMessage = nextMessage(socket);
    onData?.("live\x1b[?10");
    await expect(liveMessage).resolves.toEqual({ type: "output", data: "live" });
    const outputMessage = nextMessage(socket);
    onData?.("49h\x1b[?1000h\x1b[3J\x1b[32moutput\x1b[0m");
    await expect(outputMessage).resolves.toEqual({ type: "output", data: "\x1b[32moutput\x1b[0m" });
  });

  it("strips bash alt-screen and mouse-tracking sequences so shell scrollback stays reachable while preserving live colors", async () => {
    dir = mkdtempSync(join(tmpdir(), "remote-dev-terminal-"));
    const db = createDatabase(join(dir, "state.db"));
    const workspace = db.upsertWorkspace({ name: "demo", rootPath: dir });
    const session = db.createSession({ workspaceId: workspace.id, name: "bash", type: "bash", tmuxName: "rd_bash" });
    let onData: ((data: string) => void) | null = null;
    const fakeTerminal = {
      kill() {},
      onData(callback: (data: string) => void) {
        onData = callback;
      },
      onExit() {},
      resize() {},
      write() {},
    } as unknown as pty.IPty;
    const fakeTmux = {
      attach: () => fakeTerminal,
      capture: async () => "before\x1b[34mblue\x1b[0m\x1b[?1049h\x1b[?1006h\x1b[3Jafter",
      scroll: async () => {},
    } as unknown as TmuxManager;

    server = new WebSocketServer({ port: 0 });
    registerTerminalSocket(server, db, fakeTmux);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing websocket address");
    socket = await openWebSocket(`ws://127.0.0.1:${address.port}`);

    const replayMessage = nextMessage(socket);
    socket.send(JSON.stringify({ type: "attach", sessionId: session.id, cols: 80, rows: 24 }));
    await expect(replayMessage).resolves.toEqual({ type: "scrollback", data: "before\x1b[34mblue\x1b[0mafter" });
    await expect.poll(() => onData).not.toBeNull();

    const liveMessage = nextMessage(socket);
    onData?.("live\x1b[35mpurple\x1b[0m\x1b[?1049h\x1b[?1000h\x1b[3Joutput");
    await expect(liveMessage).resolves.toEqual({ type: "output", data: "live\x1b[35mpurple\x1b[0moutput" });
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
