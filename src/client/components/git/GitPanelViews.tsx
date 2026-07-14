import type { RefObject } from "react";
import type {
  GitBranch,
  GitChange,
  GitCommit,
  GitCommitFile,
  GitFileDiffResponse,
} from "../../../shared/types.js";
import { GitDiffViewer, type GitDiffViewerHandle } from "../GitDiffViewer.js";

export type GitView = "files" | "history" | "branches";
export type DisplayedChange = GitChange | GitCommitFile;

interface GitNavigationProps {
  activeView: GitView;
  currentBranch: string;
  isLoading: boolean;
  onRefresh: () => void;
  onSelect: (view: GitView) => void;
}

export function GitNavigation({
  activeView,
  currentBranch,
  isLoading,
  onRefresh,
  onSelect,
}: GitNavigationProps) {
  return (
    <nav aria-label="Git views" className="git-view-tabs" role="tablist">
      <GitTab activeView={activeView} label="Files" view="files" onSelect={onSelect} />
      <GitTab activeView={activeView} label="History" view="history" onSelect={onSelect} />
      <GitTab activeView={activeView} label="Branches" view="branches" onSelect={onSelect} />
      <span className="git-current-branch" title={currentBranch}>{currentBranch || "Detached HEAD"}</span>
      <button className="git-refresh-button" disabled={isLoading} onClick={onRefresh} type="button">
        Refresh
      </button>
    </nav>
  );
}

interface GitFilesViewProps {
  busyPath: string | null;
  changeGroups: Array<{ label: string | null; changes: DisplayedChange[] }>;
  changes: DisplayedChange[];
  diff: GitFileDiffResponse | null;
  diffViewerRef: RefObject<GitDiffViewerHandle | null>;
  initialChangeDirection: 1 | -1 | null;
  isLoading: boolean;
  isLoadingDiff: boolean;
  onBack: () => void;
  onInitialChangeShown: () => void;
  onLoadDiff: (change: DisplayedChange) => void;
  onLoadFile: (direction: 1 | -1) => void;
  onSetStaged: (change: DisplayedChange) => void;
  onShowChange: (direction: 1 | -1) => void;
  onShowWorkingTree: () => void;
  selectedChange: DisplayedChange | null;
  selectedCommit: GitCommit | null;
  selectedPath: string | null;
}

export function GitFilesView({
  busyPath,
  changeGroups,
  changes,
  diff,
  diffViewerRef,
  initialChangeDirection,
  isLoading,
  isLoadingDiff,
  onBack,
  onInitialChangeShown,
  onLoadDiff,
  onLoadFile,
  onSetStaged,
  onShowChange,
  onShowWorkingTree,
  selectedChange,
  selectedCommit,
  selectedPath,
}: GitFilesViewProps) {
  return (
    <div
      className={selectedPath ? "git-files-view git-file-selected" : "git-files-view"}
      role="tabpanel"
      aria-label="Files view"
    >
      <aside className="git-change-list" aria-label="Git changes">
        <div className="panel-toolbar git-files-heading">
          <strong>{selectedCommit ? `Files in ${selectedCommit.shortId}` : "Working changes"}</strong>
          {selectedCommit ? <button onClick={onShowWorkingTree} type="button">Working tree</button> : null}
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
                <GitFileRow
                  busyPath={busyPath}
                  change={change}
                  isCommitFile={selectedCommit !== null}
                  key={`${change.path}-${change.status}-${change.staged}`}
                  onLoadDiff={onLoadDiff}
                  onSetStaged={onSetStaged}
                  selectedPath={selectedPath}
                />
              ))}
            </section>
          ) : null)}
        </div>
        {changes.length === 0 && !isLoading ? <p className="empty-state">No changes.</p> : null}
      </aside>

      {selectedPath ? (
        <section className="diff-panel" aria-label="Git diff">
          <div className="panel-toolbar">
            <button className="git-back-button" onClick={onBack} type="button">← Back to files</button>
            <strong>{selectedPath}</strong>
          </div>
          <div className="git-focus-actions" aria-label="Git diff navigation">
            <button disabled={isLoadingDiff} onClick={() => onShowChange(-1)} title="Previous change" type="button">↑ Change</button>
            <button disabled={isLoadingDiff} onClick={() => onShowChange(1)} title="Next change" type="button">↓ Change</button>
            <button disabled={isLoadingDiff} onClick={() => onLoadFile(-1)} title="Previous file" type="button">← File</button>
            <button disabled={isLoadingDiff} onClick={() => onLoadFile(1)} title="Next file" type="button">File →</button>
            <button disabled={!diff || isLoadingDiff} onClick={() => void diffViewerRef.current?.copyLocation()} type="button">Copy reference</button>
            {!selectedCommit && selectedChange ? (
              <button disabled={busyPath !== null} onClick={() => onSetStaged(selectedChange)} type="button">
                {busyPath === selectedChange.path ? "Working…" : selectedChange.staged ? "− Unstage" : "+ Stage"}
              </button>
            ) : null}
          </div>
          <GitDiffViewer
            diff={diff}
            initialChangeDirection={initialChangeDirection}
            isLoading={isLoadingDiff}
            onInitialChangeShown={onInitialChangeShown}
            ref={diffViewerRef}
          />
        </section>
      ) : null}
    </div>
  );
}

