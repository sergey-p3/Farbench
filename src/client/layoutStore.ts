import type { BrowserLayout } from "../shared/types.js";

const STORAGE_KEY = "remote-dev-layout";

export const defaultLayout: BrowserLayout = {
  selectedWorkspaceId: null,
  selectedSessionId: null,
  openEditorPaths: [],
  split: "terminal",
};

function isSplit(value: unknown): value is BrowserLayout["split"] {
  return value === "terminal" || value === "files" || value === "git" || value === "preview";
}

function normalizeLayout(value: unknown): BrowserLayout {
  if (typeof value !== "object" || value === null) {
    return defaultLayout;
  }

  const candidate = value as Partial<BrowserLayout>;
  return {
    selectedWorkspaceId: typeof candidate.selectedWorkspaceId === "string" ? candidate.selectedWorkspaceId : null,
    selectedSessionId: typeof candidate.selectedSessionId === "string" ? candidate.selectedSessionId : null,
    openEditorPaths: Array.isArray(candidate.openEditorPaths)
      ? candidate.openEditorPaths.filter((path): path is string => typeof path === "string")
      : [],
    split: isSplit(candidate.split) ? candidate.split : "terminal",
  };
}

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
