import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signed, expiring access to stored tender documents.
 *
 * Issuing a link requires a signed-in session and `read_documents`. The link
 * is bound to the tender reference, the exact R2 object key, its expiry and
 * the requesting user id, then signed with HMAC-SHA256. The download route
 * re-checks the session AND the signature, so a copied link is useless to
 * another account and a tampered key cannot reach a different object.
 *
 * `QUORUM_DOWNLOAD_SECRET` keeps this key separate from the gateway seal;
 * without it, GATE_SECRET is used. The development default is refused in a
 * production process, exactly like the attestation secret.
 */

export const SIGNED_DOWNLOAD_TTL_MS = 5 * 60 * 1000;
/* A verifier accepts at most the issued lifetime plus one minute of clock skew. */
export const MAX_SIGNED_DOWNLOAD_TTL_MS = SIGNED_DOWNLOAD_TTL_MS + 60 * 1000;

const DEV_DOWNLOAD_SECRET = "quorum-dev-download-secret";
const REF = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

function downloadSecret(): string {
  const explicit = process.env.QUORUM_DOWNLOAD_SECRET?.trim();
  const secret = explicit || process.env.GATE_SECRET?.trim() || DEV_DOWNLOAD_SECRET;
  if (process.env.NODE_ENV === "production" && secret === DEV_DOWNLOAD_SECRET) {
    throw new Error(
      "QUORUM_DOWNLOAD_SECRET (or GATE_SECRET) must be set to a real secret in production — refusing to sign a download link.",
    );
  }
  return secret;
}

export function isSafeTenderRef(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 80 && REF.test(value);
}

/** The key must live directly under the tender's own prefix, with no traversal. */
export function isTenderKeyFor(ref: string, key: unknown): key is string {
  if (!isSafeTenderRef(ref) || typeof key !== "string") return false;
  if (key.length === 0 || key.length > 512) return false;
  if (/[\\\u0000-\u001f]/.test(key)) return false;
  const parts = key.split("/");
  return (
    parts.length >= 3 &&
    parts[0] === "tenders" &&
    parts[1] === ref &&
    parts.every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

function canonical(ref: string, key: string, expiresAt: number, userId: string): string {
  return `${ref}\n${key}\n${expiresAt}\n${userId}`;
}

export function signTenderDownload(
  ref: string,
  key: string,
  expiresAt: number,
  userId: string,
): string {
  return createHmac("sha256", downloadSecret())
    .update(canonical(ref, key, expiresAt, userId))
    .digest("hex");
}

export type DownloadVerdict =
  | { ok: true }
  | { ok: false; status: 403 | 410; reason: string };

export function verifyTenderDownload(input: {
  ref: string;
  key: string;
  expiresAt: number;
  userId: string;
  signature: string;
  now?: number;
}): DownloadVerdict {
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= 0) {
    return { ok: false, status: 403, reason: "The download link is not valid." };
  }
  if (input.expiresAt <= now) {
    return { ok: false, status: 410, reason: "This download link has expired. Request a fresh link." };
  }
  if (input.expiresAt - now > MAX_SIGNED_DOWNLOAD_TTL_MS) {
    return { ok: false, status: 403, reason: "The download link's lifetime is longer than this service allows." };
  }
  const expected = signTenderDownload(input.ref, input.key, input.expiresAt, input.userId);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(input.signature, "hex");
  if (a.length !== b.length || a.length === 0 || !timingSafeEqual(a, b)) {
    return { ok: false, status: 403, reason: "The download link's signature is not valid." };
  }
  return { ok: true };
}

/** A human-readable attachment name derived from the object key. */
export function tenderDownloadFilename(key: string): string {
  const base = key.split("/").pop() ?? "";
  const name = base
    .replace(/^\d{10,16}-/, "")
    .replace(/[\u0000-\u001f\u007f"\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return name || "tender-document";
}
