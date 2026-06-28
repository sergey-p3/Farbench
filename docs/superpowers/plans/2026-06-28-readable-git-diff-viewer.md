# Readable Git Diff Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only Git diff viewer with side-by-side and line-by-line modes, plus copy support for new-file locations.

**Architecture:** Add a structured Git file diff response beside the existing status flow, while keeping the raw patch endpoint available as a fallback. Reuse Monaco through `@monaco-editor/react` for the read-only diff editor, and isolate mode/copy behavior in small client helpers that can be tested without a browser renderer.

**Tech Stack:** TypeScript, Express, React, Monaco, Vitest, Playwright.

---

## File Structure

- Modify `src/shared/types.ts`: add structured Git diff response types.
- Modify `src/server/agent/AgentGateway.ts`: add `gitFileDiff`.
- Modify `src/server/agent/LocalAgent.ts`: implement structured file content loading from Git and the working tree.
- Modify `src/server/http/createApp.ts`: add `/api/workspaces/:workspaceId/git/file-diff`.
- Modify `src/client/api.ts`: add `api.gitFileDiff`.
- Create `src/client/gitDiffView.ts`: pure helpers for mode defaults and copy payloads.
- Create `src/client/components/GitDiffViewer.tsx`: read-only Monaco diff rendering and copy UI.
- Modify `src/client/components/GitPanel.tsx`: fetch structured diffs and render `GitDiffViewer`.
- Modify `src/client/styles.css`: add compact segmented controls and diff viewer sizing.
- Modify `tests/server/git.test.ts`: add structured diff coverage.
- Create `tests/client/gitDiffView.test.ts`: test pure client behavior.
- Modify `tests/e2e/mvp.spec.ts`: update the Git panel smoke assertions for the readable viewer.

## Task 1: Shared Diff Types

**Files:**
- Modify: `src/shared/types.ts`
- Test: `npm run typecheck`

- [ ] **Step 1: Add response types**

Add these types after `GitStatusResponse`:

```ts
export type GitFileDiffKind = "text" | "binary" | "too-large" | "unavailable";

export interface GitFileDiffResponse {
  path: string;
  kind: GitFileDiffKind;
  original: string;
  current: string;
  patch: string;
  message: string | null;
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add structured git diff types"
```

## Task 2: Server Structured Diff API

**Files:**
- Modify: `src/server/agent/AgentGateway.ts`
- Modify: `src/server/agent/LocalAgent.ts`
- Modify: `src/server/http/createApp.ts`
- Modify: `tests/server/git.test.ts`

- [ ] **Step 1: Write failing LocalAgent tests**

Append these tests inside `describe("LocalAgent git integration", () => { ... })` in `tests/server/git.test.ts`:

```ts
  it("returns structured content for an unstaged tracked file", async () => {
    dir = mkdtempSync(join(tmpdir(), "remote-dev-git-"));
    git(["init"], dir);
    git(["config", "user.email", "dev@example.com"], dir);
    git(["config", "user.name", "Dev"], dir);
    writeFileSync(join(dir, "app.txt"), "one\n");
    git(["add", "app.txt"], dir);
    git(["commit", "-m", "initial"], dir);
    writeFileSync(join(dir, "app.txt"), "two\n");

    const diff = await new LocalAgent().gitFileDiff(dir, "app.txt");

    expect(diff).toMatchObject({
      path: "app.txt",
      kind: "text",
      original: "one\n",
      current: "two\n",
      message: null,
    });
    expect(diff.patch).toContain("-one");
    expect(diff.patch).toContain("+two");
  });

  it("returns structured content for staged-only changes", async () => {
    dir = mkdtempSync(join(tmpdir(), "remote-dev-git-"));
    git(["init"], dir);
    git(["config", "user.email", "dev@example.com"], dir);
    git(["config", "user.name", "Dev"], dir);
    writeFileSync(join(dir, "app.txt"), "one\n");
    git(["add", "app.txt"], dir);
    git(["commit", "-m", "initial"], dir);
    writeFileSync(join(dir, "app.txt"), "two\n");
    git(["add", "app.txt"], dir);

    const diff = await new LocalAgent().gitFileDiff(dir, "app.txt");

    expect(diff.original).toBe("one\n");
    expect(diff.current).toBe("two\n");
    expect(diff.kind).toBe("text");
  });

  it("returns structured content for added and deleted files", async () => {
    dir = mkdtempSync(join(tmpdir(), "remote-dev-git-"));
    git(["init"], dir);
    git(["config", "user.email", "dev@example.com"], dir);
    git(["config", "user.name", "Dev"], dir);
    writeFileSync(join(dir, "deleted.txt"), "gone\n");
    git(["add", "deleted.txt"], dir);
    git(["commit", "-m", "initial"], dir);
    writeFileSync(join(dir, "added.txt"), "new\n");
    git(["add", "added.txt"], dir);
    git(["rm", "deleted.txt"], dir);

    const agent = new LocalAgent();
    const added = await agent.gitFileDiff(dir, "added.txt");
    const deleted = await agent.gitFileDiff(dir, "deleted.txt");

    expect(added.original).toBe("");
    expect(added.current).toBe("new\n");
    expect(deleted.original).toBe("gone\n");
    expect(deleted.current).toBe("");
  });
```

