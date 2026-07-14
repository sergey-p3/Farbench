import type { RefObject } from "react";
import type { GitCommit, GitFileDiffResponse } from "../../../shared/types.js";
import { GitDiffViewer, type GitDiffViewerHandle } from "../GitDiffViewer.js";
import type { ChangeGroup, DisplayedChange } from "./gitPanelTypes.js";

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
}: {
  busyPath: string | null;
  changeGroups: ChangeGroup[];
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
}) {
  return (
    <div className={selectedPath ? "git-files-view git-file-selected" : "git-files-view"} role="tabpanel" aria-label="Files view">
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
                <div className="git-change-group-heading"><strong>{group.label}</strong><span>{group.changes.length}</span></div>
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
        <small className="git-file-status">
          <span>{change.status}</span>
          <span aria-label={`${change.additions} lines added, ${change.deletions} lines removed`} className="git-file-line-stats">
            <span className="git-additions">+{change.additions}</span>
            <span className="git-deletions">-{change.deletions}</span>
          </span>
        </small>
      </button>
      {!isCommitFile ? (
        <span className="git-file-row-actions">
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
        </span>
      ) : null}
    </div>
  );
}
