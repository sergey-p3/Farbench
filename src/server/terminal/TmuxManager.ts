import { spawn, spawnSync } from "node:child_process";
import { nanoid } from "nanoid";
import * as pty from "node-pty";
import type { CodexPermissionLevel, SessionType } from "../../shared/types.js";
import { TERMINAL_HISTORY_LINES } from "../../shared/terminalHistory.js";

export class TmuxManager {
  assertAvailable(): void {
    const result = spawnSync("tmux", ["-V"], { stdio: "ignore" });
    if (result.error || result.status !== 0) {
      throw new Error("tmux is required");
    }
  }

  commandFor(type: SessionType, codexPermissionLevel: CodexPermissionLevel = "workspace-write"): string[] {
    if (type === "codex") {
      const approvalPolicy = codexPermissionLevel === "danger-full-access" ? "never" : "on-request";
      return ["codex", "--sandbox", codexPermissionLevel, "--ask-for-approval", approvalPolicy];
    }
    if (type === "claude") return ["claude"];
    return [process.env.SHELL ?? "bash"];
  }

  async create(rootPath: string, type: SessionType, codexPermissionLevel?: CodexPermissionLevel): Promise<string> {
    this.assertAvailable();
    const tmuxName = `remote_dev_${nanoid(10)}`;
    await runTmux(["new-session", "-d", "-s", tmuxName, "-c", rootPath, terminalCommand(this.commandFor(type, codexPermissionLevel))], terminalEnvironment());
    await this.configureHistoryLimit(tmuxName);
    return tmuxName;
  }

  attach(tmuxName: string, cols: number, rows: number): pty.IPty {
    return pty.spawn("tmux", ["attach-session", "-t", tmuxName], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: process.cwd(),
      env: terminalEnvironment(),
    });
  }

  capture(tmuxName: string, historyOnly = false): Promise<string> {
    const captureArgs = ["capture-pane", "-p", "-S", `-${TERMINAL_HISTORY_LINES}`];
    if (historyOnly) captureArgs.push("-E", "-1");
    captureArgs.push("-t", tmuxName);
    return this.configureHistoryLimit(tmuxName).then(() =>
      runTmux(captureArgs, terminalEnvironment()),
    );
  }

  async scroll(tmuxName: string, direction: "up" | "down"): Promise<void> {
    if (direction === "up") {
      await runTmux(["copy-mode", "-u", "-t", tmuxName]);
      return;
    }
    await runTmux(["send-keys", "-t", tmuxName, "-X", "page-down"]);
  }

  async exists(tmuxName: string): Promise<boolean> {
    try {
      await runTmux(["has-session", "-t", tmuxName]);
      return true;
    } catch {
      return false;
    }
  }

  async kill(tmuxName: string): Promise<void> {
    await runTmux(["kill-session", "-t", tmuxName]);
  }

  async clientCount(tmuxName: string): Promise<number> {
    const output = await runTmux(["list-clients", "-t", tmuxName, "-F", "#{client_name}"], terminalEnvironment());
    return output.split(/\r?\n/).filter((line) => line.trim()).length;
  }

  private configureHistoryLimit(tmuxName: string): Promise<string> {
    return runTmux(["set-option", "-t", tmuxName, "history-limit", String(TERMINAL_HISTORY_LINES)], terminalEnvironment());
  }
}

function terminalEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NO_COLOR;
  env.TERM = "xterm-256color";
  env.COLORTERM = env.COLORTERM || "truecolor";
  return env;
}

function terminalCommand(command: string[]): string {
  return `stty -ixon 2>/dev/null; exec env -u NO_COLOR TERM=xterm-256color COLORTERM=${shellQuote(process.env.COLORTERM || "truecolor")} ${command.map(shellQuote).join(" ")}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function runTmux(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("tmux", args, { env, stdio: ["ignore", "pipe", "pipe"] });
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
