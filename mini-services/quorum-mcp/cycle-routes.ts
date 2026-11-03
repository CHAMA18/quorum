/**
 * quorum-mcp — the cycle's stateful surface (waves 1-3).
 *
 * The pure engine lives in cycle.ts; this module binds it to the durable
 * state: one TenderCycle per tender reference, the procurement pipeline, the
 * statutory gates and their executors. REST routes and MCP tool calls share
 * the same cores — the agent's hands and the officer's desk act on identical
 * code paths, and every step lands in the append-only tool log.
 */

import { createHash, createHmac, randomUUID } from "node:crypto";
import { notifyWebSoon } from "./notify";
import {
  gateSecret,
  appendLog,
  shaOf,
  currentWorkspaceId,
  normalizeCycle,
  saveState,
  state,
  type Addendum,
  type AlbDossier,
  type BidOpeningRegister,
  type BudgetLine,
  type Commitment,
  type ContractFile,
  type ContractPayment,
  type ContractVariation,
  type CoiDeclaration,
  type CoiEntity,
  type EvalConsensus,
  type EvalMatrix,
  type EvalPriceSignal,
  type EvalScoreSheet,
  type FxRate,
  type Finding,
  type Gate,
  type Office,
  type OpenBidInput,
  type QuarterlyProcurementReport,
  type RosterMemberForGate,
  type TenderCycle,
} from "./store";
import { criterionEvidenceSuggestions, evaluatePackSignals, loadPack, parseMarkdownBidValue } from "./engine";
import {
  DEFAULT_TECH_WEIGHT_PCT,
  DEFAULT_FINANCIAL_FORMULA,
  applyMedAdjustments,
  bidSecurityFindings,
  buildOpeningRows,
  composeAlbLetter,
  composeAwardNotice,
  composeAwardReport,
  composeContractPack,
  composeOpeningMinutes,
  composeProcurementFile,
  collectDeadlines,
  cleanEvaluationCriterionDetail,
  cleanEvaluationProcedure,
  composeDebriefLetter,
  contractValueCheck,
  cycleAnalytics,
  debarmentFindings,
  draftNoticeMd,
  noticeFieldCheck,
  parseClosingDate,
  parseEvaluationCriteria,
  parseEvaluationProcedure,
  scoreMatrix,
  validateCriteria,
  validateCriteriaDisclosure,
  validateScores,
  variationPctOfContract,
  responsivenessLadder,
  weightsSum,
  withEvaluationCriteria,
  withEvaluationProcedure,
} from "./cycle";
import {
  computeDivergences,
  conflictScreening,
  consensusScores,
  consensusValidationError,
  evaluationBlockReason,
  fxBlockReason,
  jurisdictionCurrency,
  normalizeCurrency,
  normalizeFxRates,
  sheetValidationError,
  sameEntity,
} from "./evaluation";
import { DEBARMENT_LIST } from "./debarment";
import { addendumNoticeState, addWorkingDaysIn, jurisdictionPack } from "./jurisdiction";
import { formatPriceRead, reconcileOpening, revealBid } from "./bid-vault";
import { awardFindingBlockReason, complaintBlockReason, dispositionReason, revalidateAward } from "./award";
import {
  assuranceBlockReason,
  assuranceStanding,
  normalizeVerification,
  verificationFailures,
  verificationOk,
} from "./supplier-assurance";
import {
  METHOD_VALUE_LIMITS,
  findMethod,
  methodAuthorityBlockReason,
  methodControlBlockReason,
  methodNeedsGate,
  methodStanding,
} from "./method-control";
import {
  commitmentBlockReason,
  completionBlockReason,
  cumulativeVariationPct,
  executionBlockReason,
  paymentBlockReason,
  paymentNet,
  paymentSplit,
  roundMoney,
  variationBlockReason,
} from "./finance";
import { TENDER_REF_RE } from "./marketplace";
import { listSampleTenders, SAMPLE_SYSTEM_REFERENCES, sampleSystemReferenceForTender } from "./samples";
import { llmConfigFromEnv, callLlama } from "./engine";
import { executeExceptionApproval, executeExceptionRejection } from "./exceptions";
import { complianceSummary } from "./rulepack";
import { listDocuments } from "./documents";

/* ── Small helpers ─────────────────────────────────────────────────────────── */

const str = (v: unknown) => (typeof v === "string" ? v : "");
const SAFE_REF = TENDER_REF_RE;
const isSystemReference = (value: unknown): value is string =>
  typeof value === "string" && /^QRM-\d{4}-\d{3,6}$/i.test(value);

export function publicSystemReferenceForTender(tenderId: string, workspaceId = currentWorkspaceId()): string | undefined {
  const pipeline = state.pipeline.find((entry) =>
    (entry.workspaceId ?? "demo") === workspaceId &&
    (entry.linkedTenderId === tenderId || entry.ref === tenderId),
  );
  if (isSystemReference(pipeline?.systemReference)) return pipeline.systemReference;
  if (isSystemReference(pipeline?.ref)) return pipeline.ref;
  const cycle = state.cycle.find((entry) => entry.tenderId === tenderId && (entry.workspaceId ?? "demo") === workspaceId);
  if (isSystemReference(cycle?.systemReference)) return cycle.systemReference;
  const run = state.runs.find((entry) => entry.tenderId === tenderId && (entry.workspaceId ?? "demo") === workspaceId);
  if (isSystemReference(run?.reference)) return run.reference;
  return isSystemReference(tenderId) ? tenderId : sampleSystemReferenceForTender(tenderId);
}

function cycleFor(tenderId: string, workspaceId = currentWorkspaceId()): TenderCycle {
  const existing = state.cycle.find((c) => c.tenderId === tenderId && (c.workspaceId ?? "demo") === workspaceId);
  if (existing) {
    /* A cycle written before a field existed keeps working: its required
       arrays are backfilled on read, in one place, not per caller. */
    return normalizeCycle(existing);
  }
  const pipeline = state.pipeline.find((entry) =>
    (entry.workspaceId ?? "demo") === workspaceId &&
    (entry.linkedTenderId === tenderId || entry.ref === tenderId),
  );
  const linkedReference = pipeline?.systemReference ?? pipeline?.ref;
  const fresh: TenderCycle = {
    tenderId,
    workspaceId,
    systemReference: isSystemReference(linkedReference) ? linkedReference : nextPipelineRef({}),
    coi: [],
    alb: [],
    debriefs: [],
    complaints: [],
    clarifications: [],
    addenda: [],
    notices: [],
    specs: [],
    dissents: [],
    createdAt: new Date().toISOString(),
  };
  state.cycle.push(fresh);
  return fresh;
}

async function tenderMeta(tenderId: string): Promise<{ title?: string; buyer?: string }> {
  try {
    const sample = (await listSampleTenders()).find((s) => s.ref === tenderId);
    return sample ? { title: sample.title, buyer: sample.buyer } : {};
  } catch {
    return {};
  }
}

/* The closing date on record: the officer's explicit entry wins, else the notice's. */
async function closingOnRecord(tenderId: string, cycle: TenderCycle): Promise<string | undefined> {
  if (cycle.closingDate) return cycle.closingDate;
  try {
    const { pack } = await loadPack(tenderId);
    const clock = jurisdictionPack(state.jurisdictionId);
    return pack.notices.map((n) => parseClosingDate(n.text, clock.utcOffsetHours)).find(Boolean);
  } catch {
    return undefined;
  }
}

function raiseCycleGate(input: {
  tenderId: string;
  workspaceId?: string;
  tool: string;
  requiredOffice?: Office;
  inputs: unknown;
  note?: string;
}): Gate {
  const gate: Gate = {
    id: `gate_${Math.random().toString(36).slice(2, 8)}`,
    runId: "cycle",
    workspaceId: input.workspaceId ?? "demo",
    tenderId: input.tenderId,
    tool: input.tool,
    inputs: input.inputs,
    status: "PENDING",
    createdAt: new Date().toISOString(),
    ...(input.requiredOffice ? { requiredOffice: input.requiredOffice } : {}),
  };
  appendLog({
    actor: "quorum-agent",
    server: "quorum-mcp",
    tool: input.tool,
    kind: "IRREVERSIBLE",
    runId: "cycle",
    inputs: input.inputs,
    outputs: {
      gate: gate.id,
      requiredOffice: input.requiredOffice ?? "any PRESENT member or the gavel",
      note: "EXECUTION BLOCKED — named human required",
    },
    status: "PENDING_GATE",
    durationMs: 0,
  });
  state.gates.unshift(gate);
  saveState();
  notifyWebSoon({ type: "GATE_WAITING", gateId: gate.id, tenderId: gate.tenderId, tool: gate.tool, requiredOffice: gate.requiredOffice });
  return gate;
}

type QuarterlyReportEntry = QuarterlyProcurementReport["entries"][number];

function quarterBounds(year: number, quarter: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, (quarter - 1) * 3, 1)),
    end: new Date(Date.UTC(year, quarter * 3, 0, 23, 59, 59, 999)),
  };
}

function entriesForQuarter(workspaceId: string, year: number, quarter: number): QuarterlyReportEntry[] {
  const { start, end } = quarterBounds(year, quarter);
  const inside = (raw: string | undefined) => {
    if (!raw) return false;
    const at = new Date(raw).getTime();
    return Number.isFinite(at) && at >= start.getTime() && at <= end.getTime();
  };
  const entries: QuarterlyReportEntry[] = [];
  for (const cycle of state.cycle) {
    if ((cycle.workspaceId ?? "demo") !== workspaceId) continue;
    for (const variation of cycle.contract?.variations ?? []) {
      const date = variation.approvedAt ?? (variation.status === "APPROVED" ? variation.at : undefined);
      if (variation.status !== "APPROVED" || !inside(date)) continue;
      entries.push({
        tenderId: cycle.tenderId,
        type: "VARIATION",
        reference: variation.id,
        date: date!,
        amount: variation.valueDelta,
        currency: cycle.contract?.currency,
      });
    }
    const notice = cycle.awardNotice;
    if (!notice?.publishedAt || !inside(notice.publishedAt) || !cycle.matrix) continue;
    const winner = cycle.matrix.bids.find((bid) => bid.bidder === cycle.awardReport?.recommendation);
    const adjustment = winner?.financial?.adjustments;
    const hasPreference = Number(adjustment?.preferencePct ?? 0) > 0 ||
      (cycle.matrix.preferenceScheme === "CDF_RESERVATION" &&
        adjustment?.reservationCitizenSupplier === true &&
        (adjustment.reservationEligible === true || adjustment.reservationExceptionRef === cycle.matrix.cdfReservationExceptionRef));
    if (!winner || !hasPreference) continue;
    entries.push({
      tenderId: cycle.tenderId,
      type: "PREFERENCE_AWARD",
      reference: notice.sha,
      date: notice.publishedAt,
      supplier: winner.bidder,
      amount: Number(winner.financial?.correctedAmount ?? winner.financial?.amount ?? 0),
      currency: winner.financial?.currency ?? cycle.matrix.evaluationCurrency,
      scheme: adjustment?.preferenceScheme ?? cycle.matrix.preferenceScheme,
    });
  }
  return entries.sort((a, b) => a.date.localeCompare(b.date) || a.tenderId.localeCompare(b.tenderId) || a.reference.localeCompare(b.reference));
}

function quarterlyReportSnapshot(report: QuarterlyProcurementReport): QuarterlyReportEntry[] {
  return entriesForQuarter(report.workspaceId, report.year, report.quarter);
}

function quarterlyReportBlockReason(gate: Gate, approvingActorId?: string): string | null {
  const input = (gate.inputs && typeof gate.inputs === "object" ? gate.inputs : {}) as { reportId?: string; digest?: string };
  const report = state.quarterlyReports.find((row) =>
    row.id === input.reportId && row.workspaceId === (gate.workspaceId ?? "demo"),
  );
  if (!report || report.status !== "PENDING_GATE") return "The quarterly report is missing or no longer awaiting approval.";
  if (!report.submissionReference.trim() || !report.evidenceReference.trim()) return "The external submission and evidence references are required.";
  const digest = shaOf(quarterlyReportSnapshot(report));
  if (!input.digest || report.digest !== input.digest || digest !== input.digest) {
    return "The report period changed after it was staged — regenerate the report and raise a new approval gate.";
  }
  if (report.requestedBy && approvingActorId && report.requestedBy === approvingActorId) {
    return "A different officer must approve the quarterly report than the officer who prepared it.";
  }
  return null;
}

function quarterlyPeriodIsClosed(year: number, quarter: number): boolean {
  return quarterBounds(year, quarter).end.getTime() < Date.now();
}

function coreStageQuarterlyReport(
  workspaceId: string,
  year: number,
  quarter: number,
  submissionReference: string,
  evidenceReference: string,
  actorId: string,
) {
  const currentYear = new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < 2020 || year > currentYear || !Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
    throw new Error("Choose a valid completed reporting quarter.");
  }
  if (!quarterlyPeriodIsClosed(year, quarter)) throw new Error("A quarterly return can be submitted only after the reporting quarter has closed.");
  if (!actorId) throw new Error("The report preparer must be a signed-in workspace user.");
  const reference = submissionReference.trim().slice(0, 200);
  const evidence = evidenceReference.trim().slice(0, 240);
  if (!reference || !evidence) throw new Error("Record both the authority submission reference and the supporting evidence reference.");
  if (state.quarterlyReports.some((report) => report.workspaceId === workspaceId && report.year === year && report.quarter === quarter)) {
    throw new Error("A report for this quarter is already staged or submitted; use its recorded status instead of creating a duplicate.");
  }
  const entries = entriesForQuarter(workspaceId, year, quarter);
  const digest = shaOf(entries);
  const report: QuarterlyProcurementReport = {
    id: `qpr_${year}_q${quarter}_${randomUUID().slice(0, 8)}`,
    workspaceId,
    year,
    quarter: quarter as 1 | 2 | 3 | 4,
    status: "PENDING_GATE",
    entries,
    digest,
    submissionReference: reference,
    evidenceReference: evidence,
    requestedBy: actorId,
    requestedAt: new Date().toISOString(),
  };
  state.quarterlyReports.push(report);
  const gate = raiseCycleGate({
    tenderId: `qpr_${year}_q${quarter}`,
    workspaceId,
    tool: "submit_quarterly_report",
    requiredOffice: "ACCOUNTING_OFFICER",
    inputs: { reportId: report.id, digest, entryCount: entries.length },
    note: `Submit the Q${quarter} ${year} variation and preference-award return`,
  });
  report.gateId = gate.id;
  saveState();
  return { report, gate: gate.id };
}

/* ── Deployment truth — one refusal shared by every money/contract path ──── */

/** What the notice or receipt can honestly call itself. */
export function publicationLabel(): string {
  const p = state.deployment.publication;
  if (state.deployment.mode === "CONNECTED" && p.mode === "CONNECTED" && p.receiptId) {
    return `${p.portal} · receipt ${p.receiptId}`;
  }
  return p.portal;
}

/** A contract follows a real notice, not a rehearsal notice. */
function awardPublicationReason(cycle: Pick<TenderCycle, "awardNotice" | "matrix"> | undefined): string | null {
  if (!cycle?.awardNotice?.publishedAt) {
    return "The notice of award has not been published — a contract follows publication and standstill, not the award report alone.";
  }
  if (cycle.awardNotice.publication?.mode !== "CONNECTED") {
    return "The award notice on record is SIMULATED — a contract cannot follow a rehearsal publication. Re-publish the notice through the connected portal first.";
  }
  const expected = (cycle.matrix?.bids ?? []).map((bid) => bid.bidder).sort((a, b) => a.localeCompare(b));
  if (!cycle.awardNotice.dispatchedAt || !cycle.awardNotice.dispatchEvidenceRef?.trim() || JSON.stringify([...(cycle.awardNotice.dispatchedTo ?? [])].sort()) !== JSON.stringify(expected)) {
    return "The award notice has no complete dispatch record for every bidder — the contract path remains closed.";
  }
  return null;
}

/** A notice staged under one mode cannot be executed under another. */
function stagedPublicationReason(gate: Gate): string | null {
  const staged = (gate.inputs as { publicationMode?: string } | undefined)?.publicationMode;
  if (staged && staged !== state.deployment.publication.mode) {
    return `The notice was staged in ${staged} mode, but this workspace is now ${state.deployment.publication.mode}. Re-draft the notice under the current deployment mode before publishing.`;
  }
  if (!staged && state.deployment.publication.mode === "CONNECTED") {
    return "The notice predates deployment labels — re-draft it under the connected mode before publishing.";
  }
  return null;
}

/* Act 8/2020 s.71(3), as amended: simplified bidding and direct bidding are
   exempt; limited bidding is exempt only where the approved method record
   establishes insufficient time. Other ZM methods keep the five-day clock. */
function standstillApplies(cycle: TenderCycle | undefined): boolean {
  if (state.jurisdictionId !== "ZM") return true;
  if (cycle?.methodId === "simplified-bidding" || cycle?.methodId === "direct-bidding") return false;
  if (cycle?.methodId === "limited-bidding" && /insufficient\s+time/i.test(cycle.methodJustification ?? "")) return false;
  return true;
}

function standstillBlockReason(cycle: TenderCycle | undefined): string | null {
  if (!cycle) return "The tender record is unavailable.";
  if (!standstillApplies(cycle)) return null;
  if (!cycle.awardNotice?.publishedAt || !cycle.standstill?.endsAt) return "The applicable standstill clock has not been started by a published award notice.";
  const endsAt = new Date(cycle.standstill.endsAt).getTime();
  if (!Number.isFinite(endsAt)) return "The standstill end date is invalid — contract signing is blocked until corrected.";
  if (Date.now() < endsAt) return `The standstill window is still running until ${cycle.standstill.endsAt.slice(0, 10)}.`;
  const open = (cycle.complaints ?? []).filter((complaint) => complaint.status === "OPEN" || complaint.status === "ESCALATED");
  if (open.length) return `The standstill time has elapsed, but complaint(s) ${open.map((complaint) => complaint.id).join(", ")} remain open.`;
  return null;
}

/* ── Award legality — the shared refusals for WS4 ──────────────────────────── */

function tenderFindings(tenderId: string): Finding[] {
  return state.runs.filter((run) => run.tenderId === tenderId).flatMap((run) => run.findings);
}

/** The value the method and the assurance check are measured against. */
function awardValue(cycle: TenderCycle | undefined): { value?: number; currency?: string } {
  if (!cycle) return {};
  const winner = cycle.awardReport?.recommendation ?? (cycle.matrix ? rankedBidder(cycle.matrix) : undefined);
  const row = winner
    ? cycle.matrix?.bids.find((b) => b.bidder.toLowerCase() === winner.trim().toLowerCase())
    : undefined;
  if (row?.financial) return { value: row.financial.correctedAmount ?? row.financial.amount, currency: row.financial.currency };
  const pipeline = state.pipeline.find((p) => p.ref === cycle.tenderId || p.linkedTenderId === cycle.tenderId);
  return pipeline?.budgetEstimate !== undefined
    ? { value: pipeline.budgetEstimate, ...(pipeline.currency ? { currency: pipeline.currency } : {}) }
    : {};
}

/** WS6 — the winner must carry a live, passing assurance check. */
function supplierAssuranceReason(cycle: TenderCycle | undefined, bidder?: string): string | null {
  if (!cycle || !state.features.supplierAssurance) return null;
  const winner = bidder ?? cycle.awardReport?.recommendation ?? (cycle.matrix ? rankedBidder(cycle.matrix) : undefined);
  return assuranceBlockReason(state.suppliers, winner);
}

/** The value the method is read against: the live award value, else the staged estimate. */
function methodValueFor(cycle: TenderCycle): { value?: number; currency?: string } {
  const live = awardValue(cycle);
  return live.value !== undefined
    ? live
    : {
        ...(cycle.methodValue !== undefined ? { value: cycle.methodValue } : {}),
        ...(cycle.methodCurrency ? { currency: cycle.methodCurrency } : {}),
      };
}

/** WS6 — the method must be lawful for the value, justified and approved. */
function methodControlReason(cycle: TenderCycle | undefined): string | null {
  if (!cycle || !state.features.methodControl) return null;
  const { value, currency } = methodValueFor(cycle);
  return methodControlBlockReason({
    methodId: cycle.methodId,
    justification: cycle.methodJustification,
    approvedAt: cycle.methodApprovedAt,
    approvalRef: cycle.methodApprovalRef,
    ...(value !== undefined ? { value } : {}),
    ...(currency ? { currency } : {}),
    jurisdictionId: state.jurisdictionId,
  });
}

function floatPeriodBlockReason(cycle: TenderCycle | undefined, noticeMd: string, issuedAt: string): string | null {
  const method = cycle?.methodId ? findMethod(state.jurisdictionId, cycle.methodId) : undefined;
  if (!method?.floatPeriod) return null;
  const minimums = method.floatPeriod.match(/(\d+)\s+weeks?\s+national.*?(\d+)\s+weeks?\s+international/i);
  if (!minimums) return `The method register's float period for ${method.name} cannot be checked — update the method rule before publication.`;
  const international = /^\*\*Procurement scope:\*\*\s*International$/m.test(noticeMd);
  const requiredDays = Number(international ? minimums[2] : minimums[1]) * 7;
  const clock = jurisdictionPack(state.jurisdictionId);
  const closing = cycle?.closingDate ?? parseClosingDate(noticeMd, clock.utcOffsetHours);
  if (!closing) return "The solicitation closing date is missing — the statutory float period cannot be checked.";
  const openedAt = new Date(issuedAt).getTime();
  const closesAt = new Date(closing).getTime();
  if (!Number.isFinite(openedAt) || !Number.isFinite(closesAt)) return "The solicitation publication or closing date is invalid — the float period cannot be checked.";
  const days = Math.floor((closesAt - openedAt) / 86_400_000);
  if (days < requiredDays) return `${method.name} requires at least ${requiredDays} calendar days for this ${international ? "international" : "national"} solicitation; the current publication-to-closing period is ${Math.max(0, days)} days.`;
  return null;
}

/** The award-revalidation: matrix, bidder, register, debarment, open findings. */
function awardLegalityReason(cycle: TenderCycle | undefined, tenderId: string): string | null {
  if (!cycle || !state.features.findingDispositions) return null;
  const verdict = revalidateAward({
    matrix: cycle.matrix,
    ...(cycle.awardReport?.recommendation ? { bidder: cycle.awardReport.recommendation } : {}),
    findings: tenderFindings(tenderId),
    suppliers: state.suppliers,
  });
  if (verdict.ok) return null;
  return `The award fails revalidation: ${verdict.blockers.join(" ")}`;
}

/** Every reason the award, contract or execution path is blocked, in one list. */
export function awardBlockers(cycle: TenderCycle): string[] {
  const blockers: string[] = [];
  if (state.features.findingDispositions) {
    const verdict = revalidateAward({
      matrix: cycle.matrix,
      ...(cycle.awardReport?.recommendation ? { bidder: cycle.awardReport.recommendation } : {}),
      findings: tenderFindings(cycle.tenderId),
      suppliers: state.suppliers,
    });
    blockers.push(...verdict.blockers);
  }
  if (state.features.complaintSuspension) {
    const complaint = complaintBlockReason(cycle.complaints);
    if (complaint) blockers.push(complaint);
  }
  const method = methodControlReason(cycle);
  if (method) blockers.push(method);
  const assurance = supplierAssuranceReason(cycle);
  if (assurance) blockers.push(assurance);
  return blockers;
}

/** The contract as the execution gate's instruments would leave it. */
function contractAtExecution(contract: ContractFile, gate: Gate): ContractFile {
  const input = (gate.inputs && typeof gate.inputs === "object" ? gate.inputs : {}) as {
    performanceSecurity?: { amount?: number; issuer?: string; validUntil?: string; documentId?: string };
    insurance?: { policyNo?: string; issuer?: string; validUntil?: string; cover?: string };
    retentionPct?: number;
    warrantyDays?: number;
  };
  const security = input.performanceSecurity;
  const insurance = input.insurance;
  return {
    ...contract,
    ...(security && typeof security.amount === "number" && security.amount > 0
      ? {
          security: {
            amount: roundMoney(security.amount),
            issuer: String(security.issuer ?? "").trim(),
            validUntil: String(security.validUntil ?? ""),
            ...(security.documentId ? { documentId: String(security.documentId) } : {}),
          },
        }
      : {}),
    ...(insurance?.policyNo?.trim()
      ? {
          insurance: {
            policyNo: String(insurance.policyNo).trim(),
            issuer: String(insurance.issuer ?? "").trim(),
            validUntil: String(insurance.validUntil ?? ""),
            ...(insurance.cover ? { cover: String(insurance.cover) } : {}),
          },
        }
      : {}),
    ...(typeof input.retentionPct === "number" ? { retentionPct: input.retentionPct } : {}),
    ...(typeof input.warrantyDays === "number" ? { warrantyDays: input.warrantyDays } : {}),
  };
}

/** Complaints suspend the contract and payment path while they are live. */
function complaintSuspensionReason(cycle: TenderCycle | undefined): string | null {
  if (!cycle || !state.features.complaintSuspension) return null;
  return complaintBlockReason(cycle.complaints);
}

/** Null only when a verified external publication exists. Fail closed. */
export function contractAuthorityReason(): string | null {
  if (state.deployment.mode !== "CONNECTED") {
    return `RECORD-ONLY MODE — ${state.deployment.publication.portal}. A contract cannot be signed and a payment cannot be certified until a verified external publication receipt is on record.`;
  }
  const p = state.deployment.publication;
  if (p.mode !== "CONNECTED" || !p.receiptId || !p.evidenceHash) {
    return "CONNECTED MODE is selected, but no verified external publication receipt is on record — the contract path stays closed.";
  }
  /* A mode can survive its own de-registration when state is held in memory:
     re-check that the connector named by the deployment is still registered
     and live. Truth follows the connector, not the flag. */
  const connector = state.connector;
  if (!connector || !connector.active || (state.deployment.connectorId && state.deployment.connectorId !== connector.id)) {
    return "The connector this CONNECTED deployment ran through is no longer registered and live — re-register the portal connector before the contract path reopens.";
  }
  return null;
}

/* ── Pre-approval checks — refused BEFORE anything changes ─────────────────── */

/* Tools whose gate cannot be decided without the inputs it staged. A gate that
   lacks them is a record defect, not an empty case list. */
const GATE_TOOLS_WITH_INPUTS = new Set([
  "submit_quarterly_report",
  "record_financial_adjustments",
  "publish_notice",
  "publish_award_notice",
  "resolve_alb",
  "approve_procurement_method",
  "issue_debrief",
  "sign_contract_pack",
  "certify_payment",
  "approve_variation",
  "record_contract_completion",
  "respond_complaint",
]);

