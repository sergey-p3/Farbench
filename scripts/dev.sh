#!/usr/bin/env bash
set -euo pipefail

CALLER_PWD="$PWD"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

random_workspace_name() {
  local length
  length=$((5 + RANDOM % 4))
  od -An -N16 -tx1 /dev/urandom | tr -d ' \n' | cut -c "1-${length}"
}

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-7000}"
WORKSPACE="${WORKSPACE:-$CALLER_PWD}"
AUTH_TOKEN="${AUTH_TOKEN:-dev-password}"
DATA_DIR="${DATA_DIR:-}"
WORKSPACE_NAME="${WORKSPACE_NAME:-$(random_workspace_name)}"

npm install
npm run build

args=(serve --host "$HOST" --port "$PORT" --workspace "$WORKSPACE")

if [[ -n "$AUTH_TOKEN" ]]; then
  args+=(--auth-token "$AUTH_TOKEN")
fi

if [[ -n "$DATA_DIR" ]]; then
  args+=(--data-dir "$DATA_DIR")
fi

args+=(--workspace-name "$WORKSPACE_NAME")

exec node dist/server/cli.js "${args[@]}"
