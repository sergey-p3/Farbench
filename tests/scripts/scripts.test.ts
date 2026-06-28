import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
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
    ["dev.sh", "npx", "0.0.0.0", "9154", "dev-password"]
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
        expect(args.slice(0, 4)).toEqual(["--no-install", "tsx", "watch", "src/server/cli.ts"]);
        args.splice(0, 4);
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
});

function valueAfter(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  expect(index).toBeGreaterThanOrEqual(0);
  return args[index + 1];
}
