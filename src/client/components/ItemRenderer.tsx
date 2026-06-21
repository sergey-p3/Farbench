import type { Workspace, WorkspaceItem } from "../../shared/types.js";
import { FilePanel } from "./FilePanel.js";
import { GitPanel } from "./GitPanel.js";
import { PreviewPanel } from "./PreviewPanel.js";
import { TerminalPane } from "./TerminalPane.js";

interface ItemRendererProps {
  item: WorkspaceItem | null;
  workspace: Workspace | null;
  onOpenCreateSheet: () => void;
  onUnauthorized: () => void;
}

export function ItemRenderer({ item, workspace, onOpenCreateSheet, onUnauthorized }: ItemRendererProps) {
  if (!item) {
    return (
      <section className="focused-empty" aria-label="No active item">
        <h2>No item open</h2>
        <p>Open a workspace item to start working.</p>
        <button onClick={onOpenCreateSheet} type="button">Open item</button>
      </section>
    );
  }

  if ((item.kind === "terminal" || item.kind === "agent") && !item.sessionId) {
    return (
      <section className="tool-panel empty-tool" aria-label="Session unavailable">
        <p className="empty-state">{item.title} is no longer available. Create a new session from the add menu.</p>
        <button onClick={onOpenCreateSheet} type="button">Create new</button>
      </section>
    );
  }

  if (item.kind === "terminal" || item.kind === "agent") {
    return <TerminalPane sessionId={item.sessionId ?? null} onOpenCreateSheet={onOpenCreateSheet} onUnauthorized={onUnauthorized} />;
  }

  if (item.kind === "files") {
    return <FilePanel workspace={workspace} onUnauthorized={onUnauthorized} />;
  }

  if (item.kind === "git") {
    return <GitPanel workspace={workspace} onUnauthorized={onUnauthorized} />;
  }

  return (
    <PreviewPanel
      initialPath={item.config?.path ?? "/"}
      initialPort={item.config?.port ?? 3000}
      onUnauthorized={onUnauthorized}
      workspace={workspace}
    />
  );
}
