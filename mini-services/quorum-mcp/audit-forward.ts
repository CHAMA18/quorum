/**
 * The unified audit spine — web-side events land in THIS chain.
 *
 * The web app owns minutes, suppliers, sittings, flags and users. Until now
 * those mutations lived only in the web store: a gate decision could be
 * verified line-by-line, but the minutes approval that followed it could not
 * be resolved against the same chain. This endpoint closes that gap.
 *
 * Rules, in order:
 *  1. The append is ATTESTED — the same HMAC the gateway puts on every
 *     mutation. An unattested or mismatched call never touches the chain.
 *  2. The event is IDEMPOTENT — an outbox retry replays the same
 *     idempotency key and receives the original log line, never a second
 *     one. Keys persist in the state snapshot, so a restart cannot reopen
 *     a key for a rewrite.
 *  3. High-risk events FAIL CLOSED — if the durable append is failing, the
 *     act is refused with 503 and the web outbox keeps holding the event.
 *     Low-risk events stay queued for retry the same way; they differ only
 *     in that the source act does not wait on them.
 *  4. The event is appended as an ordinary hash-chained line — never a
 *     parallel structure — with the chain's tamper-evidence it inherits for
 *     free.
 */

import { appendLog, auditHealth, state } from "./store";

export interface WebAuditEvent {
  /* The outbox's replay key — one act, one chain line, across restarts. */
  idempotencyKey: string;
  /* A stable, uppercase event type from the event catalogue. */
  type: string;
  /* Who the web attested: the signed-in officer behind the mutation. */
  actorId?: string;
  actor?: string;
  /* The workspace the gateway verified the session against. */
  workspaceId?: string;
  targetType: string;
  targetId: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  at?: string;
}

/* Acts whose source waits on the durable append. If the spine is not
   writable, the source act is refused rather than performed unchained. */
export const HIGH_RISK_WEB_EVENTS = [
  "MINUTES_APPROVED",
  "CONTRACT_EXECUTED",
  "PAYMENT_CERTIFIED",
  "GATE_DECIDED",
  "SUPPLIER_SUSPENDED",
  "FEATURE_FLAG_CHANGED",
  "CONNECTOR_SET",
] as const satisfies readonly string[];

const TYPE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

function normalizeEvent(raw: unknown): { event: WebAuditEvent } | { error: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const key = str(r.idempotencyKey, 200);
  if (!key) return { error: "idempotencyKey is required — every forwarded event carries the outbox's replay key." };
  const type = str(r.type, 64);
  if (!TYPE_RE.test(type)) {
    return { error: 'type must be an uppercase catalogue type like "MINUTES_APPROVED".' };
  }
  const targetType = str(r.targetType, 64).toUpperCase();
  if (!targetType) return { error: "targetType is required." };
  const targetId = str(r.targetId, 200);
  if (!targetId) return { error: "targetId is required." };
  const at = typeof r.at === "string" && !Number.isNaN(new Date(r.at).getTime()) ? r.at : new Date().toISOString();
  return {
    event: {
      idempotencyKey: key,
      type,
      ...(str(r.actorId, 120) ? { actorId: str(r.actorId, 120) } : {}),
      ...(str(r.actor, 160) ? { actor: str(r.actor, 160) } : {}),
      ...(str(r.workspaceId, 160) ? { workspaceId: str(r.workspaceId, 160) } : {}),
      targetType,
      targetId,
      ...(str(r.reason, 400) ? { reason: str(r.reason, 400) } : {}),
      ...(r.before !== undefined ? { before: r.before } : {}),
      ...(r.after !== undefined ? { after: r.after } : {}),
      at,
    },
  };
}

export interface ForwardVerdict {
  ok: boolean;
  code: number;
  error?: string;
  logId?: string;
  duplicate?: boolean;
  highRisk?: boolean;
}

/**
 * Append one attested web event to the chain. Returns the refusal the HTTP
 * route must surface, or the log line's id. The caller has already verified
 * the attestation; `attestedActor` is the identity the seal covers and
 * `attestedWorkspace` the workspace the seal was made for.
 */
export function forwardWebEvent(
  raw: unknown,
  attestedActor: string,
  attestedWorkspace: string,
): ForwardVerdict {
  const verdict = normalizeEvent(raw);
  if ("error" in verdict) return { ok: false, code: 422, error: verdict.error };
  const event = verdict.event;

  /* Tenant scoping: an event claimed for a workspace the informed envelope
     does not name is refused — cross-tenant forwards stay out of the chain. */
  const workspace = event.workspaceId ?? attestedWorkspace;
  if (workspace !== attestedWorkspace) {
    return {
      ok: false,
      code: 403,
      error: `The event names workspace "${workspace}" but the attested envelope covers "${attestedWorkspace}" — a forward cannot cross tenants.`,
    };
  }

  /* Idempotent replay: the key persists in the state snapshot, so a restart
     cannot turn a retry into a second chain line. */
  if (state.forwardedKeys.includes(event.idempotencyKey)) {
    return { ok: true, code: 200, duplicate: true };
  }

  const highRisk = (HIGH_RISK_WEB_EVENTS as readonly string[]).includes(event.type);
  /* Health is read BEFORE the append too: a previous failed durable write is
     a live outage even if this attempt happens to hit a second (healthy)
     file handle. Fail closed on either signal. */
  const durableFailing = auditHealth.logWriteFailing;
  const actor = event.actor ?? attestedActor ?? "web-app";
  const logged = appendLog({
    actor,
    server: "web-app",
    tool: `web:${event.type}`,
    kind: "WRITES",
    inputs: {
      key: event.idempotencyKey,
      type: event.type,
      targetType: event.targetType,
      targetId: event.targetId,
      ...(event.actorId ? { actorId: event.actorId } : {}),
      ...(event.reason ? { reason: event.reason } : {}),
    },
    outputs: {
      ...(event.before !== undefined ? { before: event.before } : {}),
      ...(event.after !== undefined ? { after: event.after } : {}),
      at: event.at,
    },
    status: "OK",
    durationMs: 0,
  });

  /* The key is recorded only after the append attempt; the order matters for
     the fail-closed path below. */
  state.forwardedKeys.push(event.idempotencyKey);

  if (highRisk && (durableFailing || auditHealth.logWriteFailing)) {
    /* The line exists in memory but the durable write failed. The key comes
       back, so a retry is not swallowed as a false success; the memory-only
       line stays (it is an honest record) and the duplication is bounded to
       the outage the log-write failure already announces loudly. */
    state.forwardedKeys.pop();
    return {
      ok: false,
      code: 503,
      error: "The audit spine is not durably writable — forward queued for retry; the source act stays unexecuted while this is high-risk.",
      highRisk,
    };
  }
  return { ok: true, code: 200, logId: logged.id, highRisk };
}
