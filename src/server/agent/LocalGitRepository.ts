import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import type {
  GitBranch,
  GitBranchesResponse,
  GitChange,
  GitCommit,
  GitCommitFilesResponse,
  GitFileDiffKind,
  GitFileDiffResponse,
  GitHistoryResponse,
  GitStatusResponse,
} from "../../shared/types.js";
import { resolveWorkspacePath } from "../pathPolicy.js";
import { isLikelyBinary, MAX_TEXT_FILE_BYTES } from "./LocalFileSystem.js";

const execFileAsync = promisify(execFile);
const gitCommitPattern = /^[0-9a-f]{7,64}$/i;

type GitLineStats = Pick<GitChange, "additions" | "deletions">;

function parseNumstat(output: string): Map<string, GitLineStats> {
  const stats = new Map<string, GitLineStats>();
  let offset = 0;
  while (offset < output.length) {
    const recordEnd = output.indexOf("\0", offset);
    if (recordEnd === -1) break;
    const record = output.slice(offset, recordEnd);
    offset = recordEnd + 1;

    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);
    if (firstTab === -1 || secondTab === -1) continue;

    const added = record.slice(0, firstTab);
    const deleted = record.slice(firstTab + 1, secondTab);
    let path = record.slice(secondTab + 1);
    if (!path) {
      const oldPathEnd = output.indexOf("\0", offset);
      if (oldPathEnd === -1) break;
      offset = oldPathEnd + 1;
      const newPathEnd = output.indexOf("\0", offset);
      if (newPathEnd === -1) break;
      path = output.slice(offset, newPathEnd);
      offset = newPathEnd + 1;
    }

    stats.set(path, {
      additions: added === "-" ? 0 : Number.parseInt(added, 10) || 0,
      deletions: deleted === "-" ? 0 : Number.parseInt(deleted, 10) || 0,
    });
  }
  return stats;
}

class GitFileDiffContentError extends Error {
  constructor(
    readonly kind: GitFileDiffKind,
    message: string,
  ) {
    super(message);
  }
}

