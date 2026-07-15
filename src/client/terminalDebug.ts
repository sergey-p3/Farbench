export type TerminalDebugValue = string | number | boolean | null | undefined;
export type TerminalDebugFields = Record<string, TerminalDebugValue>;
export type TerminalDebugLogger = (event: string, fields?: TerminalDebugFields) => void;

interface TerminalDebugContext {
  component: string;
  instanceId?: number;
  sessionId?: string | null;
}

interface TerminalDebugLoggerOptions {
  consoleLike?: Pick<Console, "info">;
  enabled?: boolean;
  now?: () => string;
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export function terminalDebugEnabled(
  storage: Pick<Storage, "getItem"> | null = typeof window !== "undefined" ? window.localStorage : null,
  search = typeof window !== "undefined" ? window.location.search : "",
): boolean {
  try {
    if (isTrue(storage?.getItem("remoteDevTerminalDebug"))) return true;
  } catch {
    // Storage can be unavailable in private browsing modes.
  }

  const params = new URLSearchParams(search);
  return isTrue(params.get("terminalDebug")) || isTrue(params.get("remoteDevTerminalDebug"));
}

export function createTerminalDebugLogger(
  context: TerminalDebugContext,
  options: TerminalDebugLoggerOptions = {},
): TerminalDebugLogger {
  const enabled = options.enabled ?? terminalDebugEnabled();
  const consoleLike = options.consoleLike ?? console;
  const now = options.now ?? (() => new Date().toISOString());

  return (event, fields = {}) => {
    if (!enabled) return;
    consoleLike.info("[farbench terminal]", compactPayload({
      ...context,
      event,
      ...fields,
      timestamp: now(),
    }));
  };
}

function isTrue(value: string | null | undefined): boolean {
  return TRUE_VALUES.has(String(value ?? "").trim().toLowerCase());
}

function compactPayload(fields: Record<string, TerminalDebugValue>): Record<string, Exclude<TerminalDebugValue, undefined>> {
  const payload: Record<string, Exclude<TerminalDebugValue, undefined>> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) payload[key] = value;
  }
  return payload;
}
