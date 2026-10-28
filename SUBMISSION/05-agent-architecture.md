# Agent Architecture

> **Describe your agent architecture, including relevant components such as: Agents, LLMs, Memory, Orchestration, Tools, Workflows, Databases, APIs.**
> **Also list your core technology stack, frameworks, LLMs, databases, and external APIs.**

---

## The one-line version

**A very fast, very diligent clerk reads every tender page, prepares a fully cited file — and then stops at the committee's desk, because the law says the pen is still human.**

Think of it as a new junior officer who never gets tired, never guesses, never misfiles anything, and always writes down everything it did — but who is *not allowed to hand in the award* until a named committee member has signed for it.

How to read this document: each section below answers one word from the question — **Who is the agent? Which model? How does it remember? How is it coordinated? What can it touch? How does a tender flow? Where does data live? How do other systems talk to it?** — followed by the complete technology stack.

---

## Who is the agent?

One agentic runtime, called `quorum-agent`, runs inside the `quorum-mcp` MCP server (Bun, port 3031). It is an *agent-with-hands*, not a chatbot:

- it **reads** the whole tender pack (through MCP tools),
- it **writes** findings and redline drafts (through MCP tools),
- and it **may not file the award by itself** — that is the one irreversible thing it can only *request*, never do.

Everything it can and cannot do is fixed by a tool registry, so reviewers can check its abilities at a glance (`GET /api/tools` or MCP `tools/list`). External MCP clients get served by the same registry — one code path, one audit trail.

## Which model, and what is it used for?

- **OpenAI-compatible LLM endpoint** (`LLM_BASE_URL` / `LLM_MODEL`). The live demo sets it to **Llama 3.2** (`llama3.2:3b`) through Ollama on localhost, so public-health procurement data stays on the desk. The same path takes the **Meta Model API** (or any OpenAI-compatible endpoint) with one env change; `.env.example` carries both wirings.
- The model has **two bounded jobs**. (1) `plan_review` decides review depth — deep value parsing, rule focus, draft count — from the pack inventory; every field is validated and clamped, and a heuristic plan takes over on failure. (2) `draft_redline` writes committee-ready redlines for flagged clauses (`llmDraft`: system+user prompt → strict-JSON clause `{proposed, rationale}` → draft record + audit entry).
- If inference is unreachable, the tool **degrades to a deterministic template** so a run never stalls silently. The fallback records `source: "template"` and the unavailable model id — a failed call is never attributed as model output.
- **Attribution is recorded, not inferred.** Every draft stores the exact `model` string the endpoint returned plus its `source`; `/api/runs` returns per-run attribution (plan model, draft counts, token counts), `/api/health` returns the configured endpoint and the newest attributed model answer, the downloadable report prints a **Model attribution** table, and the live console shows `MODEL · llama3.2:3b`.
- Everything *safety-critical* — requirement pinning, findings, verification — is **deterministic code, not model guesses**. A hallucinated finding cannot reach the committee, because findings never come from the model in the first place.

> In plain words: *the model plans depth and writes prose; the code makes compliance decisions.*

## How does it remember?

No vector database, no RAG — memory is **durable, structured state**, which is easier to audit:

- `state.json` — live runs, open gates, receipts, source requests; restored on boot.
- Each *run object* accumulates its own `requirements`, `findings`, `drafts` and a human-readable `progress` trail while the graph runs.
- `tool-log.jsonl` — an **append-only audit file**: every tool call writes one line (actor, server, tool, kind, inputs, outputs, duration, status), every tender object stored in R2 adds a `tender_upload` line with its object key, byte size, content type and staging outcome, and every signed download adds a `tender_download` READ line with the tender, object key, bytes served, user and link expiry. The dashboard streams it live, so the log doubles as the product's memory of *exactly what the agent did, in order* — and what the desk stored.

> In plain words: *the agent keeps a lab notebook it cannot erase.*

## How is it coordinated?

**LangGraph.js** orchestration, with the safety wired into the graph topology itself:

- The review run is an 8-node graph: `load_documents → plan_review → extract_requirements → flag_findings → verify_findings ⇄ revise_findings → draft_redlines → propose_gate`. `plan_review` decides the review depth for the pack (deep value parsing, rule focus, draft count) — model-led when an LLM is configured, deterministic otherwise; `revise_findings` is a bounded reason-and-retry loop (max 2 passes) that re-anchors refused findings and re-verifies them.
- `propose_gate` is a **terminal state** — the edge from the gate to filing **does not exist in the graph**. Nothing the agent does can follow a path it isn't given.
- Filing lives in a **separate, disconnected 2-node graph** (`filing_graph`: `seal_bundle → transmit_submission`), reachable only from the human gate-decision endpoint.
- So: no prompt injection, no runaway loop, no "creative" tool answer can ever reach the irreversible action.

> In plain words: *you can't misuse a door that isn't in the wall.*

## What exactly can it touch?

All agent tools carry typed input schemas (5 registered) — three of them are the agent's *write* hands:

| # | Tool | Kind | What it does |
| --- | --- | --- | --- |
| 1 | `tender_documents_list` | READ | Lists the tender pack via the official filesystem MCP server (third-party, sandboxed) |
| 2 | `extract_requirements` | READ | Pins SHALL/must clauses, budget and deadline |
| 3 | `flag_finding` | WRITES | Adds a *deterministic* finding — missing required doc, spec deviation, price anomaly — each with a path citation |
| 4 | `draft_redline` | WRITES | LLM-drafted committee redline for a flagged clause |
| 5 | `file_gate_submission` | IRREVERSIBLE | Requests award filing — blocked (`gate_pending`) until a named human signs |

The same server also exposes an officer-facing **source-request queue** (REST, logged as `request_source`): procuring entities can ask for new feeds — e.g. a beneficial-ownership registry — to be matched against bidders before findings are raised.

## How does a tender actually flow?

1. **Upload and extract.** The officer drops tender files; PDF, DOCX and XLSX text is extracted server-side and staged into the tender directory the review graph reads, while the original bytes are stored in Cloudflare R2.
2. **Launch.** `POST /api/runs` starts the review graph; every node is audit-logged as it happens.
3. **Review.** Requirements pinned, findings flagged *with citations*, redlines drafted.
4. **Park.** The agent raises `file_gate_submission` → the tool returns `gate_pending`, a human-gate entry is created, and the run stops in AWAITING_GATE.
5. **Sign-off.** A **named** approver opens the gate and signs — with the roll quorate:
   - `422` — approval refused *without a full name*,
   - `403` — refused if the name isn't on the PRESENT committee roster,
   - `409` — refused if fewer than the configured quorum are PRESENT (the response carries the live count),
   - `503` — fail-closed if the roster simply *cannot be read* (no roster, no approval).
6. **File.** Only now `filing_graph` runs: sha-256 seal → submit to the e-GP portal → receipt written into `data/submissions/` → run flips to FILED.
7. **Return.** A REJECT sends the bundle back to the agent for correction — and the whistleblower is the log line that says who returned it.

> In plain words: *the clerk prepares the file; the committee decides; the paper trail proves both.*

## Where does the data live?

Three storage layers, each with a clear role:

1. **The web app's store (one JSON file, `db/quorum-store.json`):** `User`, `Session`, `CommitteeMember` (the roster the gate checks against), `SystemSetting`, `ContactMessage`.
2. **The agent's file-backed state (in `mini-services/quorum-mcp/data/`):** `state.json` (runs/gates/receipts), `tool-log.jsonl` (the audit line set), submission recipes (`data/submissions/*.json`), and the tender documents on disk the filesystem MCP reads.
3. **Firebase and Cloudflare R2:** Firebase is the identity mirror. Tender uploads are stored in the `quorum-tenders` R2 bucket through the `quorum-edge` Worker's server-to-server upload gate. Before storing, the Next route extracts readable text — page-marked for PDF, raw text for DOCX, worksheet-marked rows for XLSX, UTF-8 for text files — and stages it through the sidecar's attested `POST /api/tenders/:ref/docs`, which writes the notice/bid files the review graph reads. A scanned PDF is stored but reported as needing OCR, never silently treated as reviewed. Downloads are minted as five-minute HMAC-signed URLs bound to the tender, object key and signed-in user; the download route re-checks the session and signature before streaming the object through the edge gate, so a copied link cannot be redeemed by another account.

