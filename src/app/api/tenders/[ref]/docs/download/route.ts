import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, rateLimit, SESSION_COOKIE } from "@/lib/auth";
import { sidecarFetch } from "@/lib/org-sidecar";
import { can } from "@/lib/permissions";
import {
  isSafeTenderRef,
  isTenderKeyFor,
  tenderDownloadFilename,
  verifyTenderDownload,
} from "@/lib/tender-access";
import { readLocalObject } from "@/lib/tender-local-store";

/**
 * GET /api/tenders/:ref/docs/download?key=…&exp=…&sub=…&sig=… — stream a
 * stored tender document.
 *
 * Two locks, both required:
 *   1. a signed-in session with `read_documents`, and
 *   2. a signature over (ref, key, expiry, user id) minted by
 *      `GET .../docs/link` for that same user, valid for five minutes.
 *
 * The storage credentials stay server-side. A document held in this
 * deployment's own tender store is read from disk; anything else is fetched
 * through the quorum-edge gate. A copied link cannot be used by another
 * account, and a tampered key or expiry fails the HMAC.
 *
 * A single `Range` request is forwarded to the gate, so a large document can
 * be resumed or paged without a second full transfer. The answer is then a
 * real `206 Partial Content` with `Content-Range` (or `416` when the range
 * lies outside the stored object); a multi-range or malformed header is
 * answered with the full `200` document, which HTTP permits.
 *
 * Every delivered object is appended to the sidecar's hash-chained audit
 * trail as a `tender_download` READ with the tender, object key, slice, user
 * and link expiry. The append cannot be reached on every deployment, so it
 * never blocks the bytes: `x-quorum-audit` says `recorded` or `unavailable`,
 * and a recorded entry also exposes its seq/id/self hash on the response.
 *
 * 200 → the document  206 → the requested byte range  401 → no session
 * 403 → role/signature/user mismatch  404 → object not in this store
 * 410 → expired link  416 → range outside the object  422 → unsafe ref/key
 * 429 → rate limited  502/503 → storage gate unavailable.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function attachmentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, "%27")}`;
}

/**
 * One byte range of a document held on this deployment. A malformed or
 * multi-range header is answered with the full document, which HTTP permits;
 * a range that lies outside the object is a 416. `If-Range` asks for the full
 * representation when the validator does not match, and this store does not
 * compare validators, so the full document is served.
 */
type LocalSlice =
  | { ok: true; bytes: Uint8Array; partial: boolean; contentRange?: string }
  | { ok: false; total: number };

