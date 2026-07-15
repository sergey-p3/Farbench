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
