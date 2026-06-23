import { describe, expect, test } from "vitest";
import { terminalKeyboardChromeInset } from "../../src/client/terminalViewport.js";

describe("terminal viewport sizing", () => {
  test("reserves space for iPhone Safari keyboard chrome when the visual viewport is reduced", () => {
    expect(terminalKeyboardChromeInset({
      innerHeight: 844,
      maxTouchPoints: 5,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      visualViewportHeight: 520,
      visualViewportOffsetTop: 0,
    })).toBe(64);
  });

  test("does not reserve iPhone keyboard chrome space when the keyboard is closed", () => {
    expect(terminalKeyboardChromeInset({
      innerHeight: 844,
      maxTouchPoints: 5,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      visualViewportHeight: 844,
      visualViewportOffsetTop: 0,
    })).toBe(0);
  });

  test("does not reserve iPhone keyboard chrome space for non-iOS viewports", () => {
    expect(terminalKeyboardChromeInset({
      innerHeight: 844,
      maxTouchPoints: 0,
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      visualViewportHeight: 520,
      visualViewportOffsetTop: 0,
    })).toBe(0);
  });
});
