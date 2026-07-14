import { useEffect, useMemo, useRef, useState } from "react";
import type { OnMount } from "@monaco-editor/react";
import type { FileResource, Workspace } from "../../../shared/types.js";
import { api } from "../../api.js";
import { apiErrorMessage } from "../apiError.js";
import { isFileConflict } from "./filePanelUtils.js";
import { useEditorTouchScroll } from "./useEditorTouchScroll.js";

type MonacoEditor = Parameters<OnMount>[0];

export function useFileWorkspace(workspace: Workspace | null, onUnauthorized?: () => void) {
  const editorRef = useRef<MonacoEditor | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
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
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);

  const dirty = selectedPath !== null && content !== savedContent;
  const openableFileCount = useMemo(
    () => files.filter((file) => file.type === "file" && !file.isBinary && !file.tooLarge).length,
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
    setRetryAction(null);
    editorRef.current = null;

    if (workspace) void loadFiles(workspace.id, ".", filesRequestRef.current);
  }, [workspace?.id]);

  useEditorTouchScroll(editorHostRef, editorRef, selectedPath);

  async function loadFiles(workspaceId: string, path: string, requestId: number): Promise<void> {
    setIsLoading(true);
    setError(null);
    setRetryAction(null);
    try {
      const nextFiles = await api.files(workspaceId, path);
      if (!isCurrentFilesRequest(workspaceId, path, requestId)) return;
      setFiles(nextFiles);
      setCurrentPath(path);
      currentPathRef.current = path;
    } catch (loadError) {
      if (!isCurrentFilesRequest(workspaceId, path, requestId)) return;
      const message = apiErrorMessage(loadError, "Unable to load files", onUnauthorized);
      if (message) {
        setError(message);
        setRetryAction(() => () => {
          const nextRequestId = ++filesRequestRef.current;
          currentPathRef.current = path;
          void loadFiles(workspaceId, path, nextRequestId);
        });
      }
    } finally {
      if (isCurrentFilesRequest(workspaceId, path, requestId)) setIsLoading(false);
    }
  }

  async function openDirectory(path: string): Promise<void> {
    if (!workspace) return;
    const requestId = ++filesRequestRef.current;
    currentPathRef.current = path;
    await loadFiles(workspace.id, path, requestId);
  }

  async function openFile(path: string): Promise<void> {
    if (!workspace) return;
    const workspaceId = workspace.id;
    const requestId = ++openRequestRef.current;
    setIsLoading(true);
    setError(null);
    setRetryAction(null);
    try {
      const response = await api.readFile(workspaceId, path);
      if (!isCurrentOpenRequest(workspaceId, requestId)) return;
      setSelectedPath(path);
      selectedPathRef.current = path;
      setContent(response.content);
      setSavedContent(response.content);
      setExpectedVersion(response.version);
    } catch (openError) {
      if (!isCurrentOpenRequest(workspaceId, requestId)) return;
      const message = apiErrorMessage(openError, "Unable to open file", onUnauthorized);
      if (message) {
        setError(message);
        setRetryAction(() => () => void openFile(path));
      }
    } finally {
      if (isCurrentOpenRequest(workspaceId, requestId)) setIsLoading(false);
    }
  }

  async function saveFile(): Promise<void> {
    if (!workspace || !selectedPath || !expectedVersion || !dirty) return;
    const workspaceId = workspace.id;
    const path = selectedPath;
    const requestId = ++saveRequestRef.current;
    setIsSaving(true);
    setError(null);
    setRetryAction(null);
    try {
      const response = await api.saveFile(workspaceId, path, content, expectedVersion);
      if (!isCurrentSaveRequest(workspaceId, path, requestId)) return;
      setContent(response.content);
      setSavedContent(response.content);
      setExpectedVersion(response.version);
    } catch (saveError) {
      if (!isCurrentSaveRequest(workspaceId, path, requestId)) return;
      const conflict = isFileConflict(saveError);
      const message = conflict
        ? "File changed on disk. Reload before saving."
        : apiErrorMessage(saveError, "Unable to save file", onUnauthorized);
      if (message) {
        setError(message);
        if (!conflict) setRetryAction(() => () => void saveFile());
      }
    } finally {
      if (isCurrentSaveRequest(workspaceId, path, requestId)) setIsSaving(false);
    }
  }

  function isCurrentFilesRequest(workspaceId: string, path: string, requestId: number): boolean {
    return workspaceIdRef.current === workspaceId && currentPathRef.current === path && filesRequestRef.current === requestId;
  }

  function isCurrentOpenRequest(workspaceId: string, requestId: number): boolean {
    return workspaceIdRef.current === workspaceId && openRequestRef.current === requestId;
  }

  function isCurrentSaveRequest(workspaceId: string, path: string, requestId: number): boolean {
    return workspaceIdRef.current === workspaceId && selectedPathRef.current === path && saveRequestRef.current === requestId;
  }

  return {
    content,
    currentPath,
    dirty,
    editorHostRef,
    error,
    files,
    isLoading,
    isSaving,
    onContentChange: setContent,
    onEditorMount: (editor: MonacoEditor) => { editorRef.current = editor; },
    openDirectory,
    openFile,
    openableFileCount,
    retryAction,
    saveFile,
    selectedPath,
  };
}
