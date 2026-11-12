/** Checklist ticks require evidence on record, not mere presence. Pure. */

export type DocumentTick = "verified" | "on-file" | "missing";

/** Verified = the upload carries a SHA-256 evidence fingerprint. */
export function documentTick(doc: { sha256?: string } | undefined | null): DocumentTick {
  if (!doc) return "missing";
  return (doc.sha256 ?? "").length >= 32 ? "verified" : "on-file";
}

export const TICK_LABEL: Record<DocumentTick, string> = {
  verified: "Evidence hashed",
  "on-file": "On file — no evidence hash",
  missing: "Missing",
};
