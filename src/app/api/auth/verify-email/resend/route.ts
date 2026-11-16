import { NextResponse, type NextRequest } from "next/server";
import { findUserByEmail } from "@/lib/db";
import { clientKey, rateLimit } from "@/lib/auth";
import { appOrigin, sendVerificationEmail } from "@/lib/auth-email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * POST /api/auth/verify-email/resend — send a fresh confirmation link.
 * Body: { email }
 *
 * The reply is uniform: it never reveals whether the address has an account.
 * A user who already verified is told to sign in, not re-sent a dead link.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(clientKey(req, "verify-resend"), 5, 15 * 60_000)) {
    return NextResponse.json(
      { error: "Too many requests. Wait a few minutes before asking for another link." },
      { status: 429 },
    );
  }

  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Check the highlighted fields.", errors: { email: "Enter a valid work email." } },
      { status: 400 },
    );
  }

  const user = findUserByEmail(email);
  if (!user) return NextResponse.json({ sent: true });

  if (user.emailVerified) {
    return NextResponse.json({
      sent: false,
      verified: true,
      detail: "This address is already confirmed — sign in with your passphrase.",
    });
  }

  const result = await sendVerificationEmail({ user, origin: appOrigin(req.url) });
  return NextResponse.json({
    sent: true,
    delivery: { status: result.status, detail: result.detail },
    ...(result.status === "SKIPPED" && process.env.NODE_ENV !== "production"
      ? { verificationUrl: result.url }
      : {}),
  });
}
