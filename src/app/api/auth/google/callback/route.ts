import { NextResponse, type NextRequest } from "next/server";
import {
  createUser,
  findClaimedWorkspaceMembership,
  findInviteByCode,
  findUserByEmail,
  flushStore,
  markUserVerified,
  selfServeWorkspaceCreationOpen,
  updateInvite,
} from "@/lib/db";
import { isAssignableRole, type AssignableRole } from "@/lib/permissions";
import { validateRegistrationInvite } from "@/lib/role-assignment";
import {
  createSession,
  sessionCookieOptions,
  SESSION_COOKIE,
} from "@/lib/auth";
import { appOrigin } from "@/lib/auth-email";
import { GOOGLE_STATE_COOKIE } from "../start/route";

export const dynamic = "force-dynamic";

interface GoogleTokenInfo {
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: string | boolean;
  name?: string;
}

/**
 * GET /api/auth/google/callback — exchange the authorisation code and open a
 * workspace session.
 *
 * The ID token is verified against Google's tokeninfo endpoint: the audience
 * must be this app's client id, the address must be verified, and the subject
 * must be present. Anything else is a refusal, never a fallback identity.
 */
export async function GET(req: NextRequest) {
  const origin = appOrigin(req.url);
  const deny = (reason: string) => NextResponse.redirect(new URL(`/?google=${reason}#/login`, origin));

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return deny("unconfigured");

  const state = req.nextUrl.searchParams.get("state") ?? "";
  const code = req.nextUrl.searchParams.get("code") ?? "";
  if (req.nextUrl.searchParams.get("error")) return deny("cancelled");

  let invite = "";
  try {
    const stored = JSON.parse(req.cookies.get(GOOGLE_STATE_COOKIE)?.value ?? "null") as
      | { state?: string; invite?: string }
      | null;
    if (!stored?.state || !state || stored.state !== state) return deny("state");
    invite = typeof stored.invite === "string" ? stored.invite : "";
  } catch {
    return deny("state");
  }
  if (!code) return deny("code");

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI?.trim() || `${origin}/api/auth/google/callback`;

  let idToken = "";
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!tokenRes.ok) return deny("exchange");
    const payload = (await tokenRes.json().catch(() => null)) as { id_token?: string } | null;
    idToken = payload?.id_token ?? "";
  } catch {
    return deny("network");
  }
  if (!idToken) return deny("exchange");

  let identity: GoogleTokenInfo | null = null;
  try {
    const infoRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      { cache: "no-store", signal: AbortSignal.timeout(10_000) },
    );
    if (!infoRes.ok) return deny("token");
    identity = (await infoRes.json().catch(() => null)) as GoogleTokenInfo | null;
  } catch {
    return deny("network");
  }

  const emailVerified =
    identity?.email_verified === true || identity?.email_verified === "true";
  if (
    !identity?.sub ||
    !identity.email ||
    identity.aud !== clientId ||
    !emailVerified
  ) {
    return deny("unverified");
  }

  const email = identity.email.trim().toLowerCase();
  const inviteCode = invite.toUpperCase();
  const foundInvite = inviteCode ? findInviteByCode(inviteCode) : null;
  const inviteCheck = validateRegistrationInvite(inviteCode, foundInvite, email);
  if (!inviteCheck.ok) return deny("invite");

  let inviteRole: AssignableRole | null = null;
  if (inviteCode && (!foundInvite || !isAssignableRole(foundInvite.role))) {
    return deny("invite");
  }
  if (foundInvite && isAssignableRole(foundInvite.role)) inviteRole = foundInvite.role;

  let user = findUserByEmail(email);
  if (user && inviteCode) return deny("exists");

  if (!user) {
    const membership =
      foundInvite && inviteRole
        ? { workspaceId: foundInvite.workspaceId, role: inviteRole }
        : findClaimedWorkspaceMembership(email);
    if (!membership && !selfServeWorkspaceCreationOpen()) return deny("invitation-only");
    user = createUser({
      name: identity.name?.trim() || email.split("@")[0],
      email,
      password: "oauth:google",
      emailVerified: true,
      ...(membership ?? {}),
    });
    if (foundInvite) {
      updateInvite(
        foundInvite.id,
        {
          status: "CLAIMED",
          claimedBy: user.id,
          claimedByEmail: user.email,
          claimedAt: new Date(),
        },
        foundInvite.workspaceId,
      );
    }
  } else if (!user.emailVerified) {
    user = markUserVerified(user.id) ?? user;
  }

  if (user.status === "SUSPENDED") return deny("suspended");

  const { token, expiresAt } = await createSession(user.id, true);
  await flushStore();

  const res = NextResponse.redirect(new URL("/#/dashboard", origin));
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  res.cookies.set(GOOGLE_STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
