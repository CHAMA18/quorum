import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { criterionEvidenceSuggestions, evaluatePackSignals, TENDERS_DIR, type BidDoc } from "./engine";
import { handleCycleRoutes } from "./cycle-routes";
import { state, withWorkspace, type TenderCycle } from "./store";

describe("criterion evidence suggestions", () => {
  test("returns ranked verbatim passages with source locators, without scoring", () => {
    const suggestions = criterionEvidenceSuggestions(
      "\nThe proposed solar system provides 24 hours of battery storage.\nThe solar battery storage team has delivered 4,000 rural health installations.",
      "02-bid-weza.md",
      "solar battery storage",
      undefined,
      2,
    );
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]).toMatchObject({
      citation: "02-bid-weza.md, line 2",
      quote: "The proposed solar system provides 24 hours of battery storage.",
      relevance: 100,
    });
    expect(suggestions[1].citation).toBe("02-bid-weza.md, line 3");
    expect(criterionEvidenceSuggestions("some passage", "bid.md", "and the for")).toEqual([]);
  });
});

describe("evaluation market signals", () => {
  const bids: BidDoc[] = [
    {
      bidder: "Alpha Ltd",
      source: "01-alpha.md",
      text: [
        "**Company registration:** PACRA-123456",
        "**Email:** bids@example.test",
        "| Item | Quantity | Unit price (KES) |",
        "| Solar tablet | 10 | KES 100 |",
      ].join("\n"),
    },
    {
      bidder: "Beta Ltd",
      source: "02-beta.md",
      text: [
        "**Company registration:** pacra-123456",
        "**Email:** BIDS@example.test",
        "| Item | Quantity | Unit price (KES) |",
        "| Solar tablet | 8 | KES 150 |",
      ].join("\n"),
    },
    {
      bidder: "Gamma Ltd",
      source: "03-gamma.md",
      text: [
        "**Email:** gamma@example.test",
        "| Item | Quantity | Unit price (USD) |",
        "| Solar tablet | 8 | USD 1 |",
      ].join("\n"),
    },
  ];

  test("compares only exact item and currency peers and computes extended totals", () => {
    const analytics = evaluatePackSignals(bids);
    const alpha = analytics.prices.find((row) => row.bidder === "Alpha Ltd")!;
    expect(alpha).toMatchObject({ item: "Solar tablet", quantity: 10, unitPrice: 100, extendedPrice: 1000, currency: "KES", peerMedian: 150, ratioToPeerMedian: 0.67 });
    expect(analytics.prices.find((row) => row.bidder === "Gamma Ltd")?.peerMedian).toBeUndefined();
    expect(analytics.totalsByCurrency).toContainEqual({ bidder: "Alpha Ltd", currency: "KES", total: 1000 });
  });

  test("shared identifiers are source-cited review signals and not accusations", () => {
    const analytics = evaluatePackSignals(bids);
    expect(analytics.sharedIdentifiers).toHaveLength(2);
    expect(analytics.sharedIdentifiers.map((row) => row.kind).sort()).toEqual(["EMAIL", "REGISTRATION"]);
    for (const signal of analytics.sharedIdentifiers) {
      expect(signal.bidders).toHaveLength(2);
      expect(signal.bidders.every((bidder) => bidder.citation.includes("line"))).toBe(true);
      expect(signal.interpretation).toContain("not a collusion finding");
    }
  });
});

