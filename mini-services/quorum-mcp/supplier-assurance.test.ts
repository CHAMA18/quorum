import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_DEPLOYMENT,
  DEFAULT_FEATURES,
  normalizeDeployment,
  registeredConnector,
  state,
  type EvalMatrix,
  type Supplier,
  type TenderCycle,
} from "./store";
import {
  assuranceBlockReason,
  normalizeVerification,
  verificationFailures,
  verificationOk,
} from "./supplier-assurance";
import { validateApplicationAdmission } from "./marketplace";
import { cycleToolCall, preApprovalCheck } from "./cycle-routes";

const TENDER = "T-WS6-A";
const NOW = new Date("2026-10-30T09:00:00.000Z");
const EXPIRES = "2027-10-30T00:00:00.000Z";

const CLEAN = {
  registryStatus: "REGISTERED",
  taxStatus: "VALID",
  sanctions: "CLEAR",
  pep: "CLEAR",
  beneficialOwners: [{ name: "A. Owner", role: "Director", ownershipPct: 100 }],
  documents: [{ kind: "REGISTRY EXTRACT", reference: "PACRA-1" }],
  source: "REGISTRY_LOOKUP",
  expiresAt: EXPIRES,
};

const MATRIX: EvalMatrix = {
  id: "mat_ws6",
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

function supplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: "sup_ws6",
    workspaceId: "demo",
    name: "Acme Supplies",
    registrationNo: "REG-WS6",
    categories: [],
    metadata: {},
    status: "ACTIVE",
    addedBy: "officer",
    createdAt: NOW.toISOString(),
    ...overrides,
  };
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
      createdAt: NOW.toISOString(),
      recommendation: "Acme Supplies",
    },
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

const CONNECTOR = registeredConnector({ name: "e-GP production" });

beforeEach(() => {
  state.cycle.push(cycle());
  state.features = { ...DEFAULT_FEATURES, supplierAssurance: true, methodControl: true };
  state.connector = CONNECTOR;
  state.deployment = normalizeDeployment(
    {
      mode: "CONNECTED",
      connectorId: CONNECTOR.id,
      publication: {
        mode: "CONNECTED",
        portal: "e-GP production",
        receiptId: "RCPT-6",
        evidenceHash: "evidence-6",
        publishedAt: NOW.toISOString(),
      },
    },
    CONNECTOR,
  );
});

afterEach(() => {
  state.cycle.length = 0;
  state.gates.length = 0;
  state.suppliers.length = 0;
  state.applications.length = 0;
  state.features = { ...DEFAULT_FEATURES };
  state.deployment = normalizeDeployment(DEFAULT_DEPLOYMENT);
  state.connector = null;
});

