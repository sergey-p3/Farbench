import type { Terminal } from "xterm";

export interface RichTerminalTextStyle {
  backgroundColor?: string;
  color?: string;
  fontStyle?: "italic";
  fontWeight?: 700;
  opacity?: number;
  textDecoration?: string;
}

export interface RichTerminalChunk {
  style?: RichTerminalTextStyle;
  text: string;
}

export interface RichTerminalLine {
  chunks: RichTerminalChunk[];
}

export type RichTerminalOutput = RichTerminalLine[];

const MAX_RICH_OUTPUT_LINES = 4_000;
const DEFAULT_FOREGROUND = "#d7dee8";
const DEFAULT_BACKGROUND = "#101820";
const ANSI_COLORS = [
  "#101820", "#df6b72", "#72c69c", "#d8bd73", "#73a8dd", "#bd8bd2", "#68bdc7", "#d7dee8",
  "#647486", "#f08389", "#8cdbb2", "#ead083", "#8fbeec", "#d2a0e5", "#84d3dd", "#f7f9fb",
] as const;

/** Converts xterm's parsed buffer into safe, selectable styled text. */
export function richTerminalOutput(terminal: Pick<Terminal, "buffer" | "cols">): RichTerminalOutput {
  const buffer = terminal.buffer.active;
  const startLine = Math.max(0, buffer.length - MAX_RICH_OUTPUT_LINES);
  const output: RichTerminalOutput = [];
  const reusableCell = buffer.getNullCell();

  for (let y = startLine; y < buffer.length; y += 1) {
    const line = buffer.getLine(y);
    if (!line) continue;
    const chunks: Array<RichTerminalChunk & { signature: string }> = [];
    const maxColumn = Math.min(line.length, terminal.cols);

    for (let x = 0; x < maxColumn; x += 1) {
      const cell = line.getCell(x, reusableCell);
      if (!cell || cell.getWidth() === 0) continue;
      const style = cellStyle(cell);
      const signature = styleSignature(cell);
      const text = cell.isInvisible() ? " " : cell.getChars() || " ";
      const previous = chunks.at(-1);
      if (previous?.signature === signature) previous.text += text;
      else chunks.push({ signature, style, text });
    }

    trimUnstyledTrailingSpaces(chunks);
    output.push({ chunks: chunks.map(({ signature: _signature, ...chunk }) => chunk) });
  }

  while (output.length > 1 && output.at(-1)?.chunks.length === 0) output.pop();
  return output;
}

function trimUnstyledTrailingSpaces(chunks: Array<RichTerminalChunk & { signature: string }>): void {
  while (chunks.length > 0) {
    const last = chunks.at(-1);
    if (!last || last.style?.backgroundColor || !last.text.endsWith(" ")) return;
    last.text = last.text.replace(/ +$/, "");
    if (last.text) return;
    chunks.pop();
  }
}

function styleSignature(cell: ReturnType<Terminal["buffer"]["active"]["getNullCell"]>): string {
  return [
    cell.getFgColorMode(), cell.getFgColor(), cell.getBgColorMode(), cell.getBgColor(),
    cell.isBold(), cell.isItalic(), cell.isDim(), cell.isUnderline(), cell.isInverse(),
    cell.isInvisible(), cell.isStrikethrough(), cell.isOverline(),
  ].join(":");
}

function cellStyle(cell: ReturnType<Terminal["buffer"]["active"]["getNullCell"]>): RichTerminalTextStyle | undefined {
  let foreground = cellColor(cell, "foreground");
  let background = cellColor(cell, "background");
  if (cell.isInverse()) [foreground, background] = [background ?? DEFAULT_BACKGROUND, foreground ?? DEFAULT_FOREGROUND];

  const decorations: string[] = [];
  if (cell.isUnderline()) decorations.push("underline");
  if (cell.isStrikethrough()) decorations.push("line-through");
  if (cell.isOverline()) decorations.push("overline");

  const style: RichTerminalTextStyle = {};
  if (foreground) style.color = foreground;
  if (background) style.backgroundColor = background;
  if (cell.isBold()) style.fontWeight = 700;
  if (cell.isItalic()) style.fontStyle = "italic";
  if (cell.isDim()) style.opacity = 0.62;
  if (decorations.length) style.textDecoration = decorations.join(" ");
  return Object.keys(style).length ? style : undefined;
}

function cellColor(
  cell: ReturnType<Terminal["buffer"]["active"]["getNullCell"]>,
  kind: "background" | "foreground",
): string | undefined {
  const isDefault = kind === "foreground" ? cell.isFgDefault() : cell.isBgDefault();
  if (isDefault) return undefined;
  const isRgb = kind === "foreground" ? cell.isFgRGB() : cell.isBgRGB();
  const value = kind === "foreground" ? cell.getFgColor() : cell.getBgColor();
  if (isRgb) return `#${value.toString(16).padStart(6, "0")}`;
  return ansiColor(value);
}

function ansiColor(index: number): string {
  if (index < ANSI_COLORS.length) return ANSI_COLORS[index] ?? DEFAULT_FOREGROUND;
  if (index >= 232) {
    const shade = 8 + (index - 232) * 10;
    return `rgb(${shade} ${shade} ${shade})`;
  }
  const paletteIndex = index - 16;
  const red = Math.floor(paletteIndex / 36);
  const green = Math.floor((paletteIndex % 36) / 6);
  const blue = paletteIndex % 6;
  const component = (value: number) => value === 0 ? 0 : 55 + value * 40;
  return `rgb(${component(red)} ${component(green)} ${component(blue)})`;
}
