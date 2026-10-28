import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, rateLimit, SESSION_COOKIE } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  isSafeTenderRef,
  isTenderKeyFor,
  SIGNED_DOWNLOAD_TTL_MS,
  signTenderDownload,
  tenderDownloadFilename,
} from "@/lib/tender-access";

/**
 * GET /api/tenders/:ref/docs/link?key=… — mint a signed download URL.
 *
 * Requires a signed-in desk user with `read_documents`. The returned URL is
 * bound to this tender, this object key, this user and a five-minute expiry;
 * it can only be redeemed by the same signed-in account. No R2 secret ever
 * reaches the browser.
 *
 * 200 → { url, key, filename, expiresAt, expiresInSec }
 * 401 → no session  403 → role cannot read documents
 * 422 → unsafe ref / key outside the tender's prefix  429 → rate limited
 * 503 → no signing secret in production
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const { ref } = await params;
  if (!isSafeTenderRef(ref)) {
    return NextResponse.json({ error: "The tender reference is not valid." }, { status: 422 });
  }

  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Sign in to download tender documents." }, { status: 401 });
  }
  if (!can(user.role, "read_documents")) {
    return NextResponse.json(
      { error: "Your workspace role cannot download tender documents." },
      { status: 403 },
    );
  }
  if (!rateLimit(`tender-link:${user.id}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many download links; wait a minute and try again." }, { status: 429 });
  }

  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!isTenderKeyFor(ref, key)) {
    return NextResponse.json(
      { error: "The document key must live under this tender's storage prefix." },
      { status: 422 },
    );
  }

  const expiresAt = Date.now() + SIGNED_DOWNLOAD_TTL_MS;
  let signature: string;
  try {
    signature = signTenderDownload(ref, key, expiresAt, user.id);
  } catch {
    return NextResponse.json(
      { error: "Signed downloads are not configured on this deployment." },
      { status: 503 },
    );
  }

  const query = new URLSearchParams({
    key,
    exp: String(expiresAt),
    sub: user.id,
    sig: signature,
  });
  return NextResponse.json(
    {
      url: `/api/tenders/${encodeURIComponent(ref)}/docs/download?${query.toString()}`,
      key,
      filename: tenderDownloadFilename(key),
      expiresAt: new Date(expiresAt).toISOString(),
      expiresInSec: SIGNED_DOWNLOAD_TTL_MS / 1000,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
