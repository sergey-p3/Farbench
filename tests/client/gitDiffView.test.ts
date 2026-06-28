import { describe, expect, test, vi } from "vitest";
import {
  changedNewLineBlocksFromPatch,
  changedNewLinesFromPatch,
  copyPayloadForGitLine,
  copyStatusLabel,
  copyTextToClipboard,
  defaultGitDiffMode,
  diffEditorOptionsForMode,
  nextDiffFileIndex,
  shouldCollapseGitFileList,
  validSelectedNewLine,
} from "../../src/client/gitDiffView.js";

describe("git diff view helpers", () => {
  test("defaults wide containers to side-by-side and narrow containers to line-by-line", () => {
    expect(defaultGitDiffMode(900)).toBe("side-by-side");
    expect(defaultGitDiffMode(620)).toBe("line-by-line");
  });

  test("copies path and line when a new-file line is selected", () => {
    expect(copyPayloadForGitLine("src/app.ts", 42)).toBe("src/app.ts:42");
  });

  test("falls back to path when no new-file line is available", () => {
    expect(copyPayloadForGitLine("src/app.ts", null)).toBe("src/app.ts");
    expect(copyPayloadForGitLine("src/app.ts", 0)).toBe("src/app.ts");
  });

  test("only accepts selected lines from focused current-file content", () => {
    expect(validSelectedNewLine({ currentContent: "one\ntwo", lineNumber: 2, modifiedLineCount: 2, modifiedFocused: true })).toBe(2);
    expect(validSelectedNewLine({ currentContent: "one\ntwo", lineNumber: 1, modifiedLineCount: 2, modifiedFocused: false })).toBeNull();
    expect(validSelectedNewLine({ currentContent: "", lineNumber: 1, modifiedLineCount: 1, modifiedFocused: true })).toBeNull();
    expect(validSelectedNewLine({ currentContent: "one", lineNumber: 2, modifiedLineCount: 1, modifiedFocused: true })).toBeNull();
    expect(validSelectedNewLine({ currentContent: "one", lineNumber: null, modifiedLineCount: 1, modifiedFocused: true })).toBeNull();
  });

  test("labels copy status without extra explanatory UI", () => {
    expect(copyStatusLabel("idle")).toBe("Copy location");
    expect(copyStatusLabel("copied")).toBe("Copied");
    expect(copyStatusLabel("failed")).toBe("Copy failed");
  });

  test("forces side-by-side mode even when Monaco has limited width", () => {
    expect(diffEditorOptionsForMode("side-by-side")).toMatchObject({
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: false,
      renderSideBySideInlineBreakpoint: 0,
    });
    expect(diffEditorOptionsForMode("line-by-line")).toMatchObject({
      renderSideBySide: false,
    });
  });

  test("collapses the git file list on mobile only after a file is selected", () => {
    expect(shouldCollapseGitFileList(500, null)).toBe(false);
    expect(shouldCollapseGitFileList(500, "src/app.ts")).toBe(true);
    expect(shouldCollapseGitFileList(900, "src/app.ts")).toBe(false);
  });

  test("finds the next diffable file index with wrapping", () => {
    const changes = [
      { path: "a.ts", diffAvailable: true },
      { path: "b.png", diffAvailable: false },
      { path: "c.ts", diffAvailable: true },
    ];

    expect(nextDiffFileIndex(changes, "a.ts")).toBe(2);
    expect(nextDiffFileIndex(changes, "c.ts")).toBe(0);
    expect(nextDiffFileIndex(changes, null)).toBe(0);
    expect(nextDiffFileIndex(changes, "a.ts", -1)).toBe(2);
  });

  test("extracts changed new-file line numbers from unified patches", () => {
    expect(changedNewLinesFromPatch(`@@ -1,3 +1,4 @@
 unchanged
-old
+new
+another
 context
@@ -9 +10,2 @@
+later
`)).toEqual([2, 3, 10]);
  });

  test("extracts one target line per changed block from unified patches", () => {
    expect(changedNewLineBlocksFromPatch(`@@ -1,3 +1,4 @@
 unchanged
-old
+new
+another
 context
@@ -9 +10,2 @@
+later
`)).toEqual([2, 10]);
  });

  test("uses the current new-file position for deletion-only blocks", () => {
    expect(changedNewLineBlocksFromPatch(`@@ -4,3 +4,2 @@
 keep
-deleted
 next
`)).toEqual([5]);
  });

  test("copies with clipboard api when available", async () => {
    const writeText = vi.fn<[{ text: string }], Promise<void>>();
    writeText.mockResolvedValue(undefined);

    await expect(copyTextToClipboard("src/app.ts:42", {
      clipboard: { writeText: (text) => writeText({ text }) },
    })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith({ text: "src/app.ts:42" });
  });

  test("falls back to a temporary textarea when clipboard api is unavailable", async () => {
    const textarea = {
      focus: vi.fn(),
      select: vi.fn(),
      setAttribute: vi.fn(),
      style: {},
      value: "",
    };
    const body = {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    };
    const documentRef = {
      body,
      createElement: vi.fn(() => textarea),
      execCommand: vi.fn(() => true),
    } as unknown as Document;

    await expect(copyTextToClipboard("src/app.ts", { document: documentRef })).resolves.toBe(true);

    expect(textarea.value).toBe("src/app.ts");
    expect(body.appendChild).toHaveBeenCalledWith(textarea);
    expect(textarea.select).toHaveBeenCalled();
    expect(documentRef.execCommand).toHaveBeenCalledWith("copy");
    expect(body.removeChild).toHaveBeenCalledWith(textarea);
  });

  test("falls back to textarea when clipboard api rejects", async () => {
    const documentRef = {
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
      createElement: vi.fn(() => ({
        focus: vi.fn(),
        select: vi.fn(),
        setAttribute: vi.fn(),
        style: {},
        value: "",
      })),
      execCommand: vi.fn(() => true),
    } as unknown as Document;

    await expect(copyTextToClipboard("src/app.ts", {
      clipboard: { writeText: () => Promise.reject(new Error("denied")) },
      document: documentRef,
    })).resolves.toBe(true);
  });

  test("uses a copy event fallback before creating a textarea", async () => {
    let copyHandler: ((event: ClipboardEvent) => void) | null = null;
    const clipboardData = { setData: vi.fn() };
    const copyEvent = {
      clipboardData,
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;
    const documentRef = {
      addEventListener: vi.fn((_type: string, handler: EventListenerOrEventListenerObject) => {
        copyHandler = typeof handler === "function" ? handler as (event: ClipboardEvent) => void : null;
      }),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
      createElement: vi.fn(),
      execCommand: vi.fn(() => {
        copyHandler?.(copyEvent);
        return true;
      }),
      removeEventListener: vi.fn(),
    } as unknown as Document;

    await expect(copyTextToClipboard("terminal output", {
      clipboard: { writeText: () => Promise.reject(new Error("denied")) },
      document: documentRef,
    })).resolves.toBe(true);

    expect(clipboardData.setData).toHaveBeenCalledWith("text/plain", "terminal output");
    expect(copyEvent.preventDefault).toHaveBeenCalled();
    expect(documentRef.createElement).not.toHaveBeenCalled();
  });
});
