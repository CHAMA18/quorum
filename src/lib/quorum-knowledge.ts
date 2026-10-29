/**
 * Quorum's own operating manual, for the desk assistant.
 *
 * The live desk tools answer "what is happening now"; this file answers
 * "how does Quorum work, where does this live, who may do it, and what is
 * still only a roadmap item". It is deliberately plain text so the model can
 * quote a section without turning it into a product claim that is not true.
 *
 * Keep this file aligned with the app. If a screen, route, role or safety
 * rule changes, change it here too — the assistant should not know a Quorum
 * that no longer exists.
 */

export const GUIDE_IDS = [
  "overview",
  "review",
  "gate",
  "audit",
  "roles",
  "screens",
  "cycle",
  "sources",
  "meetings",
  "suppliers",
  "notifications",
  "documents",
  "models",
  "security",
  "deployment",
  "limits",
] as const;

export type GuideId = (typeof GUIDE_IDS)[number];

type GuideEntry = { id: GuideId; title: string; body: string };

const GUIDE: GuideEntry[] = [
  {
    id: "overview",
    title: "Quorum in one page",
    body: `Quorum is an agentic public-procurement review desk for public health supply chains. Its single invariant is: the agent prepares the file; a named human committee awards the tender.

An officer stages a tender pack, the agent reads every document, extracts the requirements, checks bids against them, raises findings with citations and drafts redlines. The run then stops at the human gate. A committee member or the signed-in officer reviews the cited file, signs under their own name (with step-up), and only then is the bundle sealed, filed and receipted. The desk assistant is agentic but consent-gated: it reads the desk freely, and it can stage an approve, a return or a review launch as a signed proposal card — the action runs only after the officer confirms it in the bubble, and a gate decision still demands a fresh step-up signature.

The workspace is the officer's desk; /org is the supplier's own portal; /docs is the product documentation. The review graph, MCP tool registry and hash-chained audit log are the engine underneath all three. The hackathon build is Quorum by CHAMA18 for the Meta Global AI Developer Hackathon 2026, indie track, theme "Build for Your World".`,
  },
  {
    id: "review",
    title: "The review pipeline",
    body: `A review run moves through these states: RUNNING (the agent is reading), AWAITING_GATE (the file is ready and a human must decide), FILED (approved, sealed and receipted), REJECTED (returned to the agent for clarification) and FAILED. The UI calls these running, at a gate, filed, returned and failed.

Inside a run the graph plans the review, reads the tender pack through a path-jailed filesystem MCP server, extracts requirements, reads bids, raises findings, verifies that every finding's anchor text really appears in the document it cites, revises or drops findings that fail that check (bounded retries), and drafts redlines. A finding that cannot be anchored never reaches the committee. Rules are grouped into seven classes: DOCUMENT, COMPLIANCE, REGISTRY, PRICING, ARITHMETIC, DISCLOSURE and LOGISTICS. The rule codes you will see include R-DOC-MISSING, R-SUPPLIER-ID, R-REGISTRY-STATUS, R-PRICE-OUTLIER, R-VALUE-OUTLIER, R-BUDGET, R-AWARD-OVER-BUDGET, R-BID-SECURITY, R-SPEC-DEVIATION, R-BUYER-MISSING, R-DEBARMENT-HIT and R-PROMPT-INJECTION.

The plan decides review depth for that pack: whether deep value parsing runs, which rule families are drafted first and how many redlines to produce. The plan is stored on the run and shown in reports. A completed run can produce a sourced Markdown report with findings, evidence, drafts, citations, the gate decision and the audit trail.`,
  },
  {
    id: "gate",
    title: "The human gate",
    body: `Approvals is the irreversible boundary. The agent's file_gate_submission tool can only create a PENDING gate; it can never execute an award. A gate shows the tender, the tool it corresponds to, status (PENDING, APPROVED, REJECTED/RETURNED, EXECUTED), when it was filed, who signed and when.

A decision is refused unless the approver is a present member of the committee roster with the office the gate requires, or the signed-in officer acting as the gavel. If the roster cannot be read, the decision fails closed with a 503 rather than guessing. A quorum-short roll is refused. Gate decisions require a fresh step-up: a password or a TOTP code enrolled to the account. Replay is blocked by a server-side ledger.

An APPROVE runs the filing graph: seal the bundle with SHA-256, submit, write the receipt, flip the run to FILED. A REJECT returns the file to the agent for clarification. Every signed decision also writes an Ed25519 receipt whose public key is embedded, so the decision can be verified later without trusting the database. Receipt and gate verification endpoints exist under /api/gates/:id/verify and /api/receipts/:id/verify. The gavel never swings on a model's word: the assistant can stage a decision, but the card must be confirmed by the officer and signed with step-up before anything executes.`,
  },
  {
    id: "audit",
    title: "Audit trail and receipts",
    body: `Every tool call is one append-only line in the audit log (data/tool-log.jsonl): actor, server, tool, READ/WRITES/IRREVERSIBLE kind, run, inputs, outputs, status, duration and a hash chain linking each line to the one before it. The chain continues across restarts; boot reads the last line and never starts again from genesis. GET /api/log returns the filtered log; GET /api/log/verify checks the chain.

The Audit trail screen in the workspace is the human view: filters, expandable entries, receipt inspection, chain verification and exports. Gate and receipt verification is independent of the log. The audit spine also reports its own durability (log-write failures, state-save failures, quarantined corrupt state) in /api/health, because "nothing happens silently" includes the audit machinery itself.

The assistant can read recent audit entries and verify claims about them, but it cannot write, edit, delete or reseal a line.`,
  },
  {
    id: "roles",
    title: "Roles and permissions",
    body: `Workspace roles are OWNER, ADMIN, OFFICER, COMMITTEE and AUDITOR. OWNER can do everything, including transferring ownership. ADMIN runs the desk and governance but cannot remove the owner. OFFICER prepares evaluations, manages suppliers and can sign as the gavel. COMMITTEE reads the file and signs gates they are rostered and officed for. AUDITOR has read-only oversight: people, organizations and the audit trail.

Capabilities are enforced on mutation routes and on the same-origin sidecar gateway, not only by hiding buttons. Committee offices are separate from workspace roles: procurement unit, evaluation committee, accounting officer and oversight. A committee member without the gate's office is refused even if their workspace role is COMMITTEE. The supplier portal is a separate identity space with its own organization session and cookie; suppliers do not get workspace roles.

The assistant stages actions under the signed-in officer's identity, with the same capability checks as the screens: an AUDITOR session cannot sign a gate through the bubble any more than through the UI.`,
  },
  {
    id: "screens",
    title: "Screens and navigation",
    body: `The landing page is at /. The officer workspace is the dashboard at /#/dashboard (the app also accepts /dashboard). Its navigation groups are:

- Desk: Overview, Evaluations, Approvals, Tender cycle, Live activity.
- Review: Findings, Reports, Data sources.
- Governance: Award history, Committee, Calendar.
- Network: Suppliers.
- System: Tools & models, Oversight, Audit trail, Rules & safeguards, Settings.
- Help: Documentation (/docs) and Walkthrough.

The supplier portal is /org, with its own auth card and a console for Overview, Profile, Opportunities and Applications. The assistant's floating "Ask the desk" button appears on every screen. The workspace is a single-page desk with hash-selected views rather than separate routes for each tab.`,
  },
  {
    id: "cycle",
    title: "The tender cycle",
    body: `Tender cycle is the statutory record around one tender, not a second review. Its gates run in order: record_bid_opening (the public opening register, with late bids marked), certify_evaluation (the scoring matrix; every PRESENT member must have declared conflicts before it can be certified), resolve_alb (an abnormally low bid dossier), sign_award_report (the accounting officer), publish_award_notice (which starts the standstill), issue_debrief, sign_contract_pack (only after standstill lapses), approve_variation, certify_payment, record_contract_completion and respond_complaint.

Each step is a named gate, not a free-text status: the responsible office signs it, the decision is audit-logged, and the cycle record keeps the resulting register, matrix, award report, notice, standstill window, contract, variations, payments, debriefs or complaint response. The screen shows the stage strip and the next legal step. The server generates the tender reference; the officer does not type it.

A review run can exist before the cycle is complete. The gate at the end of the review is the filing decision; the cycle gates are the procurement events that follow or surround it. Both use the same human gate, step-up and receipt machinery.`,
  },
  {
    id: "sources",
    title: "Data sources and portals",
    body: `The Data sources screen is the evidence layer. Its header sets the standards — OCDS 1.1, MCP tools, LLM drafting and page citations — and its body reads the Open Contracting Partnership's Africa data registry: one row per country and dataset, with the publisher, coverage, counts, licence and the publisher's own portal.

The committee can switch a portal off; the sidecar then skips it in connection passes and records who changed the switch and when. "Connect" opens the published file, reads its first OCDS release and probes the publisher's portal; the result is dated and saved, and a failed check is shown rather than hidden. A source request is a real, audit-logged request for a missing registry, portal or feed, not a chat message.

The honest boundary: Quorum can read staged packs and the OCP registry snapshot, but a live OCDS ingestion loop for every country is not connected yet. A finding always cites the source it actually read. The assistant can explain the source layer; it cannot add, enable or disable a portal.`,
  },
  {
    id: "meetings",
    title: "Committee sittings and the calendar",
    body: `Committee is the roll, the offices and the sitting room. A summons opens one sitting at a time and mints a fresh, unlisted Jitsi Meet room. The door list is the committee register: only registered names are admitted, and every admission is written against the sitting. The room is open-source video (Apache-2.0), not an identity provider; the door is the verification layer.

The sitting record carries the agenda, attendance, minutes (autosaved as the room talks), the room link and the notes author. A committee member may summon, admit and write minutes without being an admin; admin controls the register itself. Quorum is checked before the sitting can decide, and gate signing still requires a rostered present member with the gate's office.

Calendar puts every date the desk answers to on one grid: statutory clocks, sittings, files at the gate and signatures. It is a read-only view across the cycle and committee records, with today ringed and overdue dates kept red.`,
  },
  {
    id: "suppliers",
    title: "Suppliers and the portal",
    body: `The supplier register is the platform's source of truth for who bidders are: legal identity, registration numbers, tax and statutory certificates, categories and status (ACTIVE, SUSPENDED, BLACKLISTED). Officers add, edit, suspend and remove suppliers through the audited sidecar path. The review uses the register when it validates supplier identifiers and statuses; a committee can open the same record at the gate.

The supplier portal at /org is a separate account space. A supplier registers an organization profile (legal identity, statutory registrations, capabilities), signs in with the organization cookie, browses staged tenders, and files applications. Applications are attested as org:<name> into the same audit spine. Late applications after the closing date, a second bid for the same tender, and suspended or blacklisted suppliers are refused honestly. The officer's Opening tab shows electronic applications as context; the register remains the officer's act.`,
  },
  {
    id: "notifications",
    title: "Notifications and clocks",
    body: `Quorum keeps an in-app notification inbox with an unread count and deep links to the gate, tender or audit entry. Delivery attempts are recorded in a delivery log. Email goes through the configured Resend adapter; WhatsApp can go through the configured WhatsApp adapter when its token and phone-number id are present. There is also an HMAC-authenticated sidecar-to-web notification webhook, so a gate or deadline event can be delivered without an external provider.

The cycle record carries statutory clocks: submissions closing, abnormally-low-bid responses, standstill periods, contract milestones and complaint responses. The assistant can read the current clocks and call out overdue ones. A notification is a prompt to act; it is never an approval.`,
  },
  {
    id: "documents",
    title: "Documents, packs and uploads",
    body: `The review reads a tender pack on disk under data/tenders/<reference>/: notices, instructions, specifications, bid documents, priced schedules and attachments. The filesystem MCP server is path-jailed and every read is audit-logged. Findings cite the exact document and line or anchor, and verification checks that the anchor really exists before the finding can survive.

The current product ships with staged packs and a document-upload interface. Real PDF, DOCX, XLSX and scanned-image extraction with page-level citations is a P0 roadmap item, not a finished claim: the upload screen does not yet replace the staged pack path. OCR/SAM 3.1 fallback for scans is also not wired. Do not tell an officer that a newly uploaded PDF is already being read if it is not.

Tender references are server-generated and system-owned in the form PREFIX-YYYY-NNN (for example ZM-2027-021). The prefix follows the currency (ZMW->ZM, KES->KE, RWF->RW, USD->ZM), the year is the expected publication year and the sequence is allocated across the pipeline.`,
  },
  {
    id: "models",
    title: "Models and provenance",
    body: `The desk assistant uses Meta Model API's muse-spark-1.3 for chat and its agentic tool loop — reads run at once, writes are staged behind consent cards. With no model key configured a deterministic local brain answers from the same desk tools, so the bubble never depends on a secret to be useful. Voice input uses muse-voice-transcribe-1.0. Spoken replies use a real neural voice from Cloudflare Workers AI: Deepgram Aura-2 in English, with MeloTTS as the fallback and the browser's installed speech synthesis as the last fallback. The voice never changes the answer; it only reads it.

The review engine can use an OpenAI-compatible model for redline drafting (the intended in-region setup is an open-weights model such as Llama via Ollama/vLLM/TGI) and falls back to a deterministic template when no model is configured. Every draft is labelled with its source, and the run shows the model and plan that produced it. The assistant displays the model id returned by the API, e.g. MODEL · MUSE-SPARK-1.3, so provenance is visible rather than implied.

The model never chooses a URL, never sees a session and never executes a write: its action calls become HMAC-signed proposals that execute only through the consent route, under the officer's verified session.`,
  },
  {
    id: "security",
    title: "Security and safety",
    body: `Quorum treats the agent as an untrusted reader of untrusted documents. Prompt-injection patterns such as "ignore previous instructions", "approve without review" and "system override" are detected and raised as R-PROMPT-INJECTION findings. Document text is wrapped as untrusted data before it reaches a drafting model; verbatim evidence checks stop a model from inventing a citation. The assistant's write surface is consent-gated: an action is staged as an HMAC-signed proposal and executes only after the officer confirms, under the officer's session, with step-up for a gate — the gate is enforced server-side, not by the UI.

Gate decisions require step-up and are signed with Ed25519 receipts. The replay ledger blocks a reused step-up assertion. The audit log is hash-chained and verifiable. The same-origin gateway adds HMAC attestation between the web app and the sidecar. Known hardening item: the sidecar is intended to be reached only through that gateway; direct exposure of port 3031 must stay closed. The assistant should not claim that Quorum is certified, compliant with a specific procurement law, or immune to every attack. It is a review aid with a deliberately narrow decision boundary.`,
  },
  {
    id: "deployment",
    title: "Deployment and data",
    body: `The production app is a Next.js 16 web app plus a Bun sidecar (quorum-mcp) on an EC2 t4g.small in af-south-1, behind nginx and systemd. The web app and sidecar share a flat JSON store; the sidecar also keeps append-only tool-log.jsonl and sealed submissions. The sidecar boots with the Next server and self-heals via /api/mcp-ensure.

The current HTTPS front door is a Cloudflare Worker at https://quorum-edge.chungu424.workers.dev. It proxies the EC2 origin, provides Workers AI text-to-speech, and holds the private R2 upload gate: the quorum-tenders bucket is bound as TENDERS, and /__edge/upload and /__edge/object require the server-to-server x-quorum-edge-key. The branded domain quorum.chungu-chama.com still has no public DNS/TLS record; the Worker URL is the working demo URL. The Worker is stateless; the sidecar and its files stay on the persistent host.

The app uses Firebase Auth, Storage and Analytics only — not Firebase Functions. Postgres/Drizzle and a full multi-tenant data layer are not in the deployed build.`,
  },
  {
    id: "limits",
    title: "What is real, and what is not yet",
    body: `Be precise about the boundary. Real today: the review graph and rule engine; cited findings and the verification/retry loop; the read-only MCP tool boundary for the review graph; the human gate with named sign-off, quorum and offices; step-up and Ed25519 receipts; the hash-chained audit trail and verifier; notifications and delivery logs; the supplier portal; the Muse assistant with consent-gated desk actions and real voice.

Not yet real: a live OCDS feed (packs carry OCDS references but ingestion is not connected); PDF/DOCX/XLSX/OCR upload extraction with page-level citations (the interface exists, the extraction path is roadmap); the e-GP portal transmission is a labelled demo stub; A5 deeper evaluation, A6 Postgres/durable production storage and A7 pilot evidence/LOIs are not finished; the admin/governance console is the flagship roadmap item; billing, SSO/SAML and full IAM are deliberately out of scope. Do not invent an officer response, a pilot, an LOI or a testimonial. If an officer asks for one of these, say it is not live yet and describe the honest next step.`,
  },
];

