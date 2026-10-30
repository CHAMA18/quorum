import { createHash } from "node:crypto";
import type { PDFFont, PDFPage } from "pdf-lib";

/**
 * The audit package an oversight body can take away.
 *
 * A screen is not evidence. This module turns the live record into one file an
 * outside reviewer can keep: the gates, the hash-chained log, the decision
 * ledger, the verification verdicts at export time, and a SHA-256 over the
 * whole package so any later change is detectable. It also carries the
 * instructions needed to check the package without this application.
 *
 * Nothing here invents a verdict: the chain and ledger results come from the
 * sidecar's own verifiers, and a failed fetch aborts the export instead of
 * producing a package that looks clean.
 */

export interface ExportGate {
  id?: string;
  tenderId?: string;
  runId?: string;
  tool?: string;
  status?: string;
  approver?: string;
  decidedAt?: string;
  executedAt?: string;
  signature?: { value?: string; keyId?: string; payloadHash?: string; publicKeyPem?: string } | null;
  stepUp?: unknown;
  evidential?: boolean;
  evidentialNote?: string;
  [key: string]: unknown;
}

export interface ExportLogEntry {
  seq?: number;
  id?: string;
  ts?: string;
  actor?: string;
  server?: string;
  tool?: string;
  kind?: string;
  status?: string;
  prev?: string;
  self?: string;
  [key: string]: unknown;
}

export interface ChainVerdict {
  ok: boolean;
  brokenAt: number | null;
  checked?: number;
  lines: number;
  segments?: number;
  registerReason?: string;
  error?: string;
  restarts?: unknown[];
  epochs?: { n: number; head: string; sealedAt: string; reason: string }[];
  [key: string]: unknown;
}

export interface LedgerVerdict {
  ok?: boolean;
  lines?: number;
  brokenAt?: number | null;
  reason?: string;
  [key: string]: unknown;
}

export interface AnchorRecord {
  at?: string;
  lines?: number;
  head?: string;
  ledgerHead?: string;
  ledgerLines?: number;
  [key: string]: unknown;
}

export interface AuditScope {
  from: string | null;
  to: string | null;
}

export interface AuditSummary {
  gatesByStatus: Record<string, number>;
  /* Executed decisions on the record with no receipt signature: shown, never
     presented as signed approvals. */
  executedUnsigned: number;
  decisionsRecorded: number;
  logLines: number;
}

export interface AuditPackageInput {
  workspaceId: string;
  generatedBy: { id: string; name: string; email: string; role: string };
  gates: ExportGate[];
  log: ExportLogEntry[];
  decisions: Record<string, unknown>[];
  verification: ChainVerdict;
  ledger: LedgerVerdict | null;
  anchor: AnchorRecord | null;
  from?: string | null;
  to?: string | null;
  generatedAt?: string;
}

export interface AuditPackage {
  format: "quorum-audit-package/1";
  generatedAt: string;
  generatedBy: AuditPackageInput["generatedBy"];
  workspaceId: string;
  scope: AuditScope;
  summary: AuditSummary;
  record: { gates: ExportGate[]; log: ExportLogEntry[]; decisions: Record<string, unknown>[] };
  verification: { chain: ChainVerdict; ledger: LedgerVerdict | null; anchor: AnchorRecord | null };
  integrity: { algorithm: "sha256"; packageHash: string };
  verificationInstructions: string[];
}

export interface AuditDigestInput {
  workspaceId: string;
  scope: AuditScope;
  summary: AuditSummary;
  record: AuditPackage["record"];
  verification: AuditPackage["verification"];
}

/* The instructions are fixed text, not prose assembled per export: a reviewer
   checking an older package reads the same steps as one checking today's. */
