import { NextResponse, type NextRequest } from "next/server";
import {
  appealReference,
  decideOrgAppeal,
  deleteOrgSessionsByOrg,
  findOrgAppealById,
  findOrganizationById,
  recordOversightEvent,
} from "@/lib/db";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { can } from "@/lib/permissions";

/**
 * POST /api/oversight/appeals/:id — decide a suspension appeal.
 *
 * REINSTATED restores the organization's access and revokes any live portal
 * sessions (there should be none, but a stale cookie is not evidence). UPHELD
 * leaves the suspension standing. Both write to the governance log, and both
 * are restricted to owners and admins — the same authority that suspends.
 */

async function requireUser(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return getUserFromToken(token).catch(() => null);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser(req);
  if (!actor) return NextResponse.json({ error: "Sign in to decide an appeal." }, { status: 401 });
  if (!can(actor.role, "manage_orgs")) {
    return NextResponse.json({ error: "Only owners and admins can decide a suspension appeal." }, { status: 403 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const decision = body.decision === "UPHELD" || body.decision === "REINSTATED" ? body.decision : null;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 600) : "";
  if (!decision) {
    return NextResponse.json({ error: "Decision must be UPHELD or REINSTATED." }, { status: 422 });
  }
  if (note.length < 4) {
    return NextResponse.json({ error: "Record the reason for the decision — it goes on the governance log." }, { status: 422 });
  }

  const appeal = findOrgAppealById(id);
  if (!appeal) return NextResponse.json({ error: "Appeal not found." }, { status: 404 });
  if (appeal.status !== "OPEN") {
    return NextResponse.json({ error: `This appeal is already ${appeal.status}.` }, { status: 409 });
  }

  const org = findOrganizationById(appeal.orgId);
  if (!org) return NextResponse.json({ error: "The organization on this appeal is no longer on the register." }, { status: 404 });

  const decided = decideOrgAppeal(appeal.id, { decision, reviewer: actor.name, note }) ?? appeal;
  const revokedSessions = decision === "REINSTATED" ? deleteOrgSessionsByOrg(org.id) : 0;
  const updatedOrg = findOrganizationById(org.id) ?? org;

  recordOversightEvent({
    actorId: actor.id,
    actorName: actor.name,
    action: decision === "REINSTATED" ? "ORG_REINSTATED_ON_APPEAL" : "ORG_APPEAL_UPHELD",
    targetType: "ORGANIZATION",
    targetId: org.id,
    targetName: org.name,
    detail: `${appealReference(appeal.id)} — ${note}${revokedSessions ? ` · ${revokedSessions} session${revokedSessions === 1 ? "" : "s"} revoked` : ""}`,
  });

  return NextResponse.json({
    appeal: {
      id: decided.id,
      reference: appealReference(decided.id),
      status: decided.status,
      reviewer: decided.reviewer ?? null,
      reviewNote: decided.reviewNote ?? null,
      decidedAt: decided.decidedAt ?? null,
    },
    organization: { id: updatedOrg.id, name: updatedOrg.name, status: updatedOrg.status },
    revokedSessions,
  });
}
