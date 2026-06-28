import { describe, expect, test } from "vitest";
import {
  copyPayloadForGitLine,
  copyStatusLabel,
  defaultGitDiffMode,
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
});
