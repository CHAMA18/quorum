import { NextResponse, type NextRequest } from "next/server";
import {
  countOrgSessionsForOrg,
  deleteOrgSessionsByOrg,
  findOrganizationById,
  listOrganizations,
  listOversightEvents,
  recordOversightEvent,
  setOrganizationStatus,
} from "@/lib/db";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { publicOrg } from "@/lib/org-auth";
import { can } from "@/lib/permissions";

/**
 * The oversight read + organization lifecycle.
 *
 * People and invites live in /api/team; this route is the organization side
 * of the governance console. Suspending an organization immediately deletes
 * its live sessions, and the login/session paths check status again so a
 * stale cookie cannot outlive the decision.
 */

async function requireUser(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return getUserFromToken(token).catch(() => null);
}

function orgView(org: ReturnType<typeof listOrganizations>[number]) {
  return {
    ...publicOrg(org),
    sessions: countOrgSessionsForOrg(org.id),
  };
}

export async function GET(req: NextRequest) {
  const actor = await requireUser(req);
  if (!actor) return NextResponse.json({ error: "Sign in to open oversight." }, { status: 401 });
  if (!can(actor.role, "view_oversight")) {
    return NextResponse.json({ error: "Oversight access is limited to owners, admins and auditors." }, { status: 403 });
  }

  const organizations = listOrganizations();
  return NextResponse.json({
    organizations: organizations.map(orgView),
    events: listOversightEvents(40),
    canManageOrgs: can(actor.role, "manage_orgs"),
    actorRole: actor.role,
  });
}

export async function PATCH(req: NextRequest) {
  const actor = await requireUser(req);
  if (!actor) return NextResponse.json({ error: "Sign in to manage organizations." }, { status: 401 });
  if (!can(actor.role, "manage_orgs")) {
    return NextResponse.json({ error: "Only owners and admins can suspend an organization." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const orgId = typeof body.orgId === "string" ? body.orgId : "";
  const status = body.status === "ACTIVE" || body.status === "SUSPENDED" ? body.status : null;
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 400) : "";
  if (!orgId || !status) {
    return NextResponse.json({ error: "Provide an organization and a status." }, { status: 422 });
  }
  if (status === "SUSPENDED" && reason.length < 4) {
    return NextResponse.json({ error: "Record a reason for the suspension — it goes on the governance log." }, { status: 422 });
  }

  const org = findOrganizationById(orgId);
  if (!org) return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  if (org.status === status) {
    return NextResponse.json({ organization: orgView(org), revokedSessions: 0 });
  }

  const updated = setOrganizationStatus(org.id, status) ?? org;
  const revokedSessions = status === "SUSPENDED" ? deleteOrgSessionsByOrg(org.id) : 0;

  recordOversightEvent({
    actorId: actor.id,
    actorName: actor.name,
    action: status === "SUSPENDED" ? "ORG_SUSPENDED" : "ORG_REACTIVATED",
    targetType: "ORGANIZATION",
    targetId: org.id,
    targetName: org.name,
    detail: `${reason || (status === "SUSPENDED" ? "Suspended by the desk" : "Reinstated by the desk")}${
      revokedSessions ? ` · ${revokedSessions} session${revokedSessions === 1 ? "" : "s"} revoked` : ""
    }`,
  });

  return NextResponse.json({ organization: orgView(updated), revokedSessions });
}
