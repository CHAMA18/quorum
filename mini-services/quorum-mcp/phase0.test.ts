import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_DEPLOYMENT,
  DEFAULT_FEATURES,
  normalizeDeployment,
  normalizeFeatures,
  registeredConnector,
  state,
  type Gate,
  type Supplier,
  type TenderCycle,
} from "./store";
import { composeAwardNotice, composeProcurementFile } from "./cycle";
import { preApprovalCheck } from "./cycle-routes";

const TENDER = "T-PHASE0";

/* WS6 is on by default: a lawful open method and a verified winner so the
   deployment rules are tested, not the assurance gate. */
const VERIFIED_SUPPLIER: Supplier = {
  id: "sup_phase0",
  name: "Acme Supplies",
  registrationNo: "REG-PHASE0",
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
    checkedAt: "2026-10-30T09:00:00.000Z",
    expiresAt: "2027-10-30T00:00:00.000Z",
    source: "REGISTRY_LOOKUP",
    checkedBy: "Procurement Officer",
  },
  addedBy: "officer",
  createdAt: "2026-10-30T09:00:00.000Z",
};

const CONNECTOR = registeredConnector({ name: "e-GP production" });

const CONNECTED = {
  mode: "CONNECTED" as const,
  connectorId: CONNECTOR.id,
  publication: {
    mode: "CONNECTED" as const,
    portal: "e-GP production",
    receiptId: "RCPT-1",
    evidenceHash: "abc123",
    publishedAt: "2026-10-30T09:00:00.000Z",
  },
};

/* Receipt + live registered connector — the full CONNECTED claim. */
function deploymentConnected() {
  return normalizeDeployment(CONNECTED, CONNECTOR);
}

function cycle(): TenderCycle {
  return {
    tenderId: TENDER,
    methodId: "open-bidding",
    coi: [],
    alb: [],
    debriefs: [],
    complaints: [],
    clarifications: [],
    addenda: [],
    notices: [],
    specs: [],
    matrix: {
      id: "mat_phase0",
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
      certifiedAt: "2026-10-30T09:30:00.000Z",
      certifiedBy: "Chair",
      createdAt: "2026-10-30T09:00:00.000Z",
    },
    awardReport: {
      tenderId: TENDER,
      md: "# award",
      recommendation: "Acme Supplies",
      sha: "sha-phase0",
      createdAt: "2026-10-30T09:00:00.000Z",
      signedAt: "2026-10-30T10:00:00.000Z",
      signedBy: "Accounting Officer",
    },
    awardNotice: {
      tenderId: TENDER,
      md: "# notice",
      sha: "sha-notice",
      portal: "e-GP production",
      publishedAt: "2026-10-30T11:00:00.000Z",
      publication: {
        mode: "CONNECTED",
        portal: "e-GP production",
        receiptId: "RCPT-1",
        evidenceHash: "abc123",
        publishedAt: "2026-10-30T11:00:00.000Z",
      },
    },
    createdAt: "2026-10-30T08:00:00.000Z",
  } as TenderCycle;
}

beforeEach(() => {
  state.cycle = state.cycle.filter((row) => row.tenderId !== TENDER);
  state.cycle.push(cycle());    state.deployment = deploymentConnected();
  state.connector = CONNECTOR;
  state.features = { ...DEFAULT_FEATURES };
  state.suppliers.push(structuredClone(VERIFIED_SUPPLIER));
  state.budgetLines.push({
    id: "bud_phase0",
    workspaceId: "demo",
    fiscalYear: 2026,
    code: "CAP-2026",
    currency: "ZMW",
    approved: 5_000_000,
    committed: 0,
    spent: 0,
    createdAt: "2026-10-30T09:00:00.000Z",
    updatedAt: "2026-10-30T09:00:00.000Z",
  });
});

afterEach(() => {
  state.cycle = state.cycle.filter((row) => row.tenderId !== TENDER);
  state.deployment = normalizeDeployment(DEFAULT_DEPLOYMENT);
  state.connector = null;
  state.sittings.length = 0;
  state.forwardedKeys.length = 0;
  state.features = { ...DEFAULT_FEATURES };
  state.budgetLines.length = 0;
  state.suppliers = state.suppliers.filter((s) => s.id !== VERIFIED_SUPPLIER.id);
});

describe("deployment truth", () => {
  test("an empty record is RECORD_ONLY and SIMULATED", () => {
    const deployment = normalizeDeployment(undefined);
    expect(deployment.mode).toBe("RECORD_ONLY");
    expect(deployment.publication.mode).toBe("SIMULATED");
    expect(deployment.publication.portal).toContain("simulated");
  });

  test("a claimed CONNECTED state without a receipt collapses to RECORD_ONLY", () => {
    const deployment = normalizeDeployment({
      mode: "CONNECTED",
      publication: { mode: "CONNECTED", portal: "Somewhere" },
    });
    expect(deployment.mode).toBe("RECORD_ONLY");
    expect(deployment.publication.mode).toBe("SIMULATED");
  });

  test("a complete external receipt AND a live registered connector survive normalisation", () => {
    const deployment = deploymentConnected();
    expect(deployment.mode).toBe("CONNECTED");
    expect(deployment.publication.receiptId).toBe("RCPT-1");
    expect(deployment.publication.evidenceHash).toBe("abc123");
    expect(deployment.connectorId).toBe(CONNECTOR.id);
  });
});

