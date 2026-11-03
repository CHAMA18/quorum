import { describe, expect, test } from "bun:test";
import {
  ASSIGNABLE_ROLES,
  CAPABILITY_DETAILS,
  WORKSPACE_ROLES,
  can,
  canAssignRole,
  canMutateSidecar,
  canReadSidecar,
} from "@/lib/permissions";

describe("workspace RBAC", () => {
  test("every defined capability is assigned through the canonical matrix", () => {
    expect(CAPABILITY_DETAILS).toHaveLength(15);
    for (const capability of CAPABILITY_DETAILS) {
      for (const role of WORKSPACE_ROLES) expect(typeof can(role, capability.key)).toBe("boolean");
    }
    expect(can("OWNER", "manage_people")).toBe(true);
    expect(can("ADMIN", "manage_people")).toBe(true);
    expect(can("OFFICER", "manage_people")).toBe(false);
    expect(can("COMMITTEE", "manage_suppliers")).toBe(false);
    expect(can("AUDITOR", "read_audit")).toBe(true);
    expect(can("AUDITOR", "run_reviews")).toBe(false);
  });

  test("role assignment cannot create another owner or let an admin grant admin", () => {
    expect(ASSIGNABLE_ROLES).not.toContain("OWNER");
    expect(canAssignRole("OWNER", "ADMIN")).toBe(true);
    expect(canAssignRole("OWNER", "OWNER")).toBe(false);
    expect(canAssignRole("ADMIN", "OFFICER")).toBe(true);
    expect(canAssignRole("ADMIN", "ADMIN")).toBe(false);
    expect(canAssignRole("ADMIN", "OWNER")).toBe(false);
    expect(canAssignRole("OFFICER", "AUDITOR")).toBe(false);
  });

  test("read access is role-scoped and unknown sidecar paths fail closed", () => {
    expect(canReadSidecar("AUDITOR", "/api/log/export")).toBe(true);
    expect(canReadSidecar("AUDITOR", "/api/guards")).toBe(false);
    expect(canReadSidecar("OFFICER", "/api/runs")).toBe(true);
    expect(canReadSidecar("OFFICER", "/api/observability")).toBe(true);
    expect(canReadSidecar("AUDITOR", "/api/traces/12345678-1234-1234-1234-123456789012")).toBe(true);
    expect(canReadSidecar("COMMITTEE", "/api/observability")).toBe(true);
    expect(canReadSidecar("OFFICER", "/api/governance")).toBe(false);
    expect(canReadSidecar("COMMITTEE", "/api/applications")).toBe(false);
    expect(canReadSidecar("COMMITTEE", "/api/tenders/TC-01/compliance")).toBe(true);
    expect(canReadSidecar("OFFICER", "/api/unclassified-secret")).toBe(false);
    expect(canReadSidecar("OFFICER", "/api/logbook")).toBe(false);
    expect(canReadSidecar(null, "/api/runs")).toBe(false);
  });

  test("mutations require an explicit capability mapping", () => {
    expect(canMutateSidecar("OFFICER", "POST", "/api/runs")).toBe(true);
    expect(canMutateSidecar("AUDITOR", "POST", "/api/runs")).toBe(false);
    expect(canMutateSidecar("COMMITTEE", "POST", "/api/gates/gate-1/decision")).toBe(true);
    expect(canMutateSidecar("AUDITOR", "POST", "/api/gates/gate-1/decision")).toBe(false);
    expect(canMutateSidecar("OFFICER", "POST", "/api/unclassified/write")).toBe(false);
    expect(canMutateSidecar("OWNER", "POST", "/api/audit/read")).toBe(false);
    expect(canMutateSidecar("OFFICER", "POST", "/api/documents-admin/archive")).toBe(false);
    expect(canMutateSidecar(null, "POST", "/api/runs")).toBe(false);
  });
});
