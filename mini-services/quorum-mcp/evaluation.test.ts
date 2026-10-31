import { afterEach, describe, expect, test } from "bun:test";
import { handleCycleRoutes, preApprovalCheck } from "./cycle-routes";
import { scoreMatrix } from "./cycle";
import {
  computeDivergences,
  conflictScreening,
  consensusScores,
  consensusValidationError,
  evaluationBlockReason,
  evaluatedPrice,
  fxBlockReason,
  normalizeFxRates,
  sheetValidationError,
  sameEntity,
} from "./evaluation";
import { state, type CoiDeclaration, type EvalMatrix, type EvalScoreSheet, type RosterMemberForGate, type TenderCycle } from "./store";

const NOW = new Date("2026-10-30T10:00:00.000Z");
const TENDER = "T-WS7-TEST";

function matrix(over: Partial<EvalMatrix> = {}): EvalMatrix {
  return {
    id: "mtx_ws7",
    tenderId: TENDER,
    criteria: [
      { id: "C-01", title: "Method", weight: 60 },
      { id: "C-02", title: "Team", weight: 40 },
    ],
    technicalWeightPct: 80,
    bids: [
      {
        bidder: "Acme Holdings Ltd",
        late: false,
        responsiveness: "RESPONSIVE",
        reasons: [],
        technicalScores: [
          { criterionId: "C-01", score: 80 },
          { criterionId: "C-02", score: 80 },
        ],
        technicalTotal: 80,
        financial: { amount: 10_000, currency: "USD" },
        verdict: "RECOMMENDED",
      },
      {
        bidder: "Beta Works",
        late: false,
        responsiveness: "RESPONSIVE",
        reasons: [],
        technicalScores: [
          { criterionId: "C-01", score: 60 },
          { criterionId: "C-02", score: 60 },
        ],
        technicalTotal: 60,
        financial: { amount: 260_000, currency: "ZMW" },
        verdict: "NOT_RECOMMENDED",
      },
    ],
    evaluationCurrency: "ZMW",
    fxRates: [{ base: "USD", quote: "ZMW", rate: 25.8, source: "Bank of Zambia", asOf: NOW.toISOString() }],
    sheets: [],
    status: "DRAFT",
    createdAt: NOW.toISOString(),
    ...over,
  };
}

function sheet(evaluator: string, first: number, second: number): EvalScoreSheet {
  return {
    id: `sheet_${evaluator.replace(/\s+/g, "_")}`,
    matrixId: "mtx_ws7",
    tenderId: TENDER,
    evaluator,
    scores: [
      { bidder: "Acme Holdings Ltd", criterionId: "C-01", score: first },
      { bidder: "Acme Holdings Ltd", criterionId: "C-02", score: first },
      { bidder: "Beta Works", criterionId: "C-01", score: second },
      { bidder: "Beta Works", criterionId: "C-02", score: second },
    ],
    submittedBy: evaluator,
    submittedAt: NOW.toISOString(),
    version: 1,
    signature: "test-signature",
  };
}

function coi(member: string, entities: CoiDeclaration["entities"] = []): CoiDeclaration {
  return {
    id: `coi_${member.replace(/\s+/g, "_")}`,
    tenderId: TENDER,
    member,
    declaration: "NO_CONFLICT",
    ...(entities?.length ? { entities } : {}),
    declaredAt: NOW.toISOString(),
  };
}

const ROSTER: RosterMemberForGate[] = [
  { name: "Eval One", status: "PRESENT", office: "EVALUATION_COMMITTEE" },
  { name: "Eval Two", status: "PRESENT", office: "EVALUATION_COMMITTEE" },
  { name: "Buyer", status: "PRESENT", office: "PROCUREMENT_UNIT" },
];

