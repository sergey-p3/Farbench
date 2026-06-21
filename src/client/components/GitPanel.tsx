import { useEffect, useRef, useState } from "react";
import type { GitChange, Workspace } from "../../shared/types.js";
import { api, isUnauthorized } from "../api.js";

interface GitPanelProps {
  workspace: Workspace | null;
}

export function GitPanel({ workspace }: GitPanelProps) {
  const workspaceIdRef = useRef<string | null>(workspace?.id ?? null);
  const selectedPathRef = useRef<string | null>(null);
  const statusRequestRef = useRef(0);
  const diffRequestRef = useRef(0);
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  useEffect(() => {
    workspaceIdRef.current = workspace?.id ?? null;
    statusRequestRef.current += 1;
    diffRequestRef.current += 1;
    setChanges([]);
    setSelectedPath(null);
    setDiff("");
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
        setDiff("");
        diffRequestRef.current += 1;
      }
    } catch (statusError) {
      if (!isCurrentStatusRequest(workspaceId, requestId)) return;
      setError(panelError(statusError, "Unable to load git status"));
    } finally {
      if (isCurrentStatusRequest(workspaceId, requestId)) setIsLoading(false);
    }
  }

  async function loadDiff(change: GitChange) {
    if (!workspace || !change.diffAvailable) return;
    const workspaceId = workspace.id;
    const path = change.path;
    const requestId = ++diffRequestRef.current;
    setSelectedPath(change.path);
    selectedPathRef.current = change.path;
    setDiff("");
    setIsLoadingDiff(true);
    setError(null);
    try {
      const nextDiff = await api.gitDiff(workspaceId, path);
      if (!isCurrentDiffRequest(workspaceId, path, requestId)) return;
      setDiff(nextDiff);
    } catch (diffError) {
      if (!isCurrentDiffRequest(workspaceId, path, requestId)) return;
      setError(panelError(diffError, "Unable to load diff"));
    } finally {
      if (isCurrentDiffRequest(workspaceId, path, requestId)) setIsLoadingDiff(false);
    }
  }

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

  return (
    <div className="tool-panel git-panel">
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
        <pre className="diff-output">{isLoadingDiff ? "Loading diff..." : diff || "Select a changed file to view its diff."}</pre>
      </section>
    </div>
  );
}

function panelError(error: unknown, fallback: string): string {
  if (isUnauthorized(error)) return "Session expired. Sign in again.";
  return error instanceof Error ? error.message : fallback;
}
