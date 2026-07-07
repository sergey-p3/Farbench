import { describe, expect, test } from "vitest";
import { createTerminalGestureOwner } from "../../src/client/terminalGestureOwner.js";

describe("terminal gesture owner", () => {
  test("gives pointer drags ownership over duplicate touch events after pointer movement starts", () => {
    const owner = createTerminalGestureOwner();

    expect(owner.beginPointer(7)).toBe(true);
    expect(owner.notePointerMoved(7)).toBe(true);
    expect(owner.beginTouch()).toBe(false);
    expect(owner.canMovePointer(7)).toBe(true);
    expect(owner.canMoveTouch()).toBe(false);

    owner.endPointer(7);

    expect(owner.beginTouch()).toBe(true);
    expect(owner.canMoveTouch()).toBe(true);
  });

  test("keeps touch fallback active when no pointer drag owns the gesture", () => {
    const owner = createTerminalGestureOwner();

    expect(owner.beginTouch()).toBe(true);
    expect(owner.canMoveTouch()).toBe(true);
    expect(owner.beginPointer(3)).toBe(false);
    expect(owner.canMovePointer(3)).toBe(false);

    owner.endTouch();

    expect(owner.beginPointer(3)).toBe(true);
    expect(owner.canMovePointer(3)).toBe(true);
  });

  test("keeps pending pointer ownership when touch fallback starts before movement", () => {
    const owner = createTerminalGestureOwner();

    expect(owner.beginPointer(7)).toBe(true);
    expect(owner.beginTouch()).toBe(true);
    expect(owner.canMovePointer(7)).toBe(true);
    expect(owner.canMoveTouch()).toBe(false);
  });

  test("allows touch fallback to take over on touch movement before pointer movement starts", () => {
    const owner = createTerminalGestureOwner();

    expect(owner.beginPointer(7)).toBe(true);
    expect(owner.beginTouch()).toBe(true);
    expect(owner.claimTouchMove()).toBe(true);
    expect(owner.canMovePointer(7)).toBe(false);
    expect(owner.canMoveTouch()).toBe(true);
  });
});