function unifiedAddedFilePatch(path: string, content: string): string {
  const lines = content.length === 0
    ? []
    : content.endsWith("\n")
      ? content.slice(0, -1).split("\n")
      : content.split("\n");
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

/** Git operations performed within a validated local workspace. */
export class LocalGitRepository {
  async status(rootPath: string): Promise<GitStatusResponse> {
    const [{ stdout: statusOutput }, { stdout: unstagedOutput }, { stdout: stagedOutput }] = await Promise.all([
      execFileAsync("git", ["status", "--porcelain=v1", "-z", "-uall"], { cwd: rootPath }),
      execFileAsync("git", ["diff", "--numstat", "-z", "--"], { cwd: rootPath }),
      execFileAsync("git", ["diff", "--cached", "--numstat", "-z", "--"], { cwd: rootPath }),
    ]);
    const unstagedStats = parseNumstat(unstagedOutput);
    const stagedStats = parseNumstat(stagedOutput);
    const records = statusOutput.split("\0");
    const parsedChanges: Array<{
      change: Omit<GitChange, "additions" | "deletions">;
      untracked: boolean;
    }> = [];

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (!record) continue;
      const indexStatus = record[0] ?? " ";
      const worktreeStatus = record[1] ?? " ";
      const path = record.slice(3);
      const staged = indexStatus !== " " && indexStatus !== "?";
      const untracked = indexStatus === "?" && worktreeStatus === "?";
      parsedChanges.push({
        change: {
          path,
          status: `${indexStatus}${worktreeStatus}`.trim(),
          staged,
          diffAvailable: staged || untracked || (worktreeStatus !== " " && worktreeStatus !== "?"),
        },
        untracked,
      });
      if (indexStatus === "R" || indexStatus === "C" || worktreeStatus === "R" || worktreeStatus === "C") {
        index += 1;
      }
    }

    const changes = await Promise.all(parsedChanges.map(async ({ change, untracked }): Promise<GitChange> => {
      const lineStats = untracked
        ? await this.untrackedLineStats(rootPath, change.path)
        : (change.staged ? stagedStats : unstagedStats).get(change.path) ?? { additions: 0, deletions: 0 };
      return { ...change, ...lineStats };
    }));
    return { changes };
  }

  async history(rootPath: string, requestedBranch?: string): Promise<GitHistoryResponse> {
    const branches = await this.localBranchNames(rootPath);
    const currentBranch = await this.currentBranch(rootPath);
    const branch = requestedBranch ?? currentBranch;
    if (!branch || !branches.includes(branch)) throw new Error("Branch not found");

    const format = "%x1e%H%x00%h%x00%s%x00%B%x00%an%x00%ae%x00%aI%x00%cI%x00";
    const { stdout } = await execFileAsync(
      "git",
      ["log", `refs/heads/${branch}`, "--topo-order", `--format=${format}`, "--numstat"],
      { cwd: rootPath, maxBuffer: 20_000_000 },
    );
    const commits = stdout
      .split("\x1e")
      .slice(1)
      .map((record) => this.parseHistoryRecord(record))
      .filter((commit): commit is GitCommit => commit !== null);
    return { branch, commits };
  }

  async branches(rootPath: string): Promise<GitBranchesResponse> {
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
      const { stdout: counts } = await execFileAsync(
        "git",
        ["rev-list", "--left-right", "--count", `${baseBranch}...${branch.name}`],
        { cwd: rootPath },
      );
      const [behind = 0, ahead = 0] = counts.trim().split(/\s+/).map((value) => Number.parseInt(value, 10) || 0);
      return { ...branch, ahead, behind };
    }));
    return { baseBranch, branches };
  }

  async switchBranch(rootPath: string, branch: string): Promise<void> {
    const branches = await this.localBranchNames(rootPath);
    if (!branches.includes(branch)) throw new Error("Branch not found");
    await execFileAsync("git", ["switch", branch], { cwd: rootPath });
  }

  async setFileStaged(rootPath: string, path: string, staged: boolean): Promise<void> {
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

  async commitFiles(rootPath: string, commitId: string): Promise<GitCommitFilesResponse> {
    const resolvedCommit = await this.resolveCommit(rootPath, commitId);
    const { stdout: parentOutput } = await execFileAsync("git", ["rev-list", "--parents", "-n", "1", resolvedCommit], {
      cwd: rootPath,
    });
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

  async diff(rootPath: string, path: string): Promise<string> {
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

    const { stdout: statusStdout } = await execFileAsync(
      "git",
      ["status", "--porcelain=v1", "--", resolved.relativePath],
      { cwd: rootPath },
    );
    const statusLine = statusStdout.split("\n").find(Boolean);
    if (statusLine?.startsWith("?? ")) {
      const current = await this.readWorkingTreeDiffText(resolved.absolutePath);
      return unifiedAddedFilePatch(resolved.relativePath, current);
    }

    return "";
  }

  async fileDiff(rootPath: string, path: string): Promise<GitFileDiffResponse> {
    const resolved = resolveWorkspacePath(rootPath, path);
    let patch = "";
    try {
      patch = await this.diff(rootPath, path);
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

      return { path: resolved.relativePath, kind: "text", original, current, patch, message: null };
    } catch (error) {
      const fallback = this.fileDiffFallbackKind(error);
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

  async commitFileDiff(rootPath: string, commitId: string, path: string): Promise<GitFileDiffResponse> {
    const resolved = resolveWorkspacePath(rootPath, path);
    const resolvedCommit = await this.resolveCommit(rootPath, commitId);
    const { stdout: parentOutput } = await execFileAsync("git", ["rev-list", "--parents", "-n", "1", resolvedCommit], {
      cwd: rootPath,
    });
    const parent = parentOutput.trim().split(/\s+/)[1] ?? null;
    let patch = "";
    try {
      const patchArgs = parent
        ? ["diff", "--no-color", parent, resolvedCommit, "--", resolved.relativePath]
        : ["show", "--no-color", "--format=", resolvedCommit, "--", resolved.relativePath];
      patch = (await execFileAsync("git", patchArgs, { cwd: rootPath, maxBuffer: 5_000_000 })).stdout;
      const original = parent && await this.pathExists(rootPath, parent, resolved.relativePath)
        ? await this.readGitObjectDiffText(rootPath, `${parent}:${resolved.relativePath}`)
        : "";
      const current = await this.pathExists(rootPath, resolvedCommit, resolved.relativePath)
        ? await this.readGitObjectDiffText(rootPath, `${resolvedCommit}:${resolved.relativePath}`)
        : "";
      return { path: resolved.relativePath, kind: "text", original, current, patch, message: null };
    } catch (error) {
      const fallback = this.fileDiffFallbackKind(error);
      return { path: resolved.relativePath, kind: fallback.kind, original: "", current: "", patch, message: fallback.message };
    }
  }

  private async currentBranch(rootPath: string): Promise<string> {
    return (await execFileAsync("git", ["branch", "--show-current"], { cwd: rootPath })).stdout.trim();
  }

  private async untrackedLineStats(rootPath: string, path: string): Promise<GitLineStats> {
    const resolved = resolveWorkspacePath(rootPath, path);
    let output = "";
    try {
      output = (await execFileAsync(
        "git",
        ["diff", "--no-index", "--numstat", "-z", "--", "/dev/null", resolved.relativePath],
        { cwd: rootPath },
      )).stdout;
    } catch (error) {
      if (error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string") {
        output = error.stdout;
      }
    }
    return parseNumstat(output).values().next().value ?? { additions: 0, deletions: 0 };
  }

  private async localBranchNames(rootPath: string): Promise<string[]> {
    const { stdout } = await execFileAsync("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads"], {
      cwd: rootPath,
    });
    return stdout.split("\n").filter(Boolean);
  }

  private parseHistoryRecord(record: string): GitCommit | null {
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

  private async resolveCommit(rootPath: string, commitId: string): Promise<string> {
    if (!gitCommitPattern.test(commitId)) throw new Error("Invalid commit id");
    return (await execFileAsync("git", ["rev-parse", "--verify", `${commitId}^{commit}`], { cwd: rootPath })).stdout.trim();
  }

  private async pathExists(rootPath: string, commitId: string, path: string): Promise<boolean> {
    try {
      await execFileAsync("git", ["cat-file", "-e", `${commitId}:${path}`], { cwd: rootPath });
      return true;
    } catch {
      return false;
    }
  }

  private fileDiffFallbackKind(error: unknown): { kind: GitFileDiffKind; message: string } {
    if (error instanceof GitFileDiffContentError) return { kind: error.kind, message: error.message };
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
      maxBuffer: MAX_TEXT_FILE_BYTES + 1,
    });
    return this.diffTextFromBuffer(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
  }

  private async readWorkingTreeDiffText(absolutePath: string): Promise<string> {
    const stats = await stat(absolutePath);
    if (stats.size > MAX_TEXT_FILE_BYTES) {
      throw new GitFileDiffContentError("too-large", "File is too large to diff as text");
    }
    return this.diffTextFromBuffer(await readFile(absolutePath));
  }

  private diffTextFromBuffer(buffer: Buffer): string {
    if (buffer.byteLength > MAX_TEXT_FILE_BYTES) {
      throw new GitFileDiffContentError("too-large", "File is too large to diff as text");
    }
    if (isLikelyBinary(buffer)) {
      throw new GitFileDiffContentError("binary", "Binary files cannot be diffed as text");
    }
    return buffer.toString("utf8");
  }
}
