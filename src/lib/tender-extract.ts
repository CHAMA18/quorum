import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extname } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mammoth from "mammoth";
import readXlsxFile from "read-excel-file/node";
import { extractText, getDocumentProxy } from "unpdf";

/**
 * Server-side text extraction for uploaded tender documents.
 *
 * The review graph reads text from the sidecar's tender directory, so an
 * uploaded binary must become readable text before it can feed a run:
 *
 *   .pdf   → unpdf, page markers (`[Page n]`) preserved for citation context
 *   .docx  → mammoth raw text
 *   .xlsx  → read-excel-file, one `# Sheet: …` block per worksheet (TSV rows)
 *   text   → .txt/.md/.csv/.eml decoded as UTF-8
 *
 * Scanned/image-only PDFs use bounded local Tesseract OCR when Poppler and
 * Tesseract are installed; OCR output remains page-marked and is flagged for
 * human verification. Set QUORUM_OCR_LANG to a locally installed language.
 * JSON (OCDS) and ZIP are stored in R2 but
 * are not extracted here; they take different ingestion paths.
 */

export type TenderDocKind = "notice" | "bid";

export interface ExtractedTender {
  text: string;
  kind: TenderDocKind;
  pages?: number;
  sheets?: string[];
  note?: string;
}

const MAX_TEXT = 60_000;
const MIN_TEXT = 20;
const execFileAsync = promisify(execFile);
const OCR_MAX_PAGES = 20;
const OCR_TIMEOUT_MS = 90_000;
const OCR_PAGE_TIMEOUT_MS = 20_000;
const EXTRACTABLE = new Set([".pdf", ".docx", ".xlsx", ".txt", ".md", ".csv", ".eml"]);

/* Filename signals are checked before content: a "Bidder A — Financial" file
   is a bid even if its letterhead quotes the RFP. Strong notice words win when
   they are the only signal; otherwise the first page decides. */
const STRONG_NOTICE = /(notice|invitation|advert)/i;
const STRONG_BID = /(bidder|tenderer|offer(?:or)?|submission|response)/i;
const NOTICE_HEAD =
  /(invitation\s+(?:to|for)\s+(?:bid|bids|tender|tenders|proposal|proposals)|request\s+for\s+(?:proposals?|quotations?|tenders?)|procurement\s+notice|tender\s+notice|notice\s+of\s+(?:invitation|tender))/i;

export function classifyTenderDocument(filename: string, text: string): TenderDocKind {
  const name = filename.toLowerCase();
  const notice = STRONG_NOTICE.test(name);
  const bid = STRONG_BID.test(name);
  if (notice && !bid) return "notice";
  if (bid && !notice) return "bid";
  if (NOTICE_HEAD.test(text.slice(0, 4000))) return "notice";
  return "bid";
}

