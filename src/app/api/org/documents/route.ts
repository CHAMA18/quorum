import { NextResponse, type NextRequest } from "next/server";
import { clientKey, getOrgFromToken, ORG_SESSION_COOKIE, rateLimit } from "@/lib/org-auth";
import {
  MAX_SUPPLIER_BID_FILE_BYTES,
  MAX_SUPPLIER_BID_FILES,
  MAX_SUPPLIER_BID_TOTAL_BYTES,
} from "@/lib/supplier-bid-document-limits";
import {
  canonicalProfileDocument,
  deleteSupplierProfileDocument,
  getSupplierProfileDocumentUsage,
  listSupplierProfileDocuments,
  putSupplierProfileDocument,
} from "@/lib/supplier-profile-documents";
import {
  supplierBidFileType,
  verifiedSupplierFirebaseIdentity,
} from "@/lib/supplier-bid-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The supplier's standing bid-document set, uploaded once against the
 * organization rather than inside an opportunity. The catalogue itself lives in
 * `src/lib/required-bid-documents.ts`; this route only stores files and reports
 * which catalogue items already have one on record.
 */

export async function GET(req: NextRequest) {
  const org = getOrgFromToken(req.cookies.get(ORG_SESSION_COOKIE)?.value);
  if (!org) {
    return NextResponse.json({ error: "Sign in as an organization to view your bid documents." }, { status: 401 });
  }
  const identity = await verifiedSupplierFirebaseIdentity(req.headers.get("authorization"), org);
  if (!identity.ok) return NextResponse.json({ error: identity.error }, { status: identity.status });
  try {
    const documents = await listSupplierProfileDocuments({ org, firebaseUid: identity.identity.uid });
    return NextResponse.json(
      { documents, maxFileBytes: MAX_SUPPLIER_BID_FILE_BYTES },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cloudflare R2 could not list your bid documents." },
      { status: 503 },
    );
  }
}

export async function POST(req: NextRequest) {
  const org = getOrgFromToken(req.cookies.get(ORG_SESSION_COOKIE)?.value);
  if (!org) {
    return NextResponse.json({ error: "Sign in as an organization to upload bid documents." }, { status: 401 });
  }
  if (!rateLimit(clientKey(req, "org-profile-docs"), 60, 15 * 60_000)) {
    return NextResponse.json({ error: "Too many document uploads. Wait a few minutes and try again." }, { status: 429 });
  }
  const identity = await verifiedSupplierFirebaseIdentity(req.headers.get("authorization"), org);
  if (!identity.ok) return NextResponse.json({ error: identity.error }, { status: identity.status });

  const form = await req.formData().catch(() => null);
  const rawFile = form?.get("file");
  const requirementLabel = typeof form?.get("requirement") === "string" ? String(form.get("requirement")) : "";
  const requirement = canonicalProfileDocument(requirementLabel);
  if (!rawFile || typeof rawFile === "string") {
    return NextResponse.json({ error: "Choose a document to upload." }, { status: 422 });
  }
  if (!requirement) {
    return NextResponse.json({ error: "Choose one of the standard bid documents." }, { status: 422 });
  }
  if (!rawFile.size) return NextResponse.json({ error: "The selected document is empty." }, { status: 422 });
  if (rawFile.size > MAX_SUPPLIER_BID_FILE_BYTES) {
    return NextResponse.json({ error: "Each bid document must be 10 MB or smaller." }, { status: 413 });
  }

  const bytes = new Uint8Array(await rawFile.arrayBuffer());
  const fileType = supplierBidFileType(rawFile.name, bytes);
  if (!fileType) {
    return NextResponse.json(
      { error: "Unsupported or unreadable file. Use a valid PDF, DOCX, XLSX, PNG, JPG or WEBP file." },
      { status: 415 },
    );
  }

  let usage;
  try {
    usage = await getSupplierProfileDocumentUsage({ orgId: org.id, firebaseUid: identity.identity.uid });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cloudflare R2 could not check the current upload limits." },
      { status: 503 },
    );
  }
  if (usage.truncated || usage.files >= MAX_SUPPLIER_BID_FILES) {
    return NextResponse.json(
      { error: `Your document set can hold up to ${MAX_SUPPLIER_BID_FILES} files. Remove one before uploading another.` },
      { status: 413 },
    );
  }
  if (usage.bytes + rawFile.size > MAX_SUPPLIER_BID_TOTAL_BYTES) {
    return NextResponse.json(
      { error: `Your document set must total ${MAX_SUPPLIER_BID_TOTAL_BYTES / (1024 * 1024)} MB or less.` },
      { status: 413 },
    );
  }

  try {
    const document = await putSupplierProfileDocument({
      org,
      firebaseUid: identity.identity.uid,
      requirement,
      filename: rawFile.name,
      contentType: fileType.contentType,
      bytes,
    });
    return NextResponse.json({ document }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cloudflare R2 refused this document." },
      { status: 503 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const org = getOrgFromToken(req.cookies.get(ORG_SESSION_COOKIE)?.value);
  if (!org) {
    return NextResponse.json({ error: "Sign in as an organization to remove a bid document." }, { status: 401 });
  }
  if (!rateLimit(clientKey(req, "org-profile-doc-delete"), 40, 15 * 60_000)) {
    return NextResponse.json({ error: "Too many document changes. Wait a few minutes and try again." }, { status: 429 });
  }
  const identity = await verifiedSupplierFirebaseIdentity(req.headers.get("authorization"), org);
  if (!identity.ok) return NextResponse.json({ error: identity.error }, { status: identity.status });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const key = typeof body?.key === "string" ? body.key : "";
  if (!key) return NextResponse.json({ error: "Choose the document to remove." }, { status: 422 });

  try {
    const removed = await deleteSupplierProfileDocument({
      org,
      firebaseUid: identity.identity.uid,
      key,
    });
    if (!removed.ok) return NextResponse.json({ error: removed.error }, { status: removed.status });
    return NextResponse.json({ deleted: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cloudflare R2 could not remove the document." },
      { status: 503 },
    );
  }
}
