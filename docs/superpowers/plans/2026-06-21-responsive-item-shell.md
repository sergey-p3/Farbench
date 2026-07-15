# Responsive Item Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the desktop-first dashboard and tool tabs with a mobile-first focused item shell that can create, focus, switch, persist, and restore terminal, agent, files, git, and preview items.

**Architecture:** Introduce a shared pane/item layout model and pure reconciliation helpers first, then move the browser client into focused shell components: `WorkspaceShell`, `PaneHost`, `ItemRenderer`, `ItemSwitcher`, and `CreateItemSheet`. Existing backend APIs and durable tmux sessions stay in place; browser-only items use local layout state and the current file, git, and preview panels.

**Tech Stack:** TypeScript, React 19, Vite, xterm.js, Monaco Editor, Vitest, Playwright.

---

## Scope Check

This plan implements phase one from `docs/superpowers/specs/2026-06-21-responsive-item-shell-design.md`. It introduces the item and pane model, replaces the persistent sidebar and tool tabs, adds the switcher and create sheet, renders existing tool surfaces through item routing, and validates the mobile viewport flow. It does not build desktop split panes, a chat-native agent UI, command palette workflows, collaboration, or backend API changes.

## File Structure

- Modify: `src/shared/types.ts` - add `ItemKind`, `WorkspaceItem`, `PaneLayout`, `BrowserLayout` pane/item state, and preview item config.
- Create: `src/client/itemLayout.ts` - pure helpers for default layout, persisted-state normalization, session-to-item reconciliation, active item focus, browser item creation, and duplicate/equivalence detection.
- Modify: `src/client/layoutStore.ts` - delegate normalization to `itemLayout.ts` and keep the existing storage key.
- Create: `tests/client/itemLayout.test.ts` - Vitest coverage for layout normalization, duplicate/equivalent item detection, and session reconciliation.
- Create: `src/client/components/WorkspaceShell.tsx` - owns authenticated workspace/session loading, layout persistence, create/focus/switch callbacks, auth failure reset, and shell-level errors.
- Create: `src/client/components/PaneHost.tsx` - renders the phase-one single active pane and focused item state.
- Create: `src/client/components/ItemRenderer.tsx` - routes `WorkspaceItem` kinds to `TerminalPane`, `FilePanel`, `GitPanel`, and `PreviewPanel`.
- Create: `src/client/components/ItemSwitcher.tsx` - drawer listing open items for the selected workspace and focusing selected rows.
- Create: `src/client/components/CreateItemSheet.tsx` - fixed touch-first create sheet with duplicate prompts for focus existing vs create new.
- Modify: `src/client/components/PreviewPanel.tsx` - accept item-provided initial port/path config.
- Modify: `src/client/App.tsx` - keep auth bootstrap and login routing, then render `WorkspaceShell`.
- Modify: `src/client/styles.css` - replace dashboard/tab styling with mobile-first shell, drawer, sheet, focused item, and responsive panel rules.
- Modify: `tests/e2e/mvp.spec.ts` - update acceptance test to mobile viewport shell flows: login, create files/git/preview items from `+`, duplicate prompt, switcher focus, refresh restore.

## Task 1: Shared Item Types and Pure Layout Helpers

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/client/itemLayout.ts`
- Create: `tests/client/itemLayout.test.ts`

- [ ] **Step 1: Add the shared item and pane types**

In `src/shared/types.ts`, replace the existing `BrowserLayout` interface with these exported types and interface definitions. Keep all existing exports above and below this block unchanged.

```ts
export type ItemKind = "agent" | "terminal" | "files" | "git" | "preview";

export interface WorkspaceItemConfig {
  runtime?: SessionType;
  port?: number;
  path?: string;
}

export interface WorkspaceItem {
  id: string;
  workspaceId: string;
  kind: ItemKind;
  title: string;
  status: SessionStatus | "ready" | "disconnected";
  sessionId?: string;
  config?: WorkspaceItemConfig;
  createdAt?: string;
  lastActiveAt?: string;
}

export interface PaneLayout {
  id: string;
  activeItemId: string | null;
  itemIds: string[];
}

export interface BrowserLayout {
  selectedWorkspaceId: string | null;
  activePaneId: string;
  panes: PaneLayout[];
  items: WorkspaceItem[];
}
```

- [ ] **Step 2: Run typecheck to verify the intentional breakage**

Run: `npm run typecheck`

Expected: FAIL with errors in `src/client/App.tsx` and `src/client/layoutStore.ts` referencing removed `selectedSessionId` and `split` layout fields. This confirms the tests will drive the migration from tab state to item state.

- [ ] **Step 3: Create pure item layout helpers**

Create `src/client/itemLayout.ts` with this full content:

```ts
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
  const items = Array.isArray(value.items) ? value.items.filter(isWorkspaceItem) : [];
  const itemIds = new Set(items.map((item) => item.id));
  const rawPanes = Array.isArray(value.panes) ? value.panes : [];
  const panes = rawPanes.map(normalizePane).filter((pane): pane is PaneLayout => pane !== null);
  const normalizedPanes = panes.length > 0 ? panes : [{ id: MAIN_PANE_ID, activeItemId: null, itemIds: [] }];
  const paneIds = new Set(normalizedPanes.map((pane) => pane.id));
  const normalizedActivePaneId = paneIds.has(activePaneId) ? activePaneId : normalizedPanes[0].id;

  return {
    selectedWorkspaceId,
    activePaneId: normalizedActivePaneId,
    panes: normalizedPanes.map((pane) => ({
      id: pane.id,
      itemIds: pane.itemIds.filter((itemId) => itemIds.has(itemId)),
      activeItemId: pane.activeItemId && itemIds.has(pane.activeItemId) ? pane.activeItemId : firstItemId(pane.itemIds, itemIds),
    })),
    items,
  };
}

