# Contributing

Thank you for helping improve Remote Development. Bug reports, design feedback,
documentation fixes, and code contributions are welcome.

## Before you start

- Search existing issues before opening a new one.
- Use an issue for substantial changes so the approach can be discussed first.
- Never include credentials, private source code, terminal transcripts, or other
  sensitive workspace data in an issue, test fixture, screenshot, or commit.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Development setup

You need Node.js 22 or newer, npm, Git, and tmux. Then:

```sh
git clone <your-fork-url>
cd remote-development
npm ci
./scripts/dev.sh
```

The development server listens on `0.0.0.0:9154` with the local-only default
token `dev-password`. Override `HOST`, `PORT`, `WORKSPACE`, and `AUTH_TOKEN` as
needed. Do not expose that default token to an untrusted network.

## Making a change

1. Create a focused branch from the default branch.
2. Add or update tests for behavior changes.
3. Keep commits scoped and use clear, imperative commit messages.
4. Update the README or other documentation when behavior or configuration changes.
5. Run the checks below before opening a pull request.

```sh
npm run verify
npm run test:e2e
```

For E2E tests, install Chromium once with:

```sh
npx playwright install --with-deps chromium
```

The full repository check is also available as `./scripts/verify.sh`.

## Pull requests

Pull requests should explain the problem, the chosen approach, how the change was
tested, and any security or compatibility impact. Small, reviewable pull requests
are easier to merge. By contributing, you agree that your contribution is licensed
under the project's MIT License.