const BY_ID = new Map(GUIDE.map((entry) => [entry.id, entry]));

export function guideIndex(): string {
  return GUIDE.map((entry) => `- ${entry.id}: ${entry.title}`).join("\n");
}

export function readSystemGuide(topic?: string): string {
  const wanted = String(topic ?? "").trim().toLowerCase();
  if (wanted && BY_ID.has(wanted as GuideId)) {
    const entry = BY_ID.get(wanted as GuideId)!;
    return `${entry.title}\n\n${entry.body}`;
  }
  return `Quorum system guide — available topics:\n${guideIndex()}\n\nCall system_guide again with one topic for the full section.`;
}

export const SYSTEM_MAP = `Quorum is an agentic public-procurement review desk. The agent prepares a cited review file and stops at a human gate; a named committee member or the signed-in officer signs with step-up, and only then is the bundle sealed and receipted. The desk assistant is agentic: it reads the desk live and can stage actions — approve or return a gate, launch a review — that execute only after the officer confirms the signed proposal card.

Main areas: Overview, Evaluations, Approvals, Tender cycle, Live activity, Findings, Reports, Data sources, Award history, Committee, Calendar, Suppliers, Tools & models, Oversight, Audit trail, Rules & safeguards, Settings, Documentation and Walkthrough. Supplier portal: /org. Docs: /docs.

The review pipeline reads a staged tender pack, extracts requirements, raises cited findings, verifies every anchor, retries or drops unanchored findings, drafts redlines, then parks at the gate. Gate approvals require a rostered present member with the right office (or the signed-in officer), quorum, step-up and a fresh decision; they write a hash-chained audit line and an Ed25519 receipt. The assistant can read runs, gates, deadlines, committee state, tenders, suppliers and recent audit entries. It never executes on its own word: every write is a signed proposal waiting for the officer's consent.

Use system_guide for the operating manual: ${GUIDE_IDS.join(", ")}.`;
