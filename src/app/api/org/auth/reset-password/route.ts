import { NextResponse, type NextRequest } from "next/server";
import {
  consumeOrgPasswordReset,
  deleteOrgSessionsByOrg,
  findOrgPasswordReset,
  findOrganizationByEmail,
  updateOrganizationPassword,
} from "@/lib/db";
import { clientKey, hashPassword, hashResetCode, normalizeResetCode, rateLimit } from "@/lib/org-auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * POST /api/org/auth/reset-password — consume a one-time code and set a
 * new passphrase on an organization account.
 * Body: { email, code, password }
 * 200 → { reset: true } — every open org session for the account is
 *       revoked at the same moment, so a stolen session cannot outlive a
 *       stolen passphrase being taken back.
 * 400 → field errors / invalid code   429 → rate limited
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(clientKey(req, "org-reset"), 10, 15 * 60_000)) {
    return NextResponse.json(
      { error: "Too many attempts. For security, wait a few minutes before trying again." },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body.code === "string" ? body.code : "";
  const password = typeof body.password === "string" ? body.password : "";

  const errors: Record<string, string> = {};
  if (!EMAIL_RE.test(email)) errors.email = "Enter the organization's account email.";
  if (normalizeResetCode(code).length !== 8) errors.code = "Enter the 8-character reset code.";
  if (password.length < 8) errors.password = "Use at least 8 characters.";
  else if (password.length > 128) errors.password = "Maximum 128 characters.";
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: "Check the highlighted fields.", errors }, { status: 400 });
  }

  const org = findOrganizationByEmail(email);
  if (!org) {
    return NextResponse.json(
      { error: "No organization account holds that address — check the spelling, or register the organization.", errors: { email: "Not on the register." } },
      { status: 400 }
    );
  }

  const row = findOrgPasswordReset(hashResetCode(code));
  const valid =
    row && row.orgId === org.id && row.usedAt === null && row.expiresAt.getTime() > Date.now();
  if (!valid) {
    return NextResponse.json(
      {
        error: "This reset code is not valid — it may have expired, been used, or been replaced by a fresher one. Issue a new code and try again.",
        errors: { code: "Not valid — issue a fresh code." },
      },
      { status: 400 }
    );
  }

  const passwordHash = await hashPassword(password);
  updateOrganizationPassword(org.id, passwordHash);
  consumeOrgPasswordReset(row.tokenHash);
  const revoked = deleteOrgSessionsByOrg(org.id);

  return NextResponse.json({ reset: true, sessionsRevoked: revoked });
}
