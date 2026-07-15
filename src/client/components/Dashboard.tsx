import { useState } from "react";
import type { Session, SessionType, Workspace } from "../../shared/types.js";
import { api, isUnauthorized } from "../api.js";

interface DashboardProps {
  workspaces: Workspace[];
  sessions: Session[];
  selectedWorkspaceId: string | null;
  selectedSessionId: string | null;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onSessionsChanged: (workspaceId: string, selectedSessionId?: string) => Promise<void>;
  onUnauthorized: () => void;
}

const sessionTypes: SessionType[] = ["bash", "codex", "claude"];

export function Dashboard({
  workspaces,
  sessions,
  selectedWorkspaceId,
  selectedSessionId,
  onSelectWorkspace,
  onSelectSession,
  onSessionsChanged,
  onUnauthorized,
}: DashboardProps) {
  const [createError, setCreateError] = useState<string | null>(null);
  const [creatingType, setCreatingType] = useState<SessionType | null>(null);

  async function startSession(type: SessionType) {
    if (!selectedWorkspaceId) return;
    setCreateError(null);
    setCreatingType(type);

    try {
      const session = await api.createSession(selectedWorkspaceId, type, `${type} session`);
      await onSessionsChanged(selectedWorkspaceId, session.id);
    } catch (error) {
      if (isUnauthorized(error)) {
        onUnauthorized();
        return;
      }
      setCreateError(error instanceof Error ? error.message : "Unable to start session");
    } finally {
      setCreatingType(null);
    }
  }

  return (
    <aside className="dashboard" aria-label="Farbench dashboard">
      <section className="dashboard-section">
        <div className="section-title">
          <h2>Workspaces</h2>
          <span>{workspaces.length}</span>
        </div>
        <div className="list" role="list">
          {workspaces.map((workspace) => (
            <button
              aria-pressed={workspace.id === selectedWorkspaceId}
              className={workspace.id === selectedWorkspaceId ? "list-item selected" : "list-item"}
              key={workspace.id}
              onClick={() => onSelectWorkspace(workspace.id)}
              type="button"
            >
              <span className="item-name">{workspace.name}</span>
              <span className="item-meta">{workspace.rootPath}</span>
            </button>
          ))}
          {workspaces.length === 0 ? <p className="empty-state">No workspaces available.</p> : null}
        </div>
      </section>

      <section className="dashboard-section">
        <div className="section-title">
          <h2>Sessions</h2>
          <span>{sessions.length}</span>
        </div>
        <div className="session-actions" aria-label="Start session">
          {sessionTypes.map((type) => (
            <button
              disabled={!selectedWorkspaceId || creatingType !== null}
              key={type}
              onClick={() => void startSession(type)}
              type="button"
            >
              {creatingType === type ? "starting" : type}
            </button>
          ))}
        </div>
        {createError ? <p className="dashboard-error" role="alert">{createError}</p> : null}
        <div className="list" role="list">
          {sessions.map((session) => (
            <button
              aria-pressed={session.id === selectedSessionId}
              className={session.id === selectedSessionId ? "list-item selected" : "list-item"}
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              type="button"
            >
              <span className="item-name">{session.name}</span>
              <span className="item-meta">{session.type} · {session.status}</span>
            </button>
          ))}
          {selectedWorkspaceId && sessions.length === 0 ? <p className="empty-state">No sessions yet.</p> : null}
        </div>
      </section>
    </aside>
  );
}
