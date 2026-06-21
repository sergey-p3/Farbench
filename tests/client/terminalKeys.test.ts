import { describe, expect, test } from "vitest";
import { terminalControlSequence, terminalKeyLabels, type TerminalToolbarKey } from "../../src/client/terminalKeys.js";

describe("terminal toolbar keys", () => {
  test("exposes compact labels for mobile toolbar rendering", () => {
    expect(terminalKeyLabels.map((key) => key.label)).toEqual(["Ctrl", "Esc", "Tab", "Enter", "←", "↑", "↓", "→", "C", "D", "L"]);
  });

  test.each([
    ["escape", false, "\x1b", false],
    ["tab", false, "\t", false],
    ["enter", false, "\r", false],
    ["left", false, "\x1b[D", false],
    ["up", false, "\x1b[A", false],
    ["down", false, "\x1b[B", false],
    ["right", false, "\x1b[C", false],
    ["c", false, "c", false],
    ["d", false, "d", false],
    ["l", false, "l", false],
  ] satisfies Array<[TerminalToolbarKey, boolean, string, boolean]>)(
    "maps %s without sticky ctrl",
    (key, ctrlActive, data, clearsCtrl) => {
      expect(terminalControlSequence(key, ctrlActive)).toEqual({ data, clearsCtrl });
    },
  );

  test.each([
    ["c", "\x03"],
    ["d", "\x04"],
    ["l", "\x0c"],
  ] satisfies Array<[TerminalToolbarKey, string]>)("maps Ctrl+%s to a control character and clears ctrl", (key, data) => {
    expect(terminalControlSequence(key, true)).toEqual({ data, clearsCtrl: true });
  });

  test.each([
    ["escape", "\x1b"],
    ["tab", "\t"],
    ["enter", "\r"],
    ["left", "\x1b[D"],
    ["up", "\x1b[A"],
    ["down", "\x1b[B"],
    ["right", "\x1b[C"],
  ] satisfies Array<[TerminalToolbarKey, string]>)("keeps %s unchanged and clears sticky ctrl", (key, data) => {
    expect(terminalControlSequence(key, true)).toEqual({ data, clearsCtrl: true });
  });
});
