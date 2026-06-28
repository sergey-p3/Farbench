# Close Session Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a close action that removes the visible tab and kills the backing tmux session for `bash`, `codex`, and `claude` items.

**Architecture:** The server exposes a session delete route that validates workspace ownership, kills tmux when present, marks the session `killed`, and audits the action. The client adds a close action in the item switcher, removes local items from the persisted layout, and filters terminal history out of automatic tab reconciliation.

**Tech Stack:** TypeScript, Express, React, Vitest, Playwright.

---

## File Structure

- Modify `src/server/http/createApp.ts`: add `DELETE /api/workspaces/:workspaceId/sessions/:sessionId`.
- Modify `src/client/api.ts`: add `killSession`.
- Modify `src/client/itemLayout.ts`: add `removeItem` and skip terminal session history during reconciliation.
- Modify `src/client/components/WorkspaceShell.tsx`: implement close flow and error handling.
- Modify `src/client/components/ItemSwitcher.tsx`: add per-item close button.
- Modify `src/client/styles.css`: style switcher rows with close controls.
- Modify `tests/server/sessionState.test.ts`: assert killed status remains terminal.
- Add `tests/server/sessionApi.test.ts`: exercise delete route behavior.
- Modify `tests/client/itemLayout.test.ts`: cover close layout behavior and killed session filtering.
- Modify `tests/e2e/mvp.spec.ts`: verify mocked terminal tab close sends DELETE and removes the item.

## Tasks

### Task 1: Server Session Delete API

- [x] Add failing tests in `tests/server/sessionApi.test.ts` for deleting a session.
- [x] Run `npm test -- tests/server/sessionApi.test.ts` and confirm the delete route returns 404 before implementation.
- [x] Add the delete route to `src/server/http/createApp.ts`.
- [x] Run `npm test -- tests/server/sessionApi.test.ts tests/server/sessionState.test.ts`.

### Task 2: Client Layout Close Behavior

- [x] Add failing tests in `tests/client/itemLayout.test.ts` for `removeItem` and terminal-history filtering.
- [x] Run `npm test -- tests/client/itemLayout.test.ts` and confirm `removeItem` is missing or killed sessions still reconcile into items.
- [x] Implement `removeItem` and skip `exited`, `crashed`, and `killed` sessions in `reconcileSessions`.
- [x] Run `npm test -- tests/client/itemLayout.test.ts`.

### Task 3: Client Close UI Flow

- [x] Add `api.killSession` in `src/client/api.ts`.
- [x] Thread `onCloseItem` from `WorkspaceShell` into `ItemSwitcher`.
- [x] Add a per-row close button that stops row focus clicks.
- [x] Close session items through `api.killSession`, then remove them locally; close browser-only items locally.
- [x] Run `npm run typecheck`.

### Task 4: E2E Verification

- [x] Extend the mocked terminal route in `tests/e2e/mvp.spec.ts` to handle `DELETE`.
- [x] Add assertions that closing a terminal item sends the delete request and removes the item from the switcher.
- [x] Run `npm test -- tests/client/itemLayout.test.ts tests/server/sessionApi.test.ts tests/server/sessionState.test.ts`.
- [x] Run `npm run typecheck`.
