import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants, type Dirent, type Stats } from "node:fs";
import { open, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify, TextDecoder } from "node:util";
import { nanoid } from "nanoid";
import type {
  FileReadResponse,
  FileResource,
  GitBranch,
  GitBranchesResponse,
  GitCommit,
  GitCommitFilesResponse,
  GitFileDiffKind,
  GitFileDiffResponse,
  GitHistoryResponse,
  GitStatusResponse,
  PortPreview,
} from "../../shared/types.js";
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
const gitCommitPattern = /^[0-9a-f]{7,64}$/i;

class GitFileDiffContentError extends Error {
  constructor(
    readonly kind: GitFileDiffKind,
    message: string,
  ) {
    super(message);
  }
}

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

function unifiedAddedFilePatch(path: string, content: string): string {
  const lines = content.length === 0 ? [] : content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
  const lineCount = lines.length;
  const hunkRange = lineCount === 1 ? "+1" : `+1,${lineCount}`;
  const patchLines = [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "index 0000000..0000000",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 ${hunkRange} @@`,
    ...lines.map((line) => `+${line}`),
  ];
  if (content.length > 0 && !content.endsWith("\n")) {
    patchLines.push("\\ No newline at end of file");
  }
  return `${patchLines.join("\n")}\n`;
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
    const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-uall"], { cwd: rootPath });
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
          const untracked = indexStatus === "?" && worktreeStatus === "?";
          return {
            path,
            status: `${indexStatus}${worktreeStatus}`.trim(),
            staged,
            diffAvailable: staged || untracked || (worktreeStatus !== " " && worktreeStatus !== "?"),
          };
        }),
    };
  }

  async gitHistory(rootPath: string, requestedBranch?: string): Promise<GitHistoryResponse> {
    const branches = await this.localGitBranchNames(rootPath);
    const currentBranch = await this.currentGitBranch(rootPath);
    const branch = requestedBranch ?? currentBranch;
    if (!branch || !branches.includes(branch)) throw new Error("Branch not found");

    const format = "%x1e%H%x00%h%x00%s%x00%B%x00%an%x00%ae%x00%aI%x00%cI%x00";
    const { stdout } = await execFileAsync("git", ["log", `refs/heads/${branch}`, "--topo-order", `--format=${format}`, "--numstat"], {
      cwd: rootPath,
      maxBuffer: 20_000_000,
    });
    const commits: GitCommit[] = stdout
      .split("\x1e")
      .slice(1)
      .map((record) => this.parseGitHistoryRecord(record))
      .filter((commit): commit is GitCommit => commit !== null);
    return { branch, commits };
  }

  async gitBranches(rootPath: string): Promise<GitBranchesResponse> {
    const { stdout } = await execFileAsync(
      "git",
      ["for-each-ref", "--format=%(refname:short)%00%(HEAD)%00%(objectname)%00%(committerdate:iso-strict)", "refs/heads"],
      { cwd: rootPath },
    );
    const rawBranches = stdout.split("\n").filter(Boolean).map((line) => {
      const [name = "", head = "", lastCommitId = "", lastCommitAt = ""] = line.split("\x00");
      return { name, current: head === "*", lastCommitId, lastCommitAt };
    });
    const currentBranch = rawBranches.find((branch) => branch.current)?.name ?? "";
    const baseBranch = rawBranches.some((branch) => branch.name === "main")
      ? "main"
      : rawBranches.some((branch) => branch.name === "master")
        ? "master"
        : currentBranch || rawBranches[0]?.name || "";
    const branches: GitBranch[] = await Promise.all(rawBranches.map(async (branch) => {
      if (!baseBranch || branch.name === baseBranch) return { ...branch, ahead: 0, behind: 0 };
      const { stdout: counts } = await execFileAsync("git", ["rev-list", "--left-right", "--count", `${baseBranch}...${branch.name}`], {
        cwd: rootPath,
      });
      const [behind = 0, ahead = 0] = counts.trim().split(/\s+/).map((value) => Number.parseInt(value, 10) || 0);
      return { ...branch, ahead, behind };
    }));
    return { baseBranch, branches };
  }

  async gitSwitchBranch(rootPath: string, branch: string): Promise<void> {
    const branches = await this.localGitBranchNames(rootPath);
    if (!branches.includes(branch)) throw new Error("Branch not found");
    await execFileAsync("git", ["switch", branch], { cwd: rootPath });
  }

  async gitSetFileStaged(rootPath: string, path: string, staged: boolean): Promise<void> {
    const resolved = resolveWorkspacePath(rootPath, path);
    if (staged) {
      await execFileAsync("git", ["add", "--", resolved.relativePath], { cwd: rootPath });
      return;
    }
    try {
      await execFileAsync("git", ["restore", "--staged", "--", resolved.relativePath], { cwd: rootPath });
    } catch {
      await execFileAsync("git", ["reset", "HEAD", "--", resolved.relativePath], { cwd: rootPath });
    }
  }

  async gitCommitFiles(rootPath: string, commitId: string): Promise<GitCommitFilesResponse> {
    const resolvedCommit = await this.resolveGitCommit(rootPath, commitId);
    const { stdout: parentOutput } = await execFileAsync("git", ["rev-list", "--parents", "-n", "1", resolvedCommit], { cwd: rootPath });
    const parent = parentOutput.trim().split(/\s+/)[1] ?? null;
    const command = parent
      ? ["diff", "--no-color", "-M", parent, resolvedCommit]
      : ["diff-tree", "--root", "--no-commit-id", "-r", "-M", "--no-color", resolvedCommit];
    const [{ stdout: statusOutput }, { stdout: statsOutput }] = await Promise.all([
      execFileAsync("git", [...command, "--name-status"], { cwd: rootPath, maxBuffer: 10_000_000 }),
      execFileAsync("git", [...command, "--numstat"], { cwd: rootPath, maxBuffer: 10_000_000 }),
    ]);
    const stats = new Map<string, { additions: number; deletions: number }>();
    for (const line of statsOutput.split("\n").filter(Boolean)) {
      const [added = "0", deleted = "0", ...pathParts] = line.split("\t");
      const path = pathParts.at(-1) ?? "";
      stats.set(path, {
        additions: added === "-" ? 0 : Number.parseInt(added, 10) || 0,
        deletions: deleted === "-" ? 0 : Number.parseInt(deleted, 10) || 0,
      });
    }
    const files = statusOutput.split("\n").filter(Boolean).map((line) => {
      const [status = "", ...pathParts] = line.split("\t");
      const path = pathParts.at(-1) ?? "";
      const counts = stats.get(path) ?? { additions: 0, deletions: 0 };
      return { path, status, staged: false, diffAvailable: true, ...counts };
    });
    return { commitId: resolvedCommit, files };
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
    if (cached.stdout) return cached.stdout;

    const { stdout: statusStdout } = await execFileAsync("git", ["status", "--porcelain=v1", "--", resolved.relativePath], {
      cwd: rootPath,
    });
    const statusLine = statusStdout.split("\n").find(Boolean);
    if (statusLine?.startsWith("?? ")) {
      const current = await this.readWorkingTreeDiffText(resolved.absolutePath);
      return unifiedAddedFilePatch(resolved.relativePath, current);
    }

    return "";
  }

  async gitFileDiff(rootPath: string, path: string): Promise<GitFileDiffResponse> {
    const resolved = resolveWorkspacePath(rootPath, path);
    let patch = "";
    try {
      patch = await this.gitDiff(rootPath, path);
      const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "--", resolved.relativePath], {
        cwd: rootPath,
      });
      const statusLine = stdout.split("\n").find(Boolean);
      const indexStatus = statusLine?.[0] ?? " ";
      const worktreeStatus = statusLine?.[1] ?? " ";
      const hasUnstagedChanges = worktreeStatus !== " " && worktreeStatus !== "?";
      const hasStagedChanges = indexStatus !== " " && indexStatus !== "?";
      const isUntracked = indexStatus === "?" && worktreeStatus === "?";

      let original: string;
      let current: string;
      if (isUntracked) {
        original = "";
        current = await this.readWorkingTreeDiffText(resolved.absolutePath);
      } else if (hasUnstagedChanges) {
        original = await this.readGitObjectDiffText(rootPath, `:${resolved.relativePath}`);
        current = worktreeStatus === "D" ? "" : await this.readWorkingTreeDiffText(resolved.absolutePath);
      } else if (hasStagedChanges) {
        original = indexStatus === "A" ? "" : await this.readGitObjectDiffText(rootPath, `HEAD:${resolved.relativePath}`);
        current = indexStatus === "D" ? "" : await this.readGitObjectDiffText(rootPath, `:${resolved.relativePath}`);
      } else {
        original = await this.readGitObjectDiffText(rootPath, `HEAD:${resolved.relativePath}`);
        current = await this.readWorkingTreeDiffText(resolved.absolutePath);
      }

      return {
        path: resolved.relativePath,
        kind: "text",
        original,
        current,
        patch,
        message: null,
      };
    } catch (error) {
      const fallback = this.gitFileDiffFallbackKind(error);
      return {
        path: resolved.relativePath,
        kind: fallback.kind,
        original: "",
        current: "",
        patch,
        message: fallback.message,
      };
    }
  }

  async gitCommitFileDiff(rootPath: string, commitId: string, path: string): Promise<GitFileDiffResponse> {
    const resolved = resolveWorkspacePath(rootPath, path);
    const resolvedCommit = await this.resolveGitCommit(rootPath, commitId);
    const { stdout: parentOutput } = await execFileAsync("git", ["rev-list", "--parents", "-n", "1", resolvedCommit], { cwd: rootPath });
    const parent = parentOutput.trim().split(/\s+/)[1] ?? null;
    let patch = "";
    try {
      const patchArgs = parent
        ? ["diff", "--no-color", parent, resolvedCommit, "--", resolved.relativePath]
        : ["show", "--no-color", "--format=", resolvedCommit, "--", resolved.relativePath];
      patch = (await execFileAsync("git", patchArgs, { cwd: rootPath, maxBuffer: 5_000_000 })).stdout;
      const original = parent && await this.gitPathExists(rootPath, parent, resolved.relativePath)
        ? await this.readGitObjectDiffText(rootPath, `${parent}:${resolved.relativePath}`)
        : "";
      const current = await this.gitPathExists(rootPath, resolvedCommit, resolved.relativePath)
        ? await this.readGitObjectDiffText(rootPath, `${resolvedCommit}:${resolved.relativePath}`)
        : "";
      return { path: resolved.relativePath, kind: "text", original, current, patch, message: null };
    } catch (error) {
      const fallback = this.gitFileDiffFallbackKind(error);
      return { path: resolved.relativePath, kind: fallback.kind, original: "", current: "", patch, message: fallback.message };
    }
  }

  private async currentGitBranch(rootPath: string): Promise<string> {
    return (await execFileAsync("git", ["branch", "--show-current"], { cwd: rootPath })).stdout.trim();
  }

  private async localGitBranchNames(rootPath: string): Promise<string[]> {
    const { stdout } = await execFileAsync("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads"], { cwd: rootPath });
    return stdout.split("\n").filter(Boolean);
  }

  private parseGitHistoryRecord(record: string): GitCommit | null {
    const [id, shortId, title, message, authorName, authorEmail, authoredAt, committedAt, stats = ""] = record.split("\x00");
    if (!id || !shortId) return null;
    let additions = 0;
    let deletions = 0;
    for (const line of stats.split("\n")) {
      const [added, deleted] = line.trim().split("\t");
      if (added && added !== "-") additions += Number.parseInt(added, 10) || 0;
      if (deleted && deleted !== "-") deletions += Number.parseInt(deleted, 10) || 0;
    }
    return {
      id,
      shortId,
      title: title ?? "",
      message: (message ?? "").trim(),
      authorName: authorName ?? "",
      authorEmail: authorEmail ?? "",
      authoredAt: authoredAt ?? "",
      committedAt: committedAt ?? "",
      additions,
      deletions,
    };
  }

  private async resolveGitCommit(rootPath: string, commitId: string): Promise<string> {
    if (!gitCommitPattern.test(commitId)) throw new Error("Invalid commit id");
    return (await execFileAsync("git", ["rev-parse", "--verify", `${commitId}^{commit}`], { cwd: rootPath })).stdout.trim();
  }

  private async gitPathExists(rootPath: string, commitId: string, path: string): Promise<boolean> {
    try {
      await execFileAsync("git", ["cat-file", "-e", `${commitId}:${path}`], { cwd: rootPath });
      return true;
    } catch {
      return false;
    }
  }

  private gitFileDiffFallbackKind(error: unknown): { kind: GitFileDiffKind; message: string } {
    if (error instanceof GitFileDiffContentError) {
      return { kind: error.kind, message: error.message };
    }
    if (
      error instanceof RangeError ||
      (error instanceof Error && "code" in error && error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
    ) {
      return { kind: "too-large", message: "File is too large to diff as text" };
    }
    return { kind: "unavailable", message: "File diff is unavailable" };
  }

  private async readGitObjectDiffText(rootPath: string, revision: string): Promise<string> {
    const { stdout } = await execFileAsync("git", ["show", revision], {
      cwd: rootPath,
      encoding: "buffer",
      maxBuffer: maxTextFileBytes + 1,
    });
    return this.diffTextFromBuffer(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
  }

  private async readWorkingTreeDiffText(absolutePath: string): Promise<string> {
    const stats = await stat(absolutePath);
    if (stats.size > maxTextFileBytes) {
      throw new GitFileDiffContentError("too-large", "File is too large to diff as text");
    }
    return this.diffTextFromBuffer(await readFile(absolutePath));
  }

  private diffTextFromBuffer(buffer: Buffer): string {
    if (buffer.byteLength > maxTextFileBytes) {
      throw new GitFileDiffContentError("too-large", "File is too large to diff as text");
    }
    if (isLikelyBinary(buffer)) {
      throw new GitFileDiffContentError("binary", "Binary files cannot be diffed as text");
    }
    return buffer.toString("utf8");
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
