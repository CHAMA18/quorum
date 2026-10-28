import { appendLog, type LogEntry } from "./store";

/**
 * Record a signed tender-document download in the hash-chained audit spine.
 *
 * The web route calls this only after the session, the link's HMAC, its
 * expiry and the edge gate have all passed. A ranged request records the exact
 * slice that was served, so a resumed or paged read is distinguishable from a
 * full object. `actor` is the attested identity — never a body field.
 */

export type TenderDownloadResult =
  | { status: 201; entry: LogEntry }
  | { status: 422; error: string };

const MAX_BYTES = 10 * 1024 * 1024;

export function recordTenderDownload(
  body: Record<string, unknown>,
  actor: string,
): TenderDownloadResult {
  const tenderId = String(body.tenderId ?? "").trim();
  const key = String(body.key ?? "").trim();
  const bytes = Number(body.bytes);
  const parts = key.split("/");
  const safeKey =
    /^[A-Za-z0-9._-]+$/.test(tenderId) &&
    key.length > 0 &&
    key.length <= 512 &&
    !/[\\\u0000-\u001f]/.test(key) &&
    parts.length >= 3 &&
    parts[0] === "tenders" &&
    parts[1] === tenderId &&
    parts.every((part) => part.length > 0 && part !== "." && part !== "..");
  if (!safeKey) {
    return { status: 422, error: "key must live under tenders/<tenderId>/ with no traversal" };
  }
  if (!Number.isFinite(bytes) || bytes < 0 || bytes > MAX_BYTES) {
    return { status: 422, error: "bytes must be between 0 and 10485760" };
  }
  const expiresAt = Number(body.linkExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0 || expiresAt > 8.64e15) {
    return { status: 422, error: "linkExpiresAt must be a valid timestamp" };
  }
  const userId = String(body.userId ?? "").trim();
  if (!userId) return { status: 422, error: "userId is required" };

  const range = typeof body.range === "string" ? body.range.trim().slice(0, 120) : "";
  const contentRange =
    typeof body.contentRange === "string" ? body.contentRange.trim().slice(0, 80) : "";
  const entry = appendLog({
    actor: actor || "web-app",
    server: "quorum-mcp",
    tool: "tender_download",
    kind: "READ",
    inputs: {
      tenderId,
      key,
      filename: String(body.filename ?? "").trim().slice(0, 200),
      userId: userId.slice(0, 80),
      role: String(body.role ?? "").trim().slice(0, 40),
      linkExpiresAt: new Date(expiresAt).toISOString(),
      range: range || undefined,
    },
    outputs: {
      served: true,
      partial: body.partial === true,
      bytes,
      contentRange: contentRange || undefined,
    },
    status: "OK",
    durationMs: Math.max(0, Math.min(600_000, Number(body.durationMs) || 0)),
  });
  return { status: 201, entry };
}
