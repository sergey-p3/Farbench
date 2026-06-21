import { mkdirSync } from "node:fs";
import { isIP } from "node:net";
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

function isLoopbackHost(host: string): boolean {
  if (host === "localhost" || host === "::1") return true;
  return isIP(host) === 4 && host.startsWith("127.");
}

export function parseServeArgs(argv: string[]): ServerConfig {
  const hasFlag = (flag: string): boolean => argv.includes(flag);
  const get = (flag: string, fallback: string): string => {
    const index = argv.indexOf(flag);
    if (index < 0) return fallback;
    const value = argv[index + 1];
    if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
    return value;
  };
  const portValue = get("--port", "3000");
  if (!/^\d+$/.test(portValue)) throw new Error("--port must be an integer from 1 to 65535");
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("--port must be an integer from 1 to 65535");
  }
  const host = get("--host", "127.0.0.1");
  const authToken = get("--auth-token", "dev-password");
  if (!isLoopbackHost(host) && !hasFlag("--auth-token")) {
    throw new Error("--auth-token is required when binding to a non-loopback host");
  }
  const workspacePath = resolve(get("--workspace", "."));
  const dataDir = resolve(get("--data-dir", `${homedir()}/.remote-dev`));
  mkdirSync(dataDir, { recursive: true });
  return {
    host,
    port,
    workspacePath,
    workspaceName: get("--workspace-name", basename(workspacePath)),
    dataDir,
    authToken
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
