import { defineConfig } from "@playwright/test";

const port = 3108;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: {
    baseURL,
    trace: "on-first-retry"
  },
  webServer: {
    command: `node tests/e2e/prepare-fixture.mjs && npm run build && node dist/server/cli.js serve --host 127.0.0.1 --port ${port} --workspace test-results/e2e-workspace --data-dir test-results/e2e-data --workspace-name e2e-workspace`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
