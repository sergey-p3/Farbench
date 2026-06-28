import type { Workspace, WorkspaceItem } from "../../shared/types.js";

interface ItemSwitcherProps {
  activeItemId: string | null;
  items: WorkspaceItem[];
  isOpen: boolean;
  selectedWorkspace: Workspace | null;
  workspaces: Workspace[];
  onClose: () => void;
  onCloseItem: (item: WorkspaceItem) => void;
  onFocusItem: (itemId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
}

export function ItemSwitcher({
  activeItemId,
  items,
  isOpen,
  selectedWorkspace,
  workspaces,
  onClose,
  onCloseItem,
  onFocusItem,
  onSelectWorkspace,
}: ItemSwitcherProps) {
  if (!isOpen) return null;

  return (
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="item-drawer" aria-label="Item switcher" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-header">
          <div>
            <p className="eyebrow">Workspace</p>
            <h2>{selectedWorkspace?.name ?? "No workspace selected"}</h2>
          </div>
          <button className="icon-button" aria-label="Close item switcher" onClick={onClose} type="button">×</button>
        </div>

        <div className="workspace-picker" aria-label="Switch workspace">
          {workspaces.map((workspace) => (
            <button
              aria-pressed={workspace.id === selectedWorkspace?.id}
              className={workspace.id === selectedWorkspace?.id ? "workspace-pill active" : "workspace-pill"}
              key={workspace.id}
              onClick={() => onSelectWorkspace(workspace.id)}
              type="button"
            >
              {workspace.name}
            </button>
          ))}
        </div>

        <div className="switcher-list" role="list">
          {items.map((item) => (
            <div
              aria-current={item.id === activeItemId ? "page" : undefined}
              className={item.id === activeItemId ? "switcher-row active" : "switcher-row"}
              key={item.id}
              role="listitem"
            >
              <button className="switcher-target" onClick={() => onFocusItem(item.id)} type="button">
                <span className="item-kind">{labelForKind(item.kind)}</span>
                <span className="item-name">{item.title}</span>
                <span className="item-meta">{detailForItem(item)}</span>
              </button>
              <button
                aria-label={`Close ${item.title}`}
                className="switcher-close icon-button"
                onClick={() => onCloseItem(item)}
                type="button"
              >
                ×
              </button>
            </div>
          ))}
          {items.length === 0 ? <p className="empty-state">No open items in this workspace.</p> : null}
        </div>
      </aside>
    </div>
  );
}

function labelForKind(kind: WorkspaceItem["kind"]): string {
  if (kind === "agent") return "Agent";
  if (kind === "terminal") return "Terminal";
  if (kind === "files") return "Files";
  if (kind === "git") return "Git";
  return "Preview";
}

function detailForItem(item: WorkspaceItem): string {
  if (item.kind === "agent" || item.kind === "terminal") {
    return `${item.config?.runtime ?? "session"} · ${item.status}`;
  }
  if (item.kind === "preview") {
    return `:${item.config?.port ?? 3000}${item.config?.path ?? "/"}`;
  }
  return item.lastActiveAt ? `Last active ${new Date(item.lastActiveAt).toLocaleTimeString()}` : item.status;
}
