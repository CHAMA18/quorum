import { describe, expect, test } from "bun:test";
import { Document, Packer, Paragraph } from "docx";
import ExcelJS from "exceljs";
import sharp from "sharp";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractTenderText } from "@/lib/tender-extract";

/** Fixtures are generated in-process; no binary files in the repo. */

async function pdfBytes(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  text.split("\n").forEach((line, i) => {
    page.drawText(line, { x: 48, y: 790 - i * 18, size: 11, font });
  });
  return doc.save();
}

async function docxBytes(text: string): Promise<Uint8Array> {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: text.split("\n").map((line) => new Paragraph({ text: line })),
      },
    ],
  });
  return Packer.toBuffer(doc);
}

async function xlsxBytes(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const pricing = wb.addWorksheet("Pricing");
  pricing.addRow(["Item", "Quantity", "Unit price", "Currency"]);
  pricing.addRow(["Infusion pump", 40, 185000, "KES"]);
  const compliance = wb.addWorksheet("Compliance");
  compliance.addRow(["Requirement", "Response"]);
  compliance.addRow(["Sterile consumables", "Compliant"]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe("tender document extraction", () => {
  test("a PDF becomes page-marked text and classifies as a notice", async () => {
    const marker = `PORTAL INSTALLATION ${Date.now()}`;
    const out = await extractTenderText(
      await pdfBytes(`INVITATION TO TENDER\n${marker}\nClosing date: 12 March 2027`),
      "tender-notice.pdf",
    );
    expect(out).not.toBeNull();
    expect(out?.pages).toBe(1);
    expect(out?.kind).toBe("notice");
    expect(out?.text.startsWith("[Page 1]")).toBe(true);
    expect(out?.text).toContain(marker);
  });

  test("a DOCX becomes raw text and classifies as a bid", async () => {
    const marker = `NORTHWIND CLINICAL ${Date.now()}`;
    const out = await extractTenderText(
      await docxBytes(`BIDDER RESPONSE\n${marker}\nUnit price: KES 185,000`),
      "bidder-northwind.docx",
    );
    expect(out?.kind).toBe("bid");
    expect(out?.text).toContain(marker);
    expect(out?.text).not.toContain("[Page");
  });

  test("an XLSX keeps every worksheet, with rows as TSV", async () => {
    const out = await extractTenderText(await xlsxBytes(), "bidder-pricing.xlsx");
    expect(out?.kind).toBe("bid");
    expect(out?.sheets).toEqual(["Pricing", "Compliance"]);
    expect(out?.text).toContain("# Sheet: Pricing");
    expect(out?.text).toContain("Infusion pump\t40\t185000\tKES");
    expect(out?.text).toContain("# Sheet: Compliance");
    expect(out?.text).toContain("Sterile consumables\tCompliant");
  });

  test("an image-only PDF gets page-marked local OCR text", async () => {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="500"><rect width="100%" height="100%" fill="white"/><text x="60" y="160" font-family="Arial" font-size="72" fill="black">SCANNED TENDER NOTICE</text><text x="60" y="300" font-family="Arial" font-size="56" fill="black">Closing date: 12 March 2027</text></svg>`);
    const png = await sharp(svg).png().toBuffer();
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const image = await doc.embedPng(png);
    page.drawImage(image, { x: 35, y: 590, width: 525, height: 219 });
    const out = await extractTenderText(await doc.save(), "scan-notice.pdf");
    expect(out?.text).toContain("[Page 1]");
    expect(out?.text).toMatch(/SCANNED TENDER NOTICE/i);
    expect(out?.text).toMatch(/12 March 2027/i);
    expect(out?.note).toContain("local OCR");
  }, 120_000);

  test("a container format is stored but not extracted here", async () => {
    expect(await extractTenderText(new Uint8Array([0x50, 0x4b]), "pack.zip")).toBeNull();
  });

  test("a text file with a notice heading classifies as a notice", async () => {
    const out = await extractTenderText(
      new TextEncoder().encode("REQUEST FOR PROPOSALS\nThe bidder SHALL submit a priced schedule.\n"),
      "document.txt",
    );
    expect(out?.kind).toBe("notice");
    expect(out?.text).toContain("REQUEST FOR PROPOSALS");
  });
});
