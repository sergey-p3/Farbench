export type GitDiffMode = "side-by-side" | "line-by-line";
export type GitDiffCopyStatus = "idle" | "copied" | "failed";

interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

interface CopyEnvironment {
  clipboard?: ClipboardWriter;
  document?: Document;
}

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

export function diffEditorOptionsForMode(mode: GitDiffMode) {
  return {
    renderSideBySide: mode === "side-by-side",
    renderSideBySideInlineBreakpoint: 0,
    useInlineViewWhenSpaceIsLimited: false,
  };
}

export async function copyTextToClipboard(text: string, environment: CopyEnvironment = {}): Promise<boolean> {
  const clipboard = environment.clipboard ?? browserClipboard();
  if (clipboard) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the textarea fallback for non-secure HTTP contexts.
    }
  }

  return copyTextWithTemporaryTextarea(text, environment.document ?? browserDocument());
}

function browserClipboard(): ClipboardWriter | undefined {
  if (typeof navigator === "undefined") return undefined;
  return navigator.clipboard;
}

function browserDocument(): Document | undefined {
  if (typeof document === "undefined") return undefined;
  return document;
}

function copyTextWithTemporaryTextarea(text: string, documentRef: Document | undefined): boolean {
  if (!documentRef?.body) return false;
  const textarea = documentRef.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  documentRef.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    return documentRef.execCommand("copy");
  } finally {
    documentRef.body.removeChild(textarea);
  }
}
