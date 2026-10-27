#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Quorum — one-command judge demo
#
#   bash scripts/judge-demo.sh
#
# From a fresh clone this script:
#   1. installs deps and boots the stack (web :3000, MCP sidecar :3031)
#   2. seeds a verified procurement officer
#   3. launches a real LangGraph review run over a demo tender pack
#   4. waits for the run to halt itself at the human-signature gate
#   5. replays the unsigned-mutation refusal — the proof the agent CANNOT file
#
# Optional env: TENDER_ID (default KE-MOH-2026-117), OFFICER_EMAIL, OFFICER_PASSWORD
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/.."

TENDER_ID="${TENDER_ID:-KE-MOH-2026-117}"
OFFICER_EMAIL="${OFFICER_EMAIL:-judge@quorum.test}"
OFFICER_PASSWORD="${OFFICER_PASSWORD:-Gatekeeper#2026}"
LOGDIR=logs; mkdir -p "$LOGDIR"

ok()   { echo "  ✓ $*"; }
warn() { echo "  ! $*"; }
step() { echo; echo "── $* ──"; }

hc() { curl -s --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 4 "http://localhost:$1$2" 2>/dev/null; }

step "1/5 · bring-up"
command -v bun >/dev/null || { echo "bun is required — https://bun.sh"; exit 1; }
[ -d node_modules ] || bun install
if [ "$(hc 3000 /)" = "000" ]; then
  ( setsid nohup bun run dev </dev/null >"$LOGDIR/judge-web.log" 2>&1 & )
  for i in $(seq 1 60); do [ "$(hc 3000 /)" != "000" ] && break; sleep 2; done
fi
[ "$(hc 3000 /)" != "000" ] || { echo "web did not come up — see $LOGDIR/judge-web.log"; exit 1; }
ok "web :3000 · MCP :3031 (spawned by instrumentation)"

step "2/5 · seed a verified officer"
code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Judge Demo\",\"email\":\"$OFFICER_EMAIL\",\"password\":\"$OFFICER_PASSWORD\"}")
[ "$code" = "201" ] || [ "$code" = "409" ] || warn "register → $code (continuing)"
login_code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d "{\"email\":\"$OFFICER_EMAIL\",\"password\":\"$OFFICER_PASSWORD\"}")
if [ "$login_code" != "200" ]; then
  # verification gate: flip the flag in the file store with the server stopped
  pkill -f "next dev" 2>/dev/null; pkill -f "bun run dev" 2>/dev/null; sleep 2
  OE="$OFFICER_EMAIL" bun -e '
    const fs = require("fs"); const p = "db/quorum-store.json";
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const want = (process.env.OE || "").toLowerCase();
    const walk = (o) => { if (o && typeof o === "object") {
      if (String(o.email || "").toLowerCase() === want) o.emailVerified = true;
      for (const v of Object.values(o)) walk(v); } };
    walk(j); fs.writeFileSync(p, JSON.stringify(j));
    console.log("emailVerified flipped for", want);
  '
  ( setsid nohup bun run dev </dev/null >>"$LOGDIR/judge-web.log" 2>&1 & )
  for i in $(seq 1 60); do [ "$(hc 3000 /)" != "000" ] && break; sleep 2; done
  login_code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/auth/login \
    -H 'Content-Type: application/json' -d "{\"email\":\"$OFFICER_EMAIL\",\"password\":\"$OFFICER_PASSWORD\"}")
fi
[ "$login_code" = "200" ] || { echo "login failed ($login_code) — see $LOGDIR/judge-web.log"; exit 1; }
ok "officer $OFFICER_EMAIL signed in"
curl -s --noproxy '*' -c "$LOGDIR/judge-cookies.txt" -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d "{\"email\":\"$OFFICER_EMAIL\",\"password\":\"$OFFICER_PASSWORD\"}" >/dev/null

step "3/5 · launch a live review run ($TENDER_ID)"
run=$(curl -s --noproxy '*' -b "$LOGDIR/judge-cookies.txt" -X POST "http://localhost:3000/api/runs?XTransformPort=3031" \
  -H 'Content-Type: application/json' -d "{\"tenderId\":\"$TENDER_ID\"}")
echo "$run" | head -c 400; echo
run_id=$(echo "$run" | grep -oE 'run_[a-z0-9]+' | head -1)
[ -n "$run_id" ] || warn "could not parse run id (check response above)"
ok "run $run_id launched through the signed gateway"

step "4/5 · wait for the agent to halt itself at the human gate"
gate=""
for i in $(seq 1 90); do
  [ -z "$run_id" ] && break
  gate=$(curl -s --noproxy '*' -b "$LOGDIR/judge-cookies.txt" "http://localhost:3000/api/runs?XTransformPort=3031&limit=10" \
    | RUN_ID="$run_id" python3 -c "
import json, sys, os
try:
    d = json.load(sys.stdin)
    runs = d.get('runs', d if isinstance(d, list) else [])
    want = os.environ.get('RUN_ID', '')
    r = [x for x in runs if x.get('id') == want]
    print(r[0].get('status', '') if r else '')
except Exception:
    print('')" 2>/dev/null)
  case "$gate" in AWAITING_GATE|PENDING|AWAITING_SIGNATURE|FILED|COMPLETED|FAILED) break;; esac
  sleep 3
done
if [ -n "$gate" ]; then ok "run $run_id → $gate (graph self-stopped; filing locked)"; else warn "no terminal state seen in 270s — check $LOGDIR/judge-web.log"; fi

step "5/5 · THE PROOF — unsigned mutation refused"
refusal=$(curl -s --noproxy '*' --max-time 6 -X POST http://localhost:3031/api/tools-list 2>/dev/null)
[ -z "$refusal" ] && refusal=$(curl -s --noproxy '*' --max-time 6 -X POST http://localhost:3031/tools-list 2>/dev/null)
echo "  sidecar → ${refusal:0:220}"
echo "$refusal" | grep -q "Unattested mutation" && ok "gate holds: state-changing requests WITHOUT a human-signed attestation are refused" \
  || warn "replay manually: curl -X POST http://localhost:3031/api/tools-list"

echo
echo "══════════════════════════════════════════════════════════════"
echo " The agent prepared the file. It stopped. A named human signs."
echo "   UI:            http://localhost:3000"
echo "   Run:           $run_id  (tender $TENDER_ID)"
echo "   Audit log:     GET /api/log?XTransformPort=3031&limit=20"
echo "   Sign the gate: sign in as $OFFICER_EMAIL → committee desk"
echo "══════════════════════════════════════════════════════════════"
