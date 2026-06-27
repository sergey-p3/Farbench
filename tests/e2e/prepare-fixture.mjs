import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workspace = resolve(root, "test-results/e2e-workspace");
const dataDir = resolve(root, "test-results/e2e-data");

rmSync(workspace, { force: true, recursive: true });
rmSync(dataDir, { force: true, recursive: true });
mkdirSync(workspace, { recursive: true });
mkdirSync(dataDir, { recursive: true });
mkdirSync(resolve(workspace, "src"), { recursive: true });

writeFileSync(resolve(workspace, "README.md"), "# E2E workspace\n\nInitial content.\n");
writeFileSync(resolve(workspace, "app.txt"), "first line\noriginal line\n");
writeFileSync(
  resolve(workspace, "src", "nested.txt"),
  Array.from({ length: 120 }, (_, index) => `nested content line ${String(index + 1).padStart(3, "0")}`).join("\n") + "\n",
);

execFileSync("git", ["init"], { cwd: workspace, stdio: "ignore" });
execFileSync("git", ["config", "user.email", "e2e@example.com"], { cwd: workspace, stdio: "ignore" });
execFileSync("git", ["config", "user.name", "E2E"], { cwd: workspace, stdio: "ignore" });
execFileSync("git", ["add", "README.md", "app.txt", "src/nested.txt"], { cwd: workspace, stdio: "ignore" });
execFileSync("git", ["commit", "-m", "initial"], { cwd: workspace, stdio: "ignore" });

writeFileSync(resolve(workspace, "app.txt"), "first line\nchanged line\n");