export function preApprovalCheck(
  gate: Gate,
  approver: string,
  roster: RosterMemberForGate[],
  signedInAs?: string,
  attestedActorId?: string,
): string | null {
  /* A roster row written before the committee register carried a name cannot
     be matched to an actor or a score sheet — it is an absent member, not a
     crash. Every roster question below reads this list. */
  const named = roster.filter((m) => typeof m?.name === "string" && m.name.trim().length > 0);
  /* Office-aware gates: a roster member must HOLD the required office. The
     signed-in officer is the gavel — the accounting officer's seat — and may
     always sign. FAIL CLOSED: a name that matches nobody on the register is
     refused with the office named, never waved through. A member with no
     office on the register fails closed too. */
  if (gate.requiredOffice) {
    const who = approver.trim().toLowerCase();
    const isOfficer = !!signedInAs?.trim() && signedInAs.trim().toLowerCase() === who;
    if (!isOfficer) {
      const member = named.find((m) => m.name.trim().toLowerCase() === who);
      if (!member)
        return `${approver.trim()} is not on the committee register — this gate must be signed by the ${gate.requiredOffice.replace(/_/g, " ").toLowerCase()} (or the signed-in officer acting as the gavel).`;
      if (attestedActorId && (member.userId ?? member.id) !== attestedActorId) {
        return `${member.name}'s office is bound to a different signed-in user — a typed name cannot borrow another officer's authority. Sign in as the office holder.`;
      }
      if (!member.office) return `${member.name} has no office on the committee register — set the member's office before they sign this gate.`;
      if (member.office !== gate.requiredOffice)
        return `${member.name} holds the ${member.office.replace(/_/g, " ").toLowerCase()} office — this gate must be signed by the ${gate.requiredOffice.replace(/_/g, " ").toLowerCase()}.`;
    }
  }
  /* Gates read the record straight from the store, so the same backfill the
     routes get is applied here: a record written before a field existed must
     answer the gate with a refusal, never with a crash. */
  const found = state.cycle.find((c) => c.tenderId === gate.tenderId);
  const cycle = found ? normalizeCycle(found) : undefined;
  /* A gate persisted before it carried inputs must answer, not throw: the
     cases below read their staged fields off this one object. Where the tool
     cannot be decided without them, the answer is a refusal naming the record
     — an empty object would let a signable gate through to an executor that
     then throws halfway through the decision. */
  const carriesInputs = !!gate.inputs && typeof gate.inputs === "object";
  const inputs = (carriesInputs ? gate.inputs : {}) as Record<string, unknown>;
  if (!carriesInputs && GATE_TOOLS_WITH_INPUTS.has(gate.tool)) {
    return "This gate was raised without its staged inputs on record — raise a fresh gate so the officer signs a decision that names what was staged.";
  }
  switch (gate.tool) {
    case "submit_quarterly_report":
      return quarterlyReportBlockReason(gate, attestedActorId);
    case "record_financial_adjustments": {
      const input = inputs as { matrixId?: string; digest?: string; submittedBy?: string };
      if (!cycle?.matrix || cycle.matrix.id !== input.matrixId) return "The evaluation matrix changed after the price adjustments were staged.";
      const staged = (cycle.matrix.bids ?? []).map((bid) => ({ bidder: bid.bidder, adjustments: bid.financial?.adjustments ?? null }));
      if (!input.digest || shaOf(staged) !== input.digest || cycle.matrix.financialAdjustmentsDigest !== input.digest) {
        return "The financial adjustment record changed after it was staged — submit it again for certification.";
      }
      if (input.submittedBy && attestedActorId && input.submittedBy === attestedActorId) return "A different procurement-unit member must certify the submitted financial adjustments.";
      if ((cycle.matrix.bids ?? []).some((bid) => !bid.financial?.adjustments?.evidenceRef?.trim() || !bid.financial.adjustments.verifiedBy)) return "Every bidder needs a sourced financial adjustment record before certification.";
      return null;
    }
    case "certify_evaluation": {
      if (!cycle) return null;
      /* Every PRESENT member must have declared conflicts before the matrix is certified. */
      const missing = named
        .filter((m) => m.status === "PRESENT")
        .filter((m) => !cycle.coi.some((d) => d.member.toLowerCase() === m.name.toLowerCase()));
      if (missing.length)
        return `Conflict-of-interest declarations are outstanding for: ${missing.map((m) => m.name).join(", ")} — every PRESENT member must declare before the matrix is certified.`;
      const albBlock = openAlbBlockReason(cycle);
      if (albBlock) return albBlock;
      /* WS7 — sheets, consensus, screened conflicts and the FX basis. Checked
         here so a short panel is refused before the token is burned, and again
         in the executor so a direct call cannot certify around the gate. */
      if (state.features.evaluationIntegrity && cycle.matrix) {
        const integrity = evaluationBlockReason({
          matrix: cycle.matrix,
          coi: cycle.coi,
          suppliers: state.suppliers,
          roster: named,
          divergencePoints: state.guards.scoreDivergencePoints,
          fxStalenessDays: state.guards.fxStalenessDays,
        });
        if (integrity) return integrity;
      }
      const cdfBlock = cdfReservationBlockReason(cycle);
      if (cdfBlock) return cdfBlock;
      return null;
    }
    case "publish_notice": {
      const pipeline = state.pipeline.find((entry) => entry.linkedTenderId === gate.tenderId && (entry.workspaceId ?? "demo") === currentWorkspaceId());
      if (!pipeline?.requisition?.budgetValidated || !pipeline.requisition.budgetReference) {
        return "The linked procurement-plan entry has no validated requisition and budget reference — validate available funding before publishing the solicitation.";
      }
      const noticeId = (inputs as { noticeId?: string }).noticeId;
      const notice = cycle?.notices.find((entry) => entry.id === noticeId);
      /* A notice written before the field check existed carries no checklist —
         that is an incomplete notice, not a publishable one. */
      if (!notice || !Array.isArray(notice.fieldCheck) || notice.fieldCheck.some((field) => !field.present)) return "The solicitation notice is incomplete and cannot be published.";
      const floatBlock = floatPeriodBlockReason(cycle, notice.md, gate.decidedAt ?? new Date().toISOString());
      if (floatBlock) return floatBlock;
      return null;
    }
    case "sign_award_report": {
      if (!cycle) return null;
      if (cycle.matrix && cycle.matrix.status === "DRAFT")
        return "The evaluation matrix is still a DRAFT — certify it (or replace it) before the award report is signed.";
      const legality = awardLegalityReason(cycle, gate.tenderId);
      if (legality) return legality;
      const method = methodControlReason(cycle);
      if (method) return method;
      const assurance = supplierAssuranceReason(cycle);
      if (assurance) return assurance;
      return null;
    }
    case "publish_award_notice": {
      if (!cycle?.awardReport?.signedAt) return "The award report has not been signed — the accounting officer must sign it before the notice is published.";
      const staged = stagedPublicationReason(gate);
      if (staged) return staged;
      const legality = awardLegalityReason(cycle, gate.tenderId);
      if (legality) return legality;
      const method = methodControlReason(cycle);
      if (method) return method;
      const assurance = supplierAssuranceReason(cycle);
      if (assurance) return assurance;
      const input = inputs as { dispatchedTo?: string[]; dispatchEvidenceRef?: string };
      const expected = (cycle.matrix?.bids ?? []).map((bid) => bid.bidder).sort((a, b) => a.localeCompare(b));
      if (!input.dispatchEvidenceRef?.trim() || JSON.stringify([...(input.dispatchedTo ?? [])].sort()) !== JSON.stringify(expected)) {
        return "The award notice needs a delivery evidence reference and a recipient entry for every bidder.";
      }
      return null;
    }
    case "resolve_alb": {
      const input = inputs as { dossierId?: string; outcome?: string; note?: string };
      const dossier = cycle?.alb.find((entry) => entry.id === input.dossierId);
      if (!dossier) return "The ALB dossier is missing from this tender.";
      if (!dossier.response && !dossier.noResponseRecordedAt) return "The bidder response or the expired-deadline no-response record is missing.";
      if (dossier.noResponseRecordedAt && input.outcome === "JUSTIFIED") return "A bidder with no response on record cannot be marked JUSTIFIED.";
      if (str(input.note).trim().length < 12) return "Record the committee's reasoned assessment before resolving the ALB dossier.";
      return null;
    }
    case "approve_procurement_method": {
      if (!cycle?.methodId) return "No procurement method is recorded — set the method before it can be approved.";
      const input = inputs as { methodId?: string; justification?: string; approvalRef?: string; value?: unknown; currency?: unknown };
      if (input.methodId && input.methodId !== cycle.methodId) {
        return "The method changed after this gate was raised — raise a fresh method gate for the method now on record.";
      }
      const justification = (input.justification ?? cycle.methodJustification ?? "").trim();
      if (justification.length < 20) {
        return "The method gate needs the stated justification (at least 20 characters) — a gate without reasons is a rubber stamp.";
      }
      /* The value staged at the gate is the record the officer is signing;
         only fall back to the live estimate when the gate carries none. */
      const staged = typeof input.value === "number" ? input.value : undefined;
      const live = awardValue(cycle);
      const authority = methodAuthorityBlockReason({
        methodId: cycle.methodId,
        approvalRef: input.approvalRef ?? cycle.methodApprovalRef,
        ...(staged !== undefined ? { value: staged } : live.value !== undefined ? { value: live.value } : {}),
        ...(typeof input.currency === "string" ? { currency: input.currency } : live.currency ? { currency: live.currency } : {}),
        jurisdictionId: state.jurisdictionId,
      });
      if (authority) return authority;
      return null;
    }
    case "issue_debrief": {
      if (!cycle?.awardNotice?.publishedAt) return "The notice of award has not been published — debrief letters follow publication.";
      return null;
    }
    case "sign_contract_pack": {
      const authority = contractAuthorityReason();
      if (authority) return authority;
      const publication = awardPublicationReason(cycle);
      if (publication) return publication;
      const standstillBlock = standstillBlockReason(cycle);
      if (standstillBlock) return standstillBlock;
      if (!cycle?.awardReport?.signedAt) return "The award report has not been signed — the contract pack follows the award.";
      const legality = awardLegalityReason(cycle, gate.tenderId);
      if (legality) return legality;
      const method = methodControlReason(cycle);
      if (method) return method;
      const assurance = supplierAssuranceReason(cycle);
      if (assurance) return assurance;
      const suspension = complaintSuspensionReason(cycle);
      if (suspension) return suspension;
      /* A contract without a value is not a contract. The pack carries the
         winning bid's value; refuse to sign if it does not. */
      const contractValue = contractValueCheck((inputs as { value?: unknown }).value);
      if (!contractValue.ok) return contractValue.reason;
      if (state.features.paymentCaps) {
        const lineId = (inputs as { budgetLineId?: string }).budgetLineId;
        if (!lineId) return "A contract commits budget — select a budget line before the pack is signed.";
        const line = state.budgetLines.find((l) => l.id === lineId && (l.workspaceId ?? "demo") === currentWorkspaceId());
        if (!line) return "The selected budget line is not on the register — choose a live line before the pack is signed.";
        const commitBlock = commitmentBlockReason(line, contractValue.value);
        const override = (inputs as { budgetOverride?: { reason?: string; secondedBy?: string } }).budgetOverride;
        if (commitBlock) {
          if (!override?.reason?.trim() || !override?.secondedBy?.trim()) return commitBlock;
          if (override.secondedBy.trim().toLowerCase() === approver.trim().toLowerCase()) {
            return `${commitBlock} The second approver must be a different officer.`;
          }
        }
      }
      return null;
    }
    case "certify_payment": {
      const authority = contractAuthorityReason();
      if (authority) return authority;
      if (!cycle?.contract) return "No contract is open on this tender — payments certify against an open contract.";
      const suspension = complaintSuspensionReason(cycle);
      if (suspension) return suspension;
      if (state.features.paymentCaps) {
        const paymentId = (inputs as { paymentId?: string }).paymentId;
        const payment = cycle.contract.payments.find((p) => p.id === paymentId);
        const block = paymentBlockReason({ contract: cycle.contract, payment });
        if (block) return block;
      }
      return null;
    }
    case "execute_contract": {
      const authority = contractAuthorityReason();
      if (authority) return authority;
      if (!cycle?.contract) return "No contract is on record — sign the contract pack before executing it.";
      const suspension = complaintSuspensionReason(cycle);
      if (suspension) return suspension;
      const legality = awardLegalityReason(cycle, gate.tenderId);
      if (legality) return legality;
      const method = methodControlReason(cycle);
      if (method) return method;
      const assurance = supplierAssuranceReason(cycle, cycle.contract.supplier);
      if (assurance) return assurance;
      if (state.features.contractExecution) {
        const execution = executionBlockReason(contractAtExecution(cycle.contract, gate));
        if (execution) return execution;
      }
      return null;
    }
    case "approve_variation": {
      if (!cycle?.contract) return "No contract is open on this tender — there is nothing to vary.";
      if (state.features.paymentCaps) {
        const variationId = (inputs as { variationId?: string }).variationId;
        const variation = cycle.contract.variations.find((v) => v.id === variationId);
        if (!variation) return "The variation this gate refers to is not on the contract register.";
        const block = variationBlockReason({
          contract: cycle.contract,
          valueDelta: variation.valueDelta,
          excludeVariationId: variation.id,
        });
        if (block) return block;
        if (!variation.legalAdviceRef?.trim() || !variation.approvalReference?.trim()) return "The variation needs an Attorney-General legal advice reference and an approval reference.";
      }
      return null;
    }
    case "lift_standstill": {
      if (!cycle?.standstill) return "No standstill is running on this tender.";
      if (!standstillApplies(cycle)) return "This procurement method is exempt from the section 71 standstill clock.";
      if (Date.now() < new Date(cycle.standstill.endsAt).getTime()) return `The standstill cannot be marked lapsed before ${cycle.standstill.endsAt}.`;
      if ((cycle.complaints ?? []).some((complaint) => complaint.status === "OPEN" || complaint.status === "ESCALATED")) return "An open or escalated complaint keeps the award suspended after the standstill period.";
      return null;
    }
    case "record_contract_completion": {
      if (!cycle?.contract) return "No contract is open on this tender — there is nothing to complete.";
      if (state.features.paymentCaps) {
        const block = completionBlockReason(cycle.contract, inputs);
        if (block) return block;
      }
      return null;
    }
    case "respond_complaint": {
      const id = (inputs as { complaintId?: string }).complaintId;
      const complaint = cycle?.complaints.find((c) => c.id === id);
      if (!complaint) return "The complaint this response belongs to is not open on this tender.";
      if (complaint.status !== "OPEN") return `The complaint is already ${complaint.status}.`;
      return null;
    }
    default:
      return null;
  }
}

/* ── Gate executors — the thing that happens ONLY after a named human signs ── */

