#!/usr/bin/env bash
# Deploy the Cloudflare Worker that fronts the Quorum origin.
#
#   bash scripts/deploy-edge.sh
#
# Reads CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN and both Worker secrets
# from .env.local; none of their values are printed.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
. ./.env.local
set +a

: "${CLOUDFLARE_ACCOUNT_ID:?missing CLOUDFLARE_ACCOUNT_ID in .env.local}"
: "${CLOUDFLARE_API_TOKEN:?missing CLOUDFLARE_API_TOKEN in .env.local}"
: "${QUORUM_EDGE_SECRET:?missing QUORUM_EDGE_SECRET in .env.local}"
: "${MCP_REMOTE_TOKEN:?missing MCP_REMOTE_TOKEN in .env.local — generate a strong random bearer token}"

cd workers/quorum-edge
printf '%s' "$QUORUM_EDGE_SECRET" | npx --yes wrangler@latest secret put EDGE_SHARED_SECRET
printf '%s' "$MCP_REMOTE_TOKEN" | npx --yes wrangler@latest secret put MCP_REMOTE_TOKEN
exec npx --yes wrangler@latest deploy
