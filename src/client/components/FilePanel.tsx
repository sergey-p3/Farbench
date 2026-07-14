import type { Workspace } from "../../shared/types.js";
import { FileBrowser, FileEditor } from "./files/FilePanelViews.js";
import { useFileWorkspace } from "./files/useFileWorkspace.js";

interface FilePanelProps {
  workspace: Workspace | null;
  onUnauthorized?: () => void;
}

export function FilePanel({ workspace, onUnauthorized }: FilePanelProps) {
  const files = useFileWorkspace(workspace, onUnauthorized);

  if (!workspace) {
    return <div className="tool-panel empty-tool"><p className="empty-state">Select a workspace to browse files.</p></div>;
  }

  return (
    <div className="tool-panel file-panel">
      <FileBrowser
        currentPath={files.currentPath}
        files={files.files}
        isLoading={files.isLoading}
        onOpenDirectory={(path) => void files.openDirectory(path)}
        onOpenFile={(path) => void files.openFile(path)}
        openableFileCount={files.openableFileCount}
        selectedPath={files.selectedPath}
      />
      <FileEditor
        content={files.content}
        dirty={files.dirty}
        editorHostRef={files.editorHostRef}
        error={files.error}
        isSaving={files.isSaving}
        onContentChange={files.onContentChange}
        onEditorMount={files.onEditorMount}
        onRetry={files.retryAction}
        onSave={() => void files.saveFile()}
        selectedPath={files.selectedPath}
      />
    </div>
  );
}
