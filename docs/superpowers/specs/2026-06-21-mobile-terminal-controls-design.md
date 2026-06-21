# Mobile Terminal Controls Design

## Goal

Make the terminal usable on mobile devices by fixing three gaps:

- Touch users can scroll terminal history up and down inside the terminal.
- When the software keyboard opens, the terminal remains visible and refits into the usable viewport.
- Mobile users can send special keys, including a one-shot sticky `Ctrl`, `Esc`, `Tab`, `Enter`, and arrow keys.

## Current State

`TerminalPane` owns the xterm instance, websocket attachment, fitting, and resize messages. The terminal host is nested inside fixed-height grid containers with `overflow: hidden`, and the component only responds to `window.resize`. There is no mobile-only input affordance for keys that virtual keyboards do not expose reliably.

## Approach

Add the behavior inside `TerminalPane` and local CSS. Keep websocket payloads unchanged: all special key actions still flow through the existing `{ type: "input", data }` message, and terminal size changes still use `{ type: "resize", cols, rows }`.

The implementation will add:

- Touch-friendly terminal scrolling by allowing xterm's viewport/scroller to handle vertical overflow with momentum scrolling.
- Visual viewport tracking with `window.visualViewport` when available, falling back to `window.resize`. On viewport changes, the terminal refits and sends an updated resize to the server.
- A compact terminal key toolbar shown with the terminal. The toolbar sends ANSI/control sequences directly to the existing terminal input path.
- A one-shot sticky `Ctrl` state. Tapping `Ctrl` arms the modifier for the next supported key action, then clears it.

## Key Behavior

Toolbar keys:

- `Ctrl`: toggles one-shot sticky modifier state.
- `Esc`: sends `\x1b`.
- `Tab`: sends `\t`.
- `Enter`: sends `\r`.
- Arrow keys: send `\x1b[D`, `\x1b[A`, `\x1b[B`, and `\x1b[C`.

When sticky `Ctrl` is active:

- Letter keys from toolbar actions are converted to control characters, such as `Ctrl+C` -> `\x03`.
- The modifier clears after the next special key action.
- If regular terminal typing occurs through xterm while `Ctrl` is armed, the modifier clears so the UI does not stay in a misleading state.

## Layout

The terminal pane remains a grid. The terminal host gets the flexible row, and the key toolbar gets an auto-height row. On mobile keyboard viewport changes, `TerminalPane` records the current visual viewport height in a CSS variable on its root so the terminal can size to the usable screen area before calling `fitAddon.fit()`.

The toolbar uses compact icon/text buttons with stable dimensions. It must not overlap terminal output or the top shell bar, and it must remain reachable when the virtual keyboard is open.

## Testing

Add focused tests for:

- The special-key mapper, including `Esc`, arrows, `Tab`, `Enter`, sticky `Ctrl+C`, and one-shot clearing behavior.
- Mobile terminal toolbar visibility in Playwright.
- Terminal pane staying within a reduced mobile viewport after a simulated viewport resize.

Run the existing client/unit tests and the focused E2E test after implementation.
