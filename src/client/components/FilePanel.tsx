import { Editor } from "@monaco-editor/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FileResource, Workspace } from "../../shared/types.js";
import { ApiError, api, isUnauthorized } from "../api.js";

interface FilePanelProps {
  workspace: Workspace | null;
}

export function FilePanel({ workspace }: FilePanelProps) {
  const workspaceIdRef = useRef<string | null>(workspace?.id ?? null);
  const selectedPathRef = useRef<string | null>(null);
  const currentPathRef = useRef(".");
  const filesRequestRef = useRef(0);
  const openRequestRef = useRef(0);
  const saveRequestRef = useRef(0);
  const [files, setFiles] = useState<FileResource[]>([]);
  const [currentPath, setCurrentPath] = useState(".");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [expectedVersion, setExpectedVersion] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = selectedPath !== null && content !== savedContent;
  const openableFiles = useMemo(
    () => files.filter((file) => file.type === "file" && !file.isBinary && !file.tooLarge),
    [files],
  );

  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  useEffect(() => {
    workspaceIdRef.current = workspace?.id ?? null;
    filesRequestRef.current += 1;
    openRequestRef.current += 1;
    saveRequestRef.current += 1;
    setFiles([]);
    setCurrentPath(".");
    currentPathRef.current = ".";
    setSelectedPath(null);
    selectedPathRef.current = null;
    setContent("");
    setSavedContent("");
    setExpectedVersion(null);
    setIsLoading(false);
    setIsSaving(false);
    setError(null);

    if (!workspace) return;
    void loadFiles(workspace.id, ".", filesRequestRef.current);
  }, [workspace?.id]);

  async function loadFiles(workspaceId: string, path: string, requestId: number) {
    setIsLoading(true);
    setError(null);
    try {
      const nextFiles = await api.files(workspaceId, path);
      if (!isCurrentFilesRequest(workspaceId, path, requestId)) return;
      setFiles(nextFiles);
      setCurrentPath(path);
      currentPathRef.current = path;
    } catch (loadError) {
      if (!isCurrentFilesRequest(workspaceId, path, requestId)) return;
      setError(panelError(loadError, "Unable to load files"));
    } finally {
      if (isCurrentFilesRequest(workspaceId, path, requestId)) setIsLoading(false);
    }
  }

  async function openDirectory(path: string) {
    if (!workspace) return;
    const requestId = ++filesRequestRef.current;
    currentPathRef.current = path;
    await loadFiles(workspace.id, path, requestId);
  }

  async function openFile(path: string) {
    if (!workspace) return;
    const workspaceId = workspace.id;
    const requestId = ++openRequestRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.readFile(workspaceId, path);
      if (!isCurrentOpenRequest(workspaceId, path, requestId)) return;
      setSelectedPath(path);
      selectedPathRef.current = path;
      setContent(response.content);
      setSavedContent(response.content);
      setExpectedVersion(response.version);
    } catch (openError) {
      if (!isCurrentOpenRequest(workspaceId, path, requestId)) return;
      setError(panelError(openError, "Unable to open file"));
    } finally {
      if (isCurrentOpenRequest(workspaceId, path, requestId)) setIsLoading(false);
    }
  }

  async function saveFile() {
    if (!workspace || !selectedPath || !expectedVersion || !dirty) return;
    const workspaceId = workspace.id;
    const path = selectedPath;
    const requestId = ++saveRequestRef.current;
    setIsSaving(true);
    setError(null);
    try {
      const response = await api.saveFile(workspaceId, path, content, expectedVersion);
      if (!isCurrentSaveRequest(workspaceId, path, requestId)) return;
      setContent(response.content);
      setSavedContent(response.content);
      setExpectedVersion(response.version);
    } catch (saveError) {
      if (!isCurrentSaveRequest(workspaceId, path, requestId)) return;
      setError(isConflict(saveError) ? "File changed on disk. Reload before saving." : panelError(saveError, "Unable to save file"));
    } finally {
      if (isCurrentSaveRequest(workspaceId, path, requestId)) setIsSaving(false);
    }
  }

  function isCurrentFilesRequest(workspaceId: string, path: string, requestId: number): boolean {
    return workspaceIdRef.current === workspaceId && currentPathRef.current === path && filesRequestRef.current === requestId;
  }

  function isCurrentOpenRequest(workspaceId: string, path: string, requestId: number): boolean {
    return workspaceIdRef.current === workspaceId && openRequestRef.current === requestId && path !== "";
  }

  function isCurrentSaveRequest(workspaceId: string, path: string, requestId: number): boolean {
    return workspaceIdRef.current === workspaceId && selectedPathRef.current === path && saveRequestRef.current === requestId;
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
          <strong>{currentPath === "." ? "Files" : currentPath}</strong>
          <span>{openableFiles.length}</span>
        </div>
        <div className="file-nav">
          <button disabled={currentPath === "."} onClick={() => void openDirectory(".")} type="button">
            Root
          </button>
          <button disabled={currentPath === "."} onClick={() => void openDirectory(parentPath(currentPath))} type="button">
            Up
          </button>
        </div>
        {isLoading && files.length === 0 ? <p className="loading-state compact">Loading files...</p> : null}
        <div className="file-buttons">
          {files.map((file) => {
            const openable = file.type === "file" && !file.isBinary && !file.tooLarge;
            const label = file.type === "directory" ? "directory" : file.tooLarge ? "too large" : file.isBinary ? "binary" : `${file.size} bytes`;
            return (
              <button
                className={file.path === selectedPath ? "file-button selected" : "file-button"}
                disabled={file.type === "file" && !openable}
                key={file.path}
                onClick={() => file.type === "directory" ? void openDirectory(file.path) : void openFile(file.path)}
                title={file.path}
                type="button"
              >
                <span>{file.path}</span>
                <small>{label}</small>
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

function parentPath(path: string): string {
  if (path === "." || !path.includes("/")) return ".";
  return path.slice(0, path.lastIndexOf("/"));
}

function panelError(error: unknown, fallback: string): string {
  if (isUnauthorized(error)) return "Session expired. Sign in again.";
  return error instanceof Error ? error.message : fallback;
}
