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

test("owner can open workspace and see durable browser shell UI", async ({ page }, testInfo) => {
  const preview = await startPreviewServer();
  testInfo.annotations.push({
    type: "tmux",
    description: "tmux-backed session startup is not exercised here because the app has no E2E cleanup path for durable tmux sessions.",
  });

  await page.context().clearCookies();
  await page.goto("/");

  try {
    await page.getByLabel("Access token").fill("dev-password");
    await page.getByRole("button", { name: "Connect" }).click();

    await expect(page.getByRole("heading", { name: "Workspaces" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
    await expect(page.getByRole("button", { name: "e2e-workspace" })).toBeVisible();
    await expect(page.getByRole("button", { name: "bash" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Workspaces" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();

    await page.getByRole("button", { name: "files", exact: true }).click();
    await expect(page.getByRole("button", { name: /app\.txt/ })).toBeVisible();
    await page.getByRole("button", { name: /app\.txt/ }).click();
    await expect(page.getByLabel("File editor").getByText("app.txt")).toBeVisible();
    await expect(page.getByText("changed line")).toBeVisible();

    await page.getByRole("button", { name: "git", exact: true }).click();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    await expect(page.getByRole("button", { name: /app\.txt/ })).toBeVisible();
    await page.getByRole("button", { name: /app\.txt/ }).click();
    await expect(page.getByLabel("Git diff").getByText("-original line")).toBeVisible();
    await expect(page.getByLabel("Git diff").getByText("+changed line")).toBeVisible();

    await page.getByRole("button", { name: "preview", exact: true }).click();
    await page.getByLabel("Port").fill(String(preview.port));
    await page.getByRole("button", { name: "Expose" }).click();
    await expect(page.getByRole("link", { name: "Open in new tab" })).toBeVisible();
    await expect(page.frameLocator(`iframe[title="Preview port ${preview.port}"]`).getByText("preview fixture ok")).toBeVisible();
  } finally {
    await closeServer(preview.server);
  }
});