describe("the verification record", () => {
  test("a clean registry, tax, ownership, screening and document set derives VERIFIED", () => {
    const v = normalizeVerification(CLEAN, { checkedBy: "Procurement Officer", now: NOW });
    expect(v.status).toBe("VERIFIED");
    expect(v.source).toBe("REGISTRY_LOOKUP");
    expect(v.checkedAt).toBe(NOW.toISOString());
    expect(v.expiresAt).toBe(EXPIRES);
    expect(verificationOk(v, NOW)).toBe(true);
    expect(verificationFailures(v, NOW)).toEqual([]);
  });

  test("a sanctions hit is recorded as FAILED and names the match", () => {
    const v = normalizeVerification(
      { ...CLEAN, sanctions: "HIT", sanctionsMatches: ["World Bank list — Acme Holdings"] },
      { checkedBy: "Officer", now: NOW },
    );
    expect(v.status).toBe("FAILED");
    const failures = verificationFailures(v, NOW).join(" ");
    expect(failures).toContain("sanctions screening returned HIT");
    expect(failures).toContain("Acme Holdings");
  });

  test("a manual check is labelled manual, not dressed as a registry lookup", () => {
    const v = normalizeVerification({ ...CLEAN, source: "MANUAL_ATTESTATION" }, { checkedBy: "Officer", now: NOW });
    expect(v.source).toBe("MANUAL_ATTESTATION");
    expect(v.status).toBe("VERIFIED");
  });

  test("one check records the whole beneficial-owner and document set", () => {
    const v = normalizeVerification(
      {
        ...CLEAN,
        beneficialOwners: [
          { name: "A. Owner", role: "Director", ownershipPct: 60, nationality: "Zambian" },
          { name: "B. Owner", role: "Shareholder", ownershipPct: 25 },
          { name: "C. Holdings", role: "Corporate shareholder", ownershipPct: 15 },
        ],
        documents: [
          { kind: "TAX CLEARANCE", reference: "ZRA-1", expiresAt: "2027-06-30" },
          { kind: "REGISTRY EXTRACT", reference: "PACRA-2" },
          { kind: "SANCTIONS SCREEN", reference: "SCR-3", expiresAt: "2027-01-31" },
        ],
      },
      { checkedBy: "Officer", now: NOW },
    );
    expect(v.beneficialOwners.map((owner) => owner.name)).toEqual(["A. Owner", "B. Owner", "C. Holdings"]);
    expect(v.documents.map((doc) => doc.kind)).toEqual(["TAX CLEARANCE", "REGISTRY EXTRACT", "SANCTIONS SCREEN"]);
    expect(v.status).toBe("VERIFIED");
  });

  test("a check with no beneficial owner or no document cannot be VERIFIED", () => {
    const noOwner = normalizeVerification({ ...CLEAN, beneficialOwners: [] }, { checkedBy: "Officer", now: NOW });
    expect(noOwner.status).toBe("FAILED");
    expect(verificationFailures(noOwner, NOW).join(" ")).toContain("no beneficial owner");
    const noDoc = normalizeVerification({ ...CLEAN, documents: [] }, { checkedBy: "Officer", now: NOW });
    expect(noDoc.status).toBe("FAILED");
    expect(verificationFailures(noDoc, NOW).join(" ")).toContain("no verification document");
  });

  test("an expired check fails even when every field was clean", () => {
    const v = normalizeVerification({ ...CLEAN, expiresAt: "2026-01-01T00:00:00.000Z" }, { checkedBy: "Officer", now: NOW });
    expect(verificationFailures(v, NOW).join(" ")).toContain("expired on 2026-01-01");
  });

  test("an unknown source is refused rather than silently trusted", () => {
    expect(() => normalizeVerification({ ...CLEAN, source: "SELF_DECLARED" }, { checkedBy: "Officer", now: NOW })).toThrow(
      /REGISTRY_LOOKUP/,
    );
  });

  test("a check must name the officer who made it", () => {
    expect(() => normalizeVerification(CLEAN, { checkedBy: "  ", now: NOW })).toThrow(/name the officer/);
  });
});

describe("assurance blocks", () => {
  test("an unverified registered supplier cannot win", () => {
    const reason = assuranceBlockReason([supplier()], "Acme Supplies", NOW);
    expect(reason).toContain("no assurance check is on record");
  });

  test("a supplier absent from the register cannot win", () => {
    expect(assuranceBlockReason([], "Acme Supplies", NOW)).toContain("not on the supplier register");
  });

  test("a suspended supplier is caught regardless of its check", () => {
    const verified = normalizeVerification(CLEAN, { checkedBy: "Officer", now: NOW });
    const reason = assuranceBlockReason([supplier({ status: "SUSPENDED", verification: verified })], "Acme Supplies", NOW);
    expect(reason).toContain("SUSPENDED");
  });

  test("an expired check blocks with the expiry date named", () => {
    const expired = normalizeVerification({ ...CLEAN, expiresAt: "2026-02-01T00:00:00.000Z" }, { checkedBy: "Officer", now: NOW });
    const reason = assuranceBlockReason([supplier({ verification: expired })], "Acme Supplies", NOW);
    expect(reason).toContain("expired on 2026-02-01");
  });
});

