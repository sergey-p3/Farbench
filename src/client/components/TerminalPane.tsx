import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "xterm-addon-fit";
import { Terminal } from "xterm";
import { api, isUnauthorized } from "../api.js";
import { copyTextToClipboard } from "../clipboard.js";
import { createMomentumScrollGesture, TOUCH_SCROLL_TAP_THRESHOLD_PX } from "../scrollMomentum.js";
import {
  shouldResetTerminalArrowAcceleration,
  terminalArrowRepeatDelay,
  terminalArrowVector,
  type TerminalArrowDirection,
} from "../terminalArrowGesture.js";
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
import { terminalKeyboardChromeInset, terminalViewportFitDelayMs } from "../terminalViewport.js";
import { createTerminalDebugLogger, type TerminalDebugLogger } from "../terminalDebug.js";
import { createTerminalWriteQueue, terminalHistoryReplay } from "../terminalWriteQueue.js";
import { TERMINAL_HISTORY_LINES } from "../../shared/terminalHistory.js";

interface TerminalPaneProps {
  sessionId: string | null;
  displayKind?: "terminal" | "agent";
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

interface TerminalArrowGestureRuntime {
  accelerationStartedAt: number;
  direction: TerminalArrowDirection | null;
  distance: number;
  originX: number;
  originY: number;
  peakDistance: number;
  pointerId: number;
  viewportScrollTop: number;
}

interface TerminalArrowOverlayState {
  direction: TerminalArrowDirection | null;
  originX: number;
  originY: number;
}

type TerminalSelectionHandleKind = "start" | "end";
type ConnectionPhase = "connecting" | "attaching" | "loading-history" | null;

const LONG_PRESS_MS = 1_000;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const ARROW_INPUT_VIBRATION_MS = 12;
const TERMINAL_ACTION_MENU_WIDTH_PX = 168;
const TERMINAL_CONNECT_TIMEOUT_MS = 4_000;
const TERMINAL_AUTO_RETRY_DELAYS_MS = [300, 1_000, 2_500];
let nextTerminalPaneInstanceId = 1;

export function terminalSocketUrl(locationLike: Pick<Location, "protocol" | "host"> = window.location): string {
  const protocol = locationLike.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${locationLike.host}/ws/terminal`;
}

export function TerminalPane({ sessionId, displayKind = "terminal", onOpenCreateSheet, onUnauthorized }: TerminalPaneProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const pasteCaptureRef = useRef<HTMLTextAreaElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalDebugRef = useRef<TerminalDebugLogger | null>(null);
  const pendingInputRef = useRef<string[]>([]);
  const receivedScrollbackRef = useRef(false);
  const isCtrlActiveRef = useRef(false);
  const autoReconnectAttemptsRef = useRef(0);
  const autoReconnectSessionIdRef = useRef<string | null>(null);
  const skipNextToolbarClickRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{
    keyboardWasActive: boolean;
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const arrowGestureRef = useRef<TerminalArrowGestureRuntime | null>(null);
  const arrowRepeatTimerRef = useRef<number | null>(null);
  const cancelScrollForArrowGestureRef = useRef<(() => void) | null>(null);
  const explicitTapStartRef = useRef<{ pointerId: number; pointerType: string; x: number; y: number } | null>(null);
  const selectionDragRef = useRef<{ anchor: TerminalBufferCell; handle: TerminalSelectionHandleKind; pointerId: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [connectionPhase, setConnectionPhase] = useState<ConnectionPhase>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [isCtrlActive, setIsCtrlActive] = useState(false);
  const [actionMenu, setActionMenu] = useState<TerminalActionMenuState | null>(null);
  const [isPasteCaptureVisible, setIsPasteCaptureVisible] = useState(false);
  const [selectionHandles, setSelectionHandles] = useState<TerminalSelectionHandleLayout | null>(null);
  const [arrowOverlay, setArrowOverlay] = useState<TerminalArrowOverlayState | null>(null);

  const focusTerminal = useCallback(() => {
    window.setTimeout(() => terminalRef.current?.focus(), 0);
  }, []);

  const retryConnection = useCallback(() => {
    autoReconnectAttemptsRef.current = 0;
    setRetryNonce((current) => current + 1);
  }, []);

  const focusTerminalAtPointer = useCallback((clientX: number, clientY: number) => {
    const terminal = terminalRef.current;
    const textarea = terminal?.textarea;
    const screen = containerRef.current?.querySelector(".xterm-screen");
    if (textarea && screen instanceof HTMLElement) {
      const screenRect = screen.getBoundingClientRect();
      textarea.style.width = "20px";
      textarea.style.height = "20px";
      textarea.style.left = `${clientX - screenRect.left - 10}px`;
      textarea.style.top = `${clientY - screenRect.top - 10}px`;
      textarea.style.zIndex = "1000";
    }
    terminal?.focus();
  }, []);

  const updateCtrlActive = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    const nextValue = typeof next === "function" ? next(isCtrlActiveRef.current) : next;
    isCtrlActiveRef.current = nextValue;
    setIsCtrlActive(nextValue);
  }, []);

  const sendTerminalInput = useCallback((data: string) => {
    const socket = socketRef.current;
    const readyState = socket ? webSocketReadyStateName(socket.readyState) : "none";
    if (socket?.readyState === WebSocket.CONNECTING) {
      pendingInputRef.current.push(data);
      terminalDebugRef.current?.("input.queued", {
        bytes: data.length,
        pendingInputCount: pendingInputRef.current.length,
        readyState,
      });
      return;
    }
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      terminalDebugRef.current?.("input.dropped", { bytes: data.length, readyState });
      setStatus("Terminal is reconnecting.");
      return;
    }
    terminalDebugRef.current?.("input.sent", { bytes: data.length, readyState });
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

  const clearArrowRepeat = useCallback(() => {
    if (arrowRepeatTimerRef.current === null) return;
    window.clearTimeout(arrowRepeatTimerRef.current);
    arrowRepeatTimerRef.current = null;
  }, []);

  const sendArrowDirection = useCallback((direction: TerminalArrowDirection) => {
    const sequence = terminalControlSequence(direction, false);
    if (!sequence) return;
    sendTerminalInput(sequence.data);
    try {
      navigator.vibrate?.(ARROW_INPUT_VIBRATION_MS);
    } catch {
      // Haptics are optional and may be blocked by the browser or device settings.
    }
  }, [sendTerminalInput]);

  const scheduleArrowRepeat = useCallback(function scheduleArrowRepeatTick() {
    clearArrowRepeat();
    const gesture = arrowGestureRef.current;
    if (!gesture?.direction) return;

    const delay = terminalArrowRepeatDelay(
      gesture.distance,
      performance.now() - gesture.accelerationStartedAt,
      gesture.direction,
    );
    arrowRepeatTimerRef.current = window.setTimeout(() => {
      arrowRepeatTimerRef.current = null;
      const current = arrowGestureRef.current;
      if (!current?.direction) return;
      sendArrowDirection(current.direction);
      scheduleArrowRepeatTick();
    }, delay);
  }, [clearArrowRepeat, sendArrowDirection]);

  const restoreArrowGestureScrollPosition = useCallback(() => {
    const gesture = arrowGestureRef.current;
    const viewport = containerRef.current?.querySelector(".xterm-viewport");
    if (!gesture || !(viewport instanceof HTMLElement)) return;
    if (viewport.scrollTop !== gesture.viewportScrollTop) {
      viewport.scrollTop = gesture.viewportScrollTop;
    }
  }, []);

  const updateArrowGesture = useCallback((pointerId: number | null, clientX: number, clientY: number): boolean => {
    const arrowGesture = arrowGestureRef.current;
    if (!arrowGesture || (pointerId !== null && arrowGesture.pointerId !== pointerId)) return false;

    const next = terminalArrowVector(
      arrowGesture.originX,
      arrowGesture.originY,
      clientX,
      clientY,
    );
    const directionChanged = next.direction !== arrowGesture.direction;
    const accelerationReset = shouldResetTerminalArrowAcceleration(arrowGesture.peakDistance, next.distance);
    if (accelerationReset) {
      arrowGesture.accelerationStartedAt = performance.now();
      arrowGesture.peakDistance = next.distance;
    } else {
      arrowGesture.peakDistance = Math.max(arrowGesture.peakDistance, next.distance);
    }
    arrowGesture.direction = next.direction;
    arrowGesture.distance = next.distance;
    setArrowOverlay({
      direction: next.direction,
      originX: arrowGesture.originX,
      originY: arrowGesture.originY,
    });

    if (!next.direction) {
      clearArrowRepeat();
    } else if (directionChanged) {
      sendArrowDirection(next.direction);
      scheduleArrowRepeat();
    } else if (accelerationReset) {
      scheduleArrowRepeat();
    }
    restoreArrowGestureScrollPosition();
    return true;
  }, [clearArrowRepeat, restoreArrowGestureScrollPosition, scheduleArrowRepeat, sendArrowDirection]);

  const clearArrowGesture = useCallback(() => {
    clearArrowRepeat();
    const gesture = arrowGestureRef.current;
    arrowGestureRef.current = null;
    setArrowOverlay(null);

    const stage = stageRef.current;
    if (!gesture || !stage) return;
    try {
      if (stage.hasPointerCapture(gesture.pointerId)) stage.releasePointerCapture(gesture.pointerId);
    } catch {
      // Synthetic pointer events and older touch browsers may not support capture.
    }
  }, [clearArrowRepeat]);

  const activateArrowGesture = useCallback((start: NonNullable<typeof longPressStartRef.current>) => {
    if (longPressStartRef.current?.pointerId !== start.pointerId) return;
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
    explicitTapStartRef.current = null;
    setActionMenu(null);
    terminalRef.current?.clearSelection();
    setSelectionHandles(null);
    cancelScrollForArrowGestureRef.current?.();

    if (!start.keyboardWasActive && terminalRef.current?.textarea === document.activeElement) {
      terminalRef.current.textarea?.blur();
    }

    const viewport = containerRef.current?.querySelector(".xterm-viewport");
    arrowGestureRef.current = {
      accelerationStartedAt: performance.now(),
      direction: null,
      distance: 0,
      originX: start.x,
      originY: start.y,
      peakDistance: 0,
      pointerId: start.pointerId,
      viewportScrollTop: viewport instanceof HTMLElement ? viewport.scrollTop : 0,
    };
    setArrowOverlay({ direction: null, originX: start.x, originY: start.y });
    try {
      stageRef.current?.setPointerCapture(start.pointerId);
    } catch {
      // Pointer capture is an enhancement; the gesture still works within the stage.
    }
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
    if (longPressStartRef.current || arrowGestureRef.current) return;
    openTerminalActionMenu(event.clientX, event.clientY);
  }, [openTerminalActionMenu]);

  const handleTerminalPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setActionMenu(null);
    explicitTapStartRef.current = { pointerId: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY };
    if (event.button !== 0 || (event.pointerType !== "touch" && event.pointerType !== "pen")) return;

    const start = {
      keyboardWasActive: terminalRef.current?.textarea === document.activeElement,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    longPressStartRef.current = start;
    longPressTimerRef.current = window.setTimeout(() => {
      activateArrowGesture(start);
    }, LONG_PRESS_MS);
  }, [activateArrowGesture]);

  const handleTerminalPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (updateArrowGesture(event.pointerId, event.clientX, event.clientY)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const start = longPressStartRef.current;
    if (start?.pointerId === event.pointerId) {
      const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (distance > LONG_PRESS_MOVE_TOLERANCE_PX) {
        clearLongPress();
      }
    }
    const tapStart = explicitTapStartRef.current;
    if (!tapStart || tapStart.pointerId !== event.pointerId) return;
    const tapDistance = Math.hypot(event.clientX - tapStart.x, event.clientY - tapStart.y);
    if (tapDistance > LONG_PRESS_MOVE_TOLERANCE_PX) {
      explicitTapStartRef.current = null;
    }
  }, [clearLongPress, updateArrowGesture]);

  const cancelTerminalPointerGesture = useCallback(() => {
    explicitTapStartRef.current = null;
    clearLongPress();
    clearArrowGesture();
  }, [clearArrowGesture, clearLongPress]);

  const handleTerminalPointerLeave = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // Pointer capture and dragging beyond the terminal can produce leave events.
    // Once arrow control owns this pointer, only release/cancel should end it.
    if (arrowGestureRef.current?.pointerId === event.pointerId) return;
    cancelTerminalPointerGesture();
  }, [cancelTerminalPointerGesture]);

  const handleTerminalPointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" && arrowGestureRef.current?.pointerId === event.pointerId) {
      event.preventDefault();
      explicitTapStartRef.current = null;
      clearLongPress();
      return;
    }
    cancelTerminalPointerGesture();
  }, [cancelTerminalPointerGesture, clearLongPress]);

  const handleTerminalPointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (arrowGestureRef.current?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      explicitTapStartRef.current = null;
      clearLongPress();
      clearArrowGesture();
      return;
    }
    const tapStart = explicitTapStartRef.current;
    if (tapStart?.pointerId === event.pointerId) {
      if (tapStart.pointerType === "touch" || tapStart.pointerType === "pen") {
        event.preventDefault();
        event.stopPropagation();
        focusTerminalAtPointer(event.clientX, event.clientY);
      } else {
        terminalRef.current?.focus();
      }
    }
    explicitTapStartRef.current = null;
    clearLongPress();
  }, [clearArrowGesture, clearLongPress, focusTerminalAtPointer]);

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
    try {
      const text = await navigator.clipboard.readText();
      if (text) sendTerminalInput(text);
      setIsPasteCaptureVisible(false);
      setActionMenu(null);
      terminalRef.current?.focus();
    } catch {
      setIsPasteCaptureVisible(true);
      window.setTimeout(() => pasteCaptureRef.current?.focus(), 0);
    }
  }, [sendTerminalInput]);

  const sendCapturedPaste = useCallback((text: string) => {
    if (!text) return;
    sendTerminalInput(text);
    setIsPasteCaptureVisible(false);
    setActionMenu(null);
    terminalRef.current?.focus();
  }, [sendTerminalInput]);

  const handlePasteCapturePaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    event.currentTarget.value = "";
    sendCapturedPaste(text);
  }, [sendCapturedPaste]);

  const handlePasteCaptureInput = useCallback((event: React.FormEvent<HTMLTextAreaElement>) => {
    const text = event.currentTarget.value;
    event.currentTarget.value = "";
    sendCapturedPaste(text);
  }, [sendCapturedPaste]);

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
        setIsPasteCaptureVisible(false);
        setActionMenu(null);
        focusTerminal();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (actionMenuRef.current?.contains(event.target as Node)) return;
      setIsPasteCaptureVisible(false);
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
  }, [actionMenu, cancelTerminalPointerGesture, focusTerminal]);

  useEffect(() => {
    setStatus(null);
    setConnectionPhase(null);
    updateCtrlActive(false);

    if (!sessionId || !containerRef.current) {
      return;
    }
    if (autoReconnectSessionIdRef.current !== sessionId) {
      autoReconnectSessionIdRef.current = sessionId;
      autoReconnectAttemptsRef.current = 0;
    }

    const debug = createTerminalDebugLogger({
      component: "TerminalPane",
      instanceId: nextTerminalPaneInstanceId++,
      sessionId,
    });
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "JetBrains Mono, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      scrollback: TERMINAL_HISTORY_LINES,
      theme: {
        background: "#101820",
        foreground: "#d7dee8",
      },
    });
    const fitAddon = new FitAddon();
    const socketUrl = terminalSocketUrl();
    const socket = new WebSocket(socketUrl);
    let authProbeStarted = false;
    let connectTimeoutTimer: number | null = null;
    let deferredFitAndResizeTimer: number | null = null;
    let reconnectScheduled = false;
    let reconnectTimer: number | null = null;

    terminalDebugRef.current = debug;
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    socketRef.current = socket;
    setConnectionPhase("connecting");
    debug("effect.start", {
      hasContainer: true,
      readyState: webSocketReadyStateName(socket.readyState),
      socketUrl,
    });
    receivedScrollbackRef.current = false;
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    const writeQueue = createTerminalWriteQueue(terminal);
    debug("terminal.open", { cols: terminal.cols, rows: terminal.rows });
    terminal.attachCustomKeyEventHandler((event) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "v") {
        return false;
      }
      return true;
    });

    const fit = () => {
      try {
        fitAddon.fit();
        debug("fit", { cols: terminal.cols, rows: terminal.rows });
      } catch (error) {
        debug("fit.failed", { error: error instanceof Error ? error.message : "unknown fit error" });
        return;
      }
    };

    const sendResize = () => {
      if (!isCurrentSocket() || socket.readyState !== WebSocket.OPEN) {
        debug("resize.skipped", {
          current: isCurrentSocket(),
          readyState: webSocketReadyStateName(socket.readyState),
        });
        return;
      }
      debug("resize.sent", { cols: terminal.cols, rows: terminal.rows });
      socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
    };

    const fitAndResize = () => {
      fit();
      sendResize();
    };

    const clearDeferredFitAndResize = () => {
      if (deferredFitAndResizeTimer === null) return;
      window.clearTimeout(deferredFitAndResizeTimer);
      deferredFitAndResizeTimer = null;
    };

    const clearConnectTimeout = () => {
      if (connectTimeoutTimer === null) return;
      window.clearTimeout(connectTimeoutTimer);
      connectTimeoutTimer = null;
    };

    const clearReconnectTimer = () => {
      if (reconnectTimer === null) return;
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const syncVisualViewport = () => {
      const viewport = window.visualViewport;
      if (rootRef.current && viewport) {
        const metrics = {
          innerHeight: window.innerHeight,
          maxTouchPoints: navigator.maxTouchPoints,
          userAgent: navigator.userAgent,
          visualViewportHeight: viewport.height,
          visualViewportOffsetTop: viewport.offsetTop,
        };
        rootRef.current.style.setProperty("--terminal-visual-height", `${viewport.height}px`);
        rootRef.current.style.setProperty("--terminal-keyboard-chrome-inset", `${terminalKeyboardChromeInset(metrics)}px`);

        const fitDelayMs = terminalViewportFitDelayMs({
          isTerminalInputFocused: document.activeElement === terminal.textarea,
          metrics,
        });
        if (fitDelayMs > 0) {
          clearDeferredFitAndResize();
          deferredFitAndResizeTimer = window.setTimeout(() => {
            deferredFitAndResizeTimer = null;
            fitAndResize();
          }, fitDelayMs);
          return;
        }
      }
      clearDeferredFitAndResize();
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
    const cancelScrollForArrowGesture = () => {
      touchMomentum.cancel();
      pointerMomentum.cancel();
    };
    cancelScrollForArrowGestureRef.current = cancelScrollForArrowGesture;
    const arrowGestureTarget = stageRef.current;
    const captureArrowPointerMove = (event: PointerEvent) => {
      if (!updateArrowGesture(event.pointerId, event.clientX, event.clientY)) return;
      explicitTapStartRef.current = null;
      cancelScrollForArrowGesture();
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      restoreArrowGestureScrollPosition();
    };
    const captureArrowTouchMove = (event: TouchEvent) => {
      if (!arrowGestureRef.current) return;
      explicitTapStartRef.current = null;
      cancelScrollForArrowGesture();
      const touch = event.touches.item(0);
      if (touch) updateArrowGesture(null, touch.clientX, touch.clientY);
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      restoreArrowGestureScrollPosition();
    };
    arrowGestureTarget?.addEventListener("pointermove", captureArrowPointerMove, { capture: true, passive: false });
    arrowGestureTarget?.addEventListener("touchmove", captureArrowTouchMove, { capture: true, passive: false });
    let touchScrollStartY: number | null = null;
    const beginTouchScroll = (event: TouchEvent) => {
      const touchY = touchScrollY(event.touches);
      if (touchY === null || !gestureOwner.beginTouch()) {
        touchScrollStartY = null;
        touchMomentum.cancel();
        gestureOwner.endTouch();
        return;
      }
      touchScrollStartY = touchY;
      touchMomentum.begin(touchY);
    };
    const moveTouchScroll = (event: TouchEvent) => {
      if (arrowGestureRef.current) {
        explicitTapStartRef.current = null;
        cancelScrollForArrowGesture();
        const touch = event.touches.item(0);
        if (touch) updateArrowGesture(null, touch.clientX, touch.clientY);
        if (event.cancelable) event.preventDefault();
        return;
      }
      const nextY = touchScrollY(event.touches);
      if (nextY === null) return;
      if (!gestureOwner.canMoveTouch()) {
        if (touchScrollStartY === null || Math.abs(nextY - touchScrollStartY) < TOUCH_SCROLL_TAP_THRESHOLD_PX) return;
        if (!gestureOwner.claimTouchMove()) return;
        pointerMomentum.cancel();
      }
      if (!touchMomentum.move(nextY)) return;
      explicitTapStartRef.current = null;
      clearLongPress();
      if (event.cancelable) {
        event.preventDefault();
      }
    };
    const resetTouchScroll = () => {
      const hadArrowGesture = arrowGestureRef.current !== null;
      if (hadArrowGesture) clearArrowGesture();
      touchScrollStartY = null;
      if (hadArrowGesture) touchMomentum.cancel();
      else touchMomentum.end();
      gestureOwner.endTouch();
    };
    const cancelTouchScroll = () => {
      if (arrowGestureRef.current) clearArrowGesture();
      touchScrollStartY = null;
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
      if (arrowGestureRef.current?.pointerId === event.pointerId) {
        explicitTapStartRef.current = null;
        pointerMomentum.cancel();
        if (event.cancelable) event.preventDefault();
        return;
      }
      if (!gestureOwner.canMovePointer(event.pointerId)) return;
      if (!pointerMomentum.move(event.clientY)) return;
      gestureOwner.notePointerMoved(event.pointerId);
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
    const handleXtermViewportScroll = () => {
      if (arrowGestureRef.current) {
        restoreArrowGestureScrollPosition();
        return;
      }
      updateTerminalSelectionHandles();
    };
    if (xtermViewport instanceof HTMLElement) {
      xtermViewport.addEventListener("scroll", handleXtermViewportScroll);
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

    connectTimeoutTimer = window.setTimeout(() => {
      if (!isCurrentSocket() || socket.readyState !== WebSocket.CONNECTING) return;
      debug("socket.connect_timeout", {
        attempt: autoReconnectAttemptsRef.current + 1,
        timeoutMs: TERMINAL_CONNECT_TIMEOUT_MS,
      });
      handleConnectionFailure("Terminal connection timed out.");
    }, TERMINAL_CONNECT_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      if (!isCurrentSocket()) {
        debug("socket.open.stale", { readyState: webSocketReadyStateName(socket.readyState) });
        return;
      }
      clearConnectTimeout();
      debug("socket.open", { readyState: webSocketReadyStateName(socket.readyState) });
      fit();
      setConnectionPhase("attaching");
      socket.send(JSON.stringify({ type: "attach", sessionId, cols: terminal.cols, rows: terminal.rows }));
      setConnectionPhase("loading-history");
      debug("attach.sent", { cols: terminal.cols, pendingInputCount: pendingInputRef.current.length, rows: terminal.rows });
      for (const data of pendingInputRef.current.splice(0)) {
        debug("input.flushed", { bytes: data.length });
        socket.send(JSON.stringify({ type: "input", data }));
      }
      setStatus(null);
      // Touch browsers can focus this hidden textarea without opening the keyboard,
      // leaving the terminal in a half-focused state that blocks first-drag scrolling.
      if (navigator.maxTouchPoints === 0) {
        terminal.focus();
        focusTerminal();
      }
    });

    socket.addEventListener("message", (event) => {
      if (!isCurrentSocket()) {
        debug("socket.message.stale", { bytes: socketDataBytes(event.data) });
        return;
      }
      const message = parseTerminalMessage(event.data);
      if (!message) {
        debug("socket.message.invalid", { bytes: socketDataBytes(event.data) });
        return;
      }
      debug("socket.message", {
        bytes: terminalMessageBytes(message),
        messageType: message.type,
        receivedScrollback: receivedScrollbackRef.current,
      });

      if (message.type === "scrollback") {
        autoReconnectAttemptsRef.current = 0;
        setConnectionPhase(null);
        receivedScrollbackRef.current = true;
        writeQueue.replace(terminalHistoryReplay(message.data, terminal.rows));
        debug("scrollback.applied", { bytes: message.data.length });
        return;
      }

      if (message.type === "output") {
        autoReconnectAttemptsRef.current = 0;
        setConnectionPhase(null);
        writeQueue.write(message.data);
        return;
      }

      if (message.type === "error") {
        setConnectionPhase(null);
        setStatus(message.error);
        writeQueue.write(`\r\n${message.error}\r\n`);
        debug("terminal.error", { error: message.error });
        return;
      }

      setConnectionPhase(null);
      setStatus("Terminal exited.");
      writeQueue.write("\r\nTerminal exited.\r\n");
      debug("terminal.exit");
    });

    socket.addEventListener("close", (event) => {
      debug(isCurrentSocket() ? "socket.close" : "socket.close.stale", {
        code: event.code,
        readyState: webSocketReadyStateName(socket.readyState),
        reason: event.reason,
        wasClean: event.wasClean,
      });
      handleConnectionFailure("Terminal disconnected.");
    });

    socket.addEventListener("error", () => {
      debug(isCurrentSocket() ? "socket.error" : "socket.error.stale", {
        readyState: webSocketReadyStateName(socket.readyState),
      });
      handleConnectionFailure("Unable to connect to terminal.");
    });

    function handleConnectionFailure(message: string) {
      if (!isCurrentSocket()) return;
      debug("connection.failure", { message });
      clearConnectTimeout();
      if (scheduleAutomaticReconnect(message)) return;
      setConnectionPhase(null);
      setStatus(message);
      if (authProbeStarted) return;
      authProbeStarted = true;
      void verifyAuth(message);
    }

    function scheduleAutomaticReconnect(message: string): boolean {
      if (reconnectScheduled) return true;
      const retryDelayMs = TERMINAL_AUTO_RETRY_DELAYS_MS[autoReconnectAttemptsRef.current];
      if (retryDelayMs === undefined) return false;

      autoReconnectAttemptsRef.current += 1;
      reconnectScheduled = true;
      setStatus(null);
      setConnectionPhase("connecting");
      debug("connection.retry_scheduled", {
        attempt: autoReconnectAttemptsRef.current + 1,
        delayMs: retryDelayMs,
        message,
      });
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
      reconnectTimer = window.setTimeout(() => {
        if (!isCurrentSocket()) return;
        debug("connection.retry_start", { attempt: autoReconnectAttemptsRef.current + 1 });
        setRetryNonce((current) => current + 1);
      }, retryDelayMs);
      if (authProbeStarted) return true;
      authProbeStarted = true;
      void verifyAuth(message);
      return true;
    }

    async function verifyAuth(message: string) {
      try {
        await api.workspaces();
        debug("auth.probe.ok");
      } catch (error) {
        if (!isCurrentSocket()) return;
        if (isUnauthorized(error)) {
          debug("auth.probe.unauthorized");
          onUnauthorized?.();
          return;
        }
        debug("auth.probe.failed", { error: error instanceof Error ? error.message : "unknown auth probe error" });
        if (!reconnectScheduled) setStatus(message);
      }
    }

    function isCurrentSocket(): boolean {
      return socketRef.current === socket && terminalRef.current === terminal;
    }

    return () => {
      debug("effect.cleanup.start", {
        pendingInputCount: pendingInputRef.current.length,
        readyState: webSocketReadyStateName(socket.readyState),
      });
      window.removeEventListener("resize", syncVisualViewport);
      window.visualViewport?.removeEventListener("resize", syncVisualViewport);
      window.visualViewport?.removeEventListener("scroll", syncVisualViewport);
      clearConnectTimeout();
      clearReconnectTimer();
      clearDeferredFitAndResize();
      resizeObserver.disconnect();
      touchMomentum.cancel();
      pointerMomentum.cancel();
      gestureOwner.cancel();
      if (cancelScrollForArrowGestureRef.current === cancelScrollForArrowGesture) {
        cancelScrollForArrowGestureRef.current = null;
      }
      arrowGestureTarget?.removeEventListener("pointermove", captureArrowPointerMove, true);
      arrowGestureTarget?.removeEventListener("touchmove", captureArrowTouchMove, true);
      touchScrollTarget.removeEventListener("touchstart", beginTouchScroll, true);
      touchScrollTarget.removeEventListener("touchmove", moveTouchScroll, true);
      touchScrollTarget.removeEventListener("touchend", resetTouchScroll, true);
      touchScrollTarget.removeEventListener("touchcancel", cancelTouchScroll, true);
      touchScrollTarget.removeEventListener("pointerdown", beginPointerScroll, true);
      touchScrollTarget.removeEventListener("pointermove", movePointerScroll, true);
      touchScrollTarget.removeEventListener("pointerup", resetPointerScroll, true);
      touchScrollTarget.removeEventListener("pointercancel", cancelPointerScroll, true);
      if (xtermViewport instanceof HTMLElement) {
        xtermViewport.removeEventListener("scroll", handleXtermViewportScroll);
      }
      dataDisposable.dispose();
      selectionDisposable.dispose();
      scrollDisposable.dispose();
      clearLongPress();
      clearArrowGesture();
      setSelectionHandles(null);
      if (socketRef.current === socket) socketRef.current = null;
      if (terminalRef.current === terminal) terminalRef.current = null;
      if (fitAddonRef.current === fitAddon) fitAddonRef.current = null;
      pendingInputRef.current = [];
      receivedScrollbackRef.current = false;
      setConnectionPhase(null);
      socket.close();
      writeQueue.dispose();
      terminal.dispose();
      debug("effect.cleanup.complete", { readyState: webSocketReadyStateName(socket.readyState) });
      if (terminalDebugRef.current === debug) terminalDebugRef.current = null;
    };
  }, [clearArrowGesture, clearLongPress, focusTerminal, onUnauthorized, restoreArrowGestureScrollPosition, retryNonce, sendTerminalInput, sessionId, updateArrowGesture, updateCtrlActive, updateTerminalSelectionHandles]);

  if (!sessionId) {
    return (
      <div className="tool-panel empty-tool">
        <p className="empty-state">Select a session to attach a terminal.</p>
        <button onClick={onOpenCreateSheet} type="button">Create new</button>
      </div>
    );
  }

  const connectionStatus = status ? null : terminalConnectionStatusText(displayKind, connectionPhase);

  return (
    <div className="tool-panel terminal-pane" ref={rootRef}>
      {status ? (
        <div className="panel-error terminal-status" role="status">
          <span>{status}</span>
          <div className="terminal-status-actions">
            <button onClick={retryConnection} type="button">Retry</button>
            <button onClick={onOpenCreateSheet} type="button">Create new</button>
          </div>
        </div>
      ) : null}
      <div
        className="terminal-stage"
        ref={stageRef}
        onContextMenu={handleTerminalContextMenu}
        onPointerCancel={handleTerminalPointerCancel}
        onPointerDown={handleTerminalPointerDown}
        onPointerLeave={handleTerminalPointerLeave}
        onPointerMove={handleTerminalPointerMove}
        onPointerUp={handleTerminalPointerEnd}
      >
        <div className="terminal-host" ref={containerRef} />
        {connectionStatus ? (
          <div className="terminal-connection-status" role="status" aria-live="polite">
            <span className="terminal-connection-dot" aria-hidden="true" />
            <span>{connectionStatus}</span>
          </div>
        ) : null}
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
        {arrowOverlay ? (
          <div
            aria-label="Arrow key gesture control"
            className="terminal-arrow-gesture"
            data-direction={arrowOverlay.direction ?? "inactive"}
            role="status"
            style={{ left: arrowOverlay.originX, top: arrowOverlay.originY }}
          >
            <span aria-hidden="true" className="terminal-arrow-origin" />
            {(["left", "up", "down", "right"] as const).map((direction) => (
              <span
                aria-hidden="true"
                className={`terminal-arrow terminal-arrow-${direction}${arrowOverlay.direction === direction ? " active" : ""}`}
                key={direction}
              >
                {direction === "left" ? "←" : direction === "up" ? "↑" : direction === "down" ? "↓" : "→"}
              </span>
            ))}
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
          {isPasteCaptureVisible ? (
            <textarea
              aria-label="Paste terminal input"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              className="terminal-paste-capture"
              onInput={handlePasteCaptureInput}
              onPaste={handlePasteCapturePaste}
              ref={pasteCaptureRef}
              rows={1}
              spellCheck={false}
            />
          ) : null}
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

function terminalConnectionStatusText(displayKind: "terminal" | "agent", phase: ConnectionPhase): string | null {
  if (!phase) return null;
  const label = displayKind === "agent" ? "agent" : "terminal";
  if (phase === "connecting") return `Connecting to ${label}...`;
  if (phase === "attaching") return `Attaching ${label}...`;
  return `Loading ${label} history...`;
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

function webSocketReadyStateName(readyState: number | undefined): string {
  if (readyState === 0) return "connecting";
  if (readyState === 1) return "open";
  if (readyState === 2) return "closing";
  if (readyState === 3) return "closed";
  return "unknown";
}

function socketDataBytes(data: unknown): number {
  return typeof data === "string" ? data.length : 0;
}

function terminalMessageBytes(message: TerminalSocketMessage): number {
  if ("data" in message) return message.data.length;
  if ("error" in message) return message.error.length;
  return 0;
}
