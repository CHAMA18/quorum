import { NextResponse, type NextRequest } from "next/server";
import { appealReference, findOrganizationById, listOrgAppeals } from "@/lib/db";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { can } from "@/lib/permissions";

/**
 * GET /api/oversight/appeals — suspension appeals, joined to the register.
 *
 * Read follows the oversight console's own rule: owners, admins and auditors
 * read; nobody else sees the register. Decisions live on the [id] route and
 * are restricted to owners and admins.
 */

async function requireUser(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return getUserFromToken(token).catch(() => null);
}

export async function GET(req: NextRequest) {
  const actor = await requireUser(req);
  if (!actor) return NextResponse.json({ error: "Sign in to open oversight." }, { status: 401 });
  if (!can(actor.role, "view_oversight")) {
    return NextResponse.json({ error: "Oversight access is limited to owners, admins and auditors." }, { status: 403 });
  }

  const appeals = listOrgAppeals().map((appeal) => {
    const org = findOrganizationById(appeal.orgId);
    return {
      id: appeal.id,
      reference: appealReference(appeal.id),
      orgId: appeal.orgId,
      reason: appeal.reason,
      status: appeal.status,
      reviewer: appeal.reviewer ?? null,
      reviewNote: appeal.reviewNote ?? null,
      createdAt: appeal.createdAt,
      decidedAt: appeal.decidedAt ?? null,
      organization: org
        ? {
            id: org.id,
            name: org.name,
            email: org.email,
            registrationNo: org.registrationNo,
            status: org.status,
          }
        : null,
    };
  });

  return NextResponse.json({
    appeals,
    canDecide: can(actor.role, "manage_orgs"),
    actorRole: actor.role,
  });
}
