import { isAssignableRole, type AssignableRole, type WorkspaceRole } from "@/lib/permissions";

export type RegistrationInvite = {
  status: string;
  createdAt: Date | string;
  email: string | null;
  role: string;
};

export type RegistrationInviteResult =
  | { ok: true; invite: RegistrationInvite | null }
  | { ok: false; status: 403 | 404 | 409 | 410; error: string };

/** An invite code is an access credential: if supplied, it must resolve. */
export function validateRegistrationInvite(
  code: string,
  invite: RegistrationInvite | null,
  email: string,
  now = Date.now(),
): RegistrationInviteResult {
  if (!code) return { ok: true, invite: null };
  if (!invite) return { ok: false, status: 404, error: "This invitation code is not valid." };
  if (invite.status !== "PENDING") {
    return {
      ok: false,
      status: invite.status === "REVOKED" ? 410 : 409,
      error: invite.status === "REVOKED" ? "This invitation has been revoked." : "This invitation has already been used.",
    };
  }
  const createdAt = invite.createdAt instanceof Date ? invite.createdAt.getTime() : Date.parse(invite.createdAt);
  if (!Number.isFinite(createdAt) || now - createdAt > 14 * 86_400_000) {
    return { ok: false, status: 410, error: "This invitation has expired. Ask the workspace owner for a fresh invite." };
  }
  if (!isAssignableRole(invite.role)) {
    return { ok: false, status: 409, error: "This invitation has an invalid workspace role. Ask the workspace owner for a fresh invite." };
  }
  if (invite.email && invite.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
    return { ok: false, status: 403, error: "This invitation was issued to a different email address. Register using the address that received it." };
  }
  return { ok: true, invite };
}

export type ClaimedInviteRecord = {
  status: string;
  workspaceId?: string;
  role: string;
  claimedByEmail: string | null;
  claimedAt?: Date | string | null;
};

/** Recover the same workspace role if a verified account row is rebuilt. */
export function claimedMembershipForEmail(
  invites: readonly ClaimedInviteRecord[],
  email: string,
): { workspaceId: string; role: AssignableRole } | null {
  const normalizedEmail = email.trim().toLowerCase();
  const matches = invites
    .filter(
      (invite) =>
        invite.status === "CLAIMED" &&
        invite.claimedByEmail?.trim().toLowerCase() === normalizedEmail &&
        typeof invite.workspaceId === "string" &&
        invite.workspaceId.trim().length > 0 &&
        isAssignableRole(invite.role),
    )
    .sort((a, b) => timestamp(b.claimedAt) - timestamp(a.claimedAt));
  const match = matches[0];
  return match?.workspaceId && isAssignableRole(match.role)
    ? { workspaceId: match.workspaceId, role: match.role }
    : null;
}

function timestamp(value: Date | string | null | undefined): number {
  if (value instanceof Date) return value.getTime();
  return typeof value === "string" ? Date.parse(value) : 0;
}

/** An explicit invited role wins; only an uninvited first account owns a workspace. */
export function roleForNewWorkspaceMember(
  memberCount: number,
  requestedRole?: WorkspaceRole,
): WorkspaceRole {
  if (!Number.isInteger(memberCount) || memberCount < 0) throw new Error("Workspace member count must be a non-negative integer.");
  if (requestedRole === "OWNER" && memberCount > 0) {
    throw new Error("An existing workspace owner cannot be assigned through member creation.");
  }
  if (requestedRole) return requestedRole;
  return memberCount === 0 ? "OWNER" : "OFFICER";
}
