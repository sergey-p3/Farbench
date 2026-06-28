# Terminal Context Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a terminal context-menu `Select` action that preselects the word under the pointer and lets users copy or expand that selection.

**Architecture:** Keep the behavior client-side. Add a pure terminal-selection helper for coordinate and word-bound calculations, then wire it into `TerminalPane` using xterm public APIs and the existing context menu.

**Tech Stack:** React 19, TypeScript, xterm 5.3, Vitest, Playwright.

---

### Task 1: Terminal Selection Helper

**Files:**
- Create: `src/client/terminalSelection.ts`
- Create: `tests/client/terminalSelection.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/client/terminalSelection.test.ts` with tests for cell coordinate conversion and word expansion.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- tests/client/terminalSelection.test.ts`

Expected: fail because `src/client/terminalSelection.ts` does not exist.

- [ ] **Step 3: Implement minimal helper code**

Create `src/client/terminalSelection.ts` with exported helpers for `terminalCellFromPointer`, `terminalWordRangeAtCell`, and `isTerminalWordCharacter`.

- [ ] **Step 4: Run the helper tests and verify GREEN**

Run: `npm test -- tests/client/terminalSelection.test.ts`

Expected: pass.

### Task 2: TerminalPane Context Menu Integration

**Files:**
- Modify: `src/client/components/TerminalPane.tsx`
- Modify: `tests/e2e/mvp.spec.ts`

- [ ] **Step 1: Write the failing E2E test**

Extend the existing mobile terminal test to grant clipboard permissions, open the terminal context menu over a known word, assert `Select` appears, click `Copy`, and assert the clipboard contains that word.

- [ ] **Step 2: Run the E2E test and verify RED**

Run: `npm run test:e2e -- tests/e2e/mvp.spec.ts -g "mobile terminal special keys"`

Expected: fail because the `Select` menu item is missing or the clipboard remains empty.

- [ ] **Step 3: Wire selection into `TerminalPane`**

Update the context menu state to include pointer coordinates, preselect a word when the menu opens, add the `Select` menu item, and use the helper to call `terminal.select(column, row, length)`.

- [ ] **Step 4: Run focused verification**

Run:

```bash
npm test -- tests/client/terminalSelection.test.ts
npm run test:e2e -- tests/e2e/mvp.spec.ts -g "mobile terminal special keys"
npm run typecheck
```

Expected: all pass.

## Self-Review

- Spec coverage: covers menu item, word preselection, copy via existing selection, and xterm-native expansion behavior.
- Placeholder scan: no placeholder steps remain.
- Type consistency: helper names and planned integration points are consistent across tasks.
