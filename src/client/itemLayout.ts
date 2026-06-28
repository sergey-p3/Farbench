import type { BrowserLayout, ItemKind, PaneLayout, Session, SessionType, WorkspaceItem } from "../shared/types.js";

export const MAIN_PANE_ID = "main";

export const defaultLayout: BrowserLayout = {
  selectedWorkspaceId: null,
  activePaneId: MAIN_PANE_ID,
  panes: [{ id: MAIN_PANE_ID, activeItemId: null, itemIds: [] }],
  items: [],
};

export type BrowserItemInput =
  | { kind: "files"; workspaceId: string; duplicateKey?: string; now?: string }
  | { kind: "git"; workspaceId: string; duplicateKey?: string; now?: string }
  | { kind: "preview"; workspaceId: string; port: number; path: string; duplicateKey?: string; now?: string };

export function normalizeLayout(value: unknown): BrowserLayout {
  if (!isRecord(value)) return cloneDefaultLayout();

  const selectedWorkspaceId = typeof value.selectedWorkspaceId === "string" ? value.selectedWorkspaceId : null;
  const activePaneId = typeof value.activePaneId === "string" ? value.activePaneId : MAIN_PANE_ID;
  const items = Array.isArray(value.items)
    ? uniqueItems(value.items.map(normalizeWorkspaceItem).filter((item): item is WorkspaceItem => item !== null))
    : [];
  const itemIds = new Set(items.map((item) => item.id));
  const rawPanes = Array.isArray(value.panes) ? value.panes : [];
  const panes = uniquePanes(rawPanes.map(normalizePane).filter((pane): pane is PaneLayout => pane !== null));
  const normalizedPanes = panes.length > 0 ? panes : [{ id: MAIN_PANE_ID, activeItemId: null, itemIds: [] }];
  const paneIds = new Set(normalizedPanes.map((pane) => pane.id));
  const normalizedActivePaneId = paneIds.has(activePaneId) ? activePaneId : normalizedPanes[0].id;

  return {
    selectedWorkspaceId,
    activePaneId: normalizedActivePaneId,
    panes: normalizedPanes.map((pane) => normalizePaneReferences(pane, itemIds)),
    items,
  };
}

export function reconcileSessions(layout: BrowserLayout, workspaceId: string, sessions: Session[], now = new Date().toISOString()): BrowserLayout {
  const normalized = normalizeLayout(layout);
  const sessionIds = new Set(sessions.map((session) => session.id));
  const nextItems = normalized.items.flatMap((item) => preserveItemDuringSessionReconcile(item, workspaceId, sessionIds));
  const nextPane = ensureActivePane(normalized);
  const existingItemIds = new Set(nextItems.map((item) => item.id));
  const nextPaneItemIds = nextPane.itemIds.filter((itemId) => existingItemIds.has(itemId));

  for (const session of sessions.filter(isOpenSession)) {
    const item = sessionToItem(session, now);
    nextItems.push(item);
    if (!nextPaneItemIds.includes(item.id)) nextPaneItemIds.push(item.id);
  }

  const activeItemId = chooseActiveItemId(normalized, workspaceId, nextItems, nextPaneItemIds);
  const panes = normalized.panes.map((pane) =>
    pane.id === nextPane.id
      ? { ...pane, itemIds: nextPaneItemIds, activeItemId }
      : pane,
  );

  return normalizeLayout({
    ...normalized,
    selectedWorkspaceId: workspaceId,
    activePaneId: nextPane.id,
    panes,
    items: nextItems,
  });
}

export function sessionToItem(session: Session, now = new Date().toISOString()): WorkspaceItem {
  const isAgent = session.type === "codex" || session.type === "claude";
  return {
    id: sessionItemId(session.id),
    workspaceId: session.workspaceId,
    kind: isAgent ? "agent" : "terminal",
    title: session.name,
    status: session.status,
    sessionId: session.id,
    config: { runtime: session.type },
    createdAt: session.createdAt,
    lastActiveAt: session.lastActivityAt ?? session.lastAttachedAt ?? session.createdAt ?? now,
  };
}

export function createBrowserItem(input: BrowserItemInput): WorkspaceItem {
  const now = input.now ?? new Date().toISOString();
  if (input.kind === "files") {
    return {
      id: browserItemId("files", input.workspaceId, input.duplicateKey),
      workspaceId: input.workspaceId,
      kind: "files",
      title: "Files",
      status: "ready",
      createdAt: now,
      lastActiveAt: now,
    };
  }
  if (input.kind === "git") {
    return {
      id: browserItemId("git", input.workspaceId, input.duplicateKey),
      workspaceId: input.workspaceId,
      kind: "git",
      title: "Git diff",
      status: "ready",
      createdAt: now,
      lastActiveAt: now,
    };
  }
  return {
    id: browserItemId("preview", input.workspaceId, input.duplicateKey, `${input.port}`, input.path),
    workspaceId: input.workspaceId,
    kind: "preview",
    title: `Preview :${input.port}`,
    status: "ready",
    config: { port: input.port, path: input.path },
    createdAt: now,
    lastActiveAt: now,
  };
}

