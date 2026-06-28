# Readable Git Diff Viewer Design

## Goal

Replace the raw `git diff` text view with a read-only, user-friendly file diff viewer that supports both side-by-side and line-by-line review modes.

## User Experience

The Git panel keeps the existing changed-file list. Selecting a changed file opens a readable diff inside the panel instead of a raw patch block.

The diff toolbar includes a compact mode control:

- `Side by side` shows original content on the left and current content on the right.
- `Line by line` shows changes in a unified inline flow.

Desktop-sized panels default to side-by-side. Narrow panels default to line-by-line. The user can switch modes during the session without changing the selected file.

The viewer is read-only in this version. Editing remains in the Files panel.

## Copy Behavior

The diff viewer exposes a copy action for the current/new-file location. When the user has selected or focused a changed line that exists in the new file, the copy payload is:

```text
path:line
```

When no new-file line is available, the copy payload falls back to:

```text
path
```

Deleted-only lines do not invent a new-file line number. In that case, copying uses the path-only fallback unless the user focuses a nearby current-line context line.

## Architecture

Use Monaco's built-in diff editor rather than adding a second editor dependency. `FilePanel` already loads Monaco through `@monaco-editor/react`, so the Git panel can reuse the same dependency and visual language.

The server should provide structured content for a selected changed file:

- `path`
- original/base text
- current text
- whether the diff is available as text
- optional fallback patch text for cases that cannot be represented cleanly

The client maps that response into Monaco diff models and controls Monaco's `renderSideBySide` option from the toolbar mode.

## Server Behavior

For modified tracked files, the server reads original content from Git and current content from the working tree or index, depending on whether the visible change is unstaged or staged-only.

For staged-only changes, the original side comes from `HEAD:path` and the current side comes from `:path`.

For unstaged changes, the original side comes from the index when available, and the current side comes from the working tree.

For added files, the original side is empty and the current side is the added content.

For deleted files, the original side is the previous content and the current side is empty.

Binary files, files too large for the existing text-file limit, and Git errors return a stable non-text or fallback state instead of crashing the panel.

## Client Components

`GitPanel` remains responsible for status loading, selection, and errors. It should delegate diff rendering to a focused diff viewer component so the status list logic does not grow around Monaco-specific behavior.

The diff viewer component owns:

- read-only Monaco diff rendering
- side-by-side versus line-by-line mode
- selected/focused new-file line tracking
- copy payload generation
- empty, loading, text fallback, and non-text states

The toolbar should stay compact and operational. It should not include explanatory help text inside the app.

## Testing

Server tests cover structured diff content for:

- modified unstaged files
- staged-only files
- added files
- deleted files
- missing path validation

Client tests cover:

- mode toggle state
- default mode selection for wide and narrow containers
- copy payload generation for `path:line`
- path-only fallback when no new-file line is selected

Verification should run typecheck and the focused tests before broader validation.
