# 12 — Reusing the tool surface: a stranger's five calls

*The agentic criterion asks whether the tool boundaries are ones a stranger could
reuse. This page is the checkable answer: every command below was run against a
booted sidecar while writing this page, and each names the surface it hits — the
repo's own MCP server on `:3031`, speaking plain JSON-RPC 2.0 that any MCP client
speaks. There is no session, no SDK, no custom protocol to learn.*

---

## 1. Discover the surface (no auth, no session)

```bash
curl -s localhost:3031/mcp -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Verified live: returns **5 tools**, each with its kind in the description —
`tender_documents_list` (read), `extract_requirements` (read),
`draft_redline` (writes), `flag_finding` (writes),
`file_gate_submission` (irreversible). Schemas are standard JSON-Schema
`inputSchema` objects, so a stranger's MCP client can render forms from them.

## 2. Read the pack (read-only tool)

```bash
curl -s localhost:3031/mcp -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"extract_requirements","arguments":{"tenderId":"KE-MOH-2026-117"}}}'
```

Verified live: returns the pinned `SHALL` clauses as MCP `content` text
(`REQ-01 ~ SHALL supply only medicines prequalified by the WHO or registered by
the PPB`, …) — pure function, stores nothing.

## 3. Write with a gate-rejecting contract (the reuse proof)

The two writing tools enforce their invariants against *any* caller, not just
the graph. A stranger's client cannot:

- **flag a finding whose citation doesn't hold** — `flag_finding` verifies the
  anchor text against the cited document and rejects the call otherwise;
- **file an award** — `file_gate_submission` returns `gate_pending` until a
  named human signs; the edge to filing does not exist in the graph.

Rejection paths are replayable whole (`SUBMISSION/DEMO.md` §1:20–2:20 and the
Part-2 clip): `POST /api/gates/:id/decision` without an approver →
`422`; with an approver the roster does not know → `403` (or the roster's
`503` fail-closed).

## 4. The audit surface is on the same protocol

```bash
curl -s "localhost:3031/api/log?limit=20"        # append-only tool log
curl -s  localhost:3031/api/runs                 # run register
curl -s  localhost:3031/api/runs/<RUN_ID>/report # sourced Markdown report
```

Everything a stranger calls is one line in `data/tool-log.jsonl`: actor, tool,
inputs, outputs, status, duration — the append-only record that makes reuse
auditable rather than private.

## 5. Porting the boundaries

Each tool is a pure, schema-checked function over two dependencies: the tender
store (`data/tenders/`) and the official filesystem MCP server (sandboxed to
the dossier). A stranger reusing the surface on their own packs swaps two
things: the documents in the dossier and the model endpoint behind
`draft_redline` (`LLM_BASE_URL`/`LLM_MODEL`; see `.env.example` for the
verified Ollama pairing). Nothing else carries state between calls.
