/**
 * documents.ts — Phase 4: the trustworthy document register.
 *
 * One row per known document, however it arrived: a sample pack staged at
 * intake, typed text staged through the web wizard, an R2 upload through the
 * edge gate, or a gate artifact. Each row carries:
 *
 *   - the content hash (sha-256, first 32 hex — the same shaOf the audit
 *     spine uses), so silent replacement is detectable: re-registering the
 *     same key with a different hash is a VERSION with a previousSha line,
 *     never an overwrite;
 *   - provenance (channel, importer, origin system, note);
 *   - chain-of-custody events (registered, versioned, downloaded, reviewed,
 *     archived) — the same facts the hash-chained tool log holds, folded
 *     per-document so a custody question has a one-place answer;
 *   - an extraction-confidence flag with a person-in-the-loop review gate:
 *     LOW/MEDIUM confidence is a work item until a named reviewer clears it;
 *   - a retention schedule per document kind, with the disposal date derived
 *     from capture. The years are working defaults, marked as such — the
 *     operational owner confirms the legal schedule.
 *
 * Nothing here deletes anything. Disposal is a status a reviewer sets after
 * the schedule allows it; the audit log keeps its own copy of history.
 */

import { createHash } from "crypto";
import { appendLog, saveState, state, type DocumentKind, type DocumentRecord, type TrustChannel } from "./store";

const KIND_RE = /^[A-Za-z0-9._\-/]{1,512}$/;

/* Working defaults per document kind. The schedule line names the basis; the
   operational owner confirms the years against the applicable records
   schedule before live disposal decisions rely on them. */
const RETENTION_DEFAULTS: Record<DocumentKind, { schedule: string; years: number }> = {
  NOTICE: { schedule: "Solicitation record — confirm against the operational records schedule", years: 7 },
  BID: { schedule: "Bid record — confirm against the operational records schedule", years: 7 },
  OCDS: { schedule: "Structured procurement data — confirm against the operational records schedule", years: 7 },
  SPECIFICATION: { schedule: "Specification record — confirm against the operational records schedule", years: 7 },
  EVIDENCE: { schedule: "Evidence attachment — confirm against the operational records schedule", years: 7 },
  CONTRACT: { schedule: "Contract record — typically the longest schedule; confirm", years: 10 },
  RECEIPT: { schedule: "Decision receipt — keep with the procurement file", years: 10 },
  OTHER: { schedule: "Unspecified — confirm against the operational records schedule", years: 7 },
};

function sha256OfText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

export interface RegisterInput {
  tenderId?: string;
  key: string;
  title?: string;
  kind?: DocumentKind;
  /** Text content — hashed server-side. Never stored. */
  content?: string;
  /** Pre-computed hash (e.g. from the web upload route over raw bytes). */
  sha256?: string;
  bytes: number;
  contentType?: string;
  channel: TrustChannel;
  importer: string;
  provenance?: { originSystem?: string; note?: string };
  extractionConfidence?: { level: "HIGH" | "MEDIUM" | "LOW"; reason?: string };
}