export function reconcileSessions(layout: BrowserLayout, workspaceId: string, sessions: Session[], now = new Date().toISOString()): BrowserLayout {
  const normalized = normalizeLayout(layout);
  const nextItems = normalized.items.filter((item) => item.workspaceId !== workspaceId || !item.sessionId);
  const nextPane = ensureActivePane(normalized);
  const existingItemIds = new Set(nextItems.map((item) => item.id));
  const nextPaneItemIds = nextPane.itemIds.filter((itemId) => existingItemIds.has(itemId));

  for (const session of sessions) {
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

function normalizePane(value: unknown): PaneLayout | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const itemIds = Array.isArray(value.itemIds) ? value.itemIds.filter((itemId): itemId is string => typeof itemId === "string") : [];
  return {
    id: value.id,
    activeItemId: typeof value.activeItemId === "string" ? value.activeItemId : null,
    itemIds,
  };
}

function isWorkspaceItem(value: unknown): value is WorkspaceItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.workspaceId === "string" &&
    isItemKind(value.kind) &&
    typeof value.title === "string" &&
    typeof value.status === "string" &&
    (value.sessionId === undefined || typeof value.sessionId === "string") &&
    (value.config === undefined || isRecord(value.config))
  );
}

function isItemKind(value: unknown): value is ItemKind {
  return value === "agent" || value === "terminal" || value === "files" || value === "git" || value === "preview";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function firstItemId(itemIds: string[], validItemIds: Set<string>): string | null {
  return itemIds.find((itemId) => validItemIds.has(itemId)) ?? null;
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
```

- [ ] **Step 4: Add layout helper tests**

Create `tests/client/itemLayout.test.ts` with this full content:

```ts
import { describe, expect, test } from "vitest";
import type { BrowserLayout, Session, WorkspaceItem } from "../../src/shared/types.js";
import {
  addItemAndFocus,
  areEquivalentItems,
  createBrowserItem,
  defaultLayout,
  focusItem,
  normalizeLayout,
  reconcileSessions,
  sessionItemId,
} from "../../src/client/itemLayout.js";

function session(overrides: Partial<Session>): Session {
  return {
    id: "s1",
    workspaceId: "w1",
    name: "bash session",
    type: "bash",
    tmuxName: "farbench-s1",
    status: "running",
    createdAt: "2026-06-21T10:00:00.000Z",
    lastAttachedAt: null,
    lastActivityAt: null,
    endedAt: null,
    ...overrides,
  };
}

describe("item layout helpers", () => {
  test("normalizes invalid persisted state to one empty pane", () => {
    expect(normalizeLayout({ selectedWorkspaceId: 42, activePaneId: "missing", panes: [{ id: "main", activeItemId: "ghost", itemIds: ["ghost"] }], items: [] })).toEqual(defaultLayout);
  });

  test("drops pane item references that do not exist", () => {
    const item: WorkspaceItem = createBrowserItem({ kind: "files", workspaceId: "w1", now: "2026-06-21T10:00:00.000Z" });
    const normalized = normalizeLayout({
      selectedWorkspaceId: "w1",
      activePaneId: "main",
      panes: [{ id: "main", activeItemId: "ghost", itemIds: ["ghost", item.id] }],
      items: [item],
    });

    expect(normalized.panes[0]).toEqual({ id: "main", activeItemId: item.id, itemIds: [item.id] });
  });

  test("reconciles durable sessions into active workspace items", () => {
    const reconciled = reconcileSessions(defaultLayout, "w1", [
      session({ id: "bash-1", type: "bash", name: "shell" }),
      session({ id: "codex-1", type: "codex", name: "codex" }),
    ], "2026-06-21T11:00:00.000Z");

    expect(reconciled.items.map((item) => [item.id, item.kind, item.config?.runtime])).toEqual([
      [sessionItemId("bash-1"), "terminal", "bash"],
      [sessionItemId("codex-1"), "agent", "codex"],
    ]);
    expect(reconciled.panes[0].activeItemId).toBe(sessionItemId("bash-1"));
  });

  test("preserves a focused browser item when sessions refresh", () => {
    const filesItem = createBrowserItem({ kind: "files", workspaceId: "w1", now: "2026-06-21T10:00:00.000Z" });
    const focused = addItemAndFocus(defaultLayout, filesItem, "2026-06-21T10:05:00.000Z");
    const reconciled = reconcileSessions(focused, "w1", [session({ id: "bash-1" })], "2026-06-21T11:00:00.000Z");

    expect(reconciled.panes[0].activeItemId).toBe(filesItem.id);
  });

  test("focusItem updates active pane and last active time", () => {
    const filesItem = createBrowserItem({ kind: "files", workspaceId: "w1", now: "2026-06-21T10:00:00.000Z" });
    const gitItem = createBrowserItem({ kind: "git", workspaceId: "w1", now: "2026-06-21T10:01:00.000Z" });
    const layout = addItemAndFocus(addItemAndFocus(defaultLayout, filesItem), gitItem);
    const focused = focusItem(layout, filesItem.id, "2026-06-21T10:10:00.000Z");

    expect(focused.panes[0].activeItemId).toBe(filesItem.id);
    expect(focused.items.find((item) => item.id === filesItem.id)?.lastActiveAt).toBe("2026-06-21T10:10:00.000Z");
  });

  test("detects kind-specific duplicate equivalence", () => {
    const filesA = createBrowserItem({ kind: "files", workspaceId: "w1" });
    const filesB = createBrowserItem({ kind: "files", workspaceId: "w1", duplicateKey: "copy" });
    const gitOtherWorkspace = createBrowserItem({ kind: "git", workspaceId: "w2" });
    const preview3000 = createBrowserItem({ kind: "preview", workspaceId: "w1", port: 3000, path: "/" });
    const preview3001 = createBrowserItem({ kind: "preview", workspaceId: "w1", port: 3001, path: "/" });

    expect(areEquivalentItems(filesA, filesB)).toBe(true);
    expect(areEquivalentItems(filesA, gitOtherWorkspace)).toBe(false);
    expect(areEquivalentItems(preview3000, preview3001)).toBe(false);
  });
});
```

- [ ] **Step 5: Run the focused helper tests**

Run: `npm test -- tests/client/itemLayout.test.ts`

Expected: PASS with 6 tests passing.

- [ ] **Step 6: Commit the shared model**

```bash
git add src/shared/types.ts src/client/itemLayout.ts tests/client/itemLayout.test.ts
git commit -m "feat: add item layout model"
```

## Task 2: Persist the New Layout Shape

**Files:**
- Modify: `src/client/layoutStore.ts`
- Test: `tests/client/itemLayout.test.ts`

- [ ] **Step 1: Replace layout store normalization**

Replace the full contents of `src/client/layoutStore.ts` with:

```ts
import type { BrowserLayout } from "../shared/types.js";
import { defaultLayout, normalizeLayout } from "./itemLayout.js";

const STORAGE_KEY = "farbench-layout";

export { defaultLayout, normalizeLayout };

export function loadLayout(): BrowserLayout {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLayout;
    return normalizeLayout(JSON.parse(raw));
  } catch {
    return defaultLayout;
  }
}

export function saveLayout(layout: BrowserLayout): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeLayout(layout)));
}
```

- [ ] **Step 2: Run layout tests and typecheck**

Run: `npm test -- tests/client/itemLayout.test.ts`

Expected: PASS with 6 tests passing.

Run: `npm run typecheck`

Expected: FAIL with remaining errors in `src/client/App.tsx` because it still references tab/session fields removed from `BrowserLayout`.

- [ ] **Step 3: Commit layout persistence**

```bash
git add src/client/layoutStore.ts
git commit -m "feat: persist item shell layout"
```

## Task 3: Add Focused Item Shell Components

**Files:**
- Create: `src/client/components/ItemRenderer.tsx`
- Create: `src/client/components/PaneHost.tsx`
- Create: `src/client/components/ItemSwitcher.tsx`
- Create: `src/client/components/CreateItemSheet.tsx`
- Modify: `src/client/components/PreviewPanel.tsx`

- [ ] **Step 1: Create the item renderer**

Create `src/client/components/ItemRenderer.tsx` with this full content:

```tsx
import type { Workspace, WorkspaceItem } from "../../shared/types.js";
import { FilePanel } from "./FilePanel.js";
import { GitPanel } from "./GitPanel.js";
import { PreviewPanel } from "./PreviewPanel.js";
import { TerminalPane } from "./TerminalPane.js";

