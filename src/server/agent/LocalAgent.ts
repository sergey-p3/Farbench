import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants, type Dirent, type Stats } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify, TextDecoder } from "node:util";
import { nanoid } from "nanoid";
import type { FileReadResponse, FileResource, GitStatusResponse, PortPreview } from "../../shared/types.js";
import type { AgentGateway, CreateSessionInput, WriteFileInput } from "./AgentGateway.js";
import { resolveWorkspacePath } from "../pathPolicy.js";
import { TmuxManager } from "../terminal/TmuxManager.js";

const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const execFileAsync = promisify(execFile);
const writeLocks = new Map<string, Promise<void>>();
const noFollowReadOnlyFlags = constants.O_RDONLY | constants.O_NOFOLLOW;
const noFollowReadWriteFlags = constants.O_RDWR | constants.O_NOFOLLOW;
const noFollowDirectoryFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY;
const maxTextFileBytes = 1_000_000;
const binarySampleBytes = 8_192;

function isLikelyBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;

  try {
    strictUtf8Decoder.decode(buffer);
    return false;
  } catch {
    return true;
  }
}

function versionFor(buffer: Buffer, stats: { dev: number; ino: number; mtimeMs: number }): string {
  return createHash("sha256")
    .update(buffer)
    .update(String(stats.dev))
    .update(String(stats.ino))
    .update(String(stats.mtimeMs))
    .digest("hex");
}

function isSameFileIdentity(a: { dev: number; ino: number }, b: { dev: number; ino: number }): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function fileIdentityKey(stats: { dev: number; ino: number }): string {
  return `${stats.dev}:${stats.ino}`;
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
  const tooLarge = !isDirectory && stats.size > maxTextFileBytes;
  return {
    path,
    type: isDirectory ? "directory" : "file",
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    isBinary,
    canWrite: !isDirectory && !isBinary && !tooLarge,
    tooLarge,
  };
}

export class LocalAgent implements AgentGateway {
  constructor(private readonly tmux = new TmuxManager()) {}

  async listFiles(rootPath: string, path: string): Promise<FileResource[]> {
    const resolved = resolveWorkspacePath(rootPath, path);
    await this.beforeListOpen();
    assertSameResolvedTarget(resolveWorkspacePath(rootPath, path).absolutePath, resolved.absolutePath);
    await this.beforeListDirectoryOpen();
    const directoryHandle = await this.openDirectoryForList(resolved.absolutePath);
    let entries: Dirent[];
    try {
      await this.assertOpenHandleStillMatches(directoryHandle, rootPath, path, resolved.absolutePath);
      entries = await this.readDirectoryEntriesFromHandle(directoryHandle);
    } finally {
      await directoryHandle.close();
    }

    const resources = await Promise.all(
      entries.map(async (entry) => {
        const childPath = join(resolved.relativePath, entry.name);
        const child = resolveWorkspacePath(rootPath, childPath);
        await this.beforeListChildOpen();
        assertSameResolvedTarget(resolveWorkspacePath(rootPath, childPath).absolutePath, child.absolutePath);
        return this.readResourceMetadata(rootPath, childPath, child.absolutePath);
      }),
    );
    assertSameResolvedTarget(resolveWorkspacePath(rootPath, path).absolutePath, resolved.absolutePath);

    return resources.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
  }

  async readFile(input: { rootPath: string; path: string }): Promise<FileReadResponse> {
    const resolved = resolveWorkspacePath(input.rootPath, input.path);
    await this.beforeReadOpen();
    assertSameResolvedTarget(resolveWorkspacePath(input.rootPath, input.path).absolutePath, resolved.absolutePath);
    await this.beforeReadFileOpen();
    const handle = await this.openForRead(resolved.absolutePath);
    let stats: Stats;
    let buffer: Buffer;
    try {
      await this.assertOpenHandleStillMatches(handle, input.rootPath, input.path, resolved.absolutePath);
      stats = await handle.stat();
      if (stats.size > maxTextFileBytes) {
        throw new Error("File is too large to open");
      }
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
      version: versionFor(buffer, stats),
    };
  }

