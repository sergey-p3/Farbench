import { describe, expect, test, vi } from "vitest";
import { createTerminalDebugLogger, terminalDebugEnabled } from "../../src/client/terminalDebug.js";

describe("terminalDebug", () => {
  test("is enabled by local storage or query flags", () => {
    expect(terminalDebugEnabled(fakeStorage({ remoteDevTerminalDebug: "1" }), "")).toBe(true);
    expect(terminalDebugEnabled(fakeStorage({ remoteDevTerminalDebug: "true" }), "")).toBe(true);
    expect(terminalDebugEnabled(fakeStorage(), "?terminalDebug=1")).toBe(true);
    expect(terminalDebugEnabled(fakeStorage(), "?remoteDevTerminalDebug=true")).toBe(true);
    expect(terminalDebugEnabled(fakeStorage({ remoteDevTerminalDebug: "0" }), "")).toBe(false);
    expect(terminalDebugEnabled(fakeStorage(), "")).toBe(false);
  });

  test("logs structured terminal events only when enabled", () => {
    const info = vi.fn();
    const enabled = createTerminalDebugLogger(
      { component: "TerminalPane", instanceId: 7, sessionId: "session-1" },
      { consoleLike: { info }, enabled: true, now: () => "2026-07-02T12:00:00.000Z" },
    );
    const disabled = createTerminalDebugLogger(
      { component: "TerminalPane", instanceId: 8 },
      { consoleLike: { info }, enabled: false, now: () => "2026-07-02T12:00:00.000Z" },
    );

    enabled("socket.open", { readyState: "open" });
    disabled("socket.close", { readyState: "closed" });

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("[farbench terminal]", {
      component: "TerminalPane",
      event: "socket.open",
      instanceId: 7,
      readyState: "open",
      sessionId: "session-1",
      timestamp: "2026-07-02T12:00:00.000Z",
    });
  });
});

function fakeStorage(values: Record<string, string> = {}): Pick<Storage, "getItem"> {
  return {
    getItem(key: string) {
      return values[key] ?? null;
    },
  };
}
