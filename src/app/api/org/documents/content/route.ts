import { NextResponse, type NextRequest } from "next/server";
import { clientKey, getOrgFromToken, ORG_SESSION_COOKIE, rateLimit } from "@/lib/org-auth";
import { verifiedSupplierFirebaseIdentity } from "@/lib/supplier-bid-documents";
import { readSupplierProfileDocument } from "@/lib/supplier-profile-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/org/documents/content?key=…&download=1
 *
 * Serves one standing bid document back to its owning supplier so the console
 * can preview it (or save it). The edge secret never leaves the server: the
 * route re-reads the object through the gate and re-verifies the ownership
 * metadata recorded at upload time before a single byte is returned.
 *
 * 200 → the file, inline by default  401/403 → not this supplier
 * 404 → gone from R2  413 → over the reading limit  503 → R2 unreachable
 */
export async function GET(req: NextRequest) {
  const org = getOrgFromToken(req.cookies.get(ORG_SESSION_COOKIE)?.value);
  if (!org) {
    return NextResponse.json({ error: "Sign in as an organization to open your bid documents." }, { status: 401 });
  }
  if (!rateLimit(clientKey(req, "org-profile-doc-content"), 240, 15 * 60_000)) {
    return NextResponse.json({ error: "Too many document reads. Wait a few minutes and try again." }, { status: 429 });
  }
  const identity = await verifiedSupplierFirebaseIdentity(req.headers.get("authorization"), org);
  if (!identity.ok) return NextResponse.json({ error: identity.error }, { status: identity.status });

  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!key) return NextResponse.json({ error: "Choose the document to open." }, { status: 422 });
  const download = req.nextUrl.searchParams.get("download") === "1";

  let file: Awaited<ReturnType<typeof readSupplierProfileDocument>>;
  try {
    file = await readSupplierProfileDocument({
      org,
      firebaseUid: identity.identity.uid,
      key,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cloudflare R2 could not read this document." },
      { status: 503 },
    );
  }
  if (!file.ok) return NextResponse.json({ error: file.error }, { status: file.status });

  /* Both filename forms: a plain ASCII fallback for old clients and the RFC
     5987 form so a non-Latin name is not mangled on save or in the tab title. */
  const safeName = file.filename.replace(/["\\\r\n]/g, "_").slice(0, 120) || "document";
  const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_");

  /* A concrete ArrayBuffer slice: Next's BodyInit does not accept a generic
     ArrayBufferLike view, and the file is at most 10 MB either way. */
  const body = file.bytes.buffer.slice(
    file.bytes.byteOffset,
    file.bytes.byteOffset + file.bytes.byteLength,
  ) as ArrayBuffer;

  return new NextResponse(body, {
    headers: {
      "content-type": file.contentType,
      "content-length": String(file.bytes.byteLength),
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}