interface ItemRendererProps {
  item: WorkspaceItem | null;
  workspace: Workspace | null;
  onOpenCreateSheet: () => void;
}

export function ItemRenderer({ item, workspace, onOpenCreateSheet }: ItemRendererProps) {
  if (!item) {
    return (
      <section className="focused-empty" aria-label="No active item">
        <h2>No item open</h2>
        <p>Open a workspace item to start working.</p>
        <button onClick={onOpenCreateSheet} type="button">Open item</button>
      </section>
    );
  }

  if ((item.kind === "terminal" || item.kind === "agent") && !item.sessionId) {
    return (
      <section className="tool-panel empty-tool" aria-label="Session unavailable">
        <p className="empty-state">{item.title} is no longer available. Create a new session from the add menu.</p>
      </section>
    );
  }

  if (item.kind === "terminal" || item.kind === "agent") {
    return <TerminalPane sessionId={item.sessionId ?? null} />;
  }

  if (item.kind === "files") {
    return <FilePanel workspace={workspace} />;
  }

  if (item.kind === "git") {
    return <GitPanel workspace={workspace} />;
  }

  return (
    <PreviewPanel
      initialPath={item.config?.path ?? "/"}
      initialPort={item.config?.port ?? 3000}
      workspace={workspace}
    />
  );
}
```

- [ ] **Step 2: Create the pane host**

Create `src/client/components/PaneHost.tsx` with this full content:

```tsx
import type { BrowserLayout, Workspace, WorkspaceItem } from "../../shared/types.js";
import { activeItem } from "../itemLayout.js";
import { ItemRenderer } from "./ItemRenderer.js";

