import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, rateLimit, SESSION_COOKIE } from "@/lib/auth";
import { sidecarError, sidecarFetch } from "@/lib/org-sidecar";
import { can } from "@/lib/permissions";
import {
  isSafeTenderRef,
  isTenderKeyFor,
  tenderDownloadFilename,
} from "@/lib/tender-access";
import { extractTenderText } from "@/lib/tender-extract";

/**
 * POST /api/tenders/:ref/docs — store a tender document through the R2 edge
 * gate.
 *
 * The browser sends multipart form data (`file`); this route:
 *   1. requires a signed-in workspace user with `run_reviews` (owner, admin,
 *      officer) — the edge secret never reaches the browser;
 *   2. validates the tender reference, the extension and a 10 MB ceiling;
 *   3. extracts readable text (PDF/DOCX/XLSX/text) before anything is staged;
 *   4. PUTs the bytes to `${QUORUM_EDGE_URL}/__edge/upload?key=tenders/<ref>/…`
 *      with `x-quorum-edge-key`, hosted by the quorum-edge Worker;
 *   5. stages the extracted text through the sidecar's attested
 *      `POST /api/tenders/:ref/docs`, which writes the notice/bid files the
 *      review graph reads;
 *   6. records the stored object in the sidecar's hash-chained audit trail via
 *      its attested `POST /api/tender-uploads`, whether or not the text could
 *      be staged. Storage is never silent.
 *
 * The object key and audit sequence are returned so the caller can cite them. If extraction finds
 * no text (a scanned PDF, for example), the file is still stored in R2 and the
 * response says `staged: false` with a reason — OCR is not claimed. If the
 * edge is not configured or R2 is not bound, the route fails closed, and the
 * wizard marks the document `LOCAL`.
 *
 * GET /api/tenders/:ref/docs — list every stored R2 object under this tender's
 * prefix. Requires `read_documents` (committee members and auditors included)
 * and reads through the same edge gate, so the bucket is never public. Each
 * object carries its key, filename, size, type and upload time; the browser
 * mints a signed URL per chosen object through `.../docs/link`, so listing
 * does not hand out credentials or links that outlive the page.
 *
 * DELETE /api/tenders/:ref/docs?key=… — operator-only removal of one stored
 * object. Requires `run_reviews`, validates the key against the tender's
 * prefix, deletes through the edge gate and appends a `tender_delete` line to
 * the hash-chained audit trail. A failed audit append never pretends the
 * object is still there, and never hides the deletion.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const REF = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".zip": "application/zip",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".eml": "message/rfc822",
  ".txt": "text/plain",
  ".md": "text/markdown",
};

function parseName(raw: string): { stem: string; ext: string } | null {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  const dot = cleaned.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = cleaned.slice(dot).toLowerCase();
  const stem = cleaned
    .slice(0, dot)
    .replace(/[^\w-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!stem) return null;
  return { stem, ext };
}

const LIST_PAGE = 500;
const LIST_MAX = 5000;

interface StoredObject {
  key: string;
  filename: string;
  bytes: number;
  contentType: string;
  uploaded?: string;
  etag?: string;
}

function listingError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const { ref } = await params;
  if (!isSafeTenderRef(ref)) {
    return listingError("The tender reference is not valid.", 422);
  }

  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) return listingError("Sign in to browse stored tender documents.", 401);
  if (!can(user.role, "read_documents")) {
    return listingError("Your workspace role cannot read tender documents.", 403);
  }
  if (!rateLimit(`tender-list:${user.id}`, 60, 60_000)) {
    return listingError("Too many document listings; wait a minute and try again.", 429);
  }

  const edge = process.env.QUORUM_EDGE_URL?.trim().replace(/\/+$/, "") ?? "";
  const secret = process.env.QUORUM_EDGE_SECRET?.trim() ?? "";
  if (!edge || !secret) {
    return listingError("The R2 edge gate is not configured on this deployment.", 503);
  }

  const objects: StoredObject[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let more = false;
  do {
    const query = new URLSearchParams({ prefix: `tenders/${ref}/`, limit: String(LIST_PAGE) });
    if (cursor) query.set("cursor", cursor);

    let upstream: Response;
    try {
      upstream = await fetch(`${edge}/__edge/list?${query.toString()}`, {
        headers: { "x-quorum-edge-key": secret, "accept-encoding": "identity" },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      return listingError("The R2 edge gate is unreachable.", 502);
    }
    if (!upstream.ok) {
      return listingError(
        "The storage gate refused the listing.",
        upstream.status === 503 ? 503 : 502,
      );
    }

    const data = (await upstream.json().catch(() => null)) as {
      objects?: unknown;
      truncated?: unknown;
      cursor?: unknown;
    } | null;
    if (!data || !Array.isArray(data.objects)) {
      return listingError("The storage gate returned an unreadable listing.", 502);
    }

    for (const raw of data.objects) {
      const row = raw as {
        key?: unknown;
        size?: unknown;
        contentType?: unknown;
        uploaded?: unknown;
        etag?: unknown;
      };
      if (typeof row.key !== "string" || !isTenderKeyFor(ref, row.key) || seen.has(row.key)) continue;
      if (typeof row.size !== "number" || !Number.isFinite(row.size) || row.size < 0) continue;
      seen.add(row.key);
      objects.push({
        key: row.key,
        filename: tenderDownloadFilename(row.key),
        bytes: row.size,
        contentType:
          typeof row.contentType === "string" ? row.contentType : "application/octet-stream",
        uploaded:
          typeof row.uploaded === "string" && !Number.isNaN(Date.parse(row.uploaded))
            ? row.uploaded
            : undefined,
        etag: typeof row.etag === "string" ? row.etag : undefined,
      });
    }

    more = data.truncated === true;
    const next = typeof data.cursor === "string" && data.cursor ? data.cursor : undefined;
    if (!more || !next || next === cursor) break;
    cursor = next;
  } while (objects.length < LIST_MAX);

  /* Newest first; the key's timestamp prefix makes this stable enough for a
     list, and the explicit sort keeps mixed upload paths predictable. */
  objects.sort(
    (a, b) => (b.uploaded ?? "").localeCompare(a.uploaded ?? "") || a.filename.localeCompare(b.filename),
  );
  const totalBytes = objects.reduce((sum, object) => sum + object.bytes, 0);

  return NextResponse.json(
    {
      tender: ref,
      objects,
      count: objects.length,
      totalBytes,
      truncated: more,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const startedAt = Date.now();
  const { ref } = await params;
  if (!REF.test(ref) || ref.length > 80) {
    return NextResponse.json({ error: "The tender reference is not safe to store under." }, { status: 422 });
  }

  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Sign in to upload tender documents." }, { status: 401 });
  }
  if (!can(user.role, "run_reviews")) {
    return NextResponse.json(
      { error: "Only owners, admins and officers can upload tender documents." },
      { status: 403 },
    );
  }
  if (!rateLimit(`tender-docs:${user.id}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many uploads; wait a minute and try again." }, { status: 429 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Attach one document as `file`." }, { status: 422 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "The document is empty." }, { status: 422 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Each document must be 10 MB or smaller." }, { status: 413 });
  }

  const parsed = parseName(file.name || "document");
  const contentType = parsed ? TYPES[parsed.ext] : undefined;
  if (!parsed || !contentType) {
    return NextResponse.json(
      { error: "Unsupported document type. Allowed: PDF, JSON, ZIP, XLSX, CSV, DOCX, EML, TXT, MD." },
      { status: 415 },
    );
  }

  const edge = process.env.QUORUM_EDGE_URL?.trim().replace(/\/+$/, "") ?? "";
  const secret = process.env.QUORUM_EDGE_SECRET?.trim() ?? "";
  if (!edge || !secret) {
    return NextResponse.json(
      { error: "The R2 edge gate is not configured on this deployment; the document stays in the local vault." },
      { status: 503 },
    );
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    return NextResponse.json({ error: "The document could not be read." }, { status: 400 });
  }

  /* Extract first so a scanned/empty document still gets an honest answer
     even though its bytes are stored. The size is captured before the PUT:
     a consumed body may leave the ArrayBuffer detached (byteLength 0). */
  const size = bytes.byteLength;
  const extracted = await extractTenderText(bytes, file.name || "document").catch(() => null);

  const key = `tenders/${ref}/${Date.now()}-${parsed.stem}${parsed.ext}`;
  let edgeResponse: Response;
  try {
    edgeResponse = await fetch(`${edge}/__edge/upload?key=${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: {
        "x-quorum-edge-key": secret,
        "content-type": contentType,
      },
      body: bytes,
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return NextResponse.json(
      { error: "The R2 edge gate is unreachable; the document stays in the local vault." },
      { status: 502 },
    );
  }

  const result = (await edgeResponse.json().catch(() => ({}))) as { error?: string };
  if (!edgeResponse.ok) {
    const detail = typeof result.error === "string" ? result.error : `the edge gate refused the upload (HTTP ${edgeResponse.status})`;
    return NextResponse.json({ error: detail }, { status: edgeResponse.status === 503 ? 503 : 502 });
  }

  let staged = false;
  let stageReason: string | undefined;
  let files: string[] = [];
  if (extracted && extracted.text.trim()) {
    /* The bytes are already durable in R2; an attestation failure (a missing
       GATE_SECRET, say) must not turn the upload into a 500. It becomes an
       honest "stored, not staged" result instead. */
    const stage: { status: number; data: Record<string, unknown> } = await sidecarFetch(
      `/api/tenders/${encodeURIComponent(ref)}/docs`,
      {
        method: "POST",
        body: {
          docs: [{ name: file.name || "document", text: extracted.text, kind: extracted.kind }],
        },
        actor: user.name,
      },
    ).catch(() => ({
      status: 502,
      data: { error: "The procurement service could not be reached; the document is stored in R2 only." },
    }));
    staged = stage.status === 201;
    if (staged) {
      files = Array.isArray(stage.data.files)
        ? stage.data.files.filter((f): f is string => typeof f === "string")
        : [];
    } else {
      stageReason = sidecarError(stage.data, "The document was stored but could not be staged for review.");
    }
  } else {
    stageReason =
      extracted?.note ??
      "Text extraction is not available for this file type; the document is stored in R2 only.";
  }

  /* The bytes are durable at this point. Record the object itself — not only
     the optional staging — in the hash-chained spine. A failed audit append is
     reported, never hidden; it does not undo the stored object. */
  const audit: { status: number; data: Record<string, unknown> } = await sidecarFetch(
    "/api/tender-uploads",
    {
      method: "POST",
      actor: user.name,
      body: {
        tenderId: ref,
        key,
        bytes: size,
        contentType,
        filename: file.name || "document",
        staged,
        extracted: Boolean(extracted?.text.trim()),
        kind: extracted?.kind,
        pages: extracted?.pages,
        sheets: extracted?.sheets,
        chars: extracted?.text.length ?? 0,
        note: extracted?.note,
        reason: stageReason,
        files,
        durationMs: Date.now() - startedAt,
      },
    },
  ).catch(() => ({
    status: 502,
    data: { error: "The procurement service could not be reached; the upload was not recorded in the audit trail." },
  }));
  const auditEntry =
    audit.data.entry && typeof audit.data.entry === "object"
      ? (audit.data.entry as { seq?: unknown; id?: unknown; self?: unknown })
      : null;
  const auditSeq = typeof auditEntry?.seq === "number" ? auditEntry.seq : undefined;
  const auditId = typeof auditEntry?.id === "string" ? auditEntry.id : undefined;
  const auditSelf = typeof auditEntry?.self === "string" ? auditEntry.self : undefined;
  const audited =
    audit.status === 201 &&
    auditSeq !== undefined &&
    typeof auditId === "string" &&
    typeof auditSelf === "string";
  const auditReason = audited
    ? undefined
    : sidecarError(audit.data, "The upload was stored but not recorded in the audit trail.");

  return NextResponse.json(
    {
      ok: true,
      key,
      bytes: size,
      contentType,
      extracted: Boolean(extracted?.text.trim()),
      staged,
      kind: extracted?.kind,
      pages: extracted?.pages,
      sheets: extracted?.sheets,
      chars: extracted?.text.length ?? 0,
      note: extracted?.note,
      reason: stageReason,
      files,
      audited,
      audit: audited && auditSeq !== undefined && auditId && auditSelf
        ? { seq: auditSeq, id: auditId, self: auditSelf }
        : undefined,
      auditReason,
    },
    { status: 201, headers: { "cache-control": "no-store" } },
  );
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const startedAt = Date.now();
  const { ref } = await params;
  if (!isSafeTenderRef(ref)) {
    return listingError("The tender reference is not valid.", 422);
  }

  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) return listingError("Sign in to remove stored tender documents.", 401);
  if (!can(user.role, "run_reviews")) {
    return listingError("Only owners, admins and officers can remove stored documents.", 403);
  }
  if (!rateLimit(`tender-delete:${user.id}`, 30, 60_000)) {
    return listingError("Too many removals; wait a minute and try again.", 429);
  }

  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!isTenderKeyFor(ref, key)) {
    return listingError("The document key must live under this tender's storage prefix.", 422);
  }

  const edge = process.env.QUORUM_EDGE_URL?.trim().replace(/\/+$/, "") ?? "";
  const secret = process.env.QUORUM_EDGE_SECRET?.trim() ?? "";
  if (!edge || !secret) {
    return listingError("The R2 edge gate is not configured on this deployment.", 503);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${edge}/__edge/delete?key=${encodeURIComponent(key)}`, {
      method: "DELETE",
      headers: { "x-quorum-edge-key": secret },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return listingError("The R2 edge gate is unreachable.", 502);
  }
  if (!upstream.ok) {
    return listingError(
      "The storage gate refused the removal.",
      upstream.status === 503 ? 503 : 502,
    );
  }

  const filename = tenderDownloadFilename(key);
  const audit: { status: number; data: Record<string, unknown> } = await sidecarFetch(
    "/api/tender-deletions",
    {
      method: "POST",
      actor: user.name,
      body: {
        tenderId: ref,
        key,
        filename,
        userId: user.id,
        role: user.role,
        durationMs: Date.now() - startedAt,
      },
    },
  ).catch(() => ({
    status: 502,
    data: { error: "The procurement service could not be reached; the removal was not recorded in the audit trail." },
  }));
  const auditEntry =
    audit.data.entry && typeof audit.data.entry === "object"
      ? (audit.data.entry as { seq?: unknown; id?: unknown; self?: unknown })
      : null;
  const audited =
    audit.status === 201 &&
    typeof auditEntry?.seq === "number" &&
    typeof auditEntry.id === "string" &&
    typeof auditEntry.self === "string";
  const auditReason = audited
    ? undefined
    : sidecarError(audit.data, "The object was removed but the removal was not recorded in the audit trail.");

  return NextResponse.json(
    {
      ok: true,
      key,
      filename,
      audited,
      audit: audited && auditEntry && typeof auditEntry.seq === "number"
        ? { seq: auditEntry.seq, id: auditEntry.id as string, self: auditEntry.self as string }
        : undefined,
      auditReason,
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
