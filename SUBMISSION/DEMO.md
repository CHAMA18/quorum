# DEMO — the 3-minute script

*One browser, one terminal, no edits. The most interesting moment is a refusal:
the gate rejecting the operator until a named human signs.*

**Pre-flight (before recording):**

1. `bun run dev` (web :3000) and `bun run mcp` (sidecar :3031) are running.
2. `.env.local` carries the model chain: `LLM_MODEL=muse-spark-1.3`,
   `LLM_BASE_URL=https://api.meta.ai/v1`, `MODEL_RESIDENCY=HYBRID`,
   `LLM_FALLBACK_MODEL=llama3.2:3b`, `LLM_FALLBACK_BASE_URL=http://localhost:11434/v1`.
   Start Ollama (`ollama serve`) so the in-region fallback is live.
3. The committee roll is quorate — the signed-in officer sits as the gavel, and
   enough roster members are marked PRESENT to meet the threshold (5 of 9 by
   default). A short roll is refused with HTTP 409: a useful beat, but it blocks
   the award moment.
4. **Tools & models** shows `MUSE-SPARK-1.3 · META MODEL API · HOSTED → LLAMA3.2:3B`
   and `residency HYBRID`. If it says `TEMPLATE FALLBACK`, fix the endpoint before
   recording — do not narrate a model that is not answering.
5. Have `SUBMISSION/evidence/scanned/nyamira-price-schedule-p58.png` ready to
   upload. It is a real page from Nyamira County tender CGN/T015/2024-2025.

---

## 0:00–0:20 — The desk

**Say:** "Public procurement is where public money leaks, and the leak starts at
the review desk: officers cross-checking hundreds of pages by hand. Quorum is the
agent that prepares the file — and a gate that stops it from doing anything
irreversible."

**Show:** landing page hero → scroll to the **live stack console**: five MCP tools
with their READ / WRITES / IRREVERSIBLE kinds, the third-party filesystem server,
the streaming audit log. Point at the model chip: Muse Spark plans and drafts;
Llama 3.2 is the in-region fallback.

## 0:20–1:15 — A real public record, not a toy pack

**Do:** Workspace → **New evaluation** → pick
`KE-KEMSA-2024-ONT08 — Supply of health technologies (cotton gauze, cotton wool
& tubes), framework awards` → launch.

**Say (over the live progress trail):** "This is a real PPRA award register:
eleven published awards from KEMSA, retrieved from the Open Contracting Data
Registry. Muse Spark read the inventory and chose the plan — value outliers and
budget checks first. The graph read both files over MCP, pinned the requirement,
and flagged five awards whose published values sit far above the median. Each
finding cites the OCDS path it came from."

**Point at:** a finding — `R-VALUE-OUTLIER`, supplier, `ocds-release.json,
ocds-5whusi-KEMSA/ONT08/2024-2026, bids.details[3].value` — and the audit line
that maps to it.

**Say the limit:** "The release publishes no line items, quantities or evaluation
record. So the desk says exactly that: the spread is a question for the committee,
not a finding of impropriety. It does not invent a unit price it cannot see."

**Point at the drafts:** "Two redlines, both written by Muse Spark. Four spans
were redacted before the hosted call — supplier names and amounts replaced. The
full pack never left the desk; if the hosted call fails, Llama 3.2 answers
in-region with the full evidence."

## 1:15–1:55 — The scan SAM can point at (and cannot read)

**Do:** open the tender's documents → upload
`nyamira-price-schedule-p58.png` → wait for the response.

**Say:** "This is a scanned page: a table, no embedded text. The graph cannot read
it, so it does not pretend to. SAM 3.1 locates the table region and returns a box
for a human to inspect. It does not read the table, and it does not authenticate
anything. The upload is marked `humanReviewRequired` whether SAM matches or not."

**Show:** the response / console line: `SAM located 1 matching region on page 1 —
human review required` and the box. If SAM returns zero matches, say: "Zero
matches is a valid answer; the scan is still stored and still marked for human
review."

## 1:55–2:40 — The gate refuses

**Do (terminal, side by side):** post the raw gate contract:

```bash
curl -s -X POST localhost:3031/api/gates/<GATE_ID>/decision \
  -H 'content-type: application/json' -d '{"decision":"APPROVE"}'
# → HTTP 422  "A named human is required — provide the approving officer's full name."

curl -s -X POST localhost:3031/api/gates/<GATE_ID>/decision \
  -H 'content-type: application/json' -d '{"decision":"APPROVE","approver":"Mallory Intruder"}'
# → HTTP 403  not a PRESENT member of the committee roster and not the signed-in officer
```

**Say:** "This is the thesis. The agent prepared everything — and the only path to
filing runs through a name the roster knows, with a quorum present. Not a prompt,
not a policy: the edge from the gate to filing does not exist in the graph. These
are HTTP status codes, not theatre."

**Do (browser):** Approvals → **Award** the run. Sign with your session identity,
complete the step-up, draw the wet-ink signature.

**Show:** sha-256 seal → `transmit_submission` → receipt written → run flips to
**FILED**, receipt ID (`SUB-…`) on the ledger.

## 2:40–3:00 — The record

**Do:** run register → expand the run → **SOURCED REPORT**.

**Say:** "The committee gets a citations-first report: the plan and why it focused
where it did, every finding with its evidence and file, the gate decision with the
approver's name, the full audit trail, and a model-attribution line — Muse Spark
planned and drafted both redlines, four spans were redacted, and here are the token
counts. The cost line is an explicit assumption, not a quote. If the endpoint is
down, the report says template mode and charges zero; it never claims model output
it did not get."

**Close:** "The agent prepares the file. The committee awards the tender. And every
step in between is one append-only line you can replay."

---

## If something breaks, say the honest thing

| Symptom | Line to say |
| --- | --- |
| Sidecar offline | "The web app self-heals it — `GET /api/mcp-ensure` respawns the sidecar; watch it come back." |
| Hosted Muse call fails | "The chain falls back to Llama 3.2 in-region — same graph, same gate, full evidence stays on the desk. The report names whichever model actually answered." |
| Both endpoints down | "That's template mode, by design: compliance logic is code; the model only plans depth and writes prose, and every draft and the report label the fallback instead of claiming model output." |
| SAM returns zero matches | "Zero matches is a valid outcome. The scan is stored, the upload is marked human-review-required, and the officer inspects it." |
| A run shows `FAILED` | "That's the audit trail doing its job — the error is on the run, the log line has the reason, and nothing was filed." |

## The refusal, as a shipped artifact

The refusals are kept as captured evidence, not as a video that may go stale:
**[`refusal-transcript.md`](./refusal-transcript.md)** holds the verbatim HTTP
bodies of the three beats (422 no-name, 403 name-not-on-the-roster, 503
fail-closed roster read) with the gate PENDING before, during and after —
nothing filed. Replay them live from any clone:

```bash
GATE=$(curl -s localhost:3031/api/gates | python3 -c "import json,sys;print([g['id'] for g in json.load(sys.stdin)['gates'] if g['status']=='PENDING'][0])")
curl -s -X POST localhost:3031/api/gates/$GATE/decision -H 'content-type: application/json' -d '{"decision":"APPROVE"}'
# → {"error":"A named human is required — provide the approving officer's full name.","code":422}
curl -s -X POST localhost:3031/api/gates/$GATE/decision -H 'content-type: application/json' -d '{"decision":"APPROVE","approver":"Mallory Intruder"}'
# → {"error":"Mallory Intruder is not a PRESENT member of the committee roster and is not the signed-in officer.","code":403}
```
