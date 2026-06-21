import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseServeArgs } from "../../src/server/config.js";

let dir: string | null = null;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function dataDirArgs(): string[] {
  dir = mkdtempSync(join(tmpdir(), "remote-dev-config-"));
  return ["--data-dir", dir];
}

describe("parseServeArgs", () => {
  it("allows the development token for loopback hosts", () => {
    const config = parseServeArgs([...dataDirArgs(), "--host", "127.0.0.1"]);

    expect(config.authToken).toBe("dev-password");
  });

  it("requires an explicit auth token when binding to all interfaces", () => {
    expect(() => parseServeArgs([...dataDirArgs(), "--host", "0.0.0.0"])).toThrow(/--auth-token is required/i);
  });

  it("rejects non-numeric ports", () => {
    expect(() => parseServeArgs([...dataDirArgs(), "--port", "abc"])).toThrow(/--port must be an integer/i);
  });

  it("rejects missing flag values", () => {
    expect(() => parseServeArgs([...dataDirArgs(), "--port", "--host"])).toThrow(/--port requires a value/i);
  });

  it("rejects ports outside the TCP range", () => {
    expect(() => parseServeArgs([...dataDirArgs(), "--port", "65536"])).toThrow(/--port must be an integer/i);
  });
});
