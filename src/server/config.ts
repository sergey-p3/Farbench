import { mkdirSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { basename, resolve } from "node:path";

export interface ServerConfig {
  host: string;
  port: number;
  workspacePath: string;
  workspaceName: string;
  dataDir: string;
  authToken: string;
}

export function parseServeArgs(argv: string[]): ServerConfig {
  const get = (flag: string, fallback: string): string => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };
  const workspacePath = resolve(get("--workspace", "."));
  const dataDir = resolve(get("--data-dir", `${homedir()}/.remote-dev`));
  mkdirSync(dataDir, { recursive: true });
  return {
    host: get("--host", "127.0.0.1"),
    port: Number(get("--port", "3000")),
    workspacePath,
    workspaceName: get("--workspace-name", basename(workspacePath)),
    dataDir,
    authToken: get("--auth-token", "dev-password")
  };
}

export function lanAddress(): string | null {
  for (const values of Object.values(networkInterfaces())) {
    for (const value of values ?? []) {
      if (value.family === "IPv4" && !value.internal) return value.address;
    }
  }
  return null;
}
