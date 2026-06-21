import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAgent } from "../../src/server/agent/LocalAgent.js";

let root: string | null = null;
let outsideRoot: string | null = null;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  if (outsideRoot) rmSync(outsideRoot, { recursive: true, force: true });
  root = null;
  outsideRoot = null;
});

describe("LocalAgent files", () => {
  class RacingLocalAgent extends LocalAgent {
    racePath: string | null = null;
    replacementPath: string | null = null;
    symlinkTargetPath: string | null = null;

    protected async beforeWriteOpen(): Promise<void> {
      if (!this.racePath || !this.symlinkTargetPath) return;
      unlinkSync(this.racePath);
      symlinkSync(this.symlinkTargetPath, this.racePath);
      this.racePath = null;
      this.symlinkTargetPath = null;
    }

    protected async beforeWriteVersionCheck(): Promise<void> {
      if (this.symlinkTargetPath) return;

      if (this.replacementPath) {
        renameSync(this.replacementPath, this.racePath ?? this.replacementPath);
        this.racePath = null;
        this.replacementPath = null;
        return;
      }

      if (!this.racePath) return;
      writeFileSync(this.racePath, "changed during write");
      this.racePath = null;
    }
  }

  it("marks directories as not writable and files as writable when listing files", async () => {
    root = mkdtempSync(join(tmpdir(), "remote-dev-files-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "note.txt"), "first");
    const agent = new LocalAgent();

    const resources = await agent.listFiles(root, "");

    expect(resources).toEqual([
      expect.objectContaining({ path: "src", type: "directory", canWrite: false }),
      expect.objectContaining({ path: "note.txt", type: "file", canWrite: true }),
    ]);
  });

  it("lists internal symlinks by link name while enforcing workspace boundaries", async () => {
    root = mkdtempSync(join(tmpdir(), "remote-dev-files-"));
    writeFileSync(join(root, "actual.txt"), "first");
    symlinkSync("actual.txt", join(root, "alias.txt"));
    const agent = new LocalAgent();

    const resources = await agent.listFiles(root, "");

    expect(resources.map((resource) => resource.path)).toEqual(["actual.txt", "alias.txt"]);
    expect(resources).toContainEqual(expect.objectContaining({ path: "alias.txt", type: "file" }));
  });

  it("lists symlink directory children under the requested logical path", async () => {
    root = mkdtempSync(join(tmpdir(), "remote-dev-files-"));
    mkdirSync(join(root, "real"));
    writeFileSync(join(root, "real", "child.txt"), "first");
    symlinkSync("real", join(root, "alias"));
    const agent = new LocalAgent();

    const resources = await agent.listFiles(root, "alias");

    expect(resources).toEqual([
      expect.objectContaining({ path: "alias/child.txt", type: "file" }),
    ]);
  });

  it("keeps internal symlink names in read and write responses", async () => {
    root = mkdtempSync(join(tmpdir(), "remote-dev-files-"));
    writeFileSync(join(root, "actual.txt"), "first");
    symlinkSync("actual.txt", join(root, "alias.txt"));
    const agent = new LocalAgent();

    const read = await agent.readFile({ rootPath: root, path: "alias.txt" });
    const written = await agent.writeFile({
      rootPath: root,
      path: "alias.txt",
      content: "browser edit",
      expectedVersion: read.version,
    });

    expect(read.resource.path).toBe("alias.txt");
    expect(written.resource.path).toBe("alias.txt");
    expect(readFileSync(join(root, "actual.txt"), "utf8")).toBe("browser edit");
  });

  it("rejects an intervening write during save without overwriting it", async () => {
    root = mkdtempSync(join(tmpdir(), "remote-dev-files-"));
    const path = join(root, "note.txt");
    writeFileSync(path, "first");
    const agent = new RacingLocalAgent();
    const read = await agent.readFile({ rootPath: root, path: "note.txt" });
    agent.racePath = path;

    await expect(
      agent.writeFile({
        rootPath: root,
        path: "note.txt",
        content: "browser edit",
        expectedVersion: read.version,
      }),
    ).rejects.toThrow("File changed on disk");
    expect(readFileSync(path, "utf8")).toBe("changed during write");
  });

  it("rejects when the requested path is replaced during save", async () => {
    root = mkdtempSync(join(tmpdir(), "remote-dev-files-"));
    const path = join(root, "note.txt");
    const replacementPath = join(root, "replacement.txt");
    writeFileSync(path, "first");
    writeFileSync(replacementPath, "replacement content");
    const agent = new RacingLocalAgent();
    const read = await agent.readFile({ rootPath: root, path: "note.txt" });
    agent.racePath = path;
    agent.replacementPath = replacementPath;

    await expect(
      agent.writeFile({
        rootPath: root,
        path: "note.txt",
        content: "browser edit",
        expectedVersion: read.version,
      }),
    ).rejects.toThrow("File changed on disk");
    expect(readFileSync(path, "utf8")).toBe("replacement content");
  });

  it("rejects when the checked path is swapped to an outside symlink before open", async () => {
    root = mkdtempSync(join(tmpdir(), "remote-dev-files-"));
    outsideRoot = mkdtempSync(join(tmpdir(), "remote-dev-outside-"));
    const path = join(root, "note.txt");
    const outsidePath = join(outsideRoot, "note.txt");
    writeFileSync(path, "first");
    const agent = new RacingLocalAgent();
    const read = await agent.readFile({ rootPath: root, path: "note.txt" });
    const originalStats = statSync(path);
    writeFileSync(outsidePath, "first");
    utimesSync(outsidePath, originalStats.atime, originalStats.mtime);
    agent.racePath = path;
    agent.symlinkTargetPath = outsidePath;

    await expect(
      agent.writeFile({
        rootPath: root,
        path: "note.txt",
        content: "browser edit",
        expectedVersion: read.version,
      }),
    ).rejects.toThrow("File changed on disk");
    expect(readFileSync(outsidePath, "utf8")).toBe("first");
  });

  it("serializes concurrent saves with the same expected version", async () => {
    root = mkdtempSync(join(tmpdir(), "remote-dev-files-"));
    const path = join(root, "note.txt");
    writeFileSync(path, "first");
    const agent = new LocalAgent();
    const read = await agent.readFile({ rootPath: root, path: "note.txt" });

    const results = await Promise.allSettled([
      agent.writeFile({
        rootPath: root,
        path: "note.txt",
        content: "browser edit 1",
        expectedVersion: read.version,
      }),
      agent.writeFile({
        rootPath: root,
        path: "note.txt",
        content: "browser edit 2",
        expectedVersion: read.version,
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toEqual(expect.objectContaining({ reason: expect.any(Error) }));
    expect((rejected[0] as PromiseRejectedResult).reason.message).toBe("File changed on disk");
    expect(["browser edit 1", "browser edit 2"]).toContain(readFileSync(path, "utf8"));
  });

  it("marks invalid utf8 files as binary and rejects reading them", async () => {
    root = mkdtempSync(join(tmpdir(), "remote-dev-files-"));
    writeFileSync(join(root, "invalid.bin"), Buffer.from([0xc3, 0x28]));
    const agent = new LocalAgent();

    await expect(agent.readFile({ rootPath: root, path: "invalid.bin" })).rejects.toThrow("Binary files cannot be edited");
    await expect(agent.listFiles(root, "")).resolves.toEqual([
      expect.objectContaining({ path: "invalid.bin", isBinary: true }),
    ]);
  });

  it("blocks save when file version changed after read", async () => {
    root = mkdtempSync(join(tmpdir(), "remote-dev-files-"));
    const path = join(root, "note.txt");
    writeFileSync(path, "first");
    const agent = new LocalAgent();
    const read = await agent.readFile({ rootPath: root, path: "note.txt" });

    writeFileSync(path, "changed elsewhere");

    await expect(
      agent.writeFile({
        rootPath: root,
        path: "note.txt",
        content: "browser edit",
        expectedVersion: read.version,
      }),
    ).rejects.toThrow("File changed on disk");
  });
});
