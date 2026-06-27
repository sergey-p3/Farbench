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

interface TerminalActionMenuState {
  x: number;
  y: number;
}

const LONG_PRESS_MS = 550;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const TERMINAL_ACTION_MENU_WIDTH_PX = 168;
const TOUCH_SCROLL_TAP_THRESHOLD_PX = 8;

export function terminalSocketUrl(locationLike: Pick<Location, "protocol" | "host"> = window.location): string {
  const protocol = locationLike.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${locationLike.host}/ws/terminal`;
}

export function TerminalPane({ sessionId, onOpenCreateSheet, onUnauthorized }: TerminalPaneProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isCtrlActiveRef = useRef(false);
  const skipNextToolbarClickRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [isCtrlActive, setIsCtrlActive] = useState(false);
  const [actionMenu, setActionMenu] = useState<TerminalActionMenuState | null>(null);

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

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }, []);

  const openTerminalActionMenu = useCallback((x: number, y: number) => {
    clearLongPress();
    const nextX = Math.max(8, Math.min(x, window.innerWidth - TERMINAL_ACTION_MENU_WIDTH_PX - 8));
    const nextY = Math.max(8, Math.min(y, window.innerHeight - 160));
    setActionMenu({ x: nextX, y: nextY });
    terminalRef.current?.focus();
  }, [clearLongPress]);

  const handleTerminalContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    openTerminalActionMenu(event.clientX, event.clientY);
  }, [openTerminalActionMenu]);

  const handleTerminalPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setActionMenu(null);
    terminalRef.current?.focus();
    if (event.button !== 0 || (event.pointerType !== "touch" && event.pointerType !== "pen")) return;

    const start = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    longPressStartRef.current = start;
    longPressTimerRef.current = window.setTimeout(() => {
      if (longPressStartRef.current?.pointerId === start.pointerId) {
        openTerminalActionMenu(start.x, start.y);
      }
    }, LONG_PRESS_MS);
  }, [openTerminalActionMenu]);

  const handleTerminalPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = longPressStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (distance > LONG_PRESS_MOVE_TOLERANCE_PX) {
      clearLongPress();
    }
  }, [clearLongPress]);

  const handleTerminalPointerEnd = useCallback(() => {
    clearLongPress();
  }, [clearLongPress]);

  const copyTerminalSelection = useCallback(async () => {
    const selection = terminalRef.current?.getSelection() ?? "";
    setActionMenu(null);
    terminalRef.current?.focus();
    if (!selection) return;

    try {
      await navigator.clipboard.writeText(selection);
    } catch {
      setStatus("Unable to copy terminal selection.");
    }
  }, []);

  const pasteFromClipboard = useCallback(async () => {
    setActionMenu(null);
    terminalRef.current?.focus();

    try {
      const text = await navigator.clipboard.readText();
      if (text) sendTerminalInput(text);
    } catch {
      setStatus("Unable to read clipboard.");
    }
  }, [sendTerminalInput]);

  const selectAllTerminalText = useCallback(() => {
    terminalRef.current?.selectAll();
    terminalRef.current?.focus();
    setActionMenu(null);
  }, []);

  useEffect(() => {
    if (!actionMenu) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setActionMenu(null);
        terminalRef.current?.focus();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (actionMenuRef.current?.contains(event.target as Node)) return;
      setActionMenu(null);
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleTerminalPointerEnd);
    window.addEventListener("scroll", handleTerminalPointerEnd, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleTerminalPointerEnd);
      window.removeEventListener("scroll", handleTerminalPointerEnd, true);
    };
  }, [actionMenu, handleTerminalPointerEnd]);

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
    let touchStartY = 0;
    let didTouchScroll = false;
    let pendingTouchScrollRows = 0;
    let activePointerId: number | null = null;
    let lastPointerY = 0;
    let pointerStartY = 0;
    let didPointerScroll = false;
    let pendingPointerScrollRows = 0;
    let lastPointerScrollAt = 0;
    const touchScrollTarget = containerRef.current;
    const scrollTerminalByPixels = (deltaY: number, pendingRows: number): number => {
      const viewport = touchScrollTarget.querySelector(".xterm-viewport");
      if (!(viewport instanceof HTMLElement)) return pendingRows;

      const rowHeight = Math.max(1, terminal.element?.querySelector(".xterm-rows > div")?.getBoundingClientRect().height ?? 15);
      const nextPendingRows = pendingRows + deltaY / rowHeight;
      const rowsToScroll = Math.trunc(nextPendingRows);
      const before = viewport.scrollTop;
      if (rowsToScroll !== 0) {
        terminal.scrollLines(rowsToScroll);
      }
      if (viewport.scrollTop === before) {
        viewport.scrollTop += deltaY;
      }
      return rowsToScroll === 0 ? nextPendingRows : nextPendingRows - rowsToScroll;
    };
    const beginTouchScroll = (event: TouchEvent) => {
      const touchY = touchScrollY(event.touches);
      if (touchY !== null) {
        lastTouchY = touchY;
        touchStartY = touchY;
        didTouchScroll = false;
        pendingTouchScrollRows = 0;
        terminal.focus();
        return;
      }
      lastTouchY = null;
    };
    const moveTouchScroll = (event: TouchEvent) => {
      if (lastTouchY === null) return;
      if (performance.now() - lastPointerScrollAt < 80) return;
      const nextY = touchScrollY(event.touches);
      if (nextY === null) return;
      if (!didTouchScroll && Math.abs(nextY - touchStartY) < TOUCH_SCROLL_TAP_THRESHOLD_PX) {
        return;
      }
      didTouchScroll = true;

      const deltaY = lastTouchY - nextY;
      pendingTouchScrollRows = scrollTerminalByPixels(deltaY, pendingTouchScrollRows);
      lastTouchY = nextY;
      clearLongPress();
      if (event.cancelable) {
        event.preventDefault();
      }
    };
    const resetTouchScroll = () => {
      lastTouchY = null;
      didTouchScroll = false;
    };
    const beginPointerScroll = (event: PointerEvent) => {
      if (event.button !== 0 || (event.pointerType !== "touch" && event.pointerType !== "pen")) return;
      activePointerId = event.pointerId;
      lastPointerY = event.clientY;
      pointerStartY = event.clientY;
      didPointerScroll = false;
      pendingPointerScrollRows = 0;
      terminal.focus();
    };
    const movePointerScroll = (event: PointerEvent) => {
      if (activePointerId !== event.pointerId) return;
      if (!didPointerScroll && Math.abs(event.clientY - pointerStartY) < TOUCH_SCROLL_TAP_THRESHOLD_PX) {
        return;
      }
      didPointerScroll = true;

      const deltaY = lastPointerY - event.clientY;
      pendingPointerScrollRows = scrollTerminalByPixels(deltaY, pendingPointerScrollRows);
      lastPointerY = event.clientY;
      lastPointerScrollAt = performance.now();
      clearLongPress();
      if (event.cancelable) {
        event.preventDefault();
      }
    };
    const resetPointerScroll = (event: PointerEvent) => {
      if (activePointerId !== event.pointerId) return;
      activePointerId = null;
      didPointerScroll = false;
    };
    touchScrollTarget.addEventListener("touchstart", beginTouchScroll, { capture: true, passive: true });
    touchScrollTarget.addEventListener("touchmove", moveTouchScroll, { capture: true, passive: false });
    touchScrollTarget.addEventListener("touchend", resetTouchScroll, true);
    touchScrollTarget.addEventListener("touchcancel", resetTouchScroll, true);
    touchScrollTarget.addEventListener("pointerdown", beginPointerScroll, { capture: true });
    touchScrollTarget.addEventListener("pointermove", movePointerScroll, { capture: true });
    touchScrollTarget.addEventListener("pointerup", resetPointerScroll, true);
    touchScrollTarget.addEventListener("pointercancel", resetPointerScroll, true);

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
      touchScrollTarget.removeEventListener("pointerdown", beginPointerScroll, true);
      touchScrollTarget.removeEventListener("pointermove", movePointerScroll, true);
      touchScrollTarget.removeEventListener("pointerup", resetPointerScroll, true);
      touchScrollTarget.removeEventListener("pointercancel", resetPointerScroll, true);
      dataDisposable.dispose();
      clearLongPress();
      if (socketRef.current === socket) socketRef.current = null;
      if (terminalRef.current === terminal) terminalRef.current = null;
      if (fitAddonRef.current === fitAddon) fitAddonRef.current = null;
      socket.close();
      terminal.dispose();
    };
  }, [clearLongPress, onUnauthorized, retryNonce, sendTerminalInput, sessionId, updateCtrlActive]);

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
      <div
        className="terminal-stage"
        onContextMenu={handleTerminalContextMenu}
        onPointerCancel={handleTerminalPointerEnd}
        onPointerDown={handleTerminalPointerDown}
        onPointerLeave={handleTerminalPointerEnd}
        onPointerMove={handleTerminalPointerMove}
        onPointerUp={handleTerminalPointerEnd}
      >
        <div className="terminal-host" ref={containerRef} />
      </div>
      {actionMenu ? (
        <div
          aria-label="Terminal actions"
          className="terminal-action-menu"
          ref={actionMenuRef}
          role="menu"
          style={{ left: actionMenu.x, top: actionMenu.y }}
        >
          <button onClick={() => void copyTerminalSelection()} role="menuitem" type="button">Copy</button>
          <button onClick={() => void pasteFromClipboard()} role="menuitem" type="button">Paste</button>
          <button onClick={selectAllTerminalText} role="menuitem" type="button">Select all</button>
        </div>
      ) : null}
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
