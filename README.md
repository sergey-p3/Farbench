# Farbench

Farbench is a browser-first remote development workspace for terminals, coding
agents, files, Git, and application previews. It keeps terminal sessions alive with
tmux and brings the essential tools on a trusted development machine into one
responsive browser workspace.

> [!WARNING]
> This is pre-1.0 software with privileged access to the selected workspace and
> host processes. Use it on trusted machines and networks. Direct internet exposure
> is not a supported deployment model.

## Features

- Durable tmux-backed Bash, Codex, and Claude sessions
- Browser reconnection after refresh or device changes
- Workspace file browsing and editing with conflict detection
- Git status, commit history, and readable diffs
- Authenticated previews of local HTTP services
- Desktop and mobile-friendly terminal controls
- Single-owner token authentication

## Requirements

- Node.js 22 or newer and npm
- Git
- tmux for terminal sessions
- Codex or Claude installed locally for their respective session types
- A Chromium browser installed through Playwright for E2E tests

The server starts without tmux, but cannot launch terminal sessions until tmux is
available.

## Quick start

```sh
cd farbench
npm ci
npm run build
node dist/server/cli.js serve --host 127.0.0.1 --port 3000 --workspace .
```

Open <http://localhost:3000> and sign in with `dev-password`. For a shorter local
workflow, `./scripts/run.sh` installs dependencies, builds, and starts the server on
`127.0.0.1:7000`.

## Configuration

The CLI accepts these `serve` options:

| Option | Default | Purpose |
| --- | --- | --- |
| `--host` | `127.0.0.1` | Address on which the server listens |
| `--port` | `3000` | HTTP port |
| `--workspace` | current directory | Workspace the app can access |
| `--workspace-name` | directory name | Display name for the workspace |
| `--data-dir` | `~/.farbench` | SQLite state and application data |
| `--auth-token` | `dev-password` | Single-owner login token |

A non-loopback host requires an explicit authentication token:

```sh
node dist/server/cli.js serve \
  --host 0.0.0.0 \
  --port 3000 \
  --workspace /path/to/project \
  --auth-token '<strong-unique-secret>'
```

The helper scripts accept equivalent environment variables: `HOST`, `PORT`,
`WORKSPACE`, `WORKSPACE_NAME`, `DATA_DIR`, and `AUTH_TOKEN`. `ALLOWED_HOSTS` is a
comma-separated list of additional hostnames accepted by the Vite development
server.

## Development

Install locked dependencies and start the hot-reloading server:

```sh
npm ci
./scripts/dev.sh
```

`dev.sh` defaults to `0.0.0.0:9154` and token `dev-password`; do not use those
defaults on an untrusted network. It uses the directory from which it was launched
as the workspace and generates a short workspace name. Override any of the script
environment variables when needed.

The development server can also run in the background:

```sh
./scripts/dev.sh --daemon
./scripts/dev.sh --restart
./scripts/dev.sh --stop
```

Daemon state is stored in `.farbench/dev.pid`, with logs in
`.farbench/dev.log`. Set `FARBENCH_RUN_DIR` to move those files.

### Project scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the TypeScript server directly on loopback |
| `npm run build` | Build the browser client and server |
| `npm run typecheck` | Run strict TypeScript checks |
| `npm test` | Run unit and integration tests |
| `npm run test:e2e` | Run Playwright E2E tests |
| `npm run verify` | Run typecheck, unit tests, and build |
| `./scripts/verify.sh` | Install dependencies and run every check, including E2E |

Before the first E2E run, install Chromium and its system dependencies:

```sh
npx playwright install --with-deps chromium
```

E2E tests use isolated directories under `test-results` and intentionally avoid
starting tmux-backed sessions so test runs do not leave durable sessions behind.

## Security

Farbench acts with the permissions of the user who starts it. It can run
commands, edit files, inspect Git repositories, and proxy local web services. Read
[SECURITY.md](SECURITY.md) before using a non-loopback binding, and report
vulnerabilities privately as described there.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup,
validation, and pull request guidance. Participation is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md).

## License

Licensed under the [MIT License](LICENSE).
