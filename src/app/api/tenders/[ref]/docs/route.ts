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
import { samEnabled, segmentTenderScan, type SamResult } from "@/lib/sam";
import {
  deleteLocalObject,
  hasLocalObject,
  listLocalObjects,
  putLocalObject,
} from "@/lib/tender-local-store";

/**
 * POST /api/tenders/:ref/docs — store a tender document.
 *
 * The browser sends multipart form data (`file`); this route:
 *   1. requires a signed-in workspace user with `run_reviews` (owner, admin,
 *      officer) — the edge secret never reaches the browser;
 *   2. validates the tender reference, the extension and a 10 MB ceiling;
 *   3. extracts readable text (PDF/DOCX/XLSX/text) before anything is staged;
 *   4. stores the bytes — through the quorum-edge Worker when it is configured,
 *      otherwise in this deployment's own tender directory; both use the same
 *      `tenders/<ref>/…` key, so nothing downstream needs to know which one
 *      answered;
 *   5. stages the extracted text through the sidecar's attested
 *      `POST /api/tenders/:ref/docs`, which writes the notice/bid files the
 *      review graph reads;
 *   6. records the stored object in the sidecar's hash-chained audit trail via
 *      its attested `POST /api/tender-uploads`, whether or not the text could
 *      be staged. Storage is never silent.
 *
 * The object key, storage location and audit sequence are returned so the
 * caller can cite them. If extraction finds no text (a scanned PDF, for
 * example), the file is still stored and the response says `staged: false`
 * with a reason — OCR is not claimed.
 *
 * Scanned pages and image uploads are additionally handed to SAM 3.1 when
 * `SAM_ENABLED=true`: the model locates the table region and returns boxes for
 * a human to inspect. It does not read the table, and the upload is marked
 * `humanReviewRequired` whether SAM matched or not. With SAM off or
 * unreachable, nothing about the upload fails; the flag simply stays true.
 *
 * GET /api/tenders/:ref/docs — list every stored object under this tender's
 * prefix, from the edge and from this deployment's own store. Requires
 * `read_documents` (committee members and auditors included), so neither
 * store is public. Each object carries its key, filename, size, type and
 * upload time; the browser mints a signed URL per chosen object through
 * `.../docs/link`, so listing does not hand out credentials or links that
 * outlive the page.
 *
 * DELETE /api/tenders/:ref/docs?key=… — operator-only removal of one stored
 * object. Requires `run_reviews`, validates the key against the tender's
 * prefix, deletes it from whichever store holds it and appends a
 * `tender_delete` line to the hash-chained audit trail. A failed audit append
 * never pretends the object is still there, and never hides the deletion.
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
  /* Scanned pages: stored as images, never silently "extracted". */
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

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

/**
 * The edge is preferred when both its URL and its key are set. A deployment
 * without them is not broken: the local store answers, and the response says
 * which store did.
 */
