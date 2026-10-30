/**
 * Tender document storage — browser side.
 *
 * The bytes go to our own Next route, never to Cloudflare directly: the
 * server holds `QUORUM_EDGE_SECRET` and forwards the file to the quorum-edge
 * Worker's `/__edge/upload` gate. A null result is not an exception: the
 * caller keeps the file in the local vault and says so, exactly like the old
 * Firebase mirror. The object key returned by the route is the durable
 * citation for the stored document.
 */

export interface TenderStorageResult {
  /** R2 object key, e.g. tenders/KE-MOH-2026-117/…-notice.pdf */
  key: string;
  bytes: number;
  contentType: string;
  /** Where the bytes are held: the edge bucket, or this deployment's own store. */
  storage?: "local" | "r2";
  /** Text was extracted and staged into the sidecar's tender directory. */
  staged: boolean;
  extracted: boolean;
  kind?: "notice" | "bid";
  pages?: number;
  sheets?: string[];
  chars?: number;
  note?: string;
  reason?: string;
  /** The upload was appended to the sidecar's hash-chained audit trail. */
  audited: boolean;
  audit?: { seq: number; id: string; self: string };
  auditReason?: string;
}

export interface StoredTenderDocument {
  /** R2 object key, e.g. tenders/KE-MOH-2026-117/…-notice.pdf */
  key: string;
  filename: string;
  bytes: number;
  contentType: string;
  uploaded?: string;
  etag?: string;
}

/**
 * List every R2 object stored under a tender's prefix. The route requires a
 * session with `read_documents`; it returns facts only, never a download URL,
 * so a stale page cannot keep a link alive beyond five minutes.
 */
export async function listStoredTenderDocuments(tenderRef: string): Promise<
  | { objects: StoredTenderDocument[]; totalBytes: number; truncated: boolean }
  | { error: string }
> {
  try {
    const res = await fetch(`/api/tenders/${encodeURIComponent(tenderRef)}/docs`, {
      cache: "no-store",
    });
    const data = (await res.json().catch(() => null)) as
      | { objects?: unknown; totalBytes?: unknown; truncated?: unknown; error?: unknown }
      | null;
    if (!res.ok) {
      return {
        error:
          typeof data?.error === "string" && data.error
            ? data.error
            : "Stored tender documents could not be listed.",
      };
    }
    const objects = (Array.isArray(data?.objects) ? data.objects : [])
      .filter((raw): raw is Record<string, unknown> => Boolean(raw) && typeof raw === "object")
      .map((raw) => raw as {
        key?: unknown;
        filename?: unknown;
        bytes?: unknown;
        contentType?: unknown;
        uploaded?: unknown;
        etag?: unknown;
      })
      .filter(
        (raw): raw is { key: string; filename: string; bytes: number } & Record<string, unknown> =>
          typeof raw.key === "string" &&
          raw.key.length > 0 &&
          typeof raw.filename === "string" &&
          typeof raw.bytes === "number" &&
          Number.isFinite(raw.bytes),
      )
      .map((raw) => ({
        key: raw.key,
        filename: raw.filename,
        bytes: raw.bytes,
        contentType:
          typeof raw.contentType === "string" ? raw.contentType : "application/octet-stream",
        uploaded: typeof raw.uploaded === "string" ? raw.uploaded : undefined,
        etag: typeof raw.etag === "string" ? raw.etag : undefined,
      }));
    return {
      objects,
      totalBytes:
        typeof data?.totalBytes === "number" && Number.isFinite(data.totalBytes)
          ? data.totalBytes
          : objects.reduce((sum, object) => sum + object.bytes, 0),
      truncated: data?.truncated === true,
    };
  } catch {
    return { error: "Stored tender documents could not be reached." };
  }
}

/**
 * Ask the authenticated link route for a short-lived signed download URL.
 * The URL is bound to this session's user id and a five-minute expiry; the
 * browser never receives the R2 secret. Null means the link could not be
 * minted (signed out, wrong role, expired config) — the caller says so.
 */
export async function signedTenderDownloadUrl(
  tenderRef: string,
  key: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `/api/tenders/${encodeURIComponent(tenderRef)}/docs/link?key=${encodeURIComponent(key)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { url?: unknown } | null;
    return typeof data?.url === "string" && data.url ? data.url : null;
  } catch {
    return null;
  }
}

/**
 * Remove one stored object. The route requires an operator role, deletes
 * through the edge gate and appends the removal to the audit trail; a failed
 * append is reported but the object is still gone.
 */
export async function deleteStoredTenderDocument(
  tenderRef: string,
  key: string,
): Promise<
  | { ok: true; audited: boolean; audit?: { seq: number; id: string; self: string }; auditReason?: string }
  | { error: string }
> {
  try {
    const res = await fetch(
      `/api/tenders/${encodeURIComponent(tenderRef)}/docs?key=${encodeURIComponent(key)}`,
      { method: "DELETE", cache: "no-store" },
    );
    const data = (await res.json().catch(() => null)) as
      | {
          audited?: unknown;
          audit?: { seq?: unknown; id?: unknown; self?: unknown };
          auditReason?: unknown;
          error?: unknown;
        }
      | null;
    if (!res.ok) {
      return {
        error:
          typeof data?.error === "string" && data.error
            ? data.error
            : "The stored document could not be removed.",
      };
    }
    const audit =
      data?.audit &&
      typeof data.audit === "object" &&
      typeof data.audit.seq === "number" &&
      typeof data.audit.id === "string" &&
      typeof data.audit.self === "string"
        ? { seq: data.audit.seq, id: data.audit.id, self: data.audit.self }
        : undefined;
    return {
      ok: true,
      audited: data?.audited === true,
      audit,
      auditReason:
        typeof data?.auditReason === "string" && data.auditReason
          ? data.auditReason
          : undefined,
    };
  } catch {
    return { error: "The stored document could not be reached." };
  }
}

export async function uploadTenderDocument(
  tenderRef: string,
  file: File,
): Promise<TenderStorageResult | null> {
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/tenders/${encodeURIComponent(tenderRef)}/docs`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as Partial<TenderStorageResult> | null;
    if (!data || typeof data.key !== "string" || !data.key) return null;
    return {
      key: data.key,
      bytes: typeof data.bytes === "number" ? data.bytes : file.size,
      contentType: typeof data.contentType === "string" ? data.contentType : file.type,
      storage: data.storage === "local" || data.storage === "r2" ? data.storage : undefined,
      extracted: data.extracted === true,
      staged: data.staged === true,
      kind: data.kind === "notice" || data.kind === "bid" ? data.kind : undefined,
      pages: typeof data.pages === "number" ? data.pages : undefined,
      sheets: Array.isArray(data.sheets) ? data.sheets.filter((s): s is string => typeof s === "string") : undefined,
      chars: typeof data.chars === "number" ? data.chars : undefined,
      note: typeof data.note === "string" ? data.note : undefined,
      reason: typeof data.reason === "string" ? data.reason : undefined,
      audited: data.audited === true,
      audit:
        data.audit &&
        typeof data.audit === "object" &&
        typeof data.audit.seq === "number" &&
        typeof data.audit.id === "string" &&
        typeof data.audit.self === "string"
          ? { seq: data.audit.seq, id: data.audit.id, self: data.audit.self }
          : undefined,
      auditReason: typeof data.auditReason === "string" ? data.auditReason : undefined,
    };
  } catch {
    return null;
  }
}
