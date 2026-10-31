import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_DEPLOYMENT,
  DEFAULT_FEATURES,
  normalizeDeployment,
  registeredConnector,
  state,
  type Complaint,
  type EvalMatrix,
  type Finding,
  type Gate,
  type Run,
  type Supplier,
  type TenderCycle,
} from "./store";
import {
  awardFindingBlockReason,
  complaintBlockReason,
  dispositionReason,
  openHighFindings,
  revalidateAward,
} from "./award";
import { composeAwardReport } from "./cycle";
import { cycleToolCall, executeCycleGateAction, preApprovalCheck } from "./cycle-routes";

const TENDER = "T-WS4";
const NOW = "2026-10-30T09:00:00.000Z";

/* WS6 is on by default: the fixture carries a lawful open method and a
   verified winner, so these tests exercise WS4's rules rather than WS6's. */
const VERIFIED_SUPPLIER: Supplier = {
  id: "sup_ws4",
  name: "Acme Supplies",
  registrationNo: "REG-WS4",
  categories: [],
  metadata: {},
  status: "ACTIVE",
  verification: {
    status: "VERIFIED",
    registryStatus: "REGISTERED",
    taxStatus: "VALID",
    beneficialOwners: [{ name: "A. Owner", role: "Director", ownershipPct: 100 }],
    sanctions: "CLEAR",
    pep: "CLEAR",
    documents: [{ id: "doc_1", kind: "REGISTRY EXTRACT" }],
    checkedAt: NOW,
    expiresAt: "2027-10-30T00:00:00.000Z",
    source: "REGISTRY_LOOKUP",
    checkedBy: "Procurement Officer",
  },
  addedBy: "officer",
  createdAt: NOW,
};

const MATRIX: EvalMatrix = {
  id: "mat_ws4",
  tenderId: TENDER,
  criteria: [{ id: "c1", title: "Technical", weight: 100 }],
  technicalWeightPct: 80,
  bids: [
    {
      bidder: "Acme Supplies",
      late: false,
      responsiveness: "RESPONSIVE",
      reasons: [],
      technicalScores: [],
      technicalTotal: 90,
      financial: { amount: 1_000_000, currency: "ZMW", formulaScore: 100 },
      total: 92,
      verdict: "RECOMMENDED",
    },
    {
      bidder: "Beta Works",
      late: false,
      responsiveness: "RESPONSIVE",
      reasons: [],
      technicalScores: [],
      technicalTotal: 70,
      financial: { amount: 1_200_000, currency: "ZMW", formulaScore: 80 },
      total: 72,
      verdict: "NOT_RECOMMENDED",
    },
  ],
  status: "CERTIFIED",
  certifiedAt: NOW,
  certifiedBy: "Chair",
  createdAt: NOW,
};

let finding: Finding;

function cycle(overrides: Partial<TenderCycle> = {}): TenderCycle {
  return {
    tenderId: TENDER,
    workspaceId: "demo",
    methodId: "open-bidding",
    coi: [],
    alb: [],
    debriefs: [],
    complaints: [],
    clarifications: [],
    addenda: [],
    notices: [],
    specs: [],
    matrix: MATRIX,
    awardReport: {
      tenderId: TENDER,
      md: "# award",
      sha: "sha-award",
      createdAt: NOW,
      recommendation: "Acme Supplies",
      signedAt: NOW,
      signedBy: "Accounting Officer",
    },
    awardNotice: {
      tenderId: TENDER,
      md: "# notice",
      sha: "sha-notice",
      portal: "e-GP production",
      publishedAt: NOW,
      publication: {
        mode: "CONNECTED",
        portal: "e-GP production",
        receiptId: "RCPT-4",
        evidenceHash: "evidence-4",
        publishedAt: NOW,
      },
    },
    standstill: { tenderId: TENDER, startsAt: NOW, endsAt: NOW, days: 10, status: "LAPSED" },
    createdAt: NOW,
    ...overrides,
  };
}

