import { describe, expect, test } from "vitest";
import { richTerminalOutput } from "../../src/client/richTerminalOutput.js";

type TerminalLike = Parameters<typeof richTerminalOutput>[0];
type BufferCell = ReturnType<TerminalLike["buffer"]["active"]["getNullCell"]>;

function cell(character: string, options: { bold?: boolean; foreground?: number } = {}): BufferCell {
  const foreground = options.foreground;
  return {
    getBgColor: () => 0,
    getBgColorMode: () => 0,
    getChars: () => character,
    getCode: () => character.codePointAt(0) ?? 0,
    getFgColor: () => foreground ?? 0,
    getFgColorMode: () => foreground === undefined ? 0 : 1,
    getWidth: () => 1,
    isAttributeDefault: () => foreground === undefined && !options.bold,
    isBgDefault: () => true,
    isBgPalette: () => false,
    isBgRGB: () => false,
    isBlink: () => 0,
    isBold: () => options.bold ? 1 : 0,
    isDim: () => 0,
    isFgDefault: () => foreground === undefined,
    isFgPalette: () => foreground !== undefined,
    isFgRGB: () => false,
    isInvisible: () => 0,
    isInverse: () => 0,
    isItalic: () => 0,
    isOverline: () => 0,
    isStrikethrough: () => 0,
    isUnderline: () => 0,
  };
}

describe("rich terminal output", () => {
  test("groups styled cells and removes blank screen rows", () => {
    const lines = [
      [cell("O", { bold: true, foreground: 2 }), cell("K", { bold: true, foreground: 2 }), cell("")],
      [cell(""), cell(""), cell("")],
    ];
    const terminal = {
      cols: 3,
      buffer: {
        active: {
          length: lines.length,
          getLine: (line: number) => ({
            isWrapped: false,
            length: lines[line]?.length ?? 0,
            getCell: (column: number) => lines[line]?.[column],
            translateToString: () => "",
          }),
          getNullCell: () => cell(""),
        },
      },
    } as unknown as TerminalLike;

    expect(richTerminalOutput(terminal)).toEqual([{
      chunks: [{ text: "OK", style: { color: "#72c69c", fontWeight: 700 } }],
    }]);
  });
});
