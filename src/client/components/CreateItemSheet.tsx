import { useEffect, useMemo, useRef, useState } from "react";
import type { CodexPermissionLevel, SessionType, WorkspaceItem } from "../../shared/types.js";
import { createBrowserItem, findEquivalentItem } from "../itemLayout.js";

type BrowserCreateKind = "files" | "git" | "preview";

interface CreateItemSheetProps {
  isOpen: boolean;
  items: WorkspaceItem[];
  workspaceId: string | null;
  onClose: () => void;
  onCreateBrowserItem: (item: WorkspaceItem) => void;
  onCreateSession: (type: SessionType, codexPermissionLevel?: CodexPermissionLevel) => Promise<void>;
  onFocusItem: (itemId: string) => void;
}

interface PendingDuplicate {
  label: string;
  existingItem: WorkspaceItem;
  createNew: () => void | Promise<void>;
}

export function CreateItemSheet({
  isOpen,
  items,
  workspaceId,
  onClose,
  onCreateBrowserItem,
  onCreateSession,
  onFocusItem,
}: CreateItemSheetProps) {
  const createInFlightRef = useRef(false);
  const sheetStateVersionRef = useRef(0);
  const [pendingDuplicate, setPendingDuplicate] = useState<PendingDuplicate | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isCodexSetupOpen, setIsCodexSetupOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codexPermissionLevel, setCodexPermissionLevel] = useState<CodexPermissionLevel>("workspace-write");
  const [previewPort, setPreviewPort] = useState(3000);
  const [previewPath, setPreviewPath] = useState("/");

  const workspaceItems = useMemo(
    () => items.filter((item) => item.workspaceId === workspaceId),
    [items, workspaceId],
  );

  useEffect(() => {
    sheetStateVersionRef.current += 1;
    setPendingDuplicate(null);
    setIsCodexSetupOpen(false);
    setError(null);
    setCodexPermissionLevel("workspace-write");
    setPreviewPort(3000);
    setPreviewPath("/");
  }, [isOpen, workspaceId]);

  if (!isOpen) return null;

  async function createSession(type: SessionType, permissionLevel?: CodexPermissionLevel) {
    if (!workspaceId || isCreateLocked()) return;
    const kind = type === "bash" ? "terminal" : "agent";
    const candidate: WorkspaceItem = {
      id: `new-session:${type}`,
      workspaceId,
      kind,
      title: type === "bash" ? "shell session" : `${type} session`,
      status: "ready",
      config: { runtime: type },
    };
    const existing = findEquivalentItem(workspaceItems, candidate);
    if (existing) {
      setPendingDuplicate({
        label: candidate.title,
        existingItem: existing,
        createNew: () => runCreateSession(type, permissionLevel),
      });
      return;
    }
    await runCreateSession(type, permissionLevel);
  }

  async function runCreateSession(type: SessionType, permissionLevel?: CodexPermissionLevel) {
    if (createInFlightRef.current) return;
    createInFlightRef.current = true;
    const sheetStateVersion = sheetStateVersionRef.current;
    setIsCreating(true);
    setError(null);
    try {
      await onCreateSession(type, permissionLevel);
      if (sheetStateVersionRef.current === sheetStateVersion) onClose();
    } catch (createError) {
      if (sheetStateVersionRef.current === sheetStateVersion) {
        setError(createError instanceof Error ? createError.message : "Unable to create session");
      }
    } finally {
      createInFlightRef.current = false;
      setIsCreating(false);
    }
  }

  function createBrowser(kind: BrowserCreateKind, forceDuplicate = false) {
    if (!workspaceId || isCreateLocked()) return;
    const item = createBrowserItem(
      kind === "preview"
        ? { kind, workspaceId, port: previewPort, path: previewPath || "/", duplicateKey: forceDuplicate ? uniqueDuplicateKey() : undefined }
        : { kind, workspaceId, duplicateKey: forceDuplicate ? uniqueDuplicateKey() : undefined },
    );
    const existing = findEquivalentItem(workspaceItems, item);
    if (existing && !forceDuplicate) {
      setPendingDuplicate({
        label: item.title,
        existingItem: existing,
        createNew: () => createBrowser(kind, true),
      });
      return;
    }
    onCreateBrowserItem(item);
    onClose();
  }

  function focusExisting(itemId: string) {
    if (isCreateLocked()) return;
    onFocusItem(itemId);
    setPendingDuplicate(null);
    onClose();
  }

  function isCreateLocked(): boolean {
    return createInFlightRef.current || isCreating;
  }

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <section className="create-sheet" aria-label="Create item" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-header">
          <div>
            <p className="eyebrow">Create</p>
            <h2>{isCodexSetupOpen ? "Start Codex" : "Open item"}</h2>
          </div>
          <button className="icon-button" aria-label="Close create sheet" onClick={onClose} type="button">×</button>
        </div>

        {pendingDuplicate ? (
          <div className="duplicate-panel" role="alert">
            <h3>{pendingDuplicate.label} is already open</h3>
            <p>{pendingDuplicate.existingItem.title}</p>
            <div className="sheet-actions">
              <button disabled={isCreating} onClick={() => focusExisting(pendingDuplicate.existingItem.id)} type="button">Focus existing</button>
              <button disabled={isCreating} onClick={() => void pendingDuplicate.createNew()} type="button">Create new</button>
              <button className="secondary-button" disabled={isCreating} onClick={() => setPendingDuplicate(null)} type="button">Cancel</button>
            </div>
          </div>
        ) : isCodexSetupOpen ? (
          <fieldset className="codex-create">
            <legend>Codex permissions</legend>
            <div className="permission-options">
              <PermissionOption
                checked={codexPermissionLevel === "read-only"}
                description="Inspect files and ask before making changes."
                label="Read only"
                onChange={() => setCodexPermissionLevel("read-only")}
              />
              <PermissionOption
                checked={codexPermissionLevel === "workspace-write"}
                description="Edit and run commands here; ask before going outside."
                label="Workspace (recommended)"
                onChange={() => setCodexPermissionLevel("workspace-write")}
              />
              <PermissionOption
                checked={codexPermissionLevel === "danger-full-access"}
                description="No sandbox or approval prompts. Use only in trusted environments."
                label="Full access"
                onChange={() => setCodexPermissionLevel("danger-full-access")}
              />
            </div>
            <div className="sheet-actions">
              <button
                disabled={!workspaceId || isCreating}
                onClick={() => void createSession("codex", codexPermissionLevel)}
                type="button"
              >
                Start Codex
              </button>
              <button className="secondary-button" disabled={isCreating} onClick={() => setIsCodexSetupOpen(false)} type="button">
                Back
              </button>
            </div>
          </fieldset>
        ) : (
          <>
            <div className="create-grid">
              <button disabled={!workspaceId || isCreating} onClick={() => setIsCodexSetupOpen(true)} type="button">Agent: Codex</button>
              <button disabled={!workspaceId || isCreating} onClick={() => void createSession("claude")} type="button">Agent: Claude</button>
              <button disabled={!workspaceId || isCreating} onClick={() => void createSession("bash")} type="button">Terminal</button>
              <button disabled={!workspaceId || isCreating} onClick={() => createBrowser("files")} type="button">Files</button>
              <button disabled={!workspaceId || isCreating} onClick={() => createBrowser("git")} type="button">Git diff</button>
            </div>

            <fieldset className="preview-create">
              <legend>Preview</legend>
              <label className="field compact-field">
                <span>Port</span>
                <input min={1} max={65535} onChange={(event) => setPreviewPort(Number(event.target.value))} type="number" value={previewPort} />
              </label>
              <label className="field compact-field">
                <span>Path</span>
                <input onChange={(event) => setPreviewPath(event.target.value)} type="text" value={previewPath} />
              </label>
              <button disabled={!workspaceId || isCreating || !Number.isInteger(previewPort) || previewPort < 1 || previewPort > 65535} onClick={() => createBrowser("preview")} type="button">Preview</button>
            </fieldset>
          </>
        )}

        {error ? <p className="panel-error" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}

function uniqueDuplicateKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface PermissionOptionProps {
  checked: boolean;
  description: string;
  label: string;
  onChange: () => void;
}

function PermissionOption({ checked, description, label, onChange }: PermissionOptionProps) {
  return (
    <label className={checked ? "permission-option selected" : "permission-option"}>
      <input checked={checked} name="codex-permission-level" onChange={onChange} type="radio" />
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}