describe("assurance at the application and award", () => {
  test("a failed check on the register refuses a new application", () => {
    const failed = normalizeVerification({ ...CLEAN, taxStatus: "EXPIRED" }, { checkedBy: "Officer", now: NOW });
    const out = validateApplicationAdmission({
      actor: "org:Acme Supplies",
      tenderRef: TENDER,
      amount: 500_000,
      closingDate: "2027-01-01T00:00:00.000Z",
      existing: [],
      registrationNo: "REG-WS6",
      supplierStatus: "ACTIVE",
      verification: failed,
      now: NOW,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe(403);
      expect(out.error).toContain("tax status is EXPIRED");
    }
  });

  test("a supplier with no check may still file — the award is where assurance bites", () => {
    const out = validateApplicationAdmission({
      actor: "org:Acme Supplies",
      tenderRef: TENDER,
      amount: 500_000,
      closingDate: "2027-01-01T00:00:00.000Z",
      existing: [],
      registrationNo: "REG-WS6",
      supplierStatus: "ACTIVE",
      now: NOW,
    });
    expect(out.ok).toBe(true);
  });

  test("the award gate blocks an unverified winner, then passes once the check is recorded", async () => {
    state.suppliers.push(supplier());
    const gate = {
      id: "gate_award_ws6",
      runId: "cycle",
      workspaceId: "demo",
      tenderId: TENDER,
      tool: "sign_award_report",
      inputs: {},
      status: "PENDING" as const,
      createdAt: NOW.toISOString(),
      requiredOffice: "ACCOUNTING_OFFICER" as const,
    };
    const blocked = preApprovalCheck(gate, "Accounting Officer", [], "Accounting Officer");
    expect(blocked).toContain("Supplier assurance fails");
    expect(blocked).toContain("no assurance check is on record");

    await cycleToolCall("verify_supplier", {
      supplierId: "sup_ws6",
      ...CLEAN,
      by: "Procurement Officer",
    });
    expect(preApprovalCheck(gate, "Accounting Officer", [], "Accounting Officer")).toBeNull();
  });

  test("an expired check blocks contract execution", () => {
    const expired = normalizeVerification(
      { ...CLEAN, expiresAt: "2026-02-01T00:00:00.000Z" },
      { checkedBy: "Officer", now: NOW },
    );
    state.suppliers.push(supplier({ verification: expired }));
    state.cycle[0].contract = {
      tenderId: TENDER,
      supplier: "Acme Supplies",
      value: 500_000,
      currency: "ZMW",
      openedAt: NOW.toISOString(),
      status: "DRAFT",
      supplierAcceptedAt: NOW.toISOString(),
      supplierSignatory: "A. Director",
      performanceSecurity: { amount: 50_000, issuer: "Bank", validUntil: "2027-10-30" },
      insurance: { policyNo: "POL-1", issuer: "Insurer", validUntil: "2027-10-30" },
      milestones: [],
      variations: [],
      payments: [],
    };
    const gate = {
      id: "gate_execute_ws6",
      runId: "cycle",
      workspaceId: "demo",
      tenderId: TENDER,
      tool: "execute_contract",
      inputs: {},
      status: "PENDING" as const,
      createdAt: NOW.toISOString(),
      requiredOffice: "ACCOUNTING_OFFICER" as const,
    };
    const reason = preApprovalCheck(gate, "Accounting Officer", [], "Accounting Officer");
    expect(reason).toContain("Supplier assurance fails");
    expect(reason).toContain("expired on 2026-02-01");
  });

  test("a supplier suspended after application is caught before contract execution", () => {
    const clean = normalizeVerification(CLEAN, { checkedBy: "Officer", now: NOW });
    state.suppliers.push(supplier({ status: "SUSPENDED", verification: clean }));
    state.cycle[0].contract = {
      tenderId: TENDER,
      supplier: "Acme Supplies",
      value: 500_000,
      currency: "ZMW",
      openedAt: NOW.toISOString(),
      status: "DRAFT",
      supplierAcceptedAt: NOW.toISOString(),
      supplierSignatory: "A. Director",
      performanceSecurity: { amount: 50_000, issuer: "Bank", validUntil: "2027-10-30" },
      insurance: { policyNo: "POL-1", issuer: "Insurer", validUntil: "2027-10-30" },
      milestones: [],
      variations: [],
      payments: [],
    };
    const gate = {
      id: "gate_execute_ws6b",
      runId: "cycle",
      workspaceId: "demo",
      tenderId: TENDER,
      tool: "execute_contract",
      inputs: {},
      status: "PENDING" as const,
      createdAt: NOW.toISOString(),
      requiredOffice: "ACCOUNTING_OFFICER" as const,
    };
    const reason = preApprovalCheck(gate, "Accounting Officer", [], "Accounting Officer");
    expect(reason).toContain("SUSPENDED");
  });

  test("the assurance check is written to the register, not asserted by the caller", async () => {
    state.suppliers.push(supplier());
    const result = (await cycleToolCall("verify_supplier", {
      supplierId: "sup_ws6",
      ...CLEAN,
      sanctioned: true,
      by: "Procurement Officer",
    })) as { verification: { status: string; checkedBy: string } };
    expect(result.verification.status).toBe("VERIFIED");
    expect(result.verification.checkedBy).toBe("Procurement Officer");
    expect(state.suppliers[0].verification?.status).toBe("VERIFIED");
  });
});
