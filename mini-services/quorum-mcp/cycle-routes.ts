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
  saveState,
  state,
  type Addendum,
  type AlbDossier,
  type BidOpeningRegister,
  type ContractPayment,
  type ContractVariation,
  type EvalMatrix,
  type Gate,
  type Office,
  type OpenBidInput,
  type RosterMemberForGate,
  type TenderCycle,
} from "./store";
import { loadPack, parseMarkdownBidValue } from "./engine";
import {
  ADDENDUM_MIN_NOTICE_DAYS,
  ALB_RESPONSE_DAYS,
  DEFAULT_TECH_WEIGHT_PCT,
  STANDSTILL_DAYS,
  addWorkingDays,
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
  composeDebriefLetter,
  contractValueCheck,
  cycleAnalytics,
  debarmentFindings,
  draftNoticeMd,
  noticeFieldCheck,
  parseClosingDate,
  scoreMatrix,
  validateCriteria,
  validateScores,
  variationNeedsGate,
  variationPctOfContract,
  responsivenessLadder,
  weightsSum,
} from "./cycle";
import { DEBARMENT_LIST } from "./debarment";
import { TENDER_REF_RE } from "./marketplace";
import { listSampleTenders } from "./samples";
import { llmConfigFromEnv, callLlama } from "./engine";

/* ── Small helpers ─────────────────────────────────────────────────────────── */

const str = (v: unknown) => (typeof v === "string" ? v : "");
const SAFE_REF = TENDER_REF_RE;

function cycleFor(tenderId: string): TenderCycle {
  const existing = state.cycle.find((c) => c.tenderId === tenderId);
  if (existing) return existing;
  const fresh: TenderCycle = {
    tenderId,
    coi: [],
    alb: [],
    debriefs: [],
    complaints: [],
    clarifications: [],
    addenda: [],
    notices: [],
    specs: [],
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
    return pack.notices.map((n) => parseClosingDate(n.text)).find(Boolean);
  } catch {
    return undefined;
  }
}

