import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";

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
    await expect(page.getByText("nested content")).toBeVisible();

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
