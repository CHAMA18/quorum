/**
 * quorum-mcp — the agent's hands.
 *
 * A real MCP server (JSON-RPC 2.0 over HTTP) with five tools. Three of them
 * change state: draft_redline DRAFTS, flag_finding FLAGS, file_gate_submission
 * FILES — and filing is irreversible, so it halts behind a named-human gate.
 *
 * Every tool call is appended to data/tool-log.jsonl with inputs, outputs,
 * timestamps, actor and status. Nothing happens twice, nothing happens silently.
 */

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFileSync, renameSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolveDataDir } from "./paths";

export type ToolKind = "READ" | "WRITES" | "IRREVERSIBLE" | "GATE_DECISION";

export interface LogEntry {
  seq: number;
  id: string;
  ts: string;
  actor: string;
  server: string;
  tool: string;
  kind: ToolKind;
  runId?: string;
  inputs: unknown;
  outputs: unknown;
  status: "OK" | "ERROR" | "PENDING_GATE" | "GATED";
  durationMs: number;
  /* Tamper-evidence: each line's `self` hash covers the line itself, and `prev`
     points at the previous line's hash — genesis is the literal "genesis". */
  prev?: string;
  self?: string;
}

export interface Requirement {
  id: string;
  clause: string;
  page: number;
}

export interface Finding {
  id: string;
  rule: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  item: string;
  evidence: string;
  citation: string;
  /* Set when the bounded repair loop re-anchored this finding to a verified line of its cited document. */
  repaired?: boolean;
}

export interface Draft {
  id: string;
  findingId: string;
  original: string;
  proposed: string;
  rationale: string;
  model: string;
  /* "llm" only when the model's reply was used; "template" when the fallback text is the proposal. */
  source?: "llm" | "template";
  usage?: { promptTokens: number; completionTokens: number };
  latencyMs?: number;
}

export interface Gate {
  id: string;
  runId: string;
  tenderId: string;
  tool: string;
  inputs: unknown;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXECUTED";
  createdAt: string;
  decidedAt?: string;
  approver?: string;
  note?: string;
  executedAt?: string;
  receipt?: { submissionId?: string; hash?: string; portal?: string; [k: string]: unknown };
  /* Office-aware approval (the cycle's statutory gates): when set, a roster
     member must HOLD this office to approve. The signed-in officer (the gavel)
     is the accounting officer and may always sign. */
  requiredOffice?: Office;
}

/* The named offices of a procurement desk. The committee roster carries one
   per member; the cycle's statutory gates declare the office that must sign. */
export const OFFICES = ["PROCUREMENT_UNIT", "EVALUATION_COMMITTEE", "ACCOUNTING_OFFICER", "OVERSIGHT"] as const;
export type Office = (typeof OFFICES)[number];

export const OFFICE_LABELS: Record<Office, string> = {
  PROCUREMENT_UNIT: "Procurement unit",
  EVALUATION_COMMITTEE: "Evaluation committee",
  ACCOUNTING_OFFICER: "Accounting officer",
  OVERSIGHT: "Oversight / audit",
};

/* The review plan: decided before any rule runs, by the configured LLM when one is set
   and by a deterministic pack inspection otherwise. Every field changes downstream
   behaviour (which parsers run, which rule families are drafted first, how many drafts). */
export interface ReviewPlan {
  pack: { files: number; bids: number; ocdsRecords: number; markdownValueBids: number; ocdsValueBids: number };
  /* Deep value parsing: markdown "**Bid value:**" lines join OCDS values for outlier/budget rules. */
  parseMarkdownValues: boolean;
  focusRules: string[];
  maxDrafts: number;
  note: string;
  source: "heuristic" | "llm";
  model?: string;
}

export interface Run {
  id: string;
  tenderId: string;
  status: "RUNNING" | "AWAITING_GATE" | "REJECTED" | "FILED" | "FAILED";
  startedAt: string;
  updatedAt: string;
  progress: string[];
  requirements: Requirement[];
  findings: Finding[];
  drafts: Draft[];
  gateId?: string;
  error?: string;
  /* The plan this run was reviewed under (plan_review node output). */
  plan?: ReviewPlan;
  /* Drafting cost for this run: how many drafts came from the model and the tokens it used. */
  usage?: { drafts: number; llmDrafts: number; promptTokens: number; completionTokens: number };
  /* Tender detail typed by the officer at launch (manual entry). Persisted for
     the register and surfaced on runs/gates; the review engine's rules stay
     deterministic — this rides alongside, never inside, the rule set. */
  detail?: Record<string, unknown>;
}