- [ ] **Step 2: Verify tests fail because `gitFileDiff` is missing**

Run: `npm test -- tests/server/git.test.ts`

Expected: FAIL with a TypeScript or runtime error indicating `gitFileDiff` does not exist.

- [ ] **Step 3: Add the AgentGateway method**

In `src/server/agent/AgentGateway.ts`, import `GitFileDiffResponse` and add:

```ts
  gitFileDiff(rootPath: string, path: string): Promise<GitFileDiffResponse>;
```

- [ ] **Step 4: Implement `LocalAgent.gitFileDiff`**

In `src/server/agent/LocalAgent.ts`, update the promise import to:

```ts
import { open, readFile as readFileFromDisk, readdir, stat } from "node:fs/promises";
```

Also import `GitFileDiffResponse`.

Add these helpers above `export class LocalAgent`:

```ts
function firstPorcelainLine(stdout: string): { indexStatus: string; worktreeStatus: string } {
  const line = stdout.split("\n").find(Boolean) ?? "  ";
  return {
    indexStatus: line[0] ?? " ",
    worktreeStatus: line[1] ?? " ",
  };
}

function textDiffResponse(input: {
  path: string;
  original: string;
  current: string;
  patch: string;
}): GitFileDiffResponse {
  return {
    path: input.path,
    kind: "text",
    original: input.original,
    current: input.current,
    patch: input.patch,
    message: null,
  };
}
```

Add these private methods to `LocalAgent`:

```ts
  private async gitObjectText(rootPath: string, objectPath: string): Promise<string> {
    const { stdout } = await execFileAsync("git", ["show", objectPath], {
      cwd: rootPath,
      encoding: "buffer",
      maxBuffer: 5_000_000,
    });
    const buffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
    if (buffer.length > maxTextFileBytes) throw new Error("File is too large to open");
    if (isLikelyBinary(buffer)) throw new Error("Binary files cannot be edited");
    return buffer.toString("utf8");
  }

  private async workingTreeText(rootPath: string, path: string): Promise<string> {
    const resolved = resolveWorkspacePath(rootPath, path);
    const buffer = await readFileFromDisk(resolved.absolutePath);
    if (buffer.length > maxTextFileBytes) throw new Error("File is too large to open");
    if (isLikelyBinary(buffer)) throw new Error("Binary files cannot be edited");
    return buffer.toString("utf8");
  }
```

Add this public method near `gitDiff`:

```ts
  async gitFileDiff(rootPath: string, path: string): Promise<GitFileDiffResponse> {
    const resolved = resolveWorkspacePath(rootPath, path);
    const patch = await this.gitDiff(rootPath, path);
    const status = await execFileAsync("git", ["status", "--porcelain=v1", "--", resolved.relativePath], { cwd: rootPath });
    const { indexStatus, worktreeStatus } = firstPorcelainLine(status.stdout);

    try {
      if (worktreeStatus !== " " && worktreeStatus !== "?") {
        const original = indexStatus === "A" ? "" : await this.gitObjectText(rootPath, `:${resolved.relativePath}`);
        const current = worktreeStatus === "D" ? "" : await this.workingTreeText(rootPath, resolved.relativePath);
        return textDiffResponse({ path: resolved.relativePath, original, current, patch });
      }

      const original = indexStatus === "A" || indexStatus === "?" ? "" : await this.gitObjectText(rootPath, `HEAD:${resolved.relativePath}`);
      const current = indexStatus === "D"
        ? ""
        : indexStatus === "?"
          ? await this.workingTreeText(rootPath, resolved.relativePath)
          : await this.gitObjectText(rootPath, `:${resolved.relativePath}`);
      return textDiffResponse({ path: resolved.relativePath, original, current, patch });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Diff is unavailable";
      return {
        path: resolved.relativePath,
        kind: message.includes("large") ? "too-large" : message.includes("Binary") ? "binary" : "unavailable",
        original: "",
        current: "",
        patch,
        message,
      };
    }
  }
```

- [ ] **Step 5: Add the HTTP endpoint**

In `src/server/http/createApp.ts`, import no new symbols. Add this route after `/git/diff`:

```ts
  app.get(
    "/api/workspaces/:workspaceId/git/file-diff",
    asyncHandler(async (req, res) => {
      const workspace = getWorkspace(req.params.workspaceId);
      const path = typeof req.query.path === "string" ? req.query.path.trim() : "";
      if (!path) {
        res.status(400).json({ error: "missing path" });
        return;
      }
      const diff = await agent.gitFileDiff(workspace.rootPath, path);
      recordAudit("git.file_diff", { workspaceId: workspace.id, path });
      res.json(diff);
    }),
  );
```

- [ ] **Step 6: Run focused server tests**

Run: `npm test -- tests/server/git.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/server/agent/AgentGateway.ts src/server/agent/LocalAgent.ts src/server/http/createApp.ts tests/server/git.test.ts
git commit -m "feat: serve structured git file diffs"
```

## Task 3: Client Diff Helpers

**Files:**
- Create: `src/client/gitDiffView.ts`
- Create: `tests/client/gitDiffView.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `tests/client/gitDiffView.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { copyPayloadForGitLine, defaultGitDiffMode } from "../../src/client/gitDiffView.js";

describe("git diff view helpers", () => {
  test("defaults wide containers to side-by-side and narrow containers to line-by-line", () => {
    expect(defaultGitDiffMode(900)).toBe("side-by-side");
    expect(defaultGitDiffMode(620)).toBe("line-by-line");
  });

  test("copies path and line when a new-file line is selected", () => {
    expect(copyPayloadForGitLine("src/app.ts", 42)).toBe("src/app.ts:42");
  });

  test("falls back to path when no new-file line is available", () => {
    expect(copyPayloadForGitLine("src/app.ts", null)).toBe("src/app.ts");
    expect(copyPayloadForGitLine("src/app.ts", 0)).toBe("src/app.ts");
  });
});
```

- [ ] **Step 2: Verify tests fail because helper file is missing**

Run: `npm test -- tests/client/gitDiffView.test.ts`

Expected: FAIL with module resolution error for `gitDiffView.js`.

- [ ] **Step 3: Add helpers**

Create `src/client/gitDiffView.ts`:

```ts
export type GitDiffMode = "side-by-side" | "line-by-line";

const narrowDiffWidthPx = 760;

export function defaultGitDiffMode(widthPx: number): GitDiffMode {
  return widthPx <= narrowDiffWidthPx ? "line-by-line" : "side-by-side";
}

