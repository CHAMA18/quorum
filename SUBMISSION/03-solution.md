# Solution

> **Briefly describe your solution, how it works, and who will use or benefit from it.**
> *Maximum 200 words.*

---

Quorum is an agentic tender-review system for public-health procurement in Africa: the agent prepares the file, the committee awards the tender.

How it works: our own MCP server (JSON-RPC 2.0 over HTTP) exposes five tools with typed input schemas — two that read (`tender_documents_list` via the official filesystem MCP server, `extract_requirements`) and three that change state (`flag_finding` writes to a findings ledger, `draft_redline` drafts committee redlines through a configured LLM endpoint (Llama 3.2 via Ollama in the live demo; Meta Model API or the template fallback), `file_gate_submission` files the award). A LangGraph.js review graph orchestrates the flow (load → extract → flag → verify → draft → propose the gate) and halts at the gate by construction — the edge to filing does not exist. Only a roster-verified signer, with quorum present, releases the filing graph — the bundle is sealed (sha-256), filed to the e-GP portal, and a receipt is written. Every tool call lands in an append-only audit log.

Who benefits: evaluation officers are meant to get a fully cited, committee-ready first-pass file faster at the review desk (the speed-up is a target; we have not timed it against a real desk); oversight bodies get a tamper-evident record of who decided what; procuring entities clear backlogs faster; and citizens get auditable awards instead of health supplies stuck in disputes.
