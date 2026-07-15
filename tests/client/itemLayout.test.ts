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
  removeItem,
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

  test("strips malformed persisted item config", () => {
    const normalized = normalizeLayout({
      selectedWorkspaceId: "w1",
      activePaneId: "main",
      panes: [{ id: "main", activeItemId: "preview:w1:3000:%2F", itemIds: ["preview:w1:3000:%2F"] }],
      items: [{
        id: "preview:w1:3000:%2F",
        workspaceId: "w1",
        kind: "preview",
        title: "Preview :3000",
        status: "ready",
        config: { port: "3000", path: 42 },
      }],
    });

    expect(normalized.items[0].config).toBeUndefined();
  });

  test("drops duplicate pane ids during normalization", () => {
    const filesItem: WorkspaceItem = createBrowserItem({ kind: "files", workspaceId: "w1" });
    const gitItem: WorkspaceItem = createBrowserItem({ kind: "git", workspaceId: "w1" });
    const normalized = normalizeLayout({
      selectedWorkspaceId: "w1",
      activePaneId: "main",
      panes: [
        { id: "main", activeItemId: filesItem.id, itemIds: [filesItem.id] },
        { id: "main", activeItemId: gitItem.id, itemIds: [gitItem.id] },
      ],
      items: [filesItem, gitItem],
    });

    expect(normalized.panes).toEqual([{ id: "main", activeItemId: filesItem.id, itemIds: [filesItem.id] }]);
  });

  test("dedupes pane item ids during normalization", () => {
    const item: WorkspaceItem = createBrowserItem({ kind: "files", workspaceId: "w1" });
    const normalized = normalizeLayout({
      selectedWorkspaceId: "w1",
      activePaneId: "main",
      panes: [{ id: "main", activeItemId: item.id, itemIds: [item.id, item.id, "ghost", item.id] }],
      items: [item],
    });

    expect(normalized.panes[0]).toEqual({ id: "main", activeItemId: item.id, itemIds: [item.id] });
  });

  test("clears active item when it is not in the pane item ids", () => {
    const item: WorkspaceItem = createBrowserItem({ kind: "files", workspaceId: "w1" });
    const normalized = normalizeLayout({
      selectedWorkspaceId: "w1",
      activePaneId: "main",
      panes: [{ id: "main", activeItemId: item.id, itemIds: [] }],
      items: [item],
    });

    expect(normalized.panes[0]).toEqual({ id: "main", activeItemId: null, itemIds: [] });
  });

  test("dedupes persisted workspace items by id", () => {
    const firstItem: WorkspaceItem = createBrowserItem({ kind: "files", workspaceId: "w1", now: "2026-06-21T10:00:00.000Z" });
    const duplicateItem: WorkspaceItem = {
      ...createBrowserItem({ kind: "git", workspaceId: "w1", now: "2026-06-21T10:01:00.000Z" }),
      id: firstItem.id,
    };
    const normalized = normalizeLayout({
      selectedWorkspaceId: "w1",
      activePaneId: "main",
      panes: [{ id: "main", activeItemId: firstItem.id, itemIds: [firstItem.id] }],
      items: [firstItem, duplicateItem],
    });

    expect(normalized.items).toEqual([firstItem]);
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

  test("keeps missing durable session items as disconnected recovery items", () => {
    const withSession = reconcileSessions(defaultLayout, "w1", [
      session({ id: "bash-1", type: "bash", name: "shell", lastActivityAt: "2026-06-21T10:30:00.000Z" }),
    ], "2026-06-21T11:00:00.000Z");
    const reconciled = reconcileSessions(withSession, "w1", [], "2026-06-21T11:05:00.000Z");
    const item = reconciled.items.find((candidate) => candidate.id === sessionItemId("bash-1"));

    expect(item).toMatchObject({
      id: sessionItemId("bash-1"),
      workspaceId: "w1",
      kind: "terminal",
      title: "shell",
      status: "disconnected",
      config: { runtime: "bash" },
      lastActiveAt: "2026-06-21T10:30:00.000Z",
    });
    expect(item).not.toHaveProperty("sessionId");
    expect(reconciled.panes[0].itemIds).toContain(sessionItemId("bash-1"));
    expect(reconciled.panes[0].activeItemId).toBe(sessionItemId("bash-1"));
  });

  test("does not reconcile terminal history into open items", () => {
    const reconciled = reconcileSessions(defaultLayout, "w1", [
      session({ id: "killed-1", status: "killed", endedAt: "2026-06-21T10:30:00.000Z" }),
      session({ id: "exited-1", status: "exited", endedAt: "2026-06-21T10:31:00.000Z" }),
      session({ id: "running-1", status: "running" }),
    ], "2026-06-21T11:00:00.000Z");

    expect(reconciled.items.map((item) => item.id)).toEqual([sessionItemId("running-1")]);
    expect(reconciled.panes[0].itemIds).toEqual([sessionItemId("running-1")]);
  });

  test("removeItem removes an item from panes and focuses the next item to the right", () => {
    const filesItem = createBrowserItem({ kind: "files", workspaceId: "w1", now: "2026-06-21T10:00:00.000Z" });
    const gitItem = createBrowserItem({ kind: "git", workspaceId: "w1", now: "2026-06-21T10:01:00.000Z" });
    const previewItem = createBrowserItem({ kind: "preview", workspaceId: "w1", port: 3000, path: "/", now: "2026-06-21T10:02:00.000Z" });
    const layout = focusItem(addItemAndFocus(addItemAndFocus(addItemAndFocus(defaultLayout, filesItem), gitItem), previewItem), gitItem.id);

    const closed = removeItem(layout, gitItem.id);

    expect(closed.items.map((item) => item.id)).toEqual([filesItem.id, previewItem.id]);
    expect(closed.panes[0]).toEqual({ id: "main", activeItemId: previewItem.id, itemIds: [filesItem.id, previewItem.id] });
  });

  test("removeItem focuses the previous item when closing the last active item", () => {
    const filesItem = createBrowserItem({ kind: "files", workspaceId: "w1" });
    const gitItem = createBrowserItem({ kind: "git", workspaceId: "w1" });
    const layout = addItemAndFocus(addItemAndFocus(defaultLayout, filesItem), gitItem);

    const closed = removeItem(layout, gitItem.id);

    expect(closed.panes[0]).toEqual({ id: "main", activeItemId: filesItem.id, itemIds: [filesItem.id] });
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
