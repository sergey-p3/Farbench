# Right Tab Shortcut Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a compact transparent right-side shortcut rail for switching between open workspace items.

**Architecture:** `WorkspaceShell` already owns `visibleItems`, `active`, and `focusExistingItem`, so the rail can live there without new global state. Styling belongs in `src/client/styles.css` beside the focused shell styles.

**Tech Stack:** React 19, TypeScript, CSS, Playwright.

---

### Task 1: E2E Coverage

**Files:**
- Modify: `tests/e2e/mvp.spec.ts`

- [ ] Add a focused Playwright test that seeds persisted open Files, Git diff, and Preview items.
- [ ] Verify the rail is visible, contains shortcut buttons for open items, can focus Files, and has vertical overflow enabled.
- [ ] Run `npm run test:e2e -- tests/e2e/mvp.spec.ts --grep "right-side shortcut rail"` and confirm the new assertions fail before implementation.

### Task 2: Workspace Shell Rail

**Files:**
- Modify: `src/client/components/WorkspaceShell.tsx`

- [ ] Add a `tab-shortcut-rail` nav after `PaneHost`.
- [ ] Render one button per `visibleItems` entry when at least one item is open.
- [ ] Use `focusExistingItem(item.id)` on click.
- [ ] Mark the active button with `active`, `aria-current="page"`, and `aria-pressed`.

### Task 3: Responsive Styling

**Files:**
- Modify: `src/client/styles.css`

- [ ] Position the rail fixed to the right side of the workspace panel.
- [ ] Use transparent background, blur, and subtle border.
- [ ] Set `max-height`, `overflow-y: auto`, stable button dimensions, and small-screen sizing.
- [ ] Ensure it layers below modal drawers/sheets and does not affect pane layout.

### Task 4: Verification

**Files:**
- Run tests only.

- [ ] Run the focused Playwright test and confirm it passes.
- [ ] Run `npm run typecheck`.
