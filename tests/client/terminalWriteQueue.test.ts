import { describe, expect, test } from "vitest";
import {
  createTerminalWriteQueue,
  terminalHistoryReplay,
  type TerminalWriteTarget,
} from "../../src/client/terminalWriteQueue.js";

describe("terminal write queue", () => {
  test("replaces content only after earlier writes finish", async () => {
    const operations: string[] = [];
    const callbacks: Array<() => void> = [];
    const target: TerminalWriteTarget = {
      reset() {
        operations.push("reset");
      },
      write(data, callback) {
        operations.push(`write:${data}`);
        if (callback) callbacks.push(callback);
      },
    };
    const queue = createTerminalWriteQueue(target);

    queue.write("cached screen");
    queue.replace("live screen");
    await Promise.resolve();

    expect(operations).toEqual(["write:cached screen"]);
    callbacks.shift()?.();

    await expect.poll(() => operations).toEqual(["write:cached screen", "reset", "write:live screen"]);
    callbacks.shift()?.();
    await queue.flush();
  });

  test("serializes appends after a replacement", async () => {
    const operations: string[] = [];
    const callbacks: Array<() => void> = [];
    const target: TerminalWriteTarget = {
      reset() {
        operations.push("reset");
      },
      write(data, callback) {
        operations.push(`write:${data}`);
        if (callback) callbacks.push(callback);
      },
    };
    const queue = createTerminalWriteQueue(target);

    queue.replace("history");
    queue.write("output");
    await Promise.resolve();

    expect(operations).toEqual(["reset", "write:history"]);
    callbacks.shift()?.();

    await expect.poll(() => operations).toEqual(["reset", "write:history", "write:output"]);
    callbacks.shift()?.();
    await queue.flush();
  });

  test("moves captured history above the live terminal screen", () => {
    expect(terminalHistoryReplay("old output\n", 3)).toBe("old output\n\r\n\r\n\r\n");
    expect(terminalHistoryReplay("", 3)).toBe("");
    expect(terminalHistoryReplay("old output", -1)).toBe("old output");
  });
});
