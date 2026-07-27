import { useCallback, useEffect, useRef, useState } from "react";
import type { FitAddon } from "xterm-addon-fit";
import type { Terminal } from "xterm";
import {
  agentInputSubmission,
  clearAgentInputDraft,
  loadAgentInputDraft,
  saveAgentInputDraft,
} from "../agentInputDraft.js";
import {
  loadRichAgentOutputMode,
  saveRichAgentOutputMode,
  type RichAgentOutputMode,
} from "../agentViewPreferences.js";
import type { TerminalDebugLogger } from "../terminalDebug.js";
import type { RichAgentInputMode } from "../richAgentInput.js";
import { richTerminalOutput, type RichTerminalOutput } from "../richTerminalOutput.js";
import { createTerminalLogCollector } from "../terminalLog.js";
import {
  AgentInputComposer,
  type AgentInputComposerMode,
} from "./terminal/AgentInputComposer.js";
import { RichAgentView } from "./terminal/RichAgentView.js";
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
  agentViewMode?: "rich" | "terminal";
  sessionId: string | null;
  displayKind?: "terminal" | "agent";
  isAgentComposerRequested?: boolean;
  onAgentComposerClosed?: (sessionId: string) => void;
  onOpenCreateSheet: () => void;
  onUnauthorized?: () => void;
}

const ACTION_MENU_WIDTH_PX = 168;

export { terminalSocketUrl };

