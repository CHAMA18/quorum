"use client";

/**
 * CycleView — the tender cycle, every phase from solicitation to closure.
 *
 * Wave 1-3 of the procurement-cycle build, one desk view: pipeline (G17),
 * deadlines (G16), bid opening (G3/G8), COI + evaluation matrix + MED
 * (G1/G2/G4), ALB (G9), award report + notice + standstill + debriefs
 * (G6/G7), contract pack + register (G12/G13), complaints (G14) and the
 * analytics/procurement-file read-side (G15/G5).
 *
 * Every action here calls the quorum-mcp sidecar through the gateway —
 * the same cores the MCP tools call — and irreversible steps always land
 * in the Approvals queue for a named human with the right office.
 *
 * The shell is a live instrument: the cycle rail summarizes the tender's
 * recorded progress, the sidebar owns page navigation, and the vitals strip
 * reads the desk's numbers. Both themes are first-class — every raw colour
 * carries a dark variant, tokens do the rest.
 */

import { cloneElement, isValidElement, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  Copy,
  Download,
  ExternalLink,
  FileSignature,
  FileText,
  Flag,
  Gavel,
  Loader2,
  Play,
  Plus,
  Scale,
  Search,
  Stamp,
  Trash2,
  Upload,
  Workflow,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { trapTabFocus } from "@/lib/a11y";
import { isSystemReference, systemReferenceLabel } from "@/lib/system-reference";
import {
  REQUIRED_DOCUMENT_GROUPS,
  STANDARD_REQUIRED_DOCUMENTS,
} from "@/lib/required-bid-documents";
import { StoredDocsBrowser } from "@/components/quorum/stored-docs-browser";
import { HorizontalScrollRegion } from "@/components/quorum/horizontal-scroll-region";

const SVC = "?XTransformPort=3031";
const DEFAULT_METHOD_ID = "open-national-bidding";
const canonicalMethodId = (methodId?: string) =>
  methodId === "open-bidding" ? "open-national-bidding" : methodId === "open-selection" ? "open-national-selection" : methodId ?? DEFAULT_METHOD_ID;
const isDefaultBiddingMethod = (methodId?: string) =>
  ["open-national-bidding", "open-international-bidding"].includes(canonicalMethodId(methodId));
const scopeForMethodId = (methodId: string): "National" | "International" | undefined =>
  methodId.includes("-international-") ? "International" : methodId.includes("-national-") ? "National" : undefined;
const tenderReferenceLabel = (tender?: { systemReference?: string; source?: "sample" | "record" }) =>
  isSystemReference(tender?.systemReference)
    ? systemReferenceLabel(tender.systemReference)
    : tender?.source === "sample" ? "BUILT-IN SAMPLE PACK" : "SYSTEM REFERENCE PENDING";
const EASE = [0.22, 1, 0.36, 1] as const;

/* The evaluation-criteria table is authored in the specification and carried
   into the notice unchanged. Read it with the same rules the sidecar applies
   at publication, so the desk sees the exact criteria the gate will test. */
type EvaluationCriterion = {
  id: string;
  title: string;
  weight: number;
  evidence?: string;
  scoringMethod?: string;
};
const EVALUATION_CRITERIA_EXAMPLES = [
  "Technical quality and performance",
  "Implementation approach and work plan",
  "Delivery schedule and deployment",
  "Life-cycle cost and maintenance",
  "Environmental or sustainability outcome",
  "After-sales support and warranty",
  "Cybersecurity and privacy safeguards",
];

function reindexEvaluationCriteria(criteria: EvaluationCriterion[]): EvaluationCriterion[] {
  return criteria.map((criterion, index) => ({
    ...criterion,
    id: `C-${String(index + 1).padStart(2, "0")}`,
  }));
}

function parseEvaluationCriteriaMarkdown(markdown: string): EvaluationCriterion[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  const heading = lines.findIndex((line) => /^#{1,6}\s+(?:\d+\.?\s*)?evaluation criteria\b/i.test(line.trim()));
  if (heading < 0) return [];
  const criteria: EvaluationCriterion[] = [];
  let criterionColumn = 0;
  let weightColumn = 1;
  let evidenceColumn = -1;
  let scoringMethodColumn = -1;
  for (const line of lines.slice(heading + 1)) {
    const trimmed = line.trim();
    if (/^#{1,6}\s/.test(trimmed)) break;
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
      if (criteria.length) break;
      continue;
    }
    const cells = trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
    if (cells.length < 2 || cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
    const isCriterionHeader = (cell: string) => /\b(?:criterion|criteria|title)\b/i.test(cell);
    if (cells.some(isCriterionHeader) && cells.some((cell) => /weight|percentage/i.test(cell))) {
      criterionColumn = Math.max(0, cells.findIndex(isCriterionHeader));
      weightColumn = cells.findIndex((cell) => /weight|percentage/i.test(cell));
      evidenceColumn = cells.findIndex((cell) => /evidence|basis|subcriteria/i.test(cell));
      scoringMethodColumn = cells.findIndex((cell) => /scoring method|score method/i.test(cell));
      continue;
    }
    const title = cells[criterionColumn] ?? "";
    const weight = cells[weightColumn]?.match(/^(\d+(?:\.\d+)?)\s*%?$/);
    if (!title || !weight) continue;
    criteria.push({
      id: `C-${String(criteria.length + 1).padStart(2, "0")}`,
      title: title.slice(0, 120),
      weight: Number(weight[1]),
      evidence: evidenceColumn >= 0 ? (cells[evidenceColumn] ?? "") : "",
      scoringMethod: scoringMethodColumn >= 0 ? (cells[scoringMethodColumn] ?? "") : "",
    });
  }
  return criteria;
}

function parseEvaluationProcedureMarkdown(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const heading = lines.findIndex((line) => /^#{1,6}\s+(?:\d+\.?\s*)?evaluation criteria\b/i.test(line.trim()));
  if (heading < 0) return "";
  const nextHeading = lines.findIndex((line, index) => index > heading && /^#{1,6}\s/.test(line.trim()));
  const procedureLine = lines
    .slice(heading + 1, nextHeading < 0 ? lines.length : nextHeading)
    .find((line) => /^\*\*Evaluation procedure:\*\*/i.test(line.trim()));
  return procedureLine?.trim().replace(/^\*\*Evaluation procedure:\*\*\s*/i, "") ?? "";
}

const OFFICES = ["PROCUREMENT_UNIT", "EVALUATION_COMMITTEE", "ACCOUNTING_OFFICER", "OVERSIGHT"] as const;
const CURRENCIES = ["ZMW", "KES", "USD", "RWF"] as const;
const MAX_REQUIRED_DOCUMENTS = 100;

function RequiredDocumentToggle({
  document,
  checked,
  disabled,
  onCheckedChange,
}: {
  document: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={`Require ${document}`}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "focus-brand flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-70",
        checked ? "bg-emerald-500/[0.07] dark:bg-emerald-400/[0.07]" : "hover:bg-ink-50 dark:hover:bg-white/[0.035]",
      )}
    >
      <span className="text-[13px] leading-snug text-ink-800 dark:text-[#e3e6eb]">{document}</span>
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-colors",
          checked
            ? "bg-emerald-600 dark:border-emerald-300/70 dark:bg-emerald-600"
            : "bg-ink-300 dark:border-[#69717e] dark:bg-[#46505d]",
        )}
      >
        <span
          className={cn(
            "absolute left-1 size-4 rounded-full bg-white shadow-sm transition-transform",
            checked && "translate-x-5",
          )}
        />
      </span>
    </button>
  );
}

function requiredDocumentsFromNotice(md?: string): string[] {
  if (!md) return [];
  return [...md.matchAll(/^- \[REQUIRED\]\s*(.+)$/gm)]
    .map((match) => match[1].trim())
    .filter((document) => document && !document.startsWith("(none listed"));
}

const OFFICE_LABELS: Record<string, string> = {
  PROCUREMENT_UNIT: "Procurement unit",
  EVALUATION_COMMITTEE: "Evaluation committee",
  ACCOUNTING_OFFICER: "Accounting officer",
  OVERSIGHT: "Oversight / audit",
};
const OFFICE_BLURBS: Record<string, string> = {
  PROCUREMENT_UNIT: "Runs the pack and keeps the file.",
  EVALUATION_COMMITTEE: "Scores the bids and certifies the matrix.",
  ACCOUNTING_OFFICER: "Signs the award and the contract.",
  OVERSIGHT: "Reads the record; never writes it.",
};

type OpeningRow = { id: string; bidder: string; receivedAt: string; late: boolean; priceRead?: string };
type PortalAppRow = {
  id: string;
  tenderId: string;
  orgName: string;
  amount?: number;
  currency?: string;
  sealed?: boolean;
  receiptId?: string;
  receivedAt: string;
  status: string;
};
type OpeningDto = {
  id: string;
  closingDate?: string;
  rows: OpeningRow[];
  reconciliation?: {
    sealed: number;
    manual: number;
    derived: number;
    withdrawn: number;
    amended: number;
    missingFromRegister?: string[];
    extraInRegister?: string[];
    matches: boolean;
    note: string;
  };
  minutesMd?: string;
  certifiedAt?: string;
  certifiedBy?: string;
  sha?: string;
  gateId?: string;
};
type EvalSheetDto = {
  id: string;
  evaluator: string;
  version: number;
  submittedAt: string;
  submittedBy: string;
  note?: string;
  signature: string;
  scores: { bidder: string; criterionId: string; score: number; note?: string }[];
};
type EvalDivergenceDto = {
  bidder: string;
  criterionId: string;
  min: number;
  max: number;
  spread: number;
  values: { evaluator: string; score: number }[];
};
type EvalConsensusDto = {
  matrixId: string;
  attendees: string[];
  notes: string;
  divergences: EvalDivergenceDto[];
  recordedBy: string;
  recordedAt: string;
  signature: string;
};
type FxRateDto = { base: string; quote: string; rate: number; source: string; asOf: string };
type MatrixDto = {
  id: string;
  criteriaNoticeId?: string;
  scoringStartedAt?: string;
  scoringBasisBlockReason?: string | null;
  status: "DRAFT" | "CERTIFIED";
  criteria: { id: string; title: string; weight: number; evidence?: string; scoringMethod?: string }[];
  technicalWeightPct: number;
  financialFormula?: string;
  preferenceScheme?: string;
  foreignBiddersPermitted?: boolean;
  cdfReservationExceptionRef?: string;
  cdfReservationConstituency?: string;
  financialAdjustmentsCertifiedAt?: string;
  bids: {
    bidder: string;
    late: boolean;
    albOpen?: boolean;
    responsiveness: string;
    reasons: string[];
    priceSignals?: { item: string; source: string; ratioToPeerMedian?: number; peerMedian?: number; currency?: string }[];
    technicalScores: { criterionId: string; score: number; note?: string }[];
    technicalTotal: number;
    financial?: {
      amount: number;
      currency?: string;
      formulaScore?: number;
      evaluatedAmount?: number;
      evaluatedCurrency?: string;
      correctedAmount?: number;
      preferenceAdjustedAmount?: number;
      adjustments?: {
        arithmeticCorrection?: number;
        unconditionalDiscount?: number;
        otherAdjustment?: number;
        preferencePct?: number;
        preferenceScheme?: string;
        reservationEligible?: boolean;
        evidenceRef: string;
        verifiedBy: string;
      };
      fxRate?: number;
      fxSource?: string;
      fxAsOf?: string;
      fxError?: string;
    };
    total?: number;
    verdict: string;
  }[];
  evaluationCurrency?: string;
  fxRates?: FxRateDto[];
  sheets?: EvalSheetDto[];
  consensus?: EvalConsensusDto;
  med?: { recordedAt: string; attendees: string[]; adjustments?: Record<string, number>; notes?: string };
  certifiedBy?: string;
};
type FindingDto = {
  id: string;
  rule: string;
  severity: string;
  item: string;
  evidence: string;
  citation: string;
  disposition?: { status: string; by: string; note: string; at: string; secondedBy?: string };
};
type CycleDto = {
  tenderId: string;
  systemReference?: string;
  findings?: FindingDto[];
  blockers?: string[];
  methodId?: string;
  methodJustification?: string;
  methodCurrency?: string;
  methodApprovalRef?: string;
  methodApprovedBy?: string;
  methodApprovedAt?: string;
  methodGateId?: string;
  method?: MethodStandingDto;
  assurance?: AssuranceDto | null;
  closingDate?: string;
  opening?: OpeningDto;
  coi: {
    id: string;
    member: string;
    declaration: string;
    conflicts?: string;
    entities?: { name: string; relationship?: string; kind?: "ENTITY" | "PERSON" }[];
    recused?: boolean;
    declaredAt: string;
  }[];
  matrix?: MatrixDto;
  alb: {
    id: string;
    bidder: string;
    openingBasis?: string;
    openedAt?: string;
    findingId?: string;
    responseDueAt: string;
    response?: { text?: string; evidenceRef: string; receivedAt: string; submittedByOrg?: string; receiptHash?: string };
    noResponseRecordedAt?: string;
    noResponseRecordedBy?: string;
    resolution?: { outcome: string; note: string };
  }[];
  awardReport?: { sha: string; recommendation?: string; signedAt?: string; signedBy?: string };
  awardNotice?: { portal: string; publishedAt?: string; dispatchedTo?: string[]; dispatchEvidenceRef?: string; dispatchedAt?: string; standstillExemptReason?: string };
  standstill?: { startsAt: string; endsAt: string; days: number; status: string };
  debriefs: { id: string; bidder: string; status: string }[];
  contract?: {
    supplier: string;
    value: number;
    currency?: string;
    status?: "DRAFT" | "EXECUTED" | "COMPLETED";
    executedAt?: string;
    supplierAcceptedAt?: string;
    supplierSignatory?: string;
    /* The security declared at execution, and the instruments received against
       the contract afterwards — two different records, both on the file. */
    security?: { amount: number; issuer: string; validUntil: string; documentId?: string };
    performanceSecurity?: {
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
    }[];
    insurance?: { policyNo: string; issuer: string; validUntil: string };
    retentionPct?: number;
    warrantyDays?: number;
    completedAt?: string;
    completion?: { certificateId: string; defectsLiabilityEndsAt: string; performanceRating: number };
    milestones: { id: string; title: string; dueDate?: string; status: string }[];
    variations: { id: string; description: string; pctOfContract: number; cumulativePct?: number; status: string; valueDelta: number }[];
    payments: {
      id: string;
      description: string;
      amount: number;
      gross?: number;
      retention?: number;
      net?: number;
      status?: string;
      invoiceId?: string;
      milestoneId?: string;
      goodsReceiptId?: string;
      certifiedAt?: string;
    }[];
  };
  complaints: {
    id: string;
    complainant: string;
    subject: string;
    body: string;
    status: "OPEN" | "ANSWERED" | "ESCALATED" | "CLOSED" | "WITHDRAWN";
    duringStandstill: boolean;
    receivedAt: string;
    acknowledgedAt?: string;
    response?: { md: string; at: string; by: string; gateId?: string };
    escalationReason?: string;
    escalatedAt?: string;
    independentReview?: { reviewer: string; at: string; outcome: string; note: string };
    closedAt?: string;
    closedBy?: string;
  }[];
  clarifications: { id: string; question: string; askedBy: string; answer?: string }[];
  addenda: { id: string; number: number; summary: string; extendsClosingTo?: string; closingExtensionRequired?: boolean }[];
  notices: {
    id: string;
    reference?: string;
    md: string;
    fieldCheck: { field: string; present: boolean }[];
    evaluationCriteria?: EvaluationCriterion[];
    createdAt: string;
    gateId?: string;
    issuedAt?: string;
    issuedBy?: string;
  }[];
  specs: { id: string; md: string; source: "llm" | "template"; model?: string; createdAt: string }[];
  dissents: {
    id: string;
    stage: "EVALUATION_CERTIFICATION" | "AWARD_REPORT" | "CONTRACT_PACK";
    member: string;
    position: "DISSENT" | "ABSTAIN" | "CONCUR_WITH_NOTES";
    basis: string;
    recordedAt: string;
    recordedBy?: string;
  }[];
};
type PipelineDto = {
  id: string;
  ref: string;
  systemReference?: string;
  title: string;
  office?: string;
  budgetEstimate?: number;
  currency?: string;
  expectedPublication?: string;
  status: string;
  linkedTenderId?: string;
  requisition?: {
    budgetValidated: boolean;
    budgetReference?: string;
    validatedBy?: string;
    validatedAt?: string;
    note?: string;
  };
};
type DeadlineDto = { tenderId: string; kind: string; dueAt: string; ref?: string; overdue?: boolean };
type QuarterlyPeriodDto = {
  year: number;
  quarter: number;
  startsAt: string;
  endsAt: string;
  digest: string;
  status: "OPEN" | "READY" | "PENDING_GATE" | "SUBMITTED";
  entries: {
    tenderId: string;
    type: "VARIATION" | "PREFERENCE_AWARD";
    reference: string;
    date: string;
    supplier?: string;
    amount?: number;
    currency?: string;
    scheme?: string;
  }[];
  report?: {
    id: string;
    status: "PENDING_GATE" | "SUBMITTED";
    submissionReference: string;
    evidenceReference: string;
    requestedAt: string;
    gateId?: string;
    submittedAt?: string;
    submittedBy?: string;
  };
};
type BudgetLineDto = {
  id: string;
  fiscalYear: number;
  code: string;
  currency: string;
  approved: number;
  committed: number;
  spent: number;
};
type MemberDto = { name: string; office?: string; status: "PRESENT" | "EXCUSED" };
type MethodDto = {
  id: string;
  name: string;
  group: string;
  legalBasis: string;
  when: string;
  valueBand?: string;
  awardAuthorisation: string;
  advertising: string;
};
type MethodStandingDto = {
  methodId: string | null;
  name: string | null;
  legalBasis: string | null;
  when: string | null;
  valueBand: string | null;
  justification: string | null;
  approvalRef: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  ok: boolean;
  block: string | null;
};
type VerificationDto = {
  status: "VERIFIED" | "FAILED";
  registryStatus: string;
  taxStatus: string;
  beneficialOwners: { name: string; role?: string; ownershipPct?: number; nationality?: string; idNo?: string }[];
  sanctions: string;
  pep: string;
  sanctionsMatches?: string[];
  pepMatches?: string[];
  documents: { id: string; kind: string; reference?: string; expiresAt?: string }[];
  checkedAt: string;
  expiresAt: string;
  source: string;
  checkedBy: string;
  notes?: string;
};
type AssuranceDto = {
  supplier: string | null;
  supplierId: string | null;
  expectedSupplier: string;
  status: "VERIFIED" | "FAILED" | "UNVERIFIED";
  failures: string[];
  verification: VerificationDto | null;
};

/* A cycle row is written by several cores over time; a partially-written row
   can omit any of its nested collections. Normalize once at ingest so every
   tab reads real arrays instead of a maybe. */
function normalizeCycle(raw: CycleDto): CycleDto {
  const opening = raw.opening
    ? {
        ...raw.opening,
        rows: Array.isArray(raw.opening.rows) ? raw.opening.rows : [],
        minutesMd: typeof raw.opening.minutesMd === "string" ? raw.opening.minutesMd : "",
        ...(raw.opening.reconciliation
          ? {
              reconciliation: {
                ...raw.opening.reconciliation,
                missingFromRegister: Array.isArray(raw.opening.reconciliation.missingFromRegister)
                  ? raw.opening.reconciliation.missingFromRegister
                  : [],
                extraInRegister: Array.isArray(raw.opening.reconciliation.extraInRegister)
                  ? raw.opening.reconciliation.extraInRegister
                  : [],
              },
            }
          : {}),
      }
    : undefined;
  const matrix = raw.matrix
    ? {
        ...raw.matrix,
        criteria: Array.isArray(raw.matrix.criteria) ? raw.matrix.criteria : [],
        bids: (Array.isArray(raw.matrix.bids) ? raw.matrix.bids : []).map((bid) => ({
          ...bid,
          reasons: Array.isArray(bid.reasons) ? bid.reasons : [],
          technicalScores: Array.isArray(bid.technicalScores) ? bid.technicalScores : [],
        })),
        ...(raw.matrix.med
          ? {
              med: {
                ...raw.matrix.med,
                attendees: Array.isArray(raw.matrix.med.attendees) ? raw.matrix.med.attendees : [],
              },
            }
          : {}),
        sheets: Array.isArray(raw.matrix.sheets) ? raw.matrix.sheets : [],
        fxRates: Array.isArray(raw.matrix.fxRates) ? raw.matrix.fxRates : [],
        ...(raw.matrix.consensus
          ? {
              consensus: {
                ...raw.matrix.consensus,
                attendees: Array.isArray(raw.matrix.consensus.attendees) ? raw.matrix.consensus.attendees : [],
                divergences: Array.isArray(raw.matrix.consensus.divergences) ? raw.matrix.consensus.divergences : [],
              },
            }
          : {}),
      }
    : undefined;
  const contract = raw.contract
    ? {
        ...raw.contract,
        milestones: Array.isArray(raw.contract.milestones) ? raw.contract.milestones : [],
        variations: Array.isArray(raw.contract.variations) ? raw.contract.variations : [],
        payments: Array.isArray(raw.contract.payments) ? raw.contract.payments : [],
        performanceSecurity: Array.isArray(raw.contract.performanceSecurity) ? raw.contract.performanceSecurity : [],
      }
    : undefined;
  const findings = Array.isArray(raw.findings) ? raw.findings : [];

  return {
    ...raw,
    coi: Array.isArray(raw.coi) ? raw.coi : [],
    alb: Array.isArray(raw.alb) ? raw.alb : [],
    debriefs: Array.isArray(raw.debriefs) ? raw.debriefs : [],
    complaints: Array.isArray(raw.complaints) ? raw.complaints : [],
    clarifications: Array.isArray(raw.clarifications) ? raw.clarifications : [],
    addenda: Array.isArray(raw.addenda) ? raw.addenda : [],
    notices: Array.isArray(raw.notices) ? raw.notices : [],
    specs: Array.isArray(raw.specs) ? raw.specs : [],
    dissents: Array.isArray(raw.dissents) ? raw.dissents : [],
    ...(opening ? { opening } : {}),
    ...(matrix ? { matrix } : {}),
    ...(contract ? { contract } : {}),
    findings,
  };
}

/** The spreads across evaluator sheets, widest first — the committee's agenda. */
function sheetDivergences(sheets: EvalSheetDto[]): EvalDivergenceDto[] {
  const cells = new Map<string, EvalDivergenceDto>();
  for (const sheet of sheets) {
    for (const score of sheet.scores) {
      const key = `${score.bidder.toLowerCase()}\u0000${score.criterionId}`;
      const cell = cells.get(key) ?? {
        bidder: score.bidder,
        criterionId: score.criterionId,
        min: score.score,
        max: score.score,
        spread: 0,
        values: [] as { evaluator: string; score: number }[],
      };
      cell.min = Math.min(cell.min, score.score);
      cell.max = Math.max(cell.max, score.score);
      cell.spread = Math.round((cell.max - cell.min) * 10) / 10;
      cell.values.push({ evaluator: sheet.evaluator, score: score.score });
      cells.set(key, cell);
    }
  }
  return [...cells.values()]
    .filter((cell) => cell.values.length > 1 && cell.spread > 0)
    .sort((a, b) => b.spread - a.spread || a.bidder.localeCompare(b.bidder));
}

export type CycleStageTab = "solicitation" | "opening" | "evaluation" | "award" | "standstill" | "contract" | "closure";
export type CyclePageTab = CycleStageTab | "deadlines" | "complaints" | "analytics" | "reporting";

export const CYCLE_STAGE_PAGES: { id: CycleStageTab; label: string }[] = [
  { id: "solicitation", label: "Solicitation" },
  { id: "opening", label: "Opening" },
  { id: "evaluation", label: "Evaluation" },
  { id: "award", label: "Award" },
  { id: "standstill", label: "Standstill" },
  { id: "contract", label: "Contract" },
  { id: "closure", label: "Closure" },
];

const STAGE_TABS = CYCLE_STAGE_PAGES;

const UTILITY_TABS: { id: CyclePageTab; label: string }[] = [
  { id: "deadlines", label: "Deadlines" },
  { id: "complaints", label: "Complaints" },
  { id: "analytics", label: "Analytics" },
  { id: "reporting", label: "Quarterly returns" },
];

export const CYCLE_PAGE_PAGES: { id: CyclePageTab; label: string; group?: string }[] = [
  ...CYCLE_STAGE_PAGES,
  ...UTILITY_TABS.map((page) => ({ ...page, group: "DESK TOOLS" })),
];

const STAGE_INTROS: Record<CycleStageTab, string> = {
  solicitation: "Prepare the tender pack, confirm its notice, and keep the planned procurement record together.",
  opening: "Record receipt and public opening with a complete, certifiable bid register.",
  evaluation: "Run the evaluation against the published criteria, record conflicts, and certify the matrix.",
  award: "Resolve blockers and prepare the award report for the accountable officer’s decision.",
  standstill: "Publish the award notice, track the review window, and clear it only when conditions are met.",
  contract: "Manage execution, milestones, variations, and payments against the approved award.",
  closure: "Record final acceptance and preserve the evidence that closes this procurement cycle.",
};

/* Every stage states what it must produce before it shows a control. The
   same words serve the populated page and the page that has no record
   yet — the record is missing, the obligation is not. */
const STAGE_BRIEFS: Record<CycleStageTab, { label: string; lede: string; items: string[]; gate: string }> = {
  solicitation: {
    label: "SOLICITATION · WHAT THIS PAGE MUST PRODUCE",
    lede:
      "The tender exists on paper before it exists in the market. Publication is the moment the rules become binding on everyone — so the notice, the specification and every answer issued before closing are built here, checked here, and signed by a named office here.",
    items: [
      "A notice carrying buyer, subject, method, budget ceiling, closing date, required documents and contact — the seven fields the publication gate refuses to pass without.",
      "A specification or terms of reference whose mandatory requirements are written as SHALL clauses, so the review desk can pin and test them verbatim.",
      "Every bidder question answered on the record; the answer reaches all bidders at once, never one privately.",
      "Any addendum inside seven days of closing moves the closing date — otherwise the record is flagged as an unfair change.",
      "A closing date the register of bids can be measured against; the notice's date is only the fallback.",
    ],
    gate:
      "The machine drafts and checks. Publishing the notice, issuing an addendum and moving a closing date are gates: a named procurement-unit officer decides, and the decision is recorded with its inputs.",
  },
  opening: {
    label: "OPENING · WHAT THIS PAGE MUST PRODUCE",
    lede:
      "Nothing in the cycle is more contestable than the opening. This page fixes the moment the clock stopped and preserves, bid by bid, the order in which sealed envelopes were opened and the price that was read out.",
    items: [
      "A closing date on record before the first bid is opened — the officer's entry wins, the notice's date is only the fallback.",
      "Every bid as it was received, with the bidder and the exact time; the register is the tender's attendance list.",
      "Late bids recorded as received and rejected unopened — the desk refuses to treat a late price as a competitive one.",
      "The price read from each envelope as announced, so the record can be compared with what the bidder later signs.",
      "A reconciliation against bids filed through the supplier portal, so no electronic submission disappears between systems.",
    ],
    gate:
      "Certifying the register is a procurement-unit gate: the officer confirms the register matches the envelopes opened. The bid opening is never signed by the machine that transcribed it.",
  },
  evaluation: {
    label: "EVALUATION · WHAT THIS PAGE MUST PRODUCE",
    lede:
      "Evaluation is where a bid becomes a defensible recommendation. Every number on this page is traceable to a criterion published before closing, a sheet an evaluator signed, and a spread the committee reconciled in writing.",
    items: [
      "A conflict-of-interest declaration from every member recorded present — the certification gate refuses a partial set.",
      "Criteria and weights summing to exactly 100, published with the notice; the validator refuses anything else.",
      "An individual sheet per evaluator, the divergences across them, and the consensus minute that reconciles every spread.",
      "The FX basis and the margin-of-error adjustment, written down before scoring, never after the winner is visible.",
      "An abnormally-low-bid dossier with a justification clock of five working days for every bid it is opened against.",
    ],
    gate:
      "Certifying the matrix is a committee gate that needs a quorum and a complete declaration set. ALB resolutions and score changes travel through the same gate — the desk cannot certify on the machine's say-so.",
  },
  award: {
    label: "AWARD · WHAT THIS PAGE MUST PRODUCE",
    lede:
      "The award is the desk's recommendation, never its decision. This page assembles the evidence an accounting officer is asked to stand behind: who won and why, what the method allows, who the supplier really is, and which findings were closed before the report existed.",
    items: [
      "Every HIGH finding against the recommended bid disposed of by a named officer, optionally seconded — an open blocker has no award.",
      "The procurement method on the file with its justification, and the approval reference wherever the law demands prior authority.",
      "The supplier assurance check: ownership, registry, tax and sanctions status of the entity that would sign.",
      "The award report composed from the certified matrix and the run's findings — the statutory document behind the recommendation.",
      "A debrief for every unsuccessful bidder, drafted from their own record and issued at a gate.",
    ],
    gate:
      "Drafting the report raises the accounting officer's gate. Nothing here publishes, notifies or awards until that signature exists — and a dissent recorded below travels with the file.",
  },
  standstill: {
    label: "STANDSTILL · WHAT THIS PAGE MUST PRODUCE",
    lede:
      "The standstill is the window in which a disappointed bidder can still change the outcome. It is measured in working days, it starts at publication, and while it runs nothing is signed and no money moves.",
    items: [
      "A published award notice naming the winner, the price and the reasons — publication is what starts the clock, not the decision.",
      "The review window counted in working days from publication, with the end date on the file rather than in someone's head.",
      "Every complaint received inside the window marked as such; a live complaint holds the contract and the payment.",
      "A lift only after the window has lapsed with no unresolved complaint — a lift is an accounting officer's decision, recorded.",
    ],
    gate:
      "Publishing the notice and lifting the standstill are both gates with a named signatory. The desk will not let the contract open while the review clock is still running.",
  },
  contract: {
    label: "CONTRACT · WHAT THIS PAGE MUST PRODUCE",
    lede:
      "The award is a decision; the contract is an obligation. This page turns one into the other and then administers it: the signed instrument, the security that backs it, the milestones that measure it, and every shilling that leaves against it.",
    items: [
      "A contract pack prepared only after the award report is signed and the standstill has lapsed, committing money to a named budget line.",
      "Execution with the performance security and insurance on the record — an unexecuted contract cannot be paid.",
      "Supplier acceptance recorded by the supplier themselves, not typed on their behalf.",
      "Milestones completed against evidence, and variations priced against the contract value; a variation above ten percent goes to the gate.",
      "Payments certified on the three-way match of contract, invoice and goods receipt, inside the contract ceiling and after retention.",
      "Performance securities received, held and verified by a named officer, with their validity dates watched.",
    ],
    gate:
      "Execution and every payment are gates. The desk assembles the file and tests it against the contract value, the cumulative variation cap and the retention rule; a named accounting officer signs each one.",
  },
  closure: {
    label: "CLOSURE · WHAT THIS PAGE MUST PRODUCE",
    lede:
      "Closure is not the absence of activity; it is a certificate, a defects period and a supplier record that outlives the file. This page is what an auditor reads when they ask whether the money bought what the tender promised.",
    items: [
      "Final acceptance recorded against a certificate, never against a verbal handover.",
      "The defects liability end date, so a failure discovered next year still has a route back to the supplier.",
      "A performance rating carried into the supplier's register — the record that informs the next tender's assurance check.",
      "A closure file that binds the notice, the register, the matrix, the award, the contract, the payments and the acceptance into one procurement file.",
      "A retention decision on the money the desk has been holding since the first payment.",
    ],
    gate:
      "Recording acceptance raises the completion gate. The cycle closes when a named officer signs it — and the closure file is then read-only evidence, not a working document.",
  },
};

/* The desk tools are not stages, but they answer the same question a stage
   answers: what does this page exist to produce, and where does the machine
   stop? Deadlines is derived arithmetic over the other pages' records;
   Complaints is the bidder's remedy; Analytics is the read side of the log. */
const DESK_TOOL_BRIEFS: Record<"deadlines" | "complaints" | "analytics" | "reporting", { label: string; lede: string; items: string[]; gate: string }> = {
  deadlines: {
    label: "DEADLINES · WHAT THIS PAGE MUST PRODUCE",
    lede:
      "A deadline is not a diary entry; it is a consequence. Every item on this page is arithmetic over a record another page already holds — the closing date, the ALB clock, the standstill window, the milestone schedule, the complaint window. Nothing here is typed in a second time, so nothing here can quietly disagree with the file.",
    items: [
      "The closing date as the record holds it — the officer's entry, with the notice's date only as fallback.",
      "Abnormally-low-bid justification clocks, counted from the query and never from the bid.",
      "Standstill ends counted in working days from publication, not from the decision that preceded it.",
      "Milestone due dates as signed, so a slipping schedule shows up before a payment is certified against it.",
      "Complaint windows, so an unanswered one is visible on the day it matters rather than at the audit.",
    ],
    gate:
      "The desk will not let a clock be reset by editing a date here. An overdue item stays on this page until the underlying record moves through its own gate.",
  },
  complaints: {
    label: "COMPLAINTS · WHAT THIS PAGE MUST PRODUCE",
    lede:
      "A complaint is the bidder's only remedy, and the standstill is when they use it. This page preserves the grounds as filed, the response as issued, the escalation as requested and the independent review as decided — in that order, on one record, with the contract held while it is open.",
    items: [
      "The grounds as the complainant filed them, kept verbatim and never summarised into agreement.",
      "A response drafted by the desk and issued only at a named officer's gate — not typed as if already decided.",
      "An escalation that names the reason, with the contract and the payment held for as long as it is open.",
      "An independent review recorded with its reviewer, outcome and note, so the file shows who decided and on what.",
      "A closure that is an explicit act, never an expiry: a complaint does not go away because time passed.",
    ],
    gate:
      "Responding and closing are gates. While a complaint is OPEN or ESCALATED the contract cannot be executed and no payment leaves the desk — the hold is the record, not a reminder.",
  },
  analytics: {
    label: "ANALYTICS · WHAT THIS PAGE MUST PRODUCE",
    lede:
      "This page is the read side of the append-only log: counts computed from records the desk already wrote, with no new instrumentation and no estimate standing in for a fact. A zero here is a zero the log supports, and a blank is a record that does not exist yet.",
    items: [
      "Headline counts an oversight meeting opens with: tenders in cycle, bids opened, matrices certified, contracts closed.",
      "Where every dossier stands, counted at the stage its own record has reached — closed cycles sit at closure.",
      "A watchlist of exceptions only: late bids, open ALB queries, unanswered complaints, running standstills.",
      "Findings per tender, so a desk that is finding more than it used to is visible before the audit says so.",
    ],
    gate:
      "Nothing on this page is a decision, and nothing on it can be edited. When a number looks wrong, the fix is on the page that owns the record — this view follows it on the next poll.",
  },
  reporting: {
    label: "QUARTERLY RETURNS · WHAT THIS PAGE MUST PRODUCE",
    lede: "Build the statutory return from approved contract variations and preference awards recorded in this workspace. Each period is a dated snapshot; the officer approves its digest before the external submission is recorded.",
    items: [
      "Approved variations and preference awards that fall inside the quarter, with a tender, date, amount and record reference.",
      "The external submission reference and supporting evidence needed to trace the return to its destination.",
      "A digest check at approval time, so changes to the underlying records refuse a stale return.",
      "An accounting officer gate and a different preparer/approver before the report is marked submitted.",
    ],
    gate: "Quarterly returns are not marked submitted until the accounting officer approves the period and the staged record still matches its digest.",
  },
};

const CYCLE_PAGE_EMPTY_GUIDES: Partial<
  Record<CyclePageTab, { title: string; body: string; records: string[] }>
> = {
  opening: {
    title: "Opening record",
    body: "This page brings the closing-date record, bid receipt register, supplier-portal applications, reconciliation and certification evidence together.",
    records: ["Closing date and recorded basis", "Bidder, receipt time and price read", "Portal reconciliation, minutes and certification"],
  },
  evaluation: {
    title: "Evaluation file",
    body: "Publish the criteria and exact 100-point weights with the notice, then establish the FX and margin-of-error basis before any evaluator scores.",
    records: [
      "Conflict declarations from every present committee member",
      "Issued notice criteria, sourced FX basis and pre-score MED record",
      "Signed evaluator sheets, divergences, consensus minute and five-day ALB dossiers",
    ],
  },
  award: {
    title: "Award decision file",
    body: "This page gathers the evidence an accountable officer needs to review the recommendation and record the award decision.",
    records: ["Open findings and their dispositions", "Procurement method and supplier assurance", "Award report, debriefs and clarifications"],
  },
  standstill: {
    title: "Award notice and review window",
    body: "Track notice publication, the review-window dates and any complaint that affects whether the contract can proceed.",
    records: ["Published notice and destination", "Window start, end and current status", "Complaints and contract holds"],
  },
  contract: {
    title: "Contract administration file",
    body: "Follow the signed contract from budget commitment and supplier acceptance through delivery, variations and verified payments.",
    records: ["Budget line, contract pack and acceptance", "Security, insurance, milestones and variations", "Invoice, receipt and milestone-matched payments"],
  },
  closure: {
    title: "Completion and close-out",
    body: "Preserve the final acceptance record and the evidence that shows how the procurement contract was completed.",
    records: ["Acceptance certificate and defects period", "Performance rating and completion date", "Award, standstill and contract close-out checks"],
  },
  complaints: {
    title: "Complaint and review record",
    body: "Keep the original grounds, response, escalation and independent-review outcome visible alongside the standstill context.",
    records: ["Complainant, grounds and receipt timestamp", "Response and approval-gate record", "Escalation, independent review and outcome"],
  },
};

/* ── formatting helpers ─────────────────────────────────────────────────────── */

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtDateTime = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const fmtMoney = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);

/** One summary line a collapsed workflow card can stand on: "3 sheets". */
function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Whole days from now until the iso instant (negative = past). */
function daysUntil(iso?: string): number | undefined {
  if (!iso) return undefined;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

/** Compact relative label: "in 103 d" · "in 3 d" · "2 d overdue". */
function relDays(iso?: string): string {
  const n = daysUntil(iso);
  if (n === undefined) return "—";
  if (n > 1) return `in ${n} d`;
  if (n === 1) return "tomorrow";
  if (n === 0) return "today";
  return `${-n} d overdue`;
}

/* ── the cycle rail: seven stages, derived from the tender's own record ─────── */

type StageState = "done" | "current" | "todo";
type Stage = {
  key: string;
  label: string;
  tab: CycleStageTab;
  state: StageState;
  caption?: string;
  /* True when the desk has reached this stage but an irreversible step is
     parked at a named human's gate (or the standstill clock is running).
     Derived strictly from the record — never from a feeling. */
  held?: boolean;
};

function deriveStages(c: CycleDto | null): { stages: Stage[]; doneCount: number; currentIndex: number } {
  const raw: { key: string; label: string; tab: CycleStageTab; done: boolean; caption: string; held?: boolean }[] = [
    {
      key: "solicitation",
      label: "Solicitation",
      tab: "solicitation",
      done: !!c?.opening,
      caption: c?.closingDate ? `closes ${fmtDate(c.closingDate)}` : "pack on the desk",
    },
    {
      key: "opening",
      label: "Opening",
      tab: "opening",
      done: !!c?.opening?.certifiedAt,
      held: !!c?.opening && !c.opening.certifiedAt,
      caption: c?.opening?.certifiedAt ? "register certified" : c?.opening ? "awaiting certification gate" : "public bid opening",
    },
    {
      key: "evaluation",
      label: "Evaluation",
      tab: "evaluation",
      done: !!c?.matrix?.certifiedBy,
      held: !!c?.matrix && !c.matrix.certifiedBy,
      caption: c?.matrix?.certifiedBy ? "matrix certified" : c?.matrix ? "matrix in draft — at the gate" : "matrix · MED · COI",
    },
    {
      key: "award",
      label: "Award",
      tab: "award",
      done: !!c?.awardReport?.signedAt,
      held: !!c?.awardReport && !c.awardReport.signedAt,
      caption: c?.awardReport?.signedAt ? "report signed" : c?.awardReport ? "awaiting the gavel" : "report at the gate",
    },
    {
      key: "standstill",
      label: "Standstill",
      tab: "standstill",
      done: !!c?.standstill && c.standstill.status !== "ACTIVE",
      held: c?.standstill?.status === "ACTIVE",
      caption: c?.standstill?.status === "ACTIVE" ? `ends ${fmtDate(c.standstill.endsAt)}` : c?.standstill ? "lifted — clear" : "10 wd on publication",
    },
    {
      key: "contract",
      label: "Contract",
      tab: "contract",
      done: !!c?.contract?.completedAt,
      caption: c?.contract?.completedAt ? "acceptance recorded" : c?.contract ? "active — milestones" : "pack · variations",
    },
    {
      key: "closure",
      label: "Closure",
      tab: "closure",
      done: !!c?.contract?.completedAt,
      caption: c?.contract?.completedAt ? "cycle closed" : "final acceptance",
    },
  ];
  const stages: Stage[] = raw.map((s) => ({
    key: s.key,
    label: s.label,
    tab: s.tab,
    caption: s.caption,
    state: "todo" as StageState,
    ...(s.held ? { held: true } : {}),
  }));
  let currentIndex = raw.findIndex((s) => !s.done);
  if (currentIndex === -1) currentIndex = raw.length - 1;
  stages[currentIndex] = { ...stages[currentIndex], state: "current" };
  for (let i = 0; i < currentIndex; i++) stages[i] = { ...stages[i], state: "done" };
  if (raw.every((s) => s.done)) stages[stages.length - 1] = { ...stages[stages.length - 1], state: "done" };
  const doneCount = raw.filter((s) => s.done).length;
  return { stages, doneCount, currentIndex };
}

/* ── primitives ─────────────────────────────────────────────────────────────── */

function Chip({ tone, children }: { tone: "ok" | "warn" | "muted" | "brand"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.06em]",
        tone === "ok" &&
          "bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:text-emerald-300 dark:ring-emerald-400/25",
        tone === "warn" &&
          "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-600/20 dark:bg-brand-500/12 dark:text-brand-300 dark:ring-brand-400/30",
        /* Inverted in both themes. Avoid `dark:bg-white`: the global dark card
           remap would swallow it and leave dark text on a dark chip. */
        tone === "brand" && "bg-ink-950 text-white dark:bg-[#f1f2f4] dark:text-[#0b0c0f]",
        tone === "muted" &&
          "bg-ink-100/80 text-ink-600 ring-1 ring-inset ring-ink-200/60 dark:bg-white/[0.06] dark:text-ink-400 dark:ring-white/10",
      )}
    >
      {children}
    </span>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const fieldId = `cycle-field-${useId()}`;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  let controlId: string | undefined;
  let controlIndex = 0;

  const enhanceControls = (node: ReactNode): ReactNode => {
    if (Array.isArray(node)) return node.map(enhanceControls);
    if (!isValidElement(node)) return node;

    const child = node as ReactElement<{
      id?: string;
      "aria-describedby"?: string;
      children?: ReactNode;
    }>;
    if (typeof child.type === "string" && ["input", "select", "textarea"].includes(child.type)) {
      const id = child.props.id ?? `${fieldId}-control-${++controlIndex}`;
      controlId ??= id;
      const describedBy = [child.props["aria-describedby"], hintId].filter(Boolean).join(" ");
      return cloneElement(child as ReactElement<Record<string, unknown>>, {
        id,
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
      });
    }

    const nestedChildren = child.props.children;
    return nestedChildren === undefined
      ? child
      : cloneElement(child, undefined, enhanceControls(nestedChildren));
  };

  const enhancedChildren = enhanceControls(children);
  return (
    <div className="block min-w-0">
      <span className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        {controlId ? <label htmlFor={controlId} className="eyebrow">{label}</label> : <span className="eyebrow">{label}</span>}
        {hint ? (
          <span id={hintId} className="min-w-0 font-sans text-[11.5px] leading-[1.4] text-ink-600 dark:text-ink-400">{hint}</span>
        ) : null}
      </span>
      {enhancedChildren}
    </div>
  );
}

/* One field vocabulary for the whole desk. Avoid `bg-white`: the dark theme
   remaps that utility, which would flatten the recessed field into the panel.
   The inset shadow + hover border are what make a control feel physical. */
const inputCls =
  "h-11 w-full min-w-0 rounded-xl border border-ink-200/90 bg-[#fffdfb] px-3 text-base text-ink-900 shadow-[inset_0_1px_1px_rgba(11,12,15,0.03)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-400 hover:border-ink-300 focus:border-ink-950 focus:ring-[3px] focus:ring-ink-950/[0.08] sm:text-[12.5px] dark:border-white/[0.13] dark:bg-[#0b0d12] dark:text-ink-900 dark:placeholder:text-ink-500 dark:hover:border-white/25 dark:focus:border-white/40 dark:focus:ring-white/[0.07] dark:[color-scheme:dark]";

function Btn({
  onClick,
  children,
  variant = "primary",
  disabled,
  className,
}: {
  onClick: () => void;
  children: ReactNode;
  variant?: "primary" | "ghost";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3.5 text-[12px] font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffdfb] active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-40 dark:focus-visible:ring-offset-[#0b0d12]",
        variant === "primary" &&
          "bg-brand-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_22px_-14px_rgba(217,38,22,0.9)] hover:bg-brand-500",
        variant === "ghost" &&
          "border border-ink-200/90 bg-[#fffdfb] text-ink-700 shadow-[0_1px_2px_rgba(11,12,15,0.03)] hover:border-ink-400 hover:text-ink-950 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-ink-300 dark:hover:border-white/25 dark:hover:bg-white/[0.07] dark:hover:text-white",
        className,
      )}
    >
      {children}
    </button>
  );
}

type AssuranceOwnerDraft = {
  key: number;
  name: string;
  role: string;
  ownershipPct: string;
  nationality: string;
  idNo: string;
};
type AssuranceDocDraft = { key: number; kind: string; reference: string; expiresAt: string };

/**
 * WS6 assurance check, written in one sitting: several beneficial owners and
 * several documents are one check, not one owner and one document repeated.
 * Blank rows are not disclosures — the form refuses them before the server
 * does, and the server records the whole set under one check, one source and
 * one expiry.
 */
function AssuranceCheckForm({
  onSubmit,
  busy,
  onToast,
}: {
  onSubmit: (payload: Record<string, unknown>) => void;
  busy: boolean;
  onToast: (message: string) => void;
}) {
  const [source, setSource] = useState("REGISTRY_LOOKUP");
  const [registryStatus, setRegistryStatus] = useState("REGISTERED");
  const [taxStatus, setTaxStatus] = useState("VALID");
  const [sanctions, setSanctions] = useState("CLEAR");
  const [pep, setPep] = useState("CLEAR");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const nextKey = useRef(2);
  const [owners, setOwners] = useState<AssuranceOwnerDraft[]>([
    { key: 1, name: "", role: "", ownershipPct: "", nationality: "", idNo: "" },
  ]);
  const [documents, setDocuments] = useState<AssuranceDocDraft[]>([{ key: 1, kind: "", reference: "", expiresAt: "" }]);

  const patchOwner = (key: number, patch: Partial<AssuranceOwnerDraft>) =>
    setOwners((current) => current.map((owner) => (owner.key === key ? { ...owner, ...patch } : owner)));
  const patchDocument = (key: number, patch: Partial<AssuranceDocDraft>) =>
    setDocuments((current) => current.map((doc) => (doc.key === key ? { ...doc, ...patch } : doc)));

  const submit = () => {
    const filledOwners = owners.filter((owner) =>
      [owner.name, owner.role, owner.ownershipPct, owner.nationality, owner.idNo].some((value) => value.trim()),
    );
    if (!filledOwners.length) {
      onToast("AT LEAST ONE BENEFICIAL OWNER IS REQUIRED — A CHECK WITH NO OWNER IS NOT A DISCLOSURE");
      return;
    }
    if (filledOwners.some((owner) => !owner.name.trim())) {
      onToast("EVERY BENEFICIAL OWNER NEEDS A NAME");
      return;
    }
    const filledDocuments = documents.filter((doc) => [doc.kind, doc.reference, doc.expiresAt].some((value) => value.trim()));
    if (!filledDocuments.length) {
      onToast("AT LEAST ONE VERIFICATION DOCUMENT IS REQUIRED");
      return;
    }
    if (filledDocuments.some((doc) => !doc.kind.trim())) {
      onToast("EVERY DOCUMENT NEEDS A KIND — E.G. TAX CLEARANCE, REGISTRY EXTRACT");
      return;
    }
    onSubmit({
      source,
      registryStatus,
      taxStatus,
      sanctions,
      pep,
      ...(expiresAt ? { expiresAt } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      beneficialOwners: filledOwners.map((owner) => ({
        name: owner.name.trim(),
        ...(owner.role.trim() ? { role: owner.role.trim() } : {}),
        ...(owner.ownershipPct.trim() ? { ownershipPct: Number(owner.ownershipPct) } : {}),
        ...(owner.nationality.trim() ? { nationality: owner.nationality.trim() } : {}),
        ...(owner.idNo.trim() ? { idNo: owner.idNo.trim() } : {}),
      })),
      documents: filledDocuments.map((doc) => ({
        kind: doc.kind.trim(),
        ...(doc.reference.trim() ? { reference: doc.reference.trim() } : {}),
        ...(doc.expiresAt ? { expiresAt: doc.expiresAt } : {}),
      })),
    });
  };

  return (
    <div className="grid gap-2">
      <div className="grid gap-1.5 sm:grid-cols-2">
        <select className={inputCls} aria-label="Supplier evidence source" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="REGISTRY_LOOKUP">Registry lookup</option>
          <option value="MANUAL_ATTESTATION">Manual attestation</option>
        </select>
        <select className={inputCls} aria-label="Supplier registry status" value={registryStatus} onChange={(e) => setRegistryStatus(e.target.value)}>
          <option value="REGISTERED">Registry: registered</option>
          <option value="NOT_FOUND">Registry: not found</option>
          <option value="STRUCK_OFF">Registry: struck off</option>
        </select>
        <select className={inputCls} aria-label="Supplier tax clearance status" value={taxStatus} onChange={(e) => setTaxStatus(e.target.value)}>
          <option value="VALID">Tax: valid clearance</option>
          <option value="EXPIRED">Tax: expired</option>
          <option value="NOT_FOUND">Tax: not found</option>
        </select>
        <select className={inputCls} aria-label="Supplier sanctions screening result" value={sanctions} onChange={(e) => setSanctions(e.target.value)}>
          <option value="CLEAR">Sanctions: clear</option>
          <option value="HIT">Sanctions: hit</option>
        </select>
        <select className={inputCls} aria-label="Supplier politically exposed person screening result" value={pep} onChange={(e) => setPep(e.target.value)}>
          <option value="CLEAR">PEP: clear</option>
          <option value="HIT">PEP: hit</option>
        </select>
        <input className={inputCls} type="date" aria-label="Check expires on" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
      </div>

      <div className="rounded-xl border border-ink-100 bg-paper p-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="font-code text-[10px] font-semibold tracking-[0.08em] text-ink-600">Beneficial owners · {owners.length}</p>
          <Btn
            variant="ghost"
            onClick={() => {
              if (owners.length >= 20) {
                onToast("AT MOST 20 BENEFICIAL OWNERS CAN BE RECORDED IN ONE CHECK");
                return;
              }
              setOwners((current) => [
                ...current,
                { key: nextKey.current++, name: "", role: "", ownershipPct: "", nationality: "", idNo: "" },
              ]);
            }}
            disabled={busy}
          >
            <Plus className="h-3 w-3" aria-hidden="true" /> Add owner
          </Btn>
        </div>
        <ul className="space-y-1.5">
          {owners.map((owner, index) => (
            <li key={owner.key} className="grid gap-1.5 sm:grid-cols-[1.6fr_1fr_70px_1fr_1fr_auto]">
              <input
                className={cn(inputCls, "h-11 text-base sm:text-[12.5px]")}
                aria-label={`Beneficial owner ${index + 1} name`}
                placeholder="Owner name"
                value={owner.name}
                onChange={(e) => patchOwner(owner.key, { name: e.target.value })}
              />
              <input
                className={cn(inputCls, "h-11 text-base sm:text-[12.5px]")}
                aria-label={`Beneficial owner ${index + 1} role`}
                placeholder="Role"
                value={owner.role}
                onChange={(e) => patchOwner(owner.key, { role: e.target.value })}
              />
              <input
                className={cn(inputCls, "h-11 px-3 text-base sm:px-2 sm:text-[12.5px]")}
                aria-label={`Beneficial owner ${index + 1} ownership percentage`}
                type="number"
                min={0}
                max={100}
                placeholder="%"
                value={owner.ownershipPct}
                onChange={(e) => patchOwner(owner.key, { ownershipPct: e.target.value })}
              />
              <input
                className={cn(inputCls, "h-11 text-base sm:text-[12.5px]")}
                aria-label={`Beneficial owner ${index + 1} nationality`}
                placeholder="Nationality"
                value={owner.nationality}
                onChange={(e) => patchOwner(owner.key, { nationality: e.target.value })}
              />
              <input
                className={cn(inputCls, "h-11 text-base sm:text-[12.5px]")}
                aria-label={`Beneficial owner ${index + 1} ID or passport number`}
                placeholder="ID / passport"
                value={owner.idNo}
                onChange={(e) => patchOwner(owner.key, { idNo: e.target.value })}
              />
              <button
                type="button"
                aria-label={`Remove beneficial owner ${index + 1}`}
                onClick={() => setOwners((current) => (current.length === 1 ? current : current.filter((row) => row.key !== owner.key)))}
                disabled={busy || owners.length === 1}
                className="focus-brand inline-flex h-11 w-11 items-center justify-center rounded-lg text-ink-600 transition-colors hover:text-brand-800 disabled:cursor-not-allowed disabled:opacity-30 sm:w-10"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-ink-100 bg-paper p-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="font-code text-[10px] font-semibold tracking-[0.08em] text-ink-600">Documents · {documents.length}</p>
          <Btn
            variant="ghost"
            onClick={() => {
              if (documents.length >= 20) {
                onToast("AT MOST 20 DOCUMENTS CAN BE ATTACHED TO ONE CHECK");
                return;
              }
              setDocuments((current) => [...current, { key: nextKey.current++, kind: "", reference: "", expiresAt: "" }]);
            }}
            disabled={busy}
          >
            <Plus className="h-3 w-3" aria-hidden="true" /> Add document
          </Btn>
        </div>
        <ul className="space-y-1.5">
          {documents.map((doc, index) => (
            <li key={doc.key} className="grid gap-1.5 sm:grid-cols-[1.3fr_1.3fr_150px_auto]">
              <input
                className={cn(inputCls, "h-11 text-base sm:text-[12.5px]")}
                aria-label={`Document ${index + 1} kind`}
                placeholder="Kind (e.g. TAX CLEARANCE)"
                value={doc.kind}
                onChange={(e) => patchDocument(doc.key, { kind: e.target.value })}
              />
              <input
                className={cn(inputCls, "h-11 text-base sm:text-[12.5px]")}
                aria-label={`Document ${index + 1} reference`}
                placeholder="Reference"
                value={doc.reference}
                onChange={(e) => patchDocument(doc.key, { reference: e.target.value })}
              />
              <input
                className={cn(inputCls, "h-11 text-base sm:text-[12.5px]")}
                type="date"
                aria-label={`Document ${index + 1} expires on`}
                value={doc.expiresAt}
                onChange={(e) => patchDocument(doc.key, { expiresAt: e.target.value })}
              />
              <button
                type="button"
                aria-label={`Remove document ${index + 1}`}
                onClick={() =>
                  setDocuments((current) => (current.length === 1 ? current : current.filter((row) => row.key !== doc.key)))
                }
                disabled={busy || documents.length === 1}
                className="focus-brand inline-flex h-11 w-11 items-center justify-center rounded-lg text-ink-600 transition-colors hover:text-brand-800 disabled:cursor-not-allowed disabled:opacity-30 sm:w-10"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <input className={inputCls} aria-label="Supplier assurance notes (optional)" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <Btn variant="ghost" onClick={submit} disabled={busy}>
        <Check className="h-3.5 w-3.5" aria-hidden="true" /> Record the check
      </Btn>
    </div>
  );
}

function Card({
  title,
  sub,
  right,
  children,
  teaser,
  workflow = false,
  busy = false,
  actionLabel = "Open workflow",
  className,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  teaser?: string;
  /* A stage grid can widen one card across both columns (an odd last card
     would otherwise leave half a row of empty panel space). */
  className?: string;
  workflow?: boolean;
  busy?: boolean;
  actionLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const dialogId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
  }, [busy]);

  /* A workflow that finishes its own write closes itself — the busy flag is
     already settled by the time the write reports success. */
  const closeNow = useCallback(() => setOpen(false), []);

  /* Hand focus back to the trigger only after a dialog that had been open. */
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!workflow || !open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => dialogRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const focusedModal = document.activeElement?.closest('[role="dialog"][aria-modal="true"]');
        if (focusedModal && focusedModal !== dialogRef.current) return;
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [workflow, open, close]);

  if (workflow) {
    return (
      <>
        <section className={cn("@container panel flex min-w-0 flex-col overflow-hidden rounded-[12px]", className)}>
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-4 pt-[18px]">
            <div className="min-w-0">
              <h3 className="font-display text-[15px] font-bold tracking-[-0.015em] text-ink-950">{title}</h3>
              {sub ? <p className="mt-1.5 max-w-[52ch] font-code text-[10px] leading-[1.6] tracking-[0.08em] text-ink-500 dark:text-ink-400">{sub}</p> : null}
            </div>
            {right ? <div className="shrink-0">{right}</div> : null}
          </div>
          {/* The action moves under the teaser whenever the card itself is
              narrow — a stage grid can halve a card at desktop width, so this
              is a container query, not a viewport one. */}
          <div className="flex flex-1 flex-col gap-3 border-t border-ink-100/80 px-5 py-4 @lg:flex-row @lg:items-end @lg:justify-between @lg:gap-4 dark:border-white/[0.055]">
            <p className="max-w-[46ch] text-[11.5px] leading-relaxed text-ink-500 dark:text-ink-400">
              {teaser ?? "Open the guided workflow to review details and complete this action."}
            </p>
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setOpen(true)}
              disabled={busy}
              className="focus-brand inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-ink-950 px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 @lg:w-auto dark:bg-white dark:text-ink-950 dark:hover:bg-brand-400"
            >
              {actionLabel}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </section>
        {typeof document !== "undefined"
          ? createPortal(
              <AnimatePresence>
                {open ? (
                  <motion.div
                    key={`cycle-workflow-${dialogId}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-[90] grid place-items-center bg-night/70 p-3 backdrop-blur-sm sm:p-5"
                    onMouseDown={(event) => {
                      if (event.target === event.currentTarget) close();
                    }}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={`cycle-workflow-${dialogId}`}
                  >
                    <motion.div
                      ref={dialogRef}
                      tabIndex={-1}
                      initial={{ opacity: 0, y: 18, scale: 0.985 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 12, scale: 0.99 }}
                      transition={{ duration: 0.28, ease: EASE }}
                      className="panel panel-lift flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-[12px] outline-none"
                    >
                      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-ink-100 px-5 py-4 dark:border-white/[0.06] sm:px-7 sm:py-5">
                        <div className="min-w-0">
                          <p className="font-code text-[10px] font-bold tracking-[0.08em] text-brand-800 dark:text-brand-300">Tender cycle · guided workflow</p>
                          <h3 id={`cycle-workflow-${dialogId}`} className="mt-1 font-display text-[20px] font-black tracking-[-0.02em] text-ink-950 dark:text-white sm:text-[22px]">{title}</h3>
                          {sub ? <p className="mt-1.5 max-w-[65ch] text-[11.5px] leading-relaxed text-ink-500 dark:text-ink-400">{sub}</p> : null}
                        </div>
                        <button
                          type="button"
                          onClick={close}
                          disabled={busy}
                          aria-label={`Close ${title} workflow`}
                          className="focus-brand grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/[0.06] dark:hover:text-white"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </header>
                      <div
                        data-cycle-workflow-body
                        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-7 sm:py-5"
                      >
                        {typeof children === "function" ? children(closeNow) : children}
                      </div>
                    </motion.div>
                  </motion.div>
                ) : null}
              </AnimatePresence>,
              document.body,
            )
          : null}
      </>
    );
  }

  return (
    <section className={cn("panel flex min-w-0 flex-col overflow-hidden rounded-[12px]", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-4 pt-[18px]">
        <div className="min-w-0">
          <h3 className="font-display text-[15px] font-bold tracking-[-0.015em] text-ink-950">{title}</h3>
          {sub ? (
            <p className="mt-1.5 max-w-[52ch] font-code text-[10px] leading-[1.6] tracking-[0.08em] text-ink-500 dark:text-ink-400">
              {sub}
            </p>
          ) : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      <div className="flex-1 border-t border-ink-100/80 px-5 pb-5 pt-4 dark:border-white/[0.055]">
        {typeof children === "function" ? null : children}
      </div>
    </section>
  );
}

/** Close on outside click — shared by the picker and the link menu. */
function useOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const fn = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("pointerdown", fn);
    document.addEventListener("focusin", fn);
    return () => {
      document.removeEventListener("pointerdown", fn);
      document.removeEventListener("focusin", fn);
    };
  }, [ref, onOutside, active]);
}

/* ── StageBrief — what a page must produce, stated before the buttons ────────
   Every stage of the cycle is a decision someone can be asked about years
   later. The brief names, in the officer's own vocabulary, the records the
   page exists to create and the point at which the machine stops and a named
   human signs. It is content, not decoration: each line maps to a real
   control on the page below it. */

function StageBrief({
  label,
  lede,
  items,
  gate,
  span = false,
}: {
  label: string;
  lede: string;
  items: string[];
  gate?: string;
  /* Inside a two-column stage grid, the brief reads across the full width. */
  span?: boolean;
}) {
  return (
    <section className={cn("panel overflow-hidden rounded-[12px] px-4 py-3.5 sm:px-5", span && "col-span-full")} aria-label={`${label} brief`}>
      <div className="flex items-start gap-3">
        <span className="mt-[3px] grid h-6 w-6 shrink-0 place-items-center rounded-full border border-brand-500/30 bg-brand-500/[0.08] text-brand-600 dark:text-brand-300">
          <Gavel className="h-3 w-3" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="font-code text-[10.5px] font-bold tracking-[0.12em] text-brand-600 dark:text-brand-300">{label}</p>
          <p className="mt-1.5 max-w-[86ch] text-[12.5px] leading-relaxed text-ink-600 dark:text-ink-600">{lede}</p>
        </div>
      </div>
      <ul className="mt-3 grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-600 dark:text-ink-600">
            <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-brand-500/60" aria-hidden="true" />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
      {gate ? (
        <p className="mt-3 border-t border-ink-100 pt-2.5 text-[11px] leading-relaxed text-ink-600 dark:border-white/[0.06] dark:text-ink-600">
          {gate}
        </p>
      ) : null}
    </section>
  );
}

/* ── TenderPicker — the tender selector as a first-class control ────────────── */

function ProgressRing({ pct, size = 42 }: { pct: number; size?: number }) {
  const stroke = 2.5;
  const r = (size - stroke * 2) / 2;
  const c = 2 * Math.PI * r;
  const value = Math.max(0, Math.min(100, pct));
  return (
    <span
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-ink-200/80 dark:stroke-white/[0.12]"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * value) / 100}
          className={cn(
            "transition-[stroke-dashoffset] duration-700 ease-out",
            value === 100 ? "stroke-emerald-500" : "stroke-brand-500",
          )}
        />
      </svg>
      <span className="relative flex items-baseline gap-px font-code text-[11px] font-bold tabular leading-none text-ink-800 dark:text-ink-200">
        {value}
        <span className="text-[10px] font-semibold text-ink-600 dark:text-ink-300">%</span>
      </span>
    </span>
  );
}

function TenderPicker({
  tenders,
  value: currentRef,
  cycles,
  onSelect,
  onToast,
}: {
  tenders: { ref: string; title: string; systemReference?: string; source?: "sample" | "record" }[];
  value: string;
  cycles: CycleDto[];
  onSelect: (ref: string) => void;
  onToast: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState(false);
  const pickerPanelId = `${useId()}-tender-picker`;
  const listboxId = `${pickerPanelId}-listbox`;
  const pickerTriggerRef = useRef<HTMLButtonElement>(null);
  /* Carousel direction — last travel of the deck, so the slide animation
     always agrees with the control that caused it. */
  const [dir, setDir] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragX = useRef<number | null>(null);
  const swiped = useRef(false);
  useOutside(boxRef, () => setOpen(false), open);

  const count = tenders.length;
  const many = count > 1;
  const at = Math.max(0, tenders.findIndex((t) => t.ref === currentRef));

  /* The deck wraps: an officer flipping right from the last dossier lands
     back on the first — the desk is a ring, not a dead end. */
  const step = (delta: number) => {
    if (!many) return;
    const next = (at + delta + count) % count;
    setDir(delta);
    onSelect(tenders[next].ref);
  };
  const goTo = (i: number) => {
    if (!many || i === at || !tenders[i]) return;
    setDir(i > at ? 1 : -1);
    onSelect(tenders[i].ref);
  };

  const current = tenders.find((t) => t.ref === currentRef);
  const displayReference = tenderReferenceLabel;
  const currentCycle = cycles.find((x) => x.tenderId === currentRef) ?? null;
  const progressOf = (r: string) => {
    const c = cycles.find((x) => x.tenderId === r);
    if (!c) return { pct: 0, stage: "Not started" };
    const { doneCount, currentIndex, stages } = deriveStages(c);
    return { pct: Math.round((doneCount / 7) * 100), stage: stages[currentIndex]?.label ?? "Not started" };
  };
  const query = q.trim().toLowerCase();
  const filtered = query
    ? tenders.filter((t) => `${t.systemReference ?? ""} ${t.title}`.toLowerCase().includes(query))
    : tenders;

  const pick = (r: string) => {
    onSelect(r);
    setOpen(false);
    setQ("");
    window.requestAnimationFrame(() => pickerTriggerRef.current?.focus());
  };

  /* Opening the panel is a state transition, not an effect: reset the query and
     park the cursor on the current tender as part of the click itself. */
  const toggle = () => {
    if (!open) {
      setQ("");
      setActive(Math.max(0, tenders.findIndex((t) => t.ref === currentRef)));
    }
    setOpen(!open);
  };

  const handleToggleClick = () => {
    /* A horizontal swipe ends with a synthesized click — swallow that one
       so flipping the deck never also opens the dropdown. */
    if (swiped.current) {
      swiped.current = false;
      return;
    }
    toggle();
  };

  const p = progressOf(currentRef);

  /* The dossier's own status line — spoken from the record, never invented:
     closed cycles say so; open ones name the stage the desk is standing at. */
  const cycleClosed = !!currentCycle?.contract?.completedAt;
  const dossierStatus = !currentCycle
    ? { label: "NOT STARTED", tone: "muted" as const }
    : cycleClosed
      ? { label: "CYCLE CLOSED", tone: "ok" as const }
      : { label: `STAGE ${String(deriveStages(currentCycle).currentIndex + 1).padStart(2, "0")} · ${p.stage.toUpperCase()}`, tone: "brand" as const };

  const copyRef = async () => {
    if (!isSystemReference(current?.systemReference)) {
      onToast("CREATE THE PROCUREMENT RECORD TO ISSUE ITS SYSTEM REFERENCE");
      return;
    }
    try {
      const reference = systemReferenceLabel(current.systemReference);
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      onToast(`REFERENCE ${reference} COPIED`);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Clipboard permission denied — the reference is selectable text anyway. */
      onToast("COPY BLOCKED BY THE BROWSER — SELECT THE REFERENCE MANUALLY");
    }
  };

  return (
    <div
      ref={boxRef}
      role="group"
      aria-roledescription="carousel"
      aria-label="Working dossiers on the desk"
      className="relative w-full"
      onKeyDown={(e) => {
        /* The deck answers ← → when the dropdown is closed; when it is open
           those keys belong to the caret in the search field. */
        if (!open && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          e.preventDefault();
          step(e.key === "ArrowRight" ? 1 : -1);
          return;
        }
        if (!open) return;
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive((a) => Math.min(a + 1, Math.max(filtered.length - 1, 0)));
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((a) => Math.max(a - 1, 0));
        }
        if (e.key === "Enter") {
          e.preventDefault();
          if (filtered[active]) pick(filtered[active].ref);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setOpen(false);
          window.requestAnimationFrame(() => pickerTriggerRef.current?.focus());
        }
      }}
    >
      {/* The dossier surface: two controls, one visual instrument. The
          picker button owns the reading; the copy button stands beside it,
          never inside it — a button inside a button is a lie to the DOM. */}
      <div
        className={cn(
          "panel-inset group flex w-full flex-wrap items-center gap-x-2.5 gap-y-2.5 rounded-[10px] px-3 py-3 transition-[border-color,background-color] duration-200 sm:flex-nowrap sm:gap-3.5 sm:px-3.5",
          "hover:border-ink-300 dark:hover:border-white/20",
          "focus-within:border-ink-950 focus-within:ring-4 focus-within:ring-ink-950/[0.06] dark:focus-within:border-white/40 dark:focus-within:ring-white/[0.05]",
          open && "border-ink-950 ring-4 ring-ink-950/[0.06] dark:border-white/40 dark:ring-white/[0.05]",
        )}
        onPointerDown={(e) => {
          swiped.current = false;
          dragX.current = e.clientX;
        }}
        onPointerUp={(e) => {
          const startX = dragX.current;
          dragX.current = null;
          if (startX === null || open) return;
          const dx = e.clientX - startX;
          if (Math.abs(dx) >= 44) {
            swiped.current = true;
            step(dx < 0 ? 1 : -1);
          }
        }}
        onPointerCancel={() => {
          dragX.current = null;
        }}
        style={{ touchAction: "pan-y" }}
      >
        <button
          ref={pickerTriggerRef}
          type="button"
          onClick={handleToggleClick}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Tender: ${current ? `${displayReference(current)} — ${current.title}` : "select a tender"}. ${dossierStatus.label}. ${p.pct}% complete${currentCycle?.closingDate ? `. Closes ${fmtDate(currentCycle.closingDate)}; ${relDays(currentCycle.closingDate)}.` : ""} Open the dossier picker.`}
          className="min-w-0 w-full rounded-[8px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 sm:w-auto sm:flex-1"
        >
          {/* One dossier = one slide. The key is the tender reference, so
              flipping the deck slides the card in the direction travelled. */}
          <motion.span
            key={currentRef || "empty"}
            initial={{ opacity: 0, x: dir * 14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="flex min-w-0 items-center gap-3.5"
          >
            <ProgressRing pct={p.pct} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 eyebrow text-[10px] tracking-[0.12em]">
                <span className="text-ink-400 dark:text-ink-500">Working dossier</span>
                <Chip tone={dossierStatus.tone}>{dossierStatus.label}</Chip>
              </span>
              <span className="mt-1.5 flex min-w-0 items-baseline gap-2.5">
                <span className="shrink-0 font-code text-[12.5px] font-bold tracking-[0.08em] text-ink-950 dark:text-white">
                  {current ? displayReference(current) : "—"}
                </span>
                <span className="truncate text-[12px] leading-tight text-ink-500">
                  {current?.title ?? "No tender staged on the desk yet"}
                </span>
              </span>
              {/* One honest meta line, only from the record: the closing date
                  when the cycle has one. Without a record the right-hand count
                  already says what the desk holds — say it once, not twice. */}
              {currentCycle?.closingDate ? (
                <span className="mt-1 inline-flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] leading-relaxed text-ink-600 dark:text-ink-300">
                  <CalendarClock className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>
                    Closes {fmtDate(currentCycle.closingDate)} · {relDays(currentCycle.closingDate)}
                  </span>
                </span>
              ) : null}
            </span>
          </motion.span>
        </button>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {isSystemReference(current?.systemReference) ? (
            <button
              type="button"
              onClick={() => void copyRef()}
              aria-label={`Copy tender reference ${current.systemReference}`}
              title={`Copy ${current.systemReference}`}
              className="focus-brand grid h-11 w-11 place-items-center rounded-lg border border-ink-200/70 text-ink-400 transition-colors hover:border-ink-400 hover:text-ink-900 dark:border-white/10 dark:text-ink-500 dark:hover:border-white/25 dark:hover:text-white"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
          ) : null}
          {many ? (
            <span className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label={`Previous dossier (${displayReference(tenders[(at - 1 + count) % count])})`}
                title="Previous tender"
                className="focus-brand grid h-11 w-11 place-items-center rounded-lg border border-ink-200/70 text-ink-500 transition-colors hover:border-ink-400 hover:bg-ink-950/[0.03] hover:text-ink-900 active:scale-95 dark:border-white/10 dark:text-ink-400 dark:hover:border-white/25 dark:hover:bg-white/[0.05] dark:hover:text-white"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <span className="w-[50px] text-center font-code text-[10px] font-bold tabular tracking-[0.04em] text-ink-600 dark:text-ink-300">
                {String(at + 1).padStart(2, "0")}/{String(count).padStart(2, "0")}
              </span>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label={`Next dossier (${displayReference(tenders[(at + 1) % count])})`}
                title="Next tender"
                className="focus-brand grid h-11 w-11 place-items-center rounded-lg border border-ink-200/70 text-ink-500 transition-colors hover:border-ink-400 hover:bg-ink-950/[0.03] hover:text-ink-900 active:scale-95 dark:border-white/10 dark:text-ink-400 dark:hover:border-white/25 dark:hover:bg-white/[0.05] dark:hover:text-white"
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </span>
          ) : null}
          <span className="hidden text-[10.5px] font-medium text-ink-600 dark:text-ink-300 lg:block">
            {tenders.length} tenders on desk
          </span>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-label={open ? "Collapse tender list" : "Expand tender list"}
            className="focus-brand hidden h-11 w-11 shrink-0 place-items-center rounded-lg border border-ink-200/70 text-ink-600 transition-colors group-hover:border-ink-300 group-hover:text-ink-900 sm:grid dark:border-white/10 dark:text-ink-300 dark:group-hover:border-white/25 dark:group-hover:text-white"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", open && "rotate-180")} aria-hidden="true" />
          </button>
        </span>
      </div>

      {/* Position dots — a direct jump for every dossier on the desk. Kept
          to twelve; past that the stepper and the searchable picker are the
          honest instruments. */}
      {many && count <= 12 ? (
        <div className="mt-2 hidden items-center justify-center gap-1.5 md:flex">
          {tenders.map((t, i) => (
            <button
              key={t.ref}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Dossier ${i + 1} of ${count}: ${displayReference(t)}`}
              aria-current={i === at ? "true" : undefined}
              title={`${displayReference(t)} — ${t.title}`}
              className="focus-brand grid h-11 w-11 place-items-center rounded-full"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "block h-1.5 rounded-full transition-all duration-200",
                  i === at
                    ? "w-4 bg-brand-500 dark:bg-brand-400"
                    : "w-1.5 bg-ink-200 hover:bg-ink-300 dark:bg-white/[0.14] dark:hover:bg-white/[0.28]",
                )}
              />
            </button>
          ))}
        </div>
      ) : null}

      {/* The one announcement a screen reader needs: which dossier the desk
          is showing now. The visual slide animation is silent by design. */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {count
          ? `Dossier ${at + 1} of ${count}: ${current ? `${displayReference(current)} — ${current.title}` : "none selected"}. ${dossierStatus.label}. ${p.pct}% complete${currentCycle?.closingDate ? `. Closes ${fmtDate(currentCycle.closingDate)}; ${relDays(currentCycle.closingDate)}.` : ""}`
          : "No tenders on the desk"}
      </span>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.985 }}
            transition={{ duration: 0.18, ease: EASE }}
            id={pickerPanelId}
            role="dialog"
            aria-label="Choose a tender"
            className="panel panel-lift absolute left-0 right-0 z-40 mt-2 overflow-hidden rounded-[10px]"
          >
            <div className="flex items-center justify-between gap-3 border-b border-ink-100/80 px-4 py-2.5 dark:border-white/[0.06]">
              <p className="eyebrow text-[10px] tracking-[0.1em]">Tenders on the desk</p>
              <span className="text-[10.5px] font-medium tabular text-ink-600 dark:text-ink-300">
                {filtered.length} / {tenders.length}
              </span>
            </div>
            <div className="p-2.5">
              <p id={`${pickerPanelId}-instructions`} className="sr-only">
                Type to filter tenders. Use the up and down arrow keys to move through results, Enter to choose, and Escape to close.
              </p>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" aria-hidden="true" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setActive(0);
                  }}
                  placeholder="Find by reference or title…"
                  aria-label="Find a tender"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={open}
                  aria-controls={listboxId}
                  aria-describedby={`${pickerPanelId}-instructions`}
                  aria-activedescendant={open && filtered[active] ? `${listboxId}-option-${active}` : undefined}
                  className="h-11 w-full rounded-lg border border-ink-200/80 bg-transparent pl-9 pr-3 text-base text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-400 sm:text-[13px] dark:border-white/10 dark:text-ink-900 dark:focus:border-white/30"
                />
              </div>
            </div>
            <ul id={listboxId} role="listbox" aria-label="Tenders" className="max-h-[320px] overflow-y-auto px-1.5 pb-2">
              {filtered.map((t, i) => {
                const row = progressOf(t.ref);
                const selected = t.ref === currentRef;
                return (
                  <li key={t.ref}>
                    <button
                      type="button"
                      id={`${listboxId}-option-${i}`}
                      role="option"
                      tabIndex={-1}
                      aria-selected={i === active}
                      aria-label={`${displayReference(t)} — ${t.title}; ${row.pct}% complete; ${row.stage}${selected ? "; currently open" : ""}`}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(t.ref)}
                      className={cn(
                        "flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors",
                        i === active && "bg-ink-950/[0.045] dark:bg-white/[0.055]",
                        selected && "bg-brand-50/70 dark:bg-brand-500/[0.08]",
                      )}
                    >
                      <span className="flex shrink-0 items-end gap-[2px]" aria-hidden="true">
                        {Array.from({ length: 7 }).map((_, n) => (
                          <span
                            key={n}
                            className={cn(
                              "w-[3px] rounded-full transition-colors",
                              n < Math.round((row.pct / 100) * 7)
                                ? row.pct === 100
                                  ? "bg-emerald-500"
                                  : "bg-brand-500"
                                : "bg-ink-200 dark:bg-white/[0.12]",
                              n === Math.round((row.pct / 100) * 7) - 1 ? "h-3.5" : "h-2",
                            )}
                          />
                        ))}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-code text-[11px] font-bold tracking-[0.04em] text-ink-800 dark:text-ink-200">
                          {displayReference(t)}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-ink-600 dark:text-ink-300">{t.title}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5">
                        <span className={cn("tabular font-code text-[10px] font-bold", row.pct === 100 ? "text-emerald-600 dark:text-emerald-400" : "text-ink-600")}>
                          {row.pct}%
                        </span>
                        <span className="max-w-[110px] truncate text-[10px] leading-tight text-ink-600 dark:text-ink-300">
                          {row.stage}
                        </span>
                      </span>
                      {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden="true" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            {filtered.length === 0 ? (
              <div role="status" className="px-3 py-8 text-center">
                <p className="text-[12px] text-ink-600 dark:text-ink-300">
                  {tenders.length === 0 ? "No tenders staged yet." : "No tender matches that search."}
                </p>
                {tenders.length === 0 ? (
                  <p className="mt-1 text-[11px] text-ink-600 dark:text-ink-300">
                    Start in the pipeline below.
                  </p>
                ) : null}
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ── VitalStrip — the tender's numbers at a glance ──────────────────────────── */

function Vital({
  label,
  value,
  meta,
  accent,
}: {
  label: string;
  value: ReactNode;
  meta: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0 px-5 py-3.5">
      <p className="eyebrow whitespace-nowrap text-[10.5px] tracking-[0.12em]">{label}</p>
      <p
        className={cn(
          "mt-2 truncate font-display text-[17px] font-bold leading-none tracking-[-0.02em] tabular",
          accent ? "text-brand-600 dark:text-brand-400" : "text-ink-950",
        )}
      >
        {value}
      </p>
      {/* The meaning line wraps rather than clipping: "1 late · rejected
          unopened" is the point of the cell, not decoration. */}
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-600 dark:text-ink-300">{meta}</p>
    </div>
  );
}

/**
 * The vitals strip is always present — a blank band is worse than an honest
 * em-dash. Each cell states a number the officer would otherwise have to
 * hunt for, and the line under it says what the number means.
 */
function VitalStrip({ cycle }: { cycle: CycleDto | null }) {
  /* Before the first record exists, five cells of em-dashes would read as a
     broken instrument. One quiet sentence says the same thing honestly. */
  if (!cycle) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-ink-100/80 px-5 py-3.5 dark:border-white/[0.055]">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-dashed border-ink-300 text-ink-400 dark:border-white/20 dark:text-ink-500">
          <Workflow className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <p className="text-[12px] leading-relaxed text-ink-500">
          <span className="font-semibold text-ink-800">No cycle record yet.</span> Stage this tender below —
          opening, evaluation, award and contract each keep their own file from the first entry.
        </p>
        <span className="ml-auto hidden text-[10.5px] font-medium text-ink-600 dark:text-ink-300 sm:block">
          7 stages · one continuous file
        </span>
      </div>
    );
  }

  const bids = cycle?.opening?.rows ?? [];
  const late = bids.filter((b) => b.late).length;
  const scored = cycle?.matrix?.bids ?? [];
  const responsive = scored.filter((b) => b.responsiveness === "RESPONSIVE").length;
  const leading = scored.reduce<number | null>(
    (best, b) => (b.total !== undefined && (best === null || b.total > best) ? b.total : best),
    null,
  );

  const standstillActive = cycle?.standstill?.status === "ACTIVE";
  const contract = cycle?.contract;

  const cells: { label: string; value: ReactNode; meta: ReactNode; accent?: boolean }[] = [
    {
      label: "Closing",
      value: cycle?.closingDate ? fmtDate(cycle.closingDate) : "—",
      meta: cycle?.closingDate ? relDays(cycle.closingDate) : "No closing date on record",
    },
    {
      label: "Bids opened",
      value: bids.length ? bids.length : "—",
      meta: bids.length ? (late ? `${late} late · rejected unopened` : "All bids admitted") : "Awaiting bid opening",
      accent: late > 0,
    },
    {
      label: "Responsive",
      value: scored.length ? `${responsive}/${scored.length}` : "—",
      meta: leading !== null ? `Leading total ${leading}` : "No certified evaluation matrix",
    },
    {
      label: "Standstill",
      value: cycle?.standstill ? (standstillActive ? "Active" : "Lifted") : "—",
      meta: cycle?.standstill ? `Ends ${fmtDate(cycle.standstill.endsAt)} · ${cycle.standstill.days} working days` : "Standstill not reached",
      accent: standstillActive,
    },
    {
      label: "Contract",
      value: contract ? `${contract.currency ?? ""} ${fmtMoney(contract.value)}`.trim() : "—",
      meta: contract ? (contract.completedAt ? "Accepted · cycle closed" : "Active · milestones open") : "Not yet awarded",
    },
  ];

  return (
    <div
      className="grid grid-cols-2 gap-px border-t border-ink-100/80 bg-ink-100/70 sm:grid-cols-3 xl:grid-cols-5 dark:border-white/[0.055] dark:bg-white/[0.07]"
      aria-label="Tender vitals"
    >
      {cells.map((c) => (
        <div
          key={c.label}
          className="min-w-0 bg-[#fffefa] last:col-span-2 sm:last:col-span-2 xl:last:col-span-1 dark:bg-[#12141a] lg:bg-transparent dark:lg:bg-transparent"
        >
          <Vital label={c.label} value={c.value} meta={c.meta} accent={c.accent} />
        </div>
      ))}
    </div>
  );
}

/* ── tender comparison ─────────────────────────────────────────────────────── */

interface CompareRow {
  ref: string;
  title: string;
  closing?: string;
  stageLabel: string;
  stageCaption: string;
  pct: number;
  bids: number;
  portalBids: number;
  value?: number;
  currency?: string;
  valueKind: "contract" | "estimate" | null;
  complaints: number;
  alb: number;
}

/* One comparison row, read from the tender's own cycle record — every figure
   is stored, none inferred. Missing data renders as a dash, never as zero. */
function compareRowOf(
  ref: string,
  title: string,
  cycles: CycleDto[],
  pipeline: PipelineDto[],
  applications: PortalAppRow[],
): CompareRow {
  const cycle = cycles.find((c) => c.tenderId === ref) ?? null;
  const { stages, doneCount, currentIndex } = deriveStages(cycle);
  const stage = stages[currentIndex];
  const plan = pipeline.find((p) => p.linkedTenderId === ref || p.ref === ref);
  const contractValue = cycle?.contract?.value;
  return {
    ref,
    title,
    ...(cycle?.closingDate ? { closing: cycle.closingDate } : {}),
    stageLabel: stage?.label ?? "Not started",
    stageCaption: stage?.caption ?? "No record yet",
    pct: Math.round((doneCount / stages.length) * 100),
    bids: cycle?.opening?.rows.length ?? cycle?.matrix?.bids.length ?? 0,
    portalBids: applications.filter((a) => a.tenderId === ref).length,
    ...(contractValue !== undefined
      ? { value: contractValue, currency: cycle?.contract?.currency, valueKind: "contract" as const }
      : plan?.budgetEstimate !== undefined
        ? { value: plan.budgetEstimate, currency: plan.currency, valueKind: "estimate" as const }
        : { valueKind: null }),
    complaints: cycle?.complaints.filter((c) => c.status === "OPEN").length ?? 0,
    alb: cycle?.alb.length ?? 0,
  };
}

function TenderCompare({
  tenders,
  cycles,
  pipeline,
  applications,
  current,
  onSelect,
}: {
  tenders: { ref: string; title: string; systemReference?: string; source?: "sample" | "record" }[];
  cycles: CycleDto[];
  pipeline: PipelineDto[];
  applications: PortalAppRow[];
  current: string;
  onSelect: (ref: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const dialogId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      if (!wasOpenRef.current) return;
      wasOpenRef.current = false;
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      const timer = window.setTimeout(() => {
        if (target?.isConnected) target.focus();
      }, 220);
      return () => window.clearTimeout(timer);
    }
    wasOpenRef.current = true;
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? active : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const focusedModal = document.activeElement?.closest('[role="dialog"][aria-modal="true"]');
      if (focusedModal && focusedModal !== dialogRef.current) return;
      setOpen(false);
    };
    const prior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prior;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const start = () => {
    const others = tenders.filter((t) => t.ref !== current).map((t) => t.ref);
    setPicked([current, ...others].filter(Boolean).slice(0, 3));
    setOpen(true);
  };

  const toggle = (r: string) =>
    setPicked((list) =>
      list.includes(r) ? list.filter((x) => x !== r) : list.length >= 4 ? list : [...list, r],
    );

  const rows = picked
    .map((r) => {
      const t = tenders.find((x) => x.ref === r);
      return t ? compareRowOf(t.ref, t.title, cycles, pipeline, applications) : null;
    })
    .filter((r): r is CompareRow => r !== null);

  /* The earliest closing among the picked tenders — the fact a comparison is
     usually opened for. */
  let earliest: string | undefined;
  for (const r of rows) {
    if (!r.closing) continue;
    if (!earliest || new Date(r.closing).getTime() < new Date(earliest).getTime()) earliest = r.closing;
  }

  const facts: { label: string; value: (r: CompareRow) => ReactNode }[] = [
    {
      label: "Closes",
      value: (r) => (
        <>
          <p className="text-[11.5px] font-semibold text-ink-800 dark:text-ink-100">{fmtDate(r.closing)}</p>
          <p
            className={cn(
              "mt-0.5 font-code text-[10px] font-bold tracking-[0.08em]",
              r.closing && (daysUntil(r.closing) ?? 0) < 0 ? "text-brand-700 dark:text-brand-300" : "text-ink-400",
            )}
          >
            {r.closing ? relDays(r.closing).toUpperCase() : "NO DATE ON RECORD"}
          </p>
        </>
      ),
    },
    {
      label: "Stage",
      value: (r) => (
        <>
          <p className="text-[11.5px] font-semibold text-ink-800 dark:text-ink-100">{r.stageLabel}</p>
          <span className="mt-1.5 block h-[2px] w-full overflow-hidden rounded-full bg-ink-100 dark:bg-white/[0.08]">
            <span className="block h-full rounded-full bg-brand-500" style={{ width: `${r.pct}%` }} />
          </span>
          <p className="mt-1 font-code text-[10px] leading-snug tracking-[0.06em] text-ink-500 dark:text-ink-400">
            {r.pct}% COMPLETE · {r.stageCaption.toUpperCase()}
          </p>
        </>
      ),
    },
    {
      label: "Bids read",
      value: (r) => (
        <>
          <p className="font-display text-[20px] font-bold leading-none text-ink-950 tabular dark:text-white">{r.bids}</p>
          <p className="mt-1 font-code text-[10px] leading-snug tracking-[0.06em] text-ink-500 dark:text-ink-400">
            {r.bids === 1 ? "BID ON THE REGISTER" : "BIDS ON THE REGISTER"}
          </p>
        </>
      ),
    },
    {
      label: "Portal bids",
      value: (r) => (
        <>
          <p className="font-display text-[20px] font-bold leading-none text-ink-950 tabular dark:text-white">{r.portalBids}</p>
          <p className="mt-1 font-code text-[10px] leading-snug tracking-[0.06em] text-ink-500 dark:text-ink-400">RECEIVED FROM SUPPLIERS</p>
        </>
      ),
    },
    {
      label: "Value",
      value: (r) =>
        r.value !== undefined ? (
          <>
            <p className="font-code text-[11px] font-bold tracking-[0.04em] text-ink-900 tabular dark:text-ink-100">
              {r.currency ? `${r.currency} ` : ""}
              {fmtMoney(r.value)}
            </p>
            <p className="mt-1 font-code text-[10px] leading-snug tracking-[0.06em] text-ink-500 dark:text-ink-400">
              {r.valueKind === "contract" ? "CONTRACT ON RECORD" : "BUDGET ESTIMATE"}
            </p>
          </>
        ) : (
          <p className="text-[11.5px] text-ink-400">—</p>
        ),
    },
    {
      label: "Risk flags",
      value: (r) => (
        <>
          <p className="text-[11.5px] font-semibold text-ink-800 dark:text-ink-100">
            {r.complaints} {r.complaints === 1 ? "open complaint" : "open complaints"}
          </p>
          <p className="mt-0.5 font-code text-[10px] leading-snug tracking-[0.06em] text-ink-500 dark:text-ink-400">
            {r.alb} ALB {r.alb === 1 ? "DOSSIER" : "DOSSIERS"}
          </p>
        </>
      ),
    },
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={start}
        disabled={tenders.length < 2}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${dialogId}-dialog`}
        title={tenders.length < 2 ? "Stage at least two tenders to compare them" : "Compare the tenders on the desk"}
        className="focus-brand inline-flex h-11 min-h-11 shrink-0 items-center justify-center gap-2 rounded-[10px] border border-ink-200/80 bg-[#fffdfb] px-3.5 font-code text-[10.5px] font-bold tracking-[0.08em] text-ink-800 shadow-[0_1px_2px_rgba(11,12,15,0.04)] transition-colors hover:border-brand-400 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-ink-200 dark:hover:border-brand-500/50 dark:hover:text-brand-300 sm:h-auto sm:self-stretch"
      >
        <Scale className="h-3.5 w-3.5" aria-hidden="true" />
        Compare
        <span className="rounded-full bg-ink-950 px-1.5 py-0.5 text-[10px] font-bold tracking-[0.04em] text-white dark:bg-white dark:text-ink-950">
          {tenders.length}
        </span>
      </button>

      {typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <motion.div
                  key={`compare-${dialogId}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="fixed inset-0 z-[90] grid place-items-center bg-night/70 p-3 backdrop-blur-sm sm:p-5"
                  onMouseDown={(event) => {
                    if (event.target === event.currentTarget) setOpen(false);
                  }}
                >
                  <motion.div
                    ref={dialogRef}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={`${dialogId}-title`}
                    tabIndex={-1}
                    initial={{ opacity: 0, y: 18, scale: 0.985 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 12, scale: 0.99 }}
                    transition={{ duration: 0.28, ease: EASE }}
                    onKeyDown={(event) => trapTabFocus(event, dialogRef.current)}
                    className="panel panel-lift flex max-h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-[12px]"
                  >
                    <header className="flex shrink-0 items-start justify-between gap-4 border-b border-ink-100 px-5 py-4 dark:border-white/[0.06] sm:px-7 sm:py-5">
                      <div className="min-w-0">
                        <p className="font-code text-[10px] font-bold tracking-[0.1em] text-brand-800 dark:text-brand-300">
                          Tender cycle · comparison
                        </p>
                        <h3
                          id={`${dialogId}-title`}
                          className="mt-1 font-display text-[20px] font-black tracking-[-0.02em] text-ink-950 dark:text-white sm:text-[22px]"
                        >
                          Compare bidding tenders
                        </h3>
                        <p className="mt-1.5 max-w-[70ch] text-[11.5px] leading-relaxed text-ink-500 dark:text-ink-400">
                          Closing, stage, bids and value side by side — read live from each tender&apos;s own cycle record. Pick up to four.
                        </p>
                      </div>
                      <button
                        ref={closeRef}
                        type="button"
                        onClick={() => setOpen(false)}
                        aria-label="Close tender comparison"
                        className="focus-brand grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-950 sm:w-10 dark:hover:bg-white/[0.06] dark:hover:text-white"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </header>

                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                      {/* The desk's whole register, one tap each — the selection
                          IS the comparison. */}
                      <div className="border-b border-ink-100/80 px-5 py-3 dark:border-white/[0.06] sm:px-7">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {tenders.map((t) => {
                            const on = picked.includes(t.ref);
                            const full = !on && picked.length >= 4;
                            return (
                              <button
                                key={t.ref}
                                type="button"
                                onClick={() => toggle(t.ref)}
                                aria-pressed={on}
                                disabled={full}
                                title={t.title}
                                className={cn(
                                  "focus-brand inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 font-code text-[10px] font-bold tracking-[0.06em] transition-colors",
                                  on
                                    ? "border-ink-950 bg-ink-950 text-white dark:border-white dark:bg-white dark:text-ink-950"
                                    : "border-ink-200 bg-white text-ink-500 hover:border-ink-400 hover:text-ink-900 dark:border-white/[0.12] dark:bg-white/[0.03] dark:text-ink-400 dark:hover:border-white/30 dark:hover:text-white",
                                  full && "cursor-not-allowed opacity-35",
                                )}
                              >
                                <span
                                  className={cn("h-1 w-1 rounded-full", on ? "bg-emerald-400" : "bg-ink-300 dark:bg-white/25")}
                                  aria-hidden="true"
                                />
                                {tenderReferenceLabel(t)}
                              </button>
                            );
                          })}
                          <span aria-live="polite" className="ml-auto text-[10.5px] font-semibold text-ink-600">
                            {picked.length} of 4 selected
                          </span>
                        </div>
                      </div>

                      {rows.length === 0 ? (
                        <p className="px-5 py-12 text-center text-[12.5px] text-ink-500 sm:px-7">
                          Pick at least one tender to compare.
                        </p>
                      ) : (
                        <HorizontalScrollRegion label="Tender comparison table">
                          <table className="w-full min-w-[560px] border-collapse text-left">
                            <thead>
                              <tr className="border-b border-ink-100 dark:border-white/[0.07]">
                                <th
                                  scope="col"
                                  className="sticky left-0 z-10 w-[148px] bg-[#fffdfb] px-4 py-3 font-code text-[10px] font-bold tracking-[0.08em] text-ink-600 dark:bg-[#12141a]"
                                >
                                  TENDER
                                </th>
                                {rows.map((r) => (
                                  <th
                                    key={r.ref}
                                    scope="col"
                                    className="min-w-[176px] border-l border-ink-100/70 px-3 py-3 align-top dark:border-white/[0.055]"
                                  >
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-950 dark:text-white">
                                        {tenderReferenceLabel(tenders.find((tender) => tender.ref === r.ref))}
                                      </span>
                                      {r.ref === current ? (
                                        <span className="rounded-full bg-ink-950 px-2 py-1 font-code text-[10px] font-bold tracking-[0.04em] text-white dark:bg-white dark:text-ink-950">
                                          ON DESK
                                        </span>
                                      ) : null}
                                      {rows.length > 1 && earliest === r.closing ? (
                                        <span className="rounded-full bg-emerald-500/10 px-2 py-1 font-code text-[10px] font-bold tracking-[0.04em] text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">
                                          CLOSES FIRST
                                        </span>
                                      ) : null}
                                    </div>
                                    <p className="mt-1 line-clamp-2 text-[10.5px] font-medium leading-snug text-ink-500 dark:text-ink-400">
                                      {r.title}
                                    </p>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {facts.map((fact) => (
                                <tr
                                  key={fact.label}
                                  className="border-b border-ink-100/60 last:border-0 dark:border-white/[0.045]"
                                >
                                  <th
                                    scope="row"
                                    className="sticky left-0 z-10 bg-[#fffdfb] px-4 py-3.5 align-top font-code text-[10px] font-bold tracking-[0.06em] text-ink-600 dark:bg-[#12141a]"
                                  >
                                    {fact.label.toUpperCase()}
                                  </th>
                                  {rows.map((r) => (
                                    <td
                                      key={r.ref}
                                      className="border-l border-ink-100/70 px-3 py-3.5 align-top dark:border-white/[0.055]"
                                    >
                                      {fact.value(r)}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                              <tr>
                                <td className="sticky left-0 z-10 bg-[#fffdfb] px-4 py-3 dark:bg-[#12141a]" />
                                {rows.map((r) => (
                                  <td
                                    key={r.ref}
                                    className="border-l border-ink-100/70 px-3 py-3 dark:border-white/[0.055]"
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        onSelect(r.ref);
                                        setOpen(false);
                                      }}
                                      className="focus-brand inline-flex min-h-11 items-center gap-1 font-code text-[10px] font-bold tracking-[0.06em] text-brand-800 transition-colors hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200"
                                    >
                                      OPEN DOSSIER
                                      <ArrowRight className="h-2.5 w-2.5" aria-hidden="true" />
                                    </button>
                                  </td>
                                ))}
                              </tr>
                            </tbody>
                          </table>
                        </HorizontalScrollRegion>
                      )}
                    </div>

                    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-5 py-3.5 dark:border-white/[0.06] sm:px-7">
                      <p className="max-w-[60ch] text-[11.5px] leading-relaxed text-ink-600">
                        Every figure is stored on the tender&apos;s cycle record — closing date, opening register, portal
                        applications, contract value. Nothing here is inferred.
                      </p>
                      <button
                        type="button"
                        onClick={() => setOpen(false)}
                        className="focus-brand inline-flex min-h-11 items-center rounded-lg border border-ink-200/80 px-3 font-code text-[10.5px] font-bold tracking-[0.06em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950 dark:border-white/[0.12] dark:text-ink-300 dark:hover:border-white/30 dark:hover:text-white"
                      >
                        CLOSE
                      </button>
                    </footer>
                  </motion.div>
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}

/* ── the desk ───────────────────────────────────────────────────────────────── */

export function CycleView({
  onToast,
  canDeleteDocuments = false,
  selectedPage = "solicitation",
  onPageChange,
}: {
  user?: unknown;
  onToast: (m: string) => void;
  canDeleteDocuments?: boolean;
  selectedPage?: CyclePageTab;
  onPageChange?: (page: CyclePageTab) => void;
}) {
  const [tenders, setTenders] = useState<{ ref: string; title: string; systemReference?: string; source?: "sample" | "record" }[]>([]);
  const [ref, setRef] = useState("");
  const [tab, setTab] = useState<CyclePageTab>(selectedPage);
  const [cycles, setCycles] = useState<CycleDto[]>([]);
  const [pipeline, setPipeline] = useState<PipelineDto[]>([]);
  const [deadlines, setDeadlines] = useState<DeadlineDto[]>([]);
  const [analytics, setAnalytics] = useState<Record<string, number | string> | null>(null);
  const [quarterlyPeriods, setQuarterlyPeriods] = useState<QuarterlyPeriodDto[]>([]);
  const [members, setMembers] = useState<MemberDto[]>([]);
  const [budgetLines, setBudgetLines] = useState<BudgetLineDto[]>([]);
  const [methods, setMethods] = useState<MethodDto[]>([]);
  const [methodsStatus, setMethodsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [methodsRetry, setMethodsRetry] = useState(0);
  const methodSelectRef = useRef<HTMLSelectElement>(null);
  const methodRetryButtonRef = useRef<HTMLButtonElement>(null);
  const methodsRetryFocusRef = useRef(false);
  const [busy, setBusy] = useState(false);
  /* Draft inputs, one record shared across the tab forms. */
  const [d, setD] = useState<Record<string, string>>({});
  const [criteriaDraft, setCriteriaDraft] = useState<EvaluationCriterion[] | null>(null);
  const [criteriaProcedureDraft, setCriteriaProcedureDraft] = useState<string | null>(null);
  const [criteriaAnnouncement, setCriteriaAnnouncement] = useState("");
  const evaluationCriterionTitleRefs = useRef<(HTMLInputElement | null)[]>([]);
  const firstEvaluationCriterionButtonRef = useRef<HTMLButtonElement | null>(null);
  const requiredDocsId = useId();
  const [customDocumentDraft, setCustomDocumentDraft] = useState("");
  const [customDocumentError, setCustomDocumentError] = useState("");
  const [openRows, setOpenRows] = useState<{ bidder: string; receivedAt: string; priceRead: string }[]>([
    { bidder: "", receivedAt: "", priceRead: "" },
  ]);
  /* Applications filed from the supplier portal — read-only context for the
     opening: the officer still records the register, but sees who bid
     electronically and for how much. */
  const [portalApps, setPortalApps] = useState<PortalAppRow[]>([]);
  /* The register owns the neutral reference: refresh when publication year
     changes or another record claims the next sequence number. */
  const [noticeAutoRef, setNoticeAutoRef] = useState("");
  const [noticeRefLoading, setNoticeRefLoading] = useState(true);
  const set = (k: string, v: string) => {
    setD((p) => ({ ...p, [k]: v }));
  };

  useEffect(() => {
    setCriteriaDraft(null);
    setCriteriaProcedureDraft(null);
    setCriteriaAnnouncement("");
  }, [ref]);

  const cycle = useMemo(() => cycles.find((c) => c.tenderId === ref) ?? null, [cycles, ref]);
  const pipelineForCurrent = pipeline.find((entry) => entry.linkedTenderId === ref || entry.ref === ref);
  const currentSystemReference = isSystemReference(cycle?.systemReference)
    ? cycle.systemReference
    : isSystemReference(pipelineForCurrent?.systemReference)
      ? pipelineForCurrent.systemReference
      : isSystemReference(pipelineForCurrent?.ref)
        ? pipelineForCurrent.ref
        : isSystemReference(ref)
          ? ref
          : "";
  const currentReferenceLabel = tenderReferenceLabel(tenders.find((tender) => tender.ref === ref));
  const selectedNoticeMethodId = canonicalMethodId(d.noticeMethod ?? cycle?.methodId);
  const selectedNoticeMethod = methods.find((method) => method.id === selectedNoticeMethodId);
  const methodRecordSelectionId = canonicalMethodId(d.methodPick ?? cycle?.methodId);
  const methodRecordSelection = methods.find((method) => method.id === methodRecordSelectionId);
  const showMethodRecordGuidance = methodsStatus === "ready" && !!methodRecordSelection?.when && (
    methodRecordSelectionId !== canonicalMethodId(cycle?.methodId) || !cycle?.method?.when
  );
  const noticeMethodName = selectedNoticeMethod?.name ?? cycle?.method?.name ?? "Open national bidding";
  const selectedNoticeScope = d.noticeScope ?? scopeForMethodId(selectedNoticeMethodId) ?? "National";
  const methodGroups = useMemo(() => {
    const groups = new Map<string, MethodDto[]>();
    for (const method of methods) {
      const group = groups.get(method.group) ?? [];
      group.push(method);
      groups.set(method.group, group);
    }
    return Array.from(groups.entries());
  }, [methods]);

  useEffect(() => {
    setTab(selectedPage);
  }, [selectedPage]);

  const selectTab = (next: CyclePageTab) => {
    setTab(next);
    onPageChange?.(next);
  };

  const pull = useCallback(async () => {
    try {
      const [t, c, dl, an, cm, rn, ap, bl, qr] = await Promise.all([
        fetch(`/api/sample-tenders${SVC}`).then((x) => x.json()),
        fetch(`/api/cycle${SVC}`).then((x) => x.json()),
        fetch(`/api/cycle/deadlines${SVC}`).then((x) => x.json()),
        fetch(`/api/cycle/analytics${SVC}`).then((x) => x.json()),
        fetch("/api/committee").then((x) => x.json()),
        fetch(`/api/runs${SVC}`).then((x) => x.json()),
        fetch(`/api/applications${SVC}`).then((x) => x.json()),
        fetch(`/api/budget-lines${SVC}`).then((x) => x.json()),
        fetch(`/api/cycle/quarterly-reports${SVC}`).then((x) => x.json()),
      ]);
      const samples = (t.samples ?? []) as { ref: string; title?: string }[];
      const cycleRows = ((c.cycles ?? []) as CycleDto[]).map(normalizeCycle);
      const pipelineRows = (c.pipeline ?? []) as PipelineDto[];
      const runRows = (rn.runs ?? []) as { tenderId: string; reference?: string }[];
      const systemReferences = new Map<string, string>();
      const rememberReference = (tenderId: string | undefined, candidate: unknown) => {
        if (tenderId && isSystemReference(candidate) && !systemReferences.has(tenderId)) {
          systemReferences.set(tenderId, candidate);
        }
      };
      for (const entry of pipelineRows) {
        const systemReference = isSystemReference(entry.systemReference)
          ? entry.systemReference
          : isSystemReference(entry.ref) ? entry.ref : undefined;
        rememberReference(entry.linkedTenderId, systemReference);
        rememberReference(entry.ref, systemReference);
      }
      for (const cycle of cycleRows) rememberReference(cycle.tenderId, cycle.systemReference);
      for (const run of runRows) rememberReference(run.tenderId, run.reference);
      /* Live tenders the desk has seen (runs + cycles) join the curated packs —
         a manually staged probe tender is as real to the cycle as a sample. */
      const seen = new Set<string>();
      const list: { ref: string; title: string; systemReference?: string; source?: "sample" | "record" }[] = [];
      const push = (ref: string, title?: string, source?: "sample" | "record") => {
        if (!ref || seen.has(ref)) return;
        seen.add(ref);
        const systemReference = systemReferences.get(ref) ?? (isSystemReference(ref) ? ref : undefined);
        list.push({ ref, title: title || "Tender record", ...(systemReference ? { systemReference } : {}), ...(source ? { source } : {}) });
      };
      for (const s of samples) push(s.ref, s.title, "sample");
      for (const cyc of cycleRows) push(cyc.tenderId, undefined, "record");
      for (const r of runRows) push(r.tenderId, undefined, "record");
      setTenders(list);
      setCycles(cycleRows);
      setPipeline(pipelineRows);
      setDeadlines(
        ((dl.deadlines ?? []) as DeadlineDto[])
          .map((d) => ({ ...d, kind: d.kind || "DEADLINE" }))
          .filter((d) => typeof d.dueAt === "string" && !Number.isNaN(new Date(d.dueAt).getTime()))
      );
      setAnalytics(an ?? null);
      setQuarterlyPeriods((qr.periods ?? []) as QuarterlyPeriodDto[]);
      setMembers(((cm.members ?? []) as MemberDto[]).filter((m) => m.status === "PRESENT"));
      setPortalApps(((ap.applications ?? []) as PortalAppRow[]).filter((a) => a.status === "RECEIVED"));
      setBudgetLines((bl.lines ?? []) as BudgetLineDto[]);
      setRef((cur) => cur || list[0]?.ref || "");
    } catch {
      /* the desk renders what it last had; the poll retries */
    }
  }, []);

  useEffect(() => {
    void pull();
    const id = setInterval(() => void pull(), 5000);
    return () => clearInterval(id);
  }, [pull]);

  /* The method register is the law's own list — loaded live so the selector
     cannot drift from what the sidecar validates against. */
  useEffect(() => {
    let alive = true;
    setMethodsStatus("loading");
    fetch(`/api/methods${SVC}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Method register request failed (${res.status}).`);
        return res.json();
      })
      .then((data: { ZM?: MethodDto[] }) => {
        if (!alive) return;
        if (Array.isArray(data.ZM) && data.ZM.length > 0) {
          setMethods(data.ZM);
          setMethodsStatus("ready");
        } else {
          setMethodsStatus("error");
        }
      })
      .catch(() => {
        if (alive) setMethodsStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [methodsRetry]);

  useEffect(() => {
    if (!methodsRetryFocusRef.current || methodsStatus === "loading") return;
    const target = methodsStatus === "ready" ? methodSelectRef.current : methodRetryButtonRef.current;
    if (document.activeElement === document.body && target) requestAnimationFrame(() => target.focus());
    methodsRetryFocusRef.current = false;
  }, [methodsStatus]);

  const noticeDraftCount = cycles.reduce((count, cycle) => count + cycle.notices.length, 0);
  const refreshNoticeRef = useCallback(async () => {
    setNoticeRefLoading(true);
    try {
      const res = await fetch(`/api/pipeline/next-ref?XTransformPort=3031`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { ref?: string };
      if (res.ok && isSystemReference(data.ref)) setNoticeAutoRef(data.ref);
    } catch {
      /* The sidecar issues the reference when the notice draft is saved. */
    } finally {
      setNoticeRefLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshNoticeRef();
  }, [refreshNoticeRef, pipeline.length, cycles.length, noticeDraftCount, tenders.length]);

  const act = async (path: string, body: unknown, okMsg: string, firstParty = false): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await fetch(`${path}${firstParty ? "" : SVC}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        onToast((data.error ?? `THE CYCLE SERVICE REFUSED (HTTP ${res.status})`).toUpperCase());
        return false;
      }
      onToast(okMsg.toUpperCase());
      await pull();
      return true;
    } catch {
      onToast("THE CYCLE SERVICE DID NOT ANSWER — quorum-mcp UNREACHABLE");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const refreshCycle = () => void pull();

  /* ── Solicitation — the notice, the specification and the question log ──────
     Everything a bidder reads before the closing is created here: the notice
     (refused at publication unless every mandatory field is present), the
     specification the review desk will pin SHALL clauses from, and the
     clarifications and addenda that change the pack for every bidder at once. */

  const tenderTitle = tenders.find((t) => t.ref === ref)?.title ?? "";
  const notices = cycle?.notices ?? [];
  const currentNotice = notices.length ? notices[notices.length - 1] : null;
  const selectedRequiredDocs = useMemo(() => {
    const documents = d.noticeDocs === undefined
      ? requiredDocumentsFromNotice(currentNotice?.md)
      : d.noticeDocs.split("\n").map((document) => document.trim()).filter(Boolean);
    return new Set(documents);
  }, [currentNotice?.id, currentNotice?.md, d.noticeDocs]);
  const customRequiredDocs = useMemo(() => {
    const fromDraft = (d.noticeCustomDocs ?? "").split("\n").map((document) => document.trim()).filter(Boolean);
    const fromNotice = requiredDocumentsFromNotice(currentNotice?.md)
      .filter((document) => !STANDARD_REQUIRED_DOCUMENTS.has(document.toLocaleLowerCase()));
    return [...new Map([...fromNotice, ...fromDraft].map((document) => [document.toLocaleLowerCase(), document] as const)).values()];
  }, [currentNotice?.id, currentNotice?.md, d.noticeCustomDocs]);
  const customRequiredSelected = customRequiredDocs.filter((document) => selectedRequiredDocs.has(document)).length;
  const setRequiredDocument = (document: string, required: boolean) => {
    const next = new Set(selectedRequiredDocs);
    if (required) {
      if (next.size >= MAX_REQUIRED_DOCUMENTS) return;
      next.add(document);
    } else {
      next.delete(document);
    }
    set("noticeDocs", [...next].join("\n"));
  };
  /* Section controls act on one table at a time — every standard group and
     the custom list can be filled or cleared without touching the others. */
  const setRequiredDocuments = (documents: readonly string[], required: boolean) => {
    const next = new Set(selectedRequiredDocs);
    if (required) {
      for (const document of documents) {
        if (next.size >= MAX_REQUIRED_DOCUMENTS) break;
        next.add(document);
      }
    } else {
      for (const document of documents) next.delete(document);
    }
    set("noticeDocs", [...next].join("\n"));
  };
  const addCustomRequiredDocument = () => {
    const document = customDocumentDraft.trim().replace(/\s+/g, " ");
    setCustomDocumentError("");
    if (!document) {
      setCustomDocumentError("Enter the name of the document first.");
      return;
    }
    if (document.length > 180) {
      setCustomDocumentError("Document names must be 180 characters or fewer.");
      return;
    }
    if (selectedRequiredDocs.size >= MAX_REQUIRED_DOCUMENTS) {
      setCustomDocumentError(`A notice can list up to ${MAX_REQUIRED_DOCUMENTS} required documents.`);
      return;
    }
    const standardMatch = REQUIRED_DOCUMENT_GROUPS.flatMap((group) => group.documents)
      .find((option) => option.toLocaleLowerCase() === document.toLocaleLowerCase());
    if (standardMatch) {
      setRequiredDocument(standardMatch, true);
      setCustomDocumentDraft("");
      return;
    }
    const existingCustom = customRequiredDocs.find((option) => option.toLocaleLowerCase() === document.toLocaleLowerCase());
    if (existingCustom) {
      setRequiredDocument(existingCustom, true);
      setCustomDocumentDraft("");
      return;
    }
    set("noticeCustomDocs", [...customRequiredDocs, document].join("\n"));
    setRequiredDocument(document, true);
    setCustomDocumentDraft("");
  };
  const noticeMissing = (currentNotice?.fieldCheck ?? []).filter((f) => !f.present);
  const currentSpec = cycle?.specs.length ? cycle.specs[cycle.specs.length - 1] : null;
  /* Parse the published markdown, not a cached copy — the publication gate
     re-reads the notice table, so this is the same list it will test. */
  const noticeCriteria = parseEvaluationCriteriaMarkdown(currentNotice?.md ?? "");
  const noticeCriteriaWeight = noticeCriteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const noticeCriteriaTableValid = noticeCriteria.length > 0 && noticeCriteria.length <= 12 && Math.abs(noticeCriteriaWeight - 100) <= 0.0001 &&
    noticeCriteria.every((criterion) => !!criterion.title.trim() && Number.isFinite(criterion.weight) && criterion.weight > 0 && !!criterion.evidence?.trim() && !!criterion.scoringMethod?.trim());
  const noticeProcedurePresent = !!parseEvaluationProcedureMarkdown(currentNotice?.md ?? "").trim();
  const noticeCriteriaValid = noticeCriteriaTableValid && noticeProcedurePresent;
  const evaluationCriteria = currentNotice ? noticeCriteria : parseEvaluationCriteriaMarkdown(currentSpec?.md ?? "");
  const evaluationProcedure = parseEvaluationProcedureMarkdown(currentNotice?.md ?? currentSpec?.md ?? "");
  const legacyIssuedCriteria = notices.some((notice) => !!notice.issuedAt) && evaluationCriteria.length > 0 &&
    evaluationCriteria.some((criterion) => !criterion.evidence?.trim() || !criterion.scoringMethod?.trim());
  const activeEvaluationCriteria = criteriaDraft ?? evaluationCriteria;
  const activeEvaluationProcedure = criteriaProcedureDraft ?? evaluationProcedure;
  const evaluationTotal = activeEvaluationCriteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const evaluationRowValid = (criterion: EvaluationCriterion) =>
    !!criterion.title.trim() && Number.isFinite(criterion.weight) && criterion.weight > 0 &&
    !!criterion.evidence?.trim() && !!criterion.scoringMethod?.trim();
  const evaluationCriteriaValid = activeEvaluationCriteria.length > 0 && activeEvaluationCriteria.length <= 12 &&
    activeEvaluationCriteria.every(evaluationRowValid) && Math.abs(evaluationTotal - 100) <= 0.0001;
  const evaluationValid = evaluationCriteriaValid && !!activeEvaluationProcedure.trim();
  const evaluationIssue = activeEvaluationCriteria.length === 0
    ? "No evaluation-criteria table is on record."
    : activeEvaluationCriteria.length > 12
      ? "More than 12 criteria — a matrix is meant to be read."
      : !activeEvaluationCriteria.every(evaluationRowValid)
        ? activeEvaluationCriteria.some((criterion) => !criterion.title.trim() || !Number.isFinite(criterion.weight) || criterion.weight <= 0)
          ? "Every criterion needs a title and a weight above zero."
          : activeEvaluationCriteria.some((criterion) => !criterion.evidence?.trim())
            ? "State the bidder evidence or subcriteria for every criterion."
            : "State the scoring method for every criterion."
        : Math.abs(evaluationTotal - 100) > 0.0001
          ? `Weights sum to ${evaluationTotal.toFixed(1)}% — they must total exactly 100%.`
          : !activeEvaluationProcedure.trim()
            ? "Describe the evidence and scoring procedure before this can be published."
            : "";
  const evaluationLocked = (currentNotice?.gateId != null) || notices.some((notice) => !!notice.issuedAt);
  const evaluationDirty = criteriaDraft !== null || criteriaProcedureDraft !== null;
  const updateEvaluationCriteria = (update: (rows: EvaluationCriterion[]) => EvaluationCriterion[]) => {
    setCriteriaDraft((current) => reindexEvaluationCriteria(update(current ?? evaluationCriteria)));
  };
  const appendEvaluationCriterion = (criterion: Omit<EvaluationCriterion, "id">) => {
    const nextIndex = activeEvaluationCriteria.length;
    updateEvaluationCriteria((rows) => [...rows, { id: "", ...criterion }]);
    requestAnimationFrame(() => evaluationCriterionTitleRefs.current[nextIndex]?.focus());
  };
  const moveEvaluationCriterion = (index: number, offset: -1 | 1) => {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= activeEvaluationCriteria.length) return;
    const movedCriterion = activeEvaluationCriteria[index];
    updateEvaluationCriteria((rows) => {
      const next = [...rows];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
    setCriteriaAnnouncement(`${movedCriterion.title.trim() || `Criterion ${index + 1}`} moved to position ${nextIndex + 1} of ${activeEvaluationCriteria.length}.`);
    requestAnimationFrame(() => evaluationCriterionTitleRefs.current[nextIndex]?.focus());
  };

  const saveEvaluationCriteria = () => {
    void act(
      `/api/tenders/${ref}/specs/criteria`,
      {
        criteria: activeEvaluationCriteria.map(({ title, weight, evidence, scoringMethod }) => ({ title, weight, evidence, scoringMethod })),
        procedure: activeEvaluationProcedure,
      },
      "EVALUATION CRITERIA AND PROCEDURE SAVED TO THE SPECIFICATION AND NOTICE DRAFT",
    ).then((ok) => {
      if (!ok) return;
      setCriteriaDraft(null);
      setCriteriaProcedureDraft(null);
    });
  };

  const draftTenderNotice = () =>
    act(
      `/api/tenders/${ref}/notices/draft`,
      {
        buyer: d.noticeBuyer,
        subject: d.noticeSubject || tenderTitle,
        method: noticeMethodName,
        closingDate: d.noticeClosing || d.closing || undefined,
        ceiling: d.noticeCeiling,
        contact: d.noticeContact,
        requiredDocs: [...selectedRequiredDocs],
        technicalWeightPct: d.noticeTechWeight ? Number(d.noticeTechWeight) : 80,
        fxBasis: d.noticeFxBasis,
        preferenceScheme: d.noticePreference || "None",
        cdfReservationConstituency: d.noticePreference === "CDF_RESERVATION" ? d.noticeCdfConstituency : undefined,
        cdfReservationExceptionRef: d.noticePreference === "CDF_RESERVATION" ? d.noticeCdfExceptionRef : undefined,
        cdfReservationExceptionBasis: d.noticePreference === "CDF_RESERVATION" ? d.noticeCdfExceptionBasis : undefined,
        foreignBiddersPermitted: d.foreignBiddersPermitted === "true",
        evaluationCurrency: d.noticeEvaluationCurrency || (cycle?.methodCurrency ?? "ZMW"),
        procurementScope: selectedNoticeScope,
      },
      "NOTICE DRAFTED — THE MANDATORY-FIELD CHECK DECIDES WHETHER IT CAN PUBLISH",
    ).then((ok) => ok && refreshCycle());

  const publishTenderNotice = (id: string) =>
    act(
      `/api/tenders/${ref}/notices/${id}/publish`,
      {},
      "PUBLICATION GATE RAISED — THE PROCUREMENT UNIT SIGNS THE NOTICE",
    ).then((ok) => ok && refreshCycle());

  const draftSpecDoc = () =>
    act(
      `/api/tenders/${ref}/specs/draft`,
      { brief: d.specBrief },
      "SPECIFICATION DRAFTED FROM THE BRIEF — SHALL CLAUSES ARE NOW PINNABLE",
    ).then((ok) => ok && refreshCycle());

  const logClarification = () =>
    act(
      `/api/tenders/${ref}/clarifications`,
      { question: d.clarQuestion, askedBy: d.clarBy || undefined },
      "QUESTION LOGGED — THE ANSWER GOES TO EVERY BIDDER",
    ).then((ok) => {
      if (ok) set("clarQuestion", "");
      return ok;
    });

  const PipelineTab = (
    <div className="grid gap-4 xl:gap-5">
      <StageBrief {...STAGE_BRIEFS.solicitation} />

      <Card
        title="Tender notice"
        sub="DRAFTED AND FIELD-CHECKED HERE — PUBLICATION IS A PROCUREMENT UNIT GATE"
        right={
          currentNotice ? (
            currentNotice.issuedAt ? (
              <Chip tone={noticeCriteriaValid ? "ok" : "warn"}>{noticeCriteriaValid ? "ISSUED" : "ISSUED · BASIS REVIEW"}</Chip>
            ) : noticeMissing.length || !noticeCriteriaValid ? (
              <Chip tone="warn">{noticeMissing.length + (noticeCriteriaTableValid ? 0 : 1)} REQUIREMENT{noticeMissing.length + (noticeCriteriaTableValid ? 0 : 1) === 1 ? "" : "S"} MISSING</Chip>
            ) : (
              <Chip tone="brand">READY FOR THE GATE</Chip>
            )
          ) : (
            <Chip tone="muted">NO DRAFT</Chip>
          )
        }
      >
        <div className="grid gap-3">
          <div className="grid gap-2.5 md:grid-cols-2">
            <div className="border-b border-ink-100 pb-2 dark:border-white/[0.07] md:col-span-2">
              <h3 className="font-display text-[13px] font-semibold text-ink-900 dark:text-white">Notice details</h3>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500 dark:text-ink-400">
                Identify the buyer, what is being purchased, and the method used for this tender.
              </p>
            </div>
            <Field label="SYSTEM REFERENCE" hint="Quorum-assigned ID; source-pack keys stay internal.">
              <input
                id="notice-reference"
                className={cn(inputCls, "cursor-default font-code tracking-[0.04em]")}
                value={currentSystemReference || noticeAutoRef}
                placeholder={noticeRefLoading ? "Assigning reference…" : "Issued when record is created"}
                readOnly
                aria-readonly="true"
              />
            </Field>
            <Field label="BUYER — THE PROCURING ENTITY">
              <input id="notice-buyer" className={inputCls} placeholder="e.g. Ministry of Health" value={d.noticeBuyer ?? ""} onChange={(e) => set("noticeBuyer", e.target.value)} />
            </Field>
            <Field label="SUBJECT OF THE PROCUREMENT">
              <input id="notice-subject" className={inputCls} placeholder={tenderTitle || "What is being bought"} value={d.noticeSubject ?? ""} onChange={(e) => set("noticeSubject", e.target.value)} />
            </Field>
            <div className="block min-w-0">
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                <label htmlFor="notice-method" className="eyebrow">PROCUREMENT METHOD</label>
                <span className="min-w-0 font-sans text-[11.5px] leading-[1.4] text-ink-600 dark:text-ink-400">
                  {methodsStatus === "ready" ? `${methods.length} Zambia legal methods · scope set separately` : "Loading Zambia method register…"}
                </span>
              </div>
              <select
                ref={methodSelectRef}
                id="notice-method"
                className={inputCls}
                value={selectedNoticeMethodId}
                disabled={methodsStatus !== "ready"}
                aria-describedby={
                  methodsStatus !== "ready"
                    ? "notice-method-status"
                    : selectedNoticeMethod?.when
                      ? "notice-method-guidance"
                      : undefined
                }
                onChange={(event) => {
                  const methodId = event.target.value;
                  set("noticeMethod", methodId);
                  const scope = scopeForMethodId(methodId);
                  if (scope) set("noticeScope", scope);
                }}
              >
                {methodsStatus === "ready" ? (
                  methodGroups.map(([group, groupMethods]) => (
                    <optgroup key={group} label={group}>
                      {groupMethods.map((method) => (
                        <option key={method.id} value={method.id}>
                          {method.name}
                        </option>
                      ))}
                    </optgroup>
                  ))
                ) : (
                  <option value={selectedNoticeMethodId}>
                    {methodsStatus === "loading" ? "Loading procurement methods…" : "Method register unavailable"}
                  </option>
                )}
              </select>
              {methodsStatus === "ready" && selectedNoticeMethod?.when ? (
                <p id="notice-method-guidance" className="mt-1.5 text-[11px] leading-relaxed text-ink-600 dark:text-ink-400">
                  {selectedNoticeMethod.when}
                </p>
              ) : null}
            </div>
            {methodsStatus !== "ready" ? (
              <div id="notice-method-status" role="status" className="-mt-1 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] leading-relaxed text-ink-500 md:col-span-2">
                <span>
                  {methodsStatus === "loading"
                    ? "Loading the complete Zambia legal-method list."
                    : "The Zambia procurement-method list could not be loaded."}
                </span>
                {methodsStatus === "error" ? (
                  <button
                    ref={methodRetryButtonRef}
                    type="button"
                    onClick={() => {
                      methodsRetryFocusRef.current = true;
                      setMethodsRetry((attempt) => attempt + 1);
                    }}
                    className="focus-brand inline-flex min-h-11 items-center rounded-lg border border-ink-200 px-3 font-code text-[10px] font-bold tracking-[0.06em] text-ink-700 transition-colors hover:border-ink-400 dark:border-white/15 dark:text-ink-200 dark:hover:border-white/30"
                  >
                    TRY AGAIN
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="border-t border-ink-100 pt-3 dark:border-white/[0.07] md:col-span-2">
              <h3 className="font-display text-[13px] font-semibold text-ink-900 dark:text-white">Evaluation and bidder rules</h3>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500 dark:text-ink-400">
                Set evaluation weights, currency, scope, preferences, and bidder eligibility.
              </p>
            </div>
            <Field label="TECHNICAL WEIGHT (%) — BALANCE IS FINANCIAL">
              <input id="notice-technical-weight" className={inputCls} type="number" min={0} max={100} value={d.noticeTechWeight ?? "80"} onChange={(e) => set("noticeTechWeight", e.target.value)} />
            </Field>
            <Field label="EVALUATION CURRENCY">
              <select className={inputCls} value={d.noticeEvaluationCurrency ?? cycle?.methodCurrency ?? "ZMW"} onChange={(e) => set("noticeEvaluationCurrency", e.target.value)}>
                {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
              </select>
            </Field>
            <Field label="PROCUREMENT SCOPE">
              <select className={inputCls} value={selectedNoticeScope} onChange={(e) => set("noticeScope", e.target.value)}>
                <option value="National">National</option>
                <option value="International">International</option>
              </select>
            </Field>
            <Field label="FX BASIS — SOURCE AND OBSERVATION DATE" hint="State the source and date/method the issued document requires bidders and evaluators to use.">
              <input id="notice-fx-basis" className={inputCls} placeholder="Bank of Zambia published rate, dated YYYY-MM-DD" value={d.noticeFxBasis ?? ""} onChange={(e) => set("noticeFxBasis", e.target.value)} />
            </Field>
            <div className="rounded-xl border border-ink-100 bg-paper/60 px-3 py-2.5 text-[11px] leading-relaxed text-ink-600 dark:border-white/[0.07] dark:bg-white/[0.025] dark:text-ink-400">
              <span className="font-semibold">Financial formula fixed for this release:</span> Lowest evaluated price / bidder evaluated price × 100, after documented arithmetic corrections, unconditional discounts and published preference.
            </div>
            <Field label="PREFERENCE / RESERVATION SCHEME">
              <select className={inputCls} value={d.noticePreference ?? "None"} onChange={(e) => set("noticePreference", e.target.value)}>
                <option value="None">None</option>
                <option value="SI45-2025">Zambia SI 45/2025 preference margins</option>
                <option value="CDF_RESERVATION">CDF constituency reservation</option>
              </select>
            </Field>
            {d.noticePreference === "CDF_RESERVATION" ? (
              <div className="grid gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3 md:col-span-2 md:grid-cols-2">
                <Field label="FUNDED CONSTITUENCY">
                  <input id="notice-cdf-constituency" className={inputCls} value={d.noticeCdfConstituency ?? ""} onChange={(e) => set("noticeCdfConstituency", e.target.value)} maxLength={120} placeholder="Name the constituency funding this procurement" />
                </Field>
                <p className="md:col-span-2 text-[10.5px] leading-relaxed text-amber-900 dark:text-amber-200">
                  Optional locality exception under SI 45/2025 regulation 8(2): record it only where procurement requirements cannot be satisfied by a citizen bidder domiciled in the funded constituency. This evidence is part of the published solicitation.
                </p>
                <Field label="LOCALITY ASSESSMENT EVIDENCE REFERENCE">
                  <input id="notice-cdf-evidence" className={inputCls} value={d.noticeCdfExceptionRef ?? ""} onChange={(e) => set("noticeCdfExceptionRef", e.target.value)} maxLength={200} placeholder="Market assessment / local capacity record" />
                </Field>
                <Field label="WHY CONSTITUENCY REQUIREMENTS CANNOT BE MET" hint="At least 20 characters when an evidence reference is supplied.">
                  <input id="notice-cdf-basis" className={inputCls} value={d.noticeCdfExceptionBasis ?? ""} onChange={(e) => set("noticeCdfExceptionBasis", e.target.value)} maxLength={500} placeholder="Describe the unmet requirement and local market check" />
                </Field>
              </div>
            ) : null}
            <label className="flex items-center gap-2 rounded-lg border border-ink-100 px-3 py-2 text-[11.5px] text-ink-700">
              <input type="checkbox" checked={d.foreignBiddersPermitted === "true"} onChange={(e) => set("foreignBiddersPermitted", e.target.checked ? "true" : "false")} />
              Foreign bidders may participate (required for the local supplier 5% margin)
            </label>
            <div className="border-t border-ink-100 pt-3 dark:border-white/[0.07] md:col-span-2">
              <h3 className="font-display text-[13px] font-semibold text-ink-900 dark:text-white">Budget and timeline</h3>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500 dark:text-ink-400">
                Set the spending limit, closing date, and contact for bidder questions.
              </p>
            </div>
            <Field label="BUDGET CEILING">
              <input id="notice-budget-ceiling" className={inputCls} placeholder={`${cycle?.methodCurrency ?? ""} 48,000,000`.trim()} value={d.noticeCeiling ?? ""} onChange={(e) => set("noticeCeiling", e.target.value)} />
            </Field>
            <Field label="CLOSING DATE" hint={cycle?.closingDate ? `on record: ${fmtDate(cycle.closingDate)}` : "moves with the notice"}>
              <input id="notice-closing-date" className={cn(inputCls, "pr-20")} type="date" value={d.noticeClosing ?? ""} onChange={(e) => set("noticeClosing", e.target.value)} />
            </Field>
            <Field label="CONTACT FOR CLARIFICATIONS">
              <input id="notice-clarification-contact" className={inputCls} placeholder="Office, officer and email" value={d.noticeContact ?? ""} onChange={(e) => set("noticeContact", e.target.value)} />
            </Field>
            <div className="min-w-0 border-t border-ink-100 pt-3 dark:border-white/[0.07] md:col-span-2">
              <div className="mb-1.5 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="font-display text-[13px] font-semibold text-ink-900 dark:text-white">Required bid documents</h3>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500 dark:text-[#aeb5c0]">
                    Choose the documents required for this tender. Only enabled items are published in the notice and checked during bid review.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span aria-live="polite" className="rounded-full bg-ink-100 px-2.5 py-1.5 font-code text-[10.5px] font-semibold text-ink-700 dark:bg-white/[0.07] dark:text-[#e3e6eb]">
                    {selectedRequiredDocs.size} SELECTED
                  </span>
                  <button
                    type="button"
                    onClick={() => set("noticeDocs", "")}
                    disabled={selectedRequiredDocs.size === 0}
                    className="focus-brand inline-flex min-h-11 items-center rounded-md px-3 text-[11.5px] font-semibold text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-60 dark:text-[#c3c9d2] dark:hover:bg-white/[0.07] dark:hover:text-white"
                  >
                    Clear selection
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-ink-200/80 bg-paper/70 p-3 dark:border-white/[0.1] dark:bg-[#0b0d12] sm:p-4">
                <div className="grid gap-3 lg:max-h-[520px] lg:overflow-y-auto lg:pr-1 lg:grid-cols-2">
                  {REQUIRED_DOCUMENT_GROUPS.map((group) => {
                    const groupDocuments = group.documents;
                    const groupSelected = groupDocuments.filter((document) => selectedRequiredDocs.has(document)).length;
                    const allSelected = groupSelected === groupDocuments.length;
                    return (
                      <fieldset key={group.label} className="min-w-0 rounded-lg border border-ink-100 bg-white/70 p-2.5 dark:border-white/[0.07] dark:bg-white/[0.02]">
                        <legend className="px-1 font-code text-[10px] font-bold tracking-[0.1em] text-ink-500 dark:text-[#c3c9d2]">{group.label}</legend>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="font-code text-[10px] tracking-[0.06em] text-ink-500 dark:text-[#aeb5c0]" aria-live="polite">
                            {groupSelected} OF {groupDocuments.length} REQUIRED
                          </span>
                          <button
                            type="button"
                            onClick={() => setRequiredDocuments(groupDocuments, !allSelected)}
                            disabled={!allSelected && selectedRequiredDocs.size >= MAX_REQUIRED_DOCUMENTS}
                            aria-label={allSelected ? `Clear all documents in ${group.label}` : `Enable all documents in ${group.label}`}
                            className="focus-brand inline-flex min-h-11 items-center rounded-md px-3 text-[11px] font-semibold text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-60 dark:text-[#d5d9df] dark:hover:bg-white/[0.07] dark:hover:text-white"
                          >
                            {allSelected ? "Clear all" : "Select all"}
                          </button>
                        </div>
                        <div className="grid gap-1">
                          {group.documents.map((document, documentIndex) => {
                            const checked = selectedRequiredDocs.has(document);
                            return (
                              <RequiredDocumentToggle
                                key={document}
                                document={document}
                                checked={checked}
                                disabled={!checked && selectedRequiredDocs.size >= MAX_REQUIRED_DOCUMENTS}
                                onCheckedChange={(on) => setRequiredDocument(document, on)}
                              />
                            );
                          })}
                        </div>
                      </fieldset>
                    );
                  })}

                  {customRequiredDocs.length ? (
                    <fieldset className="min-w-0 rounded-lg border border-brand-500/20 bg-brand-500/[0.025] p-2.5 dark:border-brand-400/15 dark:bg-brand-400/[0.025] lg:col-span-2">
                        <legend className="px-1 font-code text-[10px] font-bold tracking-[0.1em] text-ink-500 dark:text-[#c3c9d2]">CUSTOM / TENDER-SPECIFIC DOCUMENTS</legend>
                      <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="font-code text-[10px] tracking-[0.06em] text-ink-500 dark:text-[#aeb5c0]" aria-live="polite">
                          {customRequiredSelected} OF {customRequiredDocs.length} REQUIRED
                        </span>
                        <button
                          type="button"
                          onClick={() => setRequiredDocuments(customRequiredDocs, customRequiredSelected !== customRequiredDocs.length)}
                          disabled={customRequiredSelected !== customRequiredDocs.length && selectedRequiredDocs.size >= MAX_REQUIRED_DOCUMENTS}
                          aria-label={
                            customRequiredSelected === customRequiredDocs.length
                              ? "Clear all custom required documents"
                              : "Enable all custom required documents"
                          }
                          className="focus-brand inline-flex min-h-11 items-center rounded-md px-3 text-[11px] font-semibold text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-60 dark:text-[#d5d9df] dark:hover:bg-white/[0.07] dark:hover:text-white"
                        >
                          {customRequiredSelected === customRequiredDocs.length ? "Clear all" : "Select all"}
                        </button>
                      </div>
                      <div className="grid gap-1 md:grid-cols-2">
                        {customRequiredDocs.map((document, documentIndex) => {
                          const checked = selectedRequiredDocs.has(document);
                          return (
                            <RequiredDocumentToggle
                              key={document}
                              document={document}
                              checked={checked}
                              disabled={!checked && selectedRequiredDocs.size >= MAX_REQUIRED_DOCUMENTS}
                              onCheckedChange={(on) => setRequiredDocument(document, on)}
                            />
                          );
                        })}
                      </div>
                    </fieldset>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-col gap-2 border-t border-ink-100 pt-3 dark:border-white/[0.07] sm:flex-row">
                  <div className="min-w-0 flex-1">
                    <input
                      id={`${requiredDocsId}-custom-document`}
                      className={cn(inputCls, "h-11 text-base sm:text-[12.5px]")}
                      value={customDocumentDraft}
                      onChange={(event) => {
                        setCustomDocumentDraft(event.target.value);
                        setCustomDocumentError("");
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addCustomRequiredDocument();
                        }
                      }}
                      maxLength={180}
                      placeholder="Add a tender-specific document requirement"
                      aria-label="Custom required document"
                      aria-describedby={customDocumentError ? `${requiredDocsId}-custom-error` : undefined}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={addCustomRequiredDocument}
                    disabled={!customDocumentDraft.trim() || selectedRequiredDocs.size >= MAX_REQUIRED_DOCUMENTS}
                    className="focus-brand inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-ink-200 px-3 text-[11.5px] font-semibold text-ink-700 transition-colors hover:border-ink-400 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.12] dark:text-ink-200 dark:hover:border-white/30 dark:hover:bg-white/[0.05]"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add and require
                  </button>
                </div>
                {customDocumentError ? <p id={`${requiredDocsId}-custom-error`} role="alert" className="mt-1.5 text-[12px] text-rose-700 dark:text-rose-300">{customDocumentError}</p> : null}
                {selectedRequiredDocs.size === 0 ? (
                  <p role="status" className="mt-2 text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">No documents are selected. The notice will explicitly state that no eligibility documents were listed.</p>
                ) : (
                  <p className="mt-2 text-[11.5px] leading-relaxed text-ink-600 dark:text-[#aeb5c0]">You can select up to {MAX_REQUIRED_DOCUMENTS} items. The selected list is included in the published notice and bid-compliance review.</p>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Btn onClick={() => void draftTenderNotice()} disabled={busy || !ref || methodsStatus !== "ready" || evaluationDirty}>
              <FileText className="h-3.5 w-3.5" aria-hidden="true" /> {currentNotice ? "Redraft the notice" : "Draft the notice"}
            </Btn>
            {evaluationDirty ? <p className="basis-full text-[10.5px] text-brand-700 dark:text-brand-300" role="status">Save the evaluation basis before drafting the notice.</p> : null}
            {currentNotice && !currentNotice.issuedAt ? (
              <Btn
                variant="ghost"
                onClick={() => void publishTenderNotice(currentNotice.id)}
                disabled={busy || noticeMissing.length > 0 || !noticeCriteriaValid}
              >
                <Stamp className="h-3.5 w-3.5" aria-hidden="true" /> Publish (procurement unit gate)
              </Btn>
            ) : null}
            {currentNotice?.issuedAt ? (
              <span className="font-code text-[10px] leading-relaxed tracking-[0.08em] text-ink-500 dark:text-ink-400">
                ISSUED {fmtDate(currentNotice.issuedAt)}
                {currentNotice.issuedBy ? ` · ${currentNotice.issuedBy.toUpperCase()}` : ""}
              </span>
            ) : null}
            {currentNotice?.gateId && !currentNotice.issuedAt ? (
              <span className="font-code text-[10px] leading-relaxed tracking-[0.08em] text-brand-700 dark:text-brand-300">
                GATE {currentNotice.gateId} AWAITING A NAMED OFFICER
              </span>
            ) : null}
          </div>

          {currentNotice ? (
            <div className="rounded-xl border border-ink-100 bg-paper px-3 py-2.5 dark:border-white/[0.08]">
              <p className="font-code text-[10px] font-bold tracking-[0.1em] text-ink-500 dark:text-ink-400">MANDATORY FIELDS · {currentNotice.fieldCheck.filter((f) => f.present).length} OF {currentNotice.fieldCheck.length}</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {currentNotice.fieldCheck.map((f) => (
                  <li
                    key={f.field}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.06em]",
                      f.present
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "bg-brand-500/10 text-brand-700 dark:text-brand-300",
                    )}
                  >
                    {f.present ? <Check className="h-2.5 w-2.5" aria-hidden="true" /> : <CircleAlert className="h-2.5 w-2.5" aria-hidden="true" />}
                    {f.field.toUpperCase()}
                  </li>
                ))}
              </ul>
              <div className="mt-2 border-t border-ink-100 pt-2 dark:border-white/[0.06]">
                <p className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-500 dark:text-ink-400">
                  EVALUATION CRITERIA · {noticeCriteriaTableValid ? `${noticeCriteria.length} PUBLISHED · ${noticeCriteriaWeight.toFixed(1)}% TOTAL` : "MISSING / INVALID · DETAILS AND WEIGHTS REQUIRED"}
                </p>
                {noticeCriteriaTableValid ? (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {noticeCriteria.map((criterion) => <li key={criterion.id} className="rounded-md bg-ink-100/70 px-2.5 py-1.5 text-[11.5px] leading-snug text-ink-700 dark:bg-white/[0.05] dark:text-ink-600">{criterion.title} · {criterion.weight}%</li>)}
                  </ul>
                ) : (
                  <p className="mt-1 text-[10.5px] leading-relaxed text-amber-700 dark:text-amber-300">Add bidder evidence / subcriteria and a scoring method for every row; weights must total 100. Then redraft the notice before publication.</p>
                )}
                {!noticeProcedurePresent ? (
                  <p className="mt-1.5 text-[10.5px] leading-relaxed text-amber-700 dark:text-amber-300">The bidder-facing evaluation procedure is missing. Add the evidence and scoring method in Evaluation criteria, then redraft this notice.</p>
                ) : null}
              </div>
              <details className="mt-2.5">
                <summary className="focus-brand inline-flex min-h-11 cursor-pointer items-center rounded-md px-2 font-code text-[10px] font-semibold tracking-[0.08em] text-ink-600 dark:text-ink-600">Read the draft</summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-ink-50/80 p-2.5 text-[11px] leading-relaxed text-ink-700 dark:bg-white/[0.04] dark:text-ink-600">
                  {currentNotice.md}
                </pre>
              </details>
            </div>
          ) : (
            <p className="text-[11.5px] leading-relaxed text-ink-400">
              No notice is on record for {currentReferenceLabel}. The draft is refused at the gate, not here — every mandatory field is checked the moment it is drafted.
            </p>
          )}
        </div>
      </Card>

      <Card
        title="Specification / terms of reference"
        sub="MANDATORY REQUIREMENTS AS SHALL CLAUSES — THE REVIEW DESK PINS THEM VERBATIM"
        right={currentSpec ? <Chip tone={currentSpec.source === "llm" ? "brand" : "muted"}>{currentSpec.source === "llm" ? currentSpec.model ?? "MODEL" : "TEMPLATE"}</Chip> : undefined}
      >
        <div className="grid gap-3">
          <Field label="BRIEF — THE NEED, THE OUTCOME, THE QUANTITIES" hint="one paragraph is enough to start">
            <textarea
              className={cn(inputCls, "h-24 py-2 text-[12px] leading-relaxed")}
              placeholder="Supply and deliver 48 tracer medicines to 62 facilities in 12 counties, including installation of cold-chain monitoring and a 12-month warranty."
              value={d.specBrief ?? ""}
              onChange={(e) => set("specBrief", e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Btn onClick={() => void draftSpecDoc()} disabled={busy || !ref || !(d.specBrief ?? "").trim()}>
              <FileText className="h-3.5 w-3.5" aria-hidden="true" /> {currentSpec ? "Draft a fresh version" : "Draft the specification"}
            </Btn>
              <span className="font-code text-[10px] leading-relaxed tracking-[0.08em] text-ink-500 dark:text-ink-400">
              {currentSpec ? `${cycle?.specs.length} VERSION${(cycle?.specs.length ?? 0) === 1 ? "" : "S"} · LATEST ${fmtDate(currentSpec.createdAt)}` : "NO SPECIFICATION ON RECORD"}
            </span>
          </div>
          {currentSpec ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-ink-100 bg-paper p-3 text-[11px] leading-relaxed text-ink-700 dark:border-white/[0.08] dark:text-ink-600">
              {currentSpec.md}
            </pre>
          ) : (
            <p className="text-[11.5px] leading-relaxed text-ink-400">
              A specification is the document every technical finding is measured against. Draft it before the notice publishes: a requirement the pack never states cannot be enforced against a bid.
            </p>
          )}
        </div>
      </Card>

      <Card
        title="Evaluation criteria"
        sub="AUTHOR THE SCORING BASIS BEFORE THE NOTICE IS ISSUED"
        right={
          evaluationLocked ? (
            <Chip tone="muted">{notices.some((notice) => !!notice.issuedAt) ? "ISSUED · LOCKED" : "GATE · LOCKED"}</Chip>
          ) : activeEvaluationCriteria.length === 0 ? (
            <Chip tone="warn">NO CRITERIA</Chip>
          ) : evaluationValid ? (
            <Chip tone="ok">VALID · 100%</Chip>
          ) : evaluationCriteriaValid ? (
            <Chip tone="warn">PROCEDURE NEEDED</Chip>
          ) : (
            <Chip tone="warn">
              {Number.isInteger(evaluationTotal) ? evaluationTotal : evaluationTotal.toFixed(1)}% TOTAL
            </Chip>
          )
        }
      >
        <div className="grid gap-4">
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{criteriaAnnouncement}</p>
          <div className="rounded-xl border border-ink-100 bg-paper/70 p-3 dark:border-white/[0.08] dark:bg-white/[0.025]">
            <p className="text-[12px] font-semibold text-ink-800 dark:text-ink-800">
              The issued solicitation becomes the committee’s scoring contract.
            </p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-600 dark:text-ink-400">
              For every criterion, disclose the evidence or subcriteria, the scoring method and its relative weight. Bidders see the same basis before they submit; the evaluation matrix will use the published criteria and weights exactly.
            </p>
            <p className="mt-2 border-t border-ink-100 pt-2 text-[11px] leading-relaxed text-ink-500 dark:border-white/[0.07] dark:text-ink-400">
              Keep eligibility and mandatory documents as pass/fail requirements. Use this weighted table for comparative merit, and avoid counting the same outcome twice.
            </p>
          </div>

          {evaluationLocked ? (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.045] p-3" role="status">
              <p className="text-[11.5px] font-semibold text-amber-900 dark:text-amber-200">
                {notices.some((notice) => !!notice.issuedAt)
                  ? "This notice has been issued. Its evaluation basis is fixed for every bidder."
                  : "A publication gate is checking this notice. Withdraw that gate before editing its criteria."}
              </p>
              {currentNotice?.issuedAt ? (
                <p className="mt-1 text-[11px] leading-relaxed text-amber-900/80 dark:text-amber-100/80">
                  If a correction is required after issue, record it through an addendum visible to all bidders.
                </p>
              ) : null}
            </div>
          ) : null}

          {evaluationLocked ? (
            <div className="grid gap-3">
              <div className="overflow-hidden rounded-xl border border-ink-100 dark:border-white/[0.08]">
                <ul className="divide-y divide-ink-100 dark:divide-white/[0.06]">
                  {(evaluationCriteria.length ? evaluationCriteria : activeEvaluationCriteria).map((criterion) => (
                    <li key={criterion.id} className="flex flex-wrap items-start gap-3 px-3 py-2.5">
                      <span className="w-11 shrink-0 font-code text-[10px] font-bold tracking-[0.08em] text-ink-500 dark:text-ink-500">{criterion.id}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-semibold text-ink-800 dark:text-ink-900">{criterion.title}</p>
                        {criterion.evidence ? <p className="mt-1 text-[11px] leading-relaxed text-ink-600 dark:text-ink-500"><span className="font-semibold">Evidence / subcriteria:</span> {criterion.evidence}</p> : null}
                        {criterion.scoringMethod ? <p className="mt-1 text-[11px] leading-relaxed text-ink-600 dark:text-ink-500"><span className="font-semibold">Scoring method:</span> {criterion.scoringMethod}</p> : null}
                      </div>
                      <span className="shrink-0 font-code text-[11px] font-bold tabular-nums text-ink-700 dark:text-ink-600">{criterion.weight}%</span>
                    </li>
                  ))}
                </ul>
                {evaluationProcedure ? (
                  <p className="border-t border-ink-100 bg-paper/70 px-3 py-2.5 text-[11px] leading-relaxed text-ink-700 dark:border-white/[0.07] dark:bg-white/[0.025] dark:text-ink-600">
                    <span className="font-semibold">Evaluation procedure: </span>{evaluationProcedure}
                  </p>
                ) : null}
              </div>
              {!evaluationValid ? (
                <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-200" role="status">
                  {legacyIssuedCriteria
                    ? `This issued notice uses the earlier two-column criteria format${evaluationProcedure ? "" : " and has no detailed procedure"}. Its published basis remains fixed here; distribute any required clarification to every bidder by addendum.`
                    : evaluationProcedure
                      ? evaluationIssue
                      : "No evaluation procedure is disclosed in this issued document. Any clarification must be distributed to every bidder through the addendum process."}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-4">
              {activeEvaluationCriteria.length ? (
                <div className="grid gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="eyebrow">WEIGHTED SCORING CRITERIA</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-ink-500 dark:text-ink-400">{activeEvaluationCriteria.length} of 12 rows · weights total 100% · evidence and scoring method required per criterion</p>
                    </div>
                    {evaluationDirty ? <Chip tone="brand">UNSAVED CHANGES</Chip> : null}
                  </div>
                  <ol className="grid gap-2">
                    {activeEvaluationCriteria.map((criterion, index) => (
                      <li key={criterion.id} className="grid min-w-0 gap-2.5 rounded-xl border border-ink-100 bg-[#fffefa] p-3 dark:border-white/[0.08] dark:bg-white/[0.02] sm:grid-cols-[minmax(0,1fr)_150px_auto] sm:items-end">
                        <Field label={`CRITERION ${String(index + 1).padStart(2, "0")}`} hint="Use an outcome bidders can evidence">
                          <input
                            ref={(element) => { evaluationCriterionTitleRefs.current[index] = element; }}
                            className={inputCls}
                            value={criterion.title}
                            maxLength={120}
                            disabled={busy}
                            aria-label={`Criterion ${index + 1} title`}
                            placeholder="e.g. Delivery plan and implementation capacity"
                            onChange={(event) => updateEvaluationCriteria((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, title: event.target.value } : row))}
                          />
                        </Field>
                        <Field label="WEIGHT (%)" hint="0.1–100">
                          <div className="relative">
                            <input
                              className={cn(inputCls, "pr-9 text-right tabular-nums")}
                              type="number"
                              inputMode="decimal"
                              min="0.1"
                              max="100"
                              step="0.1"
                              disabled={busy}
                              aria-label={`Weight percentage for criterion ${index + 1}`}
                              value={criterion.weight || ""}
                              placeholder="0.0"
                              onChange={(event) => {
                                const rawValue = event.target.value === "" ? 0 : Number(event.target.value);
                                const value = Number.isFinite(rawValue) ? Math.round(rawValue * 10) / 10 : 0;
                                updateEvaluationCriteria((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, weight: value } : row));
                              }}
                            />
                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-ink-400">%</span>
                          </div>
                        </Field>
                        <div className="flex items-center justify-end gap-1 sm:pb-0.5">
                          <button
                            type="button"
                            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 disabled:cursor-not-allowed disabled:opacity-35 dark:text-ink-400 dark:hover:bg-white/[0.08] dark:hover:text-white"
                            aria-label={`Move criterion ${index + 1} up`}
                            disabled={busy || index === 0}
                            onClick={() => moveEvaluationCriterion(index, -1)}
                          >
                            <ChevronUp className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 disabled:cursor-not-allowed disabled:opacity-35 dark:text-ink-400 dark:hover:bg-brand-500/10 dark:hover:text-brand-300"
                            aria-label={`Remove criterion ${index + 1}`}
                            disabled={busy}
                            onClick={() => {
                              const nextLength = activeEvaluationCriteria.length - 1;
                              updateEvaluationCriteria((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
                              requestAnimationFrame(() => {
                                if (nextLength === 0) firstEvaluationCriterionButtonRef.current?.focus();
                                else evaluationCriterionTitleRefs.current[Math.min(index, nextLength - 1)]?.focus();
                              });
                            }}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 disabled:cursor-not-allowed disabled:opacity-35 dark:text-ink-400 dark:hover:bg-white/[0.08] dark:hover:text-white"
                            aria-label={`Move criterion ${index + 1} down`}
                            disabled={busy || index === activeEvaluationCriteria.length - 1}
                            onClick={() => moveEvaluationCriterion(index, 1)}
                          >
                            <ChevronDown className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                        <div className="grid gap-2.5 sm:col-span-3 sm:grid-cols-2">
                          <Field label="BIDDER EVIDENCE / SUBCRITERIA" hint="What documents or measurable facts will be assessed?">
                            <textarea
                              className={cn(inputCls, "h-20 resize-y py-2.5 text-[12px] leading-relaxed")}
                              value={criterion.evidence ?? ""}
                              maxLength={600}
                              disabled={busy}
                              aria-label={`Bidder evidence or subcriteria for ${criterion.title || `criterion ${index + 1}`}`}
                              placeholder="e.g. Named project references completed in the last 5 years; include client, value, dates and completion evidence."
                              onChange={(event) => updateEvaluationCriteria((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, evidence: event.target.value } : row))}
                            />
                          </Field>
                          <Field label="SCORING METHOD" hint="Use published, reproducible anchors or a formula.">
                            <textarea
                              className={cn(inputCls, "h-20 resize-y py-2.5 text-[12px] leading-relaxed")}
                              value={criterion.scoringMethod ?? ""}
                              maxLength={600}
                              disabled={busy}
                              aria-label={`Scoring method for ${criterion.title || `criterion ${index + 1}`}`}
                              placeholder="e.g. Score 0–5 against the published anchors; multiply by this row’s weight; award 0 for no evidence."
                              onChange={(event) => updateEvaluationCriteria((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, scoringMethod: event.target.value } : row))}
                            />
                          </Field>
                        </div>
                      </li>
                    ))}
                  </ol>
                  {activeEvaluationCriteria.length < 12 ? (
                    <div>
                      <p className="text-[10.5px] leading-relaxed text-ink-500 dark:text-ink-400">Optional examples — adapt to the contract and use only where relevant. New rows start at 0%.</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {EVALUATION_CRITERIA_EXAMPLES.map((example) => {
                          const alreadyAdded = activeEvaluationCriteria.some((criterion) => criterion.title.trim().toLocaleLowerCase() === example.toLocaleLowerCase());
                          return (
                            <button
                              key={example}
                              type="button"
                              className="inline-flex min-h-11 items-center rounded-full border border-ink-200/80 px-2.5 text-[10.5px] font-medium text-ink-600 transition-colors hover:border-ink-400 hover:text-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.12] dark:text-ink-400 dark:hover:border-white/25 dark:hover:text-white"
                              aria-label={`Add suggested criterion: ${example}`}
                              disabled={busy || alreadyAdded}
                              onClick={() => appendEvaluationCriterion({ title: example, weight: 0, evidence: "", scoringMethod: "" })}
                            >
                              <Plus className="mr-1 h-3 w-3" aria-hidden="true" />{example}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  <div className="grid gap-3 rounded-xl border border-ink-100 bg-paper/70 p-3 dark:border-white/[0.08] dark:bg-white/[0.025] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="eyebrow">WEIGHT ALLOCATED</span>
                        <span className={cn("font-code text-[12px] font-bold tabular-nums", evaluationCriteriaValid ? "text-emerald-700 dark:text-emerald-300" : "text-brand-700 dark:text-brand-300")}>
                          {Number.isInteger(evaluationTotal) ? evaluationTotal : evaluationTotal.toFixed(1)}% / 100%
                        </span>
                      </div>
                      <div
                        className="mt-2 h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-white/[0.09]"
                        role="progressbar"
                        aria-label="Evaluation criteria weight allocation"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Number.isFinite(evaluationTotal) ? Math.min(100, Math.max(0, Number(evaluationTotal.toFixed(1)))) : 0}
                      >
                        <div className={cn("h-full rounded-full transition-[width] duration-200", evaluationCriteriaValid ? "bg-emerald-500" : evaluationTotal > 100 ? "bg-brand-600" : "bg-ink-700 dark:bg-ink-300")} style={{ width: `${Math.min(100, Math.max(0, evaluationTotal))}%` }} />
                      </div>
                      <p className={cn("mt-2 text-[11px] leading-relaxed", evaluationCriteriaValid ? "text-emerald-800 dark:text-emerald-300" : "text-brand-700 dark:text-brand-300")} role="status">
                        {evaluationCriteriaValid
                          ? "Allocation is exact. These relative weights will be published and carried into the scoring matrix."
                          : evaluationTotal < 100
                            ? `${(100 - evaluationTotal).toFixed(1)} percentage points remain to allocate.`
                            : `${(evaluationTotal - 100).toFixed(1)} percentage points over the 100% limit.`}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-ink-200 bg-[#fffefa] px-3.5 text-[12px] font-semibold text-ink-700 transition-colors hover:border-ink-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:bg-white/[0.035] dark:text-ink-800 dark:hover:border-white/30"
                      disabled={activeEvaluationCriteria.length >= 12 || busy}
                      onClick={() => appendEvaluationCriterion({ title: "", weight: 0, evidence: "", scoringMethod: "" })}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add criterion
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-ink-200 bg-paper/60 p-4 dark:border-white/[0.14] dark:bg-white/[0.02]">
                  <p className="text-[12px] font-semibold text-ink-800 dark:text-ink-800">No scored criteria yet</p>
                  <p className="mt-1 max-w-2xl text-[11.5px] leading-relaxed text-ink-600 dark:text-ink-400">
                    Add criteria that distinguish how well each responsive bid meets the procurement need. You can then set and rebalance their weights; the total must equal 100%.
                  </p>
                  <button
                    type="button"
                    ref={firstEvaluationCriterionButtonRef}
                    className="mt-3 inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3.5 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={busy}
                    onClick={() => {
                      setCriteriaDraft([{ id: "C-01", title: "", weight: 100, evidence: "", scoringMethod: "" }]);
                      requestAnimationFrame(() => evaluationCriterionTitleRefs.current[0]?.focus());
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add first criterion
                  </button>
                </div>
              )}

              {activeEvaluationCriteria.length > 0 ? (
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <Field label="EVALUATION PROCEDURE" hint="Required · published verbatim · max 1,600 characters">
                      <textarea
                        className={cn(inputCls, "h-auto min-h-28 resize-y py-3 text-[13px] leading-relaxed")}
                        value={activeEvaluationProcedure}
                        maxLength={1600}
                        disabled={busy}
                        aria-label="Evaluation procedure disclosed to bidders"
                        placeholder="Describe the evaluation sequence, any pass/fail thresholds, treatment of clarifications and partial evidence, tie-break rule, and how technical and financial scores combine. Keep row-level evidence and scoring anchors in their criteria above."
                        onChange={(event) => setCriteriaProcedureDraft(event.target.value)}
                      />
                    </Field>
                    <span className="pb-1 font-code text-[10px] tabular-nums text-ink-400">{activeEvaluationProcedure.length} / 1,600</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-ink-500 dark:text-ink-400">
                    Each row is published with its evidence basis, scoring method and weight. Keep the procedure for stages, thresholds, ties and score combination below; never apply a factor that bidders could not see.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      { title: "Relevant to the contract", text: "Tie every scored factor to the subject matter and the outcome being bought." },
                      { title: "Objective and reproducible", text: "State evidence, score anchors and how partial or missing evidence is treated." },
                      { title: "Fully disclosed", text: "Publish the criteria, relative weights and application method before bids are submitted." },
                      { title: "Proportionate value", text: "Use non-price or life-cycle cost factors only where they fit the need and market." },
                    ].map((guide) => (
                      <div key={guide.title} className="rounded-lg border border-ink-100 px-3 py-2.5 dark:border-white/[0.07]">
                        <p className="text-[11px] font-semibold text-ink-800 dark:text-ink-800">{guide.title}</p>
                        <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-500 dark:text-ink-400">{guide.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="rounded-xl border border-ink-100 p-3 dark:border-white/[0.08]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="eyebrow">OFFICIAL PROCUREMENT REFERENCES</p>
                    <p className="mt-1 text-[10.5px] text-ink-500 dark:text-ink-400">Guidance is jurisdiction-dependent; apply the governing solicitation and law.</p>
                  </div>
                  <Scale className="h-4 w-4 text-ink-400" aria-hidden="true" />
                </div>
                <ul className="mt-2 grid gap-1.5 text-[11px] sm:grid-cols-2 xl:grid-cols-3">
                  <li>
                    <a className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-ink-700 underline decoration-ink-300 underline-offset-2 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 dark:text-ink-600 dark:decoration-white/25 dark:hover:text-brand-300" href="https://www.zppa.org.zm/documents/20182/21184/The%2BPublic%2BProcurement%2BAct%2BNo.%2B8%2Bof%2B2020.pdf/7ebd55aa-03cd-41c5-a906-f319d162d615?version=1.0" target="_blank" rel="noreferrer">
                      Zambia PPA 2020 · §60 <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </li>
                  <li>
                    <a className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-ink-700 underline decoration-ink-300 underline-offset-2 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 dark:text-ink-600 dark:decoration-white/25 dark:hover:text-brand-300" href="https://www.zppa.org.zm/documents/20182/21181/Public%2BProcurement%2BRegulations%2B2022.pdf/9f9fd0d3-860e-4fbf-bed6-d9378d0c04ab?version=1.0" target="_blank" rel="noreferrer">
                      Zambia Regulations 2022 · reg. 8 <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </li>
                  <li>
                    <a className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-ink-700 underline decoration-ink-300 underline-offset-2 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 dark:text-ink-600 dark:decoration-white/25 dark:hover:text-brand-300" href="https://uncitral.un.org/sites/uncitral.un.org/files/media-documents/uncitral/en/2011-model-law-on-public-procurement-e.pdf" target="_blank" rel="noreferrer">
                      UNCITRAL Model Law · art. 11 <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </li>
                  <li>
                    <a className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-ink-700 underline decoration-ink-300 underline-offset-2 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 dark:text-ink-600 dark:decoration-white/25 dark:hover:text-brand-300" href="https://www.unodc.org/documents/treaties/UNCAC/Publications/TechnicalGuide/09-84395_Ebook.pdf" target="_blank" rel="noreferrer">
                      UNCAC · art. 9 <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </li>
                  <li>
                    <a className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-ink-700 underline decoration-ink-300 underline-offset-2 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 dark:text-ink-600 dark:decoration-white/25 dark:hover:text-brand-300" href="https://www.wto.org/english/docs_e/legal_e/downloads_e/gpa12_en.pdf" target="_blank" rel="noreferrer">
                      WTO GPA 2012 · art. X(7)(iii) (where covered) <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </li>
                  <li>
                    <a className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-ink-700 underline decoration-ink-300 underline-offset-2 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 dark:text-ink-600 dark:decoration-white/25 dark:hover:text-brand-300" href="https://documents1.worldbank.org/curated/en/099325208202512194/pdf/IDU-a052dfd8-ab44-44c1-b854-870b4cccacdb.pdf" target="_blank" rel="noreferrer">
                      World Bank · Rated Criteria Guidance <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </li>
                </ul>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-3 dark:border-white/[0.07]">
                <p className={cn("text-[11px] leading-relaxed", evaluationValid ? "text-emerald-800 dark:text-emerald-300" : "text-brand-700 dark:text-brand-300")} role="status">
                  {evaluationValid
                    ? `${activeEvaluationCriteria.length} criteria · exact 100% total · procedure ready for disclosure.`
                    : evaluationIssue}
                </p>
                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-4 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={busy || !ref || !evaluationValid || !evaluationDirty}
                  onClick={saveEvaluationCriteria}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                  {busy ? "Saving…" : "Save evaluation basis"}
                </button>
              </div>

              {currentNotice ? (
                <p className="text-[10.5px] leading-relaxed text-ink-500 dark:text-ink-400">
                  Saving updates the specification and current notice draft together. The issued notice is immutable here; changes after issue must be communicated to all bidders by addendum.
                </p>
              ) : (
                <p className="text-[10.5px] leading-relaxed text-ink-500 dark:text-ink-400">
                  Saving adds this basis to the latest specification. When you draft the notice, its criteria and procedure are carried forward for publication.
                </p>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card
        title="Clarifications & addenda"
        sub="EVERY ANSWER GOES TO EVERY BIDDER — AN ADDENDUM INSIDE 7 DAYS MUST MOVE THE CLOSING"
        right={cycle?.addenda.some((a) => a.closingExtensionRequired) ? <Chip tone="warn">CLOSING EXTENSION OWED</Chip> : undefined}
      >
        <div className="flex flex-wrap items-end gap-1.5">
          <Field label="BIDDER'S QUESTION">
            <input className={inputCls} placeholder="What a bidder asked, in their words" value={d.clarQuestion ?? ""} onChange={(e) => set("clarQuestion", e.target.value)} />
          </Field>
          <Field label="ASKED BY">
            <input className={cn(inputCls, "w-40")} placeholder="Bidder name" value={d.clarBy ?? ""} onChange={(e) => set("clarBy", e.target.value)} />
          </Field>
          <Btn variant="ghost" onClick={() => void logClarification()} disabled={busy || !ref || !(d.clarQuestion ?? "").trim()}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Log
          </Btn>
        </div>
        <ul className="mt-3 space-y-1.5">
          {cycle?.clarifications.slice(0, 6).map((c) => (
            <li key={c.id} className="rounded-lg border border-ink-100 bg-paper px-2.5 py-2 text-[12px] dark:border-white/[0.07]">
              <span className="font-semibold text-ink-800">{c.askedBy}:</span> <span className="text-ink-600">{c.question}</span>
              {c.answer ? (
                <span className="mt-1 block text-emerald-800 dark:text-emerald-300">A: {c.answer}</span>
              ) : (
                <div className="mt-1 flex gap-1.5">
                  <input className={inputCls} aria-label={`Buyer response to clarification from ${c.askedBy}`} placeholder="Answer on behalf of the buyer — sent to every bidder" value={d[`ans-${c.id}`] ?? ""} onChange={(e) => set(`ans-${c.id}`, e.target.value)} />
                  <Btn
                    variant="ghost"
                    onClick={() => act(`/api/tenders/${ref}/clarifications/${c.id}/answer`, { answer: d[`ans-${c.id}`] }, "ANSWER RECORDED — EVERY BIDDER IS TREATED THE SAME").then((ok) => ok && refreshCycle())}
                    disabled={busy || !d[`ans-${c.id}`]}
                  >
                    Post
                  </Btn>
                </div>
              )}
            </li>
          ))}
          {!cycle?.clarifications.length ? <li className="py-2 text-[11.5px] text-ink-400">No clarifications logged on this tender yet.</li> : null}
        </ul>
        <div className="mt-3 flex flex-wrap items-end gap-1.5 border-t border-ink-100 pt-3 dark:border-white/[0.06]">
          <Field label="ADDENDUM SUMMARY">
            <input className={inputCls} placeholder="What changes for every bidder" value={d.addSummary ?? ""} onChange={(e) => set("addSummary", e.target.value)} />
          </Field>
          <Field label="EXTEND CLOSING TO" hint="inside 7 days it is required">
            <input className={cn(inputCls, "w-40")} type="date" value={d.addExt ?? ""} onChange={(e) => set("addExt", e.target.value)} />
          </Field>
          <Btn
            variant="ghost"
            onClick={() => act(`/api/tenders/${ref}/addenda`, { summary: d.addSummary, extendsClosingTo: d.addExt || undefined }, "ADDENDUM ISSUED").then((ok) => ok && refreshCycle())}
            disabled={busy || !ref || !(d.addSummary ?? "").trim()}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Issue
          </Btn>
        </div>
        {cycle?.addenda.length ? (
          <ul className="mt-2 space-y-1">
            {cycle.addenda.map((a) => (
              <li key={a.id} className="text-[11.5px] text-ink-500">
                Addendum {a.number}: {a.summary} {a.extendsClosingTo ? ` · closing moved to ${fmtDate(a.extendsClosingTo)}` : ""}{" "}
                {a.closingExtensionRequired ? <Chip tone="warn">CLOSING EXTENSION REQUIRED</Chip> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );

  /* ── Tab: deadlines (G16) ────────────────────────────────────────────────── */

  const sorted = [...deadlines].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const overdueList = sorted.filter((x) => x.overdue);
  const weekList = sorted.filter((x) => !x.overdue && (daysUntil(x.dueAt) ?? 99) <= 7);
  const laterList = sorted.filter((x) => !x.overdue && (daysUntil(x.dueAt) ?? 99) > 7);

  const DeadlinesTab = (
    <div className="grid gap-4">
      <StageBrief {...DESK_TOOL_BRIEFS.deadlines} />
      <Card
      title="Upcoming deadlines"
      sub="CLOSINGS · ALB RESPONSES · STANDSTILLS · MILESTONES · COMPLAINTS — DERIVED, NEVER STORED TWICE"
      right={
        deadlines.length ? (
          <span className="text-[10px] font-semibold text-ink-600">
            {deadlines.length} live{overdueList.length ? <span className="text-brand-700 dark:text-brand-300"> · {overdueList.length} overdue</span> : null}
          </span>
        ) : null
      }
    >
      <dl className="mb-4 grid grid-cols-3 gap-px overflow-hidden rounded-[10px] border border-ink-100 bg-ink-100/70 dark:border-white/[0.07] dark:bg-white/[0.07]">
        {[
          { label: "OVERDUE", n: overdueList.length },
          { label: "NEXT 7 DAYS", n: weekList.length },
          { label: "LATER", n: laterList.length },
        ].map((bucket) => (
          <div key={bucket.label} className="bg-[#fffefa] px-3.5 py-3 dark:bg-[#12141a]">
            <dt className="eyebrow text-[10px] tracking-[0.08em]">{bucket.label}</dt>
            <dd
              className={cn(
                "mt-1.5 font-display text-[19px] font-bold leading-none tabular tracking-[-0.02em]",
                bucket.label === "OVERDUE" && bucket.n > 0 ? "text-brand-600 dark:text-brand-400" : "text-ink-900 dark:text-white",
              )}
            >
              {bucket.n}
            </dd>
          </div>
        ))}
      </dl>
      {deadlines.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-200 px-4 py-8 text-center">
          <CalendarClock className="mx-auto h-5 w-5 text-ink-400" aria-hidden="true" />
          <p className="mt-2 text-[12.5px] text-ink-500">No live deadlines on the desk.</p>
          <p className="mt-1 text-[11px] text-ink-400">Closings, standstill ends and milestones surface here the moment the cycle creates them.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {[
            { label: "OVERDUE", list: overdueList, tone: "brand" as const },
            { label: "NEXT 7 DAYS", list: weekList, tone: null },
            { label: "COMING UP", list: laterList, tone: null },
          ]
            .filter((b) => b.list.length)
            .map((bucket) => (
              <section key={bucket.label}>
                <p className={cn("mb-1.5 font-code text-[10px] font-bold tracking-[0.08em]", bucket.tone === "brand" ? "text-brand-700 dark:text-brand-300" : "text-ink-600")}>
                  {bucket.label} — {bucket.list.length}
                </p>
                <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100 bg-paper">
                  {bucket.list.map((x, i) => (
                    <li key={`${x.tenderId}-${x.kind}-${i}`} className="flex items-center gap-3 px-3 py-2.5">
                      <span className={cn("h-8 w-1 shrink-0 rounded-full", x.overdue ? "bg-brand-500" : "bg-ink-200")} aria-hidden="true" />
                      <span className={cn("shrink-0", x.overdue ? "text-brand-600 dark:text-brand-300" : "text-ink-400")}>
                        <DeadlineIcon kind={x.kind} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-semibold text-ink-900">{tenderReferenceLabel(tenders.find((tender) => tender.ref === x.tenderId))}</p>
                        <p className="truncate text-[10.5px] text-ink-500">{tenders.find((tender) => tender.ref === x.tenderId)?.title ?? "Tender record"}</p>
                        <p className="truncate text-[10px] leading-relaxed text-ink-600">
                          {x.kind.replace(/_/g, " ")}{x.ref ? ` — ${x.ref}` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={cn("font-code text-[10px] font-bold tracking-[0.06em]", x.overdue ? "text-brand-700 dark:text-brand-300" : "text-ink-700")}>
                          {relDays(x.dueAt).toUpperCase()}
                        </p>
                        <p className="text-[10px] font-medium text-ink-600">{fmtDateTime(x.dueAt)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
      </Card>

      <Card title="What the clock is reading" sub="EACH DEADLINE NAMES THE RECORD IT COMES FROM — NONE IS TYPED IN A SECOND TIME">
        <ul className="grid gap-2 sm:grid-cols-2">
          {[
            { k: "CLOSING", v: "The closing date on the cycle record; the notice's date is used only while that entry is empty." },
            { k: "ALB RESPONSE", v: "Five working days from the query. An open dossier blocks the bid from being recommended." },
            { k: "STANDSTILL", v: "Counted in working days from publication — the clock starts when the market can see the notice." },
            { k: "MILESTONE", v: "The due date the contract was signed against, so slipping shows before a payment is certified." },
            { k: "COMPLAINT", v: "The window inside which the desk acknowledges and answers; an open complaint holds the contract." },
            { k: "OVERDUE", v: "Never dismissed by time alone — the item stays here until its record moves through its own gate." },
          ].map((row) => (
            <li key={row.k} className="rounded-xl border border-ink-100 bg-paper px-3 py-2.5 dark:border-white/[0.08]">
              <p className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-600">{row.k}</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-700 dark:text-ink-300">{row.v}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );

  /* ── Tab: opening (G3/G8) ────────────────────────────────────────────────── */
  const setClosing = () =>
    act(`/api/tenders/${ref}/closing`, { closingDate: d.closing, actor: "officer" }, "CLOSING DATE ON RECORD").then((ok) => ok && refreshCycle());

  const recordOpening = () =>
    act(
      `/api/tenders/${ref}/opening`,
      {
        bids: openRows
          .filter((r) => r.bidder.trim() && r.receivedAt)
          .map((r) => ({ bidder: r.bidder, receivedAt: new Date(r.receivedAt).toISOString(), priceRead: r.priceRead || undefined })),
      },
      "OPENING REGISTER RECORDED — CERTIFICATION GATE RAISED",
    ).then((ok) => ok && refreshCycle());

  const OpeningTab = (
    <div className="grid gap-4 lg:grid-cols-2">
      <StageBrief span {...STAGE_BRIEFS.opening} />
      <Card
        title="Closing date on record"
        sub="THE OFFICER'S ENTRY WINS; THE NOTICE'S DATE IS THE FALLBACK"
        workflow
        busy={busy}
        actionLabel="Set closing date"
        teaser={
          cycle?.closingDate
            ? `Closing ${fmtDate(cycle.closingDate)} · ${relDays(cycle.closingDate).toUpperCase()} · every bid is judged against this moment, so the officer's entry is the record, not the notice.`
            : "No closing date on record — the notice's date is only a fallback, and nothing can be opened against a moment the desk does not hold."
        }
      >
        <div className="flex items-end gap-2">
          <Field label="CLOSING DATE">
            <input className={inputCls} type="date" value={d.closing ?? ""} onChange={(e) => set("closing", e.target.value)} />
          </Field>
          <Btn onClick={setClosing} disabled={busy || !ref || !d.closing}>
            <Check className="h-3.5 w-3.5" aria-hidden="true" /> Set
          </Btn>
        </div>
        <p className="mt-2 font-code text-[10px] tracking-[0.12em] text-ink-500">
          ON RECORD: {cycle?.closingDate ? fmtDateTime(cycle.closingDate) : "NOT SET"}
        </p>
      </Card>

      <Card
        title="Record the public bid opening"
        sub="LATE BIDS ARE REJECTED UNOPENED — THE REGISTER GOES TO THE PROCUREMENT UNIT'S GATE"
        workflow
        busy={busy}
        actionLabel="Record bid opening"
        teaser={
          cycle?.opening
            ? `${count(cycle.opening.rows.length, "bid")} received · ${count(cycle.opening.rows.filter((r) => r.late).length, "late bid")} rejected unopened · ${cycle.opening.certifiedAt ? `register certified ${fmtDateTime(cycle.opening.certifiedAt)}` : "the register is not certified yet"}`
            : "The register is empty — each bid is entered with its exact time of receipt, and anything after the closing moment is rejected unopened."
        }
      >
        {cycle?.opening?.certifiedAt ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="ok">REGISTER CERTIFIED{cycle.opening.certifiedBy ? ` · ${cycle.opening.certifiedBy}` : ""}</Chip>
              {cycle.opening.certifiedAt ? <span className="text-[10.5px] leading-relaxed text-ink-600">Certified {fmtDateTime(cycle.opening.certifiedAt)}</span> : null}
              {cycle.opening.gateId ? <span className="text-[10.5px] leading-relaxed text-ink-600">Gate {cycle.opening.gateId}</span> : null}
            </div>
            <HorizontalScrollRegion label="Certified bid opening register" className="rounded-lg border border-ink-100">
              <table className="w-full min-w-[480px] text-[12px]">
                <thead>
                  <tr className="border-b border-ink-100 bg-ink-50/70 text-left font-code text-[10px] font-bold tracking-[0.06em] text-ink-600">
                    <th scope="col" className="px-2.5 py-2">BIDDER</th>
                    <th scope="col" className="px-2.5 py-2">RECEIVED</th>
                    <th scope="col" className="px-2.5 py-2">PRICE READ</th>
                    <th scope="col" className="px-2.5 py-2 text-right">DISPOSITION</th>
                  </tr>
                </thead>
                <tbody>
                  {cycle.opening.rows.length ? cycle.opening.rows.map((r) => (
                    <tr key={r.id ?? r.bidder} className="border-b border-ink-100 last:border-0">
                      <td className="px-2.5 py-1.5 font-semibold text-ink-900">{r.bidder}</td>
                      <td className="px-2.5 py-1.5 text-ink-500">{fmtDateTime(r.receivedAt)}</td>
                      <td className="px-2.5 py-1.5 tabular text-ink-700">{r.priceRead || "—"}</td>
                      <td className="px-2.5 py-1.5 text-right">
                        {r.late ? <span className="font-bold text-brand-700 dark:text-brand-300">LATE</span> : <span className="text-emerald-700 dark:text-emerald-300">admitted</span>}
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={4} className="px-2.5 py-4 text-center text-[11.5px] leading-relaxed text-ink-600">No bid rows are included in this opening record.</td></tr>
                  )}
                </tbody>
              </table>
            </HorizontalScrollRegion>
            {cycle.opening.reconciliation ? (
              <div
                className={cn(
                  "rounded-lg border px-3 py-2 text-[11px] leading-relaxed",
                  cycle.opening.reconciliation.matches
                    ? "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-800 dark:text-emerald-300"
                    : "border-amber-500/30 bg-amber-500/[0.08] text-amber-900 dark:text-amber-200",
                )}
              >
                {cycle.opening.reconciliation.matches ? "RECONCILED" : "RECONCILIATION FAILED"} — {cycle.opening.reconciliation.note}
                <span className="mt-1 block text-[10.5px] leading-relaxed text-ink-600">
                  {cycle.opening.reconciliation.sealed} SEALED · {cycle.opening.reconciliation.manual} MANUAL ·{" "}
                  {cycle.opening.reconciliation.withdrawn} WITHDRAWN · {cycle.opening.reconciliation.amended} AMENDED
                </span>
              </div>
            ) : null}
            {cycle.opening.reconciliation &&
            ((cycle.opening.reconciliation.missingFromRegister?.length ?? 0) > 0 || (cycle.opening.reconciliation.extraInRegister?.length ?? 0) > 0) ? (
              <div className="grid gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3 sm:grid-cols-2">
                {(cycle.opening.reconciliation.missingFromRegister?.length ?? 0) > 0 ? (
                  <div>
                    <p className="font-code text-[10px] font-bold tracking-[0.06em] text-amber-900 dark:text-amber-300">Missing from register</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-700 dark:text-ink-200">{cycle.opening.reconciliation.missingFromRegister?.join(" · ")}</p>
                  </div>
                ) : null}
                {(cycle.opening.reconciliation.extraInRegister?.length ?? 0) > 0 ? (
                  <div>
                    <p className="font-code text-[10px] font-bold tracking-[0.06em] text-amber-900 dark:text-amber-300">Register entries without a portal receipt</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-700 dark:text-ink-200">{cycle.opening.reconciliation.extraInRegister?.join(" · ")}</p>
                  </div>
                ) : null}
              </div>
            ) : null}
            {cycle.opening.minutesMd ? (
              <details className="rounded-lg border border-ink-100 bg-paper px-3 py-2">
                <summary className="focus-brand inline-flex min-h-11 cursor-pointer items-center rounded-md px-1 font-code text-[10px] font-bold tracking-[0.06em] text-ink-600">Read the opening minutes</summary>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-ink-700">{cycle.opening.minutesMd}</pre>
              </details>
            ) : null}
            {cycle.opening.sha ? <p className="text-[10px] leading-relaxed text-ink-500">SHA-256 {cycle.opening.sha}</p> : null}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[11px] leading-relaxed text-ink-500">Enter each bid as it was received. The submitted register is reconciled with portal receipts and routed for certification.</p>
            <HorizontalScrollRegion label="Bid opening entry rows">
              <div className="min-w-[560px] space-y-2">
                <div className="grid grid-cols-[1.4fr_1.2fr_1fr] gap-2 px-1 font-code text-[10px] font-bold tracking-[0.06em] text-ink-600">
                  <span>BIDDER</span><span>RECEIVED AT</span><span>PRICE READ</span>
                </div>
                {openRows.map((row, i) => (
                  <div key={i} className="grid grid-cols-[1.4fr_1.2fr_1fr] gap-2">
                    <input
                      className={inputCls}
                      aria-label={`Bidder, row ${i + 1}`}
                      placeholder="Bidder"
                      value={row.bidder}
                      onChange={(e) => setOpenRows((p) => p.map((r, j) => (j === i ? { ...r, bidder: e.target.value } : r)))}
                    />
                    <input
                      className={inputCls}
                      type="datetime-local"
                      aria-label={`Receipt date and time, row ${i + 1}`}
                      value={row.receivedAt}
                      onChange={(e) => setOpenRows((p) => p.map((r, j) => (j === i ? { ...r, receivedAt: e.target.value } : r)))}
                    />
                    <input
                      className={inputCls}
                      aria-label={`Price read at opening, row ${i + 1}`}
                      placeholder="Price read"
                      value={row.priceRead}
                      onChange={(e) => setOpenRows((p) => p.map((r, j) => (j === i ? { ...r, priceRead: e.target.value } : r)))}
                    />
                  </div>
                ))}
              </div>
            </HorizontalScrollRegion>
            <div className="flex items-center gap-2">
              <Btn variant="ghost" onClick={() => setOpenRows((p) => [...p, { bidder: "", receivedAt: "", priceRead: "" }])}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add bid row
              </Btn>
              <Btn onClick={recordOpening} disabled={busy || !ref || !openRows.some((row) => row.bidder.trim() && row.receivedAt)}>
                <Stamp className="h-3.5 w-3.5" aria-hidden="true" /> Record opening
              </Btn>
            </div>
            {cycle?.opening && !cycle.opening.certifiedAt ? (
              <p className="text-[11.5px] leading-relaxed text-brand-800 dark:text-brand-300">
                Register {cycle.opening.id} is awaiting certification{cycle.opening.gateId ? ` · Gate ${cycle.opening.gateId}` : ""}
              </p>
            ) : null}
          </div>
        )}
      </Card>

      <Card
        title="Applications from the supplier portal"
        sub="FILED ELECTRONICALLY AT /ORG — ATTESTED org:<name> · LATE AND DUPLICATE BIDS ALREADY REFUSED AT FILING"
        /* The odd last card in a two-column stage — full width keeps the row even. */
        className="lg:col-span-2"
      >
        {(() => {
          const apps = portalApps.filter((a) => a.tenderId === ref);
          if (apps.length === 0) {
            return (
              <p className="text-[11.5px] leading-relaxed text-ink-600">
                No electronic applications are on record for this tender. Suppliers can file through the <a href="/org" className="font-semibold text-ink-800 underline decoration-ink-400 underline-offset-2 hover:text-brand-700">/org portal</a>.
              </p>
            );
          }
          return (
            <div className="space-y-2">
              <Chip tone="ok">{apps.length} ELECTRONIC {apps.length === 1 ? "APPLICATION" : "APPLICATIONS"} ON RECORD</Chip>
              <HorizontalScrollRegion label="Supplier applications register" className="rounded-lg border border-ink-100">
                <table className="w-full min-w-[620px] text-[12px]">
                  <thead>
                    <tr className="border-b border-ink-100 bg-ink-50/70 text-left font-code text-[10px] font-bold tracking-[0.06em] text-ink-600">
                      <th scope="col" className="px-2.5 py-2">ORGANIZATION</th>
                      <th scope="col" className="px-2.5 py-2">OFFER</th>
                      <th scope="col" className="px-2.5 py-2">RECEIVED</th>
                      <th scope="col" className="px-2.5 py-2">RECEIPT</th>
                      <th scope="col" className="px-2.5 py-2">STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apps.map((a) => (
                      <tr key={a.id} className="border-b border-ink-100 last:border-0">
                        <td className="px-2.5 py-1.5 font-semibold text-ink-900">{a.orgName}</td>
                        <td className="px-2.5 py-1.5 text-ink-500">
                          {a.sealed ? (
                            <span className="font-code text-[10px] font-bold tracking-[0.06em] text-brand-800 dark:text-brand-300">SEALED</span>
                          ) : (
                            <>
                              {a.currency ? `${a.currency} ` : ""}
                              {typeof a.amount === "number" && Number.isFinite(a.amount) ? fmtMoney(a.amount) : "—"}
                            </>
                          )}
                        </td>
                        <td className="px-2.5 py-1.5 text-ink-500">{fmtDateTime(a.receivedAt)}</td>
                        <td className="px-2.5 py-1.5 font-code text-[10px] tracking-normal text-ink-600">{a.receiptId ?? a.id}</td>
                        <td className="px-2.5 py-1.5 font-code text-[10px] font-bold tracking-[0.04em] text-ink-700">{a.status.replace(/_/g, " ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </HorizontalScrollRegion>
              <p className="text-[11px] leading-relaxed text-ink-600">
                The opening register remains the officer’s act. These portal rows are context, not entries.
              </p>
            </div>
          );
        })()}
      </Card>
    </div>
  );

  /* ── Tab: evaluation (G1/G2/G4 + G9) ─────────────────────────────────────── */

  const declareCoi = (
    member: string,
    declaration: "NO_CONFLICT" | "CONFLICT_DECLARED",
    extra?: { entities?: { name: string; relationship?: string }[]; recused?: boolean; conflicts?: string },
  ) =>
    act(
      `/api/tenders/${ref}/coi`,
      {
        member,
        declaration,
        conflicts: declaration === "CONFLICT_DECLARED" ? (extra?.conflicts ?? d[`coi-${member}`]) : undefined,
        ...(extra?.entities?.length ? { entities: extra.entities } : {}),
        ...(extra?.recused ? { recused: true } : {}),
      },
      "CONFLICT DECLARATION RECORDED",
    ).then((ok) => ok && refreshCycle());

  /* Structured connections: one per line, "name | relationship". The server
     screens these names against every bidder and beneficial owner. */
  const saveCoiConnections = (member: string, decl: NonNullable<CycleDto["coi"]>[number]) => {
    const entities = (d[`coi-ent-${member}`] ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, relationship] = line.split("|").map((part) => part.trim());
        return { name, ...(relationship ? { relationship } : {}) };
      })
      .filter((entity) => entity.name);
    if (!entities.length) {
      onToast("NAME AT LEAST ONE CONNECTION — ONE PER LINE, NAME | RELATIONSHIP");
      return;
    }
    void declareCoi(member, decl.declaration === "CONFLICT_DECLARED" ? "CONFLICT_DECLARED" : "NO_CONFLICT", {
      entities,
      conflicts: decl.conflicts,
      recused: decl.recused,
    });
  };

  const presentMembers = members.filter((m) => m.status === "PRESENT");
  const assignedEvaluators = presentMembers.filter((m) => m.office === "EVALUATION_COMMITTEE");
  const sheetEvaluator = d.sheetEvaluator || assignedEvaluators[0]?.name || "";
  const publishedEvaluationNotice = [...(cycle?.notices ?? [])].reverse().find((notice) => !!notice.issuedAt);
  const publishedEvaluationCriteria = publishedEvaluationNotice?.evaluationCriteria ?? [];
  const splitMatch = publishedEvaluationNotice?.md.match(/^\*\*Technical\/financial split:\*\*\s*(\d+)\/(\d+)\s*$/m);
  const publishedTechWeight = splitMatch ? Number(splitMatch[1]) : NaN;
  const publishedFormulaReady = !!publishedEvaluationNotice?.md.match(/^\*\*Financial formula:\*\*\s*\S.+$/m) &&
    !!publishedEvaluationNotice?.md.match(/^\*\*FX basis:\*\*\s*\S.+$/m) &&
    !!publishedEvaluationNotice?.md.match(/^\*\*Preference\/reservation scheme:\*\*\s*\S.+$/m) &&
    !!publishedEvaluationNotice?.md.match(/^\*\*Foreign bidders permitted:\*\*\s*(?:Yes|No)$/m) &&
    Number.isInteger(publishedTechWeight) && publishedTechWeight >= 0 && publishedTechWeight <= 100 &&
    publishedTechWeight + Number(splitMatch?.[2]) === 100;
  const publishedCriteriaWeight = publishedEvaluationCriteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const publishedCriteriaReady =
    publishedFormulaReady &&
    publishedEvaluationCriteria.length > 0 &&
    Math.abs(publishedCriteriaWeight - 100) <= 0.0001 &&
    publishedEvaluationCriteria.every((criterion) => criterion.title.trim() && Number.isFinite(criterion.weight) && criterion.weight > 0);
  const scoreBasisReady = (() => {
    const matrix = cycle?.matrix;
    if (matrix?.scoringBasisBlockReason !== undefined) return matrix.scoringBasisBlockReason === null;
    const evaluationCurrency = matrix?.evaluationCurrency?.toUpperCase();
    if (!matrix || !evaluationCurrency || !matrix.med) return false;
    const foreignCurrencies = [...new Set(matrix.bids
      .map((bid) => bid.financial?.currency?.toUpperCase())
      .filter((currency): currency is string => !!currency && currency !== evaluationCurrency))];
    return foreignCurrencies.every((currency) => (matrix.fxRates ?? []).some(
      (rate) => rate.base.toUpperCase() === currency && rate.quote.toUpperCase() === evaluationCurrency && rate.rate > 0 && !!rate.source.trim(),
    ));
  })();
  const scoringStarted = !!cycle?.matrix && (
    !!cycle.matrix.scoringStartedAt ||
    (cycle.matrix.sheets?.length ?? 0) > 0 ||
    cycle.matrix.bids.some((bid) => bid.technicalScores.some((score) =>
      score.score !== 0 && cycle.matrix?.med?.adjustments?.[`${bid.bidder}|${score.criterionId}`] === undefined,
    ))
  );

  const submitSheet = () => {
    if (!cycle?.matrix) return;
    if (!sheetEvaluator) {
      onToast("NO EVALUATOR HOLDS THE EVALUATION-COMMITTEE OFFICE — SET THE OFFICE ON THE COMMITTEE REGISTER FIRST");
      return;
    }
    const cells: { bidder: string; criterionId: string; score: number }[] = [];
    for (const bid of cycle.matrix.bids) {
      for (const criterion of cycle.matrix.criteria) {
        const raw = d[`sh-${sheetEvaluator}-${bid.bidder}-${criterion.id}`];
        if (raw === undefined || raw === "") {
          onToast(`ENTER A SCORE FOR ${bid.bidder.toUpperCase()} / ${criterion.id} — A BLANK IS NOT A ZERO`);
          return;
        }
        cells.push({ bidder: bid.bidder, criterionId: criterion.id, score: Number(raw) });
      }
    }
    void act(
      `/api/tenders/${ref}/matrix/sheets`,
      { evaluator: sheetEvaluator, scores: cells },
      `SHEET SUBMITTED — ${sheetEvaluator.toUpperCase()}`,
    ).then((ok) => ok && refreshCycle());
  };

  const recordConsensus = () => {
    const attendees = (
      d.consensusAttendees ?? assignedEvaluators.map((m) => m.name).join(", ")
    )
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    void act(
      `/api/tenders/${ref}/matrix/consensus`,
      { attendees, notes: d.consensusNotes ?? "" },
      "CONSENSUS RECORDED — THE MATRIX TECHNICAL COLUMN NOW FOLLOWS IT",
    ).then((ok) => ok && refreshCycle());
  };

  const saveFx = () => {
    const rates: { base: string; rate: number; source: string; asOf: string }[] = [];
    const text =
      d.fxRates ??
      (cycle?.matrix?.fxRates ?? [])
        .map((rate) => `${rate.base} = ${rate.rate} | ${rate.source} | ${rate.asOf.slice(0, 10)}`)
        .join("\n");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^([A-Za-z]{3})\s*=\s*([\d.]+)\s*\|\s*(.+?)\s*\|\s*(\d{4}-\d{2}-\d{2})$/);
      if (!match) {
        onToast("FX LINES READ: BASE = RATE | SOURCE | YYYY-MM-DD — ONE PER FOREIGN CURRENCY");
        return;
      }
      rates.push({ base: match[1].toUpperCase(), rate: Number(match[2]), source: match[3].trim(), asOf: match[4] });
    }
    void act(
      `/api/tenders/${ref}/matrix/fx`,
      { evaluationCurrency: (d.evalCurrency ?? cycle?.matrix?.evaluationCurrency ?? "ZMW").toUpperCase(), rates },
      "EVALUATED-PRICE BASIS SAVED",
    ).then((ok) => ok && refreshCycle());
  };

  const buildMatrix = () => {
    if (!publishedCriteriaReady) {
      onToast("PUBLISH EVALUATION CRITERIA THAT SUM TO EXACTLY 100 BEFORE BUILDING THE MATRIX");
      return;
    }
    void act(
      `/api/tenders/${ref}/matrix`,
      {
        criteria: publishedEvaluationCriteria.map(({ title, weight }) => ({ title, weight })),
        technicalWeightPct: publishedTechWeight,
      },
      "EVALUATION MATRIX BUILT — SCORES DRAFT",
    ).then((ok) => ok && refreshCycle());
  };

  const certifyFinancialAdjustments = () => {
    const matrix = cycle?.matrix;
    if (!matrix) return;
    const rows = matrix.bids.map((bid) => {
      const key = encodeURIComponent(bid.bidder);
      return {
        bidder: bid.bidder,
        arithmeticCorrection: Number(d[`fin-${key}-correction`] || 0),
        unconditionalDiscount: Number(d[`fin-${key}-discount`] || 0),
        otherAdjustment: Number(d[`fin-${key}-other`] || 0),
        preferenceScheme: d[`fin-${key}-preference`] || "",
        localContentPct: d[`fin-${key}-local-content`] ? Number(d[`fin-${key}-local-content`]) : undefined,
        ...(d[`fin-${key}-reservation-domiciled`] && d[`fin-${key}-reservation-citizen`] ? {
          reservationEligible: d[`fin-${key}-reservation-domiciled`] === "yes",
          reservationCitizenSupplier: d[`fin-${key}-reservation-citizen`] === "yes",
        } : {}),
        evidenceRef: d[`fin-${key}-evidence`] || "",
      };
    });
    void act(`/api/tenders/${ref}/matrix/financial-adjustments`, { rows }, "FINANCIAL ADJUSTMENTS STAGED — PROCUREMENT UNIT CERTIFICATION GATE RAISED").then((ok) => ok && refreshCycle());
  };

  const saveScores = (bidder: string) =>
    act(
      `/api/tenders/${ref}/matrix/scores`,
      {
        bidder,
        scores: (cycle?.matrix?.criteria ?? []).map((c) => ({ criterionId: c.id, score: Number(d[`s-${bidder}-${c.id}`] ?? "0") })),
      },
      `SCORES SAVED — ${bidder.toUpperCase()}`,
    ).then((ok) => ok && refreshCycle());

  const recordMed = () => {
    const adjustments: Record<string, number> = {};
    for (const line of (d.medAdj ?? "").split("\n").map((value) => value.trim()).filter(Boolean)) {
      const m = line.match(/^(.+?)\s*\|\s*(C-\d+)\s*=\s*([\d.]+)$/);
      if (!m) {
        onToast("MED LINES READ: BIDDER | C-01 = SCORE — REMOVE OR CORRECT THE INVALID LINE");
        return;
      }
      const score = Number(m[3]);
      if (!Number.isFinite(score) || score < 0 || score > 100) {
        onToast("MED SCORE ADJUSTMENTS MUST BE BETWEEN 0 AND 100");
        return;
      }
      adjustments[`${m[1].trim()}|${m[2]}`] = score;
    }
    return act(
      `/api/tenders/${ref}/matrix/med`,
      { attendees: (d.medAttendees ?? "").split(",").map((s) => s.trim()).filter(Boolean), adjustments, notes: d.medNotes },
      "MED SESSION RECORDED",
    ).then((ok) => ok && refreshCycle());
  };

  const certifyMatrix = () =>
    act(`/api/tenders/${ref}/matrix/certify`, {}, "CERTIFICATION GATE RAISED — EVALUATION COMMITTEE SIGNS").then((ok) => ok && refreshCycle());

  const openAlbDossier = () => {
    const bidder = d.albBidder ?? "";
    const basis = (d.albBasis ?? "").trim();
    if (!bidder || basis.length < 12) {
      onToast("SELECT A BIDDER AND RECORD THE PRICING EVIDENCE FOR THE FIVE-DAY CLARIFICATION");
      return;
    }
    const finding = cycle?.findings?.find((item) =>
      (item.rule === "R-PRICE-OUTLIER" || item.rule === "R-VALUE-OUTLIER") &&
      item.item.toLowerCase().includes(bidder.toLowerCase()),
    );
    void act(
      `/api/tenders/${ref}/alb`,
      { bidder, basis, ...(finding ? { findingId: finding.id } : {}) },
      "FIVE-WORKING-DAY ALB DOSSIER OPENED — BIDDER JUSTIFICATION REQUESTED",
    ).then((ok) => ok && refreshCycle());
  };

  /* Same rule the sidecar enforces on signing: every PRESENT member must have a COI record. */
  const outstandingCoi = cycle
    ? presentMembers.filter((m) => !cycle.coi.some((x) => x.member.toLowerCase() === m.name.toLowerCase()))
    : [];
  const openAlbDossiers = cycle?.alb.filter((dossier) => !dossier.resolution) ?? [];
  const sheets = cycle?.matrix?.sheets ?? [];
  const divergences = cycle?.matrix ? sheetDivergences(cycle.matrix.sheets ?? []) : [];

  /* A minority position is evidence, not an approval: it needs no gate, but
     the record carries it beside the recommendation it disagrees with. */
  const dissentCard = (stage: "EVALUATION_CERTIFICATION" | "AWARD_REPORT", title: string, sub: string) => {
    const rows = (cycle?.dissents ?? []).filter((x) => x.stage === stage);
    const memberKey = `dis-${stage}-member`;
    const positionKey = `dis-${stage}-position`;
    const basisKey = `dis-${stage}-basis`;
    return (
      <Card
        title={title}
        sub={sub}
        right={rows.length ? <Chip tone="warn">{rows.length} ON FILE</Chip> : <Chip tone="muted">NONE RECORDED</Chip>}
      >
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label="MEMBER HOLDING THE POSITION">
            <input
              className={inputCls}
              list={`dis-members-${stage}`}
              placeholder="Name — a present committee member"
              value={d[memberKey] ?? ""}
              onChange={(e) => set(memberKey, e.target.value)}
            />
            <datalist id={`dis-members-${stage}`}>
              {presentMembers.map((m) => (
                <option key={m.name} value={m.name} />
              ))}
            </datalist>
          </Field>
          <Field label="POSITION">
            <select className={inputCls} value={d[positionKey] ?? "DISSENT"} onChange={(e) => set(positionKey, e.target.value)}>
              <option value="DISSENT">Dissent — disagrees with the recommendation</option>
              <option value="ABSTAIN">Abstain — declines to decide</option>
              <option value="CONCUR_WITH_NOTES">Concurs with notes — agrees, with reservations on the record</option>
            </select>
          </Field>
        </div>
        <div className="mt-2.5">
          <Field label="BASIS — THE REASONS, IN WORDS THE AUDITOR CAN TEST">
            <textarea
              className={cn(inputCls, "h-20 py-2 text-[12px] leading-relaxed")}
              placeholder="Which criterion, which evidence, what the committee should have done instead."
              value={d[basisKey] ?? ""}
              onChange={(e) => set(basisKey, e.target.value)}
            />
          </Field>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Btn
            variant="ghost"
            onClick={() =>
              act(
                `/api/tenders/${ref}/dissents`,
                {
                  member: d[memberKey],
                  position: d[positionKey] || "DISSENT",
                  stage,
                  basis: d[basisKey],
                },
                "POSITION RECORDED — THE FILE CARRIES IT BESIDE THE RECOMMENDATION",
              ).then((ok) => {
                if (ok) {
                  set(memberKey, "");
                  set(basisKey, "");
                }
                return ok;
              })
            }
            disabled={busy || !ref || !(d[memberKey] ?? "").trim() || (d[basisKey] ?? "").trim().length < 10}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Record the position
          </Btn>
          <span className="text-[11px] leading-relaxed text-ink-600">
            {(d[basisKey] ?? "").trim().length < 10 ? "A BASIS OF AT LEAST 10 CHARACTERS IS REQUIRED" : "READY"}
          </span>
        </div>
        {rows.length ? (
          <ul className="mt-3 space-y-1.5 border-t border-ink-100 pt-2.5 dark:border-white/[0.06]">
            {rows.map((x) => (
              <li key={x.id} className="rounded-lg border border-ink-100 bg-paper px-2.5 py-2 text-[11.5px] dark:border-white/[0.07]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink-900">{x.member}</span>
                  <Chip tone={x.position === "DISSENT" ? "warn" : "muted"}>{x.position.replace(/_/g, " ")}</Chip>
                  <span className="text-[10.5px] leading-relaxed text-ink-600">{fmtDateTime(x.recordedAt)}</span>
                </div>
                <p className="mt-1 leading-relaxed text-ink-600">{x.basis}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    );
  };

  const EvaluationTab = cycle ? (
    <div className="grid gap-4">
      <StageBrief {...STAGE_BRIEFS.evaluation} />

      <Card title="Conflict-of-interest declarations" sub="EVERY PRESENT MEMBER DECLARES BEFORE THE MATRIX IS CERTIFIED — THE GATE ENFORCES IT" workflow busy={busy} actionLabel="Manage declarations" teaser={`${count(cycle.coi.length, "declaration")} for ${count(presentMembers.length, "present member")} · ${count(cycle.coi.filter((c) => c.recused).length, "recusal")} · ${cycle.coi.length >= presentMembers.length && presentMembers.length > 0 ? "the certification gate has a complete set" : "the gate will refuse a partial set"}`}>
        {presentMembers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-200 px-4 py-6 text-center">
            <p className="text-[12px] font-semibold text-ink-700">No present committee members on record</p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-500">Add members or update attendance in Committee. Declarations are collected from the members recorded as present.</p>
          </div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
          {presentMembers.map((m) => {
            const decl = cycle.coi.find((x) => x.member.toLowerCase() === m.name.toLowerCase());
            return (
              <li key={m.name} className="rounded-xl border border-ink-100 bg-paper px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-ink-900">{m.name}</p>
                    <p className="text-[11px] leading-relaxed text-ink-600">Present · {m.office ? OFFICE_LABELS[m.office] ?? m.office.replace(/_/g, " ") : "Office not set"}</p>
                  </div>
                  {decl ? (
                    decl.declaration === "NO_CONFLICT" ? <Chip tone="ok">NO CONFLICT</Chip> : <Chip tone="warn">CONFLICT DECLARED</Chip>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <Btn variant="ghost" onClick={() => declareCoi(m.name, "NO_CONFLICT")} disabled={busy}>
                        None
                      </Btn>
                      <Btn variant="ghost" onClick={() => declareCoi(m.name, "CONFLICT_DECLARED")} disabled={busy}>
                        <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" /> Declare
                      </Btn>
                    </div>
                  )}
                </div>
                {decl ? (
                  <div className="mt-2 space-y-1.5">
                    {decl.declaration === "CONFLICT_DECLARED" && !decl.conflicts ? (
                      <input
                        className={inputCls}
                        aria-label={`Conflict declaration for ${m.name}`}
                        placeholder="State the conflict"
                        value={d[`coi-${m.name}`] ?? ""}
                        onChange={(e) => set(`coi-${m.name}`, e.target.value)}
                        onBlur={() => declareCoi(m.name, "CONFLICT_DECLARED")}
                      />
                    ) : null}
                    <p className="text-[11px] text-ink-500">
                      <span className="font-code text-[10px] font-semibold tracking-[0.04em] text-ink-600">Connections: </span>
                      {decl.entities?.length
                        ? decl.entities.map((entity) => `${entity.name}${entity.relationship ? ` (${entity.relationship})` : ""}`).join(" · ")
                        : "none named — screening can only check names on the record"}
                    </p>
                    <div className="flex items-start gap-1.5">
                      <textarea
                        className={cn(inputCls, "h-14 py-2 text-[11.5px]")}
                        aria-label={`Connected firms or people for ${m.name}`}
                        placeholder="Connected firms or people, one per line: Acme Holdings | former employer"
                        value={d[`coi-ent-${m.name}`] ?? ""}
                        onChange={(e) => set(`coi-ent-${m.name}`, e.target.value)}
                      />
                      <Btn variant="ghost" onClick={() => saveCoiConnections(m.name, decl)} disabled={busy}>
                        Save
                      </Btn>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
          </ul>
        )}
      </Card>

      {cycle.matrix ? (
        <Card title={`Evaluation matrix ${cycle.matrix.id}`} sub={`${cycle.matrix.status} · TECHNICAL ${cycle.matrix.technicalWeightPct}/FINANCIAL ${100 - cycle.matrix.technicalWeightPct}${cycle.matrix.certifiedBy ? ` · CERTIFIED BY ${cycle.matrix.certifiedBy.toUpperCase()}` : ""}`} workflow busy={busy} actionLabel="Open evaluation matrix">
          {!scoreBasisReady && cycle.matrix.status === "DRAFT" ? (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[10.5px] leading-relaxed text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/[0.04] dark:text-amber-200">
              Scoring is locked until the evaluation currency and required FX quotes are recorded and the committee records its pre-score MED basis.
            </div>
          ) : null}
          <HorizontalScrollRegion label="Evaluation scoring matrix">
            <table className="w-full min-w-[720px] text-[12px]">
              <thead>
                <tr className="border-b border-ink-100 text-left font-code text-[10px] font-bold tracking-[0.06em] text-ink-600">
                  <th scope="col" className="py-2 pr-2">BIDDER</th>
                  {cycle.matrix.criteria.map((c) => (
                    <th key={c.id} scope="col" className="py-2 pr-2">
                      {c.title.toUpperCase()} · {c.weight}%
                    </th>
                  ))}
                  <th scope="col" className="py-2 pr-2">TECH</th>
                  <th scope="col" className="py-2 pr-2">FIN</th>
                  <th scope="col" className="py-2 pr-2">TOTAL</th>
                  <th scope="col" className="py-2 pr-2">RESPONSIVE</th>
                  <th scope="col" className="py-2 pr-2">VERDICT</th>
                  <th scope="col" className="py-2"><span className="sr-only">Row actions</span></th>
                </tr>
              </thead>
              <tbody>
                {cycle.matrix.bids.map((b) => (
                  <tr key={b.bidder} className="border-b border-ink-100 last:border-0 align-top">
                    <td className="py-2 pr-2 font-semibold text-ink-900">
                      {b.bidder}
                      {b.late ? <Chip tone="warn">LATE</Chip> : null}
                      {b.reasons.length ? <p className="mt-1 max-w-[220px] text-[10.5px] leading-snug text-ink-400">{b.reasons[0]}</p> : null}
                    </td>
                    {cycle.matrix!.criteria.map((c) => {
                      const s = b.technicalScores.find((x) => x.criterionId === c.id);
                      return (
                        <td key={c.id} className="py-2 pr-2">
                          <input
                            className="h-11 w-16 rounded-lg border border-ink-200 px-2 text-base disabled:border-transparent disabled:bg-transparent disabled:text-ink-700"
                            type="number" min={0} max={100}
                            aria-label={`${b.bidder} technical score for ${c.title}, from 0 to 100`}
                            disabled={cycle.matrix!.status === "CERTIFIED"}
                            value={d[`s-${b.bidder}-${c.id}`] ?? String(s?.score ?? 0)}
                            onChange={(e) => set(`s-${b.bidder}-${c.id}`, e.target.value)}
                          />
                        </td>
                      );
                    })}
                    <td className="py-2 pr-2 font-bold text-ink-900">{b.technicalTotal}</td>
                    <td className="py-2 pr-2">
                      <span>{b.financial?.formulaScore ?? "—"}</span>
                      {b.financial?.evaluatedAmount !== undefined ? (
                        <p className="mt-0.5 max-w-[220px] font-code text-[10px] leading-relaxed tracking-normal text-ink-600">
                          {b.financial.currency ?? "?"} {fmtMoney(b.financial.amount)} → {b.financial.evaluatedCurrency}{" "}
                          {fmtMoney(b.financial.evaluatedAmount)} @ {b.financial.fxRate}
                        </p>
                      ) : null}
                      {b.financial?.fxError ? (
                        <p className="mt-0.5 max-w-[220px] text-[11px] leading-snug text-brand-800 dark:text-brand-300">
                          NO FX — {b.financial.fxError}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2 font-bold text-ink-950">{b.total ?? "—"}</td>
                    <td className="py-2 pr-2 font-code text-[10px] font-semibold tracking-[0.04em]">
                      {b.responsiveness === "RESPONSIVE" ? <span className="text-emerald-700 dark:text-emerald-300">YES</span> : <span className="text-brand-700 dark:text-brand-300">{b.responsiveness.replace(/_/g, " ")}</span>}
                    </td>
                    <td className="py-2 pr-2">{b.verdict === "RECOMMENDED" ? <Chip tone="ok">RECOMMENDED</Chip> : b.verdict === "DISQUALIFIED" ? <Chip tone="warn">DISQUALIFIED</Chip> : <Chip tone="muted">NOT RECOMMENDED</Chip>}</td>
                    <td className="py-2">
                      {cycle.matrix!.status === "DRAFT" ? (
                  <Btn variant="ghost" onClick={() => saveScores(b.bidder)} disabled={busy || !scoreBasisReady}>
                          Save
                        </Btn>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </HorizontalScrollRegion>
          {cycle.matrix.status === "DRAFT" ? (
            <div className="mt-3 grid gap-3 border-t border-ink-100 pt-3 lg:grid-cols-2">
              <div className="space-y-2">
                <Field label="MARGIN-OF-ERROR SESSION ATTENDEES (COMMA-SEPARATED)">
                  <input className={inputCls} value={d.medAttendees ?? ""} onChange={(e) => set("medAttendees", e.target.value)} placeholder={members.map((m) => m.name).join(", ")} disabled={scoringStarted} />
                </Field>
                <Field label="MARGIN-OF-ERROR ADJUSTMENTS — ONE PER LINE: BIDDER | C-01 = 85">
                  <textarea className={cn(inputCls, "h-16 py-2")} value={d.medAdj ?? ""} onChange={(e) => set("medAdj", e.target.value)} disabled={scoringStarted} />
                </Field>
                <Field label="MARGIN-OF-ERROR BASIS — ADJUSTMENT OR WHY NONE IS REQUIRED">
                  <textarea className={cn(inputCls, "h-16 py-2")} value={d.medNotes ?? ""} onChange={(e) => set("medNotes", e.target.value)} placeholder="Record the margin-of-error basis before any scores are entered…" disabled={scoringStarted} />
                </Field>
                <Btn variant="ghost" onClick={recordMed} disabled={busy || scoringStarted || (d.medNotes ?? "").trim().length < 12}>
                  <FileSignature className="h-3.5 w-3.5" aria-hidden="true" /> Record pre-score margin-of-error basis
                </Btn>
                {scoringStarted ? <p className="text-[10.5px] leading-snug text-amber-700 dark:text-amber-300">The FX and MED basis was locked when scoring began.</p> : null}
                {cycle.matrix.med ? (
                  <div className="rounded-lg border border-ink-100 bg-white/70 px-2.5 py-2 text-[10.5px] leading-relaxed dark:border-white/[0.07] dark:bg-white/[0.025]">
                    <p className="font-semibold text-ink-800">MED recorded · {fmtDateTime(cycle.matrix.med.recordedAt)}</p>
                    <p className="mt-1 text-ink-500">{cycle.matrix.med.notes || "No basis note on the legacy record."}</p>
                    {Object.entries(cycle.matrix.med.adjustments ?? {}).length ? (
                      <ul className="mt-1 space-y-0.5 font-code text-[10px] leading-relaxed text-ink-600">
                        {Object.entries(cycle.matrix.med.adjustments ?? {}).map(([key, score]) => <li key={key}>{key.replace("|", " · ")} → {score}</li>)}
                      </ul>
                    ) : <p className="mt-1 text-[11px] text-ink-600">No score adjustments recorded.</p>}
                  </div>
                ) : null}
              </div>
              <div className="flex flex-col items-start gap-2">
                {outstandingCoi.length ? (
                  <p className="text-[12px] text-ink-600">
                    <span className="font-semibold text-ink-900">Conflict-of-interest declarations outstanding:</span>{" "}
                    {outstandingCoi.map((m) => m.name).join(", ")}
                  </p>
                ) : null}
                {openAlbDossiers.length ? (
                  <p className="text-[12px] text-amber-800 dark:text-amber-300">
                    <span className="font-semibold">Resolve open ALB dossiers before certification:</span>{" "}
                    {openAlbDossiers.map((dossier) => dossier.bidder).join(", ")}
                  </p>
                ) : null}
                <Btn onClick={certifyMatrix} disabled={busy || outstandingCoi.length > 0 || openAlbDossiers.length > 0}>
                  <Stamp className="h-3.5 w-3.5" aria-hidden="true" /> Certify the matrix (gate)
                </Btn>
              </div>
            </div>
          ) : null}
        </Card>
      ) : (
        <Card title="Build the evaluation matrix" sub="CRITERIA WEIGHTS MUST SUM TO 100 — THE VALIDATOR REFUSES ANYTHING ELSE" workflow busy={busy} actionLabel="Set evaluation criteria">
          <div className="grid gap-3">
            {publishedCriteriaReady ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-500/20 dark:bg-emerald-500/[0.04]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-code text-[10px] font-bold tracking-[0.06em] text-emerald-900 dark:text-emerald-300">PUBLISHED EVALUATION CRITERIA · TOTAL {publishedCriteriaWeight.toFixed(1)}%</p>
                  <Chip tone="ok">NOTICE {publishedEvaluationNotice?.id}</Chip>
                </div>
                <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                  {publishedEvaluationCriteria.map((criterion) => (
                    <li key={criterion.id} className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200/70 bg-white/70 px-2.5 py-2 text-[11.5px] dark:border-white/[0.06] dark:bg-white/[0.025]">
                      <div className="min-w-0">
                        <p className="font-medium text-ink-800">{criterion.title}</p>
                        {criterion.evidence ? <p className="mt-1 leading-relaxed text-ink-600 dark:text-ink-500"><span className="font-semibold">Evidence:</span> {criterion.evidence}</p> : null}
                        {criterion.scoringMethod ? <p className="mt-1 leading-relaxed text-ink-600 dark:text-ink-500"><span className="font-semibold">Scoring:</span> {criterion.scoringMethod}</p> : null}
                      </div>
                      <span className="shrink-0 font-code text-[10.5px] font-bold text-ink-600">{criterion.weight}%</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11.5px] leading-relaxed text-ink-600">The matrix will use this issued notice’s criteria exactly.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/60 px-3 py-3 dark:border-amber-500/25 dark:bg-amber-500/[0.04]">
                <p className="text-[11.5px] font-semibold text-amber-900 dark:text-amber-200">No valid criteria table found in an issued notice.</p>
                <p className="mt-1 text-[10.5px] leading-relaxed text-amber-800 dark:text-amber-300">In Solicitation, draft a specification with evaluation criteria, draft or redraft the notice, and publish it through the procurement-unit gate. The weights must total exactly 100 before scoring begins.</p>
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field label="TECHNICAL WEIGHT % (REST GOES TO THE FINANCIAL FORMULA)">
                <input className={inputCls} type="number" min={0} max={100} value={Number.isFinite(publishedTechWeight) ? publishedTechWeight : ""} disabled />
              </Field>
              <Btn onClick={buildMatrix} disabled={busy || !ref || !publishedCriteriaReady}>
                <Play className="h-3.5 w-3.5" aria-hidden="true" /> Build from notice
              </Btn>
            </div>
          </div>
        </Card>
      )}

      {cycle.matrix ? (
        <Card
          title="Evaluation integrity"
          sub="EACH EVALUATOR SCORES THEIR OWN SHEET · THE COMMITTEE RECORDS THE CONSENSUS · THE MATRIX FOLLOWS IT · FOREIGN PRICES ARE SCORED ON A SOURCED FX BASIS"
          workflow
          busy={busy}
          actionLabel="Manage evaluation integrity"
          teaser={`${count(cycle.matrix.sheets?.length ?? 0, "evaluator sheet")} · ${count(sheetDivergences(cycle.matrix.sheets ?? []).length, "divergent cell")} · ${cycle.matrix.consensus ? "consensus minute recorded" : "consensus minute not recorded"}`}
        >
          {!cycle.matrix.financialAdjustmentsCertifiedAt ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/20 dark:bg-amber-500/[0.04]">
              <p className="font-code text-[10px] font-bold tracking-[0.06em] text-amber-900 dark:text-amber-200">FINANCIAL BASIS — RECORD BEFORE ANY EVALUATOR SCORES</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-amber-800 dark:text-amber-300">For each bidder, record arithmetic correction, unconditional discount, other documented adjustment, and a source reference. The published preference scheme controls whether any margin is available. A second procurement-unit member certifies this record.</p>
              <div className="mt-3 space-y-2">
                {cycle.matrix.bids.map((bid) => {
                  const key = encodeURIComponent(bid.bidder);
                  return (
                    <div key={bid.bidder} className="grid gap-1.5 rounded-lg border border-amber-200/70 bg-white/70 p-2 dark:border-white/[0.06] dark:bg-white/[0.025] sm:grid-cols-2 lg:grid-cols-4">
                      <p className="truncate self-center text-[11.5px] font-semibold text-ink-800" title={bid.bidder}>{bid.bidder}</p>
                      <input className={inputCls} aria-label={`Arithmetic correction for ${bid.bidder}`} type="number" step="0.01" placeholder="Arithmetic correction ±" value={d[`fin-${key}-correction`] ?? "0"} onChange={(e) => set(`fin-${key}-correction`, e.target.value)} />
                      <input className={inputCls} aria-label={`Unconditional discount for ${bid.bidder}`} type="number" min="0" step="0.01" placeholder="Unconditional discount" value={d[`fin-${key}-discount`] ?? "0"} onChange={(e) => set(`fin-${key}-discount`, e.target.value)} />
                      <input className={inputCls} aria-label={`Other evaluated adjustment for ${bid.bidder}`} type="number" step="0.01" placeholder="Other evaluated adjustment ±" value={d[`fin-${key}-other`] ?? "0"} onChange={(e) => set(`fin-${key}-other`, e.target.value)} />
                      {cycle.matrix?.preferenceScheme === "SI45-2025" ? (
                        <select className={inputCls} aria-label={`Preference claim for ${bid.bidder}`} value={d[`fin-${key}-preference`] ?? ""} onChange={(e) => set(`fin-${key}-preference`, e.target.value)}>
                          <option value="">No preference claimed</option>
                          <option value="LOCAL_SUPPLIER">Local supplier · 5%</option>
                          <option value="CITIZEN_SUPPLIER">Citizen supplier · 7%</option>
                          <option value="CITIZEN_WOMAN_OWNED">Citizen woman owned · 9%</option>
                          <option value="CITIZEN_YOUTH_OWNED">Citizen youth owned · 9%</option>
                          <option value="CITIZEN_PWD_OWNED">Citizen PWD owned · 10%</option>
                          <option value="CITIZEN_SMALL_TURNOVER">Citizen small turnover · 8%</option>
                          <option value="CITIZEN_LOCAL_JV">Citizen/local JV · 6%</option>
                          <option value="LOCAL_CONTENT_CITIZEN">Citizen local content · 15%</option>
                          <option value="LOCAL_CONTENT_CITIZEN_LOCAL_JV">Citizen/local JV content · 12%</option>
                          <option value="LOCAL_CONTENT_LOCAL">Local producer content · 10%</option>
                        </select>
                      ) : null}
                      {d[`fin-${key}-preference`]?.startsWith("LOCAL_CONTENT_") ? (
                        <input className={inputCls} aria-label={`Verified local content percentage for ${bid.bidder}`} type="number" min="35" max="100" placeholder="Verified local content %" value={d[`fin-${key}-local-content`] ?? ""} onChange={(e) => set(`fin-${key}-local-content`, e.target.value)} />
                      ) : null}
                      {cycle.matrix?.preferenceScheme === "CDF_RESERVATION" ? (
                        <>
                          <select className={inputCls} aria-label={`Citizen supplier status for ${bid.bidder}`} value={d[`fin-${key}-reservation-citizen`] ?? ""} onChange={(e) => set(`fin-${key}-reservation-citizen`, e.target.value)}>
                            <option value="">Citizen supplier?</option>
                            <option value="yes">Yes — citizen supplier</option>
                            <option value="no">No — not a citizen supplier</option>
                          </select>
                          <select className={inputCls} aria-label={`Funded constituency residence status for ${bid.bidder}`} value={d[`fin-${key}-reservation-domiciled`] ?? ""} onChange={(e) => set(`fin-${key}-reservation-domiciled`, e.target.value)}>
                            <option value="">Domiciled in {cycle.matrix?.cdfReservationConstituency ?? "funded constituency"}?</option>
                            <option value="yes">Yes — domiciled in funded constituency</option>
                            <option value="no">No — domiciled elsewhere</option>
                          </select>
                          {!cycle.matrix?.cdfReservationExceptionRef && d[`fin-${key}-reservation-domiciled`] === "no" ? (
                            <p className="text-[10px] leading-relaxed text-amber-800 dark:text-amber-300 sm:col-span-2">The published notice has no locality exception; a citizen bidder domiciled outside the funded constituency will be marked nonresponsive.</p>
                          ) : null}
                        </>
                      ) : null}
                      <input className={cn(inputCls, "sm:col-span-2 lg:col-span-2")} aria-label={`Evidence reference for evaluated-price adjustments for ${bid.bidder}`} placeholder="Bid page / correction / ownership / local-content evidence reference" value={d[`fin-${key}-evidence`] ?? ""} onChange={(e) => set(`fin-${key}-evidence`, e.target.value)} />
                    </div>
                  );
                })}
              </div>
              <Btn className="mt-3" onClick={certifyFinancialAdjustments} disabled={busy || !ref || cycle.matrix.status !== "DRAFT"}>
                <Stamp className="h-3.5 w-3.5" aria-hidden="true" /> Certify evaluated-price inputs
              </Btn>
            </div>
          ) : (
            <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-[10.5px] text-emerald-900 dark:border-emerald-500/20 dark:bg-emerald-500/[0.04] dark:text-emerald-200">
              Financial adjustments certified {fmtDateTime(cycle.matrix.financialAdjustmentsCertifiedAt)} · preference: {cycle.matrix.preferenceScheme ?? "None"} · formula: {cycle.matrix.financialFormula}
            </p>
          )}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Chip tone={cycle.matrix.criteriaNoticeId ? "ok" : "warn"}>
              {cycle.matrix.criteriaNoticeId ? `CRITERIA FROM NOTICE ${cycle.matrix.criteriaNoticeId}` : "LEGACY CRITERIA SOURCE NOT RECORDED"}
            </Chip>
            <Chip tone={sheets.length >= assignedEvaluators.length && assignedEvaluators.length >= 2 ? "ok" : "warn"}>
              SHEETS {sheets.length}/{assignedEvaluators.length || "—"}
            </Chip>
            <Chip tone={cycle.matrix.consensus ? "ok" : "warn"}>
              {cycle.matrix.consensus ? "CONSENSUS RECORDED" : "NO CONSENSUS"}
            </Chip>
            <Chip tone={cycle.matrix.evaluationCurrency ? "brand" : "muted"}>
              BASIS {cycle.matrix.evaluationCurrency ?? "LEGACY STATED AMOUNTS"}
            </Chip>
            {cycle.matrix.consensus ? (
              <span className="font-code text-[10px] tracking-[0.04em] text-ink-600">
                SIG {cycle.matrix.consensus.signature.slice(0, 12).toUpperCase()}
              </span>
            ) : null}
          </div>
          <div className={cn(
            "mb-3 rounded-lg border px-3 py-2 text-[10.5px] leading-relaxed",
            scoreBasisReady
              ? "border-emerald-200 bg-emerald-50/60 text-emerald-900 dark:border-emerald-500/20 dark:bg-emerald-500/[0.04] dark:text-emerald-200"
              : "border-amber-200 bg-amber-50/60 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/[0.04] dark:text-amber-200",
          )}>
            {scoreBasisReady
              ? scoringStarted
                ? "Pre-score FX and MED basis locked; scores and signed sheets are now being collected."
                : "FX and MED basis recorded. The committee may now begin scoring."
              : cycle.matrix.scoringBasisBlockReason ?? "Record the currency basis, sourced FX quotes where needed, and the MED adjustment or reason for none before scoring."}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <p className="font-code text-[10px] font-semibold tracking-[0.06em] text-ink-600">PER-EVALUATOR SHEETS</p>
              {assignedEvaluators.length === 0 ? (
                <p className="text-[11.5px] text-amber-700 dark:text-amber-300">
                  No PRESENT member holds the evaluation-committee office — the certification gate refuses a panel that is not constituted.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {assignedEvaluators.map((member) => {
                    const sheet = sheets.find((entry) => entry.evaluator.toLowerCase() === member.name.toLowerCase());
                    const total = sheet
                      ? cycle.matrix!.criteria.reduce((sum, criterion) => {
                          const cell = sheet.scores.find((score) => score.criterionId === criterion.id);
                          return sum + (cell ? cell.score * criterion.weight : 0);
                        }, 0) / 100
                      : undefined;
                    return (
                      <li key={member.name} className="flex items-center justify-between gap-2 rounded-lg border border-ink-100 bg-paper px-2.5 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-semibold text-ink-900">{member.name}</p>
                          <p className="text-[11px] leading-relaxed text-ink-600">
                            {sheet ? `V${sheet.version} · ${fmtDateTime(sheet.submittedAt)} · ${sheet.submittedBy.toUpperCase()}` : "NO SHEET ON FILE"}
                          </p>
                        </div>
                        {sheet ? <Chip tone="ok">TECH {Math.round(total! * 10) / 10}</Chip> : <Chip tone="warn">OUTSTANDING</Chip>}
                      </li>
                    );
                  })}
                </ul>
              )}

              {cycle.matrix.status === "DRAFT" ? (
                <div className="space-y-2 rounded-xl border border-ink-100 bg-paper p-2.5">
                  <Field label="SCORE AS">
                    <select className={inputCls} value={sheetEvaluator} onChange={(e) => set("sheetEvaluator", e.target.value)}>
                      {assignedEvaluators.length === 0 ? <option value="">No evaluator office set</option> : null}
                      {assignedEvaluators.map((member) => (
                        <option key={member.name} value={member.name}>
                          {member.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {sheetEvaluator ? (
                    <HorizontalScrollRegion label="Evaluator scoring sheet">
                      <table className="w-full min-w-[420px] text-[11px]">
                        <thead>
                          <tr className="border-b border-ink-100 text-left font-code text-[10px] font-bold tracking-[0.04em] text-ink-600">
                            <th scope="col" className="py-1.5 pr-1.5">BIDDER</th>
                            {cycle.matrix.criteria.map((criterion) => (
                              <th key={criterion.id} scope="col" className="py-1.5 pr-1.5">
                                {criterion.id} · {criterion.weight}%
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {cycle.matrix.bids.map((bid) => (
                            <tr key={bid.bidder} className="border-b border-ink-100 last:border-0">
                              <td className="py-1.5 pr-1.5 font-semibold text-ink-800">{bid.bidder}</td>
                              {cycle.matrix!.criteria.map((criterion) => (
                                <td key={criterion.id} className="py-1.5 pr-1.5">
                                  <input
                                    className="h-11 w-16 rounded-md border border-ink-200 px-1.5 text-base"
                                    type="number"
                                    min={0}
                                    max={100}
                                    aria-label={`${bid.bidder} score for ${criterion.title}, ${criterion.weight} percent, from 0 to 100`}
                                    disabled={!scoreBasisReady}
                                    value={d[`sh-${sheetEvaluator}-${bid.bidder}-${criterion.id}`] ?? ""}
                                    onChange={(e) => set(`sh-${sheetEvaluator}-${bid.bidder}-${criterion.id}`, e.target.value)}
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </HorizontalScrollRegion>
                  ) : null}
                  <Btn variant="ghost" onClick={submitSheet} disabled={busy || !sheetEvaluator || !scoreBasisReady}>
                    <FileSignature className="h-3.5 w-3.5" aria-hidden="true" /> Submit sheet for {sheetEvaluator || "—"}
                  </Btn>
                  <p className="text-[10.5px] leading-snug text-ink-400">
                    A resubmission supersedes your earlier sheet and clears the consensus, because the agreement no longer describes the evidence.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <p className="font-code text-[10px] font-semibold tracking-[0.06em] text-ink-600">DIVERGENCES ACROSS SHEETS</p>
              {divergences.length === 0 ? (
                <p className="text-[11.5px] text-ink-500">No cell has more than one scored sheet yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {divergences.slice(0, 8).map((cell) => (
                    <li key={`${cell.bidder}-${cell.criterionId}`} className="rounded-lg border border-ink-100 bg-paper px-2.5 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11.5px] font-semibold text-ink-800">
                          {cell.bidder} · {cell.criterionId}
                        </p>
                        <Chip tone={cell.spread > 25 ? "warn" : "muted"}>SPREAD {cell.spread}</Chip>
                      </div>
                      <p className="text-[11px] leading-relaxed text-ink-600">
                        {cell.values.map((value) => `${value.evaluator.toUpperCase()} ${value.score}`).join(" · ")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              {cycle.matrix.status === "DRAFT" ? (
                <div className="space-y-2 rounded-xl border border-ink-100 bg-paper p-2.5">
                  <Field label="CONSENSUS ATTENDEES (COMMA-SEPARATED)">
                    <input
                      className={inputCls}
                      value={d.consensusAttendees ?? assignedEvaluators.map((member) => member.name).join(", ")}
                      onChange={(e) => set("consensusAttendees", e.target.value)}
                    />
                  </Field>
                  <Field label="MINUTE — WHAT WAS RECONCILED AND WHY">
                    <textarea
                      className={cn(inputCls, "h-16 py-2")}
                      placeholder="The panel reconciled the widest spreads on ..."
                      value={d.consensusNotes ?? ""}
                      onChange={(e) => set("consensusNotes", e.target.value)}
                    />
                  </Field>
                  <Btn onClick={recordConsensus} disabled={busy || sheets.length < 2}>
                    <Stamp className="h-3.5 w-3.5" aria-hidden="true" /> Record consensus
                  </Btn>
                  {sheets.length < 2 ? (
                    <p className="text-[10.5px] text-ink-400">Two sheets are required before a consensus can be recorded.</p>
                  ) : null}
                </div>
              ) : cycle.matrix.consensus ? (
                <div className="rounded-xl border border-ink-100 bg-paper p-2.5 text-[11.5px] text-ink-600">
                  <p className="font-semibold text-ink-900">Consensus minute</p>
                  <p className="mt-1 leading-snug">{cycle.matrix.consensus.notes}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-600">
                    {cycle.matrix.consensus.recordedBy.toUpperCase()} · {fmtDateTime(cycle.matrix.consensus.recordedAt)} · ATTENDEES{" "}
                    {cycle.matrix.consensus.attendees.join(", ")}
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-4 space-y-2 border-t border-ink-100 pt-3">
            <p className="font-code text-[10px] font-semibold tracking-[0.06em] text-ink-600">EVALUATED-PRICE BASIS</p>
            <div className="grid gap-1.5 sm:grid-cols-[140px_1fr]">
              <input
                className={inputCls}
                aria-label="Evaluation currency"
                placeholder="ZMW"
                value={d.evalCurrency ?? cycle.matrix.evaluationCurrency ?? ""}
                onChange={(e) => set("evalCurrency", e.target.value.toUpperCase())}
                disabled={cycle.matrix.status === "CERTIFIED" || scoringStarted}
              />
              <textarea
                className={cn(inputCls, "h-16 py-2")}
                aria-label="Sourced foreign-exchange rates and dates"
                placeholder="USD = 25.80 | Bank of Zambia | 2026-10-29"
                value={
                  d.fxRates ??
                  (cycle.matrix.fxRates ?? []).map((rate) => `${rate.base} = ${rate.rate} | ${rate.source} | ${rate.asOf.slice(0, 10)}`).join("\n")
                }
                onChange={(e) => set("fxRates", e.target.value)}
                disabled={cycle.matrix.status === "CERTIFIED" || scoringStarted}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {cycle.matrix.status === "DRAFT" ? (
                <Btn variant="ghost" onClick={saveFx} disabled={busy || scoringStarted}>
                  <Check className="h-3.5 w-3.5" aria-hidden="true" /> Save the FX basis
                </Btn>
              ) : null}
              {(cycle.matrix.fxRates ?? []).map((rate) => (
                <span key={rate.base} className="font-code text-[10px] tracking-normal text-ink-600">
                  {rate.base}→{rate.quote} {rate.rate} · {rate.source.toUpperCase()} · {rate.asOf.slice(0, 10)}
                </span>
              ))}
            </div>
            <p className="text-[10.5px] leading-snug text-ink-400">
              One line per foreign currency: BASE = RATE | SOURCE | YYYY-MM-DD. The financial formula scores the converted amount; the gate refuses a missing, unsourced or stale quote.
            </p>
            {!scoreBasisReady ? <p className="text-[10.5px] leading-snug text-amber-700 dark:text-amber-300">Record the evaluated-price basis and pre-score MED session before any evaluator enters scores.</p> : null}
          </div>
        </Card>
      ) : null}

      <Card
        title="Abnormally low bids"
        sub="OPEN A CITED FIVE-WORKING-DAY JUSTIFICATION DOSSIER — EACH RESOLUTION NEEDS THE EVALUATION COMMITTEE GATE"
        right={cycle.alb.some((a) => !a.resolution) ? <Chip tone="warn">{cycle.alb.filter((a) => !a.resolution).length} OPEN</Chip> : <Chip tone={cycle.alb.length ? "ok" : "muted"}>{cycle.alb.length ? "ALL RESOLVED" : "NO DOSSIERS"}</Chip>}
      >
        <div className="grid gap-3 rounded-xl border border-ink-100 bg-paper p-3 dark:border-white/[0.07]">
          <div className="grid gap-2 sm:grid-cols-[minmax(180px,0.8fr)_minmax(260px,1.5fr)_auto] sm:items-end">
            <Field label="BIDDER — ON THIS MATRIX">
              <select className={inputCls} value={d.albBidder ?? ""} onChange={(e) => set("albBidder", e.target.value)}>
                <option value="">Select a bidder</option>
                {(cycle.matrix?.bids ?? []).map((bid) => <option key={bid.bidder} value={bid.bidder}>{bid.bidder}</option>)}
              </select>
            </Field>
            <Field label="PRICE EVIDENCE — WHY JUSTIFICATION IS REQUIRED">
              <input className={inputCls} value={d.albBasis ?? ""} onChange={(e) => set("albBasis", e.target.value)} maxLength={800} placeholder="e.g. price is materially below comparable bids for the same scope" />
            </Field>
            <Btn onClick={openAlbDossier} disabled={busy || cycle.matrix?.status === "CERTIFIED" || !d.albBidder || (d.albBasis ?? "").trim().length < 12 || cycle.alb.some((a) => a.bidder.toLowerCase() === (d.albBidder ?? "").toLowerCase() && !a.resolution)}>
              <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" /> Open five-day dossier
            </Btn>
          </div>
          {cycle.matrix?.status === "CERTIFIED" ? <p className="text-[10.5px] text-ink-400">ALB dossiers must be opened and resolved before the evaluation matrix is certified.</p> : null}
          {d.albBidder ? (() => {
            const bid = (cycle.matrix?.bids ?? []).find((row) => row.bidder === d.albBidder);
            const signals = bid?.priceSignals ?? [];
            return signals.length ? (
              <div className="rounded-lg border border-ink-100 bg-white px-2.5 py-2 dark:border-white/[0.07] dark:bg-white/[0.025]">
                <p className="font-code text-[10px] font-bold tracking-[0.06em] text-ink-600">PRICE SCHEDULE SIGNALS · HUMAN REVIEW REQUIRED</p>
                <ul className="mt-1 space-y-0.5">
                  {signals.slice(0, 4).map((signal, index) => (
                    <li key={`${signal.item}-${index}`} className="text-[10.5px] leading-relaxed text-ink-600">
                      {signal.item} · {signal.currency ?? "currency unstated"}{signal.ratioToPeerMedian !== undefined ? ` · ${signal.ratioToPeerMedian}× peer median` : " · no comparable peer"}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-[10.5px] leading-relaxed text-ink-400">No same-item price comparison is available for this bid; cite the file evidence in the reason field above.</p>
            );
          })() : null}
        </div>
        {cycle.alb.length ? (
          <ul className="mt-3 space-y-2">
            {cycle.alb.map((a) => (
              <li key={a.id} className="rounded-xl border border-ink-100 bg-paper px-3 py-2.5 dark:border-white/[0.07]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-ink-900">{a.bidder}</p>
                    <p className="text-[11px] leading-relaxed text-ink-600">Opened {a.openedAt ? fmtDate(a.openedAt) : "—"} · Response due {fmtDate(a.responseDueAt)} · {relDays(a.responseDueAt)}</p>
                  </div>
                  {a.resolution ? <Chip tone={a.resolution.outcome === "JUSTIFIED" ? "ok" : "warn"}>{a.resolution.outcome}</Chip> : <Chip tone="warn">OPEN</Chip>}
                </div>
                {a.openingBasis ? <p className="mt-1.5 text-[11px] leading-relaxed text-ink-600">Basis: {a.openingBasis}</p> : null}
                {a.response ? (
                  <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5 text-[11px] dark:border-emerald-500/20 dark:bg-emerald-500/[0.04]">
                    <p className="font-semibold text-emerald-900 dark:text-emerald-200">Bidder response received {fmtDateTime(a.response.receivedAt)} · {a.response.submittedByOrg}</p>
                    <p className="mt-1 whitespace-pre-wrap text-ink-700">{a.response.text}</p>
                    <p className="mt-1 text-[10.5px] leading-relaxed text-ink-600">Evidence {a.response.evidenceRef} · Receipt {a.response.receiptHash?.slice(0, 16) ?? "—"}</p>
                  </div>
                ) : a.noResponseRecordedAt ? (
                  <p className="mt-2 text-[11px] text-amber-800 dark:text-amber-300">No bidder response recorded after the deadline on {fmtDateTime(a.noResponseRecordedAt)} by {a.noResponseRecordedBy}.</p>
                ) : null}
                {a.resolution ? (
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-600">{a.resolution.note}</p>
                ) : (
                  <div className="mt-2 flex flex-wrap items-end gap-1.5">
                    {!a.response && !a.noResponseRecordedAt && new Date(a.responseDueAt).getTime() < Date.now() ? (
                      <Btn
                        variant="ghost"
                        onClick={() => act(`/api/tenders/${ref}/alb/${a.id}/no-response`, {}, "ALB NON-RESPONSE RECORDED").then((ok) => ok && refreshCycle())}
                        disabled={busy}
                      >
                        Record no response after deadline
                      </Btn>
                    ) : null}
                    <Field label="OUTCOME">
                      <select className={inputCls} value={d[`alb-${a.id}-outcome`] ?? "JUSTIFIED"} onChange={(e) => set(`alb-${a.id}-outcome`, e.target.value)}>
                        <option value="JUSTIFIED" disabled={!a.response}>Justified — the price is sustainable and explained</option>
                        <option value="REJECTED">Rejected — the price is not sustainable, the bid falls away</option>
                        <option value="WITHDRAWN">Withdrawn — the bidder stood down</option>
                      </select>
                    </Field>
                    <Field label="NOTE — THE REASONS ON THE FILE">
                      <input className={cn(inputCls, "w-64")} placeholder="What the bidder showed, and what the committee accepted" value={d[`alb-${a.id}-note`] ?? ""} onChange={(e) => set(`alb-${a.id}-note`, e.target.value)} />
                    </Field>
                    <Btn
                      variant="ghost"
                      onClick={() =>
                        act(
                          `/api/tenders/${ref}/alb/${a.id}/resolve`,
                          { outcome: d[`alb-${a.id}-outcome`] || "JUSTIFIED", note: d[`alb-${a.id}-note`] },
                          "ALB RESOLUTION GATE RAISED — THE COMMITTEE SIGNS",
                        ).then((ok) => ok && refreshCycle())
                      }
                      disabled={busy || !ref || (!a.response && !a.noResponseRecordedAt) || !(d[`alb-${a.id}-note`] ?? "").trim()}
                    >
                      Resolve (gate)
                    </Btn>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-[11px] leading-relaxed text-ink-400">No justification dossiers are open. Each new dossier records the pricing evidence and starts its five-working-day response clock.</p>}
        <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
          A resolution takes effect when the evaluation committee signs it — the dossier stays open until the gate is decided, and an under-valued bid may not be recommended while its dossier is open.
        </p>
      </Card>

      {dissentCard(
        "EVALUATION_CERTIFICATION",
        "Minority positions — the certification",
        "A MEMBER WHO WOULD NOT CERTIFY SAYS SO HERE; THE CERTIFIED MATRIX STILL CARRIES THE NOTE",
      )}
    </div>
  ) : null;

  /* ── Tab: award (G6/G7) ──────────────────────────────────────────────────── */

  const draftAwardReport = () => act(`/api/tenders/${ref}/award-report`, {}, "AWARD REPORT DRAFTED — ACCOUNTING OFFICER GATE RAISED").then((ok) => ok && refreshCycle());
  const recordMethod = () =>
    act(
      `/api/tenders/${ref}/method`,
      {
        methodId: canonicalMethodId(d.methodPick ?? cycle?.methodId),
        justification: d.methodJust,
        approvalRef: d.methodRef || undefined,
        estimatedValue: d.methodValue ? Number(d.methodValue) : undefined,
      },
      "METHOD RECORDED — THE LAWFUL ROUTE IS ON THE FILE",
    ).then((ok) => ok && refreshCycle());
  const recordAssurance = (payload: Record<string, unknown>) => {
    const supplierId = cycle?.assurance?.supplierId;
    if (!supplierId) {
      onToast("THE WINNER IS NOT ON THE SUPPLIER REGISTER — ADD AND VERIFY THE SUPPLIER FIRST");
      return;
    }
    void act(
      `/api/suppliers/${encodeURIComponent(supplierId)}/verification`,
      payload,
      "ASSURANCE CHECK RECORDED — THE WHOLE OWNERSHIP AND DOCUMENT SET IS ON THE FILE",
    ).then((ok) => ok && refreshCycle());
  };
  const awardWinner = cycle?.awardReport?.recommendation ?? cycle?.matrix?.bids.find((b) => b.verdict === "RECOMMENDED")?.bidder;
  const awardFindings = (cycle?.findings ?? []).filter(
    (f) => !!awardWinner && [f.item, f.evidence, f.citation].some((v) => v.toLowerCase().includes(awardWinner.toLowerCase())),
  );
  const blockerFindings = awardFindings.filter((f) => f.severity === "HIGH" && (!f.disposition || f.disposition.status === "RE_CHECK"));
  const disposeFinding = (id: string) =>
    act(
      `/api/tenders/${ref}/findings/${id}/dispose`,
      {
        status: d[`fdisp-${id}`] || "CLEARED",
        note: d[`fnote-${id}`],
        secondedBy: d[`fsecond-${id}`] || undefined,
      },
      "FINDING DISPOSITION RECORDED",
    ).then((ok) => ok && refreshCycle());
  const publishNotice = () => act(
    `/api/tenders/${ref}/award-notice/publish`,
    { dispatchEvidenceRef: d.awardDispatchRef },
    "AWARD DISPATCH AND PUBLICATION GATE RAISED",
  ).then((ok) => ok && refreshCycle());
  const draftDebrief = (bidder: string) => act(`/api/tenders/${ref}/debrief`, { bidder }, "DEBRIEF DRAFTED").then((ok) => ok && refreshCycle());
  const issueDebrief = (id: string) => act(`/api/tenders/${ref}/debrief/${id}/issue`, {}, "ISSUING GATE RAISED").then((ok) => ok && refreshCycle());

  const AwardTab = cycle ? (
    <div className="grid gap-4">
      <StageBrief {...STAGE_BRIEFS.award} />

      <div className="grid gap-4 lg:grid-cols-2">
      <Card
        title="Award blockers"
        sub="A HIGH FINDING AGAINST THE RECOMMENDED BID IS OPEN UNTIL A NAMED DISPOSITION CLOSES IT"
        workflow
        busy={busy}
        actionLabel="Dispose of award findings"
        teaser={
          (cycle.blockers ?? []).length > 0
            ? `${count((cycle.blockers ?? []).length, "open blocker")} — the award report gate will refuse until each one has a named disposition.`
            : `${(cycle.findings ?? []).filter((f) => f.disposition).length} of ${count((cycle.findings ?? []).length, "finding")} disposed · nothing blocking the recommendation.`
        }
      >
        {(cycle.blockers ?? []).length > 0 ? (
          <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-[11.5px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="font-code text-[10px] font-semibold tracking-[0.06em]">
              The gate will refuse this report until all {(cycle.blockers ?? []).length} blocker{(cycle.blockers ?? []).length === 1 ? "" : "s"} are resolved.
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {(cycle.blockers ?? []).map((blocker, i) => (
                <li key={i}>{blocker}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {awardFindings.length === 0 ? (
          <p className="text-[12px] text-ink-500">No findings stand against the recommended bid.</p>
        ) : (
          <ul className="space-y-2">
            {awardFindings.map((f) => {
              const open = f.severity === "HIGH" && (!f.disposition || f.disposition.status === "RE_CHECK");
              return (
                <li key={f.id} className="rounded-xl border border-ink-100 bg-paper px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={open ? "warn" : "ok"}>{open ? "OPEN" : f.disposition?.status ?? "—"}</Chip>
                    <span className="font-code text-[10px] tracking-[0.12em] text-ink-500">{f.id} · {f.rule} · {f.severity}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-ink-700">{f.item}</p>
                  {f.disposition ? (
                    <p className="mt-1 text-[11px] text-ink-500">
                      {f.disposition.by}{f.disposition.secondedBy ? ` · seconded ${f.disposition.secondedBy}` : ""} — {f.disposition.note}
                    </p>
                  ) : null}
                  {open ? (
                    <div className="mt-2 grid gap-1.5 sm:grid-cols-[8rem_1fr_8rem_auto]">
                      <select
                        className={inputCls}
                        aria-label={`Disposition for finding ${f.id}`}
                        value={d[`fdisp-${f.id}`] ?? "CLEARED"}
                        onChange={(e) => set(`fdisp-${f.id}`, e.target.value)}
                      >
                        <option value="CLEARED">Cleared</option>
                        <option value="WAIVED">Waived</option>
                        <option value="RE_CHECK">Re-check</option>
                      </select>
                      <input
                        className={inputCls}
                        aria-label={`Disposition reason for finding ${f.id}`}
                        placeholder="Reason (required)"
                        value={d[`fnote-${f.id}`] ?? ""}
                        onChange={(e) => set(`fnote-${f.id}`, e.target.value)}
                      />
                      <input
                        className={inputCls}
                        aria-label={`Seconding officer for finding ${f.id}`}
                        placeholder={d[`fdisp-${f.id}`] === "WAIVED" ? "Seconded by" : "Seconder (waiver)"}
                        value={d[`fsecond-${f.id}`] ?? ""}
                        onChange={(e) => set(`fsecond-${f.id}`, e.target.value)}
                      />
                      <Btn
                        variant="ghost"
                        onClick={() => disposeFinding(f.id)}
                        disabled={busy || !d[`fnote-${f.id}`]}
                      >
                        Record
                      </Btn>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {blockerFindings.length > 0 ? (
          <p className="mt-3 text-[11px] text-amber-700 dark:text-amber-300">
            The award signature is refused while {blockerFindings.length} HIGH finding{blockerFindings.length === 1 ? " is" : "s are"} undispositioned.
          </p>
        ) : null}
      </Card>

      <Card
        title="Procurement method"
        sub="THE LEGAL ROUTE — A NON-OPEN CHOICE NEEDS A JUSTIFICATION AND THE ACCOUNTING OFFICER'S METHOD GATE"
        workflow
        busy={busy}
        actionLabel="Record the procurement method"
        teaser={
          cycle.method?.methodId
            ? `${cycle.method.name ?? cycle.method.methodId}${cycle.method.approvalRef ? ` · authority ${cycle.method.approvalRef}` : " · no approval reference"}${cycle.method.ok ? " · clears the value band" : ` · ${cycle.method.block ?? "blocked"}`}`
            : "No method on the file — the award report cannot be signed until the legal route is chosen and justified."
        }
      >
        {cycle.method?.methodId ? (
          <div className="mb-3 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={cycle.method.ok ? "ok" : "warn"}>{cycle.method.name ?? cycle.method.methodId}</Chip>
              {cycle.methodApprovedAt ? (
                <Chip tone="ok">
                  APPROVED {fmtDate(cycle.methodApprovedAt)} · {cycle.methodApprovedBy?.toUpperCase() ?? "—"}
                </Chip>
              ) : cycle.methodId && !isDefaultBiddingMethod(cycle.methodId) ? (
                <Chip tone="brand">METHOD GATE PENDING</Chip>
              ) : null}
              {cycle.method.approvalRef ? <Chip tone="muted">{cycle.method.approvalRef}</Chip> : null}
            </div>
            {cycle.method.legalBasis ? <p className="text-[11px] text-ink-500">{cycle.method.legalBasis}</p> : null}
            {cycle.method.when ? <p className="text-[11.5px] text-ink-600">{cycle.method.when}</p> : null}
            {cycle.method.valueBand ? (
              <p className="font-code text-[10px] tracking-[0.06em] text-ink-600">Value band · {cycle.method.valueBand}</p>
            ) : null}
            {cycle.method.justification ? (
              <p className="text-[11.5px] text-ink-600">Justification: {cycle.method.justification}</p>
            ) : null}
            {cycle.method.block ? (
              <p className="text-[11px] text-amber-700 dark:text-amber-300">{cycle.method.block}</p>
            ) : null}
          </div>
        ) : (
          <p className="mb-3 text-[12px] text-ink-500">
            No method is recorded — an award cannot rest on an unstated route.
          </p>
        )}
        <div className="grid gap-1.5">
          <label htmlFor="cycle-method-selection" className="eyebrow">PROCUREMENT METHOD</label>
          {methodsStatus === "ready" ? (
            <p id="cycle-method-options" className="text-[11px] leading-relaxed text-ink-600 dark:text-ink-400">
              {methods.length} methods in the Zambia legal register, grouped by competition type.
            </p>
          ) : null}
          <select
            id="cycle-method-selection"
            className={inputCls}
            aria-label="Procurement method"
            value={methodRecordSelectionId}
            aria-describedby={showMethodRecordGuidance ? "cycle-method-options cycle-method-selection-guidance" : methodsStatus === "ready" ? "cycle-method-options" : undefined}
            disabled={methodsStatus !== "ready"}
            onChange={(e) => set("methodPick", e.target.value)}
          >
            {methodsStatus === "ready" ? (
              methodGroups.map(([group, groupMethods]) => (
                <optgroup key={group} label={group}>
                  {groupMethods.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </optgroup>
              ))
            ) : (
              <option value={canonicalMethodId(d.methodPick ?? cycle.methodId)}>
                {methodsStatus === "loading" ? "Loading procurement methods…" : "Method register unavailable"}
              </option>
            )}
          </select>
          {showMethodRecordGuidance ? (
            <p id="cycle-method-selection-guidance" className="text-[11px] leading-relaxed text-ink-600 dark:text-ink-400">
              <span className="font-semibold">Selected: {methodRecordSelection?.name}.</span> {methodRecordSelection?.when}
            </p>
          ) : null}
          {methodsStatus !== "ready" ? (
            <p role="status" className="text-[10.5px] leading-relaxed text-ink-500">
              {methodsStatus === "loading"
                ? "Loading the complete legal-method list."
                : "The method register is unavailable; a procurement method cannot be recorded yet."}
            </p>
          ) : null}
          {!isDefaultBiddingMethod(d.methodPick ?? cycle.methodId) ? (
            <div className="grid gap-2.5 rounded-xl border border-ink-100 bg-paper/60 p-3 dark:border-white/[0.08] dark:bg-white/[0.02]">
              <Field label="RESTRICTED METHOD JUSTIFICATION" hint="Required · minimum 20 characters · name the statutory ground">
                <textarea
                  className={cn(inputCls, "h-16 py-2")}
                  placeholder="Explain why competition was restricted"
                  value={d.methodJust ?? ""}
                  aria-required="true"
                  onChange={(e) => set("methodJust", e.target.value)}
                />
              </Field>
              <Field label="AUTHORITY APPROVAL REFERENCE" hint="Required when the selected method or value band needs prior approval">
                <input
                  className={inputCls}
                  placeholder="Enter the approval reference"
                  value={d.methodRef ?? ""}
                  onChange={(e) => set("methodRef", e.target.value)}
                />
              </Field>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <Field label="ESTIMATED PROCUREMENT VALUE" hint="Optional · checked against the winning bid before award">
              <input
                className={inputCls}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="Enter an amount"
                value={d.methodValue ?? ""}
                onChange={(e) => set("methodValue", e.target.value)}
              />
            </Field>
            <Btn variant="ghost" onClick={recordMethod} disabled={busy || !ref || methodsStatus !== "ready"}>
              <Scale className="h-3.5 w-3.5" aria-hidden="true" /> Record method
            </Btn>
          </div>
        </div>
      </Card>

      <Card
        title="Supplier assurance"
        sub="REGISTRY · TAX · BENEFICIAL OWNERSHIP · SANCTIONS/PEP — A CHECK WITH A SOURCE AND AN EXPIRY"
        workflow
        busy={busy}
        actionLabel="Record the supplier assurance check"
        teaser={
          cycle.assurance?.status === "UNVERIFIED" || !cycle.assurance
            ? "No assurance check on record — the entity that would sign this contract has not been tested against the registry, tax and sanctions registers."
            : `${cycle.assurance.status} · registry ${cycle.assurance.verification?.registryStatus ?? "not read"} · tax ${cycle.assurance.verification?.taxStatus ?? "not read"} · checked ${fmtDate(cycle.assurance.verification?.checkedAt)}`
        }
      >
        {cycle.assurance ? (
          <div className="mb-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={cycle.assurance.status === "VERIFIED" ? "ok" : "warn"}>{cycle.assurance.status}</Chip>
              <span className="font-code text-[10px] tracking-[0.12em] text-ink-500">
                {cycle.assurance.expectedSupplier.toUpperCase()}
              </span>
              {cycle.assurance.verification ? (
                <Chip tone="muted">{cycle.assurance.verification.source.replace(/_/g, " ")}</Chip>
              ) : null}
            </div>
            {cycle.assurance.verification ? (
              <>
                <p className="text-[10px] leading-relaxed text-ink-600">
                  Checked {fmtDate(cycle.assurance.verification.checkedAt)} by {cycle.assurance.verification.checkedBy} · expires {fmtDate(cycle.assurance.verification.expiresAt)}
                </p>
                <ul className="space-y-1 text-[12px] text-ink-600">
                  <li>
                    Registry: {cycle.assurance.verification.registryStatus.replace(/_/g, " ")} · tax:{" "}
                    {cycle.assurance.verification.taxStatus} · sanctions: {cycle.assurance.verification.sanctions}
                    {cycle.assurance.verification.sanctionsMatches?.length
                      ? ` (${cycle.assurance.verification.sanctionsMatches.join("; ")})`
                      : ""}{" "}
                    · PEP: {cycle.assurance.verification.pep}
                    {cycle.assurance.verification.pepMatches?.length
                      ? ` (${cycle.assurance.verification.pepMatches.join("; ")})`
                      : ""}
                  </li>
                  <li>
                    Beneficial owners:{" "}
                    {cycle.assurance.verification.beneficialOwners.length
                      ? cycle.assurance.verification.beneficialOwners
                          .map((o) => `${o.name}${o.ownershipPct !== undefined ? ` (${o.ownershipPct}%)` : ""}`)
                          .join(", ")
                      : "none collected"}
                  </li>
                  <li>
                    Documents:{" "}
                    {cycle.assurance.verification.documents.length
                      ? cycle.assurance.verification.documents
                          .map((doc) => `${doc.kind}${doc.reference ? ` ${doc.reference}` : ""}`)
                          .join(" · ")
                      : "none attached"}
                  </li>
                </ul>
                {cycle.assurance.failures.length ? (
                  <ul className="list-disc space-y-1 pl-4 text-[11.5px] text-amber-700 dark:text-amber-300">
                    {cycle.assurance.failures.map((failure, i) => (
                      <li key={i}>{failure}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className="text-[12px] text-ink-500">No assurance check is on record for this bidder.</p>
            )}
          </div>
        ) : (
          <p className="mb-3 text-[12px] text-ink-500">No winner is recommended yet.</p>
        )}
        {cycle.assurance?.supplierId ? (
          <AssuranceCheckForm onSubmit={recordAssurance} busy={busy} onToast={onToast} />
        ) : cycle.assurance ? (
          <p className="text-[11.5px] text-amber-700 dark:text-amber-300">
            The recommended bidder is not on the supplier register — add and verify the supplier before the award can proceed.
          </p>
        ) : null}
      </Card>

      <Card title="Award recommendation report" sub="THE STATUTORY REPORT — FINDINGS, MATRIX, RECOMMENDATION, SIGNATURES" workflow busy={busy} actionLabel="Manage award report" teaser={cycle.awardReport?.signedAt ? `Signed ${fmtDate(cycle.awardReport.signedAt)} by ${cycle.awardReport.signedBy ?? "the accounting officer"} · recommendation: ${cycle.awardReport.recommendation ?? "not stated"}` : "Not signed — the report is the document the accounting officer signs, and nothing downstream opens without that signature."}>
        {cycle.awardReport ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {cycle.awardReport.signedAt ? <Chip tone="ok">SIGNED BY {cycle.awardReport.signedBy?.toUpperCase()}</Chip> : <Chip tone="brand">AWAITING SIGNATURE GATE</Chip>}
              {cycle.awardReport.recommendation ? <Chip tone="muted">{cycle.awardReport.recommendation.toUpperCase()}</Chip> : null}
            </div>
            <p className="break-all font-mono text-[10px] leading-relaxed text-ink-600">SHA-256 · {cycle.awardReport.sha}</p>
            {!cycle.awardReport.signedAt ? (
              <Btn variant="ghost" onClick={draftAwardReport} disabled={busy || !ref}>
                <FileSignature className="h-3.5 w-3.5" aria-hidden="true" /> Re-draft with current dispositions
              </Btn>
            ) : null}
          </div>
        ) : (
          <Btn onClick={draftAwardReport} disabled={busy || !ref}>
            <FileSignature className="h-3.5 w-3.5" aria-hidden="true" /> Draft the award report
          </Btn>
        )}
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-400">
          The report composes from the certified matrix and the run's findings. The accounting officer signs at the gate; publication follows.
        </p>
      </Card>

      <Card title="Debrief letters" sub="QUALITATIVE DEBRIEFS FOR EVERY UNSUCCESSFUL BIDDER — DRAFTED FROM THEIR OWN RECORD" workflow busy={busy} actionLabel="Manage debriefs" teaser={`${count(cycle.debriefs.filter((d) => d.status === "ISSUED").length, "debrief issued")} of ${count(cycle.debriefs.length, "unsuccessful bidder")} · a bidder without a debrief has a finding against the file`}>
        {cycle.debriefs.length === 0 ? (
          <div className="space-y-2">
            <p className="text-[11.5px] text-ink-400">Draft from the matrix's unsuccessful bidders:</p>
            <div className="flex flex-wrap gap-2">
              {(cycle.matrix?.bids ?? [])
                .filter((b) => b.verdict !== "RECOMMENDED")
                .map((b) => (
                  <Btn key={b.bidder} variant="ghost" onClick={() => draftDebrief(b.bidder)} disabled={busy}>
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {b.bidder}
                  </Btn>
                ))}
            </div>
          </div>
        ) : (
          <ul className="space-y-2">
            {cycle.debriefs.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 rounded-xl border border-ink-100 bg-paper px-3 py-2.5">
                <span className="text-[13px] font-semibold text-ink-900">{l.bidder}</span>
                {l.status === "ISSUED" ? <Chip tone="ok">ISSUED</Chip> : <Btn variant="ghost" onClick={() => issueDebrief(l.id)} disabled={busy}>Issue (gate)</Btn>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {dissentCard(
        "AWARD_REPORT",
        "Minority positions — the award recommendation",
        "A MEMBER WHO DISAGREES WITH THE RECOMMENDATION SAYS SO HERE, BEFORE THE OFFICER SIGNS",
      )}
      </div>
    </div>
  ) : null;

  /* ── Stage: standstill — notice publication and review window ─────────────── */

  const StandstillTab = cycle ? (
    <div className="grid gap-4 lg:grid-cols-2">
      <StageBrief span {...STAGE_BRIEFS.standstill} />
      <Card
        title="Award notice and standstill"
        sub="PUBLICATION OPENS THE STATUTORY REVIEW WINDOW"
        workflow
        busy={busy}
        actionLabel="Manage notice"
        teaser={
          `${cycle.awardNotice?.publishedAt ? `Published ${fmtDate(cycle.awardNotice.publishedAt)} on ${cycle.awardNotice.portal}` : "Not yet published — the review clock has not started"} · standstill ${cycle.standstill ? `${cycle.standstill.status.toLowerCase()} · ${count(cycle.standstill.days, "working day", "working days")}` : "not opened"}`
        }
      >
        {cycle.standstill ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={cycle.standstill.status === "ACTIVE" ? "brand" : "muted"}>STANDSTILL {cycle.standstill.status}</Chip>
              <span className="font-code text-[10px] tracking-[0.12em] text-ink-500">
                ENDS {fmtDate(cycle.standstill.endsAt)} · {cycle.standstill.days} WORKING DAYS
              </span>
            </div>
            {cycle.awardNotice?.publishedAt ? (
              <p className="text-[10px] leading-relaxed text-ink-600">
                Published {fmtDate(cycle.awardNotice.publishedAt)} · {cycle.awardNotice.portal}
              </p>
            ) : null}
            {cycle.standstill.status === "ACTIVE" ? (
              <Btn
                variant="ghost"
                onClick={() => act(`/api/tenders/${ref}/standstill/lift`, {}, "STANDSTILL LAPSE APPROVAL GATE RAISED").then((ok) => ok && refreshCycle())}
                disabled={busy || new Date(cycle.standstill.endsAt).getTime() > Date.now() || cycle.complaints.some((c) => c.status === "OPEN" || c.status === "ESCALATED")}
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" /> Mark elapsed (approval gate)
              </Btn>
            ) : (
              <p className="text-[11.5px] leading-relaxed text-ink-500">The review window is recorded as elapsed. Contract signing still checks the statutory end time and open complaints.</p>
            )}
          </div>
        ) : cycle.awardNotice?.publishedAt ? (
          <div className="space-y-3">
            <Chip tone="ok">AWARD NOTICE PUBLISHED · {cycle.awardNotice.portal}</Chip>
            <p className="text-[11.5px] leading-relaxed text-ink-500">Dispatch recorded {fmtDateTime(cycle.awardNotice.dispatchedAt)} to {(cycle.awardNotice.dispatchedTo ?? []).length} bidders. Evidence: {cycle.awardNotice.dispatchEvidenceRef ?? "—"}.</p>
            {cycle.awardNotice.standstillExemptReason ? <p className="text-[11.5px] text-ink-500">No standstill applies: {cycle.awardNotice.standstillExemptReason}</p> : null}
          </div>
        ) : cycle.awardNotice ? (
          <div className="space-y-3">
            <Chip tone="brand">NOTICE DRAFTED · PUBLICATION GATE PENDING</Chip>
            <p className="text-[11.5px] leading-relaxed text-ink-500">Award report signed. The notice must be sent to every bidder; the dispatch evidence is staged for the accounting officer gate.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[12px] leading-relaxed text-ink-500">
              The notice includes the winning value. Enter the portal or messaging delivery evidence reference for dispatch to every bidder.
            </p>
            <Field label="BIDDER DISPATCH EVIDENCE REFERENCE" hint="portal receipt, email batch ID or equivalent delivery record">
              <input className={inputCls} value={d.awardDispatchRef ?? ""} onChange={(e) => set("awardDispatchRef", e.target.value)} placeholder="e.g. ZPPA dispatch receipt" />
            </Field>
            <Btn onClick={publishNotice} disabled={busy || !ref || !cycle.awardReport?.signedAt || !(d.awardDispatchRef ?? "").trim()}>
              <Stamp className="h-3.5 w-3.5" aria-hidden="true" /> Publish the notice of award
            </Btn>
            {!cycle.awardReport?.signedAt ? <p className="text-[10.5px] text-ink-600">Awaiting the signed award report.</p> : null}
          </div>
        )}
      </Card>

      <Card title="Review window" sub="THE CLOCK AND COMPLAINTS THAT HOLD THE CONTRACT" workflow busy={busy} actionLabel="Review standstill status" teaser={
        cycle.standstill
          ? `Ends ${fmtDate(cycle.standstill.endsAt)} · ${
              cycle.complaints.filter((c) => c.status === "OPEN" || c.status === "ESCALATED").length === 0
                ? "no live complaint — the lift is clean"
                : `${count(cycle.complaints.filter((c) => c.status === "OPEN" || c.status === "ESCALATED").length, "live complaint")} holding the contract and the payment`
            }`
          : "Not started — the window opens when the award notice is published, not when the decision is signed."
      }>
        {cycle.standstill ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-ink-100 bg-paper px-3 py-3">
                <p className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-600">Window</p>
                <p className="mt-1.5 text-[15px] font-semibold text-ink-900">{cycle.standstill.days} working days</p>
              </div>
              <div className="rounded-xl border border-ink-100 bg-paper px-3 py-3">
                <p className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-600">Ends</p>
                <p className="mt-1.5 text-[15px] font-semibold text-ink-900">{fmtDate(cycle.standstill.endsAt)}</p>
              </div>
            </div>
            <p className="text-[11.5px] leading-relaxed text-ink-500">
              {cycle.standstill.status === "ACTIVE"
                ? "Keep the contract on hold while the review window is active or any complaint remains unresolved."
                : "The standstill is lifted. Keep the notice and complaint record with the award file."}
            </p>
            {cycle.complaints.some((complaint) => complaint.status === "OPEN" || complaint.status === "ESCALATED") ? (
              <Chip tone="warn">OPEN COMPLAINT · CONTRACT REMAINS ON HOLD</Chip>
            ) : null}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-ink-200 px-4 py-7 text-center dark:border-white/[0.12]">
            <p className="text-[12px] font-semibold text-ink-700">Standstill has not started</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">Publish the signed award notice to begin the review window.</p>
          </div>
        )}
      </Card>
    </div>
  ) : null;

  /* ── Tab: contract (G12/G13) ─────────────────────────────────────────────── */

  const preparePack = () =>
    act(
      `/api/tenders/${ref}/contract/pack`,
      {
        budgetLineId: d.budgetLine || budgetLines[0]?.id,
        retentionPct: d.retentionPct ? Number(d.retentionPct) : undefined,
      },
      "CONTRACT PACK PREPARED — ACCOUNTING OFFICER GATE RAISED",
    ).then((ok) => ok && refreshCycle());
  const createBudgetLine = () =>
    act(
      "/api/budget-lines",
      {
        fiscalYear: Number(d.budYear) || new Date().getFullYear(),
        code: d.budCode,
        currency: d.budCurrency || "ZMW",
        approved: Number(d.budApproved),
      },
      "BUDGET LINE ON THE REGISTER",
    ).then((ok) => ok && refreshCycle());
  const executeContract = () =>
    act(
      `/api/tenders/${ref}/contract/execute`,
      {
        retentionPct: d.retentionPct ? Number(d.retentionPct) : undefined,
        performanceSecurity: {
          amount: Number(d.secAmount),
          issuer: d.secIssuer,
          validUntil: d.secValid,
        },
        insurance: {
          policyNo: d.insPolicy,
          issuer: d.insIssuer,
          validUntil: d.insValid,
        },
      },
      "CONTRACT EXECUTION GATE RAISED",
    ).then((ok) => ok && refreshCycle());
  const addMilestone = () =>
    act(`/api/tenders/${ref}/contract/milestones`, { title: d.milTitle, dueDate: d.milDue || undefined }, "MILESTONE ADDED").then(
      (ok) => ok && (setD((p) => ({ ...p, milTitle: "", milDue: "" })), refreshCycle()),
    );
  const addVariation = () =>
    act(`/api/tenders/${ref}/contract/variations`, {
      description: d.varDesc,
      valueDelta: Number(d.varDelta),
      legalAdviceRef: d.varAdvice,
      approvalReference: d.varApproval,
    }, "VARIATION APPROVAL GATE RAISED").then(
      (ok) => ok && (setD((p) => ({ ...p, varDesc: "", varDelta: "", varAdvice: "", varApproval: "" })), refreshCycle()),
    );
  const addPayment = () =>
    act(
      `/api/tenders/${ref}/contract/payments`,
      {
        description: d.payDesc,
        amount: Number(d.payAmount),
        invoiceId: d.payInvoice,
        milestoneId: d.payMilestone,
        goodsReceiptId: d.payGrn,
        withholding: d.payWithholding ? Number(d.payWithholding) : undefined,
      },
      "PAYMENT CERTIFICATION GATE RAISED",
    ).then((ok) => ok && (setD((p) => ({ ...p, payDesc: "", payAmount: "" })), refreshCycle()));

  const ContractTab = cycle ? (
    cycle.contract ? (
      <div className="grid gap-4 lg:grid-cols-2">
        <StageBrief span {...STAGE_BRIEFS.contract} />
        <Card
          title={`Contract — ${cycle.contract.supplier}`}
          sub={`${cycle.contract.currency ?? ""} ${fmtMoney(cycle.contract.value)} · ${cycle.contract.completedAt ? "COMPLETED" : cycle.contract.status ?? "LEGACY_UNEXECUTED"}`}
          workflow
          busy={busy}
          actionLabel="Manage contract"
          teaser={`${cycle.contract.executedAt ? `Executed ${fmtDate(cycle.contract.executedAt)}` : "Not executed"} · security ${cycle.contract.security ? `${fmtMoney(cycle.contract.security.amount)} with ${cycle.contract.security.issuer}` : "not on record"} · retention ${cycle.contract.retentionPct !== undefined ? `${cycle.contract.retentionPct}%` : "not set"} · ${count((cycle.contract.payments ?? []).length, "payment")} certified`}
        >
          {(() => {
            const liveComplaints = cycle.complaints.filter((c) => c.status === "OPEN" || c.status === "ESCALATED");
            return liveComplaints.length ? (
              <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                <span className="font-semibold uppercase tracking-[0.12em]">Contract and payment suspended</span> — {liveComplaints.length}{" "}
                live complaint{liveComplaints.length === 1 ? "" : "s"}: {liveComplaints.map((c) => c.id).join(", ")}. Answer, independently review or close each one.
              </div>
            ) : null;
          })()}
          <ul className="space-y-1.5 text-[12.5px] text-ink-600">
            <li>Status: <span className="font-semibold text-ink-900">{cycle.contract.status ?? "LEGACY_UNEXECUTED — cannot pay"}</span>{cycle.contract.executedAt ? ` · executed ${fmtDate(cycle.contract.executedAt)}` : ""}</li>
            <li>Supplier acceptance: {cycle.contract.supplierAcceptedAt ? `${fmtDate(cycle.contract.supplierAcceptedAt)} · ${cycle.contract.supplierSignatory ?? "—"}` : <span className="font-semibold text-amber-700 dark:text-amber-300">not recorded</span>}</li>
            <li>
              Performance security:{" "}
              {cycle.contract.security || (cycle.contract.performanceSecurity?.length ?? 0) > 0 ? (
                <>
                  {cycle.contract.security
                    ? `${fmtMoney(cycle.contract.security.amount)} · declared at execution · valid to ${fmtDate(cycle.contract.security.validUntil)}`
                    : "none declared at execution"}
                  {cycle.contract.performanceSecurity?.length
                    ? ` · ${cycle.contract.performanceSecurity.length} instrument${cycle.contract.performanceSecurity.length === 1 ? "" : "s"} on the register`
                    : ""}
                </>
              ) : (
                <span className="font-semibold text-amber-700 dark:text-amber-300">none</span>
              )}
            </li>
            <li>Insurance: {cycle.contract.insurance ? `${cycle.contract.insurance.policyNo} · valid to ${fmtDate(cycle.contract.insurance.validUntil)}` : <span className="font-semibold text-amber-700 dark:text-amber-300">none</span>}</li>
            <li>Retention: {cycle.contract.retentionPct ?? 0}% · warranty {cycle.contract.warrantyDays ?? 0} days · variation cap 25% cumulative.</li>
            <li>Payments certify at a named gate, inside the contract value and the three-way match.</li>
          </ul>
          {cycle.contract.status !== "EXECUTED" && cycle.contract.status !== "COMPLETED" && !cycle.contract.completedAt ? (
            <div className="mt-3 space-y-2 rounded-xl border border-dashed border-ink-200 p-3">
              <p className="font-code text-[10px] font-semibold tracking-[0.06em] text-ink-600">Execution · supplier acceptance, bond, and insurance</p>
              <div className="grid gap-1.5 sm:grid-cols-3">
                <input className={inputCls} aria-label="Performance security amount" type="number" placeholder="Security amount" value={d.secAmount ?? ""} onChange={(e) => set("secAmount", e.target.value)} />
                <input className={inputCls} aria-label="Performance security issuer" placeholder="Security issuer" value={d.secIssuer ?? ""} onChange={(e) => set("secIssuer", e.target.value)} />
                <input className={inputCls} aria-label="Performance security valid until" type="date" value={d.secValid ?? ""} onChange={(e) => set("secValid", e.target.value)} />
                <input className={inputCls} aria-label="Insurance policy number" placeholder="Insurance policy no." value={d.insPolicy ?? ""} onChange={(e) => set("insPolicy", e.target.value)} />
                <input className={inputCls} aria-label="Insurer name" placeholder="Insurer" value={d.insIssuer ?? ""} onChange={(e) => set("insIssuer", e.target.value)} />
                <input className={inputCls} aria-label="Insurance valid until" type="date" value={d.insValid ?? ""} onChange={(e) => set("insValid", e.target.value)} />
              </div>
              <Btn variant="ghost" onClick={executeContract} disabled={busy || !d.secAmount || !d.secIssuer || !d.secValid || !d.insPolicy || !d.insIssuer || !d.insValid}>
                <Stamp className="h-3.5 w-3.5" aria-hidden="true" /> Execute the contract (gate)
              </Btn>
            </div>
          ) : null}
        </Card>

        <Card title="Milestones" sub={`${cycle.contract.milestones.length} ON THE SCHEDULE`} workflow busy={busy} actionLabel="Manage milestones" teaser={`${count(cycle.contract.milestones.filter((m) => m.status === "DONE").length, "milestone")} complete of ${count(cycle.contract.milestones.length, "milestone")} · payments are certified against a completed milestone, never against a promise`}>
          <ul className="space-y-1.5">
            {cycle.contract.milestones.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 rounded-lg bg-paper px-2.5 py-2 text-[12.5px]">
                <span className="text-ink-800">
                  {m.title}
                  {m.dueDate ? <span className="text-ink-400"> · due {fmtDate(m.dueDate)} · {relDays(m.dueDate).toUpperCase()}</span> : null}
                </span>
                {m.status === "DONE" ? (
                  <Chip tone="ok">DONE</Chip>
                ) : (
                  <Btn variant="ghost" onClick={() => act(`/api/tenders/${ref}/contract/milestones/${m.id}/done`, {}, "MILESTONE DONE").then((ok) => ok && refreshCycle())} disabled={busy}>
                    Mark done
                  </Btn>
                )}
              </li>
            ))}
            {cycle.contract.milestones.length === 0 ? <li className="py-3 text-center text-[12px] text-ink-400">No milestones yet.</li> : null}
          </ul>
          <div className="mt-3 grid grid-cols-[2fr_1fr_auto] gap-1.5">
            <input className={inputCls} aria-label="Milestone title" placeholder="Milestone" value={d.milTitle ?? ""} onChange={(e) => set("milTitle", e.target.value)} />
            <input className={inputCls} aria-label="Milestone due date" type="date" value={d.milDue ?? ""} onChange={(e) => set("milDue", e.target.value)} />
            <Btn variant="ghost" onClick={addMilestone} disabled={busy || !d.milTitle}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </Btn>
          </div>
        </Card>

        <Card title="Variations" sub="PRIOR APPROVAL + ATTORNEY-GENERAL ADVICE · 25% CUMULATIVE INCREASE CAP" workflow busy={busy} actionLabel="Manage variations" teaser={`${count(cycle.contract.variations.length, "variation")} · cumulative approved increase is subject to the statutory 25% cap · every variation goes to the approval gate`}>
          <ul className="space-y-1.5">
            {cycle.contract.variations.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 rounded-lg bg-paper px-2.5 py-2 text-[12.5px]">
                <span className="min-w-0 truncate text-ink-800">
                  {v.description}{" "}
                  <span className="text-ink-400">
                    · {v.pctOfContract}% · {v.valueDelta > 0 ? "+" : ""}
                    {fmtMoney(v.valueDelta)}
                    {v.cumulativePct !== undefined ? ` · cumulative ${v.cumulativePct}% / 25%` : ""}
                  </span>
                </span>
                {v.status === "APPROVED" ? <Chip tone="ok">APPROVED</Chip> : v.status === "REJECTED" ? <Chip tone="muted">REJECTED</Chip> : <Chip tone="warn">AT GATE</Chip>}
              </li>
            ))}
            {cycle.contract.variations.length === 0 ? <li className="py-3 text-center text-[12px] text-ink-400">No variations.</li> : null}
          </ul>
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
            <input className={inputCls} aria-label="Variation description" placeholder="Variation description" value={d.varDesc ?? ""} onChange={(e) => set("varDesc", e.target.value)} />
            <input className={inputCls} aria-label="Variation value change" type="number" placeholder="± value" value={d.varDelta ?? ""} onChange={(e) => set("varDelta", e.target.value)} />
            <input className={inputCls} aria-label="Attorney-General legal advice reference" placeholder="Attorney-General legal advice reference" value={d.varAdvice ?? ""} onChange={(e) => set("varAdvice", e.target.value)} />
            <input className={inputCls} aria-label="Variation approving authority reference" placeholder="Approving authority reference" value={d.varApproval ?? ""} onChange={(e) => set("varApproval", e.target.value)} />
            <div className="sm:col-span-2">
              <Btn variant="ghost" onClick={addVariation} disabled={busy || !d.varDesc || !d.varDelta || !d.varAdvice || !d.varApproval}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Request approval
              </Btn>
            </div>
          </div>
        </Card>

        <Card
          title="Payments"
          sub="THREE-WAY MATCH · RETENTION · CAP — CERTIFY BEFORE IT LEAVES THE DESK"
          workflow
          busy={busy}
          actionLabel="Manage payments"
          teaser={`${count((cycle.contract.payments ?? []).length, "payment")} on the register · ${fmtMoney((cycle.contract.payments ?? []).reduce((sum, p) => sum + (p.net ?? p.amount), 0))} ${cycle.contract.currency ?? ""} net of retention · contract ceiling ${fmtMoney(cycle.contract.value)}`}
        >
          <ul className="space-y-1.5">
            {cycle.contract.payments.map((p) => (
              <li key={p.id} className="rounded-lg bg-paper px-2.5 py-2 text-[12.5px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-ink-800">
                    {p.description}{" "}
                    <span className="text-ink-400">
                      · gross {fmtMoney(p.gross ?? p.amount)}
                      {p.retention ? ` · retention ${fmtMoney(p.retention)}` : ""}
                      {p.net !== undefined ? ` · net ${fmtMoney(p.net)}` : ""}
                    </span>
                  </span>
                  {p.status === "CERTIFIED" || p.certifiedAt ? <Chip tone="ok">CERTIFIED</Chip> : <Chip tone="warn">AT GATE</Chip>}
                </div>
                <p className="text-[10px] leading-relaxed text-ink-600">
                  {p.invoiceId ? `Invoice ${p.invoiceId} · ` : ""}
                  {p.milestoneId ? `Milestone ${p.milestoneId} · ` : ""}
                  {p.goodsReceiptId ? `GRN ${p.goodsReceiptId}` : ""}
                </p>
              </li>
            ))}
            {cycle.contract.payments.length === 0 ? <li className="py-3 text-center text-[12px] text-ink-400">No payments raised.</li> : null}
          </ul>
          {cycle.contract.payments.length > 0 ? (
            <p className="mt-2 text-[10px] leading-relaxed text-ink-600">
              Cumulative gross {fmtMoney(cycle.contract.payments.reduce((s, p) => s + (p.gross ?? p.amount), 0))} · net{" "}
              {fmtMoney(cycle.contract.payments.reduce((s, p) => s + (p.net ?? p.amount), 0))} · RETENTION{" "}
              {fmtMoney(cycle.contract.payments.reduce((s, p) => s + (p.retention ?? 0), 0))} · CONTRACT {fmtMoney(cycle.contract.value)}
            </p>
          ) : null}
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
            <input className={inputCls} aria-label="Payment description" placeholder="Payment description" value={d.payDesc ?? ""} onChange={(e) => set("payDesc", e.target.value)} />
            <input className={inputCls} aria-label="Payment gross amount" type="number" placeholder="Gross amount" value={d.payAmount ?? ""} onChange={(e) => set("payAmount", e.target.value)} />
            <input className={inputCls} aria-label="Invoice number" placeholder="Invoice no." value={d.payInvoice ?? ""} onChange={(e) => set("payInvoice", e.target.value)} />
            <select className={inputCls} aria-label="Accepted milestone for payment" value={d.payMilestone ?? ""} onChange={(e) => set("payMilestone", e.target.value)}>
              <option value="">Accepted milestone…</option>
              {cycle.contract.milestones.map((m) => (
                <option key={m.id} value={m.id} disabled={m.status !== "DONE"}>
                  {m.title}{m.status === "DONE" ? "" : " (not accepted)"}
                </option>
              ))}
            </select>
            <input className={inputCls} aria-label="Goods receipt note number" placeholder="Goods receipt (GRN)" value={d.payGrn ?? ""} onChange={(e) => set("payGrn", e.target.value)} />
            <input className={inputCls} aria-label="Payment withholding amount" type="number" placeholder="Withholding" value={d.payWithholding ?? ""} onChange={(e) => set("payWithholding", e.target.value)} />
            <Btn
              variant="ghost"
              onClick={addPayment}
              disabled={busy || !d.payDesc || !d.payAmount || !d.payInvoice || !d.payMilestone || !d.payGrn}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Raise payment
            </Btn>
          </div>
        </Card>
        {(() => {
          const contract = cycle.contract;
          if (!contract) return null;
          const register = contract.performanceSecurity ?? [];
          return (
            <Card
              className="lg:col-span-2"
              title="Performance security"
              sub="THE INSTRUMENTS HELD AGAINST THE CONTRACT — RECEIPT AND VERIFICATION ARE SEPARATE ACTS"
              right={
                register.length
                  ? <Chip tone="ok">{register.length} ON THE REGISTER</Chip>
                  : <Chip tone="warn">NONE RECEIVED</Chip>
              }
            >
              <div className="space-y-2">
                {contract.security ? (
                  <div className="rounded-xl border border-ink-100 bg-paper px-3 py-2.5 text-[12px] dark:border-white/[0.08]">
                    <p className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-600">Declared at execution</p>
                    <p className="mt-1 text-ink-700">
                      {fmtMoney(contract.security.amount)} · {contract.security.issuer || "issuer not stated"} · valid to {fmtDate(contract.security.validUntil)}
                    </p>
                  </div>
                ) : (
                  <p className="text-[11.5px] leading-relaxed text-ink-400">
                    No security was declared when the contract was executed. Record what was actually received below — the declared figure and the instruments held are two different facts on this file.
                  </p>
                )}

                <ul className="space-y-1.5">
                  {register.map((s) => (
                    <li key={s.id} className="rounded-lg border border-ink-100 bg-paper px-2.5 py-2 text-[12px] dark:border-white/[0.07]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 text-ink-800">
                          {s.instrument.replace(/_/g, " ")} · {s.currency ?? contract.currency ?? ""} {fmtMoney(s.amount)}
                          <span className="text-ink-400">
                            {s.provider ? ` · ${s.provider}` : ""}
                            {s.reference ? ` · ${s.reference}` : ""}
                          </span>
                        </span>
                        {s.verifiedAt ? (
                          <Chip tone="ok">VERIFIED{s.verifiedBy ? ` · ${s.verifiedBy}` : ""}</Chip>
                        ) : (
                          <div className="flex items-end gap-1.5">
                            <input
                              className={cn(inputCls, "h-11 w-44 text-[12.5px]")}
                              aria-label={`Officer verifying ${s.instrument.replace(/_/g, " ")} ${s.reference ?? ""}`}
                              placeholder="Verifying officer"
                              value={d[`sec-${s.id}-by`] ?? ""}
                              onChange={(e) => set(`sec-${s.id}-by`, e.target.value)}
                            />
                            <Btn
                              variant="ghost"
                              className="h-11"
                              onClick={() =>
                                act(
                                  `/api/tenders/${ref}/contract/security/${s.id}/verify`,
                                  { actor: d[`sec-${s.id}-by`] },
                                  "SECURITY VERIFIED — THE NAME IS ON THE RECORD",
                                ).then((ok) => ok && refreshCycle())
                              }
                              disabled={busy || !ref || !(d[`sec-${s.id}-by`] ?? "").trim()}
                            >
                              Verify
                            </Btn>
                          </div>
                        )}
                      </div>
                      <p className="mt-1 text-[10.5px] leading-relaxed text-ink-600">
                        Received {fmtDate(s.receivedAt)}
                        {s.validUntil ? ` · Valid to ${fmtDate(s.validUntil)}` : " · No expiry on record"}
                      </p>
                    </li>
                  ))}
                  {register.length ? null : (
                    <li className="py-2 text-[11.5px] text-ink-400">No instrument has been received against this contract.</li>
                  )}
                </ul>

                <div className="grid gap-1.5 border-t border-ink-100 pt-2.5 sm:grid-cols-2 dark:border-white/[0.06]">
                  <Field label="INSTRUMENT">
                    <select className={inputCls} value={d.secInstrument ?? "BANK_GUARANTEE"} onChange={(e) => set("secInstrument", e.target.value)}>
                      <option value="BANK_GUARANTEE">Bank guarantee</option>
                      <option value="INSURANCE_BOND">Insurance bond</option>
                      <option value="CASH_DEPOSIT">Cash deposit</option>
                      <option value="OTHER">Other instrument</option>
                    </select>
                  </Field>
                  <Field label="AMOUNT">
                    <input className={inputCls} type="number" placeholder="e.g. 4800000" value={d.secRegAmount ?? ""} onChange={(e) => set("secRegAmount", e.target.value)} />
                  </Field>
                  <Field label="ISSUER / PROVIDER">
                    <input className={inputCls} placeholder="Bank or insurer" value={d.secRegProvider ?? ""} onChange={(e) => set("secRegProvider", e.target.value)} />
                  </Field>
                  <Field label="REFERENCE">
                    <input className={inputCls} placeholder="Guarantee or bond number" value={d.secRegRef ?? ""} onChange={(e) => set("secRegRef", e.target.value)} />
                  </Field>
                  <Field label="VALID UNTIL">
                    <input className={inputCls} type="date" value={d.secRegValid ?? ""} onChange={(e) => set("secRegValid", e.target.value)} />
                  </Field>
                  <Field label="CURRENCY">
                    <input className={inputCls} placeholder={contract.currency ?? "ZMW"} value={d.secRegCurrency ?? ""} onChange={(e) => set("secRegCurrency", e.target.value)} />
                  </Field>
                </div>
                <Btn
                  variant="ghost"
                  onClick={() =>
                    act(
                      `/api/tenders/${ref}/contract/security`,
                      {
                        instrument: d.secInstrument || "BANK_GUARANTEE",
                        amount: Number(d.secRegAmount),
                        currency: d.secRegCurrency || contract.currency || undefined,
                        provider: d.secRegProvider || undefined,
                        reference: d.secRegRef || undefined,
                        validUntil: d.secRegValid || undefined,
                      },
                      "SECURITY RECEIVED — RECORD THE OFFICER WHO VERIFIED IT",
                    ).then((ok) => ok && refreshCycle())
                  }
                  disabled={busy || !ref || !(Number(d.secRegAmount) > 0)}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Record a security received
                </Btn>
              </div>
            </Card>
          );
        })()}
      </div>
    ) : (
      <div className="grid gap-4 lg:grid-cols-2">
        <StageBrief
          span
          label="CONTRACT · NOTHING IS OBLIGATED YET"
          lede="No contract is on the register for this tender. Before one can exist, three things must be true: the award report is signed, the standstill window has lapsed without a live complaint, and the money is committed against an approved budget line."
          items={[
            "A signed award report — the contract cannot be prepared from an unsigned recommendation.",
            "A lapsed standstill: the review window is the bidder's remedy and it runs before signature, not after.",
            "An approved budget line with enough free balance to carry the whole contract value; the commitment is booked the moment the pack exists.",
            "A retention percentage decided up front, so every later payment is tested against it rather than negotiated case by case.",
          ]}
          gate="Preparing the pack raises the accounting officer's gate. The desk will not create an obligation a named officer has not signed."
        />
        <Card title="Budget line" sub="AN AWARD COMMITS MONEY AGAINST A LINE — NO COMMITMENT, NO CONTRACT" workflow busy={busy} actionLabel="Manage budget">
          <ul className="space-y-1.5">
            {budgetLines.map((line) => (
              <li
                key={line.id}
                className={cn(
                  "rounded-lg border px-2.5 py-2 text-[12.5px]",
                  d.budgetLine === line.id ? "border-brand-400 bg-brand-50/50 dark:bg-brand-950/30" : "border-ink-100 bg-paper",
                )}
              >
                <button type="button" className="min-h-11 w-full text-left" onClick={() => set("budgetLine", line.id)}>
                  <span className="font-semibold text-ink-900">{line.code}</span>{" "}
                  <span className="text-ink-400">
                    {line.fiscalYear} · {line.currency} {fmtMoney(line.approved)} approved · {fmtMoney(line.committed)} committed
                  </span>
                </button>
              </li>
            ))}
            {budgetLines.length === 0 ? <li className="py-3 text-center text-[12px] text-ink-400">No budget line yet.</li> : null}
          </ul>
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
            <input className={inputCls} aria-label="Budget line code" placeholder="Code (e.g. CAP-2026)" value={d.budCode ?? ""} onChange={(e) => set("budCode", e.target.value)} />
            <input className={inputCls} aria-label="Budget line approved amount" type="number" placeholder="Approved amount" value={d.budApproved ?? ""} onChange={(e) => set("budApproved", e.target.value)} />
            <input className={inputCls} aria-label="Budget line fiscal year" type="number" placeholder="Fiscal year" value={d.budYear ?? ""} onChange={(e) => set("budYear", e.target.value)} />
            <input className={inputCls} aria-label="Budget line currency" placeholder="Currency" value={d.budCurrency ?? ""} onChange={(e) => set("budCurrency", e.target.value)} />
            <Btn variant="ghost" onClick={createBudgetLine} disabled={busy || !d.budCode || !d.budApproved}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add budget line
            </Btn>
          </div>
        </Card>

        <Card title="Prepare the contract pack" sub="OPENS AFTER THE AWARD REPORT IS SIGNED AND THE STANDSTILL HAS LAPSED" workflow busy={busy} actionLabel="Prepare contract pack">
          <div className="mb-3 grid gap-1.5 sm:grid-cols-2">
            <select className={inputCls} aria-label="Budget line for contract commitment" value={d.budgetLine ?? budgetLines[0]?.id ?? ""} onChange={(e) => set("budgetLine", e.target.value)}>
              <option value="">Select a budget line…</option>
              {budgetLines.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.code} — {line.currency} {fmtMoney(line.approved - line.committed)} free
                </option>
              ))}
            </select>
            <input className={inputCls} aria-label="Contract retention percentage" type="number" placeholder="Retention %" value={d.retentionPct ?? ""} onChange={(e) => set("retentionPct", e.target.value)} />
          </div>
          <Btn onClick={preparePack} disabled={busy || !ref || !cycle.awardReport?.signedAt || !budgetLines.length || !(d.budgetLine || budgetLines[0]?.id)}>
            <FileSignature className="h-3.5 w-3.5" aria-hidden="true" /> Prepare the contract pack
          </Btn>
          {!cycle.awardReport?.signedAt ? <p className="mt-3 text-[11.5px] text-ink-400">The award report must be signed first.</p> : null}
          {!budgetLines.length ? <p className="mt-3 text-[11.5px] text-amber-700 dark:text-amber-300">Create a budget line first — the award must commit money.</p> : null}
        </Card>

      </div>
    )
  ) : null;

  /* ── Stage: closure — acceptance and completion evidence ──────────────────── */

  const ClosureTab = cycle ? (
    <div className="grid gap-4 lg:grid-cols-2">
      <StageBrief span {...STAGE_BRIEFS.closure} />
      <Card
        title="Final acceptance"
        sub="CERTIFICATE · DEFECTS PERIOD · PERFORMANCE RATING"
        workflow
        busy={busy}
        actionLabel="Record final acceptance"
        teaser={
          cycle.contract?.completedAt
            ? `Accepted ${fmtDate(cycle.contract.completedAt)}${cycle.contract.completion ? ` · defects liability to ${fmtDate(cycle.contract.completion.defectsLiabilityEndsAt)} · rated ${cycle.contract.completion.performanceRating}/5` : ""}`
            : "No acceptance certificate on record — the contract is still open and the supplier's register still shows it as live."
        }
      >
        {cycle.contract?.completedAt ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="ok">CYCLE CLOSED</Chip>
              <span className="font-code text-[10px] font-bold tracking-[0.12em] text-ink-500">ACCEPTED {fmtDate(cycle.contract.completedAt)}</span>
            </div>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-ink-100 bg-paper px-3 py-3">
                <dt className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-600">Certificate</dt>
                <dd className="mt-1.5 text-[13px] font-semibold text-ink-900">{cycle.contract.completion?.certificateId ?? "—"}</dd>
              </div>
              <div className="rounded-xl border border-ink-100 bg-paper px-3 py-3">
                <dt className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-600">Performance rating</dt>
                <dd className="mt-1.5 text-[13px] font-semibold text-ink-900">{cycle.contract.completion?.performanceRating ?? "—"} / 5</dd>
              </div>
            </dl>
            <p className="text-[11.5px] leading-relaxed text-ink-500">The final acceptance record is retained with this tender’s contract and audit trail.</p>
          </div>
        ) : cycle.contract ? (
          <div className="space-y-3">
            <p className="text-[12px] leading-relaxed text-ink-500">
              Record acceptance after the contract work is complete. The action creates an approval gate; it does not close the cycle until that gate is approved.
            </p>
            <div className="grid gap-1.5 sm:grid-cols-3">
              <input className={inputCls} aria-label="Acceptance certificate number" placeholder="Certificate no." value={d.completeCert ?? ""} onChange={(e) => set("completeCert", e.target.value)} />
              <input className={inputCls} aria-label="Defects liability end date" type="date" value={d.completeDefects ?? ""} onChange={(e) => set("completeDefects", e.target.value)} />
              <input className={inputCls} aria-label="Supplier performance rating from 1 to 5" type="number" min={1} max={5} placeholder="Rating 1–5" value={d.completeRating ?? ""} onChange={(e) => set("completeRating", e.target.value)} />
            </div>
            <textarea
              className={cn(inputCls, "min-h-20 py-2")}
              aria-label="Final acceptance note and outstanding observations"
              placeholder="Acceptance note and any remaining observations"
              value={d.completeNote ?? ""}
              onChange={(e) => set("completeNote", e.target.value)}
            />
            <Btn
              onClick={() =>
                act(
                  `/api/tenders/${ref}/contract/complete`,
                  {
                    certificateId: d.completeCert,
                    defectsLiabilityEndsAt: d.completeDefects,
                    performanceRating: Number(d.completeRating),
                    note: d.completeNote,
                  },
                  "COMPLETION GATE RAISED",
                ).then((ok) => ok && refreshCycle())
              }
              disabled={busy || !d.completeCert || !d.completeDefects || !d.completeRating}
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" /> Record acceptance for approval
            </Btn>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-ink-200 px-4 py-8 text-center dark:border-white/[0.12]">
            <p className="text-[12px] font-semibold text-ink-700">Contract not ready for closure</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">Complete award, standstill, and contract setup before recording final acceptance.</p>
          </div>
        )}
      </Card>

      <Card title="Closure file" sub="THE LAST RECORD IN THE PROCUREMENT CYCLE" workflow busy={busy} actionLabel="Review closure evidence" teaser={`${cycle.contract?.completedAt ? "Closed" : "Open"} · notice ${cycle.notices.length ? "on file" : "missing"} · register ${cycle.opening?.certifiedAt ? "certified" : "uncertified"} · matrix ${cycle.matrix?.certifiedBy ? "certified" : "uncertified"} · award ${cycle.awardReport?.signedAt ? "signed" : "unsigned"} · contract ${cycle.contract?.status ?? "none"}`}>
        <ul className="space-y-2 text-[12px] text-ink-600">
          <li className="flex items-center justify-between gap-3 rounded-lg bg-paper px-3 py-2.5">
            <span>Signed award report</span>
            {cycle.awardReport?.signedAt ? <Chip tone="ok">ON FILE</Chip> : <Chip tone="warn">PENDING</Chip>}
          </li>
          <li className="flex items-center justify-between gap-3 rounded-lg bg-paper px-3 py-2.5">
            <span>Standstill</span>
            {cycle.standstill?.status === "LIFTED" ? <Chip tone="ok">LIFTED</Chip> : cycle.standstill ? <Chip tone="warn">{cycle.standstill.status}</Chip> : <Chip tone="muted">NOT STARTED</Chip>}
          </li>
          <li className="flex items-center justify-between gap-3 rounded-lg bg-paper px-3 py-2.5">
            <span>Contract acceptance</span>
            {cycle.contract?.supplierAcceptedAt ? <Chip tone="ok">RECORDED</Chip> : <Chip tone="warn">PENDING</Chip>}
          </li>
          <li className="flex items-center justify-between gap-3 rounded-lg bg-paper px-3 py-2.5">
            <span>Final acceptance</span>
            {cycle.contract?.completedAt ? <Chip tone="ok">RECORDED</Chip> : <Chip tone="muted">AWAITING APPROVAL</Chip>}
          </li>
        </ul>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-400">
          Closure remains subject to the approval record. Keep every certificate, decision, and outstanding complaint linked to this tender.
        </p>
      </Card>
    </div>
  ) : null;

  /* ── Tab: complaints (G14) ───────────────────────────────────────────────── */

  const ComplaintsTab = cycle ? (
    <div className="grid gap-4 lg:grid-cols-2">
      <StageBrief span {...DESK_TOOL_BRIEFS.complaints} />
      <Card
        title="Log a complaint"
        sub="STANDSTILL-WINDOW COMPLAINTS ARE MARKED AS SUCH"
        workflow
        busy={busy}
        actionLabel="Log a complaint"
        teaser={`${count(cycle.complaints.length, "complaint")} on this tender · ${
          cycle.complaints.filter((c) => c.status === "OPEN" || c.status === "ESCALATED").length
        } still live · the grounds are recorded as filed, and the answer is issued at a gate, never typed as decided`}
      >
        <div className="grid gap-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={inputCls} aria-label="Complaint filer" placeholder="Complainant" value={d.cmpWho ?? ""} onChange={(e) => set("cmpWho", e.target.value)} />
            <input className={inputCls} aria-label="Complaint subject" placeholder="Subject" value={d.cmpWhat ?? ""} onChange={(e) => set("cmpWhat", e.target.value)} />
          </div>
          <textarea className={cn(inputCls, "h-20 py-2")} aria-label="Complaint grounds as filed" placeholder="Grounds" value={d.cmpBody ?? ""} onChange={(e) => set("cmpBody", e.target.value)} />
          <Btn
            onClick={() =>
              act(`/api/tenders/${ref}/complaints`, { complainant: d.cmpWho, subject: d.cmpWhat, body: d.cmpBody }, "COMPLAINT LOGGED").then(
                (ok) => ok && (setD((p) => ({ ...p, cmpWho: "", cmpWhat: "", cmpBody: "" })), refreshCycle()),
              )
            }
            disabled={busy || !d.cmpWho || !d.cmpWhat}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Log complaint
          </Btn>
        </div>
      </Card>

      <Card
        title="Complaints on this tender"
        sub="RESPONSES ARE DRAFTED, SIGNED AT A GATE, THEN ISSUE"
        workflow
        busy={busy}
        actionLabel="Manage complaint responses"
        teaser={
          cycle.complaints.length === 0
            ? "No complaint on record. A filed complaint keeps its grounds verbatim, holds the contract while open, and closes only by an explicit act."
            : `${cycle.complaints.filter((c) => c.status === "OPEN").length} open · ${cycle.complaints.filter((c) => c.status === "ESCALATED").length} escalated · ${cycle.complaints.filter((c) => c.duringStandstill).length} filed inside the standstill window`
        }
      >
        <dl className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-ink-100 bg-ink-100/70 dark:border-white/[0.07] dark:bg-white/[0.07] lg:grid-cols-4">
          {[
            { label: "LIVE", n: cycle.complaints.filter((c) => c.status === "OPEN" || c.status === "ESCALATED").length, alarm: true },
            { label: "ANSWERED", n: cycle.complaints.filter((c) => c.status === "ANSWERED").length },
            { label: "IN REVIEW", n: cycle.complaints.filter((c) => c.status === "ESCALATED").length },
            { label: "CLOSED", n: cycle.complaints.filter((c) => c.status === "CLOSED" || c.status === "WITHDRAWN").length },
          ].map((bucket) => (
            <div key={bucket.label} className="bg-[#fffefa] px-3 py-2.5 dark:bg-[#12141a]">
              <dt className="eyebrow text-[10px] tracking-[0.08em]">{bucket.label}</dt>
              <dd
                className={cn(
                  "mt-1 font-display text-[17px] font-bold leading-none tabular",
                  bucket.alarm && bucket.n > 0 ? "text-brand-600 dark:text-brand-400" : "text-ink-900 dark:text-white",
                )}
              >
                {bucket.n}
              </dd>
            </div>
          ))}
        </dl>
        {cycle.complaints.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-200 px-4 py-8 text-center">
            <Scale className="mx-auto h-5 w-5 text-ink-400" aria-hidden="true" />
            <p className="mt-2 text-[12.5px] text-ink-500">None on record.</p>
            <p className="mt-1 text-[11px] text-ink-400">Bidder complaints land here — standstill-window ones are flagged for priority.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {cycle.complaints.map((c) => (
              <li key={c.id} className="rounded-xl border border-ink-100 bg-paper px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-ink-900">{c.complainant}</p>
                    <p className="truncate text-[11.5px] text-ink-500">{c.subject}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {c.duringStandstill ? <Chip tone="brand">STANDSTILL</Chip> : null}
                    <Chip tone={c.status === "ANSWERED" ? "ok" : c.status === "OPEN" || c.status === "ESCALATED" ? "warn" : "muted"}>
                      {c.status.replace(/_/g, " ")}
                    </Chip>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] leading-relaxed text-ink-600">
                  <span>Received {fmtDateTime(c.receivedAt)}</span>
                  {c.acknowledgedAt ? <span>Acknowledged {fmtDateTime(c.acknowledgedAt)}</span> : null}
                  <span className="break-all">Reference {c.id}</span>
                </div>
                <div className="mt-3 rounded-lg border border-ink-100 bg-paper/75 px-3 py-2.5 dark:border-white/[0.08] dark:bg-white/[0.02]">
                  <p className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-600">Grounds as filed</p>
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-ink-700 dark:text-ink-200">{c.body || "No grounds were included in the record."}</p>
                </div>
                {c.response ? (
                  <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.035] px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <p className="font-code text-[10px] font-bold tracking-[0.08em] text-emerald-800 dark:text-emerald-300">Issued response</p>
                      <span className="text-[10px] text-ink-600">{c.response.by} · {fmtDateTime(c.response.at)}</span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-ink-700 dark:text-ink-200">{c.response.md}</p>
                    {c.response.gateId ? <p className="mt-1.5 text-[10px] text-ink-600">Approval gate · {c.response.gateId}</p> : null}
                  </div>
                ) : null}
                {c.escalationReason ? (
                  <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.035] px-3 py-2.5">
                    <p className="font-code text-[10px] font-bold tracking-[0.06em] text-amber-900 dark:text-amber-200">Independent review requested{c.escalatedAt ? ` · ${fmtDateTime(c.escalatedAt)}` : ""}</p>
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-ink-700 dark:text-ink-200">{c.escalationReason}</p>
                  </div>
                ) : null}
                {c.independentReview ? (
                  <div className="mt-2 rounded-lg border border-ink-100 px-3 py-2.5 dark:border-white/[0.08]">
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <p className="font-code text-[10px] font-bold tracking-[0.06em] text-ink-700">Independent review · {c.independentReview.outcome}</p>
                      <span className="text-[10px] text-ink-600">{c.independentReview.reviewer} · {fmtDateTime(c.independentReview.at)}</span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-ink-700 dark:text-ink-200">{c.independentReview.note}</p>
                  </div>
                ) : null}
                {c.closedAt || c.closedBy ? (
                  <p className="mt-2 text-[10px] text-ink-600">Closed{c.closedBy ? ` by ${c.closedBy}` : ""}{c.closedAt ? ` · ${fmtDateTime(c.closedAt)}` : ""}</p>
                ) : null}
                {c.status === "OPEN" ? (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex gap-1.5">
                      <input className={inputCls} aria-label={`Response draft for complaint ${c.id}`} placeholder="Response draft" value={d[`cresp-${c.id}`] ?? ""} onChange={(e) => set(`cresp-${c.id}`, e.target.value)} />
                      <Btn
                        variant="ghost"
                        onClick={() =>
                          act(`/api/tenders/${ref}/complaints/${c.id}/respond`, { response: d[`cresp-${c.id}`] }, "RESPONSE GATE RAISED").then((ok) => ok && refreshCycle())
                        }
                        disabled={busy || !d[`cresp-${c.id}`]}
                      >
                        Respond (gate)
                      </Btn>
                    </div>
                    <div className="flex gap-1.5">
                      <input className={inputCls} aria-label={`Independent review escalation reason for complaint ${c.id}`} placeholder="Escalation reason (independent review)" value={d[`cesc-${c.id}`] ?? ""} onChange={(e) => set(`cesc-${c.id}`, e.target.value)} />
                      <Btn
                        variant="ghost"
                        onClick={() =>
                          act(`/api/tenders/${ref}/complaints/${c.id}/escalate`, { reason: d[`cesc-${c.id}`] }, "COMPLAINT ESCALATED — CONTRACT STAYS SUSPENDED").then((ok) => ok && refreshCycle())
                        }
                        disabled={busy || !d[`cesc-${c.id}`]}
                      >
                        Escalate
                      </Btn>
                    </div>
                  </div>
                ) : null}
                {c.status === "ANSWERED" || c.status === "ESCALATED" ? (
                  <div className="mt-2 space-y-1.5 rounded-lg border border-dashed border-ink-200 p-2">
                    <p className="text-[10.5px] leading-relaxed text-ink-600">Close after review. The contract stays suspended until this complaint is closed.</p>
                    <div className="grid gap-1.5 sm:grid-cols-3">
                      <input className={inputCls} aria-label={`Independent review outcome for complaint ${c.id}`} placeholder="Outcome" value={d[`cout-${c.id}`] ?? ""} onChange={(e) => set(`cout-${c.id}`, e.target.value)} />
                      <input className={inputCls} aria-label={`Independent review reason for complaint ${c.id}`} placeholder="Review reason" value={d[`cnote-${c.id}`] ?? ""} onChange={(e) => set(`cnote-${c.id}`, e.target.value)} />
                      <input className={inputCls} aria-label={`Reviewing officer for complaint ${c.id}`} placeholder="Reviewing officer" value={d[`crev-${c.id}`] ?? ""} onChange={(e) => set(`crev-${c.id}`, e.target.value)} />
                    </div>
                    <Btn
                      variant="ghost"
                      onClick={() =>
                        act(
                          `/api/tenders/${ref}/complaints/${c.id}/close`,
                          { outcome: d[`cout-${c.id}`], note: d[`cnote-${c.id}`], reviewer: d[`crev-${c.id}`] },
                          "COMPLAINT CLOSED — INDEPENDENT REVIEW RECORDED",
                        ).then((ok) => ok && refreshCycle())
                      }
                      disabled={busy || !d[`cout-${c.id}`] || !d[`cnote-${c.id}`] || !d[`crev-${c.id}`]}
                    >
                      Close complaint
                    </Btn>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  ) : null;

  /* ── Tab: analytics + procurement file (G15/G5) ──────────────────────────── */

  /* Whole numbers stay whole; the one ratio on the desk gets one decimal. */
  const fmtNum = (v: number | string) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(1);
  };

  /* Where every dossier on the desk actually stands — each cycle record is
     read for the stage it has reached and counted once. Derived from the
     records on every poll, never stored, never asserted. Zero stays zero. */
  const stageLabels = useMemo(() => deriveStages(null).stages.map((s) => s.label), []);
  const stageDist = useMemo(() => {
    const buckets = Array.from({ length: 7 }, () => 0);
    for (const c of cycles) {
      const { currentIndex } = deriveStages(c);
      buckets[Math.min(Math.max(currentIndex, 0), 6)] += 1;
    }
    return buckets;
  }, [cycles]);
  const stageDistMax = Math.max(...stageDist, 1);

  const defaultReportPeriod = quarterlyPeriods.find((period) => period.status === "READY") ?? quarterlyPeriods[0];
  const reportPeriodKey = d.qprPeriod ?? (defaultReportPeriod ? `${defaultReportPeriod.year}-Q${defaultReportPeriod.quarter}` : "");
  const selectedReportPeriod = quarterlyPeriods.find((period) => `${period.year}-Q${period.quarter}` === reportPeriodKey);
  const QuarterlyReportsTab = (
    <div className="grid gap-4">
      <StageBrief {...DESK_TOOL_BRIEFS.reporting} />
      <Card title="Variation and preference returns" sub="QUARTERLY SNAPSHOT · ACCOUNTING OFFICER APPROVAL REQUIRED">
        {!quarterlyPeriods.length ? (
          <div className="rounded-xl border border-dashed border-ink-200 px-4 py-7 text-center text-[12px] text-ink-500 dark:border-white/10">Quarterly reporting periods are loading.</div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(220px,0.6fr)_1fr] sm:items-end">
              <Field label="REPORTING PERIOD">
                <select className={inputCls} value={reportPeriodKey} onChange={(event) => set("qprPeriod", event.target.value)}>
                  {quarterlyPeriods.map((period) => (
                    <option key={`${period.year}-Q${period.quarter}`} value={`${period.year}-Q${period.quarter}`}>
                      Q{period.quarter} {period.year} · {period.status.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </Field>
              {selectedReportPeriod ? (
                <p className="text-[11px] leading-relaxed text-ink-500">{fmtDate(selectedReportPeriod.startsAt)} – {fmtDate(selectedReportPeriod.endsAt)} · {selectedReportPeriod.entries.length} reportable record{selectedReportPeriod.entries.length === 1 ? "" : "s"}</p>
              ) : null}
            </div>

            {selectedReportPeriod?.entries.length ? (
              <HorizontalScrollRegion label="Quarterly report entries" className="rounded-lg border border-ink-100 dark:border-white/[0.07]">
                <table className="w-full min-w-[650px] text-left text-[11px]">
                  <thead className="bg-paper font-code text-[10px] font-semibold tracking-[0.06em] text-ink-600 dark:bg-white/[0.03]">
                    <tr><th className="px-3 py-2">Date / tender</th><th className="px-3 py-2">Reportable event</th><th className="px-3 py-2">Supplier / reference</th><th className="px-3 py-2 text-right">Amount</th></tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 dark:divide-white/[0.06]">
                    {selectedReportPeriod.entries.map((entry) => (
                      <tr key={`${entry.tenderId}-${entry.type}-${entry.reference}`}>
                        <td className="px-3 py-2.5"><span className="block font-semibold text-ink-800 dark:text-ink-100">{tenderReferenceLabel(tenders.find((tender) => tender.ref === entry.tenderId))}</span><span className="block text-[10px] text-ink-500">{tenders.find((tender) => tender.ref === entry.tenderId)?.title ?? "Tender record"}</span><span className="text-[10px] text-ink-500">{fmtDate(entry.date)}</span></td>
                        <td className="px-3 py-2.5 text-ink-700 dark:text-ink-200">{entry.type === "VARIATION" ? "Approved contract variation" : `Preference award · ${entry.scheme ?? "scheme recorded"}`}</td>
                        <td className="px-3 py-2.5 text-ink-600 dark:text-ink-300">{entry.supplier ?? entry.reference}<span className="block font-mono text-[10px] text-ink-500">{entry.reference}</span></td>
                        <td className="px-3 py-2.5 text-right tabular text-ink-700 dark:text-ink-200">{entry.amount === undefined ? "—" : `${entry.currency ?? ""} ${Number(entry.amount).toLocaleString()}`.trim()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </HorizontalScrollRegion>
            ) : selectedReportPeriod ? (
              <p className="rounded-lg border border-ink-100 bg-paper px-3 py-3 text-[11.5px] text-ink-500 dark:border-white/[0.06] dark:bg-white/[0.02]">No approved variations or preference awards fell in this quarter. A nil return can still be submitted for the period.</p>
            ) : null}

            {selectedReportPeriod?.status === "PENDING_GATE" && selectedReportPeriod.report ? (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-3 text-[11.5px] text-amber-900 dark:text-amber-200">
                Awaiting accounting officer approval · gate {selectedReportPeriod.report.gateId ?? "pending"} · submission reference {selectedReportPeriod.report.submissionReference}.
              </div>
            ) : null}
            {selectedReportPeriod?.status === "SUBMITTED" && selectedReportPeriod.report ? (
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-3 text-[11.5px] text-emerald-900 dark:text-emerald-200">
                Submitted {selectedReportPeriod.report.submittedAt ? fmtDate(selectedReportPeriod.report.submittedAt) : "on record"} by {selectedReportPeriod.report.submittedBy ?? "accounting officer"} · reference {selectedReportPeriod.report.submissionReference}.
              </div>
            ) : null}
            {selectedReportPeriod?.status === "READY" ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="AUTHORITY SUBMISSION REFERENCE" hint="The reference assigned by the reporting authority or portal.">
                    <input className={inputCls} value={d.qprSubmission ?? ""} onChange={(event) => set("qprSubmission", event.target.value)} maxLength={200} placeholder="e.g. ZPPA quarterly return reference" />
                  </Field>
                  <Field label="SUPPORTING EVIDENCE REFERENCE" hint="Portal receipt, report file, or document-register reference.">
                    <input className={inputCls} value={d.qprEvidence ?? ""} onChange={(event) => set("qprEvidence", event.target.value)} maxLength={240} placeholder="e.g. report upload receipt / document ID" />
                  </Field>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[10px] leading-relaxed text-ink-600">Snapshot digest · {selectedReportPeriod.digest.slice(0, 20)}</p>
                  <Btn onClick={() => act("/api/cycle/quarterly-reports", {
                    year: selectedReportPeriod.year,
                    quarter: selectedReportPeriod.quarter,
                    submissionReference: d.qprSubmission,
                    evidenceReference: d.qprEvidence,
                  }, "QUARTERLY RETURN STAGED — ACCOUNTING OFFICER APPROVAL REQUIRED").then((ok) => ok && setD((current) => ({ ...current, qprSubmission: "", qprEvidence: "" })))} disabled={busy || !d.qprSubmission?.trim() || !d.qprEvidence?.trim()}>
                    <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Prepare return and request approval
                  </Btn>
                </div>
              </>
            ) : null}
            {selectedReportPeriod?.status === "OPEN" ? <p className="text-[11px] text-ink-500">The quarter has not closed yet; its return will be available after {fmtDate(selectedReportPeriod.endsAt)}.</p> : null}
          </div>
        )}
      </Card>
    </div>
  );

  const AnalyticsTab = (
    <div className="grid gap-4">
      <StageBrief {...DESK_TOOL_BRIEFS.analytics} />
      <Card
        title="Desk analytics"
        sub="READ-SIDE ONLY — COMPUTED FROM THE APPEND-ONLY LOGS, ZERO NEW INSTRUMENTATION"
        right={
          analytics ? (
            <span className="text-[10px] font-semibold text-ink-600">
              {fmtNum(analytics.tendersInCycle ?? 0)} TENDER{Number(analytics.tendersInCycle ?? 0) === 1 ? "" : "S"} IN CYCLE
            </span>
          ) : null
        }
      >
        {!analytics ? (
          /* No record yet — an honest instrument reads blank, not zero. */
          <div className="flex flex-col items-center rounded-[10px] border border-dashed border-ink-200 px-5 py-10 text-center dark:border-white/[0.12]">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-ink-100/70 text-ink-400 dark:bg-white/[0.05]">
              <Workflow className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="mt-3.5 text-[13px] font-semibold text-ink-800">Analytics arrive with the first cycle record</p>
            <p className="mt-1.5 max-w-[44ch] text-[11.5px] leading-relaxed text-ink-400">
              Every number here is computed from the append-only log the moment the desk starts moving — nothing is
              estimated ahead of the record.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {/* Headline numbers — the four an oversight meeting opens with. */}
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-ink-100 bg-ink-100/70 sm:grid-cols-4 dark:border-white/[0.07] dark:bg-white/[0.07]">
              {(
                [
                  { k: "tendersInCycle", label: "Tenders in cycle", hint: "RECORDS OPEN ON THE DESK" },
                  { k: "bidsOpened", label: "Bids opened", hint: "REGISTERED AT PUBLIC OPENING" },
                  { k: "certifiedMatrices", label: "Matrices certified", hint: "EVALUATION SIGNED AT A GATE" },
                  { k: "contractsClosed", label: "Contracts closed", hint: "ACCEPTANCE RECORDED", accent: true },
                ] as { k: string; label: string; hint?: string; accent?: boolean }[]
              ).map((m) => (
                <div key={m.k} className="bg-[#fffefa] px-4 py-3.5 dark:bg-[#12141a]">
                  <dt className="eyebrow text-[10px] tracking-[0.08em]">{m.label}</dt>
                  <dd
                    className={cn(
                      "mt-2 font-display text-[26px] font-black leading-none tracking-[-0.02em] tabular",
                      m.accent ? "text-brand-600 dark:text-brand-400" : "text-ink-950 dark:text-white",
                    )}
                  >
                    {fmtNum(analytics[m.k] ?? 0)}
                  </dd>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-ink-600">{m.hint}</p>
                </div>
              ))}
            </dl>

            {/* Where the desk stands — one column per stage, one count per
                dossier record. The bar carries no decoration: height is the
                count, zero is empty, and the number above it is the truth. */}
            {cycles.length ? (
              <div className="rounded-[10px] border border-ink-100 px-4 pb-3 pt-3.5 dark:border-white/[0.07]">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="eyebrow text-[10px] tracking-[0.08em]">Where the desk stands</p>
                  <span className="text-[10px] font-semibold text-ink-600">
                    {cycles.length} CYCLE {cycles.length === 1 ? "RECORD" : "RECORDS"} ON FILE
                  </span>
                </div>
                <div
                  className="mt-3 space-y-2"
                  role="img"
                  aria-label={
                    `Tenders by current stage: ` +
                    stageLabels.map((l, i) => `${l} ${stageDist[i]}`).join(", ")
                  }
                >
                  {stageDist.map((n, i) => (
                    <div
                      key={stageLabels[i]}
                      className="grid grid-cols-[minmax(92px,0.8fr)_minmax(0,2fr)_2.5rem] items-center gap-2.5"
                      title={`${n} tender${n === 1 ? "" : "s"} at ${stageLabels[i]}`}
                    >
                      <span className="truncate text-[10.5px] font-medium text-ink-700 dark:text-ink-200">
                        {stageLabels[i]}
                      </span>
                      <span className="h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-white/[0.08]" aria-hidden="true">
                        <span
                          className="block h-full rounded-full bg-brand-500/90 transition-[width] duration-500 dark:bg-brand-400"
                          style={{ width: n > 0 ? `${Math.max((n / stageDistMax) * 100, 4)}%` : "0%" }}
                        />
                      </span>
                      <span className="text-right font-code text-[10px] font-bold tabular text-ink-700 dark:text-ink-200">
                        {n}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[10.5px] leading-relaxed text-ink-600">
                  Counts show the stage each record has reached. Closed cycles remain under closure.
                </p>
              </div>
            ) : null}

            {/* Watchlist — the exceptions that need a human, each with the
                tab that resolves it. Zero stays zero; nothing is invented. */}
            {(() => {
              const watches: { count: number; label: string; tab: CyclePageTab; tabLabel: string }[] = [
                { count: Number(analytics.lateBids ?? 0), label: "late bids rejected unopened", tab: "opening", tabLabel: "OPENING" },
                { count: Number(analytics.albOpen ?? 0), label: "abnormally-low-bid queries open", tab: "evaluation", tabLabel: "EVALUATION" },
                { count: Number(analytics.openComplaints ?? 0), label: "complaints awaiting a response", tab: "complaints", tabLabel: "COMPLAINTS" },
                { count: Number(analytics.standstillsActive ?? 0), label: "standstill clocks running", tab: "standstill", tabLabel: "STANDSTILL" },
              ];
              const raised = watches.filter((w) => w.count > 0);
              return (
                <div
                  className={cn(
                    "rounded-[10px] border px-4 py-3.5",
                    raised.length
                      ? "border-brand-500/30 bg-brand-500/[0.05] dark:border-brand-400/30 dark:bg-brand-500/[0.07]"
                      : "border-emerald-500/25 bg-emerald-500/[0.05] dark:border-emerald-400/25",
                  )}
                >
                  <p className={cn("eyebrow text-[10px] tracking-[0.08em]", raised.length ? "text-brand-800 dark:text-brand-300" : "text-emerald-800 dark:text-emerald-300")}>
                    {raised.length ? "NEEDS ATTENTION" : "ALL CLEAR"}
                  </p>
                  {raised.length ? (
                    <ul className="mt-2.5 space-y-1.5">
                      {raised.map((w) => (
                        <li key={w.label} className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <span className="inline-grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1 font-code text-[10px] font-black tabular text-white dark:bg-brand-500">
                            {w.count}
                          </span>
                          <span className="text-[12px] font-medium text-ink-800 dark:text-ink-100">{w.label}</span>
                          <button
                            type="button"
                            onClick={() => {
                              selectTab(w.tab);
                            }}
                            className="focus-brand inline-flex min-h-11 items-center gap-1 rounded font-code text-[10px] font-bold tracking-[0.06em] text-brand-800 underline decoration-brand-500/40 underline-offset-4 transition-colors hover:decoration-brand-500 dark:text-brand-300"
                          >
                            OPEN {w.tabLabel}
                            <ArrowRight className="h-2.5 w-2.5" aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1.5 text-[12px] text-ink-600 dark:text-ink-300">
                      No late bids, no open queries, no unanswered complaints, no running standstills — the desk is clean.
                    </p>
                  )}
                </div>
              );
            })()}

            {/* The rest of the record — compact, tabular, honest. */}
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-ink-100 bg-ink-100/70 sm:grid-cols-3 xl:grid-cols-5 dark:border-white/[0.07] dark:bg-white/[0.07]">
              {(
                [
                  { k: "onTimeBids", label: "On-time bids" },
                  { k: "complaints", label: "Complaints logged" },
                  { k: "findingsTotal", label: "Findings raised" },
                  { k: "findingsPerTender", label: "Findings / tender" },
                  { k: "contractsActive", label: "Contracts active" },
                ] as { k: string; label: string }[]
              ).map((m) => (
                <div key={m.k} className="bg-[#fffefa] px-3.5 py-3 dark:bg-[#12141a]">
                  <dt className="eyebrow text-[10px] tracking-[0.08em]">{m.label}</dt>
                  <dd className="mt-1.5 font-display text-[19px] font-bold leading-none tracking-[-0.02em] tabular text-ink-900 dark:text-white">
                    {fmtNum(analytics[m.k] ?? 0)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </Card>
      <Card
        title="Stored tender documents"
        sub={ref ? `${currentReferenceLabel} · STORAGE, STAGING AND AUDIT STATUS` : "SELECT A TENDER TO BROWSE ITS DOCUMENTS"}
        workflow
        busy={busy}
        actionLabel="Manage stored documents"
      >
        <StoredDocsBrowser
          tenderRef={ref}
          canDelete={canDeleteDocuments}
          title="STORED TENDER DOCUMENTS"
        />
      </Card>
      <Card title="Consolidated procurement file" sub="ONE BUNDLE FOR THE AUDITORS — EVERY ARTIFACT, HASH AND SIGNATURE, WITH THE LOG-CHAIN VERDICT">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-100 bg-paper px-4 py-3.5">
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-ink-900">{ref ? currentReferenceLabel : "Select a tender"}</p>
            <p className="text-[11px] text-ink-400">Composes live from the append-only log — the auditors' single entry point.</p>
          </div>
          <a
            href={`/api/procurement-file/${encodeURIComponent(ref)}${SVC}`}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-[12.5px] font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-950/20 active:scale-[0.98]",
              ref ? "bg-brand-600 text-white shadow-sm hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-400" : "pointer-events-none bg-ink-100 text-ink-400",
            )}
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> Open the procurement file
          </a>
        </div>
      </Card>
    </div>
  );

  /* ── Shell ───────────────────────────────────────────────────────────────── */

  const stageIndex = STAGE_TABS.findIndex((stage) => stage.id === tab);
  const activeStage = stageIndex >= 0 ? STAGE_TABS[stageIndex] : null;
  const activeStageRecord = activeStage && cycle ? deriveStages(cycle).stages[stageIndex] : null;
  const previousStage = stageIndex > 0 ? STAGE_TABS[stageIndex - 1] : null;
  const nextStage = stageIndex >= 0 && stageIndex < STAGE_TABS.length - 1 ? STAGE_TABS[stageIndex + 1] : null;
  const emptyGuide = CYCLE_PAGE_EMPTY_GUIDES[tab];
  /* A desk tool with no cycle record still states what it produces — the
     stage pages get theirs from STAGE_BRIEFS, these from their own map. */
  const deskToolBrief =
    tab === "deadlines" || tab === "complaints" || tab === "analytics" || tab === "reporting" ? DESK_TOOL_BRIEFS[tab] : null;
  return (
    <section id="mc-cycle" aria-labelledby="mc-cycle-h" className="scroll-mt-24">
      <p className="sr-only" role="status" aria-atomic="true">
        {activeStage
          ? `Tender Cycle, stage ${stageIndex + 1} of ${STAGE_TABS.length}: ${activeStage.label}.${activeStageRecord?.held ? " Awaiting a human decision." : activeStageRecord?.state === "done" ? " Complete." : ""}`
          : `Tender Cycle desk tool: ${UTILITY_TABS.find((item) => item.id === tab)?.label ?? "selected"}.`}
      </p>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
        className="panel relative flex h-full flex-col overflow-hidden rounded-[12px]"
      >
        {/* One wash of signal colour at the top edge — the desk's own light. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-28 left-0 right-0 h-56 bg-[radial-gradient(420px_180px_at_18%_100%,rgba(232,56,42,0.08),transparent_70%)] dark:bg-[radial-gradient(440px_190px_at_18%_100%,rgba(232,56,42,0.16),transparent_72%)]"
        />

        <header className="relative px-5 pb-4 pt-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 eyebrow">
                <Workflow className="h-3 w-3 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                Command / Cycle control
              </p>
              <h2
                id="mc-cycle-h"
                className="mt-2.5 font-display text-[27px] font-black leading-none tracking-[-0.032em] text-ink-950"
              >
                Tender Cycle<span className="text-brand-600 dark:text-brand-400">.</span>
              </h2>
              <p className="mt-2 max-w-[62ch] text-[12.5px] leading-relaxed text-ink-500">
                One desk, the whole cycle — every irreversible step stops at a named human gate.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-stretch">
            <div className="min-w-0 flex-1">
              <TenderPicker tenders={tenders} value={ref} cycles={cycles} onSelect={setRef} onToast={onToast} />
            </div>
            <TenderCompare
              tenders={tenders}
              cycles={cycles}
              pipeline={pipeline}
              applications={portalApps}
              current={ref}
              onSelect={setRef}
            />
          </div>
        </header>

        <VitalStrip cycle={cycle} />

        <div
          className="relative flex-1 bg-[#f8f7f3] px-4 py-4 outline-none sm:px-5 sm:py-5 dark:bg-[#090b0f]"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: EASE }}
            >
              {activeStage ? (
                <header className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-ink-200/70 pb-4 dark:border-white/[0.08]">
                  <div className="min-w-0">
                    <p aria-current="step" className="font-code text-[10.5px] font-bold tracking-[0.12em] text-brand-600 dark:text-brand-300">
                      STAGE {String(stageIndex + 1).padStart(2, "0")} / {String(STAGE_TABS.length).padStart(2, "0")}
                    </p>
                    <h3 className="mt-1 font-display text-[20px] font-bold tracking-[-0.025em] text-ink-950 dark:text-white">{activeStage.label}</h3>
                    <p className="mt-1 max-w-[70ch] text-[12.5px] leading-relaxed text-ink-600 dark:text-ink-300">{STAGE_INTROS[activeStage.id]}</p>
                  </div>
                  {cycle && activeStageRecord ? <Chip tone={activeStageRecord.state === "done" ? "ok" : activeStageRecord.held ? "warn" : "muted"}>
                    {activeStageRecord.state === "done"
                      ? "COMPLETE"
                      : activeStageRecord.held
                        ? "AT HUMAN GATE"
                        : activeStageRecord.state === "current"
                          ? "CURRENT STAGE"
                          : "UPCOMING"}
                  </Chip> : <Chip tone="muted">NO CYCLE RECORD</Chip>}
                </header>
              ) : (
                <header className="mb-5 border-b border-ink-200/70 pb-4 dark:border-white/[0.08]">
                  <p className="font-code text-[10.5px] font-bold tracking-[0.12em] text-brand-600 dark:text-brand-300">TENDER CYCLE · DESK TOOLS</p>
                  <h3 className="mt-1 font-display text-[20px] font-bold tracking-[-0.025em] text-ink-950 dark:text-white">
                    {UTILITY_TABS.find((item) => item.id === tab)?.label}
                  </h3>
                </header>
              )}
              {tab === "solicitation" ? PipelineTab : null}
              {tab === "deadlines" ? DeadlinesTab : null}
              {tab === "opening" ? OpeningTab : null}
              {tab === "evaluation" ? EvaluationTab : null}
              {tab === "award" ? AwardTab : null}
              {tab === "standstill" ? StandstillTab : null}
              {tab === "contract" ? ContractTab : null}
              {tab === "closure" ? ClosureTab : null}
              {tab === "complaints" ? ComplaintsTab : null}
              {tab === "analytics" ? AnalyticsTab : null}
              {tab === "reporting" ? QuarterlyReportsTab : null}
              {tab !== "solicitation" && tab !== "deadlines" && !cycle && emptyGuide ? (
                <>
                {activeStage ? (
                  <StageBrief {...STAGE_BRIEFS[activeStage.id]} />
                ) : deskToolBrief ? (
                  <StageBrief {...deskToolBrief} />
                ) : null}
                <section
                  className={cn("panel overflow-hidden rounded-[12px]", activeStage && "mt-4")}
                  aria-labelledby="cycle-empty-guide-title"
                >
                  <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(250px,0.72fr)] lg:gap-8">
                    <div>
                      <p className="font-code text-[10.5px] font-bold tracking-[0.1em] text-brand-600 dark:text-brand-300">
                        {ref ? `NO CYCLE RECORD · ${currentReferenceLabel}` : "SELECT A TENDER TO VIEW ITS RECORD"}
                      </p>
                      <h3 id="cycle-empty-guide-title" className="mt-2 font-display text-[19px] font-bold tracking-[-0.025em] text-ink-950 dark:text-white">
                        {emptyGuide.title}
                      </h3>
                      <p className="mt-2 max-w-[58ch] text-[12px] leading-relaxed text-ink-600 dark:text-ink-300">{emptyGuide.body}</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => selectTab("solicitation")}
                          className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-3.5 text-[12px] font-semibold text-white transition-colors hover:bg-brand-500"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          {ref ? "Open Solicitation" : "Plan a tender"}
                        </button>
                        {tenders.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => {
                              const next = tenders.find((t) => cycles.some((c) => c.tenderId === t.ref))?.ref ?? tenders[0]?.ref;
                              if (next) setRef(next);
                            }}
                            className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink-200 bg-paper px-3.5 text-[12px] font-semibold text-ink-700 transition-colors hover:border-ink-400 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-ink-300 dark:hover:border-white/25 dark:hover:text-white"
                          >
                            <Search className="h-3.5 w-3.5" aria-hidden="true" />
                            View a recorded tender
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="rounded-xl border border-ink-100 bg-paper/80 p-3.5 dark:border-white/[0.08] dark:bg-white/[0.025]">
                      <p className="font-code text-[10px] font-bold tracking-[0.1em] text-ink-600 dark:text-ink-300">This page brings together</p>
                      <ul className="mt-2.5 space-y-2">
                        {emptyGuide.records.map((record, index) => (
                          <li key={record} className="flex items-start gap-2.5 text-[12px] leading-relaxed text-ink-700 dark:text-ink-300">
                            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-ink-200 font-code text-[10px] text-ink-600 dark:border-white/[0.12] dark:text-ink-300">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            {record}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </section>
                </>
              ) : null}
              {activeStage ? (
                <nav className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-ink-200/70 pt-4 dark:border-white/[0.08]" aria-label="Stage page navigation">
                  <button
                    type="button"
                    onClick={() => previousStage && selectTab(previousStage.id)}
                    disabled={!previousStage}
                    className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink-200 bg-paper px-3.5 text-[12px] font-semibold text-ink-700 transition-colors hover:border-ink-400 hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.12] dark:bg-white/[0.03] dark:text-ink-300 dark:hover:border-white/25 dark:hover:text-white"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    {previousStage ? `Previous: ${previousStage.label}` : "First stage"}
                  </button>
                  <span className="font-code text-[10.5px] font-bold tracking-[0.1em] text-ink-600 dark:text-ink-300">
                    Page {String(stageIndex + 1).padStart(2, "0")} of {String(STAGE_TABS.length).padStart(2, "0")}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {activeStage.id === "solicitation" ? (
                      <button
                        type="button"
                        onClick={() => currentNotice && void publishTenderNotice(currentNotice.id)}
                        disabled={busy || !currentNotice || !!currentNotice.issuedAt || noticeMissing.length > 0 || !noticeCriteriaValid}
                        title={
                          currentNotice?.issuedAt
                            ? "The notice is already published — registered suppliers can read it."
                            : !currentNotice
                              ? "Draft the tender notice before publishing."
                              : noticeMissing.length > 0 || !noticeCriteriaValid
                                ? "Complete the notice's mandatory fields and evaluation criteria before publishing."
                                : "Publish the notice to registered suppliers — the procurement unit signs the gate."
                        }
                        className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 text-[12px] font-semibold text-white shadow-[0_8px_18px_-12px_rgba(217,38,22,0.8)] transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Stamp className="h-4 w-4" aria-hidden="true" />
                        Publish
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => selectTab((nextStage ?? STAGE_TABS[0]).id)}
                      className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 text-[12px] font-semibold text-white shadow-[0_8px_18px_-12px_rgba(217,38,22,0.8)] transition-colors hover:bg-brand-500"
                    >
                      {nextStage ? `Next: ${nextStage.label}` : "Return to Solicitation"}
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </nav>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </section>
  );
}

/* ── small shared pieces defined once, used by the pages ────────────────────── */

function DeadlineIcon({ kind }: { kind: string }) {
  const k = kind.toUpperCase();
  if (k.includes("MILESTONE")) return <Flag className="h-4 w-4" aria-hidden="true" />;
  if (k.includes("STANDSTILL")) return <Stamp className="h-4 w-4" aria-hidden="true" />;
  if (k.includes("ALB")) return <CircleAlert className="h-4 w-4" aria-hidden="true" />;
  if (k.includes("COMPLAINT")) return <Scale className="h-4 w-4" aria-hidden="true" />;
  return <CalendarClock className="h-4 w-4" aria-hidden="true" />;
}
