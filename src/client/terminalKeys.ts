export type TerminalToolbarKey =
  | "ctrl"
  | "escape"
  | "tab"
  | "enter"
  | "left"
  | "up"
  | "down"
  | "right"
  | "c"
  | "d"
  | "l";

export interface TerminalToolbarKeyDefinition {
  key: TerminalToolbarKey;
  label: string;
  ariaLabel: string;
}

export interface TerminalControlSequence {
  data: string;
  clearsCtrl: boolean;
}

export const terminalKeyLabels: TerminalToolbarKeyDefinition[] = [
  { key: "ctrl", label: "Ctrl", ariaLabel: "Sticky Control modifier" },
  { key: "escape", label: "Esc", ariaLabel: "Escape" },
  { key: "tab", label: "Tab", ariaLabel: "Tab" },
  { key: "enter", label: "Enter", ariaLabel: "Enter" },
  { key: "left", label: "←", ariaLabel: "Left arrow" },
  { key: "up", label: "↑", ariaLabel: "Up arrow" },
  { key: "down", label: "↓", ariaLabel: "Down arrow" },
  { key: "right", label: "→", ariaLabel: "Right arrow" },
  { key: "c", label: "C", ariaLabel: "C" },
  { key: "d", label: "D", ariaLabel: "D" },
  { key: "l", label: "L", ariaLabel: "L" },
];

const directSequences: Partial<Record<TerminalToolbarKey, string>> = {
  escape: "\x1b",
  tab: "\t",
  enter: "\r",
  left: "\x1b[D",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  c: "c",
  d: "d",
  l: "l",
};

export function terminalControlSequence(key: TerminalToolbarKey, ctrlActive: boolean): TerminalControlSequence | null {
  if (key === "ctrl") return null;

  if (ctrlActive && isControlLetter(key)) {
    return { data: String.fromCharCode(key.toUpperCase().charCodeAt(0) - 64), clearsCtrl: true };
  }

  const data = directSequences[key];
  if (!data) return null;
  return { data, clearsCtrl: ctrlActive };
}

function isControlLetter(key: TerminalToolbarKey): key is "c" | "d" | "l" {
  return key === "c" || key === "d" || key === "l";
}
