import { useCallback, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Terminal } from "xterm";
import {
  shouldActivateTerminalSelectionAfterArrowGesture,
  shouldResetTerminalArrowAcceleration,
  terminalArrowRepeatDelay,
  terminalArrowVector,
  type TerminalArrowDirection,
} from "../../terminalArrowGesture.js";
import { terminalControlSequence } from "../../terminalKeys.js";
import type { TerminalSelectionHandleLayout } from "../../terminalSelection.js";
import type { TerminalActionMenuState, TerminalArrowOverlayState } from "./TerminalChrome.js";

const LONG_PRESS_MS = 1_000;
const MOVE_TOLERANCE_PX = 10;
const ARROW_INPUT_VIBRATION_MS = 12;
const SELECTION_ACTIVATION_VIBRATION_MS = 30;

export interface TerminalArrowGestureRuntime {
  accelerationStartedAt: number;
  direction: TerminalArrowDirection | null;
  distance: number;
  originX: number;
  originY: number;
  peakDistance: number;
  pointerId: number;
  viewportScrollTop: number;
}

export interface TerminalExplicitTap {
  pointerId: number;
  pointerType: string;
  x: number;
  y: number;
}

export function useTerminalArrowGesture({
  containerRef,
  selectWordAtPointer,
  sendTerminalInput,
  setActionMenu,
  setSelectionHandles,
  stageRef,
  terminalRef,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  selectWordAtPointer: (x: number, y: number) => boolean;
  sendTerminalInput: (data: string) => void;
  setActionMenu: Dispatch<SetStateAction<TerminalActionMenuState | null>>;
  setSelectionHandles: Dispatch<SetStateAction<TerminalSelectionHandleLayout | null>>;
  stageRef: RefObject<HTMLDivElement | null>;
  terminalRef: RefObject<Terminal | null>;
}) {
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ keyboardWasActive: boolean; pointerId: number; x: number; y: number } | null>(null);
  const arrowGestureRef = useRef<TerminalArrowGestureRuntime | null>(null);
  const arrowRepeatTimerRef = useRef<number | null>(null);
  const cancelScrollForArrowGestureRef = useRef<(() => void) | null>(null);
  const explicitTapStartRef = useRef<TerminalExplicitTap | null>(null);
  const [arrowOverlay, setArrowOverlay] = useState<TerminalArrowOverlayState | null>(null);

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
    vibrate(ARROW_INPUT_VIBRATION_MS);
  }, [sendTerminalInput]);

  const scheduleArrowRepeat = useCallback(function scheduleRepeat() {
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
      scheduleRepeat();
    }, delay);
  }, [clearArrowRepeat, sendArrowDirection]);

  const restoreScrollPosition = useCallback(() => {
    const gesture = arrowGestureRef.current;
    const viewport = containerRef.current?.querySelector(".xterm-viewport");
    if (gesture && viewport instanceof HTMLElement && viewport.scrollTop !== gesture.viewportScrollTop) {
      viewport.scrollTop = gesture.viewportScrollTop;
    }
  }, [containerRef]);

  const updateArrowGesture = useCallback((pointerId: number | null, clientX: number, clientY: number): boolean => {
    const gesture = arrowGestureRef.current;
    if (!gesture || (pointerId !== null && gesture.pointerId !== pointerId)) return false;
    const next = terminalArrowVector(gesture.originX, gesture.originY, clientX, clientY);
    const directionChanged = next.direction !== gesture.direction;
    const accelerationReset = shouldResetTerminalArrowAcceleration(gesture.peakDistance, next.distance);
    if (accelerationReset) {
      gesture.accelerationStartedAt = performance.now();
      gesture.peakDistance = next.distance;
    } else {
      gesture.peakDistance = Math.max(gesture.peakDistance, next.distance);
    }
    gesture.direction = next.direction;
    gesture.distance = next.distance;
    setArrowOverlay({ direction: next.direction, originX: gesture.originX, originY: gesture.originY });
    if (!next.direction) clearArrowRepeat();
    else if (directionChanged) {
      sendArrowDirection(next.direction);
      scheduleArrowRepeat();
    } else if (accelerationReset) scheduleArrowRepeat();
    restoreScrollPosition();
    return true;
  }, [clearArrowRepeat, restoreScrollPosition, scheduleArrowRepeat, sendArrowDirection]);

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
      // Pointer capture is optional in synthetic and older touch environments.
    }
  }, [clearArrowRepeat, stageRef]);

  const activateArrowGesture = useCallback((start: NonNullable<typeof longPressStartRef.current>) => {
    if (longPressStartRef.current?.pointerId !== start.pointerId) return;
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    longPressStartRef.current = null;
    explicitTapStartRef.current = null;
    setActionMenu(null);
    terminalRef.current?.clearSelection();
    setSelectionHandles(null);
    cancelScrollForArrowGestureRef.current?.();
    if (!start.keyboardWasActive && terminalRef.current?.textarea === document.activeElement) terminalRef.current.textarea?.blur();

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
      // The gesture remains usable while the pointer stays within the stage.
    }
  }, [containerRef, setActionMenu, setSelectionHandles, stageRef, terminalRef]);

  const releaseArrowGesture = useCallback(() => {
    const gesture = arrowGestureRef.current;
    if (!gesture) return;
    const activateSelection = shouldActivateTerminalSelectionAfterArrowGesture(gesture.peakDistance);
    const { originX, originY } = gesture;
    clearArrowGesture();
    if (activateSelection && selectWordAtPointer(originX, originY)) vibrate(SELECTION_ACTIVATION_VIBRATION_MS);
  }, [clearArrowGesture, selectWordAtPointer]);

  const cancelPointerGesture = useCallback(() => {
    explicitTapStartRef.current = null;
    clearLongPress();
    clearArrowGesture();
  }, [clearArrowGesture, clearLongPress]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
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
    longPressTimerRef.current = window.setTimeout(() => activateArrowGesture(start), LONG_PRESS_MS);
  }, [activateArrowGesture, setActionMenu, terminalRef]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (updateArrowGesture(event.pointerId, event.clientX, event.clientY)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const start = longPressStartRef.current;
    if (start?.pointerId === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE_PX) {
      clearLongPress();
    }
    const tap = explicitTapStartRef.current;
    if (tap?.pointerId === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > MOVE_TOLERANCE_PX) {
      explicitTapStartRef.current = null;
    }
  }, [clearLongPress, updateArrowGesture]);

  const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (arrowGestureRef.current?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      explicitTapStartRef.current = null;
      clearLongPress();
      releaseArrowGesture();
      return;
    }
    const tap = explicitTapStartRef.current;
    if (tap?.pointerId === event.pointerId) {
      if (tap.pointerType === "touch" || tap.pointerType === "pen") {
        event.preventDefault();
        event.stopPropagation();
        focusAtPointer(terminalRef.current, containerRef.current, event.clientX, event.clientY);
      } else terminalRef.current?.focus();
    }
    explicitTapStartRef.current = null;
    clearLongPress();
  }, [clearLongPress, containerRef, releaseArrowGesture, terminalRef]);

  const handlePointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" && arrowGestureRef.current?.pointerId === event.pointerId) {
      event.preventDefault();
      explicitTapStartRef.current = null;
      clearLongPress();
      return;
    }
    cancelPointerGesture();
  }, [cancelPointerGesture, clearLongPress]);

  const handlePointerLeave = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (arrowGestureRef.current?.pointerId !== event.pointerId) cancelPointerGesture();
  }, [cancelPointerGesture]);

  return {
    arrowGestureRef,
    arrowOverlay,
    cancelPointerGesture,
    cancelScrollForArrowGestureRef,
    clearArrowGesture,
    clearLongPress,
    explicitTapStartRef,
    handlePointerCancel,
    handlePointerDown,
    handlePointerEnd,
    handlePointerLeave,
    handlePointerMove,
    longPressStartRef,
    releaseArrowGesture,
    restoreScrollPosition,
    updateArrowGesture,
  };
}

function focusAtPointer(terminal: Terminal | null, container: HTMLDivElement | null, clientX: number, clientY: number): void {
  const textarea = terminal?.textarea;
  const screen = container?.querySelector(".xterm-screen");
  if (textarea && screen instanceof HTMLElement) {
    const rect = screen.getBoundingClientRect();
    textarea.style.width = "20px";
    textarea.style.height = "20px";
    textarea.style.left = `${clientX - rect.left - 10}px`;
    textarea.style.top = `${clientY - rect.top - 10}px`;
    textarea.style.zIndex = "1000";
  }
  terminal?.focus();
}

function vibrate(durationMs: number): void {
  try {
    navigator.vibrate?.(durationMs);
  } catch {
    // Haptics are optional and may be blocked by browser or device settings.
  }
}
