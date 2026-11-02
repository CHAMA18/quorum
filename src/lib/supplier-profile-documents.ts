import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { OrganizationRow } from "@/lib/db";
import { ALL_REQUIRED_DOCUMENTS } from "@/lib/required-bid-documents";
import {
  MAX_SUPPLIER_BID_FILE_BYTES,
  MAX_SUPPLIER_BID_FILES,
  MAX_SUPPLIER_BID_TOTAL_BYTES,
  deleteSupplierBidObject,
  getSupplierBidObjectHead,
  listEdgeObjects,
  putEdgeObject,
  readEdgeObject,
  requirementHash,
  safeSupplierFilename,
  supplierEdgeConfig,
  type EdgeObjectHead,
} from "@/lib/supplier-bid-documents";

/**
 * Organization-level bid documents ("pre-uploads").
 *
 * The tender flow stores files under a tender prefix and only accepts them for
 * that notice. Suppliers asked to keep one set of standing evidence ready, so
 * the same catalogue is also stored against the organization itself:
 *
 *   orgs/<orgId>/<firebaseUid>/profile-documents/<requirementHash>/<file>
 *
 * Same gate, same size limits and same metadata proof as tender uploads — only
 * the prefix and the missing `tenderref` differ. Nothing here is trusted from
 * the client: every listing and removal re-reads the R2 object head.
 */

export type SupplierProfileDocument = {
  requirement: string;
  key: string;
  filename: string;
  bytes: number;
  contentType: string;
  sha256: string;
  uploadedAt: string;
};

export { MAX_SUPPLIER_BID_FILE_BYTES, MAX_SUPPLIER_BID_FILES, MAX_SUPPLIER_BID_TOTAL_BYTES };

