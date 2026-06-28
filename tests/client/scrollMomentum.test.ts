import { describe, expect, test } from "vitest";
import { createMomentumScrollGesture } from "../../src/client/scrollMomentum.js";

function createFrameClock() {
  let now = 0;
  let nextFrame = 1;
  const frames = new Map<number, FrameRequestCallback>();

  return {
    now: () => now,
    requestAnimationFrame(callback: FrameRequestCallback) {
      const frame = nextFrame;
      nextFrame += 1;
      frames.set(frame, callback);
      return frame;
    },
    cancelAnimationFrame(frame: number) {
      frames.delete(frame);
    },
    step(ms: number) {
      now += ms;
      const callbacks = Array.from(frames.entries());
      frames.clear();
      for (const [, callback] of callbacks) {
        callback(now);
      }
    },
  };
}

describe("momentum scroll gesture", () => {
  test("treats small y changes as tap drift instead of scrolling", () => {
    const deltas: number[] = [];
    const clock = createFrameClock();
    const gesture = createMomentumScrollGesture({
      now: clock.now,
      requestAnimationFrame: clock.requestAnimationFrame,
      cancelAnimationFrame: clock.cancelAnimationFrame,
      scrollBy: (deltaY) => deltas.push(deltaY),
    });

    gesture.begin(500);
    expect(gesture.move(504)).toBe(false);
    gesture.end();
    clock.step(16);

    expect(deltas).toEqual([]);
  });

  test("continues scrolling after a fast release", () => {
    const deltas: number[] = [];
    const clock = createFrameClock();
    const gesture = createMomentumScrollGesture({
      now: clock.now,
      requestAnimationFrame: clock.requestAnimationFrame,
      cancelAnimationFrame: clock.cancelAnimationFrame,
      scrollBy: (deltaY) => deltas.push(deltaY),
    });

    gesture.begin(500);
    clock.step(16);
    expect(gesture.move(440)).toBe(true);
    clock.step(16);
    expect(gesture.move(380)).toBe(true);
    gesture.end();
    clock.step(16);
    clock.step(16);

    expect(deltas.length).toBeGreaterThan(2);
    expect(deltas.slice(0, 2)).toEqual([60, 60]);
    expect(deltas[2]).toBeGreaterThan(0);
  });

  test("scales release momentum from viewport-relative motion", () => {
    const shortDeltas: number[] = [];
    const tallDeltas: number[] = [];
    const shortClock = createFrameClock();
    const tallClock = createFrameClock();
    const shortGesture = createMomentumScrollGesture({
      now: shortClock.now,
      requestAnimationFrame: shortClock.requestAnimationFrame,
      cancelAnimationFrame: shortClock.cancelAnimationFrame,
      scrollBy: (deltaY) => shortDeltas.push(deltaY),
      viewportHeightPx: () => 400,
    });
    const tallGesture = createMomentumScrollGesture({
      now: tallClock.now,
      requestAnimationFrame: tallClock.requestAnimationFrame,
      cancelAnimationFrame: tallClock.cancelAnimationFrame,
      scrollBy: (deltaY) => tallDeltas.push(deltaY),
      viewportHeightPx: () => 800,
    });

    shortGesture.begin(500);
    tallGesture.begin(500);
    shortClock.step(16);
    tallClock.step(16);
    shortGesture.move(440);
    tallGesture.move(380);
    shortClock.step(16);
    tallClock.step(16);
    shortGesture.move(380);
    tallGesture.move(260);
    shortGesture.end();
    tallGesture.end();
    shortClock.step(16);
    tallClock.step(16);

    expect(shortDeltas.slice(0, 2)).toEqual([60, 60]);
    expect(tallDeltas.slice(0, 2)).toEqual([120, 120]);
    expect(tallDeltas[2]).toBeGreaterThan(shortDeltas[2] * 1.9);
  });

  test("does not continue scrolling after a slow release", () => {
    const deltas: number[] = [];
    const clock = createFrameClock();
    const gesture = createMomentumScrollGesture({
      now: clock.now,
      requestAnimationFrame: clock.requestAnimationFrame,
      cancelAnimationFrame: clock.cancelAnimationFrame,
      scrollBy: (deltaY) => deltas.push(deltaY),
    });

    gesture.begin(500);
    clock.step(300);
    expect(gesture.move(470)).toBe(true);
    clock.step(300);
    expect(gesture.move(440)).toBe(true);
    gesture.end();
    clock.step(16);

    expect(deltas).toEqual([30, 30]);
  });
});
