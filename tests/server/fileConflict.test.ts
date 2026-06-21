import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAgent } from "../../src/server/agent/LocalAgent.js";

let root: string | null = null;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe("LocalAgent files", () => {
  class RacingLocalAgent extends LocalAgent {
    racePath: string | null = null;

    protected async beforeWriteVersionCheck(): Promise<void> {
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
