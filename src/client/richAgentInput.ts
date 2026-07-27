export type RichAgentInputMode = "keystroke" | "message";

interface KeyboardInput {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

const KEY_SEQUENCES: Record<string, string> = {
  ArrowDown: "\x1b[B",
  ArrowLeft: "\x1b[D",
  ArrowRight: "\x1b[C",
  ArrowUp: "\x1b[A",
  Backspace: "\x7f",
  Delete: "\x1b[3~",
  End: "\x1b[F",
  Enter: "\r",
  Escape: "\x1b",
  Home: "\x1b[H",
  Tab: "\t",
};

/** Returns input that must bypass the textarea in immediate keystroke mode. */
export function richAgentKeyInput(event: KeyboardInput): string | null {
  if (event.key === "Tab" && event.shiftKey) return "\x1b[Z";
  const sequence = KEY_SEQUENCES[event.key];
  if (sequence) return event.altKey ? `\x1b${sequence}` : sequence;
  if (event.ctrlKey && !event.metaKey && /^[a-z]$/i.test(event.key)) {
    if (event.key.toLowerCase() === "v") return null;
    return String.fromCharCode(event.key.toUpperCase().charCodeAt(0) - 64);
  }
  if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.length === 1) {
    return `\x1b${event.key}`;
  }
  return null;
}

export function normalizeRichAgentTyping(text: string): string {
  return text.replace(/\r?\n/g, "\r");
}
