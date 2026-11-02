import { NextResponse, type NextRequest } from "next/server";
import { clientKey, getOrgFromToken, ORG_SESSION_COOKIE, rateLimit } from "@/lib/org-auth";
import { metaBidDocumentAssistAvailable, scanProfileDocumentWithMeta } from "@/lib/meta-bid-document-assist";
import { verifiedSupplierFirebaseIdentity } from "@/lib/supplier-bid-documents";
import { readSupplierProfileDocument } from "@/lib/supplier-profile-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/org/documents/scan  { key }
 *
 * Reads one standing bid document with Meta's multimodal Muse Spark and
 * returns a structured, advisory reading: what the document appears to be,
 * whether it matches the catalogue item, who it names, its dates and number,
 * and anything doubtful. The bytes are sent inline for this one request
 * (`store: false`); nothing is filed with Meta and nothing is written back to
 * R2 or the document's status — a scan never changes eligibility.
 *
 * 200 → { review }  415 → a format Muse Spark cannot read
 * 503 → the model is not configured on this deployment  502 → the model failed
 */
export async function POST(req: NextRequest) {
  const org = getOrgFromToken(req.cookies.get(ORG_SESSION_COOKIE)?.value);
  if (!org) {
    return NextResponse.json({ error: "Sign in as an organization to scan your bid documents." }, { status: 401 });
  }
  if (!rateLimit(clientKey(req, "org-profile-doc-scan"), 40, 15 * 60_000)) {
    return NextResponse.json({ error: "Too many document scans. Wait a few minutes and try again." }, { status: 429 });
  }
  const identity = await verifiedSupplierFirebaseIdentity(req.headers.get("authorization"), org);
  if (!identity.ok) return NextResponse.json({ error: identity.error }, { status: identity.status });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const key = typeof body?.key === "string" ? body.key : "";
  if (!key) return NextResponse.json({ error: "Choose the document to scan." }, { status: 422 });

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

  if (!metaBidDocumentAssistAvailable()) {
    return NextResponse.json(
      {
        error:
          "Meta document scanning is not configured on this deployment. The document is stored and can be previewed or downloaded.",
      },
      { status: 503 },
    );
  }

  try {
    const review = await scanProfileDocumentWithMeta({
      bytes: file.bytes,
      filename: file.filename,
      contentType: file.contentType,
      requirement: file.requirement,
      organizationName: org.name,
      firebaseUid: identity.identity.uid,
    });
    return NextResponse.json({ review }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Muse Spark could not scan this document. It is still stored in Cloudflare R2.";
    const unsupported = /scans PDF, PNG, JPEG and WebP/i.test(message);
    return NextResponse.json({ error: message }, { status: unsupported ? 415 : 502 });
  }
}