interface PaneHostProps {
  layout: BrowserLayout;
  workspace: Workspace | null;
  onOpenCreateSheet: () => void;
}

export function PaneHost({ layout, workspace, onOpenCreateSheet }: PaneHostProps) {
  const item: WorkspaceItem | null = activeItem(layout);

  return (
    <section className="pane-host" aria-label="Focused item">
      <ItemRenderer item={item} workspace={workspace} onOpenCreateSheet={onOpenCreateSheet} />
    </section>
  );
}
```

- [ ] **Step 3: Create the item switcher drawer**

Create `src/client/components/ItemSwitcher.tsx` with this full content:

```tsx
import type { Workspace, WorkspaceItem } from "../../shared/types.js";

interface ItemSwitcherProps {
  activeItemId: string | null;
  items: WorkspaceItem[];
  isOpen: boolean;
  selectedWorkspace: Workspace | null;
  workspaces: Workspace[];
  onClose: () => void;
  onFocusItem: (itemId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
}

export function ItemSwitcher({
  activeItemId,
  items,
  isOpen,
  selectedWorkspace,
  workspaces,
  onClose,
  onFocusItem,
  onSelectWorkspace,
}: ItemSwitcherProps) {
  if (!isOpen) return null;

  return (
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="item-drawer" aria-label="Item switcher" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-header">
          <div>
            <p className="eyebrow">Workspace</p>
            <h2>{selectedWorkspace?.name ?? "No workspace selected"}</h2>
          </div>
          <button className="icon-button" aria-label="Close item switcher" onClick={onClose} type="button">×</button>
        </div>

        <div className="workspace-picker" aria-label="Switch workspace">
          {workspaces.map((workspace) => (
            <button
              aria-pressed={workspace.id === selectedWorkspace?.id}
              className={workspace.id === selectedWorkspace?.id ? "workspace-pill active" : "workspace-pill"}
              key={workspace.id}
              onClick={() => onSelectWorkspace(workspace.id)}
              type="button"
            >
              {workspace.name}
            </button>
          ))}
        </div>

        <div className="switcher-list" role="list">
          {items.map((item) => (
            <button
              aria-current={item.id === activeItemId ? "page" : undefined}
              className={item.id === activeItemId ? "switcher-row active" : "switcher-row"}
              key={item.id}
              onClick={() => onFocusItem(item.id)}
              type="button"
            >
              <span className="item-kind">{labelForKind(item.kind)}</span>
              <span className="item-name">{item.title}</span>
              <span className="item-meta">{detailForItem(item)}</span>
            </button>
          ))}
          {items.length === 0 ? <p className="empty-state">No open items in this workspace.</p> : null}
        </div>
      </aside>
    </div>
  );
}

function labelForKind(kind: WorkspaceItem["kind"]): string {
  if (kind === "agent") return "Agent";
  if (kind === "terminal") return "Terminal";
  if (kind === "files") return "Files";
  if (kind === "git") return "Git";
  return "Preview";
}

function detailForItem(item: WorkspaceItem): string {
  if (item.kind === "agent" || item.kind === "terminal") {
    return `${item.config?.runtime ?? "session"} · ${item.status}`;
  }
  if (item.kind === "preview") {
    return `:${item.config?.port ?? 3000}${item.config?.path ?? "/"}`;
  }
  return item.lastActiveAt ? `Last active ${new Date(item.lastActiveAt).toLocaleTimeString()}` : item.status;
}
```

- [ ] **Step 4: Create the item creation sheet**

Create `src/client/components/CreateItemSheet.tsx` with this full content:

```tsx
import { useMemo, useState } from "react";
import type { SessionType, WorkspaceItem } from "../../shared/types.js";
import { createBrowserItem, findEquivalentItem } from "../itemLayout.js";

type BrowserCreateKind = "files" | "git" | "preview";

interface CreateItemSheetProps {
  isOpen: boolean;
  items: WorkspaceItem[];
  workspaceId: string | null;
  onClose: () => void;
  onCreateBrowserItem: (item: WorkspaceItem) => void;
  onCreateSession: (type: SessionType) => Promise<void>;
  onFocusItem: (itemId: string) => void;
}

interface PendingDuplicate {
  label: string;
  existingItem: WorkspaceItem;
  createNew: () => void | Promise<void>;
}

export function CreateItemSheet({
  isOpen,
  items,
  workspaceId,
  onClose,
  onCreateBrowserItem,
  onCreateSession,
  onFocusItem,
}: CreateItemSheetProps) {
  const [pendingDuplicate, setPendingDuplicate] = useState<PendingDuplicate | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewPort, setPreviewPort] = useState(3000);
  const [previewPath, setPreviewPath] = useState("/");

