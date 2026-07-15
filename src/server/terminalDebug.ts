export type TerminalDebugValue = string | number | boolean | null | undefined;
export type TerminalDebugFields = Record<string, TerminalDebugValue>;

export interface TerminalDebugOptions {
  consoleLike?: Pick<Console, "info">;
  enabled?: boolean;
  env?: NodeJS.ProcessEnv;
  now?: () => string;
}

export interface TerminalDebugLogger {
  enabled: boolean;
  log: (event: string, fields?: TerminalDebugFields) => void;
}

interface TerminalDebugContext {
  component: string;
  connectionId?: number;
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export function terminalDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return TRUE_VALUES.has(String(env.FARBENCH_TERMINAL_DEBUG ?? "").trim().toLowerCase());
}

export function createTerminalDebugLogger(
  context: TerminalDebugContext,
  options: TerminalDebugOptions = {},
): TerminalDebugLogger {
  const enabled = options.enabled ?? terminalDebugEnabled(options.env);
  const consoleLike = options.consoleLike ?? console;
  const now = options.now ?? (() => new Date().toISOString());

  return {
    enabled,
    log(event, fields = {}) {
      if (!enabled) return;
      consoleLike.info("[farbench terminal]", compactPayload({
        ...context,
        event,
        ...fields,
        timestamp: now(),
      }));
    },
  };
}

function compactPayload(fields: Record<string, TerminalDebugValue>): Record<string, Exclude<TerminalDebugValue, undefined>> {
  const payload: Record<string, Exclude<TerminalDebugValue, undefined>> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) payload[key] = value;
  }
  return payload;
}
