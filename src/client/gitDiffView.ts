export type GitDiffMode = "side-by-side" | "line-by-line";
export type GitDiffCopyStatus = "idle" | "copied" | "failed";

interface NewLineSelection {
  currentContent: string;
  lineNumber: number | null;
  modifiedLineCount: number;
  modifiedFocused: boolean;
}

const narrowDiffWidthPx = 760;

export function defaultGitDiffMode(widthPx: number): GitDiffMode {
  return widthPx <= narrowDiffWidthPx ? "line-by-line" : "side-by-side";
}

export function copyPayloadForGitLine(path: string, newLineNumber: number | null): string {
  return newLineNumber && newLineNumber > 0 ? `${path}:${newLineNumber}` : path;
}

export function validSelectedNewLine({
  currentContent,
  lineNumber,
  modifiedLineCount,
  modifiedFocused,
}: NewLineSelection): number | null {
  if (!modifiedFocused || currentContent.length === 0 || lineNumber === null) return null;
  if (lineNumber < 1 || lineNumber > modifiedLineCount) return null;
  return lineNumber;
}

export function copyStatusLabel(status: GitDiffCopyStatus): string {
  if (status === "copied") return "Copied";
  if (status === "failed") return "Copy failed";
  return "Copy location";
}
