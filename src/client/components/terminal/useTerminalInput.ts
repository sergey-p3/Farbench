import { useCallback, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Terminal } from "xterm";
import type { TerminalDebugLogger } from "../../terminalDebug.js";
import { terminalControlSequence, type TerminalToolbarKey } from "../../terminalKeys.js";
import { webSocketReadyStateName } from "./terminalProtocol.js";

export function useTerminalInput({
  socketRef,
  terminalDebugRef,
  terminalRef,
  setStatus,
}: {
  socketRef: RefObject<WebSocket | null>;
  terminalDebugRef: RefObject<TerminalDebugLogger | null>;
  terminalRef: RefObject<Terminal | null>;
  setStatus: Dispatch<SetStateAction<string | null>>;
}) {
  const pendingInputRef = useRef<string[]>([]);
  const isCtrlActiveRef = useRef(false);
  const skipNextToolbarClickRef = useRef(false);
  const [isCtrlActive, setIsCtrlActive] = useState(false);

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
  }, [setStatus, socketRef, terminalDebugRef]);

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

  const focusTerminal = useCallback(() => {
    window.setTimeout(() => terminalRef.current?.focus(), 0);
  }, [terminalRef]);

  return {
    focusTerminal,
    handleToolbarClick,
    handleToolbarTouchEnd,
    isCtrlActive,
    isCtrlActiveRef,
    pendingInputRef,
    preserveTerminalFocus,
    sendTerminalInput,
    updateCtrlActive,
  };
}
