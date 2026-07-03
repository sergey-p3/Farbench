import type * as pty from "node-pty";
import type { WebSocketServer } from "ws";
import { TERMINAL_HISTORY_CACHE_BYTES } from "../../shared/terminalHistory.js";
import type { SessionType } from "../../shared/types.js";
import type { MetadataDb } from "../db.js";
import { createTerminalDebugLogger, type TerminalDebugLogger, type TerminalDebugOptions } from "../terminalDebug.js";
import { TmuxManager } from "../terminal/TmuxManager.js";

type ClientMessage =
  | { type: "attach"; sessionId: string; cols: number; rows: number }
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "scroll"; direction: "up" | "down" };

interface TerminalSocketOptions {
  debug?: TerminalDebugOptions;
}

let nextTerminalSocketConnectionId = 1;

export function registerTerminalSocket(
  server: WebSocketServer,
  db: MetadataDb,
  tmux = new TmuxManager(),
  options: TerminalSocketOptions = {},
): void {
  server.on("connection", (socket) => {
    const connectionId = nextTerminalSocketConnectionId++;
    const debug = createTerminalDebugLogger({ component: "TerminalSocket", connectionId }, options.debug);
    let terminal: pty.IPty | null = null;
    let attachedSessionId: string | null = null;
    let attachedTmuxName: string | null = null;
    let outputSanitizer = new TerminalOutputSanitizer("bash");
    let hasLiveActivity = false;
    const detachedTerminals = new WeakSet<pty.IPty>();

    debug.log("socket.connection", {
      connectedClients: server.clients.size,
      readyState: wsReadyStateName(socket.readyState),
    });

    const send = (message: Record<string, unknown>): void => {
      if (socket.readyState === socket.OPEN) {
        debug.log("send", {
          bytes: responseBytes(message),
          messageType: messageType(message),
          readyState: wsReadyStateName(socket.readyState),
          sessionId: attachedSessionId,
          tmuxName: attachedTmuxName,
        });
        socket.send(JSON.stringify(message));
        return;
      }
      debug.log("send.skipped", {
        messageType: messageType(message),
        readyState: wsReadyStateName(socket.readyState),
        sessionId: attachedSessionId,
        tmuxName: attachedTmuxName,
      });
    };

    const detach = (reason: string): void => {
      if (!terminal) {
        debug.log("detach.skipped", { reason });
        return;
      }
      const detachedTerminal = terminal;
      debug.log("detach.start", {
        pid: detachedTerminal.pid,
        reason,
        sessionId: attachedSessionId,
        tmuxName: attachedTmuxName,
      });
      detachedTerminals.add(terminal);
      terminal.kill();
      terminal = null;
      attachedSessionId = null;
      attachedTmuxName = null;
      outputSanitizer = new TerminalOutputSanitizer("bash");
      hasLiveActivity = false;
      debug.log("detach.complete", { pid: detachedTerminal.pid, reason });
    };

    socket.on("message", (raw) => {
      void handleMessage(raw.toString()).catch((error: unknown) => {
        debug.log("message.error", { error: error instanceof Error ? error.message : "terminal socket error" });
        send({ type: "error", error: error instanceof Error ? error.message : "terminal socket error" });
      });
    });

    socket.on("close", (code, reason) => {
      debug.log("socket.close", {
        code,
        readyState: wsReadyStateName(socket.readyState),
        reason: reason.toString("utf8"),
      });
      detach("socket.close");
    });

    socket.on("error", (error) => {
      debug.log("socket.error", { error: error.message, readyState: wsReadyStateName(socket.readyState) });
    });

    async function handleMessage(raw: string): Promise<void> {
      const message = parseMessage(raw);
      debug.log("message", messageFields(message, raw.length));

      if (message.type === "attach") {
        const session = db.getSession(message.sessionId);
        if (!session) {
          debug.log("attach.missing_session", { sessionId: message.sessionId });
          send({ type: "error", error: "session not found" });
          return;
        }

        detach("attach.replace");
        outputSanitizer = new TerminalOutputSanitizer(session.type);

        const tmuxClientsBefore = await debugTmuxClientCount(tmux, session.tmuxName, debug);
        debug.log("attach.start", {
          cols: message.cols,
          rows: message.rows,
          sessionId: session.id,
          tmuxClientsBefore,
          tmuxName: session.tmuxName,
        });

        try {
          terminal = tmux.attach(session.tmuxName, message.cols, message.rows);
          attachedSessionId = session.id;
          attachedTmuxName = session.tmuxName;
        } catch (error) {
          debug.log("attach.failed", {
            error: error instanceof Error ? error.message : "terminal attach failed",
            sessionId: session.id,
            tmuxName: session.tmuxName,
          });
          db.updateSessionStatus(session.id, "exited");
          send({ type: "error", error: error instanceof Error ? error.message : "terminal attach failed" });
          return;
        }
        const attachedTerminal = terminal;
        const exitedSessionId = session.id;
        const tmuxClientsAfter = await debugTmuxClientCount(tmux, session.tmuxName, debug);
        debug.log("attach.success", {
          cols: attachedTerminal.cols,
          pid: attachedTerminal.pid,
          rows: attachedTerminal.rows,
          sessionId: session.id,
          tmuxClientsAfter,
          tmuxName: session.tmuxName,
        });
        hasLiveActivity = false;
        db.touchSessionAttachment(session.id);
        terminal.onData((data) => {
          const cleanData = outputSanitizer.clean(data);
          debug.log("pty.data", {
            cleanBytes: cleanData.length,
            rawBytes: data.length,
            sent: Boolean(cleanData),
            sessionId: attachedSessionId,
            tmuxName: session.tmuxName,
          });
          if (cleanData) {
            hasLiveActivity = true;
            send({ type: "output", data: cleanData });
          }
        });
        terminal.onExit((exit) => {
          const detached = detachedTerminals.has(attachedTerminal);
          debug.log("pty.exit", {
            detached,
            exitCode: exit.exitCode,
            sessionId: exitedSessionId,
            signal: exit.signal ?? null,
            tmuxName: session.tmuxName,
          });
          if (!detached) {
            db.updateSessionStatus(exitedSessionId, "exited");
            send({ type: "exit" });
          }
          if (terminal === attachedTerminal) {
            terminal = null;
            attachedSessionId = null;
            attachedTmuxName = null;
          }
        });
        debug.log("capture.start", { sessionId: session.id, tmuxName: session.tmuxName });
        void tmux.capture(session.tmuxName)
          .then((scrollback) => {
            if (terminal !== attachedTerminal || hasLiveActivity) {
              debug.log("capture.skipped", {
                current: terminal === attachedTerminal,
                hasLiveActivity,
                rawBytes: scrollback.length,
                sessionId: session.id,
                tmuxName: session.tmuxName,
              });
              return;
            }
            const replay = stripTerminalReplay(session.type, capTerminalReplay(scrollback));
            debug.log("capture.sent", {
              bytes: replay.length,
              rawBytes: scrollback.length,
              sessionId: session.id,
              tmuxName: session.tmuxName,
            });
            send({ type: "scrollback", data: replay });
          })
          .catch((error: unknown) => {
            debug.log("capture.failed", {
              error: error instanceof Error ? error.message : "terminal capture failed",
              sessionId: session.id,
              tmuxName: session.tmuxName,
            });
          });
        return;
      }

      if (!terminal) {
        debug.log("message.ignored", { messageType: message.type, reason: "not attached" });
        return;
      }

      if (message.type === "input") {
        hasLiveActivity = true;
        debug.log("input", { bytes: message.data.length, sessionId: attachedSessionId, tmuxName: attachedTmuxName });
        terminal.write(message.data);
        return;
      }

      if (message.type === "scroll") {
        if (attachedTmuxName) {
          debug.log("scroll", { direction: message.direction, sessionId: attachedSessionId, tmuxName: attachedTmuxName });
          await tmux.scroll(attachedTmuxName, message.direction);
        }
        return;
      }

      debug.log("resize", {
        cols: message.cols,
        rows: message.rows,
        sessionId: attachedSessionId,
        tmuxName: attachedTmuxName,
      });
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

function capTerminalReplay(data: string): string {
  return data.length > TERMINAL_HISTORY_CACHE_BYTES ? data.slice(-TERMINAL_HISTORY_CACHE_BYTES) : data;
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
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

async function debugTmuxClientCount(
  tmux: TmuxManager,
  tmuxName: string,
  debug: TerminalDebugLogger,
): Promise<number | null> {
  if (!debug.enabled) return null;
  const diagnostics = tmux as TmuxManager & { clientCount?: (name: string) => Promise<number> };
  if (typeof diagnostics.clientCount !== "function") return null;
  try {
    return await diagnostics.clientCount(tmuxName);
  } catch (error) {
    debug.log("tmux.client_count.failed", {
      error: error instanceof Error ? error.message : "tmux client count failed",
      tmuxName,
    });
    return null;
  }
}

function messageFields(message: ClientMessage, rawBytes: number): Record<string, string | number> {
  if (message.type === "attach") {
    return {
      bytes: rawBytes,
      cols: message.cols,
      messageType: message.type,
      rows: message.rows,
      sessionId: message.sessionId,
    };
  }
  if (message.type === "input") {
    return { bytes: message.data.length, messageType: message.type };
  }
  if (message.type === "resize") {
    return { bytes: rawBytes, cols: message.cols, messageType: message.type, rows: message.rows };
  }
  return { bytes: rawBytes, direction: message.direction, messageType: message.type };
}

function messageType(message: Record<string, unknown>): string {
  return typeof message.type === "string" ? message.type : "unknown";
}

function responseBytes(message: Record<string, unknown>): number {
  if (typeof message.data === "string") return message.data.length;
  if (typeof message.error === "string") return message.error.length;
  return 0;
}

function wsReadyStateName(readyState: number): string {
  if (readyState === 0) return "connecting";
  if (readyState === 1) return "open";
  if (readyState === 2) return "closing";
  if (readyState === 3) return "closed";
  return "unknown";
}
