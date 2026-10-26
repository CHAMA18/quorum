# The gate refusals — captured artifacts

*The gate's refusals are the product's thesis, so they are kept as evidence
rather than as screenshots. Every body below is verbatim JSON from a live
run, replayable from any clone with the commands shown. Nothing here is
staged: each refusal happens before any state changes, so the gate stays
PENDING and nothing is filed.*

**Captured:** 2026-10-20, sidecar `quorum-mcp` on :3031, gate `gate_kx8lgd`
(status PENDING before, during and after every capture — approver field
still null). The 503 was captured on a throwaway sidecar instance pointed at
an unreachable roster URL, because the refusal must not depend on breaking
the live deployment.

---

## 1 — No name, no filing (HTTP 422)

```bash
curl -s -X POST localhost:3031/api/gates/gate_kx8lgd/decision \
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

## 2 — A name the register does not know (HTTP 403)

```bash
curl -s -X POST localhost:3031/api/gates/gate_kx8lgd/decision \
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
`Eng. Bwalya Phiri` (EXCUSED), plus the signed-in officer holding the gavel.
An intruder's name matches none of them, so the edge from the gate to filing
refuses. Not a prompt, not a policy — a roster check before anything changes.

## 3 — Fail closed when the roster cannot be read (HTTP 503)

```bash
# throwaway instance: own data dir, port 3039, roster URL pointed at a dead port
QUORUM_DATA_DIR=<copy>/data/ QUORUM_WEB_URL=http://127.0.0.1:9999 \
  bun mini-services/quorum-mcp/index.ts

curl -s -X POST localhost:3039/api/gates/gate_kx8lgd/decision \
  -H 'content-type: application/json' \
  -d '{"decision":"APPROVE","approver":"QA Reviewer","signedInAs":"QA Reviewer"}'
```

```json
{
  "error": "The committee roster could not be read — approval refused.",
  "code": 503
}
```

Even the signed-in officer is refused when the roster cannot be read: the
check fails closed. An unreachable record never becomes a silent yes.

---

## Replaying these from a fresh clone

`bun run mcp` (sidecar :3031) + `bun run dev` (web :3000); run a review to
raise a gate, then:

```bash
GATE=$(curl -s localhost:3031/api/gates | python3 -c "import json,sys;print([g['id'] for g in json.load(sys.stdin)['gates'] if g['status']=='PENDING'][0])")
curl -s -X POST localhost:3031/api/gates/$GATE/decision -H 'content-type: application/json' -d '{"decision":"APPROVE"}'
curl -s -X POST localhost:3031/api/gates/$GATE/decision -H 'content-type: application/json' -d '{"decision":"APPROVE","approver":"Mallory Intruder"}'
```

Expected: 422, then 403 — with the gate still PENDING and nothing filed.
The refusal bodies in this file were captured through the same commands.
