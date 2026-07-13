import { useEffect, useRef, useState } from "react";
import type {
  GitBranch,
  GitCommit,
  GitCommitFile,
  GitChange,
  GitFileDiffResponse,
  Workspace,
} from "../../shared/types.js";
import { api, isUnauthorized } from "../api.js";
import { nextDiffFileIndex } from "../gitDiffView.js";
import { GitDiffViewer, type GitDiffViewerHandle } from "./GitDiffViewer.js";

interface GitPanelProps {
  workspace: Workspace | null;
  onUnauthorized?: () => void;
}

type GitView = "files" | "history" | "branches";
type DisplayedChange = GitChange | GitCommitFile;

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
      <nav aria-label="Git views" className="git-view-tabs" role="tablist">
        <GitTab activeView={activeView} label="Files" view="files" onSelect={setActiveView} />
        <GitTab activeView={activeView} label="History" view="history" onSelect={setActiveView} />
        <GitTab activeView={activeView} label="Branches" view="branches" onSelect={setActiveView} />
        <span className="git-current-branch" title={currentBranch}>{currentBranch || "Detached HEAD"}</span>
        <button className="git-refresh-button" disabled={isLoading} onClick={() => void refreshCurrentView()} type="button">
          Refresh
        </button>
      </nav>

      {error ? <p className="panel-error git-panel-error" role="alert">{error}</p> : null}

      {activeView === "files" ? (
        <div
          className={selectedPath ? "git-files-view git-file-selected" : "git-files-view"}
          role="tabpanel"
          aria-label="Files view"
        >
          <aside className="git-change-list" aria-label="Git changes">
            <div className="panel-toolbar git-files-heading">
              <strong>{selectedCommit ? `Files in ${selectedCommit.shortId}` : "Working changes"}</strong>
              {selectedCommit ? <button onClick={() => void showWorkingChanges()} type="button">Working tree</button> : null}
            </div>
            {isLoading ? <p className="loading-state compact">Loading files...</p> : null}
            <div className="file-buttons">
              {changeGroups.map((group) => group.changes.length > 0 ? (
                <section className="git-change-group" key={group.label ?? "commit-files"}>
                  {group.label ? (
                    <div className="git-change-group-heading">
                      <strong>{group.label}</strong>
                      <span>{group.changes.length}</span>
                    </div>
                  ) : null}
                  {group.changes.map((change) => (
                    <div className="git-file-row" key={`${change.path}-${change.status}-${change.staged}`}>
                      <button
                        className={change.path === selectedPath ? "file-button selected" : "file-button"}
                        disabled={!change.diffAvailable}
                        onClick={() => void loadDiff(change)}
                        title={change.path}
                        type="button"
                      >
                        <span>{change.path}</span>
                        <small>{change.status}</small>
                      </button>
                      <span className="git-file-row-actions">
                        {"additions" in change ? (
                          <span
                            aria-label={`${change.additions} lines added, ${change.deletions} lines removed`}
                            className="git-file-line-stats"
                          >
                            <span className="git-additions">+{change.additions}</span>
                            <span className="git-deletions">-{change.deletions}</span>
                          </span>
                        ) : null}
                        {!selectedCommit ? (
                          <button
                            aria-label={`${change.staged ? "Unstage" : "Stage"} ${change.path}`}
                            className="git-stage-button"
                            disabled={busyPath !== null}
                            onClick={() => void setFileStaged(change)}
                            title={change.staged ? "Unstage file" : "Stage file"}
                            type="button"
                          >
                            {busyPath === change.path ? "Working…" : change.staged ? "− Unstage" : "+ Stage"}
                          </button>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </section>
              ) : null)}
            </div>
            {changes.length === 0 && !isLoading ? <p className="empty-state">No changes.</p> : null}
          </aside>

          {selectedPath ? <section className="diff-panel" aria-label="Git diff">
            <div className="panel-toolbar">
              <button className="git-back-button" onClick={clearSelection} type="button">← Back to files</button>
              <strong>{selectedPath}</strong>
            </div>
            <div className="git-focus-actions" aria-label="Git diff navigation">
              <button disabled={isLoadingDiff} onClick={() => showAdjacentChange(-1)} title="Previous change" type="button">↑ Change</button>
              <button disabled={isLoadingDiff} onClick={() => showAdjacentChange(1)} title="Next change" type="button">↓ Change</button>
              <button disabled={isLoadingDiff} onClick={() => loadAdjacentFile(-1)} title="Previous file" type="button">← File</button>
              <button disabled={isLoadingDiff} onClick={() => loadAdjacentFile(1)} title="Next file" type="button">File →</button>
              <button disabled={!diff || isLoadingDiff} onClick={() => void diffViewerRef.current?.copyLocation()} type="button">Copy reference</button>
              {!selectedCommit && selectedChange ? (
                <button
                  disabled={busyPath !== null}
                  onClick={() => void setFileStaged(selectedChange)}
                  type="button"
                >
                  {busyPath === selectedChange.path ? "Working…" : selectedChange.staged ? "− Unstage" : "+ Stage"}
                </button>
              ) : null}
            </div>
            <GitDiffViewer
              diff={diff}
              initialChangeDirection={initialChangeDirection}
              isLoading={isLoadingDiff}
              onInitialChangeShown={() => setInitialChangeDirection(null)}
              ref={diffViewerRef}
            />
          </section> : null}
        </div>
      ) : null}

      {activeView === "history" ? (
        <section className="git-list-view" role="tabpanel" aria-label="Git history">
          {isLoading ? <p className="loading-state compact">Loading history...</p> : null}
          <div className="git-history-list">
            {commits.map((commit) => (
              <article className="git-history-row" key={commit.id}>
                <button className="git-history-main" onClick={() => void selectHistoryCommit(commit)} type="button">
                  <span className="git-commit-title">{commit.title || "Untitled commit"}</span>
                  <span className="git-commit-meta">
                    <span className="git-commit-id">{commit.shortId}</span>
                    <span className="git-additions">+{commit.additions}</span>
                    <span className="git-deletions">-{commit.deletions}</span>
                  </span>
                </button>
                <button
                  aria-label={`Information for ${commit.title || commit.shortId}`}
                  className="git-info-button"
                  onClick={() => setDetailCommit(commit)}
                  title="Commit information"
                  type="button"
                >
                  i
                </button>
              </article>
            ))}
          </div>
          {commits.length === 0 && !isLoading ? <p className="empty-state">No commits on this branch.</p> : null}
        </section>
      ) : null}

      {activeView === "branches" ? (
        <section className="git-list-view" role="tabpanel" aria-label="Git branches">
          <div className="git-list-heading">
            <strong>Local branches</strong>
            <span>Compared with {baseBranch || "main"}</span>
          </div>
          {isLoading ? <p className="loading-state compact">Loading branches...</p> : null}
          <div className="git-branch-list">
            {branches.map((branch) => (
              <button
                aria-current={branch.current ? "true" : undefined}
                className={branch.current ? "git-branch-row current" : "git-branch-row"}
                disabled={branch.current || switchingBranch !== null}
                key={branch.name}
                onClick={() => void switchBranch(branch)}
                type="button"
              >
                <span className="git-branch-main">
                  <span className="git-branch-name">{branch.name}</span>
                  <small>Last commit {formatDate(branch.lastCommitAt)}</small>
                </span>
                <span className="git-branch-divergence">
                  <span className="git-additions">{branch.ahead} ahead</span>
                  <span className="git-deletions">{branch.behind} behind</span>
                  <small>{branch.current ? "Current" : switchingBranch === branch.name ? "Switching…" : "Switch"}</small>
                </span>
              </button>
            ))}
          </div>
          {branches.length === 0 && !isLoading ? <p className="empty-state">No local branches.</p> : null}
        </section>
      ) : null}

      {detailCommit ? <CommitDetails commit={detailCommit} onClose={() => setDetailCommit(null)} /> : null}
    </div>
  );
}

function GitTab({ activeView, label, onSelect, view }: {
  activeView: GitView;
  label: string;
  onSelect: (view: GitView) => void;
  view: GitView;
}) {
  return (
    <button
      aria-selected={activeView === view}
      className={activeView === view ? "active" : ""}
      onClick={() => onSelect(view)}
      role="tab"
      type="button"
    >
      {label}
    </button>
  );
}

function CommitDetails({ commit, onClose }: { commit: GitCommit; onClose: () => void }) {
  return (
    <div className="git-dialog-backdrop" onClick={onClose}>
      <section
        aria-label="Commit information"
        aria-modal="true"
        className="git-commit-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="git-dialog-header"><strong>Commit information</strong><button aria-label="Close commit information" onClick={onClose} type="button">×</button></div>
        <dl>
          <div><dt>Commit</dt><dd className="git-commit-hash">{commit.id}</dd></div>
          <div><dt>Author</dt><dd>{commit.authorName} &lt;{commit.authorEmail}&gt;</dd></div>
          <div><dt>Authored</dt><dd>{formatDateTime(commit.authoredAt)}</dd></div>
          <div><dt>Committed</dt><dd>{formatDateTime(commit.committedAt)}</dd></div>
          <div><dt>Lines changed</dt><dd><span className="git-additions">+{commit.additions}</span> <span className="git-deletions">-{commit.deletions}</span></dd></div>
          <div><dt>Message</dt><dd className="git-full-message">{commit.message || commit.title}</dd></div>
        </dl>
      </section>
    </div>
  );
}

function formatDate(value: string): string {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function formatDateTime(value: string): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(date);
}

function panelError(error: unknown, fallback: string, onUnauthorized?: () => void): string | null {
  if (isUnauthorized(error)) {
    onUnauthorized?.();
    return onUnauthorized ? null : "Session expired. Sign in again.";
  }
  return error instanceof Error ? error.message : fallback;
}
