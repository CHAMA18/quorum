# Dated verification evidence - 4 November 2026

These artifacts describe automated checks on fictional data. They are not a field pilot, legal certification, a security guarantee or an independently awarded hackathon score.

| Artifact | What it establishes | Limit |
| --- | --- | --- |
| `verification.json` | 509 tests pass, zero failures; 48 files; production build generates 48 pages with TypeScript enabled | Selected repository test command, local environment |
| `proof.json` | Source files/hash, review graph, actual Meta advisory and real HTTP approval refusals, followed by a signature-verified simulation receipt | Fictional tender and automated authorised accounts; no national filing |
| `browser-advisory.json` | Exact response returned by the later browser-triggered live review | Repeated model calls may vary in wording and quote count |
| `browser-review.json` | Authenticated product path, consent, model result, evidence gap and reduced-motion hydration; computed provenance colours | Desktop Chromium capture; human usability remains unmeasured |
| `read-audit-isolation.json` | A read through logical selector 3031 is traced into the configured isolated service on 3131 | Earlier audit URL defect is documented and fixed |
| `model-quality-before-fix.json` | Initial Meta challenge could not parse a complete response with a 400-token budget; Llama passed | Preserved failure, not counted as a pass |
| `model-quality-report.json` | After enough reasoning/output budget and a correct-deadline assertion, one injection probe passes for each configured model | Two prompts total; not a general prompt-injection resistance rate |

The corrected persisted audit is `persisted-model-audit.json`. It normalises the spine’s JSON-string payloads before counting real model calls; earlier reports did not recognise those payloads. Its availability failures are retained, and zero-observation rates are `null`, not 100%. The earlier model-quality reports preserve their original capture and challenge results. The bid-comparison quotations have a separate exact-source check in `proof.json` and `browser-advisory.json`. Quote existence does not establish semantic or legal correctness.

Run `npm test` and `bun run build`. Run `bun scripts/judge-proof.ts --production --keep-server` for the production integration, or omit `--production` for development. Live mode calls the configured model; `--template` skips the advisory and demonstrates template fallback. Stores and signing identities are temporary and never published. The exported receipt contains its public verification key only. Ports 3100/3131 must be free. Ctrl-C stops the runner's process group, leaving other apps alone.

The normal deployed workspace has not been updated by this local work. A final deployment and any public upload must use the reviewed artifacts and the institution's runtime secrets.
