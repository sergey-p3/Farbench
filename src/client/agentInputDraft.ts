const AGENT_INPUT_DRAFT_KEY_PREFIX = "remote-dev-agent-input-draft:";

type DraftStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export function loadAgentInputDraft(
  sessionId: string,
  storage: DraftStorage = window.localStorage,
): string {
  try {
    return storage.getItem(agentInputDraftKey(sessionId)) ?? "";
  } catch {
    return "";
  }
}

export function saveAgentInputDraft(
  sessionId: string,
  text: string,
  storage: DraftStorage = window.localStorage,
): void {
  try {
    if (text) storage.setItem(agentInputDraftKey(sessionId), text);
    else storage.removeItem(agentInputDraftKey(sessionId));
  } catch {
    // Keep the in-memory draft usable when browser storage is unavailable.
  }
}

export function clearAgentInputDraft(
  sessionId: string,
  storage: DraftStorage = window.localStorage,
): void {
  try {
    storage.removeItem(agentInputDraftKey(sessionId));
  } catch {
    // The composer can still close after a successful terminal submission.
  }
}

export function agentInputDraftKey(sessionId: string): string {
  return `${AGENT_INPUT_DRAFT_KEY_PREFIX}${sessionId}`;
}

/** Mirrors xterm paste handling and presses Enter after the pasted prompt. */
export function agentInputSubmission(text: string, bracketedPasteMode: boolean): string {
  const normalizedText = text.replace(/\r?\n/g, "\r");
  const pastedText = bracketedPasteMode
    ? `\x1b[200~${normalizedText}\x1b[201~`
    : normalizedText;
  return `${pastedText}\r`;
}
