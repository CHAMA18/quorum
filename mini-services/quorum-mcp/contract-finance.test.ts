import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_DEPLOYMENT,
  DEFAULT_FEATURES,
  normalizeDeployment,
  registeredConnector,
  VARIATION_CUMULATIVE_CAP_PCT,
  state,
  type BudgetLine,
  type ContractFile,
  type EvalMatrix,
  type Gate,
  type Supplier,
  type TenderCycle,
} from "./store";
import {
  commitmentBlockReason,
  completionBlockReason,
  cumulativeVariationPct,
  executionBlockReason,
  paymentBlockReason,
  paymentNet,
  paymentSplit,
  variationBlockReason,
} from "./finance";
import { cycleToolCall, executeCycleGateAction, preApprovalCheck } from "./cycle-routes";

const TENDER = "T-WS5";
const NOW = "2026-10-30T09:00:00.000Z";

const MATRIX: EvalMatrix = {
  id: "mat_ws5",
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
  ],
  status: "CERTIFIED",
  certifiedAt: NOW,
  certifiedBy: "Chair",
  createdAt: NOW,
};

/* WS6 is on by default: the fixture carries a lawful open method and a
   verified winner, so these tests exercise WS5's money rules. */
const VERIFIED_SUPPLIER: Supplier = {
  id: "sup_ws5",
  name: "Acme Supplies",
  registrationNo: "REG-WS5",
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

const LINE: BudgetLine = {
  id: "bud_ws5",
  workspaceId: "demo",
  fiscalYear: 2026,
  code: "CAP-2026",
  currency: "ZMW",
  approved: 5_000_000,
  committed: 0,
  spent: 0,
  createdAt: NOW,
  updatedAt: NOW,
};

const CONNECTOR = registeredConnector({ name: "e-GP production" });

function connected() {
  /* Registering the connector is part of staging the workspace fixture: a
     CONNECTED mode without its live connector is refused, as it must be. */
  state.connector = CONNECTOR;
  return normalizeDeployment(
    {
      mode: "CONNECTED",
      connectorId: CONNECTOR.id,
      publication: {
        mode: "CONNECTED",
        portal: "e-GP production",
        receiptId: "RCPT-5",
        evidenceHash: "evidence-5",
      publishedAt: NOW,
      },
    },
    CONNECTOR,
  );
}

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
        receiptId: "RCPT-5",
        evidenceHash: "evidence-5",
        publishedAt: NOW,
      },
    },
    standstill: { tenderId: TENDER, startsAt: NOW, endsAt: NOW, days: 10, status: "LAPSED" },
    createdAt: NOW,
    ...overrides,
  };
}

