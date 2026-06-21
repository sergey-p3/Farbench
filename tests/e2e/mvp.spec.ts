import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

const hasTmux = (() => {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("owner can open workspace and see durable browser shell UI", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Access token").fill("dev-password");
  await page.getByRole("button", { name: "Connect" }).click();

  await expect(page.getByRole("heading", { name: "Workspaces" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();

  if (hasTmux) {
    await page.getByRole("button", { name: "bash" }).click();
    await expect(page.getByRole("button", { name: /bash session/i })).toBeVisible();
  } else {
    testInfo.annotations.push({
      type: "tmux",
      description: "tmux is not available; skipped the tmux-backed bash session startup path.",
    });
    await expect(page.getByRole("button", { name: "bash" })).toBeVisible();
  }

  await page.reload();
  await expect(page.getByRole("heading", { name: "Workspaces" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();

  await page.getByRole("button", { name: "files" }).click();
  await expect(page.getByLabel("File editor").getByText("No file selected")).toBeVisible();

  await page.getByRole("button", { name: "git" }).click();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();

  await page.getByRole("button", { name: "preview" }).click();
  await expect(page.getByRole("button", { name: "Expose" })).toBeVisible();
});
