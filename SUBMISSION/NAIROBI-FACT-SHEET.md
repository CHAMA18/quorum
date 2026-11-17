# Quorum — Judging Fact Sheet (African Agentic AI Design Challenge, Nairobi Edition)

*Prepared for today's judging. Every number below names where a judge can re-derive it. Where something is simulated, unmeasured, or not yet contracted, it says so in the same sentence — per the framework's honesty rule (score what is built, not what is described).*

## One-line problem statement

**A procurement evaluation officer** at a **Kenyan county health procurement unit** (or KEMSA / Ministry of Health procurement desk) must **cross-check hundreds of pages of bids against tender requirements within a statutory 30-day window**, and today does it by manual line-by-line reading — which backlogs hospital supply tenders and leaves thin, hard-to-scrutinise award records.

---

## 1. Tool Integration & Interoperability (30%)

### Which integrations are live right now, and which are simulated?

| Integration | Status | What it does | Where to see it |
|---|---|---|---|
| `quorum-mcp` (own MCP server, Bun, `:3031`) | **LIVE** | Agent tool registry: read tender packs, extract requirements, flag findings, draft redlines, request filing. JSON-RPC 2.0 over HTTP (`initialize` · `tools/list` · `tools/call` · `ping`). | Workspace → Tools & models; `curl localhost:3031/mcp` with `tools/list` |
| `@modelcontextprotocol/server-filesystem` (official third-party) | **LIVE** | Sandboxed reads of the tender pack, path-jailed to `data/tenders/<ref>/`. One audit line per read — this is what makes "every finding cites its file" mechanical. | Run progress: "`tender_documents_list` — via server-filesystem MCP" |
| LangGraph.js review + filing graphs | **LIVE** | 8-node review graph halts at `propose_gate`; there is **no edge from the gate to filing**. Filing is a separate disconnected 2-node graph reachable only after a named human signs. | `SUBMISSION/05-agent-architecture.md`; run progress ends "review graph complete — the graph itself stops at the gate" |
| Cloudflare R2 tender storage + `quorum-edge` Worker | **LIVE** | Original tender bytes in private R2; 5-minute signed download URLs. Every upload/download appends a hash-chained `tender_upload` / `tender_download` audit line (or the response says `audited: false` / `x-quorum-audit: unavailable` rather than claiming a record). | Upload flow; Audit → Activity log |
| Upstash Redis REST rate limit | **LIVE** | Atomic fixed-window limit on requisition writes (20 / 15 min / user). **Fails closed** if Redis is unconfigured or down — the route refuses the write. | `POST /api/pipeline/:id/requisition` |
| Google OAuth + first-party accounts (PostgreSQL, scrypt, TOTP, step-up) | **LIVE** | Server-side role checks on every route and again at the sidecar gateway (HMAC attestation). Step-up re-auth at signing, bound to `{userId, gateId, documentHash}`. | Sign-in; gate signing dialog |
| Kira drafting (Llama 3.2 3B, `quorum-edge` Workers AI) | **LIVE (hosted)** | Open-weight endpoint at `https://quorum-edge.chungu424.workers.dev/v1` (`@cf/meta/llama-3.2-3b-instruct`). Verified answering 2026-11-16 (`docs/MODEL-HOSTING.md`). Hosted calls carry **redacted evidence only**; redaction count is recorded per draft. In-region Ollama and deterministic template fallbacks remain. | Run attribution table; `/api/health` names endpoint + residency |
| Email (Resend) + pilot intake `POST /api/contact` | **LIVE (pilot channel)** | Pilot requests stored in the workspace store; email sent when `RESEND_API_KEY` is set, otherwise the failure is reported and the request retained. | Landing → Get started |
| WhatsApp + Slack catalogue (Teams / Calendars / SharePoint) | **WhatsApp + Slack: ADAPTERS BUILT — credentials pending**; rest PLANNED | WhatsApp: template-first Cloud API adapter + signature-verified webhook (STOP/START, delivery/read receipts), honest `NO TEMPLATE` status. Slack: bot-token channel adapter (one post per event, desk deep link, no approve buttons) + signature-verified Events API and `/quorum` slash command for mute/unmute. Both send only once configured, otherwise logged SKIPPED. Teams/Calendars/SharePoint remain setup-requirements only. | Workspace → Integrations · bell footer · `docs/WHATSAPP-INTEGRATION.md` · `docs/SLACK-INTEGRATION.md` |
| National e-GP filing (Kenya PPIP / Rwanda UMUCYO) | **SANDBOX (simulated)** | `egp-portal (simulated)` — sealed sha-256 receipt written to `data/submissions/`, labelled `SIMULATED`. **No live national endpoint is called by Quorum.** Sample bid packs are synthetic (invented references, no real personal data); one regression pack (`KE-KEMSA-2024-ONT08`) is a real public award register (11 awards, no line items). | Receipt marked `SIMULATED`; README "Data reality" |

