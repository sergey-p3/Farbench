import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export interface ResolvedWorkspacePath {
  absolutePath: string;
  relativePath: string;
}

function assertInsideWorkspace(rootRealPath: string, absolutePath: string): void {
  const pathRelativeToRoot = relative(rootRealPath, absolutePath);
  if (pathRelativeToRoot === "") return;
  if (pathRelativeToRoot.startsWith("..") || isAbsolute(pathRelativeToRoot)) {
    throw new Error("Path escapes workspace");
  }
}

function nearestExistingPath(absolutePath: string): string {
  let current = absolutePath;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

export function resolveWorkspacePath(rootPath: string, requestedPath: string): ResolvedWorkspacePath {
  const rootRealPath = realpathSync(rootPath);
  const lexicalAbsolutePath = resolve(rootRealPath, requestedPath);
  assertInsideWorkspace(rootRealPath, lexicalAbsolutePath);

  const existingPath = nearestExistingPath(lexicalAbsolutePath);
  const existingRealPath = realpathSync(existingPath);
  assertInsideWorkspace(rootRealPath, existingRealPath);

  const missingSuffix = relative(existingPath, lexicalAbsolutePath);
  const absolutePath = missingSuffix === "" ? existingRealPath : resolve(existingRealPath, missingSuffix);
  assertInsideWorkspace(rootRealPath, absolutePath);

  return {
    absolutePath,
    relativePath: relative(rootRealPath, absolutePath),
  };
}
