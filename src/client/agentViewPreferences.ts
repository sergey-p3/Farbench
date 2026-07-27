export type AgentViewMode = "rich" | "terminal";
export type RichAgentOutputMode = "log" | "screen";

const AGENT_VIEW_MODE_KEY = "farbench-agent-view-mode";
const RICH_AGENT_OUTPUT_MODE_KEY = "farbench-rich-agent-output-mode";

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function loadAgentViewMode(
  storage: PreferenceStorage = window.localStorage,
): AgentViewMode {
  return readPreference(storage, AGENT_VIEW_MODE_KEY, isAgentViewMode) ?? "terminal";
}

export function saveAgentViewMode(
  mode: AgentViewMode,
  storage: PreferenceStorage = window.localStorage,
): void {
  writePreference(storage, AGENT_VIEW_MODE_KEY, mode);
}

export function loadRichAgentOutputMode(
  storage: PreferenceStorage = window.localStorage,
): RichAgentOutputMode {
  return readPreference(storage, RICH_AGENT_OUTPUT_MODE_KEY, isRichAgentOutputMode) ?? "screen";
}

export function saveRichAgentOutputMode(
  mode: RichAgentOutputMode,
  storage: PreferenceStorage = window.localStorage,
): void {
  writePreference(storage, RICH_AGENT_OUTPUT_MODE_KEY, mode);
}

function readPreference<T extends string>(
  storage: PreferenceStorage,
  key: string,
  isValid: (value: string) => value is T,
): T | null {
  try {
    const value = storage.getItem(key);
    return value && isValid(value) ? value : null;
  } catch {
    return null;
  }
}

function writePreference(storage: PreferenceStorage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Preferences remain usable in memory when browser storage is unavailable.
  }
}

function isAgentViewMode(value: string): value is AgentViewMode {
  return value === "rich" || value === "terminal";
}

function isRichAgentOutputMode(value: string): value is RichAgentOutputMode {
  return value === "log" || value === "screen";
}
