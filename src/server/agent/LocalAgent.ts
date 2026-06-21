import { createHash } from "node:crypto";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import { nanoid } from "nanoid";
import type { FileReadResponse, FileResource, GitStatusResponse, PortPreview } from "../../shared/types.js";
import type { AgentGateway, CreateSessionInput, WriteFileInput } from "./AgentGateway.js";
import { resolveWorkspacePath } from "../pathPolicy.js";

const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

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
        const childStats = await stat(child.absolutePath);
        const isBinary = childStats.isDirectory() ? false : isLikelyBinary(await readFile(child.absolutePath));
        return resourceFor(childPath, childStats, isBinary);
      }),
    );

    return resources.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
  }

  async readFile(input: { rootPath: string; path: string }): Promise<FileReadResponse> {
    const resolved = resolveWorkspacePath(input.rootPath, input.path);
    const [stats, buffer] = await Promise.all([stat(resolved.absolutePath), readFile(resolved.absolutePath)]);

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
    const handle = await open(resolved.absolutePath, "r+");
    try {
      await this.beforeWriteVersionCheck();
      const stats = await handle.stat();
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
  }

  protected async beforeWriteVersionCheck(): Promise<void> {}

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
