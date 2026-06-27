import { describe, expect, test, vi } from "vitest";
import { installAppViewportHeightSync } from "../../src/client/appViewport.js";

describe("app viewport sizing", () => {
  test("syncs the app viewport height from the visual viewport", () => {
    const target = new FakeViewportTarget();
    const visualViewport = new FakeVisualViewport(520);
    const windowLike = new FakeWindow(844, visualViewport);

    const cleanup = installAppViewportHeightSync(windowLike, target);

    expect(target.style.getPropertyValue("--app-viewport-height")).toBe("520px");

    visualViewport.height = 500;
    visualViewport.dispatch("resize");

    expect(target.style.getPropertyValue("--app-viewport-height")).toBe("500px");

    cleanup();
    visualViewport.height = 480;
    visualViewport.dispatch("resize");

    expect(target.style.getPropertyValue("--app-viewport-height")).toBe("500px");
  });

  test("falls back to innerHeight when visualViewport is unavailable", () => {
    const target = new FakeViewportTarget();
    const windowLike = new FakeWindow(844, undefined);

    installAppViewportHeightSync(windowLike, target);

    expect(target.style.getPropertyValue("--app-viewport-height")).toBe("844px");
  });
});

class FakeVisualViewport {
  readonly listeners = new Map<string, Set<() => void>>();

  constructor(public height: number) {}

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener));
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

class FakeViewportTarget {
  readonly style = {
    values: new Map<string, string>(),
    getPropertyValue(property: string) {
      return this.values.get(property) ?? "";
    },
    setProperty(property: string, value: string) {
      this.values.set(property, value);
    },
  };
}

class FakeWindow {
  readonly addEventListener = vi.fn();
  readonly removeEventListener = vi.fn();

  constructor(
    public innerHeight: number,
    public visualViewport?: FakeVisualViewport,
  ) {}
}