/* The committee roster as the sidecar reads it from the web app. The office
   rides along when the register carries it — office-aware gates need it. */
export interface RosterMemberForGate {
  name: string;
  status: "PRESENT" | "EXCUSED";
  office?: Office;
}

/* fileURLToPath decodes %20 etc. — .pathname breaks on paths with spaces. */
const DATA = resolveDataDir();

function cap(value: unknown, max = 420): unknown {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  if (s === undefined) return value;
  if (s.length <= max) return s;
  return s.slice(0, max) + " …[truncated]";
}

/* ── Tool log — append-only JSONL, hash-chained, the audit spine ─────────── */

let seq = 0;
export const toolLog: LogEntry[] = [];

/* The audit spine must never fail silently — a product whose thesis is
   "nothing happens silently" surfaces its own durability, loud and in the
   clear. These flags are exposed on GET /api/health. */
export const auditHealth = {
  logWriteFailing: false,
  stateSaveFailing: false,
  stateCorrupt: false,
  stateCorruptFile: null as string | null,
};

function hashOfEntry(entry: Omit<LogEntry, "self">): string {
  return createHash("sha256").update(JSON.stringify(entry)).digest("hex").slice(0, 16);
}

export function appendLog(e: Omit<LogEntry, "seq" | "id" | "ts" | "prev" | "self">): LogEntry {
  seq += 1;
  const prev = toolLog.length ? toolLog[toolLog.length - 1].self ?? toolLog[toolLog.length - 1].id : "genesis";
  const entry: LogEntry = {
    seq,
    id: `tl_${seq.toString().padStart(5, "0")}_${randomUUID().slice(0, 8)}`,
    ts: new Date().toISOString(),
    ...e,
    inputs: cap(e.inputs),
    outputs: cap(e.outputs),
    prev,
  };
  const self = hashOfEntry(entry);
  const logged: LogEntry = { ...entry, self };
  toolLog.push(logged);
  if (toolLog.length > 600) toolLog.splice(0, toolLog.length - 600);
  try {
    /* appendFileSync creates the file on first write — never lose the spine. */
    appendFileSync(DATA + "tool-log.jsonl", JSON.stringify(logged) + "\n");
    auditHealth.logWriteFailing = false;
  } catch (err) {
    /* append failures never break the tool itself — but they are never quiet */
    auditHealth.logWriteFailing = true;
    console.error("[audit-spine] tool-log append FAILED — entries are memory-only until this resolves:", err);
  }
  return logged;
}

/* Verifies the prev/self hash chain of in-memory or parsed-from-disk entries. */
export function verifyLogChain(entries: LogEntry[]): { ok: boolean; brokenAt: number | null; checked: number } {
  let expected = "genesis";
  for (let i = 0; i < entries.length; i++) {
    const { self, ...rest } = entries[i];
    const h = hashOfEntry(rest as Omit<LogEntry, "self">);
    if (!self || self !== h || entries[i].prev !== expected) return { ok: false, brokenAt: i, checked: i + 1 };
    expected = self;
  }
  return { ok: true, brokenAt: null, checked: entries.length };
}

export async function verifyToolLogFile(): Promise<{ ok: boolean; brokenAt: number | null; checked: number; lines: number; error?: string }> {
  try {
    const raw = await readFile(DATA + "tool-log.jsonl", "utf8");
    const lines = raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as LogEntry);
    return { ...verifyLogChain(lines), lines: lines.length };
  } catch {
    return { ok: true, brokenAt: null, checked: 0, lines: 0, error: "no log file yet" };
  }
}

/* ── Gateway attestation — WHO the web layer vouches for ─────────────────
   The Next.js gateway owns the session. Every state-changing request it
   forwards carries an HMAC over (method, path, actor, ts) computed with the
   shared secret; the sidecar refuses unattested mutations, so the approving
   identity can no longer be typed by the caller — it is attested by the
   process that verified the session. GATE_SECRET overrides the shipped
   development default on real deployments. */