describe("FX-scored prices", () => {
  test("a foreign bid is converted and the formula scores the evaluated amount", () => {
    const scored = scoreMatrix(matrix());
    const acme = scored.bids.find((bid) => bid.bidder === "Acme Holdings Ltd")!;
    expect(acme.financial?.evaluatedAmount).toBe(258_000);
    expect(acme.financial?.evaluatedCurrency).toBe("ZMW");
    expect(acme.financial?.fxRate).toBe(25.8);
    /* 258,000 is the lowest evaluated price, so it scores 100; 260,000 scores 99.2. */
    expect(acme.financial?.formulaScore).toBe(100);
    expect(scored.bids.find((bid) => bid.bidder === "Beta Works")!.financial?.formulaScore).toBe(99.2);
  });

  test("a foreign price with no quote is not silently compared as the same currency", () => {
    const scored = scoreMatrix(matrix({ fxRates: [] }));
    const acme = scored.bids.find((bid) => bid.bidder === "Acme Holdings Ltd")!;
    expect(acme.financial?.evaluatedAmount).toBeUndefined();
    expect(acme.financial?.fxError).toContain("no USD→ZMW rate");
    expect(acme.financial?.formulaScore).toBe(0);
    expect(fxBlockReason(scored, 30, NOW)).toContain("no USD→ZMW rate");
  });

  test("a stale quote is refused at the gate", () => {
    const stale = matrix({ fxRates: [{ base: "USD", quote: "ZMW", rate: 25.8, source: "BoZ", asOf: "2026-08-01T00:00:00.000Z" }] });
    expect(fxBlockReason(stale, 30, NOW)).toContain("days old");
  });

  test("normalizeFxRates refuses an unsourced or undated quote", () => {
    expect(() => normalizeFxRates([{ base: "USD", rate: 25.8, asOf: "2026-10-29" }], "ZMW", NOW)).toThrow("source");
    expect(() => normalizeFxRates([{ base: "USD", rate: 25.8, source: "BoZ" }], "ZMW", NOW)).toThrow("date");
    expect(() => normalizeFxRates([{ base: "ZMW", rate: 1, source: "BoZ", asOf: "2026-10-29" }], "ZMW", NOW)).toThrow(
      "same-currency",
    );
  });

  test("evaluatedPrice leaves legacy matrices on their stated amounts", () => {
    expect(evaluatedPrice({ fxRates: [] }, { amount: 1000, currency: "USD" })).toEqual({ state: "LEGACY", amount: 1000 });
    expect(evaluatedPrice(matrix(), { amount: 1000, currency: "ZMW" })).toEqual({ state: "SAME", amount: 1000 });
  });
});

describe("structured conflicts", () => {
  test("names are folded and company suffixes do not hide a match", () => {
    expect(sameEntity("Acme Holdings", "ACME HOLDINGS LIMITED")).toBe(true);
    expect(sameEntity("Dr. Chanda Mwale", "Chanda Mwale", "PERSON")).toBe(true);
    expect(sameEntity("Mwale", "Chanda Mwale", "PERSON")).toBe(false);
  });

  test("a declaration entity is screened against bidders and beneficial owners", () => {
    const suppliers = [
      {
        id: "sup_1",
        workspaceId: "demo",
        name: "Beta Works",
        registrationNo: "R1",
        categories: [],
        metadata: {},
        status: "ACTIVE" as const,
        addedBy: "test",
        createdAt: NOW.toISOString(),
        verification: {
          status: "VERIFIED" as const,
          registryStatus: "REGISTERED" as const,
          taxStatus: "VALID" as const,
          beneficialOwners: [{ name: "Chanda Mwale", role: "Director" }],
          sanctions: "CLEAR" as const,
          pep: "CLEAR" as const,
          documents: [{ id: "doc_1", kind: "TAX CLEARANCE" }],
          checkedAt: NOW.toISOString(),
          expiresAt: "2027-04-01T00:00:00.000Z",
          source: "REGISTRY_LOOKUP" as const,
          checkedBy: "Officer",
        },
      },
    ];
    const hits = conflictScreening([coi("Eval One", [{ name: "Acme Holdings" }, { name: "Chanda Mwale", kind: "PERSON" }])], ["Acme Holdings Ltd", "Beta Works"], suppliers);
    expect(hits.map((hit) => `${hit.bidder}:${hit.matchedKind}`)).toEqual(["Acme Holdings Ltd:BIDDER", "Beta Works:BENEFICIAL_OWNER"]);
  });

  test("an undisclosed screened connection blocks certification", () => {
    const m = matrix({ sheets: [sheet("Eval One", 80, 60), sheet("Eval Two", 80, 60)] });
    m.consensus = consensusFor(m);
    const reason = evaluationBlockReason({
      matrix: m,
      coi: [coi("Eval One", [{ name: "Acme Holdings" }]), coi("Eval Two")],
      suppliers: [],
      roster: ROSTER,
      divergencePoints: 25,
      fxStalenessDays: 30,
      now: NOW,
    });
    expect(reason).toContain("declared no conflict");
    expect(reason).toContain("Acme Holdings");
  });
});

