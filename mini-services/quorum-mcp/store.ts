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
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolveDataDir } from "./paths";
import { initializePersistence, readJsonSnapshot, readSnapshot, writeSnapshot, persistenceStatus } from "./postgres";
import {
  hashLogEntry,
  splitSegments,
  reconcileRegister,
  verifyChain,
  type ChainEntry,
  type ChainVerdict,
  type SegmentRecord,
} from "./audit-chain";
import { secretFor } from "./secrets";

export type ToolKind = "READ" | "WRITES" | "IRREVERSIBLE" | "GATE_DECISION";

export interface LogEntry {
  seq: number;
  workspaceId?: string;
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

/* A finding is only closed by a named human who says what was decided. `OPEN`
   is the absence of this record — never a status inferred from silence. */
export type DispositionStatus = "CLEARED" | "WAIVED" | "RE_CHECK";

export interface FindingDisposition {
  status: DispositionStatus;
  by: string;
  /* The signed-in user id behind the disposition, when the web layer attests one. */
  byId?: string;
  at: string;
  note: string;
  evidence?: string;
  /* A waiver is a second pair of eyes: the officer who seconded it. */
  secondedBy?: string;
  gateId?: string;
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
  /* The award is blocked while a HIGH finding against the recommended bid has
     no disposition. Legacy findings simply have none — they fail closed. */
  disposition?: FindingDisposition;
  /* Phase 6 (AI safety): the named human disposition for a model-surfaced
     finding. Nothing is accepted or rejected silently — the reviewer, the
     decision, when it happened and why are all part of the record. */
  review?: { decision: "ACCEPTED" | "REJECTED"; by: string; at: string; note?: string };
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
  /* Spans the model gateway replaced before a hosted call (names + amounts).
     Zero on the in-region path, where the full evidence stayed on the desk. */
  redactions?: number;
  latencyMs?: number;
}

export interface GateSignature {
  algorithm: "ed25519";
  keyId: string;
  publicKeyPem: string;
  payloadHash: string;
  value: string;
  signedAt: string;
}

export interface Gate {
  id: string;
  runId: string;
  tenantId?: string;
  workspaceId?: string;
  tenderId: string;
  tool: string;
  inputs: unknown;
  status: "PENDING" | "AWAITING_SECOND" | "APPROVED" | "REJECTED" | "EXECUTED";
  createdAt: string;
  decidedAt?: string;
  approver?: string;
  note?: string;
  executedAt?: string;
  receipt?: { submissionId?: string; hash?: string; portal?: string; [k: string]: unknown };
  /* The second signature: who re-authenticated for this decision, how, and
     the one-time token id the sidecar consumed. */
  stepUp?: { by: string; method: "password" | "totp"; at: string; jti: string; docHash: string };
  /* Ed25519 over the canonical decision receipt. Verifiable offline with the
     embedded public key; see /api/receipts/:gateId/verify. */
  signature?: GateSignature;
  /* The wet-ink layer: the officer's freeform signature, drawn in the award
     dialog before the step-up seal. `image` is a trimmed PNG data URL (white
     ground, ≤640px wide); `by` is the gateway-attested officer, never a body
     claim. Kept beside the cryptographic seal — the hand and the hash. */
  handSignature?: { image: string; signedAt: string; strokes: number; by: string };
  /* Office-aware approval (the cycle's statutory gates): when set, a roster
     member must HOLD this office to approve. The signed-in officer (the gavel)
     is the accounting officer and may always sign. */
  requiredOffice?: Office;
  /* Evidential weight. A decided gate is evidence only when it carries both a
     step-up assertion and an Ed25519 receipt; legacy decisions are marked. */
  evidential?: boolean;
  evidentialNote?: string;
  /* Dual approval above the configured threshold: the first signature records
     who opened the gate, the second names the officer who completed it. */
  firstApproval?: { by: string; at: string; stepUpJti: string; note?: string };
  secondApprover?: { by: string; at: string; stepUpJti: string };
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
  tenantId?: string;
  workspaceId?: string;
  tenderId: string;
  status: "RUNNING" | "AWAITING_GATE" | "REJECTED" | "FILED" | "FAILED";
  /* The attested officer who launched the review — four eyes compares the
     signer against this, so preparing and approving cannot be one act. */
  startedBy?: string;
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
  /* The web user id behind the roster row. Office authority is bound to this
     id, not to a typed name. Older rosters may not carry it. */
  id?: string;
  name: string;
  status: "PRESENT" | "EXCUSED";
  office?: Office;
}

/* fileURLToPath decodes %20 etc. — .pathname breaks on paths with spaces. */
const DATA = resolveDataDir();
/** The record directory — the sidecar's own data files live here. */
export const DATA_DIR = DATA;
export { DATA };

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
  /* A snapshot write was refused because the persisted record held decisions
     this process does not have. Nothing was overwritten. */
  snapshotOverwriteRefused: false,
  /* Decided gates on the record with neither a signature nor a step-up. */
  unsignedExecuted: 0,
  /* Epochs sealed when the segment register was introduced or extended. */
  auditRegisterAdded: 0,
};

function hashOfEntry(entry: Omit<LogEntry, "self">): string {
  return hashLogEntry(entry as Record<string, unknown>);
}

/* A decided gate is evidence only when it carries both a step-up assertion and
   an Ed25519 receipt. Decisions recorded before that became mandatory stay on
   the record — deleting history would be worse — but they are marked, so no
   screen or export can present them as signed approvals. */
function markLegacyDecisions() {
  let unsigned = 0;
  for (const gate of state.gates) {
    if (gate.status !== "EXECUTED" && gate.status !== "APPROVED") continue;
    if (gate.signature && gate.stepUp) continue;
    gate.evidential = false;
    gate.evidentialNote =
      "UNSIGNED — decided before signatures were mandatory. The decision stands as a record of what happened, but it is not evidence of a signed approval.";
    unsigned += 1;
  }
  auditHealth.unsignedExecuted = unsigned;
}

