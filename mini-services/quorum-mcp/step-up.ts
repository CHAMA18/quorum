import { createHmac, timingSafeEqual } from "node:crypto";
import { gateSecret, saveState, shaOf, state } from "./store";

/**
 * Sidecar-side verification of the web app's step-up token.
 *
 * The gateway already vouches for the actor, but the actor seal only says
 * "this session is signed in". A gate needs a second, recent proof that the
 * human at the desk re-authenticated for *this* bundle. This module verifies
 * that proof without a callback to the web app, so a direct Caddy → :3031
 * request gets the same guarantee as the Next gateway.
 */

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

function secret(): string {
  return process.env.STEP_UP_SECRET?.trim() || gateSecret();
}

export function verifyStepUp(
  token: string | undefined,
  expected: { gateId: string; inputs: unknown; actor: string },
): { ok: true; payload: StepUpPayload } | { ok: false; reason: string } {
  if (!token) {
    return {
      ok: false,
      reason: "This gate requires a fresh step-up signature. Re-authenticate with your passphrase or authenticator and try again.",
    };
  }
  const [prefix, body, sig] = token.split(".");
  if (prefix !== "qsu1" || !body || !sig) return { ok: false, reason: "Malformed step-up token." };
  let payload: StepUpPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StepUpPayload;
  } catch {
    return { ok: false, reason: "Malformed step-up token payload." };
  }
  if (!payload || payload.v !== 1) return { ok: false, reason: "Unsupported step-up token version." };

  const expectedSig = createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(expectedSig);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "Step-up token signature is invalid." };
  }

  const now = Date.now();
  if (!Number.isFinite(payload.exp) || payload.exp < now) {
    return { ok: false, reason: "The step-up signature expired — re-authenticate." };
  }
  if (!payload.iat || payload.iat > now + 60_000) {
    return { ok: false, reason: "Step-up token timestamps are not valid." };
  }
  if (payload.gateId !== expected.gateId) {
    return { ok: false, reason: "This step-up signature was issued for a different gate." };
  }
  const docHash = shaOf(expected.inputs);
  if (payload.docHash !== docHash) {
    return { ok: false, reason: "The gate inputs changed after step-up — re-authenticate against the current bundle." };
  }
  if (!expected.actor || payload.name.trim().toLowerCase() !== expected.actor.trim().toLowerCase()) {
    return { ok: false, reason: "This step-up signature belongs to a different officer than the attested session." };
  }
  if (state.stepUpUses.some((u) => u.jti === payload.jti)) {
    return { ok: false, reason: "This step-up signature was already used. Re-authenticate for a fresh one." };
  }
  return { ok: true, payload };
}

/** Consume exactly once, immediately before the gate changes state. */
export function consumeStepUp(payload: StepUpPayload): boolean {
  if (state.stepUpUses.some((u) => u.jti === payload.jti)) return false;
  state.stepUpUses.push({
    jti: payload.jti,
    gateId: payload.gateId,
    sub: payload.sub,
    usedAt: new Date().toISOString(),
  });
  /* Keep the local replay ledger bounded; old tokens have expired anyway. */
  if (state.stepUpUses.length > 2000) state.stepUpUses.splice(0, state.stepUpUses.length - 2000);
  saveState();
  return true;
}
