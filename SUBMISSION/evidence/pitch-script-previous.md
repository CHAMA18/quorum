# Quorum — pitch script

**3-minute judge pitch · 60-second elevator · 30-second cut · Q&A prep**

Written for a live hackathon pitch (or a recorded voiceover). The timings are guides, not a stopwatch. If you are pitching an investor or a pilot desk instead of judges, use the variants at the end.

**The one line to leave in the room:**

> The agent prepares the file. The committee awards the tender.

---

## Before you speak: the spine

| Beat | What the audience should feel |
| --- | --- |
| **The clock** | This is a real, statutory bottleneck — not a generic “AI for documents” story. |
| **The read** | The agent does the work a desk cannot scale: every page, every citation. |
| **The limit** | The system is honest about what the record does not contain. That is the trust hook. |
| **The gate** | The agent is powerful *and* structurally powerless over the irreversible step. |
| **The ask** | One real desk, one timed pilot. Not a fake traction claim. |

**Never say:** “autonomous procurement,” “replaces the committee,” “live e-GP integration,” “X% faster,” or “in production.” Every one of those is either false or unmeasured.

**Alternative cold open (demo-first rooms):** “The most important button in Quorum is the one the agent cannot press.” Then go straight to the clock. Do not use both openings.

---

# The 3-minute pitch

## 0:00–0:22 · The clock

**SAY**

> Across Africa, public procurement averages about 17% of GDP. In Zambia, ZPPA recorded 203 procuring entities and 71,102 suppliers on e-GP at the end of 2023.
>
> In follow-up assessments of 25 entities, 13 were non-compliant and none fully compliant. Those visits are not a national rate.
>
> The bottleneck is the work before the decision: reading, checking and recording the evidence.

**DO**

Stand still. No slide yet. Let “not a national rate” land for one beat.

**SLIDE 1**

> **17% of GDP. 203 entities. One evidence-linked desk.**
> Quorum — agentic tender review

---

## 0:22–0:42 · What Quorum is

**SAY**

> Quorum is an agentic review desk for public procurement. An agent reads the file, extracts the requirements, flags what doesn’t reconcile, and drafts committee-ready redlines. Every finding carries its source.
>
> Then it stops — because filing an award is irreversible, and that is not the agent’s decision to make.

**DO**

Cut to the workspace, not a slide. Let them see the product early.

**SLIDE 2**

> **The agent prepares the file.**
> **The committee awards the tender.**

---

## 0:42–1:30 · A real public record, and its limit

**SAY**

> To show what a cited review looks like, I’m using a public test record from Kenya: KEMSA’s 2024 award register, with eleven published awards. It is a test dataset, not a Zambian procurement.
>
> Muse Spark reads the inventory and chooses the plan — value outliers and budget checks first. The graph reads both files over MCP and flags five awards whose published values sit far above the median. Each finding cites its exact OCDS path.
>
> Now notice what it refuses to do. This record publishes no line items and no quantities. So the desk says so. It does not invent a unit price. It does not call the spread fraud. It raises a question for the committee.
>
> Knowing what it cannot see is the point.

**DO**

- Open the pre-run KEMSA evaluation. **Do not run it live from zero** — the model call takes ~23 seconds and dead air kills the pitch.
- Point at one finding: the supplier, the value, the `ocds-release.json` path.
- Point at the limitation line. Pause before “Knowing what it cannot see is the point.”

**SLIDE 3**

> **No citation, no finding.**
> Real KEMSA register · 11 awards · 5 cited value outliers

---

## 1:30–1:54 · The model chain

**SAY**

> Two redlines were drafted by Muse Spark on Meta Model API. Before the hosted call, four spans were redacted — supplier names and amounts never left the desk.
>
> If the hosted call fails, Llama 3.2 answers in-region with the full pack. If neither answers, a template drafts and labels itself. It never claims a model it didn’t use.

**DO**

Point at the model chip or the attribution table: **MUSE-SPARK-1.3 · META MODEL API · HOSTED → LLAMA3.2:3B**. Then at the redaction count.

**SLIDE 4**

> **Muse Spark 1.3** plans and drafts
> **Llama 3.2** answers in-region
> **Template** as the honest last resort
> Redacted before egress · attribution recorded

---

## 1:54–2:25 · The gate refuses

**SAY**