export function appendLog(e: Omit<LogEntry, "seq" | "id" | "ts" | "prev" | "self">): LogEntry {
  seq += 1;
  const prev = toolLog.length ? toolLog[toolLog.length - 1].self ?? toolLog[toolLog.length - 1].id : "genesis";
  const entry: LogEntry = {
    seq,
    workspaceId: currentWorkspaceId(),
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

/* ── The segment register — signed epochs across restarts ────────────────
   A restart begins again at genesis; that is a fact of operating the service,
   not a tampering event. Each segment of the log is sealed under the audit key
   with its first and last line and its head hash, and verification checks the
   segments and their records together. An unrecorded restart still fails, so
   the epochs make restarts attributable instead of invisible. */
export const AUDIT_REGISTER = DATA + "log-segments.jsonl";

function readRegister(): SegmentRecord[] {
  try {
    return readFileSync(AUDIT_REGISTER, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as SegmentRecord);
  } catch {
    return [];
  }
}

export async function readLogEntries(): Promise<LogEntry[]> {
  try {
    const raw = await readFile(DATA + "tool-log.jsonl", "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as LogEntry);
  } catch {
    return [];
  }
}

/** Seal every segment the register does not cover yet. Existing records are
    never rewritten: a disagreement has to fail loudly, not be papered over. */
export async function reconcileAuditRegister(): Promise<{ added: number; epochs: number }> {
  const entries = await readLogEntries();
  if (!entries.length) return { added: 0, epochs: readRegister().length };
  const { register, added } = reconcileRegister(
    entries as unknown as ChainEntry[],
    readRegister(),
    secretFor("audit"),
    "quorum-mcp",
  );
  if (added.length) {
    writeFileSync(AUDIT_REGISTER, register.map((record) => JSON.stringify(record)).join("\n") + "\n");
    auditHealth.auditRegisterAdded += added.length;
  }
  return { added: added.length, epochs: register.length };
}

/** Verify the whole log against its register — what /api/log/verify reports. */
export async function verifyToolLogFile(): Promise<ChainVerdict> {
  const entries = await readLogEntries();
  if (!entries.length) {
    return { ok: true, brokenAt: null, checked: 0, lines: 0, segments: 0, restarts: [], epochs: [], error: "no log file yet" };
  }
  return verifyChain(entries as unknown as ChainEntry[], readRegister(), secretFor("audit"));
}

/** In-memory chain check for callers that already hold the entries. */
export function verifyLogChain(entries: LogEntry[]): { ok: boolean; brokenAt: number | null; checked: number } {
  const segments = splitSegments(entries as unknown as ChainEntry[]);
  const broken = segments.find((segment) => !segment.ok);
  return { ok: !broken, brokenAt: broken ? broken.brokenAt : null, checked: entries.length };
}

/* ── Gateway attestation — WHO the web layer vouches for ─────────────────
   The Next.js gateway owns the session. Every state-changing request it
   forwards carries an HMAC over (method, path, actor, ts) computed with the
   shared secret; the sidecar refuses unattested mutations, so the approving
   identity can no longer be typed by the caller — it is attested by the
   process that verified the session. GATE_SECRET overrides the shipped
   development default on real deployments. */
/**
 * The attestation key. Purpose-scoped secrets live in ./secrets: ATTEST_SECRET
 * first, GATE_SECRET as the shared fallback, and the shipped development
 * default refused outright in a production process.
 */
export function gateSecret(): string {
  return secretFor("attest");
}
export const ATTEST_SKEW_MS = 5 * 60 * 1000;

export function attestSignature(method: string, path: string, actor: string, ts: number, secret = gateSecret(), workspaceId = "demo"): string {
  return createHmac("sha256", secret).update(`${method}|${path}|${actor}|${workspaceId}|${ts}`).digest("hex");
}

export function attestVerify(
  method: string,
  path: string,
  headers: Headers,
): { ok: true; actor: string } | { ok: false; reason: string } {
  const actor = headers.get("x-quorum-actor") ?? "";
  const ts = Number(headers.get("x-quorum-ts") ?? NaN);
  const sig = headers.get("x-quorum-attest") ?? "";
  const workspaceId = headers.get("x-quorum-workspace")?.trim() || "demo";
  if (!actor || !sig)
    return { ok: false, reason: "Unattested mutation — state-changing requests must arrive through the gateway, signed by the session that owns them." };
  if (!workspaceId || workspaceId.length > 160)
    return { ok: false, reason: "Invalid workspace scope in gateway attestation." };
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > ATTEST_SKEW_MS)
    return { ok: false, reason: "Attestation timestamp outside the 5-minute window — reload and retry." };
  const expected = attestSignature(method, path, actor, ts, gateSecret(), workspaceId);
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
  /* Set when the row was revealed from the sealed vault. The receipt is the
     link back to the filing; the commitment proves the revealed price is the
     one the bidder sealed. */
  applicationId?: string;
  receiptId?: string;
  commitment?: string;
  sealed?: boolean;
}

export interface OpeningReconciliation {
  sealed: number;
  manual: number;
  derived: number;
  withdrawn: number;
  amended: number;
  missingFromRegister: string[];
  extraInRegister: string[];
  matches: boolean;
  note: string;
}

export interface BidOpeningRegister {
  id: string;
  tenderId: string;
  createdAt: string;
  closingDate?: string;
  rows: OpeningBidRow[];
  minutesMd: string;
  reconciliation?: OpeningReconciliation;
  certifiedAt?: string;
  certifiedBy?: string;
  sha?: string;
  gateId?: string;
}

/* A structured connection named in a declaration: the firm or person the
   member is connected to, and how. The evaluator screen writes these by name
   so the bidder/owner screen can compare entities rather than prose. */
export interface CoiEntity {
  name: string;
  relationship?: string;
  kind?: "ENTITY" | "PERSON";
}

export interface CoiDeclaration {
  id: string;
  tenderId: string;
  member: string;
  declaration: "NO_CONFLICT" | "CONFLICT_DECLARED";
  conflicts?: string;
  /* The names the declaration covers. Screening compares them with the
     bidders on the matrix and their beneficial owners; a hit under a
     NO_CONFLICT declaration blocks certification until the member amends it. */
  entities?: CoiEntity[];
  /* The member has stepped aside from this tender's evaluation. Recusal is
     recorded separately from the declaration so a conflict can be declared
     and the panel composition read from the same record. */
  recused?: boolean;
  declaredAt: string;
}

export interface EvalCriterion {
  id: string;
  title: string;
  weight: number; /* percent — all weights must sum to 100 */
}

export interface EvalEvidence {
  citation: string;
  quote: string;
  relevance: number;
  decision: "SUGGESTED" | "CONFIRMED" | "REJECTED";
  decidedBy?: string;
  decidedAt?: string;
}

export interface EvalEvidenceGroup {
  criterionId: string;
  evidence: EvalEvidence[];
}

export interface EvalPriceSignal {
  bidder: string;
  item: string;
  source: string;
  quantity: number;
  unitPrice: number;
  extendedPrice: number;
  currency?: string;
  peerMedian?: number;
  ratioToPeerMedian?: number;
}

export interface EvalSharedIdentifier {
  kind: "REGISTRATION" | "TAX_ID" | "EMAIL" | "PHONE";
  value: string;
  bidders: { bidder: string; citation: string; quote: string }[];
  interpretation: string;
}

export interface EvalMarketSignals {
  prices: EvalPriceSignal[];
  sharedIdentifiers: EvalSharedIdentifier[];
  totalsByCurrency: { bidder: string; currency: string; total: number }[];
}

export interface EvalScore {
  criterionId: string;
  score: number; /* 0-100 */
  note?: string;
  evidence?: EvalEvidence[];
}

/* One evaluator's own sheet: every bidder against every criterion, sealed
   with a digest over the submitted cells. A sheet is evidence of what that
   evaluator scored before the committee met — it is never overwritten by
   consensus, and a resubmission supersedes its predecessor explicitly. */
export interface EvalSheetScore {
  bidder: string;
  criterionId: string;
  score: number; /* 0-100 */
  note?: string;
}

export interface EvalScoreSheet {
  id: string;
  matrixId: string;
  tenderId: string;
  evaluator: string;
  evaluatorId?: string;
  scores: EvalSheetScore[];
  note?: string;
  submittedBy: string;
  submittedAt: string;
  version: number;
  supersedes?: string;
  signature: string;
}

/* A disagreement the committee has to look at: the spread across sheets for
   one cell, with the values and the evaluators who gave them. */
export interface EvalDivergence {
  bidder: string;
  criterionId: string;
  min: number;
  max: number;
  spread: number;
  values: { evaluator: string; score: number }[];
}

/* The committee's agreed scores, computed from the sheets and signed by the
   recorder. The matrix's technical column is only rewritten from here. */
export interface EvalConsensus {
  matrixId: string;
  scores: EvalSheetScore[];
  attendees: string[];
  notes: string;
  divergences: EvalDivergence[];
  recordedBy: string;
  recordedAt: string;
  signature: string;
}

/* An FX quote used to put every bid on one evaluated-price basis. `base` is
   the bid's currency, `quote` the evaluation currency; rate is quote per one
   base unit. A quote carries its source and observation date, and the gate
   refuses a stale or unsourced one. */
export interface FxRate {
  base: string;
  quote: string;
  rate: number;
  source: string;
  asOf: string;
}

export type Responsiveness = "ADMINISTRATIVELY_NONRESPONSIVE" | "MATERIALLY_NONRESPONSIVE" | "RESPONSIVE";

export interface EvalBidResult {
  bidder: string;
  source?: string;
  late: boolean;
  responsiveness: Responsiveness;
  reasons: string[];
  technicalScores: EvalScore[];
  evidenceByCriterion?: EvalEvidenceGroup[];
  priceSignals?: EvalPriceSignal[];
  technicalTotal: number; /* weighted 0-100 */
  financial?: {
    amount: number;
    currency?: string;
    formulaScore?: number;
    /* The evaluated basis the formula scored. Present when a conversion was
       applied; `fxError` explains why a foreign price could not be scored. */
    evaluatedAmount?: number;
    evaluatedCurrency?: string;
    fxRate?: number;
    fxSource?: string;
    fxAsOf?: string;
    fxError?: string;
  };
  total?: number; /* technical × techWeightPct + financial × rest */
  verdict: "RECOMMENDED" | "NOT_RECOMMENDED" | "DISQUALIFIED";
}

export interface EvalMatrix {
  id: string;
  tenderId: string;
  marketSignals?: EvalMarketSignals;
  runId?: string;
  criteria: EvalCriterion[];
  technicalWeightPct: number;
  bids: EvalBidResult[];
  /* The common basis every bid is scored in. Absent on legacy matrices — the
     financial formula then compares stated amounts as before. */
  evaluationCurrency?: string;
  fxRates?: FxRate[];
  /* WS7 — evaluator sheets and the committee consensus drawn from them. */
  sheets?: EvalScoreSheet[];
  consensus?: EvalConsensus;
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
  /* What kind of publication this actually is. A simulated notice is a
     rehearsal record; it never authorises a contract. */
  publication?: ExternalPublication;
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
  /* The share of the original contract value all approved variations now
     represent. Computed when the variation is requested, stored for the file. */
  cumulativePct?: number;
  status: "APPROVED" | "REJECTED" | "PENDING";
  at: string;
  gateId?: string;
  decidedBy?: string;
  approvedAt?: string;
  /* A cumulative-cap override: a named reason and the officer who seconded it. */
  override?: { reason: string; secondedBy: string; by: string; at: string };
}

export interface ContractPayment {
  id: string;
  description: string;
  /* `amount` is the gross claim, kept for records written before the payment
     cap existed. New payments carry the split explicitly. */
  amount: number;
  gross?: number;
  retention?: number;
  withholding?: number;
  net?: number;
  currency?: string;
  fxRate?: number;
  invoiceId?: string;
  milestoneId?: string;
  goodsReceiptId?: string;
  status?: "PENDING" | "CERTIFIED" | "PAID";
  gateId?: string;
  certifiedAt?: string;
  certifiedBy?: string;
}

export interface PerformanceSecurity {
  amount: number;
  issuer: string;
  validUntil: string;
  documentId?: string;
}

export interface ContractInsurance {
  policyNo: string;
  issuer: string;
  validUntil: string;
  cover?: string;
}

export interface ContractCondition {
  id: string;
  text: string;
  metAt?: string;
}

export interface ContractCompletion {
  certificateId: string;
  defectsLiabilityEndsAt: string;
  performanceRating: number;
  note?: string;
  at: string;
  by: string;
export interface ContractPerfSecurity {
  id: string;
  instrument: "BANK_GUARANTEE" | "INSURANCE_BOND" | "CASH_DEPOSIT" | "OTHER";
  amount: number;
  currency?: string;
  provider?: string;
  reference?: string;
  validUntil?: string;
  receivedAt: string;
  verifiedBy?: string;
  verifiedAt?: string;
}

export interface ContractFile {
  tenderId: string;
  supplier: string;
  value: number;
  currency?: string;
  openedAt: string;
  openedFromGate?: string;
  packMd?: string;
  /* DRAFT is a signed pack; EXECUTED is the instrument the supplier accepted;
     only an executed contract may carry a payment. */
  status?: "DRAFT" | "EXECUTED" | "COMPLETED";
  executedAt?: string;
  executedBy?: string;
  supplierAcceptedAt?: string;
  supplierSignatory?: string;
  acceptanceHash?: string;
  security?: PerformanceSecurity;
  insurance?: ContractInsurance;
  subcontractors?: { name: string; scope: string }[];
  retentionPct?: number;
  warrantyDays?: number;
  conditions?: ContractCondition[];
  completion?: ContractCompletion;
  milestones: ContractMilestone[];
  variations: ContractVariation[];
  payments: ContractPayment[];
  /* Phase 2 (lifecycle): performance security held against the contract.
     Recorded on receipt; verification is a named officer's act. */
  performanceSecurity: ContractPerfSecurity[];
  completedAt?: string;
  completedBy?: string;
}

export interface ComplaintIndependentReview {
  reviewer: string;
  at: string;
  outcome: string;
  note: string;
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
  /* The complainant is told the outcome; an escalation goes to independent
     review. Contract and payment stay blocked while OPEN or ESCALATED. */
  status: "OPEN" | "ANSWERED" | "ESCALATED" | "CLOSED" | "WITHDRAWN";
  acknowledgedAt?: string;
  escalatedAt?: string;
  escalationReason?: string;
  independentReview?: ComplaintIndependentReview;
  closedAt?: string;
  closedBy?: string;
}

/* ── Budget and commitment ledger ───────────────────────────────────────────
   The award commits money before it is spent. A commitment is released when
   the contract closes; a payment draws down `spent` against the line. */

export interface BudgetLine {
  id: string;
  workspaceId?: string;
  fiscalYear: number;
  code: string;
  currency: string;
  approved: number;
  committed: number;
  spent: number;
  createdAt: string;
  updatedAt: string;
}

export interface Commitment {
  id: string;
  workspaceId?: string;
  tenderId: string;
  budgetLineId: string;
  amount: number;
  currency?: string;
  createdAt: string;
  createdBy: string;
  releasedAt?: string;
  releasedBy?: string;
}

/* The cap on cumulative variations, as a share of the original contract value.
   A lawful variation regime needs a ceiling, not only a gate. */
export const VARIATION_CUMULATIVE_CAP_PCT = 25;

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
  tenantId?: string;
  workspaceId?: string;
  ref: string;
  title: string;
  office?: string;
  budgetEstimate?: number;
  currency?: string;
  expectedPublication?: string;
  status: "PLANNED" | "LINKED";
  linkedTenderId?: string;
  createdAt: string;
  /* Phase 2 (lifecycle): requisition and budget validation sits between
     planning and publication. The officer who confirms the budget signs the
     record; the planning entry cannot be published without it. */
  requisition?: {
    budgetValidated: boolean;
    budgetReference?: string;
    validatedBy?: string;
    validatedAt?: string;
    note?: string;
  };
}

export interface TenderCycle {
  tenderId: string;
  tenantId?: string;
  workspaceId?: string;
  /* The lawful method this tender runs under (methods.ts), and the record
     that makes a non-open choice defensible: a stated justification, the
     accounting officer's method gate, and — where the law requires it — the
     authority's prior approval reference. */
  methodId?: string;
  methodJustification?: string;
  methodApprovalRef?: string;
  methodApprovedBy?: string;
  methodApprovedAt?: string;
  methodGateId?: string;
  /* The value the method was tested against when it was recorded; the award
     re-tests against the winning bid's actual value. */
  methodValue?: number;
  methodCurrency?: string;
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
  /* Phase 2 (committee decision support): minority positions and dissenting
     recommendations, recorded by the member who holds them. A dissent is a
     right, not an approval — it never needs a gate, but it is evidence and
     the procurement file carries it. */
  dissents: TenderDissent[];
  createdAt: string;
}

export interface TenderDissent {
  id: string;
  stage: "EVALUATION_CERTIFICATION" | "AWARD_REPORT" | "CONTRACT_PACK";
  member: string;
  position: "DISSENT" | "ABSTAIN" | "CONCUR_WITH_NOTES";
  basis: string;
  recordedAt: string;
  recordedBy: string;
}

export interface SourceRequest {
  id: string;
  workspaceId?: string;
  name: string;
  kind: string;
  note?: string;
  requestedBy: string;
  createdAt: string;
  status: "PENDING" | "CONNECTED" | "DISMISSED";
}

/* ── Phase 2 (exception handling): the formal exception register ────────────
   Every departure from the standard route — single-source, emergency, direct
   award, non-compliance, post-award correction — lives here with its extra
   evidence. Approval is never an ordinary write: raising an exception raises
   a GATE for the accounting officer, and only a signed decision registers it.
   Public-sector reality: an exception without a paper trail is a scandal. */
export const EXCEPTION_KINDS = [
  "SINGLE_SOURCE",
  "EMERGENCY",
  "DIRECT_AWARD",
  "NON_COMPLIANCE",
  "POST_AWARD_CORRECTION",
] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

export const EXCEPTION_KIND_LABELS: Record<ExceptionKind, string> = {
  SINGLE_SOURCE: "Single-source procurement",
  EMERGENCY: "Emergency procurement",
  DIRECT_AWARD: "Direct award",
  NON_COMPLIANCE: "Non-compliance exception",
  POST_AWARD_CORRECTION: "Post-award correction",
};

export interface ProcurementException {
  id: string;
  tenderId?: string;
  kind: ExceptionKind;
  title: string;
  justification: string;
  /* References to the evidence pack: document keys, file names, gate ids —
     whatever anchors the justification to the record. */
  evidence: string[];
  valueImpact?: { amount: number; currency?: string };
  requestedBy: string;
  requestedAt: string;
  status: "PENDING_GATE" | "APPROVED" | "REFUSED" | "WITHDRAWN";
  gateId?: string;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
  withdrawnAt?: string;
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
  workspaceId?: string;
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
  workspaceId?: string;
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
  /* The latest assurance check on this supplier — registry, tax, beneficial
     ownership, sanctions/PEP and documents. Optional because the register
     predates it; absent fails closed whenever assurance is enforced. */
  verification?: SupplierVerification;
  addedBy: string;
  createdAt: string;
  updatedAt?: string;
}

/* ── Supplier assurance (WS6) ──────────────────────────────────────────────
   A point-in-time check, not a permanent badge: registry standing, tax
   standing, who ultimately owns the firm, sanctions/PEP screening and the
   documents behind it. It carries its source (a live registry lookup or a
   labelled manual attestation) and an expiry, because a clean check today is
   not evidence of a clean check at award. */

export type VerificationSource = "REGISTRY_LOOKUP" | "MANUAL_ATTESTATION";
export type RegistryStatus = "REGISTERED" | "NOT_FOUND" | "STRUCK_OFF";
export type TaxStatus = "VALID" | "EXPIRED" | "NOT_FOUND";
export type ScreeningResult = "CLEAR" | "HIT";

export interface BeneficialOwner {
  name: string;
  role?: string;
  /* Percentage of the firm ultimately held; 0 when not stated. */
  ownershipPct?: number;
  nationality?: string;
  idNo?: string;
}

export interface VerificationDocument {
  id: string;
  kind: string;
  reference?: string;
  issuedAt?: string;
  expiresAt?: string;
}

export interface SupplierVerification {
  status: "VERIFIED" | "FAILED";
  registryStatus: RegistryStatus;
  taxStatus: TaxStatus;
  beneficialOwners: BeneficialOwner[];
  sanctions: ScreeningResult;
  pep: ScreeningResult;
  /* Named matches behind a HIT — the reviewer sees who and where. */
  sanctionsMatches?: string[];
  pepMatches?: string[];
  documents: VerificationDocument[];
  checkedAt: string;
  expiresAt: string;
  source: VerificationSource;
  checkedBy: string;
  notes?: string;
}

/* An application an organization files against a published tender from the
   supplier portal. The identity on the record is the ATTESTED actor the web
   layer vouches for (org:<name>) — a body-declared organization is never
   trusted. Applications are refused after the closing date and one bid per
   organization per tender, the same discipline the opening register enforces
   on paper bids. */
export interface SupplierApplication {
  id: string;
  workspaceId?: string;
  tenderId: string;
  orgId: string;                 /* the web store's organization id (reference only) */
  orgName: string;               /* derived from the attested actor, not the body */
  actor: string;                 /* org:<name> — the gateway-sealed identity */
  supplierId?: string;           /* the supplier-register entry synced on filing */
  registrationNo: string;        /* the organization's legal registration number */
  /* Legacy plaintext filings keep their amount. A sealed filing never stores
     the price: `sealed` holds the only copy, encrypted. */
  amount?: number;
  currency?: string;
  coverNote?: string;
  sealed?: SealedBidEnvelope;
  receiptId?: string;
  version?: number;
  supersedesId?: string;
  withdrawnAt?: string;
  amendedAt?: string;
  receivedAt: string;
  status: "RECEIVED" | "WITHDRAWN" | "AMENDED";
}

export interface BidReceipt {
  id: string;
  tenderId: string;
  orgId: string;
  orgName: string;
  commitment: string;
  receivedAt: string;
  algorithm: "AES-256-GCM";
  signature: string;
}

export interface SealedBidEnvelope {
  version: 1;
  algorithm: "AES-256-GCM";
  envelopeId: string;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
  commitment: string;
  sealedAt: string;
  receipt: BidReceipt;
}

/* The tunable guards — the thresholds the agent obeys inside a run. The Rules &
   guards page writes them by name; the engine reads them at flag time, so the
   very next run is reviewed under the settings on the page. Defaults are the
   settings as first carved: 25% variance, STANDARD checklist, cross-check ON. */
export interface Guards {
  priceVariancePct: 15 | 25 | 40;
  checklist: "STANDARD" | "STRICT";
  registryCrossCheck: boolean;
  /* A gate whose stated value is at or above this figure needs two named
     approvals from two different officers. 0 disables the rule. */
  dualApprovalThreshold: number;
  /* A spread this wide (in score points) between evaluator sheets is a
     structured divergence the committee must minute before certifying. */
  scoreDivergencePoints: number;
  /* An FX quote older than this many days is stale and cannot carry the
     evaluated-price basis. */
  fxStalenessDays: number;
  /* Who last moved a guard, and when — the audit line on the page. */
  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_GUARDS: Guards = {
  priceVariancePct: 25,
  checklist: "STANDARD",
  registryCrossCheck: true,
  dualApprovalThreshold: 0,
  scoreDivergencePoints: 25,
  fxStalenessDays: 30,
  updatedAt: null,
  updatedBy: null,
};

/* One normaliser for every reader of the guards — the live store, the offline
   eval and the benchmark parse the same record the same way, so a harness can
   never drift from the settings the desk set. */
export function normalizeGuards(raw: unknown): Guards {
  const g = (raw ?? {}) as Partial<Guards>;
  return {
    priceVariancePct: ([15, 25, 40] as const).includes(g.priceVariancePct as 15 | 25 | 40)
      ? (g.priceVariancePct as Guards["priceVariancePct"])
      : DEFAULT_GUARDS.priceVariancePct,
    checklist: g.checklist === "STRICT" ? "STRICT" : "STANDARD",
    registryCrossCheck: typeof g.registryCrossCheck === "boolean" ? g.registryCrossCheck : DEFAULT_GUARDS.registryCrossCheck,
    dualApprovalThreshold:
      typeof g.dualApprovalThreshold === "number" && g.dualApprovalThreshold > 0
        ? g.dualApprovalThreshold
        : DEFAULT_GUARDS.dualApprovalThreshold,
    scoreDivergencePoints:
      typeof g.scoreDivergencePoints === "number" && g.scoreDivergencePoints > 0 && g.scoreDivergencePoints <= 100
        ? g.scoreDivergencePoints
        : DEFAULT_GUARDS.scoreDivergencePoints,
    fxStalenessDays:
      typeof g.fxStalenessDays === "number" && g.fxStalenessDays > 0 && g.fxStalenessDays <= 365
        ? g.fxStalenessDays
        : DEFAULT_GUARDS.fxStalenessDays,
    updatedAt: typeof g.updatedAt === "string" ? g.updatedAt : null,
    updatedBy: typeof g.updatedBy === "string" ? g.updatedBy : null,
  };
}

export interface StepUpUse {
  jti: string;
  gateId: string;
  sub: string;
  usedAt: string;
}

export type JurisdictionId = "KE" | "ZM";
/* ── Phase 4 (evidence architecture): the document register ─────────────────
   One row per known document across every channel (sample pack, staged text,
   R2 upload, gate artifact). Content hash, version line, provenance and
   chain-of-custody events make a document's life reconstructible — and make
   silent replacement detectable: a new row with the same key and a different
   hash is a version, never an overwrite. */
export const DOCUMENT_KINDS = [
  "NOTICE",
  "BID",
  "OCDS",
  "SPECIFICATION",
  "EVIDENCE",
  "CONTRACT",
  "RECEIPT",
  "OTHER",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export type TrustChannel = "web_upload" | "sidecar_stage" | "sample_pack" | "gate_artifact" | "system";

export interface DocumentCustodyEvent {
  at: string;
  actor: string;
  action: "REGISTERED" | "VERSIONED" | "DOWNLOADED" | "REVIEWED" | "ARCHIVED" | "RESTORED";
  detail?: string;
}

export interface DocumentRecord {
  id: string;
  tenderId?: string;
  key: string;
  title: string;
  kind: DocumentKind;
  sha256: string;
  version: number;
  previousSha?: string;
  bytes: number;
  contentType?: string;
  channel: TrustChannel;
  importer: string;
  capturedAt: string;
  provenance?: { originSystem?: string; note?: string };
  /* Person-in-the-loop for low-confidence extraction: a LOW/MEDIUM flag is a
     work item, cleared only by a named reviewer. */
  extractionConfidence?: {
    level: "HIGH" | "MEDIUM" | "LOW";
    reason?: string;
    reviewedBy?: string;
    reviewedAt?: string;
  };
  retention: { schedule: string; years: number; disposeAfter?: string; status: "ACTIVE" | "ARCHIVED" };
  custody: DocumentCustodyEvent[];
}

/* ── Phase 1 (governance): the authority configuration the desk runs on ─────
   The role/capability matrix is code (the web app's permissions.ts); the part
   that varies per installation — monetary approval bands and the governance
   sign-off — is data, persisted here and changed only by named actors. */
export interface ApprovalBand {
  id: string;
  label: string;
  currency: string;
  min: number;
  max?: number;
  approvalOffice: Office;
  note?: string;
}

export interface GovernanceConfig {
  bands: ApprovalBand[];
  signedOff?: { by: string; at: string; scope: string };
  updatedAt?: string;
  updatedBy?: string;
}

interface PersistShape {
  gates: Gate[];
  runs: Run[];
  sourceRequests: SourceRequest[];
  suppliers: Supplier[];
  applications: SupplierApplication[];
  guards: Guards;
  cycle: TenderCycle[];
  pipeline: PipelineEntry[];
  budgetLines: BudgetLine[];
  commitments: Commitment[];
  stepUpUses: StepUpUse[];
  exceptions: ProcurementException[];
  documents: DocumentRecord[];
  governance: GovernanceConfig;
  agentMode: AgentMode;
  deployment: Deployment;
  connector: ConnectorRegistration | null;
  sittings: Sitting[];
  /* Idempotency keys of web-side events already written into the chain —
     the outbox's replay guarantee across restarts. */
  forwardedKeys: string[];
  features: Features;
  jurisdictionId: JurisdictionId;
  stateVersion: number;
}

export type AgentMode = "enabled" | "read-only" | "disabled";
export const DEFAULT_AGENT_MODE: AgentMode = "enabled";

/* ── Deployment truth ──────────────────────────────────────────────────────
   A workspace starts in RECORD_ONLY: it may rehearse the whole cycle, but a
   contract or payment cannot be signed on a local record. CONNECTED requires a
   verified external publication receipt; the normaliser fails closed, so a
   hand-edited state file cannot jump the gate. */
export type DeploymentMode = "RECORD_ONLY" | "CONNECTED";
export type PublicationMode = "SIMULATED" | "CONNECTED";

export interface ExternalPublication {
  mode: PublicationMode;
  portal: string;
  receiptId?: string;
  publishedAt?: string;
  verifiedAt?: string;
  evidenceHash?: string;
}

export interface Deployment {
  mode: DeploymentMode;
  publication: ExternalPublication;
  /* The registered connector this mode runs through. A receipt alone can be
     pasted from anywhere; a CONNECTED workspace must name the connector that
     actually carried the notice, and that connector must still be active. */
  connectorId?: string;
  updatedAt: string | null;
  updatedBy: string | null;
  reason?: string;
}

/* ── The external connector — what "CONNECTED" means ─────────────────────
   A deployment can only ever be as connected as the thing it is connected
   TO. A workspace claims CONNECTED only while a real connector is registered
   (by a named operator, with an endpoint, on the record) and still active.
   Deregistering (deactivating) a connector collapses the deployment to
   RECORD_ONLY at the next normalisation — truth follows the connector. */
export interface ConnectorRegistration {
  id: string;
  name: string;
  endpoint: string;
  operator: string;
  operatorId?: string;
  registeredAt: string;
  active: boolean;
  deactivatedAt?: string;
  deactivatedBy?: string;
  note?: string;
}

export function activeConnector(state): ConnectorRegistration | null {
  const c = state.connector;
  return c && c.active ? c : null;
}

/** (raw, connector) — CONNECTED requires the receipt AND a live registered
    connector named by connectorId. Fails closed: a hand-edited state file
    claiming CONNECTED with no connector collapses to RECORD_ONLY. */
export function normalizeDeployment(raw: unknown, connector?: ConnectorRegistration | null): Deployment {
  const r = (raw ?? {}) as Partial<Deployment>;
  const p = (r.publication ?? {}) as Partial<ExternalPublication>;
  const portal = typeof p.portal === "string" && p.portal.trim() ? p.portal.trim().slice(0, 200) : SIMULATED_PORTAL;
  const receiptId = typeof p.receiptId === "string" ? p.receiptId.trim().slice(0, 200) : "";
  const evidenceHash = typeof p.evidenceHash === "string" ? p.evidenceHash.trim().slice(0, 200) : "";
  const connectorId = typeof r.connectorId === "string" ? r.connectorId.trim().slice(0, 120) : "";
  const connectorLive = !!connector && connector.active && (!connectorId || connectorId === connector.id);
  /* CONNECTED is only as good as its receipt AND its connector. Without the
     external id, the evidence hash, a real timestamp and a registered
     connector, the record says what it can prove: a rehearsal. */
  const connected =
    r.mode === "CONNECTED" &&
    p.mode === "CONNECTED" &&
    !!receiptId &&
    !!evidenceHash &&
    connectorLive &&
    typeof p.publishedAt === "string" &&
    !Number.isNaN(new Date(p.publishedAt).getTime());
  return {
    mode: connected ? "CONNECTED" : "RECORD_ONLY",
    publication: connected
      ? {
          mode: "CONNECTED",
          portal,
          receiptId,
          evidenceHash,
          publishedAt: p.publishedAt,
          ...(typeof p.verifiedAt === "string" ? { verifiedAt: p.verifiedAt } : {}),
        }
      : { mode: "SIMULATED", portal: SIMULATED_PORTAL },
    ...(connected ? { connectorId: connector!.id } : {}),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
    updatedBy: typeof r.updatedBy === "string" ? r.updatedBy : null,
    ...(typeof r.reason === "string" && r.reason.trim() ? { reason: r.reason.trim().slice(0, 240) } : {}),
  };
}

export const SIMULATED_PORTAL = "e-GP portal (simulated — no transmission)";

export const DEFAULT_DEPLOYMENT: Deployment = {
  mode: "RECORD_ONLY",
  publication: { mode: "SIMULATED", portal: SIMULATED_PORTAL },
  updatedAt: null,
  updatedBy: null,
};

/* ── Sittings — the noticed meeting a quorum is drawn from ────────────────
   A committee roll is who the desk SAYS is present; a sitting is where the
   evidence lives: a notice issued ahead of time, attendance admitted at the
   door and withdrawn again when a member leaves. A gate linked to a tender
   under the sittingQuorum flag must draw its quorum from the sitting's
   admitted attendance — never from a hand-set PRESENT flag. */
export interface SittingAttendance {
  name: string;
  memberId?: string;
  status: "ADMITTED" | "WITHDRAWN" | "EXCUSED";
  at: string;
  by?: string;
}

export type SittingStatus = "SCHEDULED" | "NOTICED" | "LIVE" | "ENDED";

export interface Sitting {
  id: string;
  workspaceId?: string;
  tenderIds: string[];
  title?: string;
  scheduledAt: string;
  /* The moment the summons to members was issued. Attendance counts only
     for sittings that carry one — an unnotified sitting is not a committee. */
  noticeAt?: string;
  noticeIssuedBy?: string;
  location?: string;
  quorumRequired?: number;
  attendance: SittingAttendance[];
  status: SittingStatus;
  endedAt?: string;
  /* The emergency path exists but is never free: it is named, reasoned and
     audited, and it still names the members who attended. */
  emergency?: { by: string; reason: string; at: string };
}

/* Rows written by earlier versions simply load back with what they carry. */
export function normalizeSitting(raw: unknown): Sitting | null {
  const r = (raw ?? {}) as Partial<Sitting>;
  if (!Array.isArray(r.tenderIds)) return null;
  const tenderIds = r.tenderIds.filter((t): t is string => typeof t === "string" && !!t.trim());
  if (!tenderIds.length) return null;
  const scheduledAt = typeof r.scheduledAt === "string" ? r.scheduledAt : "";
  if (!scheduledAt || Number.isNaN(new Date(scheduledAt).getTime())) return null;
  const attendance = (Array.isArray(r.attendance) ? r.attendance : []).flatMap((a) => {
    const row = (a ?? {}) as Partial<SittingAttendance>;
    const name = typeof row.name === "string" ? row.name.trim().slice(0, 160) : "";
    if (!name) return [];
    return [{
      name,
      ...(typeof row.memberId === "string" ? { memberId: row.memberId } : {}),
      status: row.status === "ADMITTED" || row.status === "WITHDRAWN" || row.status === "EXCUSED" ? row.status : "ADMITTED" as const,
      at: typeof row.at === "string" ? row.at : new Date().toISOString(),
      ...(typeof row.by === "string" ? { by: row.by } : {}),
    }];
  });
  const emergency = (r.emergency ?? {}) as Partial<NonNullable<Sitting["emergency"]>>;
  return {
    id: typeof r.id === "string" && r.id ? r.id : `sit_${randomUUID().slice(0, 10)}`,
    ...(typeof r.workspaceId === "string" ? { workspaceId: r.workspaceId } : {}),
    tenderIds,
    ...(typeof r.title === "string" && r.title.trim() ? { title: r.title.trim().slice(0, 160) } : {}),
    scheduledAt,
    ...(typeof r.noticeAt === "string" && !Number.isNaN(new Date(r.noticeAt).getTime())
      ? { noticeAt: r.noticeAt, noticeIssuedBy: typeof r.noticeIssuedBy === "string" ? r.noticeIssuedBy.slice(0, 160) : undefined }
      : {}),
    ...(typeof r.location === "string" && r.location.trim() ? { location: r.location.trim().slice(0, 200) } : {}),
    ...(typeof r.quorumRequired === "number" && Number.isFinite(r.quorumRequired) && r.quorumRequired > 0
      ? { quorumRequired: Math.round(r.quorumRequired) }
      : {}),
    attendance,
    status: r.status === "NOTICED" || r.status === "LIVE" || r.status === "ENDED" ? r.status : "SCHEDULED" as const,
    ...(typeof r.endedAt === "string" && !Number.isNaN(new Date(r.endedAt).getTime()) ? { endedAt: r.endedAt } : {}),
    ...(typeof emergency.by === "string" && typeof emergency.reason === "string" && emergency.reason.trim().length >= 12
      ? { emergency: { by: emergency.by, reason: emergency.reason.trim().slice(0, 400), at: typeof emergency.at === "string" ? emergency.at : new Date().toISOString() } }
      : {}),
  };
}

/* The connector in a state file loads back exactly as registered or not at
   all — a half-baked record is not registered. Deactivation is history, not
   deletion, so a connector sugar-coated to look live in a hand edit fails. */
export function normalizeConnector(raw: unknown): ConnectorRegistration | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim().slice(0, 120) : "";
  const name = typeof r.name === "string" ? r.name.trim().slice(0, 200) : "";
  const endpoint = typeof r.endpoint === "string" ? r.endpoint.trim().slice(0, 400) : "";
  const operator = typeof r.operator === "string" ? r.operator.trim().slice(0, 160) : "";
  if (!id || !name || !endpoint || !operator) return null;
  if (typeof r.registeredAt !== "string" || Number.isNaN(new Date(r.registeredAt).getTime())) return null;
  const active = r.active !== false;
  return {
    id,
    name,
    endpoint,
    operator,
    ...(typeof r.operatorId === "string" && r.operatorId.trim() ? { operatorId: r.operatorId.trim().slice(0, 120) } : {}),
    registeredAt: r.registeredAt,
    active,
    ...(active ? {} : { deactivatedAt: typeof r.deactivatedAt === "string" ? r.deactivatedAt : new Date().toISOString() }),
    ...(active ? {} : { deactivatedBy: typeof r.deactivatedBy === "string" ? r.deactivatedBy.slice(0, 160) : "system" }),
    ...(typeof r.note === "string" && r.note.trim() ? { note: r.note.trim().slice(0, 240) } : {}),
  };
}

/* Bounded, de-duplicated, string-only: the harmless keys of past receipts. */
function forwardKeysFrom(raw: unknown): string[] {
  const rows = Array.isArray(raw) ? raw : [];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (typeof row !== "string") continue;
    const key = row.trim().slice(0, 200);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
    if (keys.length >= 5000) break;
  }
  return keys;
}

/** A registered, active connector: the shape every CONNECTED workspace must
 *  carry. The approval route builds one from the attested request; tests and
 *  tooling use this to stage a record that can honestly say CONNECTED. */
export function registeredConnector(
  overrides: Partial<ConnectorRegistration> = {},
): ConnectorRegistration {
  return {
    id: `con_${randomUUID().slice(0, 10)}`,
    name: "e-GP portal connector",
    endpoint: "https://egp.gov.zm/api",
    operator: "System Administrator",
    registeredAt: new Date().toISOString(),
    active: true,
    ...overrides,
  };
}

/* ── Feature flags ─────────────────────────────────────────────────────────
   The registry is the source of truth for what has actually shipped. Refusals
   that protect the record are locked on; future workstreams ship dark. */
export const FEATURE_FLAGS = [
  { key: "recordOnlyEnforcement", label: "Record-only enforcement", description: "Refuse contracts and payments while no external publication is connected.", phase: "Phase 0", default: true, locked: true },
  { key: "truthInLabeling", label: "Truth-in-labeling", description: "Label simulated notices, receipts and exports as simulations.", phase: "Phase 0", default: true, locked: true },
  { key: "liveRuleCatalogue", label: "Live rule catalogue", description: "Generate the published rule register from the live guard values.", phase: "Phase 0", default: true, locked: true },
  { key: "connectedPublication", label: "Connected e-GP publication", description: "Allow CONNECTED deployment after a verified portal receipt exists.", phase: "WS0", default: false },
  { key: "sealedBids", label: "Sealed bid vault", description: "Encrypt bid payloads until the certified opening reveal.", phase: "WS1", default: true },
  { key: "bidLifecycle", label: "Bid withdrawal and amendment", description: "Offer receipts, withdrawal and amendment before closing.", phase: "WS1", default: true },
  { key: "jurisdictionClock", label: "Jurisdiction clocks", description: "Compute statutory periods against a signed holiday/timezone pack.", phase: "WS2", default: true },
  { key: "addendumEnforcement", label: "Addendum notice control", description: "Refuse a late addendum that does not extend the closing date.", phase: "WS2", default: true },
  { key: "actorBoundOffice", label: "Actor-bound office authority", description: "Bind every office gate to a user ID, not a typed name.", phase: "WS3", default: true },
  { key: "dualApproval", label: "Dual approval", description: "Require two different officers above the configured value.", phase: "WS3", default: true },
  { key: "findingDispositions", label: "Finding dispositions", description: "Block award while a HIGH finding is undispositioned.", phase: "WS4", default: true },
  { key: "complaintSuspension", label: "Complaint suspension", description: "Block contract and payment while a complaint is open.", phase: "WS4", default: true },
  { key: "contractExecution", label: "Contract execution", description: "Require supplier acceptance, bonds and insurance before payment.", phase: "WS5", default: true },
  { key: "paymentCaps", label: "Payment and variation caps", description: "Enforce contract value, retention and cumulative variation limits.", phase: "WS5", default: true },
  { key: "supplierAssurance", label: "Supplier assurance", description: "Verify registry, tax, sanctions and beneficial ownership before award.", phase: "WS6", default: true },
  { key: "methodControl", label: "Procurement method control", description: "Require a lawful method and a signed justification for non-open methods.", phase: "WS6", default: true },
  { key: "evaluationIntegrity", label: "Evaluation integrity", description: "Per-evaluator sheets, consensus, structured conflicts and FX scoring.", phase: "WS7", default: true },
  { key: "sittingQuorum", label: "Sitting quorum", description: "Derive quorum from a noticed sitting's admitted attendance.", phase: "WS8", default: false },
  { key: "minutesEvidential", label: "Evidential minutes", description: "Attendee filing, approval, hashing, quote checks and scoped access.", phase: "WS8", default: false },
  { key: "unifiedAudit", label: "Unified audit spine", description: "Forward web-side mutations into the verifiable chain.", phase: "WS9", default: true, locked: true },
  { key: "residencyPolicy", label: "Data residency policy", description: "Route model calls by workspace residency and redaction policy.", phase: "WS10", default: true, locked: true },
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[number]["key"];
export type Features = Record<FeatureFlagKey, boolean>;

export const DEFAULT_FEATURES = Object.fromEntries(
  FEATURE_FLAGS.map((flag) => [flag.key, flag.default]),
) as Features;

export function normalizeFeatures(raw: unknown): Features {
  const r = (raw ?? {}) as Record<string, unknown>;
  const next = { ...DEFAULT_FEATURES };
  for (const flag of FEATURE_FLAGS) {
    if (typeof r[flag.key] === "boolean") next[flag.key] = r[flag.key] as boolean;
  }
  return next;
}

export const STATE_VERSION = 1;
const workspaceContext = new AsyncLocalStorage<string>();
export const currentWorkspaceId = () => workspaceContext.getStore() ?? "demo";
export function workspaceRows<T extends { workspaceId?: string }>(rows: readonly T[], workspaceId = currentWorkspaceId()): T[] {
  return rows.filter((row) => (row.workspaceId ?? "demo") === workspaceId);
}
export function withWorkspace<T>(workspaceId: string, work: () => T): T {
  if (!workspaceId || workspaceId.length > 160) throw new Error("invalid workspace scope");
  return workspaceContext.run(workspaceId, work);
}

/* The seed bands are the desk's working defaults, plainly marked illustrative:
   they name the office that approves in each band but carry no invented legal
   numbers. The operational owner confirms or replaces them, and the change is
   logged like every other governance act. */
export const DEFAULT_GOVERNANCE: GovernanceConfig = {
  bands: [
    {
      id: "band-small",
      label: "Small value",
      currency: "ZMW",
      min: 0,
      max: 250_000,
      approvalOffice: "PROCUREMENT_UNIT",
      note: "Illustrative default — the operational owner confirms the real bands before live use.",
    },
    {
      id: "band-medium",
      label: "Medium value",
      currency: "ZMW",
      min: 250_000,
      max: 2_000_000,
      approvalOffice: "EVALUATION_COMMITTEE",
      note: "Illustrative default — the operational owner confirms the real bands before live use.",
    },
    {
      id: "band-large",
      label: "Large / material value",
      currency: "ZMW",
      min: 2_000_000,
      approvalOffice: "ACCOUNTING_OFFICER",
      note: "Material awards carry independent committee review and the accounting officer's signature.",
    },
  ],
};

export const state: PersistShape = {
  gates: [],
  runs: [],
  sourceRequests: [],
  suppliers: [],
  applications: [],
  guards: { ...DEFAULT_GUARDS },
  cycle: [],
  pipeline: [],
  budgetLines: [],
  commitments: [],
  stepUpUses: [],
  exceptions: [],
  documents: [],
  governance: { bands: DEFAULT_GOVERNANCE.bands.map((b) => ({ ...b })) },
  agentMode: DEFAULT_AGENT_MODE,
  deployment: { ...DEFAULT_DEPLOYMENT, publication: { ...DEFAULT_DEPLOYMENT.publication } },
  connector: null,
  sittings: [],
  forwardedKeys: [],
  features: { ...DEFAULT_FEATURES },
  jurisdictionId: "ZM",
  stateVersion: STATE_VERSION,
};

export async function loadState() {
  const storage = await initializePersistence();
  let raw: any = await readSnapshot();
  if (raw === null && storage === "postgres") {
    /* First PostgreSQL boot imports, but does not remove, the JSON snapshot. */
    raw = await readJsonSnapshot();
    if (raw !== null) await writeSnapshot(raw);
  }
  /* A state file that EXISTS but cannot be parsed is not "first boot" — it is
     corruption, and pretending otherwise silently erases gates, runs and the
     cycle. Quarantine the file (renamed, never deleted), flag it, and say so
     on /api/health forever after. */
  if (storage === "json") {
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
  }
  try {
    if (raw === null) return;

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
    state.budgetLines.length = 0;
    state.budgetLines.push(...(raw.budgetLines ?? []));
    state.commitments.length = 0;
    state.commitments.push(...(raw.commitments ?? []));
    state.stepUpUses.length = 0;
    state.stepUpUses.push(...(raw.stepUpUses ?? []));
    state.connector = normalizeConnector(raw.connector);
    state.sittings.length = 0;
    state.sittings.push(...((raw.sittings ?? []) as unknown[]).map(normalizeSitting).filter((s): s is Sitting => s !== null));
    state.forwardedKeys.length = 0;
    state.forwardedKeys.push(...forwardKeysFrom(raw.forwardedKeys));
    state.exceptions.length = 0;
    state.exceptions.push(...(raw.exceptions ?? []));
    state.documents.length = 0;
    state.documents.push(...(raw.documents ?? []));
    state.governance = {
      bands: Array.isArray(raw.governance?.bands) && raw.governance.bands.length > 0 ? raw.governance.bands : DEFAULT_GOVERNANCE.bands,
      ...(raw.governance?.signedOff ? { signedOff: raw.governance.signedOff } : {}),
      ...(raw.governance?.updatedAt ? { updatedAt: raw.governance.updatedAt } : {}),
      ...(raw.governance?.updatedBy ? { updatedBy: raw.governance.updatedBy } : {}),
    };
    state.agentMode = raw.agentMode === "read-only" || raw.agentMode === "disabled" ? raw.agentMode : DEFAULT_AGENT_MODE;
    /* Deployment and feature flags are normalised on every boot. A state file
       written before them, or edited by hand to claim CONNECTED, loads as the
       conservative record it can actually prove — and the connector has to be
       registered and live for the claim to survive. */
    state.deployment = normalizeDeployment(raw.deployment, state.connector);
    state.features = normalizeFeatures(raw.features);
    state.jurisdictionId = raw.jurisdictionId === "KE" || raw.jurisdictionId === "ZM" ? raw.jurisdictionId : "ZM";
    state.stateVersion = STATE_VERSION;
    /* Merged over the defaults so a store written before the guards existed
       still boots with the carved settings. */
    state.guards = normalizeGuards(raw.guards);
    seq = raw.seq ?? 0;
  } catch {
    /* first boot */
  }
  /* Mark decisions that predate mandatory signatures before anything reads
     them. This is a label, never a delete: the record of what happened stays. */
  markLegacyDecisions();
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
  /* Seal every segment the register does not cover yet. A fresh restart point
     becomes an epoch, so it is visible rather than mistaken for a break. */
  try {
    const sealed = await reconcileAuditRegister();
    if (sealed.added) console.log(`[audit-spine] sealed ${sealed.added} new epoch(s) in the segment register`);
  } catch (err) {
    console.error("[audit-spine] the segment register could not be sealed — verification will report the truth:", err);
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSnapshot: ReturnType<typeof setTimeout> | null = null;
const DECIDED_STATUSES = new Set<Gate["status"]>(["APPROVED", "EXECUTED", "REJECTED"]);

/* A deliberate removal (the probe purge, an archive-and-remove) is the one case
   where losing rows is the intent. It must be declared up front, with a reason,
   and the spine records it — so the override is auditable rather than a hole. */
let intentionalRemoval: string | null = null;
export function allowIntentionalRemoval(reason: string) {
  intentionalRemoval = reason.slice(0, 400);
}
let guardCache: { mtimeMs: number; gates: Gate[] } | null = null;

/** The gates in the persisted snapshot, cached by mtime. */
async function persistedGates(): Promise<Gate[]> {
  try {
    const file = Bun.file(DATA + "state.json");
    const mtimeMs = (await file.stat()).mtimeMs;
    if (guardCache && guardCache.mtimeMs === mtimeMs) return guardCache.gates;
    const parsed = (await file.json()) as { gates?: Gate[] };
    guardCache = { mtimeMs, gates: parsed.gates ?? [] };
    return guardCache.gates;
  } catch {
    return [];
  }
}

/**
 * Refuse to write a snapshot that would erase a decision this process does not
 * hold. The failure this prevents is real: two processes, one data directory,
 * last write wins — and a signed, executed gate disappears from the record.
 */
async function overwriteRefusal(): Promise<string | null> {
  if (persistenceStatus() !== "json") return null;
  if (intentionalRemoval) {
    appendLog({
      actor: "quorum-mcp",
      server: "quorum-mcp",
      tool: "record_removal",
      kind: "IRREVERSIBLE",
      inputs: { reason: intentionalRemoval },
      outputs: { override: "the snapshot overwrite guard was waived for this declared removal" },
      status: "OK",
      durationMs: 0,
    });
    return null;
  }
  const persisted = await persistedGates();
  for (const gate of persisted) {
    const decided = DECIDED_STATUSES.has(gate.status) || !!gate.signature;
    if (!decided) continue;
    const live = state.gates.find(
      (g) => g.id === gate.id && (g.workspaceId ?? "demo") === (gate.workspaceId ?? "demo"),
    );
    if (!live) {
      return `gate ${gate.id} (${gate.status}${gate.signature ? ", signed" : ""}) is in the persisted record but not in this process's memory`;
    }
    if (!DECIDED_STATUSES.has(live.status) && live.status !== gate.status) {
      return `gate ${gate.id} is ${live.status} in memory but ${gate.status} in the persisted record`;
    }
  }
  return null;
}

async function persist(snapshot: unknown) {
  const refusal = await overwriteRefusal();
  if (refusal) {
    auditHealth.stateSaveFailing = true;
    auditHealth.snapshotOverwriteRefused = true;
    console.error(
      `[audit-spine] snapshot write REFUSED — ${refusal}. The persisted record is newer than this process; nothing was overwritten.`,
    );
    try {
      appendLog({
        actor: "quorum-mcp",
        server: "quorum-mcp",
        tool: "state_write_refused",
        kind: "WRITES",
        inputs: {},
        outputs: { refused: refusal },
        status: "ERROR",
        durationMs: 0,
      });
    } catch {
      /* appendLog carries its own failure flag */
    }
    return;
  }
  try {
    await writeSnapshot(snapshot);
    auditHealth.stateSaveFailing = false;
    auditHealth.snapshotOverwriteRefused = false;
    intentionalRemoval = null;
  } catch (err) {
    auditHealth.stateSaveFailing = true;
    console.error("[audit-spine] state snapshot write FAILED — gates/runs/cycle are memory-only until this resolves:", err);
  }
}

/* Read the guards and the supplier register WITHOUT booting or writing the
   store. The offline eval and the benchmark use this so they measure the same
   engine the app runs, under the settings the desk set — never a fixed
   default. Read-only: no snapshot is written. */
export async function readPersistedGuardContext(): Promise<{
  guards: Guards;
  registry: { name: string; status: string }[];
}> {
  try {
    const storage = await initializePersistence();
    let raw: any = await readSnapshot();
    if (raw === null && storage === "postgres") raw = await readJsonSnapshot();
    const suppliers = (raw?.suppliers ?? []) as { name?: unknown; status?: unknown }[];
    return {
      guards: normalizeGuards(raw?.guards),
      registry: suppliers
        .filter((s) => s && typeof s.name === "string" && s.name.length > 0)
        .map((s) => ({ name: String(s.name), status: String(s.status ?? "ACTIVE") })),
    };
  } catch {
    return { guards: { ...DEFAULT_GUARDS }, registry: [] };
  }
}

export function saveState() {
  if (saveTimer) clearTimeout(saveTimer);
  if (pendingSnapshot) clearTimeout(pendingSnapshot);
  saveTimer = setTimeout(() => {
    const snapshot = { ...state, seq };
    if (persistenceStatus() === "postgres") {
      void persist(snapshot);
    } else {
      pendingSnapshot = setTimeout(() => {
        void persist(snapshot);
      }, 0);
    }
  }, 120);
}

export function shaOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}
