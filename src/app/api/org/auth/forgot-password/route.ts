import { randomBytes } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { findOrganizationByEmail } from "@/lib/db";
import { clientKey, rateLimit } from "@/lib/org-auth";
import {
  firebaseRestEnsureAccount,
  firebaseRestSendPasswordReset,
} from "@/lib/firebase-rest";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * POST /api/org/auth/forgot-password — email a password-reset link.
 * Body: { email }
 * 200 → { sent: true }  uniform reply for every well-formed address, so the
 *       response never reveals whether an organization is registered.
 * 400 → invalid email   429 → rate limited   502 → reset service down
 *
 * The link is emailed by Firebase to the address itself. Holding the link
 * is the proof of inbox control: no code is ever returned to the browser.
 * For an organization on the register, a Firebase identity is bootstrapped
 * first (random passphrase, never shown) so the reset email has a target.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(clientKey(req, "org-forgot"), 4, 15 * 60_000)) {
    return NextResponse.json(
      { error: "Too many reset requests. For security, wait a few minutes before trying again." },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Check the highlighted fields.", errors: { email: "Enter the organization's account email." } },
      { status: 400 }
    );
  }

  if (findOrganizationByEmail(email)) {
    /* Result ignored on purpose: if Firebase is down, the send below fails
     * too and the same honest 502 covers both. */
    await firebaseRestEnsureAccount(email, randomBytes(24).toString("hex"));
  }

  const sent = await firebaseRestSendPasswordReset(email);
  /* An unknown address is not an error: same reply as a registered one. */
  if (!sent.ok && sent.code !== "EMAIL_NOT_FOUND") {
    return NextResponse.json(
      {
        error:
          sent.code === "TOO_MANY_ATTEMPTS_TRY_LATER"
            ? "The reset service is rate-limiting this address. Try again in a few minutes."
            : "The reset service is unavailable right now. Try again shortly.",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ sent: true });
}
