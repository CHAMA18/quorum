import { describe, expect, it } from "bun:test";
import { checkDeliveryCompliance } from "../../mini-services/quorum-mcp/engine";
import { buildBenchmarks } from "./price-history";
import { buildSupplierHistory } from "./supplier-history";
import { buildHeatmap } from "./risk-heatmap";
import { enqueue, flushOutbox, type OutboxStorage } from "./outbox";
import { isLocale, t } from "./i18n";

describe("checkDeliveryCompliance", () => {
  it("checks only what the notice imposes", () => {
    const notice = "Suppliers SHALL transport cold-chain items at 2–8 °C. Deliver within 45 days. Shelf life not less than 24 months at delivery.";
    const r = checkDeliveryCompliance(notice, [
      { bidder: "A", text: "Cold chain 2-8°C maintained. Delivery within 45 days.", source: "a.md" },
      { bidder: "B", text: "Standard delivery terms.", source: "b.md" },
    ]);
    expect(r.required).toContain("cold-chain");
    expect(r.bids[0].checks.find((c) => c.key === "cold-chain")?.stated).toBe(true);
    expect(r.bids[1].checks.find((c) => c.key === "cold-chain")?.stated).toBe(false);
  });
});

describe("buildBenchmarks", () => {
  it("excludes the current tender and medians the rest", () => {
    const b = buildBenchmarks([
      { item: "insulin", peerMedian: 100, tenderId: "T-1" },
      { item: "insulin", peerMedian: 120, tenderId: "T-2" },
      { item: "insulin", peerMedian: 999, tenderId: "T-3" },
    ], "T-3");
    expect(b[0].medianOfMedians).toBe(110);
    expect(b[0].tenders).toBe(2);
  });
});

describe("buildSupplierHistory", () => {
  it("counts awards and completions per supplier", () => {
    const h = buildSupplierHistory([
      { tenderId: "T-1", awardReport: { recommendation: "Acme", signedAt: "2026-01-01" }, contract: { completedAt: "2026-03-01", completion: { performanceRating: 4 } } },
      { tenderId: "T-2", awardReport: { recommendation: "Acme", signedAt: "2026-02-01" } },
    ]);
    expect(h[0]).toMatchObject({ supplier: "Acme", awards: 2, completed: 1, avgRating: 4 });
  });
});

describe("buildHeatmap", () => {
  it("intensifies with open findings", () => {
    const heat = buildHeatmap([
      { tender: "T-1", cls: "PRICING", status: "OPEN" },
      { tender: "T-1", cls: "PRICING", status: "OPEN" },
      { tender: "T-1", cls: "PRICING", status: "CLEARED" },
    ]);
    expect(heat.cells[0].intensity).toBe(2);
  });
});

describe("outbox", () => {
  it("queues and flushes in order, keeping failures", async () => {
    let items: import("./outbox").OutboxItem[] = [];
    const storage: OutboxStorage = { read: () => items, write: (v) => { items = v; } };
    enqueue(storage, "/api/a", { x: 1 });
    enqueue(storage, "/api/b", { x: 2 });
    const sent = await flushOutbox(storage, async (url) => url.endsWith("/a"));
    expect(sent).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe("/api/b");
  });
});

describe("i18n sw", () => {
  it("resolves Swahili and translates core keys", () => {
    expect(isLocale("sw")).toBe(true);
    expect(t("sw", "review.findings")).toBe("Matokeo");
    expect(t("sw", "missing.key")).toBe("missing.key");
  });
});
