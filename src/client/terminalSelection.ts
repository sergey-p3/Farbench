export interface TerminalHostRect {
  left: number;
  top: number;
}

export interface TerminalCellFromPointerInput {
  cellHeight: number;
  cellWidth: number;
  clientX: number;
  clientY: number;
  cols: number;
  hostRect: TerminalHostRect;
  rows: number;
}

export interface TerminalCell {
  column: number;
  row: number;
}

export interface TerminalWordRange {
  start: number;
  length: number;
}

export interface TerminalBufferCell {
  column: number;
  row: number;
}

export interface TerminalBufferSelection {
  start: TerminalBufferCell;
  end: TerminalBufferCell;
}

export interface TerminalSelectionHandlePoint {
  left: number;
  top: number;
}

export interface TerminalSelectionHandleLayout {
  start: TerminalSelectionHandlePoint;
  end: TerminalSelectionHandlePoint;
}

export interface TerminalHandleLayoutInput {
  cellHeight: number;
  cellWidth: number;
  screenOffsetLeft: number;
  screenOffsetTop: number;
  selection: TerminalBufferSelection;
  viewportY: number;
  visibleRows: number;
}

export interface TerminalSelectArgs {
  column: number;
  row: number;
  length: number;
}

export interface TerminalSelectArgsInput {
  cols: number;
  end: TerminalBufferCell;
  start: TerminalBufferCell;
}

export interface TerminalSelectionContainsCellInput {
  cell: TerminalBufferCell;
  cols: number;
  selection: TerminalBufferSelection;
}

export function terminalCellFromPointer(input: TerminalCellFromPointerInput): TerminalCell | null {
  if (input.cellWidth <= 0 || input.cellHeight <= 0 || input.cols <= 0 || input.rows <= 0) return null;

  const column = Math.floor((input.clientX - input.hostRect.left) / input.cellWidth);
  const row = Math.floor((input.clientY - input.hostRect.top) / input.cellHeight);
  if (column < 0 || row < 0 || column >= input.cols || row >= input.rows) return null;

  return { column, row };
}

export function terminalWordRangeAtCell(line: string, column: number): TerminalWordRange | null {
  if (column < 0 || column >= line.length || !isTerminalWordCharacter(line[column] ?? "")) return null;

  let start = column;
  while (start > 0 && isTerminalWordCharacter(line[start - 1] ?? "")) {
    start -= 1;
  }

  let end = column + 1;
  while (end < line.length && isTerminalWordCharacter(line[end] ?? "")) {
    end += 1;
  }

  return { start, length: end - start };
}

export function isTerminalWordCharacter(character: string): boolean {
  return /^[^\s]+$/.test(character);
}

export function terminalHandleLayoutFromSelection(input: TerminalHandleLayoutInput): TerminalSelectionHandleLayout | null {
  const startRow = input.selection.start.row - input.viewportY;
  const endRow = input.selection.end.row - input.viewportY;
  if (startRow < 0 || endRow < 0 || startRow >= input.visibleRows || endRow >= input.visibleRows) return null;

  return {
    start: {
      left: input.screenOffsetLeft + input.selection.start.column * input.cellWidth,
      top: input.screenOffsetTop + startRow * input.cellHeight,
    },
    end: {
      left: input.screenOffsetLeft + input.selection.end.column * input.cellWidth,
      top: input.screenOffsetTop + endRow * input.cellHeight,
    },
  };
}

export function terminalSelectArgsFromEndpoints(input: TerminalSelectArgsInput): TerminalSelectArgs | null {
  if (input.cols <= 0) return null;

  const startOffset = input.start.row * input.cols + input.start.column;
  const endOffset = input.end.row * input.cols + input.end.column;
  if (startOffset === endOffset) return null;

  const first = startOffset < endOffset ? input.start : input.end;
  const length = Math.abs(endOffset - startOffset);
  return { column: first.column, row: first.row, length };
}

export function terminalSelectionContainsCell(input: TerminalSelectionContainsCellInput): boolean {
  if (input.cols <= 0) return false;
  const startOffset = input.selection.start.row * input.cols + input.selection.start.column;
  const endOffset = input.selection.end.row * input.cols + input.selection.end.column;
  const cellOffset = input.cell.row * input.cols + input.cell.column;
  return cellOffset >= Math.min(startOffset, endOffset) && cellOffset < Math.max(startOffset, endOffset);
}
