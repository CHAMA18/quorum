import { randomInt } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createOrgPasswordReset, findOrganizationByEmail } from "@/lib/db";
import { clientKey, hashResetCode, rateLimit } from "@/lib/org-auth";
import { appOrigin, sendOrgResetCodeEmail } from "@/lib/auth-email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* No 0/O or 1/I: a code read over the phone must not be ambiguous. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newResetCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/**
 * POST /api/org/auth/forgot-password — email a supplier reset code.
 * Body: { email }
 *
 * Quorum mints the code itself, stores only its digest and mails it through
 * its own relay. The code is never returned to the caller — holding the inbox
 * is the proof, and the response is uniform for every well-formed address.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(clientKey(req, "org-forgot"), 4, 15 * 60_000)) {
    return NextResponse.json(
      { error: "Too many reset requests. For security, wait a few minutes before trying again." },
      { status: 429 },
    );
  }

  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Check the highlighted fields.", errors: { email: "Enter the organization's account email." } },
      { status: 400 },
    );
  }

  const org = findOrganizationByEmail(email);
  if (!org) return NextResponse.json({ sent: true });

  const code = newResetCode();
  createOrgPasswordReset(org.id, hashResetCode(code), new Date(Date.now() + 30 * 60_000));
  const result = await sendOrgResetCodeEmail({ org, code, origin: appOrigin(req.url) });

  if (result.status === "SKIPPED" || result.status === "FAILED") {
    return NextResponse.json(
      {
        error:
          result.status === "SKIPPED"
            ? "Email delivery is not configured on this deployment, so a reset code cannot be sent. Contact the procurement desk."
            : "The reset service is unavailable right now. Try again shortly.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ sent: true });
}