function sliceLocalDocument(range: string | null, bytes: Uint8Array): LocalSlice {
  const total = bytes.byteLength;
  if (!range) return { ok: true, bytes, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || (!match[1] && !match[2])) return { ok: true, bytes, partial: false };

  let from: number;
  let to: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return { ok: true, bytes, partial: false };
    from = Math.max(0, total - suffix);
    to = total - 1;
  } else {
    from = Number(match[1]);
    to = match[2] ? Number(match[2]) : total - 1;
  }
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    from >= total ||
    to < from
  ) {
    return { ok: false, total };
  }
  to = Math.min(to, total - 1);
  return {
    ok: true,
    bytes: bytes.subarray(from, to + 1),
    partial: true,
    contentRange: `bytes ${from}-${to}/${total}`,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const startedAt = Date.now();
  const { ref } = await params;
  if (!isSafeTenderRef(ref)) {
    return noStore({ error: "The tender reference is not valid." }, 422);
  }

  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) {
    return noStore({ error: "Sign in to download tender documents." }, 401);
  }
  if (!can(user.role, "read_documents")) {
    return noStore({ error: "Your workspace role cannot download tender documents." }, 403);
  }
  if (!rateLimit(`tender-download:${user.id}`, 120, 60_000)) {
    return noStore({ error: "Too many downloads; wait a minute and try again." }, 429);
  }

  const query = req.nextUrl.searchParams;
  const key = query.get("key") ?? "";
  const expRaw = query.get("exp") ?? "";
  const sub = query.get("sub") ?? "";
  const sig = query.get("sig") ?? "";
  if (!isTenderKeyFor(ref, key) || !expRaw || !sub || !sig) {
    return noStore({ error: "The download link is incomplete or its key is not valid." }, 422);
  }

  const expiresAt = Number(expRaw);
  if (!Number.isSafeInteger(expiresAt)) {
    return noStore({ error: "The download link is not valid." }, 403);
  }
  if (sub !== user.id) {
    return noStore({ error: "This download link was issued to another account." }, 403);
  }

  let verdict: ReturnType<typeof verifyTenderDownload>;
  try {
    verdict = verifyTenderDownload({ ref, key, expiresAt, userId: user.id, signature: sig });
  } catch {
    return noStore({ error: "Signed downloads are not configured on this deployment." }, 503);
  }
  if (!verdict.ok) {
    return noStore({ error: verdict.reason }, verdict.status);
  }

  const range = req.headers.get("range");
  const ifRange = req.headers.get("if-range");
  const name = tenderDownloadFilename(key);
  const headers = new Headers({
    "content-disposition": attachmentDisposition(name),
    "cache-control": "private, no-store, no-transform",
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  let body: BodyInit;
  let status = 200;
  let partial = false;
  let contentRange: string | null = null;

  /* A document this deployment holds is served from its own store; the edge is
     only consulted for a key the local store does not have. */
  const local = await readLocalObject(ref, key).catch(() => null);
  if (local) {
    const slice = sliceLocalDocument(ifRange ? null : range, local.bytes);
    if (!slice.ok) {
      return NextResponse.json(
        { error: "The requested byte range is not available for this document." },
        {
          status: 416,
          headers: {
            "cache-control": "no-store",
            "accept-ranges": "bytes",
            "content-range": `bytes */${slice.total}`,
          },
        },
      );
    }
    headers.set("content-type", local.contentType || "application/octet-stream");
    headers.set("content-length", String(slice.bytes.byteLength));
    if (slice.contentRange) {
      headers.set("content-range", slice.contentRange);
      contentRange = slice.contentRange;
    }
    body = new Blob([new Uint8Array(slice.bytes)], {
      type: local.contentType || "application/octet-stream",
    });
    partial = slice.partial;
    status = partial ? 206 : 200;
  } else {
    const edge = process.env.QUORUM_EDGE_URL?.trim().replace(/\/+$/, "") ?? "";
    const secret = process.env.QUORUM_EDGE_SECRET?.trim() ?? "";
    if (!edge || !secret) {
      return noStore(
        { error: "That document is not held on this deployment, and no storage gate is configured." },
        404,
      );
    }

    /* Ask the gate for the stored bytes, not a gzipped variant: compression of a
       206 strips Content-Length and makes Content-Range ambiguous. */
    const upstreamHeaders: Record<string, string> = {
      "x-quorum-edge-key": secret,
      "accept-encoding": "identity",
    };
    if (range) upstreamHeaders.range = range;
    if (ifRange) upstreamHeaders["if-range"] = ifRange;

    let upstream: Response;
    try {
      upstream = await fetch(`${edge}/__edge/object?key=${encodeURIComponent(key)}`, {
        headers: upstreamHeaders,
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      return noStore({ error: "The storage gate is unreachable." }, 502);
    }

    if (upstream.status === 404) {
      return noStore({ error: "That stored document was not found." }, 404);
    }
    if (upstream.status === 416) {
      const headers416 = new Headers({ "cache-control": "no-store", "accept-ranges": "bytes" });
      const rangeHeader = upstream.headers.get("content-range");
      if (rangeHeader) headers416.set("content-range", rangeHeader);
      return NextResponse.json(
        { error: "The requested byte range is not available for this document." },
        { status: 416, headers: headers416 },
      );
    }
    if (!upstream.ok) {
      return noStore(
        { error: "The storage gate refused the download." },
        upstream.status === 503 ? 503 : 502,
      );
    }

    partial = upstream.status === 206;
    headers.set("content-type", upstream.headers.get("content-type") ?? "application/octet-stream");
    const length = upstream.headers.get("content-length");
    if (length) headers.set("content-length", length);
    const etag = upstream.headers.get("etag");
    if (etag) headers.set("etag", etag);
    contentRange = upstream.headers.get("content-range");
    if (partial && contentRange) {
      headers.set("content-range", contentRange);
      /* Some edge paths still chunk a 206; Content-Range carries the length. */
      if (!headers.get("content-length")) {
        const match = /^bytes (\d+)-(\d+)\/\d+$/.exec(contentRange);
        if (match) headers.set("content-length", String(Number(match[2]) - Number(match[1]) + 1));
      }
    }
    body = upstream.body as ReadableStream<Uint8Array>;
    status = partial ? 206 : 200;
  }

  /* The bytes are ready to stream; record the delivery. A failed append is
     reported on the response and never turns a readable document into a 500. */
  const servedBytes = Number(headers.get("content-length") ?? NaN);
  const audit: { status: number; data: Record<string, unknown> } = await sidecarFetch(
    "/api/tender-downloads",
    {
      method: "POST",
      actor: user.name,
      body: {
        tenderId: ref,
        key,
        filename: name,
        userId: user.id,
        role: user.role,
        bytes: Number.isFinite(servedBytes) ? servedBytes : 0,
        range: range || undefined,
        partial,
        contentRange: contentRange || undefined,
        linkExpiresAt: expiresAt,
        durationMs: Date.now() - startedAt,
      },
    },
  ).catch(() => ({
    status: 502,
    data: { error: "The procurement service could not be reached; the download was not recorded in the audit trail." },
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
  headers.set("x-quorum-audit", audited ? "recorded" : "unavailable");
  if (audited && auditEntry && typeof auditEntry.seq === "number") {
    headers.set("x-quorum-audit-seq", String(auditEntry.seq));
    headers.set("x-quorum-audit-id", auditEntry.id as string);
    headers.set("x-quorum-audit-self", auditEntry.self as string);
  }

  return new Response(body, { status, headers });
}
