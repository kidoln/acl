#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API_PORT="${ACL_API_PORT:-3010}"
CONSOLE_PORT="${ACL_CONSOLE_PORT:-3020}"
API_BASE_URL="${ACL_API_BASE_URL:-http://127.0.0.1:${API_PORT}}"
PERSISTENCE_DRIVER="${ACL_PERSISTENCE_DRIVER:-}"
POSTGRES_DSN="${ACL_POSTGRES_DSN:-}"
CONTROL_TOKEN="${ACL_CONTROL_TOKEN:-9e6eab8f5cdc6347ed2054f96735d4f204fb2a6c9bd89cdf898db56315c70e33}"
CONTROL_IP_ALLOWLIST="${ACL_CONTROL_IP_ALLOWLIST:-}"

if [[ -z "$PERSISTENCE_DRIVER" && -n "$POSTGRES_DSN" ]]; then
  PERSISTENCE_DRIVER="postgres"
fi

if [[ -z "$PERSISTENCE_DRIVER" ]]; then
  PERSISTENCE_DRIVER="memory"
fi

TSX_BIN=""

for candidate in \
  "${ROOT_DIR}/node_modules/.bin/tsx" \
  "${ROOT_DIR}/node_modules/.pnpm/node_modules/.bin/tsx" \
  "${ROOT_DIR}/apps/api/node_modules/.bin/tsx" \
  "${ROOT_DIR}/apps/console/node_modules/.bin/tsx"; do
  if [[ -x "$candidate" ]]; then
    TSX_BIN="$candidate"
    break
  fi
done

if [[ -z "$TSX_BIN" ]]; then
  echo "[start-dev] missing tsx executable"
  echo "[start-dev] run: corepack pnpm install"
  echo "[start-dev] or:  npm exec --yes --package=pnpm@10.30.3 -- pnpm install --frozen-lockfile"
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

if [[ "$PERSISTENCE_DRIVER" == "postgres" && -z "$POSTGRES_DSN" ]]; then
  echo "[start-dev] ACL_PERSISTENCE_DRIVER=postgres but ACL_POSTGRES_DSN is empty"
  echo "[start-dev] set ACL_POSTGRES_DSN or switch to ACL_PERSISTENCE_DRIVER=memory"
  exit 1
fi

if [[ "$PERSISTENCE_DRIVER" == "memory" ]]; then
  echo "[start-dev] persistence: memory (non-persistent across restart)"
else
  echo "[start-dev] persistence: postgres"
fi

ACL_API_PORT="$API_PORT" \
ACL_PERSISTENCE_DRIVER="$PERSISTENCE_DRIVER" \
ACL_POSTGRES_DSN="$POSTGRES_DSN" \
ACL_CONTROL_TOKEN="$CONTROL_TOKEN" \
ACL_CONTROL_IP_ALLOWLIST="$CONTROL_IP_ALLOWLIST" \
"$TSX_BIN" watch apps/api/src/main.ts &
API_PID=$!

ACL_CONSOLE_PORT="$CONSOLE_PORT" \
ACL_API_BASE_URL="$API_BASE_URL" \
ACL_CONTROL_TOKEN="$CONTROL_TOKEN" \
ACL_CONTROL_IP_ALLOWLIST="$CONTROL_IP_ALLOWLIST" \
"$TSX_BIN" watch apps/console/src/index.ts &
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
