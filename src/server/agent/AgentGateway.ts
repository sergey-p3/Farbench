import type {
  FileReadResponse,
  FileResource,
  GitBranchesResponse,
  GitCommitFilesResponse,
  GitFileDiffResponse,
  GitHistoryResponse,
  GitStatusResponse,
  PortPreview,
  SessionType,
} from "../../shared/types.js";

export interface CreateSessionInput {
  workspaceId: string;
  rootPath: string;
  name: string;
  type: SessionType;
}

export interface WriteFileInput {
  rootPath: string;
  path: string;
  content: string;
  expectedVersion: string;
}

export interface AgentGateway {
  listFiles(rootPath: string, path: string): Promise<FileResource[]>;
  readFile(input: { rootPath: string; path: string }): Promise<FileReadResponse>;
  writeFile(input: WriteFileInput): Promise<FileReadResponse>;
  gitStatus(rootPath: string): Promise<GitStatusResponse>;
  gitHistory(rootPath: string, branch?: string): Promise<GitHistoryResponse>;
  gitBranches(rootPath: string): Promise<GitBranchesResponse>;
  gitSwitchBranch(rootPath: string, branch: string): Promise<void>;
  gitSetFileStaged(rootPath: string, path: string, staged: boolean): Promise<void>;
  gitCommitFiles(rootPath: string, commitId: string): Promise<GitCommitFilesResponse>;
  gitDiff(rootPath: string, path: string): Promise<string>;
  gitFileDiff(rootPath: string, path: string): Promise<GitFileDiffResponse>;
  gitCommitFileDiff(rootPath: string, commitId: string, path: string): Promise<GitFileDiffResponse>;
  createTerminalSession(input: CreateSessionInput): Promise<{ tmuxName: string }>;
  captureScrollback(tmuxName: string): Promise<string>;
  terminalSessionExists(tmuxName: string): Promise<boolean>;
  killSession(tmuxName: string): Promise<void>;
  createPreview(workspaceId: string, port: number): Promise<PortPreview>;
}
