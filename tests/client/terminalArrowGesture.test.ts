import { describe, expect, test } from "vitest";
import {
  shouldResetTerminalArrowAcceleration,
  terminalArrowRepeatDelay,
  terminalArrowVector,
} from "../../src/client/terminalArrowGesture.js";

describe("terminal arrow gesture", () => {
  test("keeps small movement inactive and selects the dominant direction outside the dead zone", () => {
    expect(terminalArrowVector(100, 100, 110, 108).direction).toBeNull();
    expect(terminalArrowVector(100, 100, 145, 115).direction).toBe("right");
    expect(terminalArrowVector(100, 100, 60, 85).direction).toBe("left");
    expect(terminalArrowVector(100, 100, 112, 55).direction).toBe("up");
    expect(terminalArrowVector(100, 100, 88, 150).direction).toBe("down");
  });

  test("repeats faster with greater distance", () => {
    const closeDelay = terminalArrowRepeatDelay(30, 0);
    const mediumDelay = terminalArrowRepeatDelay(80, 0);
    const farDelay = terminalArrowRepeatDelay(180, 0);

    expect(closeDelay).toBeGreaterThan(mediumDelay);
    expect(mediumDelay).toBeGreaterThan(farDelay);
  });

  test("repeats vertical arrows much slower than horizontal arrows", () => {
    const horizontalDelay = terminalArrowRepeatDelay(80, 2_000, "right");

    expect(terminalArrowRepeatDelay(80, 2_000, "up")).toBeGreaterThan(horizontalDelay * 2);
    expect(terminalArrowRepeatDelay(80, 2_000, "down")).toBeGreaterThan(horizontalDelay * 2);
  });

  test("accelerates over time without dropping below the minimum delay", () => {
    expect(terminalArrowRepeatDelay(80, 4_000)).toBeLessThan(terminalArrowRepeatDelay(80, 0));
    expect(terminalArrowRepeatDelay(180, 60_000)).toBeGreaterThanOrEqual(48);
  });

  test("resets acceleration only after moving significantly closer", () => {
    expect(shouldResetTerminalArrowAcceleration(130, 110)).toBe(false);
    expect(shouldResetTerminalArrowAcceleration(130, 96)).toBe(true);
    expect(shouldResetTerminalArrowAcceleration(130, 160)).toBe(false);
  });
});
