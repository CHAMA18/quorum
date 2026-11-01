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
  OWNER: "Workspace owner. Manages the team, suppliers, rules, procurements, contracts and oversight; only the owner may grant Admin access.",
  ADMIN: "Workspace administrator. Manages the team, organizations, committee, rules and procurement desk, but cannot change the owner's access or grant Admin.",
  OFFICER: "Operational user. Prepares and runs procurements, manages suppliers and contracts, and may sign only when the required office and gate controls allow it.",
  COMMITTEE: "Committee user. Reads procurement files and audit records, records meeting attendance, and signs only when rostered for the required office.",
  AUDITOR: "Read-only oversight. Reviews people, organizations, procurement files and the audit trail; cannot change records or sign gates.",
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
  | "dispose_findings"
  | "manage_contracts"
  | "certify_payments"
  | "view_oversight"
  | "read_audit"
  | "read_documents";

export const CAPABILITY_DETAILS: readonly { key: Capability; label: string; description: string }[] = [
  { key: "manage_people", label: "People and invitations", description: "Invite members, assign permitted roles, suspend accounts and revoke sessions." },
  { key: "manage_orgs", label: "Organizations", description: "Review supplier organizations and decide organization appeals." },
  { key: "manage_rules", label: "Rules and system controls", description: "Change procurement guards, approval bands, policy and deployment settings." },
  { key: "manage_committee", label: "Committee roster", description: "Add, update and remove statutory committee members and offices." },
  { key: "manage_meetings", label: "Meetings", description: "Schedule sittings, record attendance and file meeting minutes." },
  { key: "manage_suppliers", label: "Supplier register", description: "Add, verify, update and suspend suppliers and review applications." },
  { key: "manage_sources", label: "Procurement sources", description: "Manage source connections, refreshes and sourcing requests." },
  { key: "run_reviews", label: "Tender preparation and evaluation", description: "Upload tender files, prepare procurements and launch or manage reviews." },
  { key: "sign_gates", label: "Gate signatures", description: "Submit a gate decision; statutory office, roster, step-up and separation-of-duties checks still apply." },
  { key: "dispose_findings", label: "Finding dispositions", description: "Record an officer's acceptance or rejection of review findings." },
  { key: "manage_contracts", label: "Contracts and variations", description: "Manage contract records, variations and contract-stage controls." },
  { key: "certify_payments", label: "Payment certification", description: "Certify payment milestones and payment evidence." },
  { key: "view_oversight", label: "Oversight console", description: "Read workspace access, organizations, governance and oversight reports." },
  { key: "read_audit", label: "Audit trail", description: "Read audit events and decision records." },
  { key: "read_documents", label: "Procurement files", description: "Read tender documents, evaluation files, gates and procurement records." },
];

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
  /* A disposition is a decision about a finding, not a review run: the
     committee may propose one, but the desk's officers own the award file. */
  dispose_findings: ["OWNER", "ADMIN", "OFFICER"],
  manage_contracts: ["OWNER", "ADMIN", "OFFICER"],
  certify_payments: ["OWNER", "ADMIN", "OFFICER"],
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

