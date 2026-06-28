export type GitDiffMode = "side-by-side" | "line-by-line";
export type GitDiffCopyStatus = "idle" | "copied" | "failed";
export { copyTextToClipboard } from "./clipboard.js";

interface NewLineSelection {
  currentContent: string;
  lineNumber: number | null;
  modifiedLineCount: number;
  modifiedFocused: boolean;
}

const narrowDiffWidthPx = 760;
const mobileGitPanelWidthPx = 760;

export function defaultGitDiffMode(widthPx: number): GitDiffMode {
  return widthPx <= narrowDiffWidthPx ? "line-by-line" : "side-by-side";
}

export function shouldCollapseGitFileList(widthPx: number, selectedPath: string | null): boolean {
  return widthPx <= mobileGitPanelWidthPx && selectedPath !== null;
}

export function nextDiffFileIndex(
  changes: Array<{ path: string; diffAvailable: boolean }>,
  selectedPath: string | null,
  direction: 1 | -1 = 1,
): number | null {
  const diffableChanges = changes
    .map((change, index) => ({ change, index }))
    .filter(({ change }) => change.diffAvailable);
  if (diffableChanges.length === 0) return null;

  const currentDiffableIndex = diffableChanges.findIndex(({ change }) => change.path === selectedPath);
  const startIndex = currentDiffableIndex === -1 ? (direction === 1 ? -1 : 0) : currentDiffableIndex;
  const nextIndex = (startIndex + direction + diffableChanges.length) % diffableChanges.length;
  return diffableChanges[nextIndex].index;
}

export function changedNewLinesFromPatch(patch: string): number[] {
  const changedLines: number[] = [];
  let newLineNumber: number | null = null;

  for (const line of patch.split("\n")) {
    const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunkMatch) {
      newLineNumber = Number(hunkMatch[1]);
      continue;
    }
    if (newLineNumber === null) continue;
    if (line.startsWith("+++")) continue;
    if (line.startsWith("+")) {
      changedLines.push(newLineNumber);
      newLineNumber += 1;
      continue;
    }
    if (line.startsWith("-")) continue;
    newLineNumber += 1;
  }

  return changedLines;
}

export function changedNewLineBlocksFromPatch(patch: string): number[] {
  const changedBlocks: number[] = [];
  let newLineNumber: number | null = null;
  let currentBlockStart: number | null = null;

  function closeCurrentBlock() {
    if (currentBlockStart !== null) changedBlocks.push(currentBlockStart);
    currentBlockStart = null;
  }

  for (const line of patch.split("\n")) {
    const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunkMatch) {
      closeCurrentBlock();
      newLineNumber = Number(hunkMatch[1]);
      continue;
    }
    if (newLineNumber === null) continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;

    if (line.startsWith("+")) {
      currentBlockStart ??= newLineNumber;
      newLineNumber += 1;
      continue;
    }
    if (line.startsWith("-")) {
      currentBlockStart ??= newLineNumber;
      continue;
    }

    closeCurrentBlock();
    newLineNumber += 1;
  }

  closeCurrentBlock();
  return changedBlocks;
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

export function diffEditorOptionsForMode(mode: GitDiffMode) {
  return {
    renderSideBySide: mode === "side-by-side",
    renderSideBySideInlineBreakpoint: 0,
    useInlineViewWhenSpaceIsLimited: false,
  };
}