function raiseCycleGate(input: {
  tenderId: string;
  tool: string;
  requiredOffice?: Office;
  inputs: unknown;
  note?: string;
}): Gate {
  const gate: Gate = {
    id: `gate_${Math.random().toString(36).slice(2, 8)}`,
    runId: "cycle",
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

/* ── Pre-approval checks — refused BEFORE anything changes ─────────────────── */

export function preApprovalCheck(
  gate: Gate,
  approver: string,
  roster: RosterMemberForGate[],
  signedInAs?: string,
): string | null {
  /* Office-aware gates: a roster member must HOLD the required office. The
     signed-in officer is the gavel — the accounting officer's seat — and may
     always sign. FAIL CLOSED: a name that matches nobody on the register is
     refused with the office named, never waved through. A member with no
     office on the register fails closed too. */
  if (gate.requiredOffice) {
    const who = approver.trim().toLowerCase();
    const isOfficer = !!signedInAs?.trim() && signedInAs.trim().toLowerCase() === who;
    if (!isOfficer) {
      const member = roster.find((m) => m.name.trim().toLowerCase() === who);
      if (!member)
        return `${approver.trim()} is not on the committee register — this gate must be signed by the ${gate.requiredOffice.replace(/_/g, " ").toLowerCase()} (or the signed-in officer acting as the gavel).`;
      if (!member.office) return `${member.name} has no office on the committee register — set the member's office before they sign this gate.`;
      if (member.office !== gate.requiredOffice)
        return `${member.name} holds the ${member.office.replace(/_/g, " ").toLowerCase()} office — this gate must be signed by the ${gate.requiredOffice.replace(/_/g, " ").toLowerCase()}.`;
    }
  }
  const cycle = state.cycle.find((c) => c.tenderId === gate.tenderId);
  switch (gate.tool) {
    case "certify_evaluation": {
      if (!cycle) return null;
      /* Every PRESENT member must have declared conflicts before the matrix is certified. */
      const missing = roster
        .filter((m) => m.status === "PRESENT")
        .filter((m) => !cycle.coi.some((d) => d.member.toLowerCase() === m.name.toLowerCase()));
      if (missing.length)
        return `Conflict-of-interest declarations are outstanding for: ${missing.map((m) => m.name).join(", ")} — every PRESENT member must declare before the matrix is certified.`;
      return null;
    }
    case "sign_award_report": {
      if (cycle?.matrix && cycle.matrix.status === "DRAFT")
        return "The evaluation matrix is still a DRAFT — certify it (or replace it) before the award report is signed.";
      return null;
    }
    case "publish_award_notice": {
      if (!cycle?.awardReport?.signedAt) return "The award report has not been signed — the accounting officer must sign it before the notice is published.";
      return null;
    }
    case "issue_debrief": {
      if (!cycle?.awardNotice?.publishedAt) return "The notice of award has not been published — debrief letters follow publication.";
      return null;
    }
    case "sign_contract_pack": {
      if (cycle?.standstill && cycle.standstill.status === "ACTIVE") {
        return `The standstill window is ACTIVE until ${cycle.standstill.endsAt.slice(0, 10)} — the contract pack may be signed only after it lapses.`;
      }
      if (!cycle?.awardReport?.signedAt) return "The award report has not been signed — the contract pack follows the award.";
      /* A contract without a value is not a contract. The pack carries the
         winning bid's value; refuse to sign if it does not. */
      const contractValue = contractValueCheck((gate.inputs as { value?: unknown })?.value);
      if (!contractValue.ok) return contractValue.reason;
      return null;
    }
    case "certify_payment": {
      if (!cycle?.contract) return "No contract is open on this tender — payments certify against an open contract.";
      return null;
    }
    case "respond_complaint": {
      const id = (gate.inputs as { complaintId?: string })?.complaintId;
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
  const cycle = cycleFor(gate.tenderId);
  const who = gate.approver ?? "named human";
  switch (gate.tool) {
    case "record_bid_opening": {
      if (cycle.opening) {
        cycle.opening.certifiedAt = gate.decidedAt;
        cycle.opening.certifiedBy = who;
        cycle.opening.sha = shaOf({ rows: cycle.opening.rows, certifiedBy: who, certifiedAt: gate.decidedAt });
        saveState();
        return { registerId: cycle.opening.id, sha: cycle.opening.sha, admitted: cycle.opening.rows.filter((r) => !r.late).length };
      }
      return undefined;
    }
    case "certify_evaluation": {
      if (!cycle.matrix) return undefined;
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
      const outcome = input.outcome === "REJECTED" || input.outcome === "WITHDRAWN" ? input.outcome : "JUSTIFIED";
      dossier.resolution = {
        outcome,
        note: input.note ?? "",
        at: gate.decidedAt ?? new Date().toISOString(),
        by: who,
        gateId: gate.id,
      };
      saveState();
      return { dossierId: dossier.id, outcome: dossier.resolution.outcome };
    }
    case "sign_award_report": {
      if (!cycle.awardReport) return undefined;
      cycle.awardReport.signedAt = gate.decidedAt;
      cycle.awardReport.signedBy = who;
      saveState();
      return { sha: cycle.awardReport.sha, recommendation: cycle.awardReport.recommendation };
    }
    case "publish_award_notice": {
      if (!cycle.awardNotice) return undefined;
      const startsAt = gate.decidedAt ?? new Date().toISOString();
      cycle.awardNotice.publishedAt = startsAt;
      cycle.awardNotice.publishedBy = who;
      cycle.standstill = {
        tenderId: gate.tenderId,
        startsAt,
        endsAt: addWorkingDays(startsAt, STANDSTILL_DAYS),
        days: STANDSTILL_DAYS,
        status: "ACTIVE",
      };
      saveState();
      return { portal: cycle.awardNotice.portal, standstillEndsAt: cycle.standstill.endsAt };
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
      const input = gate.inputs as { supplier?: string; value?: unknown; currency?: string; packMd?: string };
      const contractValue = contractValueCheck(input.value);
      if (!contractValue.ok) throw new Error(contractValue.reason);
      cycle.contract = {
        tenderId: gate.tenderId,
        supplier: input.supplier ?? "—",
        value: contractValue.value,
        currency: input.currency,
        openedAt: gate.decidedAt ?? new Date().toISOString(),
        openedFromGate: gate.id,
        packMd: input.packMd,
        milestones: [],
        variations: [],
        payments: [],
      };
      saveState();
      return { supplier: cycle.contract.supplier, value: cycle.contract.value };
    }
    case "approve_variation": {
      const input = gate.inputs as { variationId?: string };
      const variation = cycle.contract?.variations.find((v) => v.id === input.variationId);
      if (!variation) return undefined;
      variation.status = "APPROVED";
      variation.decidedBy = who;
      saveState();
      return { variationId: variation.id, pct: variation.pctOfContract };
    }
    case "certify_payment": {
      const input = gate.inputs as { paymentId?: string };
      const payment = cycle.contract?.payments.find((p) => p.id === input.paymentId);
      if (!payment) return undefined;
      payment.certifiedAt = gate.decidedAt;
      payment.certifiedBy = who;
      saveState();
      return { paymentId: payment.id, amount: payment.amount };
    }
    case "record_contract_completion": {
      if (!cycle.contract) return undefined;
      cycle.contract.completedAt = gate.decidedAt;
      cycle.contract.completedBy = who;
      saveState();
      return { completedAt: cycle.contract.completedAt };
    }
    case "respond_complaint": {
      const input = gate.inputs as { complaintId?: string; response?: string };
      const complaint = cycle.complaints.find((c) => c.id === input.complaintId);
      if (!complaint) return undefined;
      complaint.response = { md: input.response ?? "", at: gate.decidedAt ?? new Date().toISOString(), by: who, gateId: gate.id };
      complaint.status = "ANSWERED";
      saveState();
      return { complaintId: complaint.id, status: "ANSWERED" };
    }
    case "publish_notice": {
      const input = gate.inputs as { noticeId?: string };
      const notice = cycle.notices.find((n) => n.id === input.noticeId);
      if (!notice) return undefined;
      notice.issuedAt = gate.decidedAt;
      notice.issuedBy = who;
      saveState();
      return { noticeId: notice.id, published: true, portal: "egp-portal (simulated)" };
    }
    default:
      return undefined;
  }
}

function rankedBidder(matrix: EvalMatrix): string | undefined {
  return [...matrix.bids]
    .filter((b) => b.responsiveness === "RESPONSIVE")
    .sort((a, b) => (b.total ?? 0) - (a.total ?? 0))[0]?.bidder;
}

/* ── Cores — shared by the REST routes and the MCP tool calls ──────────────── */

async function coreRecordBidOpening(tenderId: string, bids: OpenBidInput[]) {
  if (!SAFE_REF.test(tenderId)) throw new Error(`invalid tenderId: "${tenderId}"`);
  if (!Array.isArray(bids) || bids.length === 0) throw new Error("at least one bid row is required to open");
  if (bids.length > 20) throw new Error("at most 20 bids per opening register");
  const cycle = cycleFor(tenderId);
  if (cycle.opening?.certifiedAt) throw new Error(`the opening register for ${tenderId} is already certified — a certified register is not re-opened`);
  const closing = await closingOnRecord(tenderId, cycle);
  const { rows, lateCount } = buildOpeningRows(bids, closing);
  const openedAt = new Date().toISOString();
  const register: BidOpeningRegister = {
    id: `open_${Math.random().toString(36).slice(2, 8)}`,
    tenderId,
    createdAt: openedAt,
    ...(closing ? { closingDate: closing } : {}),
    rows,
    minutesMd: composeOpeningMinutes({ tenderId, closingDate: closing, rows, openedAt }),
  };
  cycle.opening = register;
  const gate = raiseCycleGate({
    tenderId,
    tool: "record_bid_opening",
    requiredOffice: "PROCUREMENT_UNIT",
    inputs: { registerId: register.id, bids: rows.length, late: lateCount },
    note: "Certify the public bid opening register",
  });
  register.gateId = gate.id;
  appendLog({
    actor: "quorum-agent",
    server: "quorum-mcp",
    tool: "record_bid_opening",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, bids: rows.length, closingDate: closing ?? "not on record" },
    outputs: { registerId: register.id, admitted: rows.length - lateCount, late: lateCount },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { register, gate: gate.id, lateCount };
}

async function coreBuildMatrix(tenderId: string, criteriaRaw: { title: unknown; weight: unknown }[], techWeightRaw: unknown) {
  if (!SAFE_REF.test(tenderId)) throw new Error(`invalid tenderId: "${tenderId}"`);
  const criteria = (Array.isArray(criteriaRaw) ? criteriaRaw : []).slice(0, 12).map((c, i) => ({
    id: `C-${String(i + 1).padStart(2, "0")}`,
    title: str(c?.title).trim().slice(0, 120),
    weight: Math.round(Number(c?.weight) * 10) / 10,
  }));
  const criteriaError = validateCriteria(criteria);
  if (criteriaError) throw new Error(criteriaError);
  let techWeight = Number(techWeightRaw);
  if (!Number.isFinite(techWeight)) techWeight = DEFAULT_TECH_WEIGHT_PCT;
  techWeight = Math.min(100, Math.max(0, Math.round(techWeight)));

  const { pack } = await loadPack(tenderId);
  if (pack.bids.length === 0) throw new Error(`no bids staged for tender "${tenderId}" — stage the pack first`);
  const cycle = cycleFor(tenderId);
  const run = state.runs.find((r) => r.tenderId === tenderId);
  const lateBy = new Map<string, boolean>((cycle.opening?.rows ?? []).map((r) => [r.bidder.toLowerCase(), r.late]));

  const bids = pack.bids.map((raw) => {
    /* The pack carries OCDS values; markdown bids state theirs on the value line —
       the same deep parse flagPack runs, so the matrix's financial column reads
       exactly what the review rules read. */
    const b = raw.value === undefined ? (() => { const v = parseMarkdownBidValue(raw.text); return v ? { ...raw, value: v.amount, currency: v.currency } : raw; })() : raw;
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
      technicalTotal: 0,
      financial: b.value !== undefined ? { amount: b.value, ...(b.currency ? { currency: b.currency } : {}) } : undefined,
      verdict: "NOT_RECOMMENDED" as const,
    };
  });
  const matrix: EvalMatrix = {
    id: `mtx_${Math.random().toString(36).slice(2, 8)}`,
    tenderId,
    ...(run ? { runId: run.id } : {}),
    criteria,
    technicalWeightPct: techWeight,
    bids,
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

function coreScoreMatrix(tenderId: string, bidder: string, scores: { criterionId: string; score: number; note?: string }[]) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (!cycle?.matrix) throw new Error(`no evaluation matrix on record for "${tenderId}" — build one first`);
  if (cycle.matrix.status === "CERTIFIED") throw new Error("the matrix is CERTIFIED — its scores are sealed; record a MED session instead");
  const row = cycle.matrix.bids.find((b) => b.bidder.toLowerCase() === bidder.trim().toLowerCase());
  if (!row) throw new Error(`bidder "${bidder}" is not on the matrix`);
  const err = validateScores(cycle.matrix.criteria, scores);
  if (err) throw new Error(err);
  row.technicalScores = scores.map((s) => ({ criterionId: s.criterionId, score: Math.round(Number(s.score) * 10) / 10, ...(s.note ? { note: str(s.note).slice(0, 200) } : {}) }));
  cycle.matrix = scoreMatrix(cycle.matrix);
  appendLog({
    actor: "web-app",
    server: "quorum-mcp",
    tool: "score_matrix",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, bidder },
    outputs: { technicalTotal: row.technicalTotal, total: row.total },
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
  if (!Array.isArray(attendees) || attendees.length === 0) throw new Error("at least one attendee is required for a MED session");
  const clean: Record<string, number> = {};
  for (const [key, value] of Object.entries(adjustments ?? {}).slice(0, 144)) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`adjustment "${key}" must be a score 0-100`);
    const [bidder, criterionId] = key.split("|");
    if (!bidder || !criterionId) throw new Error(`adjustment key "${key}" must be "<bidder>|<criterionId>"`);
    clean[key] = Math.round(n * 10) / 10;
  }
  cycle.matrix.med = {
    recordedAt: new Date().toISOString(),
    attendees: attendees.map((a) => str(a).trim().slice(0, 80)).filter(Boolean).slice(0, 12),
    adjustments: clean,
    ...(notes ? { notes: str(notes).slice(0, 400) } : {}),
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

async function coreCertifyMatrix(tenderId: string) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (!cycle?.matrix) throw new Error(`no evaluation matrix on record for "${tenderId}"`);
  if (cycle.matrix.status === "CERTIFIED") throw new Error("the matrix is already certified");
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

async function coreOpenAlb(tenderId: string, bidder: string, findingId?: string) {
  if (!SAFE_REF.test(tenderId)) throw new Error(`invalid tenderId: "${tenderId}"`);
  const cycle = cycleFor(tenderId);
  const run = state.runs.find((r) => r.tenderId === tenderId);
  const finding = run?.findings.find((f) => (findingId ? f.id === findingId : (f.rule === "R-PRICE-OUTLIER" || f.rule === "R-VALUE-OUTLIER") && f.item.toLowerCase().includes(bidder.trim().toLowerCase())));
  if (cycle.alb.some((a) => a.bidder.toLowerCase() === bidder.trim().toLowerCase() && !a.resolution))
    throw new Error(`an ALB dossier is already open for ${bidder}`);
  const dueAt = addWorkingDays(new Date().toISOString(), ALB_RESPONSE_DAYS);
  const dossier: AlbDossier = {
    id: `alb_${Math.random().toString(36).slice(2, 8)}`,
    tenderId,
    bidder: bidder.trim(),
    ...(finding ? { findingId: finding.id } : {}),
    openedAt: new Date().toISOString(),
    letterMd: composeAlbLetter({
      tenderId,
      bidder: bidder.trim(),
      finding: finding?.evidence ?? "the bid's pricing sits outside the peer range the guards accept",
      dueAt,
    }),
    responseDueAt: dueAt,
  };
  cycle.alb.push(dossier);
  appendLog({
    actor: "quorum-agent",
    server: "quorum-mcp",
    tool: "open_alb_dossier",
    kind: "WRITES",
    runId: "cycle",
    inputs: { tenderId, bidder, findingId: finding?.id },
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
  const gate = raiseCycleGate({
    tenderId,
    tool: "resolve_alb",
    requiredOffice: "EVALUATION_COMMITTEE",
    inputs: { dossierId, outcome, note: note.slice(0, 300) },
    note: "Record the abnormally-low-bid resolution",
  });
  return { gate: gate.id };
}

async function coreAwardReport(tenderId: string) {
  if (!SAFE_REF.test(tenderId)) throw new Error(`invalid tenderId: "${tenderId}"`);
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (!cycle?.matrix || cycle.matrix.status !== "CERTIFIED")
    throw new Error(`the evaluation matrix for "${tenderId}" is not certified — build and certify it before the award report`);
  const meta = await tenderMeta(tenderId);
  const run = state.runs.find((r) => r.tenderId === tenderId);
  const winner = rankedBidder(cycle.matrix);
  const winnerRow = cycle.matrix.bids.find((b) => b.bidder === winner);
  const { md, recommendation } = composeAwardReport({
    tenderId,
    ...(meta.title ? { title: meta.title } : {}),
    ...(meta.buyer ? { buyer: meta.buyer } : {}),
    matrix: cycle.matrix,
    findings: (run?.findings ?? []).map((f) => ({ rule: f.rule, item: f.item, severity: f.severity })),
    ...(winnerRow?.financial ? { value: `${winnerRow.financial.currency ?? ""} ${winnerRow.financial.amount.toLocaleString()}`.trim() } : {}),
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

async function corePublishAwardNotice(tenderId: string) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (!cycle?.awardReport?.signedAt) throw new Error("the award report must be signed before the notice is drafted");
  const meta = await tenderMeta(tenderId);
  const winner = cycle.awardReport.recommendation;
  const portal = "egp-portal (simulated)";
  const md = composeAwardNotice({
    tenderId,
    ...(meta.buyer ? { buyer: meta.buyer } : {}),
    ...(winner ? { supplier: winner } : {}),
    portal,
  });
  cycle.awardNotice = { tenderId, md, sha: shaOf(md), portal };
  const gate = raiseCycleGate({
    tenderId,
    tool: "publish_award_notice",
    requiredOffice: "ACCOUNTING_OFFICER",
    inputs: { sha: cycle.awardNotice.sha, portal },
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

async function coreContractPack(tenderId: string) {
  if (!SAFE_REF.test(tenderId)) throw new Error(`invalid tenderId: "${tenderId}"`);
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (cycle?.standstill && cycle.standstill.status === "ACTIVE")
    throw new Error(`the standstill window is ACTIVE until ${cycle.standstill.endsAt.slice(0, 10)} — the contract pack follows the window, not the middle of it`);
  if (!cycle?.awardReport?.signedAt) throw new Error("the award report must be signed before a contract pack is prepared");
  const winner = cycle.awardReport.recommendation;
  const winnerRow = cycle.matrix?.bids.find((b) => b.bidder === winner);
  /* The contract is opened from the winner's evaluated price. No price, no
     contract pack — a contract always has a contract value. */
  const contractValue = contractValueCheck(winnerRow?.financial?.amount);
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

function coreVariation(tenderId: string, description: string, valueDelta: number) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (!cycle?.contract) throw new Error(`no contract is open on "${tenderId}" — sign the contract pack first`);
  if (!Number.isFinite(valueDelta) || valueDelta === 0) throw new Error("valueDelta must be a non-zero number (negative for a downward variation)");
  const pct = variationPctOfContract(cycle.contract.value, valueDelta);
  const variation: ContractVariation = {
    id: `var_${Math.random().toString(36).slice(2, 8)}`,
    description: description.trim().slice(0, 300),
    valueDelta,
    pctOfContract: pct,
    status: "PENDING",
    at: new Date().toISOString(),
  };
  cycle.contract.variations.push(variation);
  let gate: string | undefined;
  if (variationNeedsGate(pct)) {
    gate = raiseCycleGate({
      tenderId,
      tool: "approve_variation",
      requiredOffice: "ACCOUNTING_OFFICER",
      inputs: { variationId: variation.id, description: variation.description, pctOfContract: pct, valueDelta },
      note: `Variation is ${pct}% of the contract value — accounting officer's signature required`,
    }).id;
    variation.gateId = gate;
  } else {
    variation.status = "APPROVED";
    variation.decidedBy = "within the procurement unit's variation authority (below the gate threshold)";
    appendLog({
      actor: "web-app",
      server: "quorum-mcp",
      tool: "request_variation",
      kind: "WRITES",
      runId: "cycle",
      inputs: { tenderId, description: variation.description },
      outputs: { variationId: variation.id, pctOfContract: pct, status: "APPROVED within authority" },
      status: "OK",
      durationMs: 0,
    });
  }
  saveState();
  return { variation, gate };
}

function corePayment(tenderId: string, description: string, amount: number, currency?: string) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (!cycle?.contract) throw new Error(`no contract is open on "${tenderId}"`);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("amount must be a positive number");
  const payment: ContractPayment = {
    id: `pay_${Math.random().toString(36).slice(2, 8)}`,
    description: description.trim().slice(0, 300),
    amount,
    ...(currency ? { currency } : cycle.contract.currency ? { currency: cycle.contract.currency } : {}),
  };
  cycle.contract.payments.push(payment);
  const gate = raiseCycleGate({
    tenderId,
    tool: "certify_payment",
    requiredOffice: "ACCOUNTING_OFFICER",
    inputs: { paymentId: payment.id, amount, description: payment.description },
    note: "Certify the payment before it leaves the desk",
  }).id;
  payment.gateId = gate;
  saveState();
  return { payment, gate };
}

function coreCompleteContract(tenderId: string, note?: string) {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  if (!cycle?.contract) throw new Error(`no contract is open on "${tenderId}"`);
  if (cycle.contract.completedAt) throw new Error("the contract is already completed");
  const gate = raiseCycleGate({
    tenderId,
    tool: "record_contract_completion",
    requiredOffice: "ACCOUNTING_OFFICER",
    inputs: { note: (note ?? "").slice(0, 300) },
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
  const addendum: Addendum = {
    id: `add_${Math.random().toString(36).slice(2, 8)}`,
    tenderId,
    number: cycle.addenda.length + 1,
    summary: summary.trim().slice(0, 600),
    issuedAt,
    ...(extendsClosingTo ? { extendsClosingTo: extendsClosingTo.trim() } : {}),
  };
  /* The fairness rule: an addendum inside the minimum-notice window must move
     the closing date, or it is flagged on the register — never silent. */
  if (closing && !extendsClosingTo) {
    const daysLeft = (new Date(closing).getTime() - new Date(issuedAt).getTime()) / 86_400_000;
    if (daysLeft < ADDENDUM_MIN_NOTICE_DAYS) addendum.closingExtensionRequired = true;
  }
  if (extendsClosingTo) {
    cycle.closingDate = extendsClosingTo.trim();
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

function coreDraftNotice(tenderId: string, fields: Record<string, unknown>) {
  if (!SAFE_REF.test(tenderId)) throw new Error(`invalid tenderId: "${tenderId}"`);
  const cycle = cycleFor(tenderId);
  const reference = str(fields.reference).trim() || tenderId;
  const buyer = str(fields.buyer).trim() || "—";
  const method = str(fields.method).trim() || "Open competitive selection";
  const subject = str(fields.subject).trim() || "—";
  const contact = str(fields.contact).trim() || "—";
  const closingDate = str(fields.closingDate).trim() || undefined;
  const ceiling = str(fields.ceiling).trim() || undefined;
  const requiredDocs = Array.isArray(fields.requiredDocs) ? fields.requiredDocs.map((d) => str(d)).filter(Boolean).slice(0, 12) : undefined;
  const md = draftNoticeMd({ reference, buyer, method, subject, contact, ...(closingDate ? { closingDate } : {}), ...(ceiling ? { ceiling } : {}), ...(requiredDocs ? { requiredDocs } : {}) });
  const draft = {
    id: `ntc_${randomUUID().slice(0, 8)}`,
    tenderId,
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
  const ref = provided || nextPipelineRef(input);
  const title = str(input.title).trim().slice(0, 200);
  if (!ref || !title) throw new Error("ref and title are required for a pipeline entry");
  const exists = [...state.pipeline.map((p) => p.ref), ...state.cycle.map((c) => c.tenderId), ...state.runs.map((r) => r.tenderId)]
    .some((r) => r.toLowerCase() === ref.toLowerCase());
  if (exists) throw new Error(`reference "${ref}" is already on record — wait for the system to issue the next one`);
  const entry = {
    id: `pip_${randomUUID().slice(0, 8)}`,
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
 * Officers do not invent references: a tender reference is an identifier the
 * register owns. The prefix follows the workspace currency (Zambia → ZM,
 * Kenya → KE, Rwanda → RW), the year follows the expected publication date,
 * and the sequence is the next free number across every live register —
 * pipeline, cycle and review runs — so two planners cannot collide.
 */
export function nextPipelineRef(input: Record<string, unknown>): string {
  const currency = str(input.currency).trim().toUpperCase();
  const byCurrency: Record<string, string> = { ZMW: "ZM", KES: "KE", RWF: "RW", USD: "ZM" };
  const prefix = (process.env.QUORUM_REF_PREFIX?.trim().toUpperCase() || byCurrency[currency] || "ZM").slice(0, 4);
  const publication = str(input.expectedPublication ?? input.publication).trim();
  const parsed = publication ? new Date(publication) : null;
  const year = parsed && !Number.isNaN(parsed.getTime()) ? parsed.getUTCFullYear() : new Date().getUTCFullYear();
  const matcher = new RegExp(`^${prefix}-${year}-(\\d{2,})$`, "i");
  const used = new Set<number>();
  for (const ref of [
    ...state.pipeline.map((p) => p.ref),
    ...state.cycle.map((c) => c.tenderId),
    ...state.runs.map((r) => r.tenderId),
  ]) {
    const match = ref.match(matcher);
    if (match) used.add(Number(match[1]));
  }
  let sequence = 1;
  while (used.has(sequence)) sequence += 1;
  return `${prefix}-${year}-${String(sequence).padStart(3, "0")}`;
}


function corePipelineLink(pipelineId: string, tenderId: string) {
  const entry = state.pipeline.find((p) => p.id === pipelineId);
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
      return coreOpenAlb(str(args.tenderId).trim(), str(args.bidder).trim(), str(args.findingId).trim() || undefined);
    case "draft_award_report":
      return coreAwardReport(str(args.tenderId).trim());
    case "publish_award_notice":
      return corePublishAwardNotice(str(args.tenderId).trim());
    case "prepare_contract_pack":
      return coreContractPack(str(args.tenderId).trim());
    case "request_variation":
      return coreVariation(str(args.tenderId).trim(), str(args.description), Number(args.valueDelta));
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
  const md = composeProcurementFile({
    tenderId,
    ...(meta.title ? { title: meta.title } : {}),
    ...(meta.buyer ? { buyer: meta.buyer } : {}),
    ...(cycle
      ? {
          cycle: {
            ...(cycle.closingDate ? { closingDate: cycle.closingDate } : {}),
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
      findings: r.findings.map((f) => ({ id: f.id, rule: f.rule, item: f.item, severity: f.severity, citation: f.citation })),
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
    generatedAt: new Date().toISOString(),
  });
  const log = await verifyToolLogFile();
  return { md, logVerified: { ok: log.ok, checked: log.checked } };
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
  const manifest = { tenderId, generatedAt, logVerified: file.logVerified, artifacts };
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

export async function handleCycleRoutes(path: string, method: string, body: Record<string, unknown>): Promise<Response | null> {
  const mustPost = () => method === "POST";
  const tenderRef = (re: RegExp) => decodeURIComponent(path.match(re)?.[1] ?? "");

  if (path === "/api/cycle" && method === "GET") {
    return json({ cycles: [...state.cycle].reverse(), pipeline: [...state.pipeline].reverse() });
  }
  if (path === "/api/cycle/analytics" && method === "GET") {
    return json(cycleAnalytics({ cycles: state.cycle, runs: state.runs }));
  }
  if (path === "/api/cycle/deadlines" && method === "GET") {
    return json({ deadlines: collectDeadlines(state.cycle) });
  }
  const tenderGet = path.match(/^\/api\/tenders\/([A-Za-z0-9._-]+)$/);
  if (tenderGet && method === "GET") {
    const tenderId = decodeURIComponent(tenderGet[1]);
    const cycle = state.cycle.find((c) => c.tenderId === tenderId);
    const pipeline = state.pipeline.find((p) => p.ref === tenderId || p.linkedTenderId === tenderId);
    if (!cycle && !pipeline) return json({ error: `no tender "${tenderId}" on record` }, 404);
    return json({
      tenderId,
      ...(pipeline ? { pipeline } : {}),
      ...(cycle ? { cycle } : {}),
      runs: state.runs.filter((r) => r.tenderId === tenderId).map((r) => ({ id: r.id, status: r.status, startedAt: r.startedAt })),
      gates: state.gates.filter((g) => g.tenderId === tenderId).map((g) => ({ id: g.id, tool: g.tool, status: g.status })),
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
      return json(corePipelineLink(path.split("/")[3] ?? "", str(body.tenderId).trim()));
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
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
    const member = str(body.member).trim().slice(0, 80);
    if (!member) return json({ error: "member (the declaring committee member's name) is required" }, 422);
    const declaration = str(body.declaration) === "CONFLICT_DECLARED" ? "CONFLICT_DECLARED" : "NO_CONFLICT";
    const cycle = cycleFor(ref);
    const prior = cycle.coi.find((d) => d.member.toLowerCase() === member.toLowerCase());
    const record = {
      id: prior?.id ?? `coi_${randomUUID().slice(0, 8)}`,
      tenderId: ref,
      member,
      declaration: declaration as "NO_CONFLICT" | "CONFLICT_DECLARED",
      ...(str(body.conflicts).trim() ? { conflicts: str(body.conflicts).trim().slice(0, 600) } : {}),
      declaredAt: new Date().toISOString(),
    };
    if (prior) cycle.coi.splice(cycle.coi.indexOf(prior), 1, record);
    else cycle.coi.push(record);
    appendLog({
      actor: member,
      server: "quorum-mcp",
      tool: "declare_coi",
      kind: "WRITES",
      runId: "cycle",
      inputs: { tenderId: ref, declaration },
      outputs: { coiId: record.id, conflicts: record.conflicts ? true : false },
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
      return { criterionId: str(s.criterionId), score: Number(s.score), ...(s.note ? { note: str(s.note) } : {}) };
    });
    try {
      return json(coreScoreMatrix(ref, str(body.bidder), scores));
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
      return json(await coreOpenAlb(ref, str(body.bidder), str(body.findingId) || undefined), 201);
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
      return json(await corePublishAwardNotice(ref), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/standstill\/lift$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/standstill\/lift$/);
    const cycle = state.cycle.find((c) => c.tenderId === ref);
    if (!cycle?.standstill) return json({ error: "no standstill is running on this tender" }, 422);
    if (cycle.standstill.status !== "ACTIVE") return json({ error: `the standstill is already ${cycle.standstill.status}` }, 422);
    const actor = str(body.actor).trim().slice(0, 80) || "officer";
    cycle.standstill.status = "LIFTED";
    appendLog({
      actor,
      server: "quorum-mcp",
      tool: "lift_standstill",
      kind: "WRITES",
      runId: "cycle",
      inputs: { tenderId: ref },
      outputs: { status: "LIFTED" },
      status: "OK",
      durationMs: 0,
    });
    saveState();
    return json({ standstill: cycle.standstill });
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
      return json(await coreContractPack(ref), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
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
      return json(coreVariation(ref, str(body.description), Number(body.valueDelta)), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/contract\/payments$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/contract\/payments$/);
    try {
      return json(corePayment(ref, str(body.description), Number(body.amount), str(body.currency) || undefined), 201);
    } catch (err) {
      return json({ error: (err as Error).message }, 422);
    }
  }
  if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/contract\/complete$/.test(path) && mustPost()) {
    const ref = tenderRef(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/contract\/complete$/);
    try {
      return json(coreCompleteContract(ref, str(body.note) || undefined), 201);
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
    return json(coreAddendum(ref, str(body.summary), str(body.extendsClosingTo) || undefined), 201);
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
    if (notice.fieldCheck.some((f) => !f.present))
      return json({ error: `the notice is missing mandatory fields: ${notice.fieldCheck.filter((f) => !f.present).map((f) => f.field).join(", ")}`, code: "FIELDS_MISSING" }, 422);
    const gate = raiseCycleGate({
      tenderId: ref,
      tool: "publish_notice",
      requiredOffice: "PROCUREMENT_UNIT",
      inputs: { noticeId },
      note: "Publish the tender notice to the e-GP (simulated)",
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
  return null;
}

/* The seeded debarment register is re-exported so the analytics view can show
   its provenance next to the count. */
export { DEBARMENT_LIST };
export { debarmentFindings };
