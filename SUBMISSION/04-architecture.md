# Architecture Diagram

> **Upload an architecture diagram showing the relationship between:** Agents, LLMs/models, MCP client/server components, MCP tools/resources, External APIs, Data sources, Human-in-the-loop, Overall data flow.

---

## The diagram (Mermaid — renders on GitHub, GitLab, Notion and most form uploaders accept the exported PNG)

```mermaid
flowchart TB
    %% ═══════════ PEOPLE ═══════════
    OFF["🧑‍💼 Evaluation Officer /<br/>Committee Member"]

    %% ═══════════ BROWSER (MCP CLIENT SIDE-SURFACE) ═══════════
    subgraph BROWSER["Browser  ·  Next.js 16  ·  :3000"]
        MC["Workspace dashboard<br/>(run register · HUMAN GATE queue · decision ledger)"]
        LC["Live stack console<br/>(health · tools · streaming audit)"]
    end

    %% ═══════════ AGENT + OWN MCP SERVER ═══════════
    subgraph QUORUM["quorum-mcp  ·  own MCP server  ·  Bun :3031"]
        SRVR[["MCP surface — JSON-RPC 2.0 over HTTP<br/>initialize · tools/list · tools/call"]]
        AGENT[["🤖 agentic runtime<br/>LangGraph.js — review_graph:<br/>load → plan → extract → flag → verify ⇄ repair → draft → propose_gate<br/>⏸ HALTS AT THE GATE — the edge to filing does not exist"]]
        TOOLS["MCP TOOLS (typed input schemas)<br/>📖 tender_documents_list · extract_requirements<br/>✍️ flag_finding · draft_redline<br/>🔒 file_gate_submission — IRREVERSIBLE → raises gate"]
        FG[["filing_graph — separate LangGraph graph:<br/>seal_bundle → transmit_submission<br/>runs ONLY after a named human signs the gate"]]
    end

    %% ═══════════ THIRD-PARTY MCP SERVER ═══════════
    FSMCP[["📦 @modelcontextprotocol/server-filesystem<br/>(official third-party MCP server, spawned over stdio<br/>sandboxed path-jail → tender documents as MCP RESOURCES)"]]

    %% ═══════════ HUMAN-IN-THE-LOOP ═══════════
    subgraph HITL["🧑‍⚖️ HUMAN-IN-THE-LOOP GATE"]
        GATE["gate_pending — bundle parked<br/>named sign-off required (HTTP 422 without one)<br/>approver checked against committee roster (403 if not on it)<br/>roll must be quorate (409 if short)"]
    end

    %% ═══════════ EXTERNAL APIs ═══════════
    LLM["☁️ LLM endpoint — OpenAI-compatible model<br/>via LLM_BASE_URL/LLM_MODEL<br/>(intended: open-weights, served in-region)"]
    EGP["🏛️ e-GP procurement portal<br/>(award transmission — simulated in demo)"]
    BOR["🔎 Beneficial-ownership registry<br/>(bidder matching — source requested, pending)"]
    FB["<img src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIwLjhlbSIgaGVpZ2h0PSIxZW0iIHZpZXdCb3g9IjAgMCAyNTYgMzIyIj48cGF0aCBmaWxsPSIjZmY5MTAwIiBkPSJNODAuMTggMzEyLjI5NWMxMy40NTUgNS40MTQgMjguMDUgOC42MjggNDMuMzc2IDkuMTYzYTEyNy41IDEyNy41IDAgMCAwIDU4LjA5OC0xMS43MWMtMjEuMTQ1LTguMzA3LTQwLjI5NC0yMC40NTUtNTYuNjM4LTM1LjU2Yy0xMC41OTQgMTYuOTYzLTI2LjI2MyAzMC4zNi00NC44MzUgMzguMTA3Ii8+PHBhdGggZmlsbD0iI2ZmYzQwMCIgZD0iTTEyNS4wMTMgMjc0LjE5M2MtMzcuMzA3LTM0LjUwNC01OS45MzktODQuNDQ0LTU4LjAyNi0xMzkuMjE4Yy4wNjItMS43OC4xNTYtMy41NTcuMjY2LTUuMzM0YTk2LjYzIDk2LjYzIDAgMCAwLTUwLjQ1Ni41MjhDNi44MzggMTQ3LjYxNC44MjggMTY3LjYzLjA3OSAxODkuMDY5Qy0xLjg1MyAyNDQuNDAzIDMxLjYzMiAyOTIuNzUgODAuMTc4IDMxMi4zYzE4LjU3Mi03Ljc0NyAzNC4yNC0yMS4xMyA0NC44MzUtMzguMTA3Ii8+PHBhdGggZmlsbD0iI2ZmOTEwMCIgZD0iTTEyNS4wMTUgMjc0LjE5MWM4LjY3NC0xMy44OCAxMy45MzMtMzAuMTU0IDE0LjU0NS00Ny42ODdjMS42MS00Ni4xMi0yOS4zOTQtODUuNzk0LTcyLjMwNi05Ni44NjVjLS4xMSAxLjc3Ny0uMjAzIDMuNTU1LS4yNjUgNS4zMzRjLTEuOTEzIDU0Ljc3NSAyMC43MTkgMTA0LjcxNCA1OC4wMjYgMTM5LjIxOCIvPjxwYXRoIGZpbGw9IiNkZDJjMDAiIGQ9Ik0xMzQuNzYxIDBjLTI0LjQ0IDE5LjU4LTQzLjczOCA0NS4zOTYtNTUuNDE0IDc1LjEzNmExODAuNSAxODAuNSAwIDAgMC0xMi4xMTMgNTQuNTE1YzQyLjkxMiAxMS4wNyA3My45MTcgNTAuNzQ1IDcyLjMwNiA5Ni44NjVjLS42MTIgMTcuNTMyLTUuODg3IDMzLjc5LTE0LjU0NSA0Ny42ODdhMTgwLjcgMTgwLjcgMCAwIDAgNTYuNjM3IDM1LjU2YzQyLjQ0MS0xOS42MTggNzIuNTUzLTYxLjgzMyA3NC4yOTctMTExLjc2NGMxLjEyOS0zMi4zNTEtMTEuMy02MS4xODQtMjguODY0LTg1LjUyMUMyMDguNTE3IDg2LjczOCAxMzQuNzYgMCAxMzQuNzYgMCIvPjwvc3ZnPg==' width='22' height='27' style='vertical-align:-4px'/> Firebase<br/>identity (Google Sign-In / email)"]
    R2["☁️ Cloudflare R2 — quorum-tenders<br/>original bytes behind the quorum-edge gate"]

    %% ═══════════ DATA SOURCES ═══════════
    subgraph DATA["Data sources"]
        TD["data/tenders/&lt;ref&gt;/<br/>tender pack + bids the agent reads"]
        LOG["📈 tool-log.jsonl — append-only audit<br/>every call: actor · tool · kind · inputs · outputs · status"]
        ST["state.json — runs · gates · receipts"]
        SUBS["data/submissions/*.json —<br/>sha-256-sealed filed bundles (receipts)"]
    end

    %% ═══════════ OVERALL DATA FLOW ═══════════
    OFF -- "1 · signs in, drops tender files" --> MC
    MC -- "1 · uploads tender files" --> R2
    R2 -- "PDF/DOCX/XLSX text extracted → staged" --> TD
    OFF -- "2 · launches run" --> MC
    MC -- "3 · gateway /api/* → XTransformPort :3031" --> SRVR
    SRVR -- "4 · tools/call (agent's hands)" --> TOOLS
    SRVR -- "5 · runReview() — graph invoked" --> AGENT
    OFF -- "6 · lifts gate, signs as named approver" --> GATE
    AGENT -- "redline drafting via llmDraft" --> LLM
    AGENT -- "document reads via stdio" --> FSMCP
    FSMCP -- "reads" --> TD
    AGENT -- "every orchestrated step" --> LOG
    AGENT -- "7 · irreversible? NO — returns gate_pending" --> GATE
    GATE -- "8 · APPROVE only after roster check" --> OFF
    GATE -- "9 · executeFiling()" --> FG
    FG -- "10 · sealed bundle (sha-256) transmitted" --> EGP
    EGP -- "receipt written" --> SUBS
    SRVR -- "gate + run state" --> ST
    LOG -- "oversight bodies review the same trail" --> OFF
    SUBS -- "11 · audit trail for oversight" --> OFF
    LOG -- "streaming to" --> LC

    classDef agent fill:#1b1f3a,stroke:#7c8cf8,color:#fff
    classDef mcp fill:#14232e,stroke:#4bcf82,color:#fff
    classDef ext fill:#2a1e33,stroke:#d98fe0,color:#fff
    class AGENT,SRVR,TOOLS,FG agent
    class FSMCP mcp
    class LLM,EGP,BOR,FB,R2 ext
```

