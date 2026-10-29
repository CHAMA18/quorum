import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getSetting, listUsers, recordOversightEvent, setSetting } from "@/lib/db";

/**
 * Phase 7 — the MFA-for-privilege policy.
 *
 * GET  (view_oversight): whether the policy is on and who it currently blocks.
 * POST (manage_people): turn it on or off. Flipping it is a governance event
 * with the actor on the record — a security posture change is never quiet.
 * With the policy ON, every OWNER/ADMIN step-up (the act that signs gates)
 * requires a TOTP code; a passphrase alone no longer opens the gavel.
 */
export async function GET(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user.role, "view_oversight")) return NextResponse.json({ error: "Oversight access required." }, { status: 403 });
  const enabled = getSetting("require_mfa_admins") === "1";
  const privileged = listUsers().filter((u) => u.role === "OWNER" || u.role === "ADMIN");
  return NextResponse.json({
    enabled,
    privilegedCount: privileged.length,
    blockedCount: privileged.filter((u) => !u.totpEnabled).length,
  });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user.role, "manage_people")) {
    return NextResponse.json({ error: "Changing the MFA policy requires people management." }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  const enabled = body.enabled === true;
  setSetting("require_mfa_admins", enabled ? "1" : "0");
  recordOversightEvent({
    actorId: user.id,
    actorName: user.name,
    action: "ROLE_CHANGED",
    targetType: "ORGANIZATION",
    targetId: "policy-mfa-admins",
    targetName: "MFA-for-admins policy",
    detail: enabled
      ? "MFA for privileged accounts turned ON — gate signatures now require a second factor for OWNER/ADMIN."
      : "MFA for privileged accounts turned OFF — gate signatures accept a passphrase again.",
  });
  return NextResponse.json({ enabled }, { status: 201 });
}