function withinPath(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function isAdminRole(role: WorkspaceRole | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Owners can grant any assignable role; admins can grant non-admin roles only. */
export function canAssignRole(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  if (!isAssignableRole(target)) return false;
  if (actor === "OWNER") return true;
  if (actor === "ADMIN") return target === "OFFICER" || target === "COMMITTEE" || target === "AUDITOR";
  return false;
}

/**
 * The same-origin sidecar gateway: which workspace role may read a given
 * sidecar path. Every read now needs a session; this decides whether that
 * session may see the particular surface. An auditor sees the audit trail and
 * the file, not the rule configuration; only the desk's administrators do.
 */
export function canReadSidecar(role: WorkspaceRole | null | undefined, path: string): boolean {
  if (!role) return false;
  if (["/api/agent-mode", "/api/guards", "/api/settings", "/api/jurisdiction", "/api/deployment", "/api/features"].some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return can(role, "manage_rules");
  if (["/api/portal-state", "/api/portal-connect", "/api/portal-links", "/api/ocp-refresh", "/api/source-requests"].some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return can(role, "manage_sources");
  }
  if (withinPath(path, "/api/suppliers")) return can(role, "manage_suppliers") || role === "AUDITOR" || role === "COMMITTEE";
  /* Bidder identities and offer amounts are restricted to the desk until the
     evaluation process makes them part of the committee record. */
  if (withinPath(path, "/api/applications")) return can(role, "manage_suppliers");
  if (withinPath(path, "/api/log") || withinPath(path, "/api/decisions")) return can(role, "read_audit");
  if (path === "/api/governance" || path.startsWith("/api/governance/")) return can(role, "view_oversight");
  if (path === "/api/eval/summary") return can(role, "view_oversight");
  if (withinPath(path, "/api/sittings")) return can(role, "manage_meetings") || can(role, "view_oversight");
  if (withinPath(path, "/api/exceptions")) return can(role, "run_reviews") || can(role, "view_oversight");
  if (path === "/api/ocp-refresh" || path.startsWith("/api/ocp-refresh/")) return can(role, "manage_sources");

  /* Read-only reference and procurement records are available to every desk
     role. Unknown sidecar paths are refused until explicitly classified. */
  if ([
    "/api/health", "/api/tools", "/api/architecture", "/api/sample-tenders",
    "/api/methods", "/api/egp-status", "/api/zppa-roll", "/api/ocds-feed",
    "/api/ocp-africa", "/api/marketplace", "/api/rulepacks",
  ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return can(role, "read_documents");
  if ([
    "/api/runs", "/api/gates", "/api/receipts", "/api/tenders", "/api/documents",
    "/api/cycle", "/api/budget-lines", "/api/procurement-file", "/api/pipeline",
  ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return can(role, "read_documents");
  if (path === "/api/rule-catalogue") return can(role, "view_oversight");
  return false;
}

/**
 * The same-origin sidecar gateway: which workspace role may perform a mutation
 * on a given sidecar path. A new path stays closed until its capability is
 * deliberately classified here.
 */
export function canMutateSidecar(
  role: WorkspaceRole | null | undefined,
  method: string,
  path: string,
): boolean {
  if (!role) return false;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  if (/^\/api\/agent-mode$/.test(path)) return can(role, "manage_rules");
  if (/^\/api\/gates\/[^/]+\/decision$/.test(path)) return can(role, "sign_gates");
  /* Exceptions are requested by the desk; approval itself is a gate decision
     for the accounting officer (the sidecar enforces the office). */
  if (withinPath(path, "/api/exceptions")) return can(role, "run_reviews");
  /* Document register upkeep: OCR review confirmations and archiving. */
  if (withinPath(path, "/api/documents")) return can(role, "run_reviews");
  if (["/api/guards", "/api/settings", "/api/jurisdiction", "/api/deployment", "/api/features", "/api/governance/bands", "/api/governance/signoff"].some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return can(role, "manage_rules");
  if (["/api/portal-state", "/api/portal-connect", "/api/portal-links", "/api/source-requests", "/api/ocp-refresh"].some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return can(role, "manage_sources");
  if (withinPath(path, "/api/sittings") || path === "/api/pack-binding") return can(role, "manage_meetings");
  if (withinPath(path, "/api/budget-lines")) return can(role, "run_reviews");
  if (/\/findings\/[^/]+\/(?:dispose|review)$/.test(path)) return can(role, "dispose_findings");
  if (/\/contract\/payments$/.test(path)) return can(role, "certify_payments");
  if (/\/contract(\/|$)/.test(path)) return can(role, "manage_contracts");
  if (["/api/suppliers", "/api/applications"].some((prefix) => withinPath(path, prefix))) return can(role, "manage_suppliers");
  if (["/api/runs", "/api/tenders", "/api/tender-uploads", "/api/tender-deletions", "/api/pipeline", "/api/procurement-file", "/api/cycle"].some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return can(role, "run_reviews");
  if (path === "/api/tender-downloads") return can(role, "read_documents");

  /* A newly added sidecar mutation stays unavailable until its capability is
     deliberately classified here. Audit-forwarding endpoints are server-only
     and are called directly by trusted route handlers, never through this
     browser-facing gateway. */
  return false;
}
