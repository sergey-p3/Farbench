import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { GitFileDiffResponse } from "../../shared/types.js";
import {
  changedNewLineBlocksFromPatch,
  copyPayloadForGitLine,
  copyStatusLabel,
  copyTextToClipboard,
  defaultGitDiffMode,
  diffEditorOptionsForMode,
  validSelectedNewLine,
  type GitDiffCopyStatus,
  type GitDiffMode,
} from "../gitDiffView.js";

interface GitDiffViewerProps {
  diff: GitFileDiffResponse | null;
  initialChangeDirection?: 1 | -1 | null;
  isLoading: boolean;
  onInitialChangeShown?: () => void;
}

export interface GitDiffViewerHandle {
  copyLocation: () => Promise<void>;
  showAdjacentChange: (direction: 1 | -1) => boolean;
  showBoundaryChange: (direction: 1 | -1) => boolean;
}

export const GitDiffViewer = forwardRef<GitDiffViewerHandle, GitDiffViewerProps>(function GitDiffViewer(
  { diff, initialChangeDirection = null, isLoading, onInitialChangeShown },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const modifiedEditorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const editorListenersRef = useRef<Array<{ dispose: () => void }>>([]);
  const [mode, setMode] = useState<GitDiffMode>(() => defaultGitDiffMode(window.innerWidth));
  const [selectedNewLine, setSelectedNewLine] = useState<number | null>(null);
  const [copyStatus, setCopyStatus] = useState<GitDiffCopyStatus>("idle");
  const changedBlocks = useMemo(() => changedNewLineBlocksFromPatch(diff?.patch ?? ""), [diff?.patch]);

  useEffect(() => {
    disposeEditorListeners();
    modifiedEditorRef.current = null;
    const width = hostRef.current?.clientWidth ?? window.innerWidth;
    setMode(defaultGitDiffMode(width));
    setSelectedNewLine(null);
    setCopyStatus("idle");
  }, [diff?.path]);

  useEffect(() => {
    return disposeEditorListeners;
  }, []);

  useImperativeHandle(ref, () => ({
    copyLocation,
    showAdjacentChange,
    showBoundaryChange,
  }));

  const handleMount: DiffOnMount = (editor) => {
    disposeEditorListeners();
    const originalEditor = editor.getOriginalEditor();
    const modifiedEditor = editor.getModifiedEditor();
    modifiedEditorRef.current = modifiedEditor;
    const updateSelectedLine = (lineNumber: number | null, modifiedFocused: boolean) => {
      setSelectedNewLine(validSelectedNewLine({
        currentContent: diff?.current ?? "",
        lineNumber,
        modifiedLineCount: modifiedEditor.getModel()?.getLineCount() ?? 0,
        modifiedFocused,
      }));
      setCopyStatus("idle");
    };

    editorListenersRef.current = [
      originalEditor.onDidFocusEditorWidget(() => updateSelectedLine(null, false)),
      modifiedEditor.onDidFocusEditorWidget(() => {
        updateSelectedLine(modifiedEditor.getPosition()?.lineNumber ?? null, true);
      }),
      modifiedEditor.onDidChangeCursorPosition((event) => {
        updateSelectedLine(event.position.lineNumber, modifiedEditor.hasTextFocus());
      }),
    ];

    if (initialChangeDirection !== null) {
      window.requestAnimationFrame(() => {
        if (showBoundaryChange(initialChangeDirection)) onInitialChangeShown?.();
      });
    }
  };

  async function copyLocation(): Promise<void> {
    if (!diff) return;
    if (await copyTextToClipboard(copyPayloadForGitLine(diff.path, selectedNewLine))) {
      setCopyStatus("copied");
      return;
    }
    setCopyStatus("failed");
  }

  function showAdjacentChange(direction: 1 | -1): boolean {
    const modifiedEditor = modifiedEditorRef.current;
    if (!modifiedEditor || changedBlocks.length === 0) return false;
    const currentLine = modifiedEditor.getPosition()?.lineNumber ?? 0;
    const targetLine = direction === 1
      ? changedBlocks.find((line) => selectedNewLine === null ? line >= currentLine : line > currentLine)
      : [...changedBlocks].reverse().find((line) => selectedNewLine === null ? line <= currentLine : line < currentLine);
    if (targetLine === undefined) return false;
    showChangeAtLine(modifiedEditor, targetLine);
    return true;
  }

  function showBoundaryChange(direction: 1 | -1): boolean {
    const modifiedEditor = modifiedEditorRef.current;
    if (!modifiedEditor || changedBlocks.length === 0) return false;
    const targetLine = direction === 1 ? changedBlocks[0] : changedBlocks[changedBlocks.length - 1];
    showChangeAtLine(modifiedEditor, targetLine);
    return true;
  }

  function showChangeAtLine(modifiedEditor: Monaco.editor.IStandaloneCodeEditor, targetLine: number) {
    modifiedEditor.setPosition({ column: 1, lineNumber: targetLine });
    modifiedEditor.revealLineInCenter(targetLine);
    setSelectedNewLine(targetLine);
    setCopyStatus("idle");
  }

  function selectMode(nextMode: GitDiffMode) {
    setMode(nextMode);
    setCopyStatus("idle");
  }

  function disposeEditorListeners() {
    for (const listener of editorListenersRef.current) {
      listener.dispose();
    }
    editorListenersRef.current = [];
  }

  if (isLoading) {
    return (
      <div className="git-diff-viewer">
        <p className="loading-state centered">Loading diff...</p>
      </div>
    );
  }

  if (!diff) {
    return (
      <div className="git-diff-viewer">
        <p className="empty-state centered">Select a changed file to view its diff.</p>
      </div>
    );
  }

  if (diff.kind !== "text") {
    const fallbackText = diff.patch || "Diff content is unavailable.";
    return (
      <div className="git-diff-viewer">
        <pre className="diff-output">{`${diff.message ?? "This file cannot be shown as a text diff."}\n\n${fallbackText}`}</pre>
      </div>
    );
  }

  return (
    <div className="git-diff-viewer" ref={hostRef}>
      <div className="diff-controls">
        <div className="segmented-control" role="group" aria-label="Diff view mode">
          <button
            aria-pressed={mode === "side-by-side"}
            onClick={() => selectMode("side-by-side")}
            type="button"
          >
            Side by side
          </button>
          <button
            aria-pressed={mode === "line-by-line"}
            onClick={() => selectMode("line-by-line")}
            type="button"
          >
            Line by line
          </button>
        </div>
        <button className="secondary-button" onClick={() => void copyLocation()} type="button">
          {copyStatusLabel(copyStatus)}
        </button>
      </div>
      <div className="diff-editor-host">
        <DiffEditor
          key={`${diff.path}-${mode}`}
          language={languageForPath(diff.path)}
          modified={diff.current}
          onMount={handleMount}
          options={{
            automaticLayout: true,
            ...diffEditorOptionsForMode(mode),
            domReadOnly: true,
            fontSize: 13,
            minimap: { enabled: false },
            originalEditable: false,
            readOnly: true,
            scrollBeyondLastLine: false,
          }}
          original={diff.original}
          theme="vs-dark"
        />
      </div>
    </div>
  );
});

function languageForPath(path: string): string {
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js") || path.endsWith(".jsx")) return "javascript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".html")) return "html";
  return "plaintext";
}