function contract(overrides: Partial<ContractFile> = {}): ContractFile {
  return {
    tenderId: TENDER,
    supplier: "Acme Supplies",
    value: 1_000_000,
    currency: "ZMW",
    openedAt: NOW,
    packMd: "# contract pack",
    status: "EXECUTED",
    executedAt: NOW,
    supplierAcceptedAt: NOW,
    supplierSignatory: "A. Director",
    performanceSecurity: { amount: 100_000, issuer: "Bank", validUntil: "2027-10-30" },
    insurance: { policyNo: "POL-1", issuer: "Insurer", validUntil: "2027-10-30" },
    retentionPct: 10,
    milestones: [{ id: "mil_1", title: "Delivery", status: "DONE", doneAt: NOW }],
    variations: [],
    payments: [],
    ...overrides,
  };
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

function seed(fixture: Partial<TenderCycle> = {}) {
  state.cycle.push(cycle(fixture));
  state.budgetLines.push(structuredClone(LINE));
  state.suppliers.push(structuredClone(VERIFIED_SUPPLIER));
  state.deployment = connected();
  state.features = { ...DEFAULT_FEATURES, paymentCaps: true, contractExecution: true };
}

beforeEach(() => seed());

afterEach(() => {
  state.cycle.length = 0;
  state.gates.length = 0;
  state.runs.length = 0;
  state.budgetLines.length = 0;
  state.commitments.length = 0;
  state.suppliers.length = 0;
  state.deployment = normalizeDeployment(DEFAULT_DEPLOYMENT);
  state.features = { ...DEFAULT_FEATURES };
});

describe("payment arithmetic", () => {
  test("retention and withholding are exact at currency precision", () => {
    const split = paymentSplit({ gross: 1_234.56, retentionPct: 10, withholding: 34.56 });
    expect(split.gross).toBe(1234.56);
    expect(split.retention).toBe(123.46);
    expect(split.withholding).toBe(34.56);
    expect(split.net).toBe(1076.54);
  });

  test("legacy payments without a split count as net gross claims", () => {
    expect(paymentNet({ id: "p", description: "legacy", amount: 500 })).toBe(500);
    expect(paymentNet({ id: "p", description: "new", amount: 500, gross: 500, retention: 50, net: 450 })).toBe(450);
  });
});

describe("contract execution", () => {
  test("a draft contract cannot pay", () => {
    expect(executionBlockReason(contract({ status: "DRAFT", supplierAcceptedAt: undefined }))).toContain(
      "supplier has not accepted",
    );
  });

  test("expired security or insurance fails closed", () => {
    const expired = contract({
      status: "DRAFT",
      performanceSecurity: { amount: 100_000, issuer: "Bank", validUntil: "2025-01-01" },
    });
    expect(executionBlockReason(expired)).toContain("performance security has expired");
    const noInsurance = contract({ status: "DRAFT", insurance: undefined });
    expect(executionBlockReason(noInsurance)).toContain("no insurance");
  });

  test("a complete instrument is executable", () => {
    expect(executionBlockReason(contract())).toBeNull();
  });

  test("completion needs a certificate, a defects period and a rating", () => {
    expect(completionBlockReason(contract(), {})).toContain("completion certificate");
    expect(
      completionBlockReason(contract(), {
        certificateId: "CERT-1",
        defectsLiabilityEndsAt: "2027-06-30",
        performanceRating: 4,
      }),
    ).toBeNull();
    expect(
      completionBlockReason(contract(), {
        certificateId: "CERT-1",
        defectsLiabilityEndsAt: "2025-01-01",
        performanceRating: 4,
      }),
    ).toContain("defects-liability end date in the future");
  });
});

describe("payment caps and three-way match", () => {
  const basePayment = {
    id: "pay_1",
    description: "Milestone 1",
    amount: 400_000,
    gross: 400_000,
    retention: 40_000,
    net: 360_000,
    invoiceId: "INV-1",
    milestoneId: "mil_1",
    goodsReceiptId: "GRN-1",
  };

  test("a draft contract blocks certification", () => {
    const draft = contract({ status: "DRAFT" });
    expect(paymentBlockReason({ contract: draft, payment: basePayment })).toContain("not executed");
  });

  test("the three-way match is mandatory", () => {
    expect(paymentBlockReason({ contract: contract(), payment: { ...basePayment, invoiceId: undefined } })).toContain(
      "invoice",
    );
    expect(
      paymentBlockReason({ contract: contract(), payment: { ...basePayment, milestoneId: undefined } }),
    ).toContain("milestone");
    expect(
      paymentBlockReason({ contract: contract(), payment: { ...basePayment, goodsReceiptId: undefined } }),
    ).toContain("three-way match");
    expect(paymentBlockReason({ contract: contract(), payment: basePayment })).toBeNull();
  });

  test("an incomplete milestone blocks certification", () => {
    const pending = contract({ milestones: [{ id: "mil_1", title: "Delivery", status: "PENDING" }] });
    expect(paymentBlockReason({ contract: pending, payment: basePayment })).toContain("still PENDING");
  });

  test("a payment above the cap is refused, not clamped", () => {
    const paid = contract({
      payments: [{ id: "pay_0", description: "Earlier", amount: 700_000, gross: 700_000, net: 630_000, status: "CERTIFIED" }],
    });
    const reason = paymentBlockReason({ contract: paid, payment: basePayment });
    expect(reason).toContain("cumulative net");
    expect(reason).toContain("refused, never clamped");
  });

  test("a completed contract takes no further payment", () => {
    const done = contract({ completedAt: NOW, status: "COMPLETED" });
    expect(paymentBlockReason({ contract: done, payment: basePayment })).toContain("completed");
  });
});

describe("variation cap and budget commitment", () => {
  test("cumulative variations above the cap are refused", () => {
    const varied = contract({
      variations: [
        { id: "v1", description: "Extra scope", valueDelta: 200_000, pctOfContract: 20, cumulativePct: 20, status: "APPROVED", at: NOW },
      ],
    });
    expect(cumulativeVariationPct(varied, 100_000)).toBe(30);
    const reason = variationBlockReason({ contract: varied, valueDelta: 100_000 });
    expect(reason).toContain(`${VARIATION_CUMULATIVE_CAP_PCT}% cap`);
  });

  test("pending variations stack against the cap, not only approved ones", () => {
    const pending = contract({
      variations: [
        { id: "v1", description: "Proposed scope", valueDelta: 200_000, pctOfContract: 20, cumulativePct: 20, status: "PENDING", at: NOW },
        { id: "v2", description: "Second proposal", valueDelta: 60_000, pctOfContract: 6, cumulativePct: 26, status: "PENDING", at: NOW },
      ],
    });
    expect(variationBlockReason({ contract: pending, valueDelta: 100_000 })).toContain("cap");
    /* Approving v1 counts v2 and v1's own delta — not v1 twice. */
    expect(variationBlockReason({ contract: pending, valueDelta: 200_000, excludeVariationId: "v1" })).toContain("cap");
  });

  test("a downward variation is not capped", () => {
    expect(variationBlockReason({ contract: contract(), valueDelta: -100_000 })).toBeNull();
  });

  test("an overcommit names the remaining authority", () => {
    const line = { ...LINE, approved: 1_000_000, committed: 900_000 };
    const reason = commitmentBlockReason(line, 200_000);
    expect(reason).toContain("100,000 remaining");
    expect(commitmentBlockReason(line, 100_000)).toBeNull();
  });
});

describe("contract and payment gates", () => {
  test("the pack signature commits budget and opens a draft contract", async () => {
    const prepared = (await cycleToolCall("prepare_contract_pack", {
      tenderId: TENDER,
      budgetLineId: "bud_ws5",
    })) as { gate: string };
    const packGate = state.gates.find((g) => g.id === prepared.gate)!;
    expect(preApprovalCheck(packGate, "Accounting Officer", [], "Accounting Officer")).toBeNull();
    const result = await executeCycleGateAction(packGate);
    expect(result?.status).toBe("DRAFT");
    expect(state.cycle[0].contract?.status).toBe("DRAFT");
    expect(state.commitments).toHaveLength(1);
    expect(state.budgetLines[0].committed).toBe(1_000_000);
  });

  test("an overcommitted budget refuses the pack before signature", async () => {
    state.budgetLines[0].approved = 500_000;
    const prepared = (await cycleToolCall("prepare_contract_pack", {
      tenderId: TENDER,
      budgetLineId: "bud_ws5",
    })) as { gate: string };
    const packGate = state.gates.find((g) => g.id === prepared.gate)!;
    const reason = preApprovalCheck(packGate, "Accounting Officer", [], "Accounting Officer");
    expect(reason).toContain("overcommit");
    await expect(executeCycleGateAction(packGate)).rejects.toThrow(/overcommit/);
  });

  test("execution requires the supplier acceptance and instruments", async () => {
    state.cycle[0].contract = contract({ status: "DRAFT", supplierAcceptedAt: undefined, supplierSignatory: undefined });
    const draftGate = gate("execute_contract");
    expect(preApprovalCheck(draftGate, "Accounting Officer", [], "Accounting Officer")).toContain(
      "supplier has not accepted",
    );
    state.cycle[0].contract = contract({ status: "DRAFT" });
    expect(preApprovalCheck(draftGate, "Accounting Officer", [], "Accounting Officer")).toBeNull();
    const result = await executeCycleGateAction(draftGate);
    expect(result?.status).toBe("EXECUTED");
    expect(state.cycle[0].contract?.status).toBe("EXECUTED");
  });

  test("instruments entered at the execution gate satisfy the check and land on the contract", async () => {
    state.cycle[0].contract = contract({
      status: "DRAFT",
      performanceSecurity: undefined,
      insurance: undefined,
      retentionPct: undefined,
    });
    const execGate = gate("execute_contract", {
      performanceSecurity: { amount: 100_000, issuer: "Bank", validUntil: "2027-10-30" },
      insurance: { policyNo: "POL-1", issuer: "Insurer", validUntil: "2027-10-30" },
      retentionPct: 5,
    });
    expect(preApprovalCheck(execGate, "Accounting Officer", [], "Accounting Officer")).toBeNull();
    await executeCycleGateAction(execGate);
    expect(state.cycle[0].contract?.performanceSecurity?.amount).toBe(100_000);
    expect(state.cycle[0].contract?.retentionPct).toBe(5);
  });

  test("certifying a payment draws down the budget line", async () => {
    state.cycle[0].contract = contract({
      payments: [
        {
          id: "pay_1",
          description: "Milestone 1",
          amount: 500_000,
          gross: 500_000,
          retention: 50_000,
          net: 450_000,
          invoiceId: "INV-1",
          milestoneId: "mil_1",
          goodsReceiptId: "GRN-1",
          status: "PENDING",
        },
      ],
    });
    state.commitments.push({
      id: "cmt_1",
      workspaceId: "demo",
      tenderId: TENDER,
      budgetLineId: "bud_ws5",
      amount: 1_000_000,
      createdAt: NOW,
      createdBy: "Accounting Officer",
    });
    state.budgetLines[0].committed = 1_000_000;
    const paymentGate = gate("certify_payment", { paymentId: "pay_1" });
    expect(preApprovalCheck(paymentGate, "Accounting Officer", [], "Accounting Officer")).toBeNull();
    const result = await executeCycleGateAction(paymentGate);
    expect(result?.net).toBe(450_000);
    expect(state.cycle[0].contract?.payments[0].status).toBe("CERTIFIED");
    expect(state.budgetLines[0].spent).toBe(450_000);
  });

  test("an over-cap payment never reaches the gate", async () => {
    state.cycle[0].contract = contract({
      payments: [
        { id: "pay_0", description: "Earlier", amount: 900_000, gross: 900_000, net: 810_000, status: "CERTIFIED" },
        {
          id: "pay_1",
          description: "Now",
          amount: 300_000,
          gross: 300_000,
          net: 270_000,
          invoiceId: "INV-2",
          milestoneId: "mil_1",
          goodsReceiptId: "GRN-2",
          status: "PENDING",
        },
      ],
    });
    const paymentGate = gate("certify_payment", { paymentId: "pay_1" });
    const reason = preApprovalCheck(paymentGate, "Accounting Officer", [], "Accounting Officer");
    expect(reason).toContain("cumulative net");
    await expect(executeCycleGateAction(paymentGate)).rejects.toThrow(/cumulative net/);
  });
});
