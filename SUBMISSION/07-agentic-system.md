# What Makes This an Agentic AI System

> **Explain what makes your solution an agentic AI system.**

---

## The one-line version

**A software actor with its own role, its own tools, and its own goal — going through a multi-step workflow, using state-changing tools, and stopping at a human gate it cannot cross by itself.**

If you asked "did a person review the file?" — at the moment it matters, yes, always. But it was the **agent** that read every page, wrote the findings, and drafted the redlines. That division of labor is what makes the system agentic.

---

## The five properties that make it agentic (and where each lives)

**1. It pursues a goal across multiple steps, without being told what to do at each one.**
The driver isn't a chat loop: it's a **LangGraph graph** (`load_documents → plan_review → extract_requirements → flag_findings → verify_findings ⇄ revise_findings → draft_redlines → propose_gate`). The agent decides what it still owes the goal *inside* the workflow — pinning clauses, cross-checking evidence, drafting language — one node feeding the next until it has either produced a complete committee-ready file or hit a boundary. Ask it nothing; it already knows the choreography.

**2. Its tools change the world, not just describe it.**
A read-only agent is an assistant; a write-capable agent is an actor. Our agent's hands are real: `flag_finding` **writes** to the findings ledger, `draft_redline` **writes** committee redlines, `file_gate_submission` **attempts** an irreversible filing — each with typed input schemas, each logged (READ / WRITES / IRREVERSIBLE) so its footprint is always inspectable (`tools/list` even publishes the kinds).

**3. It conditions behavior on what it observes.**
It doesn't run a fixed script; it reads the pack and *acts on what the pack says*: a missing required document becomes a cited finding; a bid value far above the peer median is flagged with the OCDS path as citation; a spec deviation gets its own redline draft. The `verify_findings` node then *re-checks its own work* against the cited documents before anything reaches a human — self-verification is a hallmark of agentic behavior.

**4. It knows its limits, from the architecture, not from a rule prompt.**
Agentic autonomy fails loudly at the wrong moment in most demos; ours can't fail that way, because **the edge from the gate to filing does not exist in the graph**. Raising `file_gate_submission` is the maximum the agent can reach on its own — the tool returns `gate_pending` and a human entry appears in the HUMAN GATE queue. Autonomy is *scoped by construction*, not by pleading with a model.

**5. It participates in a multi-agent protocol surface (MCP).**
The agent's abilities live in a tool registry served over real **MCP JSON-RPC 2.0** (`initialize` · `tools/list` · `tools/call`), so external MCP clients can inspect, delegate, and invoke the same tools any time. Our agent doesn't just *use* MCP to read the tender pack through the official filesystem server — it is itself reachable *through* the protocol. Multi-agent interop is native, not an afterthought.

## What it is *not* — and why that sharpens the claim

| This system is | This system is not |
| --- | --- |
| An agent with write-hands and an irreversible ambition it can only reach through a human | A chatbot — there is no chat loop; the agent initiates the work itself |
| Deterministic compliance logic + generative planning/drafting — reliability where it's law, flexibility where it's prose | A bare model wrapper — the LLM only plans review depth and drafts prose, and never decides compliance |
| An interop surface (MCP) other agents/systems can drive | A cron job — every action is conditioned on what the agent actually read |
| Honest about degradation — if the LLM endpoint is down, `draft_redline` falls back to a template, and the run completes rather than stalling | An autonomous filer — no prompt, no injection, and no graph path can file without a named human's signature |

## The honest scope note

The agentic qualities above — the workflow, the tools, the self-verification, the gate discipline — do **not** depend on the live model: they were built to survive model outages (hence the template fallback). The model's presence upgrades the *quality of the prose*, not the *agency of the agent*. That is why we call it an agentic **workflow** with an LLM *inside* one of its hands, not an "LLM agent" doing everything.
