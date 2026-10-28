import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";
import {
  countSessionsForUser,
  createInvite,
  deleteSessionsForUser,
  findInviteById,
  findUserById,
  listInvites,
  listUsers,
  recordOversightEvent,
  setUserStatus,
  updateInvite,
  updateUserRole,
} from "@/lib/db";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import {
  can,
  canAssignRole,
  isAssignableRole,
  isWorkspaceRole,
  type WorkspaceRole,
} from "@/lib/permissions";

/**
 * Workspace access — people, roles and invites.
 *
 * GET is the oversight read: OWNER, ADMIN and AUDITOR may see the roster.
 * Every write requires `manage_people`, and an ADMIN can never grant or modify
 * OWNER/ADMIN authority. The owner is unique and cannot remove themselves.
 */

async function requireUser(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return getUserFromToken(token).catch(() => null);
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/L/O/0/1 — read-aloud safe

function newCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `Q-${code.slice(0, 4)}-${code.slice(4)}`;
}

function ownerCount(): number {
  return listUsers().filter((u) => u.role === "OWNER" && u.status === "ACTIVE").length;
}

function publicMember(user: ReturnType<typeof listUsers>[number], actorId: string) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    organization: user.organization,
    role: user.role,
    status: user.status,
    totpEnabled: user.totpEnabled === true,
    sessions: countSessionsForUser(user.id),
    joined: user.createdAt,
    currentAccount: user.id === actorId,
  };
}

export async function GET(req: NextRequest) {
  const actor = await requireUser(req);
  if (!actor) return NextResponse.json({ error: "Sign in to manage workspace access." }, { status: 401 });
  if (!can(actor.role, "view_oversight")) {
    return NextResponse.json({ error: "Oversight access is limited to owners, admins and auditors." }, { status: 403 });
  }

  const invites = listInvites(100);
  const now = Date.now();
  const canManagePeople = can(actor.role, "manage_people");
  const invitesView = invites.map((inv) => ({
    id: inv.id,
    /* A live invite code is a credential. Auditors may read that an invite
       exists, but not the secret that would let them claim it. */
    code: canManagePeople && inv.status === "PENDING" ? inv.code : null,
    email: inv.email,
    role: inv.role,
    status: inv.status,
    inviterName: inv.inviterName,
    claimedByEmail: inv.claimedByEmail,
    createdAt: inv.createdAt,
    expiresInDays: Math.max(0, Math.ceil((inv.createdAt.getTime() + 14 * 86_400_000 - now) / 86_400_000)),
  }));

  return NextResponse.json({
    members: listUsers().map((u) => publicMember(u, actor.id)),
    invites: invitesView,
    canManage: canManagePeople,
    actorRole: actor.role,
  });
}