export async function executeCycleGateAction(gate: Gate): Promise<Record<string, unknown> | undefined> {
  /* Exceptions resolve through the register, not the cycle — a standalone
     exception (no tender) must not mint an empty TenderCycle row. */
  if (gate.tool === "approve_exception") {
    return executeExceptionApproval(gate);
  }
  if (gate.tool === "submit_quarterly_report") {
    const blocked = quarterlyReportBlockReason(gate);
    if (blocked) throw new Error(blocked);
    const input = gate.inputs as { reportId?: string; digest?: string };
    const report = state.quarterlyReports.find((row) => row.id === input.reportId && row.workspaceId === (gate.workspaceId ?? "demo"));
    if (!report) throw new Error("the quarterly report is missing from the record");
    const submittedAt = gate.decidedAt ?? new Date().toISOString();
    for (const entry of report.entries) {
      const cycle = state.cycle.find((row) => row.tenderId === entry.tenderId && (row.workspaceId ?? "demo") === report.workspaceId);
      if (!cycle) continue;
      if (entry.type === "VARIATION") {
        const variation = cycle.contract?.variations.find((row) => row.id === entry.reference);
        if (variation) {
          variation.quarterlyReportRef = report.submissionReference;
          variation.reportedAt = submittedAt;
        }
      } else if (cycle.awardNotice?.sha === entry.reference) {
        cycle.awardNotice.quarterlyReportRef = report.submissionReference;
        cycle.awardNotice.reportedAt = submittedAt;
      }
    }
    report.status = "SUBMITTED";
    report.submittedAt = submittedAt;
    report.submittedBy = gate.approver ?? "accounting officer";
    saveState();
    return { reportId: report.id, year: report.year, quarter: report.quarter, entryCount: report.entries.length, digest: report.digest, submittedAt };
  }
  const cycle = cycleFor(gate.tenderId);
  const who = gate.approver ?? "named human";
  switch (gate.tool) {
    case "record_bid_opening": {
      if (cycle.opening) {
        cycle.opening.certifiedAt = gate.decidedAt;
        cycle.opening.certifiedBy = who;
        cycle.opening.sha = shaOf({
          rows: cycle.opening.rows,
          reconciliation: cycle.opening.reconciliation ?? null,
          certifiedBy: who,
          certifiedAt: gate.decidedAt,
        });
        saveState();
        return { registerId: cycle.opening.id, sha: cycle.opening.sha, admitted: cycle.opening.rows.filter((r) => !r.late).length };
      }
      return undefined;
    }
    case "record_financial_adjustments": {
      const input = gate.inputs as { matrixId?: string; digest?: string };
      if (!cycle.matrix || cycle.matrix.id !== input.matrixId) throw new Error("the evaluation matrix changed after the financial adjustments were staged");
      const digest = shaOf(cycle.matrix.bids.map((bid) => ({ bidder: bid.bidder, adjustments: bid.financial?.adjustments ?? null })));
      if (!input.digest || digest !== input.digest || digest !== cycle.matrix.financialAdjustmentsDigest) throw new Error("the financial adjustment digest no longer matches the staged record");
      cycle.matrix.financialAdjustmentsCertifiedAt = gate.decidedAt ?? new Date().toISOString();
      cycle.matrix.financialAdjustmentsCertifiedBy = who;
      saveState();
      return { matrixId: cycle.matrix.id, digest, certifiedAt: cycle.matrix.financialAdjustmentsCertifiedAt };
    }
    case "certify_evaluation": {
      if (!cycle.matrix) return undefined;
      const albBlock = openAlbBlockReason(cycle);
      if (albBlock) throw new Error(albBlock);
      if (state.features.evaluationIntegrity) {
        const block = evaluationBlockReason({
          matrix: cycle.matrix,
          coi: cycle.coi,
          suppliers: state.suppliers,
          divergencePoints: state.guards.scoreDivergencePoints,
          fxStalenessDays: state.guards.fxStalenessDays,
        });
        if (block) throw new Error(block);
        /* The technical column is drawn from the consensus, never from a
           single officer's last edit. MED adjustments are a committee act and
           are re-applied on top. */
        const agreed = cycle.matrix.consensus?.scores ?? [];
        cycle.matrix.bids = cycle.matrix.bids.map((bid) => ({
          ...bid,
          technicalScores: bid.technicalScores.map((score) => {
            const consensus = agreed.find(
              (entry) => entry.bidder.toLowerCase() === bid.bidder.toLowerCase() && entry.criterionId === score.criterionId,
            );
            return consensus ? { ...score, score: consensus.score } : score;
          }),
        }));
        cycle.matrix = scoreMatrix(cycle.matrix);
        if (cycle.matrix.med) cycle.matrix = applyMedAdjustments(cycle.matrix, cycle.matrix.med.adjustments);
      }
      const cdfBlock = cdfReservationBlockReason(cycle);
      if (cdfBlock) throw new Error(cdfBlock);
      cycle.matrix.status = "CERTIFIED";
      cycle.matrix.certifiedAt = gate.decidedAt;
      cycle.matrix.certifiedBy = who;
      saveState();
      return { matrixId: cycle.matrix.id, status: "CERTIFIED", recommended: rankedBidder(cycle.matrix) };
    }
    case "resolve_alb": {
      const input = gate.inputs as { dossierId?: string; outcome?: string; note?: string };
      const dossier = cycle.alb.find((a) => a.id === input.dossierId);
      if (!dossier) return undefined;
      if (!dossier.response && !dossier.noResponseRecordedAt) throw new Error("the bidder response or expired-deadline no-response record is missing");
      if (dossier.noResponseRecordedAt && input.outcome === "JUSTIFIED") throw new Error("a bidder with no response on record cannot be marked JUSTIFIED");
      const outcome = input.outcome === "REJECTED" || input.outcome === "WITHDRAWN" ? input.outcome : "JUSTIFIED";
      dossier.resolution = {
        outcome,
        note: input.note ?? "",
        at: gate.decidedAt ?? new Date().toISOString(),
        by: who,
        gateId: gate.id,
      };
      if (cycle.matrix) {
        const bidder = cycle.matrix.bids.find((row) => row.bidder.toLowerCase() === dossier.bidder.toLowerCase());
        if (bidder) {
          bidder.albOpen = false;
          const openReason = "abnormally low bid clarification is open";
          bidder.reasons = (bidder.reasons ?? []).filter((reason) => reason !== openReason);
          if (outcome !== "JUSTIFIED") {
            bidder.responsiveness = "MATERIALLY_NONRESPONSIVE";
            const reason = outcome === "REJECTED"
              ? "abnormally low pricing was not justified by the bidder"
              : "bidder withdrew after the abnormally low bid clarification request";
            bidder.reasons = [...new Set([...bidder.reasons, reason])];
          }
          cycle.matrix = scoreMatrix(cycle.matrix);
        }
      }
      saveState();
      return { dossierId: dossier.id, outcome: dossier.resolution.outcome };
    }
    case "sign_award_report": {
      if (!cycle.awardReport) return undefined;
      const legality = awardLegalityReason(cycle, gate.tenderId);
      if (legality) throw new Error(legality);
      const method = methodControlReason(cycle);
      if (method) throw new Error(method);
      const assurance = supplierAssuranceReason(cycle);
      if (assurance) throw new Error(assurance);
      cycle.awardReport.signedAt = gate.decidedAt;
      cycle.awardReport.signedBy = who;
      saveState();
      return { sha: cycle.awardReport.sha, recommendation: cycle.awardReport.recommendation };
    }
    case "publish_award_notice": {
      if (!cycle.awardNotice) return undefined;
      const staged = stagedPublicationReason(gate);
      if (staged) throw new Error(staged);
      const legality = awardLegalityReason(cycle, gate.tenderId);
      if (legality) throw new Error(legality);
      const method = methodControlReason(cycle);
      if (method) throw new Error(method);
      const assurance = supplierAssuranceReason(cycle);
      if (assurance) throw new Error(assurance);
      const gateInputs = gate.inputs as { dispatchedTo?: string[]; dispatchEvidenceRef?: string };
      const expectedRecipients = (cycle.matrix?.bids ?? []).map((bid) => bid.bidder).sort((a, b) => a.localeCompare(b));
      if (!gateInputs.dispatchEvidenceRef?.trim() || JSON.stringify([...(gateInputs.dispatchedTo ?? [])].sort()) !== JSON.stringify(expectedRecipients)) {
        throw new Error("the award publication lacks the complete bidder dispatch list and delivery evidence reference");
      }
      const startsAt = gate.decidedAt ?? new Date().toISOString();
      cycle.awardNotice.publishedAt = startsAt;
      cycle.awardNotice.publishedBy = who;
      cycle.awardNotice.publication = { ...state.deployment.publication, portal: cycle.awardNotice.portal };
      cycle.awardNotice.dispatchedTo = expectedRecipients;
      cycle.awardNotice.dispatchedAt = startsAt;
      cycle.awardNotice.dispatchEvidenceRef = gateInputs.dispatchEvidenceRef.trim().slice(0, 240);
      if (standstillApplies(cycle)) {
        const clock = jurisdictionPack(state.jurisdictionId);
        cycle.standstill = {
          tenderId: gate.tenderId,
          startsAt,
          endsAt: addWorkingDaysIn(startsAt, clock.standstillDays, clock),
          days: clock.standstillDays,
          status: "ACTIVE",
        };
      } else {
        cycle.awardNotice.standstillExemptReason = `${cycle.methodId}${cycle.methodJustification ? ` — ${cycle.methodJustification}` : ""}`;
      }
      saveState();
      return {
        portal: cycle.awardNotice.portal,
        publicationMode: cycle.awardNotice.publication?.mode ?? "SIMULATED",
        standstillEndsAt: cycle.standstill?.endsAt,
        dispatchedTo: expectedRecipients,
        dispatchEvidenceRef: cycle.awardNotice.dispatchEvidenceRef,
      };
    }
    case "lift_standstill": {
      if (!cycle.standstill) return undefined;
      const reason = standstillBlockReason(cycle);
      if (reason) throw new Error(reason);
      cycle.standstill.status = "LAPSED";
      cycle.standstill.liftedAt = gate.decidedAt ?? new Date().toISOString();
      cycle.standstill.liftedBy = who;
      saveState();
      return { status: "LAPSED", standstillEndsAt: cycle.standstill.endsAt };
    }
    case "issue_debrief": {
      const input = gate.inputs as { debriefId?: string };
      const letter = cycle.debriefs.find((d) => d.id === input.debriefId);
      if (!letter) return undefined;
      letter.status = "ISSUED";
      letter.issuedAt = gate.decidedAt;
      letter.issuedBy = who;
      saveState();
      return { debriefId: letter.id, bidder: letter.bidder };
    }
    case "sign_contract_pack": {
      const authority = contractAuthorityReason();
      if (authority) throw new Error(authority);
      const publication = awardPublicationReason(cycle);
      if (publication) throw new Error(publication);
      const standstillBlock = standstillBlockReason(cycle);
      if (standstillBlock) throw new Error(standstillBlock);
      const suspension = complaintSuspensionReason(cycle);
      if (suspension) throw new Error(suspension);
      const legality = awardLegalityReason(cycle, gate.tenderId);
      if (legality) throw new Error(legality);
      const method = methodControlReason(cycle);
      if (method) throw new Error(method);
      const assurance = supplierAssuranceReason(cycle);
      if (assurance) throw new Error(assurance);
      if (cycle.contract) {
        throw new Error(`A contract is already on the register for ${gate.tenderId} — one tender, one contract. Complete or cancel the open instrument first.`);
      }
      const input = gate.inputs as {
        supplier?: string;
        value?: unknown;
        currency?: string;
        packMd?: string;
        budgetLineId?: string;
        budgetOverride?: { reason?: string; secondedBy?: string };
        retentionPct?: number;
        warrantyDays?: number;
        conditions?: { text?: string }[];
        performanceSecurity?: { amount?: number; issuer?: string; validUntil?: string; documentId?: string };
        insurance?: { policyNo?: string; issuer?: string; validUntil?: string; cover?: string };
        subcontractors?: { name?: string; scope?: string }[];
      };
      const contractValue = contractValueCheck(input.value);
      if (!contractValue.ok) throw new Error(contractValue.reason);
      const line = state.budgetLines.find((l) => l.id === input.budgetLineId && (l.workspaceId ?? "demo") === currentWorkspaceId());
      if (state.features.paymentCaps && !line) {
        throw new Error("A contract commits budget — the gate is not attached to a live budget line. Select one before signing.");
      }
      if (line) {
        const commitBlock = commitmentBlockReason(line, contractValue.value);
        if (commitBlock) {
          const override = input.budgetOverride;
          if (!override?.reason?.trim() || !override?.secondedBy?.trim()) throw new Error(commitBlock);
          if (override.secondedBy.trim().toLowerCase() === who.trim().toLowerCase()) {
            throw new Error(`${commitBlock} The second approver must be a different officer.`);
          }
        }
      }
      const retentionPct = typeof input.retentionPct === "number" && input.retentionPct >= 0 && input.retentionPct <= 100
        ? input.retentionPct
        : undefined;
      cycle.contract = {
        tenderId: gate.tenderId,
        supplier: input.supplier ?? "—",
        value: contractValue.value,
        originalValue: contractValue.value,
        currency: input.currency,
        openedAt: gate.decidedAt ?? new Date().toISOString(),
        openedFromGate: gate.id,
        packMd: input.packMd,
        status: "DRAFT",
        ...(retentionPct !== undefined ? { retentionPct } : {}),
        ...(typeof input.warrantyDays === "number" && input.warrantyDays >= 0 ? { warrantyDays: input.warrantyDays } : {}),
        ...(Array.isArray(input.conditions)
          ? { conditions: input.conditions.filter((c) => c.text?.trim()).slice(0, 20).map((c, i) => ({ id: `cond_${i + 1}`, text: String(c.text).trim().slice(0, 300) })) }
          : {}),
        ...(input.performanceSecurity?.amount !== undefined && input.performanceSecurity.amount > 0
          ? {
              security: {
                amount: roundMoney(input.performanceSecurity.amount),
                issuer: String(input.performanceSecurity.issuer ?? "").trim().slice(0, 160),
                validUntil: String(input.performanceSecurity.validUntil ?? ""),
                ...(input.performanceSecurity.documentId ? { documentId: String(input.performanceSecurity.documentId).slice(0, 120) } : {}),
              },
            }
          : {}),
        ...(input.insurance?.policyNo?.trim()
          ? {
              insurance: {
                policyNo: String(input.insurance.policyNo).trim().slice(0, 120),
                issuer: String(input.insurance.issuer ?? "").trim().slice(0, 160),
                validUntil: String(input.insurance.validUntil ?? ""),
                ...(input.insurance.cover ? { cover: String(input.insurance.cover).slice(0, 240) } : {}),
              },
            }
          : {}),
        ...(Array.isArray(input.subcontractors)
          ? { subcontractors: input.subcontractors.filter((s) => s.name?.trim()).slice(0, 20).map((s) => ({ name: String(s.name).trim().slice(0, 160), scope: String(s.scope ?? "").trim().slice(0, 240) })) }
          : {}),
        milestones: [],
        variations: [],
        payments: [],
        performanceSecurity: [],
      };
      if (line) {
        const commitment: Commitment = {
          id: `cmt_${randomUUID().slice(0, 8)}`,
          workspaceId: gate.workspaceId ?? "demo",
          tenderId: gate.tenderId,
          budgetLineId: line.id,
          amount: contractValue.value,
          ...(cycle.contract.currency ? { currency: cycle.contract.currency } : {}),
          createdAt: gate.decidedAt ?? new Date().toISOString(),
          createdBy: who,
        };
        state.commitments.push(commitment);
        line.committed = roundMoney(line.committed + contractValue.value);
        line.updatedAt = new Date().toISOString();
      }
      saveState();
      return { supplier: cycle.contract.supplier, value: cycle.contract.value, status: "DRAFT" };
    }
    case "execute_contract": {
      const authority = contractAuthorityReason();
      if (authority) throw new Error(authority);
      if (!cycle.contract) return undefined;
      const suspension = complaintSuspensionReason(cycle);
      if (suspension) throw new Error(suspension);
      const legality = awardLegalityReason(cycle, gate.tenderId);
      if (legality) throw new Error(legality);
      const method = methodControlReason(cycle);
      if (method) throw new Error(method);
      const assurance = supplierAssuranceReason(cycle, cycle.contract.supplier);
      if (assurance) throw new Error(assurance);
      const execution = executionBlockReason(contractAtExecution(cycle.contract, gate));
      if (execution) throw new Error(execution);
      Object.assign(cycle.contract, contractAtExecution(cycle.contract, gate));
      cycle.contract.status = "EXECUTED";
      cycle.contract.executedAt = gate.decidedAt ?? new Date().toISOString();
      cycle.contract.executedBy = who;
      saveState();
      return { supplier: cycle.contract.supplier, status: "EXECUTED", executedAt: cycle.contract.executedAt };
    }
    case "approve_variation": {
      const input = gate.inputs as { variationId?: string };
      const variation = cycle.contract?.variations.find((v) => v.id === input.variationId);
      if (!variation) return undefined;
      const block = variationBlockReason({ contract: cycle.contract, valueDelta: variation.valueDelta, excludeVariationId: variation.id });
      if (block) throw new Error(block);
      if (!variation.approvalReference?.trim() || (state.jurisdictionId === "ZM" && !variation.legalAdviceRef?.trim())) {
        throw new Error("the required approval and Attorney-General legal advice references are missing");
      }
      const cumulative = cumulativeVariationPct(cycle.contract!, variation.valueDelta, variation.id);
      variation.status = "APPROVED";
      variation.decidedBy = who;
      variation.approvedAt = gate.decidedAt;
      variation.cumulativePct = cumulative;
      cycle.contract!.value = roundMoney(cycle.contract!.value + variation.valueDelta);
      cycle.contract!.value = Math.max(0, cycle.contract!.value);
      saveState();
      return { variationId: variation.id, pct: variation.pctOfContract, cumulativePct: cumulative, value: cycle.contract!.value };
    }
    case "certify_payment": {
      const authority = contractAuthorityReason();
      if (authority) throw new Error(authority);
      if (!cycle.contract) return undefined;
      const suspension = complaintSuspensionReason(cycle);
      if (suspension) throw new Error(suspension);
      const input = gate.inputs as { paymentId?: string };
      const payment = cycle.contract.payments.find((p) => p.id === input.paymentId);
      if (!payment) return undefined;
      if (state.features.paymentCaps) {
        const block = paymentBlockReason({ contract: cycle.contract, payment });
        if (block) throw new Error(block);
      }
      payment.certifiedAt = gate.decidedAt;
      payment.certifiedBy = who;
      payment.status = "CERTIFIED";
      const net = paymentNet(payment);
      const commitment = state.commitments.find((c) => c.tenderId === gate.tenderId && !c.releasedAt);
      if (commitment) {
        const line = state.budgetLines.find((l) => l.id === commitment.budgetLineId && (l.workspaceId ?? "demo") === currentWorkspaceId());
        if (line) {
          line.spent = roundMoney(line.spent + net);
          line.updatedAt = new Date().toISOString();
        }
      }
      saveState();
      return { paymentId: payment.id, amount: payment.amount, net };
    }
    case "record_contract_completion": {
      if (!cycle.contract) return undefined;
      const input = gate.inputs as { certificateId?: string; defectsLiabilityEndsAt?: string; performanceRating?: number; note?: string };
      if (state.features.paymentCaps) {
        const block = completionBlockReason(cycle.contract, input);
        if (block) throw new Error(block);
      }
      if (!input.certificateId?.trim()) throw new Error("Completion needs a completion certificate on record.");
      cycle.contract.completedAt = gate.decidedAt;
      cycle.contract.completedBy = who;
      cycle.contract.status = "COMPLETED";
      cycle.contract.completion = {
        certificateId: input.certificateId.trim().slice(0, 160),
        defectsLiabilityEndsAt: String(input.defectsLiabilityEndsAt ?? ""),
        performanceRating: Number(input.performanceRating),
        ...(input.note ? { note: input.note.slice(0, 400) } : {}),
        at: gate.decidedAt ?? new Date().toISOString(),
        by: who,
      };
      appendLog({
        actor: who,
        server: "quorum-mcp",
        tool: "supplier_performance_review",
        kind: "WRITES",
        runId: "cycle",
        inputs: { tenderId: gate.tenderId, supplier: cycle.contract.supplier, rating: cycle.contract.completion.performanceRating },
        outputs: { task: "DEBARMENT_AND_PERFORMANCE_REVIEW", status: "QUEUED" },
        status: "OK",
        durationMs: 0,
      });
      const commitment = state.commitments.find((c) => c.tenderId === gate.tenderId && !c.releasedAt);
      if (commitment) {
        const line = state.budgetLines.find((l) => l.id === commitment.budgetLineId && (l.workspaceId ?? "demo") === currentWorkspaceId());
        if (line) {
          const spent = roundMoney(cycle.contract.payments.reduce((sum, p) => sum + paymentNet(p), 0));
          const release = Math.max(0, roundMoney(commitment.amount - spent));
          line.committed = Math.max(0, roundMoney(line.committed - release));
          line.updatedAt = new Date().toISOString();
        }
        commitment.releasedAt = gate.decidedAt ?? new Date().toISOString();
        commitment.releasedBy = who;
      }
      saveState();
      return { completedAt: cycle.contract.completedAt, certificateId: cycle.contract.completion.certificateId };
    }
    case "approve_procurement_method": {
      if (!cycle.methodId) return undefined;
      const input = gate.inputs as { methodId?: string; justification?: string; approvalRef?: string; value?: unknown; currency?: unknown };
      if (input.methodId && input.methodId !== cycle.methodId) {
        throw new Error("The method changed after this gate was raised — raise a fresh method gate for the method now on record.");
      }
      const justification = (input.justification ?? cycle.methodJustification ?? "").trim();
      if (justification.length < 20) throw new Error("The method gate needs the stated justification (at least 20 characters).");
      const staged = typeof input.value === "number" ? input.value : undefined;
      const live = awardValue(cycle);
      const authority = methodAuthorityBlockReason({
        methodId: cycle.methodId,
        approvalRef: input.approvalRef ?? cycle.methodApprovalRef,
        ...(staged !== undefined ? { value: staged } : live.value !== undefined ? { value: live.value } : {}),
        ...(typeof input.currency === "string" ? { currency: input.currency } : live.currency ? { currency: live.currency } : {}),
        jurisdictionId: state.jurisdictionId,
      });
      if (authority) throw new Error(authority);
      cycle.methodJustification = justification;
      if (input.approvalRef) cycle.methodApprovalRef = input.approvalRef.trim().slice(0, 200);
      cycle.methodApprovedBy = who;
      cycle.methodApprovedAt = gate.decidedAt ?? new Date().toISOString();
      saveState();
      appendLog({
        actor: who,
        server: "quorum-mcp",
        tool: "approve_procurement_method",
        kind: "GATE_DECISION",
        runId: "cycle",
        inputs: { tenderId: gate.tenderId, methodId: cycle.methodId },
        outputs: { approvedAt: cycle.methodApprovedAt, approvalRef: cycle.methodApprovalRef ?? null },
        status: "OK",
        durationMs: 0,
      });
      return { methodId: cycle.methodId, approvedBy: who, approvedAt: cycle.methodApprovedAt };
    }
    case "respond_complaint": {
      const input = gate.inputs as { complaintId?: string; response?: string };
      const complaint = cycle.complaints.find((c) => c.id === input.complaintId);
      if (!complaint) return undefined;
      complaint.response = { md: input.response ?? "", at: gate.decidedAt ?? new Date().toISOString(), by: who, gateId: gate.id };
      complaint.status = "ANSWERED";
      complaint.acknowledgedAt = gate.decidedAt ?? new Date().toISOString();
      saveState();
      return { complaintId: complaint.id, status: "ANSWERED" };
    }
    case "publish_notice": {
      const input = gate.inputs as { noticeId?: string };
      const notice = cycle.notices.find((n) => n.id === input.noticeId);
      if (!notice) return undefined;
      const pipeline = state.pipeline.find((entry) => entry.linkedTenderId === gate.tenderId && (entry.workspaceId ?? "demo") === currentWorkspaceId());
      if (!pipeline?.requisition?.budgetValidated || !pipeline.requisition.budgetReference) throw new Error("validated requisition and budget reference are required before solicitation publication");
      const floatBlock = floatPeriodBlockReason(cycle, notice.md, gate.decidedAt ?? new Date().toISOString());
      if (floatBlock) throw new Error(floatBlock);
      notice.issuedAt = gate.decidedAt;
      notice.issuedBy = who;
      saveState();
      return { noticeId: notice.id, published: true, portal: publicationLabel() };
    }
    default:
      return undefined;
  }
}

/* Rejections need their own bookkeeping for tools whose refusal is itself a
   record (the exception register keeps the REFUSED row with the decider). */
export function executeCycleGateRejection(gate: Gate): Record<string, unknown> | undefined {
  switch (gate.tool) {
    case "approve_exception":
      return executeExceptionRejection(gate);
    default:
      return undefined;
  }
}

function rankedBidder(matrix: EvalMatrix): string | undefined {
  return [...matrix.bids]
    .filter((b) => b.responsiveness === "RESPONSIVE" && !b.albOpen)
    .sort((a, b) => (b.total ?? 0) - (a.total ?? 0))[0]?.bidder;
}

function openAlbBlockReason(cycle: TenderCycle): string | null {
  /* A record written before dossiers existed holds no list — an unreadable
     field must not turn a gate into a crash. */
  const open = (cycle.alb ?? []).filter((dossier) => !dossier.resolution);
  if (!open.length) return null;
  const bidders = [...new Set(open.map((dossier) => dossier.bidder))];
  return `Resolve the open five-working-day ALB dossier${bidders.length === 1 ? "" : "s"} for ${bidders.join(", ")} before the evaluation matrix can be certified.`;
}

function cdfReservationBlockReason(cycle: TenderCycle): string | null {
  const matrix = cycle.matrix;
  if (!matrix || matrix.preferenceScheme !== "CDF_RESERVATION") return null;
  const winnerName = rankedBidder(matrix);
  if (!winnerName) return null;
  const winner = matrix.bids.find((bid) => bid.bidder === winnerName);
  const adjustment = winner?.financial?.adjustments;
  if (!adjustment?.reservationCitizenSupplier) return "The recommended CDF supplier is not recorded as a citizen supplier.";
  if (adjustment.reservationEligible) return null;
  if (!matrix.cdfReservationExceptionRef || adjustment.reservationExceptionRef !== matrix.cdfReservationExceptionRef) {
    return "An outside-constituency CDF supplier needs the locality exception evidence published in the solicitation.";
  }
  const localResponsive = matrix.bids.some((bid) =>
    bid.responsiveness === "RESPONSIVE" &&
    bid.financial?.adjustments?.reservationCitizenSupplier === true &&
    bid.financial.adjustments.reservationEligible === true,
  );
  if (localResponsive) {
    return "A responsive citizen bidder domiciled in the funded constituency is on the record; the statutory locality exception cannot be used to recommend an outside supplier.";
  }
  return null;
}

/* ── Cores — shared by the REST routes and the MCP tool calls ──────────────── */

