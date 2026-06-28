import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import type { GitFileDiffResponse } from "../../shared/types.js";
import {
  copyPayloadForGitLine,
  copyStatusLabel,
  defaultGitDiffMode,
  validSelectedNewLine,
  type GitDiffCopyStatus,
  type GitDiffMode,
} from "../gitDiffView.js";

interface GitDiffViewerProps {
  diff: GitFileDiffResponse | null;
  isLoading: boolean;
}

export function GitDiffViewer({ diff, isLoading }: GitDiffViewerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorListenersRef = useRef<Array<{ dispose: () => void }>>([]);
  const [mode, setMode] = useState<GitDiffMode>(() => defaultGitDiffMode(window.innerWidth));
  const [selectedNewLine, setSelectedNewLine] = useState<number | null>(null);
  const [copyStatus, setCopyStatus] = useState<GitDiffCopyStatus>("idle");

  useEffect(() => {
    disposeEditorListeners();
    const width = hostRef.current?.clientWidth ?? window.innerWidth;
    setMode(defaultGitDiffMode(width));
    setSelectedNewLine(null);
    setCopyStatus("idle");
  }, [diff?.path]);

  useEffect(() => {
    return disposeEditorListeners;
  }, []);

  const handleMount: DiffOnMount = (editor) => {
    disposeEditorListeners();
    const originalEditor = editor.getOriginalEditor();
    const modifiedEditor = editor.getModifiedEditor();
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
  };

  async function copyLocation() {
    if (!diff) return;
    try {
      await navigator.clipboard.writeText(copyPayloadForGitLine(diff.path, selectedNewLine));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
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
          key={diff.path}
          language={languageForPath(diff.path)}
          modified={diff.current}
          onMount={handleMount}
          options={{
            automaticLayout: true,
            fontSize: 13,
            minimap: { enabled: false },
            originalEditable: false,
            readOnly: true,
            renderSideBySide: mode === "side-by-side",
            scrollBeyondLastLine: false,
          }}
          original={diff.original}
          theme="vs-dark"
        />
      </div>
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
