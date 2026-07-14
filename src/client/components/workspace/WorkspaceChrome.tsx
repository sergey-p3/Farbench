import type { Workspace, WorkspaceItem } from "../../../shared/types.js";

export function WorkspaceTopBar({
  active,
  isExpanded,
  isPinned,
  onCreate,
  onOpenSwitcher,
  onToggle,
  onTogglePin,
  workspace,
}: {
  active: WorkspaceItem | null;
  isExpanded: boolean;
  isPinned: boolean;
  onCreate: () => void;
  onOpenSwitcher: () => void;
  onToggle: () => void;
  onTogglePin: () => void;
  workspace: Workspace | null;
}) {
  return (
    <header className={`top-bar shell-top-bar ${isExpanded ? "top-menu-expanded" : "top-menu-collapsed"}`}>
      {isExpanded ? (
        <>
          <button className="icon-button" aria-label="Open item switcher" onClick={onOpenSwitcher} type="button">⇄</button>
          <div className="top-bar-title">
            <p className="eyebrow">{workspace?.name ?? "Workspace"}</p>
            <h1>{active?.title ?? "No item open"}</h1>
          </div>
          <span className="session-chip">{active ? `${active.kind} · ${active.status}` : "Empty"}</span>
          <button className="icon-button" aria-label={isPinned ? "Unpin top menu" : "Pin top menu"} onClick={onTogglePin} type="button">⌖</button>
          <button className="icon-button primary-icon" aria-label="Create item" onClick={onCreate} type="button">+</button>
        </>
      ) : null}
      <button
        className="icon-button top-menu-toggle"
        aria-expanded={isExpanded}
        aria-label={isExpanded ? "Hide top menu" : "Show top menu"}
        onClick={onToggle}
        type="button"
      >☰</button>
    </header>
  );
}

export function ShortcutRail({
  activeItemId,
  isOpen,
  items,
  onFocusItem,
  onToggle,
}: {
  activeItemId: string | null;
  isOpen: boolean;
  items: WorkspaceItem[];
  onFocusItem: (itemId: string) => void;
  onToggle: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <nav className={`tab-shortcut-rail ${isOpen ? "" : "collapsed"}`} aria-label="Open item shortcuts">
      <button
        aria-controls="tab-shortcut-list"
        aria-expanded={isOpen}
        aria-label={isOpen ? "Hide shortcut tabs" : "Show shortcut tabs"}
        className="tab-shortcut-rail-toggle"
        onClick={onToggle}
        title={isOpen ? "Hide shortcut tabs" : "Show shortcut tabs"}
        type="button"
      >{isOpen ? "›" : "‹"}</button>
      {isOpen ? (
        <div className="tab-shortcut-list" id="tab-shortcut-list">
          {items.map((item) => {
            const active = item.id === activeItemId;
            return (
              <button
                aria-current={active ? "page" : undefined}
                aria-label={`Switch to ${item.title}`}
                aria-pressed={active}
                className={`tab-shortcut-button ${active ? "active" : ""}`}
                key={item.id}
                onClick={() => onFocusItem(item.id)}
                title={item.title}
                type="button"
              >{shortcutLabel(item)}</button>
            );
          })}
        </div>
      ) : null}
    </nav>
  );
}

function shortcutLabel(item: WorkspaceItem): string {
  if (item.kind === "terminal") return "T";
  if (item.kind === "agent") return item.config?.runtime?.slice(0, 1).toUpperCase() ?? "A";
  if (item.kind === "files") return "F";
  if (item.kind === "git") return "G";
  if (item.kind === "preview") return "P";
  return item.title.slice(0, 1).toUpperCase();
}