> Now the part that matters most. The review is finished. The agent proposes the award — and stops.
>
> There is no edge in the graph from the gate to filing. Not a prompt. Not a policy. The edge does not exist.
>
> Watch what happens when someone tries to approve without a name.

**DO — terminal, side by side**

```bash
curl -s -X POST localhost:3031/api/gates/<GATE_ID>/decision \
  -H 'content-type: application/json' -d '{"decision":"APPROVE"}'
# → 422: "A named human is required — provide the approving officer's full name."

curl -s -X POST localhost:3031/api/gates/<GATE_ID>/decision \
  -H 'content-type: application/json' \
  -d '{"decision":"APPROVE","approver":"Mallory Intruder"}'
# → 403: not a PRESENT member of the committee roster
```

**SAY**

> Refused: a named human is required. Try a name the roster doesn’t know. Refused: not a present committee member.
>
> Then a quorum. Then a fresh step-up. Only then is the bundle sealed with SHA-256 and receipted.
>
> The agent prepared everything. It cannot award anything.

**DO — browser**

Approvals → sign with your session identity → complete the step-up → show the seal and receipt. If time is tight, stop on the refusal. The refusal is the pitch.

**SLIDE 5**

> **The edge does not exist.**
> 422 no name · 403 wrong name · 409 no quorum
> Named signer → step-up → SHA-256 seal → receipt

---

## 2:25–2:50 · The close

**SAY**

> That’s Quorum. The agent prepares the file. The committee awards the tender.
>
> We’ve built the desk, the MCP server, the gate, and the audit trail. What we need next is one real evaluation desk for a timed pilot — because the number that matters isn’t how fast the agent reads. It’s how much faster a committee can decide, and explain why.

**DO**

Stop moving. Say the tagline slowly. Hold eye contact. Do not add “thank you” immediately — let the last sentence sit. The final ten seconds are silence; do not fill them.

**SLIDE 6**

> **The agent prepares the file.**
> **The committee awards the tender.**
>
> One pilot desk. One timed comparison. Both numbers published — or the pilot says why not.

---

## If the demo breaks

| Failure | Say this | Then |
| --- | --- | --- |
| App or sidecar is down | “The gate is the product — here is the captured refusal, replayed from the repo.” | Show `SUBMISSION/refusal-transcript.md` or the backup clip. |
| Hosted model call fails | “The chain falls back to Llama 3.2 in-region — same graph, same gate, full evidence stays on the desk.” | Point at the fallback path. Do not claim Muse answered. |
| Both models down | “That is template mode by design. Compliance logic is code; the model only plans depth and writes prose.” | Show the template label. |
| KEMSA run is missing | “I have the same evidence in the sourced report.” | Open the report, not a blank screen. |
| A judge challenges the e-GP claim | “The transmission is a labeled stub. Sealing, quorum, step-up, and receipts are real.” | Offer `SUBMISSION/09-fit.md` §5. |

**Always have ready:** the live app on a pre-run KEMSA evaluation, a pending gate, a terminal at the repo root, the refusal transcript, and a 40-second backup screen recording. Never debug on stage.

---

# The 60-second version

> Across Africa, public procurement averages about 17% of GDP. In Zambia, ZPPA recorded 203 procuring entities and 71,102 suppliers on e-GP at the end of 2023. In a separate set of 25 follow-up assessments, 13 were non-compliant and none fully compliant; that is not a national rate.
>
> Quorum is an agentic review desk. It reads tender documents over MCP, extracts requirements, flags issues with citations, and drafts committee redlines with Muse Spark. A public KEMSA register from Kenya is the test record in this demo, not a Zambian tender.
>
> Then it stops. Filing an award is irreversible, so the graph has no edge to filing. A named human signs, with quorum present, and the bundle is sealed with SHA-256 and receipted.
>
> We’ve run it on a real KEMSA award register — eleven awards, five cited findings — and it tells you what it cannot see. The agent prepares the file. The committee awards the tender.
>
> We’re looking for one pilot desk to measure the difference.

**Timing:** ~55 seconds at a normal pace. Pause after “Then it stops.”

---

# The 30-second version

> African public procurement averages 17% of GDP. In Zambia, 203 procuring entities and 71,102 suppliers were registered on e-GP at the end of 2023. Quorum reads tender packs, flags what doesn’t reconcile with citations, and drafts committee redlines with Muse Spark — then stops.
>
> The graph has no edge to filing. A named human signs, quorum present, and the award is sealed and receipted.
>
> The agent prepares the file. The committee awards the tender.

