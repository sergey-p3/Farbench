# Terminal And Agent Connection Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show status text while terminal and agent panes connect, attach, and wait for history so the surface is not a blank black pane.

**Architecture:** `ItemRenderer` passes the item kind to `TerminalPane`. `TerminalPane` tracks a small client-only connection phase and renders a passive overlay inside the terminal stage only while no terminal content is visible.

**Tech Stack:** TypeScript, React, xterm, Playwright, Vitest.

---

## File Structure

- Modify `src/client/components/TerminalPane.tsx`: add display kind props, connection phase tracking, and stage overlay rendering.
- Modify `src/client/components/ItemRenderer.tsx`: pass terminal versus agent display kind into `TerminalPane`.
- Modify `src/client/styles.css`: style the passive connection overlay.
- Modify `tests/e2e/mvp.spec.ts`: add fake-WebSocket coverage for terminal and agent connection phases and overlay dismissal.

## Tasks

### Task 1: E2E Failing Coverage

- [x] Add a Playwright test in `tests/e2e/mvp.spec.ts` that installs a delayed fake WebSocket, opens a terminal item, asserts `Connecting to terminal...`, releases socket open, asserts `Loading terminal history...`, releases scrollback, and asserts the status disappears.
- [x] Add a second Playwright path for an agent item with persisted layout or mocked session data that asserts `Connecting to agent...`.
- [x] Run `npm run test:e2e -- tests/e2e/mvp.spec.ts -g "connection status"` and confirm the new expectations fail because no overlay exists.

### Task 2: TerminalPane Status Model

- [x] In `src/client/components/TerminalPane.tsx`, add `displayKind?: "terminal" | "agent"` to `TerminalPaneProps`.
- [x] Add `type ConnectionPhase = "connecting" | "attaching" | "loading-history" | null`.
- [x] Initialize the phase to `connecting` when a session effect starts.
- [x] Set phase to `null` when cached scrollback is written.
- [x] Set phase to `attaching` after WebSocket open and before sending attach.
- [x] Set phase to `loading-history` after attach is sent.
- [x] Set phase to `null` when scrollback, output, error, or exit is received.
- [x] Render a passive status overlay inside `.terminal-stage` when the phase is non-null and `status` is null.

### Task 3: Agent Copy Wiring And Styling

- [x] In `src/client/components/ItemRenderer.tsx`, pass `displayKind={item.kind}` for terminal and agent items.
- [x] Add a helper in `TerminalPane.tsx` that maps display kind and phase to `Connecting to terminal...`, `Attaching terminal...`, `Loading terminal history...`, `Connecting to agent...`, `Attaching agent...`, and `Loading agent history...`.
- [x] In `src/client/styles.css`, add `.terminal-connection-status` and child styles. Keep it centered, readable on the terminal background, and non-interactive with `pointer-events: none`.

### Task 4: Verification

- [x] Run `npm run test:e2e -- tests/e2e/mvp.spec.ts -g "connection status"` and confirm the new tests pass.
- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
