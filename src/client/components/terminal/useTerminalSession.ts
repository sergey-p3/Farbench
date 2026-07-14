import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { FitAddon } from "xterm-addon-fit";
import { Terminal } from "xterm";
import { TERMINAL_HISTORY_LINES } from "../../../shared/terminalHistory.js";
import { api, isUnauthorized } from "../../api.js";
import { createMomentumScrollGesture, TOUCH_SCROLL_TAP_THRESHOLD_PX } from "../../scrollMomentum.js";
import type { TerminalArrowDirection } from "../../terminalArrowGesture.js";
import { createTerminalDebugLogger, type TerminalDebugLogger } from "../../terminalDebug.js";
import { createTerminalGestureOwner } from "../../terminalGestureOwner.js";
import { terminalControlSequence } from "../../terminalKeys.js";
import { scrollTerminalViewportByPixels } from "../../terminalPixelScroller.js";
import type { TerminalSelectionHandleLayout } from "../../terminalSelection.js";
import { terminalKeyboardChromeInset, terminalViewportFitDelayMs } from "../../terminalViewport.js";
import { createTerminalWriteQueue, terminalHistoryReplay } from "../../terminalWriteQueue.js";
import {
  averageTouchClientY,
  parseTerminalMessage,
  socketDataBytes,
  terminalControlLetter,
  terminalMessageBytes,
  terminalSocketUrl,
  webSocketReadyStateName,
  type TerminalConnectionPhase,
} from "./terminalProtocol.js";

const TERMINAL_CONNECT_TIMEOUT_MS = 4_000;
const TERMINAL_AUTO_RETRY_DELAYS_MS = [300, 1_000, 2_500];
let nextTerminalPaneInstanceId = 1;

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

interface TerminalSessionRefs {
  arrowGestureRef: RefObject<TerminalArrowGestureRuntime | null>;
  autoReconnectAttemptsRef: RefObject<number>;
  autoReconnectSessionIdRef: RefObject<string | null>;
  cancelScrollForArrowGestureRef: RefObject<(() => void) | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  explicitTapStartRef: RefObject<TerminalExplicitTap | null>;
  fitAddonRef: RefObject<FitAddon | null>;
  isCtrlActiveRef: RefObject<boolean>;
  pendingInputRef: RefObject<string[]>;
  receivedScrollbackRef: RefObject<boolean>;
  rootRef: RefObject<HTMLDivElement | null>;
  socketRef: RefObject<WebSocket | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  terminalDebugRef: RefObject<TerminalDebugLogger | null>;
  terminalRef: RefObject<Terminal | null>;
}

interface TerminalSessionActions {
  clearArrowGesture: () => void;
  clearLongPress: () => void;
  focusTerminal: () => void;
  releaseArrowGesture: () => void;
  restoreArrowGestureScrollPosition: () => void;
  sendTerminalInput: (data: string) => void;
  updateArrowGesture: (pointerId: number | null, clientX: number, clientY: number) => boolean;
  updateCtrlActive: (next: boolean | ((current: boolean) => boolean)) => void;
  updateTerminalSelectionHandles: () => void;
}

interface UseTerminalSessionOptions {
  actions: TerminalSessionActions;
  onUnauthorized?: () => void;
  refs: TerminalSessionRefs;
  retryNonce: number;
  sessionId: string | null;
  setConnectionPhase: Dispatch<SetStateAction<TerminalConnectionPhase>>;
  setRetryNonce: Dispatch<SetStateAction<number>>;
  setSelectionHandles: Dispatch<SetStateAction<TerminalSelectionHandleLayout | null>>;
  setStatus: Dispatch<SetStateAction<string | null>>;
}

/** Owns xterm, WebSocket, resize, scroll, reconnect, and disposal lifecycle. */
export function useTerminalSession({
  actions,
  onUnauthorized,
  refs,
  retryNonce,
  sessionId,
  setConnectionPhase,
  setRetryNonce,
  setSelectionHandles,
  setStatus,
}: UseTerminalSessionOptions): void {
  const {
    clearArrowGesture,
    clearLongPress,
    focusTerminal,
    releaseArrowGesture,
    restoreArrowGestureScrollPosition,
    sendTerminalInput,
    updateArrowGesture,
    updateCtrlActive,
    updateTerminalSelectionHandles,
  } = actions;
  const {
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
  } = refs;

  useEffect(() => {
    setStatus(null);
    setConnectionPhase(null);
    updateCtrlActive(false);

    if (!sessionId || !containerRef.current) return;
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
        rootRef.current.style.setProperty(
          "--terminal-keyboard-chrome-inset",
          `${terminalKeyboardChromeInset(metrics)}px`,
        );

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
    const createScrollMomentum = () => createMomentumScrollGesture({
      scrollBy: scrollTerminalByPixels,
      viewportHeightPx: () => {
        const viewport = touchScrollTarget.querySelector(".xterm-viewport");
        return viewport instanceof HTMLElement ? viewport.clientHeight : touchScrollTarget.clientHeight;
      },
    });
    const touchMomentum = createScrollMomentum();
    const pointerMomentum = createScrollMomentum();
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
      const touchY = averageTouchClientY(event.touches);
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
      const nextY = averageTouchClientY(event.touches);
      if (nextY === null) return;
      if (!gestureOwner.canMoveTouch()) {
        if (touchScrollStartY === null || Math.abs(nextY - touchScrollStartY) < TOUCH_SCROLL_TAP_THRESHOLD_PX) return;
        if (!gestureOwner.claimTouchMove()) return;
        pointerMomentum.cancel();
      }
      if (!touchMomentum.move(nextY)) return;
      explicitTapStartRef.current = null;
      clearLongPress();
      if (event.cancelable) event.preventDefault();
    };
    const resetTouchScroll = () => {
      const hadArrowGesture = arrowGestureRef.current !== null;
      if (hadArrowGesture) releaseArrowGesture();
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
      if (!gestureOwner.canMovePointer(event.pointerId) || !pointerMomentum.move(event.clientY)) return;
      gestureOwner.notePointerMoved(event.pointerId);
      explicitTapStartRef.current = null;
      clearLongPress();
      if (event.cancelable) event.preventDefault();
    };
    const resetPointerScroll = (event: PointerEvent) => {
      if (gestureOwner.endPointer(event.pointerId)) pointerMomentum.end();
    };
    const cancelPointerScroll = (event: PointerEvent) => {
      if (gestureOwner.endPointer(event.pointerId)) pointerMomentum.cancel();
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
      if (arrowGestureRef.current) restoreArrowGestureScrollPosition();
      else updateTerminalSelectionHandles();
    };
    if (xtermViewport instanceof HTMLElement) xtermViewport.addEventListener("scroll", handleXtermViewportScroll);

    const dataDisposable = terminal.onData((data) => {
      if (isCtrlActiveRef.current) {
        const controlKey = terminalControlLetter(data);
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

    function handleConnectionFailure(message: string): void {
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
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close();
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

    async function verifyAuth(message: string): Promise<void> {
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
      if (xtermViewport instanceof HTMLElement) xtermViewport.removeEventListener("scroll", handleXtermViewportScroll);
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
  }, [
    clearArrowGesture,
    clearLongPress,
    focusTerminal,
    onUnauthorized,
    releaseArrowGesture,
    restoreArrowGestureScrollPosition,
    retryNonce,
    sendTerminalInput,
    sessionId,
    updateArrowGesture,
    updateCtrlActive,
    updateTerminalSelectionHandles,
  ]);
}
