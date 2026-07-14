import type * as pty from "node-pty";
import type { WebSocketServer } from "ws";
import type { MetadataDb } from "../db.js";
import { createTerminalDebugLogger, type TerminalDebugLogger, type TerminalDebugOptions } from "../terminalDebug.js";
import { TmuxManager } from "../terminal/TmuxManager.js";
import {
  capTerminalReplay,
  parseTerminalClientMessage,
  stripTerminalReplay,
  TerminalOutputSanitizer,
  terminalMessageFields,
  terminalResponseBytes,
  terminalResponseType,
  webSocketReadyStateName,
} from "./terminalProtocol.js";

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
    const detachedTerminals = new WeakSet<pty.IPty>();

    debug.log("socket.connection", {
      connectedClients: server.clients.size,
      readyState: webSocketReadyStateName(socket.readyState),
    });

    const send = (message: Record<string, unknown>): void => {
      if (socket.readyState === socket.OPEN) {
        debug.log("send", {
          bytes: terminalResponseBytes(message),
          messageType: terminalResponseType(message),
          readyState: webSocketReadyStateName(socket.readyState),
          sessionId: attachedSessionId,
          tmuxName: attachedTmuxName,
        });
        socket.send(JSON.stringify(message));
        return;
      }
      debug.log("send.skipped", {
        messageType: terminalResponseType(message),
        readyState: webSocketReadyStateName(socket.readyState),
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
        readyState: webSocketReadyStateName(socket.readyState),
        reason: reason.toString("utf8"),
      });
      detach("socket.close");
    });

    socket.on("error", (error) => {
      debug.log("socket.error", { error: error.message, readyState: webSocketReadyStateName(socket.readyState) });
    });

    async function handleMessage(raw: string): Promise<void> {
      const message = parseTerminalClientMessage(raw);
      debug.log("message", terminalMessageFields(message, raw.length));

      if (message.type === "attach") {
        const session = db.getSession(message.sessionId);
        if (!session) {
          debug.log("attach.missing_session", { sessionId: message.sessionId });
          send({ type: "error", error: "session not found" });
          return;
        }

        detach("attach.replace");
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
        const outputSanitizer = new TerminalOutputSanitizer(session.type);
        const bufferedOutput: string[] = [];
        let historySent = false;
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
            if (terminal !== attachedTerminal) return;
            // The first tmux redraw contains the visible pane. Keep it behind
            // captured history so xterm receives one correctly ordered stream.
            if (!historySent) {
              bufferedOutput.push(cleanData);
              debug.log("pty.data.buffered", {
                bufferedChunks: bufferedOutput.length,
                bytes: cleanData.length,
                sessionId: attachedSessionId,
                tmuxName: session.tmuxName,
              });
              return;
            }
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
        void tmux.capture(session.tmuxName, true)
          .then((scrollback) => {
            if (terminal !== attachedTerminal) {
              debug.log("capture.skipped", {
                current: terminal === attachedTerminal,
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
            historySent = true;
            for (const data of bufferedOutput.splice(0)) {
              send({ type: "output", data });
            }
            debug.log("capture.output_flushed", {
              sessionId: session.id,
              tmuxName: session.tmuxName,
            });
          })
          .catch((error: unknown) => {
            debug.log("capture.failed", {
              error: error instanceof Error ? error.message : "terminal capture failed",
              sessionId: session.id,
              tmuxName: session.tmuxName,
            });
            if (terminal !== attachedTerminal) return;
            send({ type: "scrollback", data: "" });
            historySent = true;
            for (const data of bufferedOutput.splice(0)) {
              send({ type: "output", data });
            }
          });
        return;
      }

      if (!terminal) {
        debug.log("message.ignored", { messageType: message.type, reason: "not attached" });
        return;
      }

      if (message.type === "input") {
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
