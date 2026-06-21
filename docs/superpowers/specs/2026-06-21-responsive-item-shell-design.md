# Responsive Item Shell Design

Date: 2026-06-21

## Summary

Redesign the browser client around a responsive item shell that is mobile-first without blocking a richer desktop layout later.

The current UI is a desktop-first dashboard with always-visible workspace/session controls and persistent tool tabs for terminal, files, git, and preview. That makes the product feel bulky and cluttered, especially on a phone. The new design treats every workspace surface as an open item that can be created, focused, restored, switched, and later placed into desktop panes.

Phase one implements the mobile-first shell and the unified item model. Desktop split panes are designed in the state model but implemented later.

## Goals

- Make mobile the primary first implementation target.
- Show one focused workspace item at a time on mobile.
- Replace always-visible tool tabs with a `+` create sheet and an item switcher.
- Treat terminal sessions, agent sessions, files, git diff, and preview as workspace items.
- Restore the last active item after refresh or reconnect when possible.
- Avoid blocking a later desktop layout with tmux-like splits and tabs per split.
- Keep existing terminal, file, git, and preview capabilities available.

## Non-Goals

- Implement desktop split panes in phase one.
- Replace terminal-backed agent sessions with a chat UI in phase one.
- Build a command-palette-first workflow.
- Build a full IDE or multi-file editor experience.
- Add multi-user collaboration or hosted relay behavior.

## Product Model

An item is an open workspace surface.

Initial item kinds:

- `agent`: a durable agent session. In phase one this is still backed by a terminal/tmux session such as Codex or Claude. A later phase can render this as a chat/log interface.
- `terminal`: a durable shell/tmux session.
- `files`: a workspace file explorer/editor surface backed by the current file APIs.
- `git`: a git status and diff surface backed by the current git APIs.
- `preview`: an authenticated local port preview surface.

Items have metadata independent of how they render:

- ID.
- Workspace ID.
- Kind.
- Title.
- Status.
- Optional server session ID for durable terminal-backed items.
- Optional item-specific config, such as preview port and path.
- Created time and last active time when available.

Terminal and agent items remain durable server-backed sessions. Files, git, and preview items can start as browser layout items backed by existing server APIs.

## Responsive Layout

The shell uses one layout model with different renderers by viewport.

### Mobile Phase-One Renderer

Mobile is the primary implementation target.

- The active item fills the screen.
- A minimal top bar shows workspace context, the active item title/status, an item switcher control, and `+`.
- The item switcher opens as a drawer or bottom sheet.
- `+` opens a fixed create sheet with large touch targets.
- There is no persistent sidebar, permanent dashboard, or multi-pane view.
- Selecting an item closes the drawer and returns to the focused item.

### Desktop Phase-One Renderer

Desktop initially uses the same focused item shell, scaled to available space.

- The drawer and create sheet may be wider and denser.
- No dashboard is forced to be always visible.
- The code should not assume there is only one pane forever.

### Future Desktop Renderer

Desktop later becomes a tmux-like workspace layout.

- The screen can contain multiple split panes.
- Each pane has its own tab strip.
- Each tab references an item.
- Items can move between panes without changing their internal rendering.
- Mobile continues to render one active pane/item at a time.

## Create Flow

The `+` button opens a fixed create sheet, not a search-first command palette.

Primary actions:

- Agent.
- Terminal.
- Files.
- Git diff.
- Preview.

Agent can open a second-level choice for the supported agent runtime, initially Codex or Claude. Terminal creates a shell session.

When the requested item type already has an equivalent open item, the shell must inform the user and offer:

- `Focus existing`.
- `Create new`.

Equivalence is kind-specific:

- Terminal and agent creation checks for existing open items of the same runtime, such as Codex, Claude, or shell. If one exists, the sheet must offer `Focus existing` and `Create new`.
- Files is equivalent by workspace unless later expanded to path-specific file items.
- Git is equivalent by workspace unless later expanded to specific diff scopes.
- Preview is equivalent by workspace, port, and path.

