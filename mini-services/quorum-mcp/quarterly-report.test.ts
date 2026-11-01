import { afterEach, describe, expect, test } from "bun:test";
import { executeCycleGateAction, handleCycleRoutes, preApprovalCheck } from "./cycle-routes";
import { state, type Gate, type TenderCycle } from "./store";

const WORKSPACE = "quarterly-report-test";
const TENDER = "QPR-TENDER-1";
const PREPARER = "procurement-user-qpr";

function closedQuarter() {
  const date = new Date(Date.now() - 200 * 86_400_000);
  return { year: date.getUTCFullYear(), quarter: Math.floor(date.getUTCMonth() / 3) + 1, eventAt: date.toISOString() };
}

describe("quarterly variation and preference-award returns", () => {
  afterEach(() => {
    state.cycle = state.cycle.filter((cycle) => cycle.tenderId !== TENDER);
    state.quarterlyReports = state.quarterlyReports.filter((report) => report.workspaceId !== WORKSPACE);
    state.gates = state.gates.filter((gate) => gate.workspaceId !== WORKSPACE);
  });

  test("builds a dated snapshot and submits it only after a separate accounting officer signs", async () => {
    const period = closedQuarter();
    state.cycle.push({
      tenderId: TENDER,
      workspaceId: WORKSPACE,
      coi: [],
      alb: [],
      debriefs: [],
      complaints: [],
      clarifications: [],
      addenda: [],
      notices: [],
      specs: [],
      dissents: [],
      matrix: {
        id: "qpr-matrix",
        tenderId: TENDER,
        criteria: [],
        technicalWeightPct: 80,
        preferenceScheme: "CDF_RESERVATION",
        cdfReservationExceptionRef: "cdf-local-assessment-1",
        bids: [{
          bidder: "Citizen Supplier Limited",
          late: false,
          responsiveness: "RESPONSIVE",
          reasons: [],
          technicalScores: [],
          technicalTotal: 80,
          financial: {
            amount: 1_000_000,
            currency: "ZMW",
            correctedAmount: 1_000_000,
            adjustments: {
              preferencePct: 0,
              preferenceScheme: "CDF_RESERVATION",
              reservationEligible: false,
              reservationCitizenSupplier: true,
              reservationExceptionRef: "cdf-local-assessment-1",
              evidenceRef: "ownership-record-1",
              verifiedBy: PREPARER,
              verifiedAt: period.eventAt,
            },
          },
          total: 90,
          verdict: "RECOMMENDED",
        }],
        status: "CERTIFIED",
        createdAt: period.eventAt,
      },
      awardReport: { tenderId: TENDER, md: "# report", sha: "award-sha", createdAt: period.eventAt, recommendation: "Citizen Supplier Limited" },
      awardNotice: {
        tenderId: TENDER,
        md: "# award notice",
        sha: "notice-sha",
        portal: "ZPPA e-GP",
        publishedAt: period.eventAt,
        dispatchedAt: period.eventAt,
        dispatchedTo: ["Citizen Supplier Limited"],
        dispatchEvidenceRef: "dispatch-1",
      },
      contract: {
        tenderId: TENDER,
        supplier: "Citizen Supplier Limited",
        value: 1_000_000,
        originalValue: 1_000_000,
        openedAt: period.eventAt,
        milestones: [],
        variations: [{
          id: "variation-1",
          description: "Approved scope adjustment",
          valueDelta: 25_000,
          pctOfContract: 2.5,
          status: "APPROVED",
          at: period.eventAt,
          approvedAt: period.eventAt,
          approvalReference: "approval-1",
        }],
        payments: [],
        performanceSecurity: [],
      },
      createdAt: period.eventAt,
    } as TenderCycle);

    const staged = await handleCycleRoutes("/api/cycle/quarterly-reports", "POST", {
      year: period.year,
      quarter: period.quarter,
      submissionReference: "ZPPA-QPR-2026-01",
      evidenceReference: "portal-receipt-1",
    }, "Procurement Officer", WORKSPACE, PREPARER);
    expect(staged?.status).toBe(201);
    const stagedBody = await staged!.json() as { report: { id: string; status: string; entries: { type: string }[]; gateId: string }; gate: string };
    expect(stagedBody.report.entries.map((entry) => entry.type).sort()).toEqual(["PREFERENCE_AWARD", "VARIATION"]);
    expect(stagedBody.report.status).toBe("PENDING_GATE");

    const gate = state.gates.find((row) => row.id === stagedBody.gate)!;
    expect(gate.requiredOffice).toBe("ACCOUNTING_OFFICER");
    expect(preApprovalCheck(gate, "Accounting Officer", [{ name: "Accounting Officer", userId: "accounting-user-qpr", office: "ACCOUNTING_OFFICER", status: "PRESENT" }], "Not the preparer", "accounting-user-qpr")).toBeNull();
    expect(preApprovalCheck(gate, "Accounting Officer", [{ name: "Accounting Officer", userId: PREPARER, office: "ACCOUNTING_OFFICER", status: "PRESENT" }], "Not the preparer", PREPARER)).toContain("different officer");

    gate.approver = "Accounting Officer";
    gate.decidedAt = new Date().toISOString();
    const completed = await executeCycleGateAction(gate);
    expect(completed).toMatchObject({ reportId: stagedBody.report.id, entryCount: 2 });
    const report = state.quarterlyReports.find((row) => row.id === stagedBody.report.id)!;
    expect(report.status).toBe("SUBMITTED");
    expect(state.cycle.find((cycle) => cycle.tenderId === TENDER)?.contract?.variations[0].quarterlyReportRef).toBe(report.submissionReference);
    expect(state.cycle.find((cycle) => cycle.tenderId === TENDER)?.awardNotice?.quarterlyReportRef).toBe(report.submissionReference);
  });
});
