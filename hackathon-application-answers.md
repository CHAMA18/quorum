# Hackathon Application Answers

**Projects identified via GitHub API (CHAMA18):**
- **Q1 anchor** — `the-bid-box-challenge` (public) + `quorum` (private code): **Quorum**, agentic tender review for public procurement. Deployed at `quorum.chungu-chama.com`; this folder is its submission/documentation kit.
- **Q2 anchor** — `CHAMA18/UlimaAI`: offline multilingual agricultural advisor (open-weights LLM, RAG, NLLB-200).

---

## Q1 · What do you want to build for this hackathon? *(186 words)*

I want to build Quorum — an agentic review desk for public procurement in Africa. Evaluation committees wade through tender packs of hundreds of pages by hand: backlogs delay hospital supplies, and thin award documentation is exactly what lets fraud go unchallenged. With today's agentic stack this is solvable: a LangGraph.js agent wired to its own MCP server reads every document over a sandboxed filesystem tool, pins the requirements, and raises findings — price outliers, missing compliance documents, spec deviations — each carrying a file-path citation, then drafts committee-ready redlines with an open-weights LLM served in-region, so procurement data never leaves the country. This build adds the pieces that make it pilot-grade: live e-GP and OCDS portal connectors, beneficial-ownership registry matching against bidders, and an eval layer with a second independent labeller. The one irreversible step — filing the award — stays behind a named human gate: the graph contains no edge to filing, so no prompt, tool misuse or model turn can do it, and only a roster-verified signature releases a sha-256-sealed filing with its receipt. The scope is real desks in Kenya and Rwanda.

---

## Q2 · Tell us about an AI project you recently built (what you built + techniques). *(187 words)*

UlimaAI — an offline agricultural advisor speaking 21 African languages (github.com/CHAMA18/UlimiAI), built in a three-day hackathon sprint. Smallholder farmers often have no connectivity, so it runs a fully local stack on commodity laptops ($150–500): Qwen2-1.5B quantized to Q4_K_M, served by llama.cpp on CPU at 15+ tokens/second under 7GB RAM — no internet, no API fees, works on battery. Techniques: (1) On-device open-weights inference — 4-bit quantization tuned for CPU-only hardware. (2) Multilingual NLP — per-language system prompts with region-specific crop varieties and farming calendars; automatic language detection; NLLB-200 translation bridging low-resource languages such as Lozi and English. (3) Retrieval-augmented generation — FAISS + ChromaDB index a local corpus (583 entries across 29 language files covering crops, pests, livestock, market access), grounding answers in agricultural knowledge beyond the model's limits. (4) Evaluation — 55 language-detection tests, 9 translator tests, and prompt-quality validation across 8 categories. (5) Frugal engineering — the entire advisor runs offline on integrated graphics with zero marginal cost per question. The result: expert farming advice in a farmer's own language, sovereign on their own device — the open-weights, in-region approach my proposed build expands on.

---

## Why UlimaAI for Q2 (not for pasting)

- Built Aug 22–25, 2026 — a genuinely recent, self-contained 3-day sprint.
- Different technical axis from Q1's Quorum: on-device quantized inference, RAG, and low-resource-language NLP instead of agent orchestration + MCP.
- The closing line ties it to Q1's "open-weights, in-region" claim — claiming two projects read together.
- Alternates considered: **delegate.ai** (solid, but too similar to Quorum's agent/theme) and **MedSigLIP** (dropped — model authored by Khanyi Tapiwa Magagula, AI Eswatini; don't claim it as yours).

## Security note

The GitHub personal access token pasted in chat was used read-only to inventory repos (171 owned) and confirm the projects. It has now been exposed in plain text — **revoke it immediately**: GitHub → Settings → Developer settings → Personal access tokens → delete. If any form asks for a token again, create a fresh fine-grained, expiring-in-7-days, read-only one instead.
