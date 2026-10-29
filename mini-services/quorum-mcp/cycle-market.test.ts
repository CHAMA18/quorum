import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { criterionEvidenceSuggestions, evaluatePackSignals, TENDERS_DIR, type BidDoc } from "./engine";
import { handleCycleRoutes } from "./cycle-routes";
import { state } from "./store";

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

      const scored = await handleCycleRoutes(`/api/tenders/${tenderId}/matrix/scores`, "POST", {
        bidder: "ALPHA",
        scores: [{ criterionId: "C-01", score: 80, evidenceDecision: "CONFIRMED" }],
      }, "Test Officer");
      expect(scored?.status).toBe(200);
      const scoredBody = await scored!.json() as { matrix: { bids: { bidder: string; technicalScores: { evidence?: { decision: string; decidedBy?: string }[] }[] }[] } };
      const scoredAlpha = scoredBody.matrix.bids.find((bid) => bid.bidder === "ALPHA")!;
      expect(scoredAlpha.technicalScores[0].evidence?.[0]).toMatchObject({ decision: "CONFIRMED", decidedBy: "Test Officer" });
      expect(state.cycle.find((cycle) => cycle.tenderId === tenderId)?.matrix?.marketSignals?.sharedIdentifiers).toHaveLength(2);
    } finally {
      state.cycle = state.cycle.filter((cycle) => cycle.tenderId !== tenderId);
      await rm(tenderDir, { recursive: true, force: true });
    }
  });
});
