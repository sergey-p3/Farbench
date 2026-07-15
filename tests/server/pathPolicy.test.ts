import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
    root = mkdtempSync(join(tmpdir(), "farbench-root-"));
    writeFileSync(join(root, "a.txt"), "hello");

    expect(resolveWorkspacePath(root, "a.txt").absolutePath).toBe(join(root, "a.txt"));
  });

  it("allows child names that start with dot dot characters", () => {
    root = mkdtempSync(join(tmpdir(), "farbench-root-"));
    writeFileSync(join(root, "..foo"), "hello");

    expect(resolveWorkspacePath(root, "..foo").absolutePath).toBe(join(root, "..foo"));
  });

  it("allows nested child paths with names that start with dot dot characters", () => {
    root = mkdtempSync(join(tmpdir(), "farbench-root-"));
    const directory = join(root, "..data");
    mkdirSync(directory);
    writeFileSync(join(directory, "file.txt"), "hello");

    expect(resolveWorkspacePath(root, "..data/file.txt").absolutePath).toBe(join(root, "..data/file.txt"));
  });

  it("preserves the logical relative path for internal symlinks", () => {
    root = mkdtempSync(join(tmpdir(), "farbench-root-"));
    mkdirSync(join(root, "real"));
    writeFileSync(join(root, "real", "child.txt"), "hello");
    symlinkSync("real", join(root, "alias"));

    const resolved = resolveWorkspacePath(root, "alias/child.txt");

    expect(resolved.absolutePath).toBe(join(root, "real", "child.txt"));
    expect(resolved.relativePath).toBe("alias/child.txt");
  });

  it("blocks traversal outside the workspace", () => {
    root = mkdtempSync(join(tmpdir(), "farbench-root-"));

    expect(() => resolveWorkspacePath(root, "../secret.txt")).toThrow("Path escapes workspace");
  });

  it("blocks absolute paths outside the workspace", () => {
    root = mkdtempSync(join(tmpdir(), "farbench-root-"));
    const outside = mkdtempSync(join(tmpdir(), "farbench-outside-"));

    expect(() => resolveWorkspacePath(root, join(outside, "secret.txt"))).toThrow("Path escapes workspace");

    rmSync(outside, { recursive: true, force: true });
  });

  it("blocks symlinks that resolve outside the workspace", () => {
    root = mkdtempSync(join(tmpdir(), "farbench-root-"));
    const outside = mkdtempSync(join(tmpdir(), "farbench-outside-"));
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"));

    expect(() => resolveWorkspacePath(root, "link.txt")).toThrow("Path escapes workspace");

    rmSync(outside, { recursive: true, force: true });
  });
});
