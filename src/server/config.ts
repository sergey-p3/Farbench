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

function parseIpv4Part(part: string): number | null {
  if (part === "") return null;
  const radix = part.length > 1 && part.startsWith("0") ? 8 : 10;
  if (radix === 8 && !/^[0-7]+$/.test(part)) return null;
  if (radix === 10 && !/^\d+$/.test(part)) return null;
  const value = Number.parseInt(part, radix);
  return Number.isSafeInteger(value) ? value : null;
}

function ipv4LiteralFirstOctet(host: string): number | null {
  if (!/^[0-9.]+$/.test(host)) return null;
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const values = parts.map(parseIpv4Part);
  if (values.some((value) => value === null)) return null;
  const [first, second, third, fourth] = values as [number, number?, number?, number?];

  if (parts.length === 1) return first <= 0xffffffff ? first >>> 24 : null;
  if (first > 0xff) return null;
  if (parts.length === 2) return second !== undefined && second <= 0xffffff ? first : null;
  if (second === undefined || second > 0xff) return null;
  if (parts.length === 3) return third !== undefined && third <= 0xffff ? first : null;
  return third !== undefined && third <= 0xff && fourth !== undefined && fourth <= 0xff ? first : null;
}

function isLoopbackHost(host: string): boolean {
  if (host === "localhost" || host === "::1") return true;
  if (isIP(host) === 6 && host.toLowerCase().startsWith("::ffff:")) {
    return ipv4LiteralFirstOctet(host.slice("::ffff:".length)) === 127;
  }
  return ipv4LiteralFirstOctet(host) === 127;
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
  const dataDir = resolve(get("--data-dir", `${homedir()}/.farbench`));
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
