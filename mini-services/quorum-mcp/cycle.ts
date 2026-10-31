/**
 * quorum-mcp — the tender cycle engine (waves 1-3 of the procurement-cycle
 * build). Everything here is PURE and exported for the test suite: parsers,
 * deterministic rules, matrix arithmetic, working-day math and the statutory
 * artifact composers. The stateful glue lives in index.ts, which operates on
 * the store; nothing in this module reads or writes state.
 *
 * Why deterministic first: the same discipline as the review rules — the
 * compliance calls are code, the model drafts prose. A scoring matrix, a
 * standstill clock or a late-bid determination is arithmetic and dates, not
 * opinion, so no finding a committee relies on is improvised.
 */

import { addWorkingDaysIn, type JurisdictionPack } from "./jurisdiction";
import { evaluatedPrice } from "./evaluation";
import type {
  Addendum,
  AlbDossier,
  BidOpeningRegister,
  BidSecurityLine,
  Complaint,
  Clarification,
  ContractFile,
  DeadlinesInput,
  DeadlineItem,
  EvalBidResult,
  EvalCriterion,
  EvalMatrix,
  EvalScoreInput,
  Finding,
  NoticeFieldCheck,
  OpenBidInput,
  Responsiveness,
} from "./store";

/* ── Tunable constants — the regime's numbers, stated once ─────────────────── */

export const STANDSTILL_DAYS = 10; /* working days to lodge a complaint after award publication */
export const ALB_RESPONSE_DAYS = 5; /* working days for an abnormally-low-bid justification */
export const ADDENDUM_MIN_NOTICE_DAYS = 7; /* an addendum inside this window must extend closing */
export const BID_SECURITY_MIN_PCT = 2; /* of bid value, unless the notice states more */
export const BID_SECURITY_VALIDITY_MARGIN_DAYS = 28; /* calendar days beyond the closing date */
export const VARIATION_GATE_PCT = 10; /* a variation at or above this share of the contract needs the gate */
export const DEFAULT_TECH_WEIGHT_PCT = 80; /* technical 80 / financial 20, the standard methods default */
export const COMPLAINT_RESPONSE_DAYS = 14; /* working days to answer a standstill complaint */

/* ── Dates: working-day arithmetic, no library, no timezone drift ──────────── */

/** Add N working days (Sat/Sun skipped) to an ISO date/datetime. Pure. */
export function addWorkingDays(iso: string, days: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return d.toISOString();
}

/** Working days strictly between two ISO datetimes (a→b). Pure. */
export function workingDaysBetween(a: string, b: string): number {
  const start = new Date(a);
  const end = new Date(b);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0;
  let n = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6 && cursor <= end) n += 1;
  }
  return n;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar days from a→b as a plain number (used for security validity margins). */
export function calendarDaysBetween(a: string, b: string): number {
  const start = new Date(a);
  const end = new Date(b);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.floor((end.getTime() - start.getTime()) / DAY_MS);
}

/* ── Parsers: the same cited-line discipline as the value parsers ──────────── */

const CLOSING_PATTERNS = [
  /\*\*Closing date:?\*\*\s*([^\n]+)/i,
  /\*\*Closing:?\*\*\s*([^\n]+)/i,
  /\*\*Deadline(?: for submissions)?:?\*\*\s*([^\n]+)/i,
  /\*\*Submission deadline:?\*\*\s*([^\n]+)/i,
];

/* African timezone abbreviations a notice may close against. EAT (East
   Africa Time) is the one East African e-GPs use; CAT/SAST cover the
   south, WAT the west. Offsets from UTC, in hours. */
const NAMED_TZ_OFFSETS: Record<string, number> = {
  EAT: 3, CAT: 2, SAST: 2, WAT: 1, GMT: 0, UTC: 0,
};

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function parseDateish(raw: string, utcOffsetHours = 0): string | undefined {
  const cleaned = raw.trim().replace(/\s*\(.*\)\s*$/, "").trim();
  /* Date-only values close at the end of the local day. The offset comes from
     the jurisdiction pack, so a Lusaka notice is not read as UTC midnight. */
  const endOfDay = (y: string, m: string, d: string) =>
    new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 23, 59, 59) - utcOffsetHours * 3_600_000).toISOString();
  /* ISO or ISO-like dates first: 2026-10-30, 2026-10-30T14:00, 30/10/2026 */
  const iso = cleaned.match(/(\d{4})-(\d{2})-(\d{2})(?:[T\s]+(\d{2}):(\d{2}))?/);
  if (iso) {
    const [, y, m, d, hh, mm] = iso;
    if (!hh || !mm) return endOfDay(y, m, d);
    /* An explicit UTC designator or numeric offset wins over the jurisdiction
       default. A notice that says 14:00Z closes at 14:00Z, not 14:00 local. */
    const zone = cleaned.match(/(Z|[+-]\d{2}:?\d{2})\s*$/i)?.[1];
    let offset = utcOffsetHours;
    if (zone) {
      if (zone.toUpperCase() === "Z") offset = 0;
      else {
        const sign = zone.startsWith("+") ? 1 : -1;
        const digits = zone.slice(1).replace(":", "");
        offset = sign * (Number(digits.slice(0, 2)) + Number(digits.slice(2, 4)) / 60);
      }
    }
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm)) - offset * 3_600_000);
    return Number.isNaN(dt.getTime()) ? undefined : dt.toISOString();
  }
  const slash = cleaned.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) {
    const [, d, m, y] = slash;
    return endOfDay(y, m.padStart(2, "0"), d.padStart(2, "0"));
  }
  /* Prose with a named month — "17 October 2026, 10:00 EAT". Date.parse
     cannot read African timezone abbreviations, so the offset is applied
     by hand: the notice's local wall-clock becomes the UTC instant. */
  const prose = cleaned.match(
    /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?\s*(EAT|CAT|SAST|WAT|GMT|UTC)?/i,
  );
  if (prose) {
    const [, d, mon, y, hh, mm, tz] = prose;
    const month = MONTHS[mon.toLowerCase()];
    if (month !== undefined) {
      const offsetH = tz ? (NAMED_TZ_OFFSETS[tz.toUpperCase()] ?? 0) : utcOffsetHours;
      const seconds = hh && mm ? 0 : 59;
      const utcMs = Date.UTC(Number(y), month, Number(d), Number(hh ?? 23), Number(mm ?? 59), seconds) - offsetH * 3_600_000;
      const dt = new Date(utcMs);
      return Number.isNaN(dt.getTime()) ? undefined : dt.toISOString();
    }
  }
  const named = Date.parse(cleaned);
  return Number.isNaN(named) ? undefined : new Date(named).toISOString();
}

