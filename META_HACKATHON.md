# Quorum - Meta hackathon submission

**Builder:** Chungu Chama / CHAMA18
**Project:** AI-assisted procurement review, starting with Zambia's public-health procurement context
**Theme:** Build for Your World
**Source:** [CHAMA18/the-bid-box-challenge](https://github.com/CHAMA18/the-bid-box-challenge)
**Product:** [Main Quorum domain](https://quorum-solutions.com) · [Supplier portal](https://quorum-solutions.com/org) · [Admin console](https://quorum-solutions.com/admin) · [Officer and committee sign-in](https://d1n7mv5t5hn4xe.cloudfront.net/#/login)

## The problem and who benefits

A hospital cannot use equipment still waiting for procurement review. Evaluation officers must reconcile issued criteria, bid documents, supporting certificates and committee questions into a defensible record. Quorum prepares that first-pass review and keeps the evidence beside the advice. The procurement officer is the initial user; committee members inspect the evidence and make the decision; auditors can trace the record. Better purchasing is the intended public benefit. Officer time saved and downstream service improvements remain unmeasured.

The scale starts with Africa: World Bank 2023 analysis puts public procurement at an average 17% of GDP across the region. UNECA cited a historical US$148 billion annual corruption estimate in 2015; its scope is broader than procurement. Zambia supplies the initial institutional context. ZPPA's 2023 annual report records 203 procuring entities and 71,102 suppliers on e-GP; selected follow-ups found recurring record and procedure gaps. These figures describe scale and oversight needs, not Quorum's market share or a representative national error rate. The [full project description and primary sources](SUBMISSION/01-problem-statement.md) distinguish the monetary evidence: the FIC's 2017 US$450 million estimate covered several suspected offences, with approximately US$50 million attributed to corruption; a separate case reported in 2022 involved an advance exceeding ZMW85 million (approximately US$4.25 million at the 2021 annual-average exchange rate). Another case involved US$32 million paid on a US$215 million contract where the FIC reported no works performed. These are historical estimates and case-level values, not a combined annual procurement-loss total.

## What Meta AI does

Muse Spark on Meta Model API plans the review, proposes source-linked reading aids, drafts committee questions and redlines, and compares every admitted bidder against the issued criteria. The advisory panel displays the returned model name, document count, verified quotation count and measured request duration. Positive or partial assessments require an exact quotation from that bidder's source. Unknown bidders, missing criteria, invented quotations and unsupported recommendations are rejected before display. Exact matching proves quotation existence; officers still check the interpretation.

The core review gateway supports institution-approved hosted processing with redaction and a configured Llama fallback. A separate, explicitly consented bid-comparison call shares the admitted source documents with Meta; it does not claim those complete documents are redacted. Institutions choose what may be processed under their own policies. SAM's opt-in table-region capability and the voice assistant are documented separately; the current main demonstration centres on document reasoning and the approval boundary.

Model advice stays separate from official committee scores, formal ranking and award authority. Neither model output nor a template is disguised as the other.

## The working demonstration

The main three-minute film contains **122 seconds from the supplied Part 1, Part 2 and Untitled recordings**, showing supplier checks, bid-review consent and results, committee membership and evaluator records. Earlier illustrative records are labelled separately and their varying fields are not presented as a current Zambia case. A separate production integration follows **one fictional Zambia case**, `ZM-DEMO-2026-001`: ten vaccine refrigerators, a ZMW480,000 ceiling, two timely bids, and issued technical/delivery criteria weighted 60/40. Dates place review after closing. Sources contain no real supplier tax record or personal identifiers. Starting state and automated test accounts are explicitly labelled as fictional. The separately documented KEMSA public award-register example is Kenyan, and is not substituted into this Zambia story.

Run `bash scripts/judge-demo.sh` after installing Bun and dependencies. It uses isolated temporary stores and web/service ports 3100/3131; refuses occupied ports; and never stops an existing app or changes its store. `--template` exercises the non-model path. Live mode requires a configured Meta endpoint and consumes its normal usage allowance. The script never sends email or makes a national e-GP transaction.

The [captured proof](SUBMISSION/evidence/current-run/proof.json) records the real model response, source bundle, graph run and HTTP approval boundary. Unsigned direct access is refused, a signed-in request without step-up is refused, and the gate remains pending with no receipt. A separate authorised fictional account completes TOTP; the server checks office authority and quorum; the local simulation then creates a signed receipt. Signature validity is independently exposed by the verification endpoint. These are integration results, not a human field pilot.

## Engineering that supports the product

- MCP tools connect the review to documents; the official filesystem server is pinned and launched from the local installation, with a tender-directory boundary.
- The LangGraph review ends after proposing the gate. Filing lives in a separate approval path; there is no review-graph edge to filing.
- Authenticated role checks, HMAC gateway attestation, gate-bound step-up verification, replay protection, Ed25519 decision receipts and a hash-chained audit log support a reviewable decision trail.
- Source-linked deterministic rules and model-output checks run separately. Model availability does not change official scores or manufacture evidence.
- Production builds run TypeScript checks. The dated verification report records test scope, build outcome and integration limitations; historic counts are not reused as current results.

## Evidence and next adoption step

See [current verification](SUBMISSION/evidence/current-run/README.md), [improvement tracker](SUBMISSION/IMPROVEMENT-TRACKER.md), [model evaluation scope](SUBMISSION/10-cost-and-audit.md), and the [officer study protocol](SUBMISSION/USER-VALIDATION.md). Existing evaluation labels have one reviewer. A blinded independent packet and a two-officer counterbalanced manual/assisted study are prepared; independent annotations, observed time saving, adoption commitments and willingness to pay are pending.

The next deployment is one consenting procurement unit reviewing one retrospective, non-sensitive tender in shadow mode. Its normal national procurement and approval processes remain in use. We will report material missed issues, unsupported statements and corrections as well as time, including results where assistance is slower. No corruption prevented, money recovered or national savings figure is claimed.
