# Farbench MVP Architecture Design

Date: 2026-06-20

## Product Summary

Build a browser-first remote development control plane for terminal-based coding agents such as Codex and Claude Code.

The product is not an IDE clone. It is a persistent remote workspace manager where the client is disposable and workspace state remains durable on the dev machine, local agent, tmux, and workspace filesystem.

For the first MVP, the user launches a self-hosted app from a dev machine. The app exposes a browser URL, and the browser connects to that endpoint.

Example launch:

```bash
farbench serve --host 0.0.0.0 --workspace ~/code/my-project
```

Example output:

```text
Farbench is running:
Local: http://localhost:3000
LAN:   http://192.168.86.23:3000
```

Later, each workspace can run its own agent and connect outward to a single global relay. From the browser's point of view, there should still be one stable endpoint: the relay.

## Target Users

The MVP targets a single technical owner who already works in terminals and wants durable browser access to long-running coding-agent sessions.

Primary user:

- Runs Codex, Claude Code, shell commands, tests, and dev servers on a trusted dev machine or VM.
- Wants to start work from a laptop and reconnect from another laptop, tablet, or phone.
- Wants to inspect changes, make small edits, and open a manually exposed preview port without SSHing into the machine.

Secondary future user:

- A trusted teammate who can view or continue another person's workspace session.
- This user is out of scope for the first MVP but should not be blocked by the data model.

## MVP Boundary

Included:

- CLI-launched local/self-hosted app.
- Single-user authentication.
- One or more configured local workspaces.
- Durable tmux-backed terminal sessions.
- Session types for `bash`, `codex`, and `claude`, treated as opaque terminal apps.
- Multiple terminal tabs/sessions per workspace.
- Browser terminal attach, detach, reconnect, resize, and scrollback restore.
- Per-browser layout memory, stored locally in the browser.
- Server-side user session records for active sessions, closed sessions, and history.
- File tree, file viewer, editor-lite, save, dirty state, syntax highlighting, and conflict detection.
- Git status and diff views.
- Manual port preview through an authenticated reverse proxy.
- Basic audit log for session lifecycle and high-level user actions.
- Responsive browser UI for desktop and mobile monitoring/small edits.

Out of scope:

- Hosted global relay implementation.
- Multi-user collaboration.
- Billing, quotas, organization settings, and enterprise RBAC.
- Custom AI orchestration or transcript parsing.
- Full IDE replacement.
- Real-time multiplayer editing.
- Required Docker/devcontainer isolation.
- Automatic port detection.
- Public unauthenticated preview URLs.

## Primary Acceptance Demo

The MVP is successful when this flow works:

1. Launch the app on a dev machine with a workspace path.
2. Open the printed browser URL from a laptop.
3. Log in as the single owner.
4. Start Codex or Claude Code in a tmux-backed workspace session.
5. Close or refresh the browser.
6. Reopen the app from another browser or LAN device.
7. See remembered browser layout if available, otherwise see active sessions first and closed/history sessions second.
8. Reconnect to the same terminal session.
9. Inspect changed files and git diffs.
10. Make and save a small browser edit with conflict detection.
11. Manually expose a local dev port and open it through the authenticated preview route.

## Architecture

The MVP has one deployable app with clean internal boundaries.

```text
Browser
  |
  | HTTP/WebSocket
  v
Local ControlPlane / Browser Endpoint
  |
  | AgentGateway interface
  v
LocalAgent
  |
  | tmux / filesystem / git / localhost ports
  v
WorkspaceRuntime
```

Future architecture:

```text
Browser
  |
  v
Global Relay
  |
  | secure agent channel
  v
Workspace Agent
  |
  v
WorkspaceRuntime
```

### WebClient

Runs in the browser. It provides the dashboard, terminal tabs, file tree/editor, git diff views, and manual port previews.

The browser never owns terminal state. It renders server state, stores disposable layout preferences, and sends user intent.

### ControlPlane

The local HTTP/WebSocket server started by the CLI.

Responsibilities:

- Authentication.
- Browser endpoint.
- Workspace and session metadata.
- Server-side user session records.
- Browser reconnect handling.
- WebSocket routing and fan-out.
- Audit events.
- Preview routing.
- Durable local database for MVP metadata.

The MVP can use a local embedded database for this metadata. The logical model should still be named as relay-owned state because the future hosted relay will own the same records.

### AgentGateway

The internal contract between control-plane logic and workspace capabilities.

The control plane should not directly know how tmux, files, git, or port proxying are implemented. This boundary allows the MVP `LocalAgent` to become a future remote workspace agent without rewriting browser-facing APIs.

### LocalAgent

