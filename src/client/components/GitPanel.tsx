import { useEffect, useState } from "react";
import type { GitChange, Workspace } from "../../shared/types.js";
import { api, isUnauthorized } from "../api.js";

interface GitPanelProps {
  workspace: Workspace | null;
}

export function GitPanel({ workspace }: GitPanelProps) {
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setChanges([]);
    setSelectedPath(null);
    setDiff("");
    setError(null);
    if (!workspace) return;
    void refreshStatus();
  }, [workspace?.id]);

  async function refreshStatus() {
    if (!workspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const status = await api.gitStatus(workspace.id);
      setChanges(status.changes);
      if (selectedPath && !status.changes.some((change) => change.path === selectedPath)) {
        setSelectedPath(null);
        setDiff("");
      }
    } catch (statusError) {
      setError(panelError(statusError, "Unable to load git status"));
    } finally {
      setIsLoading(false);
    }
  }

  async function loadDiff(change: GitChange) {
    if (!workspace || !change.diffAvailable) return;
    setSelectedPath(change.path);
    setIsLoadingDiff(true);
    setError(null);
    try {
      setDiff(await api.gitDiff(workspace.id, change.path));
    } catch (diffError) {
      setError(panelError(diffError, "Unable to load diff"));
    } finally {
      setIsLoadingDiff(false);
    }
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