**Use when:** someone asks “what do you do?” in a hallway, not on stage.

---

# Optional beats (for a 4–5 minute slot)

Add one or two, never all three.

### The scan — SAM 3.1

> This page is a scan: a table, no embedded text. The graph cannot read it, so it doesn’t pretend to. SAM 3.1 locates the table region and returns a box for a human. It doesn’t read the table, and it doesn’t authenticate anything. Every scan is marked human-review-required.

**Why it works:** it shows the model is used where it is actually reliable — localization, not interpretation.

### The record — sourced report

> The committee gets a citations-first report: the plan and why it focused where it did, every finding with its evidence and file, the gate decision with the approver’s name, the full audit trail, and a model-attribution line. If the endpoint is down, the report says template mode and charges zero. It never claims model output it didn’t get.

**Why it works:** auditability is the product, not a feature.

### The cycle — beyond evaluation

> The same gate holds across the wider cycle: clarifications, opening, evaluation, award, standstill, contract, payments, variations, complaints. Every phase that can bind the institution declares the office that must sign. The evaluation desk is where we start; the guarantee is the through-line.

**Why it works:** shows the product is a platform, not a one-screen demo.

---

# Q&A prep

Answer in two or three sentences, then stop. A long answer sounds defensive.

### “Isn’t this just an LLM reading PDFs?”

> No. The compliance logic is deterministic code; the model plans review depth and drafts prose. Every finding must carry a file-path citation — the test suite enforces “no citation, no finding” — and the model never gets a path to filing.

### “How do you stop hallucinations?”

> Findings come from rules over parsed documents, not free text, and every claim carries its source. Model output is labeled and attributed, and the fallback chain ends in a deterministic template. On the KEMSA register, the desk explicitly says it cannot test unit-price reasonableness because the record has no line items.

### “What did you actually measure?”

> Agent time, not human savings. The rule path runs in under two milliseconds per pack; the full template-mode graph takes 0.15 seconds; the live Muse run on KEMSA took 22.8 seconds with two drafts and four redactions. We have not timed a human desk — the pilot pre-registers that comparison, and we won’t quote a number we didn’t measure.

### “Why Meta models?”

> Muse Spark 1.3 plans the review and drafts the redlines. Llama 3.2 is the in-region fallback when the hosted call fails, and SAM 3.1 locates table regions on scans for human review. The chain is model-agnostic — one environment change — and the product boots without a secret.

### “What about data sovereignty?”

> Hosted calls are redacted: supplier names and amounts are replaced before egress. The in-region path sees the full pack. Residency and the model that actually answered are printed in health, the run record, and the report.

### “Is the e-GP filing real?”

> The transmission is a labeled stub. The sealing, quorum, step-up, and receipt are real. A live national connector is roadmap, not a claim.

### “Who pays?”

> The procuring entity — a ministry, county health unit, or authority like KEMSA. We start with a free pilot of up to three tender reviews, then an institutional plan scoped to review volume, integrations, data residency, and support. Oversight bodies are the second buyer because they consume the audit trail.

*If your actual commercial terms change, update this answer before you use it.*

### “What’s the moat? Anyone can call the same model.”

> The moat isn’t the model. It’s the structural gate, the procurement rules, the audit trail, and the workflow. A competitor can call the same API; they can’t retrofit a no-edge guarantee or a signed quorum record onto a demo.

### “What happens when the model is wrong?”

> A finding is a question, not a decision. The officer accepts or rejects it, and the report records the decision and the evidence. The agent does not score, rank, or award.

### “What’s next?”

> One pilot desk, a timed baseline, and live connectors. The protocol is pre-registered: two experienced officers, the same pack, a stopwatch and a screen recording — both numbers published, or the pilot says the comparison could not be run.

### “Why not just use a generic procurement platform?”

> Those platforms store the file. Quorum reads it. The differentiated act is the cited first pass plus the irreversible gate — not another place to upload documents.

### If you don’t know

> I don’t have that measured. Here’s how we would measure it in the pilot.

That answer is stronger than a guess. Use it.

---

# Claims: use and avoid

