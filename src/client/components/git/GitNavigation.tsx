import type { GitView } from "./gitPanelTypes.js";

export function GitNavigation({
  activeView,
  currentBranch,
  isLoading,
  onRefresh,
  onSelect,
}: {
  activeView: GitView;
  currentBranch: string;
  isLoading: boolean;
  onRefresh: () => void;
  onSelect: (view: GitView) => void;
}) {
  return (
    <nav aria-label="Git views" className="git-view-tabs" role="tablist">
      <GitTab activeView={activeView} label="Files" view="files" onSelect={onSelect} />
      <GitTab activeView={activeView} label="History" view="history" onSelect={onSelect} />
      <GitTab activeView={activeView} label="Branches" view="branches" onSelect={onSelect} />
      <span className="git-current-branch" title={currentBranch}>{currentBranch || "Detached HEAD"}</span>
      <button className="git-refresh-button" disabled={isLoading} onClick={onRefresh} type="button">Refresh</button>
    </nav>
  );
}

function GitTab({ activeView, label, onSelect, view }: {
  activeView: GitView;
  label: string;
  onSelect: (view: GitView) => void;
  view: GitView;
}) {
  return (
    <button
      aria-selected={activeView === view}
      className={activeView === view ? "active" : ""}
      onClick={() => onSelect(view)}
      role="tab"
      type="button"
    >
      {label}
    </button>
  );
}