### Tool-call log for the run you just watched

Every call lands in the append-only, hash-chained `tool-log.jsonl` (`seq · ts · actor · tool · READ/WRITES/IRREVERSIBLE · inputs · outputs · status · durationMs`). The **Audit → Activity log** screen streams it with filters (actor / tool / status / kind / date), expandable inputs/outputs, JSON/CSV export, and a **Check activity log** verifier (`GET /api/log/verify` → `{ok, brokenAt, checked, lines}`). The chain continues across restarts (boot re-reads the log so the next append points at the last hash, never genesis). A measured template-mode run made **22 tool calls** (1 plan, 3 reads, 1 extract, 11 flag, 2 draft, 1 gate request + gate-decision probes) — `SUBMISSION/10-cost-and-audit.md` §2.

### What happens if a tool times out or errors?

- Desk reads use bounded timeouts (3–6 s) with `AbortSignal.timeout`; a timeout is reported to the model as a failed read ("The desk could not be read… Tell the officer the service is briefly unreachable rather than guessing") — never filled with a guess (`src/lib/desk-tools.ts`).
- The review graph's `verify_findings ⇄ revise_findings` loop refuses any finding whose anchor text is not in its cited document (bounded to 2 repair passes; deterministic re-anchoring first, model-assisted correction only when configured — and the model's proposal is re-verified by the same deterministic check). Every rejection/repair/drop is an audit line.
- A failed run is replayed from its beginning (no LangGraph node checkpoint resumption); expired job leases retry with bounded attempts/backoff. Upload/download paths report `audited: false` / `x-quorum-audit: unavailable` instead of claiming a record that does not exist.
- Model failure degrades honestly: hosted → in-region fallback → deterministic template, each draft labelled with the exact model string returned and its source. The planning safety floor (deep-value parsing can be added, never removed when bid values are present) is pinned by a committed test.

### What would it take to connect the institution's real system next week?

The e-GP transmission stub runs behind a single adapter boundary (`seal_bundle → transmit_submission`). Connecting a real Kenya PPIP / Rwanda UMUCYO (or Airtel Money / Moov Money, SMS/USSD, WhatsApp Cloud API) endpoint is: (1) obtain the portal's published API + credential issuance for the procuring entity, (2) configure the adapter with the entity's secret server-side (never in the browser — Integrations page states this explicitly), (3) run the existing gate (named human + roster + office + quorum + step-up) in front of `transmit_submission` unchanged, (4) keep computing the sha-256 receipt. No gate weakening is required; the human-approval topology is the integration contract. Timeline is gated by the entity's credential issuance, not by Quorum code.

### Which actions need human approval, and where are credentials stored?

