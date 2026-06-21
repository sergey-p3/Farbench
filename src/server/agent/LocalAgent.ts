import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nanoid } from "nanoid";
import type { FileReadResponse, FileResource, GitStatusResponse, PortPreview } from "../../shared/types.js";
import type { AgentGateway, CreateSessionInput, WriteFileInput } from "./AgentGateway.js";
import { resolveWorkspacePath } from "../pathPolicy.js";

function containsNullByte(buffer: Buffer): boolean {
  return buffer.includes(0);
}

function versionFor(buffer: Buffer, mtimeMs: number): string {
  return createHash("sha256").update(buffer).update(String(mtimeMs)).digest("hex");
}

function resourceFor(path: string, stats: { isDirectory(): boolean; size: number; mtimeMs: number }): FileResource {
  const isDirectory = stats.isDirectory();
  return {
    path,
    type: isDirectory ? "directory" : "file",
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    isBinary: false,
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
        return resourceFor(child.relativePath, childStats);
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

    if (containsNullByte(buffer)) {
      throw new Error("Binary files cannot be edited");
    }

    return {
      resource: resourceFor(resolved.relativePath, stats),
      content: buffer.toString("utf8"),
      version: versionFor(buffer, stats.mtimeMs),
    };
  }

  async writeFile(input: WriteFileInput): Promise<FileReadResponse> {
    const current = await this.readFile({ rootPath: input.rootPath, path: input.path });
    if (current.version !== input.expectedVersion) {
      throw new Error("File changed on disk");
    }

    const resolved = resolveWorkspacePath(input.rootPath, input.path);
    await writeFile(resolved.absolutePath, input.content, "utf8");
    return this.readFile({ rootPath: input.rootPath, path: input.path });
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
