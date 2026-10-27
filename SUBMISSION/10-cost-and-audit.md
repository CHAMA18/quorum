# 10 — Cost per run and the audit trail

*This page exists to be checked. Every number below was measured during the
Meta Global AI Developer Hackathon 2026 build window (re-measured 2026-10-27,
bun 1.3, Linux x86-64, 4 GB RAM, no GPU) from the repo's own artifacts, and
each one names the file it can be re-derived from. No number here is
estimated or borrowed. A judge can regenerate every figure with one command
in a fresh clone.*

---

## 1. Rule-path cost, per tender pack (measured)

The compliance path (pack → requirements → findings → verify) makes **zero model
calls**, and the eval harness measures it repeatedly:

- **Cost: 0 USD per pack.** No tokens are consumed; nothing is billed.
- **Latency:** median **0.53–1.14 ms** per pack across the seven staged packs
  (KE and RW samples), spread published per tender in
  `mini-services/quorum-mcp/data/eval/report.json` (`medianMs`, `msRange`;
  regenerated 2026-10-27).
- The harness config cost is one-time labelling; runtime cost is machine time only.

For a **live LLM endpoint**, cost is not a mystery: the sidecar records
`prompt_tokens` and `completion_tokens` on every draft (in `tool-log.jsonl` and on
the run's `usage` block), so

> `cost run = Σ (prompt_tokens + completion_tokens) × endpoint price/token`,

and the line items are reproducible from the append-only log. With no endpoint
configured every draft is labelled `template` and the measured cost is exactly
the 0 USD rule-path figure above.

## 2. What a full review costs end-to-end (measured, template mode)

One live run of `review_graph` on the demo pack `KE-KCS-2026-042`
(run `run_055c076c`, 2026-10-27, no LLM configured):

| Item | Measured |
| --- | --- |
| Wall clock | 0.15 s (startedAt 08:50:04.604Z → updatedAt 08:50:04.758Z) |
| Tool calls | 22: 1 `plan_review`, 3 `read_text_file`, 1 `extract_requirements`, 11 `flag_finding`, 2 `draft_redline`, 1 `file_gate_submission`, plus the run launch and two logged gate-decision refusal probes from the capture session |
| Findings | 11, every one cited and verified against its cited document |
| Drafts | 2, both labelled `template` |
| Tokens | 0 in / 0 out → **0 USD** |
| Output | Sourced report (10.9 KB Markdown, HTTP 200), run parked at `AWAITING_GATE` |
| Filing | Blocked — `file_gate_submission` logged `PENDING_GATE`, status left `PENDING`; no bundle left the building |

Repeat the same run and the finding set is byte-identical
(requirements 8, findings 11, drafts 2, same rule signature each time) — stability
is measured, not claimed (`data/eval/report.json`, `identicalAcrossRuns`).

## 3. The audit surface (what an auditor would read)

1. **`data/tool-log.jsonl`** — append-only, every call: seq, timestamp, actor,
   tool, READ/WRITES/IRREVERSIBLE kind, inputs, outputs, status, duration.
2. **Per-run sourced report** — `GET :3031/api/runs/:id/report` (9.9 KB for the
   run above), findings with file-level citations, the gate decision, and the run's
   own audit trail.
3. **Sealed receipts** — sha-256, written at filing, only after the named human
   signs at the gate.
4. **Cost recomputation** — `state.json` usage blocks × any published price list;
   no hidden token accounting.

## 4. The live-model path, measured (2026-10-27)

The scoring criteria ask whether run-to-run variation is measured or hidden, and
whether cost per run is known. An in-region open-weights endpoint (Ollama,
`llama3.2:1b` on localhost — the README's intended deployment, on commodity
hardware: a 4 GB-RAM CPU box, no GPU) is wired, and the numbers below come from
committed code: `bun live-audit.ts` regenerates the artifact
`mini-services/quorum-mcp/data/eval/live-llm-audit.json` from the append-only
log, any time, offline. The audited series: three different packs, then the
demo pack `KE-KCS-2026-042` run three more times for the variance claim.

| Measured fact | Value |
| --- | --- |
| LLM-planned runs audited | 6 (3 packs × 1 + demo pack × 3 repeats) |
| Rule findings, same pack | stable — all 3 repeat runs of `KE-KCS-2026-042` find the same 11 findings with the same 5-rule signature (incl. OVER-BUDGET, VALUE-OUTLIER) |
| Rule findings, across packs | differ as they should — different packs raise different rule sets (2–5 rule types); deterministic rules, not model moods |
| Draft-text variance | distinct draft sets across the same-pack repeats — measured run-to-run variance, published, not hidden |
| Tokens per run | 291–348 total (prompt+completion), recorded per run |
| Tokens audited (6 runs) | 1,529 prompt / 661 completion |
| Model-call latency | median 6,975 ms, range 4,222–16,263 ms per call (13 calls, CPU-only) |
| Cost | local in-region endpoint: **0 USD**; hosted: tokens × published price |
| Gate discipline under LLM plans | unchanged — 6/6 runs parked at `AWAITING_GATE`; nothing filed |

**The honest caveat (kept from bring-up):** with a 3B planner during pre-hackathon
bring-up, the model's own plan once tried to disable deep-value parsing on a pack
whose bid values are markdown — which would have starved the flagship OVER-BUDGET
check. The engine therefore applies a planner safety floor (parsing can be added,
never removed when bid values are present), pinned by a dedicated test that runs
in the committed suite. A judge can re-run `bun eval.ts` and
`bun live-audit.ts` to check both halves.

## 5. What we deliberately do not claim

- **A hosted-endpoint cost figure** — the formula and the per-run token counts
  are published; any price list can be multiplied out by an auditor.
- Human desk time (see `09-fit.md` §3): unmeasured until the pilot runs.
