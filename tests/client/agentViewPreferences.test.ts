import { describe, expect, test } from "vitest";
import {
  loadAgentViewMode,
  loadRichAgentOutputMode,
  saveAgentViewMode,
  saveRichAgentOutputMode,
} from "../../src/client/agentViewPreferences.js";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("agent view preferences", () => {
  test("persists the terminal/rich view and screen/log tab", () => {
    const store = storage();

    saveAgentViewMode("rich", store);
    saveRichAgentOutputMode("screen", store);

    expect(loadAgentViewMode(store)).toBe("rich");
    expect(loadRichAgentOutputMode(store)).toBe("screen");
  });

  test("uses safe defaults for missing or invalid preferences", () => {
    const store = storage({
      "farbench-agent-view-mode": "unknown",
      "farbench-rich-agent-output-mode": "unknown",
    });

    expect(loadAgentViewMode(store)).toBe("terminal");
    expect(loadRichAgentOutputMode(store)).toBe("screen");
  });

  test("tolerates unavailable browser storage", () => {
    const unavailable = {
      getItem: () => { throw new Error("unavailable"); },
      setItem: () => { throw new Error("unavailable"); },
    };

    expect(() => saveAgentViewMode("rich", unavailable)).not.toThrow();
    expect(() => saveRichAgentOutputMode("screen", unavailable)).not.toThrow();
    expect(loadAgentViewMode(unavailable)).toBe("terminal");
    expect(loadRichAgentOutputMode(unavailable)).toBe("screen");
  });
});