const DEV_GATE_SECRET = "quorum-dev-attest-secret";

/**
 * GATE_SECRET resolves lazily, per signature, and then fails closed: the
 * guard lives at the first use, not at module evaluation. Production builds
 * import this module with no runtime secrets in scope and must still load;
 * a production PROCESS without a real GATE_SECRET still refuses to sign.
 */
export function gateSecret(): string {
  const secret = process.env.GATE_SECRET?.trim() || DEV_GATE_SECRET;
  if (process.env.NODE_ENV === "production" && secret === DEV_GATE_SECRET) {
    throw new Error("GATE_SECRET must be set to a real secret in production — refusing to run with the shipped default.");
  }
  return secret;
}
export const ATTEST_SKEW_MS = 5 * 60 * 1000;

export function attestSignature(method: string, path: string, actor: string, ts: number, secret = gateSecret()): string {
  return createHmac("sha256", secret).update(`${method}|${path}|${actor}|${ts}`).digest("hex");
}

export function attestVerify(
  method: string,
  path: string,
  headers: Headers,
): { ok: true; actor: string } | { ok: false; reason: string } {
  const actor = headers.get("x-quorum-actor") ?? "";
  const ts = Number(headers.get("x-quorum-ts") ?? NaN);
  const sig = headers.get("x-quorum-attest") ?? "";
  if (!actor || !sig)
    return { ok: false, reason: "Unattested mutation — state-changing requests must arrive through the gateway, signed by the session that owns them." };
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > ATTEST_SKEW_MS)
    return { ok: false, reason: "Attestation timestamp outside the 5-minute window — reload and retry." };
  const expected = attestSignature(method, path, actor, ts);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  return ok ? { ok: true, actor } : { ok: false, reason: "Attestation signature mismatch — the request does not carry the gateway's seal." };
}

/* ── Durable state (gates + runs + source requests survive reloads) ─────── */

/* ── The tender cycle — every phase from solicitation to closure ───────────
   One TenderCycle per tender reference. Wave 1-3 of the procurement-cycle
   build: opening, integrity, evaluation matrix, award, standstill, debriefs,
   contract, complaints, clarifications/addenda, notices and specs. */

export interface OpeningBidRow {
  bidder: string;
  source?: string;
  receivedAt: string;
  late: boolean;
  priceRead?: string;
}

export interface BidOpeningRegister {
  id: string;
  tenderId: string;
  createdAt: string;
  closingDate?: string;
  rows: OpeningBidRow[];
  minutesMd: string;
  certifiedAt?: string;
  certifiedBy?: string;
  sha?: string;
  gateId?: string;
}

export interface CoiDeclaration {
  id: string;
  tenderId: string;
  member: string;
  declaration: "NO_CONFLICT" | "CONFLICT_DECLARED";
  conflicts?: string;
  declaredAt: string;
}

export interface EvalCriterion {
  id: string;
  title: string;
  weight: number; /* percent — all weights must sum to 100 */
}

export interface EvalScore {
  criterionId: string;
  score: number; /* 0-100 */
  note?: string;
}

export type Responsiveness = "ADMINISTRATIVELY_NONRESPONSIVE" | "MATERIALLY_NONRESPONSIVE" | "RESPONSIVE";

export interface EvalBidResult {
  bidder: string;
  source?: string;
  late: boolean;
  responsiveness: Responsiveness;
  reasons: string[];
  technicalScores: EvalScore[];
  technicalTotal: number; /* weighted 0-100 */
  financial?: { amount: number; currency?: string; formulaScore?: number };
  total?: number; /* technical × techWeightPct + financial × rest */
  verdict: "RECOMMENDED" | "NOT_RECOMMENDED" | "DISQUALIFIED";
}

export interface EvalMatrix {
  id: string;
  tenderId: string;
  runId?: string;
  criteria: EvalCriterion[];
  technicalWeightPct: number;
  bids: EvalBidResult[];
  med?: {
    recordedAt: string;
    attendees: string[];
    adjustments: Record<string, number>; /* "<bidder>|<criterionId>" → agreed score */
    notes?: string;
  };
  status: "DRAFT" | "CERTIFIED";
  gateId?: string;
  certifiedAt?: string;
  certifiedBy?: string;
  createdAt: string;
}

