#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export PORT="${PORT:-10000}"
export QUORUM_DATA_DIR="${QUORUM_DATA_DIR:-/var/data/mcp}"
export QUORUM_STORE_PATH="${QUORUM_STORE_PATH:-/var/data/quorum-store.json}"

mkdir -p "$QUORUM_DATA_DIR/tenders" "$(dirname "$QUORUM_STORE_PATH")"

# Keep signing keys stable across deploys even if they are not injected as
# Render environment variables. The JSON file is on the attached persistent
# disk, created with owner-only permissions, and never copied into the image.
mapfile -t quorum_runtime_secrets < <(
  node -e '
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    const path = require("node:path");
    const names = ["GATE_SECRET", "ATTEST_SECRET", "STEP_UP_SECRET", "QUORUM_DOWNLOAD_SECRET", "NOTIFY_SECRET", "AUDIT_SECRET", "MUSE_ACTION_SECRET", "BID_VAULT_SECRET"];
    const file = path.join(process.env.QUORUM_DATA_DIR, "runtime-secrets.json");
    let stored = {};
    try { stored = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    const values = names.map((name) => {
      const value = process.env[name]?.trim() || stored[name] || crypto.randomBytes(32).toString("base64url");
      if (!process.env[name]?.trim()) stored[name] = value;
      return value;
    });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(stored), { mode: 0o600 });
    fs.renameSync(temp, file);
    fs.chmodSync(file, 0o600);
    process.stdout.write(`${values.join("\n")}\n`);
  '
)

if [ "${#quorum_runtime_secrets[@]}" -ne 8 ]; then
  echo "could not initialize persistent Quorum signing keys" >&2
  exit 1
fi

export GATE_SECRET="${GATE_SECRET:-${quorum_runtime_secrets[0]}}"
export ATTEST_SECRET="${ATTEST_SECRET:-${quorum_runtime_secrets[1]}}"
export STEP_UP_SECRET="${STEP_UP_SECRET:-${quorum_runtime_secrets[2]}}"
export QUORUM_DOWNLOAD_SECRET="${QUORUM_DOWNLOAD_SECRET:-${quorum_runtime_secrets[3]}}"
export NOTIFY_SECRET="${NOTIFY_SECRET:-${quorum_runtime_secrets[4]}}"
export AUDIT_SECRET="${AUDIT_SECRET:-${quorum_runtime_secrets[5]}}"
export MUSE_ACTION_SECRET="${MUSE_ACTION_SECRET:-${quorum_runtime_secrets[6]}}"
export BID_VAULT_SECRET="${BID_VAULT_SECRET:-${quorum_runtime_secrets[7]}}"

# Seed only the public sample tender documents on first deploy. Runtime state,
# accounts, submissions, and audit history start clean and live on the disk.
SEED_TENDERS="$APP_DIR/deploy-seed/tenders"
if [ ! -d "$SEED_TENDERS" ]; then
  SEED_TENDERS="$APP_DIR/mini-services/quorum-mcp/data/tenders"
fi
if [ -d "$SEED_TENDERS" ]; then
  cp -Rn "$SEED_TENDERS"/. "$QUORUM_DATA_DIR/tenders/"
fi

bun "$APP_DIR/mini-services/quorum-mcp/index.ts" &
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

NEXT_SERVER="$APP_DIR/server.js"
if [ ! -f "$NEXT_SERVER" ]; then
  NEXT_SERVER="$APP_DIR/.next/standalone/server.js"
fi
node "$NEXT_SERVER" &
NEXT_PID=$!

set +e
wait -n "$SIDECAR_PID" "$NEXT_PID"
status=$?
set -e
exit "$status"
