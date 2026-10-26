import { describe, expect, test } from "bun:test";
import {
  ADDENDUM_MIN_NOTICE_DAYS,
  BID_SECURITY_MIN_PCT,
  STANDSTILL_DAYS,
  VARIATION_GATE_PCT,
  addWorkingDays,
  applyMedAdjustments,
  bidSecurityFindings,
  buildOpeningRows,
  calendarDaysBetween,
  collectDeadlines,
  composeAwardReport,
  composeProcurementFile,
  contractValueCheck,
  cycleAnalytics,
  debarmentFindings,
  draftNoticeMd,
  financialFormulaScores,
  isLate,
  namesMatch,
  noticeFieldCheck,
  parseBidSecurity,
  parseClosingDate,
  responsivenessLadder,
  scoreMatrix,
  technicalTotal,
  validateCriteria,
  validateScores,
  variationNeedsGate,
  variationPctOfContract,
  weightsSum,
  workingDaysBetween,
} from "./cycle";
import type { EvalMatrix, EvalCriterion, Finding } from "./store";
import { verifyFindingReason } from "./engine";

/* ── Working-day arithmetic ────────────────────────────────────────────────── */

describe("working-day math", () => {
  test("addWorkingDays skips Saturday and Sunday", () => {
    // Friday 2026-10-16 → 1 wd = Mon 19th, 2 wd = Tue 20th
    expect(addWorkingDays("2026-10-16T10:00:00Z", 1).slice(0, 10)).toBe("2026-10-19");
    expect(addWorkingDays("2026-10-16T10:00:00Z", 2).slice(0, 10)).toBe("2026-10-20");
    // Wednesday → 5 working days lands the following Wednesday (weekend skipped)
    expect(addWorkingDays("2026-10-14T10:00:00Z", 5).slice(0, 10)).toBe("2026-10-21");
  });

  test("workingDaysBetween counts only working days", () => {
    // Fri → Mon = 1 working day
    expect(workingDaysBetween("2026-10-16T00:00:00Z", "2026-10-19T00:00:00Z")).toBe(1);
    // Mon → Fri = 4
    expect(workingDaysBetween("2026-10-19T00:00:00Z", "2026-10-23T00:00:00Z")).toBe(4);
    expect(workingDaysBetween("2026-10-23T00:00:00Z", "2026-10-19T00:00:00Z")).toBe(0);
  });

  test("calendarDaysBetween is plain day arithmetic", () => {
    expect(calendarDaysBetween("2026-10-16", "2026-10-19")).toBe(3);
    expect(calendarDaysBetween("2026-10-19", "2026-10-16")).toBeLessThan(0);
  });
});

/* ── Closing-date parser (G3) ──────────────────────────────────────────────── */

describe("closing date parser", () => {
  test("reads the notice's closing line in ISO form", () => {
    expect(parseClosingDate("**Closing date:** 2026-10-30 at 14:00")?.slice(0, 10)).toBe("2026-10-30");
  });
  test("reads Deadline and submission-deadline spellings", () => {
    expect(parseClosingDate("**Deadline:** 2026-11-02")?.slice(0, 10)).toBe("2026-11-02");
    expect(parseClosingDate("**Submission deadline:** 2026-11-03T12:00")?.slice(0, 10)).toBe("2026-11-03");
  });
  test("reads DD/MM/YYYY (the format the region's notices use)", () => {
    expect(parseClosingDate("**Closing date:** 30/10/2026, 14:00 hrs")?.slice(0, 10)).toBe("2026-10-30");
  });
  test("reads the bare **Closing:** spelling with a named month and EAT", () => {
    // 17 October 2026, 10:00 EAT = 07:00 UTC
    const got = parseClosingDate("**Closing:** 17 October 2026, 10:00 EAT · Open tender");
    expect(got).toBe("2026-10-17T07:00:00.000Z");
  });
  test("converts the other African timezone abbreviations too", () => {
    expect(parseClosingDate("**Closing:** 20 March 2027, 10:00 CAT")?.slice(0, 16)).toBe("2027-03-20T08:00");
    expect(parseClosingDate("**Closing:** 30 January 2027, 10:00 WAT")?.slice(0, 16)).toBe("2027-01-30T09:00");
  });
  test("a prose closing without a time falls to end-of-day local", () => {
    expect(parseClosingDate("**Closing:** 20 March 2027")?.slice(0, 10)).toBe("2027-03-20");
  });
  test("returns undefined when the notice states none", () => {
    expect(parseClosingDate("# NOTICE\nno dates here")).toBeUndefined();
  });
});

