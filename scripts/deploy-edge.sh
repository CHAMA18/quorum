#!/usr/bin/env bash
# Deploy the Cloudflare Worker that fronts the Quorum origin.
#
#   bash scripts/deploy-edge.sh
#
# Reads CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN from .env.local (never
# prints them). The worker's own runtime secret is EDGE_SHARED_SECRET, set with:
#
#   printf '%s' "$QUORUM_EDGE_SECRET" | npx wrangler secret put EDGE_SHARED_SECRET
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
. ./.env.local
set +a

: "${CLOUDFLARE_ACCOUNT_ID:?missing CLOUDFLARE_ACCOUNT_ID in .env.local}"
: "${CLOUDFLARE_API_TOKEN:?missing CLOUDFLARE_API_TOKEN in .env.local}"

cd workers/quorum-edge
exec npx --yes wrangler@latest deploy
