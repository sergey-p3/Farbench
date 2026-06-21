import { useState } from "react";
import type { PortPreview, Workspace } from "../../shared/types.js";
import { api, isUnauthorized } from "../api.js";

interface PreviewPanelProps {
  workspace: Workspace | null;
}

export function PreviewPanel({ workspace }: PreviewPanelProps) {
  const [port, setPort] = useState(3000);
  const [preview, setPreview] = useState<PortPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exposePreview() {
    if (!workspace) return;
    setIsLoading(true);
    setError(null);
    try {
      setPreview(await api.createPreview(workspace.id, port));
    } catch (previewError) {
      setError(panelError(previewError, "Unable to create preview"));
    } finally {
      setIsLoading(false);
    }
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
        <button disabled={isLoading || !Number.isInteger(port) || port < 1 || port > 65535} onClick={() => void exposePreview()} type="button">
          {isLoading ? "Exposing" : "Expose"}
        </button>
        {preview ? (
          <a href={preview.pathPrefix} rel="noreferrer" target="_blank">
            Open in new tab
          </a>
        ) : null}
      </div>
      {error ? <p className="panel-error" role="alert">{error}</p> : null}
      <div className="preview-frame-wrap">
        {preview ? (
          <iframe className="preview-frame" src={preview.pathPrefix} title={`Preview port ${preview.port}`} />
        ) : (
          <p className="empty-state centered">Expose a port to load its preview.</p>
        )}
      </div>
    </div>
  );
}

function panelError(error: unknown, fallback: string): string {
  if (isUnauthorized(error)) return "Session expired. Sign in again.";
  return error instanceof Error ? error.message : fallback;
}
