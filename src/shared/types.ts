export type SessionType = "bash" | "codex" | "claude";
export type SessionStatus = "starting" | "running" | "idle" | "disconnected" | "exited" | "crashed" | "killed" | "unknown";

export interface User {
  id: string;
  username: string;
}

export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  status: "available" | "unavailable";
}

export interface Session {
  id: string;
  workspaceId: string;
  name: string;
  type: SessionType;
  tmuxName: string;
  status: SessionStatus;
  createdAt: string;
  lastAttachedAt: string | null;
  lastActivityAt: string | null;
  endedAt: string | null;
}

export type ItemKind = "agent" | "terminal" | "files" | "git" | "preview";

export interface WorkspaceItemConfig {
  runtime?: SessionType;
  port?: number;
  path?: string;
}

export interface WorkspaceItem {
  id: string;
  workspaceId: string;
  kind: ItemKind;
  title: string;
  status: SessionStatus | "ready" | "disconnected";
  sessionId?: string;
  config?: WorkspaceItemConfig;
  createdAt?: string;
  lastActiveAt?: string;
}

export interface PaneLayout {
  id: string;
  activeItemId: string | null;
  itemIds: string[];
}

export interface BrowserLayout {
  selectedWorkspaceId: string | null;
  activePaneId: string;
  panes: PaneLayout[];
  items: WorkspaceItem[];
}

export interface FileResource {
  path: string;
  type: "file" | "directory";
  size: number;
  mtimeMs: number;
  isBinary: boolean;
  canWrite: boolean;
  tooLarge: boolean;
}

export interface FileReadResponse {
  resource: FileResource;
  content: string;
  version: string;
}

export interface GitChange {
  path: string;
  status: string;
  staged: boolean;
  diffAvailable: boolean;
}

export interface GitStatusResponse {
  changes: GitChange[];
}

export interface GitCommit {
  id: string;
  shortId: string;
  title: string;
  message: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  committedAt: string;
  additions: number;
  deletions: number;
}

export interface GitHistoryResponse {
  branch: string;
  commits: GitCommit[];
}

export interface GitBranch {
  name: string;
  current: boolean;
  ahead: number;
  behind: number;
  lastCommitAt: string;
  lastCommitId: string;
}

export interface GitBranchesResponse {
  baseBranch: string;
  branches: GitBranch[];
}

export interface GitCommitFile extends GitChange {
  additions: number;
  deletions: number;
}

export interface GitCommitFilesResponse {
  commitId: string;
  files: GitCommitFile[];
}

export type GitFileDiffKind = "text" | "binary" | "too-large" | "unavailable";

export interface GitFileDiffResponse {
  path: string;
  kind: GitFileDiffKind;
  original: string;
  current: string;
  patch: string;
  message: string | null;
}

export interface PortPreview {
  id: string;
  workspaceId: string;
  port: number;
  pathPrefix: string;
  status: "active" | "failed";
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  type: string;
  createdAt: string;
  metadata: Record<string, string | number | boolean | null>;
}