export const VERIFICATION_INSTRUCTIONS = [
  "Recompute the SHA-256 hash of this package's workspaceId, scope, summary, record and verification fields, serialised as JSON with object keys sorted and no whitespace. It must equal integrity.packageHash. If it does not, the package was changed after export.",
  "The audit log is a hash chain. Each line's self is the first 16 hex characters of the SHA-256 over that line without self, and its prev names the hash of the line before it. Recompute both across record.log: outside the segment starts listed in verification.chain.restarts, every prev must match the previous line's self, and the final self is the head of the record.",
  "verification.chain is the sidecar's own verdict over the complete log at export time. ok:true means no line was edited, removed or reordered. brokenAt names the first line that failed; registerReason explains a failed epoch seal.",
  "The chain can restart, and a restart is not hidden: verification.chain.epochs lists the signed epoch record that sealed each segment, with its reason and the head it began from. An unrecorded restart fails verification instead of passing quietly.",
  "A gate is evidence only when it carries both a step-up assertion and an Ed25519 receipt. summary.executedUnsigned counts executed gates without a receipt signature; those decisions were taken before signatures were mandatory and must not be read as signed approvals.",
  "Receipt signatures are Ed25519 and embed their public key in signature.publicKeyPem. A receipt verifies without this application: check signature.value against the canonical decision payload whose SHA-256 is signature.payloadHash.",
  "verification.anchor is the most recent daily head seal: the line count and head hash at the moment it was taken. Compare its head with the line it names. A mismatch means the record was rewritten after anchoring, because the anchor copy lives outside the application.",
  "This package is a point-in-time export. Decisions taken after generatedAt are not included; compare verification.chain.lines with the live record before treating this package as the current state.",
] as const;

/**
 * Deterministic JSON: object keys sorted at every depth, no whitespace.
 * Two exports of the same record hash identically, whatever order the sidecar
 * happened to serialise its fields in.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function packageHashFor(input: AuditDigestInput): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

/** Counts by status, plus the executed gates that carry no receipt signature. */
export function summarizeGates(gates: ExportGate[]): Pick<AuditSummary, "gatesByStatus" | "executedUnsigned"> {
  const gatesByStatus: Record<string, number> = {};
  let executedUnsigned = 0;
  for (const gate of gates) {
    const status =
      typeof gate.status === "string" && gate.status.trim() ? gate.status.trim().toUpperCase() : "UNKNOWN";
    gatesByStatus[status] = (gatesByStatus[status] ?? 0) + 1;
    const signature = gate.signature;
    const signed =
      !!signature &&
      typeof signature === "object" &&
      typeof signature.value === "string" &&
      signature.value.length > 0;
    if ((status === "EXECUTED" || status === "APPROVED") && !signed) executedUnsigned += 1;
  }
  return { gatesByStatus, executedUnsigned };
}

export function buildAuditPackage(input: AuditPackageInput): AuditPackage {
  const scope: AuditScope = { from: input.from ?? null, to: input.to ?? null };
  const summary: AuditSummary = {
    ...summarizeGates(input.gates),
    decisionsRecorded: input.decisions.length,
    logLines: input.log.length,
  };
  const record = { gates: input.gates, log: input.log, decisions: input.decisions };
  const verification = { chain: input.verification, ledger: input.ledger, anchor: input.anchor };
  const packageHash = packageHashFor({ workspaceId: input.workspaceId, scope, summary, record, verification });

  return {
    format: "quorum-audit-package/1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    generatedBy: input.generatedBy,
    workspaceId: input.workspaceId,
    scope,
    summary,
    record,
    verification,
    integrity: { algorithm: "sha256", packageHash },
    verificationInstructions: [...VERIFICATION_INSTRUCTIONS],
  };
}

/* ── PDF rendering ───────────────────────────────────────────────────────── */

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

/**
 * A readable summary, not a screenshot of the app: cover, evidence page, then
 * the decisions themselves. The full record lives in the JSON export beside it.
 */
