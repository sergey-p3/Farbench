import { describe, expect, test } from "vitest";
import { createTerminalLogCollector } from "../../src/client/terminalLog.js";

describe("terminal log collector", () => {
  test("turns redraws into appended lines and strips split ANSI sequences", () => {
    const log = createTerminalLogCollector();

    expect(log.replace("ready\r\nphase 1\r\x1b[3")).toBe("ready\nphase 1\n");
    expect(log.append("2mphase 2\x1b[0m\r\n")).toBe("ready\nphase 1\nphase 2\n");
    expect(log.append("done")).toBe("ready\nphase 1\nphase 2\ndone");
  });

  test("removes OSC metadata while preserving printable output", () => {
    const log = createTerminalLogCollector();

    log.append("before\x1b]0;secret title");
    expect(log.value()).toBe("before");
    expect(log.append("\x07after")).toBe("beforeafter");
  });

  test("removes 8-bit control sequences", () => {
    const log = createTerminalLogCollector();

    log.append("before\x9d0;secret title");
    expect(log.value()).toBe("before");
    expect(log.append("\x9cafter\x9b32mgreen\x9b0m")).toBe("beforeaftergreen");
  });

  test("replaces history and bounds retained output", () => {
    const log = createTerminalLogCollector(10);

    log.append("old output");
    expect(log.replace("123456789012")).toBe("3456789012");
    expect(log.value()).toBe("3456789012");
  });

  test("merges reconnect replay without erasing or duplicating existing history", () => {
    const log = createTerminalLogCollector();

    log.append("first\r\nsecond\r\nthird\r\n");
    expect(log.replay("second\r\nthird\r\nfourth\r\n")).toBe(
      "first\nsecond\nthird\nfourth\n",
    );
    expect(log.replay("third\r\nfourth\r\n")).toBe("first\nsecond\nthird\nfourth\n");
  });

  test("does not discard long-running output by default", () => {
    const log = createTerminalLogCollector();
    const output = "x".repeat(250_000);

    expect(log.append(output)).toHaveLength(output.length);
    expect(log.append("tail")).toBe(`${output}tail`);
  });
});
