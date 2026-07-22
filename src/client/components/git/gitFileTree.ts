import type { DisplayedChange } from "./gitPanelTypes.js";

export interface GitFileTreeDirectory {
  children: GitFileTreeNode[];
  name: string;
  path: string;
  type: "directory";
}

export interface GitFileTreeFile {
  change: DisplayedChange;
  name: string;
  path: string;
  type: "file";
}

export type GitFileTreeNode = GitFileTreeDirectory | GitFileTreeFile;

interface MutableDirectory {
  children: Map<string, MutableNode>;
  name: string;
  path: string;
  type: "directory";
}

type MutableNode = MutableDirectory | GitFileTreeFile;

export function buildGitFileTree(changes: DisplayedChange[]): GitFileTreeNode[] {
  const root: MutableDirectory = { children: new Map(), name: "", path: "", type: "directory" };

  for (const change of changes) {
    const parts = change.path.split("/");
    const fileName = parts.pop() ?? change.path;
    let directory = root;

    for (const part of parts) {
      const path = directory.path ? `${directory.path}/${part}` : part;
      const key = `directory:${part}`;
      const existing = directory.children.get(key);
      if (existing?.type === "directory") {
        directory = existing;
        continue;
      }

      const child: MutableDirectory = { children: new Map(), name: part, path, type: "directory" };
      directory.children.set(key, child);
      directory = child;
    }

    directory.children.set(`file:${fileName}`, {
      change,
      name: fileName,
      path: change.path,
      type: "file",
    });
  }

  return freezeChildren(root);
}

function freezeChildren(directory: MutableDirectory): GitFileTreeNode[] {
  return [...directory.children.values()]
    .sort((left, right) => {
      if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
      return left.name.localeCompare(right.name);
    })
    .map((node) => node.type === "file" ? node : { ...node, children: freezeChildren(node) });
}