function GitFileRow({
  busyPath,
  change,
  isCommitFile,
  onLoadDiff,
  onSetStaged,
  selectedPath,
}: {
  busyPath: string | null;
  change: DisplayedChange;
  isCommitFile: boolean;
  onLoadDiff: (change: DisplayedChange) => void;
  onSetStaged: (change: DisplayedChange) => void;
  selectedPath: string | null;
}) {
  return (
    <div className="git-file-row">
      <button
        className={change.path === selectedPath ? "file-button selected" : "file-button"}
        disabled={!change.diffAvailable}
        onClick={() => onLoadDiff(change)}
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
        {!isCommitFile ? (
          <button
            aria-label={`${change.staged ? "Unstage" : "Stage"} ${change.path}`}
            className="git-stage-button"
            disabled={busyPath !== null}
            onClick={() => onSetStaged(change)}
            title={change.staged ? "Unstage file" : "Stage file"}
            type="button"
          >
            {busyPath === change.path ? "Working…" : change.staged ? "− Unstage" : "+ Stage"}
          </button>
        ) : null}
      </span>
    </div>
  );
}

export function GitHistoryView({
  commits,
  isLoading,
  onSelectCommit,
  onShowDetails,
}: {
  commits: GitCommit[];
  isLoading: boolean;
  onSelectCommit: (commit: GitCommit) => void;
  onShowDetails: (commit: GitCommit) => void;
}) {
  return (
    <section className="git-list-view" role="tabpanel" aria-label="Git history">
      {isLoading ? <p className="loading-state compact">Loading history...</p> : null}
      <div className="git-history-list">
        {commits.map((commit) => (
          <article className="git-history-row" key={commit.id}>
            <button className="git-history-main" onClick={() => onSelectCommit(commit)} type="button">
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
              onClick={() => onShowDetails(commit)}
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
  );
}

export function GitBranchesView({
  baseBranch,
  branches,
  isLoading,
  onSwitchBranch,
  switchingBranch,
}: {
  baseBranch: string;
  branches: GitBranch[];
  isLoading: boolean;
  onSwitchBranch: (branch: GitBranch) => void;
  switchingBranch: string | null;
}) {
  return (
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
            onClick={() => onSwitchBranch(branch)}
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
  );
}

export function CommitDetails({ commit, onClose }: { commit: GitCommit; onClose: () => void }) {
  return (
    <div className="git-dialog-backdrop" onClick={onClose}>
      <section
        aria-label="Commit information"
        aria-modal="true"
        className="git-commit-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="git-dialog-header">
          <strong>Commit information</strong>
          <button aria-label="Close commit information" onClick={onClose} type="button">×</button>
        </div>
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
