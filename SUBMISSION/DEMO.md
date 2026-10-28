# DEMO — the 3-minute script

*One browser, one terminal, no edits. The demo is designed so the most interesting
moment is a refusal: the gate rejecting the operator until a named human signs.*

**Pre-flight (before recording):** `bun run dev` (web :3000) + `bun run mcp`
(sidecar :3031) running; landing page open; Workspace open in a second tab;
the committee roll is quorate — the signed-in officer sits as the gavel, and
enough roster members are marked PRESENT to meet the configured threshold
(5 of 9 by default). A short roll is refused with HTTP 409, which is a useful
demo beat but blocks the award moment. Confirm **Tools & models** shows
`LLAMA3.2:3B · OLLAMA · LOCAL`; if it says `TEMPLATE FALLBACK`, start Ollama
(`ollama serve`) and check `LLM_BASE_URL` / `LLM_MODEL` before recording.

---

## 0:00–0:25 — The desk

**Say:** "Public procurement is where public money leaks, and the leak starts at the
review desk: officers cross-checking hundreds of pages by hand. Quorum is the agent
that prepares the file — and a gate that stops it from doing anything irreversible."

**Show:** landing page hero → scroll to the **live stack console**: five MCP tools
with their READ / WRITES / IRREVERSIBLE kinds, the third-party filesystem server's
14 tools, the streaming audit log ticking.

## 0:25–1:20 — The run

**Do:** Workspace → **New evaluation** → pick the sample tender
`KE-KCS-2026-042` → launch.

**Say (over the live progress trail):** "Watch the plan node: the agent inspected the
pack — two markdown bid values and a published ceiling — so it turned on deep value
parsing and put over-budget first. Now every document is read over MCP, requirements
pinned, findings flagged — each one citing its file — and the self-check confirmed
nine of nine in their cited documents. Two redlines drafted, over-budget first,
because the plan said so."

**Point at:** a finding's citation (`03-bid-coastline-screening.md, bid value line`)
and the audit line it maps to.

## 1:20–2:20 — The gate refuses (the failure bridge)

**Do (terminal, side by side):** post the raw gate contract:

```bash
curl -s -X POST localhost:3031/api/gates/<GATE_ID>/decision \
  -H 'content-type: application/json' -d '{"decision":"APPROVE"}'
# → HTTP 422  "A named human is required — provide the approving officer's full name."

curl -s -X POST localhost:3031/api/gates/<GATE_ID>/decision \
  -H 'content-type: application/json' -d '{"decision":"APPROVE","approver":"Mallory Intruder"}'
# → HTTP 403  not a PRESENT member of the committee roster and not the signed-in officer
```

**Say:** "This is the whole thesis. The agent prepared everything — and the only path
to filing runs through a name the roster knows, with a quorum present. Not a prompt,
not a policy: the edge from the gate to filing does not exist in the graph. These
refusals are HTTP status codes, not theatre." (503 fail-closed when the roster can't
be read; 409 when the roll is short.)

**Do (browser):** in the Approvals board, click **Award** on the run you just watched.
The gate signs with **your session identity** — the named human on the record.

**Show:** sha-256 seal → `transmit_submission` → receipt written → run flips to
**FILED**, receipt ID (`SUB-…`) on the ledger.

## The refusal, as a shipped artifact

The refusals are kept as captured evidence, not as a video that may go stale:
**[`refusal-transcript.md`](./refusal-transcript.md)** holds the verbatim HTTP
bodies of all three beats (422 no-name, 403 name-not-on-the-roster, 503
fail-closed roster read) with the gate PENDING before, during and after —
nothing filed. Replay them live from any clone:

```bash
GATE=$(curl -s localhost:3031/api/gates | python3 -c "import json,sys;print([g['id'] for g in json.load(sys.stdin)['gates'] if g['status']=='PENDING'][0])")
curl -s -X POST localhost:3031/api/gates/$GATE/decision -H 'content-type: application/json' -d '{"decision":"APPROVE"}'
# → {"error":"A named human is required — provide the approving officer's full name.","code":422}
curl -s -X POST localhost:3031/api/gates/$GATE/decision -H 'content-type: application/json' -d '{"decision":"APPROVE","approver":"Mallory Intruder"}'
# → {"error":"Mallory Intruder is not a PRESENT member of the committee roster and is not the signed-in officer.","code":403}
```

The 503 (fail-closed when the roster cannot be read) needs a throwaway
sidecar with an unreachable roster URL — the exact recipe is in the
transcript. During the recording, play these beats live at 1:20–2:20; if a
take goes wrong, re-run them — they are deterministic and mutate nothing.

## 2:20–3:00 — The record

**Do:** run register → expand the run → **SOURCED REPORT**.

**Say:** "The committee gets a citations-first report: the review plan and why deep
parsing was on, every finding with its evidence and file, the gate decision with the
approver's name, the full audit trail, and a model-attribution line — Llama 3.2 wrote
both drafts, with the token counts — plus an honest cost line. If the endpoint is down,
the report says template mode and charges $0; it never claims model output it did not get."

**Close:** "The agent prepares the file. The committee awards the tender. And every
step in between is one append-only line you can replay."

---

## If something breaks, say the honest thing

| Symptom | Line to say |
| --- | --- |
| Sidecar offline | "The web app self-heals it — `GET /api/mcp-ensure` respawns the sidecar; watch it come back." |
| Firebase popup blocked | "Firebase is an optional mirror — the local scrypt session carries the demo." |
| LLM not configured or Ollama down | "That's template mode, by design: compliance logic is code; the model only plans depth and writes prose, and every draft and the report label the fallback instead of claiming model output." |
| A run shows `FAILED` | "That's the audit trail doing its job — the error is on the run, the log line has the reason, and nothing was filed." |
