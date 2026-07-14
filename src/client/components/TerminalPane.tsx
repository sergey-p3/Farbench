import { useCallback, useEffect, useRef, useState } from "react";
import type { FitAddon } from "xterm-addon-fit";
import type { Terminal } from "xterm";
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
} from "./terminal/TerminalChrome.js";
import {
  terminalConnectionStatusText,
  terminalSocketUrl,
  type TerminalConnectionPhase,
} from "./terminal/terminalProtocol.js";
import { useTerminalArrowGesture } from "./terminal/useTerminalArrowGesture.js";
import { useTerminalInput } from "./terminal/useTerminalInput.js";
import { useTerminalSelection } from "./terminal/useTerminalSelection.js";
import { useTerminalSession } from "./terminal/useTerminalSession.js";

interface TerminalPaneProps {
  sessionId: string | null;
  displayKind?: "terminal" | "agent";
  onOpenCreateSheet: () => void;
  onUnauthorized?: () => void;
}

const ACTION_MENU_WIDTH_PX = 168;

export { terminalSocketUrl };

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
  const receivedScrollbackRef = useRef(false);
  const autoReconnectAttemptsRef = useRef(0);
  const autoReconnectSessionIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [connectionPhase, setConnectionPhase] = useState<TerminalConnectionPhase>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [actionMenu, setActionMenu] = useState<TerminalActionMenuState | null>(null);
  const [isPasteCaptureVisible, setIsPasteCaptureVisible] = useState(false);

  const input = useTerminalInput({ socketRef, terminalDebugRef, terminalRef, setStatus });
  const selection = useTerminalSelection({ containerRef, stageRef, terminalRef, setStatus });
  const openActionMenu = useCallback((x: number, y: number) => {
    const nextX = Math.max(8, Math.min(x, window.innerWidth - ACTION_MENU_WIDTH_PX - 8));
    const nextY = Math.max(8, Math.min(y, window.innerHeight - 160));
    if (!terminalRef.current?.getSelection()) selection.selectWordAtPointer(x, y);
    setActionMenu({ pointerX: x, pointerY: y, x: nextX, y: nextY });
  }, [selection.selectWordAtPointer]);
  const arrow = useTerminalArrowGesture({
    containerRef,
    handleSelectionTapAtPointer: selection.handleSelectionTapAtPointer,
    openActionMenu,
    selectWordAtPointer: selection.selectWordAtPointer,
    sendTerminalInput: input.sendTerminalInput,
    setActionMenu,
    setSelectionHandles: selection.setSelectionHandles,
    stageRef,
    terminalRef,
  });

  const retryConnection = useCallback(() => {
    autoReconnectAttemptsRef.current = 0;
    setRetryNonce((current) => current + 1);
  }, []);

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!arrow.longPressStartRef.current && !arrow.arrowGestureRef.current) openActionMenu(event.clientX, event.clientY);
  }, [arrow.arrowGestureRef, arrow.longPressStartRef, openActionMenu]);

  const selectWordFromMenu = useCallback(() => {
    const pointer = actionMenu;
    setActionMenu(null);
    if (pointer) selection.selectWordAtPointer(pointer.pointerX, pointer.pointerY);
  }, [actionMenu, selection.selectWordAtPointer]);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) input.sendTerminalInput(text);
      closeActionMenu();
      terminalRef.current?.focus();
    } catch {
      setIsPasteCaptureVisible(true);
      window.setTimeout(() => pasteCaptureRef.current?.focus(), 0);
    }
  }, [input.sendTerminalInput]);

  const sendCapturedPaste = useCallback((text: string) => {
    if (!text) return;
    input.sendTerminalInput(text);
    closeActionMenu();
    terminalRef.current?.focus();
  }, [input.sendTerminalInput]);

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

  function closeActionMenu(): void {
    setIsPasteCaptureVisible(false);
    setActionMenu(null);
  }

  useEffect(() => {
    if (!actionMenu) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeActionMenu();
      input.focusTerminal();
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!actionMenuRef.current?.contains(event.target as Node)) closeActionMenu();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", arrow.cancelPointerGesture);
    window.addEventListener("scroll", arrow.cancelPointerGesture, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", arrow.cancelPointerGesture);
      window.removeEventListener("scroll", arrow.cancelPointerGesture, true);
    };
  }, [actionMenu, arrow.cancelPointerGesture, input.focusTerminal]);

  useTerminalSession({
    actions: {
      clearArrowGesture: arrow.clearArrowGesture,
      clearLongPress: arrow.clearLongPress,
      focusTerminal: input.focusTerminal,
      releaseArrowGesture: arrow.releaseArrowGesture,
      restoreArrowGestureScrollPosition: arrow.restoreScrollPosition,
      sendTerminalInput: input.sendTerminalInput,
      updateArrowGesture: arrow.updateArrowGesture,
      updateCtrlActive: input.updateCtrlActive,
      updateTerminalSelectionHandles: selection.updateSelectionHandles,
    },
    onUnauthorized,
    refs: {
      arrowGestureRef: arrow.arrowGestureRef,
      autoReconnectAttemptsRef,
      autoReconnectSessionIdRef,
      cancelScrollForArrowGestureRef: arrow.cancelScrollForArrowGestureRef,
      containerRef,
      explicitTapStartRef: arrow.explicitTapStartRef,
      fitAddonRef,
      isCtrlActiveRef: input.isCtrlActiveRef,
      pendingInputRef: input.pendingInputRef,
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
    setSelectionHandles: selection.setSelectionHandles,
    setStatus,
  });

  if (!sessionId) return <EmptyTerminalPane onCreate={onOpenCreateSheet} />;
  const connectionStatus = status ? null : terminalConnectionStatusText(displayKind, connectionPhase);

  return (
    <div className="tool-panel terminal-pane" ref={rootRef}>
      <TerminalStatus message={status} onCreate={onOpenCreateSheet} onRetry={retryConnection} />
      <div
        className="terminal-stage"
        ref={stageRef}
        onContextMenu={handleContextMenu}
        onPointerCancel={arrow.handlePointerCancel}
        onPointerDown={arrow.handlePointerDown}
        onPointerLeave={arrow.handlePointerLeave}
        onPointerMove={arrow.handlePointerMove}
        onPointerUp={arrow.handlePointerEnd}
      >
        <div className="terminal-host" ref={containerRef} />
        <TerminalConnectionStatus message={connectionStatus} />
        <TerminalSelectionHandles
          bufferLength={terminalRef.current?.buffer.active.length ?? 0}
          handles={selection.selectionHandles}
          onBeginDrag={selection.beginHandleDrag}
        />
        <TerminalArrowGesture overlay={arrow.arrowOverlay} />
      </div>
      <TerminalActionMenu
        isPasteCaptureVisible={isPasteCaptureVisible}
        menu={actionMenu}
        menuRef={actionMenuRef}
        onCopy={() => {
          closeActionMenu();
          void selection.copySelection();
        }}
        onPaste={() => void pasteFromClipboard()}
        onPasteCaptureInput={handlePasteCaptureInput}
        onPasteCapturePaste={handlePasteCapturePaste}
        onSelect={selectWordFromMenu}
        onSelectAll={() => {
          selection.selectAll();
          setActionMenu(null);
        }}
        pasteCaptureRef={pasteCaptureRef}
      />
      <TerminalKeybar
        isCtrlActive={input.isCtrlActive}
        onClick={input.handleToolbarClick}
        onPreserveFocus={input.preserveTerminalFocus}
        onTouchEnd={input.handleToolbarTouchEnd}
      />
    </div>
  );
}