export function registerDocument(input: RegisterInput): { record: DocumentRecord; versioned: boolean } {
  const key = String(input.key ?? "").trim();
  if (!KIND_RE.test(key)) throw new Error("key must be a plain document path (1-512 chars)");
  const sha = input.sha256 && /^[a-f0-9]{16,64}$/.test(input.sha256) ? input.sha256.slice(0, 32) : input.content !== undefined ? sha256OfText(input.content) : null;
  if (!sha) throw new Error("either content or sha256 is required to fingerprint the document");
  const bytes = Math.max(0, Math.min(10 * 1024 * 1024, Math.round(Number(input.bytes) || 0)));
  const kind: DocumentKind = (input.kind && key.length > 0 ? input.kind : "OTHER") as DocumentKind;
  const retention = RETENTION_DEFAULTS[kind];
  const capturedAt = new Date().toISOString();
  const disposeAfter = new Date(new Date(capturedAt).getTime() + retention.years * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  /* Version line: same tender + key, different hash → a new version. Same
     hash → idempotent: the prior row stands, no duplicate is written. */
  const prior = [...state.documents]
    .filter((d) => d.key === key && (!input.tenderId || d.tenderId === input.tenderId))
    .sort((a, b) => b.version - a.version)[0];
  if (prior && prior.sha256 === sha) {
    return { record: prior, versioned: false };
  }
  const versioned = !!prior;

  const record: DocumentRecord = {
    id: `doc_${Math.random().toString(36).slice(2, 10)}`,
    ...(input.tenderId ? { tenderId: input.tenderId } : {}),
    key,
    title: (input.title ?? key.split("/").pop() ?? key).slice(0, 200),
    kind,
    sha256: sha,
    version: versioned ? prior.version + 1 : 1,
    ...(versioned ? { previousSha: prior.sha256 } : {}),
    bytes,
    ...(input.contentType ? { contentType: input.contentType.slice(0, 120) } : {}),
    channel: input.channel,
    importer: input.importer.slice(0, 80) || "unknown",
    capturedAt,
    ...(input.provenance ? { provenance: input.provenance } : {}),
    ...(input.extractionConfidence
      ? { extractionConfidence: { ...input.extractionConfidence, ...(input.extractionConfidence.level !== "HIGH" ? {} : {}) } }
      : {}),
    retention: { schedule: retention.schedule, years: retention.years, disposeAfter, status: "ACTIVE" },
    custody: [{ at: capturedAt, actor: input.importer.slice(0, 80) || "unknown", action: versioned ? "VERSIONED" : "REGISTERED", detail: `sha256:${sha} · v${versioned ? prior.version + 1 : 1}` }],
  };
  state.documents.unshift(record);
  saveState();
  appendLog({
    actor: record.importer,
    server: "quorum-mcp",
    tool: "document_register",
    kind: "WRITES",
    runId: "cycle",
    inputs: { key, tenderId: record.tenderId ?? null, channel: record.channel, bytes },
    outputs: { docId: record.id, sha256: record.sha256, version: record.version, previousSha: record.previousSha ?? null, kind: record.kind },
    status: "OK",
    durationMs: 0,
  });
  return { record, versioned };
}

export function listDocuments(filter?: { tenderId?: string; unreviewedOnly?: boolean }): DocumentRecord[] {
  let rows = [...state.documents].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  if (filter?.tenderId) rows = rows.filter((d) => d.tenderId === filter.tenderId);
  if (filter?.unreviewedOnly) {
    rows = rows.filter((d) => d.extractionConfidence && d.extractionConfidence.level !== "HIGH" && !d.extractionConfidence.reviewedBy);
  }
  return rows;
}

export function findDocument(id: string): DocumentRecord | undefined {
  return state.documents.find((d) => d.id === id);
}

/** The person-in-the-loop gate: only a named reviewer clears a confidence flag. */
export function reviewDocument(id: string, actor: string, confirm: boolean, note?: string): { ok: true; record: DocumentRecord } | { ok: false; error: string; code: number } {
  const record = findDocument(id);
  if (!record) return { ok: false, error: "document not found", code: 404 };
  if (!record.extractionConfidence) return { ok: false, error: "this document carries no extraction-confidence flag", code: 409 };
  if (confirm) {
    record.extractionConfidence.level = "HIGH";
    record.extractionConfidence.reason = note?.trim().slice(0, 300) ?? record.extractionConfidence.reason;
    record.extractionConfidence.reviewedBy = actor;
    record.extractionConfidence.reviewedAt = new Date().toISOString();
    record.custody.push({ at: record.extractionConfidence.reviewedAt, actor, action: "REVIEWED", detail: "extraction confirmed by a named reviewer" });
  } else {
    record.extractionConfidence.reason = note?.trim().slice(0, 300) || record.extractionConfidence.reason;
  }
  saveState();
  appendLog({
    actor,
    server: "quorum-mcp",
    tool: "document_review",
    kind: "WRITES",
    runId: "cycle",
    inputs: { docId: record.id, confirm },
    outputs: { level: record.extractionConfidence.level, reviewedBy: record.extractionConfidence.reviewedBy ?? null },
    status: "OK",
    durationMs: 0,
  });
  return { ok: true, record };
}

export function archiveDocument(id: string, actor: string): { ok: true; record: DocumentRecord } | { ok: false; error: string; code: number } {
  const record = findDocument(id);
  if (!record) return { ok: false, error: "document not found", code: 404 };
  if (record.retention.status === "ARCHIVED") return { ok: false, error: "already archived", code: 409 };
  record.retention.status = "ARCHIVED";
  record.custody.push({ at: new Date().toISOString(), actor, action: "ARCHIVED", detail: `schedule: ${record.retention.schedule}` });
  saveState();
  appendLog({
    actor,
    server: "quorum-mcp",
    tool: "document_archive",
    kind: "WRITES",
    runId: "cycle",
    inputs: { docId: record.id },
    outputs: { status: "ARCHIVED" },
    status: "OK",
    durationMs: 0,
  });
  return { ok: true, record };
}

/** Verify: recompute the hash from the staged pack file when the content lives on disk. */
export function verifyDocument(id: string, readTenderFile?: (tenderId: string, file: string) => string | null): { ok: boolean; detail: string; record?: DocumentRecord } {
  const record = findDocument(id);
  if (!record) return { ok: false, detail: "document not found" };
  const packMatch = record.channel === "sample_pack" || record.channel === "sidecar_stage";
  if (packMatch && readTenderFile && record.tenderId) {
    const filename = record.key.includes("/") ? record.key.split("/").pop()! : record.key;
    const content = readTenderFile(record.tenderId, filename);
    if (content === null) return { ok: false, detail: "the staged file is no longer readable — investigate before trusting this record", record };
    const sha = sha256OfText(content);
    return sha === record.sha256
      ? { ok: true, detail: `recomputed sha256 matches the register (${sha})`, record }
      : { ok: false, detail: `HASH MISMATCH — register says ${record.sha256}, the file now hashes to ${sha}. The content changed without a version event.`, record };
  }
  return {
    ok: true,
    detail: `hash on record (${record.sha256}) — content lives in object storage; integrity rides the edge gate's etag and the custody line below`,
    record,
  };
}

/** Fold a download event (from the tender-downloads spine) into the register's custody. */
export function noteDownload(key: string, actor: string, detail?: string): void {
  const record = state.documents.find((d) => d.key === key || key.endsWith(`/${d.key}`));
  if (!record) return;
  record.custody.push({ at: new Date().toISOString(), actor, action: "DOWNLOADED", detail: detail?.slice(0, 200) });
  saveState();
}
