import { nanoid } from "nanoid";
import type {
  GitBranchesResponse,
  GitCommitFilesResponse,
  GitFileDiffResponse,
  GitHistoryResponse,
  GitStatusResponse,
  PortPreview,
} from "../../shared/types.js";
import { TmuxManager } from "../terminal/TmuxManager.js";
import type { AgentGateway, CreateSessionInput } from "./AgentGateway.js";
import { LocalFileSystem } from "./LocalFileSystem.js";
import { LocalGitRepository } from "./LocalGitRepository.js";

/**
 * Local implementation of the server boundary.
 *
 * Filesystem safety lives in LocalFileSystem, Git behavior in
 * LocalGitRepository, and this class composes those capabilities with tmux and
 * preview lifecycle operations while preserving the AgentGateway API.
 */
export class LocalAgent extends LocalFileSystem implements AgentGateway {
  constructor(
    private readonly tmux = new TmuxManager(),
    private readonly git = new LocalGitRepository(),
  ) {
    super();
  }

  gitStatus(rootPath: string): Promise<GitStatusResponse> {
    return this.git.status(rootPath);
  }

  gitHistory(rootPath: string, branch?: string): Promise<GitHistoryResponse> {
    return this.git.history(rootPath, branch);
  }

  gitBranches(rootPath: string): Promise<GitBranchesResponse> {
    return this.git.branches(rootPath);
  }

  gitSwitchBranch(rootPath: string, branch: string): Promise<void> {
    return this.git.switchBranch(rootPath, branch);
  }

  gitSetFileStaged(rootPath: string, path: string, staged: boolean): Promise<void> {
    return this.git.setFileStaged(rootPath, path, staged);
  }

  gitCommitFiles(rootPath: string, commitId: string): Promise<GitCommitFilesResponse> {
    return this.git.commitFiles(rootPath, commitId);
  }

  gitDiff(rootPath: string, path: string): Promise<string> {
    return this.git.diff(rootPath, path);
  }

  gitFileDiff(rootPath: string, path: string): Promise<GitFileDiffResponse> {
    return this.git.fileDiff(rootPath, path);
  }

  gitCommitFileDiff(rootPath: string, commitId: string, path: string): Promise<GitFileDiffResponse> {
    return this.git.commitFileDiff(rootPath, commitId, path);
  }

  async createTerminalSession(input: CreateSessionInput): Promise<{ tmuxName: string }> {
    return { tmuxName: await this.tmux.create(input.rootPath, input.type, input.codexPermissionLevel) };
  }

  captureScrollback(tmuxName: string): Promise<string> {
    return this.tmux.capture(tmuxName);
  }

  terminalSessionExists(tmuxName: string): Promise<boolean> {
    return this.tmux.exists(tmuxName);
  }

  killSession(tmuxName: string): Promise<void> {
    return this.tmux.kill(tmuxName);
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
