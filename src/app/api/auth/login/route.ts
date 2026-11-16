import { NextResponse, type NextRequest } from "next/server";
import { findUserByEmail, flushStore } from "@/lib/db";
import {
  clearRateLimit,
  clientKey,
  createSession,
  hashPassword,
  publicUser,
  rateLimit,
  sessionCookieOptions,
  SESSION_COOKIE,
  verifyPassword,
} from "@/lib/auth";


/**
 * POST /api/auth/login — verify credentials and open a session.
 * Body: { email, password, remember? }
 * 200 → { user } + httpOnly session cookie (30 days, or 1 day without remember)
 * 400 → { error, errors? }  401 → bad credentials  403 → EMAIL_UNVERIFIED
 * 429 → rate limited
 *
 * The account record and its scrypt hash live in Quorum's own store
 * (Postgres). There is no second identity provider to reconcile against: a
 * passphrase changed through the emailed reset link is written here, and a
 * failed check is simply a failed check.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(clientKey(req, "login"), 8, 15 * 60_000)) {
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
  const password = typeof body.password === "string" ? body.password : "";
  const remember = body.remember !== false;

  const errors: Record<string, string> = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = "Enter a valid work email.";
  if (password.length === 0) errors.password = "Enter your password.";
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: "Check the highlighted fields.", errors }, { status: 400 });
  }

  /* Per-account budget, independent of the caller's IP: a distributed attacker
     cannot grind one address by rotating networks. Successful sign-in clears
     the budget below. */
  const accountKey = `account-login:${email}`;
  if (!rateLimit(accountKey, 8, 15 * 60_000)) {
    return NextResponse.json(
      { error: "Too many attempts for this account. Wait a few minutes before trying again." },
      { status: 429 },
    );
  }

  const user = findUserByEmail(email);
  const authed = user ? await verifyPassword(password, user.password) : false;

  if (!authed || !user) {
    return NextResponse.json(
      { error: "Incorrect email or password. Check your credentials and try again." },
      { status: 401 }
    );
  }

  if (user.status === "SUSPENDED") {
    return NextResponse.json(
      {
        code: "ACCOUNT_SUSPENDED",
        error: "This workspace account is suspended. Ask the workspace owner or an admin to restore it.",
      },
      { status: 403 }
    );
  }

  if (!user.emailVerified) {
    return NextResponse.json(
      {
        code: "EMAIL_UNVERIFIED",
        error: "Verify your email to finish signing in. We'll send a fresh verification link.",
      },
      { status: 403 }
    );
  }

  clearRateLimit(accountKey);
  const { token, expiresAt } = await createSession(user.id, remember);
  /* The session row must exist before the cookie is handed over. */
  await flushStore();
  const res = NextResponse.json({ user: publicUser(user) });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  return res;
}