export function copyPayloadForGitLine(path: string, newLineNumber: number | null): string {
  return newLineNumber && newLineNumber > 0 ? `${path}:${newLineNumber}` : path;
}
```

- [ ] **Step 4: Run helper tests**

Run: `npm test -- tests/client/gitDiffView.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/gitDiffView.ts tests/client/gitDiffView.test.ts
git commit -m "feat: add git diff view helpers"
```

## Task 4: React Read-Only Diff Viewer

**Files:**
- Modify: `src/client/api.ts`
- Create: `src/client/components/GitDiffViewer.tsx`
- Modify: `src/client/components/GitPanel.tsx`
- Modify: `src/client/styles.css`

- [ ] **Step 1: Add client API method**

In `src/client/api.ts`, import `GitFileDiffResponse` and add:

```ts
  async gitFileDiff(workspaceId: string, path: string): Promise<GitFileDiffResponse> {
    return request<GitFileDiffResponse>(`/api/workspaces/${encodeURIComponent(workspaceId)}/git/file-diff${query({ path })}`);
  },
```

- [ ] **Step 2: Create `GitDiffViewer`**

Create `src/client/components/GitDiffViewer.tsx`:

```tsx
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import type { GitFileDiffResponse } from "../../shared/types.js";
import { copyPayloadForGitLine, defaultGitDiffMode, type GitDiffMode } from "../gitDiffView.js";

interface GitDiffViewerProps {
  diff: GitFileDiffResponse | null;
  isLoading: boolean;
}

export function GitDiffViewer({ diff, isLoading }: GitDiffViewerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<GitDiffMode>("side-by-side");
  const [selectedNewLine, setSelectedNewLine] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const width = hostRef.current?.clientWidth ?? window.innerWidth;
    setMode(defaultGitDiffMode(width));
  }, [diff?.path]);

  useEffect(() => {
    setSelectedNewLine(null);
    setCopied(false);
  }, [diff?.path]);

  const handleMount: DiffOnMount = (_editor, monaco) => {
    const modified = _editor.getModifiedEditor();
    modified.onDidChangeCursorPosition((event) => {
      setSelectedNewLine(event.position.lineNumber);
      setCopied(false);
    });
    monaco.editor.setTheme("vs-dark");
  };

  async function copyLocation() {
    if (!diff) return;
    await navigator.clipboard.writeText(copyPayloadForGitLine(diff.path, selectedNewLine));
    setCopied(true);
  }

  if (isLoading) {
    return <p className="empty-state centered">Loading diff...</p>;
  }

  if (!diff) {
    return <p className="empty-state centered">Select a changed file to view its diff.</p>;
  }

  if (diff.kind !== "text") {
    return (
      <pre className="diff-output">
        {diff.message ? `${diff.message}\n\n` : ""}
        {diff.patch || "Diff is unavailable for this file."}
      </pre>
    );
  }

  return (
    <div className="git-diff-viewer" ref={hostRef}>
      <div className="diff-controls" aria-label="Diff view controls">
        <div className="segmented-control" role="group" aria-label="Diff view mode">
          <button aria-pressed={mode === "side-by-side"} onClick={() => setMode("side-by-side")} type="button">
            Side by side
          </button>
          <button aria-pressed={mode === "line-by-line"} onClick={() => setMode("line-by-line")} type="button">
            Line by line
          </button>
        </div>
        <button className="secondary-button" onClick={() => void copyLocation()} type="button">
          {copied ? "Copied" : "Copy location"}
        </button>
      </div>
      <div className="diff-editor-host">
        <DiffEditor
          language={languageForPath(diff.path)}
          modified={diff.current}
          onMount={handleMount}
          options={{
            automaticLayout: true,
            enableSplitViewResizing: true,
            fontSize: 13,
            minimap: { enabled: false },
            originalEditable: false,
            readOnly: true,
            renderSideBySide: mode === "side-by-side",
            scrollBeyondLastLine: false,
          }}
          original={diff.original}
          theme="vs-dark"
        />
      </div>
    </div>
  );
}