- **Human approval required:** every irreversible act — filing (`file_gate_submission`), award, standstill notice, contract signature/variation/payment/completion, budget approval. The agent can only *request* filing (`gate_pending`); APPROVE additionally demands a **named** approver on the PRESENT roster (`422` without a name · `403` if not rostered · `409` if quorum unmet, with live count · `503` fail-closed if the roster can't be read), correct statutory **office**, and fresh **step-up auth**. REJECT returns the bundle to the agent (ledger records who returned it). The desk assistant (`src/lib/desk-tools.ts`) exposes **reads only** — it cannot sign, award, return, file, or summon.
- **Credentials:** all provider secrets live **server-side** (environment / secret store): `KIRA_API_KEY`, `EDGE_SHARED_SECRET`, `MCP_REMOTE_TOKEN`, `QUORUM_EDGE_SECRET`, `RESEND_API_KEY`, `DATABASE_URL`, Upstash tokens. The Integrations page and model config expose at most last-4 / masked keys. No key is committed to the repo (`.env.local` git-ignored; `bug-bounty` hygiene: secrets scan in CI).

---

## 2. Problem Relevance & Local Insight (20%)

### One-line problem statement

See the top of this sheet: evaluation officer · Kenyan county health procurement unit (measurable extension: KEMSA framework desk, Ministry of Health procurement) · manual page-by-page cross-check against a 30-day statutory clock, producing backlogs and thin audit records.

### The six checks

| Check | Answer (with source) |
|---|---|
| **Evidenced** | PPAD Act 2015 s.80(6): evaluation **must complete within 30 days** (2020 Regulations compress national/county stages toward 7 days) — an officer-side bottleneck is a compliance risk. Open Contracting Kenya dataset: **259,709 tenders** published. PPRA reviews **5,064 of 50,142** published notices (~10%) in one financial year, flagging 2,127. KEMSA runs multi-year framework tenders (e.g. `KEMSA/OIT04/2024-2026`) for countrywide distribution. Rwanda: UMUCYO is the single mandated portal (~200 entities, 5,000+ bidders). Full links in `SUBMISSION/09-fit.md` §3.5 + `SUBMISSION/01-problem-statement.md` (World Bank 17% of GDP; UNECA; ZPPA 203 entities / 71,102 suppliers; FIC cases with scope stated). |
| **Named user** | Procurement evaluation officer preparing a committee's file (downstream: committee members, accounting officer, internal audit as reader). `SUBMISSION/USER-VALIDATION.md` names the first intended user explicitly. |
| **Sized** | Volume is sized (259,709 tenders; PPRA's ~10% oversight coverage). **Human time is deliberately not claimed** — no controlled manual-vs-Quorum officer timing has been run (see §3). The pilot protocol (two officers, counterbalanced, stopwatch + screen recording) is pre-registered but has **zero completed observations**; publishing any hour-saved figure today would be fabrication. |
| **Today's workaround** | Manual reading + spreadsheets + paper registers: officer reads notice, bids, and price tables line by line, cross-checks missing documents / price outliers / spec deviations by eye, and types the committee report. It fails because high-volume packs exceed officer capacity inside the statutory window, citations are inconsistent, and oversight can re-read only ~10% of notices — so thin records stand unscrutinised. |
| **Local reality** | Jurisdiction rules, currencies (KES/ZMW/RWF), KRA PIN / ZPPA validation, and statutory offices are modelled per-country (same engine reviews KE + RW packs unchanged). Connectivity/data-cost: the deterministic rule path (0 tokens) and template fallback work with **no model endpoint at all**; in-region Llama 3.2 3B runs on a 4 GB-RAM CPU box with zero data leaving the desk; hosted calls send redacted evidence only. The product is web-first (desktop officers); phone/SMS/USSD review is **planned, not claimed** — see rollout. Kenya Data Protection Act posture and retention are in `docs/governance-policy.md` / `docs/records-retention.md`. |
| **Why agentic (not a form/chatbot/spreadsheet)** | One outcome requires chaining: list pack over MCP → plan review depth → extract SHALL clauses → run five deterministic rule families → verify each finding against its cited document (with bounded repair) → draft redlines per flagged clause → halt at the gate → seal + receipt. A form cannot read 200 pages, a chatbot cannot verify citations against source bytes, and a spreadsheet cannot enforce "no citation, no finding" or stop itself from filing. The plan, the verification loop, and the topology-enforced halt are the agentic work. |

### Who did we speak to?

**No officer has been contacted yet.** That is stated as fact in `SUBMISSION/09-fit.md` §3/§5 and `SUBMISSION/11-pilot-outreach.md` (three outreach texts drafted — Ministry of Health KE, KEMSA, PPRA — status: drafted, not yet sent). The evidence offered today is therefore **cited public evidence** (laws, regulator reports, datasets), not field interviews. The pre-registered pilot protocol is published so judges can verify we will not invent the baseline later.

### Before → after workflow

|  | Today (manual) | With Quorum (live) |
|---|---|---|
| Read the pack | Officer opens every file, in order, by eye/Find | Agent lists the pack via sandboxed MCP, reads each document (one audit line each) |
| Pin requirements | Officer re-types SHALL/must clauses into notes | `extract_requirements` pins SHALL clauses, budget ceiling, deadline with page refs |
| Check bids | Officer eyeballs missing docs, price outliers, spec deviations; inconsistent citations | Deterministic rules flag + **verify refuses any finding whose anchor text isn't in its cited document** |
| Draft the file | Officer types clarifications/redlines from scratch | Model drafts `{proposed, rationale}` per flagged clause (or labelled template fallback), with tokens/latency recorded |
| Decide | Committee reads officer's typed summary | Agent **halts at HUMAN GATE**; named rostered officer with office + quorum + step-up signs; sha-256 sealed receipt + audit export |

---

## 2.5 Accuracy — what '95%' means here (best metric per surface)

For procurement review the best primary metric is **recall**: a missed material issue can produce an improper award; a false flag costs an officer minutes. "Accuracy" is the wrong metric for this task (most bidder×rule pairs are negatives — flagging nothing scores deceptively high). Precision is the secondary metric (officer trust); mutation detection measures sensitivity behind the recall number.

**Review engine (deterministic, `mini-services/quorum-mcp/data/eval/report.json`, regenerated by `bun eval.ts`):** recall on labels the rule set claims to cover = **100% (39/39)**; recall on all labels = **97.6% (41/42)** after adding the licence-expiry rule below; mutation detection = **100% (27/27)**; precision = **87.2%** — a lower bound: 4 of its 6 unlabelled findings are STRICT-checklist missing-document flags the single-reviewer labeller never recorded, and no second reviewer has adjudicated them, so precision may be higher than measured and is reported as a floor. Single-reviewer, single-pass labels throughout (`report.json` header). Stability is 7/7 tenders byte-identical across repeats; held-out recall (covered) is 100% (12/12).

**Engine changes made for Nairobi:** (1) fixed the eval harness's bidder matching (file slug vs cover-page display name were hiding one tender's detection — KE-NCB-104293's detections were real and miscounted as misses; recall 97.4→100, mutation 88.9→100, precision 84.4→87.2 with no engine behaviour change on that step); (2) added `R-LICENCE-EXPIRED` (`cycle.ts licenceFindings`, wired into `flagPack` with a verbatim-line self-check in `verifyFinding`) catching a licence line whose own words say expired/pending before closing — both expired-licence misses now caught (recall-all 92.9→97.6, findings 45→47), with "valid through <future>" never flagged. One miss remains (Radiation Protection Board approval-in-review — semantic state, no licence wording; deliberately left uncovered rather than overfit).

**Tender Builder (screenshot surface):** best metric is per-field accuracy. The deterministic composer (not the model) owns facts; the model only refines and `preferVerbatim` keeps composer values. Frozen bench (`bun scripts/tender-bench.ts`, 13 briefs × 49 field checks, expectations written before fixes): baseline **77.6% (38/49)** → after fixes **100% (49/49)** on that set: added KSh/RWF/UGX/TZS currencies, long-form shillings, space-grouped thousands ("412 600 000"), fixed "6 months" (plural suffix), county-prefixed buyers ("county health department"), cold-chain category, consultancy-first precedence ("Consultancy to design …"), and US-order date fallback when day/month is impossible (D/M/Y precedence kept). Adversarial negatives verified: quantities ("12 ambulances") never become budgets. The system prompt's Zambia-only wording was generalised to the buyer's regime (KE/RW/ZM names). Honest limit: this is a small frozen set measuring the deterministic layer; model refinement quality and officer-judged brief quality remain unmeasured until piloted.

## 3. Feasibility & Cost-to-Serve (20%)

### Working prototype

Live at the deployed workspace (sign in with the seeded judge account `judge@quorum.test` / `Gatekeeper#2026` — verified, no email needed). **Judge's 5-minute path:** run the KEMSA pack → read the sourced report → watch the agent halt at the gate; signing without fresh step-up is refused **403**. Locally: `bash scripts/judge-demo.sh` boots the stack, seeds a verified officer, runs a real review, waits for the agent to halt at the gate, then replays the unsigned-mutation refusal. The review handles unscripted packs (upload → extract → stage → run ships for PDF/DOCX/XLSX/text with bounded Tesseract OCR for scans); unsupported files get an explicit `UNSUPPORTED` / "needs OCR" state, never a silent drop. Production integration evidence (single fictional Zambia tender, two bids, gate refusals 401/403 → authorised 200 with verified simulation receipt) is in `SUBMISSION/evidence/current-run/proof.json`.

### Tokens per answer (measured from logs, model named)

| Path | Tokens per completed outcome | Model | Source |
|---|---|---|---|
| Deterministic rule path (0 model calls) | **0 in / 0 out** | none — rules only | `mini-services/quorum-mcp/data/eval/report.json` (regenerated 2026-10-27) |
| Live LLM planning + drafting (6 audited runs: 3 packs × 1 + demo pack × 3 repeats) | **291–348 total per run**; 1,529 prompt / 661 completion across 6 runs | `llama3.2:1b` (local Ollama, CPU-only) | `mini-services/quorum-mcp/data/eval/live-llm-audit.json` (regenerable offline via `bun live-audit.ts`) |
| Proof run (fictional ZM pack, 1 draft) | **1,259 total** (273 prompt + 986 completion) | `muse-spark-1.3` (Meta Model API, hosted) | `SUBMISSION/evidence/current-run/proof.json` (`run_1ece5c92`) |
| Current hosted default (Kira) | per-draft tokens recorded on every draft + run attribution (`promptTokens`/`completionTokens`); visible in Tools & models and Tender Builder session usage | `@cf/meta/llama-3.2-3b-instruct` (Workers AI) | Live run UI; run report "Model attribution" table |

Run-to-run variance is **published, not hidden**: same-pack rule findings are byte-identical across repeats; draft wording varies (distinct draft sets across repeats) — both halves measured. Median model-call latency 6,975 ms (range 4,222–16,263 ms across 13 calls, CPU-only); hosted Kira ~0.7 s warm. See `SUBMISSION/10-cost-and-audit.md` §4.

### Cost per completed outcome (USD, with working shown)

"Outcome" = one tender first-pass review parked at the gate with a downloadable sourced report. Formula: `cost = Σ (prompt_tokens + completion_tokens) × endpoint price/token` **+ amortised infra + human-review share**. Token counts are in `tool-log.jsonl` — any auditor can recompute.

- **Model tokens (hosted Kira, Llama 3.2 3B on Workers AI):** list price **$0.0509 / M input, $0.335 / M output** (Cloudflare Workers AI, https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct, checked 2026-11-17). At the audited average (≈255 in + ≈110 out per run): 255×$0.0509/10⁶ + 110×$0.335/10⁶ ≈ **$0.00005 per outcome**. At the proof run (273 + 986): ≈ **$0.0003 per outcome**. **Token cost is sub-cent in every measured case.**
- **In-region / template mode:** token cost **exactly $0**.
- **Amortised infra (labelled assumption, not a bill):** EC2 origin (`af-south-1`) + CloudFront + R2 + Redis + Worker at an assumed **$60–150 / month** single-instance demo footprint. At a pilot assumption of **20 outcomes / month / unit**: **$3.00–$7.50 per outcome** — the stack has no per-outcome metered fee (R2/Redis are sub-cent per outcome; Workers AI sits inside the neuron free allocation up to 10,000 neurons/day). At 200 outcomes/month (10×) the same footprint amortises to $0.30–$0.75; at 2,000/month (100×) to $0.03–$0.08, before any capacity upgrade. **Model + tool fees are negligible; fixed infra amortisation is the cost-to-serve line.** Any hosted-frontier draft path (e.g. Muse Spark) is priced the same way from its per-run token log — the repricing helper multiplies logged tokens by whichever endpoint price list applies.

### Optimisation and latency levers

- Deterministic-first architecture: rules do the compliance work (0 tokens); the model only plans depth and drafts prose. No model call can create or close a rule finding.
- Smaller / in-region model for drafting (Llama 3.2 3B — 2 GB at Q4_K_M, 4 GB RAM), frontier drafting as an opt-in admin switch; plan clamps `maxDrafts` and focus-rules.
- Two repair passes max; redaction-bounded excerpts; no vector store / no embedding bill.
- Weak connection / SMS: the rule path + template fallback need **no model endpoint**; documents stage asynchronously with honest "needs OCR" states. A full SMS/USSD review channel is planned (rollout, §5), not claimed live.

### What was built during the sprint vs reused

Reused foundation: review desk, MCP engine, audit spine. In-window (Oct 26 – Nov 4, 2026): gate-refusal transcript (2026-10-27, gate `gate_753w2e`, all five refusal layers), rule-path eval report + live-LLM audit (six live runs on `llama3.2:1b`), design pass (commit `4ce6048`), Meta advisory integration (2026-11-04). Every evidence artifact carries an in-window date and a committed regeneration command (README "Project provenance").

---

## 4. User Value & Willingness to Pay (15%)

### User's cost today

An evaluation officer's manual first pass costs **officer time inside a 30-day statutory window** (the compliance risk of missing it), **late-stage correction** when thin records are challenged, and **oversight effort** — PPRA re-reads only ~10% of notices, so weak files stand until a supplier complains or an auditor samples them. **No shilling figure for officer time is claimed** — the pilot will measure active minutes under the pre-registered protocol (`SUBMISSION/09-fit.md` §3).

### Value gap with the agent (formula, not a promise)

```
value per outcome = (manual officer-minutes − Quorum officer-minutes) × loaded officer cost/min
                    + avoided correction/re-review effort
                    + avoided statutory-breach risk
```

The pilot publishes both minute counts (manual stopwatch vs measured agent + correction time) and then evaluates this formula with the unit's own loaded cost. Until then, the only honest price statement is a **pilot hypothesis** (below), not a savings claim.

### Who pays, and from which budget

The **procuring entity** (county health procurement unit / KEMSA / ministry procurement department) — annual workspace subscription from the **procurement operations / ICT systems budget line**, subject to that entity's purchasing rules. Suppliers do **not** pay (no bidder fee, which would be an integrity risk). Citizens do not pay. Donor-funded CPD/genesis pilots are possible but the subscription model must stand when a grant ends — hence no donor dependency in the price below.

### Pilot price hypothesis (for validation, not a quote)

- **First 3 tender reviews: no cost** (already live on the landing page and pricing section) — this is the willingness-to-pay experiment, tracked as pilot intake (`POST /api/contact`).
- **Hypothesised steady price: $25 per completed outcome (first-pass review + sourced report) OR $499 / unit / month (up to 40 outcomes), whichever the pilot unit prefers.** This sits **3–8× above amortised infra at pilot volume** ($3–$7.50/outcome, §3) so the margin survives support and onboarding, and **2–5× below** the plausible value of even a small officer-time saving at a loaded officer cost — to be validated against the measured minutes, not asserted.
- **Evidence of willingness to pay today: none, and it says so.** No pilot signed, no LOI, no paying customer (`SUBMISSION/USER-VALIDATION.md`). What exists is the live intake channel, the pre-registered protocol, and three drafted outreach texts awaiting sending. If a donor pays, the same per-outcome price applies from day one so grant end does not strand the desk.

---

## 5. Scalability & Sustainable Impact (15%)

### Margin per outcome at pilot / 10× / 100× (model from §3 + §4 hypotheses)

Assumes the hosted-Kira token line (≈$0.0001/outcome — negligible at any scale) and the $60–150/month footprint before capacity upgrades. Capacity (`single-instance` → managed DB/object store/queue) is the linear riser; human review is the oversight riser (see below).

| | Pilot (1 unit, ~20 outcomes/mo) | 10× (~200/mo) | 100× (~2,000/mo) |
|---|---|---|---|
| Price / outcome (per-outcome billing) | $25.00 | $25.00 | $25.00 |
| Token cost | $0.00–$0.0003 | $0.0001 | $0.0001 |
| Amortised infra / outcome | $3.00–$7.50 | $0.30–$0.75 | $0.03–$0.08 (+ capacity programme) |
| Support/onboarding allowance / outcome | $5.00 (assumption) | $3.00 | $1.50 |
| **Margin / outcome** | **≈ $12.50–$17.00 (50–68%)** | **≈ $21.00–$21.70 (84–87%)** | **≈ $23.00+ (90%+ gross; net after oversight staffing)** |

### Cost curve — what gets cheaper, what doesn't

- **Falls with scale:** infra amortisation per outcome; hosted token line is flat-negligible; shared prompt/rule maintenance.
- **Does not fall:** officer/committee human-minutes per outcome (the gate scales linearly — by design; throughput comes from retiring the manual first pass, not from removing humans); per-entity onboarding, jurisdiction rule packs, and records/retention compliance; any future SMS/USSD channel fees (metered per message — budgeted per alert, never per approval).

### Rollout path (named, not claimed)

1. **Pilot:** one consenting Kenyan county health procurement unit (primary target), KEMSA framework desk as the high-volume comparator, PPRA as the audit-trail reviewer — outreach drafted, **not yet sent** (`SUBMISSION/11-pilot-outreach.md`).
2. **National:** other Kenyan county units via the same jurisdiction pack; Rwanda extension proven by the unchanged RW sample pack (portability claim).
3. **Regional:** other Central/East African jurisdictions via OCDS field mapping + rule packs (currency, validation, statutory offices) — the multi-portal design already models this.
4. **Channels:** web desk first; WhatsApp deep-link alerts (never approvals) — adapter built, going live gated by Meta template approval + credential issuance; Slack team-channel alerts — adapter built, going live gated by workspace app + bot credentials; then SMS/USSD review summaries for low-connectivity officers — planned, gated by provider credential issuance.

### Oversight and impact metrics (with baselines)

| Metric | Baseline | Pilot target | How tracked |
|---|---|---|---|
| Review time reduction (first-pass) | **Unmeasured** (protocol pre-registered) | ≥ 50% | Readiness screen `pilotMetrics` (run durations vs manual log) |
| Flagged-finding precision / mutation detection | Eval-lab gold labels | precision ≥ 85% · mutation 100% | `bun eval.ts` + mutation suite |
| Citation coverage | — | 100% of findings carry a source citation | Run register (findings with citations / total) |
| Human overrides | — | measured, every override carries a stated reason | REJECTED gates + finding rejections |
| Audit completeness | — | 100% chain verified | `GET /api/log/verify` |
| Time to award recommendation | Cycle timestamps | measured, trending down | closing → signed report |

Human review keeps up with volume because the agent's job is to make the manual first pass a **verification task** (confirm/reject cited findings) rather than a reading task — the pilot measures whether that holds. No impact on hospital-supply outcomes is claimed until a pilot measures it.

---

## Appendix — Unit-economics quick view (Criteria 3 + 4 + 5)

| Line | Pilot (measured where marked) |
|---|---|
| **Tokens / outcome** | 0 (rule path) · 291–348 (live LLM audit, `llama3.2:1b`) · 1,259 (proof run, `muse-spark-1.3`) |
| **Model cost / outcome (hosted Kira)** | ≈ $0.00005 – $0.0003 (Workers AI list: $0.0509 in / $0.335 out per M) |
| **Full cost / outcome** | $0 token + $3.00–$7.50 infra @ 20/mo (assumption stated in §3) |
| **Value formula** | (manual min − Quorum min) × loaded cost/min + correction/compliance avoidance — minutes **unmeasured until pilot** |
| **Price hypothesis** | 3 free, then $25/outcome or $499/unit/mo; payer = procuring entity operations/ICT budget |
| **WTP evidence** | **None yet** — intake live, outreach drafted not sent, no LOI (stated plainly) |
| **Margins** | pilot ≈ 50–68% · 10× ≈ 84–87% · 100× ≈ 90%+ gross (see §5 table) |

*Appendices linked from the judging criteria (Section 7) point to a Google Doc ("The Unit Economics Teams Must Bring"). This fact sheet is the team's submission of the same numbers with repo-verifiable sources; the Google Doc was not accessible from this environment during preparation, so no figure here depends on it.*
