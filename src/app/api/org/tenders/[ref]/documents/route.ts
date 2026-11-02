import { NextResponse, type NextRequest } from "next/server";
import { clientKey, getOrgFromToken, ORG_SESSION_COOKIE, orgActor, rateLimit } from "@/lib/org-auth";
import { sidecarError, sidecarFetch } from "@/lib/org-sidecar";
import {
  MAX_SUPPLIER_BID_FILE_BYTES,
  MAX_SUPPLIER_BID_FILES,
  MAX_SUPPLIER_BID_TOTAL_BYTES,
  deleteSupplierBidObject,
  getSupplierBidStorageUsage,
  getSupplierBidObjectHead,
  listSupplierBidObjects,
  publishedTenderRequirements,
  putSupplierBidObject,
  safeSupplierFilename,
  supplierBidFileType,
  verifiedSupplierFirebaseIdentity,
} from "@/lib/supplier-bid-documents";
import { metaBidDocumentAssistAvailable, reviewBidDocumentWithMeta } from "@/lib/meta-bid-document-assist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeTenderRef(ref: string): boolean {
  return ref.length > 0 && ref.length <= 80 && /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(ref);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const org = getOrgFromToken(req.cookies.get(ORG_SESSION_COOKIE)?.value);
  if (!org) return NextResponse.json({ error: "Sign in as an organization to view bid document requirements." }, { status: 401 });
  const { ref } = await params;
  if (!safeTenderRef(ref)) return NextResponse.json({ error: "The tender reference is not valid." }, { status: 422 });
  const requirements = await publishedTenderRequirements(ref);
  if (!requirements.ok) return NextResponse.json({ error: requirements.error }, { status: requirements.status });
  const identity = await verifiedSupplierFirebaseIdentity(req.headers.get("authorization"), org);
  if (!identity.ok) return NextResponse.json({ error: identity.error }, { status: identity.status });
  let uploadedDocuments;
  try {
    uploadedDocuments = await listSupplierBidObjects({
      tenderRef: ref,
      org,
      firebaseUid: identity.identity.uid,
      requiredDocuments: requirements.requiredDocuments,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Cloudflare R2 could not list bid documents." }, { status: 503 });
  }
  return NextResponse.json({
    requiredDocuments: requirements.requiredDocuments,
    uploadedDocuments,
    metaAssistAvailable: metaBidDocumentAssistAvailable(),
    maxFileBytes: MAX_SUPPLIER_BID_FILE_BYTES,
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const org = getOrgFromToken(req.cookies.get(ORG_SESSION_COOKIE)?.value);
  if (!org) return NextResponse.json({ error: "Sign in as an organization to upload bid documents." }, { status: 401 });
  const { ref } = await params;
  if (!safeTenderRef(ref)) return NextResponse.json({ error: "The tender reference is not valid." }, { status: 422 });
  if (!rateLimit(clientKey(req, "org-bid-docs"), 40, 15 * 60_000)) {
    return NextResponse.json({ error: "Too many bid document uploads. Wait a few minutes and try again." }, { status: 429 });
  }

  const identity = await verifiedSupplierFirebaseIdentity(req.headers.get("authorization"), org);
  if (!identity.ok) return NextResponse.json({ error: identity.error }, { status: identity.status });

  const requirements = await publishedTenderRequirements(ref);
  if (!requirements.ok) return NextResponse.json({ error: requirements.error }, { status: requirements.status });
  const form = await req.formData().catch(() => null);
  const rawFile = form?.get("file");
  const requirementLabel = typeof form?.get("requirement") === "string" ? String(form.get("requirement")).trim() : "";
  const requirement = requirements.requiredDocuments.find((item) => item === requirementLabel);
  if (!rawFile || typeof rawFile === "string") return NextResponse.json({ error: "Choose a document to upload." }, { status: 422 });
  if (!requirement) return NextResponse.json({ error: "Choose one of the published required bid documents." }, { status: 422 });
  if (!rawFile.size) return NextResponse.json({ error: "The selected document is empty." }, { status: 422 });
  if (rawFile.size > MAX_SUPPLIER_BID_FILE_BYTES) {
    return NextResponse.json({ error: "Each bid document must be 10 MB or smaller." }, { status: 413 });
  }

  const bytes = new Uint8Array(await rawFile.arrayBuffer());
  const fileType = supplierBidFileType(rawFile.name, bytes);
  if (!fileType) {
    return NextResponse.json({ error: "Unsupported or unreadable file. Use a valid PDF, DOCX, XLSX, PNG, JPG or WEBP file." }, { status: 415 });
  }

  let usage;
  try {
    usage = await getSupplierBidStorageUsage({ tenderRef: ref, org, firebaseUid: identity.identity.uid });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Cloudflare R2 could not check the current upload limits." }, { status: 503 });
  }
  if (usage.truncated || usage.files >= MAX_SUPPLIER_BID_FILES) {
    return NextResponse.json({ error: `A bid can contain up to ${MAX_SUPPLIER_BID_FILES} uploaded files.` }, { status: 413 });
  }
  if (usage.bytes + rawFile.size > MAX_SUPPLIER_BID_TOTAL_BYTES) {
    return NextResponse.json({ error: `Bid attachments must total ${MAX_SUPPLIER_BID_TOTAL_BYTES / (1024 * 1024)} MB or less.` }, { status: 413 });
  }

  let document;
  try {
    document = await putSupplierBidObject({
      tenderRef: ref,
      org,
      firebaseUid: identity.identity.uid,
      requirement,
      filename: rawFile.name,
      contentType: fileType.contentType,
      bytes,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Cloudflare R2 refused this document." }, { status: 503 });
  }

  const audit = await sidecarFetch("/api/supplier-bid-uploads", {
    method: "POST",
    actor: orgActor(org),
    body: {
      tenderRef: ref,
      organizationId: org.id,
      firebaseUid: identity.identity.uid,
      requirement,
      key: document.key,
      filename: document.filename,
      contentType: document.contentType,
      bytes: document.bytes,
      sha256: document.sha256,
      uploadedAt: document.uploadedAt,
    },
  });
  const auditWarning = audit.status !== 201 ? sidecarError(audit.data, "The document uploaded, but its procurement audit receipt could not be recorded.") : undefined;

  let metaAssist: Awaited<ReturnType<typeof reviewBidDocumentWithMeta>> | undefined;
  let metaAssistError: string | undefined;
  const requestedAssist = form?.get("metaAssist") === "true";
  if (requestedAssist) {
    if (!metaBidDocumentAssistAvailable()) {
      metaAssistError = "Muse Spark review is not enabled for this workspace; the file is safely uploaded for the procurement team.";
    } else {
      try {
        metaAssist = await reviewBidDocumentWithMeta({
          bytes,
          filename: safeSupplierFilename(rawFile.name),
          contentType: fileType.contentType,
          requirement,
          firebaseUid: identity.identity.uid,
        });
      } catch (error) {
        metaAssistError = error instanceof Error ? error.message : "Muse Spark could not review this document. The upload is still complete.";
      }
    }
  }

  return NextResponse.json({ document, auditRecorded: audit.status === 201, auditWarning, metaAssist, metaAssistError }, { status: 201, headers: { "cache-control": "no-store" } });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const org = getOrgFromToken(req.cookies.get(ORG_SESSION_COOKIE)?.value);
  if (!org) return NextResponse.json({ error: "Sign in as an organization to remove a bid document." }, { status: 401 });
  const { ref } = await params;
  if (!safeTenderRef(ref)) return NextResponse.json({ error: "The tender reference is not valid." }, { status: 422 });
  if (!rateLimit(clientKey(req, "org-bid-doc-delete"), 40, 15 * 60_000)) {
    return NextResponse.json({ error: "Too many document changes. Wait a few minutes and try again." }, { status: 429 });
  }
  const identity = await verifiedSupplierFirebaseIdentity(req.headers.get("authorization"), org);
  if (!identity.ok) return NextResponse.json({ error: identity.error }, { status: identity.status });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const key = typeof body?.key === "string" ? body.key : "";
  const prefix = `tenders/${ref}/supplier-bids/${org.id}/${identity.identity.uid}/`;
  if (!key.startsWith(prefix) || key.length > 512 || /[\\\u0000-\u001f]/.test(key)) {
    return NextResponse.json({ error: "This document does not belong to the signed-in supplier and tender." }, { status: 403 });
  }

  let object;
  try {
    object = await getSupplierBidObjectHead(key);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Cloudflare R2 could not verify the document." }, { status: 503 });
  }
  if (!object) return NextResponse.json({ error: "This bid document is no longer in Cloudflare R2." }, { status: 404 });
  const meta = object.customMetadata;
  const requirements = await publishedTenderRequirements(ref);
  if (!requirements.ok) return NextResponse.json({ error: requirements.error }, { status: requirements.status });
  const requirement = requirements.requiredDocuments.find((label) => label === meta.requirement);
  if (
    meta.organizationid !== org.id || meta.firebaseuid !== identity.identity.uid || meta.tenderref !== ref ||
    !requirement || meta.contenttype !== object.contentType || !/^[a-f0-9]{64}$/i.test(meta.sha256 ?? "")
  ) return NextResponse.json({ error: "The document ownership metadata could not be verified." }, { status: 403 });

  const records = await sidecarFetch(`/api/applications?orgId=${encodeURIComponent(org.id)}&tenderId=${encodeURIComponent(ref)}`);
  if (records.status !== 200) return NextResponse.json({ error: sidecarError(records.data, "The application record could not be checked before deleting this file.") }, { status: 503 });
  const applications = Array.isArray(records.data.applications) ? records.data.applications as Record<string, unknown>[] : [];
  const alreadyFiled = applications.some((application) => Array.isArray(application.bidDocuments) && application.bidDocuments.some((document) => Boolean(document) && typeof document === "object" && (document as Record<string, unknown>).key === key));
  if (alreadyFiled) return NextResponse.json({ error: "A document attached to a filed application cannot be removed." }, { status: 409 });

  try {
    await deleteSupplierBidObject(key);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Cloudflare R2 could not remove the document." }, { status: 503 });
  }
  const audit = await sidecarFetch("/api/supplier-bid-document-deletions", {
    method: "POST",
    actor: orgActor(org),
    body: { tenderRef: ref, organizationId: org.id, firebaseUid: identity.identity.uid, requirement, key, sha256: meta.sha256 },
  });
  return NextResponse.json({ deleted: true, auditRecorded: audit.status === 201, auditWarning: audit.status === 201 ? undefined : sidecarError(audit.data, "The file was removed, but its audit receipt could not be recorded.") }, { headers: { "cache-control": "no-store" } });
}
