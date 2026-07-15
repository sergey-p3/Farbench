#!/usr/bin/env bash
set -euo pipefail

CALLER_PWD="$PWD"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

usage() {
  cat <<'USAGE'
Usage: ./scripts/dev.sh [--daemon] [--restart] [--stop]

Options:
  --daemon   Start the hot-reload dev server in the background.
  --restart  Stop any running dev daemon, then start it in the background.
  --stop     Stop the running dev daemon.
USAGE
}

random_workspace_name() {
  local length
  length=$((5 + RANDOM % 4))
  od -An -N16 -tx1 /dev/urandom | tr -d ' \n' | cut -c "1-${length}"
}

MODE="foreground"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --daemon)
      MODE="daemon"
      ;;
    --restart)
      MODE="restart"
      ;;
    --stop)
      MODE="stop"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-9154}"
WORKSPACE="${WORKSPACE:-$CALLER_PWD}"
AUTH_TOKEN="${AUTH_TOKEN:-dev-password}"
DATA_DIR="${DATA_DIR:-}"
WORKSPACE_NAME="${WORKSPACE_NAME:-$(random_workspace_name)}"
FARBENCH_RUN_DIR="${FARBENCH_RUN_DIR:-$PWD/.farbench}"
PID_FILE="$FARBENCH_RUN_DIR/dev.pid"
LOG_FILE="$FARBENCH_RUN_DIR/dev.log"
TSX_BIN="${TSX_BIN:-$PWD/node_modules/.bin/tsx}"

read_pid() {
  if [[ -f "$PID_FILE" ]]; then
    tr -d '[:space:]' < "$PID_FILE"
  fi
}

is_running_pid() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

stop_daemon() {
  local pid
  pid="$(read_pid)"

  if [[ -z "$pid" ]]; then
    rm -f "$PID_FILE"
    echo "No dev daemon is running."
    return 0
  fi

  if ! is_running_pid "$pid"; then
    rm -f "$PID_FILE"
    echo "Removed stale dev daemon pid $pid."
    return 0
  fi

  kill "$pid"
  for _ in {1..50}; do
    if ! is_running_pid "$pid"; then
      rm -f "$PID_FILE"
      echo "Stopped dev daemon $pid."
      return 0
    fi
    sleep 0.1
  done

  kill -KILL "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "Stopped dev daemon $pid."
}

dev_command() {
  args=(serve --host "$HOST" --port "$PORT" --workspace "$WORKSPACE")

  if [[ -n "$AUTH_TOKEN" ]]; then
    args+=(--auth-token "$AUTH_TOKEN")
  fi

  if [[ -n "$DATA_DIR" ]]; then
    args+=(--data-dir "$DATA_DIR")
  fi

  args+=(--workspace-name "$WORKSPACE_NAME")
  command=("$TSX_BIN" watch --exclude .farbench --exclude node_modules --exclude dist --exclude test-results src/server/cli.ts "${args[@]}")
}

start_daemon() {
  local pid
  mkdir -p "$FARBENCH_RUN_DIR"
  pid="$(read_pid)"
  if is_running_pid "$pid"; then
    echo "Dev daemon is already running as pid $pid. Use --restart to replace it."
    return 0
  fi
  rm -f "$PID_FILE"

  npm install
  export FARBENCH_VITE="${FARBENCH_VITE:-1}"
  dev_command

  setsid "${command[@]}" > "$LOG_FILE" 2>&1 < /dev/null &
  pid="$!"
  echo "$pid" > "$PID_FILE"
  echo "Started dev daemon $pid."
  echo "Log: $LOG_FILE"
}

case "$MODE" in
  stop)
    stop_daemon
    exit 0
    ;;
  restart)
    stop_daemon
    start_daemon
    exit 0
    ;;
  daemon)
    start_daemon
    exit 0
    ;;
esac

npm install
export FARBENCH_VITE="${FARBENCH_VITE:-1}"
dev_command

exec "${command[@]}"