describe("evaluation matrix route persists evidence and market signals", () => {
  const tenderId = "T-MATRIX-MARKET-ROUTE";
  const tenderDir = join(TENDERS_DIR, tenderId);

  test("builds a cited evidence matrix, preserves market signals, then records a human evidence decision", async () => {
    await rm(tenderDir, { recursive: true, force: true });
    await mkdir(tenderDir, { recursive: true });
    state.cycle = state.cycle.filter((cycle) => cycle.tenderId !== tenderId);
    state.cycle.push({
      tenderId,
      coi: [],
      alb: [],
      debriefs: [],
      complaints: [],
      clarifications: [],
      addenda: [],
      opening: {
        id: "opening-market-test",
        tenderId,
        createdAt: new Date().toISOString(),
        rows: [
          { bidder: "ALPHA", receivedAt: new Date().toISOString(), late: false },
          { bidder: "BETA", receivedAt: new Date().toISOString(), late: false },
        ],
        minutesMd: "Public opening fixture",
        reconciliation: { sealed: 0, manual: 2, derived: 0, withdrawn: 0, amended: 0, missingFromRegister: [], extraInRegister: [], matches: true, note: "fixture reconciles" },
        certifiedAt: new Date().toISOString(),
      },
      notices: [{
        id: "issued-market-test-notice",
        tenderId,
        md: [
          "# TENDER NOTICE",
          "**Technical/financial split:** 80/20",
          "**Financial formula:** Lowest evaluated price / bidder evaluated price × 100; arithmetic corrections, unconditional discounts and published preference applied before ranking.",
          "**Preference/reservation scheme:** None",
          "**Foreign bidders permitted:** No",
          "**Evaluation currency:** KES",
          "## Evaluation criteria (published with this notice)",
          "| Criterion | Weight (%) |",
          "| --- | ---: |",
          "| solar battery storage | 100 |",
        ].join("\n"),
        fieldCheck: [],
        createdAt: new Date().toISOString(),
        issuedAt: new Date().toISOString(),
      }],
      specs: [],
      dissents: [],
      createdAt: new Date().toISOString(),
    } as TenderCycle);
    await writeFile(join(tenderDir, "91-bid-alpha.md"), [
      "**Company registration:** PACRA-123456",
      "**Email:** bids@example.test",
      "The solar system provides 24 hours of battery storage.",
      "| Item | Quantity | Unit price (KES) |",
      "| Solar tablet | 10 | KES 100 |",
    ].join("\n"));
    await writeFile(join(tenderDir, "92-bid-beta.md"), [
      "**Company registration:** pacra-123456",
      "**Email:** BIDS@example.test",
      "The bidder provides 12 hours of battery storage.",
      "| Item | Quantity | Unit price (KES) |",
      "| Solar tablet | 8 | KES 150 |",
    ].join("\n"));

    try {
      const built = await handleCycleRoutes(`/api/tenders/${tenderId}/matrix`, "POST", {
        criteria: [{ title: "solar battery storage", weight: 100 }],
        technicalWeightPct: 80,
      });
      expect(built?.status).toBe(201);
      const builtBody = await built!.json() as { matrix: { marketSignals?: { sharedIdentifiers: unknown[] }; bids: { bidder: string; evidenceByCriterion?: { evidence: { citation: string; quote: string }[] }[]; priceSignals?: { item: string; peerMedian?: number }[] }[] } };
      const alpha = builtBody.matrix.bids.find((bid) => bid.bidder === "ALPHA")!;
      expect(alpha.evidenceByCriterion?.[0].evidence[0]).toMatchObject({
        citation: "91-bid-alpha.md, line 3",
        quote: "The solar system provides 24 hours of battery storage.",
      });
      expect(alpha.priceSignals?.[0]).toMatchObject({ item: "Solar tablet", peerMedian: 150 });
      expect(builtBody.matrix.marketSignals?.sharedIdentifiers).toHaveLength(2);
      const matrixRecord = state.cycle.find((cycle) => cycle.tenderId === tenderId)?.matrix;
      matrixRecord!.financialAdjustmentsCertifiedAt = new Date().toISOString();
      matrixRecord!.financialAdjustmentsCertifiedBy = "Procurement Unit";

      const fx = await handleCycleRoutes(`/api/tenders/${tenderId}/matrix/fx`, "POST", {
        evaluationCurrency: "KES",
        rates: [],
      });
      expect(fx?.status).toBe(201);

      const earlyScore = await handleCycleRoutes(`/api/tenders/${tenderId}/matrix/scores`, "POST", {
        bidder: "ALPHA",
        scores: [{ criterionId: "C-01", score: 80 }],
      }, "Test Officer");
      expect(earlyScore?.status).toBe(422);
      expect(await earlyScore!.json()).toMatchObject({ error: expect.stringContaining("MED adjustment") });

      const med = await handleCycleRoutes(`/api/tenders/${tenderId}/matrix/med`, "POST", {
        attendees: ["Evaluation Committee"],
        adjustments: {},
        notes: "No margin-of-error adjustment is required for this test pack.",
      });
      expect(med?.status).toBe(200);

      const scored = await handleCycleRoutes(`/api/tenders/${tenderId}/matrix/scores`, "POST", {
        bidder: "ALPHA",
        scores: [{ criterionId: "C-01", score: 80, evidenceDecision: "CONFIRMED" }],
      }, "Test Officer");
      expect(scored?.status).toBe(200);
      const scoredBody = await scored!.json() as { matrix: { bids: { bidder: string; technicalScores: { evidence?: { decision: string; decidedBy?: string }[] }[] }[] } };
      const scoredAlpha = scoredBody.matrix.bids.find((bid) => bid.bidder === "ALPHA")!;
      expect(scoredAlpha.technicalScores[0].evidence?.[0]).toMatchObject({ decision: "CONFIRMED", decidedBy: "Test Officer" });
      expect(state.cycle.find((cycle) => cycle.tenderId === tenderId)?.matrix?.marketSignals?.sharedIdentifiers).toHaveLength(2);

      const fxAfterScoring = await handleCycleRoutes(`/api/tenders/${tenderId}/matrix/fx`, "POST", {
        evaluationCurrency: "KES",
        rates: [],
      });
      expect(fxAfterScoring?.status).toBe(422);
      expect(await fxAfterScoring!.json()).toMatchObject({ error: expect.stringContaining("locked after scoring") });

      const opened = await handleCycleRoutes(`/api/tenders/${tenderId}/alb`, "POST", {
        bidder: "ALPHA",
        basis: "Unit price is materially below comparable bids for the same solar tablet scope.",
      });
      expect(opened?.status).toBe(201);
      const dossierBody = await opened!.json() as { dossier: { id: string; openedAt: string; responseDueAt: string } };
      expect(dossierBody.dossier.responseDueAt > dossierBody.dossier.openedAt).toBe(true);
      const openedBid = state.cycle.find((cycle) => cycle.tenderId === tenderId)?.matrix?.bids.find((bid) => bid.bidder === "ALPHA");
      expect(openedBid).toMatchObject({ albOpen: true, verdict: "NOT_RECOMMENDED" });

      const certifyWithOpenAlb = await handleCycleRoutes(`/api/tenders/${tenderId}/matrix/certify`, "POST", {});
      expect(certifyWithOpenAlb?.status).toBe(422);
      expect(await certifyWithOpenAlb!.json()).toMatchObject({ error: expect.stringContaining("open five-working-day ALB dossier") });
    } finally {
      state.cycle = state.cycle.filter((cycle) => cycle.tenderId !== tenderId);
      await rm(tenderDir, { recursive: true, force: true });
    }
  });
});