export interface AlbDossier {
  id: string;
  tenderId: string;
  bidder: string;
  findingId?: string;
  openedAt: string;
  letterMd: string;
  responseDueAt: string;
  resolution?: {
    outcome: "JUSTIFIED" | "REJECTED" | "WITHDRAWN";
    note: string;
    at: string;
    by: string;
    gateId?: string;
  };
}

export interface AwardReport {
  tenderId: string;
  md: string;
  sha: string;
  createdAt: string;
  recommendation?: string;
  gateId?: string;
  signedAt?: string;
  signedBy?: string;
}

export interface AwardNotice {
  tenderId: string;
  md: string;
  sha: string;
  portal: string;
  gateId?: string;
  publishedAt?: string;
  publishedBy?: string;
}

export interface Standstill {
  tenderId: string;
  startsAt: string;
  endsAt: string;
  days: number;
  status: "ACTIVE" | "LAPSED" | "LIFTED";
}

export interface DebriefLetter {
  id: string;
  tenderId: string;
  bidder: string;
  md: string;
  status: "DRAFT" | "ISSUED";
  createdAt: string;
  issuedAt?: string;
  issuedBy?: string;
  gateId?: string;
}

export interface ContractMilestone {
  id: string;
  title: string;
  dueDate?: string;
  status: "PENDING" | "DONE";
  doneAt?: string;
}

export interface ContractVariation {
  id: string;
  description: string;
  valueDelta: number;
  pctOfContract: number;
  status: "APPROVED" | "REJECTED" | "PENDING";
  at: string;
  gateId?: string;
  decidedBy?: string;
}

export interface ContractPayment {
  id: string;
  description: string;
  amount: number;
  currency?: string;
  gateId?: string;
  certifiedAt?: string;
  certifiedBy?: string;
}

export interface ContractFile {
  tenderId: string;
  supplier: string;
  value: number;
  currency?: string;
  openedAt: string;
  openedFromGate?: string;
  packMd?: string;
  milestones: ContractMilestone[];
  variations: ContractVariation[];
  payments: ContractPayment[];
  completedAt?: string;
  completedBy?: string;
}

export interface Complaint {
  id: string;
  tenderId: string;
  complainant: string;
  subject: string;
  body: string;
  receivedAt: string;
  duringStandstill: boolean;
  response?: { md: string; at: string; by: string; gateId?: string };
  status: "OPEN" | "ANSWERED" | "WITHDRAWN";
}

export interface Clarification {
  id: string;
  tenderId: string;
  question: string;
  askedBy: string;
  askedAt: string;
  answer?: string;
  answeredAt?: string;
  answeredBy?: string;
}

export interface Addendum {
  id: string;
  tenderId: string;
  number: number;
  summary: string;
  issuedAt: string;
  extendsClosingTo?: string;
  closingExtensionRequired?: boolean;
}

export interface NoticeFieldCheck {
  field: string;
  present: boolean;
}

export interface NoticeDraft {
  id: string;
  tenderId: string;
  md: string;
  fieldCheck: NoticeFieldCheck[];
  createdAt: string;
  gateId?: string;
  issuedAt?: string;
  issuedBy?: string;
}

export interface SpecDraft {
  id: string;
  tenderId?: string;
  pipelineId?: string;
  md: string;
  source: "llm" | "template";
  model?: string;
  createdAt: string;
}

export interface PipelineEntry {
  id: string;
  ref: string;
  title: string;
  office?: string;
  budgetEstimate?: number;
  currency?: string;
  expectedPublication?: string;
  status: "PLANNED" | "LINKED";
  linkedTenderId?: string;
  createdAt: string;
}

export interface TenderCycle {
  tenderId: string;
  closingDate?: string;
  closingSetBy?: string;
  closingSetAt?: string;
  opening?: BidOpeningRegister;
  coi: CoiDeclaration[];
  matrix?: EvalMatrix;
  alb: AlbDossier[];
  awardReport?: AwardReport;
  awardNotice?: AwardNotice;
  standstill?: Standstill;
  debriefs: DebriefLetter[];
  contract?: ContractFile;
  complaints: Complaint[];
  clarifications: Clarification[];
  addenda: Addendum[];
  notices: NoticeDraft[];
  specs: SpecDraft[];
  createdAt: string;
}

