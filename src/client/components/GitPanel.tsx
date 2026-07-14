import { useEffect, useRef, useState } from "react";
import type {
  GitBranch,
  GitCommit,
  GitFileDiffResponse,
  Workspace,
} from "../../shared/types.js";
import { api, isUnauthorized } from "../api.js";
import { nextDiffFileIndex } from "../gitDiffView.js";
import type { GitDiffViewerHandle } from "./GitDiffViewer.js";
import {
  CommitDetails,
  GitBranchesView,
  GitFilesView,
  GitHistoryView,
  GitNavigation,
  type DisplayedChange,
  type GitView,
} from "./git/GitPanelViews.js";

interface GitPanelProps {
  workspace: Workspace | null;
  onUnauthorized?: () => void;
}

export function GitPanel({ workspace, onUnauthorized }: GitPanelProps) {
  const workspaceIdRef = useRef<string | null>(workspace?.id ?? null);
  const selectedPathRef = useRef<string | null>(null);
  const diffViewerRef = useRef<GitDiffViewerHandle | null>(null);
  const repositoryRequestRef = useRef(0);
  const diffRequestRef = useRef(0);
  const [activeView, setActiveView] = useState<GitView>("files");
  const [changes, setChanges] = useState<DisplayedChange[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [baseBranch, setBaseBranch] = useState("");
  const [currentBranch, setCurrentBranch] = useState("");
  const [selectedCommit, setSelectedCommit] = useState<GitCommit | null>(null);
  const [detailCommit, setDetailCommit] = useState<GitCommit | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<GitFileDiffResponse | null>(null);
  const [initialChangeDirection, setInitialChangeDirection] = useState<1 | -1 | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  useEffect(() => {
    workspaceIdRef.current = workspace?.id ?? null;
    repositoryRequestRef.current += 1;
    diffRequestRef.current += 1;
    setActiveView("files");
    setChanges([]);
    setCommits([]);
    setBranches([]);
    setBaseBranch("");
    setCurrentBranch("");
    setSelectedCommit(null);
    setDetailCommit(null);
    clearSelection();
    setIsLoading(false);
    setBusyPath(null);
    setSwitchingBranch(null);
    setError(null);
    if (workspace) void loadRepository(workspace.id);
  }, [workspace?.id]);

  async function loadRepository(workspaceId = workspace?.id) {
    if (!workspaceId) return;
    const requestId = ++repositoryRequestRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const [status, branchResponse] = await Promise.all([
        api.gitStatus(workspaceId),
        api.gitBranches(workspaceId),
      ]);
      if (!isCurrentRepositoryRequest(workspaceId, requestId)) return;
      const activeBranch = branchResponse.branches.find((branch) => branch.current)?.name ?? "";
      setChanges(status.changes);
      setBranches(branchResponse.branches);
      setBaseBranch(branchResponse.baseBranch);
      setCurrentBranch(activeBranch);
      if (activeBranch) {
        const history = await api.gitHistory(workspaceId, activeBranch);
        if (!isCurrentRepositoryRequest(workspaceId, requestId)) return;
        setCommits(history.commits);
      } else {
        setCommits([]);
      }
    } catch (loadError) {
      if (!isCurrentRepositoryRequest(workspaceId, requestId)) return;
      showError(loadError, "Unable to load repository");
    } finally {
      if (isCurrentRepositoryRequest(workspaceId, requestId)) setIsLoading(false);
    }
  }

  async function refreshCurrentView() {
    if (!workspace) return;
    const workspaceId = workspace.id;
    setIsLoading(true);
    setError(null);
    try {
      if (activeView === "files") {
        if (selectedCommit) {
          const response = await api.gitCommitFiles(workspaceId, selectedCommit.id);
          if (workspaceIdRef.current !== workspaceId) return;
          setChanges(response.files);
        } else {
          const status = await api.gitStatus(workspaceId);
          if (workspaceIdRef.current !== workspaceId) return;
          setChanges(status.changes);
        }
      } else if (activeView === "history") {
        if (!currentBranch) return;
        const history = await api.gitHistory(workspaceId, currentBranch);
        if (workspaceIdRef.current !== workspaceId) return;
        setCommits(history.commits);
      } else {
        const response = await api.gitBranches(workspaceId);
        if (workspaceIdRef.current !== workspaceId) return;
        setBranches(response.branches);
        setBaseBranch(response.baseBranch);
        setCurrentBranch(response.branches.find((branch) => branch.current)?.name ?? "");
      }
    } catch (refreshError) {
      if (workspaceIdRef.current === workspaceId) showError(refreshError, "Unable to refresh Git data");
    } finally {
      if (workspaceIdRef.current === workspaceId) setIsLoading(false);
    }
  }

  async function loadDiff(change: DisplayedChange, boundaryChangeDirection: 1 | -1 | null = null): Promise<void> {
    if (!workspace || !change.diffAvailable) return;
    const workspaceId = workspace.id;
    const path = change.path;
    const requestId = ++diffRequestRef.current;
    setSelectedPath(path);
    selectedPathRef.current = path;
    setDiff(null);
    setInitialChangeDirection(null);
    setIsLoadingDiff(true);
    setError(null);
    try {
      const nextDiff = await api.gitFileDiff(workspaceId, path, selectedCommit?.id);
      if (!isCurrentDiffRequest(workspaceId, path, requestId)) return;
      setDiff(nextDiff);
      setInitialChangeDirection(boundaryChangeDirection);
    } catch (diffError) {
      if (isCurrentDiffRequest(workspaceId, path, requestId)) showError(diffError, "Unable to load diff");
    } finally {
      if (isCurrentDiffRequest(workspaceId, path, requestId)) setIsLoadingDiff(false);
    }
  }

  function loadAdjacentFile(direction: 1 | -1, boundaryChangeDirection: 1 | -1 | null = null) {
    const nextIndex = nextDiffFileIndex(changes, selectedPath, direction);
    if (nextIndex === null) return;
    void loadDiff(changes[nextIndex], boundaryChangeDirection);
  }

  function showAdjacentChange(direction: 1 | -1) {
    if (diffViewerRef.current?.showAdjacentChange(direction)) return;
    loadAdjacentFile(direction, direction);
  }

  async function setFileStaged(change: DisplayedChange) {
    if (!workspace || selectedCommit) return;
    const workspaceId = workspace.id;
    setBusyPath(change.path);
    setError(null);
    try {
      await api.gitSetFileStaged(workspaceId, change.path, !change.staged);
      const status = await api.gitStatus(workspaceId);
      if (workspaceIdRef.current !== workspaceId) return;
      setChanges(status.changes);
      if (!status.changes.some((candidate) => candidate.path === selectedPathRef.current)) clearSelection();
    } catch (stageError) {
      if (workspaceIdRef.current === workspaceId) showError(stageError, change.staged ? "Unable to unstage file" : "Unable to stage file");
    } finally {
      if (workspaceIdRef.current === workspaceId) setBusyPath(null);
    }
  }

  async function selectHistoryCommit(commit: GitCommit) {
    if (!workspace) return;
    const workspaceId = workspace.id;
    setSelectedCommit(commit);
    setActiveView("files");
    clearSelection();
    setChanges([]);
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.gitCommitFiles(workspaceId, commit.id);
      if (workspaceIdRef.current !== workspaceId) return;
      setChanges(response.files);
    } catch (commitError) {
      if (workspaceIdRef.current === workspaceId) showError(commitError, "Unable to load commit files");
    } finally {
      if (workspaceIdRef.current === workspaceId) setIsLoading(false);
    }
  }

  async function showWorkingChanges() {
    if (!workspace) return;
    const workspaceId = workspace.id;
    setSelectedCommit(null);
    clearSelection();
    setIsLoading(true);
    setError(null);
    try {
      const status = await api.gitStatus(workspaceId);
      if (workspaceIdRef.current === workspaceId) setChanges(status.changes);
    } catch (statusError) {
      if (workspaceIdRef.current === workspaceId) showError(statusError, "Unable to load Git status");
    } finally {
      if (workspaceIdRef.current === workspaceId) setIsLoading(false);
    }
  }

  async function switchBranch(branch: GitBranch) {
    if (!workspace || branch.current || switchingBranch) return;
    const workspaceId = workspace.id;
    setSwitchingBranch(branch.name);
    setError(null);
    try {
      await api.gitSwitchBranch(workspaceId, branch.name);
      if (workspaceIdRef.current !== workspaceId) return;
      setSelectedCommit(null);
      clearSelection();
      await loadRepository(workspaceId);
    } catch (switchError) {
      if (workspaceIdRef.current === workspaceId) showError(switchError, `Unable to switch to ${branch.name}`);
    } finally {
      if (workspaceIdRef.current === workspaceId) setSwitchingBranch(null);
    }
  }

  function clearSelection() {
    diffRequestRef.current += 1;
    selectedPathRef.current = null;
    setSelectedPath(null);
    setDiff(null);
    setInitialChangeDirection(null);
    setIsLoadingDiff(false);
  }

  function isCurrentRepositoryRequest(workspaceId: string, requestId: number): boolean {
    return workspaceIdRef.current === workspaceId && repositoryRequestRef.current === requestId;
  }

  function isCurrentDiffRequest(workspaceId: string, path: string, requestId: number): boolean {
    return workspaceIdRef.current === workspaceId && selectedPathRef.current === path && diffRequestRef.current === requestId;
  }

  function showError(value: unknown, fallback: string) {
    const message = panelError(value, fallback, onUnauthorized);
    if (message) setError(message);
  }

  if (!workspace) {
    return <div className="tool-panel empty-tool"><p className="empty-state">Select a workspace to inspect Git.</p></div>;
  }

  const selectedChange = changes.find((change) => change.path === selectedPath) ?? null;
  const changeGroups: Array<{ label: string | null; changes: DisplayedChange[] }> = selectedCommit
    ? [{ label: null, changes }]
    : [
        { label: "Staged", changes: changes.filter((change) => change.staged) },
        { label: "Unstaged", changes: changes.filter((change) => !change.staged) },
      ];

  return (
    <div className="tool-panel git-workbench">
      <GitNavigation
        activeView={activeView}
        currentBranch={currentBranch}
        isLoading={isLoading}
        onRefresh={() => void refreshCurrentView()}
        onSelect={setActiveView}
      />

      {error ? <p className="panel-error git-panel-error" role="alert">{error}</p> : null}

      {activeView === "files" ? (
        <GitFilesView
          busyPath={busyPath}
          changeGroups={changeGroups}
          changes={changes}
          diff={diff}
          diffViewerRef={diffViewerRef}
          initialChangeDirection={initialChangeDirection}
          isLoading={isLoading}
          isLoadingDiff={isLoadingDiff}
          onBack={clearSelection}
          onInitialChangeShown={() => setInitialChangeDirection(null)}
          onLoadDiff={(change) => void loadDiff(change)}
          onLoadFile={loadAdjacentFile}
          onSetStaged={(change) => void setFileStaged(change)}
          onShowChange={showAdjacentChange}
          onShowWorkingTree={() => void showWorkingChanges()}
          selectedChange={selectedChange}
          selectedCommit={selectedCommit}
          selectedPath={selectedPath}
        />
      ) : null}

      {activeView === "history" ? (
        <GitHistoryView
          commits={commits}
          isLoading={isLoading}
          onSelectCommit={(commit) => void selectHistoryCommit(commit)}
          onShowDetails={setDetailCommit}
        />
      ) : null}

      {activeView === "branches" ? (
        <GitBranchesView
          baseBranch={baseBranch}
          branches={branches}
          isLoading={isLoading}
          onSwitchBranch={(branch) => void switchBranch(branch)}
          switchingBranch={switchingBranch}
        />
      ) : null}

      {detailCommit ? <CommitDetails commit={detailCommit} onClose={() => setDetailCommit(null)} /> : null}
    </div>
  );
}

function panelError(error: unknown, fallback: string, onUnauthorized?: () => void): string | null {
  if (isUnauthorized(error)) {
    onUnauthorized?.();
    return onUnauthorized ? null : "Session expired. Sign in again.";
  }
  return error instanceof Error ? error.message : fallback;
}
