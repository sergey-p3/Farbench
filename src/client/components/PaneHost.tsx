import type { BrowserLayout, Workspace, WorkspaceItem } from "../../shared/types.js";
import { activeItem } from "../itemLayout.js";
import { ItemRenderer } from "./ItemRenderer.js";

interface PaneHostProps {
  layout: BrowserLayout;
  workspace: Workspace | null;
  onOpenCreateSheet: () => void;
  onUnauthorized: () => void;
}

export function PaneHost({ layout, workspace, onOpenCreateSheet, onUnauthorized }: PaneHostProps) {
  const item: WorkspaceItem | null = activeItem(layout);
  const matchedItem = item?.workspaceId === workspace?.id ? item : null;

  return (
    <section className="pane-host" aria-label="Focused item">
      <ItemRenderer
        item={matchedItem}
        key={matchedItem?.id ?? "empty"}
        workspace={workspace}
        onOpenCreateSheet={onOpenCreateSheet}
        onUnauthorized={onUnauthorized}
      />
    </section>
  );
}
