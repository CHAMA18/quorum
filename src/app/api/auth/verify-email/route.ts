import { NextResponse, type NextRequest } from "next/server";
import { consumeEmailVerification, findUserById, flushStore, markUserVerified } from "@/lib/db";
import {
  clientKey,
  createSession,
  rateLimit,
  sessionCookieOptions,
  SESSION_COOKIE,
} from "@/lib/auth";
import { appOrigin, hashAuthToken } from "@/lib/auth-email";

/**
 * GET /api/auth/verify-email?token=… — the link in the confirmation email.
 *
 * The token is single-use, expires in 24 hours, and is matched against a
 * stored SHA-256 digest. A good token marks the address verified, opens the
 * session and lands the browser on the workspace; a bad one says so on the
 * sign-in screen instead of pretending.
 */
export async function GET(req: NextRequest) {
  const origin = appOrigin(req.url);
  if (!rateLimit(clientKey(req, "verify-email"), 20, 15 * 60_000)) {
    return NextResponse.redirect(new URL("/?verified=throttled#/login", origin));
  }

  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!token) return NextResponse.redirect(new URL("/?verified=invalid#/login", origin));

  const row = consumeEmailVerification(hashAuthToken(token));
  if (!row) return NextResponse.redirect(new URL("/?verified=expired#/login", origin));

  const user = findUserById(row.userId);
  if (!user) return NextResponse.redirect(new URL("/?verified=missing#/login", origin));
  if (user.status === "SUSPENDED") {
    return NextResponse.redirect(new URL("/?verified=suspended#/login", origin));
  }

  if (!user.emailVerified) markUserVerified(user.id);
  const { token: sessionToken, expiresAt } = await createSession(user.id, true);
  await flushStore();

  const res = NextResponse.redirect(new URL("/#/dashboard", origin));
  res.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions(expiresAt));
  return res;
}
