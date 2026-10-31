#!/usr/bin/env bash
# Redeploy the Quorum web app on the EC2 origin.
#
# Run this ON the EC2 host, from the repository checkout:
#
#   bash scripts/redeploy-ec2.sh
#
# It stops the web service, builds the Next standalone server, verifies that
# the Muse routes are actually in the build, starts the services again and
# probes the routes. The previous .next is kept as .next.prev and restored if
# the build, the start or the probes fail.
#
# Overrides (export before running):
#   APP_DIR=/home/ubuntu/quorum   WEB_SERVICE=quorum-web   MCP_SERVICE=quorum-mcp
#   APP_PORT=3000                 PULL=1                    SKIP_INSTALL=1
#   KEEP_PREV=0                   HEALTH_TIMEOUT=90
#   PULL_REMOTE_URL=https://github.com/CHAMA18/quorum.git PULL_BRANCH=main
#
# The code must already be in APP_DIR. This script does not rsync or commit;
# PULL=1 only does a fast-forward git pull.
set -Eeuo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
WEB_SERVICE="${WEB_SERVICE:-quorum-web}"
MCP_SERVICE="${MCP_SERVICE:-quorum-mcp}"
APP_PORT="${APP_PORT:-3000}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${APP_PORT}}"
PULL="${PULL:-0}"
PULL_REMOTE_URL="${PULL_REMOTE_URL:-https://github.com/CHAMA18/quorum.git}"
PULL_BRANCH="${PULL_BRANCH:-main}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"
KEEP_PREV="${KEEP_PREV:-1}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"

cd "$APP_DIR"

say() { printf '\n== %s\n' "$*"; }

PREV=".next.prev"
ROLLBACK_ARMED=0
SERVICE_WAS_STOPPED=0

restore_previous() {
  set +e
  if [ -d "$PREV" ]; then
    say "Restoring the previous build"
    rm -rf .next
    mv "$PREV" .next || printf 'warning: could not restore %s\n' "$PREV" >&2
  fi
  if [ "$SERVICE_WAS_STOPPED" = "1" ]; then
    say "Starting ${WEB_SERVICE} with the previous build"
    $SUDO systemctl start "$WEB_SERVICE" || true
  fi
}

fail() {
  printf '\nERROR: %s\n' "$*" >&2
  if [ "$ROLLBACK_ARMED" = "1" ]; then
    trap - ERR
    restore_previous
  fi
  exit 1
}

on_error() {
  status=$?
  trap - ERR
  if [ "$status" -ne 0 ]; then
    printf '\nRedeploy failed (exit %s).\n' "$status" >&2
    if [ "$ROLLBACK_ARMED" = "1" ]; then
      restore_previous
    fi
  fi
  exit "$status"
}
trap on_error ERR

[ -f package.json ] || fail "package.json not found in $APP_DIR (set APP_DIR)"
command -v bun >/dev/null 2>&1 || fail "bun is not installed or not on PATH"
command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v systemctl >/dev/null 2>&1 || fail "systemctl is required; run this on the EC2 host"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="${SUDO-sudo}"
fi

if [ "$PULL" = "1" ]; then
  say "Fetching ${PULL_BRANCH} from ${PULL_REMOTE_URL} (fast-forward only)"
  git -C "$APP_DIR" fetch --no-tags "$PULL_REMOTE_URL" "$PULL_BRANCH"
  git -C "$APP_DIR" merge --ff-only FETCH_HEAD
fi

if [ "$SKIP_INSTALL" != "1" ]; then
  say "Installing dependencies"
  bun install --frozen-lockfile
fi

say "Stopping ${WEB_SERVICE}"
$SUDO systemctl stop "$WEB_SERVICE"
SERVICE_WAS_STOPPED=1
ROLLBACK_ARMED=1

if [ -d .next ]; then
  say "Keeping the previous build at ${PREV}"
  rm -rf "$PREV"
  mv .next "$PREV"
fi

say "Building the standalone server"
bun run build

say "Verifying the Muse routes are present in the standalone build"
for route in chat speak transcribe; do
  path=".next/standalone/.next/server/app/api/muse/${route}/route.js"
  [ -f "$path" ] || fail "missing ${path} — the build does not expose /api/muse/${route}"
  echo "  ok  /api/muse/${route}"
done

say "Starting ${WEB_SERVICE}"
$SUDO systemctl start "$WEB_SERVICE"

if systemctl cat "$MCP_SERVICE" >/dev/null 2>&1; then
  say "Restarting ${MCP_SERVICE}"
  $SUDO systemctl restart "$MCP_SERVICE"
else
  echo "  (no ${MCP_SERVICE} unit; the web service boots the sidecar)"
fi

say "Waiting for ${BASE_URL} (up to ${HEALTH_TIMEOUT}s)"
deadline=$((SECONDS + HEALTH_TIMEOUT))
root_code=000
while [ "$SECONDS" -lt "$deadline" ]; do
  root_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$BASE_URL/" 2>/dev/null || echo 000)
  [ "$root_code" = "200" ] && break
  sleep 2
done

if [ "$root_code" != "200" ]; then
  printf '\nThe app did not answer 200 on / within %ss (last: %s).\n' "$HEALTH_TIMEOUT" "$root_code" >&2
  fail "the new build did not serve the homepage"
fi

say "Probing the Muse routes (404 means an old build is still serving)"
for route in chat speak transcribe; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -X POST \
    -H 'content-type: application/json' --data '{}' \
    "$BASE_URL/api/muse/${route}" 2>/dev/null || echo 000)
  printf '  /api/muse/%-10s %s\n' "$route" "$code"
  if [ "$code" = "404" ] || [ "$code" = "000" ]; then
    fail "/api/muse/${route} is not being served (HTTP ${code})"
  fi
done

if [ "$KEEP_PREV" != "1" ] && [ -d "$PREV" ]; then
  rm -rf "$PREV"
fi

ROLLBACK_ARMED=0
trap - ERR

say "Redeploy complete"
echo "  build:    $(cat .next/BUILD_ID)"
echo "  service:  ${WEB_SERVICE}"
echo "  routes:   /api/muse/{chat,speak,transcribe} are served"
if [ -d "$PREV" ]; then
  echo "  rollback: rm -rf .next && mv .next.prev .next && sudo systemctl restart ${WEB_SERVICE}"
fi
