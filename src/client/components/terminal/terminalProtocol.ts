export type TerminalSocketMessage =
  | { type: "scrollback"; data: string }
  | { type: "output"; data: string }
  | { type: "error"; error: string }
  | { type: "exit" };

export type TerminalConnectionPhase = "connecting" | "attaching" | "loading-history" | null;

export function terminalSocketUrl(
  locationLike: Pick<Location, "protocol" | "host"> = window.location,
): string {
  const protocol = locationLike.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${locationLike.host}/ws/terminal`;
}

export function terminalConnectionStatusText(
  displayKind: "terminal" | "agent",
  phase: TerminalConnectionPhase,
): string | null {
  if (!phase) return null;
  const label = displayKind === "agent" ? "agent" : "terminal";
  if (phase === "connecting") return `Connecting to ${label}...`;
  if (phase === "attaching") return `Attaching ${label}...`;
  return `Loading ${label} history...`;
}

export function terminalControlLetter(data: string): "c" | "d" | "l" | null {
  if (data.length !== 1) return null;
  const key = data.toLowerCase();
  return key === "c" || key === "d" || key === "l" ? key : null;
}

export function averageTouchClientY(touches: TouchList): number | null {
  if (touches.length !== 1 && touches.length !== 2) return null;
  let total = 0;
  for (let index = 0; index < touches.length; index += 1) {
    total += touches[index]?.clientY ?? 0;
  }
  return total / touches.length;
}

export function parseTerminalMessage(data: unknown): TerminalSocketMessage | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data) as Partial<TerminalSocketMessage>;
    if ((parsed.type === "scrollback" || parsed.type === "output") && typeof parsed.data === "string") {
      return parsed as TerminalSocketMessage;
    }
    if (parsed.type === "error" && typeof parsed.error === "string") {
      return parsed as TerminalSocketMessage;
    }
    if (parsed.type === "exit") return { type: "exit" };
  } catch {
    return null;
  }
  return null;
}

export function webSocketReadyStateName(readyState: number | undefined): string {
  if (readyState === 0) return "connecting";
  if (readyState === 1) return "open";
  if (readyState === 2) return "closing";
  if (readyState === 3) return "closed";
  return "unknown";
}

export function socketDataBytes(data: unknown): number {
  return typeof data === "string" ? data.length : 0;
}

export function terminalMessageBytes(message: TerminalSocketMessage): number {
  if ("data" in message) return message.data.length;
  if ("error" in message) return message.error.length;
  return 0;
}