async function coreRecordBidOpening(tenderId: string, bids: OpenBidInput[]) {
  if (!SAFE_REF.test(tenderId)) throw new Error(`invalid tenderId: "${tenderId}"`);
  const cycle = cycleFor(tenderId);
  if (cycle.opening?.certifiedAt) throw new Error(`the opening register for ${tenderId} is already certified — a certified register is not re-opened`);
  const applications = state.applications.filter((a) => a.tenderId === tenderId);
  const sealed = applications.filter((a) => a.status === "RECEIVED" && a.sealed);
  if ((!Array.isArray(bids) || bids.length === 0) && sealed.length === 0) {
    throw new Error("at least one bid row or sealed portal application is required to open");
  }
  if (bids.length + sealed.length > 20) throw new Error("at most 20 bids per opening register");
  const closing = await closingOnRecord(tenderId, cycle);
  const { rows: manualRows, lateCount } = buildOpeningRows(bids, closing);
  const sealedInputs: OpenBidInput[] = sealed.map((application) => {
    const payload = revealBid(application.sealed!);
    return {
      bidder: application.orgName,
      source: "SEALED PORTAL",
      receivedAt: application.receivedAt,
      priceRead: formatPriceRead(payload),
    };
  });
  const { rows: sealedBaseRows } = buildOpeningRows(sealedInputs, closing);
  const sealedRows = sealedBaseRows.map((row, i) => ({
    ...row,
    applicationId: sealed[i].id,
    receiptId: sealed[i].receiptId ?? sealed[i].sealed?.receipt.id,
    commitment: sealed[i].sealed?.commitment,
    sealed: true as const,
  }));
  /* A bidder cannot exist twice on one opening register — one sealed filing
     and one paper row for the same organization is a reconciliation failure. */
  const seen = new Set<string>();
  for (const row of [...manualRows, ...sealedRows]) {
    const key = row.bidder.trim().toLowerCase();
    if (!key) throw new Error("every bid row needs a bidder name");
    if (seen.has(key)) throw new Error(`bidder "${row.bidder}" appears twice — one bid per bidder per opening`);
    seen.add(key);
  }
  const rows = [...manualRows, ...sealedRows];
  const reconciliation = reconcileOpening(applications, rows);
  if (sealed.length && !reconciliation.matches) {
    throw new Error(`Opening reconciliation refused: ${reconciliation.note}`);
  }
  const openedAt = new Date().toISOString();
  const register: BidOpeningRegister = {
    id: `open_${Math.random().toString(36).slice(2, 8)}`,
    tenderId,
    createdAt: openedAt,
    ...(closing ? { closingDate: closing } : {}),
    rows,
    reconciliation,
    minutesMd: composeOpeningMinutes({ tenderId, closingDate: closing, rows, openedAt }),
  };
  cycle.opening = register;
  const gate = raiseCycleGate({
    tenderId,
    tool: "record_bid_opening",
    requiredOffice: "PROCUREMENT_UNIT",
    inputs: {
      registerId: register.id,
      bids: rows.length,
      late: lateCount + (rows.filter((r) => r.late && r.sealed).length),
      sealed: sealed.length,
      reconciliation: {
        matches: reconciliation.matches,
        missing: reconciliation.missingFromRegister,
        extra: reconciliation.extraInRegister,
      },
    },
    note: "Certify the public bid opening register",
  });
  register.gateId = gate.id;
  appendLog({
    actor: "quorum-agent",
    server: "quorum-mcp",
    tool: "record_bid_opening",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, bids: rows.length, sealed: sealed.length, closingDate: closing ?? "not on record" },
    outputs: {
      registerId: register.id,
      admitted: rows.filter((r) => !r.late).length,
      late: rows.filter((r) => r.late).length,
      reconciliation: reconciliation.note,
    },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { register, gate: gate.id, lateCount: rows.filter((r) => r.late).length, reconciliation };
}

function evaluationScoringStarted(matrix: EvalMatrix): boolean {
  if (matrix.scoringStartedAt || (matrix.sheets ?? []).length > 0) return true;
  return matrix.bids.some((bid) => bid.technicalScores.some((score) =>
    score.score !== 0 && matrix.med?.adjustments?.[`${bid.bidder}|${score.criterionId}`] === undefined,
  ));
}

const PREFERENCE_MARGINS: Record<string, number> = {
  LOCAL_SUPPLIER: 5,
  CITIZEN_SUPPLIER: 7,
  CITIZEN_WOMAN_OWNED: 9,
  CITIZEN_YOUTH_OWNED: 9,
  CITIZEN_PWD_OWNED: 10,
  CITIZEN_SMALL_TURNOVER: 8,
  CITIZEN_LOCAL_JV: 6,
  LOCAL_CONTENT_CITIZEN: 15,
  LOCAL_CONTENT_CITIZEN_LOCAL_JV: 12,
  LOCAL_CONTENT_LOCAL: 10,
};

function coreRecordFinancialAdjustments(
  tenderId: string,
  rowsRaw: Record<string, unknown>[],
  actorId: string,
  roster: RosterMemberForGate[] | null,
) {
  const cycle = state.cycle.find((entry) => entry.tenderId === tenderId);
  const matrix = cycle?.matrix;
  if (!cycle || !matrix) throw new Error(`no evaluation matrix on record for "${tenderId}"`);
  if (matrix.status === "CERTIFIED") throw new Error("the matrix is CERTIFIED — financial adjustments are sealed");
  if (evaluationScoringStarted(matrix)) throw new Error("financial adjustments are locked after scoring starts");
  if (matrix.financialAdjustmentsCertifiedAt) throw new Error("financial adjustments have already been certified and cannot be replaced");
  const member = roster?.find((entry) => entry.status === "PRESENT" && entry.office === "PROCUREMENT_UNIT" && (entry.userId ?? entry.id) === actorId);
  if (!actorId || !member) throw new Error("financial adjustments must be recorded by a signed-in PRESENT procurement-unit member");
  if (rowsRaw.length !== matrix.bids.length) throw new Error(`record one financial adjustment row for each of the ${matrix.bids.length} bidders`);
  const rows = new Map<string, Record<string, unknown>>();
  for (const raw of rowsRaw) {
    const bidder = str(raw.bidder).trim();
    const key = bidder.toLowerCase();
    if (!matrix.bids.some((bid) => bid.bidder.toLowerCase() === key)) throw new Error(`"${bidder}" is not on the evaluation matrix`);
    if (rows.has(key)) throw new Error(`financial adjustments repeat bidder "${bidder}"`);
    if (!str(raw.evidenceRef).trim()) throw new Error(`${bidder}: add the bid page or documentary evidence reference supporting the price check`);
    const arithmeticCorrection = Number(raw.arithmeticCorrection ?? 0);
    const unconditionalDiscount = Number(raw.unconditionalDiscount ?? 0);
    const otherAdjustment = Number(raw.otherAdjustment ?? 0);
    if (![arithmeticCorrection, unconditionalDiscount, otherAdjustment].every(Number.isFinite) || unconditionalDiscount < 0) {
      throw new Error(`${bidder}: corrections and adjustments must be finite; discount cannot be negative`);
    }
    const preferenceCode = str(raw.preferenceScheme).trim().toUpperCase();
    let preferencePct = 0;
    if (matrix.preferenceScheme === "SI45-2025") {
      if (preferenceCode && !Object.hasOwn(PREFERENCE_MARGINS, preferenceCode)) throw new Error(`${bidder}: unsupported SI 45/2025 preference category "${preferenceCode}"`);
      if (preferenceCode === "LOCAL_SUPPLIER" && !matrix.foreignBiddersPermitted) throw new Error(`${bidder}: the local-supplier 5% preference applies only when foreign bidders were permitted`);
      preferencePct = PREFERENCE_MARGINS[preferenceCode] ?? 0;
      if (preferenceCode.startsWith("LOCAL_CONTENT_")) {
        const localContentPct = Number(raw.localContentPct);
        if (!Number.isFinite(localContentPct) || localContentPct < 35 || localContentPct > 100) {
          throw new Error(`${bidder}: the published local-content preference requires verified local content of at least 35%`);
        }
      }
    } else if (matrix.preferenceScheme !== "CDF_RESERVATION" && matrix.preferenceScheme !== "None") {
      throw new Error(`the published preference scheme "${matrix.preferenceScheme}" is not supported; redraft the solicitation with a supported scheme`);
    } else if (preferenceCode) {
      throw new Error(`${bidder}: a preference margin was claimed but the published solicitation has no SI 45/2025 preference scheme`);
    }
    if (matrix.preferenceScheme === "CDF_RESERVATION" &&
        (typeof raw.reservationEligible !== "boolean" || typeof raw.reservationCitizenSupplier !== "boolean")) {
      throw new Error(`${bidder}: record whether the bidder is a citizen supplier and whether it is domiciled in the funded constituency`);
    }
    const cdfCitizen = matrix.preferenceScheme === "CDF_RESERVATION" && raw.reservationCitizenSupplier === true;
    const cdfLocal = matrix.preferenceScheme === "CDF_RESERVATION" && raw.reservationEligible === true;
    const cdfOutsideException = matrix.preferenceScheme === "CDF_RESERVATION" &&
      !cdfLocal && cdfCitizen && !!matrix.cdfReservationExceptionRef;
    rows.set(key, {
      bidder,
      arithmeticCorrection,
      unconditionalDiscount,
      otherAdjustment,
      preferencePct,
      ...(preferenceCode ? { preferenceScheme: preferenceCode } : {}),
      ...(preferenceCode.startsWith("LOCAL_CONTENT_") ? { localContentPct: Number(raw.localContentPct) } : {}),
      ...(matrix.preferenceScheme === "CDF_RESERVATION" ? {
        reservationEligible: cdfLocal,
        reservationCitizenSupplier: cdfCitizen,
        ...(cdfOutsideException ? { reservationExceptionRef: matrix.cdfReservationExceptionRef } : {}),
      } : {}),
      evidenceRef: str(raw.evidenceRef).trim().slice(0, 240),
      verifiedBy: actorId,
      verifiedAt: new Date().toISOString(),
    });
  }
  matrix.bids = matrix.bids.map((bid) => {
    const adjustment = rows.get(bid.bidder.toLowerCase());
    if (!adjustment) throw new Error(`${bid.bidder}: financial adjustment row is missing`);
    const previous = bid.financial;
    if (!previous?.amount || previous.amount <= 0) {
      bid.responsiveness = "MATERIALLY_NONRESPONSIVE";
      bid.reasons = [...new Set([...bid.reasons, "bid price is missing or invalid"])]
    }
    const cdfCitizen = adjustment.reservationCitizenSupplier === true;
    const cdfLocal = adjustment.reservationEligible === true;
    const cdfOutsidePermitted = !!matrix.cdfReservationExceptionRef && cdfCitizen && adjustment.reservationExceptionRef === matrix.cdfReservationExceptionRef;
    if (matrix.preferenceScheme === "CDF_RESERVATION" && (!cdfCitizen || (!cdfLocal && !cdfOutsidePermitted))) {
      bid.responsiveness = "ADMINISTRATIVELY_NONRESPONSIVE";
      bid.reasons = [...new Set([...bid.reasons, "bidder is not a citizen supplier eligible under the published CDF constituency reservation or its documented locality exception"])]
    }
    return {
      ...bid,
      financial: {
        ...(previous ?? { amount: 0 }),
        adjustments: adjustment as NonNullable<NonNullable<EvalMatrix["bids"][number]["financial"]>["adjustments"]>,
      },
    };
  });
  const digest = shaOf(matrix.bids.map((bid) => ({ bidder: bid.bidder, adjustments: bid.financial?.adjustments ?? null })));
  matrix.financialAdjustmentsDigest = digest;
  const scoredMatrix = scoreMatrix(matrix);
  cycle.matrix = scoredMatrix;
  const gate = raiseCycleGate({
    tenderId,
    tool: "record_financial_adjustments",
    requiredOffice: "PROCUREMENT_UNIT",
    inputs: { matrixId: scoredMatrix.id, digest, bidders: scoredMatrix.bids.length, submittedBy: actorId },
    note: "Certify the arithmetic corrections, discounts, evaluated-price adjustments and published preference claims",
  });
  scoredMatrix.financialAdjustmentsGateId = gate.id;
  saveState();
  return { matrix: scoredMatrix, gate: gate.id };
}

function scoringBasisBlockReason(matrix: EvalMatrix): string | null {
  if (!matrix.evaluationCurrency?.trim()) return "Set an evaluation currency before scoring the bids.";
  const fxBlock = fxBlockReason(matrix, state.guards.fxStalenessDays);
  if (fxBlock) return `Set a sourced, current FX basis before scoring: ${fxBlock}`;
  if (!matrix.med) return "Record the MED adjustment and its basis before any evaluator scores a bid.";
  return null;
}

async function coreBuildMatrix(tenderId: string, criteriaRaw: { title: unknown; weight: unknown }[], techWeightRaw: unknown) {
  if (!SAFE_REF.test(tenderId)) throw new Error(`invalid tenderId: "${tenderId}"`);
  const { pack } = await loadPack(tenderId);
  if (pack.bids.length === 0) throw new Error(`no bids staged for tender "${tenderId}" — stage the pack first`);
  const cycle = cycleFor(tenderId);
  if (cycle.matrix) throw new Error(`an evaluation matrix already exists for ${tenderId}; its published basis is immutable and it cannot be replaced`);
  if (!cycle.opening?.certifiedAt) throw new Error("a certified bid opening register is required before evaluation can begin");
  if (cycle.opening.reconciliation && !cycle.opening.reconciliation.matches) throw new Error("the opening register does not reconcile with received bids; resolve the discrepancy before evaluation");
  const openingNames = cycle.opening.rows.map((row) => row.bidder.trim().toLowerCase());
  const stagedNames = pack.bids.map((bid) => bid.bidder.trim().toLowerCase());
  if (new Set(openingNames).size !== openingNames.length || new Set(stagedNames).size !== stagedNames.length ||
      openingNames.length !== stagedNames.length || openingNames.some((name) => !stagedNames.includes(name))) {
    throw new Error("the certified opening register and staged bid pack must contain exactly the same bidder set");
  }
  const sourceNotice = [...(cycle.notices ?? [])].reverse().find((notice) => !!notice.issuedAt);
  if (!sourceNotice) throw new Error("publish the tender notice, including its evaluation criteria, before building the matrix");
  const criteria = parseEvaluationCriteria(sourceNotice.md).map((criterion) => ({
    ...criterion,
    weight: Math.round(criterion.weight * 10) / 10,
  }));
  const criteriaError = validateCriteria(criteria);
  if (criteriaError) throw new Error(`the published notice has invalid evaluation criteria: ${criteriaError}`);
  const submittedCriteria = (Array.isArray(criteriaRaw) ? criteriaRaw : []).slice(0, 12);
  const criteriaMatch = submittedCriteria.length === criteria.length && criteria.every((criterion, index) => {
    const submitted = submittedCriteria[index];
    return str(submitted?.title).trim().toLowerCase() === criterion.title.toLowerCase() &&
      Math.abs(Number(submitted?.weight) - criterion.weight) <= 0.0001;
  });
  if (!criteriaMatch) throw new Error("the evaluation matrix must use the criteria and weights published in the issued tender notice");
  const split = sourceNotice.md.match(/^\*\*Technical\/financial split:\*\*\s*(\d+)\/(\d+)\s*$/m);
  if (!split || Number(split[1]) + Number(split[2]) !== 100) throw new Error("the issued notice has no valid technical/financial weighting split");
  const techWeight = Number(split[1]);
  const requestedWeight = Number(techWeightRaw);
  if (Number.isFinite(requestedWeight) && requestedWeight !== techWeight) throw new Error("the matrix weighting is fixed by the issued notice and cannot be changed during evaluation");
  const financialFormula = sourceNotice.md.match(/^\*\*Financial formula:\*\*\s*(.+)$/m)?.[1]?.trim();
  if (financialFormula !== DEFAULT_FINANCIAL_FORMULA) throw new Error("the issued notice states a financial formula this engine does not implement; use the supported published lowest-evaluated-price formula");
  const preferenceScheme = sourceNotice.md.match(/^\*\*Preference\/reservation scheme:\*\*\s*(.+)$/m)?.[1]?.trim() ?? "None";
  const cdfReservationConstituency = sourceNotice.md.match(/^\*\*CDF funded constituency:\*\*\s*(.+)$/m)?.[1]?.trim();
  const cdfReservationExceptionRef = sourceNotice.md.match(/^\*\*CDF locality exception evidence:\*\*\s*(.+)$/m)?.[1]?.trim();
  const cdfReservationExceptionBasis = sourceNotice.md.match(/^\*\*CDF locality exception basis:\*\*\s*(.+)$/m)?.[1]?.trim();
  if (preferenceScheme === "CDF_RESERVATION" && (!cdfReservationConstituency || cdfReservationConstituency.length < 3)) {
    throw new Error("the issued CDF reservation notice must name its funded constituency");
  }
  if (cdfReservationExceptionRef && (preferenceScheme !== "CDF_RESERVATION" || !cdfReservationExceptionBasis || cdfReservationExceptionBasis.length < 20)) {
    throw new Error("the published CDF locality exception is incomplete or is attached to a different preference scheme");
  }
  const foreignBiddersPermitted = /^\*\*Foreign bidders permitted:\*\*\s*Yes$/m.test(sourceNotice.md);
  const evaluationCurrency = normalizeCurrency(sourceNotice.md.match(/^\*\*Evaluation currency:\*\*\s*([A-Z]{3})$/m)?.[1]);
  if (!evaluationCurrency) throw new Error("the issued notice has no valid evaluation currency");
  const run = state.runs.find((r) => r.tenderId === tenderId);
  const lateBy = new Map<string, boolean>(cycle.opening.rows.map((r) => [r.bidder.toLowerCase(), r.late]));

  const bids: EvalMatrix["bids"] = pack.bids.map((raw) => {
    /* The pack carries OCDS values; markdown bids state theirs on the value line —
       the same deep parse flagPack runs, so the matrix's financial column reads
       exactly what the review rules read. */
    const b = raw.value === undefined ? (() => { const v = parseMarkdownBidValue(raw.text); return v ? { ...raw, value: v.amount, currency: v.currency } : raw; })() : raw;
    if (!lateBy.has(b.bidder.toLowerCase())) throw new Error(`bidder "${b.bidder}" is missing from the certified opening register`);
    const highDocMissing = !!run?.findings.some(
      (f) => f.rule === "R-DOC-MISSING" && f.severity === "HIGH" && f.item.toLowerCase().startsWith(b.bidder.toLowerCase()),
    );
    const debarred = !!run?.findings.some((f) => f.rule === "R-DEBARMENT-HIT" && f.item.toLowerCase() === b.bidder.toLowerCase());
    const secFindings = bidSecurityFindings([b], cycle.closingDate);
    const missingSecurity = secFindings.some((f) => f.evidence.includes("states no security line") || f.evidence.includes("states nothing"));
    const ladder = responsivenessLadder({ late: lateBy.get(b.bidder.toLowerCase()) ?? false, missingSecurity, highDocMissing, debarred });
    return {
      bidder: b.bidder,
      source: b.source,
      late: lateBy.get(b.bidder.toLowerCase()) ?? false,
      responsiveness: ladder.responsiveness,
      reasons: ladder.reasons,
      technicalScores: criteria.map((c) => ({ criterionId: c.id, score: 0 })),
      evidenceByCriterion: criteria.map((criterion) => ({
        criterionId: criterion.id,
        evidence: criterionEvidenceSuggestions(b.text, b.source, criterion.title, b.ref).map((item) => ({ ...item, decision: "SUGGESTED" as const })),
      })),
      priceSignals: [] as EvalPriceSignal[],
      technicalTotal: 0,
      financial: b.value !== undefined ? { amount: b.value, ...(b.currency ? { currency: b.currency } : {}) } : undefined,
      verdict: "NOT_RECOMMENDED" as const,
    };
  });
  const marketSignals = evaluatePackSignals(pack.bids.map((raw) => {
    const parsedValue = raw.value === undefined ? parseMarkdownBidValue(raw.text) : undefined;
    return {
      ...raw,
      ...(parsedValue ? { value: parsedValue.amount, currency: parsedValue.currency } : {}),
    };
  }));
  for (const row of bids) {
    row.priceSignals = marketSignals.prices.filter((signal) => signal.bidder.toLowerCase() === row.bidder.toLowerCase());
  }
  /* One evaluated-price basis from the start: a single bid currency is its
     own basis, a mixed pack is measured in the jurisdiction's currency and
     needs a sourced quote for every foreign bid before certification. */
  const bidCurrencies = [
    ...new Set(bids.map((bid) => bid.financial?.currency?.toUpperCase()).filter((currency): currency is string => !!currency)),
  ];
  const matrix: EvalMatrix = {
    id: `mtx_${Math.random().toString(36).slice(2, 8)}`,
    tenderId,
    criteriaNoticeId: sourceNotice.id,
    marketSignals,
    ...(run ? { runId: run.id } : {}),
    criteria,
    technicalWeightPct: techWeight,
    financialFormula,
    preferenceScheme,
    foreignBiddersPermitted,
    ...(preferenceScheme === "CDF_RESERVATION" && cdfReservationConstituency ? { cdfReservationConstituency } : {}),
    ...(preferenceScheme === "CDF_RESERVATION" && cdfReservationExceptionRef ? { cdfReservationExceptionRef } : {}),
    bids,
    evaluationCurrency,
    status: "DRAFT",
    createdAt: new Date().toISOString(),
  };
  cycle.matrix = scoreMatrix(matrix);
  appendLog({
    actor: "quorum-agent",
    server: "quorum-mcp",
    tool: "build_evaluation_matrix",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, criteria: criteria.length, technicalWeightPct: techWeight, bids: bids.length },
    outputs: { matrixId: matrix.id, weightsSum: weightsSum(criteria) },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { matrix: cycle.matrix };
}

function coreScoreMatrix(tenderId: string, bidder: string, scores: { criterionId: string; score: number; note?: string; evidenceDecision?: "CONFIRMED" | "REJECTED" }[], actor = "web-app") {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (!cycle?.matrix) throw new Error(`no evaluation matrix on record for "${tenderId}" — build one first`);
  if (cycle.matrix.status === "CERTIFIED") throw new Error("the matrix is CERTIFIED — its scores are sealed; record a MED session instead");
  if (!cycle.matrix.financialAdjustmentsCertifiedAt) throw new Error("the procurement unit must certify arithmetic corrections, discounts and preference eligibility before technical scoring starts");
  const basisBlock = scoringBasisBlockReason(cycle.matrix);
  if (basisBlock) throw new Error(basisBlock);
  const row = cycle.matrix.bids.find((b) => b.bidder.toLowerCase() === bidder.trim().toLowerCase());
  if (!row) throw new Error(`bidder "${bidder}" is not on the matrix`);
  const err = validateScores(cycle.matrix.criteria, scores);
  if (err) throw new Error(err);
  row.technicalScores = scores.map((s) => {
    const suggested = row.evidenceByCriterion?.find((item) => item.criterionId === s.criterionId)?.evidence ?? [];
    const previous = row.technicalScores.find((item) => item.criterionId === s.criterionId)?.evidence ?? [];
    const decision = s.evidenceDecision;
    const evidence = decision
      ? (suggested.length ? suggested : previous).map((item) => ({
          ...item,
          decision,
          decidedBy: actor.slice(0, 80),
          decidedAt: new Date().toISOString(),
        }))
      : previous;
    return {
      criterionId: s.criterionId,
      score: Math.round(Number(s.score) * 10) / 10,
      ...(s.note ? { note: str(s.note).slice(0, 200) } : {}),
      ...(evidence.length ? { evidence } : {}),
    };
  });
  cycle.matrix.scoringStartedAt ??= new Date().toISOString();
  /* A direct edit moves the technical column away from the sheets, so any
     recorded consensus no longer describes the matrix. Certification draws
     the column from the consensus, and a fresh one is required after this. */
  const consensusCleared = !!cycle.matrix.consensus;
  cycle.matrix.consensus = undefined;
  cycle.matrix = scoreMatrix(cycle.matrix);
  appendLog({
    actor: actor.slice(0, 80),
    server: "quorum-mcp",
    tool: "score_matrix",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, bidder, evidenceDecisions: scores.filter((score) => score.evidenceDecision).length },
    outputs: { technicalTotal: row.technicalTotal, total: row.total, ...(consensusCleared ? { consensusCleared: true } : {}) },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { matrix: cycle.matrix };
}

function coreMed(tenderId: string, attendees: string[], adjustments: Record<string, number>, notes?: string) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (!cycle?.matrix) throw new Error(`no evaluation matrix on record for "${tenderId}"`);
  if (cycle.matrix.status === "CERTIFIED") throw new Error("the matrix is CERTIFIED — a MED session precedes certification");
  if (!cycle.matrix.financialAdjustmentsCertifiedAt) throw new Error("certify financial adjustments before recording the MED session");
  if (evaluationScoringStarted(cycle.matrix)) throw new Error("the FX basis and MED adjustment are locked after scoring starts — record them before any evaluator scores");
  const cleanAttendees = (Array.isArray(attendees) ? attendees : []).map((attendee) => str(attendee).trim().slice(0, 80)).filter(Boolean).slice(0, 12);
  if (!cleanAttendees.length) throw new Error("at least one named attendee is required for a MED session");
  const cleanNotes = str(notes).trim();
  if (cleanNotes.length < 12) throw new Error("record the margin-of-error basis or state why no adjustment is required (at least 12 characters)");
  const clean: Record<string, number> = {};
  for (const [key, value] of Object.entries(adjustments ?? {}).slice(0, 144)) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`adjustment "${key}" must be a score 0-100`);
    const [bidder, criterionId] = key.split("|");
    if (!bidder || !criterionId) throw new Error(`adjustment key "${key}" must be "<bidder>|<criterionId>"`);
    if (!cycle.matrix.bids.some((row) => row.bidder.toLowerCase() === bidder.trim().toLowerCase())) {
      throw new Error(`adjustment key "${key}" names a bidder that is not on the matrix`);
    }
    if (!cycle.matrix.criteria.some((criterion) => criterion.id === criterionId)) {
      throw new Error(`adjustment key "${key}" names a criterion that is not on the matrix`);
    }
    clean[key] = Math.round(n * 10) / 10;
  }
  cycle.matrix.med = {
    recordedAt: new Date().toISOString(),
    attendees: cleanAttendees,
    adjustments: clean,
    notes: cleanNotes.slice(0, 400),
  };
  const med = cycle.matrix.med;
  cycle.matrix = applyMedAdjustments(cycle.matrix, clean);
  appendLog({
    actor: "web-app",
    server: "quorum-mcp",
    tool: "record_med",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, attendees: med.attendees.length, adjustments: Object.keys(clean).length },
    outputs: { matrixId: cycle.matrix.id },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { matrix: cycle.matrix };
}

/* ── WS7 — evaluator sheets, consensus and the FX basis ─────────────────── */

function coreRecordSheet(
  tenderId: string,
  evaluatorRaw: string,
  scoresRaw: { bidder: unknown; criterionId: unknown; score: unknown; note?: unknown }[],
  noteRaw: unknown,
  actor: string,
  actorId: string,
  roster: RosterMemberForGate[] | null,
) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (!cycle?.matrix) throw new Error(`no evaluation matrix on record for "${tenderId}" — build one first`);
  if (cycle.matrix.status === "CERTIFIED") throw new Error("the matrix is CERTIFIED — its scores are sealed");
  if (!cycle.matrix.financialAdjustmentsCertifiedAt) throw new Error("the procurement unit must certify financial adjustments before evaluator sheets are submitted");
  const basisBlock = scoringBasisBlockReason(cycle.matrix);
  if (basisBlock) throw new Error(basisBlock);
  const member = roster?.find((entry) => entry.status === "PRESENT" && entry.office === "EVALUATION_COMMITTEE" && (entry.userId ?? entry.id) === actorId);
  if (!actorId || !member) throw new Error("the signed-in account is not linked to a PRESENT evaluation-committee seat");
  const evaluator = member.name.trim().slice(0, 120);
  const requestedEvaluator = str(evaluatorRaw).trim();
  if (requestedEvaluator && requestedEvaluator.toLowerCase() !== evaluator.toLowerCase()) throw new Error("the submitted evaluator name does not match the signed-in committee account");
  const declaration = cycle.coi.find((entry) => entry.memberId === member.id && entry.signedByUserId === actorId);
  if (!declaration) {
    throw new Error(`${evaluator} has no conflict-of-interest declaration on this tender — every evaluator declares before scoring.`);
  }
  if (declaration.declaration === "CONFLICT_DECLARED" || declaration.recused === true) {
    throw new Error(`${evaluator} declared a conflict or is recused from this tender — a conflicted evaluator cannot submit a score sheet.`);
  }
  const screening = conflictScreening([declaration], cycle.matrix.bids.map((bid) => bid.bidder), state.suppliers);
  if (screening.length) {
    const hit = screening[0];
    throw new Error(
      `${evaluator} is screened against ${hit.bidder} through ${hit.entity} (${hit.matchedName}) — amend the declaration and recuse before scoring.`,
    );
  }
  const scores = scoresRaw.map((raw) => ({
    bidder: str(raw.bidder).trim().slice(0, 160),
    criterionId: str(raw.criterionId).trim(),
    score: Math.round(Number(raw.score) * 10) / 10,
    ...(str(raw.note) ? { note: str(raw.note).slice(0, 200) } : {}),
  }));
  const invalid = sheetValidationError(cycle.matrix, scores);
  if (invalid) throw new Error(invalid);

  const prior = (cycle.matrix.sheets ?? []).find(
    (sheet) => sheet.evaluator.trim().toLowerCase() === evaluator.toLowerCase(),
  );
  const submittedAt = new Date().toISOString();
  const version = (prior?.version ?? 0) + 1;
  const digest = shaOf({ matrixId: cycle.matrix.id, evaluator, scores, submittedAt, version });
  const sheet: EvalScoreSheet = {
    id: `sheet_${randomUUID().slice(0, 8)}`,
    matrixId: cycle.matrix.id,
    tenderId,
    evaluator,
    evaluatorId: member.id,
    scores,
    ...(str(noteRaw) ? { note: str(noteRaw).slice(0, 400) } : {}),
    submittedBy: actor.slice(0, 120),
    submittedByUserId: actorId,
    submittedAt,
    version,
    ...(prior ? { supersedes: prior.id } : {}),
    signature: digest,
  };
  cycle.matrix.scoringStartedAt ??= submittedAt;
  cycle.matrix.sheets = [...(cycle.matrix.sheets ?? []).filter((entry) => entry.id !== prior?.id), sheet];
  /* New evidence moves the agreed scores: the committee has to meet again. */
  const consensusCleared = !!cycle.matrix.consensus;
  cycle.matrix.consensus = undefined;
  appendLog({
    actor: actor.slice(0, 80),
    server: "quorum-mcp",
    tool: "record_eval_sheet",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, evaluator, cells: scores.length, version },
    outputs: { sheetId: sheet.id, signature: sheet.signature, ...(consensusCleared ? { consensusCleared: true } : {}) },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { sheet, sheets: cycle.matrix.sheets.length };
}

function coreRecordConsensus(tenderId: string, attendeesRaw: string[], notesRaw: string, actor: string, actorId: string, roster: RosterMemberForGate[] | null) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (!cycle?.matrix) throw new Error(`no evaluation matrix on record for "${tenderId}"`);
  if (cycle.matrix.status === "CERTIFIED") throw new Error("the matrix is CERTIFIED — its consensus is sealed");
  const recorder = roster?.find((entry) => entry.status === "PRESENT" && entry.office === "EVALUATION_COMMITTEE" && (entry.userId ?? entry.id) === actorId);
  if (!actorId || !recorder) throw new Error("the signed-in account is not linked to a PRESENT evaluation-committee seat");
  const allowedNames = new Set((roster ?? []).filter((entry) => entry.status === "PRESENT" && entry.office === "EVALUATION_COMMITTEE").map((entry) => entry.name.trim().toLowerCase()));
  if (attendeesRaw.some((name) => !allowedNames.has(str(name).trim().toLowerCase()))) throw new Error("every consensus attendee must be a PRESENT evaluation-committee member on the roster");
  const error = consensusValidationError(
    cycle.matrix,
    attendeesRaw,
    notesRaw,
    state.guards.scoreDivergencePoints,
  );
  if (error) throw new Error(error);
  const sheets = cycle.matrix.sheets ?? [];
  const agreed = consensusScores(sheets);
  const attendees = [...new Set(attendeesRaw.map((name) => str(name).trim().slice(0, 120)).filter(Boolean))].slice(0, 12);
  const notes = str(notesRaw).trim().slice(0, 2_000);
  const recordedAt = new Date().toISOString();
  const consensus: EvalConsensus = {
    matrixId: cycle.matrix.id,
    scores: agreed,
    attendees,
    notes,
    divergences: computeDivergences(sheets).filter((cell) => cell.spread > state.guards.scoreDivergencePoints),
    recordedBy: recorder.name.slice(0, 120),
    recordedByUserId: actorId,
    recordedAt,
    signature: shaOf({ matrixId: cycle.matrix.id, scores: agreed, attendees, notes, recordedAt }),
  };
  /* Draw the technical column from the agreed scores, leaving every note and
     evidence decision untouched. */
  cycle.matrix.bids = cycle.matrix.bids.map((bid) => ({
    ...bid,
    technicalScores: bid.technicalScores.map((score) => {
      const agreedScore = agreed.find(
        (entry) => entry.bidder.toLowerCase() === bid.bidder.toLowerCase() && entry.criterionId === score.criterionId,
      );
      return agreedScore ? { ...score, score: agreedScore.score } : score;
    }),
  }));
  cycle.matrix.consensus = consensus;
  cycle.matrix = scoreMatrix(cycle.matrix);
  appendLog({
    actor: actor.slice(0, 80),
    server: "quorum-mcp",
    tool: "record_eval_consensus",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, attendees: attendees.length, sheets: sheets.length },
    outputs: {
      matrixId: cycle.matrix.id,
      signature: consensus.signature,
      divergences: consensus.divergences.length,
      recommended: rankedBidder(cycle.matrix),
    },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { consensus, matrix: cycle.matrix };
}

function coreSetFx(tenderId: string, evaluationCurrencyRaw: unknown, ratesRaw: unknown) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (!cycle?.matrix) throw new Error(`no evaluation matrix on record for "${tenderId}"`);
  if (cycle.matrix.status === "CERTIFIED") throw new Error("the matrix is CERTIFIED — its evaluated-price basis is sealed");
  if (evaluationScoringStarted(cycle.matrix)) throw new Error("the FX basis is locked after scoring starts — set it before any evaluator scores");
  const evaluationCurrency = str(evaluationCurrencyRaw).toUpperCase();
  const rates: FxRate[] = normalizeFxRates(ratesRaw, evaluationCurrency);
  cycle.matrix.evaluationCurrency = evaluationCurrency;
  cycle.matrix.fxRates = rates;
  cycle.matrix = scoreMatrix(cycle.matrix);
  const warning = fxBlockReason(cycle.matrix, state.guards.fxStalenessDays);
  appendLog({
    actor: "web-app",
    server: "quorum-mcp",
    tool: "set_evaluation_fx",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, evaluationCurrency, rates: rates.map((rate) => rate.base) },
    outputs: { matrixId: cycle.matrix.id, warning: warning ? true : false },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { matrix: cycle.matrix, warning };
}

async function coreCertifyMatrix(tenderId: string) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (!cycle?.matrix) throw new Error(`no evaluation matrix on record for "${tenderId}"`);
  if (cycle.matrix.status === "CERTIFIED") throw new Error("the matrix is already certified");
  const albBlock = openAlbBlockReason(cycle);
  if (albBlock) throw new Error(albBlock);
  const gate = raiseCycleGate({
    tenderId,
    tool: "certify_evaluation",
    requiredOffice: "EVALUATION_COMMITTEE",
    inputs: { matrixId: cycle.matrix.id, bids: cycle.matrix.bids.length },
    note: "Certify the evaluation matrix and the MED record",
  });
  cycle.matrix.gateId = gate.id;
  saveState();
  return { gate: gate.id };
}

async function coreOpenAlb(tenderId: string, bidder: string, findingId?: string, basisRaw?: string) {
  if (!SAFE_REF.test(tenderId)) throw new Error(`invalid tenderId: "${tenderId}"`);
  const cycle = cycleFor(tenderId);
  if (cycle.matrix?.status === "CERTIFIED") throw new Error("an ALB dossier must be opened and resolved before the evaluation matrix is certified");
  const bidderName = bidder.trim().slice(0, 160);
  const bid = cycle.matrix?.bids.find((row) => row.bidder.trim().toLowerCase() === bidderName.toLowerCase());
  if (!bid) throw new Error(`"${bidderName || "(blank)"}" is not a bidder on this evaluation matrix`);
  const run = state.runs.find((r) => r.tenderId === tenderId);
  const finding = run?.findings.find((f) =>
    (findingId ? f.id === findingId : (f.rule === "R-PRICE-OUTLIER" || f.rule === "R-VALUE-OUTLIER")) &&
    f.item.toLowerCase().includes(bidderName.toLowerCase()),
  );
  if (findingId && !finding) throw new Error("the selected pricing finding does not belong to this bidder");
  const openingBasis = str(basisRaw).trim().slice(0, 800);
  if (openingBasis.length < 12 && !finding?.evidence)
    throw new Error("record the pricing evidence that warrants a five-working-day clarification request");
  if (cycle.alb.some((a) => a.bidder.toLowerCase() === bidderName.toLowerCase() && !a.resolution))
    throw new Error(`an ALB dossier is already open for ${bidderName}`);
  const clock = jurisdictionPack(state.jurisdictionId);
  const dueAt = addWorkingDaysIn(new Date().toISOString(), clock.albResponseDays, clock);
  const dossier: AlbDossier = {
    id: `alb_${Math.random().toString(36).slice(2, 8)}`,
    tenderId,
    bidder: bidderName,
    openingBasis: openingBasis || finding?.evidence || "Pricing flagged for committee review.",
    ...(finding ? { findingId: finding.id } : {}),
    openedAt: new Date().toISOString(),
    letterMd: composeAlbLetter({
      tenderId,
      bidder: bidderName,
      finding: openingBasis || finding?.evidence || "the bid's pricing sits outside the peer range the guards accept",
      dueAt,
    }),
    responseDueAt: dueAt,
  };
  cycle.alb.push(dossier);
  bid.albOpen = true;
  bid.reasons = [...new Set([...(bid.reasons ?? []), "abnormally low bid clarification is open"])];
  if (cycle.matrix) cycle.matrix = scoreMatrix(cycle.matrix);
  appendLog({
    actor: "quorum-agent",
    server: "quorum-mcp",
    tool: "open_alb_dossier",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, bidder: bidderName, findingId: finding?.id, basisLength: openingBasis.length },
    outputs: { dossierId: dossier.id, responseDueAt: dueAt },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { dossier, gate: undefined };
}

async function coreResolveAlb(tenderId: string, dossierId: string, outcome: string, note: string) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  const dossier = cycle?.alb.find((a) => a.id === dossierId);
  if (!dossier) throw new Error(`no ALB dossier "${dossierId}" on tender "${tenderId}"`);
  if (dossier.resolution) throw new Error("the dossier is already resolved");
  if (!["JUSTIFIED", "REJECTED", "WITHDRAWN"].includes(outcome)) throw new Error('outcome must be "JUSTIFIED", "REJECTED" or "WITHDRAWN"');
  if (!dossier.response && !dossier.noResponseRecordedAt) throw new Error("the bidder response must be recorded, or a no-response record entered after the five-working-day deadline");
  if (dossier.noResponseRecordedAt && outcome === "JUSTIFIED") throw new Error("a bidder with no response on record cannot be marked JUSTIFIED");
  if (str(note).trim().length < 12) throw new Error("record the committee's reasoned assessment of the bidder response (at least 12 characters)");
  const gate = raiseCycleGate({
    tenderId,
    tool: "resolve_alb",
    requiredOffice: "EVALUATION_COMMITTEE",
    inputs: { dossierId, outcome, note: note.slice(0, 300), responseEvidenceRef: dossier.response?.evidenceRef ?? "NO_RESPONSE_RECORDED" },
    note: "Record the abnormally-low-bid resolution",
  });
  return { gate: gate.id };
}