/** A notice's closing date — "**Closing date:**", "**Deadline:**", or plain ISO prose. Pure. */
export function parseClosingDate(notice: string, utcOffsetHours = 0): string | undefined {
  for (const re of CLOSING_PATTERNS) {
    const m = notice.match(re);
    if (m) {
      const parsed = parseDateish(m[1], utcOffsetHours);
      if (parsed) return parsed;
    }
  }
  return undefined;
}

const SECURITY_LINE =
  /\*\*Bid security:?\*\*\s*(.*?)(?:$|\n)|^\s*[-*]\s*Bid security:?\s*(.*?)(?:$|\n)/im;

/** A bid's stated bid-security line: amount, currency and validity date when given. Pure. */
export function parseBidSecurity(bidText: string): BidSecurityLine | undefined {
  const m = bidText.match(SECURITY_LINE);
  if (!m) return undefined;
  const body = (m[1] ?? m[2] ?? "").trim();
  const amountMatch = body.match(/([A-Z]{3})\s*([\d][\d,]*(?:\.\d+)?)/);
  const dateMatch = body.match(/(\d{4}-\d{2}-\d{2})/);
  const amount = amountMatch ? Number(amountMatch[2].replace(/,/g, "")) : undefined;
  const blank = body.length === 0 || /^(?:[-–—.]+|n\/?a|tbd|tba|not\s+stated|none| waived)\s*$/i.test(body);
  return {
    stated: !blank,
    amount: Number.isFinite(amount) ? amount : undefined,
    currency: amountMatch?.[1],
    validUntil: dateMatch?.[1],
    raw: body.slice(0, 120),
  };
}

/* ── Integrity rules: bid securities (G10) and debarment screening (G4) ────── */

/* Local name matcher — same token discipline as the engine's registry match,
   kept here so this module stays import-free of the graph runtime. */
const LEGAL_SUFFIX = new Set(["ltd", "limited", "inc", "plc", "llc", "co", "group"]);

function nameTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !LEGAL_SUFFIX.has(t)),
  );
}

export function namesMatch(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  return [...small].every((t) => big.has(t));
}

/**
 * Bid securities: when the NOTICE makes a security relevant (it mentions one),
 * a bid with no security line, a blank one, an amount below the floor, or a
 * validity shorter than the margin is flagged — cited to the security line.
 * A pack whose notice never mentions a security is not judged: the absence of
 * an unrequired document is not a finding.
 */
export function bidSecurityFindings(
  bids: { bidder: string; text: string; source: string; value?: number; currency?: string }[],
  closingDate: string | undefined,
  opts: { required?: boolean; floorPct?: number } = {},
): Finding[] {
  const required = opts.required ?? false;
  const floorPct = opts.floorPct ?? BID_SECURITY_MIN_PCT;
  const findings: Finding[] = [];
  for (const bid of bids) {
    const sec = parseBidSecurity(bid.text);
    if (!sec) {
      if (required)
        findings.push({
          id: "",
          rule: "R-BID-SECURITY",
          severity: "HIGH",
          item: `${bid.bidder} — bid security`,
          evidence: "The notice calls for a bid security; the bid states no security line at all.",
          citation: `${bid.source}, bid security line`,
        });
      continue;
    }
    if (!sec.stated) {
      findings.push({
        id: "",
        rule: "R-BID-SECURITY",
        severity: "HIGH",
        item: `${bid.bidder} — bid security`,
        evidence: `The bid-security line states nothing ("${sec.raw}") — a placeholder is not a security.`,
        citation: `${bid.source}, bid security line`,
      });
      continue;
    }
    if (sec.amount !== undefined && bid.value !== undefined && bid.value > 0) {
      const pct = (sec.amount / bid.value) * 100;
      if (pct < floorPct) {
        findings.push({
          id: "",
          rule: "R-BID-SECURITY",
          severity: "HIGH",
          item: `${bid.bidder} — bid security amount`,
          evidence: `Bid security ${sec.currency ?? ""} ${sec.amount.toLocaleString()} is ${pct.toFixed(1)}% of the stated bid value — below the ${floorPct}% floor.`,
          citation: `${bid.source}, bid security line`,
        });
        continue;
      }
    }
    if (sec.validUntil && closingDate) {
      const margin = calendarDaysBetween(closingDate, sec.validUntil);
      if (margin < BID_SECURITY_VALIDITY_MARGIN_DAYS) {
        findings.push({
          id: "",
          rule: "R-BID-SECURITY",
          severity: "MEDIUM",
          item: `${bid.bidder} — bid security validity`,
          evidence: `Bid security valid until ${sec.validUntil} — only ${margin} day(s) beyond the closing date; the margin is ${BID_SECURITY_VALIDITY_MARGIN_DAYS} days.`,
          citation: `${bid.source}, bid security line`,
        });
      }
    }
  }
  return findings;
}

/**
 * Debarment screening: every bidder name is matched against the register.
 * A hit is HIGH and cites the bid itself — the committee sets the bid aside
 * before any evaluation effort is spent on it.
 */
export function debarmentFindings(
  bids: { bidder: string; text: string; source: string }[],
  list: { name: string; listedBy: string; ground: string; until?: string }[],
  nowIso = new Date().toISOString(),
): Finding[] {
  if (!list.length) return [];
  const findings: Finding[] = [];
  for (const bid of bids) {
    const hit = list.find((e) => namesMatch(bid.bidder, e.name));
    if (!hit) continue;
    if (hit.until && hit.until < nowIso.slice(0, 10)) continue; /* exclusion expired */
    findings.push({
      id: "",
      rule: "R-DEBARMENT-HIT",
      severity: "HIGH",
      item: bid.bidder,
      evidence: `Debarment register: "${hit.name}" listed by ${hit.listedBy} — ${hit.ground}${hit.until ? `; exclusion runs to ${hit.until}` : ""}. A debarred bidder must be set aside before evaluation.`,
      citation: `${bid.source}, bidder cover page`,
    });
  }
  return findings;
}

/* ── Notice authoring (G20): mandatory fields, checked, never invented ────── */

export const NOTICE_MANDATORY_FIELDS: { field: string; test: RegExp }[] = [
  { field: "Reference", test: /^\*\*Reference:\*\*\s*\S/m },
  { field: "Buyer", test: /^\*\*Buyer:\*\*\s*\S/m },
  { field: "Method", test: /^\*\*Method:\*\*\s*\S/m },
  { field: "Closing date", test: /\*\*(?:Closing(?: date)?|Deadline|Submission deadline)(?: for submissions)?:?\*\*\s*\S/i },
  { field: "Budget ceiling", test: /^\*\*Budget ceiling:\*\*\s*\S/m },
  { field: "Required documents", test: /^- \[REQUIRED\]/m },
  { field: "Contact", test: /^\*\*Contact:\*\*\s*\S/m },
];