function edgeConfig(): { edge: string; secret: string; configured: boolean } {
  const edge = process.env.QUORUM_EDGE_URL?.trim().replace(/\/+$/, "") ?? "";
  const secret = process.env.QUORUM_EDGE_SECRET?.trim() ?? "";
  return { edge, secret, configured: Boolean(edge && secret) };
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

  const { edge, secret, configured } = edgeConfig();
  const local = await listLocalObjects(ref).catch(() => []);
  if (!configured) {
    const totalBytes = local.reduce((sum, object) => sum + object.bytes, 0);
    return NextResponse.json(
      {
        tender: ref,
        objects: local,
        count: local.length,
        totalBytes,
        truncated: false,
        storage: "local",
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  /* Both stores are real: a deployment can have documents from before the
     local store existed and from after it. Dedupe by key, newest first. */
  const objects: StoredObject[] = [...local];
  const seen = new Set<string>(local.map((object) => object.key));
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
  const storage =
    local.length === 0 ? "r2" : objects.length > local.length ? "mixed" : "local";

  return NextResponse.json(
    {
      tender: ref,
      objects,
      count: objects.length,
      totalBytes,
      truncated: more,
      storage,
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
      { error: "Unsupported document type. Allowed: PDF, JSON, ZIP, XLSX, CSV, DOCX, EML, TXT, MD, PNG, JPG, WEBP." },
      { status: 415 },
    );
  }

  const { edge, secret, configured } = edgeConfig();

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

  /* A page with no embedded text (or an image upload) cannot be read by the
     graph. SAM 3.1 can still point a human at the table region. The call is
     opt-in, bounded, and never turns a scan into a claim of readable text. */
  const isVisionDoc =
    IMAGE_EXTS.has(parsed.ext) ||
    (parsed.ext === ".pdf" && (!extracted?.text.trim() || /OCR|scan/i.test(extracted?.note ?? "")));
  const vision: SamResult | null =
    isVisionDoc && samEnabled()
      ? await segmentTenderScan(new Uint8Array(bytes), file.name || "document", {
          prompts: [process.env.SAM_PROMPT?.trim() || "table"],
        }).catch((err): SamResult => ({
          ok: false,
          model: process.env.SAM_MODEL?.trim() || "sam-3.1",
          regions: [],
          matches: 0,
          latencyMs: 0,
          error: (err as Error).message.slice(0, 300),
        }))
      : null;
  const visionSummary = vision
    ? {
        model: vision.model,
        ok: vision.ok,
        matches: vision.matches,
        page: vision.page,
        prompt: vision.regions[0]?.prompt ?? process.env.SAM_PROMPT?.trim() ?? "table",
        boxes: vision.regions.flatMap((region) => region.boxes).slice(0, 20),
        latencyMs: vision.latencyMs,
        note: vision.ok
          ? vision.matches > 0
            ? `SAM located ${vision.matches} matching region(s) on page ${vision.page ?? 1}. A human must inspect the table; SAM does not read it.`
            : "SAM found no matching table region. Review the scan manually."
          : vision.error,
      }
    : null;
  const humanReviewRequired = isVisionDoc || /OCR|scan/i.test(extracted?.note ?? "");

  const key = `tenders/${ref}/${Date.now()}-${parsed.stem}${parsed.ext}`;
  const storage: "local" | "r2" = configured ? "r2" : "local";

  if (configured) {
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
        { error: "The storage gate is unreachable; the document was not stored." },
        { status: 502 },
      );
    }

    const result = (await edgeResponse.json().catch(() => ({}))) as { error?: string };
    if (!edgeResponse.ok) {
      const detail = typeof result.error === "string" ? result.error : `the edge gate refused the upload (HTTP ${edgeResponse.status})`;
      return NextResponse.json({ error: detail }, { status: edgeResponse.status === 503 ? 503 : 502 });
    }
  } else {
    /* No edge on this deployment: the bytes go to the application's own tender
       directory, indexed and hash-described. The rest of the pipeline — the
       extraction, the staging call and the audit append — is unchanged. */
    try {
      await putLocalObject(ref, key, new Uint8Array(bytes), contentType);
    } catch (err) {
      return NextResponse.json(
        {
          error:
            (err as Error).message ||
            "The document could not be written to this deployment's tender store.",
        },
        { status: 500 },
      );
    }
  }

  let staged = false;
  let stageReason: string | undefined;
  let files: string[] = [];
  if (extracted && extracted.text.trim()) {
    /* The bytes are already durable; an attestation failure (a missing
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
      status: 502,        data: { error: "The procurement service could not be reached; the document is stored but not staged for review." },
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
      "Text extraction is not available for this file type; the document is stored but not staged for review.";
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
        humanReviewRequired,
        vision: visionSummary
          ? {
              model: visionSummary.model,
              ok: visionSummary.ok,
              matches: visionSummary.matches,
              page: visionSummary.page,
              prompt: visionSummary.prompt,
              latencyMs: visionSummary.latencyMs,
              note: visionSummary.note,
            }
          : undefined,
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
      storage,
      extracted: Boolean(extracted?.text.trim()),
      staged,
      kind: extracted?.kind,
      pages: extracted?.pages,
      sheets: extracted?.sheets,
      chars: extracted?.text.length ?? 0,
      note: extracted?.note,
      reason: stageReason,
      files,
      humanReviewRequired,
      vision: visionSummary ?? undefined,
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

  const { edge, secret, configured } = edgeConfig();
  /* Whichever store holds the object answers the removal. A local object is
     removed from disk; anything else must be removed through the edge. */
  const storage: "local" | "r2" = (await hasLocalObject(ref, key)) ? "local" : "r2";
  if (storage === "local") {
    try {
      await deleteLocalObject(ref, key);
    } catch (err) {
      return listingError(
        (err as Error).message || "The stored document could not be removed.",
        500,
      );
    }
  } else if (configured) {
    let upstream: Response;
    try {
      upstream = await fetch(`${edge}/__edge/delete?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
        headers: { "x-quorum-edge-key": secret },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      return listingError("The storage gate is unreachable.", 502);
    }
    if (!upstream.ok) {
      return listingError(
        "The storage gate refused the removal.",
        upstream.status === 503 ? 503 : 502,
      );
    }
  } else {
    return listingError("That document is not held on this deployment.", 404);
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
        storage,
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
      storage,
      audited,
      audit: audited && auditEntry && typeof auditEntry.seq === "number"
        ? { seq: auditEntry.seq, id: auditEntry.id as string, self: auditEntry.self as string }
        : undefined,
      auditReason,
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