function coreRecordAlbResponse(tenderId: string, dossierId: string, actor: string, text: string, evidenceRef: string) {
  const cycle = state.cycle.find((entry) => entry.tenderId === tenderId);
  const dossier = cycle?.alb.find((entry) => entry.id === dossierId);
  if (!dossier) throw new Error(`no ALB dossier "${dossierId}" on this tender`);
  if (dossier.resolution) throw new Error("the ALB dossier is already resolved");
  if (dossier.response || dossier.noResponseRecordedAt) throw new Error("a response or no-response record already exists for this dossier");
  const organization = actor.startsWith("org:") ? actor.slice(4).trim() : "";
  if (!organization) throw new Error("only an authenticated supplier organization may submit an ALB response");
  if (!sameEntity(organization, dossier.bidder)) throw new Error("the signed-in supplier organization does not match the bidder named in this ALB dossier");
  const responseText = text.trim().slice(0, 8_000);
  const evidence = evidenceRef.trim().slice(0, 240);
  if (responseText.length < 20 || !evidence) throw new Error("the response needs a reasoned explanation and a supporting evidence reference");
  const receivedAt = new Date().toISOString();
  if (receivedAt > dossier.responseDueAt) throw new Error("the five-working-day response deadline has passed; the buyer must record the no-response outcome");
  dossier.response = {
    text: responseText,
    evidenceRef: evidence,
    receivedAt,
    submittedBy: actor.slice(0, 120),
    submittedByOrg: organization,
    receiptHash: shaOf({ tenderId, dossierId, organization, responseText, evidence, receivedAt }),
  };
  saveState();
  return { dossierId, receivedAt, receiptHash: dossier.response.receiptHash };
}

function coreRecordAlbNoResponse(tenderId: string, dossierId: string, actorId: string, actor: string, roster: RosterMemberForGate[] | null) {
  const cycle = state.cycle.find((entry) => entry.tenderId === tenderId);
  const dossier = cycle?.alb.find((entry) => entry.id === dossierId);
  if (!dossier) throw new Error(`no ALB dossier "${dossierId}" on this tender`);
  if (dossier.resolution || dossier.response || dossier.noResponseRecordedAt) throw new Error("this ALB dossier is already responded to, closed or has a no-response record");
  if (Date.now() <= new Date(dossier.responseDueAt).getTime()) throw new Error(`the bidder response deadline is ${dossier.responseDueAt}; record no response only after it expires`);
  const member = roster?.find((entry) => entry.status === "PRESENT" && entry.office === "EVALUATION_COMMITTEE" && (entry.userId ?? entry.id) === actorId);
  if (!actorId || !member) throw new Error("the signed-in account is not linked to a PRESENT evaluation-committee seat");
  dossier.noResponseRecordedAt = new Date().toISOString();
  dossier.noResponseRecordedBy = actor;
  saveState();
  return { dossierId, noResponseRecordedAt: dossier.noResponseRecordedAt, recordedBy: member.name };
}

async function coreAwardReport(tenderId: string) {
  if (!SAFE_REF.test(tenderId)) throw new Error(`invalid tenderId: "${tenderId}"`);
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (!cycle?.matrix || cycle.matrix.status !== "CERTIFIED")
    throw new Error(`the evaluation matrix for "${tenderId}" is not certified — build and certify it before the award report`);
  /* The method is validated before the report exists: a non-open route with
     no justification or no approval reference has no lawful award to draft. */
  const methodBlock = methodControlReason(cycle);
  if (methodBlock) throw new Error(methodBlock);
  const meta = await tenderMeta(tenderId);
  const run = state.runs.find((r) => r.tenderId === tenderId);
  const winner = rankedBidder(cycle.matrix);
  const winnerRow = cycle.matrix.bids.find((b) => b.bidder === winner);
  const { md, recommendation } = composeAwardReport({
    tenderId,
    ...(meta.title ? { title: meta.title } : {}),
    ...(meta.buyer ? { buyer: meta.buyer } : {}),
    matrix: cycle.matrix,
    findings: (run?.findings ?? []).map((f) => ({
      id: f.id,
      rule: f.rule,
      item: f.item,
      severity: f.severity,
      ...(f.disposition
        ? {
            disposition: {
              status: f.disposition.status,
              by: f.disposition.by,
              at: f.disposition.at,
              note: f.disposition.note,
              ...(f.disposition.secondedBy ? { secondedBy: f.disposition.secondedBy } : {}),
            },
          }
        : {}),
    })),
    complaints: cycle.complaints.map((c) => ({ complainant: c.complainant, subject: c.subject, status: c.status })),
    ...(cycle.methodId
      ? {
          method: `${findMethod(state.jurisdictionId, cycle.methodId)?.name ?? cycle.methodId}${
            cycle.methodJustification ? ` — ${cycle.methodJustification}` : ""
          }`,
        }
      : {}),
    ...(winnerRow?.financial ? { value: `${winnerRow.financial.currency ?? ""} ${Number(winnerRow.financial.correctedAmount ?? winnerRow.financial.amount).toLocaleString()}`.trim() } : {}),
  });
  cycle.awardReport = {
    tenderId,
    md,
    sha: shaOf(md),
    createdAt: new Date().toISOString(),
    ...(recommendation ? { recommendation } : {}),
  };
  const gate = raiseCycleGate({
    tenderId,
    tool: "sign_award_report",
    requiredOffice: "ACCOUNTING_OFFICER",
    inputs: { sha: cycle.awardReport.sha, recommendation: recommendation ?? "none" },
    note: "Sign the award recommendation report",
  });
  cycle.awardReport.gateId = gate.id;
  appendLog({
    actor: "quorum-agent",
    server: "quorum-mcp",
    tool: "draft_award_report",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId },
    outputs: { sha: cycle.awardReport.sha, recommendation: recommendation ?? "none" },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { awardReport: cycle.awardReport, gate: gate.id };
}

async function corePublishAwardNotice(tenderId: string, dispatchEvidenceRef: string) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (!cycle?.awardReport?.signedAt) throw new Error("the award report must be signed before the notice is drafted");
  const evidenceRef = dispatchEvidenceRef.trim();
  if (!evidenceRef) throw new Error("record the portal or messaging delivery evidence reference for dispatch to all bidders");
  const meta = await tenderMeta(tenderId);
  const winner = cycle.awardReport.recommendation;
  const winnerRow = cycle.matrix?.bids.find((bid) => bid.bidder === winner);
  const recipients = (cycle.matrix?.bids ?? []).map((bid) => bid.bidder).sort((a, b) => a.localeCompare(b));
  if (!recipients.length) throw new Error("the evaluation matrix has no bidder recipients for the award notice");
  const portal = publicationLabel();
  const publication = { ...state.deployment.publication, portal };
  const md = composeAwardNotice({
    tenderId,
    ...(meta.buyer ? { buyer: meta.buyer } : {}),
    ...(winner ? { supplier: winner } : {}),
    ...(winnerRow?.financial ? { value: `${winnerRow.financial.currency ?? cycle.matrix?.evaluationCurrency ?? ""} ${Number(winnerRow.financial.correctedAmount ?? winnerRow.financial.amount).toLocaleString()}`.trim() } : {}),
    portal,
    publicationMode: publication.mode,
    ...(standstillApplies(cycle) ? { standstillDays: jurisdictionPack(state.jurisdictionId).standstillDays } : {}),
    dispatchedTo: recipients,
    ...(publication.receiptId ? { receiptId: publication.receiptId } : {}),
  });
  cycle.awardNotice = { tenderId, md, sha: shaOf(md), portal, publication, dispatchedTo: recipients, dispatchEvidenceRef: evidenceRef };
  const gate = raiseCycleGate({
    tenderId,
    tool: "publish_award_notice",
    requiredOffice: "ACCOUNTING_OFFICER",
    inputs: { sha: cycle.awardNotice.sha, portal, publicationMode: publication.mode, dispatchedTo: recipients, dispatchEvidenceRef: evidenceRef },
    note: "Publish the notice of award — starts the standstill clock",
  });
  cycle.awardNotice.gateId = gate.id;
  return { gate: gate.id };
}

async function coreDraftDebrief(tenderId: string, bidder: string) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (!cycle?.matrix) throw new Error(`no evaluation matrix on record for "${tenderId}"`);
  const row = cycle.matrix.bids.find((b) => b.bidder.toLowerCase() === bidder.trim().toLowerCase());
  if (!row) throw new Error(`bidder "${bidder}" is not on the matrix`);
  if (row.verdict === "RECOMMENDED") throw new Error(`${bidder} is the recommended bidder — debriefs go to unsuccessful bidders`);
  const run = state.runs.find((r) => r.tenderId === tenderId);
  const theirFindings = (run?.findings ?? []).filter((f) => f.item.toLowerCase().includes(row.bidder.toLowerCase())).map((f) => `${f.rule}: ${f.item}`);
  const letter = {
    id: `dbr_${Math.random().toString(36).slice(2, 8)}`,
    tenderId,
    bidder: row.bidder,
    md: composeDebriefLetter({
      tenderId,
      bidder: row.bidder,
      responsiveness: row.responsiveness,
      reasons: row.reasons,
      theirFindings,
      winner: rankedBidder(cycle.matrix),
    }),
    status: "DRAFT" as const,
    createdAt: new Date().toISOString(),
  };
  cycle.debriefs.push(letter);
  appendLog({
    actor: "quorum-agent",
    server: "quorum-mcp",
    tool: "draft_debrief",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, bidder: row.bidder },
    outputs: { debriefId: letter.id },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { letter };
}

function coreIssueDebrief(tenderId: string, debriefId: string) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  const letter = cycle?.debriefs.find((d) => d.id === debriefId);
  if (!letter) throw new Error(`no debrief letter "${debriefId}" on tender "${tenderId}"`);
  if (letter.status === "ISSUED") throw new Error("the letter is already issued");
  const gate = raiseCycleGate({
    tenderId,
    tool: "issue_debrief",
    requiredOffice: "ACCOUNTING_OFFICER",
    inputs: { debriefId, bidder: letter.bidder },
    note: "Issue the debrief letter to the unsuccessful bidder",
  });
  return { gate: gate.id };
}

/* ── WS4 — disposition of a finding ──────────────────────────────────────── */

