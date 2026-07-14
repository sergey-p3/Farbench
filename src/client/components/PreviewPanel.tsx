import { useEffect, useRef, useState } from "react";
import type { PortPreview, Workspace } from "../../shared/types.js";
import { api } from "../api.js";
import { apiErrorMessage } from "./apiError.js";

interface PreviewPanelProps {
  workspace: Workspace | null;
  initialPort?: number;
  initialPath?: string;
  onUnauthorized?: () => void;
}

export function PreviewPanel({ workspace, initialPort = 3000, initialPath = "/", onUnauthorized }: PreviewPanelProps) {
  const workspaceIdRef = useRef<string | null>(workspace?.id ?? null);
  const previewRequestRef = useRef(0);
  const [port, setPort] = useState(initialPort);
  const [pathPrefix, setPathPrefix] = useState(initialPath);
  const [preview, setPreview] = useState<PortPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    workspaceIdRef.current = workspace?.id ?? null;
    previewRequestRef.current += 1;
    setPreview(null);
    setIsLoading(false);
    setError(null);
    setPort(initialPort);
    setPathPrefix(initialPath);
  }, [initialPath, initialPort, workspace?.id]);

  async function exposePreview() {
    if (!workspace) return;
    const workspaceId = workspace.id;
    const requestId = ++previewRequestRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const nextPreview = await api.createPreview(workspaceId, port);
      if (!isCurrentPreviewRequest(workspaceId, requestId)) return;
      setPreview(nextPreview);
    } catch (previewError) {
      if (!isCurrentPreviewRequest(workspaceId, requestId)) return;
      const message = apiErrorMessage(previewError, "Unable to create preview", onUnauthorized);
      if (message) setError(message);
    } finally {
      if (isCurrentPreviewRequest(workspaceId, requestId)) setIsLoading(false);
    }
  }

  function isCurrentPreviewRequest(workspaceId: string, requestId: number): boolean {
    return workspaceIdRef.current === workspaceId && previewRequestRef.current === requestId;
  }

  if (!workspace) {
    return (
      <div className="tool-panel empty-tool">
        <p className="empty-state">Select a workspace to expose a preview.</p>
      </div>
    );
  }

  return (
    <div className="tool-panel preview-panel">
      <div className="preview-controls">
        <label className="field compact-field">
          <span>Port</span>
          <input
            min={1}
            max={65535}
            onChange={(event) => setPort(Number(event.target.value))}
            type="number"
            value={port}
          />
        </label>
        <label className="field compact-field">
          <span>Path</span>
          <input
            onChange={(event) => setPathPrefix(event.target.value)}
            type="text"
            value={pathPrefix}
          />
        </label>
        <button disabled={isLoading || !Number.isInteger(port) || port < 1 || port > 65535} onClick={() => void exposePreview()} type="button">
          {isLoading ? "Exposing" : "Expose"}
        </button>
        {preview ? (
          <a href={previewUrl(preview.pathPrefix, pathPrefix)} rel="noreferrer" target="_blank">
            Open in new tab
          </a>
        ) : null}
      </div>
      {error ? <p className="panel-error" role="alert">{error}</p> : null}
      <div className="preview-frame-wrap">
        {preview ? (
          <iframe className="preview-frame" src={previewUrl(preview.pathPrefix, pathPrefix)} title={`Preview port ${preview.port}`} />
        ) : (
          <p className="empty-state centered">Expose a port to load its preview.</p>
        )}
      </div>
    </div>
  );
}

function previewUrl(basePath: string, itemPath: string): string {
  const trimmed = itemPath.trim();
  if (!trimmed || trimmed === "/") return `${basePath}/`;
  const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${basePath}${normalized}`;
}
