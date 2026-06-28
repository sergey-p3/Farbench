import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import type { GitFileDiffResponse } from "../../shared/types.js";
import {
  copyPayloadForGitLine,
  defaultGitDiffMode,
  type GitDiffMode,
} from "../gitDiffView.js";

interface GitDiffViewerProps {
  diff: GitFileDiffResponse | null;
  isLoading: boolean;
}

export function GitDiffViewer({ diff, isLoading }: GitDiffViewerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const cursorListenerRef = useRef<{ dispose: () => void } | null>(null);
  const [mode, setMode] = useState<GitDiffMode>(() => defaultGitDiffMode(window.innerWidth));
  const [selectedNewLine, setSelectedNewLine] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    cursorListenerRef.current?.dispose();
    cursorListenerRef.current = null;
    const width = hostRef.current?.clientWidth ?? window.innerWidth;
    setMode(defaultGitDiffMode(width));
    setSelectedNewLine(null);
    setCopied(false);
  }, [diff?.path]);

  useEffect(() => {
    return () => cursorListenerRef.current?.dispose();
  }, []);

  const handleMount: DiffOnMount = (editor) => {
    cursorListenerRef.current?.dispose();
    const modifiedEditor = editor.getModifiedEditor();
    setSelectedNewLine(modifiedEditor.getPosition()?.lineNumber ?? null);
    cursorListenerRef.current = modifiedEditor.onDidChangeCursorPosition((event) => {
      setSelectedNewLine(event.position.lineNumber);
      setCopied(false);
    });
  };

  async function copyLocation() {
    if (!diff) return;
    await navigator.clipboard.writeText(copyPayloadForGitLine(diff.path, selectedNewLine));
    setCopied(true);
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
            onClick={() => setMode("side-by-side")}
            type="button"
          >
            Side by side
          </button>
          <button
            aria-pressed={mode === "line-by-line"}
            onClick={() => setMode("line-by-line")}
            type="button"
          >
            Line by line
          </button>
        </div>
        <button className="secondary-button" onClick={() => void copyLocation()} type="button">
          {copied ? "Copied" : "Copy location"}
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
