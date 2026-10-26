"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, CircleAlert, Gavel, Maximize2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TourLayer, type TourStep } from "@/components/quorum/tour";

/* ── Quorum's documentation — the complete handbook ────────────────────────
   Its own page at /docs: Docusaurus-grade depth, written for the first-time
   officer and the auditor alike — every screen, every rule, the gate
   protocol, and Zambia's procurement law as the engine implements it.
   Chapters carry real screenshots of the screens they describe; the shots
   are frozen in public/docs and expand into a lightbox on click. */

type DocCalloutTone = "rule" | "law" | "tip" | "warn";

type DocFigure = { src: string; alt: string; caption: string; screen: string };

type DocBlock =
  | { kind: "p"; text: string }
  | { kind: "steps"; title?: string; items: string[] }
  | { kind: "table"; title?: string; head: string[]; rows: string[][] }
  | { kind: "terms"; title?: string; items: { term: string; def: string }[] }
  | { kind: "callout"; tone: DocCalloutTone; title: string; text: string }
  | ({ kind: "figure" } & DocFigure)
  | { kind: "methods" };

type DocChapter = {
  id: string;
  kicker: string;
  title: string;
  lead: string;
  blocks: DocBlock[];
};

const DOC_CHAPTERS: DocChapter[] = [
  {
    id: "start",
    kicker: "Orientation",
    title: "What Quorum is",
    lead: "An agentic review desk for public procurement. The agent reads the file, checks it against the rules and the law, and drafts findings with citations — then stops at a gate and waits for named humans to decide.",
    blocks: [
      {
        kind: "p",
        text: "Quorum prepares the file. It never awards the tender. Everything on this platform is built around that single line: the agent may read, extract, check and draft, but the decision to award or return belongs to the committee — signed under a real name and recorded permanently.",
      },
      {
        kind: "callout",
        tone: "rule",
        title: "The standing rule",
        text: "QUORUM PREPARES THE FILE. IT NEVER AWARDS THE TENDER. THE COMMITTEE SIGNS — THE AGENT NEVER DOES.",
      },
      {
        kind: "p",
        text: "The platform has three faces on one address. The landing page explains the product. The sign-in screen authenticates officials. The workspace behind #/dashboard is where the work happens: evaluations, findings, approvals, the supplier list, and these documents.",
      },
      {
        kind: "figure",
        src: "/docs/overview.png",
        alt: "The Quorum workspace overview: greeting, live stat tiles and the recent evaluations list with start times",
        screen: "WORKSPACE · OVERVIEW · CAPTURED 18 OCT 2026",
        caption:
          "The workspace as it stood when these pages were written: the evaluations table, the approvals queue and the live sources rail — every number read straight from the agent service, none written by hand.",
      },
      {
        kind: "table",
        title: "The mission in four moves",
        head: ["MOVE", "WHERE", "WHAT HAPPENS"],
        rows: [
          ["Brief", "New evaluation wizard", "Name the tender and stage its documents — OCDS records, a PDF pack or the email bag."],
          ["Review", "Agent runs", "The agent reads the pack, extracts requirements and sweeps the rules. Findings appear with page-level citations."],
          ["Decide", "Approvals", "The gate. A committee member reads the cited findings and signs to award, or returns the tender for clarification."],
          ["Record", "Award history", "The history appends the decision, the signer and the time. Nothing is edited; entries are only added."],
        ],
      },
      {
        kind: "steps",
        title: "Your first five minutes",
        items: [
          "Open the workspace from the top of the page once signed in.",
          "Read the Overview's four live counters — runs in progress, issues found, sourced coverage and approvals waiting.",
          "Open Suppliers from the sidebar and check the register of bidders your entity deals with.",
          "Launch a run against one tender — or a sample pack — and watch the register fill in.",
          "When a gate appears, read the findings, then sign or return. That is the whole loop.",
        ],
      },
      {
        kind: "callout",
        tone: "tip",
        title: "Tip",
        text: "If a screen ever feels empty, it is telling you the truth: no runs have been queued, or nothing is waiting on a signature.",
      },
    ],
  },
  {
    id: "pipeline",
    kicker: "The engine room",
    title: "How a review runs",
    lead: "A run is one tender reviewed end to end by the quorum-mcp agent — a LangGraph pipeline calling five MCP tools, with every call logged.",
    blocks: [
      {
        kind: "steps",
        title: "The lifecycle of a run",
        items: [
          "Stage the pack. The tender's documents are placed in its folder; every file is listed.",
          "Extract requirements. The SHALL/must clauses of the notices are pinned — read-only, nothing stored.",
          "Sweep the rules. Bids are parsed, prices compared, identifiers validated and notices checked — each finding is born with a citation.",
          "Draft the redline. For a finding, the agent drafts the correction, using the configured LLM or the template fallback.",
          "Raise the gate. The award submission bundle is filed as pending: execution is blocked until a named human approves.",
          "Decide. Approve executes the filing and closes the run; return re-opens the loop for clarification.",
        ],
      },
      {
        kind: "figure",
        src: "/docs/runs.png",
        alt: "The Agent runs register: one row per tender with bids, issues found, sourced claims, status and time",
        screen: "WORKSPACE · AGENT RUNS · CAPTURED 18 OCT 2026",
        caption:
          "The evaluations table — one row per tender. Statuses are derived from what actually happened in each evaluation: in progress, needs approval, or complete.",
      },
      {
        kind: "table",
        title: "The five tools",
        head: ["TOOL", "KIND", "WHAT IT DOES"],
        rows: [
          ["tender_documents_list", "READ", "Lists the tender's files for a reference via the official filesystem MCP server."],
          ["extract_requirements", "READ", "Pins the SHALL/must clauses in a tender's notices. Read-only — it stores nothing."],
          ["draft_redline", "WRITES", "Drafts a redline for a finding, using the configured LLM or the template fallback."],
          ["flag_finding", "WRITES", "Flags a finding. Accepted only if its citation names a document in the tender and its anchor text appears there."],
          ["file_gate_submission", "IRREVERSIBLE", "Files the award submission bundle. Execution is blocked until a named human approves at the gate."],
        ],
      },
      {
        kind: "callout",
        tone: "warn",
        title: "The irreversible tool",
        text: "file_gate_submission is the only irreversible call in the stack, and it is deliberately powerless on its own: it files a pending bundle and returns gate_pending. Nothing executes until a person with a name signs.",
      },
      {
        kind: "p",
        text: "Every call — read or write — lands in the audit log with actor, inputs, outputs and duration. The Tools & models screen renders that same log; the raw record lives at mini-services/quorum-mcp/data/tool-log.jsonl on the host.",
      },
      {
        kind: "callout",
        tone: "tip",
        title: "Citation discipline",
        text: "A finding whose citation does not name a real document in the tender is rejected before it ever reaches the committee. If you remember one engineering rule: nothing uncited survives the pipeline.",
      },
      {
        kind: "figure",
        src: "/docs/run-detail.png",
        alt: "A run row opened in the register: the top issues the agent flagged, each as a chip, with the sourced report download",
        screen: "WORKSPACE · AGENT RUNS · ONE RUN OPENED",
        caption:
          "One run opened. Every flagged issue is a chip that names what was seen; the sourced report — findings, citations, audit hash — downloads from the same row.",
      },
    ],
  },
  {
    id: "launch",
    kicker: "Daily work",
    title: "Launching an evaluation",
    lead: "The New evaluation wizard takes three steps and never starts until you confirm the scope. Most runs take minutes to brief.",
    blocks: [
      {
        kind: "steps",
        title: "The wizard, step by step",
        items: [
          "Details. Enter the tender reference and the published title exactly as they appear, then choose the source format: OCDS records, a PDF pack or the email bag. The wizard suggests the next reference in your register's sequence, or reads one out of a staged filename.",
          "Documents. Drop up to twelve files. Each moves from RECEIVED to PARSING to INDEXED; nothing can launch while a document is still being read. Uploads mirror to cloud storage when configured, or stay in the local vault.",
          "Scope. Choose which checks run — specifications, quantities and prices. Page-level citations stay on for every finding, always.",
          "Launch. The run is queued and you land on Agent runs, where it goes live in front of you.",
        ],
      },
      {
        kind: "table",
        title: "Staging states",
        head: ["STATE", "MEANING"],
        rows: [
          ["RECEIVED", "The file is in hand and queued for reading."],
          ["PARSING", "The reader is extracting text, tables and price lines."],
          ["INDEXED", "The document is readable by the review and will be cited."],
        ],
      },
      {
        kind: "p",
        text: "A sample registry ships with the stack — real packs with notices, bids and OCDS records. Staging a sample is the fastest way to see a full review without touching a live file; the run behaves exactly like a real one.",
      },
      {
        kind: "figure",
        src: "/docs/new-evaluation.png",
        alt: "The New evaluation wizard: step 1 details with an assigned tender reference, source format choices and the sample tender registry open",
        screen: "WORKSPACE · NEW EVALUATION · STEP 1 OF 3",
        caption:
          "The wizard at step one: the reference is assigned by the register and locked, the format is a choice, and the sample registry stages a real pack — with its own bids and price deviations — in one click.",
      },
      {
        kind: "callout",
        tone: "tip",
        title: "Naming matters",
        text: "The reference you type is the join key for everything afterwards: files, findings, gates and history rows. If the published document names the tender differently, keep the document's spelling — the agent matches on what the papers say.",
      },
    ],
  },
  {
    id: "findings",
    kicker: "The evidence",
    title: "Findings & the rulebook",
    lead: "Every issue is a finding: a rule, an item, the evidence, and a citation to the exact page, line or clause where it was seen.",
    blocks: [
      {
        kind: "p",
        text: "Findings are grouped into seven classes so a committee can scan a file quickly: DOCUMENT, COMPLIANCE, REGISTRY, PRICING, ARITHMETIC, DISCLOSURE and LOGISTICS. A finding with no citation is marked unsourced and should not be relied on — treat it as a question, not a conclusion.",
      },
      {
        kind: "table",
        title: "The rule register",
        head: ["RULE", "SEVERITY", "WHAT IT CATCHES", "THE COMMITTEE'S MOVE"],
        rows: [
          ["R-DOC-MISSING", "MEDIUM", "A document the notice lists as REQUIRED that a bid never references.", "Ask the bidder to supply it, or mark the bid non-responsive."],
          ["R-SUPPLIER-ID", "HIGH", "A supplier identifier that breaks its own national scheme — or a line that states none at all.", "Verify the identifier against the registry before relying on the bid."],
          ["R-BUYER-MISSING", "MEDIUM", "A tender notice that never names the buyer.", "Trace the buyer to the record; a notice nobody owns is a governance gap."],
          ["R-AWARD-OVER-BUDGET", "HIGH", "An OCDS award value above the published tender value.", "Review the justification before any award moves."],
          ["R-PRICE-OUTLIER", "HIGH", "A unit price two times or more against the peer median on the same line item.", "Check the arithmetic and the specification; outliers concentrate abuse."],
          ["R-SPEC-DEVIATION", "HIGH", "Bid lines offering alternatives, requesting deviations or stating non-compliance.", "Weigh the deviation against the specification before scoring."],
          ["R-VALUE-OUTLIER", "HIGH", "A bid value more than twice the median of its peers.", "Confirm the scope is comparable before treating the bid as competitive."],
          ["R-OVER-BUDGET", "HIGH", "A bid value above the budget ceiling parsed from the notice — including currency mismatches.", "A bid above the ceiling cannot be awarded without a lawful revision of the budget."],
        ],
      },
      {
        kind: "steps",
        title: "How a finding lives and dies",
        items: [
          "OPEN — raised by the agent, waiting for the committee's attention.",
          "CLEARED — the gate signed to award; the finding is part of the record that informed the decision.",
          "RE-CHECK — the tender was returned for clarification and the agent re-verifies.",
        ],
      },
      {
        kind: "callout",
        tone: "tip",
        title: "Reading a citation",
        text: "Citations name the file and the anchor — a page, a clause, a price schedule. Open the cited document at that anchor. If the anchor doesn't exist, the finding doesn't pass the pipeline in the first place.",
      },
      {
        kind: "figure",
        src: "/docs/findings.png",
        alt: "The Findings screen: the flagged issues listed with their severity, rule code and source run",
        screen: "WORKSPACE · FINDINGS · CAPTURED 18 OCT 2026",
        caption:
          "The findings board — every flag kept across the runs, each classified and attributed. Nothing here is a paraphrase; open one and read its citation.",
      },
    ],
  },
  {
    id: "gates",
    kicker: "The human gate",
    title: "Approvals, the committee and the gavel",
    lead: "The gate is the handover moment: the agent's work stops, and named humans decide.",
    blocks: [
      {
        kind: "p",
        text: "A pending gate shows the supplier, the value and how many findings were flagged. Read them against the cited documents, then sign to award or return for clarification. A return is not a rejection of the agent — it re-opens the file so the questions you raise can be cleared.",
      },
      {
        kind: "table",
        title: "The two decisions",
        head: ["DECISION", "WHAT IT RECORDS", "WHAT FOLLOWS"],
        rows: [
          ["APPROVE", "The award, signed by the officer who decided.", "The filing executes and the history appends AWARDED with the signer and time."],
          ["REJECT / RETURN", "A return for clarification, with the signer recorded.", "The loop re-opens; findings become RE-CHECK while the agent re-verifies."],
        ],
      },
      {
        kind: "p",
        text: "Signatures are enforced by the agent service, not in the browser. An approval is refused unless the approver is a present member of the committee roster or the signed-in officer; if the roster cannot be read at all, the decision is refused rather than guessed. Nobody can approve into a name that isn't theirs.",
      },
      {
        kind: "steps",
        title: "Summoning a sitting",
        items: [
          "Open Committee from the sidebar to see the roster in roll-call order: the chair, the members, the excused, and you.",
          "Summon a sitting to call the roll — it timestamps the summons and refreshes the count.",
          "Quorum is checked before decisions: the default standing house is nine seats with five required.",
          "When quorum is present, any pending gate can be decided.",
        ],
      },
      {
        kind: "figure",
        src: "/docs/approvals.png",
        alt: "The Approvals screen: the queue of files waiting at the gate, each with its supplier, value and flagged findings",
        screen: "WORKSPACE · APPROVALS · CAPTURED 18 OCT 2026",
        caption:
          "The gate queue — every file waiting with its supplier and flags, read against the cited documents. Award executes the filing; return re-opens the loop. Both are signed, by name.",
      },
      {
        kind: "callout",
        tone: "rule",
        title: "The gavel protocol",
        text: "THE AGENT QUEUES THE FILE AT THE GATE. THE COMMITTEE READS THE CITED FLAGS. AWARD OR RETURN — BY NAMED HUMANS. THE LEDGER LOGS IT, PERMANENTLY.",
      },
    ],
  },
  {
    id: "zambia",
    kicker: "The law",
    title: "Zambia's procurement regime",
    lead: "First up among the jurisdictions the platform serves: Zambia — the Public Procurement Act No. 8 of 2023, which repealed and replaced the 2008 Act, and the Public-Private Partnership Act No. 14 of 2009.",
    blocks: [
      {
        kind: "p",
        text: "The engine reviews a file with the lawful methods in view: open and limited bidding, direct bidding, simplified bidding, force account, community participation, purchases from other procuring entities, PPP concessions, and the alternative-method route via the Zambia Public Procurement Authority. The method register below is the engine's own data — loaded live, so what you read here is what the review applies.",
      },
      { kind: "methods" },
      {
        kind: "table",
        title: "Reading a method card",
        head: ["FIELD", "WHAT IT MEANS FOR THE FILE"],
        rows: [
          ["Legal basis", "The statute the method rides on — name it in the record when the method is questioned."],
          ["When this is lawful", "The conditions that must hold. A choice that doesn't fit them is a finding waiting to happen."],
          ["Value band", "Where the law draws a line — simplified bidding up to K1 million, open bidding above it."],
          ["Advertising", "Whether the invitation must be gazetted and advertised, or goes only to nominated firms."],
          ["Float period", "The minimum time bidders get: four weeks national, six weeks international."],
          ["Award authorisation", "Who signs: the Procurement Committee, the Central Tender Committee, or the Authority — never the agent."],
        ],
      },
      {
        kind: "callout",
        tone: "law",
        title: "Deviations need a ground",
        text: "Every non-open method must trace to a named statutory ground in the record. Urgency without a stated cause is the classic red flag — the review is built to catch exactly that.",
      },
      {
        kind: "callout",
        tone: "warn",
        title: "Alternative methods",
        text: "A method outside the list needs the ZPPA's approval before use, not after. For the agent, an unapproved method is a STOP: the review still runs, but the gate must name the missing approval.",
      },
      {
        kind: "p",
        text: "The register underneath all of this is the supplier roll: the certificates and registrations a bidder must hold. Keep it current — the review reads it, and so does the committee.",
      },
    ],
  },
  {
    id: "suppliers",
    kicker: "The register",
    title: "The supplier list",
    lead: "Every bidder the platform knows, held in the agent’s store with the registration detail Zambia's regime asks a bidder to carry.",
    blocks: [
      {
        kind: "p",
        text: "The register is the platform's single source of truth for who the bidders are. It is what the review leans on when it validates supplier identifiers, and what a committee opens when a name at the gate needs checking. It is maintained by officers and written through the same audited path as everything else — additions, edits, suspensions and removals are all tool calls in the log.",
      },
      {
        kind: "table",
        title: "What each field is for",
        head: ["FIELD", "WHY IT IS COLLECTED"],
        rows: [
          ["Supplier name", "The name that appears on bids — keep the legal spelling on the certificate."],
          ["Registration number", "The PACRA / Registrar of Societies number that identifies the legal entity. Picking a firm off the ZPPA roll fills it as published."],
          ["ZRA Tax PIN", "The Zambia Revenue Authority taxpayer number."],
          ["ZRA Tax Clearance No", "The certificate number a compliant bid must carry."],
          ["Tax clearance expiry", "The certificate's standing. An expired clearance makes a bid non-responsive — the classic check a committee runs first."],
          ["Sector regulator + number", "NCC, NHCC, ERB, ZPPA and similar registrations where the category requires one."],
          ["Categories", "What the firm supplies or the works it executes — the basis for matching a supplier to a tender."],
          ["Contact details", "Who signs for the firm, and how to reach them when a bid needs clarification."],
        ],
      },
      {
        kind: "steps",
        title: "Keeping the register true",
        items: [
          "Add a firm: open Suppliers and press REGISTER A SUPPLIER — the intake opens as a dialog over the register. Name and registration number are the only required fields; everything else hardens the record.",
          "Edit: open the row and update as papers renew — every change stamps the update time and lands in the audit log.",
          "Suspend or blacklist: a firm that should not be considered while a question is open, or at all.",
          "Remove: for entries created in error. The audit log still remembers — removal is a recorded act, not an erasure.",
        ],
      },
      {
        kind: "figure",
        src: "/docs/suppliers.png",
        alt: "The Supplier register screen: an empty register with the REGISTER LINKED badge and the REGISTER A SUPPLIER button",
        screen: "WORKSPACE · SUPPLIER REGISTER · CAPTURED 18 OCT 2026",
        caption:
          "A fresh list, saying so — empty until real firms are added. The badge reports the agent service's live link to the supplier store; the intake opens as a dialog over the list, and every write lands in the audit log.",
      },
      {
        kind: "p",
        text: "The intake opens with the published record at hand. The agent service ships the ZPPA roll — a derived reading of Zambia's e-GP open contracting data, the Zambia Public Procurement Authority's record published through the Open Contracting Partnership. Pick a firm off the roll and the form fills itself: legal name, PACRA number, address, telephone and the supply categories its award history points to — every value exactly as published, and every field still the officer's to correct. The record suggests; the officer confirms.",
      },
      {
        kind: "figure",
        src: "/docs/zppa-intake.png",
        alt: "The intake dialog: Karibu Pharmaceuticals Limited picked off the ZPPA record, with its PACRA number, contact details and award history filled in",
        screen: "WORKSPACE · SUPPLIER INTAKE · FILLED FROM THE ZPPA RECORD",
        caption:
          "The intake, filled from the published record: name, PACRA number, telephone and address arrive exactly as published — with the award history the values came from underneath. The record suggests; the officer confirms.",
      },
      {
        kind: "callout",
        tone: "tip",
        title: "The roll's source",
        text: "Zambia Public Procurement Authority — e-GP record, released through the Open Contracting Partnership (data.open-contracting.org/en/publication/3, CC BY 4.0). The roll ranks firms by awards on the record; tender and award counts and value totals are computed over it. The register stays the platform's own truth — the roll is only a head start.",
      },
      {
        kind: "table",
        title: "Statuses",
        head: ["STATUS", "MEANING"],
        rows: [
          ["ACTIVE", "Considerable in reviews and at gates."],
          ["SUSPENDED", "Held back pending resolution of a question — visible but flagged."],
          ["BLACKLISTED", "Excluded. The strongest statement the register can make."],
        ],
      },
      {
        kind: "callout",
        tone: "warn",
        title: "Supplier identifiers",
        text: "The R-SUPPLIER-ID rule reads what bids state about themselves: an identifier line that breaks its own national scheme — or states none at all — is flagged HIGH. A truthful register is what lets the committee tell a typo from a fabrication.",
      },
    ],
  },
  {
    id: "safeguards",
    kicker: "Governance",
    title: "Rules & safeguards",
    lead: "The thresholds the agent applies to every run — and the lines that never move.",
    blocks: [
      {
        kind: "table",
        title: "The guards",
        head: ["SAFEGUARD", "SETTING", "EFFECT"],
        rows: [
          ["Price variance flag", "15% · 25% · 40%", "Flag any bid priced above the framework median by more than the chosen threshold — the very next run is reviewed under it."],
          ["Document checklist", "Standard 12/16 · Strict 16/16", "Missing required documents are flagged to the committee; strict mode escalates every missing document to HIGH."],
          ["Registry overlay", "On · Off", "Every bidder is matched against the supplier list while a review runs — a suspended or blacklisted entry is flagged before award."],
        ],
      },
      {
        kind: "p",
        text: "Every change you make here is written to the audit trail the moment it is made — the same discipline as a gate decision. A safeguard you tightened is on the record, with a time against it. The guards are read at flag time, so the very next run obeys the settings on the page.",
      },
      {
        kind: "figure",
        src: "/docs/rules.png",
        alt: "The Rules & safeguards screen: the tunable guards (price variance, document checklist, registry cross-check, citation policy) and the standing rule",
        screen: "WORKSPACE · RULES & SAFEGUARDS · CAPTURED 18 OCT 2026",
        caption:
          "Rules & guards: the tunable thresholds at their carved settings, the citation policy locked by design, and the standing rule below them — which no setting can touch. Guard changes are logged with name, timestamp and before-and-after values.",
      },
      {
        kind: "callout",
        tone: "rule",
        title: "The line that never moves",
        text: "SETTINGS TUNE THE REVIEW. THEY NEVER TOUCH THE STANDING RULE: THE AGENT PREPARES THE FILE, AND THE COMMITTEE — BY NAME — AWARDS THE TENDER.",
      },
    ],
  },
  {
    id: "evidence",
    kicker: "Standards",
    title: "Evidence & data sources",
    lead: "A finding is only as lawful as its source. Every bid is read against national portals, supplier registries and the OCDS record — and each finding cites which.",
    blocks: [
      {
        kind: "p",
        text: "The platform reads structured and unstructured materials alike: OCDS 1.1 releases, PDF packs, the email bag and staged markdown. Four standards hold across all of them: OCDS 1.1 for publication records, the MCP tool layer for filesystem and extraction access, LLM drafting for redlines, and page citations for every finding.",
      },
      {
        kind: "steps",
        title: "Working with sources",
        items: [
          "See the registries an officer can check against: the Data sources screen reads the OCP Data Registry and lists every African dataset it publishes — country, publisher, coverage span, update frequency, formats and latest retrieval, each dated.",
          "Expand a country to inspect a dataset before leaning on it: licence, published counts, OCID prefix, and links back to the registry page, the publishing policy and the publisher's own portal.",
          "Connect the portals: for every dataset the agent opens the published file, reads the first OCDS release and keeps its OCID as proof, then checks the publisher's own portal. Every check is dated and saved — a portal that fails is shown failed.",
          "A dataset the publisher stopped updating carries the registry's own flag — findings that needed it are gaps in the file, never a silent pass.",
          "Request a source when a registry or portal is missing. It is logged, and its absence is visible rather than silent.",
        ],
      },
      {
        kind: "figure",
        src: "/docs/sources.png",
        alt: "The Data sources screen: the Connected portals card with Zambia expanded, showing the registry handshake, the first OCDS release kept as proof and the portal's response",
        screen: "WORKSPACE · DATA SOURCES · CAPTURED 18 OCT 2026",
        caption:
          "Connected portals: nine countries, twenty-two datasets. Zambia opened — the whole handshake in one line: the registry answered 206 and 256 KB was read, the first OCDS release is kept as proof, and the publisher's own portal answered 200. Every check dated; RE-CHECK CONNECTIONS runs it again.",
      },
      {
        kind: "p",
        text: "The register is read as published: coverage dates, retrieval dates, formats, file sizes, licences and counts are the registry's own figures, and the screen names the retrieval date of the snapshot it draws. Where a publisher states no licence, the registry shows an em dash — and so does the screen. Beside it sits the connection record: the first OCDS release the agent read from the published file, and the last answer from the publisher's own portal — both dated, both checkable again.",
      },
      {
        kind: "p",
        text: "Every portal can be switched off, one dataset or a whole country at a time. A portal that is off is not silently dropped: its row dims, names who set it and when, the connection pass skips it, the header counts what is switched off, and the transition is written to the audit trail. Turning it back on puts it straight back into the pass.",
      },
      {
        kind: "callout",
        tone: "tip",
        title: "Reading a record",
        text: "Citations point at anchors — a page, a clause, a schedule line. When you dispute a finding, quote its anchor back at the record; the pipeline either places the text there or the finding never existed.",
      },
    ],
  },
  {
    id: "audit",
    kicker: "Accountability",
    title: "The audit trail",
    lead: "Who did what, when, and against which record — permanently, in three places that outlive any browser session.",
    blocks: [
      {
        kind: "table",
        title: "The three records",
        head: ["RECORD", "CONTAINS", "WHERE"],
        rows: [
          ["Audit log", "Every tool call: actor, inputs, outputs, status, duration.", "The Live activity feed and Tools & models render it; the raw file lives at mini-services/quorum-mcp/data/tool-log.jsonl."],
          ["Award history", "Every AWARDED and RETURNED decision with the signer and time.", "Award history in the sidebar."],
          ["Durable state", "Evaluations, gates, source requests and the supplier list.", "mini-services/quorum-mcp/data/state.json."],
        ],
      },
      {
        kind: "p",
        text: "Rows in the award history are appended, never edited. The same is true of the audit log: entries only accumulate. If you need to answer an audit question — who approved this, on what evidence, in what order — the answer is assembled from these three records and nothing else.",
      },
      {
        kind: "figure",
        src: "/docs/activity.png",
        alt: "The Live activity screen: the agent feed streaming tool calls with their actors, statuses and durations",
        screen: "WORKSPACE · LIVE ACTIVITY · CAPTURED 18 OCT 2026",
        caption:
          "The agent feed, live: every tool call in order — the actor, the status, what it touched. Run it during a sitting; the sequence the committee reads is the sequence the record keeps.",
      },
      {
        kind: "callout",
        tone: "tip",
        title: "Practice",
        text: "Before a sitting, open Live activity and let it run during the meeting. The sequence the committee reads is the sequence the record will keep.",
      },
    ],
  },
  {
    id: "roles",
    kicker: "People",
    title: "Roles & permissions",
    lead: "Quorum's permissions follow the people in a procurement file, not a hierarchy of software seats.",
    blocks: [
      {
        kind: "table",
        title: "Who can do what",
        head: ["ROLE", "CAN", "CANNOT"],
        rows: [
          ["Officer (signed in)", "Brief runs, stage documents, watch reviews, sit the committee, manage the supplier list.", "Award against the roster's rules — the system refuses an approval that doesn't meet them."],
          ["Committee member", "Read the file, decide gates as a named approver.", "The roster check is skipped for them; the system refuses a signature that isn't present or authorised."],
          ["Chair", "Sit the committee, sign decisions.", "Edit the ledger after the fact — entries are append-only."],
          ["Auditor", "Read runs, findings, the ledger and the audit log.", "Write anything."],
        ],
      },
      {
        kind: "p",
        text: "The gavel seat is never a stored row: it belongs to whoever is actually signed in, resolved from the session at the moment of the decision. The roster itself starts empty until real members are added — no member is invented.",
      },
      {
        kind: "figure",
        src: "/docs/committee.png",
        alt: "The Committee screen: the nine-seat quorum grid with all seats open, alongside the gavel protocol and the summon control",
        screen: "WORKSPACE · COMMITTEE · CAPTURED 18 OCT 2026",
        caption:
          "The committee register: nine seats, none filled yet — the roster starts empty until real members are added, and no member is invented. A sitting is summoned from here, and the roll-call is stamped.",
      },
      {
        kind: "figure",
        src: "/docs/committee-add.png",
        alt: "The register-a-member dialog: name and role fields filled in, a chair checkbox, and the note that it is a write",
        screen: "WORKSPACE · COMMITTEE · REGISTER A MEMBER",
        caption:
          "Registering a member — name, role, and whether they hold the chair. It is a write; the dialog says so before the button does. Only names on this register are admitted to a sitting.",
      },
      {
        kind: "callout",
        tone: "warn",
        title: "One name, one signature",
        text: "Decisions are recorded under the officer's name. Do not share a sign-in: the record will read it as one person deciding everything.",
      },
    ],
  },
  {
    id: "glossary",
    kicker: "Reference",
    title: "Glossary & questions",
    lead: "The words the file uses, and the answers officers actually ask for.",
    blocks: [
      {
        kind: "terms",
        title: "Glossary",
        items: [
          { term: "Bidder / supplier", def: "The firm offering goods, works or services against a tender." },
          { term: "OCDS", def: "The Open Contracting Data Standard — the structured publication format the platform reads and cites." },
          { term: "Gate", def: "The stop where the agent's work is handed to humans for the award decision." },
          { term: "Quorum", def: "The minimum attendance at which a committee may transact — five of nine seats by default." },
          { term: "Float period", def: "The minimum time bidders get between advertisement and closing — four weeks national, six weeks international." },
          { term: "ZPPA", def: "The Zambia Public Procurement Authority — the regulator, and the approver for alternative methods." },
          { term: "ZRA", def: "The Zambia Revenue Authority — source of the Tax PIN and the Tax Clearance Certificate." },
          { term: "PACRA", def: "The Patents and Companies Registration Agency — where the legal entity's registration number lives." },
          { term: "NCC / NHCC / ERB", def: "Sector registration bodies — construction, health care, energy — whose registrations categories may require." },
          { term: "LPO", def: "Local Purchase Order — the instrument that confirms a simplified-bidding purchase." },
          { term: "MCP", def: "Model Context Protocol — the tool protocol the agent uses to reach files and services." },
          { term: "Redline", def: "The agent's drafted correction for a finding." },
          { term: "Ledger", def: "The append-only record of awards and returns." },
          { term: "Run", def: "One tender reviewed end to end." },
        ],
      },
      {
        kind: "terms",
        title: "Questions officers ask",
        items: [
          { term: "Can Quorum award the tender?", def: "No — by design. It prepares the file and stops at the gate. The committee signs." },
          { term: "What if the agent service is offline?", def: "Reads that depend on it pause, and approvals cannot be recorded until it is back. The interface shows AGENT · OFFLINE rather than pretending." },
          { term: "A finding is wrong. What now?", def: "Quote its citation back at the record. Findings that can't be anchored to a document never pass the pipeline; for the rest, the committee's return is the correction mechanism." },
          { term: "Where does my data live?", def: "On your host: the agent service's data directory for evaluations, gates, suppliers and logs; the local vault or cloud storage for documents, as configured." },
          { term: "Which jurisdictions are supported?", def: "The method register opens with Zambia — Public Procurement Act No. 8 of 2023 — and grows by jurisdiction; the engine validates only the identifier schemes it actually knows." },
        ],
      },
      {
        kind: "callout",
        tone: "tip",
        title: "One more thing",
        text: "The Walkthrough is this handbook's guided twin: the same ground, in the order a tender moves. Start any chapter and Quorum spotlights the actual controls, screen by screen — use the handbook to understand, the walkthrough to do.",
      },
    ],
  },
];