## Component legend — where each required piece sits

| Required component | In the diagram above | In the code |
| --- | --- | --- |
| **Agent** | `agentic runtime` (LangGraph.js `review_graph`, 8 nodes incl. plan_review + bounded repair, halts at the gate) | `mini-services/quorum-mcp/engine.ts` → `runReview()` |
| **LLMs / models** | any OpenAI-compatible endpoint (`LLM_BASE_URL`/`LLM_MODEL`); intended: open-weights, in-region | `llmDraft()` in `engine.ts` (redlines), template fallback if unreachable |
| **MCP server (own)** | `quorum-mcp` :3031 — JSON-RPC 2.0 `initialize`/`tools/list`/`tools/call` | `POST /mcp` in `index.ts` |
| **MCP client/server (third-party)** | official `@modelcontextprotocol/server-filesystem`, spawned over stdio; tender docs surface as **MCP resources** | `initFsMcp()` in `engine.ts` |
| **MCP tools** | 5 registered tools: 2 READ, 3 state-changing (`flag_finding`, `draft_redline`, gated `file_gate_submission`) | `TOOLS` registry in `engine.ts` |
| **External APIs** | e-GP portal (award transmit), LLM endpoint, beneficial-ownership registry (requested), Firebase (auth), Cloudflare R2 via quorum-edge (document storage) | `executeFiling()` receipt → `egp-portal`; `src/instrumentation.ts` etc. |
| **Data sources** | tender pack dir, `tool-log.jsonl` audit, `state.json` (runs/gates), submission receipts | `mini-services/quorum-mcp/data/` |
| **Human-in-the-loop** | the gate: irreversible filing parked (`gate_pending`) until a *named* approver signs and the roll is quorate; refused 422 without a name, 403 if not on the committee roster, 409 if the roll is short | `decideGate()` in `index.ts` → `POST /api/gates/:id/decision` |
| **Overall data flow** | numbered steps 1→11: upload → run launch → tool calls → graph review → gate → named sign-off → seal & file → receipt → audit trail | the node edges above |

