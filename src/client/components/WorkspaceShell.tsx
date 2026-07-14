import { CreateItemSheet } from "./CreateItemSheet.js";
import { ItemSwitcher } from "./ItemSwitcher.js";
import { PaneHost } from "./PaneHost.js";
import { ShortcutRail, WorkspaceTopBar } from "./workspace/WorkspaceChrome.js";
import { useWorkspaceShell } from "./workspace/useWorkspaceShell.js";

interface WorkspaceShellProps {
  onUnauthorized: () => void;
}

export function WorkspaceShell({ onUnauthorized }: WorkspaceShellProps) {
  const shell = useWorkspaceShell(onUnauthorized);

  return (
    <main className="app-shell item-shell">
      <section className={`workspace-panel focused-shell ${shell.isTopMenuPinned ? "top-menu-pinned" : "top-menu-floating"}`} aria-label="Workspace">
        <WorkspaceTopBar
          active={shell.active}
          isExpanded={shell.isTopMenuExpanded}
          isPinned={shell.isTopMenuPinned}
          onCreate={() => shell.setIsCreateOpen(true)}
          onOpenAgentInput={shell.openAgentComposer}
          onOpenSwitcher={() => shell.setIsSwitcherOpen(true)}
          onToggle={shell.toggleTopMenu}
          onTogglePin={shell.toggleTopMenuPin}
          workspace={shell.selectedWorkspace}
        />
        {shell.error ? (
          <div className="shell-error" role="alert">
            <span>{shell.error}</span>
            <button onClick={() => void shell.loadWorkspaces()} type="button">Retry</button>
          </div>
        ) : null}
        {shell.isLoading ? <p className="loading-state">Loading workspace...</p> : null}
        <PaneHost
          agentComposerSessionId={shell.agentComposerSessionId}
          layout={shell.layout}
          onCloseAgentComposer={shell.closeAgentComposer}
          workspace={shell.selectedWorkspace}
          onOpenCreateSheet={() => shell.setIsCreateOpen(true)}
          onUnauthorized={onUnauthorized}
        />
        <ShortcutRail
          activeItemId={shell.active?.id ?? null}
          isOpen={shell.isShortcutRailOpen}
          items={shell.visibleItems}
          onFocusItem={shell.focusExistingItem}
          onToggle={() => shell.setIsShortcutRailOpen((current) => !current)}
        />
      </section>
      <ItemSwitcher
        activeItemId={shell.active?.id ?? null}
        isOpen={shell.isSwitcherOpen}
        items={shell.visibleItems}
        onClose={() => shell.setIsSwitcherOpen(false)}
        onCloseItem={(item) => void shell.closeItem(item)}
        onFocusItem={shell.focusExistingItem}
        onSelectWorkspace={(workspaceId) => void shell.selectWorkspace(workspaceId)}
        selectedWorkspace={shell.selectedWorkspace}
        workspaces={shell.workspaces}
      />
      <CreateItemSheet
        isOpen={shell.isCreateOpen}
        items={shell.visibleItems}
        onClose={() => shell.setIsCreateOpen(false)}
        onCreateBrowserItem={shell.createBrowserItem}
        onCreateSession={shell.createSession}
        onFocusItem={shell.focusExistingItem}
        workspaceId={shell.layout.selectedWorkspaceId}
      />
    </main>
  );
}
