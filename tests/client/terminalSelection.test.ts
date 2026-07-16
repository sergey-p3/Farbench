import { describe, expect, test } from "vitest";
import {
  terminalCellFromPointer,
  terminalHandleLayoutFromSelection,
  terminalSelectedTextFromBuffer,
  terminalSelectArgsFromEndpoints,
  terminalSelectionContainsCell,
  terminalWordRangeAtCell,
  terminalWordSelectionAtCell,
} from "../../src/client/terminalSelection.js";

describe("terminal selection helpers", () => {
  test("maps a pointer position inside the terminal host to a cell", () => {
    expect(terminalCellFromPointer({
      cellHeight: 18,
      cellWidth: 9,
      clientX: 55,
      clientY: 44,
      cols: 80,
      hostRect: { left: 10, top: 8 },
      rows: 24,
    })).toEqual({ column: 5, row: 2 });
  });

  test("returns null when the pointer is outside the terminal grid", () => {
    expect(terminalCellFromPointer({
      cellHeight: 18,
      cellWidth: 9,
      clientX: 5,
      clientY: 44,
      cols: 80,
      hostRect: { left: 10, top: 8 },
      rows: 24,
    })).toBeNull();

    expect(terminalCellFromPointer({
      cellHeight: 18,
      cellWidth: 9,
      clientX: 730,
      clientY: 44,
      cols: 80,
      hostRect: { left: 10, top: 8 },
      rows: 24,
    })).toBeNull();
  });

  test("expands a cell to the surrounding terminal word", () => {
    expect(terminalWordRangeAtCell("alpha beta.gamma/path", 8)).toEqual({ start: 6, length: 15 });
  });

  test("returns null for whitespace cells", () => {
    expect(terminalWordRangeAtCell("alpha beta", 5)).toBeNull();
  });

  test.each([
    { column: 6, row: 0 },
    { column: 4, row: 1 },
    { column: 1, row: 2 },
  ])("selects the whole word across wrapped buffer rows from $row:$column", (cell) => {
    const lines = [
      { isWrapped: false, text: "say superlon" },
      { isWrapped: true, text: "gwordcontinu" },
      { isWrapped: true, text: "es now" },
    ];

    expect(terminalWordSelectionAtCell({
      cell,
      cols: 12,
      getLine: (row) => lines[row],
    })).toEqual({ column: 4, row: 0, length: 22 });
  });

  test("does not extend a word across a real line break", () => {
    const lines = [
      { isWrapped: false, text: "longword" },
      { isWrapped: false, text: "continues" },
    ];

    expect(terminalWordSelectionAtCell({
      cell: { column: 2, row: 1 },
      cols: 9,
      getLine: (row) => lines[row],
    })).toEqual({ column: 0, row: 1, length: 9 });
  });

  test("positions start and end handles against the visible selection", () => {
    expect(terminalHandleLayoutFromSelection({
      cellHeight: 18,
      cellWidth: 9,
      screenOffsetLeft: 8,
      screenOffsetTop: 10,
      selection: { start: { column: 2, row: 12 }, end: { column: 7, row: 12 } },
      viewportY: 10,
      visibleRows: 24,
    })).toEqual({
      end: { left: 71, top: 46 },
      start: { left: 26, top: 46 },
    });
  });

  test("does not position handles when the selection is outside the viewport", () => {
    expect(terminalHandleLayoutFromSelection({
      cellHeight: 18,
      cellWidth: 9,
      screenOffsetLeft: 8,
      screenOffsetTop: 10,
      selection: { start: { column: 2, row: 3 }, end: { column: 7, row: 3 } },
      viewportY: 10,
      visibleRows: 24,
    })).toBeNull();
  });

  test("normalizes dragged endpoints into terminal select arguments", () => {
    expect(terminalSelectArgsFromEndpoints({
      cols: 80,
      end: { column: 8, row: 12 },
      start: { column: 2, row: 12 },
    })).toEqual({ column: 2, row: 12, length: 6 });

    expect(terminalSelectArgsFromEndpoints({
      cols: 80,
      end: { column: 2, row: 12 },
      start: { column: 8, row: 12 },
    })).toEqual({ column: 2, row: 12, length: 6 });
  });

  test("detects whether a cell is inside a terminal selection", () => {
    const selection = { start: { column: 2, row: 12 }, end: { column: 8, row: 12 } };

    expect(terminalSelectionContainsCell({ cell: { column: 2, row: 12 }, cols: 80, selection })).toBe(true);
    expect(terminalSelectionContainsCell({ cell: { column: 7, row: 12 }, cols: 80, selection })).toBe(true);
    expect(terminalSelectionContainsCell({ cell: { column: 8, row: 12 }, cols: 80, selection })).toBe(false);
  });

  test("joins wrapped terminal rows without adding newline characters", () => {
    expect(terminalSelectedTextFromBuffer({
      getLine: (row) => ({
        isWrapped: row === 1,
        text: row === 0 ? "long command " : "continued",
      }),
      selection: { start: { column: 0, row: 0 }, end: { column: 9, row: 1 } },
    })).toBe("long command continued");
  });

  test("keeps real terminal newlines between unwrapped rows", () => {
    expect(terminalSelectedTextFromBuffer({
      getLine: (row) => ({
        isWrapped: false,
        text: row === 0 ? "first line" : "second line",
      }),
      selection: { start: { column: 0, row: 0 }, end: { column: 11, row: 1 } },
    })).toBe("first line\nsecond line");
  });

  test("clips the first and final selected rows by column", () => {
    expect(terminalSelectedTextFromBuffer({
      getLine: (row) => ({
        isWrapped: row === 1,
        text: row === 0 ? "0123456789" : "abcdefghij",
      }),
      selection: { start: { column: 3, row: 0 }, end: { column: 4, row: 1 } },
    })).toBe("3456789abcd");
  });
});
