/**
 * Procurement method control (WS6).
 *
 * The method is not a label on a form; it is the legal route the money
 * travels. Open bidding is the default, and every other route must be
 * justified in the record and signed by the accounting officer at a gate.
 * Where the law also demands the regulator's prior approval — direct or
 * limited bidding above the jurisdiction threshold, and any alternative
 * method — the approval reference must be on file before the award report
 * can even be drafted.
 *
 * Pure and fail closed. The value matters: a method lawful below a threshold
 * stops being lawful above it, and the check runs again at award with the
 * winning bid's actual value rather than the estimate.
 */

import { METHODS_BY_JURISDICTION, type ProcurementMethod } from "./methods";

/** Below this share of the law's threshold a justification only needs a name; above it, a gate too. */
export const JUSTIFICATION_MIN_CHARS = 20;

/** The value above which direct/limited bidding needs the authority's approval (ZM regulations). */
export const METHOD_AUTHORITY_THRESHOLDS: Record<string, { amount: number; currency: string }> = {
  ZM: { amount: 1_000_000, currency: "ZMW" },
};

/** Methods the law confines to a value band, regardless of justification. */
export const METHOD_VALUE_LIMITS: Record<string, Record<string, { max: number; currency: string }>> = {
  ZM: { "simplified-bidding": { max: 1_000_000, currency: "ZMW" } },
};

/** The methods that need the regulator's prior approval rather than only the entity's gate. */
export const AUTHORITY_APPROVAL_METHODS = new Set(["direct-bidding", "limited-bidding", "alternative-method"]);

/** Methods that are open to the market by advertisement — the default, no gate. */
export const OPEN_METHODS = new Set(["open-bidding"]);

export function methodsForJurisdiction(jurisdictionId: string | undefined): ProcurementMethod[] {
  return METHODS_BY_JURISDICTION[(jurisdictionId ?? "ZM").toUpperCase()] ?? [];
}

export function findMethod(jurisdictionId: string | undefined, methodId: string | undefined): ProcurementMethod | undefined {
  const id = (methodId ?? "").trim();
  if (!id) return undefined;
  return methodsForJurisdiction(jurisdictionId).find((m) => m.id === id);
}

export function methodLabel(jurisdictionId: string | undefined, methodId: string | undefined): string {
  return findMethod(jurisdictionId, methodId)?.name ?? methodId ?? "no method recorded";
}

/** The authority that must approve a method above its threshold, in plain words. */
export function authorityFor(jurisdictionId: string | undefined): string {
  return (jurisdictionId ?? "ZM").toUpperCase() === "ZM"
    ? "the Zambia Public Procurement Authority"
    : "the procurement authority for this jurisdiction";
}

/** The authority reference a method needs at this value, or null. */
export function methodAuthorityBlockReason(input: {
  methodId?: string;
  approvalRef?: string;
  value?: number;
  currency?: string;
  jurisdictionId?: string;
}): string | null {
  const jurisdiction = (input.jurisdictionId ?? "ZM").toUpperCase();
  const method = findMethod(jurisdiction, input.methodId);
  if (!method || OPEN_METHODS.has(method.id)) return null;
  const threshold = METHOD_AUTHORITY_THRESHOLDS[jurisdiction];
  const value = Number.isFinite(input.value) ? Number(input.value) : undefined;
  const aboveThreshold = !threshold || value === undefined || value > threshold.amount;
  const needsAuthority = AUTHORITY_APPROVAL_METHODS.has(method.id) && (method.id === "alternative-method" || aboveThreshold);
  if (!needsAuthority) return null;
  if ((input.approvalRef ?? "").trim()) return null;
  return `${method.name}${value !== undefined ? ` at ${input.currency ?? threshold?.currency ?? ""} ${value.toLocaleString()}` : ""} requires ${authorityFor(jurisdiction)}'s prior approval — record the approval reference before the method can be approved.`;
}

export interface MethodControlInput {
  methodId?: string;
  justification?: string;
  approvedAt?: string;
  approvalRef?: string;
  /** The tender value the method is measured against — estimate at set time, winning bid at award. */
  value?: number;
  currency?: string;
  jurisdictionId?: string;
  now?: Date;
}

/**
 * Why the recorded method is not lawful enough to award under, or null.
 * Missing method, missing justification, an unsigned method gate, an
 * out-of-band value and a missing authority reference are each named.
 */
export function methodControlBlockReason(input: MethodControlInput): string | null {
  const now = input.now ?? new Date();
  const jurisdiction = (input.jurisdictionId ?? "ZM").toUpperCase();
  const method = findMethod(jurisdiction, input.methodId);

  if (!input.methodId?.trim()) {
    return "No procurement method is recorded for this tender — choose the lawful method from the register before the award report is drafted.";
  }
  if (!method) {
    return `"${input.methodId}" is not a lawful procurement method in ${jurisdiction} — choose a method from the live method register.`;
  }

  const value = Number.isFinite(input.value) ? Number(input.value) : undefined;
  const limit = METHOD_VALUE_LIMITS[jurisdiction]?.[method.id];
  if (limit && value !== undefined && value > limit.max) {
    return `${method.name} is lawful only up to ${limit.currency} ${limit.max.toLocaleString()} — this tender is worth ${input.currency ?? limit.currency} ${value.toLocaleString()}. Use a method whose value band covers it.`;
  }

  if (OPEN_METHODS.has(method.id)) return null;

  const justification = (input.justification ?? "").trim();
  if (justification.length < JUSTIFICATION_MIN_CHARS) {
    return `A non-open method needs a stated justification of at least ${JUSTIFICATION_MIN_CHARS} characters — "${justification || "(none)"}" does not explain why competition was restricted.`;
  }

  if (!input.approvedAt || Number.isNaN(new Date(input.approvedAt).getTime())) {
    return `The ${method.name.toLowerCase()} method is not yet approved — the accounting officer must sign the method gate before the award report is drafted.`;
  }

  const authority = methodAuthorityBlockReason(input);
  if (authority) return authority;

  /* A gate approval recorded in the future is not a signature yet. */
  if (new Date(input.approvedAt).getTime() > now.getTime() + 60_000) {
    return "The method approval is dated in the future — a signature that has not happened cannot authorise today's award.";
  }

  return null;
}

/** True when the method itself needs a named-human gate before it can be relied on. */
export function methodNeedsGate(methodId: string | undefined): boolean {
  const id = (methodId ?? "").trim();
  return !!id && !OPEN_METHODS.has(id);
}

/** Everything the desk should see about the recorded method, including why it fails. */
export function methodStanding(input: MethodControlInput & { methodApprovedBy?: string }) {
  const method = findMethod(input.jurisdictionId, input.methodId);
  const block = methodControlBlockReason(input);
  return {
    methodId: input.methodId ?? null,
    name: method?.name ?? null,
    legalBasis: method?.legalBasis ?? null,
    when: method?.when ?? null,
    valueBand: method?.valueBand ?? null,
    justification: input.justification ?? null,
    approvalRef: input.approvalRef ?? null,
    approvedBy: input.methodApprovedBy ?? null,
    approvedAt: input.approvedAt ?? null,
    ok: block === null,
    block,
  };
}
