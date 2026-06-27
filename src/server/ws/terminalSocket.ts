import type * as pty from "node-pty";
import type { WebSocketServer } from "ws";
import type { SessionType } from "../../shared/types.js";
import type { MetadataDb } from "../db.js";
import { TmuxManager } from "../terminal/TmuxManager.js";

type ClientMessage =
  | { type: "attach"; sessionId: string; cols: number; rows: number }
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "scroll"; direction: "up" | "down" };

export function registerTerminalSocket(server: WebSocketServer, db: MetadataDb, tmux = new TmuxManager()): void {
  server.on("connection", (socket) => {
    let terminal: pty.IPty | null = null;
    let attachedTmuxName: string | null = null;
    let outputSanitizer = new TerminalOutputSanitizer("bash");
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
      attachedTmuxName = null;
      outputSanitizer = new TerminalOutputSanitizer("bash");
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
        outputSanitizer = new TerminalOutputSanitizer(session.type);

        let scrollback = "";
        try {
          scrollback = await tmux.capture(session.tmuxName);
        } catch {
          scrollback = "";
        }
        send({ type: "scrollback", data: stripTerminalReplay(session.type, scrollback) });

        try {
          terminal = tmux.attach(session.tmuxName, message.cols, message.rows);
          attachedTmuxName = session.tmuxName;
        } catch (error) {
          db.updateSessionStatus(session.id, "exited");
          send({ type: "error", error: error instanceof Error ? error.message : "terminal attach failed" });
          return;
        }
        const attachedTerminal = terminal;
        const attachedSessionId = session.id;
        db.touchSessionAttachment(session.id);
        terminal.onData((data) => {
          const cleanData = outputSanitizer.clean(data);
          if (cleanData) send({ type: "output", data: cleanData });
        });
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

      if (message.type === "scroll") {
        if (attachedTmuxName) {
          await tmux.scroll(attachedTmuxName, message.direction);
        }
        return;
      }

      terminal.resize(message.cols, message.rows);
    }
  });
}

class TerminalOutputSanitizer {
  private carry = "";

  constructor(private readonly sessionType: SessionType) {}

  clean(data: string): string {
    if (!shouldStripAltScreen(this.sessionType)) return data;

    data = this.carry + data;
    this.carry = "";
    const splitTail = data.match(/\x1b(?:\[\??[0-9]{0,4})?$/);
    if (splitTail) {
      this.carry = splitTail[0];
      data = data.slice(0, -splitTail[0].length);
    }
    return stripTerminalControlSequences(data);
  }
}

function stripTerminalReplay(sessionType: SessionType, data: string): string {
  return shouldStripAltScreen(sessionType) ? stripTerminalControlSequences(data) : data;
}

function shouldStripAltScreen(sessionType: SessionType): boolean {
  return sessionType === "bash" || sessionType === "codex" || sessionType === "claude";
}

function stripTerminalControlSequences(data: string): string {
  return data
    .replace(/\x1b\[\?(?:47|1047|1049)[hl]/g, "")
    .replace(/\x1b\[3J/g, "")
    .replace(/\x1b\[\?(?:1000|1001|1002|1003|1005|1006|1007)[hl]/g, "");
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
  if (parsed.type === "scroll" && (parsed.direction === "up" || parsed.direction === "down")) {
    return { type: "scroll", direction: parsed.direction };
  }
  throw new Error("invalid terminal message");
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
