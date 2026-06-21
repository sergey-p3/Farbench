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
    listDirectoryPath: string | null = null;
    listDirectorySymlinkTargetPath: string | null = null;
    ancestorDirectoryPath: string | null = null;
    ancestorSymlinkTargetPath: string | null = null;
    metadataAncestorDirectoryPath: string | null = null;
    metadataAncestorSymlinkTargetPath: string | null = null;

    private swapAncestorDirectory(): void {
      if (!this.ancestorDirectoryPath || !this.ancestorSymlinkTargetPath) return;
      rmSync(this.ancestorDirectoryPath, { recursive: true, force: true });
      symlinkSync(this.ancestorSymlinkTargetPath, this.ancestorDirectoryPath);
      this.ancestorDirectoryPath = null;
      this.ancestorSymlinkTargetPath = null;
    }

    protected async beforeReadFileOpen(): Promise<void> {
      this.swapAncestorDirectory();
    }

    protected async beforeWriteFileOpen(): Promise<void> {
      this.swapAncestorDirectory();
    }

    protected async beforeListDirectoryOpen(): Promise<void> {
      this.swapAncestorDirectory();
    }

    protected async beforeListChildMetadataOpen(): Promise<void> {
      if (!this.metadataAncestorDirectoryPath || !this.metadataAncestorSymlinkTargetPath) return;
      rmSync(this.metadataAncestorDirectoryPath, { recursive: true, force: true });
      symlinkSync(this.metadataAncestorSymlinkTargetPath, this.metadataAncestorDirectoryPath);
      this.metadataAncestorDirectoryPath = null;
      this.metadataAncestorSymlinkTargetPath = null;
    }

    protected async beforeListOpen(): Promise<void> {
      if (!this.listDirectoryPath || !this.listDirectorySymlinkTargetPath) return;
      rmSync(this.listDirectoryPath, { recursive: true, force: true });
      symlinkSync(this.listDirectorySymlinkTargetPath, this.listDirectoryPath);
      this.listDirectoryPath = null;
      this.listDirectorySymlinkTargetPath = null;
    }

    protected async beforeWriteOpen(): Promise<void> {
      if (!this.racePath || !this.symlinkTargetPath) return;
      unlinkSync(this.racePath);
      symlinkSync(this.symlinkTargetPath, this.racePath);
      this.racePath = null;
      this.symlinkTargetPath = null;
    }

    protected async beforeReadOpen(): Promise<void> {
      if (!this.racePath || !this.symlinkTargetPath) return;
      unlinkSync(this.racePath);
      symlinkSync(this.symlinkTargetPath, this.racePath);
      this.racePath = null;
      this.symlinkTargetPath = null;
    }

    protected async beforeListChildOpen(): Promise<void> {
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
    ).rejects.toThrow("Path escapes workspace");
    expect(readFileSync(outsidePath, "utf8")).toBe("first");
  });

  it("rejects when a checked read path is swapped to an outside symlink", async () => {
    root = mkdtempSync(join(tmpdir(), "remote-dev-files-"));
    outsideRoot = mkdtempSync(join(tmpdir(), "remote-dev-outside-"));
    const path = join(root, "note.txt");
    const outsidePath = join(outsideRoot, "note.txt");
    writeFileSync(path, "first");
    writeFileSync(outsidePath, "outside secret");
    const agent = new RacingLocalAgent();
    agent.racePath = path;
    agent.symlinkTargetPath = outsidePath;

    await expect(agent.readFile({ rootPath: root, path: "note.txt" })).rejects.toThrow("Path escapes workspace");
  });

  it("rejects when an internal symlink read alias is swapped to an outside symlink", async () => {
    root = mkdtempSync(join(tmpdir(), "remote-dev-files-"));
    outsideRoot = mkdtempSync(join(tmpdir(), "remote-dev-outside-"));
    const actualPath = join(root, "actual.txt");
    const aliasPath = join(root, "alias.txt");
    const outsidePath = join(outsideRoot, "outside.txt");
    writeFileSync(actualPath, "inside content");
    writeFileSync(outsidePath, "outside secret");
    symlinkSync("actual.txt", aliasPath);
    const agent = new RacingLocalAgent();
    agent.racePath = aliasPath;
    agent.symlinkTargetPath = outsidePath;

    await expect(agent.readFile({ rootPath: root, path: "alias.txt" })).rejects.toThrow("Path escapes workspace");
  });

  it("rejects when an internal symlink write alias is swapped to an outside symlink before mutation", async () => {
    root = mkdtempSync(join(tmpdir(), "remote-dev-files-"));
    outsideRoot = mkdtempSync(join(tmpdir(), "remote-dev-outside-"));
    const actualPath = join(root, "actual.txt");
    const aliasPath = join(root, "alias.txt");
    const outsidePath = join(outsideRoot, "outside.txt");
    writeFileSync(actualPath, "inside content");
    writeFileSync(outsidePath, "outside content");
    symlinkSync("actual.txt", aliasPath);
    const agent = new RacingLocalAgent();
    const read = await agent.readFile({ rootPath: root, path: "alias.txt" });
    agent.racePath = aliasPath;
    agent.symlinkTargetPath = outsidePath;

    await expect(
      agent.writeFile({
        rootPath: root,
        path: "alias.txt",
        content: "browser edit",
        expectedVersion: read.version,
      }),
    ).rejects.toThrow("Path escapes workspace");
    expect(readFileSync(actualPath, "utf8")).toBe("inside content");
    expect(readFileSync(outsidePath, "utf8")).toBe("outside content");
  });

  it("rejects when a checked list child is swapped to an outside symlink", async () => {
    root = mkdtempSync(join(tmpdir(), "remote-dev-files-"));
    outsideRoot = mkdtempSync(join(tmpdir(), "remote-dev-outside-"));
    const path = join(root, "note.txt");
    const outsidePath = join(outsideRoot, "note.txt");
    writeFileSync(path, "first");
    writeFileSync(outsidePath, "outside secret");
    const agent = new RacingLocalAgent();
    agent.racePath = path;
    agent.symlinkTargetPath = outsidePath;

    await expect(agent.listFiles(root, "")).rejects.toThrow("Path escapes workspace");
  });

  it("rejects when the requested list directory is swapped to an outside symlink", async () => {
    root = mkdtempSync(join(tmpdir(), "remote-dev-files-"));
    outsideRoot = mkdtempSync(join(tmpdir(), "remote-dev-outside-"));
    const directory = join(root, "dir");
    const insideTarget = join(root, "actual.txt");
    const outsideDirectory = join(outsideRoot, "dir");
    mkdirSync(directory);
    mkdirSync(outsideDirectory);
    writeFileSync(join(directory, "child.txt"), "inside child");
    writeFileSync(insideTarget, "inside target");
    symlinkSync(insideTarget, join(outsideDirectory, "actual.txt"));
    const agent = new RacingLocalAgent();
    agent.listDirectoryPath = directory;
    agent.listDirectorySymlinkTargetPath = outsideDirectory;

    await expect(agent.listFiles(root, "dir")).rejects.toThrow("Path escapes workspace");
  });

  it("rejects when an ancestor directory is swapped before read open", async () => {
    root = mkdtempSync(join(tmpdir(), "remote-dev-files-"));
    outsideRoot = mkdtempSync(join(tmpdir(), "remote-dev-outside-"));
    const directory = join(root, "dir");
    const outsideDirectory = join(outsideRoot, "dir");
    mkdirSync(directory);
    mkdirSync(outsideDirectory);
    writeFileSync(join(directory, "note.txt"), "inside content");
    writeFileSync(join(outsideDirectory, "note.txt"), "outside secret");
    const agent = new RacingLocalAgent();
    agent.ancestorDirectoryPath = directory;
    agent.ancestorSymlinkTargetPath = outsideDirectory;

    await expect(agent.readFile({ rootPath: root, path: "dir/note.txt" })).rejects.toThrow("Path escapes workspace");
  });

  it("rejects when an ancestor directory is swapped before write open without mutating outside", async () => {
    root = mkdtempSync(join(tmpdir(), "remote-dev-files-"));
    outsideRoot = mkdtempSync(join(tmpdir(), "remote-dev-outside-"));
    const directory = join(root, "dir");
    const outsideDirectory = join(outsideRoot, "dir");
    mkdirSync(directory);
    mkdirSync(outsideDirectory);
    const insidePath = join(directory, "note.txt");
    const outsidePath = join(outsideDirectory, "note.txt");
    writeFileSync(insidePath, "same content");
    const agent = new RacingLocalAgent();
    const read = await agent.readFile({ rootPath: root, path: "dir/note.txt" });
    const originalStats = statSync(insidePath);
    writeFileSync(outsidePath, "same content");
    utimesSync(outsidePath, originalStats.atime, originalStats.mtime);
    agent.ancestorDirectoryPath = directory;
    agent.ancestorSymlinkTargetPath = outsideDirectory;

    await expect(
      agent.writeFile({
        rootPath: root,
        path: "dir/note.txt",
        content: "browser edit",
        expectedVersion: read.version,
      }),
    ).rejects.toThrow("Path escapes workspace");
    expect(readFileSync(outsidePath, "utf8")).toBe("same content");
  });

  it("rejects when an ancestor directory is swapped before directory enumeration", async () => {
    root = mkdtempSync(join(tmpdir(), "remote-dev-files-"));
    outsideRoot = mkdtempSync(join(tmpdir(), "remote-dev-outside-"));
    const directory = join(root, "dir");
    const outsideDirectory = join(outsideRoot, "dir");
    mkdirSync(directory);
    mkdirSync(outsideDirectory);
    writeFileSync(join(directory, "child.txt"), "inside child");
    writeFileSync(join(outsideDirectory, "outside.txt"), "outside child");
    const agent = new RacingLocalAgent();
    agent.ancestorDirectoryPath = directory;
    agent.ancestorSymlinkTargetPath = outsideDirectory;

    await expect(agent.listFiles(root, "dir")).rejects.toThrow("Path escapes workspace");
  });

  it("rejects when an ancestor directory is swapped before list child metadata open", async () => {
    root = mkdtempSync(join(tmpdir(), "remote-dev-files-"));
    outsideRoot = mkdtempSync(join(tmpdir(), "remote-dev-outside-"));
    const directory = join(root, "dir");
    const outsideDirectory = join(outsideRoot, "dir");
    mkdirSync(directory);
    mkdirSync(outsideDirectory);
    writeFileSync(join(directory, "child.txt"), "inside child");
    writeFileSync(join(outsideDirectory, "child.txt"), "outside child");
    const agent = new RacingLocalAgent();
    agent.metadataAncestorDirectoryPath = directory;
    agent.metadataAncestorSymlinkTargetPath = outsideDirectory;

    await expect(agent.listFiles(root, "dir")).rejects.toThrow("Path escapes workspace");
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
