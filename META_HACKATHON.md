# Quorum — Meta Global AI Developer Hackathon 2026 Submission

**Project:** Quorum — agentic tender review for public procurement
**Builder:** CHAMA18 (indie developer track)
**Theme:** Build for Your World
**Edition:** Meta Global AI Developer Hackathon 2026 (Oct 26 – Nov 4, 2026)
**Live product:** [`quorum-edge.chungu424.workers.dev`](https://quorum-edge.chungu424.workers.dev) (Cloudflare Worker HTTPS front door; EC2 `af-south-1` origin) · **Repo:** this repository

---

## The one-paragraph pitch

Public-procurement evaluation committees wade through tender packs of hundreds of pages
by hand. Backlogs delay hospital supplies; thin award documentation is exactly what lets
fraud go unchallenged. Quorum is a working review desk where a tool-wielding agent does
the reading: it reads every document over MCP, extracts the requirements, raises findings
with file-path citations, and drafts committee-ready redlines with **Muse Spark 1.3 on
Meta Model API**. Then it stops. Filing an award is irreversible, so the agent cannot do
it: the review graph contains no edge to filing. A **named human signs the gate** first,
and only then is the bundle sealed (sha-256), filed and receipted.

The demo runs on a **real public record**, not a synthetic pack: KEMSA's
`KE-KEMSA-2024-ONT08` award register, 11 published awards from Kenya's PPRA dataset
(OCDS `ocds-5whusi-KEMSA/ONT08/2024-2026`, retrieved 2026-10-31). The release publishes
no line items or quantities, so the desk flags the value spread as a committee question
and says plainly that it cannot test unit-price reasonableness from the record. That
limit is part of the submission, not hidden from it.

## Why this fits "Build for Your World"

Procurement review is a problem known firsthand — the desk, the backlog and the audit are
real, and the users (evaluation officers, oversight bodies) are named. Meta's models are
brought into that world in a way that respects its hard constraint: raw procurement
evidence must not leave the jurisdiction. The chain therefore leads with **Muse Spark 1.3
on Meta Model API** on **redacted** evidence (supplier names and amounts replaced by the
model gateway), and keeps **Llama 3.2 in-region** as the fallback that can see the full
pack. The report prints which path answered and how many spans were redacted. If neither
model answers, the deterministic template drafts and says so.

## How Meta's models are used

| Model | Role | Status in this repo |
| --- | --- | --- |
| **Muse Spark 1.3** (Meta Model API, hosted) | Plans the review depth and drafts every committee redline through the `plan_review` / `draft_redline` MCP tools | **Primary path.** Live call verified 2026-10-31. On the real KEMSA pack: model-led plan, 2 model drafts, 4 redactions, 22.8 s wall-clock. |
| **Llama 3.2** (Meta open weights, in-region) | Fallback planning and drafting when the hosted call fails; full evidence stays on the desk | **Measured fallback.** Ollama setup (`llama3.2:3b`) documented and measured in-repo — see `.env.example` and `SUBMISSION/10-cost-and-audit.md`. |
| **SAM 3.1** (Meta Model API, segmentation) | On a scanned page or image upload, locates the table region and returns boxes for a human to inspect | **Live, opt-in.** Verified 2026-10-31 on a real Nyamira County price schedule (1 table box). It does not read text or authenticate a signature; every scan is marked `humanReviewRequired`. |
| **Muse Voice Transcribe 1.0** | The assistant's microphone: WAV clip in, sentence out | Live; procurement vocabulary is biased into the recognizer. |
| **Muse Image** | Regenerates the five-chapter demo film | Kit shipped: prompt pack, frame generator, ffmpeg assembler — `SUBMISSION/muse-film-kit/`. A bonus asset, not the main demo. |

Spoken replies use a real neural voice: **Deepgram Aura-2 through Cloudflare Workers AI**, with MeloTTS and then the browser's installed voice as fallbacks. The assistant is read-only by construction and cannot sign, award, return, file or summon.

The drafting path is deliberately model-agnostic (any OpenAI-compatible endpoint), so the
same binary that runs Llama 3.2 on a desk-side Ollama instance runs against the Meta
Model API with one environment change — and with no endpoint configured at all, a
deterministic template drafts redlines and labels every draft `template`. The product
never depends on a secret to boot.

Attribution is evidence, not a badge: every draft stores the exact model string the
endpoint returned plus its source, `/api/health` reports the newest attributed model answer,
`/api/runs` carries per-run plan/draft/token attribution, and the downloadable report
prints a **Model attribution** table.

## What is built (and verifiable)

- **Own MCP server** (JSON-RPC 2.0 over HTTP, port 3031) with five review tools and
  thirteen cycle tools, plus the official filesystem MCP server over stdio for
  path-jailed document reads.
- **LangGraph.js review graph** — load → extract → flag → verify → draft → propose the
  gate. The halt-at-the-gate guarantee is structural: the edge to filing does not exist
  in the graph, so no prompt, tool misuse or model turn can file an award.
- **The gate.** Filing runs only after a roster-verified signature by a named human,
  with the committee roll quorate; the bundle is sealed with sha-256 and a receipt is
  written. The demo's most interesting moment is the gate refusing the operator.
- **Deterministic rules engine** — price outliers (peer-median ×2), missing required
  documents, spec deviations, over-ceiling bids, publisher mess (supplier identifiers
  that break their own national scheme, notices that never name the buyer, price tables
  whose cells state a different currency from their header). No citation, no finding —
  enforced by the test suite.
- **Append-only audit log** for every tool call; tamper-evident by construction.
- **Tests:** 486 across the repo, 0 failing (450 pass, 36 environment-gated skips; Bun runner).
- **Evaluation harness** with held-out tender packs and a pre-registered baseline
  protocol (`SUBMISSION/09-fit.md`).

## Repository map

| Path | What it is |
| --- | --- |
| `src/` | The Next.js 16 product (landing, auth, workspace/dashboard) + MCP sidecar |
| `SUBMISSION/` | Documentation kit: problem, solution, architecture, agent design, MCP implementation, capabilities, cost & audit, demo script |
| `SUBMISSION/muse-film-kit/` | Muse Image film regeneration kit (prompts, generator, assembler) |
| `SUBMISSION/submission.html` | Standalone pitch page for judges |
| `META_HACKATHON.md` | This brief |
| `.env.example` | Model chain: Muse Spark 1.3 (hosted primary), Llama 3.2 (in-region fallback), residency/redaction policy, SAM 3.1 opt-in |

## Submission checklist (due Nov 4, 9:00 PM ET)

1. Deploy or refresh the live demo (`quorum.chungu-chama.com`) with the Meta edition framing.
2. Record the 3-minute demo per `SUBMISSION/DEMO.md` — the gate refusal is the centerpiece;
   the real KEMSA pack and the SAM scan are the two new beats.
3. Optional bonus: run `SUBMISSION/muse-film-kit/` with Muse Image credits and drop the
   five `chapter-N.mp4` files into `public/film/`. The main demo does not depend on it.
4. Final check of `SUBMISSION/submission.html` links and numbers.
5. Submit through the hackathon portal before **Nov 4, 9:00 PM ET** (Nov 5, 4:00 AM EAT).

## Verified before submission

| Check | Result |
| --- | --- |
| `GET https://api.meta.ai/v1/models` | HTTP 200; `muse-spark-1.3`, `sam-3.1`, `muse-image-1.0`, `muse-voice-transcribe-1.0` visible |
| Muse Spark chat completion | HTTP 200; `muse-spark-1.3`; reasoning tokens visible; `max_tokens: 4096` required |
| Real KEMSA pack, model-led | `AWAITING_GATE`, 5 cited value-outlier findings, 2 Muse Spark drafts, 4 redactions, 22.8 s |
| SAM 3.1 on a real scanned page | HTTP 200; 1 table box on Nyamira price schedule p58; 0 boxes for `signature` on the CA certificate (reported as no match) |
| `bun test` | 450 pass, 36 skip, 0 fail |
| `bun run build` | Compiled successfully; 44 pages generated |
| `bun run lint` | Changed files clean; repo-wide lint still reports pre-existing generated-file errors |