export function addItemAndFocus(layout: BrowserLayout, item: WorkspaceItem, now = new Date().toISOString()): BrowserLayout {
  const normalized = normalizeLayout(layout);
  const pane = ensureActivePane(normalized);
  const items = normalized.items.some((existing) => existing.id === item.id)
    ? normalized.items.map((existing) => existing.id === item.id ? { ...existing, ...item, lastActiveAt: now } : existing)
    : [...normalized.items, { ...item, lastActiveAt: now }];
  const itemIds = pane.itemIds.includes(item.id) ? pane.itemIds : [...pane.itemIds, item.id];
  const panes = normalized.panes.map((currentPane) =>
    currentPane.id === pane.id
      ? { ...currentPane, activeItemId: item.id, itemIds }
      : currentPane,
  );

  return normalizeLayout({ ...normalized, activePaneId: pane.id, panes, items });
}

export function focusItem(layout: BrowserLayout, itemId: string, now = new Date().toISOString()): BrowserLayout {
  const normalized = normalizeLayout(layout);
  const item = normalized.items.find((candidate) => candidate.id === itemId);
  if (!item) return normalized;
  const pane = ensureActivePane(normalized);
  const itemIds = pane.itemIds.includes(itemId) ? pane.itemIds : [...pane.itemIds, itemId];
  const panes = normalized.panes.map((currentPane) =>
    currentPane.id === pane.id
      ? { ...currentPane, activeItemId: itemId, itemIds }
      : currentPane,
  );
  const items = normalized.items.map((candidate) =>
    candidate.id === itemId ? { ...candidate, lastActiveAt: now } : candidate,
  );
  return normalizeLayout({ ...normalized, activePaneId: pane.id, panes, items });
}

export function removeItem(layout: BrowserLayout, itemId: string): BrowserLayout {
  const normalized = normalizeLayout(layout);
  const items = normalized.items.filter((item) => item.id !== itemId);
  const panes = normalized.panes.map((pane) => {
    const removedIndex = pane.itemIds.indexOf(itemId);
    const itemIds = pane.itemIds.filter((candidate) => candidate !== itemId);
    const activeItemId = pane.activeItemId === itemId
      ? itemIds[removedIndex] ?? itemIds[removedIndex - 1] ?? null
      : pane.activeItemId;

    return { ...pane, activeItemId, itemIds };
  });

  return normalizeLayout({ ...normalized, panes, items });
}

export function activeItem(layout: BrowserLayout): WorkspaceItem | null {
  const normalized = normalizeLayout(layout);
  const pane = normalized.panes.find((candidate) => candidate.id === normalized.activePaneId) ?? normalized.panes[0];
  if (!pane.activeItemId) return null;
  return normalized.items.find((item) => item.id === pane.activeItemId) ?? null;
}

export function itemsForWorkspace(layout: BrowserLayout, workspaceId: string | null): WorkspaceItem[] {
  if (!workspaceId) return [];
  return normalizeLayout(layout).items.filter((item) => item.workspaceId === workspaceId);
}

export function findEquivalentItem(items: WorkspaceItem[], candidate: WorkspaceItem): WorkspaceItem | null {
  return items.find((item) => areEquivalentItems(item, candidate)) ?? null;
}

export function areEquivalentItems(left: WorkspaceItem, right: WorkspaceItem): boolean {
  if (left.workspaceId !== right.workspaceId || left.kind !== right.kind) return false;
  if (left.kind === "agent" || left.kind === "terminal") return left.config?.runtime === right.config?.runtime;
  if (left.kind === "preview") {
    return (left.config?.port ?? 3000) === (right.config?.port ?? 3000) && (left.config?.path ?? "/") === (right.config?.path ?? "/");
  }
  return true;
}

export function sessionItemId(sessionId: string): string {
  return `session:${sessionId}`;
}

function browserItemId(kind: "files" | "git" | "preview", workspaceId: string, duplicateKey?: string, ...parts: string[]): string {
  const suffix = duplicateKey ? `:${duplicateKey}` : "";
  const config = parts.length > 0 ? `:${parts.map(encodeURIComponent).join(":")}` : "";
  return `${kind}:${workspaceId}${config}${suffix}`;
}

function cloneDefaultLayout(): BrowserLayout {
  return {
    selectedWorkspaceId: defaultLayout.selectedWorkspaceId,
    activePaneId: defaultLayout.activePaneId,
    panes: defaultLayout.panes.map((pane) => ({ ...pane, itemIds: [...pane.itemIds] })),
    items: [],
  };
}