export function noticeFieldCheck(md: string): NoticeFieldCheck[] {
  return NOTICE_MANDATORY_FIELDS.map(({ field, test }) => ({ field, present: test.test(md) }));
}

/** A compliant notice skeleton — the template fills what the caller provides, checks the rest. Pure. */
export function draftNoticeMd(input: {
  reference: string;
  buyer: string;
  method: string;
  closingDate?: string;
  ceiling?: string;
  requiredDocs?: string[];
  contact: string;
  subject: string;
}): string {
  const lines = [
    "# TENDER NOTICE",
    "",
    `**Reference:** ${input.reference}`,
    `**Buyer:** ${input.buyer}`,
    `**Subject:** ${input.subject}`,
    `**Method:** ${input.method}`,
    ...(input.ceiling ? [`**Budget ceiling:** ${input.ceiling}`] : []),
    ...(input.closingDate ? [`**Closing date:** ${input.closingDate}`] : []),
    "",
    "Eligibility — the following documents are REQUIRED with the bid:",
    ...(input.requiredDocs?.length ? input.requiredDocs.map((d) => `- [REQUIRED] ${d}`) : ["- [REQUIRED] (none listed — complete before publication)"]),
    "",
    `**Contact:** ${input.contact}`,
    "",
    "Bids must be deposited at the buyer's office or submitted through the e-procurement portal before the closing date. Late bids will be rejected unopened.",
  ];
  return lines.join("\n");
}

/* ── Responsiveness ladder (G2) — deterministic, from evidence that exists ── */

export interface LadderInput {
  late: boolean;
  missingSecurity: boolean;
  highDocMissing: boolean;
  debarred?: boolean;
}

export function responsivenessLadder(i: LadderInput): { responsiveness: Responsiveness; reasons: string[] } {
  const reasons: string[] = [];
  if (i.debarred) {
    reasons.push("bidder appears on the debarment register");
    return { responsiveness: "ADMINISTRATIVELY_NONRESPONSIVE", reasons };
  }
  if (i.late) {
    reasons.push("bid received after the closing date — late bids are rejected unopened");
    return { responsiveness: "ADMINISTRATIVELY_NONRESPONSIVE", reasons };
  }
  if (i.missingSecurity) {
    reasons.push("no valid bid security stated — fails the administrative checklist");
    return { responsiveness: "ADMINISTRATIVELY_NONRESPONSIVE", reasons };
  }
  if (i.highDocMissing) {
    reasons.push("a HIGH mandatory-document finding stands against the bid — fails substantial responsiveness");
    return { responsiveness: "MATERIALLY_NONRESPONSIVE", reasons };
  }
  return { responsiveness: "RESPONSIVE", reasons };
}

/* ── The scoring matrix (G1) — arithmetic the committee can check ─────────── */

export function weightsSum(criteria: EvalCriterion[]): number {
  return criteria.reduce((n, c) => n + (Number.isFinite(c.weight) ? c.weight : 0), 0);
}

export function validateCriteria(criteria: EvalCriterion[]): string | null {
  if (!Array.isArray(criteria) || criteria.length === 0) return "at least one evaluation criterion is required";
  if (criteria.length > 12) return "at most 12 criteria — a matrix is meant to be read";
  for (const c of criteria) {
    if (!c.title?.trim()) return "every criterion needs a title";
    if (!Number.isFinite(c.weight) || c.weight <= 0 || c.weight > 100) return `criterion "${c.title}" weight must be 1-100`;
  }
  const sum = weightsSum(criteria);
  if (Math.round(sum) !== 100) return `criterion weights must sum to 100 — they sum to ${Math.round(sum)}`;
  return null;
}

export function validateScores(criteria: EvalCriterion[], scores: EvalScoreInput[]): string | null {
  if (!Array.isArray(scores) || scores.length !== criteria.length)
    return `a score for each of the ${criteria.length} criteria is required`;
  for (const s of scores) {
    if (!criteria.some((c) => c.id === s.criterionId)) return `unknown criterion "${s.criterionId}"`;
    if (!Number.isFinite(s.score) || s.score < 0 || s.score > 100) return `score for "${s.criterionId}" must be 0-100`;
  }
  return null;
}

/** Weighted technical total: Σ(score × weight) / 100. Pure. */
export function technicalTotal(criteria: EvalCriterion[], scores: EvalScoreInput[]): number {
  const total = criteria.reduce((n, c) => {
    const s = scores.find((x) => x.criterionId === c.id);
    return n + (s ? s.score * c.weight : 0);
  }, 0);
  return Math.round((total / 100) * 10) / 10;
}

/** Financial formula: lowest evaluated price scores 100; others score lowest/price × 100. Pure. */
export function financialFormulaScores(values: (number | undefined)[]): number[] {
  const finite = values.filter((v): v is number => Number.isFinite(v) && (v ?? 0) > 0);
  const lowest = finite.length ? Math.min(...finite) : 0;
  if (lowest <= 0) return values.map(() => 0);
  return values.map((v) => (Number.isFinite(v) && (v ?? 0) > 0 ? Math.round(((lowest as number) / (v as number)) * 1000) / 10 : 0));
}

/** Re-draw every verdict from the evidence on the matrix. Pure — the one place totals are computed.
 *
 * When the matrix names an evaluation currency, every foreign bid is scored on
 * its converted evaluated price, and the bid carries the quote that put it
 * there. A price with no quote scores 0 on a draft and is refused at the gate —
 * never silently compared as if the currencies were the same. Legacy matrices
 * (no evaluation currency) keep their stated-amount arithmetic. */
export function scoreMatrix(matrix: EvalMatrix): EvalMatrix {
  const evaluated = matrix.bids.map((bid) => evaluatedPrice(matrix, bid.financial));
  const financials = evaluated.map((price) =>
    price.state === "LEGACY" || price.state === "SAME" || price.state === "CONVERTED" ? price.amount : undefined,
  );
  const scored = financialFormulaScores(financials);
  const bids = matrix.bids.map((b, i) => {
    const tech = technicalTotal(matrix.criteria, b.technicalScores);
    const price = evaluated[i];
    let financial: EvalBidResult["financial"];
    if (b.financial?.amount !== undefined) {
      financial = {
        amount: b.financial.amount,
        ...(b.financial.currency ? { currency: b.financial.currency } : {}),
        formulaScore: scored[i],
      };
      if (price.state === "CONVERTED") {
        financial = {
          ...financial,
          evaluatedAmount: price.amount,
          evaluatedCurrency: price.currency,
          fxRate: price.rate,
          fxSource: price.source,
          fxAsOf: price.asOf,
        };
      } else if (price.state === "UNCONVERTIBLE") {
        financial = { ...financial, fxError: price.reason };
      }
    }
    const total =
      financial?.formulaScore !== undefined
        ? Math.round((tech * (matrix.technicalWeightPct / 100) + (financial.formulaScore ?? 0) * (1 - matrix.technicalWeightPct / 100)) * 10) / 10
        : tech;
    const verdict: EvalBidResult["verdict"] =
      b.responsiveness === "RESPONSIVE" ? (total >= 50 ? "RECOMMENDED" : "NOT_RECOMMENDED") : "DISQUALIFIED";
    return { ...b, technicalTotal: tech, financial, total, verdict };
  });
  return { ...matrix, bids };
}