export interface SourceRequest {
  id: string;
  name: string;
  kind: string;
  note?: string;
  requestedBy: string;
  createdAt: string;
  status: "PENDING" | "CONNECTED" | "DISMISSED";
}

/* ── Cycle input shapes — what the REST/MCP surface passes to the pure engine ── */

export interface BidSecurityLine {
  stated: boolean;
  amount?: number;
  currency?: string;
  validUntil?: string;
  raw: string;
}

export interface EvalScoreInput {
  criterionId: string;
  score: number;
  note?: string;
}

export interface OpenBidInput {
  bidder: string;
  source?: string;
  receivedAt: string;
  priceRead?: string;
}

export interface DeadlineItem {
  tenderId: string;
  kind: "CLOSING" | "ALB_DUE" | "STANDSTILL_END" | "MILESTONE_DUE" | "COMPLAINT_DUE";
  dueAt: string;
  ref?: string;
  overdue?: boolean;
}

export type DeadlinesInput = Pick<TenderCycle, "tenderId" | "closingDate" | "opening" | "alb" | "standstill" | "contract" | "complaints">;

/* A supplier on the platform register. Registration fields mirror what Zambia's
   public-procurement regime asks bidders to hold: PATENTS registrar number,
   ZRA tax clearance, NCC/NHCC/graders' registration where the category needs
   it, plus the purchuring reference the entity assigns on onboarding. */
export interface Supplier {
  id: string;
  name: string;
  /* Legal identity */
  registrationNo: string;
  /* Tax: ZRA tax clearance certificate number + expiry (Zambia) */
  taxPin?: string;
  taxClearanceNo?: string;
  taxClearanceExpiry?: string;
  /* Sector registration where the category requires one */
  regulator?: string;   /* e.g. "NCC", "NHCC", "ERB", "ZPPA" */
  regulatorNo?: string;
  /* Contact */
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  /* Procurement profile */
  categories: string[];   /* what they supply / works they execute */
  metadata: Record<string, string>;  /* free-form extras, legal form etc. */
  status: "ACTIVE" | "SUSPENDED" | "BLACKLISTED";
  addedBy: string;
  createdAt: string;
  updatedAt?: string;
}

/* An application an organization files against a published tender from the
   supplier portal. The identity on the record is the ATTESTED actor the web
   layer vouches for (org:<name>) — a body-declared organization is never
   trusted. Applications are refused after the closing date and one bid per
   organization per tender, the same discipline the opening register enforces
   on paper bids. */
export interface SupplierApplication {
  id: string;
  tenderId: string;
  orgId: string;                 /* the web store's organization id (reference only) */
  orgName: string;               /* derived from the attested actor, not the body */
  actor: string;                 /* org:<name> — the gateway-sealed identity */
  supplierId?: string;           /* the supplier-register entry synced on filing */
  registrationNo: string;        /* the organization's legal registration number */
  amount: number;
  currency?: string;
  coverNote?: string;
  receivedAt: string;
  status: "RECEIVED" | "WITHDRAWN";
}

/* The tunable guards — the thresholds the agent obeys inside a run. The Rules &
   guards page writes them by name; the engine reads them at flag time, so the
   very next run is reviewed under the settings on the page. Defaults are the
   settings as first carved: 25% variance, STANDARD checklist, cross-check ON. */
