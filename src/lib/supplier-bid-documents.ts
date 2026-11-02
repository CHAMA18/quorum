import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { bindOrganizationFirebaseUid, type OrganizationRow } from "@/lib/db";
import { verifyFirebaseIdToken, type VerifiedFirebaseIdentity } from "@/lib/firebase-identity";
import { sidecarFetch, sidecarError } from "@/lib/org-sidecar";
import {
  MAX_SUPPLIER_BID_FILE_BYTES,
  MAX_SUPPLIER_BID_FILES,
  MAX_SUPPLIER_BID_TOTAL_BYTES,
} from "@/lib/supplier-bid-document-limits";

export { MAX_SUPPLIER_BID_FILE_BYTES, MAX_SUPPLIER_BID_FILES, MAX_SUPPLIER_BID_TOTAL_BYTES };

const EXTENSION_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export type VerifiedBidDocument = {
  requirement: string;
  key: string;
  filename: string;
  bytes: number;
  contentType: string;
  sha256: string;
  firebaseUid: string;
  uploadedAt: string;
};

export type EdgeObjectHead = {
  key: string;
  size: number;
  contentType: string;
  customMetadata: Record<string, string>;
};

export type SupplierBidStorageUsage = {
  files: number;
  bytes: number;
  truncated: boolean;
};

export function requirementHash(label: string): string {
  return createHash("sha256").update(label.normalize("NFKC").trim().toLowerCase()).digest("hex").slice(0, 20);
}

function normalizedLabel(label: string): string {
  return label.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

export async function publishedTenderRequirements(tenderRef: string): Promise<
  | { ok: true; requiredDocuments: string[] }
  | { ok: false; status: number; error: string }
> {
  const { status, data } = await sidecarFetch("/api/marketplace");
  if (status !== 200) {
    return { ok: false, status, error: sidecarError(data, "The published tender requirements are not reachable.") };
  }
  const tenders = Array.isArray(data.tenders) ? data.tenders as Record<string, unknown>[] : [];
  const tender = tenders.find((row) => row.ref === tenderRef);
  if (!tender) return { ok: false, status: 404, error: "This tender is not available on the supplier portal." };
  const raw = Array.isArray(tender.requiredDocuments) ? tender.requiredDocuments : [];
  const requiredDocuments = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().replace(/\s+/g, " ").slice(0, 180))
    .filter(Boolean)
    .slice(0, MAX_SUPPLIER_BID_FILES);
  return { ok: true, requiredDocuments };
}

export async function verifiedSupplierFirebaseIdentity(
  authorization: string | null,
  org: OrganizationRow,
): Promise<{ ok: true; identity: VerifiedFirebaseIdentity } | { ok: false; status: 401 | 403; error: string }> {
  const token = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1]?.trim() ?? "";
  if (!token) {
    return { ok: false, status: 401, error: "Reconnect your Firebase account to upload bid documents." };
  }
  const identity = await verifyFirebaseIdToken(token);
  if (!identity || identity.email !== org.email.trim().toLowerCase()) {
    return { ok: false, status: 403, error: "The Firebase identity must use this organization's sign-in email." };
  }
  if (!bindOrganizationFirebaseUid(org.id, identity.uid)) {
    return { ok: false, status: 403, error: "This organization is already linked to a different Firebase identity." };
  }
  return { ok: true, identity };
}

