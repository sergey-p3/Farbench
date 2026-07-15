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
  dir = mkdtempSync(join(tmpdir(), "farbench-config-"));
  return ["--data-dir", dir];
}

describe("parseServeArgs", () => {
  it("allows the development token for loopback hosts", () => {
    const config = parseServeArgs([...dataDirArgs(), "--host", "127.0.0.1"]);

    expect(config.authToken).toBe("dev-password");
  });

  it("allows the development token for localhost", () => {
    const config = parseServeArgs([...dataDirArgs(), "--host", "localhost"]);

    expect(config.authToken).toBe("dev-password");
  });

  it("allows the development token for IPv6 loopback", () => {
    const config = parseServeArgs([...dataDirArgs(), "--host", "::1"]);

    expect(config.authToken).toBe("dev-password");
  });

  it.each(["127.1", "0177.0.0.1", "::ffff:127.0.0.1"])(
    "allows the development token for concrete loopback literal %s",
    (host) => {
      const config = parseServeArgs([...dataDirArgs(), "--host", host]);

      expect(config.authToken).toBe("dev-password");
    }
  );

  it("requires an explicit auth token for 127-prefixed hostnames", () => {
    expect(() => parseServeArgs([...dataDirArgs(), "--host", "127.example.com"])).toThrow(/--auth-token is required/i);
  });

  it("allows 127-prefixed hostnames with an explicit auth token", () => {
    const config = parseServeArgs([...dataDirArgs(), "--host", "127.example.com", "--auth-token", "secret"]);

    expect(config.authToken).toBe("secret");
  });

  it.each(["0.0.0.0", "192.168.1.10", "devbox.local"])(
    "requires an explicit auth token for non-loopback host %s",
    (host) => {
      expect(() => parseServeArgs([...dataDirArgs(), "--host", host])).toThrow(/--auth-token is required/i);
    }
  );

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
