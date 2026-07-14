import type { Workspace } from "../../shared/types.js";
import { CommitDetails, GitBranchesView, GitFilesView, GitHistoryView, GitNavigation } from "./git/GitPanelViews.js";
import { useGitRepository } from "./git/useGitRepository.js";

interface GitPanelProps {
  workspace: Workspace | null;
  onUnauthorized?: () => void;
}

export function GitPanel({ workspace, onUnauthorized }: GitPanelProps) {
  const git = useGitRepository(workspace, onUnauthorized);

  if (!workspace) {
    return <div className="tool-panel empty-tool"><p className="empty-state">Select a workspace to inspect Git.</p></div>;
  }

  return (
    <div className="tool-panel git-workbench">
      <GitNavigation
        activeView={git.activeView}
        currentBranch={git.currentBranch}
        isLoading={git.isLoading}
        onRefresh={() => void git.refreshCurrentView()}
        onSelect={git.setActiveView}
      />
      {git.error ? <p className="panel-error git-panel-error" role="alert">{git.error}</p> : null}
      {git.activeView === "files" ? (
        <GitFilesView
          busyPath={git.busyPath}
          changeGroups={git.changeGroups}
          changes={git.changes}
          diff={git.diff}
          diffViewerRef={git.diffViewerRef}
          initialChangeDirection={git.initialChangeDirection}
          isLoading={git.isLoading}
          isLoadingDiff={git.isLoadingDiff}
          onBack={git.clearSelection}
          onInitialChangeShown={() => git.setInitialChangeDirection(null)}
          onLoadDiff={(change) => void git.loadDiff(change)}
          onLoadFile={git.loadAdjacentFile}
          onSetStaged={(change) => void git.setFileStaged(change)}
          onShowChange={git.showAdjacentChange}
          onShowWorkingTree={() => void git.showWorkingChanges()}
          selectedChange={git.selectedChange}
          selectedCommit={git.selectedCommit}
          selectedPath={git.selectedPath}
        />
      ) : null}
      {git.activeView === "history" ? (
        <GitHistoryView
          commits={git.commits}
          isLoading={git.isLoading}
          onSelectCommit={(commit) => void git.selectHistoryCommit(commit)}
          onShowDetails={git.setDetailCommit}
        />
      ) : null}
      {git.activeView === "branches" ? (
        <GitBranchesView
          baseBranch={git.baseBranch}
          branches={git.branches}
          isLoading={git.isLoading}
          onSwitchBranch={(branch) => void git.switchBranch(branch)}
          switchingBranch={git.switchingBranch}
        />
      ) : null}
      {git.detailCommit ? <CommitDetails commit={git.detailCommit} onClose={() => git.setDetailCommit(null)} /> : null}
    </div>
  );
}