  const workspaceItems = useMemo(
    () => items.filter((item) => item.workspaceId === workspaceId),
    [items, workspaceId],
  );

  if (!isOpen) return null;

  async function createSession(type: SessionType) {
    if (!workspaceId) return;
    const kind = type === "bash" ? "terminal" : "agent";
    const candidate: WorkspaceItem = {
      id: `new-session:${type}`,
      workspaceId,
      kind,
      title: type === "bash" ? "shell session" : `${type} session`,
      status: "ready",
      config: { runtime: type },
    };
    const existing = findEquivalentItem(workspaceItems, candidate);
    if (existing) {
      setPendingDuplicate({
        label: candidate.title,
        existingItem: existing,
        createNew: () => runCreateSession(type),
      });
      return;
    }
    await runCreateSession(type);
  }

  async function runCreateSession(type: SessionType) {
    setIsCreating(true);
    setError(null);
    try {
      await onCreateSession(type);
      onClose();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create session");
    } finally {
      setIsCreating(false);
    }
  }

  function createBrowser(kind: BrowserCreateKind, forceDuplicate = false) {
    if (!workspaceId) return;
    const item = createBrowserItem(
      kind === "preview"
        ? { kind, workspaceId, port: previewPort, path: previewPath || "/", duplicateKey: forceDuplicate ? uniqueDuplicateKey() : undefined }
        : { kind, workspaceId, duplicateKey: forceDuplicate ? uniqueDuplicateKey() : undefined },
    );
    const existing = findEquivalentItem(workspaceItems, item);
    if (existing && !forceDuplicate) {
      setPendingDuplicate({
        label: item.title,
        existingItem: existing,
        createNew: () => createBrowser(kind, true),
      });
      return;
    }
    onCreateBrowserItem(item);
    onClose();
  }

  function focusExisting(itemId: string) {
    onFocusItem(itemId);
    setPendingDuplicate(null);
    onClose();
  }

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <section className="create-sheet" aria-label="Create item" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-header">
          <div>
            <p className="eyebrow">Create</p>
            <h2>Open item</h2>
          </div>
          <button className="icon-button" aria-label="Close create sheet" onClick={onClose} type="button">×</button>
        </div>

        {pendingDuplicate ? (
          <div className="duplicate-panel" role="alert">
            <h3>{pendingDuplicate.label} is already open</h3>
            <p>{pendingDuplicate.existingItem.title}</p>
            <div className="sheet-actions">
              <button onClick={() => focusExisting(pendingDuplicate.existingItem.id)} type="button">Focus existing</button>
              <button onClick={() => void pendingDuplicate.createNew()} type="button">Create new</button>
              <button className="secondary-button" onClick={() => setPendingDuplicate(null)} type="button">Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div className="create-grid">
              <button disabled={!workspaceId || isCreating} onClick={() => void createSession("codex")} type="button">Agent: Codex</button>
              <button disabled={!workspaceId || isCreating} onClick={() => void createSession("claude")} type="button">Agent: Claude</button>
              <button disabled={!workspaceId || isCreating} onClick={() => void createSession("bash")} type="button">Terminal</button>
              <button disabled={!workspaceId} onClick={() => createBrowser("files")} type="button">Files</button>
              <button disabled={!workspaceId} onClick={() => createBrowser("git")} type="button">Git diff</button>
            </div>

            <fieldset className="preview-create">
              <legend>Preview</legend>
              <label className="field compact-field">
                <span>Port</span>
                <input min={1} max={65535} onChange={(event) => setPreviewPort(Number(event.target.value))} type="number" value={previewPort} />
              </label>
              <label className="field compact-field">
                <span>Path</span>
                <input onChange={(event) => setPreviewPath(event.target.value)} type="text" value={previewPath} />
              </label>
              <button disabled={!workspaceId || !Number.isInteger(previewPort) || previewPort < 1 || previewPort > 65535} onClick={() => createBrowser("preview")} type="button">Preview</button>
            </fieldset>
          </>
        )}

