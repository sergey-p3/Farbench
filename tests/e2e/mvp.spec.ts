import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import type { Session } from "../../src/shared/types.js";

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

async function openTopMenu(page: Page): Promise<void> {
  const hideTopMenu = page.getByRole("button", { name: "Hide top menu" });
  if (await hideTopMenu.isVisible()) return;

  const showTopMenu = page.getByRole("button", { name: "Show top menu" });
  await showTopMenu.click();
  await expect(hideTopMenu).toBeVisible();
}

async function closeTopMenu(page: Page): Promise<void> {
  const hideTopMenu = page.getByRole("button", { name: "Hide top menu" });
  if (await hideTopMenu.isVisible()) {
    await hideTopMenu.click();
    await expect(page.getByRole("button", { name: "Show top menu" })).toBeVisible();
  }
}

test("owner uses mobile focused item shell and restores last active item", async ({ page }, testInfo) => {
  const preview = await startPreviewServer();
  testInfo.annotations.push({
    type: "tmux",
    description: "tmux-backed session startup is not exercised here because the app has no E2E cleanup path for durable tmux sessions.",
  });

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.context().clearCookies();
    await page.goto("/");

    await page.getByLabel("Access token").fill("dev-password");
    await page.getByRole("button", { name: "Connect" }).click();

    await openTopMenu(page);
    await expect(page.getByRole("heading", { level: 1, name: "No item open" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Workspaces" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Sessions" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create item" })).toBeVisible();

    await page.getByRole("button", { name: "Create item" }).click();
    await expect(page.getByRole("button", { name: "Files" })).toBeVisible();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await openTopMenu(page);
    await expect(page.getByRole("heading", { level: 1, name: "Files" })).toBeVisible();
    await closeTopMenu(page);
    await page.getByRole("button", { name: /src/ }).click();
    await page.getByRole("button", { name: /nested\.txt/ }).click();
    await expect(page.getByLabel("File editor").getByText("src/nested.txt")).toBeVisible();
    await expect(page.getByText("nested content line 001")).toBeVisible();
    await expect(page.locator(".editor-host .monaco-scrollable-element").first()).toBeVisible();

    const editorTouch = await page.evaluate(async () => {
      const host = document.querySelector(".editor-host");
      const scrollable = document.querySelector(".editor-host .monaco-scrollable-element");
      if (!(host instanceof HTMLElement) || !(scrollable instanceof HTMLElement)) {
        throw new Error("Editor scroll elements not found");
      }
      const hostBox = host.getBoundingClientRect();
      const target = document.elementFromPoint(hostBox.left + hostBox.width / 2, hostBox.top + hostBox.height / 2);
      if (!(target instanceof Element)) {
        throw new Error("Editor touch target not found");
      }
      const renderedLines = () => Array.from(
        document.querySelectorAll(".editor-host .view-line"),
        (line) => (line.textContent ?? "").replace(/\u00a0/g, " "),
      );
      const before = scrollable.scrollTop;
      const renderedBefore = renderedLines();
      const pageScrollBefore = window.scrollY;
      const touchInit = (clientY: number) => ({
        bubbles: true,
        cancelable: true,
        touches: [new Touch({ identifier: 11, target, clientY })],
      });
      const start = new TouchEvent("touchstart", touchInit(650));
      target.dispatchEvent(start);
      const move = new TouchEvent("touchmove", touchInit(350));
      target.dispatchEvent(move);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        hostTouchAction: getComputedStyle(host).touchAction,
        moveDefaultPrevented: move.defaultPrevented,
        pageScrollAfter: window.scrollY,
        pageScrollBefore,
        renderedAfter: renderedLines(),
        renderedBefore,
      };
    });

    expect(editorTouch.hostTouchAction).toBe("none");
    expect(editorTouch.moveDefaultPrevented).toBe(true);
    expect(editorTouch.pageScrollAfter).toBe(editorTouch.pageScrollBefore);
    expect(editorTouch.renderedBefore).toContain("nested content line 001");
    expect(editorTouch.renderedAfter).not.toContain("nested content line 001");

    await openTopMenu(page);
    await page.getByRole("button", { name: "Create item" }).click();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(page.getByRole("heading", { level: 3, name: "Files is already open" })).toBeVisible();
    await page.getByRole("button", { name: "Focus existing" }).click();
    await openTopMenu(page);
    await expect(page.getByRole("heading", { level: 1, name: "Files" })).toBeVisible();

    await page.getByRole("button", { name: "Create item" }).click();
    await page.getByRole("button", { name: "Git diff" }).click();
    await openTopMenu(page);
    await expect(page.getByRole("heading", { level: 1, name: "Git diff" })).toBeVisible();
    await closeTopMenu(page);
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    await page.getByTitle("app.txt", { exact: true }).click();
    await expect(page.getByRole("group", { name: "Diff view mode" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy location" })).toBeVisible();
    await expect(page.getByLabel("Git diff").getByText("original line")).toBeVisible();
    await expect(page.getByLabel("Git diff").getByText("changed line")).toBeVisible();
    await page.getByRole("button", { name: "Line by line" }).click();
    await expect(page.getByRole("button", { name: "Line by line" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Side by side" }).click();
    await expect(page.getByRole("button", { name: "Side by side" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".diff-editor-host .monaco-diff-editor.side-by-side")).toBeVisible();
    await page.getByRole("button", { name: "Copy location" }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();

    await openTopMenu(page);
    await page.getByRole("button", { name: "Create item" }).click();
    await page.getByLabel("Port").fill(String(preview.port));
    await page.getByRole("button", { name: "Preview" }).click();
    await openTopMenu(page);
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`Preview :${preview.port}`) })).toBeVisible();
    await closeTopMenu(page);
    await page.getByRole("button", { name: "Expose" }).click();
    await expect(page.getByRole("link", { name: "Open in new tab" })).toBeVisible();
    await expect(page.frameLocator(`iframe[title="Preview port ${preview.port}"]`).getByText("preview fixture ok")).toBeVisible();

    await openTopMenu(page);
    await page.getByRole("button", { name: "Open item switcher" }).click();
    await expect(page.getByLabel("Item switcher").getByRole("button", { name: /^Files\b/ })).toBeVisible();
    await expect(page.getByLabel("Item switcher").getByRole("button", { name: /^Git\b/ })).toBeVisible();
    await page.getByLabel("Item switcher").getByRole("button", { name: /^Files\b/ }).click();
    await openTopMenu(page);
    await expect(page.getByRole("heading", { level: 1, name: "Files" })).toBeVisible();

    await page.reload();
    await openTopMenu(page);
    await expect(page.getByRole("heading", { level: 1, name: "Files" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Workspaces" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Sessions" })).toHaveCount(0);
  } finally {
    await closeServer(preview.server);
  }
});

test("right-side shortcut rail switches between persisted open items", async ({ page }) => {
  await page.route("**/api/login", async (route) => {
    await route.fulfill({ contentType: "application/json", json: { ok: true } });
  });
  await page.route("**/api/workspaces", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        workspaces: [{
          id: "w1",
          name: "e2e-workspace",
          rootPath: "/workspace",
          status: "available",
        }],
      },
    });
  });
  await page.route("**/api/workspaces/w1/sessions", async (route) => {
    await route.fulfill({ contentType: "application/json", json: { sessions: [] } });
  });
  await page.route("**/api/workspaces/w1/files**", async (route) => {
    await route.fulfill({ contentType: "application/json", json: { files: [] } });
  });

  await page.addInitScript(() => {
    window.localStorage.setItem("remote-dev-layout", JSON.stringify({
      selectedWorkspaceId: "w1",
      activePaneId: "main",
      panes: [{
        id: "main",
        activeItemId: "preview:w1:3000:%2F",
        itemIds: ["files:w1", "git:w1", "preview:w1:3000:%2F"],
      }],
      items: [
        { id: "files:w1", workspaceId: "w1", kind: "files", title: "Files", status: "ready" },
        { id: "git:w1", workspaceId: "w1", kind: "git", title: "Git diff", status: "ready" },
        {
          id: "preview:w1:3000:%2F",
          workspaceId: "w1",
          kind: "preview",
          title: "Preview :3000",
          status: "ready",
          config: { port: 3000, path: "/" },
        },
      ],
    }));
  });

  await page.setViewportSize({ width: 390, height: 520 });
  await page.goto("/");

  const shortcutRail = page.getByLabel("Open item shortcuts");
  await expect(shortcutRail).toBeVisible();
  await expect(shortcutRail).toHaveCSS("overflow-y", "auto");
  const expandedRailBox = await shortcutRail.boundingBox();
  expect(expandedRailBox).not.toBeNull();
  await expect(shortcutRail.getByRole("button", { name: "Switch to Files" })).toBeVisible();
  await expect(shortcutRail.getByRole("button", { name: "Switch to Git diff" })).toBeVisible();
  await expect(shortcutRail.getByRole("button", { name: "Switch to Preview :3000" })).toHaveAttribute("aria-current", "page");

  await shortcutRail.getByRole("button", { name: "Switch to Files" }).click();
  await openTopMenu(page);
  await expect(page.getByRole("heading", { level: 1, name: "Files" })).toBeVisible();
  await expect(shortcutRail.getByRole("button", { name: "Switch to Files" })).toHaveAttribute("aria-current", "page");

  await shortcutRail.getByRole("button", { name: "Hide shortcut tabs" }).click();
  await expect(shortcutRail.getByRole("button", { name: "Switch to Files" })).toHaveCount(0);
  await expect(shortcutRail.getByRole("button", { name: "Show shortcut tabs" })).toBeVisible();
  const collapsedRailBox = await shortcutRail.boundingBox();
  expect(collapsedRailBox).not.toBeNull();
  expect(collapsedRailBox!.width).toBeLessThan(expandedRailBox!.width);

  await shortcutRail.getByRole("button", { name: "Show shortcut tabs" }).click();
  await expect(shortcutRail.getByRole("button", { name: "Switch to Files" })).toBeVisible();
});

test("top menu collapses into an overlay and can be pinned into layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().clearCookies();
  await page.goto("/");

  await page.getByLabel("Access token").fill("dev-password");
  await page.getByRole("button", { name: "Connect" }).click();

  const pane = page.getByLabel("Focused item");
  const paneBoxCollapsed = await pane.boundingBox();
  expect(paneBoxCollapsed).not.toBeNull();
  if (!paneBoxCollapsed) throw new Error("Unable to measure focused item");
  expect(Math.round(paneBoxCollapsed.y)).toBe(0);

  const collapsedMenuButton = page.getByRole("button", { name: "Show top menu" });
  await expect(collapsedMenuButton).toBeVisible();
  const collapsedMenuButtonBox = await collapsedMenuButton.boundingBox();
  expect(collapsedMenuButtonBox).not.toBeNull();
  if (!collapsedMenuButtonBox) throw new Error("Unable to measure collapsed menu button");
  expect(Math.round(collapsedMenuButtonBox.x + collapsedMenuButtonBox.width)).toBeGreaterThanOrEqual(374);
  await expect(page.getByRole("button", { name: "Pin top menu" })).toHaveCount(0);

  await collapsedMenuButton.click();
  const expandedMenuButton = page.getByRole("button", { name: "Hide top menu" });
  await expect(expandedMenuButton).toBeVisible();
  await expect(page.getByRole("button", { name: "Pin top menu" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create item" })).toBeVisible();
  const expandedMenuButtonBox = await expandedMenuButton.boundingBox();
  expect(expandedMenuButtonBox).not.toBeNull();
  expect(Math.round(expandedMenuButtonBox!.x)).toBe(Math.round(collapsedMenuButtonBox.x));
  expect(Math.round(expandedMenuButtonBox!.y)).toBe(Math.round(collapsedMenuButtonBox.y));

  const paneBoxOverlay = await pane.boundingBox();
  expect(paneBoxOverlay).not.toBeNull();
  if (!paneBoxOverlay) throw new Error("Unable to measure focused item after expanding menu");
  expect(Math.round(paneBoxOverlay.y)).toBe(Math.round(paneBoxCollapsed.y));

  await page.getByRole("button", { name: "Pin top menu" }).click();
  await expect(page.getByRole("button", { name: "Unpin top menu" })).toBeVisible();

  const paneBoxPinned = await pane.boundingBox();
  expect(paneBoxPinned).not.toBeNull();
  if (!paneBoxPinned) throw new Error("Unable to measure focused item after pinning menu");
  expect(Math.round(paneBoxPinned.y)).toBeGreaterThan(Math.round(paneBoxCollapsed.y));
});

test("mobile terminal exposes special keys and stays inside a reduced viewport", async ({ page }) => {
  let terminalSession: Session | null = null;

  await page.route("**/api/workspaces/*/sessions", async (route) => {
    const request = route.request();
    const workspaceId = decodeURIComponent(new URL(request.url()).pathname.split("/")[3] ?? "workspace");

    if (request.method() === "POST") {
      terminalSession = {
        id: "e2e-terminal-session",
        workspaceId,
        name: "bash session",
        type: "bash",
        tmuxName: "e2e-terminal-session",
        status: "running",
        createdAt: "2026-06-21T00:00:00.000Z",
        lastAttachedAt: null,
        lastActivityAt: null,
        endedAt: null,
      };
      await route.fulfill({ contentType: "application/json", json: { session: terminalSession } });
      return;
    }

    if (request.method() === "GET") {
      await route.fulfill({ contentType: "application/json", json: { sessions: terminalSession ? [terminalSession] : [] } });
      return;
    }

    await route.continue();
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().clearCookies();
  await page.goto("/");

  await page.getByLabel("Access token").fill("dev-password");
  await page.getByRole("button", { name: "Connect" }).click();
  await openTopMenu(page);
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
  const viewportLock = await page.evaluate(() => ({
    appViewportHeight: getComputedStyle(document.documentElement).getPropertyValue("--app-viewport-height").trim(),
    clientHeight: document.documentElement.clientHeight,
    scrollHeight: document.scrollingElement?.scrollHeight ?? 0,
    scrollYBefore: window.scrollY,
  }));
  await page.evaluate(() => window.scrollTo(0, 200));
  const scrollYAfterScrollAttempt = await page.evaluate(() => window.scrollY);

  expect(paneBox).not.toBeNull();
  expect(toolbarBox).not.toBeNull();
  if (!paneBox || !toolbarBox) throw new Error("Unable to measure terminal layout");
  expect(Math.round(toolbarBox.height)).toBeLessThanOrEqual(36);
  expect(viewportLock.appViewportHeight).toBe("520px");
  expect(viewportLock.scrollHeight).toBe(viewportLock.clientHeight);
  expect(scrollYAfterScrollAttempt).toBe(viewportLock.scrollYBefore);
  expect(Math.round(paneBox.y + paneBox.height)).toBeLessThanOrEqual(520);
  expect(Math.round(toolbarBox.y + toolbarBox.height)).toBeLessThanOrEqual(520);
});

test("mobile terminal special keys send toolbar input while preserving keyboard textarea focus", async ({ page }) => {
  let terminalSession: Session | null = null;
  const deletedSessionIds: string[] = [];
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.addInitScript(() => {
    const sentMessages: string[] = [];
    const vibrationCalls: number[] = [];

    class FakeTerminalSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSING = 2;
      readonly CLOSED = 3;
      readonly binaryType = "blob";
      readonly bufferedAmount = 0;
      readonly extensions = "";
      readonly protocol = "";
      readyState = FakeTerminalSocket.CONNECTING;
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onopen: ((event: Event) => void) | null = null;

      constructor(readonly url: string) {
        super();
        setTimeout(() => {
          this.readyState = FakeTerminalSocket.OPEN;
          const event = new Event("open");
          this.dispatchEvent(event);
          this.onopen?.(event);
        }, 0);
      }

      send(data: string) {
        sentMessages.push(data);
        const message = JSON.parse(data) as { type?: string };
        if (message.type === "attach") {
          setTimeout(() => {
            const scrollback = Array.from({ length: 200 }, (_value, index) => `line ${index}`).join("\r\n");
            const event = new MessageEvent("message", {
              data: JSON.stringify({ type: "scrollback", data: `${scrollback}\r\n` }),
            });
            this.dispatchEvent(event);
            this.onmessage?.(event);
          }, 0);
        }
      }

      close() {
        this.readyState = FakeTerminalSocket.CLOSED;
        const event = new CloseEvent("close");
        this.dispatchEvent(event);
        this.onclose?.(event);
      }
    }

    Reflect.set(window, "WebSocket", FakeTerminalSocket);
    Reflect.set(window, "__terminalSentMessages", sentMessages);
    Reflect.set(window, "__terminalVibrationCalls", vibrationCalls);
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (duration: number) => {
        vibrationCalls.push(duration);
        return true;
      },
    });
  });

  await page.route("**/api/workspaces/*/sessions**", async (route) => {
    const request = route.request();
    const pathnameParts = new URL(request.url()).pathname.split("/");
    const workspaceId = decodeURIComponent(pathnameParts[3] ?? "workspace");
    const sessionId = pathnameParts[5] ? decodeURIComponent(pathnameParts[5]) : null;

    if (request.method() === "POST") {
      terminalSession = {
        id: "e2e-terminal-session",
        workspaceId,
        name: "bash session",
        type: "bash",
        tmuxName: "e2e-terminal-session",
        status: "running",
        createdAt: "2026-06-21T00:00:00.000Z",
        lastAttachedAt: null,
        lastActivityAt: null,
        endedAt: null,
      };
      await route.fulfill({ contentType: "application/json", json: { session: terminalSession } });
      return;
    }

    if (request.method() === "DELETE" && sessionId) {
      deletedSessionIds.push(sessionId);
      terminalSession = null;
      await route.fulfill({ contentType: "application/json", json: { ok: true } });
      return;
    }

    if (request.method() === "GET") {
      await route.fulfill({ contentType: "application/json", json: { sessions: terminalSession ? [terminalSession] : [] } });
      return;
    }

    await route.continue();
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().clearCookies();
  await page.goto("/");

  await page.getByLabel("Access token").fill("dev-password");
  await page.getByRole("button", { name: "Connect" }).click();
  await openTopMenu(page);
  await page.getByRole("button", { name: "Create item" }).click();
  await page.getByRole("button", { name: "Terminal" }).click();

  const toolbar = page.getByRole("toolbar", { name: "Terminal special keys" });
  await expect(toolbar.getByRole("button", { name: "Sticky Control modifier" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scroll terminal up" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Scroll terminal down" })).toHaveCount(0);

  await page.getByLabel("Terminal input").focus();
  await toolbar.getByRole("button", { name: "Sticky Control modifier" }).click();
  await toolbar.getByRole("button", { name: "C", exact: true }).click();
  await toolbar.getByRole("button", { name: "Up arrow" }).click();
  await expect.poll(async () =>
    page.locator(".terminal-host .xterm-viewport").evaluate((viewport) => viewport.scrollTop),
  ).toBeGreaterThan(0);

  const terminalSurface = page.locator(".terminal-host");
  const contentTouch = await page.evaluate(() => {
    const host = document.querySelector(".terminal-host");
    const viewport = document.querySelector(".terminal-host .xterm-viewport");
    if (!(host instanceof HTMLElement) || !(viewport instanceof HTMLElement)) {
      throw new Error("Terminal scroll elements not found");
    }
    const hostBox = host.getBoundingClientRect();
    const target = document.elementFromPoint(hostBox.left + hostBox.width / 2, hostBox.top + hostBox.height / 2);
    if (!(target instanceof Element)) {
      throw new Error("Terminal touch target not found");
    }
    const before = viewport.scrollTop;
    const pageScrollBefore = window.scrollY;
    const touchInit = (clientY: number) => ({
      bubbles: true,
      cancelable: true,
      touches: [new Touch({ identifier: 1, target, clientY })],
    });
    const start = new TouchEvent("touchstart", touchInit(500));
    target.dispatchEvent(start);
    const move = new TouchEvent("touchmove", touchInit(650));
    target.dispatchEvent(move);
    return {
      activeElementLabel: document.activeElement?.getAttribute("aria-label"),
      after: viewport.scrollTop,
      before,
      hostTouchAction: getComputedStyle(host).touchAction,
      moveDefaultPrevented: move.defaultPrevented,
      pageScrollAfter: window.scrollY,
      pageScrollBefore,
      viewportOverflowY: getComputedStyle(viewport).overflowY,
      startDefaultPrevented: start.defaultPrevented,
    };
  });

  const sentMessages = await page.evaluate(() => {
    const messages = Reflect.get(window, "__terminalSentMessages") as string[];
    return messages.map((message) => JSON.parse(message) as { type: string; data?: string });
  });
  const activeElementLabel = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));

  expect(sentMessages.filter((message) => message.type === "input").map((message) => message.data)).toEqual(["\x03", "\x1b[A"]);
  expect(contentTouch).toEqual({
    activeElementLabel: "Terminal input",
    after: expect.any(Number),
    before: contentTouch.before,
    hostTouchAction: "none",
    moveDefaultPrevented: true,
    pageScrollAfter: contentTouch.pageScrollBefore,
    pageScrollBefore: contentTouch.pageScrollBefore,
    viewportOverflowY: "auto",
    startDefaultPrevented: false,
  });
  expect(contentTouch.after).toBeLessThan(contentTouch.before);
  expect(activeElementLabel).toBe("Terminal input");

  await page.evaluate(() => navigator.clipboard.writeText("pasted terminal text"));
  await page.getByLabel("Terminal input").focus();
  await page.keyboard.press("Control+V");
  await expect.poll(async () => {
    const messages = await page.evaluate(() => {
      const rawMessages = Reflect.get(window, "__terminalSentMessages") as string[];
      return rawMessages.map((message) => JSON.parse(message) as { type: string; data?: string });
    });
    return messages.filter((message) => message.type === "input").map((message) => message.data);
  }).toContain("pasted terminal text");

  await page.evaluate(() => {
    const clipboard = navigator.clipboard;
    Reflect.set(window, "__originalClipboardReadText", clipboard.readText.bind(clipboard));
    Object.defineProperty(clipboard, "readText", {
      configurable: true,
      value: () => Promise.reject(new Error("denied")),
    });
  });
  await page.getByLabel("Terminal input").focus();
  await page.keyboard.press("Control+V");
  await page.evaluate(() => {
    const input = document.querySelector('[aria-label="Terminal input"]');
    if (!(input instanceof HTMLElement)) throw new Error("Terminal input not found");
    const data = new DataTransfer();
    data.setData("text/plain", "native paste text");
    input.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: data }));
  });
  await expect(page.getByText("Unable to read clipboard.")).toHaveCount(0);
  await expect.poll(async () => {
    const messages = await page.evaluate(() => {
      const rawMessages = Reflect.get(window, "__terminalSentMessages") as string[];
      return rawMessages.map((message) => JSON.parse(message) as { type: string; data?: string });
    });
    return messages.filter((message) => message.type === "input").map((message) => message.data);
  }).toContain("native paste text");
  await terminalSurface.click({ button: "right", position: { x: 20, y: 60 } });
  await page.getByRole("menuitem", { name: "Paste" }).click();
  await expect(page.getByText("Unable to read clipboard.")).toHaveCount(0);
  const pasteTarget = page.getByLabel("Paste terminal input");
  await expect(pasteTarget).toBeFocused();
  await page.evaluate(() => {
    const input = document.querySelector('[aria-label="Paste terminal input"]');
    if (!(input instanceof HTMLElement)) throw new Error("Paste terminal input not found");
    const data = new DataTransfer();
    data.setData("text/plain", "ios paste target text");
    input.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: data }));
  });
  await expect.poll(async () => {
    const messages = await page.evaluate(() => {
      const rawMessages = Reflect.get(window, "__terminalSentMessages") as string[];
      return rawMessages.map((message) => JSON.parse(message) as { type: string; data?: string });
    });
    return messages.filter((message) => message.type === "input").map((message) => message.data);
  }).toContain("ios paste target text");
  await page.evaluate(() => {
    const originalReadText = Reflect.get(window, "__originalClipboardReadText");
    if (typeof originalReadText !== "function") throw new Error("Original clipboard readText not captured");
    Object.defineProperty(navigator.clipboard, "readText", {
      configurable: true,
      value: originalReadText,
    });
  });

  const closedKeyboardScroll = await page.evaluate(() => {
    const host = document.querySelector(".terminal-host");
    const viewport = document.querySelector(".terminal-host .xterm-viewport");
    if (!(host instanceof HTMLElement) || !(viewport instanceof HTMLElement)) {
      throw new Error("Terminal scroll elements not found");
    }
    const focusedInput = document.querySelector('[aria-label="Terminal input"]');
    if (!(focusedInput instanceof HTMLElement)) {
      throw new Error("Terminal input not found");
    }
    focusedInput.blur();
    viewport.scrollTop = viewport.scrollHeight;
    const hostBox = host.getBoundingClientRect();
    const target = document.elementFromPoint(hostBox.left + hostBox.width / 2, hostBox.top + hostBox.height / 2);
    if (!(target instanceof Element)) {
      throw new Error("Terminal touch target not found");
    }
    const before = viewport.scrollTop;
    host.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: hostBox.left + hostBox.width / 2,
      clientY: 500,
      pointerId: 23,
      pointerType: "touch",
    }));
    const touchInit = (clientY: number) => ({
      bubbles: true,
      cancelable: true,
      touches: [new Touch({ identifier: 3, target, clientY })],
    });
    target.dispatchEvent(new TouchEvent("touchstart", touchInit(500)));
    const move = new TouchEvent("touchmove", touchInit(650));
    target.dispatchEvent(move);
    target.dispatchEvent(new TouchEvent("touchend", {
      bubbles: true,
      cancelable: true,
      changedTouches: [new Touch({ identifier: 3, target, clientY: 650 })],
      touches: [],
    }));
    host.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: hostBox.left + hostBox.width / 2,
      clientY: 650,
      pointerId: 23,
      pointerType: "touch",
    }));
    return {
      activeElementLabel: document.activeElement?.getAttribute("aria-label"),
      after: viewport.scrollTop,
      before,
      moveDefaultPrevented: move.defaultPrevented,
    };
  });

  expect(closedKeyboardScroll.after).toBeLessThan(closedKeyboardScroll.before);
  expect(closedKeyboardScroll.moveDefaultPrevented).toBe(true);
  expect(closedKeyboardScroll.activeElementLabel).not.toBe("Terminal input");

  const mixedPointerTouchDrag = await page.evaluate(() => {
    const host = document.querySelector(".terminal-host");
    const viewport = document.querySelector(".terminal-host .xterm-viewport");
    if (!(host instanceof HTMLElement) || !(viewport instanceof HTMLElement)) {
      throw new Error("Terminal scroll elements not found");
    }
    viewport.scrollTop = viewport.scrollHeight;
    const hostBox = host.getBoundingClientRect();
    const target = document.elementFromPoint(hostBox.left + hostBox.width / 2, hostBox.top + hostBox.height / 2);
    if (!(target instanceof Element)) {
      throw new Error("Terminal touch target not found");
    }
    const before = viewport.scrollTop;
    host.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: hostBox.left + hostBox.width / 2,
      clientY: 500,
      pointerId: 24,
      pointerType: "touch",
    }));
    target.dispatchEvent(new TouchEvent("touchstart", {
      bubbles: true,
      cancelable: true,
      touches: [new Touch({ identifier: 4, target, clientY: 500 })],
    }));
    const move = new PointerEvent("pointermove", {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: hostBox.left + hostBox.width / 2,
      clientY: 650,
      pointerId: 24,
      pointerType: "touch",
    });
    host.dispatchEvent(move);
    host.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: hostBox.left + hostBox.width / 2,
      clientY: 650,
      pointerId: 24,
      pointerType: "touch",
    }));
    return {
      after: viewport.scrollTop,
      before,
      moveDefaultPrevented: move.defaultPrevented,
    };
  });

  expect(mixedPointerTouchDrag.after).toBeLessThan(mixedPointerTouchDrag.before);
  expect(mixedPointerTouchDrag.moveDefaultPrevented).toBe(true);

  const explicitTap = await page.evaluate(() => {
    const host = document.querySelector(".terminal-host");
    if (!(host instanceof HTMLElement)) {
      throw new Error("Terminal host not found");
    }
    const focusedInput = document.querySelector('[aria-label="Terminal input"]');
    if (!(focusedInput instanceof HTMLElement)) {
      throw new Error("Terminal input not found");
    }
    focusedInput.blur();
    const hostBox = host.getBoundingClientRect();
    host.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: hostBox.left + hostBox.width / 2,
      clientY: hostBox.top + hostBox.height / 2,
      pointerId: 17,
      pointerType: "touch",
    }));
    host.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: hostBox.left + hostBox.width / 2,
      clientY: hostBox.top + hostBox.height / 2,
      pointerId: 17,
      pointerType: "touch",
    }));
    return document.activeElement?.getAttribute("aria-label");
  });

  expect(explicitTap).toBe("Terminal input");

  const tapDrift = await page.evaluate(() => {
    const host = document.querySelector(".terminal-host");
    const viewport = document.querySelector(".terminal-host .xterm-viewport");
    if (!(host instanceof HTMLElement) || !(viewport instanceof HTMLElement)) {
      throw new Error("Terminal scroll elements not found");
    }
    const hostBox = host.getBoundingClientRect();
    const target = document.elementFromPoint(hostBox.left + hostBox.width / 2, hostBox.top + hostBox.height / 2);
    if (!(target instanceof Element)) {
      throw new Error("Terminal touch target not found");
    }
    const before = viewport.scrollTop;
    const touchInit = (clientY: number) => ({
      bubbles: true,
      cancelable: true,
      touches: [new Touch({ identifier: 2, target, clientY })],
    });
    target.dispatchEvent(new TouchEvent("touchstart", touchInit(500)));
    const move = new TouchEvent("touchmove", touchInit(504));
    target.dispatchEvent(move);
    target.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, changedTouches: [] }));
    return {
      after: viewport.scrollTop,
      before,
      moveDefaultPrevented: move.defaultPrevented,
    };
  });

  expect(tapDrift).toEqual({
    after: tapDrift.before,
    before: tapDrift.before,
    moveDefaultPrevented: false,
  });

  const pointerDrag = await page.evaluate(() => {
    const host = document.querySelector(".terminal-host");
    const viewport = document.querySelector(".terminal-host .xterm-viewport");
    if (!(host instanceof HTMLElement) || !(viewport instanceof HTMLElement)) {
      throw new Error("Terminal scroll elements not found");
    }
    viewport.scrollTop = viewport.scrollHeight;
    const hostBox = host.getBoundingClientRect();
    const before = viewport.scrollTop;
    host.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: hostBox.left + hostBox.width / 2,
      clientY: 500,
      pointerId: 9,
      pointerType: "touch",
    }));
    const move = new PointerEvent("pointermove", {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: hostBox.left + hostBox.width / 2,
      clientY: 650,
      pointerId: 9,
      pointerType: "touch",
    });
    host.dispatchEvent(move);
    host.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: hostBox.left + hostBox.width / 2,
      clientY: 650,
      pointerId: 9,
      pointerType: "touch",
    }));
    return {
      after: viewport.scrollTop,
      before,
      moveDefaultPrevented: move.defaultPrevented,
    };
  });

  expect(pointerDrag.after).toBeLessThan(pointerDrag.before);
  expect(pointerDrag.moveDefaultPrevented).toBe(true);

  await terminalSurface.click({ button: "right", position: { x: 20, y: 60 } });
  const menu = page.getByRole("menu", { name: "Terminal actions" });
  await expect(menu.getByRole("menuitem", { name: "Select", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Copy" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Paste" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Select all" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Select", exact: true }).click();
  await expect.poll(() => page.locator(".terminal-host .xterm-selection div").count()).toBeGreaterThan(0);
  const startHandle = page.getByRole("slider", { name: "Expand terminal selection start" });
  const endHandle = page.getByRole("slider", { name: "Expand terminal selection end" });
  await expect(startHandle).toBeVisible();
  await expect(endHandle).toBeVisible();
  const endHandleBox = await endHandle.boundingBox();
  expect(endHandleBox).not.toBeNull();
  if (!endHandleBox) throw new Error("Terminal selection end handle not found");
  await page.mouse.move(endHandleBox.x + endHandleBox.width / 2, endHandleBox.y + endHandleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(endHandleBox.x + endHandleBox.width / 2 + 120, endHandleBox.y + endHandleBox.height / 2);
  await page.mouse.up();
  const expandedEndHandleBox = await endHandle.boundingBox();
  expect(expandedEndHandleBox).not.toBeNull();
  if (!expandedEndHandleBox) throw new Error("Expanded terminal selection end handle not found");
  expect(expandedEndHandleBox.height).toBeGreaterThan(0);
  await terminalSurface.click({ button: "right", position: { x: 20, y: 60 } });
  await menu.getByRole("menuitem", { name: "Copy" }).click();
  await expect.poll(async () => {
    const text = await page.evaluate(() => navigator.clipboard.readText());
    return text.includes("line") && text.length > "line".length;
  }).toBe(true);
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).not.toBe("Terminal input");

  const handleTopBeforeScroll = await endHandle.evaluate((handle) => handle.getBoundingClientRect().top);
  await page.locator(".terminal-host .xterm-viewport").evaluate((viewport) => {
    viewport.scrollTop += 45;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect.poll(() => endHandle.evaluate((handle) => handle.getBoundingClientRect().top)).not.toBe(handleTopBeforeScroll);

  const longPressTarget = await terminalSurface.boundingBox();
  expect(longPressTarget).not.toBeNull();
  if (!longPressTarget) throw new Error("Terminal surface not found for long press");
  const arrowInputStartIndex = await page.evaluate(() => {
    const messages = Reflect.get(window, "__terminalSentMessages") as string[];
    return messages
      .map((message) => JSON.parse(message) as { type: string })
      .filter((message) => message.type === "input")
      .length;
  });
  await terminalSurface.dispatchEvent("pointerdown", {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: longPressTarget.x + 24,
    clientY: longPressTarget.y + 68,
    pointerId: 71,
    pointerType: "touch",
  });
  await page.waitForTimeout(650);
  await expect(page.getByRole("menu", { name: "Terminal actions" })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Arrow key gesture control" })).toHaveCount(0);
  await page.waitForTimeout(500);
  const arrowGesture = page.getByRole("status", { name: "Arrow key gesture control" });
  await expect(arrowGesture).toBeVisible();
  await expect(arrowGesture).toHaveAttribute("data-direction", "inactive");
  await expect(startHandle).toHaveCount(0);
  await expect(endHandle).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).not.toBe("Terminal input");
  await terminalSurface.dispatchEvent("pointerup", {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: longPressTarget.x + 24,
    clientY: longPressTarget.y + 68,
    pointerId: 71,
    pointerType: "touch",
  });
  await expect(arrowGesture).toHaveCount(0);
  await expect(startHandle).toBeVisible();
  await expect(endHandle).toBeVisible();
  await expect(page.getByRole("menu", { name: "Terminal actions" })).toHaveCount(0);
  const selectionVibrations = await page.evaluate(
    () => Reflect.get(window, "__terminalVibrationCalls") as number[],
  );
  expect(selectionVibrations).toEqual([30]);
  const arrowVibrationStartIndex = selectionVibrations.length;

  await terminalSurface.dispatchEvent("pointerdown", {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: longPressTarget.x + 24,
    clientY: longPressTarget.y + 68,
    pointerId: 72,
    pointerType: "touch",
  });
  await page.waitForTimeout(1_100);
  await expect(arrowGesture).toBeVisible();
  await expect(arrowGesture).toHaveAttribute("data-direction", "inactive");
  await expect(startHandle).toHaveCount(0);
  await expect(endHandle).toHaveCount(0);
  await terminalSurface.dispatchEvent("pointerout", {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: longPressTarget.x + 24,
    clientY: longPressTarget.y + 68,
    pointerId: 72,
    pointerType: "touch",
    relatedTarget: null,
  });
  await expect(arrowGesture).toHaveAttribute("data-direction", "inactive");
  await terminalSurface.dispatchEvent("pointercancel", {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: longPressTarget.x + 24,
    clientY: longPressTarget.y + 68,
    pointerId: 72,
    pointerType: "touch",
  });
  await expect(arrowGesture).toHaveAttribute("data-direction", "inactive");
  const touchFallbackMove = await page.evaluate(({ clientX, clientY }) => {
    const host = document.querySelector(".terminal-host");
    const viewport = document.querySelector(".terminal-host .xterm-viewport");
    if (!(host instanceof HTMLElement) || !(viewport instanceof HTMLElement)) {
      throw new Error("Terminal scroll elements not found");
    }
    const before = viewport.scrollTop;
    const maximumScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    viewport.scrollTop = before > 0 ? 0 : Math.min(40, maximumScrollTop);
    viewport.dispatchEvent(new Event("scroll"));
    const afterForcedScroll = viewport.scrollTop;
    const touch = new Touch({ identifier: 72, target: host, clientX, clientY });
    const move = new TouchEvent("touchmove", {
      bubbles: true,
      cancelable: true,
      touches: [touch],
    });
    host.dispatchEvent(move);
    return { after: viewport.scrollTop, afterForcedScroll, before, defaultPrevented: move.defaultPrevented };
  }, {
    clientX: longPressTarget.x + 24,
    clientY: longPressTarget.y + 8,
  });
  expect(touchFallbackMove).toEqual({
    after: touchFallbackMove.before,
    afterForcedScroll: touchFallbackMove.before,
    before: touchFallbackMove.before,
    defaultPrevented: true,
  });
  await expect(arrowGesture).toHaveAttribute("data-direction", "up");
  await page.evaluate(() => {
    const host = document.querySelector(".terminal-host");
    if (!(host instanceof HTMLElement)) throw new Error("Terminal host not found");
    host.dispatchEvent(new TouchEvent("touchend", {
      bubbles: true,
      cancelable: true,
      changedTouches: [],
      touches: [],
    }));
  });
  await expect(arrowGesture).toHaveCount(0);
  await expect(page.getByRole("menu", { name: "Terminal actions" })).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).not.toBe("Terminal input");
  const arrowFeedback = await page.evaluate(({ inputStartIndex, vibrationStartIndex }) => {
    const messages = (Reflect.get(window, "__terminalSentMessages") as string[])
      .map((message) => JSON.parse(message) as { type: string; data?: string })
      .filter((message) => message.type === "input")
      .slice(inputStartIndex)
      .map((message) => message.data);
    const vibrations = (Reflect.get(window, "__terminalVibrationCalls") as number[]).slice(vibrationStartIndex);
    return { messages, vibrations };
  }, { inputStartIndex: arrowInputStartIndex, vibrationStartIndex: arrowVibrationStartIndex });
  expect(arrowFeedback.messages.length).toBeGreaterThan(0);
  expect(arrowFeedback.messages.every((data) => data === "\x1b[A")).toBe(true);
  expect(arrowFeedback.vibrations).toHaveLength(arrowFeedback.messages.length);
  expect(arrowFeedback.vibrations.every((duration) => duration === 12)).toBe(true);

  await terminalSurface.click({ button: "right", position: { x: 20, y: 60 } });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await toolbar.getByRole("button", { name: "Sticky Control modifier" }).click();
  await page.getByLabel("Terminal input").focus();
  await page.keyboard.press("c");

  const sentMessagesAfterTypedCtrl = await page.evaluate(() => {
    const messages = Reflect.get(window, "__terminalSentMessages") as string[];
    return messages.map((message) => JSON.parse(message) as { type: string; data?: string });
  });
  const sentInputAfterTypedCtrl = sentMessagesAfterTypedCtrl
    .filter((message) => message.type === "input")
    .map((message) => message.data);
  expect(sentInputAfterTypedCtrl).toEqual([
    "\x03",
    "\x1b[A",
    "pasted terminal text",
    "pasted terminal text",
    "native paste text",
    "ios paste target text",
    ...arrowFeedback.messages,
    "\x03",
  ]);

  await page.getByLabel("Terminal input").focus();
  await page.evaluate(() => {
    const ctrl = document.querySelector('button[aria-label="Sticky Control modifier"]');
    const c = document.querySelector('button[aria-label="C"]');
    const sendTouch = (target: Element) => {
      const touchInit = {
        bubbles: true,
        cancelable: true,
        changedTouches: [new Touch({ identifier: 2, target, clientY: 760 })],
        touches: [new Touch({ identifier: 2, target, clientY: 760 })],
      };
      target.dispatchEvent(new TouchEvent("touchstart", touchInit));
      target.dispatchEvent(new TouchEvent("touchend", { ...touchInit, touches: [] }));
    };
    if (!ctrl || !c) throw new Error("Toolbar touch targets not found");
    sendTouch(ctrl);
    sendTouch(c);
  });

  const sentMessagesAfterTouchCtrl = await page.evaluate(() => {
    const messages = Reflect.get(window, "__terminalSentMessages") as string[];
    return messages.map((message) => JSON.parse(message) as { type: string; data?: string });
  });
  const activeElementLabelAfterTouch = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  const sentInputAfterTouchCtrl = sentMessagesAfterTouchCtrl
    .filter((message) => message.type === "input")
    .map((message) => message.data);
  expect(sentInputAfterTouchCtrl).toEqual([
    "\x03",
    "\x1b[A",
    "pasted terminal text",
    "pasted terminal text",
    "native paste text",
    "ios paste target text",
    ...arrowFeedback.messages,
    "\x03",
    "\x03",
  ]);
  expect(activeElementLabelAfterTouch).toBe("Terminal input");

  await openTopMenu(page);
  await page.getByRole("button", { name: "Open item switcher" }).click();
  await page.getByLabel("Item switcher").getByRole("button", { name: "Close bash session" }).click();
  await expect(page.getByLabel("Item switcher").getByText("No open items in this workspace.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "No item open" })).toBeVisible();
  expect(deletedSessionIds).toEqual(["e2e-terminal-session"]);
});

test("terminal pane shows connection status before history arrives", async ({ page }) => {
  await setupConnectionStatusFixture(page, {
    id: "terminal-status-session",
    workspaceId: "w1",
    name: "bash session",
    type: "bash",
    tmuxName: "terminal-status-session",
    status: "running",
    createdAt: "2026-07-07T00:00:00.000Z",
    lastAttachedAt: null,
    lastActivityAt: null,
    endedAt: null,
  });

  await page.goto("/");

  await expect(page.getByText("Connecting to terminal...")).toBeVisible();
  await page.evaluate(() => {
    const openSocket = Reflect.get(window, "__openTerminalSocket") as () => void;
    openSocket();
  });
  await expect(page.getByText("Loading terminal history...")).toBeVisible();
  await page.evaluate(() => {
    const sendScrollback = Reflect.get(window, "__sendTerminalScrollback") as (data: string) => void;
    sendScrollback("terminal ready\r\n");
  });
  await expect(page.getByText("Loading terminal history...")).toHaveCount(0);
});

test("terminal pane retries when websocket handshake never opens", async ({ page }) => {
  await setupConnectionStatusFixture(page, {
    id: "terminal-retry-session",
    workspaceId: "w1",
    name: "retry bash session",
    type: "bash",
    tmuxName: "terminal-retry-session",
    status: "running",
    createdAt: "2026-07-07T00:00:00.000Z",
    lastAttachedAt: null,
    lastActivityAt: null,
    endedAt: null,
  });

  await page.goto("/");

  await expect(page.getByText("Connecting to terminal...")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const sockets = Reflect.get(window, "__controlledTerminalSockets") as unknown[] | undefined;
    return sockets?.length ?? 0;
  }), { timeout: 6_000 }).toBeGreaterThan(1);
  await expect(page.getByText("Connecting to terminal...")).toBeVisible();

  await page.evaluate(() => {
    const openSocket = Reflect.get(window, "__openTerminalSocket") as () => void;
    openSocket();
  });
  await expect(page.getByText("Loading terminal history...")).toBeVisible();
  await page.evaluate(() => {
    const sendScrollback = Reflect.get(window, "__sendTerminalScrollback") as (data: string) => void;
    sendScrollback("retried terminal ready\r\n");
  });
  await expect(page.getByText("Loading terminal history...")).toHaveCount(0);
});

