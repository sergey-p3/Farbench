# Mobile Terminal Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mobile terminal scrollable, visible above the software keyboard, and able to send special keys with one-shot sticky `Ctrl`.

**Architecture:** Add a small pure key-mapping helper for terminal control sequences, then wire it into `TerminalPane` through a compact toolbar. Keep the terminal websocket protocol unchanged and handle viewport changes locally with `visualViewport`, `ResizeObserver`, and the existing xterm fit addon.

**Tech Stack:** React 19, TypeScript, xterm, xterm-addon-fit, Vitest, Playwright.

---

## File Structure

- Create `src/client/terminalKeys.ts`: pure helpers for toolbar key definitions and one-shot `Ctrl` mapping.
- Create `tests/client/terminalKeys.test.ts`: Vitest coverage for special key sequences and sticky `Ctrl` behavior.
- Modify `src/client/components/TerminalPane.tsx`: integrate toolbar, shared input sending, visual viewport refit handling, and touch scroll behavior.
- Modify `src/client/styles.css`: add terminal toolbar layout, mobile viewport sizing, and xterm touch scrolling rules.
- Modify `tests/e2e/mvp.spec.ts`: add focused mobile assertions for terminal toolbar visibility and reduced viewport sizing.

---

### Task 1: Terminal Key Mapper

**Files:**
- Create: `src/client/terminalKeys.ts`
- Test: `tests/client/terminalKeys.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/client/terminalKeys.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { terminalControlSequence, terminalKeyLabels, type TerminalToolbarKey } from "../../src/client/terminalKeys.js";

describe("terminal toolbar keys", () => {
  test("exposes compact labels for mobile toolbar rendering", () => {
    expect(terminalKeyLabels.map((key) => key.label)).toEqual(["Ctrl", "Esc", "Tab", "Enter", "←", "↑", "↓", "→", "C", "D", "L"]);
  });

  test.each([
    ["escape", false, "\x1b", false],
    ["tab", false, "\t", false],
    ["enter", false, "\r", false],
    ["left", false, "\x1b[D", false],
    ["up", false, "\x1b[A", false],
    ["down", false, "\x1b[B", false],
    ["right", false, "\x1b[C", false],
    ["c", false, "c", false],
    ["d", false, "d", false],
    ["l", false, "l", false],
  ] satisfies Array<[TerminalToolbarKey, boolean, string, boolean]>)(
    "maps %s without sticky ctrl",
    (key, ctrlActive, data, clearsCtrl) => {
      expect(terminalControlSequence(key, ctrlActive)).toEqual({ data, clearsCtrl });
    },
  );

  test.each([
    ["c", "\x03"],
    ["d", "\x04"],
    ["l", "\x0c"],
  ] satisfies Array<[TerminalToolbarKey, string]>)("maps Ctrl+%s to a control character and clears ctrl", (key, data) => {
    expect(terminalControlSequence(key, true)).toEqual({ data, clearsCtrl: true });
  });

  test("keeps non-letter special keys unchanged and clears sticky ctrl", () => {
    expect(terminalControlSequence("escape", true)).toEqual({ data: "\x1b", clearsCtrl: true });
    expect(terminalControlSequence("left", true)).toEqual({ data: "\x1b[D", clearsCtrl: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/client/terminalKeys.test.ts
```

Expected: fail because `src/client/terminalKeys.ts` does not exist.

- [ ] **Step 3: Implement the minimal key mapper**

Create `src/client/terminalKeys.ts`:

```typescript
export type TerminalToolbarKey =
  | "ctrl"
  | "escape"
  | "tab"
  | "enter"
  | "left"
  | "up"
  | "down"
  | "right"
  | "c"
  | "d"
  | "l";

export interface TerminalToolbarKeyDefinition {
  key: TerminalToolbarKey;
  label: string;
  ariaLabel: string;
}

export interface TerminalControlSequence {
  data: string;
  clearsCtrl: boolean;
}

export const terminalKeyLabels: TerminalToolbarKeyDefinition[] = [
  { key: "ctrl", label: "Ctrl", ariaLabel: "Sticky Control modifier" },
  { key: "escape", label: "Esc", ariaLabel: "Escape" },
  { key: "tab", label: "Tab", ariaLabel: "Tab" },
  { key: "enter", label: "Enter", ariaLabel: "Enter" },
  { key: "left", label: "←", ariaLabel: "Left arrow" },
  { key: "up", label: "↑", ariaLabel: "Up arrow" },
  { key: "down", label: "↓", ariaLabel: "Down arrow" },
  { key: "right", label: "→", ariaLabel: "Right arrow" },
  { key: "c", label: "C", ariaLabel: "C" },
  { key: "d", label: "D", ariaLabel: "D" },
  { key: "l", label: "L", ariaLabel: "L" },
];

const directSequences: Partial<Record<TerminalToolbarKey, string>> = {
  escape: "\x1b",
  tab: "\t",
  enter: "\r",
  left: "\x1b[D",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  c: "c",
  d: "d",
  l: "l",
};

export function terminalControlSequence(key: TerminalToolbarKey, ctrlActive: boolean): TerminalControlSequence | null {
  if (key === "ctrl") return null;

  if (ctrlActive && isControlLetter(key)) {
    return { data: String.fromCharCode(key.toUpperCase().charCodeAt(0) - 64), clearsCtrl: true };
  }

  const data = directSequences[key];
  if (!data) return null;
  return { data, clearsCtrl: ctrlActive };
}

function isControlLetter(key: TerminalToolbarKey): key is "c" | "d" | "l" {
  return key === "c" || key === "d" || key === "l";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/client/terminalKeys.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/terminalKeys.ts tests/client/terminalKeys.test.ts
git commit -m "feat: add terminal key mapper"
```

---

### Task 2: Terminal Toolbar and Viewport Handling

**Files:**
- Modify: `src/client/components/TerminalPane.tsx`
- Modify: `src/client/styles.css`

- [ ] **Step 1: Write the failing E2E assertions**

In `tests/e2e/mvp.spec.ts`, add this test after the existing mobile test:

```typescript
test("mobile terminal exposes special keys and stays inside a reduced viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().clearCookies();
  await page.goto("/");

  await page.getByLabel("Access token").fill("dev-password");
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByRole("button", { name: "Create item" }).click();
  await page.getByRole("button", { name: "Terminal" }).click();

  const toolbar = page.getByRole("toolbar", { name: "Terminal special keys" });
  await expect(toolbar.getByRole("button", { name: "Sticky Control modifier" })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Escape" })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Left arrow" })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Up arrow" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 520 });
  await expect(toolbar).toBeVisible();
  const paneBox = await page.getByLabel("Focused item").boundingBox();
  const toolbarBox = await toolbar.boundingBox();

  expect(paneBox).not.toBeNull();
  expect(toolbarBox).not.toBeNull();
  expect(Math.round((toolbarBox?.bottom ?? 9999))).toBeLessThanOrEqual(520);
});
```

- [ ] **Step 2: Run E2E to verify it fails**

Run:

```bash
npm run test:e2e -- tests/e2e/mvp.spec.ts -g "mobile terminal exposes special keys"
```

Expected: fail because the toolbar does not exist.

- [ ] **Step 3: Add terminal toolbar state and input path**

Modify `src/client/components/TerminalPane.tsx` so imports and component state include the key mapper:

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "xterm-addon-fit";
import { Terminal } from "xterm";
import { api, isUnauthorized } from "../api.js";
import { terminalControlSequence, terminalKeyLabels, type TerminalToolbarKey } from "../terminalKeys.js";
```

Inside `TerminalPane`, add:

```typescript
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [isCtrlActive, setIsCtrlActive] = useState(false);

  const sendTerminalInput = useCallback((data: string) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "input", data }));
  }, []);

  const handleToolbarKey = useCallback((key: TerminalToolbarKey) => {
    if (key === "ctrl") {
      setIsCtrlActive((current) => !current);
      terminalRef.current?.focus();
      return;
    }

    const sequence = terminalControlSequence(key, isCtrlActive);
    if (!sequence) return;
    sendTerminalInput(sequence.data);
    if (sequence.clearsCtrl) setIsCtrlActive(false);
    terminalRef.current?.focus();
  }, [isCtrlActive, sendTerminalInput]);
```

Replace the existing `terminal.onData` body with:

```typescript
    const dataDisposable = terminal.onData((data) => {
      setIsCtrlActive(false);
      sendTerminalInput(data);
    });
```

Include `sendTerminalInput` in the effect dependency list:

```typescript
  }, [onUnauthorized, retryNonce, sendTerminalInput, sessionId]);
