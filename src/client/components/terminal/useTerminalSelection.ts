import { useCallback, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Terminal } from "xterm";
import { copyTextToClipboard } from "../../clipboard.js";
import {
  terminalCellFromPointer,
  terminalHandleLayoutFromSelection,
  terminalSelectedTextFromBuffer,
  terminalSelectArgsFromEndpoints,
  terminalWordRangeAtCell,
  type TerminalBufferCell,
  type TerminalSelectionHandleLayout,
} from "../../terminalSelection.js";
import type { TerminalSelectionHandleKind } from "./TerminalChrome.js";

export function useTerminalSelection({
  containerRef,
  stageRef,
  terminalRef,
  setStatus,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  terminalRef: RefObject<Terminal | null>;
  setStatus: Dispatch<SetStateAction<string | null>>;
}) {
  const selectionDragRef = useRef<{
    anchor: TerminalBufferCell;
    handle: TerminalSelectionHandleKind;
    pointerId: number;
  } | null>(null);
  const [selectionHandles, setSelectionHandles] = useState<TerminalSelectionHandleLayout | null>(null);

  const cellFromPointer = useCallback((clientX: number, clientY: number): TerminalBufferCell | null => {
    const terminal = terminalRef.current;
    const screen = containerRef.current?.querySelector(".xterm-screen");
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
    return cell ? { column: cell.column, row: terminal.buffer.active.viewportY + cell.row } : null;
  }, [containerRef, terminalRef]);

  const updateSelectionHandles = useCallback(() => {
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
  }, [containerRef, stageRef, terminalRef]);

  const selectWordAtPointer = useCallback((clientX: number, clientY: number): boolean => {
    const terminal = terminalRef.current;
    const cell = cellFromPointer(clientX, clientY);
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
    updateSelectionHandles();
    return true;
  }, [cellFromPointer, terminalRef, updateSelectionHandles]);

  const copySelection = useCallback(async () => {
    const terminal = terminalRef.current;
    const position = terminal?.getSelectionPosition();
    const selection = terminal && position
      ? terminalSelectedTextFromBuffer({
        getLine: (row) => {
          const line = terminal.buffer.active.getLine(row);
          return line ? { isWrapped: line.isWrapped, text: line.translateToString(true) } : null;
        },
        selection: {
          start: { column: position.start.x, row: position.start.y },
          end: { column: position.end.x, row: position.end.y },
        },
      }) || terminal.getSelection()
      : terminal?.getSelection() ?? "";
    if (selection && !(await copyTextToClipboard(selection))) setStatus("Unable to copy terminal selection.");
  }, [setStatus, terminalRef]);

  const applyHandleDrag = useCallback((clientX: number, clientY: number, pointerId: number): boolean => {
    const drag = selectionDragRef.current;
    const terminal = terminalRef.current;
    if (!drag || drag.pointerId !== pointerId || !terminal) return false;
    const cell = cellFromPointer(clientX, clientY);
    if (!cell) return false;

    const movingCell = drag.handle === "end" ? { column: Math.min(cell.column + 1, terminal.cols), row: cell.row } : cell;
    const args = terminalSelectArgsFromEndpoints({
      cols: terminal.cols,
      end: drag.handle === "end" ? movingCell : drag.anchor,
      start: drag.handle === "start" ? movingCell : drag.anchor,
    });
    if (!args) return false;
    terminal.select(args.column, args.row, args.length);
    updateSelectionHandles();
    return true;
  }, [cellFromPointer, terminalRef, updateSelectionHandles]);

  const beginHandleDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>, handle: TerminalSelectionHandleKind) => {
    const selection = terminalRef.current?.getSelectionPosition();
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
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      applyHandleDrag(moveEvent.clientX, moveEvent.clientY, pointerId);
    };
    const end = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      endEvent.preventDefault();
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      selectionDragRef.current = null;
    };
    window.addEventListener("pointermove", move, { capture: true, passive: false });
    window.addEventListener("pointerup", end, { capture: true, passive: false });
    window.addEventListener("pointercancel", end, { capture: true, passive: false });
  }, [applyHandleDrag, terminalRef]);

  return {
    beginHandleDrag,
    copySelection,
    selectAll: () => terminalRef.current?.selectAll(),
    selectionHandles,
    selectWordAtPointer,
    setSelectionHandles,
    updateSelectionHandles,
  };
}
