import { useEffect, useMemo, useRef, useState } from "react";
import type { CodexPermissionLevel, SessionType, Workspace, WorkspaceItem } from "../../../shared/types.js";
import { api } from "../../api.js";
import {
  MAIN_PANE_ID,
  activeItem,
  addItemAndFocus,
  focusItem,
  itemsForWorkspace,
  normalizeLayout,
  reconcileSessions,
  removeItem,
} from "../../itemLayout.js";
import { loadLayout, saveLayout } from "../../layoutStore.js";
import { apiErrorMessage } from "../apiError.js";

export function useWorkspaceShell(onUnauthorized: () => void) {
  const [layout, setLayout] = useState(() => loadLayout());
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isTopMenuOpen, setIsTopMenuOpen] = useState(false);
  const [isTopMenuPinned, setIsTopMenuPinned] = useState(false);
  const [isShortcutRailOpen, setIsShortcutRailOpen] = useState(true);
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

  async function loadWorkspaces(): Promise<void> {
    const requestId = nextRequestId();
    setIsLoading(true);
    setError(null);
    try {
      const nextWorkspaces = await api.workspaces();
      if (!isCurrentRequest(requestId)) return;
      setWorkspaces(nextWorkspaces);
      const preferredId = selectedWorkspaceIdRef.current;
      const nextWorkspace = nextWorkspaces.find((candidate) => candidate.id === preferredId) ?? nextWorkspaces[0] ?? null;
      if (!nextWorkspace) {
        setLayout((current) => normalizeLayout({
          ...current,
          selectedWorkspaceId: null,
          items: [],
          panes: [{ id: MAIN_PANE_ID, activeItemId: null, itemIds: [] }],
        }));
        return;
      }
      selectedWorkspaceIdRef.current = nextWorkspace.id;
      setLayout((current) => normalizeLayout({ ...current, selectedWorkspaceId: nextWorkspace.id }));
      await loadSessionsForWorkspace(nextWorkspace.id, requestId);
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to load workspaces", onUnauthorized);
      if (message && isCurrentRequest(requestId)) setError(message);
    } finally {
      if (isCurrentRequest(requestId)) setIsLoading(false);
    }
  }

  async function selectWorkspace(workspaceId: string): Promise<void> {
    const requestId = nextRequestId();
    selectedWorkspaceIdRef.current = workspaceId;
    setLayout((current) => normalizeLayout({ ...current, selectedWorkspaceId: workspaceId }));
    setIsSwitcherOpen(false);
    setError(null);
    setIsLoading(true);
    try {
      await loadSessionsForWorkspace(workspaceId, requestId);
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to load sessions", onUnauthorized);
      if (message && isCurrentWorkspaceRequest(workspaceId, requestId)) setError(message);
    } finally {
      if (isCurrentRequest(requestId)) setIsLoading(false);
    }
  }

  async function loadSessionsForWorkspace(workspaceId: string, requestId: number): Promise<void> {
    const sessions = await api.sessions(workspaceId);
    if (!isCurrentWorkspaceRequest(workspaceId, requestId)) return;
    selectedWorkspaceIdRef.current = workspaceId;
    setLayout((current) => reconcileSessions(current, workspaceId, sessions));
  }

  async function createSession(type: SessionType, permission?: CodexPermissionLevel): Promise<void> {
    if (!layout.selectedWorkspaceId) return;
    const workspaceId = layout.selectedWorkspaceId;
    const requestId = nextRequestId();
    try {
      const session = await api.createSession(workspaceId, type, `${type} session`, permission);
      if (!isCurrentWorkspaceRequest(workspaceId, requestId)) return;
      selectedWorkspaceIdRef.current = workspaceId;
      const sessions = await api.sessions(workspaceId);
      if (!isCurrentWorkspaceRequest(workspaceId, requestId)) return;
      setLayout((current) => focusItem(reconcileSessions(current, workspaceId, sessions), `session:${session.id}`));
      collapseUnpinnedTopMenu();
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to create session", onUnauthorized);
      if (message && isCurrentWorkspaceRequest(workspaceId, requestId)) throw new Error(message);
    }
  }

  function createBrowserItem(item: WorkspaceItem): void {
    setLayout((current) => addItemAndFocus(current, item));
    collapseUnpinnedTopMenu();
  }

  function focusExistingItem(itemId: string): void {
    setLayout((current) => focusItem(current, itemId));
    setIsSwitcherOpen(false);
    collapseUnpinnedTopMenu();
  }

  async function closeItem(item: WorkspaceItem): Promise<void> {
    setError(null);
    try {
      if ((item.kind === "agent" || item.kind === "terminal") && item.sessionId) {
        await api.killSession(item.workspaceId, item.sessionId);
      }
      setLayout((current) => removeItem(current, item.id));
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to close item", onUnauthorized);
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

  function collapseUnpinnedTopMenu(): void {
    if (!isTopMenuPinned) setIsTopMenuOpen(false);
  }

  function toggleTopMenu(): void {
    if (isTopMenuPinned) {
      setIsTopMenuPinned(false);
      setIsTopMenuOpen(false);
    } else {
      setIsTopMenuOpen((current) => !current);
    }
  }

  function toggleTopMenuPin(): void {
    setIsTopMenuPinned((current) => !current);
    setIsTopMenuOpen(true);
  }

  return {
    active,
    closeItem,
    createBrowserItem,
    createSession,
    error,
    focusExistingItem,
    isCreateOpen,
    isLoading,
    isShortcutRailOpen,
    isSwitcherOpen,
    isTopMenuExpanded: isTopMenuPinned || isTopMenuOpen,
    isTopMenuPinned,
    layout,
    loadWorkspaces,
    selectedWorkspace,
    selectWorkspace,
    setIsCreateOpen,
    setIsShortcutRailOpen,
    setIsSwitcherOpen,
    toggleTopMenu,
    toggleTopMenuPin,
    visibleItems,
    workspaces,
  };
}