const DOC_CHAPTER_IDS = DOC_CHAPTERS.map((c) => c.id);

function docChapterText(ch: DocChapter): string {
  return `${ch.title} ${ch.kicker} ${ch.lead} ${JSON.stringify(ch.blocks)}`.toLowerCase();
}

function DocCallout({ tone, title, text }: { tone: DocCalloutTone; title: string; text: string }) {
  if (tone === "rule") {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-ink-950 bg-night p-5 text-white shadow-[0_18px_45px_rgba(11,12,15,0.25)]">
        <div className="bg-grid-dark pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
        <div className="relative">
          <p className="font-code text-[8px] font-bold tracking-[0.28em] text-brand-400">{title.toUpperCase()}</p>
          <p className="mt-2.5 font-code text-[9.5px] leading-[2] tracking-[0.14em] text-ink-200">{text}</p>
        </div>
      </div>
    );
  }
  const look =
    tone === "law"
      ? { box: "border-ink-200 bg-white", icon: "text-ink-900", label: "text-ink-500", Icon: Gavel }
      : tone === "warn"
        ? { box: "border-brand-200 bg-brand-50", icon: "text-brand-700", label: "text-brand-700", Icon: CircleAlert }
        : { box: "border-ink-100 bg-paper", icon: "text-ink-500", label: "text-ink-500", Icon: BookOpen };
  const Icon = look.Icon;
  return (
    <div className={cn("rounded-xl border px-4 py-3.5", look.box)}>
      <p className={cn("flex items-center gap-2 font-code text-[8px] font-bold tracking-[0.22em]", look.label)}>
        <Icon className={cn("h-3.5 w-3.5 shrink-0", look.icon)} aria-hidden="true" />
        {title.toUpperCase()}
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-700">{text}</p>
    </div>
  );
}

