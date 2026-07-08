# Terminal And Agent Connection Status Design

## Goal

Terminal and agent panes show a clear connection status while the backing terminal surface is empty. The user should never see a plain black pane during WebSocket connection, tmux attach, or scrollback loading.

## Behavior

- When a terminal pane opens with no cached scrollback, show a centered status overlay on the terminal surface.
- Terminal items use terminal language: `Connecting to terminal...`, `Attaching terminal...`, and `Loading terminal history...`.
- Agent items use agent language: `Connecting to agent...`, `Attaching agent...`, and `Loading agent history...`.
- The overlay is passive and does not add Retry or Create actions. Existing error and disconnected banners keep those actions.
- Hide the overlay as soon as cached scrollback is painted, authoritative scrollback arrives, live output arrives, an error arrives, or the terminal exits.
- Keep cached scrollback behavior unchanged. If cached content is available, do not cover it with a loading overlay.

## Architecture

- Extend `TerminalPane` with a display mode prop from `ItemRenderer` so terminal and agent panes can use the right copy without changing the WebSocket protocol.
- Track a client-only connection phase in `TerminalPane`: connecting, attaching, loading history, and hidden.
- Render the phase overlay inside `.terminal-stage` above `.terminal-host`, with pointer events disabled so terminal gestures remain unaffected.
- Reuse the existing socket lifecycle. No backend protocol changes are required.

## Testing

- Add Playwright coverage using the existing fake terminal WebSocket to hold the socket in the connecting and attached states and assert the visible status text.
- Verify terminal copy and agent copy.
- Verify the overlay disappears when scrollback arrives.