function connected() {
  /* Registering the connector is part of staging the workspace fixture. */
  state.connector = CONNECTOR;
  return normalizeDeployment(
    {
      mode: "CONNECTED",
      connectorId: CONNECTOR.id,
      publication: {
        mode: "CONNECTED",
        portal: "e-GP production",
        receiptId: "RCPT-4",
        evidenceHash: "evidence-4",
        publishedAt: NOW,
      },
    },
    CONNECTOR,
  );
}

const CONNECTOR = registeredConnector({ name: "e-GP production" });

function seed(fixture: Partial<TenderCycle> = {}) {
  state.cycle.push(cycle(fixture));
  state.runs.push({
    id: "run_ws4",
    workspaceId: "demo",
    tenderId: TENDER,
    status: "FILED",
    startedAt: NOW,
    updatedAt: NOW,
    progress: [],
    requirements: [],
    findings: [finding],
    drafts: [],
  } as Run);
  state.deployment = connected();
  state.suppliers.push(structuredClone(VERIFIED_SUPPLIER));
  state.features = { ...DEFAULT_FEATURES, findingDispositions: true, complaintSuspension: true };
  state.budgetLines.push({
    id: "bud_ws4",
    workspaceId: "demo",
    fiscalYear: 2026,
    code: "CAP-2026",
    currency: "ZMW",
    approved: 5_000_000,
    committed: 0,
    spent: 0,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function gate(tool: string, inputs: Record<string, unknown> = {}): Gate {
  return {
    id: `gate_${tool}`,
    runId: "cycle",
    workspaceId: "demo",
    tenderId: TENDER,
    tool,
    inputs,
    status: "PENDING",
    createdAt: NOW,
    decidedAt: NOW,
    approver: "Accounting Officer",
    requiredOffice: "ACCOUNTING_OFFICER",
  } as Gate;
}

beforeEach(() => {
  finding = {
    id: "F-01",
    rule: "R-OVER-BUDGET",
    severity: "HIGH",
    item: "Acme Supplies — bid value",
    evidence: "Acme Supplies bids ZMW 1,000,000 against a ZMW 900,000 ceiling.",
    citation: "02-bid-acme.md, bid value line",
  };
  seed();
});

afterEach(() => {
  state.cycle.length = 0;
  state.runs.length = 0;
  state.gates.length = 0;
  state.suppliers.length = 0;
  state.budgetLines.length = 0;
  state.commitments.length = 0;
  state.deployment = normalizeDeployment(DEFAULT_DEPLOYMENT);
  state.connector = null;
  state.sittings.length = 0;
  state.forwardedKeys.length = 0;
  state.features = { ...DEFAULT_FEATURES };
});

describe("disposition rules", () => {
  test("a disposition needs a decision and a stated reason", () => {
    expect(dispositionReason({ status: "MAYBE", note: "x", by: "Officer" })).toContain("CLEARED, WAIVED or RE_CHECK");
    expect(dispositionReason({ status: "CLEARED", note: "   ", by: "Officer" })).toContain("stated reason");
    expect(dispositionReason({ status: "CLEARED", note: "Checked the ceiling.", by: "Officer" })).toBeNull();
  });

  test("a waiver needs a different second officer", () => {
    expect(dispositionReason({ status: "WAIVED", note: "Budget revision approved.", by: "Officer" })).toContain(
      "second, different officer",
    );
    expect(
      dispositionReason({ status: "WAIVED", note: "Budget revision approved.", by: "Officer", secondedBy: "officer" }),
    ).toContain("cannot second");
    expect(
      dispositionReason({ status: "WAIVED", note: "Budget revision approved.", by: "Officer", secondedBy: "CFO" }),
    ).toBeNull();
  });

  test("only HIGH findings block, and RE_CHECK reopens them", () => {
    expect(openHighFindings([finding], "Acme Supplies")).toHaveLength(1);
    finding.severity = "MEDIUM";
    expect(openHighFindings([finding], "Acme Supplies")).toHaveLength(0);
    finding.severity = "HIGH";
    finding.disposition = { status: "CLEARED", by: "Officer", at: NOW, note: "checked" };
    expect(openHighFindings([finding], "Acme Supplies")).toHaveLength(0);
    finding.disposition = { status: "RE_CHECK", by: "Officer", at: NOW, note: "evidence missing" };
    expect(openHighFindings([finding], "Acme Supplies")).toHaveLength(1);
  });

  test("the refusal names the blocking finding", () => {
    const reason = awardFindingBlockReason([finding], "Acme Supplies");
    expect(reason).toContain("F-01");
    expect(reason).toContain("R-OVER-BUDGET");
    expect(reason).toContain("undispositioned");
  });

  test("an answered complaint stops suspending; an escalated one does not", () => {
    const base: Complaint = {
      id: "cmp_1",
      tenderId: TENDER,
      complainant: "Beta Works",
      subject: "Scoring",
      body: "We disagree with the technical score.",
      receivedAt: NOW,
      duringStandstill: true,
      status: "OPEN",
    };
    expect(complaintBlockReason([base])).toContain("cmp_1");
    expect(complaintBlockReason([{ ...base, status: "ESCALATED" }])).toContain("cmp_1");
    expect(complaintBlockReason([{ ...base, status: "ANSWERED" }])).toBeNull();
    expect(complaintBlockReason([{ ...base, status: "CLOSED" }])).toBeNull();
  });
});

describe("award revalidation", () => {
  test("an open HIGH finding blocks the award signature", () => {
    const reason = preApprovalCheck(gate("sign_award_report"), "Accounting Officer", [], "Accounting Officer");
    expect(reason).toContain("F-01");
    expect(reason).toContain("R-OVER-BUDGET");
  });

  test("clearing the finding unblocks the award signature", async () => {
    state.cycle[0].awardReport!.signedAt = undefined;
    state.cycle[0].awardReport!.signedBy = undefined;
    await cycleToolCall("dispose_finding", {
      tenderId: TENDER,
      findingId: "F-01",
      status: "CLEARED",
      note: "The ceiling was revised in addendum 2; the bid is within the revised budget.",
      by: "Accounting Officer",
    });
    expect(preApprovalCheck(gate("sign_award_report"), "Accounting Officer", [], "Accounting Officer")).toBeNull();
  });

  test("a waiver without a second officer is refused", async () => {
    state.cycle[0].awardReport!.signedAt = undefined;
    state.cycle[0].awardReport!.signedBy = undefined;
    await expect(
      cycleToolCall("dispose_finding", {
        tenderId: TENDER,
        findingId: "F-01",
        status: "WAIVED",
        note: "Cabinet approval.",
        by: "Accounting Officer",
      }),
    ).rejects.toThrow(/second, different officer/);
  });

  test("a supplier suspended after evaluation is caught", () => {
    state.suppliers[0].status = "SUSPENDED";
    const verdict = revalidateAward({ matrix: MATRIX, findings: [], suppliers: state.suppliers });
    expect(verdict.ok).toBe(false);
    expect(verdict.blockers.join(" ")).toContain("SUSPENDED");
  });

  test("a debarred winner is caught", () => {
    const verdict = revalidateAward({
      matrix: MATRIX,
      findings: [],
      suppliers: [],
      debarment: [{ name: "Acme Supplies" }],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.blockers.join(" ")).toContain("debarment register");
  });

  test("the executor refuses even if the pre-check is bypassed", async () => {
    state.cycle[0].awardReport!.signedAt = undefined;
    state.cycle[0].awardReport!.signedBy = undefined;
    await expect(executeCycleGateAction(gate("sign_award_report", { recommendation: "Acme Supplies" }))).rejects.toThrow(
      /F-01/,
    );
    await cycleToolCall("dispose_finding", {
      tenderId: TENDER,
      findingId: "F-01",
      status: "WAIVED",
      note: "Budget revision signed by the accounting officer.",
      secondedBy: "Permanent Secretary",
      by: "Accounting Officer",
    });
    const result = await executeCycleGateAction(gate("sign_award_report", { recommendation: "Acme Supplies" }));
    expect(result?.recommendation).toBe("Acme Supplies");
  });

  test("a signed award report cannot be re-dispositioned", async () => {
    await expect(
      cycleToolCall("dispose_finding", {
        tenderId: TENDER,
        findingId: "F-01",
        status: "CLEARED",
        note: "Late change.",
        by: "Accounting Officer",
      }),
    ).rejects.toThrow(/signed/);
  });

  test("the award report carries the disposition table and complaint table", () => {
    finding.disposition = {
      status: "CLEARED",
      by: "Officer",
      at: NOW,
      note: "Ceiling revised by addendum 2.",
      secondedBy: "CFO",
    };
    const { md } = composeAwardReport({
      tenderId: TENDER,
      matrix: MATRIX,
      findings: [{ id: finding.id, rule: finding.rule, item: finding.item, severity: finding.severity, disposition: finding.disposition }],
      complaints: [{ complainant: "Beta Works", subject: "Scoring", status: "ANSWERED" }],
    });
    expect(md).toContain("### Disposition table");
    expect(md).toContain("| F-01 | R-OVER-BUDGET | HIGH | CLEARED | Officer (seconded CFO) | Ceiling revised by addendum 2. |");
    expect(md).toContain("### Complaints");
    expect(md).toContain("| Beta Works | Scoring | ANSWERED |");
  });
});

describe("complaint suspension", () => {
  const openComplaint: Complaint = {
    id: "cmp_ws4",
    tenderId: TENDER,
    complainant: "Beta Works",
    subject: "Technical scoring",
    body: "The committee misapplied the criterion.",
    receivedAt: NOW,
    duringStandstill: true,
    status: "OPEN",
  };

  test("an open complaint blocks the contract pack signature", () => {
    state.runs[0].findings = [];
    state.cycle[0].complaints.push(openComplaint);
    const reason = preApprovalCheck(
      gate("sign_contract_pack", { value: 1_000_000, budgetLineId: "bud_ws4" }),
      "Accounting Officer",
      [],
      "Accounting Officer",
    );
    expect(reason).toContain("cmp_ws4");
    expect(reason).toContain("suspends the contract and payment path");
  });

  test("an answered complaint lifts the suspension", () => {
    state.runs[0].findings = [];
    state.cycle[0].complaints.push({ ...openComplaint, status: "ANSWERED" });
    expect(
      preApprovalCheck(
        gate("sign_contract_pack", { value: 1_000_000, budgetLineId: "bud_ws4" }),
        "Accounting Officer",
        [],
        "Accounting Officer",
      ),
    ).toBeNull();
  });

  test("an open complaint blocks payment certification even after standstill", () => {
    state.cycle[0].complaints.push(openComplaint);
    state.cycle[0].contract = {
      tenderId: TENDER,
      supplier: "Acme Supplies",
      value: 1_000_000,
      currency: "ZMW",
      openedAt: NOW,
      status: "EXECUTED",
      executedAt: NOW,
      supplierAcceptedAt: NOW,
      supplierSignatory: "A. Director",
      performanceSecurity: { amount: 100_000, issuer: "Bank", validUntil: "2027-10-30" },
      insurance: { policyNo: "POL-1", issuer: "Insurer", validUntil: "2027-10-30" },
      packMd: "# pack",
      milestones: [],
      variations: [],
      payments: [],
    };
    const reason = preApprovalCheck(
      gate("certify_payment", { paymentId: "pay_1" }),
      "Accounting Officer",
      [],
      "Accounting Officer",
    );
    expect(reason).toContain("cmp_ws4");
  });
});
