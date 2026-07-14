import type { FormEvent, PointerEvent, RefObject, TouchEvent, ClipboardEvent } from "react";
import type { TerminalArrowDirection } from "../../terminalArrowGesture.js";
import { terminalKeyLabels, type TerminalToolbarKey } from "../../terminalKeys.js";
import type { TerminalSelectionHandleLayout } from "../../terminalSelection.js";

export interface TerminalActionMenuState {
  pointerX: number;
  pointerY: number;
  x: number;
  y: number;
}

export interface TerminalArrowOverlayState {
  direction: TerminalArrowDirection | null;
  originX: number;
  originY: number;
}

export type TerminalSelectionHandleKind = "start" | "end";

export function EmptyTerminalPane({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="tool-panel empty-tool">
      <p className="empty-state">Select a session to attach a terminal.</p>
      <button onClick={onCreate} type="button">Create new</button>
    </div>
  );
}

export function TerminalStatus({
  message,
  onCreate,
  onRetry,
}: {
  message: string | null;
  onCreate: () => void;
  onRetry: () => void;
}) {
  if (!message) return null;
  return (
    <div className="panel-error terminal-status" role="status">
      <span>{message}</span>
      <div className="terminal-status-actions">
        <button onClick={onRetry} type="button">Retry</button>
        <button onClick={onCreate} type="button">Create new</button>
      </div>
    </div>
  );
}

export function TerminalConnectionStatus({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="terminal-connection-status" role="status" aria-live="polite">
      <span className="terminal-connection-dot" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

export function TerminalSelectionHandles({
  bufferLength,
  handles,
  onBeginDrag,
}: {
  bufferLength: number;
  handles: TerminalSelectionHandleLayout | null;
  onBeginDrag: (event: PointerEvent<HTMLButtonElement>, handle: TerminalSelectionHandleKind) => void;
}) {
  if (!handles) return null;
  return (
    <div className="terminal-selection-handles" aria-hidden={false}>
      <button
        aria-label="Expand terminal selection start"
        aria-orientation="vertical"
        aria-valuemax={bufferLength}
        aria-valuemin={0}
        aria-valuenow={0}
        className="terminal-selection-handle terminal-selection-handle-start"
        onPointerDown={(event) => onBeginDrag(event, "start")}
        role="slider"
        style={{ left: handles.start.left, top: handles.start.top }}
        title="Expand selection start"
        type="button"
      />
      <button
        aria-label="Expand terminal selection end"
        aria-orientation="vertical"
        aria-valuemax={bufferLength}
        aria-valuemin={0}
        aria-valuenow={0}
        className="terminal-selection-handle terminal-selection-handle-end"
        onPointerDown={(event) => onBeginDrag(event, "end")}
        role="slider"
        style={{ left: handles.end.left, top: handles.end.top }}
        title="Expand selection end"
        type="button"
      />
    </div>
  );
}

export function TerminalArrowGesture({ overlay }: { overlay: TerminalArrowOverlayState | null }) {
  if (!overlay) return null;
  return (
    <div
      aria-label="Arrow key gesture control"
      className="terminal-arrow-gesture"
      data-direction={overlay.direction ?? "inactive"}
      role="status"
      style={{ left: overlay.originX, top: overlay.originY }}
    >
      <span aria-hidden="true" className="terminal-arrow-origin" />
      {(["left", "up", "down", "right"] as const).map((direction) => (
        <span
          aria-hidden="true"
          className={`terminal-arrow terminal-arrow-${direction}${overlay.direction === direction ? " active" : ""}`}
          key={direction}
        >
          {direction === "left" ? "←" : direction === "up" ? "↑" : direction === "down" ? "↓" : "→"}
        </span>
      ))}
    </div>
  );
}

export function TerminalActionMenu({
  menu,
  isPasteCaptureVisible,
  menuRef,
  onCopy,
  onPaste,
  onPasteCaptureInput,
  onPasteCapturePaste,
  onSelect,
  onSelectAll,
  pasteCaptureRef,
}: {
  menu: TerminalActionMenuState | null;
  isPasteCaptureVisible: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  onCopy: () => void;
  onPaste: () => void;
  onPasteCaptureInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  onPasteCapturePaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onSelect: () => void;
  onSelectAll: () => void;
  pasteCaptureRef: RefObject<HTMLTextAreaElement | null>;
}) {
  if (!menu) return null;
  return (
    <div
      aria-label="Terminal actions"
      className="terminal-action-menu"
      ref={menuRef}
      role="menu"
      style={{ left: menu.x, top: menu.y }}
    >
      <button onClick={onSelect} role="menuitem" type="button">Select</button>
      <button onClick={onCopy} role="menuitem" type="button">Copy</button>
      <button onClick={onPaste} role="menuitem" type="button">Paste</button>
      <button onClick={onSelectAll} role="menuitem" type="button">Select all</button>
      {isPasteCaptureVisible ? (
        <textarea
          aria-label="Paste terminal input"
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          className="terminal-paste-capture"
          onInput={onPasteCaptureInput}
          onPaste={onPasteCapturePaste}
          ref={pasteCaptureRef}
          rows={1}
          spellCheck={false}
        />
      ) : null}
    </div>
  );
}

export function TerminalKeybar({
  isCtrlActive,
  onClick,
  onPreserveFocus,
  onTouchEnd,
}: {
  isCtrlActive: boolean;
  onClick: (key: TerminalToolbarKey) => void;
  onPreserveFocus: (event: PointerEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => void;
  onTouchEnd: (event: TouchEvent<HTMLButtonElement>, key: TerminalToolbarKey) => void;
}) {
  return (
    <div className="terminal-keybar" role="toolbar" aria-label="Terminal special keys">
      {terminalKeyLabels.map((key) => (
        <button
          aria-label={key.ariaLabel}
          aria-pressed={key.key === "ctrl" ? isCtrlActive : undefined}
          className={key.key === "ctrl" && isCtrlActive ? "active" : undefined}
          key={key.key}
          onClick={() => onClick(key.key)}
          onPointerDown={onPreserveFocus}
          onTouchEnd={(event) => onTouchEnd(event, key.key)}
          onTouchStart={onPreserveFocus}
          type="button"
        >
          {key.label}
        </button>
      ))}
    </div>
  );
}