describe("authenticated workspace owns its tender-cycle writes", () => {
  test("pipeline, requisition and solicitation records stay in the request workspace", async () => {
    const workspaceId = "workspace-cycle-e2e";
    let pipelineId = "";
    let tenderId = "";

    try {
      await withWorkspace(workspaceId, async () => {
        const created = await handleCycleRoutes(
          "/api/pipeline",
          "POST",
          { title: "Workspace-scoped cycle test", currency: "ZMW" },
          "Audit Officer",
          workspaceId,
        );
        expect(created?.status).toBe(201);
        const createdBody = await created!.json() as { entry: { id: string; ref: string; workspaceId?: string } };
        pipelineId = createdBody.entry.id;
        tenderId = createdBody.entry.ref;
        expect(createdBody.entry.workspaceId).toBe(workspaceId);

        const requisition = await handleCycleRoutes(
          `/api/pipeline/${pipelineId}/requisition`,
          "POST",
          { budgetValidated: true, budgetReference: "FY2026/VOTE-03", actor: "spoofed actor" },
          "Attested Officer",
          workspaceId,
        );
        expect(requisition?.status).toBe(200);
        const requisitionBody = await requisition!.json() as { entry: { requisition: { budgetValidated: boolean; validatedBy: string } } };
        expect(requisitionBody.entry.requisition).toMatchObject({ budgetValidated: true, validatedBy: "Attested Officer" });

        const closing = await handleCycleRoutes(
          `/api/tenders/${tenderId}/closing`,
          "POST",
          { closingDate: "2026-12-15", actor: "Attested Officer" },
          "Attested Officer",
          workspaceId,
        );
        expect(closing?.status).toBe(200);

        const visible = await handleCycleRoutes("/api/cycle", "GET", {}, "Attested Officer", workspaceId);
        const visibleBody = await visible!.json() as { cycles: { tenderId: string }[]; pipeline: { id: string }[] };
        expect(visibleBody.pipeline.map((entry) => entry.id)).toContain(pipelineId);
        expect(visibleBody.cycles.map((cycle) => cycle.tenderId)).toContain(tenderId);
      });

      const otherWorkspaceRequisition = await withWorkspace("other-cycle-workspace", () =>
        handleCycleRoutes(
          `/api/pipeline/${pipelineId}/requisition`,
          "POST",
          { budgetValidated: true, budgetReference: "OTHER/WORKSPACE" },
          "Other Officer",
          "other-cycle-workspace",
        ),
      );
      expect(otherWorkspaceRequisition?.status).toBe(404);
    } finally {
      state.pipeline = state.pipeline.filter((entry) => entry.id !== pipelineId);
      state.cycle = state.cycle.filter((cycle) => cycle.tenderId !== tenderId);
    }
  });
});