test("agent pane shows agent connection status before history arrives", async ({ page }) => {
  await setupConnectionStatusFixture(page, {
    id: "agent-status-session",
    workspaceId: "w1",
    name: "codex session",
    type: "codex",
    tmuxName: "agent-status-session",
    status: "running",
    createdAt: "2026-07-07T00:00:00.000Z",
    lastAttachedAt: null,
    lastActivityAt: null,
    endedAt: null,
  });

  await page.goto("/");

  await expect(page.getByText("Connecting to agent...")).toBeVisible();
  await page.evaluate(() => {
    const openSocket = Reflect.get(window, "__openTerminalSocket") as () => void;
    openSocket();
  });
  await expect(page.getByText("Loading agent history...")).toBeVisible();
});

async function setupConnectionStatusFixture(page: Page, session: Session): Promise<void> {
  await page.route("**/api/workspaces", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        workspaces: [{
          id: "w1",
          name: "connection-status-workspace",
          rootPath: "/workspace",
          status: "available",
        }],
      },
    });
  });
  await page.route("**/api/workspaces/w1/sessions", async (route) => {
    await route.fulfill({ contentType: "application/json", json: { sessions: [session] } });
  });
  await page.addInitScript((initialSession) => {
    const itemKind = initialSession.type === "bash" ? "terminal" : "agent";
    const itemId = `session:${initialSession.id}`;
    window.localStorage.setItem("remote-dev-layout", JSON.stringify({
      selectedWorkspaceId: "w1",
      activePaneId: "main",
      panes: [{
        id: "main",
        activeItemId: itemId,
        itemIds: [itemId],
      }],
      items: [{
        id: itemId,
        workspaceId: "w1",
        kind: itemKind,
        title: initialSession.name,
        status: initialSession.status,
        sessionId: initialSession.id,
        config: { runtime: initialSession.type },
        createdAt: initialSession.createdAt,
        lastActiveAt: initialSession.createdAt,
      }],
    }));

    class ControlledTerminalSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSING = 2;
      readonly CLOSED = 3;
      readonly binaryType = "blob";
      readonly bufferedAmount = 0;
      readonly extensions = "";
      readonly protocol = "";
      readyState = ControlledTerminalSocket.CONNECTING;
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onopen: ((event: Event) => void) | null = null;

      constructor(readonly url: string) {
        super();
        const sockets = (Reflect.get(window, "__controlledTerminalSockets") as ControlledTerminalSocket[] | undefined) ?? [];
        sockets.push(this);
        Reflect.set(window, "__controlledTerminalSockets", sockets);
      }

      send() {}

      close() {
        this.readyState = ControlledTerminalSocket.CLOSED;
        const event = new CloseEvent("close");
        this.dispatchEvent(event);
        this.onclose?.(event);
      }
    }

    Reflect.set(window, "WebSocket", ControlledTerminalSocket);
    Reflect.set(window, "__openTerminalSocket", () => {
      const sockets = Reflect.get(window, "__controlledTerminalSockets") as ControlledTerminalSocket[] | undefined;
      for (const socket of sockets ?? []) {
        if (socket.readyState !== ControlledTerminalSocket.CONNECTING) continue;
        socket.readyState = ControlledTerminalSocket.OPEN;
        const event = new Event("open");
        socket.dispatchEvent(event);
        socket.onopen?.(event);
      }
    });
    Reflect.set(window, "__sendTerminalScrollback", (data: string) => {
      const sockets = Reflect.get(window, "__controlledTerminalSockets") as ControlledTerminalSocket[] | undefined;
      for (const socket of sockets ?? []) {
        if (socket.readyState !== ControlledTerminalSocket.OPEN) continue;
        const event = new MessageEvent("message", {
          data: JSON.stringify({ type: "scrollback", data }),
        });
        socket.dispatchEvent(event);
        socket.onmessage?.(event);
      }
    });
  }, session);
}
