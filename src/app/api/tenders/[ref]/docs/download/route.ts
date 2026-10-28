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

/**
 * GET /api/tenders/:ref/docs/download?key=…&exp=…&sub=…&sig=… — stream a
 * stored tender document.
 *
 * Two locks, both required:
 *   1. a signed-in session with `read_documents`, and
 *   2. a signature over (ref, key, expiry, user id) minted by
 *      `GET .../docs/link` for that same user, valid for five minutes.
 *
 * The R2 secret stays server-side: this route fetches the object through the
 * quorum-edge gate and streams it back as an attachment. A copied link cannot
 * be used by another account, and a tampered key or expiry fails the HMAC.
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
 * 403 → role/signature/user mismatch  404 → object not found
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

  const edge = process.env.QUORUM_EDGE_URL?.trim().replace(/\/+$/, "") ?? "";
  const secret = process.env.QUORUM_EDGE_SECRET?.trim() ?? "";
  if (!edge || !secret) {
    return noStore({ error: "The R2 edge gate is not configured on this deployment." }, 503);
  }

  const range = req.headers.get("range");
  const ifRange = req.headers.get("if-range");
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
    return noStore({ error: "The R2 edge gate is unreachable." }, 502);
  }

  if (upstream.status === 404) {
    return noStore({ error: "That stored document was not found." }, 404);
  }
  if (upstream.status === 416) {
    const headers = new Headers({ "cache-control": "no-store", "accept-ranges": "bytes" });
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) headers.set("content-range", contentRange);
    return NextResponse.json(
      { error: "The requested byte range is not available for this document." },
      { status: 416, headers },
    );
  }
  if (!upstream.ok) {
    return noStore(
      { error: "The storage gate refused the download." },
      upstream.status === 503 ? 503 : 502,
    );
  }

  const partial = upstream.status === 206;
  const name = tenderDownloadFilename(key);
  const headers = new Headers({
    "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
    "content-disposition": attachmentDisposition(name),
    "cache-control": "private, no-store, no-transform",
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("content-length", length);
  const etag = upstream.headers.get("etag");
  if (etag) headers.set("etag", etag);
  const contentRange = upstream.headers.get("content-range");
  if (partial && contentRange) {
    headers.set("content-range", contentRange);
    /* Some edge paths still chunk a 206; Content-Range carries the length. */
    if (!headers.get("content-length")) {
      const match = /^bytes (\d+)-(\d+)\/\d+$/.exec(contentRange);
      if (match) headers.set("content-length", String(Number(match[2]) - Number(match[1]) + 1));
    }
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

  return new Response(upstream.body, { status: partial ? 206 : 200, headers });
}
