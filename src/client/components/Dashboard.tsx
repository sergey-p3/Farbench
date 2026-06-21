import type { Session, SessionType, Workspace } from "../../shared/types.js";
import { api } from "../api.js";

interface DashboardProps {
  workspaces: Workspace[];
  sessions: Session[];
  selectedWorkspaceId: string | null;
  selectedSessionId: string | null;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onSessionsChanged: (selectedSessionId?: string) => void;
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
}: DashboardProps) {
  async function startSession(type: SessionType) {
    if (!selectedWorkspaceId) return;
    const session = await api.createSession(selectedWorkspaceId, type, `${type} session`);
    onSessionsChanged(session.id);
  }

  return (
    <aside className="dashboard" aria-label="Remote development dashboard">
      <section className="dashboard-section">
        <div className="section-title">
          <h2>Workspaces</h2>
          <span>{workspaces.length}</span>
        </div>
        <div className="list" role="list">
          {workspaces.map((workspace) => (
            <button
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
            <button disabled={!selectedWorkspaceId} key={type} onClick={() => void startSession(type)} type="button">
              {type}
            </button>
          ))}
        </div>
        <div className="list" role="list">
          {sessions.map((session) => (
            <button
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
