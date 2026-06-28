import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "xterm-addon-fit";
import { Terminal } from "xterm";
import { api, isUnauthorized } from "../api.js";
import { copyTextToClipboard } from "../clipboard.js";
import { createMomentumScrollGesture } from "../scrollMomentum.js";
import { createTerminalGestureOwner } from "../terminalGestureOwner.js";
import { scrollTerminalViewportByPixels } from "../terminalPixelScroller.js";
import { terminalControlSequence, terminalKeyLabels, type TerminalToolbarKey } from "../terminalKeys.js";
import {
  terminalCellFromPointer,
  terminalHandleLayoutFromSelection,
  terminalSelectedTextFromBuffer,
  terminalSelectArgsFromEndpoints,
  terminalWordRangeAtCell,
  type TerminalBufferCell,
  type TerminalSelectionHandleLayout,
} from "../terminalSelection.js";
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
  pointerX: number;
  pointerY: number;
  x: number;
  y: number;
}

type TerminalSelectionHandleKind = "start" | "end";

const LONG_PRESS_MS = 550;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const TERMINAL_ACTION_MENU_WIDTH_PX = 168;

export function terminalSocketUrl(locationLike: Pick<Location, "protocol" | "host"> = window.location): string {
  const protocol = locationLike.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${locationLike.host}/ws/terminal`;
}

export function TerminalPane({ sessionId, onOpenCreateSheet, onUnauthorized }: TerminalPaneProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isCtrlActiveRef = useRef(false);
  const skipNextToolbarClickRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const explicitTapStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const selectionDragRef = useRef<{ anchor: TerminalBufferCell; handle: TerminalSelectionHandleKind; pointerId: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [isCtrlActive, setIsCtrlActive] = useState(false);
  const [actionMenu, setActionMenu] = useState<TerminalActionMenuState | null>(null);
  const [selectionHandles, setSelectionHandles] = useState<TerminalSelectionHandleLayout | null>(null);

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

  const terminalBufferCellFromPointer = useCallback((clientX: number, clientY: number): TerminalBufferCell | null => {
    const terminal = terminalRef.current;
    const host = containerRef.current;
    const screen = host?.querySelector(".xterm-screen");
    if (!terminal || !(screen instanceof HTMLElement)) return null;

    const screenRect = screen.getBoundingClientRect();
    const cell = terminalCellFromPointer({
      cellHeight: screenRect.height / terminal.rows,
      cellWidth: screenRect.width / terminal.cols,
      clientX,
      clientY,
      cols: terminal.cols,
      hostRect: screenRect,
      rows: terminal.rows,
    });
    if (!cell) return null;
    return { column: cell.column, row: terminal.buffer.active.viewportY + cell.row };
  }, []);

  const updateTerminalSelectionHandles = useCallback(() => {
    const terminal = terminalRef.current;
    const stage = stageRef.current;
    const screen = containerRef.current?.querySelector(".xterm-screen");
    const selection = terminal?.getSelectionPosition();
    if (!terminal || !stage || !(screen instanceof HTMLElement) || !selection) {
      setSelectionHandles(null);
      return;
    }

    const stageRect = stage.getBoundingClientRect();
    const screenRect = screen.getBoundingClientRect();
    setSelectionHandles(terminalHandleLayoutFromSelection({
      cellHeight: screenRect.height / terminal.rows,
      cellWidth: screenRect.width / terminal.cols,
      screenOffsetLeft: screenRect.left - stageRect.left,
      screenOffsetTop: screenRect.top - stageRect.top,
      selection: {
        start: { column: selection.start.x, row: selection.start.y },
        end: { column: selection.end.x, row: selection.end.y },
      },
      viewportY: terminal.buffer.active.viewportY,
      visibleRows: terminal.rows,
    }));
  }, []);

  const selectTerminalWordAtPointer = useCallback((clientX: number, clientY: number): boolean => {
    const terminal = terminalRef.current;
    const cell = terminalBufferCellFromPointer(clientX, clientY);
    if (!terminal || !cell) {
      terminal?.clearSelection();
      return false;
    }

    const line = terminal.buffer.active.getLine(cell.row)?.translateToString(true) ?? "";
    const range = terminalWordRangeAtCell(line, cell.column);
    if (!range) {
      terminal.clearSelection();
      return false;
    }

    terminal.select(range.start, cell.row, range.length);
    updateTerminalSelectionHandles();
    return true;
  }, [terminalBufferCellFromPointer, updateTerminalSelectionHandles]);

  const openTerminalActionMenu = useCallback((x: number, y: number) => {
    clearLongPress();
    const nextX = Math.max(8, Math.min(x, window.innerWidth - TERMINAL_ACTION_MENU_WIDTH_PX - 8));
    const nextY = Math.max(8, Math.min(y, window.innerHeight - 160));
    const terminal = terminalRef.current;
    if (!terminal?.getSelection()) {
      selectTerminalWordAtPointer(x, y);
    }
    setActionMenu({ pointerX: x, pointerY: y, x: nextX, y: nextY });
  }, [clearLongPress, selectTerminalWordAtPointer]);

  const handleTerminalContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    openTerminalActionMenu(event.clientX, event.clientY);
  }, [openTerminalActionMenu]);

  const handleTerminalPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setActionMenu(null);
    explicitTapStartRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    if (event.button !== 0 || (event.pointerType !== "touch" && event.pointerType !== "pen")) return;

    const start = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    longPressStartRef.current = start;
    longPressTimerRef.current = window.setTimeout(() => {
      if (longPressStartRef.current?.pointerId === start.pointerId) {
        explicitTapStartRef.current = null;
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
    const tapStart = explicitTapStartRef.current;
    if (!tapStart || tapStart.pointerId !== event.pointerId) return;
    const tapDistance = Math.hypot(event.clientX - tapStart.x, event.clientY - tapStart.y);
    if (tapDistance > LONG_PRESS_MOVE_TOLERANCE_PX) {
      explicitTapStartRef.current = null;
    }
  }, [clearLongPress]);

  const cancelTerminalPointerGesture = useCallback(() => {
    explicitTapStartRef.current = null;
    clearLongPress();
  }, [clearLongPress]);

  const handleTerminalPointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const tapStart = explicitTapStartRef.current;
    if (tapStart?.pointerId === event.pointerId) {
      terminalRef.current?.focus();
    }
    explicitTapStartRef.current = null;
    clearLongPress();
  }, [clearLongPress]);

  const copyTerminalSelection = useCallback(async () => {
    const terminal = terminalRef.current;
    const selectionPosition = terminal?.getSelectionPosition();
    const selection = terminal && selectionPosition
      ? terminalSelectedTextFromBuffer({
        getLine: (row) => {
          const line = terminal.buffer.active.getLine(row);
          return line ? { isWrapped: line.isWrapped, text: line.translateToString(true) } : null;
        },
        selection: {
          start: { column: selectionPosition.start.x, row: selectionPosition.start.y },
          end: { column: selectionPosition.end.x, row: selectionPosition.end.y },
        },
      }) || terminal.getSelection()
      : terminal?.getSelection() ?? "";
    setActionMenu(null);
    if (!selection) return;

    if (!(await copyTextToClipboard(selection))) {
      setStatus("Unable to copy terminal selection.");
    }
  }, []);

  const selectTerminalWordFromMenu = useCallback(() => {
    const pointer = actionMenu;
    setActionMenu(null);
    if (pointer) selectTerminalWordAtPointer(pointer.pointerX, pointer.pointerY);
  }, [actionMenu, selectTerminalWordAtPointer]);

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
    setActionMenu(null);
  }, []);

  const applySelectionHandleDrag = useCallback((clientX: number, clientY: number, pointerId: number): boolean => {
    const drag = selectionDragRef.current;
    const terminal = terminalRef.current;
    if (!drag || drag.pointerId !== pointerId || !terminal) return false;

    const cell = terminalBufferCellFromPointer(clientX, clientY);
    if (!cell) return false;

    const movingCell = drag.handle === "end"
      ? { column: Math.min(cell.column + 1, terminal.cols), row: cell.row }
      : cell;
    const args = terminalSelectArgsFromEndpoints({
      cols: terminal.cols,
      end: drag.handle === "end" ? movingCell : drag.anchor,
      start: drag.handle === "start" ? movingCell : drag.anchor,
    });
    if (!args) return false;
    terminal.select(args.column, args.row, args.length);
    updateTerminalSelectionHandles();
    return true;
  }, [terminalBufferCellFromPointer, updateTerminalSelectionHandles]);

  const beginSelectionHandleDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>, handle: TerminalSelectionHandleKind) => {
    const terminal = terminalRef.current;
    const selection = terminal?.getSelectionPosition();
    if (!selection) return;

    event.preventDefault();
    event.stopPropagation();
    selectionDragRef.current = {
      anchor: handle === "start"
        ? { column: selection.end.x, row: selection.end.y }
        : { column: selection.start.x, row: selection.start.y },
      handle,
      pointerId: event.pointerId,
    };

    const pointerId = event.pointerId;
    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      applySelectionHandleDrag(moveEvent.clientX, moveEvent.clientY, pointerId);
    };
    const handlePointerEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      endEvent.preventDefault();
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerEnd, true);
      window.removeEventListener("pointercancel", handlePointerEnd, true);
      selectionDragRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", handlePointerEnd, { capture: true, passive: false });
    window.addEventListener("pointercancel", handlePointerEnd, { capture: true, passive: false });
  }, [applySelectionHandleDrag]);

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
    window.addEventListener("resize", cancelTerminalPointerGesture);
    window.addEventListener("scroll", cancelTerminalPointerGesture, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", cancelTerminalPointerGesture);
      window.removeEventListener("scroll", cancelTerminalPointerGesture, true);
    };
  }, [actionMenu, cancelTerminalPointerGesture]);

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

    const gestureOwner = createTerminalGestureOwner();
    const touchScrollTarget = containerRef.current;
    const scrollTerminalByPixels = (deltaY: number): void => {
      const viewport = touchScrollTarget.querySelector(".xterm-viewport");
      if (viewport instanceof HTMLElement) scrollTerminalViewportByPixels(viewport, deltaY);
    };
    const touchMomentum = createMomentumScrollGesture({
      scrollBy: (deltaY) => {
        scrollTerminalByPixels(deltaY);
      },
      viewportHeightPx: () => {
        const viewport = touchScrollTarget.querySelector(".xterm-viewport");
        return viewport instanceof HTMLElement ? viewport.clientHeight : touchScrollTarget.clientHeight;
      },
    });
    const pointerMomentum = createMomentumScrollGesture({
      scrollBy: (deltaY) => {
        scrollTerminalByPixels(deltaY);
      },
      viewportHeightPx: () => {
        const viewport = touchScrollTarget.querySelector(".xterm-viewport");
        return viewport instanceof HTMLElement ? viewport.clientHeight : touchScrollTarget.clientHeight;
      },
    });
    const beginTouchScroll = (event: TouchEvent) => {
      if (!gestureOwner.beginTouch()) return;
      const touchY = touchScrollY(event.touches);
      if (touchY !== null) {
        touchMomentum.begin(touchY);
        return;
      }
      touchMomentum.cancel();
      gestureOwner.endTouch();
    };
    const moveTouchScroll = (event: TouchEvent) => {
      if (!gestureOwner.canMoveTouch()) return;
      const nextY = touchScrollY(event.touches);
      if (nextY === null) return;
      if (!touchMomentum.move(nextY)) return;
      explicitTapStartRef.current = null;
      clearLongPress();
      if (event.cancelable) {
        event.preventDefault();
      }
    };
    const resetTouchScroll = () => {
      touchMomentum.end();
      gestureOwner.endTouch();
    };
    const cancelTouchScroll = () => {
      touchMomentum.cancel();
      gestureOwner.endTouch();
    };
    const beginPointerScroll = (event: PointerEvent) => {
      if (event.button !== 0 || (event.pointerType !== "touch" && event.pointerType !== "pen")) return;
      if (!gestureOwner.beginPointer(event.pointerId)) return;
      touchMomentum.cancel();
      pointerMomentum.begin(event.clientY);
    };
    const movePointerScroll = (event: PointerEvent) => {
      if (!gestureOwner.canMovePointer(event.pointerId)) return;
      if (!pointerMomentum.move(event.clientY)) return;
      explicitTapStartRef.current = null;
      clearLongPress();
      if (event.cancelable) {
        event.preventDefault();
      }
    };
    const resetPointerScroll = (event: PointerEvent) => {
      if (!gestureOwner.endPointer(event.pointerId)) return;
      pointerMomentum.end();
    };
    const cancelPointerScroll = (event: PointerEvent) => {
      if (!gestureOwner.endPointer(event.pointerId)) return;
      pointerMomentum.cancel();
    };
    touchScrollTarget.addEventListener("touchstart", beginTouchScroll, { capture: true, passive: true });
    touchScrollTarget.addEventListener("touchmove", moveTouchScroll, { capture: true, passive: false });
    touchScrollTarget.addEventListener("touchend", resetTouchScroll, true);
    touchScrollTarget.addEventListener("touchcancel", cancelTouchScroll, true);
    touchScrollTarget.addEventListener("pointerdown", beginPointerScroll, { capture: true });
    touchScrollTarget.addEventListener("pointermove", movePointerScroll, { capture: true });
    touchScrollTarget.addEventListener("pointerup", resetPointerScroll, true);
    touchScrollTarget.addEventListener("pointercancel", cancelPointerScroll, true);
    const xtermViewport = touchScrollTarget.querySelector(".xterm-viewport");
    if (xtermViewport instanceof HTMLElement) {
      xtermViewport.addEventListener("scroll", updateTerminalSelectionHandles);
    }

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
    const selectionDisposable = terminal.onSelectionChange(updateTerminalSelectionHandles);
    const scrollDisposable = terminal.onScroll(updateTerminalSelectionHandles);

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
      touchMomentum.cancel();
      pointerMomentum.cancel();
      gestureOwner.cancel();
      touchScrollTarget.removeEventListener("touchstart", beginTouchScroll, true);
      touchScrollTarget.removeEventListener("touchmove", moveTouchScroll, true);
      touchScrollTarget.removeEventListener("touchend", resetTouchScroll, true);
      touchScrollTarget.removeEventListener("touchcancel", cancelTouchScroll, true);
      touchScrollTarget.removeEventListener("pointerdown", beginPointerScroll, true);
      touchScrollTarget.removeEventListener("pointermove", movePointerScroll, true);
      touchScrollTarget.removeEventListener("pointerup", resetPointerScroll, true);
      touchScrollTarget.removeEventListener("pointercancel", cancelPointerScroll, true);
      if (xtermViewport instanceof HTMLElement) {
        xtermViewport.removeEventListener("scroll", updateTerminalSelectionHandles);
      }
      dataDisposable.dispose();
      selectionDisposable.dispose();
      scrollDisposable.dispose();
      clearLongPress();
      setSelectionHandles(null);
      if (socketRef.current === socket) socketRef.current = null;
      if (terminalRef.current === terminal) terminalRef.current = null;
      if (fitAddonRef.current === fitAddon) fitAddonRef.current = null;
      socket.close();
      terminal.dispose();
    };
  }, [clearLongPress, onUnauthorized, retryNonce, sendTerminalInput, sessionId, updateCtrlActive, updateTerminalSelectionHandles]);

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
        ref={stageRef}
        onContextMenu={handleTerminalContextMenu}
        onPointerCancel={cancelTerminalPointerGesture}
        onPointerDown={handleTerminalPointerDown}
        onPointerLeave={cancelTerminalPointerGesture}
        onPointerMove={handleTerminalPointerMove}
        onPointerUp={handleTerminalPointerEnd}
      >
        <div className="terminal-host" ref={containerRef} />
        {selectionHandles ? (
          <div className="terminal-selection-handles" aria-hidden={false}>
            <button
              aria-label="Expand terminal selection start"
              aria-orientation="vertical"
              aria-valuemax={terminalRef.current?.buffer.active.length ?? 0}
              aria-valuemin={0}
              aria-valuenow={0}
              className="terminal-selection-handle terminal-selection-handle-start"
              onPointerDown={(event) => beginSelectionHandleDrag(event, "start")}
              role="slider"
              style={{ left: selectionHandles.start.left, top: selectionHandles.start.top }}
              title="Expand selection start"
              type="button"
            />
            <button
              aria-label="Expand terminal selection end"
              aria-orientation="vertical"
              aria-valuemax={terminalRef.current?.buffer.active.length ?? 0}
              aria-valuemin={0}
              aria-valuenow={0}
              className="terminal-selection-handle terminal-selection-handle-end"
              onPointerDown={(event) => beginSelectionHandleDrag(event, "end")}
              role="slider"
              style={{ left: selectionHandles.end.left, top: selectionHandles.end.top }}
              title="Expand selection end"
              type="button"
            />
          </div>
        ) : null}
      </div>
      {actionMenu ? (
        <div
          aria-label="Terminal actions"
          className="terminal-action-menu"
          ref={actionMenuRef}
          role="menu"
          style={{ left: actionMenu.x, top: actionMenu.y }}
        >
          <button onClick={selectTerminalWordFromMenu} role="menuitem" type="button">Select</button>
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