/* ── Zambia's method register, live from the engine ──────────────────────── */

type ZMethodRow = {
  id: string;
  name: string;
  legalBasis: string;
  when: string;
  valueBand?: string;
  steps: string[];
  notes: string[];
  awardAuthorisation: string;
  advertising: string;
  floatPeriod?: string;
};

const METHOD_FALLBACK: { name: string; when: string }[] = [
  { name: "Open bidding / selection", when: "The default — advertised, open to the public, above K1 million." },
  { name: "Limited bidding / selection", when: "No public advertisement: a limited number of firms, or urgency that makes open bidding impractical." },
  { name: "Direct bidding", when: "Single source: sole availability, emergency, compatibility, or a below-threshold value." },
  { name: "Simplified bidding / selection", when: "Low-value, off-the-shelf purchases up to K1 million — three written quotations." },
  { name: "Force account", when: "The entity builds with its own personnel and equipment." },
  { name: "Community participation", when: "Selected project components engage local communities and NGOs." },
  { name: "Purchases from other procuring entities", when: "A Government agency can meet the requirement and no supplier would offer benefit." },
  { name: "Private-financed infrastructure / concessions", when: "PPPs under the Public-Private Partnership Act No. 14 of 2009." },
  { name: "Alternative procurement methods", when: "Only with the ZPPA's prior approval." },
];