function consensusFor(m: EvalMatrix) {
  return {
    matrixId: m.id,
    scores: consensusScores(m.sheets ?? []),
    attendees: ["Eval One", "Eval Two"],
    notes: "The panel reconciled the spread on the method score against the cited evidence.",
    divergences: computeDivergences(m.sheets ?? []),
    recordedBy: "Eval One",
    recordedAt: NOW.toISOString(),
    signature: "consensus-sig",
  };
}

describe("sheets and consensus", () => {
  test("a sheet must cover every bidder and criterion", () => {
    expect(sheetValidationError(matrix(), [{ bidder: "Acme Holdings Ltd", criterionId: "C-01", score: 80 }])).toContain(
      "one score for every bidder",
    );
    expect(sheetValidationError(matrix(), sheet("Eval One", 80, 60).scores)).toBeNull();
  });

  test("divergences are computed per cell, widest first", () => {
    const divergences = computeDivergences([sheet("Eval One", 90, 60), sheet("Eval Two", 60, 60)]);
    expect(divergences[0].spread).toBe(30);
    expect(divergences[0].values.map((value) => value.evaluator)).toEqual(["Eval One", "Eval Two"]);
  });

  test("a consensus must name every sheet's evaluator and minute a wide spread", () => {
    const m = matrix({ sheets: [sheet("Eval One", 90, 60), sheet("Eval Two", 60, 60)] });
    expect(consensusValidationError(m, ["Eval One"], "notes", 25)).toContain("at least two");
    expect(consensusValidationError(m, ["Eval One", "Eval Two"], "ok", 25)).toContain("spread 30");
    expect(
      consensusValidationError(m, ["Eval One", "Eval Two"], "The panel reconciled the method spread against the cited evidence.", 25),
    ).toBeNull();
  });

  test("certification refuses missing sheets, then missing consensus, then passes a complete record", () => {
    const base = matrix();
    const noSheets = evaluationBlockReason({
      matrix: base,
      coi: [coi("Eval One"), coi("Eval Two")],
      suppliers: [],
      roster: ROSTER,
      divergencePoints: 25,
      fxStalenessDays: 30,
      now: NOW,
    });
    expect(noSheets).toContain("Score sheets are outstanding");

    const sheets = [sheet("Eval One", 80, 60), sheet("Eval Two", 80, 60)];
    const noConsensus = evaluationBlockReason({
      matrix: matrix({ sheets }),
      coi: [coi("Eval One"), coi("Eval Two")],
      suppliers: [],
      roster: ROSTER,
      divergencePoints: 25,
      fxStalenessDays: 30,
      now: NOW,
    });
    expect(noConsensus).toContain("No committee consensus");

    const full = matrix({ sheets });
    full.consensus = consensusFor(full);
    expect(
      evaluationBlockReason({
        matrix: full,
        coi: [coi("Eval One"), coi("Eval Two")],
        suppliers: [],
        roster: ROSTER,
        divergencePoints: 25,
        fxStalenessDays: 30,
        now: NOW,
      }),
    ).toBeNull();
  });

  test("a recused evaluator's sheet cannot count", () => {
    const roster: RosterMemberForGate[] = [
      ...ROSTER,
      { name: "Eval Three", status: "PRESENT", office: "EVALUATION_COMMITTEE" },
    ];
    const m = matrix({ sheets: [sheet("Eval One", 80, 60), sheet("Eval Two", 80, 60), sheet("Eval Three", 80, 60)] });
    m.consensus = consensusFor(m);
    const reason = evaluationBlockReason({
      matrix: m,
      coi: [coi("Eval One"), { ...coi("Eval Two"), declaration: "CONFLICT_DECLARED" }, coi("Eval Three")],
      suppliers: [],
      roster,
      divergencePoints: 25,
      fxStalenessDays: 30,
      now: NOW,
    });
    expect(reason).toContain("Eval Two");
  });
});

