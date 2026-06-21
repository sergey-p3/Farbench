import type * as pty from "node-pty";
import type { WebSocketServer } from "ws";
import type { MetadataDb } from "../db.js";
import { TmuxManager } from "../terminal/TmuxManager.js";

type ClientMessage =
  | { type: "attach"; sessionId: string; cols: number; rows: number }
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

export function registerTerminalSocket(server: WebSocketServer, db: MetadataDb, tmux = new TmuxManager()): void {
  server.on("connection", (socket) => {
    let terminal: pty.IPty | null = null;
    const detachedTerminals = new WeakSet<pty.IPty>();

    const send = (message: Record<string, unknown>): void => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    };

    const detach = (): void => {
      if (!terminal) return;
      detachedTerminals.add(terminal);
      terminal.kill();
      terminal = null;
    };

    socket.on("message", (raw) => {
      void handleMessage(raw.toString()).catch((error: unknown) => {
        send({ type: "error", error: error instanceof Error ? error.message : "terminal socket error" });
      });
    });

    socket.on("close", detach);

    async function handleMessage(raw: string): Promise<void> {
      const message = parseMessage(raw);

      if (message.type === "attach") {
        const session = db.getSession(message.sessionId);
        if (!session) {
          send({ type: "error", error: "session not found" });
          return;
        }

        detach();

        let scrollback = "";
        try {
          scrollback = await tmux.capture(session.tmuxName);
        } catch {
          scrollback = "";
        }
        send({ type: "scrollback", data: scrollback });

        terminal = tmux.attach(session.tmuxName, message.cols, message.rows);
        const attachedTerminal = terminal;
        const attachedSessionId = session.id;
        db.touchSessionAttachment(session.id);
        terminal.onData((data) => send({ type: "output", data }));
        terminal.onExit(() => {
          if (!detachedTerminals.has(attachedTerminal)) {
            db.updateSessionStatus(attachedSessionId, "exited");
            send({ type: "exit" });
          }
          if (terminal === attachedTerminal) {
            terminal = null;
          }
        });
        return;
      }

      if (!terminal) return;

      if (message.type === "input") {
        terminal.write(message.data);
        return;
      }

      terminal.resize(message.cols, message.rows);
    }
  });
}

function parseMessage(raw: string): ClientMessage {
  const parsed = JSON.parse(raw) as Partial<ClientMessage>;
  if (parsed.type === "attach" && typeof parsed.sessionId === "string") {
    return {
      type: "attach",
      sessionId: parsed.sessionId,
      cols: numberOrDefault(parsed.cols, 80),
      rows: numberOrDefault(parsed.rows, 24),
    };
  }
  if (parsed.type === "input" && typeof parsed.data === "string") {
    return { type: "input", data: parsed.data };
  }
  if (parsed.type === "resize") {
    return {
      type: "resize",
      cols: numberOrDefault(parsed.cols, 80),
      rows: numberOrDefault(parsed.rows, 24),
    };
  }
  throw new Error("invalid terminal message");
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
