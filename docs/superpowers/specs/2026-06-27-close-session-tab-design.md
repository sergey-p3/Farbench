# Close Session Tab Design

## Goal

Users can close an open terminal or agent tab and have the backing tmux session killed at the same time. This applies to `bash`, `codex`, and `claude` session tabs. Browser-only items such as files, git diff, and preview tabs close locally without server calls.

## Behavior

- A close control is available from the item switcher for every open item.
- Closing a `terminal` or `agent` item with a `sessionId` calls the server to kill the session, records the session as `killed`, and removes the tab from the browser layout.
- Closing a local browser item removes only that item from the browser layout.
- If the killed session still appears in session history, session reconciliation must not recreate a tab for terminal statuses (`exited`, `crashed`, `killed`).
- If the close request fails, the tab remains open and the shell shows the API error.
- If the closed item was active, focus moves to the next available item in the same pane, preferring the item to the right and then the item to the left.

## Architecture

- Add a `DELETE /api/workspaces/:workspaceId/sessions/:sessionId` route in `createApp`.
- Reuse `LocalAgent.killSession`, backed by `TmuxManager.kill`.
- Treat missing tmux sessions during delete as a successful close because the desired end state is already reached.
- Add `api.killSession` on the client.
- Add `removeItem` and terminal-history filtering to `itemLayout`.
- Thread `onCloseItem` through `WorkspaceShell` into `ItemSwitcher`.

## Testing

- Server tests cover successful session close, status update, audit logging, and workspace/session ownership.
- Client layout tests cover local item removal, active-item fallback, and avoiding resurrected killed sessions.
- E2E coverage extends the mocked mobile terminal flow to verify that closing a terminal tab issues `DELETE` and removes the tab.
