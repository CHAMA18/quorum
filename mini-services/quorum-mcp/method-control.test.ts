import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_DEPLOYMENT, DEFAULT_FEATURES, normalizeDeployment, state, type EvalMatrix } from "./store";
import { methodAuthorityBlockReason, methodControlBlockReason, methodNeedsGate } from "./method-control";
import { cycleToolCall, executeCycleGateAction, handleCycleRoutes } from "./cycle-routes";

const TENDER = "T-WS6-M";
const NOW = new Date("2026-10-30T09:00:00.000Z");

const MATRIX: EvalMatrix = {
  id: "mat_ws6m",
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
      financial: { amount: 500_000, currency: "ZMW", formulaScore: 100 },
      total: 92,
      verdict: "RECOMMENDED",
    },
  ],
  status: "CERTIFIED",
  certifiedAt: NOW.toISOString(),
  certifiedBy: "Chair",
  createdAt: NOW.toISOString(),
};

const JUSTIFICATION =
  "Only one firm holds the manufacturer's calibration licence for this equipment in Zambia.";

beforeEach(() => {
  state.cycle.push({
    tenderId: TENDER,
    workspaceId: "demo",
    coi: [],
    alb: [],
    debriefs: [],
    complaints: [],
    clarifications: [],
    addenda: [],
    notices: [],
    specs: [],
    matrix: MATRIX,
    createdAt: NOW.toISOString(),
  });
  state.features = { ...DEFAULT_FEATURES, methodControl: true, supplierAssurance: false };
  state.deployment = normalizeDeployment(DEFAULT_DEPLOYMENT);
  state.pipeline.length = 0;
});

afterEach(() => {
  state.cycle.length = 0;
  state.gates.length = 0;
  state.pipeline.length = 0;
  state.features = { ...DEFAULT_FEATURES };
  state.deployment = normalizeDeployment(DEFAULT_DEPLOYMENT);
});

describe("the method rule", () => {
  test("a tender with no method has no lawful award", () => {
    expect(methodControlBlockReason({ jurisdictionId: "ZM", value: 500_000 })).toContain("No procurement method is recorded");
  });

  test("an unknown method is refused by name", () => {
    expect(methodControlBlockReason({ methodId: "friendly-award", jurisdictionId: "ZM" })).toContain(
      "not a lawful procurement method",
    );
  });

  test("open bidding is the default and needs no justification", () => {
    expect(methodControlBlockReason({ methodId: "open-bidding", jurisdictionId: "ZM", value: 5_000_000 })).toBeNull();
    expect(methodNeedsGate("open-bidding")).toBe(false);
  });

  test("direct bidding without a justification is refused", () => {
    const reason = methodControlBlockReason({
      methodId: "direct-bidding",
      jurisdictionId: "ZM",
      value: 500_000,
      approvedAt: NOW.toISOString(),
    });
    expect(reason).toContain("stated justification");
  });

  test("direct bidding below the threshold passes with a justification and the method gate", () => {
    expect(
      methodControlBlockReason({
        methodId: "direct-bidding",
        justification: JUSTIFICATION,
        approvedAt: NOW.toISOString(),
        jurisdictionId: "ZM",
        value: 500_000,
      }),
    ).toBeNull();
  });

  test("direct bidding above the threshold needs the authority's approval reference", () => {
    const reason = methodControlBlockReason({
      methodId: "direct-bidding",
      justification: JUSTIFICATION,
      approvedAt: NOW.toISOString(),
      jurisdictionId: "ZM",
      value: 2_000_000,
    });
    expect(reason).toContain("Zambia Public Procurement Authority");
    expect(
      methodControlBlockReason({
        methodId: "direct-bidding",
        justification: JUSTIFICATION,
        approvedAt: NOW.toISOString(),
        approvalRef: "ZPPA/DIR/2026/17",
        jurisdictionId: "ZM",
        value: 2_000_000,
      }),
    ).toBeNull();
  });

  test("an alternative method always needs the authority, whatever the value", () => {
    expect(
      methodAuthorityBlockReason({ methodId: "alternative-method", value: 10_000, jurisdictionId: "ZM" }),
    ).toContain("prior approval");
  });

  test("a method that has not passed its gate cannot carry an award", () => {
    const reason = methodControlBlockReason({
      methodId: "direct-bidding",
      justification: JUSTIFICATION,
      jurisdictionId: "ZM",
      value: 500_000,
    });
    expect(reason).toContain("not yet approved");
  });

  test("simplified bidding stops being lawful above its value band", () => {
    const reason = methodControlBlockReason({
      methodId: "simplified-bidding",
      justification: JUSTIFICATION,
      approvedAt: NOW.toISOString(),
      jurisdictionId: "ZM",
      value: 2_000_000,
    });
    expect(reason).toContain("lawful only up to");
  });

  test("an approval dated in the future is not a signature", () => {
    const reason = methodControlBlockReason({
      methodId: "direct-bidding",
      justification: JUSTIFICATION,
      approvedAt: "2027-01-01T00:00:00.000Z",
      jurisdictionId: "ZM",
      value: 500_000,
      now: NOW,
    });
    expect(reason).toContain("future");
  });
});

