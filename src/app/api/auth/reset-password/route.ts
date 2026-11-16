import { NextResponse, type NextRequest } from "next/server";
import { findUserByEmail, flushStore } from "@/lib/db";
import { clientKey, rateLimit } from "@/lib/auth";
import { appOrigin, sendPasswordResetEmail } from "@/lib/auth-email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * POST /api/auth/reset-password — email a one-time reset link.
 * Body: { email }
 *
 * Quorum mints and stores the token itself (only its digest is kept) and sends
 * the mail through its own relay, so the reset no longer depends on a hosted
 * identity provider. The reply is uniform: `{ sent: true }` whether or not the
 * address has an account, and the token is only minted for a real one.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(clientKey(req, "reset"), 5, 15 * 60_000)) {
    return NextResponse.json(
      { error: "Too many reset requests. For security, wait a few minutes before trying again." },
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
  if (user && user.status !== "SUSPENDED") {
    const result = await sendPasswordResetEmail({ user, origin: appOrigin(req.url) });
    await flushStore();
    /* A relay that is not configured is an operator problem, and hiding it
       would leave the user waiting for mail that cannot arrive. */
    if (result.status === "SKIPPED") {
      return NextResponse.json(
        {
          error: "Email delivery is not configured on this deployment, so a reset link cannot be sent. Ask your workspace owner to reset your access.",
          ...(process.env.NODE_ENV !== "production" ? { resetUrl: result.url } : {}),
        },
        { status: 502 },
      );
    }
    if (result.status === "FAILED") {
      return NextResponse.json(
        { error: "The reset service is unavailable right now. Try again shortly." },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({ sent: true });
}
