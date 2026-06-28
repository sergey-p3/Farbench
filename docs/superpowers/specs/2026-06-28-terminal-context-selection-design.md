# Terminal Context Selection Design

## Goal

Add a terminal context-menu selection flow so a user can right-click or long-press terminal output, get a `Select` item, start with the word under the pointer selected, expand the selection normally, and copy the selected text.

## Architecture

The feature stays in the client terminal surface. `TerminalPane` will remember the coordinates that opened the context menu and seed an xterm selection from those coordinates. A small helper module will translate DOM pointer coordinates into terminal cell coordinates and expand the selected cell to the surrounding word on that buffer line.

The existing `Copy`, `Paste`, and `Select all` actions remain. `Copy` continues to use `terminal.getSelection()`, so copied content is whatever xterm currently considers selected. The new `Select` action closes the menu and focuses the terminal after seeding the word selection.

## Components

- `src/client/terminalSelection.ts`: pure helpers for converting pointer coordinates into xterm cell coordinates and finding word bounds in a terminal line.
- `src/client/components/TerminalPane.tsx`: stores the menu pointer coordinates, preselects the word when opening the menu, adds the `Select` menu item, and invokes the helper.
- `tests/client/terminalSelection.test.ts`: unit coverage for coordinate mapping and word-bound detection.
- `tests/e2e/mvp.spec.ts`: browser coverage that the terminal menu exposes `Select`, preselects the pointed word, and the menu copy path can copy that selection.

## Behavior

Opening the context menu immediately attempts to preselect the word under the pointer. If the pointer maps outside the terminal grid or the target cell is whitespace, no selection is seeded. Choosing `Select` repeats the same selection attempt from the stored pointer and returns focus to the terminal.

Dragging after the menu closes uses xterm's normal terminal selection behavior. Copying is unchanged: it writes the current xterm selection to the Clipboard API and reports the existing failure status if clipboard access is denied.

## Testing

Unit tests cover the pure coordinate and word-bound logic. The E2E test uses the existing fake terminal socket fixture to render known scrollback, opens the terminal context menu at a known word, asserts the `Select` menu item is visible, clicks `Copy`, and verifies the clipboard receives the selected word.
