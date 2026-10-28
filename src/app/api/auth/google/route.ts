import { NextResponse, type NextRequest } from "next/server";
import { createUser, findUserByEmail, markUserVerified } from "@/lib/db";
import {
  clientKey,
  createSession,
  publicUser,
  rateLimit,
  sessionCookieOptions,
  SESSION_COOKIE,
} from "@/lib/auth";
import { verifyFirebaseIdToken } from "@/lib/firebase-identity";

/**
 * POST /api/auth/google — open a session for a Google-verified identity.
 * Body: { idToken } (Firebase ID token from the Google popup)
 * 200 → { user } + httpOnly session cookie  401 → token rejected  403 → not a verified Google identity
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(clientKey(req, "google"), 20, 15 * 60_000)) {
    return NextResponse.json({ error: "Too many attempts. Wait a few minutes." }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as { idToken?: unknown } | null;
  const idToken = typeof body?.idToken === "string" ? body.idToken : "";
  const identity = await verifyFirebaseIdToken(idToken);
  if (!identity) {
    return NextResponse.json(
      { error: "Google sign-in could not be confirmed. Please try again." },
      { status: 401 }
    );
  }
  if (!identity.providers.includes("google.com") || !identity.emailVerified) {
    return NextResponse.json({ error: "This sign-in is not a verified Google account." }, { status: 403 });
  }

  /* Google has verified the address, so the account is verified too. Existing
   * password accounts with the same email are linked, not duplicated. */
  let user = findUserByEmail(identity.email);
  if (!user) {
    user = createUser({
      name: identity.name.trim() || identity.email.split("@")[0],
      email: identity.email,
      password: "oauth:google",
      emailVerified: true,
    });
  } else if (!user.emailVerified) {
    user = markUserVerified(user.id) ?? user;
  }

  if (user.status === "SUSPENDED") {
    return NextResponse.json(
      { code: "ACCOUNT_SUSPENDED", error: "This workspace account is suspended." },
      { status: 403 }
    );
  }

  const { token, expiresAt } = await createSession(user.id, true);
  const res = NextResponse.json({ user: publicUser(user) });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  return res;
}
