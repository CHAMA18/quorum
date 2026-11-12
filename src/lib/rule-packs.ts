/**
 * Configurable procurement rule packs.
 *
 * Rules used to live only as code in the sidecar engine. This module makes a
 * pack data: an institution can select a jurisdiction, inspect every rule's
 * legal reference and severity, and know which failures hard-stop a tender
 * instead of merely warning. Evaluation is pure and fail-closed: an unknown
 * pack or a malformed finding never produces a pass.
 */

export type RuleSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ProcurementRule {
  id: string;
  jurisdiction: string;
  legalReference: string;
  riskCategory: string;
  severity: RuleSeverity;
  mandatory: boolean;
  /** True when the condition must block progression, not warn. */
  hardFail: boolean;
  description: string;
}

export interface RulePack {
  id: string;
  name: string;
  currency: string;
  rules: ProcurementRule[];
}

export interface RuleFindingInput {
  ruleId: string;
  /** Present evidence text; empty means the required evidence is absent. */
  evidence?: string;
  /** Explicit officer-confirmed exception, with a named approver. */
  exceptionApprover?: string;
}

export interface RuleEvaluation {
  packId: string;
  results: Array<{
    ruleId: string;
    status: "PASS" | "FAIL" | "EXCEPTION" | "UNKNOWN_RULE";
    hardFail: boolean;
    severity: RuleSeverity;
  }>;
  hardFailures: string[];
  failures: string[];
  /** False when anything hard-failed or referenced an unknown rule. */
  canProceed: boolean;
}

const zmRules: ProcurementRule[] = [
  { id: "ZM-DOC-REQUIRED", jurisdiction: "ZM", legalReference: "ZPPA mandatory documents schedule", riskCategory: "documentation", severity: "CRITICAL", mandatory: true, hardFail: true, description: "Every mandatory bid document is present." },
  { id: "ZM-SUPPLIER-ELIGIBLE", jurisdiction: "ZM", legalReference: "ZPPA supplier eligibility", riskCategory: "eligibility", severity: "CRITICAL", mandatory: true, hardFail: true, description: "Supplier is registered and not debarred." },
  { id: "ZM-COI-CLEAR", jurisdiction: "ZM", legalReference: "Conflict-of-interest declaration", riskCategory: "integrity", severity: "HIGH", mandatory: true, hardFail: true, description: "No prohibited conflict of interest is declared." },
  { id: "ZM-OVER-BUDGET", jurisdiction: "ZM", legalReference: "Approved budget ceiling", riskCategory: "financial", severity: "HIGH", mandatory: true, hardFail: false, description: "Award value does not exceed the approved ceiling without approval." },
  { id: "ZM-STANDSTILL", jurisdiction: "ZM", legalReference: "Award standstill period", riskCategory: "procedure", severity: "MEDIUM", mandatory: true, hardFail: false, description: "Standstill is observed before contract signature." },
];

const keRules: ProcurementRule[] = [
  { id: "KE-DOC-REQUIRED", jurisdiction: "KE", legalReference: "PPADA mandatory documents schedule", riskCategory: "documentation", severity: "CRITICAL", mandatory: true, hardFail: true, description: "Every mandatory bid document is present." },
  { id: "KE-SUPPLIER-ELIGIBLE", jurisdiction: "KE", legalReference: "PPRA supplier eligibility", riskCategory: "eligibility", severity: "CRITICAL", mandatory: true, hardFail: true, description: "Supplier is registered and not debarred." },
  { id: "KE-COI-CLEAR", jurisdiction: "KE", legalReference: "Conflict-of-interest declaration", riskCategory: "integrity", severity: "HIGH", mandatory: true, hardFail: true, description: "No prohibited conflict of interest is declared." },
  { id: "KE-OVER-BUDGET", jurisdiction: "KE", legalReference: "Approved budget ceiling", riskCategory: "financial", severity: "HIGH", mandatory: true, hardFail: false, description: "Award value does not exceed the approved ceiling without approval." },
];

export const RULE_PACKS: Record<string, RulePack> = {
  ZM: { id: "ZM", name: "Zambia (ZPPA)", currency: "ZMW", rules: zmRules },
  KE: { id: "KE", name: "Kenya (PPRA)", currency: "KES", rules: keRules },
};

export function getRulePack(id: string | undefined | null): RulePack | null {
  if (!id) return null;
  return RULE_PACKS[id.toUpperCase()] ?? null;
}

export function evaluateRulePack(
  packId: string,
  findings: readonly RuleFindingInput[],
): RuleEvaluation {
  const pack = getRulePack(packId);
  if (!pack) {
    return { packId: packId ?? "", results: [], hardFailures: [], failures: [], canProceed: false };
  }
  const byId = new Map(pack.rules.map((r) => [r.id, r]));
  const results: RuleEvaluation["results"] = [];
  for (const f of findings) {
    const rule = byId.get(f.ruleId);
    if (!rule) {
      results.push({ ruleId: f.ruleId, status: "UNKNOWN_RULE", hardFail: true, severity: "CRITICAL" });
      continue;
    }
    const hasEvidence = Boolean(f.evidence && f.evidence.trim().length > 0);
    if (hasEvidence) results.push({ ruleId: rule.id, status: "PASS", hardFail: rule.hardFail, severity: rule.severity });
    else if (f.exceptionApprover && f.exceptionApprover.trim().length > 0)
      results.push({ ruleId: rule.id, status: "EXCEPTION", hardFail: rule.hardFail, severity: rule.severity });
    else results.push({ ruleId: rule.id, status: "FAIL", hardFail: rule.hardFail, severity: rule.severity });
  }
  const failures = results.filter((r) => r.status === "FAIL" || r.status === "UNKNOWN_RULE").map((r) => r.ruleId);
  const hardFailures = results.filter((r) => (r.status === "FAIL" || r.status === "UNKNOWN_RULE") && r.hardFail).map((r) => r.ruleId);
  return { packId: pack.id, results, hardFailures, failures, canProceed: hardFailures.length === 0 };
}
