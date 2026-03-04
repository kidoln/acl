#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API_PORT="${ACL_API_PORT:-3010}"
CONSOLE_PORT="${ACL_CONSOLE_PORT:-3020}"
API_BASE_URL="${ACL_API_BASE_URL:-http://127.0.0.1:${API_PORT}}"

TSX_BIN="${ROOT_DIR}/node_modules/.bin/tsx"

if [[ ! -x "$TSX_BIN" ]]; then
  echo "[start-dev] missing tsx at ${TSX_BIN}"
  echo "[start-dev] run: corepack pnpm install"
  exit 1
fi

API_PID=""
CONSOLE_PID=""

cleanup() {
  set +e
  if [[ -n "$CONSOLE_PID" ]] && kill -0 "$CONSOLE_PID" 2>/dev/null; then
    kill "$CONSOLE_PID" 2>/dev/null || true
  fi
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}

trap cleanup EXIT INT TERM

echo "[start-dev] api port: ${API_PORT}"
echo "[start-dev] console port: ${CONSOLE_PORT}"
echo "[start-dev] console -> api: ${API_BASE_URL}"

ACL_API_PORT="$API_PORT" "$TSX_BIN" watch apps/api/src/main.ts &
API_PID=$!

ACL_CONSOLE_PORT="$CONSOLE_PORT" ACL_API_BASE_URL="$API_BASE_URL" "$TSX_BIN" watch apps/console/src/index.ts &
CONSOLE_PID=$!

while true; do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    wait "$API_PID" || true
    break
  fi

  if ! kill -0 "$CONSOLE_PID" 2>/dev/null; then
    wait "$CONSOLE_PID" || true
    break
  fi

  sleep 1
done