## Why the flow looks the way it does

- **Filing is not reachable from the agent.** `review_graph` ends at `propose_gate`; only the *separate* `filing_graph` transmits, and it is invoked exclusively from `decideGate()` after approval. No prompt, no tool misuse, and no graph path can file without a human.
- **Every hand is logged.** READ, WRITES and IRREVERSIBLE calls all append one line to `tool-log.jsonl` — actor, server, tool, kind, inputs, outputs, duration, status. Each R2 tender upload adds a `tender_upload` line with the object key, size, content type and staging outcome, and each delivered download adds a `tender_download` READ line with the slice served, the user and the link expiry — so storing and reading a document are as auditable as calling a tool.
- **Downloads are earned, not guessed.** The browser asks an authenticated link route for a five-minute HMAC-signed URL bound to the tender, object key and signed-in user. The download route verifies the session and the signature before fetching through the edge gate; the R2 secret never reaches the browser, and a copied link expires and cannot be used by another account. Large documents support a single HTTP `Range`: the gate reads only the requested bytes from R2 and returns a real `206` with `Content-Range` (or `416` with the total size when the range lies outside the object), so a scan can be resumed or paged without a second full transfer. Every delivered object — full or partial — is appended to the hash-chained trail as a `tender_download` READ bound to the user and link expiry; the response carries the entry's seq/id/self hash, or `x-quorum-audit: unavailable` if the spine could not be reached (the bytes are never withheld for a failed append). The wizard's document step, a completed evaluation and the procurement-file view open the same stored-document browser: it lists every object under the tender's R2 prefix — not only the files staged in that browser session — with search and sort, and mints a five-minute signed URL on each download click, so the bucket stays private and no stale link is left in the page. Owners, admins and officers may remove an object; the route deletes it through the edge gate and appends a `tender_delete` WRITES line, while committee and audit roles see the same list read-only.
- **The gate is identity-checked twice.** First a named full-name is required (422 if absent), then the name is matched against the committee roster or the signed-in officer (403/503 otherwise). Even a valid name is refused while the roll is short (409), with the live count in the response. Oversight bodies read the same log the agent writes.

## ASCII fallback (for forms that don't render Mermaid)

```
Officer ──1──▶ Browser (Next.js :3000) ──3──▶ quorum-mcp :3031 (own MCP server, JSON-RPC 2.0)
   │                │  store docs in R2           │  tools/call — 5 typed tools (2 READ · 3 WRITE/gated)
   │                ▼                             │
   │        Firebase (identity) + R2 (documents)  ├─▶ agent runtime (LangGraph review_graph:
   │                                              │     load → plan → extract → flag → verify ⇄ repair → draft)
   │  6 · signs as named approver                 │        │ stdio
   ▼                                              │        ▼
HUMAN GATE ◀──7─ gate_pending (no graph edge ◀────┘    @modelcontextprotocol/server-filesystem
   │              to filing exists)                        │ reads
   │ 8 · APPROVE (roster-checked 403/503 · quorum 409)     ▼
   │                                              data/tenders/<ref>/  (tender pack + bids)
   ▼
filing_graph (separate graph) ──▶ seal sha-256 ──▶ e-GP portal ──▶ receipts data/submissions/*.json
                                          ▲
drafting ──▶ configured LLM endpoint    audit: every call → tool-log.jsonl (append-only)
```