export async function POST(req: NextRequest) {
  const actor = await requireUser(req);
  if (!actor) return NextResponse.json({ error: "Sign in to invite teammates." }, { status: 401 });
  if (!can(actor.role, "manage_people")) {
    return NextResponse.json({ error: "Only owners and admins can invite people." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const requested = typeof body?.role === "string" ? body.role.toUpperCase() : "OFFICER";
  const role: WorkspaceRole = isAssignableRole(requested) ? requested : "OFFICER";
  if (!canAssignRole(actor.role, role)) {
    return NextResponse.json({ error: `An ${actor.role.toLowerCase()} cannot grant the ${role.toLowerCase()} role.` }, { status: 403 });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return NextResponse.json({ error: "That doesn't look like an email address." }, { status: 422 });
  }

  const invite = createInvite({
    code: newCode(),
    email: email || null,
    role,
    createdBy: actor.id,
    inviterName: actor.name,
  });

  return NextResponse.json(
    {
      invite: {
        id: invite.id,
        code: invite.code,
        email: invite.email,
        role: invite.role,
        status: invite.status,
        createdAt: invite.createdAt,
        expiresInDays: 14,
      },
    },
    { status: 201 }
  );
}

export async function PATCH(req: NextRequest) {
  const actor = await requireUser(req);
  if (!actor) return NextResponse.json({ error: "Sign in to manage workspace access." }, { status: 401 });
  if (!can(actor.role, "manage_people")) {
    return NextResponse.json({ error: "Only owners and admins can change workspace access." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const userId = typeof body.userId === "string" ? body.userId : "";
  const target = findUserById(userId);
  if (!target) return NextResponse.json({ error: "Workspace member not found." }, { status: 404 });

  const roleRaw = typeof body.role === "string" ? body.role.toUpperCase() : "";
  const statusRaw = typeof body.status === "string" ? body.status.toUpperCase() : "";
  const role = roleRaw && isWorkspaceRole(roleRaw) ? roleRaw : null;
  const status = statusRaw === "ACTIVE" || statusRaw === "SUSPENDED" ? statusRaw : null;
  if (!role && !status) {
    return NextResponse.json({ error: "Provide a role or a status change." }, { status: 422 });
  }
  if (target.id === actor.id) {
    return NextResponse.json({ error: "You cannot change your own role or suspend yourself. Ask another owner." }, { status: 409 });
  }
  if (target.role === "OWNER" && actor.role !== "OWNER") {
    return NextResponse.json({ error: "Only the owner can change the owner's access." }, { status: 403 });
  }
  if (role && !canAssignRole(actor.role, role)) {
    return NextResponse.json({ error: `An ${actor.role.toLowerCase()} cannot grant the ${role.toLowerCase()} role.` }, { status: 403 });
  }
  /* A workspace has one owner. The UI does not offer promotion to OWNER;
     this keeps the invariant even when the API is called directly. */
  if (role === "OWNER" && target.role !== "OWNER") {
    return NextResponse.json(
      { error: "A workspace has a single owner — ownership transfer is not available here." },
      { status: 409 },
    );
  }
  if ((status === "SUSPENDED" || (role && role !== "OWNER")) && target.role === "OWNER" && ownerCount() <= 1) {
    return NextResponse.json({ error: "The workspace must keep at least one active owner." }, { status: 409 });
  }

  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 400) : "";
  let updated = target;
  let revokedSessions = 0;
  /* Capture the old role before the store mutates the row in place — the
     governance log must read "before → after", not "after → after". */
  const previousRole = target.role;

  if (role && role !== previousRole) {
    updated = updateUserRole(target.id, role) ?? updated;
    recordOversightEvent({
      actorId: actor.id,
      actorName: actor.name,
      action: "ROLE_CHANGED",
      targetType: "USER",
      targetId: updated.id,
      targetName: updated.name,
      detail: `${previousRole} → ${role}${reason ? ` · ${reason}` : ""}`,
    });
  }

  if (status && status !== target.status) {
    updated = setUserStatus(target.id, status) ?? updated;
    if (status === "SUSPENDED") {
      revokedSessions = deleteSessionsForUser(target.id);
    }
    recordOversightEvent({
      actorId: actor.id,
      actorName: actor.name,
      action: status === "SUSPENDED" ? "USER_SUSPENDED" : "USER_REACTIVATED",
      targetType: "USER",
      targetId: updated.id,
      targetName: updated.name,
      detail: `${reason || "Access changed"}${revokedSessions ? ` · ${revokedSessions} session${revokedSessions === 1 ? "" : "s"} revoked` : ""}`,
    });
  }

  if (body.revokeSessions === true) {
    revokedSessions += deleteSessionsForUser(target.id);
    recordOversightEvent({
      actorId: actor.id,
      actorName: actor.name,
      action: "SESSIONS_REVOKED",
      targetType: "USER",
      targetId: updated.id,
      targetName: updated.name,
      detail: `${revokedSessions} session${revokedSessions === 1 ? "" : "s"} revoked${reason ? ` · ${reason}` : ""}`,
    });
  }

  return NextResponse.json({ member: publicMember(updated, actor.id), revokedSessions });
}

export async function DELETE(req: NextRequest) {
  const actor = await requireUser(req);
  if (!actor) return NextResponse.json({ error: "Sign in to manage workspace access." }, { status: 401 });
  if (!can(actor.role, "manage_people")) {
    return NextResponse.json({ error: "Only owners and admins can revoke invites." }, { status: 403 });
  }

  const inviteId = req.nextUrl.searchParams.get("inviteId") ?? "";
  if (!inviteId) return NextResponse.json({ error: "inviteId required." }, { status: 422 });

  const invite = findInviteById(inviteId);
  if (!invite) return NextResponse.json({ error: "Invite not found." }, { status: 404 });
  if (invite.status !== "PENDING") {
    return NextResponse.json({ error: `Invite already ${invite.status.toLowerCase()}.` }, { status: 409 });
  }

  updateInvite(inviteId, { status: "REVOKED" });
  recordOversightEvent({
    actorId: actor.id,
    actorName: actor.name,
    action: "INVITE_REVOKED",
    targetType: "INVITE",
    targetId: invite.id,
    targetName: invite.email ?? invite.code,
    detail: `${invite.role} invite revoked`,
  });
  return NextResponse.json({ ok: true });
}
