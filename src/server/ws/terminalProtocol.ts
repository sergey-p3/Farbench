import { TERMINAL_HISTORY_CACHE_BYTES } from "../../shared/terminalHistory.js";
import type { SessionType } from "../../shared/types.js";

export type TerminalClientMessage =
  | { type: "attach"; sessionId: string; cols: number; rows: number }
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "scroll"; direction: "up" | "down" };

export class TerminalOutputSanitizer {
  private carry = "";

  constructor(private readonly sessionType: SessionType) {}

  clean(data: string): string {
    if (!shouldStripAltScreen(this.sessionType)) return data;

    data = this.carry + data;
    this.carry = "";
    const splitTail = data.match(/\x1b(?:\[\??[0-9]{0,4})?$/);
    if (splitTail) {
      this.carry = splitTail[0];
      data = data.slice(0, -splitTail[0].length);
    }
    return stripTerminalControlSequences(data);
  }
}

export function stripTerminalReplay(sessionType: SessionType, data: string): string {
  return shouldStripAltScreen(sessionType) ? stripTerminalControlSequences(data) : data;
}

export function capTerminalReplay(data: string): string {
  return data.length > TERMINAL_HISTORY_CACHE_BYTES ? data.slice(-TERMINAL_HISTORY_CACHE_BYTES) : data;
}

function shouldStripAltScreen(sessionType: SessionType): boolean {
  return sessionType === "bash" || sessionType === "codex" || sessionType === "claude";
}

function stripTerminalControlSequences(data: string): string {
  return data
    .replace(/\x1b\[\?(?:47|1047|1049)[hl]/g, "")
    .replace(/\x1b\[3J/g, "")
    .replace(/\x1b\[\?(?:1000|1001|1002|1003|1005|1006|1007)[hl]/g, "");
}

export function parseTerminalClientMessage(raw: string): TerminalClientMessage {
  const parsed = JSON.parse(raw) as Partial<TerminalClientMessage>;
  if (parsed.type === "attach" && typeof parsed.sessionId === "string") {
    return {
      type: "attach",
      sessionId: parsed.sessionId,
      cols: positiveNumberOrDefault(parsed.cols, 80),
      rows: positiveNumberOrDefault(parsed.rows, 24),
    };
  }
  if (parsed.type === "input" && typeof parsed.data === "string") {
    return { type: "input", data: parsed.data };
  }
  if (parsed.type === "resize") {
    return {
      type: "resize",
      cols: positiveNumberOrDefault(parsed.cols, 80),
      rows: positiveNumberOrDefault(parsed.rows, 24),
    };
  }
  if (parsed.type === "scroll" && (parsed.direction === "up" || parsed.direction === "down")) {
    return { type: "scroll", direction: parsed.direction };
  }
  throw new Error("invalid terminal message");
}

function positiveNumberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function terminalMessageFields(
  message: TerminalClientMessage,
  rawBytes: number,
): Record<string, string | number> {
  if (message.type === "attach") {
    return {
      bytes: rawBytes,
      cols: message.cols,
      messageType: message.type,
      rows: message.rows,
      sessionId: message.sessionId,
    };
  }
  if (message.type === "input") {
    return { bytes: message.data.length, messageType: message.type };
  }
  if (message.type === "resize") {
    return { bytes: rawBytes, cols: message.cols, messageType: message.type, rows: message.rows };
  }
  return { bytes: rawBytes, direction: message.direction, messageType: message.type };
}

export function terminalResponseType(message: Record<string, unknown>): string {
  return typeof message.type === "string" ? message.type : "unknown";
}

export function terminalResponseBytes(message: Record<string, unknown>): number {
  if (typeof message.data === "string") return message.data.length;
  if (typeof message.error === "string") return message.error.length;
  return 0;
}

export function webSocketReadyStateName(readyState: number): string {
  if (readyState === 0) return "connecting";
  if (readyState === 1) return "open";
  if (readyState === 2) return "closing";
  if (readyState === 3) return "closed";
  return "unknown";
}