## How do other systems talk to it?

**Inbound:**
- **MCP (JSON-RPC 2.0) at `POST /mcp`** — `initialize`, `tools/list`, `tools/call`, `ping`.
- **REST API** on the same server — `/api/health`, `/api/tools`, `/api/architecture`, `/api/log`, `/api/runs`, `/api/gates`, `/api/gates/:id/decision`, `/api/source-requests`.
- The browser reaches both through a **same-origin gateway** (`/api/*?XTransformPort=3031`) — no CORS, and the agent is never directly exposed to the internet.

**Outbound:**
- The **LLM endpoint** for redline drafting — Llama 3.2 via Ollama in the live demo, or the Meta Model API / any OpenAI-compatible endpoint.
- The **committee roster read** from the web app — fail-closed on failure.
- The **e-GP procurement portal** for award transmission (simulated in the demo, with real sha-256 receipts).
- **Firebase** (authentication) and **Cloudflare R2** through the `quorum-edge` Worker (tender document storage; the edge secret stays server-side).
- **Filesystem stdio** to the official third-party filesystem MCP server, which is the only thing allowed to open tender documents.

---

## Core technology stack

| Layer | Choice | Why we picked it |
| --- | --- | --- |
| Frontend | Next.js 16 (App Router, TypeScript, standalone), React 19 | The product surface officers actually use — and the frontend wires both servers into one same-origin origin. |
| UI kit | Tailwind CSS 4 + shadcn/Radix UI | Accessible primitives out of the box (dialogs, toasts, tables) |
| Runtime | **Bun** — one process model for both the web app and the MCP sidecar | Fast test loop, one install, same TS everywhere |
| Orchestration | **LangGraph.js** (`@langchain/langgraph` / `@langchain/core`) | The *only* framework we found where "the graph simply doesn't contain that edge" is a first-class design choice |
| Agent protocol | **MCP**: our own JSON-RPC 2.0/HTTP server + the official `@modelcontextprotocol/server-filesystem` | Our design principles plus a critical third-party capability we didn't want to hand-roll |
| LLM | **Llama 3.2** (`llama3.2:3b`) via Ollama in the live demo; Meta Model API or any OpenAI-compatible endpoint; deterministic template fallback | Open weights keep procurement data in-region, and one env change moves the same drafting path to Meta's hosted API |
| Databases | One dependency-free JSON file for the web app (users/roster/settings) + file-backed state & append-only audit JSONL on the agent side | Small, inspectable store with no native dependencies; append-only text where it's auditable evidence |
| Identity & storage | Firebase Auth (email/passphrase + Google) + Cloudflare R2 through the quorum-edge gate | Real authentication without building a password system; uploads stay behind a server-side edge secret |
| Infra | nginx (reverse proxy), systemd (process supervision), one `t4g.small` EC2 in `af-south-1`, Route 53 zone | Small, boring, cheap to run — everything reproducible from the repo |
| Tests | Bun test runner (`engine.test.ts`, 49 tests: green) | The agent safety rules (roster fail-closed, citations required) are enforced by tests, not only by docs |

**Non-negotiables across the whole stack:**

- **The halt is structural** — no edge to filing exists in the review graph.
- **The gate is identity-checked** — a *named* human, against a roster, fail-closed.
- **Every action is recorded** — one append-only line per tool call.
- **The data stays in-country** — the live demo drafts against Llama 3.2 on localhost; no tender text leaves the desk.