export function supplierBidFileType(filename: string, bytes: Uint8Array): { contentType: string; extension: string } | null {
  const name = filename.split(/[\\/]/).pop() ?? "";
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
  const contentType = EXTENSION_TYPES[extension];
  if (!contentType) return null;
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const valid =
    (extension === ".pdf" && bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") ||
    (extension === ".png" && starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) ||
    ([".jpg", ".jpeg"].includes(extension) && starts(0xff, 0xd8, 0xff)) ||
    (extension === ".webp" && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") ||
    ([".docx", ".xlsx"].includes(extension) && starts(0x50, 0x4b, 0x03, 0x04));
  return valid ? { contentType, extension } : null;
}

export function safeSupplierFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "document";
  const cleaned = base.normalize("NFKD").replace(/[^\w. -]+/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 120);
  return cleaned || "document.pdf";
}

function edgeConfig(): { edge: string; secret: string } | null {
  const edge = process.env.QUORUM_EDGE_URL?.trim().replace(/\/+$/, "") ?? "";
  const secret = process.env.QUORUM_EDGE_SECRET?.trim() ?? "";
  return edge && secret ? { edge, secret } : null;
}

export async function putSupplierBidObject(args: {
  tenderRef: string;
  org: OrganizationRow;
  firebaseUid: string;
  requirement: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<VerifiedBidDocument> {
  const edgeConfigValue = edgeConfig();
  if (!edgeConfigValue) throw new Error("Cloudflare R2 storage is not configured for supplier documents.");
  const uploadedAt = new Date().toISOString();
  const filename = safeSupplierFilename(args.filename);
  const sha256 = createHash("sha256").update(args.bytes).digest("hex");
  const reqHash = requirementHash(args.requirement);
  const key = `tenders/${args.tenderRef}/supplier-bids/${args.org.id}/${args.firebaseUid}/${reqHash}/${Date.now()}-${randomUUID()}-${filename}`;
  const metadata = {
    organizationid: args.org.id,
    firebaseuid: args.firebaseUid,
    tenderref: args.tenderRef,
    requirementhash: reqHash,
    requirement: args.requirement.slice(0, 180),
    filename,
    sha256,
    uploadedat: uploadedAt,
    contenttype: args.contentType,
  };
  let response: Response;
  try {
    response = await fetch(`${edgeConfigValue.edge}/__edge/upload?key=${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: {
        "x-quorum-edge-key": edgeConfigValue.secret,
        "x-quorum-object-meta": JSON.stringify(metadata),
        "content-type": args.contentType,
      },
      body: new Uint8Array(args.bytes),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("Cloudflare R2 could not be reached. The document has not been uploaded.");
  }
  if (!response.ok) {
    throw new Error(response.status === 503 ? "Cloudflare R2 is unavailable. The document has not been uploaded." : "Cloudflare R2 refused this document upload.");
  }
  return { requirement: args.requirement, key, filename, bytes: args.bytes.byteLength, contentType: args.contentType, sha256, firebaseUid: args.firebaseUid, uploadedAt };
}

export async function getSupplierBidObjectHead(key: string): Promise<EdgeObjectHead | null> {
  const config = edgeConfig();
  if (!config) throw new Error("Cloudflare R2 storage is not configured for supplier documents.");
  let response: Response;
  try {
    response = await fetch(`${config.edge}/__edge/head?key=${encodeURIComponent(key)}`, {
      headers: { "x-quorum-edge-key": config.secret },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Cloudflare R2 could not verify an uploaded document.");
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Cloudflare R2 could not verify an uploaded document.");
  const data = await response.json().catch(() => null) as { object?: Record<string, unknown> } | null;
  const object = data?.object;
  if (!object || typeof object.key !== "string" || typeof object.size !== "number" || typeof object.contentType !== "string") return null;
  const metadata = object.customMetadata && typeof object.customMetadata === "object" && !Array.isArray(object.customMetadata)
    ? Object.fromEntries(Object.entries(object.customMetadata as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {};
  return { key: object.key, size: object.size, contentType: object.contentType, customMetadata: metadata };
}

/** Read the authenticated supplier's existing R2 usage before accepting an upload. */
export async function getSupplierBidStorageUsage(args: {
  tenderRef: string;
  org: OrganizationRow;
  firebaseUid: string;
}): Promise<SupplierBidStorageUsage> {
  const config = edgeConfig();
  if (!config) throw new Error("Cloudflare R2 storage is not configured for supplier documents.");
  const prefix = `tenders/${args.tenderRef}/supplier-bids/${args.org.id}/${args.firebaseUid}/`;
  const query = new URLSearchParams({ prefix, limit: String(MAX_SUPPLIER_BID_FILES + 1) });
  let response: Response;
  try {
    response = await fetch(`${config.edge}/__edge/list?${query.toString()}`, {
      headers: { "x-quorum-edge-key": config.secret },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Cloudflare R2 could not check this organization's current upload limits.");
  }
  if (!response.ok) throw new Error("Cloudflare R2 could not check this organization's current upload limits.");
  const data = await response.json().catch(() => null) as { objects?: unknown; truncated?: unknown } | null;
  const objects = Array.isArray(data?.objects) ? data.objects as Record<string, unknown>[] : [];
  const ownedObjects = objects.filter((object) => typeof object.key === "string" && object.key.startsWith(prefix));
  return {
    files: ownedObjects.length,
    bytes: ownedObjects.reduce((total, object) => total + (typeof object.size === "number" && Number.isFinite(object.size) ? Math.max(0, object.size) : 0), 0),
    truncated: data?.truncated === true,
  };
}

export async function deleteSupplierBidObject(key: string): Promise<void> {
  const config = edgeConfig();
  if (!config) throw new Error("Cloudflare R2 storage is not configured for supplier documents.");
  let response: Response;
  try {
    response = await fetch(`${config.edge}/__edge/delete?key=${encodeURIComponent(key)}`, {
      method: "DELETE",
      headers: { "x-quorum-edge-key": config.secret },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Cloudflare R2 could not remove this bid document.");
  }
  if (!response.ok) throw new Error("Cloudflare R2 refused to remove this bid document.");
}

export async function listSupplierBidObjects(args: {
  tenderRef: string;
  org: OrganizationRow;
  firebaseUid: string;
  requiredDocuments: string[];
}): Promise<VerifiedBidDocument[]> {
  const config = edgeConfig();
  if (!config) throw new Error("Cloudflare R2 storage is not configured for supplier documents.");
  const prefix = `tenders/${args.tenderRef}/supplier-bids/${args.org.id}/${args.firebaseUid}/`;
  const query = new URLSearchParams({ prefix, limit: String(MAX_SUPPLIER_BID_FILES) });
  let response: Response;
  try {
    response = await fetch(`${config.edge}/__edge/list?${query.toString()}`, {
      headers: { "x-quorum-edge-key": config.secret },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Cloudflare R2 could not list this organization's bid documents.");
  }
  if (!response.ok) throw new Error("Cloudflare R2 could not list this organization's bid documents.");
  const data = await response.json().catch(() => null) as { objects?: unknown } | null;
  const listed = Array.isArray(data?.objects) ? data.objects as Record<string, unknown>[] : [];
  const requirementByHash = new Map(args.requiredDocuments.map((label) => [requirementHash(label), label]));
  const output: VerifiedBidDocument[] = [];
  for (let offset = 0; offset < listed.length; offset += 8) {
    const rows = listed.slice(offset, offset + 8);
    const heads = await Promise.all(rows.map((row) => typeof row.key === "string" ? getSupplierBidObjectHead(row.key) : null));
    for (const head of heads) {
      if (!head || !head.key.startsWith(prefix)) continue;
      const meta = head.customMetadata;
      const requirement = typeof meta.requirement === "string" ? meta.requirement : "";
      if (
        !requirementByHash.has(requirementHash(requirement)) ||
        meta.organizationid !== args.org.id ||
        meta.firebaseuid !== args.firebaseUid ||
        meta.tenderref !== args.tenderRef ||
        meta.requirementhash !== requirementHash(requirement) ||
        meta.contenttype !== head.contentType ||
        !/^[a-f0-9]{64}$/i.test(meta.sha256 ?? "") ||
        !meta.filename ||
        !meta.uploadedat ||
        Number.isNaN(Date.parse(meta.uploadedat))
      ) continue;
      output.push({
        requirement: requirementByHash.get(requirementHash(requirement))!,
        key: head.key,
        filename: meta.filename.slice(0, 120),
        bytes: head.size,
        contentType: head.contentType,
        sha256: meta.sha256.toLowerCase(),
        firebaseUid: args.firebaseUid,
        uploadedAt: meta.uploadedat,
      });
    }
  }
  return output.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
}

export async function verifySubmittedSupplierBidDocuments(args: {
  tenderRef: string;
  org: OrganizationRow;
  firebaseUid: string;
  requiredDocuments: string[];
  rawDocuments: unknown;
}): Promise<{ ok: true; documents: VerifiedBidDocument[] } | { ok: false; status: number; error: string }> {
  const docs = Array.isArray(args.rawDocuments) ? args.rawDocuments : [];
  if (docs.length > MAX_SUPPLIER_BID_FILES) return { ok: false, status: 422, error: "This bid has too many attached documents." };
  const required = new Map(args.requiredDocuments.map((label) => [normalizedLabel(label), label]));
  const canonical: { requirement: string; key: string }[] = [];
  const seenKeys = new Set<string>();
  for (const raw of docs) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, status: 422, error: "One of the attached documents is not valid." };
    const item = raw as Record<string, unknown>;
    const label = typeof item.requirement === "string" ? item.requirement.trim() : "";
    const requirement = required.get(normalizedLabel(label));
    const key = typeof item.key === "string" ? item.key : "";
    if (!requirement || !key || key.length > 512 || /[\\\u0000-\u001f]/.test(key)) {
      return { ok: false, status: 422, error: "An attached file does not match a published required document." };
    }
    if (seenKeys.has(key)) return { ok: false, status: 422, error: "A document cannot be attached more than once." };
    seenKeys.add(key);
    const prefix = `tenders/${args.tenderRef}/supplier-bids/${args.org.id}/${args.firebaseUid}/${requirementHash(requirement)}/`;
    if (!key.startsWith(prefix)) return { ok: false, status: 403, error: "A document is not owned by this supplier, Firebase identity and tender." };
    canonical.push({ requirement, key });
  }

  const attached = new Set(canonical.map((doc) => normalizedLabel(doc.requirement)));
  const missing = args.requiredDocuments.filter((label) => !attached.has(normalizedLabel(label)));
  if (missing.length) return { ok: false, status: 422, error: `Upload every required bid document before filing: ${missing.join(", ")}.` };
  if (docs.length === 0) return { ok: true, documents: [] };

  const verified: VerifiedBidDocument[] = [];
  for (let offset = 0; offset < canonical.length; offset += 8) {
    const batch = canonical.slice(offset, offset + 8);
    let heads: (EdgeObjectHead | null)[];
    try {
      heads = await Promise.all(batch.map((doc) => getSupplierBidObjectHead(doc.key)));
    } catch (error) {
      return { ok: false, status: 503, error: error instanceof Error ? error.message : "Cloudflare R2 is unavailable." };
    }
    for (let index = 0; index < batch.length; index++) {
      const doc = batch[index];
      const head = heads[index];
      if (!head || head.key !== doc.key || head.size <= 0 || head.size > MAX_SUPPLIER_BID_FILE_BYTES) {
        return { ok: false, status: 422, error: "A selected bid document is missing from Cloudflare R2 or exceeds the size limit." };
      }
      const meta = head.customMetadata;
      if (
        meta.organizationid !== args.org.id ||
        meta.firebaseuid !== args.firebaseUid ||
        meta.tenderref !== args.tenderRef ||
        meta.requirementhash !== requirementHash(doc.requirement) ||
        meta.requirement !== doc.requirement ||
        meta.contenttype !== head.contentType ||
        !/^[a-f0-9]{64}$/i.test(meta.sha256 ?? "") ||
        !meta.filename ||
        !meta.uploadedat ||
        Number.isNaN(Date.parse(meta.uploadedat))
      ) {
        return { ok: false, status: 403, error: "A bid document's Cloudflare ownership record could not be verified." };
      }
      verified.push({
        requirement: doc.requirement,
        key: doc.key,
        filename: meta.filename.slice(0, 120),
        bytes: head.size,
        contentType: head.contentType,
        sha256: meta.sha256.toLowerCase(),
        firebaseUid: args.firebaseUid,
        uploadedAt: meta.uploadedat,
      });
    }
  }
  const totalBytes = verified.reduce((sum, doc) => sum + doc.bytes, 0);
  if (totalBytes > MAX_SUPPLIER_BID_TOTAL_BYTES) return { ok: false, status: 413, error: "Bid attachments must total 100 MB or less." };
  return { ok: true, documents: verified };
}

/* ── Edge object primitives ──────────────────────────────────────────────────
   The gate below is shared by every supplier-held object, so callers that
   store outside a tender prefix (organization-level pre-uploads) use the same
   secret, timeout and URL shape as the bid uploads above. */

export function supplierEdgeConfig(): { edge: string; secret: string } | null {
  return edgeConfig();
}

export async function putEdgeObject(args: {
  key: string;
  contentType: string;
  bytes: Uint8Array;
  metadata: Record<string, string>;
}): Promise<void> {
  const config = edgeConfig();
  if (!config) throw new Error("Cloudflare R2 storage is not configured for supplier documents.");
  let response: Response;
  try {
    response = await fetch(`${config.edge}/__edge/upload?key=${encodeURIComponent(args.key)}`, {
      method: "PUT",
      headers: {
        "x-quorum-edge-key": config.secret,
        "x-quorum-object-meta": JSON.stringify(args.metadata),
        "content-type": args.contentType,
      },
      body: new Uint8Array(args.bytes),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("Cloudflare R2 could not be reached. The document has not been uploaded.");
  }
  if (!response.ok) {
    throw new Error(response.status === 503 ? "Cloudflare R2 is unavailable. The document has not been uploaded." : "Cloudflare R2 refused this document upload.");
  }
}

/**
 * Read one object's bytes through the edge gate.
 *
 * The size is checked against the caller's ceiling before the body is read, so
 * a mislabelled object cannot exhaust the route's memory; the body is measured
 * again afterwards because the edge may answer without a content-length.
 */
export async function readEdgeObject(key: string, maxBytes: number): Promise<Uint8Array> {
  const config = edgeConfig();
  if (!config) throw new Error("Cloudflare R2 storage is not configured for supplier documents.");
  let response: Response;
  try {
    response = await fetch(`${config.edge}/__edge/object?key=${encodeURIComponent(key)}`, {
      headers: { "x-quorum-edge-key": config.secret },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("Cloudflare R2 could not read this document.");
  }
  if (response.status === 404) throw new Error("This document is no longer in Cloudflare R2.");
  if (!response.ok) throw new Error("Cloudflare R2 could not read this document.");
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("This document is larger than the portal's reading limit.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error("This document is empty in Cloudflare R2.");
  if (bytes.byteLength > maxBytes) throw new Error("This document is larger than the portal's reading limit.");
  return bytes;
}

export async function listEdgeObjects(
  prefix: string,
  limit: number,
): Promise<{ objects: { key: string; size: number }[]; truncated: boolean }> {
  const config = edgeConfig();
  if (!config) throw new Error("Cloudflare R2 storage is not configured for supplier documents.");
  const query = new URLSearchParams({ prefix, limit: String(limit) });
  let response: Response;
  try {
    response = await fetch(`${config.edge}/__edge/list?${query.toString()}`, {
      headers: { "x-quorum-edge-key": config.secret },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Cloudflare R2 could not list this organization's documents.");
  }
  if (!response.ok) throw new Error("Cloudflare R2 could not list this organization's documents.");
  const data = await response.json().catch(() => null) as { objects?: unknown; truncated?: unknown } | null;
  const listed = Array.isArray(data?.objects) ? data.objects as Record<string, unknown>[] : [];
  return {
    objects: listed
      .filter((row): row is { key: string; size: number } =>
        typeof row.key === "string" && typeof row.size === "number" && Number.isFinite(row.size))
      .map((row) => ({ key: row.key, size: Math.max(0, row.size) })),
    truncated: data?.truncated === true,
  };
}
