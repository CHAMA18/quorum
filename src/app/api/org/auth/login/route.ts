import { NextResponse, type NextRequest } from "next/server";
import { findOrganizationByEmail, updateOrganizationPassword } from "@/lib/db";
import {
  clientKey,
  createOrgSessionToken,
  ORG_SESSION_COOKIE,
  publicOrg,
  rateLimit,
  sessionCookieOptions,
  hashPassword,
  verifyPassword,
} from "@/lib/org-auth";
import { verifyFirebaseIdToken } from "@/lib/firebase-identity";
import { firebaseRestSignInWithPassword } from "@/lib/firebase-rest";

/**
 * POST /api/org/auth/login — verify ORGANIZATION credentials and open an
 * org session. Officers sign in at the desk's own door; this one is the
 * suppliers'. The two cookie names never overlap, so being signed in as
 * both an officer and an organization (rare, but legal) never confuses
 * either surface.
 *
 * 200 → { org } + httpOnly org session cookie
 * 400 → field errors   401 → bad credentials   403 → suspended   429 → rate limited
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(clientKey(req, "org-login"), 8, 15 * 60_000)) {
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

  const errors: Record<string, string> = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = "Enter a valid organization email.";
  if (password.length === 0) errors.password = "Enter your password.";
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: "Check the highlighted fields.", errors }, { status: 400 });
  }

  let org = findOrganizationByEmail(email);
  let authed = org ? await verifyPassword(password, org.password) : false;

  /* Password drift after an emailed reset: the new passphrase lives at
   * Firebase. Accept it only for an organization already on the register,
   * and only when Firebase has verified the address (the owner clicked the
   * link) — an unverified, attacker-created Firebase account grants nothing. */
  if (org && !authed) {
    const fb = await firebaseRestSignInWithPassword(email, password);
    if (fb.ok) {
      const identity = await verifyFirebaseIdToken(fb.value.idToken);
      if (identity && identity.email === email && identity.emailVerified) {
        const passwordHash = await hashPassword(password);
        org = updateOrganizationPassword(org.id, passwordHash) ?? org;
        authed = true;
      }
    }
  }

  if (!authed || !org) {
    return NextResponse.json(
      { error: "Incorrect email or password. Check your credentials and try again." },
      { status: 401 }
    );
  }

  if (org.status === "SUSPENDED") {
    return NextResponse.json(
      {
        error:
          "This organization is SUSPENDED on the register — signing in is blocked. Contact the procurement desk to resolve the suspension.",
      },
      { status: 403 }
    );
  }

  const { token, expiresAt } = await createOrgSessionToken(org.id, body.remember !== false);
  const res = NextResponse.json({ org: publicOrg(org) });
  res.cookies.set(ORG_SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  return res;
}
