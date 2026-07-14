import type { FormEvent, RefObject } from "react";

export type AgentInputComposerMode = "closed" | "minimized" | "open";

export function AgentInputComposer({
  draft,
  mode,
  onCancel,
  onChange,
  onMinimize,
  onRestore,
  onSubmit,
  textareaRef,
}: {
  draft: string;
  mode: AgentInputComposerMode;
  onCancel: () => void;
  onChange: (text: string) => void;
  onMinimize: () => void;
  onRestore: () => void;
  onSubmit: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  if (mode === "closed") return null;

  if (mode === "minimized") {
    return (
      <div aria-label="Minimized agent input" className="agent-input-minimized" role="group">
        <button
          aria-label="Restore agent input"
          className="agent-input-minimized-restore"
          onClick={onRestore}
          type="button"
        >
          <span aria-hidden="true">✎</span>
          <span>Agent input saved</span>
        </button>
        <button aria-label="Cancel agent input" onClick={onCancel} title="Cancel" type="button">×</button>
      </div>
    );
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <div className="agent-input-backdrop">
      <section
        aria-label="Compose agent input"
        aria-modal="true"
        className="agent-input-dialog"
        role="dialog"
      >
        <header className="agent-input-header">
          <div>
            <strong>Compose agent input</strong>
            <small>Draft saves automatically</small>
          </div>
          <div className="agent-input-window-actions">
            <button aria-label="Minimize agent input" onClick={onMinimize} title="Minimize" type="button">−</button>
            <button aria-label="Cancel agent input" onClick={onCancel} title="Cancel" type="button">×</button>
          </div>
        </header>
        <form className="agent-input-form" onSubmit={submit}>
          <textarea
            aria-label="Agent input"
            autoCapitalize="sentences"
            autoComplete="off"
            autoCorrect="on"
            onChange={(event) => onChange(event.currentTarget.value)}
            placeholder="Type or paste a message…"
            ref={textareaRef}
            spellCheck={true}
            value={draft}
          />
          <button
            aria-label="Send agent input"
            className="agent-input-send"
            disabled={!draft}
            title="Send"
            type="submit"
          >
            <span aria-hidden="true">➤</span>
          </button>
        </form>
      </section>
    </div>
  );
}
