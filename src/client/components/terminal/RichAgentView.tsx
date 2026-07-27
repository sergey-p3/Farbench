import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import type { RichAgentOutputMode } from "../../agentViewPreferences.js";
import { normalizeRichAgentTyping, richAgentKeyInput, type RichAgentInputMode } from "../../richAgentInput.js";
import type { RichTerminalOutput } from "../../richTerminalOutput.js";

const SEND_LONG_PRESS_MS = 600;

export function RichAgentView({
  draft,
  inputMode,
  inputRef,
  logText,
  onChangeDraft,
  onOutputModeChange,
  onSendImmediate,
  onSendMessage,
  onToggleInputMode,
  output,
  outputMode,
}: {
  draft: string;
  inputMode: RichAgentInputMode;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  logText: string;
  onChangeDraft: (text: string) => void;
  onOutputModeChange: (mode: RichAgentOutputMode) => void;
  onSendImmediate: (data: string) => void;
  onSendMessage: () => void;
  onToggleInputMode: () => void;
  output: RichTerminalOutput;
  outputMode: RichAgentOutputMode;
}) {
  const outputRef = useRef<HTMLDivElement | null>(null);
  const preservedScrollTopRef = useRef(0);
  const followedScrollTopRef = useRef(0);
  const manualScrollIntentRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const suppressSendRef = useRef(false);
  const [isFollowingOutput, setIsFollowingOutput] = useState(true);

  useLayoutEffect(() => {
    const element = outputRef.current;
    if (!element) return;
    element.scrollTop = isFollowingOutput ? element.scrollHeight : preservedScrollTopRef.current;
    preservedScrollTopRef.current = element.scrollTop;
    if (isFollowingOutput) followedScrollTopRef.current = element.scrollTop;
  }, [isFollowingOutput, logText, output, outputMode]);

  useEffect(() => () => clearLongPress(), []);

  const clearLongPress = () => {
    if (longPressTimerRef.current === null) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const beginLongPress = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    clearLongPress();
    suppressSendRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      suppressSendRef.current = true;
      onToggleInputMode();
    }, SEND_LONG_PRESS_MS);
  };

  const handleSendClick = () => {
    clearLongPress();
    if (suppressSendRef.current) {
      suppressSendRef.current = false;
      return;
    }
    if (inputMode === "message") onSendMessage();
  };

  const handleImmediateKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    const data = richAgentKeyInput(event);
    if (data === null) return;
    event.preventDefault();
    onSendImmediate(data);
  };

  const handleImmediateInput = (event: FormEvent<HTMLTextAreaElement>) => {
    if ((event.nativeEvent as InputEvent).isComposing) return;
    const text = event.currentTarget.value;
    if (text) onSendImmediate(normalizeRichAgentTyping(text));
    event.currentTarget.value = "";
  };

  const handleMessageKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    onSendMessage();
  };

  const stopFollowingOutput = () => {
    const element = outputRef.current;
    if (element) preservedScrollTopRef.current = element.scrollTop;
    manualScrollIntentRef.current = false;
    setIsFollowingOutput(false);
  };

  const beginManualOutputInteraction = () => {
    manualScrollIntentRef.current = true;
    if (isFollowingOutput) setIsFollowingOutput(false);
  };

  const followOutput = () => {
    const element = outputRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
      preservedScrollTopRef.current = element.scrollTop;
      followedScrollTopRef.current = element.scrollTop;
    }
    manualScrollIntentRef.current = false;
    setIsFollowingOutput(true);
  };

  const toggleFollowingOutput = () => {
    if (isFollowingOutput) stopFollowingOutput();
    else followOutput();
  };

  return (
    <section className="rich-agent-view" aria-label="Rich text agent view">
      <header className="rich-agent-output-toolbar">
        <strong>Agent output</strong>
        <div aria-label="Agent output mode" className="rich-agent-output-modes" role="group">
          <button
            aria-pressed={outputMode === "screen"}
            onClick={() => onOutputModeChange("screen")}
            type="button"
          >Screen</button>
          <button
            aria-pressed={outputMode === "log"}
            onClick={() => onOutputModeChange("log")}
            type="button"
          >Log</button>
        </div>
      </header>
      <div className="rich-agent-output-frame">
        <div
          aria-label="Agent output"
          aria-live="polite"
          className="rich-agent-output"
          onKeyDown={(event) => {
            if (["ArrowDown", "ArrowUp", "End", "Home", "PageDown", "PageUp", " "].includes(event.key)) {
              beginManualOutputInteraction();
            }
          }}
          onPointerDown={beginManualOutputInteraction}
          onScroll={(event) => {
            const element = event.currentTarget;
            const scrollTop = element.scrollTop;
            preservedScrollTopRef.current = scrollTop;
            if (isFollowingOutput && Math.abs(scrollTop - followedScrollTopRef.current) > 1) {
              setIsFollowingOutput(false);
            } else if (
              !isFollowingOutput &&
              manualScrollIntentRef.current &&
              element.scrollHeight - element.clientHeight - scrollTop <= 1
            ) {
              manualScrollIntentRef.current = false;
              followedScrollTopRef.current = scrollTop;
              setIsFollowingOutput(true);
            }
          }}
          onTouchMove={beginManualOutputInteraction}
          onWheel={beginManualOutputInteraction}
          ref={outputRef}
          role="log"
          tabIndex={0}
        >
          {outputMode === "log" ? (
            logText
              ? <div className="rich-agent-log-text">{logText}</div>
              : <p className="rich-agent-output-empty">Waiting for agent log output…</p>
          ) : output.length ? output.map((line, lineIndex) => (
              <div className="rich-agent-output-line" key={lineIndex}>
                {line.chunks.length ? line.chunks.map((chunk, chunkIndex) => (
                  <span key={chunkIndex} style={chunk.style}>{chunk.text}</span>
                )) : <br />}
              </div>
            )) : <p className="rich-agent-output-empty">Waiting for agent output…</p>}
        </div>
        <button
          aria-label={isFollowingOutput ? "Stop following output" : "Follow output"}
          aria-pressed={isFollowingOutput}
          className={`rich-agent-follow-output ${isFollowingOutput ? "active" : ""}`}
          onClick={toggleFollowingOutput}
          type="button"
        >
          <span aria-hidden="true">{isFollowingOutput ? "Ⅱ" : "↓"}</span>
          {isFollowingOutput ? "Following output" : "Follow output"}
        </button>
      </div>
      <div className="rich-agent-input-panel">
        <div className="rich-agent-input-heading">
          <div>
            <span>{inputMode === "message" ? "Message" : "Keystroke"} input</span>
            <small>{inputMode === "message" ? "Send submits the whole message" : "Each key is sent immediately"}</small>
          </div>
          <button
            aria-label={inputMode === "message" ? "Switch to keystroke input" : "Switch to message input"}
            className="rich-agent-input-mode-toggle"
            onClick={onToggleInputMode}
            type="button"
          >{inputMode === "message" ? "Keystroke" : "Message"}</button>
        </div>
        <div className="rich-agent-input-row">
          <textarea
            aria-label={inputMode === "message" ? "Agent message" : "Agent keystroke input"}
            autoCapitalize={inputMode === "message" ? "sentences" : "none"}
            autoComplete="off"
            autoCorrect={inputMode === "message" ? "on" : "off"}
            onChange={inputMode === "message" ? (event) => onChangeDraft(event.currentTarget.value) : undefined}
            onInput={inputMode === "keystroke" ? handleImmediateInput : undefined}
            onKeyDown={inputMode === "keystroke" ? handleImmediateKeyDown : handleMessageKeyDown}
            placeholder={inputMode === "message" ? "Type or paste a message…" : "Type to send keys…"}
            ref={inputRef}
            rows={inputMode === "message" ? 3 : 1}
            spellCheck={inputMode === "message"}
            value={inputMode === "message" ? draft : ""}
          />
          <button
            aria-disabled={inputMode === "message" && !draft}
            aria-label="Send agent message"
            aria-pressed={inputMode === "keystroke"}
            className="rich-agent-send"
            onClick={handleSendClick}
            onContextMenu={(event) => event.preventDefault()}
            onPointerCancel={clearLongPress}
            onPointerDown={beginLongPress}
            onPointerLeave={clearLongPress}
            onPointerUp={clearLongPress}
            title="Send. Long press to switch input mode."
            type="button"
          >
            <span aria-hidden="true">{inputMode === "message" ? "➤" : "⌨"}</span>
          </button>
        </div>
        <small className="rich-agent-input-hint">
          {inputMode === "message" ? "Ctrl/Command + Enter also sends." : "Long press the keyboard button to return to message mode."}
        </small>
      </div>
    </section>
  );
}