export interface Guards {
  priceVariancePct: 15 | 25 | 40;
  checklist: "STANDARD" | "STRICT";
  registryCrossCheck: boolean;
  /* Who last moved a guard, and when — the audit line on the page. */
  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_GUARDS: Guards = {
  priceVariancePct: 25,
  checklist: "STANDARD",
  registryCrossCheck: true,
  updatedAt: null,
  updatedBy: null,
};

interface PersistShape {
  gates: Gate[];
  runs: Run[];
  sourceRequests: SourceRequest[];
  suppliers: Supplier[];
  applications: SupplierApplication[];
  guards: Guards;
  cycle: TenderCycle[];
  pipeline: PipelineEntry[];
}

export const state: PersistShape = {
  gates: [],
  runs: [],
  sourceRequests: [],
  suppliers: [],
  applications: [],
  guards: { ...DEFAULT_GUARDS },
  cycle: [],
  pipeline: [],
};

export async function loadState() {
  /* A state file that EXISTS but cannot be parsed is not "first boot" — it is
     corruption, and pretending otherwise silently erases gates, runs and the
     cycle. Quarantine the file (renamed, never deleted), flag it, and say so
     on /api/health forever after. */
  const stateFile = Bun.file(DATA + "state.json");
  if (await stateFile.exists()) {
    try {
      await stateFile.json();
    } catch (err) {
      const quarantine = `${DATA}state.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      try {
        renameSync(DATA + "state.json", quarantine);
      } catch {
        /* keep the file in place if even the rename fails — never destroy evidence */
      }
      auditHealth.stateCorrupt = true;
      auditHealth.stateCorruptFile = quarantine;
      console.error(`[audit-spine] state.json was UNREADABLE and has been quarantined to ${quarantine} — gates/runs/cycle start empty rather than restore. Investigate before writing over it:`, err);
    }
  }
  try {
    const raw = await Bun.file(DATA + "state.json").json();
    /* mutate in place — engine.ts holds references to these exact arrays */
    state.gates.length = 0;
    state.gates.push(...(raw.gates ?? []));
    state.runs.length = 0;
    state.runs.push(...(raw.runs ?? []));
    state.sourceRequests.length = 0;
    state.sourceRequests.push(...(raw.sourceRequests ?? []));
    state.suppliers.length = 0;
    state.suppliers.push(...(raw.suppliers ?? []));
    state.applications.length = 0;
    state.applications.push(...(raw.applications ?? []));
    state.cycle.length = 0;
    state.cycle.push(...(raw.cycle ?? []));
    state.pipeline.length = 0;
    state.pipeline.push(...(raw.pipeline ?? []));
    /* Merged over the defaults so a store written before the guards existed
       still boots with the carved settings. */
    const g = (raw.guards ?? {}) as Partial<Guards>;
    state.guards = {
      priceVariancePct: ([15, 25, 40] as const).includes(g.priceVariancePct as 15 | 25 | 40)
        ? (g.priceVariancePct as Guards["priceVariancePct"])
        : DEFAULT_GUARDS.priceVariancePct,
      checklist: g.checklist === "STRICT" ? "STRICT" : "STANDARD",
      registryCrossCheck: typeof g.registryCrossCheck === "boolean" ? g.registryCrossCheck : DEFAULT_GUARDS.registryCrossCheck,
      updatedAt: typeof g.updatedAt === "string" ? g.updatedAt : null,
      updatedBy: typeof g.updatedBy === "string" ? g.updatedBy : null,
    };
    seq = raw.seq ?? 0;
  } catch {
    /* first boot */
  }
  /* The audit spine continues across restarts: the on-disk log is read back so
     the next append's `prev` points at the last line's hash, not at genesis —
     an append-only chain is only append-only if boot never pretends it is
     empty. A torn last line (a crash mid-write) is dropped with the chain
     still intact up to the last complete entry. */
  try {
    const raw = await readFile(DATA + "tool-log.jsonl", "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    for (const line of lines) {
      try {
        toolLog.push(JSON.parse(line) as LogEntry);
      } catch {
        /* skip a torn line — the chain check reports the truth either way */
      }
    }
    if (toolLog.length) {
      const last = toolLog[toolLog.length - 1];
      if (typeof last.seq === "number" && last.seq > seq) seq = last.seq;
    }
  } catch {
    /* no log file yet — genesis it is */
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function saveState() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    Bun.write(DATA + "state.json", JSON.stringify({ ...state, seq }, null, 2))
      .then(() => {
        auditHealth.stateSaveFailing = false;
      })
      .catch((err) => {
        auditHealth.stateSaveFailing = true;
        console.error("[audit-spine] state.json write FAILED — gates/runs/cycle are memory-only until this resolves:", err);
      });
  }, 120);
}

export function shaOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}