function preserveItemDuringSessionReconcile(item: WorkspaceItem, workspaceId: string, sessionIds: Set<string>): WorkspaceItem[] {
  if (item.workspaceId !== workspaceId || !item.sessionId) return [item];
  if (sessionIds.has(item.sessionId)) return [];
  if (item.kind !== "terminal" && item.kind !== "agent") return [];

  return [{
    id: item.id,
    workspaceId: item.workspaceId,
    kind: item.kind,
    title: item.title,
    status: "disconnected",
    ...(item.config === undefined ? {} : { config: item.config }),
    ...(item.createdAt === undefined ? {} : { createdAt: item.createdAt }),
    ...(item.lastActiveAt === undefined ? {} : { lastActiveAt: item.lastActiveAt }),
  }];
}

function isOpenSession(session: Session): boolean {
  return session.status !== "exited" && session.status !== "crashed" && session.status !== "killed";
}

function normalizePane(value: unknown): PaneLayout | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const itemIds = Array.isArray(value.itemIds) ? uniqueStrings(value.itemIds.filter((itemId): itemId is string => typeof itemId === "string")) : [];
  return {
    id: value.id,
    activeItemId: typeof value.activeItemId === "string" ? value.activeItemId : null,
    itemIds,
  };
}

function normalizeWorkspaceItem(value: unknown): WorkspaceItem | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.workspaceId !== "string" ||
    !isItemKind(value.kind) ||
    typeof value.title !== "string" ||
    !isWorkspaceItemStatus(value.status) ||
    (value.sessionId !== undefined && typeof value.sessionId !== "string")
  ) {
    return null;
  }

  const config = normalizeWorkspaceItemConfig(value.kind, value.config);
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    kind: value.kind,
    title: value.title,
    status: value.status,
    ...(value.sessionId === undefined ? {} : { sessionId: value.sessionId }),
    ...(config === undefined ? {} : { config }),
    ...(typeof value.createdAt === "string" ? { createdAt: value.createdAt } : {}),
    ...(typeof value.lastActiveAt === "string" ? { lastActiveAt: value.lastActiveAt } : {}),
  };
}

function normalizeWorkspaceItemConfig(kind: ItemKind, value: unknown): WorkspaceItem["config"] | undefined {
  if (!isRecord(value)) return undefined;
  if (kind === "agent" || kind === "terminal") {
    return isSessionType(value.runtime) ? { runtime: value.runtime } : undefined;
  }
  if (kind === "preview") {
    return typeof value.port === "number" && typeof value.path === "string"
      ? { port: value.port, path: value.path }
      : undefined;
  }
  return undefined;
}

function isItemKind(value: unknown): value is ItemKind {
  return value === "agent" || value === "terminal" || value === "files" || value === "git" || value === "preview";
}

function isSessionType(value: unknown): value is SessionType {
  return value === "bash" || value === "codex" || value === "claude";
}

function isWorkspaceItemStatus(value: unknown): value is WorkspaceItem["status"] {
  return (
    value === "starting" ||
    value === "running" ||
    value === "idle" ||
    value === "disconnected" ||
    value === "exited" ||
    value === "crashed" ||
    value === "killed" ||
    value === "unknown" ||
    value === "ready"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function uniquePanes(panes: PaneLayout[]): PaneLayout[] {
  const seen = new Set<string>();
  const result: PaneLayout[] = [];
  for (const pane of panes) {
    if (seen.has(pane.id)) continue;
    seen.add(pane.id);
    result.push(pane);
  }
  return result;
}

function uniqueItems(items: WorkspaceItem[]): WorkspaceItem[] {
  const seen = new Set<string>();
  const result: WorkspaceItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizePaneReferences(pane: PaneLayout, validItemIds: Set<string>): PaneLayout {
  const itemIds = uniqueStrings(pane.itemIds.filter((itemId) => validItemIds.has(itemId)));
  return {
    id: pane.id,
    itemIds,
    activeItemId: pane.activeItemId && itemIds.includes(pane.activeItemId) ? pane.activeItemId : itemIds[0] ?? null,
  };
}

function ensureActivePane(layout: BrowserLayout): PaneLayout {
  return layout.panes.find((pane) => pane.id === layout.activePaneId) ?? layout.panes[0] ?? defaultLayout.panes[0];
}

function chooseActiveItemId(layout: BrowserLayout, workspaceId: string, items: WorkspaceItem[], paneItemIds: string[]): string | null {
  const current = activeItem(layout);
  if (current && current.workspaceId === workspaceId && paneItemIds.includes(current.id)) return current.id;

  const workspaceItems = items.filter((item) => item.workspaceId === workspaceId && paneItemIds.includes(item.id));
  workspaceItems.sort((left, right) => timestamp(right.lastActiveAt) - timestamp(left.lastActiveAt));
  return workspaceItems[0]?.id ?? null;
}

function timestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
