import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAgent } from "../../src/server/agent/LocalAgent.js";

let dir: string | null = null;

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("LocalAgent git integration", () => {
  it("reports tracked file changes and returns a path-scoped diff", async () => {
    dir = mkdtempSync(join(tmpdir(), "remote-dev-git-"));
    git(["init"], dir);
    git(["config", "user.email", "dev@example.com"], dir);
    git(["config", "user.name", "Dev"], dir);
    writeFileSync(join(dir, "app.txt"), "one\n");
    git(["add", "app.txt"], dir);
    git(["commit", "-m", "initial"], dir);

    writeFileSync(join(dir, "app.txt"), "two\n");

    const agent = new LocalAgent();
    const status = await agent.gitStatus(dir);
    const diff = await agent.gitDiff(dir, "app.txt");

    expect(status.changes.some((change) => change.path === "app.txt")).toBe(true);
    expect(diff).toContain("-one");
    expect(diff).toContain("+two");
  });
});
