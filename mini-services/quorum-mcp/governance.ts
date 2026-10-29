/**
 * governance.ts — Phase 1: the authority model the desk runs on.
 *
 * The role/capability matrix is code and lives in the web app
 * (src/lib/permissions.ts). This module is the second half of the authority
 * picture:
 *
 *   1. The ACTION CATALOGUE — every governed action the platform can perform,
 *      mapped to the workspace role that may attempt it, the statutory office
 *      whose signature registers it, the value band that escalates it, and the
 *      evidence the act must leave behind. This is the "who may do what" table
 *      an auditor asks for first.
 *
 *   2. The SEPARATION-OF-DUTIES rules — which role pairs may never sit alone
 *      on the same decision, and how the platform enforces that (the roster,
 *      the COI gate, the office gates).
 *
 *   3. The approval BANDS — persisted configuration (state.governance), seeded
 *      with plainly-marked illustrative defaults that the operational owner
 *      confirms or replaces. Changing a band is a logged governance act, not a
 *      quiet settings edit.
 *
 * Nothing in this module executes a decision. It exists so the platform can
 * ANSWER the governance questions precisely, and so the desk's own UI can show
 * the authority picture instead of leaving it in a slide deck.
 */

import { appendLog, saveState, shaOf, state, type Office } from "./store";

/* ── 1. The action catalogue ─────────────────────────────────────────────── */

export interface GovernedAction {
  id: string;
  action: string;
  /** Workspace role that may attempt the action (permissions.ts capability). */
  role: string;
  capability: string;
  /** Statutory office whose signature registers the act — null when no gate. */
  office: Office | null;
  /** Whether the act rides a gate: raise → named human → step-up → receipt. */
  gated: boolean;
  /** When the act escalates to a higher office (value bands, exceptions). */
  escalation: string;
  /** The administrative/legal basis, stated as an act + topic — never an invented section number. */
  basis: string;
  /** What the record must show afterwards. */
  evidence: string;
}

