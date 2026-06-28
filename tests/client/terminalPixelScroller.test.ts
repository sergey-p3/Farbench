import { describe, expect, test } from "vitest";
import { scrollTerminalViewportByPixels } from "../../src/client/terminalPixelScroller.js";

describe("terminal pixel scroller", () => {
  test("applies repeated momentum deltas directly to the viewport scroll offset", () => {
    const viewport = { scrollTop: 240 };

    scrollTerminalViewportByPixels(viewport, -18.5);
    scrollTerminalViewportByPixels(viewport, -12.25);
    scrollTerminalViewportByPixels(viewport, -8);

    expect(viewport.scrollTop).toBeCloseTo(201.25);
  });

  test("keeps sub-row deltas instead of dropping them until a row threshold", () => {
    const viewport = { scrollTop: 100 };

    scrollTerminalViewportByPixels(viewport, 2.5);

    expect(viewport.scrollTop).toBe(102.5);
  });
});
