import { createHash, randomBytes, randomInt } from "crypto";
import {
  createOrgSession,
  deleteOrgSessionByToken,
  findOrgSessionWithOrg,
  type OrganizationRow,
} from "@/lib/db";
import { sessionCookieOptions } from "@/lib/auth";

/* The org routes import everything auth-related from this one module, so
   re-export the shared primitives here. */
export { clientKey, hashPassword, rateLimit, sessionCookieOptions, verifyPassword } from "@/lib/auth";

/**
 * Organization authentication — a completely separate experience from the
 * officers'. Separate table, separate token space, separate cookie
 * (`quorum_org_session`); an org session can never be mistaken for an
 * officer session, and the two stores never touch.
 *
 * Password hashing and cookie options are the same primitives the officer
 * side uses (same scrypt parameters, same httpOnly posture) — the SEPARATION
 * is in identity, not in cryptography.
 */

export const ORG_SESSION_COOKIE = "quorum_org_session";
const DAY_MS = 24 * 60 * 60 * 1000;

export async function createOrgSessionToken(orgId: string, remember: boolean) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + (remember ? 30 : 1) * DAY_MS);
  createOrgSession(orgId, expiresAt, token);
  return { token, expiresAt };
}

export function getOrgFromToken(token: string | undefined | null): OrganizationRow | null {
  if (!token) return null;
  const found = findOrgSessionWithOrg(token);
  if (!found) return null;
  if (found.session.expiresAt.getTime() < Date.now()) {
    deleteOrgSessionByToken(token);
    return null;
  }
  return found.org;
}

export function publicOrg(o: OrganizationRow) {
  return {
    id: o.id,
    name: o.name,
    email: o.email,
    registrationNo: o.registrationNo,
    country: o.country,
    legalForm: o.legalForm,
    taxPin: o.taxPin,
    taxClearanceNo: o.taxClearanceNo,
    taxClearanceExpiry: o.taxClearanceExpiry,
    regulator: o.regulator,
    regulatorNo: o.regulatorNo,
    contactName: o.contactName,
    phone: o.phone,
    address: o.address,
    website: o.website,
    description: o.description,
    categories: o.categories,
    status: o.status,
    createdAt: o.createdAt,
  };
}

export type PublicOrg = ReturnType<typeof publicOrg>;

/** The identity the gateway attests to the sidecar on this org's behalf. */
export function orgActor(o: { name: string }): string {
  return `org:${o.name}`;
}

/* ── Passphrase reset codes ────────────────────────────────────────────────
   The supplier door has no outbound mail, so the reset code is issued
   straight to the portal screen that requested it: single-use, 15-minute
   expiry, and only the SHA-256 of the code is ever stored. */

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L — hand-copy safe
export const CODE_TTL_MS = 15 * 60_000;

/** XXXX-XXXX in the unambiguous alphabet. */
export function generateResetCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (i === 3) code += "-";
  }
  return code;
}

/** Codes match only after case-folding and separator-stripping. */
export function normalizeResetCode(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function hashResetCode(raw: string): string {
  return createHash("sha256").update(normalizeResetCode(raw)).digest("hex");
}
