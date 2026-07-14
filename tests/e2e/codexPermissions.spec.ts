import { expect, test, type Page } from "@playwright/test";
import type { Session } from "../../src/shared/types.js";

async function openTopMenu(page: Page): Promise<void> {
  const hideTopMenu = page.getByRole("button", { name: "Hide top menu" });
  if (await hideTopMenu.isVisible()) return;
  await page.getByRole("button", { name: "Show top menu" }).click();
  await expect(hideTopMenu).toBeVisible();
}

test("chooses the permission level before starting Codex", async ({ page }) => {
  let createdSession: Session | null = null;
  let createBody: Record<string, unknown> | null = null;

  await page.route("**/api/workspaces/*/sessions", async (route) => {
    const request = route.request();
    const workspaceId = decodeURIComponent(new URL(request.url()).pathname.split("/")[3] ?? "workspace");

    if (request.method() === "POST") {
      createBody = request.postDataJSON() as Record<string, unknown>;
      createdSession = {
        id: "e2e-codex-session",
        workspaceId,
        name: "codex session",
        type: "codex",
        tmuxName: "e2e_codex",
        status: "running",
        createdAt: new Date().toISOString(),
        lastAttachedAt: null,
        lastActivityAt: null,
        endedAt: null,
      };
      await route.fulfill({ contentType: "application/json", json: { session: createdSession } });
      return;
    }

    if (request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: { sessions: createdSession ? [createdSession] : [] },
      });
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

  await expect(page.getByRole("group", { name: "Codex permissions" })).toHaveCount(0);
  await page.getByRole("button", { name: "Agent: Codex" }).click();
  await expect(page.getByRole("heading", { name: "Start Codex" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Agent: Claude" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Workspace \(recommended\)/ })).toBeChecked();
  await page.getByRole("radio", { name: /Full access/ }).check();
  await page.getByRole("button", { name: "Start Codex" }).click();

  await expect.poll(() => createBody).toEqual({
    type: "codex",
    name: "codex session",
    codexPermissionLevel: "danger-full-access",
  });
});
