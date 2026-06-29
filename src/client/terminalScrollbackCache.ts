const CACHE_PREFIX = "remote-dev-terminal-scrollback:";
const MAX_CACHED_BYTES = 200_000;

type ReadableStorage = Pick<Storage, "getItem" | "setItem">;
type WritableStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function scrollbackCacheKey(sessionId: string): string {
  return `${CACHE_PREFIX}${sessionId}`;
}

export function readCachedScrollback(storage: ReadableStorage, sessionId: string): string | null {
  try {
    const cached = storage.getItem(scrollbackCacheKey(sessionId));
    if (!cached) return cached;
    const capped = capScrollback(cached);
    if (capped.length !== cached.length) {
      try {
        storage.setItem(scrollbackCacheKey(sessionId), capped);
      } catch {
        // Cache cleanup is best-effort; still return the bounded value.
      }
    }
    return capped;
  } catch {
    return null;
  }
}

export function writeCachedScrollback(storage: WritableStorage, sessionId: string, data: string): void {
  try {
    const key = scrollbackCacheKey(sessionId);
    if (!data) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, capScrollback(data));
  } catch {
    // Storage may be unavailable (private mode) or full (quota); caching is best-effort.
  }
}

function capScrollback(data: string): string {
  return data.length > MAX_CACHED_BYTES ? data.slice(data.length - MAX_CACHED_BYTES) : data;
}