export const ACTION_CATALOGUE: GovernedAction[] = [
  {
    id: "act-review-run",
    action: "Prepare a tender review (run the agent)",
    role: "Officer (and above)",
    capability: "run_reviews",
    office: null,
    gated: false,
    escalation: "Findings are advisory; nothing files without the filing gate.",
    basis: "Platform policy — AI is advisory only; every recommendation remains a draft.",
    evidence: "Hash-chained run log with model attribution and per-finding citations.",
  },
  {
    id: "act-file-submission",
    action: "File a review submission",
    role: "Officer (and above)",
    capability: "run_reviews",
    office: null,
    gated: true,
    escalation: "Filing always waits on a signed gate.",
    basis: "Platform policy — no autonomous filing workflow exists.",
    evidence: "Gate receipt (Ed25519) + sealed bundle hash (SUB record).",
  },
  {
    id: "act-record-opening",
    action: "Record and certify the bid opening",
    role: "Officer (and above) prepares; register certifies",
    capability: "run_reviews",
    office: "PROCUREMENT_UNIT",
    gated: true,
    escalation: "Certification requires the procurement unit's office.",
    basis: "Public Procurement Act No. 8 of 2023 (Zambia) — bid opening and registration of bidders.",
    evidence: "Opening register with SHA-256 at certification; per-bid receipt times.",
  },
  {
    id: "act-coi",
    action: "Declare a conflict of interest",
    role: "Every PRESENT committee member",
    capability: "sign_gates",
    office: null,
    gated: false,
    escalation: "Certification of the evaluation is BLOCKED while any PRESENT member has not declared.",
    basis: "Public Procurement Act No. 8 of 2023 (Zambia) — conflict of interest disclosure.",
    evidence: "COI declaration rows (member, declaration, declaredAt) on the tender cycle.",
  },
  {
    id: "act-certify-evaluation",
    action: "Certify the evaluation matrix",
    role: "Committee (evaluation office)",
    capability: "sign_gates",
    office: "EVALUATION_COMMITTEE",
    gated: true,
    escalation: "Blocked until every PRESENT member has declared COI; scoring frozen once CERTIFIED.",
    basis: "Public Procurement Act No. 8 of 2023 (Zambia) — evaluation committee functions.",
    evidence: "Certified matrix (weights, responsiveness, MED adjustments) + gate receipt.",
  },
  {
    id: "act-resolve-alb",
    action: "Resolve an abnormal low bid (ALB) dossier",
    role: "Committee (evaluation office)",
    capability: "sign_gates",
    office: "EVALUATION_COMMITTEE",
    gated: true,
    escalation: "Resolution follows the committee's own evidence review.",
    basis: "Public Procurement Act No. 8 of 2023 (Zambia) — abnormally low bids.",
    evidence: "ALB dossier with letter, 5-working-day clock, resolution + gate id.",
  },
  {
    id: "act-sign-award",
    action: "Sign the award report (recommend award)",
    role: "Committee prepares; accounting officer signs",
    capability: "sign_gates",
    office: "ACCOUNTING_OFFICER",
    gated: true,
    escalation: "Refused while the evaluation matrix is still a DRAFT; value bands may raise the office.",
    basis: "Public Procurement Act No. 8 of 2023 (Zambia) — award of procurement contracts.",
    evidence: "Signed award report (md + sha) + gate receipt; dissents carried on the cycle.",
  },
  {
    id: "act-publish-notice",
    action: "Publish the award notice (starts standstill)",
    role: "Accounting officer",
    capability: "sign_gates",
    office: "ACCOUNTING_OFFICER",
    gated: true,
    escalation: "Refused until the award report is signed; execution starts the 10-day standstill.",
    basis: "Public Procurement Act No. 8 of 2023 (Zambia) — standstill period before contract signature.",
    evidence: "Published notice (md + sha + portal) + standstill window on the cycle.",
  },
  {
    id: "act-sign-contract",
    action: "Sign the contract pack",
    role: "Accounting officer",
    capability: "sign_gates",
    office: "ACCOUNTING_OFFICER",
    gated: true,
    escalation: "Refused while the standstill is ACTIVE; contract value must be present and positive.",
    basis: "Public Procurement Act No. 8 of 2023 (Zambia) — entry into force of procurement contracts.",
    evidence: "Contract file opened from the gate with value, pack md and security records.",
  },
  {
    id: "act-approve-variation",
    action: "Approve a contract variation",
    role: "Accounting officer",
    capability: "sign_gates",
    office: "ACCOUNTING_OFFICER",
    gated: true,
    escalation: "Variations ≥10% of the contract value go to the gate; smaller ones are recorded with the officer's name.",
    basis: "Public Procurement Act No. 8 of 2023 (Zambia) — contract variations.",
    evidence: "Variation row (value delta, % of contract, decidedBy) + gate receipt when gated.",
  },
  {
    id: "act-certify-payment",
    action: "Certify a contract payment",
    role: "Accounting officer",
    capability: "sign_gates",
    office: "ACCOUNTING_OFFICER",
    gated: true,
    escalation: "Every payment certification rides a gate.",
    basis: "Public Procurement Act No. 8 of 2023 (Zambia) — payment certification.",
    evidence: "Payment row (amount, certifiedBy, gate id).",
  },
  {
    id: "act-exception",
    action: "Register a procurement exception (single-source, emergency, direct award, non-compliance, correction)",
    role: "Officer requests; accounting officer disposes",
    capability: "run_reviews",
    office: "ACCOUNTING_OFFICER",
    gated: true,
    escalation: "EVERY exception approval rides the gate with the accounting officer's office — no fast lane.",
    basis: "Public Procurement Act No. 8 of 2023 (Zambia) — methods that depart from open bidding require justification and higher approval.",
    evidence: "Exception register row (justification, evidence list, gate receipt, named decider).",
  },
  {
    id: "act-supplier-register",
    action: "Register, suspend or blacklist a supplier",
    role: "Officer (and above)",
    capability: "manage_suppliers",
    office: null,
    gated: false,
    escalation: "Debarment matches flag as HIGH findings; registry cross-check refuses suspended/blacklisted bidders at evaluation.",
    basis: "Public Procurement Act No. 8 of 2023 (Zambia) — supplier registration and debarment.",
    evidence: "Supplier rows with status, addedBy; debarment findings cite the register.",
  },
  {
    id: "act-override-guard",
    action: "Override a system guard (price variance, checklist strictness, registry cross-check)",
    role: "Admin (and above)",
    capability: "manage_rules",
    office: null,
    gated: false,
    escalation: "Guard changes are logged with the actor and timestamp; findings already raised are never silently rewritten.",
    basis: "Platform policy — engine guards are configuration, and their change history is auditable.",
    evidence: "Guards row (updatedAt, updatedBy) + tool-log entries.",
  },
  {
    id: "act-governance-config",
    action: "Change approval bands or record governance sign-off",
    role: "Admin (and above)",
    capability: "manage_rules",
    office: null,
    gated: false,
    escalation: "Band changes re-derive which office approves future awards; the previous value stays in the log.",
    basis: "Platform policy — thresholds are configuration the operational owner owns and can be asked about.",
    evidence: "Governance config (updatedAt, updatedBy) + tool-log entries; sign-off carries the signer and scope.",
  },
  {
    id: "act-oversight",
    action: "Suspend an organization, revoke sessions, change roles",
    role: "Admin/Owner; auditors see the trail",
    capability: "manage_orgs",
    office: null,
    gated: false,
    escalation: "Suspension requires a written reason (≥4 chars) and revokes live sessions immediately.",
    basis: "Platform policy — workspace oversight with reasons on the record.",
    evidence: "Oversight events (actor, action, target, detail) in the workspace store.",
  },
  {
    id: "act-audit-read",
    action: "Read the audit trail, verify the chain, verify receipts",
    role: "Every signed-in role (auditor included)",
    capability: "read_audit",
    office: null,
    gated: false,
    escalation: "Chain verification recomputes every link; receipt verification checks Ed25519 offline.",
    basis: "Platform policy — audit is read-only and open to the oversight role.",
    evidence: "/api/log/verify verdicts; per-gate receipt verification.",
  },
];

