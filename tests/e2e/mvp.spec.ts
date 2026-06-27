import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
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

    await expect(page.getByRole("heading", { level: 1, name: "No item open" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Workspaces" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Sessions" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create item" })).toBeVisible();

    await page.getByRole("button", { name: "Create item" }).click();
    await expect(page.getByRole("button", { name: "Files" })).toBeVisible();
    await page.getByRole("button", { name: "Files" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Files" })).toBeVisible();
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

    await page.getByRole("button", { name: "Create item" }).click();
    await page.getByRole("button", { name: "Files" }).click();
    await expect(page.getByRole("heading", { level: 3, name: "Files is already open" })).toBeVisible();
    await page.getByRole("button", { name: "Focus existing" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Files" })).toBeVisible();

    await page.getByRole("button", { name: "Create item" }).click();
    await page.getByRole("button", { name: "Git diff" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Git diff" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    await page.getByRole("button", { name: /app\.txt/ }).click();
    await expect(page.getByLabel("Git diff").getByText("-original line")).toBeVisible();
    await expect(page.getByLabel("Git diff").getByText("+changed line")).toBeVisible();

    await page.getByRole("button", { name: "Create item" }).click();
    await page.getByLabel("Port").fill(String(preview.port));
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`Preview :${preview.port}`) })).toBeVisible();
    await page.getByRole("button", { name: "Expose" }).click();
    await expect(page.getByRole("link", { name: "Open in new tab" })).toBeVisible();
    await expect(page.frameLocator(`iframe[title="Preview port ${preview.port}"]`).getByText("preview fixture ok")).toBeVisible();

    await page.getByRole("button", { name: "Open item switcher" }).click();
    await expect(page.getByLabel("Item switcher").getByRole("button", { name: /Files/ })).toBeVisible();
    await expect(page.getByLabel("Item switcher").getByRole("button", { name: /Git diff/ })).toBeVisible();
    await page.getByLabel("Item switcher").getByRole("button", { name: /Files/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Files" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Files" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Workspaces" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Sessions" })).toHaveCount(0);
  } finally {
    await closeServer(preview.server);
  }
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
  expect(viewportLock.appViewportHeight).toBe("520px");
  expect(viewportLock.scrollHeight).toBe(viewportLock.clientHeight);
  expect(scrollYAfterScrollAttempt).toBe(viewportLock.scrollYBefore);
  expect(Math.round(paneBox.y + paneBox.height)).toBeLessThanOrEqual(520);
  expect(Math.round(toolbarBox.y + toolbarBox.height)).toBeLessThanOrEqual(520);
});

test("mobile terminal special keys send toolbar input while preserving keyboard textarea focus", async ({ page }) => {
  let terminalSession: Session | null = null;

  await page.addInitScript(() => {
    const sentMessages: string[] = [];

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
  });

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

  await terminalSurface.click({ button: "right", position: { x: 60, y: 60 } });
  const menu = page.getByRole("menu", { name: "Terminal actions" });
  await expect(menu.getByRole("menuitem", { name: "Copy" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Paste" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Select all" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await terminalSurface.dispatchEvent("pointerdown", {
    button: 0,
    clientX: 80,
    clientY: 220,
    pointerId: 7,
    pointerType: "touch",
  });
  await page.waitForTimeout(650);
  await expect(page.getByRole("menu", { name: "Terminal actions" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Select all" }).click();
  await expect(page.getByRole("menu", { name: "Terminal actions" })).toHaveCount(0);

  await toolbar.getByRole("button", { name: "Sticky Control modifier" }).click();
  await page.getByLabel("Terminal input").focus();
  await page.keyboard.press("c");

  const sentMessagesAfterTypedCtrl = await page.evaluate(() => {
    const messages = Reflect.get(window, "__terminalSentMessages") as string[];
    return messages.map((message) => JSON.parse(message) as { type: string; data?: string });
  });
  expect(sentMessagesAfterTypedCtrl.filter((message) => message.type === "input").map((message) => message.data)).toEqual(["\x03", "\x1b[A", "\x03"]);

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
  expect(sentMessagesAfterTouchCtrl.filter((message) => message.type === "input").map((message) => message.data)).toEqual(["\x03", "\x1b[A", "\x03", "\x03"]);
  expect(activeElementLabelAfterTouch).toBe("Terminal input");
});
