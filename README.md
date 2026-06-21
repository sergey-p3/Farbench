# Remote Development

Remote Development is a browser-first control plane for durable terminal coding-agent sessions on a trusted dev machine.

## Run

```sh
npm install
npm run build
npx tsx src/server/cli.ts serve --host 127.0.0.1 --port 3000 --workspace .
```

Loopback development access uses the default token:

```text
dev-password
```

## LAN Access

To serve the app on your local network, bind to all interfaces and provide an explicit auth token:

```sh
npx tsx src/server/cli.ts serve --host 0.0.0.0 --port 3000 --workspace . --auth-token <choose-a-secret>
```

Non-loopback hosts require an explicit `--auth-token`.

## MVP Capabilities

- Single-owner login
- Local workspace dashboard
- `tmux`-backed `bash`, `codex`, and `claude` sessions
- Browser reconnect after refresh or device switch
- File tree and editor-lite conflict detection
- Git status and diffs
- Manual authenticated HTTP preview

## Requirements

- Node.js 22+
- `tmux`
- `git`
- Codex and Claude binaries for those session types
- Playwright browser install for E2E tests, if needed

`tmux` is required when starting terminal sessions. The server can start without `tmux`, but terminal session launch will require it.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

E2E tests use isolated `test-results` workspace and data directories. They intentionally do not start `tmux`-backed sessions to avoid orphaning durable `tmux` sessions.

## Manual LAN Smoke Test

1. Start the LAN server:

   ```sh
   npx tsx src/server/cli.ts serve --host 0.0.0.0 --port 3000 --workspace . --auth-token <choose-a-secret>
   ```

2. Confirm the server prints a LAN URL.
3. Open the LAN URL from another device on the same trusted network.
4. Log in with the chosen auth token.
5. Start a `bash` session. This requires `tmux` on the dev machine.
6. Refresh the browser and confirm the session reconnects.
7. Open the files panel and make a small edit to a non-critical file.
8. Preview a known local HTTP server port through the authenticated HTTP preview.