The MVP implementation of `AgentGateway`.

It runs on the same dev machine as the control plane, either in-process initially or as a sidecar later.

Responsibilities:

- tmux lifecycle.
- Terminal attach/detach and scrollback capture.
- File reads/writes.
- Git status/diff commands.
- Workspace path checks.
- Local port access for previews.
- Health/status reporting.

### WorkspaceRuntime

The existing local project directory plus its installed tools, credentials, dependencies, and running dev processes.

The MVP does not require containers. The architecture should leave room for future Docker/devcontainer-backed runtimes.

## Core Models

### User

Single owner account for MVP. Stores auth identity and preferences. Team roles are out of scope.

### Workspace

A configured local project root.

Fields:

- ID.
- Display name.
- Absolute path.
- Allowed path boundary.
- Default shell.
- Environment policy.
- Status.

All file, git, and session operations must stay inside the workspace root unless explicitly allowed by launch/config.

### Session

A durable tmux-backed terminal session scoped to one workspace.

Fields:

- ID.
- Workspace ID.
- Name.
- Type: `bash`, `codex`, or `claude`.
- tmux session name.
- Current status.
- Created time.
- Last attached time.
- Last activity time.
- Restart/kill metadata.

### TerminalAttachment

An ephemeral browser connection to a session.

Attachments are WebSocket-level connections. Sessions survive after all attachments disconnect.

### BrowserLayout

Per-browser/per-device UI state stored locally in the browser.

Examples:

- Open panes.
- Split layout.
- Selected workspace/session IDs.
- Tab ordering.
- Sidebar state.
- Editor tabs.
- Preview placement.

This is convenience state only. Losing it must not lose sessions.

### UserSessionRecord

Durable server/relay-side record in the control-plane database.

This is distinct from a browser connection. It stores:

- User's known workspaces.
- Active terminal session metadata.
- Closed session/history metadata.
- Last known session state.
- History references needed for reconnect/history views.

### FileResource

Normalized metadata for files under the workspace root.

Fields:

- Workspace-relative path.
- Type.
- Size.
- mtime.
- Text/binary classification.
- Read/write capability.

### GitChange

Workspace-relative path plus git status.

Fields:

- Path.
- Status.
- Staged state if supported.
- Diff availability.
- Binary/large-file behavior.

### PortPreview

Manual preview entry.

Fields:

- Workspace ID.
- Local port.
- Generated preview path/token.
- Status.
- Last access time.

### AuditEvent

Append-only record for high-level activity:

- Login.
- Workspace open.
- Session create/kill/restart.
- Terminal attach/detach.
- File save.
- Git refresh.
- Preview expose/open.
- Auth failures.

Audit logs should not record full terminal keystrokes or terminal output in the MVP.

## Opening and Reconnect Flow

1. Browser opens the control-plane or relay URL.
2. Browser authenticates.
3. Browser loads its remembered local layout, if present.
4. Browser asks the control plane for durable workspace/session state.
5. If local layout references still-active sessions, the UI restores that arrangement and reconnects attachments.
6. If local layout is missing, stale, or references unavailable sessions, the UI shows a session picker.
7. The session picker lists active sessions first and closed/history sessions second.
8. User can reconnect to active sessions or inspect closed session history where retained.

Important rule: browser layout is convenience state only. The control-plane database is the source of truth for user session records, workspace/session metadata, and history. Terminal process state is owned by tmux through the local agent.

## Terminal Lifecycle

A terminal session is created through the control plane and materialized by the local agent as a tmux session.

Session type decides the initial command:

- `bash`: configured shell.
- `codex`: `codex` launched in the workspace root.
- `claude`: `claude` or configured Claude Code command launched in the workspace root.

Lifecycle states:

- `starting`: request accepted, tmux/session command being created.
- `running`: tmux session exists and command is active.
- `idle`: running but no browser attachments and no recent activity.
- `disconnected`: no browser attachments; process is still alive.
- `exited`: process ended normally.
- `crashed`: tmux or command exited unexpectedly.
- `killed`: user intentionally terminated the session.
- `unknown`: agent/control plane cannot determine state.

Reconnect behavior:

- Browser attachments are disposable WebSocket connections.
- Closing, refreshing, sleeping, or switching devices detaches only the attachment.
- The session remains alive in tmux until explicitly killed, until the command exits, or until retention policy removes it.
- On reconnect, the browser requests recent scrollback from tmux capture-pane plus live streaming.
- Resize events update tmux pane dimensions for the active attachment.
- If multiple browsers attach, the most recent active attachment controls pane size for MVP.
- Interrupt and EOF actions map to sending `Ctrl-C` and `Ctrl-D` into tmux, with audit events.

