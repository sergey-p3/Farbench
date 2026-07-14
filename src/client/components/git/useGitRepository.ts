import { useEffect, useRef, useState } from "react";
import type { GitBranch, GitCommit, GitFileDiffResponse, Workspace } from "../../../shared/types.js";
import { api } from "../../api.js";
import { nextDiffFileIndex } from "../../gitDiffView.js";
import { apiErrorMessage } from "../apiError.js";
import type { GitDiffViewerHandle } from "../GitDiffViewer.js";
import type { ChangeGroup, DisplayedChange, GitView } from "./gitPanelTypes.js";

export function useGitRepository(workspace: Workspace | null, onUnauthorized?: () => void) {
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

  async function loadRepository(workspaceId = workspace?.id): Promise<void> {
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
    } catch (error) {
      if (isCurrentRepositoryRequest(workspaceId, requestId)) showError(error, "Unable to load repository");
    } finally {
      if (isCurrentRepositoryRequest(workspaceId, requestId)) setIsLoading(false);
    }
  }

  async function refreshCurrentView(): Promise<void> {
    if (!workspace) return;
    const workspaceId = workspace.id;
    setIsLoading(true);
    setError(null);
    try {
      if (activeView === "files") {
        const response = selectedCommit
          ? await api.gitCommitFiles(workspaceId, selectedCommit.id)
          : await api.gitStatus(workspaceId);
        if (workspaceIdRef.current === workspaceId) setChanges("files" in response ? response.files : response.changes);
      } else if (activeView === "history") {
        if (!currentBranch) return;
        const history = await api.gitHistory(workspaceId, currentBranch);
        if (workspaceIdRef.current === workspaceId) setCommits(history.commits);
      } else {
        const response = await api.gitBranches(workspaceId);
        if (workspaceIdRef.current !== workspaceId) return;
        setBranches(response.branches);
        setBaseBranch(response.baseBranch);
        setCurrentBranch(response.branches.find((branch) => branch.current)?.name ?? "");
      }
    } catch (error) {
      if (workspaceIdRef.current === workspaceId) showError(error, "Unable to refresh Git data");
    } finally {
      if (workspaceIdRef.current === workspaceId) setIsLoading(false);
    }
  }

  async function loadDiff(change: DisplayedChange, boundaryDirection: 1 | -1 | null = null): Promise<void> {
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
      setInitialChangeDirection(boundaryDirection);
    } catch (error) {
      if (isCurrentDiffRequest(workspaceId, path, requestId)) showError(error, "Unable to load diff");
    } finally {
      if (isCurrentDiffRequest(workspaceId, path, requestId)) setIsLoadingDiff(false);
    }
  }

  function loadAdjacentFile(direction: 1 | -1, boundaryDirection: 1 | -1 | null = null): void {
    const nextIndex = nextDiffFileIndex(changes, selectedPath, direction);
    if (nextIndex !== null) void loadDiff(changes[nextIndex], boundaryDirection);
  }

  function showAdjacentChange(direction: 1 | -1): void {
    if (!diffViewerRef.current?.showAdjacentChange(direction)) loadAdjacentFile(direction, direction);
  }

  async function setFileStaged(change: DisplayedChange): Promise<void> {
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
    } catch (error) {
      if (workspaceIdRef.current === workspaceId) {
        showError(error, change.staged ? "Unable to unstage file" : "Unable to stage file");
      }
    } finally {
      if (workspaceIdRef.current === workspaceId) setBusyPath(null);
    }
  }

  async function selectHistoryCommit(commit: GitCommit): Promise<void> {
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
      if (workspaceIdRef.current === workspaceId) setChanges(response.files);
    } catch (error) {
      if (workspaceIdRef.current === workspaceId) showError(error, "Unable to load commit files");
    } finally {
      if (workspaceIdRef.current === workspaceId) setIsLoading(false);
    }
  }

  async function showWorkingChanges(): Promise<void> {
    if (!workspace) return;
    const workspaceId = workspace.id;
    setSelectedCommit(null);
    clearSelection();
    setIsLoading(true);
    setError(null);
    try {
      const status = await api.gitStatus(workspaceId);
      if (workspaceIdRef.current === workspaceId) setChanges(status.changes);
    } catch (error) {
      if (workspaceIdRef.current === workspaceId) showError(error, "Unable to load Git status");
    } finally {
      if (workspaceIdRef.current === workspaceId) setIsLoading(false);
    }
  }

  async function switchBranch(branch: GitBranch): Promise<void> {
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
    } catch (error) {
      if (workspaceIdRef.current === workspaceId) showError(error, `Unable to switch to ${branch.name}`);
    } finally {
      if (workspaceIdRef.current === workspaceId) setSwitchingBranch(null);
    }
  }

  function clearSelection(): void {
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

  function showError(error: unknown, fallback: string): void {
    const message = apiErrorMessage(error, fallback, onUnauthorized);
    if (message) setError(message);
  }

  const changeGroups: ChangeGroup[] = selectedCommit
    ? [{ label: null, changes }]
    : [
        { label: "Staged", changes: changes.filter((change) => change.staged) },
        { label: "Unstaged", changes: changes.filter((change) => !change.staged) },
      ];

  return {
    activeView,
    baseBranch,
    branches,
    busyPath,
    changeGroups,
    changes,
    clearSelection,
    commits,
    currentBranch,
    detailCommit,
    diff,
    diffViewerRef,
    error,
    initialChangeDirection,
    isLoading,
    isLoadingDiff,
    loadAdjacentFile,
    loadDiff,
    refreshCurrentView,
    selectHistoryCommit,
    selectedChange: changes.find((change) => change.path === selectedPath) ?? null,
    selectedCommit,
    selectedPath,
    setActiveView,
    setDetailCommit,
    setFileStaged,
    setInitialChangeDirection,
    showAdjacentChange,
    showWorkingChanges,
    switchBranch,
    switchingBranch,
  };
}
