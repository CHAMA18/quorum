import { createHmac, timingSafeEqual } from "crypto";
import { secretFor } from "@/lib/secrets";

/**
 * Gateway attestation — the web layer vouches for WHO acts.
 *
 * The Next.js server owns the session (httpOnly cookie). When it forwards a
 * state-changing request to the quorum-mcp sidecar it signs the request with
 * an HMAC over (method, path, actor, ts); the sidecar refuses any mutation
 * that arrives without this seal. The approving identity therefore cannot be
 * typed by the caller — it is derived from the verified session.
 *
 * The formula MUST mirror store.ts (attestSignature / attestVerify) exactly.
 * GATE_SECRET overrides the shipped development default on real deployments.
 *
 * The secret resolves LAZILY, per signature, and then fails closed: the
 * guard lives at the first use, not module evaluation. A production build
 * (`next build`) imports this module with no runtime secrets in scope and
 * must still succeed — a request-time production process without a real
 * GATE_SECRET still refuses to sign.
 */
function attestSecret(): string {
  return secretFor("attest");
}

export function attestSignature(method: string, path: string, actor: string, ts: number, workspaceId = "demo"): string {
  return createHmac("sha256", attestSecret()).update(`${method}|${path}|${actor}|${workspaceId}|${ts}`).digest("hex");
}

/**
 * Verify a server-to-server read seal (the sidecar reading the committee roll).
 * Same formula and window as `store.ts` attestVerify, so there is one shared
 * secret and no second credential to rotate. This never authorises a mutation.
 */
export function verifyAttest(
  method: string,
  path: string,
  headers: Headers,
): { ok: true; actor: string } | { ok: false; reason: string } {
  const actor = headers.get("x-quorum-actor") ?? "";
  const ts = Number(headers.get("x-quorum-ts") ?? NaN);
  const sig = headers.get("x-quorum-attest") ?? "";
  const workspaceId = headers.get("x-quorum-workspace")?.trim() || "demo";
  if (!actor || !sig) return { ok: false, reason: "missing service seal" };
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60_000) {
    return { ok: false, reason: "service seal timestamp outside the window" };
  }
  const expected = Buffer.from(attestSignature(method, path, actor, ts, workspaceId));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "service seal mismatch" };
  }
  return { ok: true, actor };
}
