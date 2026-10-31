#!/usr/bin/env bash
set -Eeuo pipefail

export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export PORT="${PORT:-10000}"
export QUORUM_DATA_DIR="${QUORUM_DATA_DIR:-/var/data/mcp}"
export QUORUM_STORE_PATH="${QUORUM_STORE_PATH:-/var/data/quorum-store.json}"

mkdir -p "$QUORUM_DATA_DIR/tenders" "$(dirname "$QUORUM_STORE_PATH")"

# Seed only the public sample tender documents on first deploy. Runtime state,
# accounts, submissions, and audit history start clean and live on the disk.
if [ -d /app/deploy-seed/tenders ]; then
  cp -Rn /app/deploy-seed/tenders/. "$QUORUM_DATA_DIR/tenders/"
fi

bun /app/mini-services/quorum-mcp/index.ts &
SIDECAR_PID=$!
NEXT_PID=

cleanup() {
  if [ -n "$NEXT_PID" ]; then
    kill -TERM "$NEXT_PID" 2>/dev/null || true
  fi
  kill -TERM "$SIDECAR_PID" 2>/dev/null || true
  if [ -n "$NEXT_PID" ]; then
    wait "$NEXT_PID" 2>/dev/null || true
  fi
  wait "$SIDECAR_PID" 2>/dev/null || true
}

trap cleanup EXIT
trap 'exit 143' TERM INT

for attempt in $(seq 1 30); do
  if bun -e 'fetch("http://127.0.0.1:3031/api/health").then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))' >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$SIDECAR_PID" 2>/dev/null; then
    wait "$SIDECAR_PID"
    exit 1
  fi
  sleep 1
done

if ! bun -e 'fetch("http://127.0.0.1:3031/api/health").then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))' >/dev/null 2>&1; then
  echo "quorum-mcp sidecar failed its startup health check" >&2
  exit 1
fi

node /app/server.js &
NEXT_PID=$!

set +e
wait -n "$SIDECAR_PID" "$NEXT_PID"
status=$?
set -e
exit "$status"
