import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "xterm-addon-fit";
import { Terminal } from "xterm";
import { api, isUnauthorized } from "../api.js";
import { terminalControlSequence, terminalKeyLabels, type TerminalToolbarKey } from "../terminalKeys.js";
import { terminalKeyboardChromeInset } from "../terminalViewport.js";

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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRailRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isCtrlActiveRef = useRef(false);
  const skipNextToolbarClickRef = useRef(false);
  const skipNextScrollClickRef = useRef(false);
  const [status, setStatus] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [isCtrlActive, setIsCtrlActive] = useState(false);

  const updateCtrlActive = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    const nextValue = typeof next === "function" ? next(isCtrlActiveRef.current) : next;
    isCtrlActiveRef.current = nextValue;
    setIsCtrlActive(nextValue);
  }, []);

  const sendTerminalInput = useCallback((data: string) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "input", data }));
  }, []);

  const handleToolbarKey = useCallback((key: TerminalToolbarKey) => {
    if (key === "ctrl") {
      updateCtrlActive((current) => !current);
      return;
    }

    const sequence = terminalControlSequence(key, isCtrlActiveRef.current);
    if (!sequence) return;
    sendTerminalInput(sequence.data);
    if (sequence.clearsCtrl) updateCtrlActive(false);
  }, [sendTerminalInput, updateCtrlActive]);

  const preserveTerminalFocus = useCallback((event: React.PointerEvent<HTMLButtonElement> | React.TouchEvent<HTMLButtonElement>) => {
    event.preventDefault();
  }, []);

  const handleToolbarTouchEnd = useCallback((event: React.TouchEvent<HTMLButtonElement>, key: TerminalToolbarKey) => {
    event.preventDefault();
    skipNextToolbarClickRef.current = true;
    handleToolbarKey(key);
  }, [handleToolbarKey]);

  const handleToolbarClick = useCallback((key: TerminalToolbarKey) => {
    if (skipNextToolbarClickRef.current) {
      skipNextToolbarClickRef.current = false;
      return;
    }
    handleToolbarKey(key);
  }, [handleToolbarKey]);

  const scrollTerminalPages = useCallback((pages: number) => {
    const terminal = terminalRef.current;
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "scroll", direction: pages < 0 ? "up" : "down" }));
    }
    terminal?.focus();
  }, []);

  const handleScrollTouchEnd = useCallback((event: React.TouchEvent<HTMLButtonElement>, pages: number) => {
    event.preventDefault();
    skipNextScrollClickRef.current = true;
    scrollTerminalPages(pages);
  }, [scrollTerminalPages]);

  const handleScrollClick = useCallback((pages: number) => {
    if (skipNextScrollClickRef.current) {
      skipNextScrollClickRef.current = false;
      return;
    }
    scrollTerminalPages(pages);
  }, [scrollTerminalPages]);

  useEffect(() => {
    setStatus(null);
    updateCtrlActive(false);

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

    const fitAndResize = () => {
      fit();
      sendResize();
    };

    const syncVisualViewport = () => {
      const viewport = window.visualViewport;
      if (rootRef.current && viewport) {
        rootRef.current.style.setProperty("--terminal-visual-height", `${viewport.height}px`);
        rootRef.current.style.setProperty("--terminal-keyboard-chrome-inset", `${terminalKeyboardChromeInset({
          innerHeight: window.innerHeight,
          maxTouchPoints: navigator.maxTouchPoints,
          userAgent: navigator.userAgent,
          visualViewportHeight: viewport.height,
          visualViewportOffsetTop: viewport.offsetTop,
        })}px`);
      }
      fitAndResize();
    };

    syncVisualViewport();
    window.addEventListener("resize", syncVisualViewport);
    window.visualViewport?.addEventListener("resize", syncVisualViewport);
    window.visualViewport?.addEventListener("scroll", syncVisualViewport);
    const resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(containerRef.current);

    let lastTouchY: number | null = null;
    let pendingTouchScrollRows = 0;
    const touchScrollTarget = containerRef.current;
    const scrollRail = scrollRailRef.current;
    const beginTouchScroll = (event: TouchEvent) => {
      const touchY = touchScrollY(event.touches);
      if (touchY !== null) {
        lastTouchY = touchY;
        pendingTouchScrollRows = 0;
        terminal.focus();
        return;
      }
      lastTouchY = null;
    };
    const moveTouchScroll = (event: TouchEvent) => {
      if (lastTouchY === null) return;
      const nextY = touchScrollY(event.touches);
      if (nextY === null) return;
      const viewport = touchScrollTarget.querySelector(".xterm-viewport");
      if (!(viewport instanceof HTMLElement)) {
        lastTouchY = nextY;
        return;
      }

      const deltaY = lastTouchY - nextY;
      const rowHeight = Math.max(1, terminal.element?.querySelector(".xterm-rows > div")?.getBoundingClientRect().height ?? 15);
      pendingTouchScrollRows += deltaY / rowHeight;
      const rowsToScroll = Math.trunc(pendingTouchScrollRows);
      const before = viewport.scrollTop;
      if (rowsToScroll !== 0) {
        terminal.scrollLines(rowsToScroll);
        pendingTouchScrollRows -= rowsToScroll;
      }
      if (viewport.scrollTop === before) {
        viewport.scrollTop += deltaY;
      }
      lastTouchY = nextY;
      if (event.cancelable) {
        event.preventDefault();
      }
    };
    const resetTouchScroll = () => {
      lastTouchY = null;
    };
    touchScrollTarget.addEventListener("touchstart", beginTouchScroll, { capture: true, passive: true });
    touchScrollTarget.addEventListener("touchmove", moveTouchScroll, { capture: true, passive: false });
    touchScrollTarget.addEventListener("touchend", resetTouchScroll, true);
    touchScrollTarget.addEventListener("touchcancel", resetTouchScroll, true);
    scrollRail?.addEventListener("touchstart", beginTouchScroll, { capture: true, passive: true });
    scrollRail?.addEventListener("touchmove", moveTouchScroll, { capture: true, passive: false });
    scrollRail?.addEventListener("touchend", resetTouchScroll, true);
    scrollRail?.addEventListener("touchcancel", resetTouchScroll, true);

    const dataDisposable = terminal.onData((data) => {
      if (isCtrlActiveRef.current) {
        const controlKey = controlLetterKey(data);
        updateCtrlActive(false);
        if (controlKey) {
          const sequence = terminalControlSequence(controlKey, true);
          if (sequence) {
            sendTerminalInput(sequence.data);
            return;
          }
        }
      } else {
        updateCtrlActive(false);
      }
      sendTerminalInput(data);
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
      window.removeEventListener("resize", syncVisualViewport);
      window.visualViewport?.removeEventListener("resize", syncVisualViewport);
      window.visualViewport?.removeEventListener("scroll", syncVisualViewport);
      resizeObserver.disconnect();
      touchScrollTarget.removeEventListener("touchstart", beginTouchScroll, true);
      touchScrollTarget.removeEventListener("touchmove", moveTouchScroll, true);
      touchScrollTarget.removeEventListener("touchend", resetTouchScroll, true);
      touchScrollTarget.removeEventListener("touchcancel", resetTouchScroll, true);
      scrollRail?.removeEventListener("touchstart", beginTouchScroll, true);
      scrollRail?.removeEventListener("touchmove", moveTouchScroll, true);
      scrollRail?.removeEventListener("touchend", resetTouchScroll, true);
      scrollRail?.removeEventListener("touchcancel", resetTouchScroll, true);
      dataDisposable.dispose();
      if (socketRef.current === socket) socketRef.current = null;
      if (terminalRef.current === terminal) terminalRef.current = null;
      if (fitAddonRef.current === fitAddon) fitAddonRef.current = null;
      socket.close();
      terminal.dispose();
    };
  }, [onUnauthorized, retryNonce, sendTerminalInput, sessionId, updateCtrlActive]);

  if (!sessionId) {
    return (
      <div className="tool-panel empty-tool">
        <p className="empty-state">Select a session to attach a terminal.</p>
        <button onClick={onOpenCreateSheet} type="button">Create new</button>
      </div>
    );
  }

  return (
    <div className="tool-panel terminal-pane" ref={rootRef}>
      {status ? (
        <div className="panel-error terminal-status" role="status">
          <span>{status}</span>
          <div className="terminal-status-actions">
            <button onClick={() => setRetryNonce((current) => current + 1)} type="button">Retry</button>
            <button onClick={onOpenCreateSheet} type="button">Create new</button>
          </div>
        </div>
      ) : null}
      <div className="terminal-stage">
        <div className="terminal-host" ref={containerRef} />
        <div
          aria-label="Terminal scroll controls"
          className="terminal-scroll-rail"
          ref={scrollRailRef}
        >
          <button
            aria-label="Scroll terminal up"
            onClick={() => handleScrollClick(-1)}
            onPointerDown={preserveTerminalFocus}
            onTouchEnd={(event) => handleScrollTouchEnd(event, -1)}
            onTouchStart={preserveTerminalFocus}
            type="button"
          >
            ↑
          </button>
          <button
            aria-label="Scroll terminal down"
            onClick={() => handleScrollClick(1)}
            onPointerDown={preserveTerminalFocus}
            onTouchEnd={(event) => handleScrollTouchEnd(event, 1)}
            onTouchStart={preserveTerminalFocus}
            type="button"
          >
            ↓
          </button>
        </div>
      </div>
      <div className="terminal-keybar" role="toolbar" aria-label="Terminal special keys">
        {terminalKeyLabels.map((key) => (
          <button
            aria-label={key.ariaLabel}
            aria-pressed={key.key === "ctrl" ? isCtrlActive : undefined}
            className={key.key === "ctrl" && isCtrlActive ? "active" : undefined}
            key={key.key}
            onClick={() => handleToolbarClick(key.key)}
            onPointerDown={preserveTerminalFocus}
            onTouchEnd={(event) => handleToolbarTouchEnd(event, key.key)}
            onTouchStart={preserveTerminalFocus}
            type="button"
          >
            {key.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function controlLetterKey(data: string): "c" | "d" | "l" | null {
  if (data.length !== 1) return null;
  const key = data.toLowerCase();
  return key === "c" || key === "d" || key === "l" ? key : null;
}

function touchScrollY(touches: TouchList): number | null {
  if (touches.length !== 1 && touches.length !== 2) return null;
  let total = 0;
  for (let index = 0; index < touches.length; index += 1) {
    total += touches[index]?.clientY ?? 0;
  }
  return total / touches.length;
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
