import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();
const scripts = ["run.sh", "dev.sh", "test.sh", "verify.sh", "e2e.sh"];

describe("project scripts", () => {
  test.each(scripts)("%s is executable and has valid bash syntax", (scriptName) => {
    const scriptPath = join(root, "scripts", scriptName);
    const mode = statSync(scriptPath).mode;

    expect(mode & 0o111).not.toBe(0);
    execFileSync("bash", ["-n", scriptPath], { stdio: "pipe" });
  });

  test.each([
    ["run.sh", "node", "127.0.0.1", "7000", null],
    ["dev.sh", "tsx", "0.0.0.0", "9154", "dev-password"]
  ])("%s defaults to expected host, port, caller workspace, and random workspace name", (
    scriptName,
    capturedCommand,
    expectedHost,
    expectedPort,
    expectedAuthToken
  ) => {
    const tempRoot = mkdtempSync(join(tmpdir(), "remote-dev-script-"));
    const callerWorkspace = join(tempRoot, "caller-workspace");
    const binDir = join(tempRoot, "bin");
    const captureFile = join(tempRoot, "capture.txt");

    mkdirSync(callerWorkspace);
    mkdirSync(binDir);
    writeFileSync(join(binDir, "npm"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
    writeFileSync(
      join(binDir, capturedCommand),
      [
        "#!/usr/bin/env bash",
        'printf "%s\\n" "$0" "$PWD" "$@" > "$SCRIPT_CAPTURE_FILE"',
        "exit 0",
        ""
      ].join("\n"),
      { mode: 0o755 }
    );

    try {
      execFileSync(join(root, "scripts", scriptName), {
        cwd: callerWorkspace,
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
          TSX_BIN: join(binDir, "tsx"),
          SCRIPT_CAPTURE_FILE: captureFile
        },
        stdio: "pipe"
      });

      const [commandPath, executedFrom, ...args] = execFileSync("cat", [captureFile], {
        encoding: "utf8"
      }).trim().split("\n");

      expect(commandPath).toBe(join(binDir, capturedCommand));
      expect(executedFrom).toBe(root);
      if (scriptName === "dev.sh") {
        expect(args.slice(0, 10)).toEqual([
          "watch",
          "--exclude",
          ".remote-dev",
          "--exclude",
          "node_modules",
          "--exclude",
          "dist",
          "--exclude",
          "test-results",
          "src/server/cli.ts"
        ]);
        args.splice(0, 10);
      } else {
        expect(args[0]).toBe("dist/server/cli.js");
        args.splice(0, 1);
      }
      expect(args[0]).toBe("serve");
      expect(valueAfter(args, "--host")).toBe(expectedHost);
      expect(valueAfter(args, "--port")).toBe(expectedPort);
      expect(valueAfter(args, "--workspace")).toBe(callerWorkspace);
      expect(valueAfter(args, "--workspace-name")).toMatch(/^[0-9a-f]{5,8}$/);
      if (expectedAuthToken) {
        expect(valueAfter(args, "--auth-token")).toBe(expectedAuthToken);
      } else {
        expect(args).not.toContain("--auth-token");
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("dev.sh --daemon starts the hot-reload server in the background and records its pid", () => {
    const fixture = createScriptFixture();
    const runtimeDir = join(fixture.tempRoot, "runtime");

    writeFileSync(
      join(fixture.binDir, "tsx"),
      [
        "#!/usr/bin/env bash",
        'printf "%s\\n" "$0" "$PWD" "$@" > "$SCRIPT_CAPTURE_FILE"',
        "exit 0",
        ""
      ].join("\n"),
      { mode: 0o755 }
    );

    try {
      execFileSync(join(root, "scripts", "dev.sh"), ["--daemon"], {
        cwd: fixture.callerWorkspace,
        env: fixture.env(runtimeDir),
        stdio: "pipe"
      });

      const [commandPath, executedFrom, ...args] = readEventually(fixture.captureFile).trim().split("\n");
      expect(commandPath).toBe(join(fixture.binDir, "tsx"));
      expect(executedFrom).toBe(root);
      expect(args.slice(0, 10)).toEqual([
        "watch",
        "--exclude",
        ".remote-dev",
        "--exclude",
        "node_modules",
        "--exclude",
        "dist",
        "--exclude",
        "test-results",
        "src/server/cli.ts"
      ]);
      expect(readFileSync(join(runtimeDir, "dev.pid"), "utf8").trim()).toMatch(/^\d+$/);
      expect(existsSync(join(runtimeDir, "dev.log"))).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  test("dev.sh --restart stops an existing daemon before starting a new one", () => {
    const fixture = createScriptFixture();
    const runtimeDir = join(fixture.tempRoot, "runtime");
    mkdirSync(runtimeDir);
    const longRunning = execFileSync("bash", ["-c", "sleep 30 >/dev/null 2>&1 & echo $!"], { encoding: "utf8" }).trim();
    writeFileSync(join(runtimeDir, "dev.pid"), `${longRunning}\n`);

    writeFileSync(
      join(fixture.binDir, "tsx"),
      [
        "#!/usr/bin/env bash",
        'printf "%s\\n" "$0" "$PWD" "$@" > "$SCRIPT_CAPTURE_FILE"',
        "exit 0",
        ""
      ].join("\n"),
      { mode: 0o755 }
    );

    try {
      execFileSync(join(root, "scripts", "dev.sh"), ["--restart"], {
        cwd: fixture.callerWorkspace,
        env: fixture.env(runtimeDir),
        stdio: "pipe"
      });

      expect(existsSync(`/proc/${longRunning}`)).toBe(false);
      expect(readFileSync(join(runtimeDir, "dev.pid"), "utf8").trim()).toMatch(/^\d+$/);
      expect(readEventually(fixture.captureFile)).toContain("watch\n--exclude\n.remote-dev");
    } finally {
      fixture.cleanup();
    }
  });

  test("dev.sh --stop stops an existing daemon without installing dependencies", () => {
    const fixture = createScriptFixture();
    const runtimeDir = join(fixture.tempRoot, "runtime");
    mkdirSync(runtimeDir);
    const longRunning = execFileSync("bash", ["-c", "sleep 30 >/dev/null 2>&1 & echo $!"], { encoding: "utf8" }).trim();
    writeFileSync(join(runtimeDir, "dev.pid"), `${longRunning}\n`);

    try {
      execFileSync(join(root, "scripts", "dev.sh"), ["--stop"], {
        cwd: fixture.callerWorkspace,
        env: fixture.env(runtimeDir, { npmFails: true }),
        stdio: "pipe"
      });

      expect(existsSync(`/proc/${longRunning}`)).toBe(false);
      expect(existsSync(join(runtimeDir, "dev.pid"))).toBe(false);
      expect(existsSync(fixture.captureFile)).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });
});

function valueAfter(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  expect(index).toBeGreaterThanOrEqual(0);
  return args[index + 1];
}

function createScriptFixture() {
  const tempRoot = mkdtempSync(join(tmpdir(), "remote-dev-script-"));
  const callerWorkspace = join(tempRoot, "caller-workspace");
  const binDir = join(tempRoot, "bin");
  const captureFile = join(tempRoot, "capture.txt");

  mkdirSync(callerWorkspace);
  mkdirSync(binDir);
  writeFileSync(join(binDir, "npm"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });

  return {
    binDir,
    callerWorkspace,
    captureFile,
    tempRoot,
    cleanup() {
      rmSync(tempRoot, { recursive: true, force: true });
    },
    env(runtimeDir: string, options: { npmFails?: boolean } = {}) {
      if (options.npmFails) {
        writeFileSync(join(binDir, "npm"), "#!/usr/bin/env bash\nexit 99\n", { mode: 0o755 });
      }
      return {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        REMOTE_DEV_RUN_DIR: runtimeDir,
        TSX_BIN: join(binDir, "tsx"),
        SCRIPT_CAPTURE_FILE: captureFile
      };
    }
  };
}

function readEventually(path: string): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (existsSync(path)) return readFileSync(path, "utf8");
    execFileSync("sleep", ["0.05"]);
  }
  return readFileSync(path, "utf8");
}
