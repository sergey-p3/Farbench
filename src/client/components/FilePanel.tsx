import { Editor } from "@monaco-editor/react";
import { useEffect, useMemo, useState } from "react";
import type { FileResource, Workspace } from "../../shared/types.js";
import { ApiError, api, isUnauthorized } from "../api.js";

interface FilePanelProps {
  workspace: Workspace | null;
}

export function FilePanel({ workspace }: FilePanelProps) {
  const [files, setFiles] = useState<FileResource[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [expectedVersion, setExpectedVersion] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = selectedPath !== null && content !== savedContent;
  const openableFiles = useMemo(() => files.filter((file) => file.type === "file" && !file.isBinary), [files]);

  useEffect(() => {
    setFiles([]);
    setSelectedPath(null);
    setContent("");
    setSavedContent("");
    setExpectedVersion(null);
    setError(null);

    if (!workspace) return;
    void loadFiles(workspace.id);
  }, [workspace?.id]);

  async function loadFiles(workspaceId: string) {
    setIsLoading(true);
    setError(null);
    try {
      setFiles(await api.files(workspaceId));
    } catch (loadError) {
      setError(panelError(loadError, "Unable to load files"));
    } finally {
      setIsLoading(false);
    }
  }

  async function openFile(path: string) {
    if (!workspace) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.readFile(workspace.id, path);
      setSelectedPath(path);
      setContent(response.content);
      setSavedContent(response.content);
      setExpectedVersion(response.version);
    } catch (openError) {
      setError(panelError(openError, "Unable to open file"));
    } finally {
      setIsLoading(false);
    }
  }

  async function saveFile() {
    if (!workspace || !selectedPath || !expectedVersion || !dirty) return;
    setIsSaving(true);
    setError(null);
    try {
      const response = await api.saveFile(workspace.id, selectedPath, content, expectedVersion);
      setContent(response.content);
      setSavedContent(response.content);
      setExpectedVersion(response.version);
    } catch (saveError) {
      setError(isConflict(saveError) ? "File changed on disk. Reload before saving." : panelError(saveError, "Unable to save file"));
    } finally {
      setIsSaving(false);
    }
  }

  if (!workspace) {
    return (
      <div className="tool-panel empty-tool">
        <p className="empty-state">Select a workspace to browse files.</p>
      </div>
    );
  }

  return (
    <div className="tool-panel file-panel">
      <aside className="file-list" aria-label="Workspace files">
        <div className="panel-toolbar">
          <strong>Files</strong>
          <span>{openableFiles.length}</span>
        </div>
        {isLoading && files.length === 0 ? <p className="loading-state compact">Loading files...</p> : null}
        <div className="file-buttons">
          {files.map((file) => {
            const openable = file.type === "file" && !file.isBinary;
            return (
              <button
                className={file.path === selectedPath ? "file-button selected" : "file-button"}
                disabled={!openable}
                key={file.path}
                onClick={() => void openFile(file.path)}
                title={file.path}
                type="button"
              >
                <span>{file.path}</span>
                <small>{file.type === "directory" ? "directory" : file.isBinary ? "binary" : `${file.size} bytes`}</small>
              </button>
            );
          })}
        </div>
        {files.length === 0 && !isLoading ? <p className="empty-state">No files at workspace root.</p> : null}
      </aside>

      <section className="editor-panel" aria-label="File editor">
        <div className="panel-toolbar">
          <strong>{selectedPath ?? "No file selected"}</strong>
          <button disabled={!dirty || isSaving} onClick={() => void saveFile()} type="button">
            {isSaving ? "Saving" : "Save"}
          </button>
        </div>
        {error ? <p className="panel-error" role="alert">{error}</p> : null}
        <div className="editor-host">
          {selectedPath ? (
            <Editor
              defaultLanguage={languageForPath(selectedPath)}
              onChange={(value: string | undefined) => setContent(value ?? "")}
              options={{
                automaticLayout: true,
                fontSize: 13,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
              }}
              path={selectedPath}
              theme="vs-dark"
              value={content}
            />
          ) : (
            <p className="empty-state centered">Choose a file to edit.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function languageForPath(path: string): string {
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js") || path.endsWith(".jsx")) return "javascript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".html")) return "html";
  return "plaintext";
}

function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

function panelError(error: unknown, fallback: string): string {
  if (isUnauthorized(error)) return "Session expired. Sign in again.";
  return error instanceof Error ? error.message : fallback;
}