/** Apply a MED adjustment ("<bidder>|<criterionId>" → score) and re-score. Pure. */
export function applyMedAdjustments(matrix: EvalMatrix, adjustments: Record<string, number>): EvalMatrix {
  const bids = matrix.bids.map((b) => ({
    ...b,
    technicalScores: b.technicalScores.map((s) => {
      const key = `${b.bidder}|${s.criterionId}`;
      const v = adjustments[key];
      return v === undefined ? s : { ...s, score: v, note: `MED adjustment (was ${s.score})` };
    }),
  }));
  return scoreMatrix({ ...matrix, bids });
}

/* ── Opening the bids (G3/G8): late determination + statutory minutes ─────── */

export function isLate(receivedAt: string, closingDate: string | undefined): boolean {
  if (!closingDate) return false;
  const r = new Date(receivedAt);
  const c = new Date(closingDate);
  if (Number.isNaN(r.getTime()) || Number.isNaN(c.getTime())) return false;
  return r.getTime() > c.getTime();
}

export function buildOpeningRows(inputs: OpenBidInput[], closingDate: string | undefined): {
  rows: BidOpeningRegister["rows"];
  lateCount: number;
} {
  const rows = inputs.map((i) => ({
    bidder: i.bidder,
    source: i.source,
    receivedAt: i.receivedAt,
    late: isLate(i.receivedAt, closingDate),
    priceRead: i.priceRead,
  }));
  return { rows, lateCount: rows.filter((r) => r.late).length };
}

export function composeOpeningMinutes(reg: {
  tenderId: string;
  closingDate?: string;
  rows: BidOpeningRegister["rows"];
  openedAt: string;
}): string {
  const lines = [
    `# BID OPENING REGISTER — ${reg.tenderId}`,
    "",
    `Opened: ${reg.openedAt}`,
    `Closing date on record: ${reg.closingDate ?? "not stated in the pack — late determination not possible"}`,
    "",
    "| Bidder | Received | Late | Price read aloud |",
    "| --- | --- | --- | --- |",
    ...reg.rows.map(
      (r) =>
        `| ${r.bidder} | ${r.receivedAt} | ${r.late ? "YES — rejected unopened" : "no"} | ${r.priceRead ?? "—"} |`,
    ),
    "",
    `${reg.rows.filter((r) => !r.late).length} bid(s) admitted · ${reg.rows.filter((r) => r.late).length} late`,
    "",
    "_Bids were opened publicly; each bid and its price were read aloud and recorded above. The register is sealed with a sha-256 digest once certified by the procurement unit._",
  ];
  return lines.join("\n");
}

/* ── Abnormally low bids (G9) ──────────────────────────────────────────────── */

export function composeAlbLetter(input: {
  tenderId: string;
  bidder: string;
  finding: string;
  dueAt: string;
}): string {
  return [
    `# CLARIFICATION REQUEST — ABNORMALLY LOW BID`,
    "",
    `Tender: ${input.tenderId}`,
    `To: ${input.bidder}`,
    "",
    `Your bid has been identified for the following anomaly:`,
    "",
    `> ${input.finding}`,
    "",
    `Under the tender's clarification clause, you are invited to provide a written justification of your pricing within five (5) working days — by **${input.dueAt.slice(0, 10)}**. Your bid may be rejected if the justification is not provided or does not establish that the price is viable.`,
    "",
    "_Issued by the review desk. The request and its resolution are recorded in the tender's audit trail._",
  ].join("\n");
}

/* ── Award artifacts (G6/G7) ───────────────────────────────────────────────── */

