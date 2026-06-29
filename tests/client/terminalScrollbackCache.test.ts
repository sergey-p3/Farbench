import { describe, expect, test } from "vitest";
import {
  readCachedScrollback,
  scrollbackCacheKey,
  writeCachedScrollback,
} from "../../src/client/terminalScrollbackCache.js";

function fakeStorage(initial: Record<string, string> = {}): Storage & { store: Record<string, string> } {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    get length() {
      return Object.keys(store).length;
    },
    clear() {
      for (const key of Object.keys(store)) delete store[key];
    },
    getItem(key: string) {
      return key in store ? store[key] : null;
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null;
    },
    removeItem(key: string) {
      delete store[key];
    },
    setItem(key: string, value: string) {
      store[key] = value;
    },
  };
}

describe("terminalScrollbackCache", () => {
  test("round-trips scrollback for a session", () => {
    const storage = fakeStorage();
    writeCachedScrollback(storage, "session-1", "hello\r\nworld");
    expect(readCachedScrollback(storage, "session-1")).toBe("hello\r\nworld");
  });

  test("returns null for an uncached session", () => {
    const storage = fakeStorage();
    expect(readCachedScrollback(storage, "missing")).toBeNull();
  });

  test("keeps caches per session independent", () => {
    const storage = fakeStorage();
    writeCachedScrollback(storage, "a", "alpha");
    writeCachedScrollback(storage, "b", "beta");
    expect(readCachedScrollback(storage, "a")).toBe("alpha");
    expect(readCachedScrollback(storage, "b")).toBe("beta");
  });

  test("empty data clears any existing cache entry", () => {
    const storage = fakeStorage();
    writeCachedScrollback(storage, "a", "alpha");
    writeCachedScrollback(storage, "a", "");
    expect(readCachedScrollback(storage, "a")).toBeNull();
    expect(storage.length).toBe(0);
  });

  test("caps stored data to the tail when oversized", () => {
    const storage = fakeStorage();
    const big = "x".repeat(500_000);
    writeCachedScrollback(storage, "a", big);
    const stored = readCachedScrollback(storage, "a") ?? "";
    expect(stored.length).toBeLessThan(big.length);
    expect(big.endsWith(stored)).toBe(true);
  });

  test("caps legacy oversized data when reading", () => {
    const big = "x".repeat(500_000);
    const storage = fakeStorage({ [scrollbackCacheKey("a")]: big });
    const stored = readCachedScrollback(storage, "a") ?? "";
    expect(stored.length).toBeLessThan(big.length);
    expect(big.endsWith(stored)).toBe(true);
    expect(storage.getItem(scrollbackCacheKey("a"))).toBe(stored);
  });

  test("swallows storage failures (quota / disabled)", () => {
    const throwing: Storage = {
      length: 0,
      clear() {},
      getItem() {
        throw new Error("disabled");
      },
      key() {
        return null;
      },
      removeItem() {
        throw new Error("disabled");
      },
      setItem() {
        throw new Error("quota");
      },
    };
    expect(() => writeCachedScrollback(throwing, "a", "data")).not.toThrow();
    expect(readCachedScrollback(throwing, "a")).toBeNull();
  });

  test("namespaces keys to avoid collisions", () => {
    expect(scrollbackCacheKey("abc")).toContain("abc");
    expect(scrollbackCacheKey("abc")).not.toBe("abc");
  });
});
