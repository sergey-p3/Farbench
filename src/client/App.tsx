import { useEffect, useMemo, useState } from "react";
import type { BrowserLayout, Session, Workspace } from "../shared/types.js";
import { api } from "./api.js";
import { Dashboard } from "./components/Dashboard.js";
import { Login } from "./components/Login.js";
import { defaultLayout, loadLayout, saveLayout } from "./layoutStore.js";

const tabs: BrowserLayout["split"][] = ["terminal", "files", "git", "preview"];

const placeholderText: Record<BrowserLayout["split"], string> = {
  terminal: "Terminal panel will appear here.",
  files: "File browser and editor will appear here.",
  git: "Git status and diff tools will appear here.",
  preview: "Preview controls will appear here.",
};

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [layout, setLayout] = useState<BrowserLayout>(() => loadLayout());
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === layout.selectedWorkspaceId) ?? null,
    [layout.selectedWorkspaceId, workspaces],
  );
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === layout.selectedSessionId) ?? null,
    [layout.selectedSessionId, sessions],
  );

  useEffect(() => {
    saveLayout(layout);
  }, [layout]);

  async function loadWorkspaces() {
    setIsLoading(true);
    setError(null);

    try {
      const nextWorkspaces = await api.workspaces();
      setWorkspaces(nextWorkspaces);

      const remembered = layout.selectedWorkspaceId;
      const nextWorkspace = nextWorkspaces.find((workspace) => workspace.id === remembered) ?? nextWorkspaces[0] ?? null;

      setLayout((current) => ({
        ...current,
        selectedWorkspaceId: nextWorkspace?.id ?? null,
        selectedSessionId: nextWorkspace ? current.selectedSessionId : null,
      }));

      if (nextWorkspace) {
        await loadSessions(nextWorkspace.id, layout.selectedSessionId);
      } else {
        setSessions([]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load workspaces");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadSessions(workspaceId: string, preferredSessionId?: string | null) {
    const nextSessions = await api.sessions(workspaceId);
    const nextSession = nextSessions.find((session) => session.id === preferredSessionId) ?? nextSessions[0] ?? null;

    setSessions(nextSessions);
    setLayout((current) => ({
      ...current,
      selectedWorkspaceId: workspaceId,
      selectedSessionId: nextSession?.id ?? null,
    }));
  }

  async function selectWorkspace(workspaceId: string) {
    setError(null);
    try {
      await loadSessions(workspaceId, null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load sessions");
    }
  }

  function selectSession(sessionId: string) {
    setLayout((current) => ({ ...current, selectedSessionId: sessionId }));
  }

  async function sessionsChanged(selectedSessionId?: string) {
    if (!layout.selectedWorkspaceId) return;
    setError(null);
    try {
      await loadSessions(layout.selectedWorkspaceId, selectedSessionId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to refresh sessions");
    }
  }

  function selectTab(split: BrowserLayout["split"]) {
    setLayout((current) => ({ ...current, split }));
  }

  if (!isAuthenticated) {
    return <Login onLogin={() => {
      setIsAuthenticated(true);
      void loadWorkspaces();
    }} />;
  }

  return (
    <main className="app-shell">
      <Dashboard
        workspaces={workspaces}
        sessions={sessions}
        selectedWorkspaceId={layout.selectedWorkspaceId}
        selectedSessionId={layout.selectedSessionId}
        onSelectWorkspace={(workspaceId) => void selectWorkspace(workspaceId)}
        onSelectSession={selectSession}
        onSessionsChanged={(selectedSessionId) => void sessionsChanged(selectedSessionId)}
      />

      <section className="workspace-panel" aria-label="Workspace">
        <header className="top-bar">
          <div>
            <p className="eyebrow">Workspace</p>
            <h1>{selectedWorkspace?.name ?? "No workspace selected"}</h1>
          </div>
          <div className="session-chip">{selectedSession ? `${selectedSession.type}: ${selectedSession.name}` : "No session"}</div>
        </header>

        {error ? <p className="shell-error" role="alert">{error}</p> : null}
        {isLoading ? <p className="loading-state">Loading workspaces...</p> : null}

        <nav className="tabs" aria-label="Workspace tools">
          {tabs.map((tab) => (
            <button
              aria-current={layout.split === tab ? "page" : undefined}
              className={layout.split === tab ? "tab active" : "tab"}
              key={tab}
              onClick={() => selectTab(tab)}
              type="button"
            >
              {tab}
            </button>
          ))}
        </nav>

        <div className="placeholder-panel">
          <h2>{layout.split}</h2>
          <p>{placeholderText[layout.split]}</p>
        </div>
      </section>
    </main>
  );
}

export default App;
