export type GitDiffMode = "side-by-side" | "line-by-line";

const narrowDiffWidthPx = 760;

export function defaultGitDiffMode(widthPx: number): GitDiffMode {
  return widthPx <= narrowDiffWidthPx ? "line-by-line" : "side-by-side";
}

export function copyPayloadForGitLine(path: string, newLineNumber: number | null): string {
  return newLineNumber && newLineNumber > 0 ? `${path}:${newLineNumber}` : path;
}