function coreDisposeFinding(
  tenderId: string,
  findingId: string,
  input: { status?: unknown; note?: unknown; evidence?: unknown; secondedBy?: unknown },
  by: string,
  byId?: string,
) {
  if (!SAFE_REF.test(tenderId)) throw new Error(`invalid tenderId: "${tenderId}"`);
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (cycle?.awardReport?.signedAt) {
    throw new Error("The award report is signed — a finding disposition cannot be changed after the signature. Re-open the award path explicitly if the decision must change.");
  }
  const run = state.runs.find((r) => r.tenderId === tenderId && r.findings.some((f) => f.id === findingId));
  const finding = run?.findings.find((f) => f.id === findingId);
  if (!finding) throw new Error(`no finding "${findingId}" on tender "${tenderId}"`);
  const reason = dispositionReason({
    status: input.status,
    note: input.note,
    by,
    ...(typeof input.secondedBy === "string" ? { secondedBy: input.secondedBy } : {}),
  });
  if (reason) throw new Error(reason);
  const status = input.status as "CLEARED" | "WAIVED" | "RE_CHECK";
  const secondedBy = typeof input.secondedBy === "string" ? input.secondedBy.trim().slice(0, 120) : undefined;
  finding.disposition = {
    status,
    by: by.trim().slice(0, 120),
    ...(byId ? { byId } : {}),
    at: new Date().toISOString(),
    note: String(input.note).trim().slice(0, 800),
    ...(typeof input.evidence === "string" && input.evidence.trim() ? { evidence: input.evidence.trim().slice(0, 400) } : {}),
    ...(status === "WAIVED" && secondedBy ? { secondedBy } : {}),
  };
  appendLog({
    actor: by || "web-app",
    server: "quorum-mcp",
    tool: "dispose_finding",
    kind: "WRITES",
    runId: run?.id ?? "cycle",
    inputs: { tenderId, findingId, status, note: finding.disposition.note },
    outputs: { disposition: status, secondedBy: secondedBy ?? null },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { finding: { id: finding.id, rule: finding.rule, severity: finding.severity, disposition: finding.disposition } };
}

/* ── WS5 — the contract instrument and its ledger ─────────────────────────── */

function coreBudgetLine(input: Record<string, unknown>) {
  const fiscalYear = Number(input.fiscalYear);
  const code = str(input.code).trim().slice(0, 60);
  const currency = str(input.currency).trim().toUpperCase().slice(0, 8) || "ZMW";
  const approved = Number(input.approved);
  if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) throw new Error("fiscalYear must be a four-digit year");
  if (!code) throw new Error("a budget line needs a code");
  if (!Number.isFinite(approved) || approved <= 0) throw new Error("approved must be a positive amount");
  const workspaceId = currentWorkspaceId();
  const existing = state.budgetLines.find(
    (l) => l.code.toLowerCase() === code.toLowerCase() && l.fiscalYear === fiscalYear && (l.workspaceId ?? "demo") === workspaceId,
  );
  if (existing) {
    existing.approved = roundMoney(approved);
    existing.currency = currency;
    existing.updatedAt = new Date().toISOString();
    saveState();
    return { line: existing, updated: true };
  }
  const line: BudgetLine = {
    id: `bud_${randomUUID().slice(0, 8)}`,
    workspaceId,
    fiscalYear,
    code,
    currency,
    approved: roundMoney(approved),
    committed: 0,
    spent: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.budgetLines.push(line);
  appendLog({
    actor: "web-app",
    server: "quorum-mcp",
    tool: "create_budget_line",
    kind: "WRITES",
    runId: "cycle",
    inputs: { fiscalYear, code, currency, approved },
    outputs: { budgetLineId: line.id },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { line, updated: false };
}

/** The supplier's signed acceptance — only the awarded organization may record it. */
function coreSupplierAcceptance(tenderId: string, actor: string, signatory: string, copyHash?: string) {
  if (!SAFE_REF.test(tenderId)) throw new Error(`invalid tenderId: "${tenderId}"`);
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (!cycle?.contract) throw new Error("no contract is on the record for this tender");
  if (cycle.contract.supplierAcceptedAt) throw new Error("the supplier has already accepted this contract");
  const organization = actor.startsWith("org:") ? actor.slice(4).trim() : "";
  if (!organization) throw new Error("only the awarded supplier organization can accept the contract.");
  if (organization.toLowerCase() !== cycle.contract.supplier.trim().toLowerCase()) {
    throw new Error(`this contract is awarded to ${cycle.contract.supplier} — a different organization cannot accept it.`);
  }
  if (!signatory.trim()) throw new Error("the accepting signatory must be named.");
  const at = new Date().toISOString();
  cycle.contract.supplierAcceptedAt = at;
  cycle.contract.supplierSignatory = signatory.trim().slice(0, 160);
  cycle.contract.acceptanceHash = shaOf({
    tenderId,
    supplier: cycle.contract.supplier,
    value: cycle.contract.value,
    signatory: signatory.trim(),
    copyHash: copyHash ?? null,
    at,
  });
  appendLog({
    actor,
    server: "quorum-mcp",
    tool: "supplier_contract_acceptance",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, signatory: signatory.trim() },
    outputs: { acceptanceHash: cycle.contract.acceptanceHash },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { supplierAcceptedAt: at, acceptanceHash: cycle.contract.acceptanceHash };
}

function coreExecuteContract(
  tenderId: string,
  input: {
    performanceSecurity?: { amount?: unknown; issuer?: unknown; validUntil?: unknown; documentId?: unknown };
    insurance?: { policyNo?: unknown; issuer?: unknown; validUntil?: unknown; cover?: unknown };
    retentionPct?: unknown;
    warrantyDays?: unknown;
  },
) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (!cycle?.contract) throw new Error(`no contract is on record for "${tenderId}"`);
  if (cycle.contract.status === "EXECUTED" || cycle.contract.status === "COMPLETED")
    throw new Error("the contract is already executed");
  const security = input.performanceSecurity;
  const insurance = input.insurance;
  const gateInputs = {
    ...(security && typeof security.amount === "number" && security.amount > 0
      ? {
          performanceSecurity: {
            amount: security.amount,
            issuer: str(security.issuer),
            validUntil: str(security.validUntil),
            ...(str(security.documentId) ? { documentId: str(security.documentId) } : {}),
          },
        }
      : {}),
    ...(insurance && str(insurance.policyNo).trim()
      ? {
          insurance: {
            policyNo: str(insurance.policyNo),
            issuer: str(insurance.issuer),
            validUntil: str(insurance.validUntil),
            ...(str(insurance.cover) ? { cover: str(insurance.cover) } : {}),
          },
        }
      : {}),
    ...(typeof input.retentionPct === "number" ? { retentionPct: input.retentionPct } : {}),
    ...(typeof input.warrantyDays === "number" ? { warrantyDays: input.warrantyDays } : {}),
  };
  const gate = raiseCycleGate({
    tenderId,
    tool: "execute_contract",
    requiredOffice: "ACCOUNTING_OFFICER",
    inputs: gateInputs,
    note: "Execute the contract — supplier acceptance, security and insurance verified",
  });
  return { gate: gate.id };
}

async function coreContractPack(tenderId: string, budgetLineId?: string, retentionPct?: number) {
  if (!SAFE_REF.test(tenderId)) throw new Error(`invalid tenderId: "${tenderId}"`);
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (cycle?.contract) throw new Error(`a contract is already on the register for ${tenderId} — one tender, one contract`);
  if (state.features.paymentCaps && !budgetLineId)
    throw new Error("A contract commits budget — select a budget line before the pack is prepared.");
  const standstillBlock = standstillBlockReason(cycle);
  if (standstillBlock) throw new Error(standstillBlock);
  if (!cycle?.awardReport?.signedAt) throw new Error("the award report must be signed before a contract pack is prepared");
  const winner = cycle.awardReport.recommendation;
  const winnerRow = cycle.matrix?.bids.find((b) => b.bidder === winner);
  /* The contract is opened from the winner's evaluated price. No price, no
     contract pack — a contract always has a contract value. */
  const contractValue = contractValueCheck(winnerRow?.financial?.correctedAmount ?? winnerRow?.financial?.amount);
  if (!contractValue.ok)
    throw new Error(
      `the recommended bid for ${tenderId} states no value — a contract cannot be prepared without a contract value. Record the winner's financial value on the evaluation matrix first.`,
    );
  const packMd = composeContractPack({
    tenderId,
    ...(winner ? { supplier: winner } : {}),
    value: contractValue.value,
    ...(winnerRow?.financial?.currency ? { currency: winnerRow.financial.currency } : {}),
  });
  const gate = raiseCycleGate({
    tenderId,
    tool: "sign_contract_pack",
    requiredOffice: "ACCOUNTING_OFFICER",
    inputs: {
      ...(winner ? { supplier: winner } : {}),
      value: contractValue.value,
      ...(winnerRow?.financial?.currency ? { currency: winnerRow.financial.currency } : {}),
      packMd: packMd.slice(0, 120),
      ...(budgetLineId ? { budgetLineId } : {}),
      ...(retentionPct !== undefined ? { retentionPct } : {}),
    },
    note: "Open the contract register from the signed pack",
  });
  appendLog({
    actor: "quorum-agent",
    server: "quorum-mcp",
    tool: "prepare_contract_pack",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId },
    outputs: { gate: gate.id },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { gate: gate.id, packMd };
}

/* ── WS6 — the method and the assurance check ───────────────────────────── */

function methodView(cycle: TenderCycle) {
  return methodStanding({
    methodId: cycle.methodId,
    justification: cycle.methodJustification,
    approvedAt: cycle.methodApprovedAt,
    approvalRef: cycle.methodApprovalRef,
    methodApprovedBy: cycle.methodApprovedBy,
    ...methodValueFor(cycle),
    jurisdictionId: state.jurisdictionId,
  });
}

/** What the desk knows about the recommended bidder's assurance standing. */
function assuranceView(cycle: TenderCycle) {
  const winner = cycle.awardReport?.recommendation ?? (cycle.matrix ? rankedBidder(cycle.matrix) : undefined);
  if (!winner) return null;
  const supplier = state.suppliers.find((s) => s.name.trim().toLowerCase() === winner.trim().toLowerCase());
  return {
    ...assuranceStanding(supplier),
    supplierId: supplier?.id ?? null,
    expectedSupplier: winner,
  };
}

/**
 * Record the tender's procurement method. An open method lands directly;
 * every non-open route needs a stated justification, a lawful value band and
 * — where the law requires it — the authority's approval reference, then a
 * named accounting officer's gate before it can be relied on.
 */
function coreSetMethod(
  tenderId: string,
  input: { methodId: string; justification?: string; approvalRef?: string; estimatedValue?: number; currency?: string },
  actor = "officer",
) {
  if (!SAFE_REF.test(tenderId)) throw new Error(`invalid tenderId: "${tenderId}"`);
  const method = findMethod(state.jurisdictionId, input.methodId);
  if (!method) {
    throw new Error(
      `"${input.methodId}" is not a lawful procurement method in ${state.jurisdictionId} — choose one from the live method register.`,
    );
  }
  const cycle = cycleFor(tenderId);
  const justification = (input.justification ?? "").trim().slice(0, 1200);
  const approvalRef = (input.approvalRef ?? "").trim().slice(0, 200);
  const estimate = awardValue(cycle);
  const value = Number.isFinite(input.estimatedValue) ? Number(input.estimatedValue) : estimate.value;
  const currency = input.currency?.trim() || estimate.currency;

  if (!methodNeedsGate(method.id)) {
    cycle.methodId = method.id;
    cycle.methodJustification = justification || undefined;
    cycle.methodApprovalRef = approvalRef || undefined;
    cycle.methodApprovedBy = undefined;
    cycle.methodApprovedAt = undefined;
    cycle.methodGateId = undefined;
    if (value !== undefined) cycle.methodValue = value;
    if (currency) cycle.methodCurrency = currency;
    appendLog({
      actor: actor.slice(0, 80),
      server: "quorum-mcp",
      tool: "set_procurement_method",
      kind: "WRITES",
      runId: "cycle",
      inputs: { tenderId, methodId: method.id, method: method.name },
      outputs: { open: true, gate: null },
      status: "OK",
      durationMs: 0,
    });
    saveState();
    return { method: methodView(cycle), gate: undefined };
  }

  if (justification.length < 20) {
    throw new Error(
      `A non-open method needs a stated justification of at least 20 characters — "${justification || "(none)"}" does not explain why competition was restricted.`,
    );
  }
  const methodLimit = METHOD_VALUE_LIMITS[state.jurisdictionId]?.[method.id];
  if (methodLimit && value !== undefined && value > methodLimit.max) {
    throw new Error(
      `${method.name} is lawful only up to ${methodLimit.currency} ${methodLimit.max.toLocaleString()} — this tender is worth ${currency ?? methodLimit.currency} ${value.toLocaleString()}. Use a method whose value band covers it.`,
    );
  }
  const authority = methodAuthorityBlockReason({
    methodId: method.id,
    approvalRef,
    ...(value !== undefined ? { value } : {}),
    ...(currency ? { currency } : {}),
    jurisdictionId: state.jurisdictionId,
  });
  if (authority) throw new Error(authority);

  const unchanged =
    cycle.methodId === method.id &&
    !!cycle.methodApprovedAt &&
    (cycle.methodJustification ?? "") === justification &&
    (cycle.methodApprovalRef ?? "") === approvalRef;
  if (unchanged) {
    return { method: methodView(cycle), gate: undefined, unchanged: true };
  }

  cycle.methodId = method.id;
  cycle.methodJustification = justification;
  if (value !== undefined) cycle.methodValue = value;
  if (currency) cycle.methodCurrency = currency;
  if (approvalRef) cycle.methodApprovalRef = approvalRef;
  else delete cycle.methodApprovalRef;
  cycle.methodApprovedBy = undefined;
  cycle.methodApprovedAt = undefined;
  const gate = raiseCycleGate({
    tenderId,
    tool: "approve_procurement_method",
    requiredOffice: "ACCOUNTING_OFFICER",
    inputs: {
      methodId: method.id,
      method: method.name,
      justification,
      approvalRef: approvalRef || null,
      value: value ?? null,
      currency: currency ?? null,
    },
    note: `Approve the ${method.name} method — ${justification.slice(0, 100)}`,
  });
  cycle.methodGateId = gate.id;
  appendLog({
    actor: actor.slice(0, 80),
    server: "quorum-mcp",
    tool: "set_procurement_method",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, methodId: method.id, method: method.name },
    outputs: { justification, approvalRef: approvalRef || null, gate: gate.id },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { method: methodView(cycle), gate: gate.id };
}

/** Record an assurance check against a supplier — a check, never an assertion of trust. */
export function coreVerifySupplier(supplierId: string, raw: Record<string, unknown>, checkedBy: string) {
  const key = supplierId.trim();
  if (!key) throw new Error("supplierId (or registration number) is required");
  const supplier =
    state.suppliers.find((s) => s.id === key) ??
    state.suppliers.find((s) => s.registrationNo.trim().toLowerCase() === key.toLowerCase());
  if (!supplier) throw new Error(`no supplier "${supplierId}" on the register`);
  const verification = normalizeVerification(raw, { checkedBy });
  supplier.verification = verification;
  supplier.updatedAt = new Date().toISOString();
  saveState();
  const standing = assuranceStanding(supplier);
  appendLog({
    actor: checkedBy.slice(0, 80),
    server: "quorum-mcp",
    tool: "verify_supplier",
    kind: "WRITES",
    runId: "cycle",
    inputs: {
      supplierId: supplier.id,
      name: supplier.name,
      source: verification.source,
      registryStatus: verification.registryStatus,
      taxStatus: verification.taxStatus,
      sanctions: verification.sanctions,
      pep: verification.pep,
      beneficialOwners: verification.beneficialOwners.length,
      documents: verification.documents.length,
    },
    outputs: { status: verification.status, expiresAt: verification.expiresAt, failures: standing.failures },
    status: "OK",
    durationMs: 0,
  });
  return { supplier: { id: supplier.id, name: supplier.name, status: supplier.status }, verification, ok: verificationOk(verification), failures: standing.failures };
}

function coreVariation(
  tenderId: string,
  description: string,
  valueDelta: number,
  options?: { legalAdviceRef?: string; approvalReference?: string; by?: string },
) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (!cycle?.contract) throw new Error(`no contract is open on "${tenderId}" — sign the contract pack first`);
  if (!Number.isFinite(valueDelta) || valueDelta === 0) throw new Error("valueDelta must be a non-zero number (negative for a downward variation)");
  const capBlock = variationBlockReason({ contract: cycle.contract, valueDelta });
  if (capBlock) throw new Error(capBlock);
  const legalAdviceRef = options?.legalAdviceRef?.trim() ?? "";
  const approvalReference = options?.approvalReference?.trim() ?? "";
  if (!approvalReference) throw new Error("an approval authority reference is required for every contract variation");
  if (state.jurisdictionId === "ZM" && !legalAdviceRef) throw new Error("the Zambia contract variation needs an Attorney-General legal advice reference");
  const pct = variationPctOfContract(cycle.contract.value, valueDelta);
  const cumulativePct = cumulativeVariationPct(cycle.contract, valueDelta);
  const variation: ContractVariation = {
    id: `var_${Math.random().toString(36).slice(2, 8)}`,
    description: description.trim().slice(0, 300),
    valueDelta,
    pctOfContract: pct,
    cumulativePct,
    status: "PENDING",
    at: new Date().toISOString(),
    approvalReference: approvalReference.slice(0, 200),
    ...(legalAdviceRef ? { legalAdviceRef: legalAdviceRef.slice(0, 200) } : {}),
  };
  cycle.contract.variations.push(variation);
  const gate = raiseCycleGate({
    tenderId,
    tool: "approve_variation",
    requiredOffice: "ACCOUNTING_OFFICER",
    inputs: { variationId: variation.id, description: variation.description, pctOfContract: pct, valueDelta, cumulativePct, approvalReference, ...(legalAdviceRef ? { legalAdviceRef } : {}) },
    note: `Variation is ${pct}% of the contract value — prior approval and legal advice must be verified before signature`,
  }).id;
  variation.gateId = gate;
  saveState();
  return { variation, gate };
}

function corePayment(
  tenderId: string,
  description: string,
  amount: number,
  options: {
    currency?: string;
    invoiceId?: string;
    milestoneId?: string;
    goodsReceiptId?: string;
    withholding?: number;
    retentionPct?: number;
  } = {},
) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (!cycle?.contract) throw new Error(`no contract is open on "${tenderId}"`);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("amount must be a positive number");
  const split = paymentSplit({
    gross: amount,
    ...(options.retentionPct !== undefined
      ? { retentionPct: options.retentionPct }
      : cycle.contract.retentionPct !== undefined
        ? { retentionPct: cycle.contract.retentionPct }
        : {}),
    ...(options.withholding !== undefined ? { withholding: options.withholding } : {}),
  });
  const payment: ContractPayment = {
    id: `pay_${Math.random().toString(36).slice(2, 8)}`,
    description: description.trim().slice(0, 300),
    amount: split.gross,
    gross: split.gross,
    retention: split.retention,
    withholding: split.withholding,
    net: split.net,
    status: "PENDING",
    ...(options.currency ? { currency: options.currency } : cycle.contract.currency ? { currency: cycle.contract.currency } : {}),
    ...(options.invoiceId?.trim() ? { invoiceId: options.invoiceId.trim().slice(0, 120) } : {}),
    ...(options.milestoneId?.trim() ? { milestoneId: options.milestoneId.trim().slice(0, 120) } : {}),
    ...(options.goodsReceiptId?.trim() ? { goodsReceiptId: options.goodsReceiptId.trim().slice(0, 120) } : {}),
  };
  cycle.contract.payments.push(payment);
  if (state.features.paymentCaps) {
    const block = paymentBlockReason({ contract: cycle.contract, payment });
    if (block) {
      cycle.contract.payments.pop();
      saveState();
      throw new Error(block);
    }
  }
  const gate = raiseCycleGate({
    tenderId,
    tool: "certify_payment",
    requiredOffice: "ACCOUNTING_OFFICER",
    inputs: { paymentId: payment.id, amount: split.gross, net: split.net, description: payment.description },
    note: "Certify the payment before it leaves the desk",
  }).id;
  payment.gateId = gate;
  saveState();
  return { payment, gate };
}

function coreCompleteContract(
  tenderId: string,
  input: { certificateId?: string; defectsLiabilityEndsAt?: string; performanceRating?: number; note?: string },
) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (!cycle?.contract) throw new Error(`no contract is open on "${tenderId}"`);
  if (cycle.contract.completedAt) throw new Error("the contract is already completed");
  if (state.features.paymentCaps) {
    const block = completionBlockReason(cycle.contract, input);
    if (block) throw new Error(block);
  }
  const gate = raiseCycleGate({
    tenderId,
    tool: "record_contract_completion",
    requiredOffice: "ACCOUNTING_OFFICER",
    inputs: {
      ...(input.certificateId ? { certificateId: input.certificateId.slice(0, 160) } : {}),
      ...(input.defectsLiabilityEndsAt ? { defectsLiabilityEndsAt: input.defectsLiabilityEndsAt.slice(0, 40) } : {}),
      ...(input.performanceRating !== undefined ? { performanceRating: input.performanceRating } : {}),
      ...(input.note ? { note: input.note.slice(0, 300) } : {}),
    },
    note: "Record final acceptance and close the contract",
  }).id;
  return { gate };
}

function coreComplaint(tenderId: string, complainant: string, subject: string, body?: string) {
  const cycle = cycleFor(tenderId);
  const receivedAt = new Date().toISOString();
  const complaint = {
    id: `cmp_${Math.random().toString(36).slice(2, 8)}`,
    tenderId,
    complainant: complainant.trim().slice(0, 160),
    subject: subject.trim().slice(0, 200),
    body: (body ?? "").slice(0, 2000),
    receivedAt,
    duringStandstill: cycle.standstill?.status === "ACTIVE" && receivedAt <= cycle.standstill.endsAt,
    status: "OPEN" as const,
  };
  cycle.complaints.push(complaint);
  appendLog({
    actor: "quorum-agent",
    server: "quorum-mcp",
    tool: "log_complaint",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, complainant: complaint.complainant, subject: complaint.subject },
    outputs: { complaintId: complaint.id, duringStandstill: complaint.duringStandstill },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { complaint };
}

function coreEscalateComplaint(tenderId: string, complaintId: string, reason: string) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  const complaint = cycle?.complaints.find((c) => c.id === complaintId);
  if (!complaint) throw new Error(`no complaint "${complaintId}" on tender "${tenderId}"`);
  if (complaint.status === "CLOSED" || complaint.status === "WITHDRAWN") throw new Error(`the complaint is already ${complaint.status}`);
  if (!reason.trim()) throw new Error("an escalation needs a stated reason");
  complaint.status = "ESCALATED";
  complaint.escalatedAt = new Date().toISOString();
  complaint.escalationReason = reason.trim().slice(0, 400);
  complaint.acknowledgedAt ??= complaint.escalatedAt;
  appendLog({
    actor: "web-app",
    server: "quorum-mcp",
    tool: "escalate_complaint",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, complaintId },
    outputs: { status: "ESCALATED", reason: complaint.escalationReason },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { complaint };
}

function coreCloseComplaint(tenderId: string, complaintId: string, outcome: string, note: string, reviewer: string) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  const complaint = cycle?.complaints.find((c) => c.id === complaintId);
  if (!complaint) throw new Error(`no complaint "${complaintId}" on tender "${tenderId}"`);
  if (complaint.status === "CLOSED" || complaint.status === "WITHDRAWN") throw new Error(`the complaint is already ${complaint.status}`);
  if (complaint.status === "OPEN") throw new Error("answer or escalate the complaint before closing it — a closure needs a response on the record");
  if (!outcome.trim() || !note.trim()) throw new Error("a closure needs an outcome and a stated reason");
  if (!reviewer.trim()) throw new Error("a closure needs the reviewing officer named");
  const at = new Date().toISOString();
  complaint.independentReview = { reviewer: reviewer.trim().slice(0, 120), at, outcome: outcome.trim().slice(0, 120), note: note.trim().slice(0, 600) };
  complaint.status = "CLOSED";
  complaint.closedAt = at;
  complaint.closedBy = reviewer.trim().slice(0, 120);
  complaint.acknowledgedAt ??= at;
  appendLog({
    actor: reviewer.trim() || "web-app",
    server: "quorum-mcp",
    tool: "close_complaint",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, complaintId, outcome: complaint.independentReview.outcome },
    outputs: { status: "CLOSED" },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { complaint };
}

function coreComplaintResponse(tenderId: string, complaintId: string, responseMd: string) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  const complaint = cycle?.complaints.find((c) => c.id === complaintId);
  if (!complaint) throw new Error(`no complaint "${complaintId}" on tender "${tenderId}"`);
  if (complaint.status !== "OPEN") throw new Error(`the complaint is already ${complaint.status}`);
  if (!responseMd.trim()) throw new Error("the response text is required");
  const gate = raiseCycleGate({
    tenderId,
    tool: "respond_complaint",
    requiredOffice: "ACCOUNTING_OFFICER",
    inputs: { complaintId, response: responseMd.slice(0, 200) },
    note: "Issue the response to the complainant",
  }).id;
  return { gate };
}

function coreClarification(tenderId: string, question: string, askedBy?: string) {
  const cycle = cycleFor(tenderId);
  const clarification = {
    id: `clr_${Math.random().toString(36).slice(2, 8)}`,
    tenderId,
    question: question.trim().slice(0, 600),
    askedBy: (askedBy ?? "a bidder").trim().slice(0, 160),
    askedAt: new Date().toISOString(),
  };
  cycle.clarifications.push(clarification);
  appendLog({
    actor: "quorum-agent",
    server: "quorum-mcp",
    tool: "log_clarification",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, question: clarification.question.slice(0, 120) },
    outputs: { clarificationId: clarification.id },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { clarification };
}

function coreAnswerClarification(tenderId: string, clarificationId: string, answer: string, answeredBy?: string) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  const clarification = cycle?.clarifications.find((c) => c.id === clarificationId);
  if (!clarification) throw new Error(`no clarification "${clarificationId}" on tender "${tenderId}"`);
  if (clarification.answer) throw new Error("the clarification is already answered");
  clarification.answer = answer.trim().slice(0, 2000);
  clarification.answeredAt = new Date().toISOString();
  clarification.answeredBy = (answeredBy ?? "the buyer").trim().slice(0, 80);
  appendLog({
    actor: "web-app",
    server: "quorum-mcp",
    tool: "answer_clarification",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, clarificationId },
    outputs: { answeredAt: clarification.answeredAt },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { clarification };
}

function coreAddendum(tenderId: string, summary: string, extendsClosingTo?: string) {
  const cycle = cycleFor(tenderId);
  const issuedAt = new Date().toISOString();
  const closing = cycle.closingDate;
  const clock = jurisdictionPack(state.jurisdictionId);
  const notice = addendumNoticeState(closing, issuedAt, clock);
  const extension = extendsClosingTo?.trim();
  if (extension && closing && new Date(extension).getTime() <= new Date(closing).getTime()) {
    throw new Error(`The extension (${extension}) must move the closing date forward from ${closing}.`);
  }
  /* The fairness rule: an addendum inside the minimum-notice window must move
     the closing date. Under addendumEnforcement the late addendum is refused;
     the flag stays on the record for older rehearsals. */
  if (notice?.requiresExtension && !extension && state.features.addendumEnforcement) {
    throw new Error(notice.reason ?? "The addendum is inside the minimum-notice window and must extend closing.");
  }
  const addendum: Addendum = {
    id: `add_${Math.random().toString(36).slice(2, 8)}`,
    tenderId,
    number: cycle.addenda.length + 1,
    summary: summary.trim().slice(0, 600),
    issuedAt,
    ...(extension ? { extendsClosingTo: extension } : {}),
    ...(notice?.requiresExtension ? { closingExtensionRequired: true } : {}),
  };
  if (extension) {
    cycle.closingDate = extension;
    cycle.closingSetBy = "addendum";
    cycle.closingSetAt = issuedAt;
  }
  cycle.addenda.push(addendum);
  appendLog({
    actor: "quorum-agent",
    server: "quorum-mcp",
    tool: "issue_addendum",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, summary: addendum.summary.slice(0, 120) },
    outputs: { addendumId: addendum.id, number: addendum.number, closingExtensionRequired: addendum.closingExtensionRequired ?? false },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { addendum };
}

async function coreDraftSpec(tenderId: string, brief: string) {
  if (!SAFE_REF.test(tenderId)) throw new Error(`invalid tenderId: "${tenderId}"`);
  const cycle = cycleFor(tenderId);
  const cleanBrief = brief.trim().slice(0, 2000);
  if (!cleanBrief) throw new Error("a brief is required to draft a specification");
  const cfg = llmConfigFromEnv();
  let md: string;
  let source: "llm" | "template" = "template";
  let model: string | undefined;
  const template = [
    `# SPECIFICATION / TERMS OF REFERENCE — ${tenderId}`,
    "",
    `**Brief:** ${cleanBrief}`,
    "",
    "## 1. Background and objective",
    "State the user department's need, the outcome required and how it ties to the approved procurement plan.",
    "",
    "## 2. Scope of supply / works / services",
    "List the deliverables, quantities and delivery schedule. Every line here becomes a SHALL clause the review desk pins later.",
    "",
    "## 3. Technical requirements",
    "Write each mandatory requirement as SHALL / must, so extract_requirements can pin and check it verbatim.",
    "",
    "## 4. Eligibility and required documents",
    "- [REQUIRED] Tax clearance certificate",
    "- [REQUIRED] (complete per the method and threshold)",
    "",
    "## 5. Evaluation criteria (published with the notice)",
    "| Criterion | Weight (%) |",
    "| --- | --- |",
    "| Technical compliance | 40 |",
    "| Relevant experience | 30 |",
    "| Delivery plan | 30 |",
    "",
    "Weights must sum to 100 — the matrix validator enforces exactly that.",
    "",
    "## 6. Reporting, acceptance and payment terms",
    "Milestones, acceptance procedure and the payment certification rhythm.",
  ].join("\n");
  if (cfg) {
    try {
      const completion = await callLlama(cfg, [
        {
          role: "system",
          content:
            'You are a public-procurement specification writer. From the brief, draft a specification / terms of reference in markdown: background, scope, SHALL-styled technical requirements, eligibility documents as "- [REQUIRED] ..." lines, an evaluation-criteria table whose weights sum to 100, and acceptance/payment terms. Markdown only — no commentary.',
        },
        { role: "user", content: `BRIEF:\n${cleanBrief}\n\nDraft the specification now.` },
      ]);
      md = completion.content.trim().slice(0, 12_000) || template;
      source = "llm";
      model = completion.model;
    } catch {
      md = template;
    }
  } else {
    md = template;
  }
  const spec = {
    id: `spec_${randomUUID().slice(0, 8)}`,
    tenderId,
    md,
    source,
    ...(model ? { model } : {}),
    createdAt: new Date().toISOString(),
  };
  cycle.specs.push(spec);
  appendLog({
    actor: "quorum-agent",
    server: source === "llm" ? "llm endpoint" : "template",
    tool: "draft_specification",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, brief: cleanBrief.slice(0, 120) },
    outputs: { specId: spec.id, source },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { spec };
}

/** Author the evaluation table once, for both documents that carry it.
 *
 * The specification is the working source; an unissued notice draft is a
 * snapshot of it, so the same edit lands in both. Once a publication gate is
 * raised or the notice is issued the table is no longer editable here: a
 * gate is testing a fixed artefact, and an issued notice can only change by
 * addendum. */
function coreSetEvaluationCriteria(tenderId: string, criteriaRaw: unknown, procedureRaw: unknown) {
  if (!SAFE_REF.test(tenderId)) throw new Error(`invalid tenderId: "${tenderId}"`);
  const cycle = cycleFor(tenderId);
  const issued = [...(cycle.notices ?? [])].reverse().find((notice) => !!notice.issuedAt);
  if (issued) {
    throw new Error("the issued notice fixes the evaluation criteria — change them by addendum, not by rewriting the file");
  }
  const latestNotice = cycle.notices?.at(-1);
  if (latestNotice?.gateId) {
    throw new Error("a publication gate is already testing this notice — withdraw the gate before changing its criteria");
  }
  if (!Array.isArray(criteriaRaw) || criteriaRaw.length === 0) {
    throw new Error("at least one evaluation criterion is required");
  }
  if (criteriaRaw.length > 12) {
    throw new Error("at most 12 criteria — a matrix is meant to be read");
  }
  const criteria = (criteriaRaw as { title?: unknown; weight?: unknown; evidence?: unknown; scoringMethod?: unknown }[]).map((item, index) => ({
    id: `C-${String(index + 1).padStart(2, "0")}`,
    title: str(item?.title).replace(/\|/g, " / ").replace(/\s+/g, " ").trim().slice(0, 120),
    /* The matrix rounds published weights to one decimal; author at the same
       precision so the notice and the matrix can never disagree. */
    weight: Math.round(Number(item?.weight) * 10) / 10,
    evidence: cleanEvaluationCriterionDetail(item?.evidence),
    scoringMethod: cleanEvaluationCriterionDetail(item?.scoringMethod),
  }));
  const criteriaError = validateCriteria(criteria);
  if (criteriaError) throw new Error(criteriaError);
  const disclosureError = validateCriteriaDisclosure(criteria);
  if (disclosureError) throw new Error(disclosureError);

  const currentSpec = cycle.specs?.at(-1);
  const base = currentSpec?.md?.trim()
    ? currentSpec.md
    : `# SPECIFICATION / TERMS OF REFERENCE — ${tenderId}`;
  const procedure = cleanEvaluationProcedure(procedureRaw);
  const now = new Date().toISOString();
  const spec = {
    id: `spec_${randomUUID().slice(0, 8)}`,
    tenderId,
    md: withEvaluationProcedure(withEvaluationCriteria(base, criteria), procedure),
    source: "officer" as const,
    createdAt: now,
  };
  cycle.specs.push(spec);

  let updatedNotice: (typeof cycle.notices)[number] | undefined;
  if (latestNotice) {
    const md = withEvaluationProcedure(withEvaluationCriteria(latestNotice.md, criteria), procedure);
    latestNotice.md = md;
    latestNotice.fieldCheck = noticeFieldCheck(md);
    latestNotice.updatedAt = now;
    updatedNotice = latestNotice;
  }

  appendLog({
    actor: "web-app",
    server: "quorum-mcp",
    tool: "set_evaluation_criteria",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, criteria: criteria.length, weightsSum: weightsSum(criteria) },
    outputs: { specId: spec.id, noticeId: updatedNotice?.id ?? null },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { spec, criteria, notice: updatedNotice ?? null };
}

function coreDraftNotice(tenderId: string, fields: Record<string, unknown>) {
  if (!SAFE_REF.test(tenderId)) throw new Error(`invalid tenderId: "${tenderId}"`);
  const cycle = cycleFor(tenderId);
  /* A notice gets its own neutral, system-issued reference. The tenderId is
     still the stable lookup key for legacy and externally published tenders. */
  const reference = cycle.systemReference ?? nextPipelineRef({});
  const buyer = str(fields.buyer).trim() || "—";
  const method = str(fields.method).trim() || "Open competitive selection";
  const subject = str(fields.subject).trim() || "—";
  const contact = str(fields.contact).trim() || "—";
  const closingDate = str(fields.closingDate).trim() || undefined;
  const ceiling = str(fields.ceiling).trim() || undefined;
  const requestedTechnicalWeight = fields.technicalWeightPct === undefined ? DEFAULT_TECH_WEIGHT_PCT : Number(fields.technicalWeightPct);
  if (!Number.isInteger(requestedTechnicalWeight) || requestedTechnicalWeight < 0 || requestedTechnicalWeight > 100) throw new Error("technicalWeightPct must be a whole number from 0 to 100");
  const requestedFormula = str(fields.financialFormula).trim();
  if (requestedFormula && requestedFormula !== DEFAULT_FINANCIAL_FORMULA) throw new Error("this release supports the lowest-evaluated-price formula; publish that exact formula so scoring matches the solicitation");
  const financialFormula = DEFAULT_FINANCIAL_FORMULA;
  const fxBasis = str(fields.fxBasis).trim() || undefined;
  const preferenceScheme = str(fields.preferenceScheme).trim() || "None";
  const cdfConstituency = str(fields.cdfReservationConstituency).trim();
  const cdfExceptionRef = str(fields.cdfReservationExceptionRef).trim();
  const cdfExceptionBasis = str(fields.cdfReservationExceptionBasis).trim();
  if (preferenceScheme === "CDF_RESERVATION" && cdfConstituency.length < 3) {
    throw new Error("name the funded constituency in the notice before using the CDF reservation scheme");
  }
  if (preferenceScheme !== "CDF_RESERVATION" && cdfConstituency) {
    throw new Error("a funded constituency can only be recorded with the CDF reservation scheme");
  }
  if (preferenceScheme === "CDF_RESERVATION" && (cdfExceptionRef || cdfExceptionBasis) && (!cdfExceptionRef || cdfExceptionBasis.length < 20)) {
    throw new Error("the CDF locality exception needs both a supporting evidence reference and a reasoned finding (at least 20 characters)");
  }
  if (preferenceScheme !== "CDF_RESERVATION" && (cdfExceptionRef || cdfExceptionBasis)) {
    throw new Error("a CDF locality exception can only be recorded with the published CDF reservation scheme");
  }
  const foreignBiddersPermitted = fields.foreignBiddersPermitted === true;
  const evaluationCurrency = normalizeCurrency(fields.evaluationCurrency) ?? jurisdictionCurrency(state.jurisdictionId);
  const procurementScope = fields.procurementScope === "International" ? "International" : "National";
  const requiredDocsInput = Array.isArray(fields.requiredDocs) ? fields.requiredDocs : undefined;
  if (requiredDocsInput && requiredDocsInput.length > 100) {
    throw new Error("requiredDocs can contain at most 100 documents");
  }
  const normalizedRequiredDocs = requiredDocsInput?.map((document) =>
    str(document).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim(),
  ).filter(Boolean) ?? [];
  if (normalizedRequiredDocs.some((document) => document.length > 180)) {
    throw new Error("required document names must be 180 characters or fewer");
  }
  const requiredDocs = requiredDocsInput
    ? [...new Map(normalizedRequiredDocs.map((document) => [document.toLocaleLowerCase(), document] as const)).values()]
    : undefined;
  const sourceCriteria = parseEvaluationCriteria(cycle.specs?.at(-1)?.md ?? "");
  const evaluationCriteria = sourceCriteria.length && !validateCriteria(sourceCriteria) && !validateCriteriaDisclosure(sourceCriteria)
    ? sourceCriteria
    : undefined;
  const evaluationProcedure = parseEvaluationProcedure(cycle.specs?.at(-1)?.md ?? "");
  const md = draftNoticeMd({
    reference,
    buyer,
    method,
    subject,
    contact,
    ...(closingDate ? { closingDate } : {}),
    ...(ceiling ? { ceiling } : {}),
    ...(requiredDocs ? { requiredDocs } : {}),
    ...(evaluationCriteria ? { evaluationCriteria } : {}),
    ...(evaluationProcedure ? { evaluationProcedure } : {}),
    technicalWeightPct: requestedTechnicalWeight,
    ...(financialFormula ? { financialFormula } : {}),
    ...(fxBasis ? { fxBasis } : {}),
    preferenceScheme,
    ...(cdfConstituency ? { cdfReservationConstituency: cdfConstituency } : {}),
    ...(cdfExceptionRef ? { cdfReservationExceptionRef: cdfExceptionRef, cdfReservationExceptionBasis: cdfExceptionBasis } : {}),
    foreignBiddersPermitted,
    evaluationCurrency,
    procurementScope,
  });
  const draft = {
    id: `ntc_${randomUUID().slice(0, 8)}`,
    tenderId,
    reference,
    md,
    fieldCheck: noticeFieldCheck(md),
    createdAt: new Date().toISOString(),
  };
  cycle.notices.push(draft);
  if (closingDate) {
    const parsed = parseClosingDate(`**Closing date:** ${closingDate}`);
    if (parsed) {
      cycle.closingDate = parsed;
      cycle.closingSetBy = "notice draft";
      cycle.closingSetAt = draft.createdAt;
    }
  }
  appendLog({
    actor: "quorum-agent",
    server: "quorum-mcp",
    tool: "draft_notice",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, reference, buyer },
    outputs: { noticeId: draft.id, missingFields: draft.fieldCheck.filter((f) => !f.present).map((f) => f.field) },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { notice: draft };
}

function corePipelineEntry(input: Record<string, unknown>) {
  const provided = str(input.ref).trim().slice(0, 60);
  if (provided && !isSystemReference(provided)) {
    throw new Error("pipeline references are assigned by Quorum; source-pack IDs cannot be used as public references");
  }
  const ref = nextPipelineRef(input);
  const title = str(input.title).trim().slice(0, 200);
  if (!ref || !title) throw new Error("ref and title are required for a pipeline entry");
  const exists = [...state.pipeline.flatMap((p) => [p.ref, p.systemReference ?? ""]), ...state.cycle.flatMap((c) => [c.tenderId, c.systemReference ?? ""]), ...state.runs.flatMap((r) => [r.tenderId, r.reference ?? ""])]
    .some((r) => r.toLowerCase() === ref.toLowerCase()) ||
    state.cycle.some((cycle) => cycle.notices.some((notice) => notice.reference?.toLowerCase() === ref.toLowerCase()));
  if (exists) throw new Error(`reference "${ref}" is already on record — wait for the system to issue the next one`);
  const entry = {
    id: `pip_${randomUUID().slice(0, 8)}`,
    workspaceId: currentWorkspaceId(),
    systemReference: ref,
    ref,
    title,
    ...(input.office ? { office: str(input.office).trim().slice(0, 80) } : {}),
    ...(Number.isFinite(Number(input.budgetEstimate)) && Number(input.budgetEstimate) > 0 ? { budgetEstimate: Number(input.budgetEstimate) } : {}),
    ...(input.currency ? { currency: str(input.currency).trim().slice(0, 8) } : {}),
    ...(input.expectedPublication ? { expectedPublication: str(input.expectedPublication).trim().slice(0, 40) } : {}),
    status: "PLANNED" as const,
    createdAt: new Date().toISOString(),
  };
  state.pipeline.push(entry);
  appendLog({
    actor: "web-app",
    server: "quorum-mcp",
    tool: "add_pipeline_entry",
    kind: "WRITES",
    runId: "cycle",
    inputs: { ref, title, generated: !provided },
    outputs: { pipelineId: entry.id },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { entry };
}

/**
 * System-issued pipeline reference.
 *
 * Officers do not invent references: the register issues neutral Quorum IDs.
 * The year follows the expected publication date and the sequence is the next
 * free number across the live pipeline, cycles, review runs, and notice drafts.
 */
export function nextPipelineRef(input: Record<string, unknown>): string {
  const prefix = "QRM";
  const publication = str(input.expectedPublication ?? input.publication).trim();
  const parsed = publication ? new Date(publication) : null;
  const year = parsed && !Number.isNaN(parsed.getTime()) ? parsed.getUTCFullYear() : new Date().getUTCFullYear();
  const matcher = new RegExp(`^${prefix}-${year}-(\\d{2,})$`, "i");
  const used = new Set<number>();
  for (const ref of [
    ...state.pipeline.map((p) => p.ref),
    ...state.pipeline.map((p) => p.systemReference ?? ""),
    ...state.cycle.map((c) => c.tenderId),
    ...state.cycle.map((c) => c.systemReference ?? ""),
    ...state.runs.map((r) => r.tenderId),
    ...state.runs.map((r) => r.reference ?? ""),
    ...state.cycle.flatMap((c) => c.notices.map((notice) => notice.reference ?? "")),
    ...Object.values(SAMPLE_SYSTEM_REFERENCES),
  ]) {
    const match = ref.match(matcher);
    if (match) used.add(Number(match[1]));
  }
  let sequence = 1;
  while (used.has(sequence)) sequence += 1;
  return `${prefix}-${year}-${String(sequence).padStart(3, "0")}`;
}


function corePipelineLink(pipelineId: string, tenderId: string, workspaceId = currentWorkspaceId()) {
  const entry = state.pipeline.find((p) => p.id === pipelineId && (p.workspaceId ?? "demo") === workspaceId);
  if (!entry) throw new Error(`no pipeline entry "${pipelineId}"`);
  if (!SAFE_REF.test(tenderId)) throw new Error(`invalid tenderId: "${tenderId}"`);
  entry.status = "LINKED";
  entry.linkedTenderId = tenderId;
  appendLog({
    actor: "web-app",
    server: "quorum-mcp",
    tool: "link_pipeline_entry",
    kind: "WRITES",
    runId: "cycle",
    inputs: { pipelineId, tenderId },
    outputs: { status: "LINKED" },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { entry };
}

/* ── MCP tool dispatch — the cycle tools' hands ────────────────────────────── */

export async function cycleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "record_bid_opening": {
      const bids = (Array.isArray(args.bids) ? args.bids : []).map((raw) => {
        const b = raw as Record<string, unknown>;
        return { bidder: str(b.bidder).trim(), receivedAt: str(b.receivedAt).trim(), ...(b.priceRead ? { priceRead: str(b.priceRead).trim().slice(0, 80) } : {}) };
      });
      return coreRecordBidOpening(str(args.tenderId).trim(), bids);
    }
    case "build_evaluation_matrix": {
      const criteria = (Array.isArray(args.criteria) ? args.criteria : []).map((raw) => {
        const c = raw as Record<string, unknown>;
        return { title: str(c.title), weight: Number(c.weight) };
      });
      return coreBuildMatrix(str(args.tenderId).trim(), criteria, args.technicalWeightPct);
    }
    case "open_alb_dossier":
      return coreOpenAlb(str(args.tenderId).trim(), str(args.bidder).trim(), str(args.findingId).trim() || undefined, str(args.basis));
    case "draft_award_report":
      return coreAwardReport(str(args.tenderId).trim());
    case "publish_award_notice":
      return corePublishAwardNotice(str(args.tenderId).trim(), str(args.dispatchEvidenceRef));
    case "prepare_contract_pack":
      return coreContractPack(
        str(args.tenderId).trim(),
        str(args.budgetLineId).trim() || undefined,
        typeof args.retentionPct === "number" ? args.retentionPct : undefined,
      );
    case "set_procurement_method":
      return coreSetMethod(
        str(args.tenderId).trim(),
        {
          methodId: str(args.methodId).trim(),
          justification: str(args.justification),
          approvalRef: str(args.approvalRef),
          ...(args.estimatedValue !== undefined ? { estimatedValue: Number(args.estimatedValue) } : {}),
          ...(str(args.currency) ? { currency: str(args.currency) } : {}),
        },
        str(args.by).trim() || "mcp-client",
      );
    case "verify_supplier":
      return coreVerifySupplier(
        str(args.supplierId ?? args.registrationNo).trim(),
        args,
        str(args.by).trim() || "mcp-client",
      );
    case "dispose_finding":
      return coreDisposeFinding(
        str(args.tenderId).trim(),
        str(args.findingId).trim(),
        { status: args.status, note: args.note, evidence: args.evidence, secondedBy: args.secondedBy },
        str(args.by).trim() || "mcp-client",
      );
    case "execute_contract":
      return coreExecuteContract(str(args.tenderId).trim(), {
        performanceSecurity: args.performanceSecurity as { amount?: unknown; issuer?: unknown; validUntil?: unknown } | undefined,
        insurance: args.insurance as { policyNo?: unknown; issuer?: unknown; validUntil?: unknown } | undefined,
        retentionPct: args.retentionPct,
        warrantyDays: args.warrantyDays,
      });
    case "request_variation":
      return coreVariation(str(args.tenderId).trim(), str(args.description), Number(args.valueDelta), {
        legalAdviceRef: str(args.legalAdviceRef) || undefined,
        approvalReference: str(args.approvalReference) || undefined,
        by: str(args.by) || "mcp-client",
      });
    case "log_complaint":
      return coreComplaint(str(args.tenderId).trim(), str(args.complainant), str(args.subject), str(args.body));
    case "log_clarification":
      return coreClarification(str(args.tenderId).trim(), str(args.question), str(args.askedBy) || undefined);
    case "issue_addendum":
      return coreAddendum(str(args.tenderId).trim(), str(args.summary), str(args.extendsClosingTo) || undefined);
    case "draft_specification":
      return coreDraftSpec(str(args.tenderId).trim(), str(args.brief));
    case "draft_notice":
      return coreDraftNotice(str(args.tenderId).trim(), args);
    case "add_pipeline_entry":
      return corePipelineEntry(args);
    default:
      throw new Error(`unknown cycle tool: ${name}`);
  }
}

/* ── The procurement file (G5) ─────────────────────────────────────────────── */

async function procurementFile(tenderId: string) {
  if (!SAFE_REF.test(tenderId)) throw new Error(`invalid tenderId: "${tenderId}"`);
  const { verifyToolLogFile } = await import("./store");
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  const meta = await tenderMeta(tenderId);
  /* The label follows the tender record, not the workspace's current mode. A
     rehearsal file must not lose its watermark because someone connected the
     portal later. */
  const publication = cycle?.awardNotice?.publication ?? state.deployment.publication;
  const deploymentMode = publication.mode === "CONNECTED" ? "CONNECTED" : "RECORD_ONLY";
  const md = composeProcurementFile({
    tenderId,
    ...(meta.title ? { title: meta.title } : {}),
    ...(meta.buyer ? { buyer: meta.buyer } : {}),
    ...(cycle
      ? {
          cycle: {
            ...(cycle.closingDate ? { closingDate: cycle.closingDate } : {}),
            ...(cycle.methodId
              ? {
                  method: {
                    id: cycle.methodId,
                    name: findMethod(state.jurisdictionId, cycle.methodId)?.name,
                    ...(cycle.methodJustification ? { justification: cycle.methodJustification } : {}),
                    ...(cycle.methodApprovalRef ? { approvalRef: cycle.methodApprovalRef } : {}),
                    ...(cycle.methodApprovedBy ? { approvedBy: cycle.methodApprovedBy } : {}),
                    ...(cycle.methodApprovedAt ? { approvedAt: cycle.methodApprovedAt } : {}),
                  },
                }
              : {}),
            ...(() => {
              const winner = cycle.awardReport?.recommendation ?? (cycle.matrix ? rankedBidder(cycle.matrix) : undefined);
              const supplier = winner
                ? state.suppliers.find((s) => s.name.trim().toLowerCase() === winner.trim().toLowerCase())
                : undefined;
              if (!supplier) return {};
              const v = supplier.verification;
              return {
                assurance: {
                  supplier: supplier.name,
                  status: v ? (verificationOk(v) ? "VERIFIED" : "FAILED") : "UNVERIFIED",
                  ...(v
                    ? {
                        source: v.source,
                        checkedBy: v.checkedBy,
                        checkedAt: v.checkedAt,
                        expiresAt: v.expiresAt,
                        registryStatus: v.registryStatus,
                        taxStatus: v.taxStatus,
                        sanctions: v.sanctions,
                        pep: v.pep,
                        beneficialOwners: v.beneficialOwners.length,
                        documents: v.documents.length,
                        failures: verificationFailures(v),
                      }
                    : { failures: ["no assurance check is on record"] }),
                },
              };
            })(),
            ...(cycle.opening ? { opening: cycle.opening } : {}),
            ...(cycle.matrix ? { matrix: cycle.matrix } : {}),
            alb: cycle.alb,
            ...(cycle.awardReport ? { awardReport: cycle.awardReport } : {}),
            ...(cycle.awardNotice ? { awardNotice: { publishedAt: cycle.awardNotice.publishedAt, portal: cycle.awardNotice.portal, sha: cycle.awardNotice.sha } } : {}),
            ...(cycle.standstill ? { standstill: cycle.standstill } : {}),
            ...(cycle.contract ? { contract: cycle.contract } : {}),
            complaints: cycle.complaints,
            clarifications: cycle.clarifications,
            addenda: cycle.addenda,
            coi: cycle.coi,
            debriefs: cycle.debriefs,
          },
        }
      : {}),
    runs: state.runs.filter((r) => r.tenderId === tenderId).map((r) => ({
      id: r.id,
      status: r.status,
      startedAt: r.startedAt,
      findings: r.findings.map((f) => ({
        id: f.id,
        rule: f.rule,
        item: f.item,
        severity: f.severity,
        citation: f.citation,
        ...(f.disposition
          ? {
              disposition: {
                status: f.disposition.status,
                by: f.disposition.by,
                note: f.disposition.note,
                ...(f.disposition.secondedBy ? { secondedBy: f.disposition.secondedBy } : {}),
              },
            }
          : {}),
        ...(f.review ? { review: { decision: f.review.decision, by: f.review.by, at: f.review.at } } : {}),
      })),
      drafts: r.drafts.map((d) => ({ id: d.id })),
    })),
    gates: state.gates.filter((g) => g.tenderId === tenderId).map((g) => ({
      id: g.id,
      tool: g.tool,
      status: g.status,
      ...(g.approver ? { approver: g.approver } : {}),
      ...(g.decidedAt ? { decidedAt: g.decidedAt } : {}),
      ...(g.receipt ? { receipt: g.receipt } : {}),
    })),
    deployment: {
      mode: deploymentMode,
      label: publication.portal,
      ...(publication.receiptId ? { receiptId: publication.receiptId } : {}),
    },
    ...(cycle?.dissents?.length
      ? { dissents: cycle.dissents.map((d) => ({ stage: d.stage, member: d.member, position: d.position, basis: d.basis, recordedAt: d.recordedAt })) }
      : {}),
    ...(state.exceptions.some((e) => e.tenderId === tenderId)
      ? {
          exceptions: state.exceptions
            .filter((e) => e.tenderId === tenderId)
            .map((e) => ({ id: e.id, kind: e.kind, status: e.status, title: e.title, requestedBy: e.requestedBy, ...(e.decidedBy ? { decidedBy: e.decidedBy } : {}) })),
        }
      : {}),
    compliance: (() => {
      const c = complianceSummary(tenderId);
      return { verdict: c.verdict, hardFails: c.hardFails.map((h) => ({ rule: h.rule, detail: h.detail })), lines: c.lines.map((l) => ({ rule: l.rule, count: l.count, hardFail: l.hardFail })) };
    })(),
    generatedAt: new Date().toISOString(),
  });
  const log = await verifyToolLogFile();
  return {
    md,
    logVerified: { ok: log.ok, checked: log.checked },
    deployment: { mode: deploymentMode, publication },
  };
}

/* ── Signed procurement bundle — the auditors' single, verifiable package ──
   Wraps the procurement file (Markdown + log-chain verdict) in a manifest
   that records a SHA-256 for every artifact, then seals the manifest with an
   HMAC over the canonical JSON using GATE_SECRET. An auditor recomputes the
   hashes and the HMAC to confirm nothing was altered after sealing. */
async function procurementBundle(tenderId: string) {
  const file = await procurementFile(tenderId);
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const generatedAt = new Date().toISOString();
  const artifacts = [
    { name: `procurement-file-${tenderId}.md`, mediaType: "text/markdown", sha256: sha(file.md) },
    {
      name: `log-chain-verdict-${tenderId}.json`,
      mediaType: "application/json",
      sha256: sha(JSON.stringify(file.logVerified)),
    },
  ];
  const manifest = {
    tenderId,
    generatedAt,
    deployment: file.deployment.mode,
    publication: file.deployment.publication,
    logVerified: file.logVerified,
    artifacts,
  };
  const signature = createHmac("sha256", gateSecret()).update(JSON.stringify(manifest)).digest("hex");
  return { manifest, signature, signatureAlgorithm: "HMAC-SHA256", content: { [artifacts[0].name]: file.md, [artifacts[1].name]: file.logVerified } };
}

/* ── REST surface ──────────────────────────────────────────────────────────── */

export const json = (data: unknown, code = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status: code,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
  });

export async function handleCycleRoutes(
  path: string,
  method: string,
  body: Record<string, unknown>,
  attestedActor = "",
  workspaceId = "demo",
  attestedActorId = "",
  roster: RosterMemberForGate[] | null = null,
): Promise<Response | null> {
  const mustPost = () => method === "POST";
  const cycles = () => state.cycle.filter((cycle) => (cycle.workspaceId ?? "demo") === workspaceId);
  const pipelineRows = () => state.pipeline.filter((entry) => (entry.workspaceId ?? "demo") === workspaceId);
  const runs = () => state.runs.filter((run) => (run.workspaceId ?? "demo") === workspaceId);
  const gates = () => state.gates.filter((gate) => (gate.workspaceId ?? "demo") === workspaceId);
  const tenderRef = (re: RegExp) => decodeURIComponent(path.match(re)?.[1] ?? "");

  if (path === "/api/cycle" && method === "GET") {
    return json({
      cycles: [...cycles()].reverse().map((cycle) => ({
        ...cycle,
        ...(cycle.matrix
          ? { matrix: { ...cycle.matrix, scoringBasisBlockReason: scoringBasisBlockReason(cycle.matrix) } }
          : {}),
        notices: (cycle.notices ?? []).map((notice) => ({
          ...notice,
          fieldCheck: noticeFieldCheck(notice.md),
          evaluationCriteria: parseEvaluationCriteria(notice.md),
        })),
        findings: runs()
          .filter((run) => run.tenderId === cycle.tenderId)
          .flatMap((run) => run.findings),
        blockers: awardBlockers(cycle),
        method: methodView(cycle),
        assurance: assuranceView(cycle),
      })),
      pipeline: [...pipelineRows()].reverse(),
    });
  }
  if (path === "/api/budget-lines" && method === "GET") {
    return json({
      lines: state.budgetLines.filter((line) => (line.workspaceId ?? "demo") === workspaceId),
      commitments: state.commitments.filter((c) => (c.workspaceId ?? "demo") === workspaceId),
    });
  }
  if (path === "/api/budget-lines" && mustPost()) {
    try {
      return json(coreBudgetLine(body), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (path === "/api/cycle/analytics" && method === "GET") {
    return json(cycleAnalytics({ cycles: cycles(), runs: runs() }));
  }
  if (path === "/api/cycle/deadlines" && method === "GET") {
    const references = new Map(cycles().map((cycle) => [cycle.tenderId, cycle.systemReference]));
    const deadlines = collectDeadlines(cycles(), undefined, jurisdictionPack(state.jurisdictionId)).map((deadline) => ({
      ...deadline,
      ...(references.get(deadline.tenderId) ? { systemReference: references.get(deadline.tenderId) } : {}),
    }));
    return json({ deadlines });
  }
  if (path === "/api/cycle/quarterly-reports" && method === "GET") {
    const now = new Date();
    const periods = [] as Record<string, unknown>[];
    for (let offset = 0; offset < 12; offset++) {
      const point = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset * 3, 1));
      const periodYear = point.getUTCFullYear();
      const periodQuarter = Math.floor(point.getUTCMonth() / 3) + 1;
      const entries = entriesForQuarter(workspaceId, periodYear, periodQuarter);
      const report = state.quarterlyReports.find((row) => row.workspaceId === workspaceId && row.year === periodYear && row.quarter === periodQuarter);
      const bounds = quarterBounds(periodYear, periodQuarter);
      periods.push({
        year: periodYear,
        quarter: periodQuarter,
        startsAt: bounds.start.toISOString(),
        endsAt: bounds.end.toISOString(),
        entries,
        digest: shaOf(entries),
        status: report?.status ?? (quarterlyPeriodIsClosed(periodYear, periodQuarter) ? "READY" : "OPEN"),
        ...(report ? { report } : {}),
      });
    }
    for (const report of state.quarterlyReports.filter((row) => row.workspaceId === workspaceId)) {
      if (!periods.some((period) => period.year === report.year && period.quarter === report.quarter)) {
        const bounds = quarterBounds(report.year, report.quarter);
        periods.push({
          year: report.year,
          quarter: report.quarter,
          startsAt: bounds.start.toISOString(),
          endsAt: bounds.end.toISOString(),
          entries: report.entries,
          digest: report.digest,
          status: report.status,
          report,
        });
      }
    }
    return json({ periods });
  }
  if (path === "/api/cycle/quarterly-reports" && mustPost()) {
    try {
      return json(coreStageQuarterlyReport(
        workspaceId,
        Number(body.year),
        Number(body.quarter),
        str(body.submissionReference),
        str(body.evidenceReference),
        attestedActorId,
      ), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  const aiReviewInput = path.match(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/matrix\/ai-review-input$/);
  if (aiReviewInput && method === "GET") {
    const tenderId = decodeURIComponent(aiReviewInput[1]);
    const rawCycle = cycles().find((row) => row.tenderId === tenderId);
    if (!rawCycle) return json({ error: "Select a tender with a workflow record before reviewing bids." }, 404);
    const cycle = normalizeCycle(rawCycle);
    const opening = cycle.opening;
    if (!opening?.certifiedAt) {
      return json({ error: "Certify the bid opening register before reviewing submitted bids." }, 409);
    }
    if (opening.reconciliation && !opening.reconciliation.matches) {
      return json({ error: "Resolve the opening-register reconciliation before reviewing bids." }, 409);
    }
    const openingRows = Array.isArray(opening.rows) ? opening.rows : [];
    const matrix = cycle.matrix;
    if (!matrix) return json({ error: "Build the evaluation matrix from the published criteria before reviewing bids." }, 409);
    const notice = (cycle.notices ?? []).find((row) => row.id === matrix.criteriaNoticeId && !!row.issuedAt);
    if (!notice) return json({ error: "The matrix is not linked to an issued evaluation notice." }, 409);
    const issuedCriteria = parseEvaluationCriteria(notice.md);
    if (
      !issuedCriteria.length ||
      issuedCriteria.length !== matrix.criteria.length ||
      issuedCriteria.some((criterion, index) => {
        const scored = matrix.criteria[index];
        return !scored || criterion.id !== scored.id || criterion.title !== scored.title || criterion.weight !== scored.weight ||
          (criterion.evidence ?? "") !== (scored.evidence ?? "") || (criterion.scoringMethod ?? "") !== (scored.scoringMethod ?? "");
      })
    ) {
      return json({ error: "The evaluation matrix no longer matches the published criteria. Rebuild it from the issued notice before reviewing bids." }, 409);
    }

    const openingNames = openingRows.map((row) => row.bidder.trim().toLowerCase()).sort();
    const matrixNames = matrix.bids.map((row) => row.bidder.trim().toLowerCase()).sort();
    if (
      new Set(openingNames).size !== openingNames.length ||
      new Set(matrixNames).size !== matrixNames.length ||
      openingNames.length !== matrixNames.length ||
      openingNames.some((name, index) => name !== matrixNames[index])
    ) {
      return json({ error: "The certified bidder register and evaluation matrix do not match. Resolve the discrepancy before using AI review." }, 409);
    }

    const admittedRows = openingRows.filter((row) => !row.late);
    if (!admittedRows.length) return json({ error: "There are no admitted bids to review. Late bids remain unopened." }, 409);
    const admittedNames = new Set(admittedRows.map((row) => row.bidder.trim().toLowerCase()));
    let stagedDocuments: { bidder: string; citation: string; text: string }[] = [];
    try {
      const { pack } = await loadPack(tenderId);
      const stagedNames = pack.bids.map((bid) => bid.bidder.trim().toLowerCase());
      const openingNameSet = new Set(openingNames);
      if (stagedNames.some((name) => !openingNameSet.has(name))) {
        return json({ error: "The staged bid records include an unregistered bidder. Resolve the discrepancy before using AI review." }, 409);
      }
      stagedDocuments = pack.bids
        .filter((bid) => admittedNames.has(bid.bidder.trim().toLowerCase()) && bid.text.trim())
        .map((bid) => ({ bidder: bid.bidder, citation: bid.source, text: bid.text }));
    } catch {
      /* Supplier portal attachments can be the complete source for live bids. */
    }
    const tenderApplications = state.applications.filter((application) =>
      (application.workspaceId ?? "demo") === workspaceId && application.tenderId === tenderId,
    );
    const applicationsById = new Map(tenderApplications.map((application) => [application.id, application]));
    const applicationSubmissions: {
      bidder: string;
      organizationId: string;
      coverNote: string;
      documents: NonNullable<(typeof tenderApplications)[number]["bidDocuments"]>;
    }[] = [];
    for (const row of admittedRows) {
      const linkedApplication = row.applicationId ? applicationsById.get(row.applicationId) : undefined;
      const matchingApplications = row.applicationId
        ? linkedApplication ? [linkedApplication] : []
        : tenderApplications.filter((application) =>
            application.status === "RECEIVED" && application.orgName.trim().toLowerCase() === row.bidder.trim().toLowerCase(),
          );
      if (row.applicationId && matchingApplications.length !== 1) {
        return json({ error: `The supplier portal record for ${row.bidder} no longer matches the certified opening register.` }, 409);
      }
      if (matchingApplications.length > 1) {
        return json({ error: `More than one active supplier portal submission matches ${row.bidder}. Resolve the tender record before AI review.` }, 409);
      }
      const application = matchingApplications[0];
      if (!application) continue;
      if (application.status !== "RECEIVED" || application.orgName.trim().toLowerCase() !== row.bidder.trim().toLowerCase()) {
        return json({ error: `The supplier portal record for ${row.bidder} has changed since bid opening. Reconcile the tender record before AI review.` }, 409);
      }
      applicationSubmissions.push({
        bidder: row.bidder,
        organizationId: application.orgId,
        coverNote: application.coverNote ?? "",
        documents: application.bidDocuments ?? [],
      });
    }
    const pipeline = pipelineRows().find((entry) => entry.ref === tenderId || entry.linkedTenderId === tenderId);

    return json({
      tenderId,
      tenderTitle: pipeline?.title ?? tenderId,
      systemReference: cycle.systemReference ?? pipeline?.systemReference ?? undefined,
      notice: {
        id: notice.id,
        criteria: issuedCriteria,
      },
      matrix: {
        id: matrix.id,
        status: matrix.status,
        criteriaNoticeId: matrix.criteriaNoticeId,
        criteria: matrix.criteria,
        technicalWeightPct: matrix.technicalWeightPct,
        financialFormula: matrix.financialFormula,
        evaluationCurrency: matrix.evaluationCurrency,
        bids: matrix.bids,
        sheets: matrix.sheets ?? [],
        consensus: matrix.consensus ?? null,
        med: matrix.med ?? null,
        fxRates: matrix.fxRates ?? [],
      },
      documents: stagedDocuments.filter((bid) => admittedNames.has(bid.bidder.trim().toLowerCase())),
      applicationSubmissions,
      excludedLateBidders: openingRows.filter((row) => row.late).map((row) => row.bidder),
    });
  }
  const tenderGet = path.match(/^\/api\/tenders\/([A-Za-z0-9._-]+)$/);
  if (tenderGet && method === "GET") {
    const tenderId = decodeURIComponent(tenderGet[1]);
    const cycle = cycles().find((c) => c.tenderId === tenderId);
    const pipeline = pipelineRows().find((p) => p.ref === tenderId || p.linkedTenderId === tenderId);
    if (!cycle && !pipeline) return json({ error: `no tender "${tenderId}" on record` }, 404);
    return json({
      tenderId,
      ...(pipeline ? { pipeline } : {}),
      ...(cycle ? { cycle } : {}),
      runs: runs().filter((r) => r.tenderId === tenderId).map((r) => ({ id: r.id, status: r.status, startedAt: r.startedAt })),
      gates: gates().filter((g) => g.tenderId === tenderId).map((g) => ({ id: g.id, tool: g.tool, status: g.status })),
    });
  }
  /* The contract as one supplier may see it. The web org route is the trust
     boundary and checks the contract names the signed-in organization; this
     read deliberately returns no matrix, bids or other suppliers' data. */
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/contract$/.test(path) && method === "GET") {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/contract$/);
    const cycle = cycles().find((c) => c.tenderId === ref);
    if (!cycle?.contract) return json({ error: `no contract is on record for "${ref}"` }, 404);
    return json({
      tenderId: ref,
      contract: cycle.contract,
      acceptance: {
        acceptedAt: cycle.contract.supplierAcceptedAt ?? null,
        signatory: cycle.contract.supplierSignatory ?? null,
        acceptanceHash: cycle.contract.acceptanceHash ?? null,
      },
    });
  }
  if (/^\/api\/procurement-file\/[A-Za-z0-9._-]+$/.test(path) && method === "GET") {
    try {
      return json(await procurementFile(tenderRef(/^\/api\/procurement-file\/([A-Za-z0-9._-]+)$/)));
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/procurement-file\/[A-Za-z0-9._-]+\/bundle$/.test(path) && method === "GET") {
    try {
      return json(await procurementBundle(tenderRef(/^\/api\/procurement-file\/([A-Za-z0-9._-]+)\/bundle$/)));
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/pipeline$/.test(path) && mustPost()) {
    try {
      return json(corePipelineEntry(body), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/pipeline\/[A-Za-z0-9._-]+\/link$/.test(path) && mustPost()) {
    try {
      return json(corePipelineLink(path.split("/")[3] ?? "", str(body.tenderId).trim(), workspaceId));
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  /* ── Requisition and budget validation (lifecycle stage 2) ─────────────────
     A planned entry is not publishable until an officer confirms the budget
     on the record. The confirmation is a named act, logged like every write. */
  if (/^\/api\/pipeline\/[A-Za-z0-9._-]+\/requisition$/.test(path) && mustPost()) {
    const id = path.split("/")[3] ?? "";
    const entry = pipelineRows().find((p) => p.id === id);
    if (!entry) return json({ error: "pipeline entry not found" }, 404);
    const actor = attestedActor || "officer";
    const validated = body.budgetValidated === true;
    const budgetReference = str(body.budgetReference).trim().slice(0, 120) || undefined;
    if (validated && !budgetReference) {
      return json({ error: "budgetReference is required when validating the budget — the record must point at the vote book line" }, 422);
    }
    entry.requisition = {
      budgetValidated: validated,
      ...(budgetReference ? { budgetReference } : {}),
      ...(validated ? { validatedBy: actor, validatedAt: new Date().toISOString() } : {}),
      ...(str(body.note).trim() ? { note: str(body.note).trim().slice(0, 300) } : {}),
    };
    saveState();
    appendLog({
      actor,
      server: "quorum-mcp",
      tool: "requisition_validate",
      kind: "WRITES",
      runId: "cycle",
      inputs: { pipelineId: entry.id, ref: entry.ref },
      outputs: { budgetValidated: entry.requisition.budgetValidated, budgetReference: entry.requisition.budgetReference ?? null },
      status: "OK",
      durationMs: 0,
    });
    return json({ entry });
  }
  /* ── Dissents and minority positions (committee decision support) ────────── */
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/dissents$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/dissents$/);
    const cycle = cycleFor(ref);
    const member = str(body.member).trim();
    const position = str(body.position);
    const basis = str(body.basis).trim();
    if (!member || member.length < 3) return json({ error: "member must name the committee member holding the position" }, 422);
    if (!["DISSENT", "ABSTAIN", "CONCUR_WITH_NOTES"].includes(position)) {
      return json({ error: "position must be DISSENT, ABSTAIN or CONCUR_WITH_NOTES" }, 422);
    }
    const stage = str(body.stage);
    if (!["EVALUATION_CERTIFICATION", "AWARD_REPORT", "CONTRACT_PACK"].includes(stage)) {
      return json({ error: "stage must be EVALUATION_CERTIFICATION, AWARD_REPORT or CONTRACT_PACK" }, 422);
    }
    if (basis.length < 10) return json({ error: "basis must state the reasons (at least 10 characters)" }, 422);
    const recordedBy = str(body.actor).trim().slice(0, 80) || member;
    const dissent = {
      id: `dis_${Math.random().toString(36).slice(2, 8)}`,
      stage: stage as "EVALUATION_CERTIFICATION" | "AWARD_REPORT" | "CONTRACT_PACK",
      member: member.slice(0, 80),
      position: position as "DISSENT" | "ABSTAIN" | "CONCUR_WITH_NOTES",
      basis: basis.slice(0, 2000),
      recordedAt: new Date().toISOString(),
      recordedBy,
    };
    cycle.dissents.push(dissent);
    saveState();
    appendLog({
      actor: recordedBy,
      server: "quorum-mcp",
      tool: "record_dissent",
      kind: "WRITES",
      runId: "cycle",
      inputs: { tenderId: ref, stage, member: dissent.member, position },
      outputs: { dissentId: dissent.id },
      status: "OK",
      durationMs: 0,
    });
    return json({ dissent }, 201);
  }
  /* ── Performance security (contract administration) ─────────────────────── */
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/contract\/security$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/contract\/security$/);
    const cycle = state.cycle.find((c) => c.tenderId === ref);
    if (!cycle?.contract) return json({ error: "no contract is open on this tender — security is held against an open contract" }, 409);
    const instrument = str(body.instrument);
    if (!["BANK_GUARANTEE", "INSURANCE_BOND", "CASH_DEPOSIT", "OTHER"].includes(instrument)) {
      return json({ error: "instrument must be BANK_GUARANTEE, INSURANCE_BOND, CASH_DEPOSIT or OTHER" }, 422);
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return json({ error: "amount must be a positive number" }, 422);
    const actor = str(body.actor).trim().slice(0, 80) || "officer";
    const security = {
      id: `sec_${Math.random().toString(36).slice(2, 8)}`,
      instrument: instrument as "BANK_GUARANTEE" | "INSURANCE_BOND" | "CASH_DEPOSIT" | "OTHER",
      amount,
      ...(str(body.currency).trim() ? { currency: str(body.currency).trim().slice(0, 8) } : {}),
      ...(str(body.provider).trim() ? { provider: str(body.provider).trim().slice(0, 120) } : {}),
      ...(str(body.reference).trim() ? { reference: str(body.reference).trim().slice(0, 120) } : {}),
      ...(str(body.validUntil).trim() ? { validUntil: str(body.validUntil).trim().slice(0, 10) } : {}),
      receivedAt: new Date().toISOString(),
    };
    cycle.contract.performanceSecurity.push(security);
    saveState();
    appendLog({
      actor,
      server: "quorum-mcp",
      tool: "performance_security_record",
      kind: "WRITES",
      runId: "cycle",
      inputs: { tenderId: ref, instrument, amount },
      outputs: { securityId: security.id },
      status: "OK",
      durationMs: 0,
    });
    return json({ security }, 201);
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/contract\/security\/[A-Za-z0-9._-]+\/verify$/.test(path) && mustPost()) {
    const match = path.match(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/contract\/security\/([A-Za-z0-9._-]+)\/verify$/);
    const cycle = state.cycle.find((c) => c.tenderId === (match?.[1] ?? ""));
    const security = cycle?.contract?.performanceSecurity.find((s) => s.id === match?.[2]);
    if (!security) return json({ error: "security record not found" }, 404);
    const actor = str(body.actor).trim().slice(0, 80);
    if (!actor) return json({ error: "actor must name the verifying officer — verification is a named act" }, 422);
    security.verifiedBy = actor;
    security.verifiedAt = new Date().toISOString();
    saveState();
    appendLog({
      actor,
      server: "quorum-mcp",
      tool: "performance_security_verify",
      kind: "WRITES",
      runId: "cycle",
      inputs: { tenderId: match?.[1], securityId: security.id },
      outputs: { verifiedAt: security.verifiedAt },
      status: "OK",
      durationMs: 0,
    });
    return json({ security });
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/closing$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/closing$/);
    const iso = parseClosingDate(`**Closing date:** ${str(body.closingDate)}`);
    if (!iso) return json({ error: "closingDate must be a parseable date" }, 422);
    const cycle = cycleFor(ref);
    cycle.closingDate = iso;
    cycle.closingSetBy = str(body.actor).trim().slice(0, 80) || "officer";
    cycle.closingSetAt = new Date().toISOString();
    appendLog({
      actor: cycle.closingSetBy,
      server: "quorum-mcp",
      tool: "set_closing_date",
      kind: "WRITES",
      runId: "cycle",
      inputs: { tenderId: ref },
      outputs: { closingDate: iso },
      status: "OK",
      durationMs: 0,
    });
    saveState();
    return json({ cycle });
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/method$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/method$/);
    try {
      return json(
        coreSetMethod(
          ref,
          {
            methodId: str(body.methodId).trim(),
            justification: str(body.justification),
            approvalRef: str(body.approvalRef),
            ...(body.estimatedValue !== undefined ? { estimatedValue: Number(body.estimatedValue) } : {}),
            ...(str(body.currency) ? { currency: str(body.currency) } : {}),
          },
          attestedActor || "officer",
        ),
        201,
      );
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/opening$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/opening$/);
    const bids = (Array.isArray(body.bids) ? body.bids : []).map((raw) => {
      const b = raw as Record<string, unknown>;
      return { bidder: str(b.bidder).trim(), receivedAt: str(b.receivedAt).trim(), ...(b.priceRead ? { priceRead: str(b.priceRead).trim().slice(0, 80) } : {}) };
    });
    try {
      return json(await coreRecordBidOpening(ref, bids), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/coi$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/coi$/);
    const rosterMember = roster?.find((entry) => entry.status === "PRESENT" && (entry.userId ?? entry.id) === attestedActorId);
    if (!attestedActorId || !rosterMember) return json({ error: "the signed-in account is not linked to a PRESENT committee seat" }, 403);
    const member = rosterMember.name.trim().slice(0, 80);
    if (body.member && str(body.member).trim().toLowerCase() !== member.toLowerCase()) return json({ error: "the declaration member must match the signed-in committee account" }, 403);
    const declaration = str(body.declaration) === "CONFLICT_DECLARED" ? "CONFLICT_DECLARED" : "NO_CONFLICT";
    const cycle = cycleFor(ref);
    const prior = cycle.coi.find((d) => d.memberId === rosterMember.id && d.signedByUserId === attestedActorId);
    /* Structured connections: names the screening can compare with the
       bidders and their beneficial owners. A blank row is not a disclosure. */
    const entitiesRaw = Array.isArray(body.entities) ? body.entities : [];
    const entities: CoiEntity[] = entitiesRaw
      .slice(0, 20)
      .map((entry): Record<string, unknown> =>
        entry && typeof entry === "object" ? (entry as Record<string, unknown>) : { name: entry },
      )
      .map((entry) => {
        const relationship = str(entry.relationship).trim();
        return {
          name: str(entry.name).trim().slice(0, 160),
          ...(relationship ? { relationship: relationship.slice(0, 160) } : {}),
          ...(entry.kind === "PERSON" ? { kind: "PERSON" as const } : {}),
        };
      })
      .filter((entity) => entity.name);
    if (entitiesRaw.length > 20) return json({ error: "At most 20 structured connections can be declared at once." }, 422);
    if (entitiesRaw.length > entities.length) return json({ error: "Every structured connection needs a name." }, 422);
    const record: CoiDeclaration = {
      id: prior?.id ?? `coi_${randomUUID().slice(0, 8)}`,
      tenderId: ref,
      member,
      memberId: rosterMember.id,
      signedByUserId: attestedActorId,
      declaration: declaration as "NO_CONFLICT" | "CONFLICT_DECLARED",
      ...(str(body.conflicts).trim() ? { conflicts: str(body.conflicts).trim().slice(0, 600) } : {}),
      ...(entities.length ? { entities } : {}),
      ...(body.recused === true ? { recused: true } : {}),
      declaredAt: new Date().toISOString(),
    };
    record.signature = shaOf({ ...record, signature: undefined });
    if (prior) cycle.coi.splice(cycle.coi.indexOf(prior), 1, record);
    else cycle.coi.push(record);
    appendLog({
      actor: member,
      server: "quorum-mcp",
      tool: "declare_coi",
      kind: "WRITES",
      runId: "cycle",
      inputs: { tenderId: ref, declaration },
      outputs: { coiId: record.id, conflicts: record.conflicts ? true : false, entities: entities.length, recused: record.recused === true },
      status: "OK",
      durationMs: 0,
    });
    saveState();
    return json({ declaration: record }, 201);
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/matrix$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/matrix$/);
    const criteria = (Array.isArray(body.criteria) ? body.criteria : []).map((raw) => {
      const c = raw as Record<string, unknown>;
      return { title: str(c.title), weight: Number(c.weight) };
    });
    try {
      return json(await coreBuildMatrix(ref, criteria, body.technicalWeightPct), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/matrix\/scores$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/matrix\/scores$/);
    const scores = (Array.isArray(body.scores) ? body.scores : []).map((raw) => {
      const s = raw as Record<string, unknown>;
      const decision: "CONFIRMED" | "REJECTED" | undefined = s.evidenceDecision === "CONFIRMED" || s.evidenceDecision === "REJECTED" ? s.evidenceDecision : undefined;
      return {
        criterionId: str(s.criterionId),
        score: Number(s.score),
        ...(s.note ? { note: str(s.note) } : {}),
        ...(decision ? { evidenceDecision: decision } : {}),
      };
    });
    try {
      return json(coreScoreMatrix(ref, str(body.bidder), scores, attestedActor || "web-app"));
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/matrix\/med$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/matrix\/med$/);
    const attendees = (Array.isArray(body.attendees) ? body.attendees : []).map((a) => str(a));
    try {
      return json(coreMed(ref, attendees, (body.adjustments ?? {}) as Record<string, number>, str(body.notes) || undefined));
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/matrix\/fx$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/matrix\/fx$/);
    try {
      return json(coreSetFx(ref, body.evaluationCurrency, Array.isArray(body.rates) ? body.rates : []), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/matrix\/financial-adjustments$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/matrix\/financial-adjustments$/);
    const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, 20).map((row) => row && typeof row === "object" ? row as Record<string, unknown> : {});
    try {
      return json(coreRecordFinancialAdjustments(ref, rows, attestedActorId, roster), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/matrix\/sheets$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/matrix\/sheets$/);
    const scores = (Array.isArray(body.scores) ? body.scores : []).map((raw) => {
      const s = raw as Record<string, unknown>;
      return { bidder: s.bidder, criterionId: s.criterionId, score: s.score, note: s.note };
    });
    try {
      return json(coreRecordSheet(ref, str(body.evaluator), scores, body.note, attestedActor || "web-app", attestedActorId, roster), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/matrix\/consensus$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/matrix\/consensus$/);
    const attendees = (Array.isArray(body.attendees) ? body.attendees : []).map((name) => str(name));
    try {
      return json(coreRecordConsensus(ref, attendees, str(body.notes), attestedActor || "web-app", attestedActorId, roster), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/matrix\/certify$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/matrix\/certify$/);
    try {
      return json(await coreCertifyMatrix(ref), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/alb$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/alb$/);
    try {
      return json(await coreOpenAlb(ref, str(body.bidder), str(body.findingId) || undefined, str(body.basis)), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/alb\/[A-Za-z0-9._-]+\/response$/.test(path) && mustPost()) {
    const match = path.match(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/alb\/([A-Za-z0-9._-]+)\/response$/)!;
    try {
      return json(coreRecordAlbResponse(decodeURIComponent(match[1]), decodeURIComponent(match[2]), attestedActor, str(body.response), str(body.evidenceRef)), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/alb\/[A-Za-z0-9._-]+\/no-response$/.test(path) && mustPost()) {
    const match = path.match(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/alb\/([A-Za-z0-9._-]+)\/no-response$/)!;
    try {
      return json(coreRecordAlbNoResponse(decodeURIComponent(match[1]), decodeURIComponent(match[2]), attestedActorId, attestedActor, roster), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/alb\/[A-Za-z0-9._-]+\/resolve$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/alb\/([A-Za-z0-9._-]+)\/resolve$/);
    const dossierId = decodeURIComponent(path.split("/")[5] ?? "");
    try {
      return json(await coreResolveAlb(ref, dossierId, str(body.outcome), str(body.note)), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/findings\/[A-Za-z0-9._-]+\/dispose$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/findings\/([A-Za-z0-9._-]+)\/dispose$/);
    const findingId = decodeURIComponent(path.split("/")[5] ?? "");
    try {
      return json(
        coreDisposeFinding(
          ref,
          findingId,
          { status: body.status, note: body.note, evidence: body.evidence, secondedBy: body.secondedBy },
          attestedActor || str(body.by) || "officer",
        ),
        201,
      );
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/award-report$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/award-report$/);
    try {
      return json(await coreAwardReport(ref), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/award-notice\/publish$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/award-notice\/publish$/);
    try {
  return json(await corePublishAwardNotice(ref, str(body.dispatchEvidenceRef)), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/standstill\/lift$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/standstill\/lift$/);
    const cycle = state.cycle.find((c) => c.tenderId === ref);
    if (!cycle?.standstill) return json({ error: "no standstill is running on this tender" }, 422);
    if (cycle.standstill.status !== "ACTIVE") return json({ error: `the standstill is already ${cycle.standstill.status}` }, 422);
    if (!standstillApplies(cycle)) return json({ error: "this procurement method is exempt from the section 71 standstill clock" }, 422);
    const block = standstillBlockReason(cycle);
    if (block) return json({ error: block }, 422);
    const gate = raiseCycleGate({
      tenderId: ref,
      workspaceId,
      tool: "lift_standstill",
      requiredOffice: "ACCOUNTING_OFFICER",
      inputs: { endsAt: cycle.standstill.endsAt, standstillStatus: cycle.standstill.status },
      note: "Mark the standstill elapsed after the statutory window and complaint checks pass",
    });
    return json({ gate: gate.id, standstill: cycle.standstill }, 202);
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/debrief$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/debrief$/);
    try {
      return json(await coreDraftDebrief(ref, str(body.bidder)), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/debrief\/[A-Za-z0-9._-]+\/issue$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/debrief\/([A-Za-z0-9._-]+)\/issue$/);
    const debriefId = decodeURIComponent(path.split("/")[5] ?? "");
    try {
      return json(coreIssueDebrief(ref, debriefId), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/contract\/pack$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/contract\/pack$/);
    try {
      return json(
        await coreContractPack(
          ref,
          str(body.budgetLineId).trim() || undefined,
          typeof body.retentionPct === "number" ? body.retentionPct : undefined,
        ),
        201,
      );
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/contract\/execute$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/contract\/execute$/);
    try {
      return json(
        coreExecuteContract(ref, {
          performanceSecurity: body.performanceSecurity as { amount?: unknown; issuer?: unknown; validUntil?: unknown; documentId?: unknown } | undefined,
          insurance: body.insurance as { policyNo?: unknown; issuer?: unknown; validUntil?: unknown; cover?: unknown } | undefined,
          retentionPct: body.retentionPct,
          warrantyDays: body.warrantyDays,
        }),
        201,
      );
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/contract\/acceptance$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/contract\/acceptance$/);
    try {
      return json(
        coreSupplierAcceptance(ref, attestedActor, str(body.signatory), str(body.copyHash) || undefined),
        201,
      );
    } catch (err) {
      return json({ error: (err as Error).message }, 401);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/contract\/milestones$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/contract\/milestones$/);
    const cycle = state.cycle.find((c) => c.tenderId === ref);
    if (!cycle?.contract) return json({ error: `no contract is open on "${ref}"` }, 422);
    const items = (Array.isArray(body.milestones) ? body.milestones : [body]).slice(0, 20);
    const added = items
      .map((raw) => raw as Record<string, unknown>)
      .filter((m) => str(m.title).trim())
      .map((m) => ({
        id: `mil_${randomUUID().slice(0, 8)}`,
        title: str(m.title).trim().slice(0, 200),
        ...(str(m.dueDate).trim() ? { dueDate: str(m.dueDate).trim() } : {}),
        status: "PENDING" as const,
      }));
    if (!added.length) return json({ error: "milestone title required" }, 422);
    cycle.contract.milestones.push(...added);
    appendLog({
      actor: "web-app",
      server: "quorum-mcp",
      tool: "add_milestones",
      kind: "WRITES",
      runId: "cycle",
      inputs: { tenderId: ref, count: added.length },
      outputs: { ids: added.map((m) => m.id) },
      status: "OK",
      durationMs: 0,
    });
    saveState();
    return json({ milestones: added }, 201);
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/contract\/milestones\/[A-Za-z0-9._-]+\/done$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/contract\/milestones\/([A-Za-z0-9._-]+)\/done$/);
    const milestoneId = decodeURIComponent(path.split("/")[5] ?? "");
    const cycle = state.cycle.find((c) => c.tenderId === ref);
    const milestone = cycle?.contract?.milestones.find((m) => m.id === milestoneId);
    if (!milestone) return json({ error: "milestone not found" }, 404);
    milestone.status = "DONE";
    milestone.doneAt = new Date().toISOString();
    appendLog({
      actor: "web-app",
      server: "quorum-mcp",
      tool: "complete_milestone",
      kind: "WRITES",
      runId: "cycle",
      inputs: { tenderId: ref, milestoneId },
      outputs: { status: "DONE" },
      status: "OK",
      durationMs: 0,
    });
    saveState();
    return json({ milestone });
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/contract\/variations$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/contract\/variations$/);
    try {
      return json(
        coreVariation(ref, str(body.description), Number(body.valueDelta), {
          legalAdviceRef: str(body.legalAdviceRef) || undefined,
          approvalReference: str(body.approvalReference) || undefined,
          by: attestedActor || str(body.by) || "officer",
        }),
        201,
      );
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/contract\/payments$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/contract\/payments$/);
    try {
      return json(
        corePayment(ref, str(body.description), Number(body.amount), {
          ...(str(body.currency) ? { currency: str(body.currency) } : {}),
          invoiceId: str(body.invoiceId) || undefined,
          milestoneId: str(body.milestoneId) || undefined,
          goodsReceiptId: str(body.goodsReceiptId) || undefined,
          ...(body.withholding !== undefined ? { withholding: Number(body.withholding) } : {}),
          ...(typeof body.retentionPct === "number" ? { retentionPct: body.retentionPct } : {}),
        }),
        201,
      );
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/contract\/complete$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/contract\/complete$/);
    try {
      return json(
        coreCompleteContract(ref, {
          certificateId: str(body.certificateId) || undefined,
          defectsLiabilityEndsAt: str(body.defectsLiabilityEndsAt) || undefined,
          performanceRating: body.performanceRating !== undefined ? Number(body.performanceRating) : undefined,
          note: str(body.note) || undefined,
        }),
        201,
      );
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/complaints$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/complaints$/);
    if (!str(body.complainant).trim() || !str(body.subject).trim()) return json({ error: "complainant and subject are required" }, 422);
    return json(coreComplaint(ref, str(body.complainant), str(body.subject), str(body.body)), 201);
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/complaints\/[A-Za-z0-9._-]+\/respond$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/complaints\/([A-Za-z0-9._-]+)\/respond$/);
    const complaintId = decodeURIComponent(path.split("/")[5] ?? "");
    try {
      return json(coreComplaintResponse(ref, complaintId, str(body.response)), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/complaints\/[A-Za-z0-9._-]+\/escalate$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/complaints\/([A-Za-z0-9._-]+)\/escalate$/);
    const complaintId = decodeURIComponent(path.split("/")[5] ?? "");
    try {
      return json(coreEscalateComplaint(ref, complaintId, str(body.reason)), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/complaints\/[A-Za-z0-9._-]+\/close$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/complaints\/([A-Za-z0-9._-]+)\/close$/);
    const complaintId = decodeURIComponent(path.split("/")[5] ?? "");
    try {
      return json(
        coreCloseComplaint(
          ref,
          complaintId,
          str(body.outcome),
          str(body.note),
          attestedActor || str(body.reviewer) || "reviewer",
        ),
        200,
      );
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/clarifications$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/clarifications$/);
    if (!str(body.question).trim()) return json({ error: "question is required" }, 422);
    return json(coreClarification(ref, str(body.question), str(body.askedBy) || undefined), 201);
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/clarifications\/[A-Za-z0-9._-]+\/answer$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/clarifications\/([A-Za-z0-9._-]+)\/answer$/);
    const clarificationId = decodeURIComponent(path.split("/")[5] ?? "");
    try {
      return json(coreAnswerClarification(ref, clarificationId, str(body.answer), str(body.answeredBy) || undefined), 200);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/addenda$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/addenda$/);
    if (!str(body.summary).trim()) return json({ error: "summary is required" }, 422);
    try {
      return json(coreAddendum(ref, str(body.summary), str(body.extendsClosingTo) || undefined), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/notices\/draft$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/notices\/draft$/);
    return json(coreDraftNotice(ref, body), 201);
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/notices\/[A-Za-z0-9._-]+\/publish$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/notices\/([A-Za-z0-9._-]+)\/publish$/);
    const noticeId = decodeURIComponent(path.split("/")[5] ?? "");
    const cycle = state.cycle.find((c) => c.tenderId === ref);
    const notice = cycle?.notices.find((n) => n.id === noticeId);
    if (!notice) return json({ error: "notice draft not found" }, 404);
    const missingNoticeFields = noticeFieldCheck(notice.md).filter((field) => !field.present);
    if (missingNoticeFields.length)
      return json({ error: `the notice is missing mandatory fields: ${missingNoticeFields.map((field) => field.field).join(", ")}`, code: "FIELDS_MISSING" }, 422);
    const criteriaError = validateCriteria(parseEvaluationCriteria(notice.md));
    if (criteriaError) {
      return json({
        error: `the notice cannot be published until its evaluation criteria are complete and sum to exactly 100: ${criteriaError}`,
        code: "EVALUATION_CRITERIA_MISSING",
      }, 422);
    }
    const disclosureError = validateCriteriaDisclosure(parseEvaluationCriteria(notice.md));
    if (disclosureError && !notice.issuedAt) {
      return json({
        error: `the notice cannot be published until every criterion states the bidder evidence or subcriteria and scoring method: ${disclosureError}`,
        code: "EVALUATION_DISCLOSURE_MISSING",
      }, 422);
    }
    const gate = raiseCycleGate({
      tenderId: ref,
      tool: "publish_notice",
      requiredOffice: "PROCUREMENT_UNIT",
      inputs: { noticeId },
      note: `Publish the tender notice to ${publicationLabel()}`
    });
    notice.gateId = gate.id;
    saveState();
    return json({ gate: gate.id }, 201);
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/specs\/draft$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/specs\/draft$/);
    try {
      return json(await coreDraftSpec(ref, str(body.brief)), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/specs\/criteria$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/specs\/criteria$/);
    try {
      return json(coreSetEvaluationCriteria(ref, body.criteria, body.procedure), 200);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  return null;
}

/* The seeded debarment register is re-exported so the analytics view can show
   its provenance next to the count. */
export { DEBARMENT_LIST };
export { debarmentFindings };
