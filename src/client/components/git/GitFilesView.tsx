import { useState, type RefObject } from "react";
import type { GitCommit, GitFileDiffResponse } from "../../../shared/types.js";
import { GitDiffViewer, type GitDiffViewerHandle } from "../GitDiffViewer.js";
import { buildGitFileTree, type GitFileTreeNode } from "./gitFileTree.js";
import type { ChangeGroup, DisplayedChange, GitFileViewMode } from "./gitPanelTypes.js";

export function GitFilesView({
  busyPath,
  changeGroups,
  changes,
  diff,
  diffViewerRef,
  fileViewMode,
  initialChangeDirection,
  isLoading,
  isLoadingDiff,
  onBack,
  onInitialChangeShown,
  onLoadDiff,
  onLoadFile,
  onFileViewModeChange,
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
  fileViewMode: GitFileViewMode;
  initialChangeDirection: 1 | -1 | null;
  isLoading: boolean;
  isLoadingDiff: boolean;
  onBack: () => void;
  onInitialChangeShown: () => void;
  onLoadDiff: (change: DisplayedChange) => void;
  onLoadFile: (direction: 1 | -1) => void;
  onFileViewModeChange: (mode: GitFileViewMode) => void;
  onSetStaged: (change: DisplayedChange) => void;
  onShowChange: (direction: 1 | -1) => void;
  onShowWorkingTree: () => void;
  selectedChange: DisplayedChange | null;
  selectedCommit: GitCommit | null;
  selectedPath: string | null;
}) {
  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(() => new Set());

  function toggleDirectory(path: string): void {
    setCollapsedDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <div className={selectedPath ? "git-files-view git-file-selected" : "git-files-view"} role="tabpanel" aria-label="Files view">
      <aside className="git-change-list" aria-label="Git changes">
        <div className="panel-toolbar git-files-heading">
          <strong>{selectedCommit ? `Files in ${selectedCommit.shortId}` : "Working changes"}</strong>
          <div className="git-files-heading-actions">
            {selectedCommit ? <button onClick={onShowWorkingTree} type="button">Working tree</button> : null}
            <div aria-label="File layout" className="segmented-control git-file-layout-toggle" role="group">
              <button aria-pressed={fileViewMode === "list"} onClick={() => onFileViewModeChange("list")} type="button">List</button>
              <button aria-pressed={fileViewMode === "tree"} onClick={() => onFileViewModeChange("tree")} type="button">Tree</button>
            </div>
          </div>
        </div>
        {isLoading ? <p className="loading-state compact">Loading files...</p> : null}
        <div className="file-buttons">
          {changeGroups.map((group) => group.changes.length > 0 ? (
            <section className="git-change-group" key={group.label ?? "commit-files"}>
              {group.label ? (
                <div className="git-change-group-heading"><strong>{group.label}</strong><span>{group.changes.length}</span></div>
              ) : null}
              {fileViewMode === "tree" ? (
                <div className="git-file-tree">
                  {buildGitFileTree(group.changes).map((node) => (
                    <GitTreeNode
                      busyPath={busyPath}
                      collapsedDirectories={collapsedDirectories}
                      collapseKeyPrefix={group.label ?? "commit-files"}
                      isCommitFile={selectedCommit !== null}
                      key={`${node.type}-${node.path}`}
                      node={node}
                      onLoadDiff={onLoadDiff}
                      onSetStaged={onSetStaged}
                      onToggleDirectory={toggleDirectory}
                      selectedPath={selectedPath}
                    />
                  ))}
                </div>
              ) : group.changes.map((change) => (
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

function GitTreeNode({
  busyPath,
  collapsedDirectories,
  collapseKeyPrefix,
  isCommitFile,
  node,
  onLoadDiff,
  onSetStaged,
  onToggleDirectory,
  selectedPath,
}: {
  busyPath: string | null;
  collapsedDirectories: Set<string>;
  collapseKeyPrefix: string;
  isCommitFile: boolean;
  node: GitFileTreeNode;
  onLoadDiff: (change: DisplayedChange) => void;
  onSetStaged: (change: DisplayedChange) => void;
  onToggleDirectory: (path: string) => void;
  selectedPath: string | null;
}) {
  if (node.type === "file") {
    return (
      <GitFileRow
        busyPath={busyPath}
        change={node.change}
        displayPath={node.name}
        isCommitFile={isCommitFile}
        onLoadDiff={onLoadDiff}
        onSetStaged={onSetStaged}
        selectedPath={selectedPath}
      />
    );
  }

  const collapseKey = `${collapseKeyPrefix}:${node.path}`;
  const collapsed = collapsedDirectories.has(collapseKey);
  return (
    <div className="git-tree-directory">
      <button
        aria-expanded={!collapsed}
        className="git-tree-directory-button"
        onClick={() => onToggleDirectory(collapseKey)}
        title={node.path}
        type="button"
      >
        <span aria-hidden="true" className="git-tree-chevron">{collapsed ? "›" : "⌄"}</span>
        <span>{node.name}</span>
      </button>
      {!collapsed ? (
        <div className="git-tree-directory-children">
          {node.children.map((child) => (
            <GitTreeNode
              busyPath={busyPath}
              collapsedDirectories={collapsedDirectories}
              collapseKeyPrefix={collapseKeyPrefix}
              isCommitFile={isCommitFile}
              key={`${child.type}-${child.path}`}
              node={child}
              onLoadDiff={onLoadDiff}
              onSetStaged={onSetStaged}
              onToggleDirectory={onToggleDirectory}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GitFileRow({
  busyPath,
  change,
  displayPath,
  isCommitFile,
  onLoadDiff,
  onSetStaged,
  selectedPath,
}: {
  busyPath: string | null;
  change: DisplayedChange;
  displayPath?: string;
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
        <span>{displayPath ?? change.path}</span>
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
