import { describe, expect, it } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { renderAwardPdf, wrapLine } from "./award-pdf";

describe("renderAwardPdf", () => {
  it("produces a valid one-page PDF for a small report", async () => {
    const bytes = await renderAwardPdf({
      tenderId: "KE-GOV-TEST-001",
      recommendation: "Savanna Pharma",
      bids: [{ bidder: "Savanna Pharma", total: 96.5, verdict: "RECOMMENDED" }],
      findings: [{ rule: "R-PRICE-OUTLIER", severity: "HIGH", item: "insulin glargine" }],
    });
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("%PDF");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("wraps long lines", () => {
    const lines = wrapLine("word ".repeat(60).trim(), 40);
    expect(lines.length).toBeGreaterThan(3);
    expect(lines.every((l) => l.length <= 40)).toBe(true);
  });
});
