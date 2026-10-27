# The gate refusals — captured artifacts

*The gate's refusals are the product's thesis, so they are kept as evidence
rather than as screenshots. Every body below is verbatim JSON from a live
run, replayable from any clone with the commands shown. Nothing here is
staged: each refusal happens before any state changes, so the gate stays
PENDING and nothing is filed.*

**Captured:** 2026-10-27 — during the Meta Global AI Developer Hackathon 2026
build window (Oct 26 – Nov 4, 2026). Sidecar `quorum-mcp` on :3031, gate
`gate_753w2e`, raised by review run `run_055c076c` on the sample tender
`KE-KCS-2026-042` (status PENDING before, during and after every capture —
approver field still null). The fail-closed refusal (§5) was captured on a
throwaway sidecar instance — copied data dir, port 3039, roster URL pointed
at a dead port — because the refusal must not depend on breaking the live
deployment.

The stack is signed end-to-end, so the refusals stack in layers: an unsigned
caller cannot reach the gate at all (§1), a signed-in caller cannot file
without a name (§2), a name is worthless unless the roster knows it (§3),
a caller cannot borrow someone else's identity (§4), and nobody can approve
when the roster itself cannot be read (§5).

---

## 1 — Unattested mutation (HTTP 401)

```bash
curl -s -X POST localhost:3031/api/gates/gate_753w2e/decision \
  -H 'content-type: application/json' \
  -d '{"decision":"APPROVE"}'
```

```json
{
  "error": "Unattested mutation — state-changing requests must arrive through the gateway, signed by the session that owns them. Sign in (a verified session is accepted) and retry."
}
```

State changes arrive through one door: the web gateway derives the actor from
a verified session and seals every mutating forward with an HMAC over
`method|path|actor|ts`. A bare curl to the sidecar is not a policy violation
waiting to happen — it never reaches the decision code.

## 2 — No name, no filing (HTTP 422)

```bash
# signed-in session, no approver name in the body
curl -s -X POST "localhost:3000/api/gates/gate_753w2e/decision?XTransformPort=3031" \
  -H 'content-type: application/json' \
  -d '{"decision":"APPROVE"}'
```

```json
{
  "error": "A named human is required — provide the approving officer's full name.",
  "code": 422
}
```

The graph cannot reach the filing nodes without a decision, and a decision
without a name is not a decision.

## 3 — A name the register does not know (HTTP 403)

```bash
curl -s -X POST "localhost:3000/api/gates/gate_753w2e/decision?XTransformPort=3031" \
  -H 'content-type: application/json' \
  -d '{"decision":"APPROVE","approver":"Mallory Intruder"}'
```

```json
{
  "error": "Mallory Intruder is not a PRESENT member of the committee roster and is not the signed-in officer.",
  "code": 403
}
```

The roster at capture time: `Dr. Chanda Mwale` (PRESENT, chair),
`Eng. Bwalya Phiri` (PRESENT), plus the signed-in officer holding the gavel.
An intruder's name matches none of them, so the edge from the gate to filing
refuses. Not a prompt, not a policy — a roster check before anything changes.
(The refusal is written to the append-only audit log at
`2026-10-27T08:54:42.118Z`, `kind: GATE_DECISION`, status `ERROR`.)

## 4 — An identity you cannot claim (HTTP 403)

```bash
curl -s -X POST "localhost:3000/api/gates/gate_753w2e/decision?XTransformPort=3031" \
  -H 'content-type: application/json' \
  -d '{"decision":"APPROVE","approver":"Dr. Chanda Mwale","signedInAs":"Dr. Chanda Mwale"}'
```

```json
{
  "error": "The gateway's attested session is not who this request claims to be — signedInAs is server-attested and cannot be declared in the body."
}
```

Even a name that IS on the roster is refused when the request tries to
declare who it is: the actor comes from the verified session, never from the
body. A client-declared identity is refused loudly, not silently remapped.
(Audit log: `2026-10-27T08:54:42.171Z`.)

## 5 — Fail closed when the roster cannot be read (HTTP 503)

```bash
# throwaway instance: own data dir, port 3039, roster URL pointed at a dead port
QUORUM_DATA_DIR=<copy>/data/ QUORUM_WEB_URL=http://127.0.0.1:9999 \
  bun mini-services/quorum-mcp/index.ts

# the request must still carry the gateway's HMAC seal to pass the mutation guard
curl -s -X POST localhost:3039/api/gates/gate_753w2e/decision \
  -H 'content-type: application/json' \
  -H "x-quorum-actor: Procurement Officer" \
  -H "x-quorum-ts: <epoch-ms>" \
  -H "x-quorum-attest: <hmac-sha256 of 'POST|/api/gates/gate_753w2e/decision|Procurement Officer|<epoch-ms>'>" \
  -d '{"decision":"APPROVE","approver":"QA Reviewer"}'
```

```json
{
  "error": "The committee roster could not be read — approval refused.",
  "code": 503
}
```

Even a sealed, signed-in officer is refused when the roster cannot be read:
the check fails closed. An unreachable record never becomes a silent yes.

---

## Replaying these from a fresh clone

`bun run dev` (web :3000 — instrumentation spawns the sidecar :3031); sign in,
run a review to raise a gate, seed at least one PRESENT committee member
(`POST /api/committee/members`), then:

```bash
GATE=$(curl -s localhost:3031/api/gates | python3 -c "import json,sys;print([g['id'] for g in json.load(sys.stdin)['gates'] if g['status']=='PENDING'][0])")
curl -s -X POST localhost:3031/api/gates/$GATE/decision -H 'content-type: application/json' -d '{"decision":"APPROVE"}'
curl -s -X POST "localhost:3000/api/gates/$GATE/decision?XTransformPort=3031" -H 'content-type: application/json' -d '{"decision":"APPROVE","approver":"Mallory Intruder"}'
```

Expected: 422, then 403 — with the gate still PENDING and nothing filed.
The refusal bodies in this file were captured through the same commands,
in that order, on 2026-10-27.