  async writeFile(input: WriteFileInput): Promise<FileReadResponse> {
    if (Buffer.byteLength(input.content, "utf8") > maxTextFileBytes) {
      throw new Error("File is too large to save");
    }
    const resolved = resolveWorkspacePath(input.rootPath, input.path);
    const lockKey = fileIdentityKey(await stat(resolved.absolutePath));
    return withWriteLock(lockKey, async () => {
      await this.beforeWriteOpen();
      assertSameResolvedTarget(resolveWorkspacePath(input.rootPath, input.path).absolutePath, resolved.absolutePath);
      await this.beforeWriteFileOpen();
      const handle = await this.openForWrite(resolved.absolutePath);
      try {
        await this.assertOpenHandleStillMatches(handle, input.rootPath, input.path, resolved.absolutePath);
        await this.beforeWriteVersionCheck();
        const [stats, pathStats] = await Promise.all([handle.stat(), stat(resolved.absolutePath)]);
        if (!isSameFileIdentity(stats, pathStats)) {
          throw new Error("File changed on disk");
        }
        if (stats.size > maxTextFileBytes) {
          throw new Error("File is too large to save");
        }

        const buffer = await handle.readFile();

        if (versionFor(buffer, stats) !== input.expectedVersion) {
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

  protected async beforeListOpen(): Promise<void> {}

  protected async beforeListDirectoryOpen(): Promise<void> {}

  protected async beforeReadOpen(): Promise<void> {}

  protected async beforeReadFileOpen(): Promise<void> {}

  protected async beforeWriteFileOpen(): Promise<void> {}

  protected async beforeListChildOpen(): Promise<void> {}

  protected async beforeListChildMetadataOpen(): Promise<void> {}

  protected async beforeWriteVersionCheck(): Promise<void> {}

  private async readResourceMetadata(rootPath: string, path: string, absolutePath: string): Promise<FileResource> {
    await this.beforeListChildMetadataOpen();
    const handle = await this.openForRead(absolutePath);
    try {
      await this.assertOpenHandleStillMatches(handle, rootPath, path, absolutePath);
      const stats = await handle.stat();
      const isBinary = stats.isDirectory() || stats.size > maxTextFileBytes ? false : isLikelyBinary(await this.readSample(handle, stats.size));
      return resourceFor(path, stats, isBinary);
    } finally {
      await handle.close();
    }
  }

  private async readSample(handle: { read(buffer: Buffer, offset: number, length: number, position: number): Promise<unknown> }, size: number) {
    const buffer = Buffer.alloc(Math.min(size, binarySampleBytes));
    await handle.read(buffer, 0, buffer.length, 0);
    return buffer;
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

  private async openDirectoryForList(path: string) {
    try {
      return await open(path, noFollowDirectoryFlags);
    } catch (error) {
      if (error instanceof Error && "code" in error && (error.code === "ELOOP" || error.code === "ENOTDIR")) {
        throw new Error("Path escapes workspace");
      }
      throw error;
    }
  }

  private async assertOpenHandleStillMatches(
    handle: { stat(): Promise<Stats> },
    rootPath: string,
    logicalPath: string,
    originalAbsolutePath: string,
  ): Promise<void> {
    const current = resolveWorkspacePath(rootPath, logicalPath);
    assertSameResolvedTarget(current.absolutePath, originalAbsolutePath);
    const [handleStats, currentStats] = await Promise.all([handle.stat(), stat(current.absolutePath)]);
    if (!isSameFileIdentity(handleStats, currentStats)) {
      throw new Error("File changed on disk");
    }
  }

  private async readDirectoryEntriesFromHandle(handle: { fd: number }) {
    try {
      return await readdir(`/proc/self/fd/${handle.fd}`, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new Error("Pinned directory enumeration is unavailable");
      }
      throw error;
    }
  }

  async gitStatus(rootPath: string): Promise<GitStatusResponse> {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1"], { cwd: rootPath });
    return {
      changes: stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const indexStatus = line[0] ?? " ";
          const worktreeStatus = line[1] ?? " ";
          const rawPath = line.slice(3);
          const path = rawPath.includes(" -> ") ? rawPath.slice(rawPath.indexOf(" -> ") + 4) : rawPath;
          const staged = indexStatus !== " " && indexStatus !== "?";
          return {
            path,
            status: `${indexStatus}${worktreeStatus}`.trim(),
            staged,
            diffAvailable: staged || (worktreeStatus !== " " && worktreeStatus !== "?"),
          };
        }),
    };
  }

  async gitDiff(rootPath: string, path: string): Promise<string> {
    const resolved = resolveWorkspacePath(rootPath, path);
    const { stdout } = await execFileAsync("git", ["diff", "--", resolved.relativePath], {
      cwd: rootPath,
      maxBuffer: 5_000_000,
    });
    if (stdout) return stdout;

    const cached = await execFileAsync("git", ["diff", "--cached", "--", resolved.relativePath], {
      cwd: rootPath,
      maxBuffer: 5_000_000,
    });
    return cached.stdout;
  }

  async createTerminalSession(input: CreateSessionInput): Promise<{ tmuxName: string }> {
    return { tmuxName: await this.tmux.create(input.rootPath, input.type) };
  }

  async captureScrollback(tmuxName: string): Promise<string> {
    return this.tmux.capture(tmuxName);
  }

  async terminalSessionExists(tmuxName: string): Promise<boolean> {
    return this.tmux.exists(tmuxName);
  }

  async killSession(tmuxName: string): Promise<void> {
    await this.tmux.kill(tmuxName);
  }

  async createPreview(workspaceId: string, port: number): Promise<PortPreview> {
    const id = nanoid();
    return {
      id,
      workspaceId,
      port,
      pathPrefix: `/preview/${id}`,
      status: "active",
      createdAt: new Date().toISOString(),
    };
  }
}