function languageForPath(path: string): string {
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js") || path.endsWith(".jsx")) return "javascript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".html")) return "html";
  return "plaintext";
}
```

- [ ] **Step 3: Wire `GitPanel` to structured diffs**

In `src/client/components/GitPanel.tsx`:

```ts
import type { GitChange, GitFileDiffResponse, Workspace } from "../../shared/types.js";
import { GitDiffViewer } from "./GitDiffViewer.js";
```

Replace `const [diff, setDiff] = useState("");` with:

```ts
  const [diff, setDiff] = useState<GitFileDiffResponse | null>(null);
```

Replace every `setDiff("");` with `setDiff(null);`.

Replace:

```ts
      const nextDiff = await api.gitDiff(workspaceId, path);
```

with:

```ts
      const nextDiff = await api.gitFileDiff(workspaceId, path);
```

Replace the `<pre className="diff-output">...</pre>` with:

```tsx
        <GitDiffViewer diff={diff} isLoading={isLoadingDiff} />
```

- [ ] **Step 4: Add styles**

In `src/client/styles.css`, replace `.diff-output` placement selectors with:

```css
.editor-host,
.git-diff-viewer,
.diff-output,
.preview-frame-wrap {
  grid-row: 3;
}
```

Add:

```css
.git-diff-viewer {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.diff-controls {
  align-items: center;
  border-bottom: 1px solid #263442;
  display: flex;
  gap: 8px;
  justify-content: space-between;
  min-height: 42px;
  padding: 6px 8px;
}

.segmented-control {
  display: inline-flex;
  min-width: 0;
}

.segmented-control button,
.secondary-button {
  background: #ffffff;
  border: 1px solid #c8d1dc;
  color: #263442;
  min-height: 32px;
  padding: 6px 9px;
  white-space: nowrap;
}

.segmented-control button:first-child {
  border-radius: 6px 0 0 6px;
}

.segmented-control button:last-child {
  border-left: 0;
  border-radius: 0 6px 6px 0;
}

.segmented-control button[aria-pressed="true"] {
  background: #edf6f8;
  border-color: #5a9aaa;
  color: #101820;
}

.secondary-button {
  border-radius: 6px;
}

.diff-editor-host {
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
```

Inside the mobile media query, add `.git-diff-viewer` to the existing height rule:

```css
  .editor-host,
  .git-diff-viewer,
  .diff-output {
    height: 100%;
    min-height: 0;
  }
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/client/api.ts src/client/components/GitDiffViewer.tsx src/client/components/GitPanel.tsx src/client/styles.css
git commit -m "feat: render readable git diffs"
```

## Task 5: E2E Smoke Update

**Files:**
- Modify: `tests/e2e/mvp.spec.ts`

- [ ] **Step 1: Update Git panel expectations**

Replace these assertions:

```ts
    await expect(page.getByLabel("Git diff").getByText("-original line")).toBeVisible();
    await expect(page.getByLabel("Git diff").getByText("+changed line")).toBeVisible();
```

with:

```ts
    await expect(page.getByRole("group", { name: "Diff view mode" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy location" })).toBeVisible();
    await expect(page.getByLabel("Git diff").getByText("original line")).toBeVisible();
    await expect(page.getByLabel("Git diff").getByText("changed line")).toBeVisible();
    await page.getByRole("button", { name: "Line by line" }).click();
    await expect(page.getByRole("button", { name: "Line by line" })).toHaveAttribute("aria-pressed", "true");
```

- [ ] **Step 2: Run focused E2E test**

Run: `npm run test:e2e -- tests/e2e/mvp.spec.ts -g "owner uses mobile focused item shell"`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/mvp.spec.ts
git commit -m "test: update git diff viewer smoke coverage"
```

## Task 6: Final Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run focused test set**

Run:

```bash
npm test -- tests/server/git.test.ts tests/client/gitDiffView.test.ts
npm run typecheck
npm run build
```

Expected: all commands PASS.

- [ ] **Step 2: Run E2E smoke**

Run:

```bash
npm run test:e2e -- tests/e2e/mvp.spec.ts -g "owner uses mobile focused item shell"
```

Expected: PASS.

- [ ] **Step 3: Inspect git status**

Run: `git status --short`

Expected: no uncommitted tracked changes.
