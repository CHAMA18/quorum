# Agent Capabilities

> **Which capabilities does your agent demonstrate?**
> Planning · Reasoning · Decision support · Tool/API calling · Data retrieval · Multi-step execution · Workflow automation · Monitoring · Recommendation generation · Information synthesis

---

## The one-line version

**Quorum's agent demonstrates all ten — with the deepest evidence in tool calling, multi-step execution and workflow automation, and a deliberately narrow model role (it drafts prose; code makes the compliance calls).**

Each capability below is mapped to the exact place in the system that implements it — so every claim is checkable against the repo, not asserted.

| Capability | Demonstrates it? | Where in Quorum — the concrete evidence |
| --- | --- | --- |
| **Planning** | ✔ (scoped) | The agent's plan is not improvised per turn — it is the **review graph's choreography** (`load → extract_requirements → flag_findings → verify_findings → draft_redlines → propose_gate`), which decides *what is still owed* at each step: clauses pinned, bids parsed, verification pass, drafts produced. Planning is honest here because it is *structural* — reproducible and auditable rather than model-improvised. |
| **Reasoning** | ✔ (deterministic core + LLM prose) | Two layers: (1) **deterministic compliance reasoning** — the price-outlier rule (peer-median ×2), missing-doc and deviation rules, and the `verify_findings` node that re-checks each finding against its cited document before it surfaces; (2) **model reasoning** — `draft_redline` asks the configured LLM for a `{proposed, rationale}` clause and the rationale is recorded. The system is explicit about which layer does what, so hallucinated findings *cannot* reach the committee. |
| **Decision support** | ✔✔ (the product's core) | Everything the agent produces exists to support one human decision: cited findings, pinned requirements, drafted redlines, run progress, and the **HUMAN GATE queue** where a named committee member signs on the strength of that file. The gate *is* the decision-support deliverable. |
| **Tool/API calling** | ✔✔ | A real **MCP tool registry** with typed input schemas, served over JSON-RPC 2.0 (`initialize` · `tools/list` · `tools/call`): the agent calls `tender_documents_list`, `extract_requirements`, `flag_finding`, `draft_redline`, `file_gate_submission`; *external MCP clients* can call the same registry remotely; and the official third-party filesystem MCP server is consumed over stdio via the SDK client for every document read. Every call lands in the append-only audit log. |
| **Data retrieval** | ✔ | Document retrieval through the path-jailed filesystem MCP (`data/tenders/<ref>/` — notices, bids, OCDS records), with structured *extraction* on top: SHALL/must clauses with page estimates, bid line items with the **source filename as the citation**, and parsed OCDS values. The `request_source` queue then lets the agent request *new* data sources (e.g. a beneficial-ownership registry) it doesn't yet have. |
| **Multi-step execution** | ✔✔ | An 8-node review graph (plan_review + bounded reason-and-retry included) + a separate 2-node filing graph, with durable state (`state.json`) persisting across steps — a run carries its requirements, findings, drafts and a human-readable progress trail mid-graph, and resumes cleanly from disk after restart. |
| **Workflow automation** | ✔✔ | The officer's whole routine is automated end-to-end: upload tender files → launch run → requirements/findings/drafts produced live → submission parked at the human gate → named sign-off → sha-256 seal → filing → receipt written → run flips to FILED — no step requires manual glue. |
| **Monitoring** | ✔✔ | First-class, not bolted on: the **append-only `tool-log.jsonl`** (actor, tool, kind, inputs, outputs, duration, status per call), `/api/health` (uptime, fs-MCP connection state, graph + gate/run counts), the streaming live-stack console on the landing page, the run register with progress trails, and the gate queue with signed/unsigned states — every layer has a monitoring surface. |
| **Recommendation generation** | ✔ | `draft_redline` produces specific committee-ready **recommendations** — a proposed clause plus a written rationale — targeted at each flagged defect; `flag_finding` itself recommends *what to fix and where it's documented*. Recommendations are always evidence-tied: no rule emits a finding without a citation (enforced by the test suite). |
| **Information synthesis** | ✔ | The run object synthesizes heterogeneous material — requirements, per-bid values, OCDS records, findings, drafts — into one coherent committee file, with a progress narrative and a receipt bundle (sha-256) that ties the whole story together. | 

## The honest boundaries

- **Planning is structural, not spontaneous.** The agent doesn't invent a plan per run — and we argue that's the *stronger* agentic claim for procurement: the graph makes the plan auditable and makes the missing-edge safety guarantee possible. Anything the model improvised could never promise "the edge to filing does not exist".
- **The generative layer is currently the template fallback on the live deployment.** With no `LLM_BASE_URL` configured, `draft_redline` drafts from the deterministic template; capabilities and agency are unaffected, prose quality is. Wiring an in-region open-weights endpoint upgrades that layer only.
- **"Recommendation generation" never crosses into "decision".** Every recommendation stops at the gate — the agent frames the decision; the named human makes it.

---

## The tender-cycle build (waves 1-3) — capabilities across the full cycle

The ten capabilities above are demonstrated by the review desk. The cycle build
extends the same architecture across the procurement cycle, with the same
discipline: deterministic rules make the compliance calls, the model drafts
prose, and nothing irreversible happens without a named human whose office
matches the gate.

| Cycle phase | What the agent does | Where the human signs |
| --- | --- | --- |
| Pipeline & authoring | `add_pipeline_entry`, `draft_specification` (LLM/template), `draft_notice` + mandatory-field check | `publish_notice` (procurement unit, simulated portal) |
| Solicitation fairness | `log_clarification`, `issue_addendum` — an addendum inside the 7-day window must move the closing, or it is flagged | — (logged, rule-enforced) |
| Bid opening | `record_bid_opening` — late bids rejected unopened, statutory minutes composed | `record_bid_opening` gate (procurement unit) |
| Evaluation | `build_evaluation_matrix` (weights must sum to 100, financial formula lowest-price-100), `open_alb_dossier` (5-working-day clock) | COI declarations (all PRESENT members) + `certify_evaluation` gate (evaluation committee) |
| Award | `draft_award_report` (statutory composer from the certified matrix), `publish_award_notice` | `sign_award_report` + `publish_award_notice` gates (accounting officer) |
| Standstill & debrief | standstill clock (10 working days), `draft_debrief` per unsuccessful bidder — qualitative, no confidential prices | `issue_debrief` gate (accounting officer) |
| Contract | `prepare_contract_pack`, variations (≥10% of contract value hits the gate), `certify_payment`, `record_contract_completion` | `sign_contract_pack`, `approve_variation`, `certify_payment`, `record_contract_completion` gates (accounting officer) |
| Complaints | `log_complaint` (standstill-window marked), 14-working-day response clock | `respond_complaint` gate (accounting officer) |
| Oversight read-side | analytics computed from the append-only log; the consolidated procurement file (every artifact, hash, signature, chain verdict) | — (read-only) |

New integrity rules joined the review set: `R-BID-SECURITY` (floor % of bid value,
validity margin beyond closing), `R-DEBARMENT-HIT` (bidder names screened against
the seeded debarment register at flag time). The workspace gained the **Tender
cycle** view: eight phase tabs, the gate queue renders every gate kind with the
office that must sign, and the committee register carries each member's office.
