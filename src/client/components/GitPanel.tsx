import { useCallback, useEffect, useRef, useState, type PointerEvent, type TouchEvent } from "react";
import type { GitChange, GitFileDiffResponse, Workspace } from "../../shared/types.js";
import { api, isUnauthorized } from "../api.js";
import { nextDiffFileIndex, shouldCollapseGitFileList } from "../gitDiffView.js";
import { GitDiffViewer, type GitDiffViewerHandle } from "./GitDiffViewer.js";

interface GitPanelProps {
  workspace: Workspace | null;
  onUnauthorized?: () => void;
}

export function GitPanel({ workspace, onUnauthorized }: GitPanelProps) {
  const workspaceIdRef = useRef<string | null>(workspace?.id ?? null);
  const selectedPathRef = useRef<string | null>(null);
  const diffViewerRef = useRef<GitDiffViewerHandle | null>(null);
  const skipNextDiffControlClickRef = useRef(false);
  const statusRequestRef = useRef(0);
  const diffRequestRef = useRef(0);
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<GitFileDiffResponse | null>(null);
  const [initialChangeDirection, setInitialChangeDirection] = useState<1 | -1 | null>(null);
  const [isFileListCollapsed, setIsFileListCollapsed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  useEffect(() => {
    function updateFileListLayout() {
      setIsFileListCollapsed(shouldCollapseGitFileList(window.innerWidth, selectedPathRef.current));
    }

    updateFileListLayout();
    window.addEventListener("resize", updateFileListLayout);
    return () => window.removeEventListener("resize", updateFileListLayout);
  }, []);

  useEffect(() => {
    setIsFileListCollapsed(shouldCollapseGitFileList(window.innerWidth, selectedPath));
  }, [selectedPath]);

  useEffect(() => {
    workspaceIdRef.current = workspace?.id ?? null;
    statusRequestRef.current += 1;
    diffRequestRef.current += 1;
    setChanges([]);
    setSelectedPath(null);
    setDiff(null);
    setInitialChangeDirection(null);
    setIsLoading(false);
    setIsLoadingDiff(false);
    setError(null);
    if (!workspace) return;
    void refreshStatus(workspace.id, statusRequestRef.current);
  }, [workspace?.id]);

  async function refreshStatus(workspaceId = workspace?.id, requestId = ++statusRequestRef.current) {
    if (!workspaceId) return;
    setIsLoading(true);
    setError(null);
    try {
      const status = await api.gitStatus(workspaceId);
      if (!isCurrentStatusRequest(workspaceId, requestId)) return;
      setChanges(status.changes);
      const currentSelectedPath = selectedPathRef.current;
      if (currentSelectedPath && !status.changes.some((change) => change.path === currentSelectedPath)) {
        setSelectedPath(null);
        setDiff(null);
        diffRequestRef.current += 1;
      }
    } catch (statusError) {
      if (!isCurrentStatusRequest(workspaceId, requestId)) return;
      const message = panelError(statusError, "Unable to load git status", onUnauthorized);
      if (message) setError(message);
    } finally {
      if (isCurrentStatusRequest(workspaceId, requestId)) setIsLoading(false);
    }
  }

  async function loadDiff(change: GitChange, boundaryChangeDirection: 1 | -1 | null = null): Promise<boolean> {
    if (!workspace || !change.diffAvailable) return false;
    const workspaceId = workspace.id;
    const path = change.path;
    const requestId = ++diffRequestRef.current;
    setSelectedPath(change.path);
    selectedPathRef.current = change.path;
    setDiff(null);
    setInitialChangeDirection(null);
    setIsLoadingDiff(true);
    setError(null);
    try {
      const nextDiff = await api.gitFileDiff(workspaceId, path);
      if (!isCurrentDiffRequest(workspaceId, path, requestId)) return false;
      setDiff(nextDiff);
      setInitialChangeDirection(boundaryChangeDirection);
      return true;
    } catch (diffError) {
      if (!isCurrentDiffRequest(workspaceId, path, requestId)) return false;
      const message = panelError(diffError, "Unable to load diff", onUnauthorized);
      if (message) setError(message);
      return false;
    } finally {
      if (isCurrentDiffRequest(workspaceId, path, requestId)) setIsLoadingDiff(false);
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

  function loadAdjacentFile(direction: 1 | -1 = 1, boundaryChangeDirection: 1 | -1 | null = null) {
    const nextIndex = nextDiffFileIndex(changes, selectedPath, direction);
    if (nextIndex === null) return;
    void loadDiff(changes[nextIndex], boundaryChangeDirection);
  }

  function showAdjacentChange(direction: 1 | -1) {
    if (diffViewerRef.current?.showAdjacentChange(direction)) return;
    loadAdjacentFile(direction, direction);
  }

  function copyReference() {
    void diffViewerRef.current?.copyLocation();
  }

  const preserveDiffControlFocus = useCallback((event: PointerEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => {
    event.preventDefault();
  }, []);

  const activateDiffControlOnTouchEnd = useCallback((event: TouchEvent<HTMLButtonElement>, action: () => void) => {
    event.preventDefault();
    skipNextDiffControlClickRef.current = true;
    action();
  }, []);

  const diffControlHandlers = useCallback((action: () => void) => ({
    onClick: () => {
      if (skipNextDiffControlClickRef.current) {
        skipNextDiffControlClickRef.current = false;
        return;
      }
      action();
    },
    onPointerDown: preserveDiffControlFocus,
    onTouchEnd: (event: TouchEvent<HTMLButtonElement>) => activateDiffControlOnTouchEnd(event, action),
    onTouchStart: preserveDiffControlFocus,
  }), [activateDiffControlOnTouchEnd, preserveDiffControlFocus]);

  function isCurrentStatusRequest(workspaceId: string, requestId: number): boolean {
    return workspaceIdRef.current === workspaceId && statusRequestRef.current === requestId;
  }

  function isCurrentDiffRequest(workspaceId: string, path: string, requestId: number): boolean {
    return workspaceIdRef.current === workspaceId && selectedPathRef.current === path && diffRequestRef.current === requestId;
  }

  if (!workspace) {
    return (
      <div className="tool-panel empty-tool">
        <p className="empty-state">Select a workspace to inspect git changes.</p>
      </div>
    );
  }

  const selectedChange = changes.find((change) => change.path === selectedPath) ?? null;
  const panelClassName = isFileListCollapsed ? "tool-panel git-panel git-panel-diff-focused" : "tool-panel git-panel";

  return (
    <div className={panelClassName}>
      <aside className="git-change-list" aria-label="Git changes">
        <div className="panel-toolbar">
          <strong>Changes</strong>
          <button disabled={isLoading} onClick={() => void refreshStatus()} type="button">
            Refresh
          </button>
        </div>
        {isLoading ? <p className="loading-state compact">Loading status...</p> : null}
        <div className="file-buttons">
          {changes.map((change) => (
            <button
              className={change.path === selectedPath ? "file-button selected" : "file-button"}
              disabled={!change.diffAvailable}
              key={`${change.path}-${change.status}-${change.staged}`}
              onClick={() => void loadDiff(change)}
              title={change.path}
              type="button"
            >
              <span>{change.path}</span>
              <small>{change.staged ? "staged" : "unstaged"} · {change.status}</small>
            </button>
          ))}
        </div>
        {changes.length === 0 && !isLoading ? <p className="empty-state">No changes.</p> : null}
      </aside>

      <section className="diff-panel" aria-label="Git diff">
        <div className="panel-toolbar">
          <strong>{selectedPath ?? "No change selected"}</strong>
        </div>
        {error ? <p className="panel-error" role="alert">{error}</p> : null}
        <GitDiffViewer
          diff={diff}
          initialChangeDirection={initialChangeDirection}
          isLoading={isLoadingDiff}
          onInitialChangeShown={() => setInitialChangeDirection(null)}
          ref={diffViewerRef}
        />
        {selectedPath ? (
          <div className="git-mobile-control-plane" aria-label="Git diff mobile controls">
            <button aria-label="Show changed files" {...diffControlHandlers(clearSelection)} title="Show files" type="button">
              Files
            </button>
            <button
              aria-label="Previous change"
              disabled={isLoadingDiff}
              {...diffControlHandlers(() => showAdjacentChange(-1))}
              title="Previous change"
              type="button"
            >
              ↑
            </button>
            <button
              aria-label="Next change"
              disabled={isLoadingDiff}
              {...diffControlHandlers(() => showAdjacentChange(1))}
              title="Next change"
              type="button"
            >
              ↓
            </button>
            <button aria-label="Previous file" {...diffControlHandlers(() => loadAdjacentFile(-1))} title="Previous file" type="button">
              &lt;F
            </button>
            <button aria-label="Next file" {...diffControlHandlers(() => loadAdjacentFile(1))} title="Next file" type="button">
              F&gt;
            </button>
            <button aria-label="Copy file reference" {...diffControlHandlers(copyReference)} title="Copy reference" type="button">
              Ref
            </button>
            <button
              aria-label={selectedChange?.staged ? "Unstage unavailable" : "Stage unavailable"}
              disabled
              onPointerDown={preserveDiffControlFocus}
              onTouchStart={preserveDiffControlFocus}
              title={selectedChange?.staged ? "Unstage unavailable" : "Stage unavailable"}
              type="button"
            >
              {selectedChange?.staged ? "U" : "S"}
            </button>
          </div>
        ) : null}
      </section>
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
