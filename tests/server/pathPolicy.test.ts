import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveWorkspacePath } from "../../src/server/pathPolicy.js";

let root: string | null = null;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe("resolveWorkspacePath", () => {
  it("allows paths inside the workspace", () => {
    root = mkdtempSync(join(tmpdir(), "remote-dev-root-"));
    writeFileSync(join(root, "a.txt"), "hello");

    expect(resolveWorkspacePath(root, "a.txt").absolutePath).toBe(join(root, "a.txt"));
  });

  it("blocks traversal outside the workspace", () => {
    root = mkdtempSync(join(tmpdir(), "remote-dev-root-"));

    expect(() => resolveWorkspacePath(root, "../secret.txt")).toThrow("Path escapes workspace");
  });

  it("blocks symlinks that resolve outside the workspace", () => {
    root = mkdtempSync(join(tmpdir(), "remote-dev-root-"));
    const outside = mkdtempSync(join(tmpdir(), "remote-dev-outside-"));
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"));

    expect(() => resolveWorkspacePath(root, "link.txt")).toThrow("Path escapes workspace");

    rmSync(outside, { recursive: true, force: true });
  });
});
