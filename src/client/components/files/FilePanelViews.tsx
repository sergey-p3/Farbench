import { Editor, type OnMount } from "@monaco-editor/react";
import type { RefObject } from "react";
import type { FileResource } from "../../../shared/types.js";
import { languageForPath, parentPath } from "./filePanelUtils.js";

export function FileBrowser({
  currentPath,
  files,
  isLoading,
  onOpenDirectory,
  onOpenFile,
  openableFileCount,
  selectedPath,
}: {
  currentPath: string;
  files: FileResource[];
  isLoading: boolean;
  onOpenDirectory: (path: string) => void;
  onOpenFile: (path: string) => void;
  openableFileCount: number;
  selectedPath: string | null;
}) {
  return (
    <aside className="file-list" aria-label="Workspace files">
      <div className="panel-toolbar">
        <strong>{currentPath === "." ? "Files" : currentPath}</strong>
        <span>{openableFileCount}</span>
      </div>
      <div className="file-nav">
        <button disabled={currentPath === "."} onClick={() => onOpenDirectory(".")} type="button">Root</button>
        <button disabled={currentPath === "."} onClick={() => onOpenDirectory(parentPath(currentPath))} type="button">Up</button>
      </div>
      {isLoading && files.length === 0 ? <p className="loading-state compact">Loading files...</p> : null}
      <div className="file-buttons">
        {files.map((file) => (
          <FileButton
            file={file}
            key={file.path}
            onOpenDirectory={onOpenDirectory}
            onOpenFile={onOpenFile}
            selected={file.path === selectedPath}
          />
        ))}
      </div>
      {files.length === 0 && !isLoading ? <p className="empty-state">No files at workspace root.</p> : null}
    </aside>
  );
}

function FileButton({
  file,
  onOpenDirectory,
  onOpenFile,
  selected,
}: {
  file: FileResource;
  onOpenDirectory: (path: string) => void;
  onOpenFile: (path: string) => void;
  selected: boolean;
}) {
  const openable = file.type === "file" && !file.isBinary && !file.tooLarge;
  const label = file.type === "directory"
    ? "directory"
    : file.tooLarge ? "too large" : file.isBinary ? "binary" : `${file.size} bytes`;
  return (
    <button
      className={selected ? "file-button selected" : "file-button"}
      disabled={file.type === "file" && !openable}
      onClick={() => file.type === "directory" ? onOpenDirectory(file.path) : onOpenFile(file.path)}
      title={file.path}
      type="button"
    >
      <span>{file.path}</span>
      <small>{label}</small>
    </button>
  );
}

export function FileEditor({
  content,
  dirty,
  editorHostRef,
  error,
  isSaving,
  onContentChange,
  onEditorMount,
  onRetry,
  onSave,
  selectedPath,
}: {
  content: string;
  dirty: boolean;
  editorHostRef: RefObject<HTMLDivElement | null>;
  error: string | null;
  isSaving: boolean;
  onContentChange: (value: string) => void;
  onEditorMount: OnMount;
  onRetry: (() => void) | null;
  onSave: () => void;
  selectedPath: string | null;
}) {
  return (
    <section className="editor-panel" aria-label="File editor">
      <div className="panel-toolbar">
        <strong>{selectedPath ?? "No file selected"}</strong>
        <button disabled={!dirty || isSaving} onClick={onSave} type="button">{isSaving ? "Saving" : "Save"}</button>
      </div>
      {error ? (
        <div className="panel-error" role="alert">
          <span>{error}</span>
          {onRetry ? <button onClick={onRetry} type="button">Retry</button> : null}
        </div>
      ) : null}
      <div className="editor-host" ref={editorHostRef}>
        {selectedPath ? (
          <Editor
            defaultLanguage={languageForPath(selectedPath)}
            onChange={(value) => onContentChange(value ?? "")}
            onMount={onEditorMount}
            options={{ automaticLayout: true, fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false }}
            path={selectedPath}
            theme="vs-dark"
            value={content}
          />
        ) : <p className="empty-state centered">Choose a file to edit.</p>}
      </div>
    </section>
  );
}
