import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { countSessionsForUser, getSetting, listInvites, listOrganizations, listOversightEvents, listStepUpLogs, listUsers, recordOversightEvent, setSetting } from "@/lib/db";

/**
 * Phase 7 — periodic access review.
 *
 * GET (view_oversight): the live posture — who holds power, who holds it
 * without a second factor, what is dormant, what is pending, and when the
 * last review was recorded. Nothing here is a snapshot table; the truth is
 * recomputed from the store on every read, so the review can never go stale.
 *
 * POST (manage_people): records that a named reviewer performed the access
 * review — the posture summary is written verbatim into the governance
 * event log, so an auditor can compare what was true then against now.
 *
 * NOTE: OversightAction's union lives in the store; ACCESS_REVIEW rides the
 * same event log (the store accepts the action string it is given).
 */

export async function GET(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user.role, "view_oversight")) return NextResponse.json({ error: "Oversight access required." }, { status: 403 });

  const users = listUsers();
  const invites = listInvites(200);
  const orgs = listOrganizations();
  const events = listOversightEvents(200);
  const stepUps = listStepUpLogs(500);

  const byRole: Record<string, number> = {};
  for (const u of users) byRole[u.role] = (byRole[u.role] ?? 0) + 1;
  const privileged = users.filter((u) => u.role === "OWNER" || u.role === "ADMIN");
  const adminsWithoutMfa = privileged.filter((u) => !u.totpEnabled).map((u) => ({ id: u.id, name: u.name, role: u.role }));
  const suspended = users.filter((u) => u.status === "SUSPENDED").map((u) => ({ id: u.id, name: u.name }));
  const activeSessions = users.reduce((n, u) => n + countSessionsForUser(u.id), 0);
  const pendingInvites = invites.filter((i) => i.status === "PENDING").length;
  const lastReview = events.find((e) => e.action === "ACCESS_REVIEW") ?? null;
  const mfaPolicyOn = getSetting("require_mfa_admins") === "1";

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    totals: { users: users.length, organizations: orgs.length, activeSessions, pendingInvites },
    byRole,
    privileged: { count: privileged.length, withoutMfa: adminsWithoutMfa, mfaPolicyOn },
    suspended,
    lastReview: lastReview
      ? { at: lastReview.createdAt, by: lastReview.actorName, detail: lastReview.detail }
      : null,
    stepUpWindow: { tracked: stepUps.length, latestAt: stepUps[0]?.issuedAt ?? null },
    events: events.slice(0, 10).map((e) => ({ at: e.createdAt, actor: e.actorName, action: e.action, target: e.targetName, detail: e.detail })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user.role, "manage_people")) {
    return NextResponse.json({ error: "Recording an access review requires people management." }, { status: 403 });
  }

  const users = listUsers();
  const privileged = users.filter((u) => u.role === "OWNER" || u.role === "ADMIN");
  const withoutMfa = privileged.filter((u) => !u.totpEnabled).length;
  const orgs = listOrganizations();
  const detail =
    `Reviewed ${users.length} accounts (${privileged.length} privileged, ${withoutMfa} without MFA), ` +
    `${orgs.length} organizations. MFA-for-admins policy: ${getSetting("require_mfa_admins") === "1" ? "ON" : "OFF"}.`;

  recordOversightEvent({
    actorId: user.id,
    actorName: user.name,
    action: "ACCESS_REVIEW",
    targetType: "ORGANIZATION",
    targetId: "workspace",
    targetName: "Workspace access",
    detail,
  });
  setSetting("last_access_review_at", new Date().toISOString());
  setSetting("last_access_review_by", user.name);

  return NextResponse.json({ recorded: true, detail }, { status: 201 });
}
