import { createHash, createHmac, timingSafeEqual } from "crypto";
import { secretFor } from "@/lib/secrets";

/**
 * Step-up tokens — the second signature on an irreversible act.
 *
 * A session proves who is at the desk. A step-up token proves that the person
 * holding that session re-authenticated *for this gate*, moments ago, with a
 * password or an authenticator code. The sidecar verifies the token itself so
 * the guarantee survives even when Caddy sends a request straight to :3031.
 *
 * The payload is deliberately small and bound to the exact gate:
 *   sub      signed-in user id (web side)
 *   name     signed-in user name (sidecar must match its attested actor)
 *   gateId   the gate being signed
 *   docHash  sha-256 of the gate's sealed inputs
 *   jti      single-use id, consumed by the sidecar
 *   exp      short-lived (2 minutes)
 */

export const STEP_UP_HEADER = "x-quorum-stepup";
export const STEP_UP_TTL_MS = 2 * 60_000;
export const DEV_STEP_UP_SECRET = "quorum-dev-attest-secret";

export interface StepUpPayload {
  v: 1;
  sub: string;
  name: string;
  gateId: string;
  docHash: string;
  jti: string;
  method: "password" | "totp";
  iat: number;
  exp: number;
}

export function stepUpSecret(): string {
  return secretFor("stepup");
}

/** The exact same canonicalisation the sidecar uses in store.shaOf(). */
export function gateDocHash(inputs: unknown): string {
  return createHash("sha256").update(JSON.stringify(inputs)).digest("hex").slice(0, 32);
}

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

export function signStepUpToken(payload: StepUpPayload): string {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", stepUpSecret()).update(body).digest("base64url");
  return `qsu1.${body}.${sig}`;
}

export function verifyStepUpToken(
  token: string | undefined,
  expected: { gateId?: string; docHash?: string; name?: string; now?: number },
): { ok: true; payload: StepUpPayload } | { ok: false; reason: string } {
  if (!token) return { ok: false, reason: "This gate needs a fresh step-up signature — re-authenticate to continue." };
  const [prefix, body, sig] = token.split(".");
  if (prefix !== "qsu1" || !body || !sig) return { ok: false, reason: "Malformed step-up token." };
  let payload: StepUpPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StepUpPayload;
  } catch {
    return { ok: false, reason: "Malformed step-up token payload." };
  }
  if (!payload || payload.v !== 1) return { ok: false, reason: "Unsupported step-up token version." };
  const expectedSig = createHmac("sha256", stepUpSecret()).update(body).digest("base64url");
  const a = Buffer.from(expectedSig);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "Step-up token signature is invalid." };
  }
  const now = expected.now ?? Date.now();
  if (!Number.isFinite(payload.exp) || payload.exp < now) return { ok: false, reason: "The step-up signature expired — re-authenticate." };
  if (!payload.iat || payload.iat > now + 60_000) return { ok: false, reason: "Step-up token timestamps are not valid." };
  if (expected.gateId && payload.gateId !== expected.gateId) return { ok: false, reason: "This step-up signature was issued for a different gate." };
  if (expected.docHash && payload.docHash !== expected.docHash) return { ok: false, reason: "The gate inputs changed after step-up — re-authenticate against the current bundle." };
  if (expected.name && payload.name.trim().toLowerCase() !== expected.name.trim().toLowerCase()) {
    return { ok: false, reason: "This step-up signature belongs to a different officer." };
  }
  return { ok: true, payload };
}