export async function renderAuditPdf(pkg: AuditPackage): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle(`Quorum audit package - ${plain(pkg.workspaceId)}`);
  doc.setAuthor("Quorum");
  doc.setSubject("Procurement decision record with chain proof and verification verdicts");
  doc.setCreator("Quorum audit export");
  doc.setProducer("Quorum");
  doc.setCreationDate(new Date(pkg.generatedAt));

  const body = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const ink = rgb(INK.r, INK.g, INK.b);
  const muted = rgb(MUTED.r, MUTED.g, MUTED.b);
  const brand = rgb(BRAND.r, BRAND.g, BRAND.b);
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
      if (line) {
        page.drawText(line, { x: margin, y, size, font, color: options.color ?? ink });
      }
      y -= leading;
    }
    y -= options.gap ?? 6;
  };

  const label = (text: string) => {
    room(14);
    page.drawText(plain(text).toUpperCase(), {
      x: margin,
      y,
      size: 7.5,
      font: bold,
      color: muted,
    });
    y -= 14;
  };

  const rule = () => {
    room(12);
    page.drawLine({
      start: { x: margin, y: y - 2 },
      end: { x: A4[0] - margin, y: y - 2 },
      thickness: 0.7,
      color: rgb(RULE.r, RULE.g, RULE.b),
    });
    y -= 14;
  };

  /* Cover */
  page.drawText("QUORUM", { x: margin, y: y - 6, size: 10, font: bold, color: brand });
  y -= 46;
  paragraph("Audit package", { size: 28, font: bold, gap: 4, leading: 32 });
  paragraph(
    "A point-in-time export of the decision record, the hash-chained audit log, the decision ledger and the verification verdicts taken when this file was produced.",
    { size: 11, color: muted, gap: 16 },
  );
  rule();

  const chain = pkg.verification.chain;
  const verdict = chain?.ok === true ? "PASSED - the log verifies against its signed epochs" : "FAILED - the log does not verify";
  label("Verification at export");
  paragraph(verdict, { size: 13, font: bold, color: chain?.ok === true ? ink : brand, gap: 10 });

  const rows: [string, string][] = [
    ["Workspace", pkg.workspaceId],
    ["Generated", pkg.generatedAt],
    ["Exported by", `${pkg.generatedBy.name} <${pkg.generatedBy.email}>`],
    ["Role", pkg.generatedBy.role],
    [
      "Scope",
      pkg.scope.from || pkg.scope.to
        ? `${pkg.scope.from ?? "beginning"} to ${pkg.scope.to ?? "export time"}`
        : "The complete record held at export time",
    ],
    ["Log lines checked", String(chain?.checked ?? chain?.lines ?? pkg.summary.logLines)],
    ["Chain epochs", String(chain?.epochs?.length ?? 0)],
    ["Chain segments", String(chain?.segments ?? 0)],
    ["Decisions in the ledger", String(pkg.summary.decisionsRecorded)],
    ["Package hash (SHA-256)", pkg.integrity.packageHash],
  ];
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

  /* Evidence */
  page = doc.addPage(A4);
  y = A4[1] - margin;
  paragraph("Evidence", { size: 20, font: bold, gap: 2, leading: 24 });
  rule();

  label("Chain verdict");
  if (chain?.ok !== true) {
    paragraph(
      chain?.brokenAt !== null && chain?.brokenAt !== undefined
        ? `The chain breaks at line ${chain.brokenAt} of ${chain.lines}. No decision in this package should be accepted as evidence until the break is explained.`
        : "The chain did not verify at export time.",
      { size: 10, color: brand, gap: 4 },
    );
    if (chain?.registerReason) paragraph(`Epoch register: ${chain.registerReason}`, { size: 9.5, color: muted });
    if (chain?.error) paragraph(`Verifier note: ${chain.error}`, { size: 9.5, color: muted });
  } else {
    const head = [...pkg.record.log].reverse().find((entry) => typeof entry.self === "string")?.self ?? "not recorded";
    paragraph(
      `All ${chain.lines} lines verify. The record restarts ${chain.restarts?.length ?? 0} time(s), each one sealed by a signed epoch, so a restart is visible rather than indistinguishable from tampering.`,
      { size: 10, gap: 4 },
    );
    paragraph(`Head hash: ${head}`, { size: 9, font: mono, color: muted, gap: 2 });
    const anchor = pkg.verification.anchor;
    paragraph(
      anchor
        ? `Daily anchor: ${anchor.lines ?? "?"} lines, head ${anchor.head ?? "not recorded"}, taken ${anchor.at ?? "at an unrecorded time"}. Compare that head with the line it names; the anchor copy is kept outside the application.`
        : "No daily anchor has been taken yet. Until one is, the head hash has no independent witness outside this application.",
      { size: 9.5, color: muted, gap: 10 },
    );
  }

  label("Decisions by status");
  const statuses = Object.entries(pkg.summary.gatesByStatus).sort((a, b) => a[0].localeCompare(b[0]));
  if (statuses.length === 0) {
    paragraph("No gates are on the record.", { size: 10, gap: 8 });
  } else {
    for (const [status, count] of statuses) {
      room(14);
      page.drawText(status, { x: margin, y, size: 9.5, font: body, color: ink });
      page.drawText(String(count), { x: margin + width - 30, y, size: 9.5, font: mono, color: ink });
      y -= 15;
    }
    y -= 4;
  }
  paragraph(
    pkg.summary.executedUnsigned > 0
      ? `${pkg.summary.executedUnsigned} executed decision(s) carry no receipt signature. They are recorded as UNSIGNED and are not evidence of a signed approval.`
      : "Every executed decision carries a receipt signature.",
    { size: 10, font: pkg.summary.executedUnsigned > 0 ? bold : body, gap: 8 },
  );

  const ledger = pkg.verification.ledger;
  if (ledger) {
    paragraph(
      ledger.ok === true
        ? `The decision ledger verifies over ${ledger.lines ?? "its"} recorded acts.`
        : `The decision ledger did not verify${ledger.reason ? `: ${ledger.reason}` : "."}`,
      { size: 10, color: ledger.ok === true ? ink : brand, gap: 8 },
    );
  }

  label("How to verify this package");
  pkg.verificationInstructions.forEach((instruction, index) => {
    paragraph(`${index + 1}. ${instruction}`, { size: 9, color: muted, gap: 2, leading: 12.2 });
  });

  /* Decisions */
  const decisions = pkg.record.decisions;
  if (decisions.length > 0) {
    page = doc.addPage(A4);
    y = A4[1] - margin;
    paragraph("Decisions", { size: 20, font: bold, gap: 2, leading: 24 });
    paragraph("Newest first, as recorded in the append-only ledger.", { size: 9.5, color: muted, gap: 10 });

    for (const decision of decisions.slice(0, 60)) {
      const gateId = typeof decision.gateId === "string" ? decision.gateId : "(gate not named)";
      const outcome = typeof decision.decision === "string" ? decision.decision : "RECORDED";
      const actor = typeof decision.actor === "string" ? decision.actor : "an unnamed officer";
      const at = typeof decision.decidedAt === "string" ? decision.decidedAt : undefined;
      const tender = typeof decision.tenderId === "string" ? decision.tenderId : undefined;
      const status = typeof decision.gateStatus === "string" ? decision.gateStatus : undefined;

      room(34);
      page.drawText(plain(`${outcome}  ${gateId}`), { x: margin, y, size: 9.5, font: bold, color: ink });
      y -= 12;
      const detail = [actor, at, tender, status].filter(Boolean).join("  ·  ");
      for (const line of wrap(detail, body, 8.5, width)) {
        room(12);
        page.drawText(line, { x: margin, y, size: 8.5, font: body, color: muted });
        y -= 11;
      }
      y -= 6;
    }
  }

  const pages = doc.getPages();
  pages.forEach((current, index) => {
    const note = `Quorum audit package · ${plain(pkg.workspaceId)} · page ${index + 1} of ${pages.length}`;
    current.drawText(note, {
      x: margin,
      y: 32,
      size: 7.5,
      font: body,
      color: rgb(0.55, 0.55, 0.56),
    });
    current.drawText(plain(pkg.integrity.packageHash.slice(0, 32)), {
      x: A4[0] - margin - body.widthOfTextAtSize(pkg.integrity.packageHash.slice(0, 32), 7.5),
      y: 32,
      size: 7.5,
      font: mono,
      color: rgb(0.55, 0.55, 0.56),
    });
  });

  return doc.save();
}
