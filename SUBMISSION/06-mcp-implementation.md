# MCP Implementation

> **Explain how you implemented Model Context Protocol (MCP) in your solution. Identify the MCP servers, tools, resources, and integrations used and explain how they connect to your agent.**

---

## The one-line version

**We run our own MCP server (`quorum-mcp`) as the agent's hands and gate, delegate document reads to the official filesystem MCP server, and make every tool call answerable to an append-only audit log — with the one irreversible action held behind a named human.**

---

## The two MCP servers in the solution

| | Server 1 (ours) | Server 2 (official, third-party) |
| --- | --- | --- |
| **Name** | `quorum-mcp` | `@modelcontextprotocol/server-filesystem` |
| **Where it runs** | Bun HTTP server, port **3031**, exposed at `POST /mcp` | Spawned locally by our agent over **stdio** (`bun x @modelcontextprotocol/server-filesystem <tenders_dir>`) |
| **Protocol** | **MCP over JSON-RPC 2.0** (`initialize` · `tools/list` · `tools/call` · `ping`) | JSON-RPC 2.0 over stdio, driven by our own MCP **Client** (`@modelcontextprotocol/sdk`) |
| **Role** | The agent's *hands and gates* — compliance logic, findings, redlines, and the human-gated filing surface | The agent's *eyes* — sandboxed reads of the tender pack, via path-jail to the tender directory only |
| **State** | Runs, gates, receipts, the full audit log | None — stateless reads |

**Our server as a first-class MCP endpoint.** We wrote the JSON-RPC 2.0 dispatch loop from scratch (`initialize` → capabilities + serverInfo, `tools/list` → the contract every client inspects, `tools/call` → dispatch with per-call audit logging, and `ping`). Because `quorum-mcp` speaks real protocol surface, any MCP client can list our tool registry — so nothing about the agent's abilities is invisible.

**Delegating reads to battle-tested shoulders.** On boot, `initFsMcp()` spawns `@modelcontextprotocol/server-filesystem` locked to the tender directory (path-jail) and handshakes over stdio using an SDK `StdioClientTransport` and `Client`. If the handshake fails we say so honestly — the agent falls back to direct filesystem reads (logged, tagged `fs-direct (server-filesystem offline)`) — but it *gains no extra privileges*: the same folder, the same audit line for every fallback read.

## The tools we connect to the agent

Five tools on our registry (each with a typed JSON-schema of inputs, plus a `_x_kind` extension honoring READ / WRITES / IRREVERSIBLE):

| Tool | Kind | Purpose |
| --- | --- | --- |
| `tender_documents_list` | READ | Enumerates the tender pack the filesystem MCP can reach |
| `extract_requirements` | READ | Pins SHALL/must clauses, budget, deadline into structured requirements |
| `flag_finding` | WRITES | Deterministic findings with a file-path citation (peer-median ×2, missing required doc, spec deviation) |
| `draft_redline` | WRITES | LLM-drafted committee redline for a flagged clause |
| `file_gate_submission` | IRREVERSIBLE | Requests the award filing — returns `gate_pending` and never executes until a named human signs |

Honest scope: over `/mcp`, only `tender_documents_list` and `file_gate_submission` execute directly. `extract_requirements`, `flag_finding` and `draft_redline` return `delegated` and run only inside the review graph, started with `POST /api/runs`.

Two tools correspond directly to the capabilities of the file-system MCP server we delegate to: `read_text_file`, `read_file` — used by our agent for document reads. The SDK client loops through whichever of these two the server offers and falls back, so the exact tool name does not become a hardcoded dependency.

## MCP resources — what documents appear as

The tender pack (`data/tenders/<tender-ref>/`) — notices, bids, OCDS records — is exposed as a **directory of documents** that file reads resolve through the filesystem MCP server's path-jail. In MCP terms this is the resource surface the agent reads: the agent never accesses raw disk. Each document read produces one audit line (`actor quorum-agent`, `server @modelcontextprotocol/server-filesystem`, `inputs {path}`, `outputs {bytes, excerpt}`), which is also what "a finding cites which file" maps to mechanically.

## How they connect to the agent

Three distinct MCP wiring paths, one per consumer:

1. **Agent ↔ review graph (in-process).** The LangGraph review graph's nodes run the review logic directly; they do not go through the `/mcp` JSON-RPC dispatch. The shared pieces are the tool names, schemas and kinds that `tools/list` publishes, and the audit log. Calls that the graph makes are written to `tool-log.jsonl` in the same format as remote calls.
2. **Agent ↔ filesystem MCP (in-process via SDK over stdio).** Our sidecar holds a long-lived SDK MCP client session to the spawned filesystem server; document reads go through it, logging the read as done by *that* server.
3. **External MCP clients ↔ us (public JSON-RPC).** Any conforming MCP client can `initialize`, list tools and call them against our port (delegated internal calls return an explicit hint to use `POST /api/runs` for graph-driven paths; but `file_gate_submission`, the interesting one, works fully remote: even an outside caller cannot bypass the gate — it just creates `gate_pending` for a human).

## The integration layer

The Next.js browser app reaches the MCP sidecar through a **same-origin gateway** (`/api/*?XTransformPort=3031`, falling back to the app's own proxy handler) so the agent is never directly exposed to the web. The gate decision endpoint then consults the **committee roster** (fail-closed), and only on APPROVE does the disconnected `filing_graph` run, sealing with sha-256 and writing receipts.

In one sentence: **our agent doesn't just *use* MCP — MCP is the safe boundary it lives on, with real servers on both sides of it.**