function DocMethodsBoard() {
  const [methods, setMethods] = useState<ZMethodRow[] | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/methods?XTransformPort=3031")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: { ZM?: ZMethodRow[] }) => {
        if (alive) setMethods(d.ZM ?? []);
      })
      .catch(() => {
        if (alive) setOffline(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!methods && !offline) {
    return (
      <div className="space-y-3" aria-label="Loading the method register">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-ink-50" />
        ))}
      </div>
    );
  }

  if (offline || !methods || methods.length === 0) {
    return (
      <div className="rounded-2xl border border-brand-200 bg-brand-50 p-5">
        <p className="flex items-center gap-2 font-code text-[8px] font-bold tracking-[0.22em] text-brand-700">
          <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
          THE AGENT'S METHOD REGISTER IS NOT REACHABLE — SUMMARY BELOW
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-700">
          The full method cards load from quorum-mcp while the stack is running. The lawful methods the engine
          applies in Zambia:
        </p>
        <ul className="mt-3 space-y-2">
          {METHOD_FALLBACK.map((m) => (
            <li key={m.name} className="flex gap-2.5 text-[12.5px] leading-relaxed text-ink-700">
              <span className="text-brand-600" aria-hidden="true">▸</span>
              <span>
                <span className="font-semibold text-ink-900">{m.name} — </span>
                {m.when}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {methods.map((m) => (
        <div key={m.id} className="rounded-2xl border border-ink-100 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="font-display text-[16px] font-black tracking-[-0.01em] text-ink-950">{m.name}</h4>
              <p className="mt-0.5 font-code text-[8px] tracking-[0.16em] text-ink-400">{m.legalBasis.toUpperCase()}</p>
            </div>
            {m.valueBand && (
              <span className="rounded-full border border-ink-200 bg-paper px-3 py-1 font-code text-[8px] font-bold tracking-[0.14em] text-ink-700">
                {m.valueBand.toUpperCase()}
              </span>
            )}
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-700">{m.when}</p>

          <details className="mt-3 border-t border-ink-100 pt-3">
            <summary className="cursor-pointer select-none font-code text-[8.5px] font-bold tracking-[0.16em] text-ink-500">
              THE PROCESS, IN ORDER
            </summary>
            <ol className="mt-2.5 space-y-2">
              {m.steps.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-[12.5px] leading-relaxed text-ink-700">
                  <span className="shrink-0 font-code text-[9px] font-bold text-brand-700">{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0">{s}</span>
                </li>
              ))}
            </ol>
          </details>

          {m.notes.length > 0 && (
            <ul className="mt-3 space-y-1.5 border-t border-ink-100 pt-3">
              {m.notes.map((n, i) => (
                <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-ink-500">
                  <span className="shrink-0 text-brand-600" aria-hidden="true">▸</span>
                  <span className="min-w-0">{n}</span>
                </li>
              ))}
            </ul>
          )}

          <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-ink-100 pt-3 sm:grid-cols-3">
            <div>
              <dt className="font-code text-[7.5px] font-bold tracking-[0.18em] text-ink-400">AWARD AUTHORISATION</dt>
              <dd className="mt-1 text-[11.5px] leading-snug text-ink-700">{m.awardAuthorisation}</dd>
            </div>
            <div>
              <dt className="font-code text-[7.5px] font-bold tracking-[0.18em] text-ink-400">ADVERTISING</dt>
              <dd className="mt-1 text-[11.5px] leading-snug text-ink-700">{m.advertising}</dd>
            </div>
            <div>
              <dt className="font-code text-[7.5px] font-bold tracking-[0.18em] text-ink-400">FLOAT PERIOD</dt>
              <dd className="mt-1 text-[11.5px] leading-snug text-ink-700">{m.floatPeriod ?? "—"}</dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}

/* One block of handbook prose, rendered by kind. */
function DocBlockView({ block, onOpenShot }: { block: DocBlock; onOpenShot?: (fig: DocFigure) => void }) {
  switch (block.kind) {
    case "p":
      return <p className="text-[13.5px] leading-relaxed text-ink-700">{block.text}</p>;
    case "callout":
      return <DocCallout tone={block.tone} title={block.title} text={block.text} />;
    case "figure":
      return (
        <figure data-doc-figure={block.src}>
          <button
            type="button"
            onClick={() => onOpenShot?.({ src: block.src, alt: block.alt, caption: block.caption, screen: block.screen })}
            aria-label={`Open the full screenshot — ${block.alt}`}
            className="group relative block w-full cursor-zoom-in overflow-hidden rounded-xl border border-ink-100 bg-ink-950 text-left shadow-[0_1px_2px_rgba(11,12,15,0.05)] transition-shadow hover:shadow-[0_14px_36px_rgba(11,12,15,0.16)]"
          >
            <img src={block.src} alt={block.alt} loading="lazy" className="block w-full" />
            <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-gradient-to-t from-ink-950/90 via-ink-950/45 to-transparent px-3.5 pb-2.5 pt-9">
              <span className="min-w-0 truncate font-code text-[7.5px] font-bold tracking-[0.18em] text-white/70">
                {block.screen}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-2 py-1 font-code text-[7px] font-bold tracking-[0.16em] text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Maximize2 className="h-2.5 w-2.5" aria-hidden="true" />
                EXPAND
              </span>
            </span>
          </button>
          <figcaption className="mt-2.5 flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-500">
            <span className="mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" aria-hidden="true" />
            <span className="min-w-0">{block.caption}</span>
          </figcaption>
        </figure>
      );
    case "steps":
      return (
        <div>
          {block.title && (
            <p className="mb-3 font-code text-[8px] font-semibold tracking-[0.22em] text-ink-400">
              {block.title.toUpperCase()}
            </p>
          )}
          <ol className="space-y-2.5">
            {block.items.map((item, i) => (
              <li key={i} className="flex gap-3 text-[13px] leading-relaxed text-ink-700">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-ink-200 font-code text-[8px] font-bold text-ink-500">
                  {i + 1}
                </span>
                <span className="min-w-0">{item}</span>
              </li>
            ))}
          </ol>
        </div>
      );
    case "table":
      return (
        <div>
          {block.title && (
            <p className="mb-3 font-code text-[8px] font-semibold tracking-[0.22em] text-ink-400">
              {block.title.toUpperCase()}
            </p>
          )}
          <div className="overflow-x-auto rounded-xl border border-ink-100">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr className="border-b border-ink-100 bg-paper">
                  {block.head.map((h) => (
                    <th key={h} scope="col" className="px-4 py-3 font-code text-[8px] font-bold tracking-[0.18em] text-ink-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, i) => (
                  <tr key={i} className="border-b border-ink-50 last:border-b-0">
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        className={cn(
                          "px-4 py-3.5 align-top text-[12.5px] leading-relaxed",
                          j === 0 ? "font-semibold text-ink-950" : "text-ink-600",
                        )}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    case "terms":
      return (
        <div>
          {block.title && (
            <p className="mb-3 font-code text-[8px] font-semibold tracking-[0.22em] text-ink-400">
              {block.title.toUpperCase()}
            </p>
          )}
          <dl className="divide-y divide-ink-50 rounded-xl border border-ink-100">
            {block.items.map((t) => (
              <div key={t.term} className="px-4 py-3.5">
                <dt className="font-code text-[9.5px] font-bold tracking-[0.14em] text-ink-900">{t.term.toUpperCase()}</dt>
                <dd className="mt-1 text-[12.5px] leading-relaxed text-ink-600">{t.def}</dd>
              </div>
            ))}
          </dl>
        </div>
      );
    case "methods":
      return <DocMethodsBoard />;
    default:
      return null;
  }
}

/* The walkthrough's final chapter runs on this page: /docs?tour=1 lands here
   and starts it, so the handbook is toured like every other screen. */
const DOC_TOUR: TourStep[] = [
  {
    target: "docs-search",
    title: "Search jumps to the point",
    body: "Type a rule code (R-OVER-BUDGET), a method, or a field name — the chapters and the rail filter as you type.",
  },
  {
    target: "docs-rail",
    title: "Read in order, or aim",
    body: "The rail follows the chapter you are in. Every chapter is written against the engine it documents — rule codes, thresholds and the committee's move for each.",
  },
  {
    target: "docs-chapters",
    title: "The full handbook",
    body: "From what Quorum is to the glossary — the review pipeline, the gate protocol and Zambia's procurement law as the engine actually implements it.",
  },
];

export function DocumentationView() {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(DOC_CHAPTERS[0].id);
  const [tourStep, setTourStep] = useState<number | null>(null);
  /* The enlarged shot — set by a figure, cleared by Escape or a click away. */
  const [shot, setShot] = useState<DocFigure | null>(null);
  const shotCloseRef = useRef<HTMLButtonElement | null>(null);

  /* Focus moves into the lightbox; Escape hands the desk back — and the
     reader's focus returns to the figure that opened it. */
  useEffect(() => {
    if (!shot) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const t = window.setTimeout(() => shotCloseRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShot(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, [shot]);

  /* Arriving from the walkthrough's final chapter — /docs?tour=1. */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tour") !== "1") return;
    const id = window.setTimeout(() => setTourStep(0), 500);
    return () => window.clearTimeout(id);
  }, []);

  const endTour = () => {
    setTourStep(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("tour");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => (q ? DOC_CHAPTERS.filter((ch) => docChapterText(ch).includes(q)) : DOC_CHAPTERS),
    [q],
  );

  /* Scroll-spy: keep the chapter rail honest while the officer reads. */
  useEffect(() => {
    if (q) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top?.target.id) setActiveId(top.target.id.replace(/^docs-/, ""));
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    for (const id of DOC_CHAPTER_IDS) {
      const el = document.getElementById(`docs-${id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [q]);

  /* A link may arrive already aimed — "/docs#docs-safeguards" from the Rules page. */
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "").replace(/^docs-/, "");
    if (!hash || !DOC_CHAPTER_IDS.includes(hash)) return;
    const id = window.setTimeout(() => {
      setActiveId(hash);
      document.getElementById(`docs-${hash}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
    return () => window.clearTimeout(id);
  }, []);

  const jumpTo = (id: string) => {
    setActiveId(id);
    document.getElementById(`docs-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <p className="flex items-center gap-2.5 font-code text-[10px] font-semibold uppercase tracking-[0.3em] text-ink-500">
            <span className="inline-block h-[2px] w-6 bg-brand-600" aria-hidden="true" />
            {DOC_CHAPTERS.length} CHAPTERS · THE COMPLETE HANDBOOK
          </p>
          <h1 className="mt-4 font-display text-[30px] font-black leading-[1.05] tracking-[-0.02em] text-ink-950 sm:text-[38px]">
            Documentation<span className="text-brand-600">.</span>
          </h1>
          <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-ink-600">
            Every screen, every rule, the gate protocol and Zambia's procurement law — written so a first-day
            officer and a ten-year auditor read the same page and both come away certain.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[264px_minmax(0,1fr)]">
        {/* The chapter rail */}
        <nav aria-label="Documentation chapters" data-tour="docs-rail" className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-[0_1px_2px_rgba(11,12,15,0.04)]">
            <label data-tour="docs-search" className="relative block">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-300"
                aria-hidden="true"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the handbook…"
                aria-label="Search the handbook"
                className="h-9 w-full rounded-full border border-ink-200 bg-paper pl-9 pr-3 text-[12.5px] text-ink-900 outline-none transition-colors placeholder:text-ink-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-600/15"
              />
            </label>
            {q && (
              <p className="mt-2 px-1 font-code text-[8px] tracking-[0.18em] text-ink-400">
                {visible.length} OF {DOC_CHAPTERS.length} CHAPTERS MATCH
              </p>
            )}
            <ul className="mt-3 max-h-[62vh] space-y-0.5 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-ink-200 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1">
              {(q ? visible : DOC_CHAPTERS).map((ch) => {
                const idx = DOC_CHAPTERS.indexOf(ch);
                const isActive = !q && activeId === ch.id;
                return (
                  <li key={ch.id}>
                    <button
                      type="button"
                      onClick={() => jumpTo(ch.id)}
                      aria-current={isActive ? "true" : undefined}
                      className={cn(
                        "flex w-full items-baseline gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                        isActive ? "bg-ink-950 text-white" : "text-ink-600 hover:bg-paper hover:text-ink-950",
                      )}
                    >
                      <span
                        className={cn(
                          "font-code text-[8px] font-bold tracking-[0.14em]",
                          isActive ? "text-brand-400" : "text-ink-300",
                        )}
                      >
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug">{ch.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {q && visible.length === 0 && (
              <p className="mt-3 rounded-lg bg-paper px-3 py-2.5 text-[12px] leading-relaxed text-ink-500">
                Nothing matches. Try a rule code (R-OVER-BUDGET), a method, or a field name.
              </p>
            )}
          </div>

          <p className="mt-3 px-2 font-code text-[7.5px] leading-[2] tracking-[0.16em] text-ink-400">
            {DOC_CHAPTERS.length} CHAPTERS · WRITTEN AGAINST THE ENGINE IT DOCUMENTS
          </p>
        </nav>

        {/* The chapters */}
        <div data-tour="docs-chapters" className="min-w-0 space-y-5">
          {(q ? visible : DOC_CHAPTERS).map((ch) => {
            const no = String(DOC_CHAPTERS.indexOf(ch) + 1).padStart(2, "0");
            return (
              <article
                key={ch.id}
                id={`docs-${ch.id}`}
                className="scroll-mt-24 rounded-2xl border border-ink-100 bg-white p-5 shadow-[0_1px_2px_rgba(11,12,15,0.04)] sm:p-7"
              >
                <p className="flex items-center gap-2.5 font-code text-[9px] font-bold tracking-[0.26em] text-brand-700">
                  <span className="inline-block h-[2px] w-5 bg-brand-600" aria-hidden="true" />
                  CHAPTER {no} · {ch.kicker.toUpperCase()}
                </p>
                <h2 className="mt-3 font-display text-[22px] font-black tracking-[-0.015em] text-ink-950 sm:text-[26px]">
                  {ch.title}
                </h2>
                <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-600">{ch.lead}</p>
                <div className="mt-6 space-y-5">
                  {ch.blocks.map((b, i) => (
                    <DocBlockView key={i} block={b} onOpenShot={setShot} />
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {/* The enlarged screenshot — click any figure to read it at full size. */}
      <AnimatePresence>
        {shot && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setShot(null)}
            role="dialog"
            aria-modal="true"
            aria-label={shot.alt}
            className="fixed inset-0 z-[80] grid place-items-center bg-ink-950/85 p-4 backdrop-blur-sm sm:p-8"
          >
            <motion.figure
              initial={{ opacity: 0, y: 14, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-950 shadow-[0_40px_120px_rgba(0,0,0,0.6)]"
            >
              <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <p className="min-w-0 truncate font-code text-[8.5px] font-bold tracking-[0.2em] text-ink-300">
                  {shot.screen}
                </p>
                <button
                  type="button"
                  ref={shotCloseRef}
                  onClick={() => setShot(null)}
                  aria-label="Close the screenshot"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="min-h-0 overflow-auto bg-paper">
                <img src={shot.src} alt={shot.alt} className="block w-full" />
              </div>
              <figcaption className="border-t border-white/10 px-4 py-3 text-[12px] leading-relaxed text-ink-300">
                {shot.caption}
              </figcaption>
            </motion.figure>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The walkthrough's final chapter — a spotlight layer on the handbook. */}
      {tourStep !== null && (
        <TourLayer
          chapterNo={15}
          chapterTotal={15}
          chapterTitle="Read the documentation"
          steps={DOC_TOUR}
          index={Math.min(tourStep, DOC_TOUR.length - 1)}
          onIndex={setTourStep}
          onClose={endTour}
          onFinish={endTour}
        />
      )}
    </div>
  );
}

