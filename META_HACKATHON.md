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
with file-path citations, and drafts committee-ready redlines with **Llama 3.2 — Meta
open weights — served in-region**. Then it stops. Filing an award is irreversible, so the
agent cannot do it: the review graph contains no edge to filing. A **named human signs
the gate** first, and only then is the bundle sealed (sha-256), filed and receipted.

## Why this fits "Build for Your World"

Procurement review is a problem known firsthand — the desk, the backlog and the audit are
real, and the users (evaluation officers, oversight bodies) are named. Meta's models are
brought into that world in a way that respects its hard constraint: procurement data must
never leave the jurisdiction. That rules out hosted-only drafting and is precisely why the
**open-weights path is the primary story**: Llama 3.2 runs in-region on commodity
hardware, and the repo measures it rather than claiming it.

## How Meta's models are used

| Model | Role | Status in this repo |
| --- | --- | --- |
| **Llama 3.2** (Meta open weights) | Drafts every committee redline through the `draft_redline` MCP tool | Primary drafting path. Ollama setup (`llama3.2:3b`) documented and measured in-repo — see `.env.example` and `SUBMISSION/10-cost-and-audit.md` |
| **Meta Model API** | Hosted OpenAI-compatible endpoint for the same drafting path | First-class configuration option in `.env.example` — set `LLM_BASE_URL`/`LLM_MODEL`/`LLM_API_KEY` from your Meta developer console |
| **Muse Spark 1.3** | The read-only desk assistant: live desk tools plus Quorum's operating manual | Live in the assistant; answers show the returned model provenance |
| **Muse Voice Transcribe 1.0** | The assistant's microphone: WAV clip in, sentence out | Live; procurement vocabulary is biased into the recognizer |
| **Muse Image** | Regenerates the five-chapter demo film | Complete kit: prompt pack, frame generator, ffmpeg assembler — `SUBMISSION/muse-film-kit/` |

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
- **Tests:** 49 green in `engine.test.ts` (Bun runner).
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
| `.env.example` | Model wiring: Ollama/Llama 3.2 (open weights) and Meta Model API (hosted) |

## Submission checklist (due Nov 4, 9:00 PM ET)

1. Deploy or refresh the live demo (`quorum.chungu-chama.com`) with the Meta edition framing.
2. Run `SUBMISSION/muse-film-kit/` with Meta Model API credits to regenerate the film; drop the
   five `chapter-N.mp4` files into `public/film/` (the cinema player picks them up unchanged).
3. Record the 3-minute demo per `SUBMISSION/DEMO.md` — the gate refusal is the centerpiece.
4. Final check of `SUBMISSION/submission.html` links and numbers.
5. Submit through the hackathon portal.
