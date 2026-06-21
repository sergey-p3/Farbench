import { useEffect, useMemo, useRef, useState } from "react";
import type { BrowserLayout, SessionType, Workspace, WorkspaceItem } from "../../shared/types.js";
import { api, isUnauthorized } from "../api.js";
import {
  activeItem,
  addItemAndFocus,
  focusItem,
  itemsForWorkspace,
  normalizeLayout,
  reconcileSessions,
} from "../itemLayout.js";
import { loadLayout, saveLayout } from "../layoutStore.js";
import { CreateItemSheet } from "./CreateItemSheet.js";
import { ItemSwitcher } from "./ItemSwitcher.js";
import { PaneHost } from "./PaneHost.js";

interface WorkspaceShellProps {
  onUnauthorized: () => void;
}

export function WorkspaceShell({ onUnauthorized }: WorkspaceShellProps) {
  const [layout, setLayout] = useState<BrowserLayout>(() => loadLayout());
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const requestRef = useRef(0);
  const selectedWorkspaceIdRef = useRef(layout.selectedWorkspaceId);

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === layout.selectedWorkspaceId) ?? null,
    [layout.selectedWorkspaceId, workspaces],
  );
  const active = activeItem(layout);
  const visibleItems = itemsForWorkspace(layout, layout.selectedWorkspaceId);

  useEffect(() => {
    saveLayout(layout);
    selectedWorkspaceIdRef.current = layout.selectedWorkspaceId;
  }, [layout]);

  useEffect(() => {
    void loadWorkspaces();
  }, []);

  async function loadWorkspaces() {
    const requestId = nextRequestId();
    setIsLoading(true);
    setError(null);
    try {
      const nextWorkspaces = await api.workspaces();
      if (!isCurrentRequest(requestId)) return;
      setWorkspaces(nextWorkspaces);
      const preferredWorkspaceId = selectedWorkspaceIdRef.current;
      const nextWorkspace = nextWorkspaces.find((workspace) => workspace.id === preferredWorkspaceId) ?? nextWorkspaces[0] ?? null;
      if (!nextWorkspace) {
        setLayout((current) => normalizeLayout({ ...current, selectedWorkspaceId: null, items: [], panes: [{ id: "main", activeItemId: null, itemIds: [] }] }));
        return;
      }
      await loadSessionsForWorkspace(nextWorkspace.id, requestId);
    } catch (loadError) {
      const message = handleApiError(loadError, "Unable to load workspaces");
      if (message) setError(message);
    } finally {
      if (isCurrentRequest(requestId)) setIsLoading(false);
    }
  }

  async function selectWorkspace(workspaceId: string) {
    const requestId = nextRequestId();
    selectedWorkspaceIdRef.current = workspaceId;
    setLayout((current) => normalizeLayout({ ...current, selectedWorkspaceId: workspaceId }));
    setIsSwitcherOpen(false);
    setError(null);
    setIsLoading(true);
    try {
      await loadSessionsForWorkspace(workspaceId, requestId);
    } catch (loadError) {
      const message = handleApiError(loadError, "Unable to load sessions");
      if (message) setError(message);
    } finally {
      if (isCurrentRequest(requestId)) setIsLoading(false);
    }
  }

  async function loadSessionsForWorkspace(workspaceId: string, requestId: number) {
    const sessions = await api.sessions(workspaceId);
    if (!isCurrentRequest(requestId)) return;
    selectedWorkspaceIdRef.current = workspaceId;
    setLayout((current) => reconcileSessions(current, workspaceId, sessions));
  }

  async function createSession(type: SessionType) {
    if (!layout.selectedWorkspaceId) return;
    const workspaceId = layout.selectedWorkspaceId;
    try {
      const session = await api.createSession(workspaceId, type, `${type} session`);
      const requestId = nextRequestId();
      selectedWorkspaceIdRef.current = workspaceId;
      const sessions = await api.sessions(workspaceId);
      if (!isCurrentRequest(requestId)) return;
      setLayout((current) => focusItem(reconcileSessions(current, workspaceId, sessions), `session:${session.id}`));
    } catch (createError) {
      const message = handleApiError(createError, "Unable to create session");
      if (message) throw new Error(message);
    }
  }

  function createBrowserItem(item: WorkspaceItem) {
    setLayout((current) => addItemAndFocus(current, item));
  }

  function focusExistingItem(itemId: string) {
    setLayout((current) => focusItem(current, itemId));
    setIsSwitcherOpen(false);
  }

  function nextRequestId(): number {
    requestRef.current += 1;
    return requestRef.current;
  }

  function isCurrentRequest(requestId: number): boolean {
    return requestId === requestRef.current;
  }

  function handleApiError(loadError: unknown, fallbackMessage: string): string | null {
    if (isUnauthorized(loadError)) {
      onUnauthorized();
      return null;
    }
    return loadError instanceof Error ? loadError.message : fallbackMessage;
  }

  return (
    <main className="app-shell item-shell">
      <section className="workspace-panel focused-shell" aria-label="Workspace">
        <header className="top-bar shell-top-bar">
          <button className="icon-button" aria-label="Open item switcher" onClick={() => setIsSwitcherOpen(true)} type="button">☰</button>
          <div className="top-bar-title">
            <p className="eyebrow">{selectedWorkspace?.name ?? "Workspace"}</p>
            <h1>{active?.title ?? "No item open"}</h1>
          </div>
          <span className="session-chip">{active ? `${active.kind} · ${active.status}` : "Empty"}</span>
          <button className="icon-button primary-icon" aria-label="Create item" onClick={() => setIsCreateOpen(true)} type="button">+</button>
        </header>

        {error ? <p className="shell-error" role="alert">{error}</p> : null}
        {isLoading ? <p className="loading-state">Loading workspace...</p> : null}

        <PaneHost layout={layout} workspace={selectedWorkspace} onOpenCreateSheet={() => setIsCreateOpen(true)} />
      </section>

      <ItemSwitcher
        activeItemId={active?.id ?? null}
        isOpen={isSwitcherOpen}
        items={visibleItems}
        onClose={() => setIsSwitcherOpen(false)}
        onFocusItem={focusExistingItem}
        onSelectWorkspace={(workspaceId) => void selectWorkspace(workspaceId)}
        selectedWorkspace={selectedWorkspace}
        workspaces={workspaces}
      />

      <CreateItemSheet
        isOpen={isCreateOpen}
        items={visibleItems}
        onClose={() => setIsCreateOpen(false)}
        onCreateBrowserItem={createBrowserItem}
        onCreateSession={createSession}
        onFocusItem={focusExistingItem}
        workspaceId={layout.selectedWorkspaceId}
      />
    </main>
  );
}