This avoids silent duplication while preserving user control.

## Switcher Flow

The item switcher lists open items for the selected workspace.

Each row should show:

- Item kind.
- Title.
- Status when meaningful.
- Enough detail to disambiguate duplicates, such as session type, preview port, or last active time.

On mobile, the switcher is optimized for quick focus changes. It is not a dashboard. Workspace selection can remain available, but it should not dominate the active item view.

## Component Design

### WorkspaceShell

Owns the responsive shell. It loads workspaces and sessions, handles auth failures, tracks layout state, and coordinates the switcher and create sheet.

### PaneHost

Owns pane-level selection. Phase one can render a single pane, but the component boundary should make future split panes natural.

### ItemRenderer

Receives an item and renders the appropriate surface:

- Terminal pane for terminal-backed items.
- File panel for files.
- Git panel for git.
- Preview panel for preview.
- Later chat/log view for agent items.

### ItemSwitcher

Drawer or sheet that focuses an open item.

### CreateItemSheet

Fixed touch-first create sheet. It owns duplicate detection UI and delegates item creation/focus decisions back to the shell.

## Layout State

The existing `BrowserLayout.split` model should evolve into a pane and item layout model.

Phase-one state should support:

- `selectedWorkspaceId`.
- `activePaneId`.
- `panes`.
- `items`.

Each pane should include:

- `id`.
- `activeItemId`.
- `itemIds`.

Each item should include:

- `id`.
- `workspaceId`.
- `kind`.
- `title`.
- `status`.
- Optional `sessionId`.
- Optional `config`.

Phase one can persist this in local storage. Invalid persisted state must normalize back to one pane and no active item.

## Launch And Restore Behavior

After authentication:

1. Load workspaces.
2. Select the remembered workspace if it still exists; otherwise select the first available workspace.
3. Load durable sessions for the selected workspace.
4. Reconcile browser layout items with server sessions.
5. Restore the remembered active item if it is valid.
6. If the remembered item is invalid but sessions exist, focus the most recent valid session item.
7. If no valid items exist, show an empty focused state with a prominent `+` button. Pressing `+` opens the fixed create sheet.

Terminal sessions that ended or disappeared should render an item-level reconnect/recreate state instead of breaking the shell.

## Error Handling

- Auth failures reset to login.
- Workspace load failures render a shell-level error with retry.
- Terminal attach failures render inside the terminal item with retry/recreate options.
- File, git, and preview API failures render inside the item surface with retry controls.
- Layout parsing failures fall back to a valid default one-pane layout.
- Duplicate create decisions should be cancelable.

## Testing

Add focused tests around the new shell behavior:

- Unit tests for layout normalization.
- Unit tests for duplicate/equivalent item detection.
- Unit tests for session-to-item reconciliation.
- Component tests for item switcher focus behavior where practical.
- Component tests for create sheet duplicate prompts where practical.
- E2E test at a mobile viewport for login, creating items from `+`, switching items, refreshing, and restoring the last active item.

Existing server tests for terminal, file, git, preview, and auth behavior should remain in place.

## Phasing

### Phase One

- Introduce item and pane layout state.
- Replace always-visible tool tabs with the active item shell.
- Add item switcher.
- Add fixed create sheet.
- Render terminal, files, git, and preview through `ItemRenderer`.
- Preserve existing APIs and backend session behavior.
- Validate mobile viewport behavior.

### Later Phase: Desktop Splits

- Add multiple visible panes on desktop.
- Add pane-level tab strips.
- Allow moving items between panes.
- Add keyboard-friendly desktop controls.

### Later Phase: Agent Chat UI

- Render agent items as a chat/log interface.
- Show the agent text log.
- Allow the user to send messages from a chat-style composer.
- Continue supporting durable reconnect behavior.
