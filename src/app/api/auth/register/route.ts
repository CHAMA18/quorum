import { NextResponse, type NextRequest } from "next/server";
import {
  createUser,
  findInviteByCode,
  findUserByEmail,
  updateInvite,
} from "@/lib/db";
import { clientKey, hashPassword, publicUser, rateLimit } from "@/lib/auth";
import { isAssignableRole } from "@/lib/permissions";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * POST /api/auth/register — create an account and open a session.
 * Body: { name, email, password, organization? }
 * 201 → { user, verification: "required" } (no session until the email is verified)
 * 400 → { error, errors? }  409 → email taken  429 → rate limited
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(clientKey(req, "register"), 10, 15 * 60_000)) {
    return NextResponse.json(
      { error: "Too many attempts from this network. Try again in a few minutes." },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const organization =
    typeof body.organization === "string" ? body.organization.trim() : "";
  const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode.trim().toUpperCase() : "";

  const errors: Record<string, string> = {};
  if (name.length < 2 || name.length > 80) errors.name = "Enter your full name (2–80 characters).";
  if (!EMAIL_RE.test(email)) errors.email = "Enter a valid work email.";
  if (password.length < 8) errors.password = "Use at least 8 characters.";
  else if (password.length > 128) errors.password = "Maximum 128 characters.";
  if (organization.length > 120) errors.organization = "Keep it under 120 characters.";
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: "Check the highlighted fields.", errors }, { status: 400 });
  }

  const existing = findUserByEmail(email);
  if (existing) {
    return NextResponse.json(
      {
        error: "An account with this email already exists.",
        errors: { email: "This email already has an account — sign in instead." },
      },
      { status: 409 }
    );
  }

  /* Resolve the invite BEFORE the account exists: its role is part of the
     account's creation, not a label appended afterwards. An unknown,
     expired or already-claimed code is simply ignored. */
  const invite = inviteCode ? findInviteByCode(inviteCode) : null;
  const usableInvite =
    invite &&
    invite.status === "PENDING" &&
    Date.now() - invite.createdAt.getTime() <= 14 * 86_400_000
      ? invite
      : null;

  const passwordHash = await hashPassword(password);
  const user = createUser({
    name,
    email,
    password: passwordHash,
    organization: organization || null,
    ...(usableInvite && isAssignableRole(usableInvite.role) ? { role: usableInvite.role } : {}),
  });

  let claimedInvite: { code: string; role: string } | null = null;
  if (usableInvite) {
    updateInvite(usableInvite.id, {
      status: "CLAIMED",
      claimedBy: user.id,
      claimedByEmail: user.email,
      claimedAt: new Date(),
    });
    claimedInvite = { code: usableInvite.code, role: usableInvite.role };
  }

  /* No session yet: the account opens only after the Firebase verification link is confirmed. */
  return NextResponse.json(
    { user: publicUser(user), invite: claimedInvite, verification: "required" },
    { status: 201 }
  );
}