export function TerminalPane({
  agentViewMode = "terminal",
  sessionId,
  displayKind = "terminal",
  isAgentComposerRequested = false,
  onAgentComposerClosed,
  onOpenCreateSheet,
  onUnauthorized,
}: TerminalPaneProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const agentInputRef = useRef<HTMLTextAreaElement | null>(null);
  const richAgentInputRef = useRef<HTMLTextAreaElement | null>(null);
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
  const [agentInputDraft, setAgentInputDraft] = useState(() =>
    displayKind === "agent" && sessionId ? loadAgentInputDraft(sessionId) : "",
  );
  const [agentInputComposerMode, setAgentInputComposerMode] = useState<AgentInputComposerMode>(() =>
    agentInputDraft ? "open" : "closed",
  );
  const [richInputMode, setRichInputMode] = useState<RichAgentInputMode>("message");
  const [richOutputMode, setRichOutputMode] = useState(loadRichAgentOutputMode);
  const [richOutput, setRichOutput] = useState<RichTerminalOutput>([]);
  const [richLogText, setRichLogText] = useState("");
  const richLogCollectorRef = useRef(createTerminalLogCollector());
  const isRichAgentView = displayKind === "agent" && agentViewMode === "rich";
  const isRichAgentViewRef = useRef(isRichAgentView);
  const richOutputModeRef = useRef(richOutputMode);
  isRichAgentViewRef.current = isRichAgentView;
  richOutputModeRef.current = richOutputMode;

  const input = useTerminalInput({ socketRef, terminalDebugRef, terminalRef, setStatus });
  const updateRichOutput = useCallback((terminal: Terminal) => {
    if (isRichAgentViewRef.current && richOutputModeRef.current === "screen") {
      setRichOutput(richTerminalOutput(terminal));
    }
  }, []);
  const updateRichLog = useCallback((data: string, behavior: "append" | "replace") => {
    const collector = richLogCollectorRef.current;
    const nextLog = behavior === "replace" ? collector.replay(data) : collector.append(data);
    if (isRichAgentViewRef.current && richOutputModeRef.current === "log") setRichLogText(nextLog);
  }, []);
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

  const closeAgentInputComposer = useCallback(() => {
    setAgentInputComposerMode("closed");
    if (sessionId) onAgentComposerClosed?.(sessionId);
  }, [onAgentComposerClosed, sessionId]);

  const minimizeAgentInputComposer = useCallback(() => {
    setAgentInputComposerMode("minimized");
    if (sessionId) onAgentComposerClosed?.(sessionId);
  }, [onAgentComposerClosed, sessionId]);

  const updateAgentInputDraft = useCallback((text: string) => {
    setAgentInputDraft(text);
    if (sessionId) saveAgentInputDraft(sessionId, text);
  }, [sessionId]);

  const submitAgentInput = useCallback(() => {
    if (!sessionId || !agentInputDraft) return;
    const data = agentInputSubmission(
      agentInputDraft,
      terminalRef.current?.modes.bracketedPasteMode ?? false,
    );
    if (!input.sendTerminalInput(data)) return;
    clearAgentInputDraft(sessionId);
    setAgentInputDraft("");
    setAgentInputComposerMode("closed");
    onAgentComposerClosed?.(sessionId);
    input.focusTerminal();
  }, [agentInputDraft, input.focusTerminal, input.sendTerminalInput, onAgentComposerClosed, sessionId]);

  const submitRichAgentMessage = useCallback(() => {
    if (!sessionId || !agentInputDraft) return;
    const data = agentInputSubmission(
      agentInputDraft,
      terminalRef.current?.modes.bracketedPasteMode ?? false,
    );
    if (!input.sendTerminalInput(data)) return;
    clearAgentInputDraft(sessionId);
    setAgentInputDraft("");
    window.setTimeout(() => richAgentInputRef.current?.focus(), 0);
  }, [agentInputDraft, input.sendTerminalInput, sessionId]);

  const toggleRichInputMode = useCallback(() => {
    setRichInputMode((current) => current === "message" ? "keystroke" : "message");
    window.setTimeout(() => richAgentInputRef.current?.focus(), 0);
  }, []);

  const changeRichOutputMode = useCallback((mode: RichAgentOutputMode) => {
    setRichOutputMode(mode);
    saveRichAgentOutputMode(mode);
    if (mode === "log") setRichLogText(richLogCollectorRef.current.value());
    else if (terminalRef.current) setRichOutput(richTerminalOutput(terminalRef.current));
  }, []);

  useEffect(() => {
    if (!isRichAgentView || !terminalRef.current) return;
    setRichOutput(richTerminalOutput(terminalRef.current));
    if (richOutputModeRef.current === "log") setRichLogText(richLogCollectorRef.current.value());
    window.setTimeout(() => richAgentInputRef.current?.focus(), 0);
  }, [isRichAgentView]);

  useEffect(() => {
    if (displayKind !== "agent" || isRichAgentView || !isAgentComposerRequested) return;
    closeActionMenu();
    setAgentInputComposerMode("open");
  }, [displayKind, isAgentComposerRequested, isRichAgentView]);

  useEffect(() => {
    if (agentInputComposerMode !== "open") return;
    const focusTimer = window.setTimeout(() => agentInputRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeAgentInputComposer();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [agentInputComposerMode, closeAgentInputComposer]);

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
    onTerminalData: updateRichLog,
    onTerminalRender: updateRichOutput,
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
    <div className={`tool-panel terminal-pane ${isRichAgentView ? "rich-agent-pane" : ""}`} ref={rootRef}>
      <TerminalStatus message={status} onCreate={onOpenCreateSheet} onRetry={retryConnection} />
      <div
        className={`terminal-stage ${isRichAgentView ? "rich-agent-stage" : ""}`}
        ref={stageRef}
        onContextMenu={isRichAgentView ? undefined : handleContextMenu}
        onPointerCancel={isRichAgentView ? undefined : arrow.handlePointerCancel}
        onPointerDown={isRichAgentView ? undefined : arrow.handlePointerDown}
        onPointerLeave={isRichAgentView ? undefined : arrow.handlePointerLeave}
        onPointerMove={isRichAgentView ? undefined : arrow.handlePointerMove}
        onPointerUp={isRichAgentView ? undefined : arrow.handlePointerEnd}
      >
        <div className={`terminal-host ${isRichAgentView ? "rich-agent-terminal-source" : ""}`} ref={containerRef} />
        {isRichAgentView ? (
          <RichAgentView
            draft={agentInputDraft}
            inputMode={richInputMode}
            inputRef={richAgentInputRef}
            logText={richLogText}
            onChangeDraft={updateAgentInputDraft}
            onOutputModeChange={changeRichOutputMode}
            onSendImmediate={(data) => input.sendTerminalInput(data)}
            onSendMessage={submitRichAgentMessage}
            onToggleInputMode={toggleRichInputMode}
            output={richOutput}
            outputMode={richOutputMode}
          />
        ) : null}
        <TerminalConnectionStatus message={connectionStatus} />
        {isRichAgentView ? null : (
          <>
            <TerminalSelectionHandles
              bufferLength={terminalRef.current?.buffer.active.length ?? 0}
              handles={selection.selectionHandles}
              onBeginDrag={selection.beginHandleDrag}
            />
            <TerminalArrowGesture overlay={arrow.arrowOverlay} />
          </>
        )}
      </div>
      {isRichAgentView ? null : (
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
      )}
      {displayKind === "agent" && !isRichAgentView ? (
        <AgentInputComposer
          draft={agentInputDraft}
          mode={agentInputComposerMode}
          onCancel={closeAgentInputComposer}
          onChange={updateAgentInputDraft}
          onMinimize={minimizeAgentInputComposer}
          onRestore={() => setAgentInputComposerMode("open")}
          onSubmit={submitAgentInput}
          textareaRef={agentInputRef}
        />
      ) : null}
      {isRichAgentView ? null : (
        <TerminalKeybar
          isCtrlActive={input.isCtrlActive}
          onClick={input.handleToolbarClick}
          onPreserveFocus={input.preserveTerminalFocus}
          onTouchEnd={input.handleToolbarTouchEnd}
        />
      )}
    </div>
  );
}
