/**
 * Workspace roles and capabilities.
 *
 * These roles govern the officer workspace only. The supplier portal has its
 * own identity space (organization sessions), and the committee's statutory
 * offices are separate from a workspace role: a COMMITTEE member may sign a
 * gate, but only if the committee roster carries their name and office.
 *
 * The matrix is deliberately small and server-side. Hiding a button is not a
 * permission — every mutation route calls `can()` before it writes.
 */

export const WORKSPACE_ROLES = ["OWNER", "ADMIN", "OFFICER", "COMMITTEE", "AUDITOR"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const ASSIGNABLE_ROLES = ["ADMIN", "OFFICER", "COMMITTEE", "AUDITOR"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  OFFICER: "Officer",
  COMMITTEE: "Committee",
  AUDITOR: "Auditor",
};

export const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  OWNER: "Owns the workspace. Can do everything, including transferring ownership.",
  ADMIN: "Runs the desk and its governance. Cannot remove the owner.",
  OFFICER: "Prepares evaluations, manages suppliers and signs as the gavel.",
  COMMITTEE: "Reads the file and signs gates they are rostered and officed for.",
  AUDITOR: "Read-only oversight: people, organizations and the audit trail.",
};

export type Capability =
  | "manage_people"
  | "manage_orgs"
  | "manage_rules"
  | "manage_committee"
  | "manage_meetings"
  | "manage_suppliers"
  | "manage_sources"
  | "run_reviews"
  | "sign_gates"
  | "view_oversight"
  | "read_audit"
  | "read_documents";

const MATRIX: Record<Capability, readonly WorkspaceRole[]> = {
  manage_people: ["OWNER", "ADMIN"],
  manage_orgs: ["OWNER", "ADMIN"],
  manage_rules: ["OWNER", "ADMIN"],
  manage_committee: ["OWNER", "ADMIN"],
  manage_meetings: ["OWNER", "ADMIN", "OFFICER", "COMMITTEE"],
  manage_suppliers: ["OWNER", "ADMIN", "OFFICER"],
  manage_sources: ["OWNER", "ADMIN", "OFFICER"],
  run_reviews: ["OWNER", "ADMIN", "OFFICER"],
  sign_gates: ["OWNER", "ADMIN", "OFFICER", "COMMITTEE"],
  view_oversight: ["OWNER", "ADMIN", "AUDITOR"],
  read_audit: ["OWNER", "ADMIN", "OFFICER", "COMMITTEE", "AUDITOR"],
  /* Committee members read the file before signing; auditors read it for
     oversight. Downloading is read-only and does not expose a mutation. */
  read_documents: ["OWNER", "ADMIN", "OFFICER", "COMMITTEE", "AUDITOR"],
};

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function isAssignableRole(value: unknown): value is AssignableRole {
  return typeof value === "string" && (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}

export function can(role: WorkspaceRole | null | undefined, capability: Capability): boolean {
  return !!role && MATRIX[capability].includes(role);
}

export function isAdminRole(role: WorkspaceRole | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Owners can make anyone anything; admins can grant non-admin roles only. */
export function canAssignRole(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  if (actor === "OWNER") return true;
  if (actor === "ADMIN") return target === "OFFICER" || target === "COMMITTEE" || target === "AUDITOR";
  return false;
}

/**
 * The same-origin sidecar gateway: which workspace role may perform a mutation
 * on a given sidecar path. Reads stay open to authenticated desk users; the
 * irreversible and configuration surfaces are the ones that matter.
 */
export function canMutateSidecar(
  role: WorkspaceRole | null | undefined,
  method: string,
  path: string,
): boolean {
  if (!role) return false;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  if (/^\/api\/gates\/[^/]+\/decision$/.test(path)) return can(role, "sign_gates");
  /* Governance configuration (approval bands, sign-off) is rule-keeping. */
  if (path.startsWith("/api/governance")) return can(role, "manage_rules");
  /* Exceptions are requested by the desk; approval itself is a gate decision
     for the accounting officer (the sidecar enforces the office). */
  if (path.startsWith("/api/exceptions")) return can(role, "run_reviews");
  /* Document register upkeep: OCR review confirmations and archiving. */
  if (path.startsWith("/api/documents")) return can(role, "run_reviews");
  if (path.startsWith("/api/guards") || path.startsWith("/api/portal-state") || path.startsWith("/api/settings")) {
    return can(role, "manage_rules");
  }
  if (path.startsWith("/api/suppliers") || path.startsWith("/api/applications")) {
    return can(role, "manage_suppliers");
  }
  if (path.startsWith("/api/source-requests") || path.startsWith("/api/pack-binding")) {
    return can(role, "manage_sources");
  }
  if (
    path.startsWith("/api/runs") ||
    path.startsWith("/api/tenders") ||
    path.startsWith("/api/pipeline") ||
    path.startsWith("/api/procurement-file")
  ) {
    return can(role, "run_reviews");
  }

  /* Any other sidecar mutation is an evaluation action. Read-only roles are
     refused by default rather than being allowed through an unmapped path. */
  return can(role, "run_reviews");
}
