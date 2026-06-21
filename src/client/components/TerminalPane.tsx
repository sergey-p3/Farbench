import { useEffect, useRef, useState } from "react";
import { FitAddon } from "xterm-addon-fit";
import { Terminal } from "xterm";
import { api, isUnauthorized } from "../api.js";

interface TerminalPaneProps {
  sessionId: string | null;
  onOpenCreateSheet: () => void;
  onUnauthorized?: () => void;
}

type TerminalSocketMessage =
  | { type: "scrollback"; data: string }
  | { type: "output"; data: string }
  | { type: "error"; error: string }
  | { type: "exit" };

export function terminalSocketUrl(locationLike: Pick<Location, "protocol" | "host"> = window.location): string {
  const protocol = locationLike.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${locationLike.host}/ws/terminal`;
}

export function TerminalPane({ sessionId, onOpenCreateSheet, onUnauthorized }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    setStatus(null);

    if (!sessionId || !containerRef.current) {
      return;
    }

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "JetBrains Mono, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      scrollback: 5000,
      theme: {
        background: "#101820",
        foreground: "#d7dee8",
      },
    });
    const fitAddon = new FitAddon();
    const socket = new WebSocket(terminalSocketUrl());
    let authProbeStarted = false;

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    socketRef.current = socket;
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);

    const fit = () => {
      try {
        fitAddon.fit();
      } catch {
        return;
      }
    };

    const sendResize = () => {
      if (!isCurrentSocket() || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
    };

    const handleResize = () => {
      fit();
      sendResize();
    };

    fit();
    window.addEventListener("resize", handleResize);
    const dataDisposable = terminal.onData((data) => {
      if (isCurrentSocket() && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data }));
      }
    });

    socket.addEventListener("open", () => {
      if (!isCurrentSocket()) return;
      fit();
      socket.send(JSON.stringify({ type: "attach", sessionId, cols: terminal.cols, rows: terminal.rows }));
      setStatus(null);
      terminal.focus();
    });

    socket.addEventListener("message", (event) => {
      if (!isCurrentSocket()) return;
      const message = parseTerminalMessage(event.data);
      if (!message) return;

      if (message.type === "scrollback") {
        terminal.clear();
        if (message.data) terminal.write(message.data);
        return;
      }

      if (message.type === "output") {
        terminal.write(message.data);
        return;
      }

      if (message.type === "error") {
        setStatus(message.error);
        terminal.writeln(`\r\n${message.error}`);
        return;
      }

      setStatus("Terminal exited.");
      terminal.writeln("\r\nTerminal exited.");
    });

    socket.addEventListener("close", () => {
      handleConnectionFailure("Terminal disconnected.");
    });

    socket.addEventListener("error", () => {
      handleConnectionFailure("Unable to connect to terminal.");
    });

    function handleConnectionFailure(message: string) {
      if (!isCurrentSocket()) return;
      setStatus(message);
      if (authProbeStarted) return;
      authProbeStarted = true;
      void verifyAuth(message);
    }

    async function verifyAuth(message: string) {
      try {
        await api.workspaces();
      } catch (error) {
        if (!isCurrentSocket()) return;
        if (isUnauthorized(error)) {
          onUnauthorized?.();
          return;
        }
        setStatus(message);
      }
    }

    function isCurrentSocket(): boolean {
      return socketRef.current === socket && terminalRef.current === terminal;
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      dataDisposable.dispose();
      if (socketRef.current === socket) socketRef.current = null;
      if (terminalRef.current === terminal) terminalRef.current = null;
      if (fitAddonRef.current === fitAddon) fitAddonRef.current = null;
      socket.close();
      terminal.dispose();
    };
  }, [onUnauthorized, retryNonce, sessionId]);

  if (!sessionId) {
    return (
      <div className="tool-panel empty-tool">
        <p className="empty-state">Select a session to attach a terminal.</p>
        <button onClick={onOpenCreateSheet} type="button">Create new</button>
      </div>
    );
  }

  return (
    <div className="tool-panel terminal-pane">
      {status ? (
        <div className="panel-error terminal-status" role="status">
          <span>{status}</span>
          <div className="terminal-status-actions">
            <button onClick={() => setRetryNonce((current) => current + 1)} type="button">Retry</button>
            <button onClick={onOpenCreateSheet} type="button">Create new</button>
          </div>
        </div>
      ) : null}
      <div className="terminal-host" ref={containerRef} />
    </div>
  );
}

function parseTerminalMessage(data: unknown): TerminalSocketMessage | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data) as Partial<TerminalSocketMessage>;
    if ((parsed.type === "scrollback" || parsed.type === "output") && typeof parsed.data === "string") {
      return parsed as TerminalSocketMessage;
    }
    if (parsed.type === "error" && typeof parsed.error === "string") {
      return parsed as TerminalSocketMessage;
    }
    if (parsed.type === "exit") {
      return { type: "exit" };
    }
  } catch {
    return null;
  }
  return null;
}
