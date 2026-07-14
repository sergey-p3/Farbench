import { useCallback, useEffect, useRef, useState } from "react";
import type { FitAddon } from "xterm-addon-fit";
import type { Terminal } from "xterm";
import { copyTextToClipboard } from "../clipboard.js";
import {
  shouldActivateTerminalSelectionAfterArrowGesture,
  shouldResetTerminalArrowAcceleration,
  terminalArrowRepeatDelay,
  terminalArrowVector,
  type TerminalArrowDirection,
} from "../terminalArrowGesture.js";
import { terminalControlSequence, type TerminalToolbarKey } from "../terminalKeys.js";
import {
  terminalCellFromPointer,
  terminalHandleLayoutFromSelection,
  terminalSelectedTextFromBuffer,
  terminalSelectArgsFromEndpoints,
  terminalWordRangeAtCell,
  type TerminalBufferCell,
  type TerminalSelectionHandleLayout,
} from "../terminalSelection.js";
import type { TerminalDebugLogger } from "../terminalDebug.js";
import {
  EmptyTerminalPane,
  TerminalActionMenu,
  TerminalArrowGesture,
  TerminalConnectionStatus,
  TerminalKeybar,
  TerminalSelectionHandles,
  TerminalStatus,
  type TerminalActionMenuState,
  type TerminalArrowOverlayState,
  type TerminalSelectionHandleKind,
} from "./terminal/TerminalChrome.js";
import {
  terminalConnectionStatusText,
  terminalSocketUrl,
  webSocketReadyStateName,
  type TerminalConnectionPhase,
} from "./terminal/terminalProtocol.js";
import {
  useTerminalSession,
  type TerminalArrowGestureRuntime,
  type TerminalExplicitTap,
} from "./terminal/useTerminalSession.js";

interface TerminalPaneProps {
  sessionId: string | null;
  displayKind?: "terminal" | "agent";
  onOpenCreateSheet: () => void;
  onUnauthorized?: () => void;
}

const LONG_PRESS_MS = 1_000;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const ARROW_INPUT_VIBRATION_MS = 12;
const SELECTION_ACTIVATION_VIBRATION_MS = 30;
const TERMINAL_ACTION_MENU_WIDTH_PX = 168;

export { terminalSocketUrl };

function vibrateTerminal(durationMs: number): void {
  try {
    navigator.vibrate?.(durationMs);
  } catch {
    // Haptics are optional and may be blocked by the browser or device settings.
  }
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
  const explicitTapStartRef = useRef<TerminalExplicitTap | null>(null);
  const selectionDragRef = useRef<{ anchor: TerminalBufferCell; handle: TerminalSelectionHandleKind; pointerId: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [connectionPhase, setConnectionPhase] = useState<TerminalConnectionPhase>(null);
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
    vibrateTerminal(ARROW_INPUT_VIBRATION_MS);
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

  const releaseArrowGesture = useCallback(() => {
    const gesture = arrowGestureRef.current;
    if (!gesture) return;

    const activateSelection = shouldActivateTerminalSelectionAfterArrowGesture(gesture.peakDistance);
    const { originX, originY } = gesture;
    clearArrowGesture();
    if (activateSelection && selectTerminalWordAtPointer(originX, originY)) {
      vibrateTerminal(SELECTION_ACTIVATION_VIBRATION_MS);
    }
  }, [clearArrowGesture, selectTerminalWordAtPointer]);

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
      releaseArrowGesture();
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
  }, [clearLongPress, focusTerminalAtPointer, releaseArrowGesture]);

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

  useTerminalSession({
    actions: {
      clearArrowGesture,
      clearLongPress,
      focusTerminal,
      releaseArrowGesture,
      restoreArrowGestureScrollPosition,
      sendTerminalInput,
      updateArrowGesture,
      updateCtrlActive,
      updateTerminalSelectionHandles,
    },
    onUnauthorized,
    refs: {
      arrowGestureRef,
      autoReconnectAttemptsRef,
      autoReconnectSessionIdRef,
      cancelScrollForArrowGestureRef,
      containerRef,
      explicitTapStartRef,
      fitAddonRef,
      isCtrlActiveRef,
      pendingInputRef,
      receivedScrollbackRef,
      rootRef,
      socketRef,
      stageRef,
      terminalDebugRef,
      terminalRef,
    },
    retryNonce,
    sessionId,
    setConnectionPhase,
    setRetryNonce,
    setSelectionHandles,
    setStatus,
  });

  if (!sessionId) {
    return <EmptyTerminalPane onCreate={onOpenCreateSheet} />;
  }

  const connectionStatus = status ? null : terminalConnectionStatusText(displayKind, connectionPhase);

  return (
    <div className="tool-panel terminal-pane" ref={rootRef}>
      <TerminalStatus message={status} onCreate={onOpenCreateSheet} onRetry={retryConnection} />
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
        <TerminalConnectionStatus message={connectionStatus} />
        <TerminalSelectionHandles
          bufferLength={terminalRef.current?.buffer.active.length ?? 0}
          handles={selectionHandles}
          onBeginDrag={beginSelectionHandleDrag}
        />
        <TerminalArrowGesture overlay={arrowOverlay} />
      </div>
      <TerminalActionMenu
        isPasteCaptureVisible={isPasteCaptureVisible}
        menu={actionMenu}
        menuRef={actionMenuRef}
        onCopy={() => void copyTerminalSelection()}
        onPaste={() => void pasteFromClipboard()}
        onPasteCaptureInput={handlePasteCaptureInput}
        onPasteCapturePaste={handlePasteCapturePaste}
        onSelect={selectTerminalWordFromMenu}
        onSelectAll={selectAllTerminalText}
        pasteCaptureRef={pasteCaptureRef}
      />
      <TerminalKeybar
        isCtrlActive={isCtrlActive}
        onClick={handleToolbarClick}
        onPreserveFocus={preserveTerminalFocus}
        onTouchEnd={handleToolbarTouchEnd}
      />
    </div>
  );
}