describe("feature registry", () => {
  test("defaults keep the refusals on and the shipped workstreams reachable", () => {
    const features = normalizeFeatures(undefined);
    expect(features.recordOnlyEnforcement).toBe(true);
    expect(features.truthInLabeling).toBe(true);
    expect(features.liveRuleCatalogue).toBe(true);
    expect(features.sealedBids).toBe(true);
    expect(features.bidLifecycle).toBe(true);
    expect(features.jurisdictionClock).toBe(true);
    expect(features.addendumEnforcement).toBe(true);
    expect(features.actorBoundOffice).toBe(true);
    expect(features.dualApproval).toBe(true);
    expect(features.connectedPublication).toBe(false);
    expect(features.connectedPublication).toBe(false);
  });

  test("known booleans are accepted and unknown keys are ignored", () => {
    const features = normalizeFeatures({ sealedBids: true, madeUpFlag: true });
    expect(features.sealedBids).toBe(true);
    expect("madeUpFlag" in features).toBe(false);
  });
});

describe("award notice labels what it is", () => {
  test("a simulated notice says it is not a publication receipt", () => {
    const md = composeAwardNotice({
      tenderId: TENDER,
      portal: "e-GP portal (simulated — no transmission)",
      publicationMode: "SIMULATED",
    });
    expect(md).toContain("SIMULATED — no transmission");
    expect(md).toContain("not a publication receipt");
    expect(md).toContain("recorded rehearsal");
  });

  test("a connected notice names the external receipt", () => {
    const md = composeAwardNotice({
      tenderId: TENDER,
      portal: "e-GP production",
      publicationMode: "CONNECTED",
      receiptId: "RCPT-9",
    });
    expect(md).toContain("transmitted to e-GP production");
    expect(md).toContain("receipt RCPT-9");
    expect(md).not.toContain("SIMULATED — no transmission");
  });
});

describe("procurement file watermark", () => {
  test("a record-only file cannot be mistaken for a publication receipt", () => {
    const md = composeProcurementFile({
      tenderId: TENDER,
      runs: [],
      gates: [],
      generatedAt: "2026-10-30T10:00:00.000Z",
      deployment: { mode: "RECORD_ONLY", label: "e-GP portal (simulated — no transmission)" },
    });
    expect(md).toContain("RECORD-ONLY — NOT A PUBLICATION RECEIPT");
    expect(md).toContain("Publication mode: RECORD_ONLY");
  });

  test("a connected file does not carry the rehearsal watermark", () => {
    const md = composeProcurementFile({
      tenderId: TENDER,
      runs: [],
      gates: [],
      generatedAt: "2026-10-30T10:00:00.000Z",
      deployment: { mode: "CONNECTED", label: "e-GP production", receiptId: "RCPT-1" },
    });
    expect(md).not.toContain("RECORD-ONLY — NOT A PUBLICATION RECEIPT");
    expect(md).toContain("Publication mode: CONNECTED");
  });
});

describe("the contract path is fail-closed", () => {
  const gate = {
    id: "gate_phase0",
    runId: "cycle",
    tenderId: TENDER,
    tool: "sign_contract_pack",
    inputs: { value: 1_000_000, budgetLineId: "bud_phase0" },
    status: "PENDING",
    createdAt: "2026-10-30T10:00:00.000Z",
  } as Gate;

  test("record-only refuses a contract before standstill or value checks", () => {
    state.deployment = normalizeDeployment(DEFAULT_DEPLOYMENT);
    const reason = preApprovalCheck(gate, "Officer", [], "Officer");
    expect(reason).toContain("RECORD-ONLY");
    expect(reason).toContain("contract");
  });

  test("a connected receipt AND live connector open the contract path", () => {
    state.deployment = deploymentConnected();
    expect(preApprovalCheck(gate, "Officer", [], "Officer")).toBeNull();
  });

  test("a receipt without a registered connector stays locked out", () => {
    state.deployment = normalizeDeployment(CONNECTED, null);
    const reason = preApprovalCheck(gate, "Officer", [], "Officer");
    expect(reason).toContain("RECORD-ONLY");
  });

  test("a deactivated connector collapses the deployment at normalisation", () => {
    state.deployment = normalizeDeployment(CONNECTED, { ...CONNECTOR, active: false });
    expect(state.deployment.mode).toBe("RECORD_ONLY");
    expect(preApprovalCheck(gate, "Officer", [], "Officer")).toContain("RECORD-ONLY");
  });

  test("record-only refuses payment certification too", () => {
    state.deployment = normalizeDeployment(DEFAULT_DEPLOYMENT);
    const paymentGate = { ...gate, tool: "certify_payment", inputs: { paymentId: "pay_1" } } as Gate;
    const reason = preApprovalCheck(paymentGate, "Officer", [], "Officer");
    expect(reason).toContain("RECORD-ONLY");
    expect(reason).toContain("payment");
  });

  test("a simulated award notice blocks a contract even when the workspace is connected", () => {
    state.deployment = deploymentConnected();
    const row = state.cycle.find((c) => c.tenderId === TENDER);
    if (!row) throw new Error("fixture missing");
    row.awardNotice = {
      ...row.awardNotice!,
      publication: { mode: "SIMULATED", portal: "e-GP portal (simulated — no transmission)" },
    };
    const reason = preApprovalCheck(gate, "Officer", [], "Officer");
    expect(reason).toContain("SIMULATED");
    expect(reason).toContain("contract");
  });

  test("a notice staged under another deployment mode cannot be published", () => {
    state.deployment = deploymentConnected();
    const publishGate = {
      ...gate,
      tool: "publish_award_notice",
      inputs: { sha: "sha-notice", portal: "e-GP production", publicationMode: "SIMULATED" },
    } as Gate;
    expect(preApprovalCheck(publishGate, "Officer", [], "Officer")).toContain("staged in SIMULATED");
  });
});