describe("the evaluator routes", () => {
  afterEach(() => {
    state.cycle = state.cycle.filter((cycle) => cycle.tenderId !== TENDER);
    state.features.evaluationIntegrity = true;
  });

  test("sheets and consensus move the matrix technical column, and the gate accepts the record", async () => {
    const m = matrix();
    state.cycle = state.cycle.filter((cycle) => cycle.tenderId !== TENDER);
    state.cycle.push({
      tenderId: TENDER,
      coi: [coi("Eval One"), coi("Eval Two"), coi("Buyer")],
      matrix: m,
      alb: [],
      debriefs: [],
      complaints: [],
      clarifications: [],
      addenda: [],
      notices: [],
      specs: [],
      createdAt: NOW.toISOString(),
    } as TenderCycle);

    for (const [evaluator, first, second] of [
      ["Eval One", 90, 60],
      ["Eval Two", 60, 60],
    ] as const) {
      const res = await handleCycleRoutes(`/api/tenders/${TENDER}/matrix/sheets`, "POST", {
        evaluator,
        scores: sheet(evaluator, first, second).scores,
      }, evaluator);
      expect(res?.status).toBe(201);
    }

    const consensusRes = await handleCycleRoutes(`/api/tenders/${TENDER}/matrix/consensus`, "POST", {
      attendees: ["Eval One", "Eval Two"],
      notes: "The panel reconciled the method spread against the cited evidence.",
    }, "Eval One");
    expect(consensusRes?.status).toBe(201);

    const cycle = state.cycle.find((row) => row.tenderId === TENDER)!;
    expect(cycle.matrix?.consensus?.scores.find((score) => score.bidder === "Acme Holdings Ltd" && score.criterionId === "C-01")?.score).toBe(75);
    expect(cycle.matrix?.bids[0].technicalScores.find((score) => score.criterionId === "C-01")?.score).toBe(75);

    const gate = {
      id: "gate_ws7",
      runId: "run_ws7",
      tenderId: TENDER,
      tool: "certify_evaluation",
      inputs: {},
      status: "PENDING" as const,
      createdAt: NOW.toISOString(),
      requiredOffice: "EVALUATION_COMMITTEE" as const,
    };
    expect(preApprovalCheck(gate, "Eval One", ROSTER, "Someone Else")).toBeNull();
  });

  test("a sheet from a member who declared a conflict is refused at the route", async () => {
    const m = matrix();
    state.cycle = state.cycle.filter((cycle) => cycle.tenderId !== TENDER);
    state.cycle.push({
      tenderId: TENDER,
      coi: [{ ...coi("Eval One"), declaration: "CONFLICT_DECLARED", conflicts: "Family interest" }, coi("Eval Two")],
      matrix: m,
      alb: [],
      debriefs: [],
      complaints: [],
      clarifications: [],
      addenda: [],
      notices: [],
      specs: [],
      createdAt: NOW.toISOString(),
    } as TenderCycle);
    const res = await handleCycleRoutes(`/api/tenders/${TENDER}/matrix/sheets`, "POST", {
      evaluator: "Eval One",
      scores: sheet("Eval One", 80, 60).scores,
    }, "Eval One");
    expect(res?.status).toBe(422);
    const body = (await res!.json()) as { error: string };
    expect(body.error).toContain("cannot submit");
  });
});