/* ── Bid securities (G10) ──────────────────────────────────────────────────── */

const BID_WITH_SECURITY =
  "**Bidder:** Coastline\n**Bid value:** KES 1,000,000\n**Bid security:** KES 30,000 valid until 2026-12-31\n";
const BID_LOW_SECURITY =
  "**Bidder:** Skint\n**Bid value:** KES 1,000,000\n**Bid security:** KES 5,000 valid until 2026-12-31\n";
const BID_SHORT_VALIDITY =
  "**Bidder:** Early\n**Bid value:** KES 1,000,000\n**Bid security:** KES 30,000 valid until 2026-10-20\n";
const BID_BLANK_SECURITY = "**Bidder:** Blank\n**Bid security:** —\n";
const BID_NO_SECURITY = "**Bidder:** Naked\n**Bid value:** KES 1,000,000\n";

describe("bid security rule (G10)", () => {
  test("parses amount, currency and validity from the security line", () => {
    const sec = parseBidSecurity(BID_WITH_SECURITY);
    expect(sec?.stated).toBe(true);
    expect(sec?.amount).toBe(30_000);
    expect(sec?.currency).toBe("KES");
    expect(sec?.validUntil).toBe("2026-12-31");
  });

  test("a stated security within the floor and margin stays silent", () => {
    expect(bidSecurityFindings([{ bidder: "C", text: BID_WITH_SECURITY, source: "02-bid.md", value: 1_000_000 }], "2026-10-30")).toHaveLength(0);
  });

  test("flags an amount below the floor with the percentage", () => {
    const [f] = bidSecurityFindings([{ bidder: "S", text: BID_LOW_SECURITY, source: "03-bid.md", value: 1_000_000 }], "2026-10-30");
    expect(f.rule).toBe("R-BID-SECURITY");
    expect(f.evidence).toContain("0.5%");
    expect(f.evidence).toContain(`${BID_SECURITY_MIN_PCT}% floor`);
  });

  test("flags a validity shorter than the margin beyond closing", () => {
    const [f] = bidSecurityFindings([{ bidder: "E", text: BID_SHORT_VALIDITY, source: "04-bid.md", value: 1_000_000 }], "2026-10-30");
    expect(f.severity).toBe("MEDIUM");
    expect(f.evidence).toContain("10 day(s)");
  });

  test("flags a blank security line as a placeholder", () => {
    const [f] = bidSecurityFindings([{ bidder: "B", text: BID_BLANK_SECURITY, source: "05-bid.md" }], undefined);
    expect(f.evidence).toContain("placeholder");
  });

  test("a missing security line is flagged ONLY when the notice requires one", () => {
    const bids = [{ bidder: "N", text: BID_NO_SECURITY, source: "06-bid.md" }];
    expect(bidSecurityFindings(bids, undefined, { required: false })).toHaveLength(0);
    const [f] = bidSecurityFindings(bids, undefined, { required: true });
    expect(f.rule).toBe("R-BID-SECURITY");
    expect(f.evidence).toContain("states no security line");
  });

  test("the finding passes the self-check against its cited bid", () => {
    const [f] = bidSecurityFindings([{ bidder: "S", text: BID_LOW_SECURITY, source: "03-bid.md", value: 1_000_000 }], "2026-10-30");
    expect(verifyFindingReason(f, { "03-bid.md": BID_LOW_SECURITY })).toBeNull();
    expect(verifyFindingReason(f, { "other.md": "x" })).toContain("not in this tender");
  });
});

