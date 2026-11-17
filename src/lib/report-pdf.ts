/**
 * The tender review report as a branded Quorum PDF (pdf-lib, no external
 * service).
 *
 * This is the file the committee takes away: the findings with their
 * sources, the approval status and the record integrity code — every
 * number on it is the same number the desk shows on screen, taken from
 * the run record and the sidecar seal. Nothing here invents a verdict:
 * until the gate signs, the report says "Awaiting committee approval"
 * and the integrity code reads "Available after approval".
 *
 * Branding follows the audit export (audit-export.ts): brand-red QUORUM
 * wordmark, Helvetica, a footer on every page naming the report and the
 * page. The closing line states the honesty boundary — the signed
 * record in Quorum governs; this PDF is a readable copy.
 */

import type { PDFFont, PDFPage } from "pdf-lib";

export interface ReportPdfFinding {
  cls: string;
  note: string;
  src: string;
}

export interface ReportPdfInput {
  reference: string;
  title: string;
  buyer?: string;
  approvalStatus: string;
  findingsCount: number;
  withSources: number;
  withoutSource: number;
  seal?: string | null;
  sealedBy?: string | null;
  findings: ReportPdfFinding[];
  generatedAt?: string;
}

const A4: [number, number] = [595.28, 841.89];
const INK = { r: 0.06, g: 0.07, b: 0.09 };
const MUTED = { r: 0.38, g: 0.39, b: 0.42 };
const RULE = { r: 0.82, g: 0.82, b: 0.8 };
const BRAND = { r: 0.6, g: 0.16, b: 0.1 };

/** Helvetica's WinAnsi encoding cannot carry arbitrary Unicode. */
function plain(text: unknown): string {
  return String(text ?? "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of plain(text).split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [""];
}

export async function renderReportPdf(input: ReportPdfInput): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const doc = await PDFDocument.create();
  doc.setTitle(`Quorum tender review report - ${plain(input.reference)}`);
  doc.setAuthor("Quorum");
  doc.setSubject("Tender review findings, source references and the committee's recorded decision");
  doc.setCreator("Quorum reports");
  doc.setProducer("Quorum");
  doc.setCreationDate(new Date(generatedAt));

  const body = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const ink = rgb(INK.r, INK.g, INK.b);
  const muted = rgb(MUTED.r, MUTED.g, MUTED.b);
  const brand = rgb(BRAND.r, BRAND.g, BRAND.b);
  const ruleColor = rgb(RULE.r, RULE.g, RULE.b);
  type PdfColor = ReturnType<typeof rgb>;

  const margin = 54;
  const width = A4[0] - margin * 2;
  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - margin;

  const room = (needed: number) => {
    if (y - needed < margin + 26) {
      page = doc.addPage(A4);
      y = A4[1] - margin;
    }
  };

  const paragraph = (
    text: string,
    options: { size?: number; font?: PDFFont; color?: PdfColor; gap?: number; leading?: number } = {},
  ) => {
    const size = options.size ?? 10;
    const font = options.font ?? body;
    const leading = options.leading ?? size * 1.45;
    for (const line of wrap(text, font, size, width)) {
      room(leading);
      if (line) page.drawText(line, { x: margin, y, size, font, color: options.color ?? ink });
      y -= leading;
    }
    y -= options.gap ?? 6;
  };

  const label = (text: string) => {
    room(14);
    page.drawText(plain(text).toUpperCase(), { x: margin, y, size: 7.5, font: bold, color: muted });
    y -= 14;
  };

  const rule = () => {
    room(12);
    page.drawLine({
      start: { x: margin, y: y - 2 },
      end: { x: A4[0] - margin, y: y - 2 },
      thickness: 0.7,
      color: ruleColor,
    });
    y -= 14;
  };

  /* ── Cover ─────────────────────────────────────────────────────────── */
  /* Brand band: the wordmark is the first thing on the page. */
  page.drawRectangle({ x: 0, y: A4[1] - 14, width: A4[0], height: 14, color: brand });
  page.drawText("QUORUM", { x: margin, y: y - 6, size: 10, font: bold, color: brand });
  page.drawText("TENDER REVIEW REPORT", {
    x: A4[0] - margin - bold.widthOfTextAtSize("TENDER REVIEW REPORT", 7.5),
    y: y - 6,
    size: 7.5,
    font: bold,
    color: muted,
  });
  y -= 46;
  paragraph("Tender review report", { size: 28, font: bold, gap: 4, leading: 32 });
  paragraph(input.title, { size: 13, font: bold, gap: 2, leading: 17 });
  if (input.buyer) paragraph(`Procuring entity: ${input.buyer}`, { size: 10, color: muted, gap: 10 });
  rule();

  const rows: [string, string][] = [
    ["Review reference", input.reference],
    ["Approval status", input.approvalStatus],
    ["Findings", String(input.findingsCount)],
    ["With sources", String(input.withSources)],
    ["Without a source", String(input.withoutSource)],
    ["Record integrity code", input.seal ?? "Available after approval"],
    ...(input.sealedBy ? [["Approved by", input.sealedBy] as [string, string]] : []),
    ["Generated", generatedAt.slice(0, 10)],
  ];
  label("Summary");
  for (const [name, value] of rows) {
    room(20);
    page.drawText(name, { x: margin, y, size: 9, font: body, color: muted });
    const lines = wrap(value, mono, 8, width - 150);
    lines.forEach((line, index) => {
      room(12);
      page.drawText(line, { x: margin + 150, y, size: 8, font: mono, color: ink });
      if (index < lines.length - 1) y -= 11;
    });
    y -= 17;
  }
  y -= 6;

  /* ── Findings and sources ──────────────────────────────────────────── */
  label("Findings and sources");
  if (input.findings.length === 0) {
    paragraph("All findings are listed in this report.", { size: 10, gap: 8 });
  } else {
    for (const finding of input.findings) {
      room(15);
      page.drawText(plain(`[${finding.cls}]`).toUpperCase(), { x: margin, y, size: 8, font: bold, color: brand });
      y -= 11;
      paragraph(finding.note, { size: 10, gap: 2 });
      paragraph(finding.src ? `Source: ${finding.src}` : "NO SOURCE ON FILE", {
        size: 8.5,
        color: finding.src ? muted : brand,
        gap: 10,
      });
    }
  }

  /* ── Audit trail ───────────────────────────────────────────────────── */
  label("Audit trail");
  paragraph("Every finding above cites the page, clause or registry ID it was read from.", { size: 10, gap: 2 });
  paragraph(`Decision: ${input.approvalStatus}.`, { size: 10, gap: 2 });
  paragraph(
    "Generated by Quorum. The signed record in Quorum governs; this PDF is a readable copy. Check the record integrity code in the Activity log.",
    { size: 8, color: muted, gap: 8 },
  );

  /* ── Footer on every page ──────────────────────────────────────────── */
  const pages = doc.getPages();
  pages.forEach((current, index) => {
    const note = `Quorum tender review report · ${plain(input.reference)} · page ${index + 1} of ${pages.length}`;
    current.drawText(note, { x: margin, y: 32, size: 7.5, font: body, color: rgb(0.55, 0.55, 0.56) });
    current.drawText("QUORUM", {
      x: A4[0] - margin - bold.widthOfTextAtSize("QUORUM", 7.5),
      y: 32,
      size: 7.5,
      font: bold,
      color: brand,
    });
  });

  return doc.save();
}
