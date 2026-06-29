import { useEffect, useMemo, useRef, useState } from "react";
import type { BrowserLayout, SessionType, Workspace, WorkspaceItem } from "../../shared/types.js";
import { api, isUnauthorized } from "../api.js";
import {
  MAIN_PANE_ID,
  activeItem,
  addItemAndFocus,
  focusItem,
  itemsForWorkspace,
  normalizeLayout,
  reconcileSessions,
  removeItem,
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
  const [isTopMenuOpen, setIsTopMenuOpen] = useState(false);
  const [isTopMenuPinned, setIsTopMenuPinned] = useState(false);
  const requestRef = useRef(0);
  const selectedWorkspaceIdRef = useRef(layout.selectedWorkspaceId);

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === layout.selectedWorkspaceId) ?? null,
    [layout.selectedWorkspaceId, workspaces],
  );
  const currentActive = activeItem(layout);
  const active = currentActive?.workspaceId === layout.selectedWorkspaceId ? currentActive : null;
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
        setLayout((current) => normalizeLayout({ ...current, selectedWorkspaceId: null, items: [], panes: [{ id: MAIN_PANE_ID, activeItemId: null, itemIds: [] }] }));
        return;
      }
      selectedWorkspaceIdRef.current = nextWorkspace.id;
      setLayout((current) => normalizeLayout({ ...current, selectedWorkspaceId: nextWorkspace.id }));
      await loadSessionsForWorkspace(nextWorkspace.id, requestId);
    } catch (loadError) {
      const message = handleApiError(loadError, "Unable to load workspaces");
      if (message && isCurrentRequest(requestId)) setError(message);
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
      if (message && isCurrentWorkspaceRequest(workspaceId, requestId)) setError(message);
    } finally {
      if (isCurrentRequest(requestId)) setIsLoading(false);
    }
  }

  async function loadSessionsForWorkspace(workspaceId: string, requestId: number) {
    const sessions = await api.sessions(workspaceId);
    if (!isCurrentWorkspaceRequest(workspaceId, requestId)) return;
    selectedWorkspaceIdRef.current = workspaceId;
    setLayout((current) => reconcileSessions(current, workspaceId, sessions));
  }

  async function createSession(type: SessionType) {
    if (!layout.selectedWorkspaceId) return;
    const workspaceId = layout.selectedWorkspaceId;
    const requestId = nextRequestId();
    try {
      const session = await api.createSession(workspaceId, type, `${type} session`);
      if (!isCurrentWorkspaceRequest(workspaceId, requestId)) return;
      selectedWorkspaceIdRef.current = workspaceId;
      const sessions = await api.sessions(workspaceId);
      if (!isCurrentWorkspaceRequest(workspaceId, requestId)) return;
      setLayout((current) => focusItem(reconcileSessions(current, workspaceId, sessions), `session:${session.id}`));
      collapseUnpinnedTopMenu();
    } catch (createError) {
      const message = handleApiError(createError, "Unable to create session");
      if (message && isCurrentWorkspaceRequest(workspaceId, requestId)) throw new Error(message);
    }
  }

  function createBrowserItem(item: WorkspaceItem) {
    setLayout((current) => addItemAndFocus(current, item));
    collapseUnpinnedTopMenu();
  }

  function focusExistingItem(itemId: string) {
    setLayout((current) => focusItem(current, itemId));
    setIsSwitcherOpen(false);
    collapseUnpinnedTopMenu();
  }

  async function closeItem(item: WorkspaceItem) {
    setError(null);
    try {
      if ((item.kind === "agent" || item.kind === "terminal") && item.sessionId) {
        await api.killSession(item.workspaceId, item.sessionId);
      }
      setLayout((current) => removeItem(current, item.id));
    } catch (closeError) {
      const message = handleApiError(closeError, "Unable to close item");
      if (message) setError(message);
    }
  }

  function nextRequestId(): number {
    requestRef.current += 1;
    return requestRef.current;
  }

  function isCurrentRequest(requestId: number): boolean {
    return requestId === requestRef.current;
  }

  function isCurrentWorkspaceRequest(workspaceId: string, requestId: number): boolean {
    return isCurrentRequest(requestId) && selectedWorkspaceIdRef.current === workspaceId;
  }

  function handleApiError(loadError: unknown, fallbackMessage: string): string | null {
    if (isUnauthorized(loadError)) {
      onUnauthorized();
      return null;
    }
    return loadError instanceof Error ? loadError.message : fallbackMessage;
  }

  function toggleTopMenuPin() {
    setIsTopMenuPinned((current) => !current);
    setIsTopMenuOpen(true);
  }

  function collapseUnpinnedTopMenu() {
    if (!isTopMenuPinned) setIsTopMenuOpen(false);
  }

  const isTopMenuExpanded = isTopMenuPinned || isTopMenuOpen;

  return (
    <main className="app-shell item-shell">
      <section className={`workspace-panel focused-shell ${isTopMenuPinned ? "top-menu-pinned" : "top-menu-floating"}`} aria-label="Workspace">
        <header className={`top-bar shell-top-bar ${isTopMenuExpanded ? "top-menu-expanded" : "top-menu-collapsed"}`}>
          <button
            className="icon-button top-menu-toggle"
            aria-expanded={isTopMenuExpanded}
            aria-label={isTopMenuExpanded ? "Hide top menu" : "Show top menu"}
            onClick={() => {
              if (isTopMenuPinned) {
                setIsTopMenuPinned(false);
                setIsTopMenuOpen(false);
                return;
              }
              setIsTopMenuOpen((current) => !current);
            }}
            type="button"
          >
            ☰
          </button>
          {isTopMenuExpanded ? (
            <>
              <button className="icon-button" aria-label="Open item switcher" onClick={() => setIsSwitcherOpen(true)} type="button">⇄</button>
              <div className="top-bar-title">
                <p className="eyebrow">{selectedWorkspace?.name ?? "Workspace"}</p>
                <h1>{active?.title ?? "No item open"}</h1>
              </div>
              <span className="session-chip">{active ? `${active.kind} · ${active.status}` : "Empty"}</span>
              <button className="icon-button" aria-label={isTopMenuPinned ? "Unpin top menu" : "Pin top menu"} onClick={toggleTopMenuPin} type="button">⌖</button>
              <button className="icon-button primary-icon" aria-label="Create item" onClick={() => setIsCreateOpen(true)} type="button">+</button>
            </>
          ) : null}
        </header>

        {error ? (
          <div className="shell-error" role="alert">
            <span>{error}</span>
            <button onClick={() => void loadWorkspaces()} type="button">Retry</button>
          </div>
        ) : null}
        {isLoading ? <p className="loading-state">Loading workspace...</p> : null}

        <PaneHost
          layout={layout}
          workspace={selectedWorkspace}
          onOpenCreateSheet={() => setIsCreateOpen(true)}
          onUnauthorized={onUnauthorized}
        />

        {visibleItems.length > 0 ? (
          <nav className="tab-shortcut-rail" aria-label="Open item shortcuts">
            {visibleItems.map((item) => {
              const isActive = item.id === active?.id;
              return (
                <button
                  aria-current={isActive ? "page" : undefined}
                  aria-label={`Switch to ${item.title}`}
                  aria-pressed={isActive}
                  className={`tab-shortcut-button ${isActive ? "active" : ""}`}
                  key={item.id}
                  onClick={() => focusExistingItem(item.id)}
                  title={item.title}
                  type="button"
                >
                  {shortcutLabel(item)}
                </button>
              );
            })}
          </nav>
        ) : null}
      </section>

      <ItemSwitcher
        activeItemId={active?.id ?? null}
        isOpen={isSwitcherOpen}
        items={visibleItems}
        onClose={() => setIsSwitcherOpen(false)}
        onCloseItem={(item) => void closeItem(item)}
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

function shortcutLabel(item: WorkspaceItem): string {
  if (item.kind === "terminal") return "T";
  if (item.kind === "agent") return item.config?.runtime?.slice(0, 1).toUpperCase() ?? "A";
  if (item.kind === "files") return "F";
  if (item.kind === "git") return "G";
  if (item.kind === "preview") return "P";
  return item.title.slice(0, 1).toUpperCase();
}