function normalizedLabel(label: string): string {
  return label.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** The published catalogue is the only set that may be pre-uploaded. */
export function canonicalProfileDocument(label: string): string | null {
  const wanted = normalizedLabel(label);
  return ALL_REQUIRED_DOCUMENTS.find((document) => normalizedLabel(document) === wanted) ?? null;
}

export function profileDocumentPrefix(orgId: string, firebaseUid: string): string {
  return `orgs/${orgId}/${firebaseUid}/profile-documents/`;
}

export function profileDocumentKey(args: {
  orgId: string;
  firebaseUid: string;
  requirement: string;
  filename: string;
}): string {
  const filename = safeSupplierFilename(args.filename);
  return `${profileDocumentPrefix(args.orgId, args.firebaseUid)}${requirementHash(args.requirement)}/${Date.now()}-${randomUUID()}-${filename}`;
}

export async function putSupplierProfileDocument(args: {
  org: OrganizationRow;
  firebaseUid: string;
  requirement: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<SupplierProfileDocument> {
  if (!supplierEdgeConfig()) throw new Error("Cloudflare R2 storage is not configured for supplier documents.");
  const uploadedAt = new Date().toISOString();
  const filename = safeSupplierFilename(args.filename);
  const sha256 = createHash("sha256").update(args.bytes).digest("hex");
  const key = profileDocumentKey({
    orgId: args.org.id,
    firebaseUid: args.firebaseUid,
    requirement: args.requirement,
    filename,
  });
  await putEdgeObject({
    key,
    contentType: args.contentType,
    bytes: args.bytes,
    metadata: {
      organizationid: args.org.id,
      firebaseuid: args.firebaseUid,
      scope: "profile",
      requirement: args.requirement.slice(0, 180),
      requirementhash: requirementHash(args.requirement),
      filename,
      sha256,
      uploadedat: uploadedAt,
      contenttype: args.contentType,
    },
  });

  /* A re-upload is a replacement: one file stands per catalogue item, so the
     previous object for this requirement is retired once the new one lands. */
  try {
    const requirementPrefix = `${profileDocumentPrefix(args.org.id, args.firebaseUid)}${requirementHash(args.requirement)}/`;
    const { objects } = await listEdgeObjects(requirementPrefix, MAX_SUPPLIER_BID_FILES);
    await Promise.all(
      objects
        .filter((object) => object.key !== key && object.key.startsWith(requirementPrefix))
        .map((object) => deleteSupplierBidObject(object.key).catch(() => undefined)),
    );
  } catch {
    /* The replacement is stored; an orphaned earlier file must not fail it. */
  }
  return {
    requirement: args.requirement,
    key,
    filename,
    bytes: args.bytes.byteLength,
    contentType: args.contentType,
    sha256,
    uploadedAt,
  };
}

export async function getSupplierProfileDocumentUsage(args: {
  orgId: string;
  firebaseUid: string;
}): Promise<{ files: number; bytes: number; truncated: boolean }> {
  const { objects, truncated } = await listEdgeObjects(
    profileDocumentPrefix(args.orgId, args.firebaseUid),
    MAX_SUPPLIER_BID_FILES + 1,
  );
  return {
    files: objects.length,
    bytes: objects.reduce((total, object) => total + object.size, 0),
    truncated,
  };
}

export async function listSupplierProfileDocuments(args: {
  org: OrganizationRow;
  firebaseUid: string;
}): Promise<SupplierProfileDocument[]> {
  const config = supplierEdgeConfig();
  if (!config) throw new Error("Cloudflare R2 storage is not configured for supplier documents.");
  const prefix = profileDocumentPrefix(args.org.id, args.firebaseUid);
  const { objects } = await listEdgeObjects(prefix, MAX_SUPPLIER_BID_FILES);
  const byHash = new Map(ALL_REQUIRED_DOCUMENTS.map((label) => [requirementHash(label), label]));
  const output: SupplierProfileDocument[] = [];
  for (let offset = 0; offset < objects.length; offset += 8) {
    const batch = objects.slice(offset, offset + 8);
    const heads = await Promise.all(
      batch.map((row) => (row.key.startsWith(prefix) ? getSupplierBidObjectHead(row.key) : null)),
    );
    for (const head of heads) {
      if (!head || !head.key.startsWith(prefix)) continue;
      const meta = head.customMetadata;
      const requirement = typeof meta.requirement === "string" ? meta.requirement : "";
      const canonical = requirement ? canonicalProfileDocument(requirement) : null;
      if (
        !canonical ||
        meta.organizationid !== args.org.id ||
        meta.firebaseuid !== args.firebaseUid ||
        meta.scope !== "profile" ||
        meta.requirementhash !== requirementHash(canonical) ||
        meta.contenttype !== head.contentType ||
        !/^[a-f0-9]{64}$/i.test(meta.sha256 ?? "") ||
        !meta.filename ||
        !meta.uploadedat ||
        Number.isNaN(Date.parse(meta.uploadedat))
      ) {
        continue;
      }
      output.push({
        requirement: byHash.get(requirementHash(canonical)) ?? canonical,
        key: head.key,
        filename: meta.filename.slice(0, 120),
        bytes: head.size,
        contentType: head.contentType,
        sha256: meta.sha256.toLowerCase(),
        uploadedAt: meta.uploadedat,
      });
    }
  }
  return output.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
}

type VerifiedProfileObject =
  | { ok: true; head: EdgeObjectHead; requirement: string }
  | { ok: false; status: 403 | 404; error: string };

/**
 * One gate for every read or removal: the key must sit under this
 * organization's own prefix, and R2's own custom metadata must still agree
 * with that prefix before a byte is served. Nothing is trusted from the client.
 */
async function verifiedProfileObject(args: {
  orgId: string;
  firebaseUid: string;
  key: string;
}): Promise<VerifiedProfileObject> {
  const prefix = profileDocumentPrefix(args.orgId, args.firebaseUid);
  if (!args.key.startsWith(prefix) || args.key.length > 512 || /[\\\u0000-\u001f]/.test(args.key)) {
    return { ok: false, status: 403, error: "This document does not belong to the signed-in supplier." };
  }
  let head;
  try {
    head = await getSupplierBidObjectHead(args.key);
  } catch (error) {
    return {
      ok: false,
      status: 403,
      error: error instanceof Error ? error.message : "Cloudflare R2 could not verify the document.",
    };
  }
  if (!head) return { ok: false, status: 404, error: "This document is no longer in Cloudflare R2." };
  const meta = head.customMetadata;
  const requirement = typeof meta.requirement === "string" ? canonicalProfileDocument(meta.requirement) : null;
  if (
    !requirement ||
    meta.organizationid !== args.orgId ||
    meta.firebaseuid !== args.firebaseUid ||
    meta.scope !== "profile" ||
    meta.contenttype !== head.contentType ||
    !/^[a-f0-9]{64}$/i.test(meta.sha256 ?? "")
  ) {
    return { ok: false, status: 403, error: "The document ownership metadata could not be verified." };
  }
  return { ok: true, head, requirement };
}

export async function deleteSupplierProfileDocument(args: {
  org: OrganizationRow;
  firebaseUid: string;
  key: string;
}): Promise<{ ok: true } | { ok: false; status: 403 | 404; error: string }> {
  const verified = await verifiedProfileObject({
    orgId: args.org.id,
    firebaseUid: args.firebaseUid,
    key: args.key,
  });
  if (!verified.ok) return verified;
  await deleteSupplierBidObject(args.key);
  return { ok: true };
}

/**
 * Read one stored document for preview, download or a model scan.
 *
 * The returned bytes are the ones the edge holds right now — never a cached
 * copy from the listing — so a preview can never show a document that has
 * since been replaced.
 */
export async function readSupplierProfileDocument(args: {
  org: OrganizationRow;
  firebaseUid: string;
  key: string;
}): Promise<
  | {
      ok: true;
      bytes: Uint8Array;
      contentType: string;
      filename: string;
      requirement: string;
      uploadedAt: string;
      sha256: string;
    }
  | { ok: false; status: 403 | 404 | 413 | 503; error: string }
> {
  const verified = await verifiedProfileObject({
    orgId: args.org.id,
    firebaseUid: args.firebaseUid,
    key: args.key,
  });
  if (!verified.ok) return verified;
  const { head, requirement } = verified;
  if (head.size <= 0 || head.size > MAX_SUPPLIER_BID_FILE_BYTES) {
    return { ok: false, status: 413, error: "This document is empty or larger than the 10 MB reading limit." };
  }
  let bytes: Uint8Array;
  try {
    bytes = await readEdgeObject(args.key, MAX_SUPPLIER_BID_FILE_BYTES);
  } catch (error) {
    return {
      ok: false,
      status: 503,
      error: error instanceof Error ? error.message : "Cloudflare R2 could not read this document.",
    };
  }
  return {
    ok: true,
    bytes,
    contentType: head.contentType,
    filename: head.customMetadata.filename.slice(0, 120),
    requirement,
    uploadedAt: head.customMetadata.uploadedat,
    sha256: head.customMetadata.sha256.toLowerCase(),
  };
}
