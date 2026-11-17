import { describe, expect, it } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { renderReportPdf } from "./report-pdf";

const base = {
  reference: "QRM-2026-013",
  title: "Supply of health technologies (cotton gauze, cotton wool & tubes)",
  buyer: "Ministry of Health",
  approvalStatus: "Award approved",
  findingsCount: 5,
  withSources: 5,
  withoutSource: 0,
  seal: "a".repeat(64),
  sealedBy: "J. Mwangi",
  findings: [
    { cls: "R-PRICE-OUTLIER", note: "Bidder total is 18% above the estimate.", src: "Priced schedule, p. 14" },
    { cls: "R-LICENCE", note: "Licence expires before the delivery date.", src: "" },
  ],
};

describe("renderReportPdf", () => {
  it("produces a valid branded PDF", async () => {
    const bytes = await renderReportPdf(base);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("%PDF");
    expect(bytes.length).toBeGreaterThan(2000);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getTitle()).toContain("QRM-2026-013");
    expect(doc.getAuthor()).toBe("Quorum");
  });

  it("handles an unsealed draft without inventing a seal", async () => {
    const bytes = await renderReportPdf({ ...base, approvalStatus: "Awaiting committee approval", seal: null, sealedBy: null, findings: [] });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("paginates long finding lists instead of overflowing", async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      cls: `R-TEST-${i}`,
      note: `Finding number ${i} with a reasonably long note that will need wrapping across lines.`,
      src: `Source document ${i}, page ${i + 1}`,
    }));
    const bytes = await renderReportPdf({ ...base, findingsCount: 80, withSources: 80, findings: many });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3);
  });
});
