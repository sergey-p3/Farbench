import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
