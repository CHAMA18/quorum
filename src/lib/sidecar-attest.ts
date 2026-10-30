import { createHmac } from "crypto";
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
