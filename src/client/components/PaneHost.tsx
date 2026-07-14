import type { BrowserLayout, Workspace, WorkspaceItem } from "../../shared/types.js";
import { activeItem } from "../itemLayout.js";
import { ItemRenderer } from "./ItemRenderer.js";

interface PaneHostProps {
  agentComposerSessionId: string | null;
  layout: BrowserLayout;
  onCloseAgentComposer: (sessionId: string) => void;
  workspace: Workspace | null;
  onOpenCreateSheet: () => void;
  onUnauthorized: () => void;
}

export function PaneHost({
  agentComposerSessionId,
  layout,
  onCloseAgentComposer,
  workspace,
  onOpenCreateSheet,
  onUnauthorized,
}: PaneHostProps) {
  const item: WorkspaceItem | null = activeItem(layout);
  const matchedItem = item?.workspaceId === workspace?.id ? item : null;

  return (
    <section className="pane-host" aria-label="Focused item">
      <ItemRenderer
        isAgentComposerRequested={matchedItem?.sessionId === agentComposerSessionId}
        item={matchedItem}
        key={matchedItem?.id ?? "empty"}
        workspace={workspace}
        onOpenCreateSheet={onOpenCreateSheet}
        onCloseAgentComposer={onCloseAgentComposer}
        onUnauthorized={onUnauthorized}
      />
    </section>
  );
}
