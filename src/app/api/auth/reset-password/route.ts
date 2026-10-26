import { randomBytes } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { findUserByEmail } from "@/lib/db";
import { clientKey, rateLimit } from "@/lib/auth";
import {
  firebaseRestEnsureAccount,
  firebaseRestSendPasswordReset,
} from "@/lib/firebase-rest";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * POST /api/auth/reset-password — email a real self-service reset link.
 * Body: { email }
 * 200 → { sent: true }   (uniform reply; never reveals whether the address
 *                          has an account — Firebase itself sends nothing
 *                          for unknown addresses)
 * 400 → invalid email    429 → rate limited    502 → reset service down
 *
 * How it stays true when the account lives only in one layer:
 *  1. If the account exists in the local store but the client-side Firebase
 *     mirror never ran, a Firebase identity is bootstrapped first (random
 *     passphrase) so the reset email has somewhere to go.
 *  2. Firebase then emails the reset link from its own infrastructure; the
 *     link is hosted on the project's authorised auth domain, so the reset
 *     completes regardless of where this app is deployed.
 *  3. The new passphrase reaches the local stack at the next sign-in
 *     (see /api/auth/login — Firebase is the source of truth for passwords
 *     after a drift).
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(clientKey(req, "reset"), 5, 15 * 60_000)) {
    return NextResponse.json(
      { error: "Too many reset requests. For security, wait a few minutes before trying again." },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Check the highlighted fields.", errors: { email: "Enter a valid work email." } },
      { status: 400 }
    );
  }

  /* Step 1 — make sure a Firebase identity exists for locally-known addresses. */
  if (findUserByEmail(email)) {
    await firebaseRestEnsureAccount(email, randomBytes(24).toString("hex"));
    /* Result ignored on purpose: if Firebase is down, step 2 fails too and
     * the same honest 502 below covers both. */
  }

  /* Step 2 — Firebase emails the reset link. */
  const sent = await firebaseRestSendPasswordReset(email);
  if (!sent.ok) {
    return NextResponse.json(
      {
        error:
          sent.code === "TOO_MANY_ATTEMPTS_TRY_LATER"
            ? "The reset service is rate-limiting this address. Try again in a few minutes."
            : "The reset service is unavailable right now. Try again shortly, or reply to your onboarding mail.",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ sent: true });
}