/* ── Debarment screening (G4) ──────────────────────────────────────────────── */

const DEBARMENT_LIST = [
  { name: "Meridian Construction Group", listedBy: "PPDA Kenya", ground: "fraudulent bid securities", until: "2030-02-28" },
  { name: "Zenith Medical Distributors", listedBy: "World Bank", ground: "collusive practices" },
];

describe("debarment rule (G4)", () => {
  const bids = [
    { bidder: "MERIDIAN CONSTRUCTION", text: "bid body", source: "02-bid-meridian.md" },
    { bidder: "Zenith Medical Distributors Ltd", text: "bid body", source: "03-bid-zenith.md" },
    { bidder: "Clean Supplier", text: "bid body", source: "04-bid-clean.md" },
  ];

  test("matches on significant name tokens, ignoring legal suffixes and case", () => {
    expect(namesMatch("MERIDIAN CONSTRUCTION", "Meridian Construction Group")).toBe(true);
    expect(namesMatch("Zenith Medical Distributors Ltd", "Zenith Medical Distributors")).toBe(true);
    expect(namesMatch("Clean Supplier", "Meridian Construction Group")).toBe(false);
  });

  test("flags each listed bidder HIGH, citing the bid", () => {
    const findings = debarmentFindings(bids, DEBARMENT_LIST, "2026-10-20T00:00:00Z");
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.rule === "R-DEBARMENT-HIT" && f.severity === "HIGH")).toBe(true);
    expect(findings[0].citation).toBe("02-bid-meridian.md, bidder cover page");
  });

  test("an expired exclusion no longer bites", () => {
    const expired = [{ name: "Old Co", listedBy: "x", ground: "y", until: "2020-01-01" }];
    expect(debarmentFindings([{ bidder: "Old Co", text: "t", source: "02-b.md" }], expired, "2026-10-20T00:00:00Z")).toHaveLength(0);
  });

  test("the finding passes the self-check against its cited bid", () => {
    const [f] = debarmentFindings([bids[0]], DEBARMENT_LIST, "2026-10-20T00:00:00Z");
    expect(verifyFindingReason(f, { "02-bid-meridian.md": "bid body" })).toBeNull();
  });
});

/* ── Responsiveness ladder (G2) ────────────────────────────────────────────── */

describe("responsiveness ladder (G2)", () => {
  test("late → administratively nonresponsive", () => {
    const r = responsivenessLadder({ late: true, missingSecurity: false, highDocMissing: false });
    expect(r.responsiveness).toBe("ADMINISTRATIVELY_NONRESPONSIVE");
    expect(r.reasons[0]).toContain("closing date");
  });
  test("missing security → administratively nonresponsive", () => {
    expect(responsivenessLadder({ late: false, missingSecurity: true, highDocMissing: false }).responsiveness).toBe("ADMINISTRATIVELY_NONRESPONSIVE");
  });
  test("debarment outranks everything", () => {
    const r = responsivenessLadder({ late: true, missingSecurity: true, highDocMissing: true, debarred: true });
    expect(r.reasons[0]).toContain("debarment");
  });
  test("a HIGH missing-document finding → materially nonresponsive", () => {
    const r = responsivenessLadder({ late: false, missingSecurity: false, highDocMissing: true });
    expect(r.responsiveness).toBe("MATERIALLY_NONRESPONSIVE");
  });
  test("clean bid → responsive", () => {
    expect(responsivenessLadder({ late: false, missingSecurity: false, highDocMissing: false }).responsiveness).toBe("RESPONSIVE");
  });
});

/* ── The scoring matrix (G1) ───────────────────────────────────────────────── */

const CRITERIA: EvalCriterion[] = [
  { id: "C-01", title: "Technical compliance", weight: 40 },
  { id: "C-02", title: "Experience", weight: 30 },
  { id: "C-03", title: "Delivery plan", weight: 30 },
];