| Use | Avoid |
| --- | --- |
| “A real KEMSA award register — 11 published awards” | “Deployed at KEMSA” |
| “The e-GP transmission is a labeled stub” | “Integrated with Kenya’s e-GP” |
| “Agent time measured; human time is the pilot” | “80% faster” or any unmeasured saving |
| “A named human signs, with quorum” | “The AI awards the tender” |
| “Five review tools over MCP” | “Fully autonomous procurement” |
| “The pilot has not run yet” | “In production” or “live with officers” |
| “Designed for Kenya and Rwanda” | “Available across Africa” |

**Test counts:** do not quote a number unless you reran `bun test` that morning. The repo has changed since earlier counts. If asked, say what the suite *enforces*, not how many tests exist.

---

# Delivery notes

- **Pace:** 145–160 words per minute. The script is ~385 spoken words; at 155 wpm that is about 2:30, leaving ~30 seconds for the gate beats, two pauses, and the closing silence.
- **Pauses that matter:** after “It’s arithmetic.” After “Then it stops.” After “The edge does not exist.” After the 422. After the tagline.
- **Hands:** keep them still during the problem. Use them only to point at the finding, the model chip, and the terminal.
- **Voice:** do not sell “AI.” Sell the desk, the evidence, and the refusal. The technology is the how, not the headline. If you built it solo, say “I” in the close — the indie track rewards it. Do not switch mid-script.
- **The refusal is the demo.** If you only get one live moment, make it the 422/403. Do not trade it for a dashboard tour.
- **Do not apologize for the stub or the missing pilot.** Label them once, plainly, and move on. Calm honesty reads as confidence.
- **Close:** say the tagline to a person, not to the slide. Then stop.

---

# Audience variants

### Investor / accelerator

Keep the 3-minute spine, then replace the close with:

> The wedge is the evaluation desk: a statutory clock, a high-volume document workflow, and an audit artifact oversight bodies already want. The expansion is the wider cycle — award, standstill, contract, variations, complaints — with the same named-human gate. The next milestone is one real pilot and the first live connector.

Add: buyer, pilot scope, institutional pricing, and the path to recurring revenue. Do not claim traction you do not have.

### Pilot desk / procurement officer

Lead with the desk, not the model:

> Give us one published pack you have already closed. We will run it beside your existing file, time both, and publish the comparison — including if it shows we are slower. You keep the citations, the report, and the audit trail either way.

Then show the gate. Officers trust a system that cannot award more than one that promises to be right.

### Technical judges

Spend more time on:

- The MCP server: five review tools, typed schemas, read/write/irreversible kinds.
- LangGraph.js: load → extract → flag → verify → draft → propose the gate; the filing edge does not exist.
- The gate: session identity, roster, quorum, step-up, SHA-256 seal, receipt.
- The rule engine: peer-median outliers, missing documents, spec deviations, over-ceiling bids, publisher mess.
- The eval harness: held-out packs, pre-registered baseline.

Then one sentence on the model chain. Do not let the model eat the architecture story.

---

# One-paragraph version (for a program or submission form)

> Quorum is an agentic review desk for public procurement. Evaluation committees wade through tender packs of hundreds of pages by hand; backlogs delay hospital supplies, and thin award documentation lets fraud go unchallenged. Quorum’s agent reads every document over MCP, extracts the requirements, raises cited findings, and drafts committee-ready redlines with Muse Spark 1.3 on Meta Model API — with Llama 3.2 in-region as the fallback. Then it stops: filing an award is irreversible, so the review graph contains no edge to filing. A roster-verified named human signs, with quorum present, and only then is the bundle sealed with SHA-256 and receipted. The demo runs on a real KEMSA award register, and it says plainly what the record cannot show. The agent prepares the file. The committee awards the tender.

---

# Source notes

Facts in this script are drawn from:

- `META_HACKATHON.md` — model chain, KEMSA run, 22.8 s, 4 redactions, 2 drafts, gate behavior.
- `SUBMISSION/09-fit.md` — 30-day statutory clock, PPRA coverage, KEMSA target office, pilot protocol, honest limits.
- `SUBMISSION/DEMO.md` — demo order, gate refusal status codes, report contents.
- `SUBMISSION/refusal-transcript.md` — captured 422 / 403 / 503 bodies.
- `SUBMISSION/01-problem-statement.md` and `03-solution.md` — problem framing and product description.

**Before you deliver:** re-check the live demo, the model chip, and the gate ID. If the app says `TEMPLATE FALLBACK`, do not narrate Muse Spark — switch to the fallback line or fix the endpoint first.
