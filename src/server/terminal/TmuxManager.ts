import { spawn, spawnSync } from "node:child_process";
import { nanoid } from "nanoid";
import * as pty from "node-pty";
import type { SessionType } from "../../shared/types.js";

export class TmuxManager {
  assertAvailable(): void {
    const result = spawnSync("tmux", ["-V"], { stdio: "ignore" });
    if (result.error || result.status !== 0) {
      throw new Error("tmux is required");
    }
  }

  commandFor(type: SessionType): string {
    if (type === "codex") return "codex";
    if (type === "claude") return "claude";
    return process.env.SHELL ?? "bash";
  }

  async create(rootPath: string, type: SessionType): Promise<string> {
    this.assertAvailable();
    const tmuxName = `remote_dev_${nanoid(10)}`;
    await runTmux(["new-session", "-d", "-s", tmuxName, "-c", rootPath, this.commandFor(type)]);
    return tmuxName;
  }

  attach(tmuxName: string, cols: number, rows: number): pty.IPty {
    return pty.spawn("tmux", ["attach-session", "-t", tmuxName], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: process.cwd(),
      env: process.env,
    });
  }

  capture(tmuxName: string): Promise<string> {
    return runTmux(["capture-pane", "-p", "-S", "-2000", "-t", tmuxName]);
  }

  async kill(tmuxName: string): Promise<void> {
    await runTmux(["kill-session", "-t", tmuxName]);
  }
}

function runTmux(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("tmux", args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
        return;
      }

      const errorOutput = Buffer.concat(stderr).toString("utf8").trim();
      reject(new Error(errorOutput || `tmux exited with code ${code ?? "unknown"}`));
    });
  });
}
