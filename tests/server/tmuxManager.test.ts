import { EventEmitter } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TERMINAL_HISTORY_LINES } from "../../src/shared/terminalHistory.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

const spawnMock = vi.mocked(spawn);
const spawnSyncMock = vi.mocked(spawnSync);

describe("TmuxManager", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    spawnSyncMock.mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);
    spawnMock.mockImplementation(() => fakeSuccessfulChild());
  });

  it("configures new sessions with the shared terminal history limit", async () => {
    const { TmuxManager } = await import("../../src/server/terminal/TmuxManager.js");
    const tmux = new TmuxManager();

    await tmux.create("/workspace", "bash");

    expect(spawnMock).toHaveBeenCalledWith(
      "tmux",
      expect.arrayContaining(["set-option", "-t", expect.stringMatching(/^remote_dev_/), "history-limit", String(TERMINAL_HISTORY_LINES)]),
      expect.any(Object),
    );
  });

  it("applies and captures the shared terminal history line count on reconnect", async () => {
    const { TmuxManager } = await import("../../src/server/terminal/TmuxManager.js");
    const tmux = new TmuxManager();

    await tmux.capture("remote_dev_test");

    expect(spawnMock).toHaveBeenCalledWith(
      "tmux",
      ["set-option", "-t", "remote_dev_test", "history-limit", String(TERMINAL_HISTORY_LINES)],
      expect.any(Object),
    );
    expect(spawnMock).toHaveBeenCalledWith(
      "tmux",
      ["capture-pane", "-p", "-S", `-${TERMINAL_HISTORY_LINES}`, "-t", "remote_dev_test"],
      expect.any(Object),
    );
  });
});

function fakeSuccessfulChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.on("newListener", (event) => {
    if (event === "close") queueMicrotask(() => child.emit("close", 0));
  });
  return child as ReturnType<typeof spawn>;
}