History behavior:

- Active sessions are reconnectable.
- Closed sessions remain visible as metadata/history records.
- MVP history includes session name, type, workspace, start/end time, exit state, and retained scrollback snapshot when available.
- Closed sessions are not resurrected; restart creates a new session linked to the prior record.

Failure handling:

- If the browser loses WebSocket connection, UI shows reconnecting state and retries.
- If the control plane restarts but tmux sessions survive, it attempts to rediscover known tmux sessions.
- If tmux is missing or a tmux session cannot be found, session state becomes `unknown` or `crashed` with a visible recovery action.
- If the workspace path is unavailable, sessions cannot start and existing sessions show workspace unavailable.

## Files, Git, Editing, and Previews

### File Access

File access is workspace-root bounded. The control plane normalizes and validates every requested path before calling the local agent.

Symlinks that resolve outside the workspace are read-only or blocked for MVP.

Large files have a configured read limit.

Binary files show metadata and are not edited in MVP.

### Editor-Lite

The browser file experience includes:

- File tree.
- Tabs.
- Read-only viewer.
- Syntax highlighting.
- Dirty state.
- Save.
- Conflict detection.

Conflict detection uses mtime plus content hash/version from the last read. If a file changed since it was opened, save is blocked and the user must reload before saving. Forced overwrite is out of scope for the MVP.

### Git Visibility

Git visibility is read-oriented.

The local agent runs bounded git commands in the workspace root for status and diffs. The UI shows changed files, untracked files, and per-file diffs.

MVP does not need staging, committing, rebasing, branch creation, or merge-conflict tooling unless used from the terminal.

### Manual Port Preview

Manual port preview works by entering a local port.

The control plane creates an authenticated route like:

```text
/preview/:previewId/*
```

It reverse-proxies to:

```text
127.0.0.1:<port>
```

from the dev machine.

Preview URLs require auth and are scoped to the owning user/workspace.

MVP supports normal HTTP previews. WebSocket preview forwarding is a follow-up.

## Security Assumptions

Security posture is single trusted owner on a trusted dev machine, with product-grade boundaries where they are cheap.

Requirements:

- Single-user login required before accessing any workspace/session/preview.
- Bind host is explicit: default `127.0.0.1`; user must opt into `0.0.0.0` for LAN access.
- Workspace paths are configured by launch args or config, not arbitrary browser input.
- All file operations are workspace-root bounded after path normalization and symlink resolution.
- Preview routes require auth and are not public bearer links by default.
- Audit events record high-level actions, not full terminal keystrokes.
- Secrets are not intentionally scraped or indexed.
- Logs avoid request bodies and terminal output by default.
- Destructive terminal commands are not prevented in MVP because terminal agents are opaque; this is documented as a trusted-machine constraint.

## Error Handling

The product should favor recoverable states:

- Browser reconnect loops for transient WebSocket failures.
- Session cards show clear states: running, disconnected, exited, crashed, unknown.
- File save conflicts block overwrite by default.
- Git errors return structured stderr/status without crashing the UI.
- Preview failures show connection refused, timeout, auth failure, or unsupported protocol where distinguishable.
- Control-plane restart attempts tmux rediscovery.

## Testing Strategy

Unit tests:

- Path normalization.
- Workspace boundary enforcement.
- Session state transitions.
- File conflict detection.
- Model serialization.

Integration tests:

- tmux create/attach/detach/reconnect.
- File read/save conflict.
- Git status/diff.
- Preview proxying.

Browser E2E:

- Launch server.
- Log in.
- Open workspace.
- Start session.
- Reconnect after reload.
- View diff.
- Edit/save file.
- Expose preview port.

Manual mobile smoke test:

- Reconnect from a LAN/mobile browser.
- View terminal output.
- Make a small edit.
- Open a manually exposed preview.

## Key Design Decisions

- Browser-first, no native wrapper in MVP.
- CLI-launched self-hosted app first.
- Single-user auth first.
- Single-box deployment first.
- tmux-backed terminal persistence first.
- Existing dev machine directories first, no required containers.
- Editor-lite included because small human intervention is part of the north-star workflow.
- Manual port exposure first.
- Internal `AgentGateway` boundary from day one to preserve the future relay/agent path.

## Future Follow-Ups

- Global hosted relay.
- Per-workspace agents connecting outward to the relay.
- Multi-user workspace sharing.
- Automatic port detection.
- Docker/devcontainer runtime isolation.
- Approval gates for dangerous actions.
- Session replay.
- AI transcript parsing and higher-level agent affordances.
- PWA install, push notifications, and native wrappers.
