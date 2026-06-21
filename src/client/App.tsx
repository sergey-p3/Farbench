import { useEffect, useMemo, useRef, useState } from "react";
import type { BrowserLayout, Session, Workspace } from "../shared/types.js";
import { api, isUnauthorized } from "./api.js";
import { Dashboard } from "./components/Dashboard.js";
import { Login } from "./components/Login.js";
import { loadLayout, saveLayout } from "./layoutStore.js";

const tabs: BrowserLayout["split"][] = ["terminal", "files", "git", "preview"];

const placeholderText: Record<BrowserLayout["split"], string> = {
  terminal: "Terminal panel will appear here.",
  files: "File browser and editor will appear here.",
  git: "Git status and diff tools will appear here.",
  preview: "Preview controls will appear here.",
};

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [layout, setLayout] = useState<BrowserLayout>(() => loadLayout());
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRequestRef = useRef(0);
  const selectedWorkspaceIdRef = useRef(layout.selectedWorkspaceId);
  const selectedSessionIdRef = useRef(layout.selectedSessionId);

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

  useEffect(() => {
    selectedWorkspaceIdRef.current = layout.selectedWorkspaceId;
    selectedSessionIdRef.current = layout.selectedSessionId;
  }, [layout.selectedSessionId, layout.selectedWorkspaceId]);

  useEffect(() => {
    void bootstrapAuth();
  }, []);

  function resetToLogin() {
    setIsAuthenticated(false);
    setWorkspaces([]);
    setSessions([]);
    setError(null);
    selectedWorkspaceIdRef.current = null;
    selectedSessionIdRef.current = null;
  }

  function handleApiError(loadError: unknown, fallbackMessage: string): string | null {
    if (isUnauthorized(loadError)) {
      resetToLogin();
      return null;
    }
    return loadError instanceof Error ? loadError.message : fallbackMessage;
  }

  async function bootstrapAuth() {
    setIsBootstrapping(true);
    setError(null);

    try {
      await loadWorkspaces({ showLoading: false });
      setIsAuthenticated(true);
    } catch {
      resetToLogin();
    } finally {
      setIsBootstrapping(false);
    }
  }

  async function loadWorkspaces(options: { showLoading?: boolean } = {}) {
    const showLoading = options.showLoading ?? true;
    let sessionRequestId: number | null = null;
    let sessionWorkspaceId: string | null = null;
    if (showLoading) setIsLoading(true);
    setError(null);

    try {
      const nextWorkspaces = await api.workspaces();
      setWorkspaces(nextWorkspaces);

      const preferredWorkspaceId = selectedWorkspaceIdRef.current;
      const preferredSessionId = selectedSessionIdRef.current;
      const nextWorkspace =
        nextWorkspaces.find((workspace) => workspace.id === preferredWorkspaceId) ?? nextWorkspaces[0] ?? null;

      if (nextWorkspace) {
        selectedWorkspaceIdRef.current = nextWorkspace.id;
        setLayout((current) => ({
          ...current,
          selectedWorkspaceId: nextWorkspace.id,
          selectedSessionId: nextWorkspace.id === current.selectedWorkspaceId ? current.selectedSessionId : null,
        }));
        sessionWorkspaceId = nextWorkspace.id;
        sessionRequestId = nextSessionRequest();
        await loadSessions(nextWorkspace.id, preferredSessionId, sessionRequestId);
      } else {
        setSessions([]);
        selectedWorkspaceIdRef.current = null;
        selectedSessionIdRef.current = null;
        setLayout((current) => ({
          ...current,
          selectedWorkspaceId: null,
          selectedSessionId: null,
        }));
      }
    } catch (loadError) {
      if (sessionRequestId !== null && sessionWorkspaceId !== null && !isCurrentSessionRequest(sessionWorkspaceId, sessionRequestId)) {
        return;
      }
      const message = handleApiError(loadError, "Unable to load workspaces");
      if (message) setError(message);
      throw loadError;
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }

  function nextSessionRequest(): number {
    sessionRequestRef.current += 1;
    return sessionRequestRef.current;
  }

  function isCurrentSessionRequest(workspaceId: string, requestId: number): boolean {
    return requestId === sessionRequestRef.current && selectedWorkspaceIdRef.current === workspaceId;
  }

  async function loadSessions(workspaceId: string, preferredSessionId: string | null | undefined, requestId: number) {
    const nextSessions = await api.sessions(workspaceId);
    if (!isCurrentSessionRequest(workspaceId, requestId)) {
      return;
    }

    const nextSession = nextSessions.find((session) => session.id === preferredSessionId) ?? nextSessions[0] ?? null;

    setSessions(nextSessions);
    selectedSessionIdRef.current = nextSession?.id ?? null;
    setLayout((current) => ({
      ...current,
      selectedWorkspaceId: workspaceId,
      selectedSessionId: nextSession?.id ?? null,
    }));
  }

  async function selectWorkspace(workspaceId: string) {
    setError(null);
    const requestId = nextSessionRequest();
    selectedWorkspaceIdRef.current = workspaceId;
    selectedSessionIdRef.current = null;
    setSessions([]);
    setLayout((current) => ({ ...current, selectedWorkspaceId: workspaceId, selectedSessionId: null }));
    try {
      await loadSessions(workspaceId, null, requestId);
    } catch (loadError) {
      if (!isCurrentSessionRequest(workspaceId, requestId)) return;
      const message = handleApiError(loadError, "Unable to load sessions");
      if (message) setError(message);
    }
  }

  function selectSession(sessionId: string) {
    selectedSessionIdRef.current = sessionId;
    setLayout((current) => ({ ...current, selectedSessionId: sessionId }));
  }

  async function sessionsChanged(workspaceId: string, selectedSessionId?: string) {
    if (selectedWorkspaceIdRef.current !== workspaceId) return;
    const requestId = nextSessionRequest();
    setError(null);
    try {
      await loadSessions(workspaceId, selectedSessionId, requestId);
    } catch (loadError) {
      if (!isCurrentSessionRequest(workspaceId, requestId)) return;
      const message = handleApiError(loadError, "Unable to refresh sessions");
      if (message) setError(message);
      throw loadError;
    }
  }

  function selectTab(split: BrowserLayout["split"]) {
    setLayout((current) => ({ ...current, split }));
  }

  if (isBootstrapping) {
    return <main className="login-screen"><p className="loading-state">Checking session...</p></main>;
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
        onSessionsChanged={sessionsChanged}
        onUnauthorized={resetToLogin}
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