/* ── 2. Separation of duties ─────────────────────────────────────────────── */

export interface DutiesRule {
  id: string;
  rule: string;
  enforcement: string;
  enforcedBy: string;
}

export const DUTIES_RULES: DutiesRule[] = [
  {
    id: "sod-evaluator-approver",
    rule: "The officer who prepares an evaluation is not, by that fact, its approver.",
    enforcement: "Certification requires a PRESENT roster member holding the EVALUATION_COMMITTEE office (or the attested gavel); the office check reads the register, not the UI.",
    enforcedBy: "Sidecar preApprovalCheck — fail-closed on unknown names.",
  },
  {
    id: "sod-award-independence",
    rule: "Material awards carry independent committee review before the accounting officer signs.",
    enforcement: "sign_award_report is refused while the matrix is DRAFT; publish_award_notice is refused until the report is signed; the matrix itself cannot certify without the full roll's COI declarations.",
    enforcedBy: "Cycle preconditions + office gates + quorum check.",
  },
  {
    id: "sod-coi",
    rule: "No member may sit on a decision they have not declared conflicts for.",
    enforcement: "The certify_evaluation gate is BLOCKED while any PRESENT member lacks a COI declaration; excused members are exempt by the roll.",
    enforcedBy: "Cycle preconditions.",
  },
  {
    id: "sod-exception",
    rule: "The officer who requests an exception never approves it.",
    enforcement: "Exception approval is a gate for the ACCOUNTING_OFFICER office; the requester's attested identity rides the gate inputs, and the approver must hold the office or be the gavel.",
    enforcedBy: "Exception gate + office check + step-up re-auth.",
  },
  {
    id: "sod-audit-readonly",
    rule: "The auditor sees everything and changes nothing.",
    enforcement: "The AUDITOR role holds read capabilities only; every mutation route re-checks can() server-side and the sidecar refuses unsealed mutations.",
    enforcedBy: "permissions.ts + gateway canMutateSidecar (fail-closed) + sidecar attestation.",
  },
  {
    id: "sod-single-human",
    rule: "No irreversible act has a single, unattested human point of failure.",
    enforcement: "Irreversible acts require: quorum roll + office match + fresh step-up (password or TOTP) + (for awards) wet-ink + Ed25519 receipt. The roll is recomputed from member rows, never trusted from a published count.",
    enforcedBy: "decideGate pipeline.",
  },
];

/* ── 3. Approval bands — persisted configuration ─────────────────────────── */

export function governanceSnapshot() {
  return {
    actions: ACTION_CATALOGUE,
    duties: DUTIES_RULES,
    bands: state.governance.bands,
    signedOff: state.governance.signedOff ?? null,
    updatedAt: state.governance.updatedAt ?? null,
    updatedBy: state.governance.updatedBy ?? null,
    /* Where the bands are enforced: the value-band check runs on award and
       exception flows that carry a value, and reports the office the band
       names. Bands are advisory-until-confirmed: an unconfirmed configuration
       says so on every read. */
    confirmed: !!state.governance.signedOff,
    note: state.governance.signedOff
      ? `Approved by ${state.governance.signedOff.by} at ${state.governance.signedOff.at} — scope: ${state.governance.signedOff.scope}.`
      : "Illustrative defaults — the operational owner has not signed off this configuration yet.",
  };
}