        {error ? <p className="panel-error" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}

function uniqueDuplicateKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
```

- [ ] **Step 5: Let preview items seed the preview panel**

In `src/client/components/PreviewPanel.tsx`, replace the props interface and state initialization with this code:

```tsx
interface PreviewPanelProps {
  workspace: Workspace | null;
  initialPort?: number;
  initialPath?: string;
}

export function PreviewPanel({ workspace, initialPort = 3000, initialPath = "/" }: PreviewPanelProps) {
  const workspaceIdRef = useRef<string | null>(workspace?.id ?? null);
  const previewRequestRef = useRef(0);
  const [port, setPort] = useState(initialPort);
  const [pathPrefix, setPathPrefix] = useState(initialPath);
  const [preview, setPreview] = useState<PortPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
```

In the workspace reset effect in the same file, add these two assignments after `setError(null);`:

```tsx
setPort(initialPort);
setPathPrefix(initialPath);
```

Replace the preview controls JSX with:

```tsx
<div className="preview-controls">
  <label className="field compact-field">
    <span>Port</span>
    <input
      min={1}
      max={65535}
      onChange={(event) => setPort(Number(event.target.value))}
      type="number"
      value={port}
    />
  </label>
  <label className="field compact-field">
    <span>Path</span>
    <input
      onChange={(event) => setPathPrefix(event.target.value)}
      type="text"
      value={pathPrefix}
    />
  </label>
  <button disabled={isLoading || !Number.isInteger(port) || port < 1 || port > 65535} onClick={() => void exposePreview()} type="button">
    {isLoading ? "Exposing" : "Expose"}
  </button>
  {preview ? (
    <a href={preview.pathPrefix} rel="noreferrer" target="_blank">
      Open in new tab
    </a>
  ) : null}
</div>
```

Inside `exposePreview`, keep the current API call as `api.createPreview(workspaceId, port)` because the backend currently returns the authenticated prefix. The `pathPrefix` state seeds the item identity and can be used by a later backend path-aware preview API.

- [ ] **Step 6: Run typecheck to expose the remaining shell integration errors**

Run: `npm run typecheck`

Expected: FAIL with errors in `src/client/App.tsx` because it has not been refactored to use the new components.

- [ ] **Step 7: Commit the shell components**

```bash
git add src/client/components/ItemRenderer.tsx src/client/components/PaneHost.tsx src/client/components/ItemSwitcher.tsx src/client/components/CreateItemSheet.tsx src/client/components/PreviewPanel.tsx
git commit -m "feat: add focused item shell components"
```

## Task 4: Replace Dashboard Tabs With WorkspaceShell

**Files:**
- Create: `src/client/components/WorkspaceShell.tsx`
- Modify: `src/client/App.tsx`
- Retain: `src/client/components/Dashboard.tsx` for deletion in a later cleanup commit after E2E passes.

- [ ] **Step 1: Create the workspace shell**

Create `src/client/components/WorkspaceShell.tsx` with this full content:

```tsx
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
```

- [ ] **Step 2: Replace App with auth routing and WorkspaceShell**

Replace the full contents of `src/client/App.tsx` with:

```tsx
import { useEffect, useState } from "react";
import { api } from "./api.js";
import { Login } from "./components/Login.js";
import { WorkspaceShell } from "./components/WorkspaceShell.js";

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  useEffect(() => {
    void bootstrapAuth();
  }, []);

  async function bootstrapAuth() {
    setIsBootstrapping(true);
    try {
      await api.workspaces();
      setIsAuthenticated(true);
    } catch {
      resetToLogin();
    } finally {
      setIsBootstrapping(false);
    }
  }

  function resetToLogin() {
    setIsAuthenticated(false);
  }

  if (isBootstrapping) {
    return <main className="login-screen"><p className="loading-state">Checking session...</p></main>;
  }

  if (!isAuthenticated) {
    return <Login onLogin={() => setIsAuthenticated(true)} />;
  }

  return <WorkspaceShell onUnauthorized={resetToLogin} />;
}

export default App;
```

- [ ] **Step 3: Run unit tests and typecheck**

Run: `npm test -- tests/client/itemLayout.test.ts`

Expected: PASS with 6 tests passing.

Run: `npm run typecheck`

Expected: PASS with 0 TypeScript errors.

- [ ] **Step 4: Commit the shell integration**

```bash
git add src/client/components/WorkspaceShell.tsx src/client/App.tsx
git commit -m "feat: render workspace item shell"
```

## Task 5: Apply Mobile-First Shell Styling

**Files:**
- Modify: `src/client/styles.css`

- [ ] **Step 1: Replace old dashboard and tab layout styles**

In `src/client/styles.css`, remove the `.dashboard`, `.dashboard-section`, `.session-actions`, `.tabs`, `.tab`, `.placeholder-panel`, and old mobile `.app-shell` dashboard rules. Keep login, field, panel, file, git, terminal, preview, and error styles. Add this shell styling after the `.form-error, .shell-error, .dashboard-error` rule:

```css
.app-shell {
  min-height: 100vh;
}

.item-shell {
  background: #eef1f4;
  display: grid;
  grid-template-columns: 1fr;
  padding: 0;
}

.workspace-panel,
.focused-shell {
  background: #ffffff;
  border: 0;
  border-radius: 0;
  display: grid;
  grid-template-rows: auto auto auto 1fr;
  min-height: 100vh;
  min-width: 0;
  overflow: hidden;
}

.shell-top-bar {
  align-items: center;
  background: #ffffff;
  border-bottom: 1px solid #d8dee6;
  display: grid;
  gap: 10px;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  min-height: 58px;
  padding: 8px 10px;
}

.top-bar-title {
  min-width: 0;
}

.top-bar-title h1 {
  color: #1f2933;
  font-size: 1rem;
  line-height: 1.2;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon-button {
  align-items: center;
  background: #ffffff;
  border: 1px solid #c8d1dc;
  border-radius: 6px;
  color: #263442;
  display: inline-grid;
  font-size: 1.2rem;
  font-weight: 700;
  height: 40px;
  justify-content: center;
  line-height: 1;
  min-width: 40px;
  padding: 0;
}

.primary-icon {
  background: #24435f;
  border-color: #24435f;
  color: #ffffff;
}

.pane-host {
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.focused-empty {
  align-content: center;
  display: grid;
  gap: 12px;
  justify-items: center;
  min-height: calc(100vh - 70px);
  padding: 24px;
  text-align: center;
}

.focused-empty h2 {
  font-size: 1.2rem;
  margin: 0;
}

.focused-empty p {
  color: #687586;
  margin: 0;
}

.focused-empty button,
.create-grid button,
.sheet-actions button,
.preview-create button {
  background: #24435f;
  border: 1px solid #24435f;
  border-radius: 6px;
  color: #ffffff;
  min-height: 44px;
  padding: 10px 14px;
}

.drawer-backdrop,
.sheet-backdrop {
  background: rgb(31 41 51 / 32%);
  inset: 0;
  position: fixed;
  z-index: 20;
}

.item-drawer,
.create-sheet {
  background: #ffffff;
  box-shadow: 0 -18px 48px rgb(31 41 51 / 18%);
  display: grid;
  gap: 14px;
  max-height: 86vh;
  overflow: auto;
  padding: 14px;
  position: fixed;
  right: 0;
}

.item-drawer {
  bottom: 0;
  left: 0;
}

.create-sheet {
  border-radius: 8px 8px 0 0;
  bottom: 0;
  left: 0;
}

.sheet-header {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.sheet-header h2,
.duplicate-panel h3 {
  margin: 0;
}

.workspace-picker {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.workspace-pill {
  background: #f8fafb;
  border: 1px solid #d8dee6;
  border-radius: 6px;
  color: #3d4b5c;
  min-height: 36px;
  padding: 7px 10px;
  white-space: nowrap;
}

.workspace-pill.active {
  background: #edf6f8;
  border-color: #5a9aaa;
}

.switcher-list,
.create-grid,
.duplicate-panel,
.sheet-actions {
  display: grid;
  gap: 8px;
}

.switcher-row {
  background: #f8fafb;
  border: 1px solid #e0e6eb;
  border-radius: 6px;
  color: inherit;
  display: grid;
  gap: 3px;
  min-height: 62px;
  min-width: 0;
  padding: 9px;
  text-align: left;
  width: 100%;
}

.switcher-row.active {
  background: #edf6f8;
  border-color: #5a9aaa;
}

.item-kind {
  color: #687586;
  font-size: 0.74rem;
  font-weight: 700;
  text-transform: uppercase;
}

.preview-create {
  border: 1px solid #e0e6eb;
  border-radius: 6px;
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 10px;
}

.preview-create legend {
  color: #3d4b5c;
  font-weight: 700;
  padding: 0 4px;
}

.secondary-button {
  background: #ffffff !important;
  border-color: #c8d1dc !important;
  color: #263442 !important;
}
```

- [ ] **Step 2: Tighten existing tool panels for mobile shell height**

In `src/client/styles.css`, replace the existing `.terminal-host`, `.editor-host`, `.preview-frame-wrap`, `.diff-output`, and `.preview-frame` sizing declarations with:

```css
.terminal-host {
  background: #101820;
  height: calc(100vh - 60px);
  min-height: 320px;
  overflow: hidden;
  padding: 8px;
}

.editor-host,
.preview-frame-wrap {
  min-height: calc(100vh - 155px);
  min-width: 0;
  overflow: hidden;
}

.diff-output {
  background: #101820;
  color: #d7dee8;
  font: 12px/1.5 "JetBrains Mono", Menlo, Monaco, Consolas, monospace;
  margin: 0;
  min-height: calc(100vh - 105px);
  overflow: auto;
  padding: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

.preview-frame {
  border: 0;
  height: calc(100vh - 155px);
  min-height: 320px;
  width: 100%;
}
```

- [ ] **Step 3: Add desktop phase-one scaling without persistent dashboard**

Append this media query to `src/client/styles.css`:

```css
@media (min-width: 900px) {
  .item-shell {
    padding: 12px;
  }

  .focused-shell {
    border: 1px solid #d8dee6;
    border-radius: 8px;
    min-height: calc(100vh - 24px);
  }

  .item-drawer,
  .create-sheet {
    border-radius: 8px;
    bottom: 18px;
    left: auto;
    max-width: 420px;
    right: 18px;
    width: min(420px, calc(100vw - 36px));
  }

  .terminal-host {
    height: calc(100vh - 96px);
  }
}
```

- [ ] **Step 4: Run typecheck and build**

Run: `npm run typecheck`

Expected: PASS with 0 TypeScript errors.

Run: `npm run build`

Expected: PASS and writes `dist/client` plus server output.

- [ ] **Step 5: Commit styling**

```bash
git add src/client/styles.css
git commit -m "feat: style mobile item shell"
```

## Task 6: Update Mobile E2E Coverage and Verify

**Files:**
- Modify: `tests/e2e/mvp.spec.ts`

- [ ] **Step 1: Replace the E2E acceptance test with mobile shell flow**

Replace the test body in `tests/e2e/mvp.spec.ts` with this full content:

```ts
import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";

async function startPreviewServer(): Promise<{ port: number; server: Server }> {
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end("preview fixture ok");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Unable to allocate preview server port");
  }

  return { port: address.port, server };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

test("owner uses mobile focused item shell and restores last active item", async ({ page }, testInfo) => {
  const preview = await startPreviewServer();
  testInfo.annotations.push({
    type: "tmux",
    description: "tmux-backed session startup is not exercised here because the app has no E2E cleanup path for durable tmux sessions.",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().clearCookies();
  await page.goto("/");

  try {
    await page.getByLabel("Access token").fill("dev-password");
    await page.getByRole("button", { name: "Connect" }).click();

    await expect(page.getByRole("heading", { name: "No item open" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Workspaces" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create item" })).toBeVisible();

    await page.getByRole("button", { name: "Create item" }).click();
    await expect(page.getByRole("button", { name: "Files" })).toBeVisible();
    await page.getByRole("button", { name: "Files" }).click();
    await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
    await page.getByRole("button", { name: /src/ }).click();
    await page.getByRole("button", { name: /nested\.txt/ }).click();
    await expect(page.getByLabel("File editor").getByText("src/nested.txt")).toBeVisible();
    await expect(page.getByText("nested content")).toBeVisible();

    await page.getByRole("button", { name: "Create item" }).click();
    await page.getByRole("button", { name: "Files" }).click();
    await expect(page.getByRole("heading", { name: "Files is already open" })).toBeVisible();
    await page.getByRole("button", { name: "Focus existing" }).click();
    await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();

    await page.getByRole("button", { name: "Create item" }).click();
    await page.getByRole("button", { name: "Git diff" }).click();
    await expect(page.getByRole("heading", { name: "Git diff" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    await page.getByRole("button", { name: /app\.txt/ }).click();
    await expect(page.getByLabel("Git diff").getByText("-original line")).toBeVisible();
    await expect(page.getByLabel("Git diff").getByText("+changed line")).toBeVisible();

    await page.getByRole("button", { name: "Create item" }).click();
    await page.getByLabel("Port").fill(String(preview.port));
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByRole("heading", { name: new RegExp(`Preview :${preview.port}`) })).toBeVisible();
    await page.getByRole("button", { name: "Expose" }).click();
    await expect(page.getByRole("link", { name: "Open in new tab" })).toBeVisible();
    await expect(page.frameLocator(`iframe[title="Preview port ${preview.port}"]`).getByText("preview fixture ok")).toBeVisible();

    await page.getByRole("button", { name: "Open item switcher" }).click();
    await expect(page.getByLabel("Item switcher").getByRole("button", { name: /Files/ })).toBeVisible();
    await expect(page.getByLabel("Item switcher").getByRole("button", { name: /Git diff/ })).toBeVisible();
    await page.getByLabel("Item switcher").getByRole("button", { name: /Files/ }).click();
    await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Workspaces" })).toHaveCount(0);
  } finally {
    await closeServer(preview.server);
  }
});
```

- [ ] **Step 2: Run the focused unit and E2E tests**

Run: `npm test -- tests/client/itemLayout.test.ts`

Expected: PASS with 6 tests passing.

Run: `npm run test:e2e`

Expected: PASS with the mobile focused item shell test passing.

- [ ] **Step 3: Run full verification**

Run: `npm test`

Expected: PASS for all Vitest suites.

Run: `npm run build`

Expected: PASS with client and server artifacts written under `dist/`.

- [ ] **Step 4: Commit E2E coverage**

```bash
git add tests/e2e/mvp.spec.ts
git commit -m "test: cover mobile item shell flow"
```

## Self-Review Notes

- Spec coverage: The plan covers the item model, one-pane phase-one layout, mobile focused renderer, item switcher, fixed create sheet, duplicate prompts, restore after refresh, auth failure reset, workspace load errors, terminal/file/git/preview routing, and mobile E2E validation.
- Backend scope: Existing session, file, git, preview, auth, and terminal APIs remain unchanged. Terminal-backed agent sessions continue to render through `TerminalPane`.
- Future desktop splits: `BrowserLayout` includes `activePaneId`, `panes`, and pane-local `itemIds`, so a later renderer can add visible split panes without changing item renderers.
- Test coverage: Pure unit tests cover normalization, duplicate/equivalent items, session reconciliation, and active focus. Playwright covers practical switcher and create sheet behavior at a mobile viewport.
