import { NextResponse, type NextRequest } from "next/server";
import {
  createUser,
  findUserByEmail,
  markUserVerified,
  updateUserPassword,
} from "@/lib/db";
import {
  clientKey,
  createSession,
  hashPassword,
  publicUser,
  rateLimit,
  sessionCookieOptions,
  SESSION_COOKIE,
  verifyPassword,
} from "@/lib/auth";
import { verifyFirebaseIdToken } from "@/lib/firebase-identity";
import { firebaseRestSignInWithPassword } from "@/lib/firebase-rest";

/**
 * POST /api/auth/login — verify credentials and open a session.
 * Body: { email, password, remember? }
 * 200 → { user } + httpOnly session cookie (30 days, or 1 day without remember)
 * 400 → { error, errors? }  401 → bad credentials  403 → EMAIL_UNVERIFIED
 * 429 → rate limited
 *
 * Password-drift fallback: the passphrase can legitimately change outside
 * the local store — through the self-service reset email (Firebase is the
 * system of record for that link) — and a store rebuild can drop an account
 * that still exists at Firebase. When the local scrypt hash rejects, the
 * same credentials are checked against Firebase Auth:
 *
 *   - match + local account        → local hash re-synced to the new
 *                                    passphrase; session opens normally;
 *   - match + no local account     → the account is restored, but ONLY for
 *                                    Firebase-VERIFIED addresses (proof of
 *                                    inbox control — an unverified,
 *                                    attacker-createable Firebase account
 *                                    must never grant anything);
 *   - match, address unverified    → the standard EMAIL_UNVERIFIED gate,
 *                                    which re-sends the verification link;
 *   - no match                     → the original 401.
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

  let user = findUserByEmail(email);
  let authed = user ? await verifyPassword(password, user.password) : false;

  if (!authed) {
    const fb = await firebaseRestSignInWithPassword(email, password);
    if (!fb.ok && fb.code === "TOO_MANY_ATTEMPTS_TRY_LATER") {
      return NextResponse.json(
        { error: "Too many attempts. For security, wait a few minutes before trying again." },
        { status: 429 }
      );
    }
    if (fb.ok) {
      const identity = await verifyFirebaseIdToken(fb.value.idToken);
      if (identity && identity.email === email) {
        const passwordHash = await hashPassword(password);
        if (user) {
          /* Password drift (self-service reset): re-sync the local hash so
           * the new passphrase works everywhere. */
          user = updateUserPassword(user.id, passwordHash) ?? user;
          if (identity.emailVerified && !user.emailVerified) {
            user = markUserVerified(user.id) ?? user;
          }
          authed = true;
        } else if (identity.emailVerified) {
          /* Account lost in a store rebuild but alive and verified at
           * Firebase — restore it. */
          user = createUser({
            name: identity.name.trim() || email.split("@")[0],
            email,
            password: passwordHash,
            emailVerified: true,
          });
          authed = true;
        } else {
          /* Credentials are right, but the address was never verified at
           * Firebase. Route into the existing verification gate instead of
           * pretending the password was wrong. */
          return NextResponse.json(
            {
              code: "EMAIL_UNVERIFIED",
              error:
                "Verify your email to finish signing in. We'll send a fresh verification link.",
            },
            { status: 403 }
          );
        }
      }
    }
  }

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

  const { token, expiresAt } = await createSession(user.id, remember);
  const res = NextResponse.json({ user: publicUser(user) });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  return res;
}
