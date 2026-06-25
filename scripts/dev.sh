#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_HOST="${HERMES_MONITOR_BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${HERMES_MONITOR_BACKEND_PORT:-8000}"
FRONTEND_HOST="${HERMES_MONITOR_FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${HERMES_MONITOR_FRONTEND_PORT:-5173}"
EVENTS_DIR="${HERMES_MONITOR_EVENTS_DIR:-$HOME/.hermes/live-events}"
DEV_WATCH="${HERMES_MONITOR_DEV_WATCH:-0}"

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  local status=$?
  trap - EXIT INT TERM

  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  wait "$FRONTEND_PID" "$BACKEND_PID" 2>/dev/null || true
  exit "$status"
}

trap cleanup EXIT INT TERM

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1" >&2
    exit 1
  fi
}

check_backend_deps() {
  if [[ ! -x "$ROOT_DIR/.venv/bin/python" ]]; then
    echo "Missing backend virtual environment: $ROOT_DIR/.venv" >&2
    echo "Create it manually:" >&2
    echo "  python3 -m venv .venv" >&2
    echo "  . .venv/bin/activate" >&2
    echo "  pip install -r backend/requirements.txt" >&2
    exit 1
  fi

  if [[ ! -x "$ROOT_DIR/.venv/bin/uvicorn" ]]; then
    echo "Missing backend dependency: uvicorn" >&2
    echo "Install backend dependencies manually:" >&2
    echo "  . .venv/bin/activate" >&2
    echo "  pip install -r backend/requirements.txt" >&2
    exit 1
  fi
}

check_frontend_deps() {
  if [[ ! -d "$ROOT_DIR/frontend/node_modules" ]]; then
    echo "Missing frontend dependencies: $ROOT_DIR/frontend/node_modules" >&2
    echo "Install frontend dependencies manually:" >&2
    echo "  cd frontend" >&2
    echo "  npm install" >&2
    exit 1
  fi

  if [[ ! -x "$ROOT_DIR/frontend/node_modules/.bin/vite" ]]; then
    echo "Missing frontend dependency: vite" >&2
    echo "Install frontend dependencies manually:" >&2
    echo "  cd frontend" >&2
    echo "  npm install" >&2
    exit 1
  fi

  if [[ "$DEV_WATCH" != "1" && ! -f "$ROOT_DIR/frontend/dist/index.html" ]]; then
    echo "Missing frontend build output: $ROOT_DIR/frontend/dist" >&2
    echo "Build it manually before starting without watchers:" >&2
    echo "  cd frontend" >&2
    echo "  npm run build" >&2
    echo "For hot-reload development mode, run:" >&2
    echo "  HERMES_MONITOR_DEV_WATCH=1 ./scripts/dev.sh" >&2
    exit 1
  fi
}

check_runtime_paths() {
  if [[ ! -d "$EVENTS_DIR" ]]; then
    echo "Missing events directory: $EVENTS_DIR" >&2
    echo "Create it manually or start Hermes with the live monitor exporter enabled." >&2
    echo "You can also point to another directory:" >&2
    echo "  HERMES_MONITOR_EVENTS_DIR=/path/to/live-events ./scripts/dev.sh" >&2
    exit 1
  fi
}

require_command npm

check_backend_deps
check_frontend_deps
check_runtime_paths

echo "[backend]  http://$BACKEND_HOST:$BACKEND_PORT"
echo "[frontend] http://$FRONTEND_HOST:$FRONTEND_PORT"
echo "[events]   $EVENTS_DIR"
if [[ "$DEV_WATCH" == "1" ]]; then
  echo "[mode]     dev watch"
else
  echo "[mode]     serve built frontend"
fi
echo
echo "Press Ctrl+C to stop both servers."
echo

(
  cd "$ROOT_DIR"
  export HERMES_MONITOR_EVENTS_DIR="$EVENTS_DIR"
  if [[ "$DEV_WATCH" == "1" ]]; then
    exec "$ROOT_DIR/.venv/bin/uvicorn" backend.main:app \
      --host "$BACKEND_HOST" \
      --port "$BACKEND_PORT" \
      --reload
  else
    exec "$ROOT_DIR/.venv/bin/uvicorn" backend.main:app \
      --host "$BACKEND_HOST" \
      --port "$BACKEND_PORT"
  fi
) &
BACKEND_PID=$!

(
  cd "$ROOT_DIR/frontend"
  if [[ "$DEV_WATCH" == "1" ]]; then
    exec npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT"
  else
    exec npm run preview -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT"
  fi
) &
FRONTEND_PID=$!

wait -n "$BACKEND_PID" "$FRONTEND_PID"
