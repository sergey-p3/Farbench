export interface TerminalLogCollector {
  append(data: string): string;
  replay(data: string): string;
  replace(data: string): string;
  value(): string;
}

const MAX_PENDING_CONTROL_CHARS = 8_192;

/** Builds a chronological, plain-text log from a terminal byte stream. */
export function createTerminalLogCollector(maxChars = Number.POSITIVE_INFINITY): TerminalLogCollector {
  const limit = Number.isFinite(maxChars) ? Math.max(1, Math.floor(maxChars)) : null;
  let text = "";
  let pendingControl = "";
  let lastWasCarriageReturn = false;

  const consume = (data: string, shouldReplace: boolean): string => {
    if (shouldReplace) {
      text = "";
      pendingControl = "";
      lastWasCarriageReturn = false;
    }

    const input = pendingControl + data;
    pendingControl = "";
    let printable = "";

    for (let index = 0; index < input.length;) {
      const code = input.charCodeAt(index);
      if (code === 0x1b) {
        const end = escapeSequenceEnd(input, index);
        if (end === -1) {
          pendingControl = input.slice(index);
          if (pendingControl.length > MAX_PENDING_CONTROL_CHARS) pendingControl = "";
          break;
        }
        index = end;
        continue;
      }
      if (code === 0x9b || code === 0x9d || code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f) {
        const end = code === 0x9b
          ? csiEnd(input, index + 1)
          : stringSequenceEnd(input, index + 1, code === 0x9d);
        if (end === -1) {
          pendingControl = input.slice(index);
          if (pendingControl.length > MAX_PENDING_CONTROL_CHARS) pendingControl = "";
          break;
        }
        index = end;
        continue;
      }
      if (code === 0x0d) {
        printable += "\n";
        lastWasCarriageReturn = true;
        index += 1;
        continue;
      }
      if (code === 0x0a) {
        if (!lastWasCarriageReturn) printable += "\n";
        lastWasCarriageReturn = false;
        index += 1;
        continue;
      }
      if (code === 0x09) {
        printable += "\t";
        lastWasCarriageReturn = false;
        index += 1;
        continue;
      }
      if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
        index += 1;
        continue;
      }
      printable += input[index];
      lastWasCarriageReturn = false;
      index += 1;
    }

    text = capLog(`${text}${printable}`, limit);
    return text;
  };

  return {
    append: (data) => consume(data, false),
    replay(data) {
      const previous = text;
      const replay = consume(data, true);
      text = capLog(mergeTerminalHistory(previous, replay), limit);
      return text;
    },
    replace: (data) => consume(data, true),
    value: () => text,
  };
}

/** Merges an authoritative reconnect replay into an existing chronological log. */
export function mergeTerminalHistory(previous: string, replay: string): string {
  if (!previous) return replay;
  if (!replay || previous.endsWith(replay)) return previous;
  if (replay.endsWith(previous)) return replay;

  const overlap = suffixPrefixOverlap(previous, replay);
  return `${previous}${replay.slice(overlap)}`;
}

function capLog(text: string, limit: number | null): string {
  return limit === null || text.length <= limit ? text : text.slice(-limit);
}

function suffixPrefixOverlap(previous: string, replay: string): number {
  const prefixLengths = Array<number>(replay.length).fill(0);
  for (let index = 1, matched = 0; index < replay.length;) {
    if (replay[index] === replay[matched]) {
      prefixLengths[index] = matched + 1;
      index += 1;
      matched += 1;
    } else if (matched > 0) {
      matched = prefixLengths[matched - 1] ?? 0;
    } else {
      index += 1;
    }
  }

  const tail = previous.slice(-replay.length);
  let matched = 0;
  for (let index = 0; index < tail.length; index += 1) {
    while (matched > 0 && replay[matched] !== tail[index]) {
      matched = prefixLengths[matched - 1] ?? 0;
    }
    if (replay[matched] === tail[index]) matched += 1;
    if (matched === replay.length && index < tail.length - 1) {
      matched = prefixLengths[matched - 1] ?? 0;
    }
  }
  return matched;
}

function escapeSequenceEnd(input: string, start: number): number {
  if (start + 1 >= input.length) return -1;
  const kind = input[start + 1];
  if (kind === "[") return csiEnd(input, start + 2);
  if (kind === "]") return stringSequenceEnd(input, start + 2, true);
  if (kind === "P" || kind === "^" || kind === "_") return stringSequenceEnd(input, start + 2, false);
  if (kind && "()*+-. /#%".includes(kind)) return start + 2 < input.length ? start + 3 : -1;
  return start + 2;
}

function csiEnd(input: string, start: number): number {
  for (let index = start; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) return index + 1;
  }
  return -1;
}

function stringSequenceEnd(input: string, start: number, acceptsBell: boolean): number {
  for (let index = start; index < input.length; index += 1) {
    if (acceptsBell && input.charCodeAt(index) === 0x07) return index + 1;
    if (input.charCodeAt(index) === 0x9c) return index + 1;
    if (input.charCodeAt(index) === 0x1b) {
      if (index + 1 >= input.length) return -1;
      if (input[index + 1] === "\\") return index + 2;
    }
  }
  return -1;
}
