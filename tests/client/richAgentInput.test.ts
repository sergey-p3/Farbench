import { describe, expect, test } from "vitest";
import { normalizeRichAgentTyping, richAgentKeyInput } from "../../src/client/richAgentInput.js";

const key = (value: string, overrides: Partial<Parameters<typeof richAgentKeyInput>[0]> = {}) => ({
  altKey: false,
  ctrlKey: false,
  key: value,
  metaKey: false,
  shiftKey: false,
  ...overrides,
});

describe("rich agent immediate input", () => {
  test("maps terminal navigation and editing keys", () => {
    expect(richAgentKeyInput(key("Enter"))).toBe("\r");
    expect(richAgentKeyInput(key("Backspace"))).toBe("\x7f");
    expect(richAgentKeyInput(key("ArrowUp"))).toBe("\x1b[A");
    expect(richAgentKeyInput(key("Delete"))).toBe("\x1b[3~");
    expect(richAgentKeyInput(key("Tab", { shiftKey: true }))).toBe("\x1b[Z");
  });

  test("maps control letters while leaving paste to the browser", () => {
    expect(richAgentKeyInput(key("c", { ctrlKey: true }))).toBe("\x03");
    expect(richAgentKeyInput(key("v", { ctrlKey: true }))).toBeNull();
    expect(richAgentKeyInput(key("a", { ctrlKey: true, metaKey: true }))).toBeNull();
  });

  test("maps alt-modified printable keys without intercepting AltGr input", () => {
    expect(richAgentKeyInput(key("x", { altKey: true }))).toBe("\x1bx");
    expect(richAgentKeyInput(key("@", { altKey: true, ctrlKey: true }))).toBeNull();
  });

  test("lets printable text flow through the textarea input event", () => {
    expect(richAgentKeyInput(key("x"))).toBeNull();
    expect(normalizeRichAgentTyping("hello\nworld\r\n")).toBe("hello\rworld\r");
  });
});
