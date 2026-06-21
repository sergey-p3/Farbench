import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import { nanoid } from "nanoid";
import type { FileReadResponse, FileResource, GitStatusResponse, PortPreview } from "../../shared/types.js";
import type { AgentGateway, CreateSessionInput, WriteFileInput } from "./AgentGateway.js";
import { resolveWorkspacePath } from "../pathPolicy.js";

const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const writeLocks = new Map<string, Promise<void>>();
const noFollowReadOnlyFlags = constants.O_RDONLY | constants.O_NOFOLLOW;
const noFollowReadWriteFlags = constants.O_RDWR | constants.O_NOFOLLOW;

function isLikelyBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;

  try {
    strictUtf8Decoder.decode(buffer);
    return false;
  } catch {
    return true;
  }
}

function versionFor(buffer: Buffer, mtimeMs: number): string {
  return createHash("sha256").update(buffer).update(String(mtimeMs)).digest("hex");
}

function isSameFileIdentity(a: { dev: number; ino: number }, b: { dev: number; ino: number }): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function assertSameResolvedTarget(currentAbsolutePath: string, originalAbsolutePath: string): void {
  if (currentAbsolutePath !== originalAbsolutePath) {
    throw new Error("File changed on disk");
  }
}

async function withWriteLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = writeLocks.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  writeLocks.set(key, tail);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (writeLocks.get(key) === tail) {
      writeLocks.delete(key);
    }
  }
}

function resourceFor(
  path: string,
  stats: { isDirectory(): boolean; size: number; mtimeMs: number },
  isBinary = false,
): FileResource {
  const isDirectory = stats.isDirectory();
  return {
    path,
    type: isDirectory ? "directory" : "file",
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    isBinary,
    canWrite: !isDirectory,
  };
}

export class LocalAgent implements AgentGateway {
  async listFiles(rootPath: string, path: string): Promise<FileResource[]> {
    const resolved = resolveWorkspacePath(rootPath, path);
    const entries = await readdir(resolved.absolutePath, { withFileTypes: true });
    const resources = await Promise.all(
      entries.map(async (entry) => {
        const childPath = join(resolved.relativePath, entry.name);
        const child = resolveWorkspacePath(rootPath, childPath);
        await this.beforeListChildOpen();
        assertSameResolvedTarget(resolveWorkspacePath(rootPath, childPath).absolutePath, child.absolutePath);
        return this.readResourceMetadata(childPath, child.absolutePath);
      }),
    );

    return resources.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
  }

  async readFile(input: { rootPath: string; path: string }): Promise<FileReadResponse> {
    const resolved = resolveWorkspacePath(input.rootPath, input.path);
    await this.beforeReadOpen();
    assertSameResolvedTarget(resolveWorkspacePath(input.rootPath, input.path).absolutePath, resolved.absolutePath);
    const handle = await this.openForRead(resolved.absolutePath);
    let stats: Stats;
    let buffer: Buffer;
    try {
      stats = await handle.stat();
      buffer = await handle.readFile();
    } finally {
      await handle.close();
    }

    if (isLikelyBinary(buffer)) {
      throw new Error("Binary files cannot be edited");
    }

    return {
      resource: resourceFor(input.path, stats, false),
      content: buffer.toString("utf8"),
      version: versionFor(buffer, stats.mtimeMs),
    };
  }

  async writeFile(input: WriteFileInput): Promise<FileReadResponse> {
    const resolved = resolveWorkspacePath(input.rootPath, input.path);
    return withWriteLock(resolved.absolutePath, async () => {
      await this.beforeWriteOpen();
      assertSameResolvedTarget(resolveWorkspacePath(input.rootPath, input.path).absolutePath, resolved.absolutePath);
      const handle = await this.openForWrite(resolved.absolutePath);
      try {
        await this.beforeWriteVersionCheck();
        const [stats, pathStats] = await Promise.all([handle.stat(), stat(resolved.absolutePath)]);
        if (!isSameFileIdentity(stats, pathStats)) {
          throw new Error("File changed on disk");
        }

        const buffer = await handle.readFile();

        if (versionFor(buffer, stats.mtimeMs) !== input.expectedVersion) {
          throw new Error("File changed on disk");
        }

        await handle.truncate(0);
        await handle.write(input.content, 0, "utf8");
      } finally {
        await handle.close();
      }

      return this.readFile({ rootPath: input.rootPath, path: input.path });
    });
  }

  protected async beforeWriteOpen(): Promise<void> {}

  protected async beforeReadOpen(): Promise<void> {}

  protected async beforeListChildOpen(): Promise<void> {}

  protected async beforeWriteVersionCheck(): Promise<void> {}

  private async readResourceMetadata(path: string, absolutePath: string): Promise<FileResource> {
    const handle = await this.openForRead(absolutePath);
    try {
      const stats = await handle.stat();
      const isBinary = stats.isDirectory() ? false : isLikelyBinary(await handle.readFile());
      return resourceFor(path, stats, isBinary);
    } finally {
      await handle.close();
    }
  }

  private async openForRead(path: string) {
    try {
      return await open(path, noFollowReadOnlyFlags);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ELOOP") {
        throw new Error("Path escapes workspace");
      }
      throw error;
    }
  }

  private async openForWrite(path: string) {
    try {
      return await open(path, noFollowReadWriteFlags);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ELOOP") {
        throw new Error("File changed on disk");
      }
      throw error;
    }
  }

  async gitStatus(_rootPath: string): Promise<GitStatusResponse> {
    return { changes: [] };
  }

  async gitDiff(_rootPath: string, _path: string): Promise<string> {
    return "";
  }

  async createTerminalSession(input: CreateSessionInput): Promise<{ tmuxName: string }> {
    return { tmuxName: `remote-dev-${input.workspaceId}-${nanoid(8)}` };
  }

  async captureScrollback(_tmuxName: string): Promise<string> {
    return "";
  }

  async killSession(_tmuxName: string): Promise<void> {}

  async createPreview(workspaceId: string, port: number): Promise<PortPreview> {
    return {
      id: nanoid(),
      workspaceId,
      port,
      pathPrefix: `/preview/${workspaceId}/${port}`,
      status: "active",
      createdAt: new Date().toISOString(),
    };
  }
}
