import { describe, expect, test, vi } from "vitest";
import {
  copyPayloadForGitLine,
  copyStatusLabel,
  copyTextToClipboard,
  defaultGitDiffMode,
  diffEditorOptionsForMode,
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
});