function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function clipText(text: string): { text: string; note?: string } {
  if (text.length <= MAX_TEXT) return { text };
  return {
    text: `${text.slice(0, MAX_TEXT)}\n\n[truncated at ${MAX_TEXT.toLocaleString()} characters]`,
    note: `Text truncated at ${MAX_TEXT.toLocaleString()} characters.`,
  };
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

async function extractScannedPdf(bytes: Uint8Array, totalPages: number): Promise<{ text: string; note?: string }> {
  const workDir = await mkdtemp(join(tmpdir(), "quorum-ocr-"));
  try {
    const pdfPath = join(workDir, "scan.pdf");
    const pagesToProcess = Math.min(totalPages, OCR_MAX_PAGES);
    const deadline = Date.now() + OCR_TIMEOUT_MS;
    await writeFile(pdfPath, bytes);
    const outputPrefix = join(workDir, "page");
    await execFileAsync("pdftoppm", ["-f", "1", "-l", String(pagesToProcess), "-r", "200", "-png", pdfPath, outputPrefix], {
      timeout: OCR_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const pageTexts: string[] = [];
    for (let page = 1; page <= pagesToProcess; page += 1) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      const pngPath = `${outputPrefix}-${page}.png`;
      try {
        const { stdout } = await execFileAsync("tesseract", [pngPath, "stdout", "-l", process.env.QUORUM_OCR_LANG?.trim() || "eng", "--psm", "3"], {
          timeout: Math.min(OCR_PAGE_TIMEOUT_MS, remainingMs),
          maxBuffer: 2 * 1024 * 1024,
        });
        const text = cleanText(stdout);
        if (text) pageTexts.push(`[Page ${page}]\n${text}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return { text: "", note: "No extractable text — local OCR requires pdftoppm and tesseract on the server." };
        }
        throw error;
      }
    }
    if (pageTexts.length === 0) return { text: "", note: "Local OCR ran, but no readable text was detected in the scanned PDF." };
    const processedPages = pageTexts.length;
    const truncatedPages = totalPages > OCR_MAX_PAGES || processedPages < pagesToProcess;
    return {
      text: pageTexts.join("\n\n"),
      note: truncatedPages ? `Local OCR recovered ${processedPages} pages (maximum ${OCR_MAX_PAGES} of ${totalPages}); upload smaller page ranges for the remainder.` : "Text recovered with local OCR (Tesseract). Verify OCR text and citations against the original scan.",
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { text: "", note: "No extractable text — local OCR requires pdftoppm and tesseract on the server." };
    const reason = error instanceof Error ? error.message.replaceAll(workDir, "[temporary OCR directory]").slice(0, 180) : "unknown processing error";
    return { text: "", note: `Local OCR could not process this PDF (${reason}). The original remains stored; review the scan manually.` };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function extractPdf(bytes: Uint8Array): Promise<{ text: string; pages: number; note?: string }> {
  /* PDF.js may transfer and detach its input buffer when using a worker. Keep
     the upload bytes intact because the local OCR fallback needs the original. */
  const pdf = await getDocumentProxy(bytes.slice());
  const result = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(result.text) ? result.text : [String(result.text)];
  const totalPages = result.totalPages ?? pages.length;
  const hasText = pages.some((page) => page.trim().length > 0);
  if (hasText) {
    return {
      text: pages.map((page, i) => `[Page ${i + 1}]\n${page}`).join("\n\n"),
      pages: totalPages,
    };
  }
  const ocr = await extractScannedPdf(bytes, totalPages);
  return { text: ocr.text, pages: totalPages, note: ocr.note };
}

async function extractDocx(bytes: Uint8Array): Promise<{ text: string; note?: string }> {
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  const messages = result.messages?.filter((m) => m.type === "error") ?? [];
  return {
    text: result.value,
    note: messages.length > 0 ? `DOCX parser reported ${messages.length} issue(s); extracted text may be partial.` : undefined,
  };
}

async function extractXlsx(bytes: Uint8Array): Promise<{ text: string; sheets: string[]; note?: string }> {
  /* read-excel-file returns every worksheet, not just the first: tender
     pricing schedules often split commercial and compliance rows across tabs. */
  const sheets = await readXlsxFile(Buffer.from(bytes));
  const names = sheets.map((s) => s.sheet);
  const text = sheets
    .map((s) => `# Sheet: ${s.sheet}\n${s.data.map((row) => row.map(cellText).join("\t")).join("\n")}`)
    .join("\n\n");
  return {
    text,
    sheets: names,
    note: text.trim() ? undefined : "The workbook has no readable cell values.",
  };
}

export async function extractTenderText(
  input: ArrayBuffer | Uint8Array,
  filename: string,
): Promise<ExtractedTender | null> {
  const ext = extname(filename).toLowerCase();
  if (!EXTRACTABLE.has(ext)) return null;

  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let raw = "";
  let pages: number | undefined;
  let sheets: string[] | undefined;
  let note: string | undefined;

  try {
    if (ext === ".pdf") {
      const out = await extractPdf(bytes);
      raw = out.text;
      pages = out.pages;
      note = out.note;
    } else if (ext === ".docx") {
      const out = await extractDocx(bytes);
      raw = out.text;
      note = out.note;
    } else if (ext === ".xlsx") {
      const out = await extractXlsx(bytes);
      raw = out.text;
      sheets = out.sheets;
      note = out.note;
    } else {
      raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    }
  } catch {
    return {
      text: "",
      kind: classifyTenderDocument(filename, ""),
      pages,
      sheets,
      note: `Could not read the ${ext.slice(1).toUpperCase()} document.`,
    };
  }

  const clipped = clipText(cleanText(raw));
  const kind = classifyTenderDocument(filename, clipped.text);
  if (clipped.text.replace(/\s/g, "").length < MIN_TEXT) {
    return {
      text: "",
      kind,
      pages,
      sheets,
      note: note ?? "No extractable text — the document may be scanned or contain no readable text.",
    };
  }
  return { text: clipped.text, kind, pages, sheets, note: clipped.note ?? note };
}