```

- [ ] **Step 4: Add viewport refit handling**

Inside the terminal setup effect, replace the existing resize listener block with:

```typescript
    const fitAndResize = () => {
      fit();
      sendResize();
    };

    const syncVisualViewport = () => {
      const viewport = window.visualViewport;
      if (rootRef.current && viewport) {
        rootRef.current.style.setProperty("--terminal-visual-height", `${viewport.height}px`);
      }
      fitAndResize();
    };

    syncVisualViewport();
    window.addEventListener("resize", syncVisualViewport);
    window.visualViewport?.addEventListener("resize", syncVisualViewport);
    window.visualViewport?.addEventListener("scroll", syncVisualViewport);
    const resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(containerRef.current);
```

Remove the old `handleResize` function and old `window.addEventListener("resize", handleResize)`.

In cleanup, remove the new listeners and observer:

```typescript
      window.removeEventListener("resize", syncVisualViewport);
      window.visualViewport?.removeEventListener("resize", syncVisualViewport);
      window.visualViewport?.removeEventListener("scroll", syncVisualViewport);
      resizeObserver.disconnect();
```

- [ ] **Step 5: Render the toolbar**

Change the session render root:

```tsx
    <div className="tool-panel terminal-pane" ref={rootRef}>
```

Add the toolbar after the terminal host:

```tsx
      <div className="terminal-host" ref={containerRef} />
      <div className="terminal-keybar" role="toolbar" aria-label="Terminal special keys">
        {terminalKeyLabels.map((key) => (
          <button
            aria-label={key.ariaLabel}
            aria-pressed={key.key === "ctrl" ? isCtrlActive : undefined}
            className={key.key === "ctrl" && isCtrlActive ? "active" : undefined}
            key={key.key}
            onClick={() => handleToolbarKey(key.key)}
            type="button"
          >
            {key.label}
          </button>
        ))}
      </div>
```

- [ ] **Step 6: Add CSS for mobile layout and scrolling**

Modify `src/client/styles.css`:

```css
.terminal-pane {
  height: 100%;
  overflow: hidden;
  --terminal-visual-height: 100vh;
}

.terminal-pane,
.preview-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
}

.terminal-pane {
  grid-template-rows: auto minmax(0, 1fr) auto;
}

.terminal-host {
  background: #101820;
  grid-row: 2;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 8px;
  touch-action: pan-y;
}

.terminal-host .xterm,
.terminal-host .xterm-screen {
  height: 100%;
}

.terminal-host .xterm-viewport {
  overflow-y: auto !important;
  -webkit-overflow-scrolling: touch;
}

.terminal-keybar {
  align-items: center;
  background: #0d141b;
  border-top: 1px solid #22313f;
  display: flex;
  gap: 6px;
  grid-row: 3;
  min-height: 44px;
  overflow-x: auto;
  padding: 6px 8px;
}

.terminal-keybar button {
  background: #182533;
  border: 1px solid #344657;
  border-radius: 6px;
  color: #d7dee8;
  flex: 0 0 auto;
  font-size: 0.82rem;
  font-weight: 700;
  min-height: 32px;
  min-width: 42px;
  padding: 6px 9px;
}

.terminal-keybar button.active,
.terminal-keybar button[aria-pressed="true"] {
  background: #edf6f8;
  border-color: #5a9aaa;
  color: #101820;
}

@media (max-width: 760px) {
  .terminal-pane {
    max-height: calc(var(--terminal-visual-height) - 58px);
  }
}
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
npm test -- tests/client/terminalKeys.test.ts
npm run test:e2e -- tests/e2e/mvp.spec.ts -g "mobile terminal exposes special keys"
```

Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add src/client/components/TerminalPane.tsx src/client/styles.css tests/e2e/mvp.spec.ts
git commit -m "feat: add mobile terminal controls"
```

---

### Task 3: Full Verification

**Files:**
- Verify repository state; no source edits expected.

- [ ] **Step 1: Run unit tests**

```bash
npm test
```

Expected: all Vitest tests pass.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: TypeScript reports no errors.

- [ ] **Step 3: Run focused E2E coverage**

```bash
npm run test:e2e -- tests/e2e/mvp.spec.ts
```

Expected: mobile item shell and mobile terminal tests pass.

- [ ] **Step 4: Inspect git state**

```bash
git status --short
```

Expected: no uncommitted changes after implementation commits.
