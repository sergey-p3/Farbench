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

export interface TerminalWordSelectionInput {
  cell: TerminalBufferCell;
  cols: number;
  getLine: (row: number) => TerminalSelectedBufferLine | null | undefined;
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

export interface TerminalSelectedBufferLine {
  isWrapped: boolean;
  text: string;
}

export interface TerminalSelectedTextInput {
  getLine: (row: number) => TerminalSelectedBufferLine | null | undefined;
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

export function terminalWordSelectionAtCell(input: TerminalWordSelectionInput): TerminalSelectArgs | null {
  if (input.cols <= 0 || input.cell.row < 0) return null;

  const line = input.getLine(input.cell.row);
  const range = line ? terminalWordRangeAtCell(line.text, input.cell.column) : null;
  if (!line || !range) return null;

  let start: TerminalBufferCell = { column: range.start, row: input.cell.row };
  let end: TerminalBufferCell = { column: range.start + range.length, row: input.cell.row };

  while (start.column === 0) {
    const currentLine = input.getLine(start.row);
    const previousLine = input.getLine(start.row - 1);
    if (!currentLine?.isWrapped || !previousLine || previousLine.text.length < input.cols) break;

    const previousRange = terminalWordRangeAtCell(previousLine.text, input.cols - 1);
    if (!previousRange || previousRange.start + previousRange.length !== input.cols) break;
    start = { column: previousRange.start, row: start.row - 1 };
  }

  while (end.column === input.cols) {
    const nextLine = input.getLine(end.row + 1);
    if (!nextLine?.isWrapped) break;

    const nextRange = terminalWordRangeAtCell(nextLine.text, 0);
    if (!nextRange) break;
    end = { column: nextRange.start + nextRange.length, row: end.row + 1 };
  }

  return terminalSelectArgsFromEndpoints({ cols: input.cols, end, start });
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

export function terminalSelectedTextFromBuffer(input: TerminalSelectedTextInput): string {
  const selection = normalizeTerminalSelection(input.selection);
  const parts: string[] = [];

  for (let row = selection.start.row; row <= selection.end.row; row += 1) {
    const line = input.getLine(row);
    if (!line) continue;

    const startColumn = row === selection.start.row ? selection.start.column : 0;
    const endColumn = row === selection.end.row ? selection.end.column : line.text.length;
    const text = line.text.slice(startColumn, Math.max(startColumn, endColumn));
    if (row > selection.start.row && !line.isWrapped) {
      parts.push("\n");
    }
    parts.push(text);
  }

  return parts.join("");
}

function normalizeTerminalSelection(selection: TerminalBufferSelection): TerminalBufferSelection {
  const startOffset = selection.start.row * Number.MAX_SAFE_INTEGER + selection.start.column;
  const endOffset = selection.end.row * Number.MAX_SAFE_INTEGER + selection.end.column;
  if (startOffset <= endOffset) return selection;
  return { start: selection.end, end: selection.start };
}
