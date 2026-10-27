#!/usr/bin/env bash
# verify-llama-api.sh — probe a Meta Model API / Llama API key and, on success,
# drop a judge-facing evidence receipt into the repo.
#
# Usage:
#   bash verify-llama-api.sh <BASE_URL> <MODEL_ID> <API_KEY> [PROMPT]
#
#   BASE_URL   e.g. https://api.llama.com/compat/v1   (from your Meta dev console)
#   MODEL_ID   e.g. Llama-4-Maverick-17B-128E-Instruct-FP8
#   API_KEY    the LLM_... key (never written to any output file)
#
# On HTTP 200 writes:
#   quorum-build/SUBMISSION/meta-api-evidence/receipt-<UTC timestamp>.md
# On failure prints the masked error and exits 1 (no file written).

set -uo pipefail

BASE="${1:?usage: verify-llama-api.sh <BASE_URL> <MODEL_ID> <API_KEY> [PROMPT]}"
MODEL="${2:?missing MODEL_ID}"
KEY="${3:?missing API_KEY}"
PROMPT="${4:-Reply with exactly: QUORUM ONLINE}"
REPO="/home/z/my-project/quorum-build"
EVDIR="$REPO/SUBMISSION/meta-api-evidence"

mask() { printf '%s…%s' "${1:0:8}" "${1: -4}"; }
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "[$NOW] probing $BASE/chat/completions model=$MODEL key=$(mask "$KEY")"

RESP="$(curl -s --max-time 90 -w "\n%{http_code}" \
  "$BASE/chat/completions" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"$PROMPT\"}],\"max_tokens\":64}")"

HTTP="${RESP##*$'\n'}"
BODY="${RESP%$'\n'*}"

echo "--- HTTP $HTTP ---"
echo "$BODY" | head -c 1200
echo

if [ "$HTTP" != "200" ]; then
  echo "PROBE FAILED (HTTP $HTTP) — no evidence file written." >&2
  exit 1
fi

mkdir -p "$EVDIR"
OUT="$EVDIR/receipt-$(date -u +%Y%m%dT%H%M%SZ).md"
cat > "$OUT" <<EOF
# Meta Model API — live call receipt

- **When (UTC):** $NOW
- **Endpoint:** \`$BASE/chat/completions\`
- **Model:** \`$MODEL\`
- **Key:** \`$(mask "$KEY")\` (redacted)
- **Prompt:** \`$PROMPT\`

## Raw response (verbatim)

\`\`\`json
$BODY
\`\`\`

Call executed by \`scripts/verify-llama-api.sh\` during the hackathon window.
EOF
echo "RECEIPT WRITTEN: $OUT"