const CURRENCY_RE = /^[A-Z]{3}$/;

/** Resolve the office that must approve a value, or null when no band matches. */
export function approvalOfficeFor(amount: number, currency?: string): { office: Office; bandId: string; label: string } | null {
  if (!Number.isFinite(amount) || amount < 0) return null;
  const bands = state.governance.bands;
  const match =
    bands.find((b) => b.currency === (currency ?? "ZMW") && amount >= b.min && (b.max === undefined || amount <= b.max)) ??
    bands.find((b) => b.currency === (currency ?? "ZMW"));
  if (!match) return null;
  return { office: match.approvalOffice, bandId: match.id, label: match.label };
}

const BAND_ID_RE = /^[a-z0-9-]{3,40}$/;

export function updateBands(
  actor: string,
  bands: Array<{ id?: unknown; label?: unknown; currency?: unknown; min?: unknown; max?: unknown; approvalOffice?: unknown; note?: unknown }>,
): { ok: true } | { ok: false; error: string; code: number } {
  if (!Array.isArray(bands) || bands.length === 0 || bands.length > 12) {
    return { ok: false, error: "bands must be a non-empty array (max 12)", code: 422 };
  }
  const offices: Office[] = ["PROCUREMENT_UNIT", "EVALUATION_COMMITTEE", "ACCOUNTING_OFFICER", "OVERSIGHT"];
  const cleaned = bands.map((b, i) => {
    const id = typeof b.id === "string" && BAND_ID_RE.test(b.id) ? b.id : `band-${i + 1}`;
    const label = String(b.label ?? `Band ${i + 1}`).trim().slice(0, 80) || `Band ${i + 1}`;
    const currency = typeof b.currency === "string" && CURRENCY_RE.test(b.currency) ? b.currency : "ZMW";
    const min = Number(b.min);
    const max = b.max === undefined || b.max === null ? undefined : Number(b.max);
    const office = offices.includes(b.approvalOffice as Office) ? (b.approvalOffice as Office) : null;
    if (!office) {
      throw new Error(`band ${id}: approvalOffice must be one of ${offices.join(", ")}`);
    }
    if (!Number.isFinite(min) || min < 0) {
      throw new Error(`band ${id}: min must be a non-negative number`);
    }
    if (max !== undefined && (!Number.isFinite(max) || max < min)) {
      throw new Error(`band ${id}: max must be a number ≥ min`);
    }
    return {
      id,
      label,
      currency,
      min,
      ...(max !== undefined ? { max } : {}),
      approvalOffice: office,
      ...(typeof b.note === "string" && b.note.trim() ? { note: b.note.trim().slice(0, 300) } : {}),
    };
  });
  /* Overlap sanity: bands of the same currency must not leave a value with two offices ambiguous. */
  const byCurrency = new Map<string, { min: number; max?: number }[]>();
  for (const b of cleaned) {
    const list = byCurrency.get(b.currency) ?? [];
    list.push({ min: b.min, max: b.max });
    byCurrency.set(b.currency, list);
  }
  for (const [currency, list] of byCurrency) {
    const sorted = [...list].sort((a, b) => a.min - b.min);
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      if (prev.max === undefined) {
        return { ok: false, error: `band overlap in ${currency}: an unbounded band precedes band starting at ${sorted[i].min}`, code: 422 };
      }
    }
  }
  state.governance.bands = cleaned;
  state.governance.updatedAt = new Date().toISOString();
  state.governance.updatedBy = actor;
  saveState();
  appendLog({
    actor,
    server: "quorum-mcp",
    tool: "governance_bands_update",
    kind: "WRITES",
    inputs: { count: cleaned.length },
    outputs: { bands: cleaned.map((b) => ({ id: b.id, currency: b.currency, min: b.min, max: b.max ?? null, office: b.approvalOffice })) },
    status: "OK",
    durationMs: 0,
  });
  return { ok: true };
}

export function recordSignoff(actor: string, scope: string): { by: string; at: string; scope: string } {
  const cleanScope = scope.trim().slice(0, 200) || "governance and control foundation";
  const signoff = { by: actor, at: new Date().toISOString(), scope: cleanScope };
  state.governance.signedOff = signoff;
  saveState();
  appendLog({
    actor,
    server: "quorum-mcp",
    tool: "governance_signoff",
    kind: "IRREVERSIBLE",
    inputs: { scope: cleanScope },
    outputs: { signedOff: signoff, configSha: shaOf(state.governance) },
    status: "OK",
    durationMs: 0,
  });
  return signoff;
}
