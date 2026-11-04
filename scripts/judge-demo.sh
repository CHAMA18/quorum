#!/usr/bin/env bash
# Isolated fictional Zambia demonstration. Never stops another app or edits its store.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v bun >/dev/null || { echo 'Bun is required: https://bun.sh'; exit 1; }
[ -d node_modules ] || bun install --frozen-lockfile
exec bun scripts/judge-proof.ts --keep-server "$@"
