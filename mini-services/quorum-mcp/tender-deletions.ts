import { appendLog, type LogEntry } from "./store";

/**
 * Record an operator's removal of a stored tender object in the hash-chained
 * audit spine. The web route calls this only after the session, the operator
 * capability and the edge gate have all passed. `actor` is the attested
 * identity — never a body field. A failed append never resurrects the object
 * or blocks the response; the route reports the audit outcome separately.
 */

export type TenderDeletionResult =
  | { status: 201; entry: LogEntry }
  | { status: 422; error: string };

export function recordTenderDeletion(
  body: Record<string, unknown>,
  actor: string,
): TenderDeletionResult {
  const tenderId = String(body.tenderId ?? "").trim();
  const key = String(body.key ?? "").trim();
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
  const userId = String(body.userId ?? "").trim();
  if (!userId) return { status: 422, error: "userId is required" };

  const entry = appendLog({
    actor: actor || "web-app",
    server: "quorum-mcp",
    tool: "tender_delete",
    kind: "WRITES",
    inputs: {
      tenderId,
      key,
      filename: String(body.filename ?? "").trim().slice(0, 200),
      userId: userId.slice(0, 80),
      role: String(body.role ?? "").trim().slice(0, 40),
    },
    outputs: { deleted: true },
    status: "OK",
    durationMs: Math.max(0, Math.min(600_000, Number(body.durationMs) || 0)),
  });
  return { status: 201, entry };
}
