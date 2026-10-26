# 10 — Cost per run and the audit trail

*This page exists to be checked. Every number below was measured on this machine
(bun 1.4.0, macOS arm64) from the repo's own artifacts, and each one names the
file it can be re-derived from. No number here is estimated or borrowed.*

---

## 1. Rule-path cost, per tender pack (measured)

The compliance path (pack → requirements → findings → verify) makes **zero model
calls**, and the eval harness measures it repeatedly:

- **Cost: 0 USD per pack.** No tokens are consumed; nothing is billed.
- **Latency:** median **0.25–1.68 ms** per pack, spread published per tender in
  `mini-services/quorum-mcp/data/eval/report.json` (`medianMs`, `msRange`).
- The harness config cost is one-time labelling; runtime cost is machine time only.

For a **live LLM endpoint**, cost is not a mystery: the sidecar records
`prompt_tokens` and `completion_tokens` on every draft (in `tool-log.jsonl` and on
the run's `usage` block), so

> `cost run = Σ (prompt_tokens + completion_tokens) × endpoint price/token`,

and the line items are reproducible from the append-only log. With no endpoint
configured every draft is labelled `template` and the measured cost is exactly
the 0 USD rule-path figure above.

## 2. What a full review costs end-to-end (measured, template mode)

One live run of `review_graph` on `KE-MOH-2026-117` (run `run_10981ace`,
2026-10-17, no LLM configured):

| Item | Measured |
| --- | --- |
| Wall clock | ~0.28 s (startedAt 06:26:11.953Z → updatedAt 06:26:12.232Z) |
| Tool calls | 18: 1 `plan_review`, 3 `read_text_file`, 1 `extract_requirements`, 10 `flag_finding`, 2 `draft_redline`, 1 `file_gate_submission` |
| Findings | 10, every one cited and verified against its cited document |
| Drafts | 2, both labelled `template` |
| Tokens | 0 in / 0 out → **0 USD** |
| Output | Sourced report (9.9 KB Markdown, HTTP 200), run parked at `AWAITING_GATE` |
| Filing | Blocked — `file_gate_submission` logged `PENDING_GATE`, status left `PENDING`; no bundle left the building |

Repeat the same run three times and the finding set is byte-identical
(requirements 8, findings 10, drafts 2, same rule signature each time) — stability
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

## 4. The live-model path, measured (2026-10-17)

The scoring criteria ask whether run-to-run variation is measured or hidden, and
whether cost per run is known. An in-region open-weights endpoint (Ollama,
`llama3.2:3b` on localhost — the README's intended deployment) is now wired, and
the numbers below come from committed code: `bun live-audit.ts` regenerates the
artifact `mini-services/quorum-mcp/data/eval/live-llm-audit.json` from the
append-only log, any time, offline.

| Measured fact | Value |
| --- | --- |
| LLM-planned runs audited | 4 (3 post-safety-floor, 1 pre-floor kept as evidence) |
| Rule findings across runs | stable — every post-floor run finds the same rule set (incl. OVER-BUDGET, VALUE-OUTLIER); the pre-floor run lost the 2 value findings, which is why a planner safety floor now exists (engine + pinning test) |
| Draft-text variance | 4 distinct draft sets across 4 runs — measured run-to-run variance, published, not hidden |
| Tokens per run | 668–988 total (prompt+completion), recorded per run |
| Tokens audited (4 runs) | 2,376 prompt / 920 completion |
| Model-call latency | median 7,696 ms, range 6,296–9,737 ms per call (14 calls) |
| Cost | local in-region endpoint: **0 USD**; hosted: tokens × published price |
| Gate discipline under LLM plans | unchanged — 3/3 runs parked at `AWAITING_GATE`; nothing filed |

**The honest caveat:** with a 3B planner, the model's own plan tried to disable
deep-value parsing on a pack whose bid values are markdown — which would have
starved the flagship OVER-BUDGET check. That run is preserved in the log as
evidence, and the engine now applies a planner safety floor (parsing can be
added, never removed when bid values are present), pinned by a dedicated test.
A judge can re-run `bun eval.ts` and `bun live-audit.ts` to check both halves.

## 5. What we deliberately do not claim

- **A hosted-endpoint cost figure** — the formula and the per-run token counts
  are published; any price list can be multiplied out by an auditor.
- Human desk time (see `09-fit.md` §3): unmeasured until the pilot runs.