export function composeAwardReport(input: {
  tenderId: string;
  title?: string;
  buyer?: string;
  matrix?: EvalMatrix;
  findings: {
    id?: string;
    rule: string;
    item: string;
    severity: string;
    disposition?: { status: string; by: string; at: string; note: string; secondedBy?: string };
  }[];
  complaints?: { complainant: string; subject: string; status: string }[];
  supplier?: string;
  value?: string;
  method?: string;
}): { md: string; recommendation?: string } {
  const ranked = input.matrix
    ? [...input.matrix.bids].filter((b) => b.responsiveness === "RESPONSIVE").sort((a, b) => (b.total ?? 0) - (a.total ?? 0))
    : [];
  const winner = input.supplier ?? ranked[0]?.bidder;
  const md = [
    `# AWARD RECOMMENDATION REPORT`,
    "",
    `**Tender:** ${input.tenderId}${input.title ? ` — ${input.title}` : ""}`,
    `**Buyer:** ${input.buyer ?? "—"}`,
    `**Method:** ${input.method ?? "—"}`,
    "",
    "## 1. Process",
    "",
    "The pack was reviewed by the quorum desk: requirements pinned from the notices, each bid read against them, every finding cited to its document and verified. The evaluation matrix below was certified by the evaluation committee.",
    "",
    "## 2. Findings carried into the decision",
    "",
    ...(input.findings.length
      ? input.findings.map((f) =>
          `- **${f.rule}** ${f.item} (${f.severity}) — ${
            f.disposition ? `${f.disposition.status} by ${f.disposition.by}` : "OPEN — no disposition"
          }`,
        )
      : ["- No findings stand against the admitted bids."]),
    "",
    "### Disposition table",
    "",
    "| Finding | Rule | Severity | Disposition | By | Reason |",
    "| --- | --- | --- | --- | --- | --- |",
    ...(input.findings.length
      ? input.findings.map((f) => {
          const d = f.disposition;
          const reason = (d?.note ?? "—").replace(/\|/g, "\\|");
          const by = d ? `${d.by}${d.secondedBy ? ` (seconded ${d.secondedBy})` : ""}` : "—";
          return `| ${f.id ?? "—"} | ${f.rule} | ${f.severity} | ${d?.status ?? "OPEN"} | ${by} | ${reason} |`;
        })
      : ["| — | — | — | — | — | No findings on record |"]),
    "",
    "### Complaints",
    "",
    ...(input.complaints?.length
      ? [
          "| Complainant | Subject | Status |",
          "| --- | --- | --- |",
          ...input.complaints.map((c) => `| ${c.complainant.replace(/\|/g, "\\|")} | ${c.subject.replace(/\|/g, "\\|")} | ${c.status} |`),
        ]
      : ["- No complaints on record."]),
    "",
    "## 3. Evaluation outcome",
    "",
    ...(input.matrix
      ? [
          `Criteria: ${input.matrix.criteria.map((c) => `${c.title} (${c.weight}%)`).join(", ")}`,
          `Technical/financial split: ${input.matrix.technicalWeightPct}/${100 - input.matrix.technicalWeightPct}`,
          "",
          "| Bidder | Responsive | Technical | Financial | Total | Verdict |",
          "| --- | --- | --- | --- | --- | --- |",
          ...input.matrix.bids.map(
            (b) =>
              `| ${b.bidder} | ${b.responsiveness} | ${b.technicalTotal} | ${b.financial?.formulaScore ?? "—"} | ${b.total ?? "—"} | ${b.verdict} |`,
          ),
          ...(input.matrix.evaluationCurrency
            ? [
                "",
                `Evaluated-price basis: **${input.matrix.evaluationCurrency}**.`,
                ...input.matrix.bids
                  .filter((b) => b.financial?.evaluatedAmount !== undefined)
                  .map(
                    (b) =>
                      `- ${b.bidder}: ${b.financial?.currency ?? input.matrix!.evaluationCurrency} ${b.financial?.amount.toLocaleString()} × ${b.financial?.fxRate} = ${b.financial?.evaluatedCurrency} ${b.financial?.evaluatedAmount?.toLocaleString()} (${b.financial?.fxSource ?? "source not recorded"}, observed ${b.financial?.fxAsOf?.slice(0, 10) ?? "—"})`,
                  ),
              ]
            : []),
        ]
      : ["_No certified matrix is attached to this report — the award rests on the findings and the pack._"]),
    "",
    "## 4. Recommendation",
    "",
    winner
      ? `Award to **${winner}**${input.value ? ` at ${input.value}` : ""}, subject to the accounting officer's signature and the statutory standstill.`
      : "No recommendation: no responsive bid achieved the pass mark. The committee may reject all bids and re-tender.",
    "",
    "## 5. Signatures",
    "",
    "- Evaluation committee chair: _signed at the certification gate_",
    "- Accounting officer: _signed at the award-report gate_",
  ].join("\n");
  return { md, recommendation: winner };
}

export function composeAwardNotice(input: {
  tenderId: string;
  buyer?: string;
  supplier?: string;
  value?: string;
  portal: string;
  publicationMode?: "SIMULATED" | "CONNECTED";
  receiptId?: string;
  standstillEndsAt?: string;
}): string {
  const connected = input.publicationMode === "CONNECTED";
  return [
    `# NOTICE OF AWARD`,
    "",
    `**Reference:** ${input.tenderId}`,
    `**Buyer:** ${input.buyer ?? "—"}`,
    `**Awarded to:** ${input.supplier ?? "—"}`,
    ...(input.value ? [`**Contract price:** ${input.value}`] : []),
    `**Publication status:** ${
      connected
        ? `transmitted to ${input.portal}${input.receiptId ? ` · receipt ${input.receiptId}` : ""}`
        : "SIMULATED — no transmission. This is not a publication receipt."
    }`,
    ...(input.standstillEndsAt
      ? [`**Standstill:** unsuccessful bidders may lodge a complaint until ${input.standstillEndsAt.slice(0, 10)} (working days 10).`]
      : []),
    "",
    ...(connected
      ? ["_This notice records a verified transmission to the external portal. The standstill period runs from publication._"]
      : [
          "_This notice is a recorded rehearsal. It has not been transmitted to an external portal. Its standstill clock is a rehearsal clock; no contract may be signed from it._",
        ]),
  ].join("\n");
}

export function composeDebriefLetter(input: {
  tenderId: string;
  bidder: string;
  responsiveness: string;
  reasons: string[];
  theirFindings: string[];
  winner?: string;
}): string {
  return [
    `# DEBRIEF LETTER — ${input.bidder}`,
    "",
    `Tender: ${input.tenderId}`,
    "",
    `Thank you for your bid. This debrief is qualitative: it explains why your bid did not succeed without disclosing another bidder's confidential pricing.`,
    "",
    `**Outcome:** your bid was recorded as ${input.responsiveness.replace(/_/g, " ").toLowerCase()} at the responsiveness stage.`,
    ...(input.reasons.length ? ["", "**Reasons:**", ...input.reasons.map((r) => `- ${r}`)] : []),
    ...(input.theirFindings.length
      ? ["", "**Findings that stood against your bid:**", ...input.theirFindings.map((f) => `- ${f}`)]
      : ["", "No findings stood against your bid specifically."]),
    "",
    "_You may request a full administrative review under the applicable procurement law within the standstill window._",
  ].join("\n");
}

/* ── Contract (G12/G13) ────────────────────────────────────────────────────── */

/**
 * A contract always has a contract value. The rule lives here so the pack
 * composer, the signing gate and its executor all ask the same question: no
 * path may open a contract at zero, because a zero-value contract cannot
 * carry a variation percentage, a payment certificate or a meaningful award.
 */
export function contractValueCheck(
  raw: unknown,
): { ok: true; value: number } | { ok: false; reason: string } {
  /* A gate may state the value as a number or as the line it was read from
     ("RWF 2,150,000,000") — the digits are the value either way. */
  const digits = String(raw ?? "").match(/-?\d[\d,]*(?:\.\d+)?/)?.[0];
  const value = typeof raw === "number" ? raw : digits ? Number(digits.replace(/,/g, "")) : Number.NaN;
  if (!Number.isFinite(value) || value <= 0) {
    return {
      ok: false,
      reason:
        "A contract always has a contract value — this award states no price. Record the winning bid's value before the contract pack is prepared or signed.",
    };
  }
  return { ok: true, value };
}

export function variationPctOfContract(contractValue: number, valueDelta: number): number {
  if (!Number.isFinite(contractValue) || contractValue <= 0) return 0;
  return Math.round((Math.abs(valueDelta) / contractValue) * 1000) / 10;
}

export function variationNeedsGate(pct: number, threshold = VARIATION_GATE_PCT): boolean {
  return pct >= threshold;
}

