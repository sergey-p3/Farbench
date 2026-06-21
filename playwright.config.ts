import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry"
  },
  webServer: {
    command: "npm run build && node dist/server/cli.js serve --host 127.0.0.1 --port 3000 --workspace .",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 30_000
  }
});