describe("recording and approving a method", () => {
  test("open bidding lands directly with no gate", async () => {
    const result = (await cycleToolCall("set_procurement_method", {
      tenderId: TENDER,
      methodId: "open-bidding",
      by: "Procurement Officer",
    })) as { gate?: string; method: { methodId: string; ok: boolean } };
    expect(result.gate).toBeUndefined();
    expect(result.method.methodId).toBe("open-bidding");
    expect(result.method.ok).toBe(true);
    expect(state.cycle[0].methodId).toBe("open-bidding");
  });

  test("a direct award without a justification fails before any gate is raised", async () => {
    await expect(
      cycleToolCall("set_procurement_method", {
        tenderId: TENDER,
        methodId: "direct-bidding",
        estimatedValue: 500_000,
        by: "Procurement Officer",
      }),
    ).rejects.toThrow(/stated justification/);
    expect(state.gates.length).toBe(0);
  });

  test("direct bidding below the threshold raises the officer's gate, and approval makes the method lawful", async () => {
    const result = (await cycleToolCall("set_procurement_method", {
      tenderId: TENDER,
      methodId: "direct-bidding",
      justification: JUSTIFICATION,
      estimatedValue: 500_000,
      currency: "ZMW",
      by: "Procurement Officer",
    })) as { gate: string };
    expect(result.gate).toBeTruthy();
    expect(state.cycle[0].methodApprovedAt).toBeUndefined();

    const gate = state.gates.find((g) => g.id === result.gate)!;
    gate.approver = "Accounting Officer";
    gate.decidedAt = NOW.toISOString();
    gate.status = "APPROVED";
    await executeCycleGateAction(gate);

    expect(state.cycle[0].methodApprovedBy).toBe("Accounting Officer");
    expect(state.cycle[0].methodApprovedAt).toBe(NOW.toISOString());
    expect(
      methodControlBlockReason({
        methodId: state.cycle[0].methodId,
        justification: state.cycle[0].methodJustification,
        approvedAt: state.cycle[0].methodApprovedAt,
        jurisdictionId: "ZM",
        value: 500_000,
      }),
    ).toBeNull();
  });

  test("the value staged at method time survives approval when no matrix exists yet", async () => {
    state.cycle[0].matrix = undefined;
    const result = (await cycleToolCall("set_procurement_method", {
      tenderId: TENDER,
      methodId: "direct-bidding",
      justification: JUSTIFICATION,
      estimatedValue: 500_000,
      currency: "ZMW",
      by: "Procurement Officer",
    })) as { gate: string };
    const gate = state.gates.find((g) => g.id === result.gate)!;
    gate.approver = "Accounting Officer";
    gate.decidedAt = NOW.toISOString();
    gate.status = "APPROVED";
    await executeCycleGateAction(gate);

    expect(state.cycle[0].methodValue).toBe(500_000);
    expect(state.cycle[0].methodCurrency).toBe("ZMW");
    const response = await handleCycleRoutes("/api/cycle", "GET", {}, "", "demo");
    const data = (await response!.json()) as { cycles: { method: { ok: boolean; block: string | null } }[] };
    expect(data.cycles[0].method.ok).toBe(true);
    expect(data.cycles[0].method.block).toBeNull();
  });

  test("a direct award above the threshold without the authority's reference is refused before the gate", async () => {
    await expect(
      cycleToolCall("set_procurement_method", {
        tenderId: TENDER,
        methodId: "direct-bidding",
        justification: JUSTIFICATION,
        estimatedValue: 2_000_000,
        by: "Procurement Officer",
      }),
    ).rejects.toThrow(/Zambia Public Procurement Authority/);
    expect(state.gates.length).toBe(0);
  });

  test("the authority reference travels onto the record when the gate is raised", async () => {
    const result = (await cycleToolCall("set_procurement_method", {
      tenderId: TENDER,
      methodId: "direct-bidding",
      justification: JUSTIFICATION,
      approvalRef: "ZPPA/DIR/2026/17",
      estimatedValue: 2_000_000,
      by: "Procurement Officer",
    })) as { gate: string };
    expect(result.gate).toBeTruthy();
    expect(state.cycle[0].methodApprovalRef).toBe("ZPPA/DIR/2026/17");
    expect(state.gates.find((g) => g.id === result.gate)?.tool).toBe("approve_procurement_method");
  });

  test("a method above its value band is refused at the register", async () => {
    await expect(
      cycleToolCall("set_procurement_method", {
        tenderId: TENDER,
        methodId: "simplified-bidding",
        justification: JUSTIFICATION,
        estimatedValue: 2_000_000,
        by: "Procurement Officer",
      }),
    ).rejects.toThrow(/lawful only up to/);
  });
});
