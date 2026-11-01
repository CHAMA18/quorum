import type { WorkspaceRole } from "@/lib/permissions";

/**
 * The Control Room payload — one snapshot of every desk surface.
 *
 * Shapes here are deliberately trimmed for the console: runs carry counts and
 * attribution rather than finding prose, gates carry the seal and the signer
 * rather than the submission body, and log lines are capped. The console is a
 * control surface, not a second copy of the record.
 */

export type AdminPerson = {
  id: string;
  name: string;
  email: string;
  organization: string | null;
  role: WorkspaceRole;
  status: "ACTIVE" | "SUSPENDED";
  totpEnabled: boolean;
  sessions: number;
  joined: string;
  currentAccount: boolean;
};

export type AdminInvite = {
  id: string;
  code: string | null;
  email: string | null;
  role: WorkspaceRole;
  status: "PENDING" | "CLAIMED" | "REVOKED";
  inviterName: string;
  emailDeliveryStatus: "SENT" | "SKIPPED" | "FAILED" | null;
  createdAt: string;
  expiresInDays: number;
};

export type AdminOrganization = {
  id: string;
  name: string;
  email: string;
  registrationNo: string;
  country: string;
  legalForm: string | null;
  categories: string[];
  status: "ACTIVE" | "SUSPENDED";
  sessions: number;
  createdAt: string;
};

export type AdminAppeal = {
  id: string;
  reference: string;
  reason: string;
  status: "OPEN" | "UPHELD" | "REINSTATED";
  reviewer: string | null;
  reviewNote: string | null;
  createdAt: string;
  decidedAt: string | null;
  organization: { id: string; name: string; email: string; registrationNo: string; status: string } | null;
};

export type AdminEvent = {
  id: string;
  actorName: string;
  action: string;
  targetType: "USER" | "ORGANIZATION" | "INVITE";
  targetName: string;
  detail: string;
  createdAt: string;
};

export type AdminSupportRequest = {
  id: string;
  requesterId: string;
  requesterName: string;
  requesterEmail: string;
  source: "BARRY";
  subject: string;
  message: string;
  status: "OPEN" | "RESPONDED" | "CLOSED";
  response: string | null;
  respondedBy: string | null;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminCommitteeMember = {
  id: string;
  name: string;
  role: string;
  isChair: boolean;
  status: "PRESENT" | "EXCUSED";
  office: string;
};

export type AdminCommittee = {
  seats: number;
  required: number;
  present: number;
  members: AdminCommitteeMember[];
};

export type AdminRunModel = {
  mode?: "llm" | "template" | "mixed";
  planSource?: string | null;
  planModel?: string | null;
  draftTotal?: number;
  draftLlm?: number;
  draftTemplate?: number;
  models?: string[];
  redactions?: number;
  promptTokens?: number;
  completionTokens?: number;
};

export type AdminRun = {
  id: string;
  tenderId: string;
  status: "RUNNING" | "AWAITING_GATE" | "REJECTED" | "FILED" | "FAILED";
  startedBy: string | null;
  startedAt: string;
  updatedAt: string;
  requirements: number;
  findings: number;
  drafts: number;
  gateId: string | null;
  error: string | null;
  seal: string | null;
  sealedBy: string | null;
  decidedAt: string | null;
  model: AdminRunModel;
};

export type AdminGate = {
  id: string;
  runId: string;
  tenderId: string;
  tool: string;
  status: "PENDING" | "AWAITING_SECOND" | "APPROVED" | "REJECTED" | "EXECUTED";
  createdAt: string;
  decidedAt: string | null;
  approver: string | null;
  note: string | null;
  requiredOffice: string | null;
  receiptHash: string | null;
  signatureValid: boolean;
  stepUp: { by: string; method: string; at: string } | null;
  evidential: boolean;
  firstApproval: { by: string; at: string } | null;
  secondApprover: { by: string; at: string } | null;
};

export type AdminAuditEntry = {
  seq: number;
  id: string;
  ts: string;
  actor: string;
  server: string;
  tool: string;
  kind: string;
  status: string;
  durationMs: number;
  runId: string | null;
  inputs: string;
  outputs: string;
  prev: string | null;
  self: string | null;
};

export type AdminChainVerdict = {
  ok: boolean;
  brokenAt: number | null;
  checked: number;
  lines: number;
  segments: number;
  restarts: { line: number; seq: number; at: string; kind: string; resumedFrom: string }[];
  epochs: { n: number; sealedAt: string; reason: string; head: string; resumedFrom: string; firstLine: number }[];
  error?: string;
};

export type AdminHealth = {
  ok: boolean;
  service: string;
  version: string;
  uptimeSec: number;
  fsMcp?: { status: string; tools: number };
  agent?: { mode: "enabled" | "read-only" | "disabled"; storage: string };
  graphs: string[];
  /** Health is version-skewed by nature: a sidecar one build behind may not
   *  publish residency rules or a governance posture. Absent means "this build
   *  does not say", which the console renders as such rather than guessing. */
  model: {
    configured: boolean;
    mode: string;
    model: string | null;
    provider: string;
    providerLabel: string;
    endpoint: string | null;
    configuredBy: string | null;
    fallback?: { model: string; provider: string; providerLabel: string; endpoint: string | null } | null;
    residency?: { residency: string; redactOn: boolean };
    lastCall: { tool: string; model: string; source: string; at: string; runId: string | null; redactions: number } | null;
  };
  counts?: { toolCalls: number; runs: number; gates: number; pendingGates: number };
  auditSpine?: {
    logWriteFailing: boolean;
    stateSaveFailing: boolean;
    stateCorrupt: boolean;
    stateCorruptFile: string | null;
    snapshotOverwriteRefused: boolean;
    unsignedExecuted: number;
    logChainEntries: number;
    decisions: number;
    forwardedKeys: number;
  };
  governance?: {
    deploymentMode: string;
    connector: { id: string; name: string; active: boolean } | null;
    sittings: number;
    sittingQuorumFlag: boolean;
    gateKey: { source: string; keyId: string };
  };
};

export type AdminTool = {
  name: string;
  description?: string;
  kind?: string;
  irreversible?: boolean;
  inputSchema?: unknown;
  [key: string]: unknown;
};

export type AdminAnchor = Record<string, unknown> | null;

export type AdminDecision = {
  seq: number;
  at: string;
  gateId: string;
  tenderId: string;
  actor: string;
  decision: "APPROVE" | "REJECT";
  gateStatus: string;
  hash: string;
};

export type AdminOverview = {
  generatedAt: string;
  actor: {
    id: string;
    name: string;
    email: string;
    role: WorkspaceRole;
    canManagePeople: boolean;
    canManageOrgs: boolean;
    canManageRules: boolean;
    readOnly: boolean;
  };
  people: AdminPerson[];
  invites: AdminInvite[];
  organizations: AdminOrganization[];
  appeals: AdminAppeal[];
  governance: AdminEvent[];
  supportRequests: AdminSupportRequest[];
  committee: AdminCommittee;
  desk: {
    online: boolean;
    error: string | null;
    health: AdminHealth | null;
    tools: AdminTool[];
    runs: AdminRun[];
    gates: AdminGate[];
    audit: { entries: AdminAuditEntry[]; total: number; allTotal: number };
    verify: AdminChainVerdict | null;
    anchor: AdminAnchor;
    anchorCount: number;
    decisions: AdminDecision[];
    ledger: { ok: boolean; brokenAt: number | null; checked: number; lines: number; head: string } | null;
  };
};