export function composeContractPack(input: {
  tenderId: string;
  supplier?: string;
  value?: number;
  currency?: string;
  awardRef?: string;
}): string {
  return [
    `# CONTRACT PACK — ${input.tenderId}`,
    "",
    `**Supplier:** ${input.supplier ?? "—"}`,
    `**Contract value:** ${input.value !== undefined ? `${input.currency ?? ""} ${input.value.toLocaleString()}`.trim() : "—"}`,
    ...(input.awardRef ? [`**Award receipt:** ${input.awardRef}`] : []),
    "",
    "## Contents",
    "",
    "1. Contract agreement — the buyer's standard form with the evaluated prices entered.",
    "2. Performance security — required from the supplier before commencement (amount per the contract form).",
    "3. Milestone schedule — negotiated delivery/works milestones with due dates (recorded in the register).",
    "4. Variation control — any variation at or above 10% of the contract value requires the accounting officer's signature at an irreversible gate.",
    "5. Payment certification — each payment is certified at a named gate before it leaves the desk.",
    "",
    "_The pack is prepared by the agent; the contract itself is signed by humans, outside this system._",
  ].join("\n");
}

/* ── Deadlines (G16) — derived, never stored twice ─────────────────────────── */

export function collectDeadlines(
  input: DeadlinesInput[],
  nowIso = new Date().toISOString(),
  clock?: JurisdictionPack,
): DeadlineItem[] {
  const items: DeadlineItem[] = [];
  for (const c of input) {
    if (c.closingDate && !c.opening?.certifiedAt) {
      items.push({ tenderId: c.tenderId, kind: "CLOSING", dueAt: c.closingDate });
    }
    for (const a of c.alb ?? []) {
      if (!a.resolution) items.push({ tenderId: c.tenderId, kind: "ALB_DUE", dueAt: a.responseDueAt, ref: a.bidder });
    }
    if (c.standstill && c.standstill.status === "ACTIVE") {
      items.push({ tenderId: c.tenderId, kind: "STANDSTILL_END", dueAt: c.standstill.endsAt });
    }
    for (const m of c.contract?.milestones ?? []) {
      if (m.status === "PENDING" && m.dueDate) items.push({ tenderId: c.tenderId, kind: "MILESTONE_DUE", dueAt: m.dueDate, ref: m.title });
    }
    for (const comp of c.complaints ?? []) {
      if (comp.status === "OPEN" || comp.status === "ESCALATED") {
        const due = clock
          ? addWorkingDaysIn(comp.receivedAt, clock.complaintResponseDays, clock)
          : addWorkingDays(comp.receivedAt, COMPLAINT_RESPONSE_DAYS);
        items.push({ tenderId: c.tenderId, kind: "COMPLAINT_DUE", dueAt: due, ref: comp.complainant });
      }
    }
  }
  return items
    .map((i) => ({ ...i, overdue: i.dueAt < nowIso }))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

/* ── The consolidated procurement file (G5) ────────────────────────────────── */

export function composeProcurementFile(input: {
  tenderId: string;
  title?: string;
  buyer?: string;
  cycle?: {
    closingDate?: string;
    method?: { id?: string; name?: string; justification?: string; approvalRef?: string; approvedBy?: string; approvedAt?: string };
    assurance?: {
      supplier: string;
      status: string;
      source?: string;
      checkedBy?: string;
      checkedAt?: string;
      expiresAt?: string;
      registryStatus?: string;
      taxStatus?: string;
      sanctions?: string;
      pep?: string;
      beneficialOwners?: number;
      documents?: number;
      failures?: string[];
    };
    opening?: BidOpeningRegister;
    matrix?: EvalMatrix;
    alb: AlbDossier[];
    awardReport?: { signedAt?: string; signedBy?: string; recommendation?: string; sha: string };
    awardNotice?: { publishedAt?: string; portal?: string; sha?: string };
    standstill?: { startsAt: string; endsAt: string; days: number; status: string };
    contract?: ContractFile;
    complaints: { complainant: string; subject: string; status: string; receivedAt: string }[];
    clarifications: { question: string; askedBy: string; answer?: string }[];
    addenda: Addendum[];
    coi: { member: string; declaration: string; declaredAt: string }[];
    debriefs: { bidder: string; status: string }[];
  };
  runs: {
    id: string;
    status: string;
    findings: {
      id: string;
      rule: string;
      item: string;
      severity: string;
      citation: string;
      disposition?: { status: string; by: string; note: string; secondedBy?: string };
      review?: { decision: string; by: string; at: string };
    }[];
    drafts: { id: string }[];
    startedAt: string;
  }[];
  gates: { id: string; tool: string; status: string; approver?: string; decidedAt?: string; receipt?: Record<string, unknown> }[];
  logVerified?: { ok: boolean; checked: number };
  dissents?: { stage: string; member: string; position: string; basis: string; recordedAt: string }[];
  exceptions?: { id: string; kind: string; status: string; title: string; requestedBy: string; decidedBy?: string }[];
  compliance?: { verdict: string; hardFails: { rule: string; detail: string }[]; lines: { rule: string; count: number; hardFail: boolean }[] };
  generatedAt: string;
  deployment?: { mode: string; label?: string; receiptId?: string };
}): string {
  const c = input.cycle;
  const lines: string[] = [
    `# PROCUREMENT FILE — ${input.tenderId}`,
    "",
    `**Tender:** ${input.tenderId}${input.title ? ` — ${input.title}` : ""}`,
    `**Buyer:** ${input.buyer ?? "—"}`,
    `**Generated:** ${input.generatedAt}`,
    ...(input.deployment && input.deployment.mode !== "CONNECTED"
      ? [
          "> **RECORD-ONLY — NOT A PUBLICATION RECEIPT.** This file was prepared without a connected external publication. No contract or payment may rest on it.",
          "",
        ]
      : []),
    ...(input.logVerified ? [`**Audit log chain:** ${input.logVerified.ok ? "verified" : "BROKEN"} (${input.logVerified.checked} entries)`] : []),
    "",
    "## 1. Solicitation",
    "",
    `- Closing date on record: ${c?.closingDate ?? "—"}`,
    `- Method: ${c?.method?.name ?? c?.method?.id ?? "— not recorded"}${c?.method?.approvedAt ? ` · approved ${c.method.approvedAt.slice(0, 10)} by ${c.method.approvedBy ?? "—"}` : ""}${c?.method?.approvalRef ? ` · authority ref ${c.method.approvalRef}` : ""}`,
    ...(c?.method?.justification ? [`- Method justification: ${c.method.justification}`] : []),
    `- Clarifications logged: ${c?.clarifications.length ?? 0} · Addenda: ${c?.addenda.length ?? 0}`,
    ...(c?.addenda ?? []).map((a) => `  - Addendum ${a.number}: ${a.summary}${a.extendsClosingTo ? ` — closing extended to ${a.extendsClosingTo.slice(0, 10)}` : ""}`),
    "",
    "## 2. Bid opening",
    "",
    ...(c?.opening
      ? [
          `- Register ${c.opening.id} · certified: ${c.opening.certifiedAt ? `yes, by ${c.opening.certifiedBy}` : "no"}${c.opening.sha ? ` · sha-256 ${c.opening.sha}` : ""}`,
          `- Bids opened: ${c.opening.rows.length} · late: ${c.opening.rows.filter((r) => r.late).length}`,
        ]
      : ["- No opening register on record."]),
    "",
    "## 3. Integrity",
    "",
    ...(c?.coi.length
      ? c.coi.map((d) => `- COI: ${d.member} — ${d.declaration.replace(/_/g, " ").toLowerCase()} (${d.declaredAt.slice(0, 10)})`)
      : ["- No conflict-of-interest declarations on record."]),
    "",
    "## 4. Review runs and findings",
    "",
    ...(input.runs.length
      ? input.runs.flatMap((r) => [
          `### Run ${r.id} — ${r.status} (${r.startedAt.slice(0, 10)})`,
          ...(r.findings.length
            ? r.findings.map((f) =>
                `- ${f.id} ${f.rule} — ${f.item} (${f.severity}) · ${f.citation} · ${
                  f.disposition ? `${f.disposition.status} by ${f.disposition.by}${f.disposition.secondedBy ? ` (seconded ${f.disposition.secondedBy})` : ""}: ${f.disposition.note}` : "OPEN"
                }`,
              )
            : ["- no findings"]),
        ])
      : ["- No review runs on record."]),
    "",
    "## 5. Evaluation",
    "",
    ...(c?.matrix
      ? [
          `- Matrix ${c.matrix.id} — ${c.matrix.status}${c.matrix.certifiedBy ? ` by ${c.matrix.certifiedBy}` : ""}`,
          `- Criteria: ${c.matrix.criteria.map((x) => `${x.title} (${x.weight}%)`).join(", ")}`,
          ...(c.matrix.evaluationCurrency ? [`- Evaluated-price basis: ${c.matrix.evaluationCurrency}`] : []),
          ...(c.matrix.fxRates ?? []).map(
            (rate) =>
              `  - FX ${rate.base}→${rate.quote} ${rate.rate} · ${rate.source} · observed ${rate.asOf.slice(0, 10)}`,
          ),
          ...c.matrix.bids.map((b) =>
            `  - ${b.bidder}: ${b.responsiveness} · technical ${b.technicalTotal} · total ${b.total ?? "—"} · ${b.verdict}${b.financial?.evaluatedAmount !== undefined ? ` · evaluated ${b.financial.evaluatedCurrency} ${b.financial.evaluatedAmount.toLocaleString()}` : ""}`,
          ),
          ...(c.matrix.sheets?.length ? [`- Evaluator sheets: ${c.matrix.sheets.length}`] : []),
          ...(c.matrix.consensus ? [`- Consensus recorded ${c.matrix.consensus.recordedAt.slice(0, 10)} by ${c.matrix.consensus.recordedBy}`] : []),
          ...(c.matrix.med ? [`- MED recorded ${c.matrix.med.recordedAt.slice(0, 10)} with ${c.matrix.med.attendees.length} attendee(s)`] : []),
        ]
      : ["- No evaluation matrix on record."]),
    ...(c?.alb.length
      ? c.alb.map((a) => `- ALB dossier ${a.bidder}: due ${a.responseDueAt.slice(0, 10)}${a.resolution ? ` · ${a.resolution.outcome} — ${a.resolution.note}` : " · open"}`)
      : []),
    "",
    "## 6. Award",
    "",
    ...(c?.assurance
      ? [
          `- Supplier assurance — ${c.assurance.supplier}: ${c.assurance.status} · ${c.assurance.source ?? "source not recorded"}${c.assurance.checkedBy ? ` by ${c.assurance.checkedBy}` : ""}${c.assurance.checkedAt ? ` on ${c.assurance.checkedAt.slice(0, 10)}` : ""}${c.assurance.expiresAt ? ` · expires ${c.assurance.expiresAt.slice(0, 10)}` : ""}`,
          `  - Registry ${c.assurance.registryStatus ?? "—"} · tax ${c.assurance.taxStatus ?? "—"} · sanctions ${c.assurance.sanctions ?? "—"} · PEP ${c.assurance.pep ?? "—"} · beneficial owners ${c.assurance.beneficialOwners ?? 0} · documents ${c.assurance.documents ?? 0}`,
          ...(c.assurance.failures?.length ? [`  - Failures: ${c.assurance.failures.join("; ")}`] : []),
        ]
      : ["- No supplier assurance check on record."]),
    ...(c?.awardReport
      ? [
          `- Recommendation: ${c.awardReport.recommendation ?? "—"}`,
          `- Report signed: ${c.awardReport.signedAt ? `${c.awardReport.signedAt.slice(0, 10)} by ${c.awardReport.signedBy}` : "no"} · sha ${c.awardReport.sha}`,
        ]
      : ["- No award report on record."]),
    ...(c?.awardNotice
      ? [`- Notice published: ${c.awardNotice.publishedAt ? `${c.awardNotice.publishedAt.slice(0, 10)} to ${c.awardNotice.portal}` : "no"} · sha ${c.awardNotice.sha ?? "—"}`]
      : []),
    ...(input.deployment
      ? [
          `- Publication mode: ${input.deployment.mode}${input.deployment.label ? ` — ${input.deployment.label}` : ""}${input.deployment.receiptId ? ` · receipt ${input.deployment.receiptId}` : ""}`,
        ]
      : []),
    ...(c?.standstill ? [`- Standstill: ${c.standstill.startsAt.slice(0, 10)} → ${c.standstill.endsAt.slice(0, 10)} (${c.standstill.days} working days, ${c.standstill.status})`] : []),
    ...(c?.debriefs.length ? c.debriefs.map((d) => `- Debrief ${d.bidder}: ${d.status}`) : []),
    "",
    "## 7. Gates and decisions",
    "",
    ...(input.gates.length
      ? input.gates.map((g) => `- ${g.tool} ${g.id} — ${g.status}${g.approver ? ` by ${g.approver}` : ""}${g.decidedAt ? ` at ${g.decidedAt.slice(0, 16).replace("T", " ")}` : ""}${g.receipt?.submissionId ? ` · receipt ${g.receipt.submissionId}` : ""}`)
      : ["- No gates on record."]),
    "",
    "## 8. Complaints",
    "",
    ...(c?.complaints.length
      ? c.complaints.map((x) => `- ${x.complainant}: ${x.subject} — ${x.status} (${x.receivedAt.slice(0, 10)})`)
      : ["- None on record."]),
    "",
    "## 9. Dissents and minority positions",
    "",
    ...(input.dissents?.length
      ? input.dissents.map(
          (d) => `- ${d.member} — ${d.position.replace(/_/g, " ").toLowerCase()} on ${d.stage.replace(/_/g, " ").toLowerCase()} (${d.recordedAt.slice(0, 10)}): ${d.basis}`,
        )
      : ["- None recorded. A dissent is a right, not a defect — its absence means none was declared."]),
    "",
    "## 10. Exceptions",
    "",
    ...(input.exceptions?.length
      ? input.exceptions.map(
          (e) => `- ${e.id} ${e.kind.replace(/_/g, " ").toLowerCase()} — ${e.status}${e.decidedBy ? ` by ${e.decidedBy}` : ""} · requested by ${e.requestedBy}: ${e.title}`,
        )
      : ["- None on record."]),
    "",
    "## 11. Compliance verdict",
    "",
    ...(input.compliance
      ? [
          `- Verdict: ${input.compliance.verdict}`,
          ...(input.compliance.hardFails.length
            ? input.compliance.hardFails.map((h) => `  - HARD FAIL ${h.rule}: ${h.detail}`)
            : ["- No hard-fail conditions."]),
          `- Rule lines on record: ${input.compliance.lines.length}`,
        ]
      : ["- Compliance summary not computed at file time."]),
    "",
    "## 12. Contract administration",
    "",
    ...(c?.contract
      ? [
          `- Contract with ${c.contract.supplier} — ${c.contract.currency ?? ""} ${c.contract.value.toLocaleString()}${c.contract.status ? ` · ${c.contract.status}` : " · LEGACY_UNEXECUTED"}${c.contract.completedAt ? ` · completed ${c.contract.completedAt.slice(0, 10)}` : ""}`,
          `- Execution: ${c.contract.executedAt ? `${c.contract.executedAt.slice(0, 10)} by ${c.contract.executedBy ?? "—"}` : "not executed — no payment may certify"}`,
          `- Supplier acceptance: ${c.contract.supplierAcceptedAt ? `${c.contract.supplierAcceptedAt.slice(0, 10)} by ${c.contract.supplierSignatory ?? "—"}` : "not recorded"}`,
          ...(c.contract.security
            ? [`- Performance security: ${c.contract.security.amount.toLocaleString()} · ${c.contract.security.issuer} · valid to ${c.contract.security.validUntil.slice(0, 10)}`]
            : ["- Performance security: none"]),
          ...(c.contract.insurance
            ? [`- Insurance: ${c.contract.insurance.policyNo} · ${c.contract.insurance.issuer} · valid to ${c.contract.insurance.validUntil.slice(0, 10)}`]
            : ["- Insurance: none"]),
          `- Retention: ${c.contract.retentionPct ?? 0}% · warranty: ${c.contract.warrantyDays ?? 0} days`,
          `- Milestones: ${c.contract.milestones.map((m) => `${m.title} (${m.status})`).join(", ") || "none"}`,
          `- Variations: ${c.contract.variations.map((v) => `${v.description} ${v.pctOfContract}%${v.cumulativePct !== undefined ? ` (cumulative ${v.cumulativePct}%)` : ""} (${v.status})`).join("; ") || "none"}`,
          `- Payments: ${c.contract.payments.length} raised · ${c.contract.payments
            .map((p) => `${p.description} gross ${p.amount.toLocaleString()}${p.net !== undefined ? ` net ${p.net.toLocaleString()}` : ""} (${p.status ?? (p.certifiedAt ? "CERTIFIED" : "PENDING")})`)
            .join("; ") || "none"}`,
          `- Performance security held: ${c.contract.performanceSecurity.length ? c.contract.performanceSecurity.map((s) => `${s.instrument.replace(/_/g, " ").toLowerCase()} ${s.currency ?? ""} ${s.amount.toLocaleString()}${s.verifiedBy ? ` (verified by ${s.verifiedBy})` : " (unverified)"}`).join("; ") : "none on record"}`,
          `- Payments certified: ${c.contract.payments.length}`,
        ]
      : ["- No contract on record."]),
  ];
  return lines.join("\n");
}

/* ── Analytics (G15) — read-side only ──────────────────────────────────────── */

export function cycleAnalytics(input: {
  cycles: {
    tenderId: string;
    closingDate?: string;
    opening?: BidOpeningRegister;
    matrix?: EvalMatrix;
    alb: AlbDossier[];
    awardReport?: { signedAt?: string };
    standstill?: { status: string };
    contract?: ContractFile;
    complaints: Complaint[];
    clarifications: Clarification[];
    addenda: Addendum[];
  }[];
  runs: { tenderId: string; findings: unknown[]; status: string; startedAt: string }[];
}): Record<string, number | string> {
  const cycles = input.cycles;
  const bidsOpened = cycles.reduce((n, c) => n + (c.opening?.rows.length ?? 0), 0);
  const lateBids = cycles.reduce((n, c) => n + (c.opening?.rows.filter((r) => r.late).length ?? 0), 0);
  const certifiedMatrices = cycles.filter((c) => c.matrix?.status === "CERTIFIED").length;
  const albOpen = cycles.reduce((n, c) => n + (c.alb.filter((a) => !a.resolution).length ?? 0), 0);
  const complaints = cycles.reduce((n, c) => n + c.complaints.length, 0);
  const openComplaints = cycles.reduce((n, c) => n + c.complaints.filter((x) => x.status === "OPEN" || x.status === "ESCALATED").length, 0);
  const findingsTotal = input.runs.reduce((n, r) => n + r.findings.length, 0);
  const contractsActive = cycles.filter((c) => c.contract && !c.contract.completedAt).length;
  const contractsClosed = cycles.filter((c) => c.contract?.completedAt).length;
  /* Average findings per reviewed tender */
  const reviewed = new Set(input.runs.map((r) => r.tenderId)).size;
  return {
    tendersInCycle: cycles.length,
    bidsOpened,
    lateBids,
    onTimeBids: bidsOpened - lateBids,
    certifiedMatrices,
    albOpen,
    complaints,
    openComplaints,
    findingsTotal,
    findingsPerTender: reviewed ? Math.round((findingsTotal / reviewed) * 10) / 10 : 0,
    contractsActive,
    contractsClosed,
    standstillsActive: cycles.filter((c) => c.standstill?.status === "ACTIVE").length,
  };
}
