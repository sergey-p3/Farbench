import { describe, expect, it } from "vitest";
import type { GitChange } from "../../src/shared/types.js";
import { buildGitFileTree } from "../../src/client/components/git/gitFileTree.js";

function change(path: string): GitChange {
  return { additions: 1, deletions: 0, diffAvailable: true, path, staged: false, status: "M" };
}

describe("buildGitFileTree", () => {
  it("nests paths and sorts directories before files", () => {
    const readme = change("README.md");
    const app = change("src/client/App.tsx");
    const server = change("src/server.ts");

    expect(buildGitFileTree([server, readme, app])).toEqual([
      {
        type: "directory",
        name: "src",
        path: "src",
        children: [
          {
            type: "directory",
            name: "client",
            path: "src/client",
            children: [{ type: "file", name: "App.tsx", path: app.path, change: app }],
          },
          { type: "file", name: "server.ts", path: server.path, change: server },
        ],
      },
      { type: "file", name: "README.md", path: readme.path, change: readme },
    ]);
  });

  it("keeps file and directory nodes that share a name in a commit diff", () => {
    const oldFile = change("docs");
    const newFile = change("docs/guide.md");

    expect(buildGitFileTree([oldFile, newFile])).toEqual([
      {
        type: "directory",
        name: "docs",
        path: "docs",
        children: [{ type: "file", name: "guide.md", path: newFile.path, change: newFile }],
      },
      { type: "file", name: "docs", path: oldFile.path, change: oldFile },
    ]);
  });
});