function matrixWith(bidders: { bidder: string; scores: number[]; amount?: number }[], over: Partial<EvalMatrix> = {}): EvalMatrix {
  return {
    id: "mtx_test",
    tenderId: "T-1",
    criteria: CRITERIA,
    technicalWeightPct: 80,
    bids: bidders.map((b) => ({
      bidder: b.bidder,
      late: false,
      responsiveness: "RESPONSIVE" as const,
      reasons: [],
      technicalScores: CRITERIA.map((c, i) => ({ criterionId: c.id, score: b.scores[i] })),
      technicalTotal: 0,
      financial: b.amount !== undefined ? { amount: b.amount, currency: "KES" } : undefined,
      verdict: "NOT_RECOMMENDED" as const,
    })),
    status: "DRAFT",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("scoring matrix (G1)", () => {
  test("weights must sum to exactly 100", () => {
    expect(validateCriteria(CRITERIA)).toBeNull();
    expect(validateCriteria([...CRITERIA, { id: "C-04", title: "X", weight: 10 }])).toContain("must sum to 100");
    expect(validateCriteria([])).toContain("at least one");
    expect(validateCriteria([{ id: "C-01", title: "X", weight: 0 }])).toContain("weight must be 1-100");
  });

  test("every criterion needs a score 0-100", () => {
    expect(validateScores(CRITERIA, CRITERIA.map((c) => ({ criterionId: c.id, score: 50 })))).toBeNull();
    expect(validateScores(CRITERIA, [{ criterionId: "C-01", score: 50 }])).toContain("each of the 3");
    expect(validateScores(CRITERIA, CRITERIA.map((c) => ({ criterionId: c.id, score: 101 })))).toContain("0-100");
    expect(validateScores(CRITERIA, [{ criterionId: "C-99", score: 50 }, { criterionId: "C-01", score: 1 }, { criterionId: "C-02", score: 2 }])).toContain("unknown criterion");
  });

  test("technicalTotal is the weighted sum", () => {
    expect(technicalTotal(CRITERIA, [{ criterionId: "C-01", score: 80 }, { criterionId: "C-02", score: 60 }, { criterionId: "C-03", score: 70 }])).toBe(71);
  });

  test("financial formula: lowest price scores 100, others scale", () => {
    expect(financialFormulaScores([1_000_000, 2_000_000, 1_250_000])).toEqual([100, 50, 80]);
  });

  test("scoreMatrix computes totals and verdicts; a disqualified bid never ranks", () => {
    const m = scoreMatrix(
      matrixWith(
        [
          { bidder: "Alpha", scores: [80, 70, 60], amount: 1_000_000 },
          { bidder: "Beta", scores: [50, 50, 50], amount: 1_200_000 },
        ],
        {
          bids: [
            {
              bidder: "Alpha", late: false, responsiveness: "RESPONSIVE" as const, reasons: [],
              technicalScores: CRITERIA.map((c, i) => ({ criterionId: c.id, score: [80, 70, 60][i] })),
              technicalTotal: 0, financial: { amount: 1_000_000, currency: "KES" }, verdict: "NOT_RECOMMENDED" as const,
            },
            {
              bidder: "Beta", late: true, responsiveness: "ADMINISTRATIVELY_NONRESPONSIVE" as const, reasons: ["late"],
              technicalScores: CRITERIA.map((c, i) => ({ criterionId: c.id, score: 50 })),
              technicalTotal: 0, financial: { amount: 1_200_000, currency: "KES" }, verdict: "NOT_RECOMMENDED" as const,
            },
          ],
        },
      ),
    );
    const alpha = m.bids.find((b) => b.bidder === "Alpha")!;
    const beta = m.bids.find((b) => b.bidder === "Beta")!;
    expect(alpha.technicalTotal).toBe(71);
    expect(alpha.financial?.formulaScore).toBe(100);
    expect(alpha.total).toBe(Math.round((71 * 0.8 + 100 * 0.2) * 10) / 10);
    expect(alpha.verdict).toBe("RECOMMENDED");
    expect(beta.verdict).toBe("DISQUALIFIED");
  });

  test("a responsive bid below 50 total is NOT_RECOMMENDED", () => {
    const m = scoreMatrix(matrixWith([{ bidder: "Weak", scores: [40, 40, 40] }]));
    expect(m.bids[0].total).toBe(40);
    expect(m.bids[0].verdict).toBe("NOT_RECOMMENDED");
  });

  test("MED adjustments re-score and are labelled on the score", () => {
    const base = scoreMatrix(matrixWith([{ bidder: "Alpha", scores: [50, 50, 50], amount: 1_000_000 }]));
    const med = applyMedAdjustments(base, { "Alpha|C-01": 90 });
    expect(med.bids[0].technicalScores[0].score).toBe(90);
    expect(med.bids[0].technicalScores[0].note).toContain("MED adjustment");
    expect(med.bids[0].technicalScores[1].score).toBe(50);
    expect(med.bids[0].technicalTotal).toBe(66);
  });

  test("weightsSum is a plain sum", () => {
    expect(weightsSum(CRITERIA)).toBe(100);
  });
});

/* ── Bid opening (G3/G8) ───────────────────────────────────────────────────── */

describe("bid opening (G3/G8)", () => {
  test("late determination is a timestamp comparison against the closing date", () => {
    expect(isLate("2026-10-30T13:59:00Z", "2026-10-30T14:00:00Z")).toBe(false);
    expect(isLate("2026-10-30T14:01:00Z", "2026-10-30T14:00:00Z")).toBe(true);
    expect(isLate("2026-10-30T14:01:00Z", undefined)).toBe(false);
  });

  test("rows are built with late flags and a count", () => {
    const { rows, lateCount } = buildOpeningRows(
      [
        { bidder: "Early Bird", receivedAt: "2026-10-30T10:00:00Z", priceRead: "KES 100" },
        { bidder: "Latecomer", receivedAt: "2026-10-30T15:00:00Z" },
      ],
      "2026-10-30T14:00:00Z",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].late).toBe(false);
    expect(rows[1].late).toBe(true);
    expect(lateCount).toBe(1);
  });
});

/* ── Notice authoring (G20) ────────────────────────────────────────────────── */

describe("notice authoring (G20)", () => {
  test("a complete draft passes every mandatory field", () => {
    const md = draftNoticeMd({
      reference: "KE-TEST-2026-001",
      buyer: "Ministry of Health",
      method: "Open competitive bidding",
      subject: "Supply of test kits",
      closingDate: "2026-12-01",
      ceiling: "KES 50,000,000",
      requiredDocs: ["Tax clearance certificate"],
      contact: "procurement@health.go.ke",
    });
    const check = noticeFieldCheck(md);
    expect(check.every((f) => f.present)).toBe(true);
  });

  test("a draft missing the ceiling and closing fails exactly those fields", () => {
    const md = draftNoticeMd({
      reference: "KE-TEST-2026-002",
      buyer: "Ministry of Health",
      method: "Open competitive bidding",
      subject: "X",
      contact: "procurement@health.go.ke",
    });
    const missing = noticeFieldCheck(md).filter((f) => !f.present).map((f) => f.field);
    expect(missing).toEqual(["Closing date", "Budget ceiling"]);
  });
});

/* ── Contract value (G12) ──────────────────────────────────────────────────── */

describe("contract value", () => {
  test("a contract always carries a positive value", () => {
    expect(contractValueCheck(2_150_000_000)).toEqual({ ok: true, value: 2_150_000_000 });
    expect(contractValueCheck("2,150,000")).toEqual({ ok: true, value: 2_150_000 });
    /* A gate that read the value off the pack states it with its currency. */
    expect(contractValueCheck("RWF 2,150,000,000")).toEqual({ ok: true, value: 2_150_000_000 });
  });
  test("zero, negative, missing and unparseable values are refused", () => {
    for (const bad of [0, -1, undefined, null, "", "  ", "not a number", Number.NaN, Number.POSITIVE_INFINITY]) {
      const checked = contractValueCheck(bad);
      expect(checked.ok).toBe(false);
      if (!checked.ok) expect(checked.reason).toContain("contract value");
    }
  });
});

/* ── Variations (G12) ──────────────────────────────────────────────────────── */

describe("variations (G12)", () => {
  test("percentage of contract, signed value taken absolute", () => {
    expect(variationPctOfContract(10_000_000, 1_000_000)).toBe(10);
    expect(variationPctOfContract(10_000_000, -500_000)).toBe(5);
    expect(variationPctOfContract(0, 1_000)).toBe(0);
  });
  test("at or above the threshold needs the gate", () => {
    expect(variationNeedsGate(10)).toBe(true);
    expect(variationNeedsGate(9.9)).toBe(false);
    expect(variationNeedsGate(50, 25)).toBe(true);
    expect(VARIATION_GATE_PCT).toBe(10);
  });
});

/* ── Deadlines (G16) and analytics (G15) ───────────────────────────────────── */

describe("deadlines and analytics (G15/G16)", () => {
  const cycles = [
    {
      tenderId: "T-1",
      closingDate: "2026-11-01T14:00:00Z",
      opening: {
        id: "open_1", tenderId: "T-1", createdAt: "2026-11-01T15:00:00Z",
        rows: [
          { bidder: "A", receivedAt: "2026-11-01T10:00:00Z", late: false },
          { bidder: "B", receivedAt: "2026-11-01T16:00:00Z", late: true },
        ],
        minutesMd: "md",
      },
      alb: [{ id: "alb_1", tenderId: "T-1", bidder: "Cheap", openedAt: "2026-11-02T00:00:00Z", letterMd: "m", responseDueAt: "2026-11-09T00:00:00Z" }],
      complaints: [],
      clarifications: [],
      addenda: [],
    },
    {
      tenderId: "T-2",
      standstill: { tenderId: "T-2", startsAt: "2026-10-15T00:00:00Z", endsAt: "2026-10-29T00:00:00Z", days: STANDSTILL_DAYS, status: "ACTIVE" as const },
      contract: {
        tenderId: "T-2", supplier: "Winner", value: 5_000_000, openedAt: "2026-10-30T00:00:00Z",
        milestones: [{ id: "mil_1", title: "Delivery", dueDate: "2026-11-15", status: "PENDING" as const }],
        variations: [], payments: [],
      },
      complaints: [{ id: "cmp_1", tenderId: "T-2", complainant: "Loser", subject: "s", body: "b", receivedAt: "2026-10-20T00:00:00Z", duringStandstill: true, status: "OPEN" as const }],
      alb: [],
      clarifications: [],
      addenda: [],
    },
  ];

  test("deadlines are collected per kind and sorted, with overdue flags", () => {
    const items = collectDeadlines(cycles as never, "2026-10-25T00:00:00Z");
    const kinds = items.map((i) => i.kind);
    expect(kinds).toContain("CLOSING");
    expect(kinds).toContain("ALB_DUE");
    expect(kinds).toContain("STANDSTILL_END");
    expect(kinds).toContain("MILESTONE_DUE");
    expect(kinds).toContain("COMPLAINT_DUE");
    const sorted = [...items.map((i) => i.dueAt)].sort();
    expect(items.map((i) => i.dueAt)).toEqual(sorted);
    const complaintDue = items.find((i) => i.kind === "COMPLAINT_DUE")!;
    expect(complaintDue.overdue).toBe(false); // 2026-11-03 > 2026-10-25
  });

  test("analytics read the cycle without new instrumentation", () => {
    const a = cycleAnalytics({ cycles: cycles as never, runs: [{ tenderId: "T-1", findings: [1, 2], status: "AWAITING_GATE", startedAt: "x" }] });
    expect(a.tendersInCycle).toBe(2);
    expect(a.bidsOpened).toBe(2);
    expect(a.lateBids).toBe(1);
    expect(a.albOpen).toBe(1);
    expect(a.openComplaints).toBe(1);
    expect(a.contractsActive).toBe(1);
    expect(a.findingsPerTender).toBe(2);
  });
});

/* ── Procurement file (G5) ─────────────────────────────────────────────────── */

describe("procurement file (G5)", () => {
  test("composes one bundle covering the whole cycle", () => {
    const md = composeProcurementFile({
      tenderId: "T-9",
      title: "Supply of kits",
      buyer: "MoH",
      cycle: {
        alb: [],
        complaints: [{ complainant: "X", subject: "s", status: "OPEN", receivedAt: "2026-10-01T00:00:00Z" }],
        clarifications: [{ question: "q", askedBy: "bidder" }],
        addenda: [],
        coi: [{ member: "Dr. Chair", declaration: "NO_CONFLICT", declaredAt: "2026-10-01T00:00:00Z" }],
        debriefs: [],
      },
      runs: [{ id: "run_1", status: "AWAITING_GATE", startedAt: "2026-10-02T00:00:00Z", findings: [{ id: "F-01", rule: "R-DOC-MISSING", item: "A — tax clearance", severity: "HIGH", citation: "02-bid.md" }], drafts: [] }],
      gates: [{ id: "gate_1", tool: "file_gate_submission", status: "EXECUTED", approver: "Officer", decidedAt: "2026-10-03T00:00:00Z", receipt: { submissionId: "SUB-1" } }],
      logVerified: { ok: true, checked: 42 },
      generatedAt: "2026-10-20T00:00:00Z",
    });
    expect(md).toContain("# PROCUREMENT FILE — T-9");
    expect(md).toContain("verified (42 entries)".replace("verified", "verified"));
    expect(md).toContain("F-01 R-DOC-MISSING");
    expect(md).toContain("SUB-1");
    expect(md).toContain("Dr. Chair");
    expect(md).toContain("X: s — OPEN");
  });
});

/* ── Award report composer (G6) ────────────────────────────────────────────── */

describe("award report (G6)", () => {
  test("recommends the top responsive bid and never a disqualified one", () => {
    const m = scoreMatrix(matrixWith([
      { bidder: "Alpha", scores: [90, 80, 70], amount: 1_000_000 },
      { bidder: "Beta", scores: [10, 10, 10], amount: 500_000 },
    ]));
    m.bids[1].responsiveness = "MATERIALLY_NONRESPONSIVE";
    const { md, recommendation } = composeAwardReport({ tenderId: "T-1", matrix: m, findings: [] });
    expect(recommendation).toBe("Alpha");
    expect(md).toContain("Award to **Alpha**");
    expect(md).toContain("Beta");
  });
});

/* ── Notice fairness rule (G19): addendum inside the window ────────────────── */

describe("addendum window constant", () => {
  test("the minimum-notice window is seven days", () => {
    expect(ADDENDUM_MIN_NOTICE_DAYS).toBe(7);
  });
});

/* keep the imported helper honest — the debarment matcher is the identity layer */
describe("name matching guard", () => {
  test("namesMatch ignores legal suffixes, case and punctuation", () => {
    expect(namesMatch("meridian-construction", "Meridian Construction Group")).toBe(true);
    expect(namesMatch("Totally Different", "Meridian Construction Group")).toBe(false);
  });
});

describe("finding shape", () => {
  test("cycle findings carry citations like every other rule", () => {
    const findings: Finding[] = debarmentFindings(
      [{ bidder: "Zenith Medical Distributors Ltd", text: "t", source: "03-bid.md" }],
      DEBARMENT_LIST,
      "2026-10-20T00:00:00Z",
    );
    expect(findings[0].citation.split(",")[0].trim()).toBe("03-bid.md");
  });
});
