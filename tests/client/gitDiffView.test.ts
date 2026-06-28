import { describe, expect, test } from "vitest";
import { copyPayloadForGitLine, defaultGitDiffMode } from "../../src/client/gitDiffView.js";

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
});
