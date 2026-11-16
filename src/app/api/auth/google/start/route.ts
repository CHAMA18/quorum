import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { appOrigin } from "@/lib/auth-email";

export const dynamic = "force-dynamic";

export const GOOGLE_STATE_COOKIE = "quorum_google_state";
export const GOOGLE_STATE_TTL_SECONDS = 10 * 60;

/**
 * GET /api/auth/google/start — begin Google sign-in.
 *
 * Quorum talks to Google's OAuth 2.0 endpoints directly; there is no hosted
 * identity broker in front of it. The state value is random, single-use and
 * bound to this browser by an httpOnly cookie, and the invitation code travels
 * inside that cookie rather than the URL Google sees.
 */
export async function GET(req: NextRequest) {
  const origin = appOrigin(req.url);
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    return NextResponse.redirect(new URL("/?google=unconfigured#/login", origin));
  }

  const invite = (req.nextUrl.searchParams.get("invite") ?? "").trim().toUpperCase().slice(0, 64);
  const state = randomBytes(24).toString("base64url");
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI?.trim() || `${origin}/api/auth/google/callback`;

  const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "openid email profile");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("prompt", "select_account");

  const res = NextResponse.redirect(authorize);
  res.cookies.set(GOOGLE_STATE_COOKIE, JSON.stringify({ state, invite }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GOOGLE_STATE_TTL_SECONDS,
  });
  return res;
}
