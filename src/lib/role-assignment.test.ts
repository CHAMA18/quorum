import { describe, expect, test } from "bun:test";
import {
  claimedMembershipForEmail,
  roleForNewWorkspaceMember,
  validateRegistrationInvite,
} from "@/lib/role-assignment";

const NOW = Date.parse("2026-11-01T12:00:00.000Z");

describe("workspace role assignment during authentication", () => {
  test("a supplied registration invite must be valid and recipient-bound", () => {
    expect(validateRegistrationInvite("", null, "new@example.com", NOW)).toEqual({ ok: true, invite: null });
    expect(validateRegistrationInvite("Q-INVALID", null, "new@example.com", NOW)).toMatchObject({ ok: false, status: 404 });
    expect(validateRegistrationInvite("Q-USED", {
      status: "CLAIMED", createdAt: new Date(NOW), email: "new@example.com", role: "OFFICER",
    }, "new@example.com", NOW)).toMatchObject({ ok: false, status: 409 });
    expect(validateRegistrationInvite("Q-OLD", {
      status: "PENDING", createdAt: new Date(NOW - 15 * 86_400_000), email: null, role: "OFFICER",
    }, "new@example.com", NOW)).toMatchObject({ ok: false, status: 410 });
    expect(validateRegistrationInvite("Q-OTHER", {
      status: "PENDING", createdAt: new Date(NOW), email: "person@example.com", role: "OFFICER",
    }, "new@example.com", NOW)).toMatchObject({ ok: false, status: 403 });
  });

  test("the role stored on a valid invite is preserved, including for an empty recovered workspace", () => {
    const invite = { status: "PENDING", createdAt: new Date(NOW), email: "new@example.com", role: "COMMITTEE" };
    const result = validateRegistrationInvite("Q-COMMITTEE", invite, "NEW@example.com", NOW);
    expect(result).toEqual({ ok: true, invite });
    expect(roleForNewWorkspaceMember(3, "COMMITTEE")).toBe("COMMITTEE");
    expect(roleForNewWorkspaceMember(0, "AUDITOR")).toBe("AUDITOR");
    expect(roleForNewWorkspaceMember(0)).toBe("OWNER");
    expect(roleForNewWorkspaceMember(2)).toBe("OFFICER");
    expect(() => roleForNewWorkspaceMember(1, "OWNER")).toThrow("existing workspace owner");
  });

  test("verified-account recovery restores the claimed workspace and role", () => {
    const membership = claimedMembershipForEmail([
      { status: "CLAIMED", workspaceId: "workspace-7", role: "AUDITOR", claimedByEmail: "AUDIT@example.com", claimedAt: new Date(NOW) },
      { status: "PENDING", workspaceId: "workspace-8", role: "ADMIN", claimedByEmail: "audit@example.com", claimedAt: new Date(NOW + 1000) },
      { status: "CLAIMED", workspaceId: "workspace-9", role: "OWNER", claimedByEmail: "audit@example.com", claimedAt: new Date(NOW + 2000) },
    ], "audit@example.com");
    expect(membership).toEqual({ workspaceId: "workspace-7", role: "AUDITOR" });
    expect(claimedMembershipForEmail([], "nobody@example.com")).toBeNull();
  });
});
