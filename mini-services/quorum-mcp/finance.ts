/**
 * Contract and finance controls.
 *
 * A signed contract pack is not the contract; a raised payment is not a
 * payment. This module holds the arithmetic and the refusal reasons that make
 * the difference, so the gate, the executor, the register and the procurement
 * file all agree on what is lawful:
 *
 *   - a contract must be executed (supplier acceptance, performance security,
 *     insurance) before a payment can certify;
 *   - a payment must match an invoice, a completed milestone and a goods
 *     receipt, and its cumulative net cannot pass the contract value;
 *   - retention and withholding are exact at currency precision;
 *   - a commitment cannot overdraw its budget line;
 *   - cumulative variations cannot pass the cap.
 *
 * Legacy rows are not rewritten: a contract without an execution record is
 * treated as DRAFT (it cannot pay), and a payment without a split is treated
 * as a gross claim with zero retention.
 */

import type { BudgetLine, ContractFile, ContractPayment } from "./store";

export const MONEY_EPSILON = 0.005;

/** Currency-precision money: two decimals, no floating drift in comparisons. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface PaymentSplit {
  gross: number;
  retention: number;
  withholding: number;
  net: number;
}

/** The split a payment certificate states: gross less retention and withholding. */
export function paymentSplit(input: {
  gross: number;
  retentionPct?: number;
  withholding?: number;
}): PaymentSplit {
  const gross = roundMoney(input.gross);
  const pct = Number.isFinite(input.retentionPct) ? Math.max(0, Math.min(100, input.retentionPct ?? 0)) : 0;
  const retention = roundMoney((gross * pct) / 100);
  const withholding = roundMoney(Math.max(0, input.withholding ?? 0));
  return { gross, retention, withholding, net: roundMoney(gross - retention - withholding) };
}

/** The net of any payment, including rows written before the split existed. */
export function paymentNet(payment: ContractPayment): number {
  if (payment.net !== undefined) return roundMoney(payment.net);
  if (payment.gross !== undefined) {
    return roundMoney(payment.gross - (payment.retention ?? 0) - (payment.withholding ?? 0));
  }
  return roundMoney(payment.amount);
}

/** Contract value net of every variation already approved. */
export function effectiveContractValue(contract: ContractFile): number {
  return roundMoney(
    contract.value +
      contract.variations.filter((v) => v.status === "APPROVED").reduce((sum, v) => sum + v.valueDelta, 0),
  );
}

export function cumulativeVariationPct(contract: ContractFile, extraDelta = 0, excludeVariationId?: string): number {
  const base = contract.value;
  if (!Number.isFinite(base) || base <= 0) return extraDelta === 0 ? 0 : 100;
  /* Pending variations count against the cap too: two variations below the
     gate threshold must not stack past it while nobody is looking. */
  const committed = contract.variations
    .filter((v) => v.id !== excludeVariationId && (v.status === "APPROVED" || v.status === "PENDING"))
    .reduce((sum, v) => sum + v.valueDelta, 0);
  return Math.round((Math.abs(committed + extraDelta) / base) * 1000) / 10;
}

export function cumulativePaymentNet(contract: ContractFile, excludeId?: string): number {
  return roundMoney(
    contract.payments
      .filter((p) => p.id !== excludeId)
      .reduce((sum, p) => sum + paymentNet(p), 0),
  );
}

/** The payment cap: the contract value, less the retention held on this claim. */
export function paymentCap(contract: ContractFile, payment?: ContractPayment): number {
  const retention = payment
    ? payment.retention ??
      paymentSplit({
        gross: payment.gross ?? payment.amount,
        retentionPct: contract.retentionPct,
        withholding: 0,
      }).retention
    : 0;
  return roundMoney(effectiveContractValue(contract) - retention);
}

export interface ContractReadiness {
  ok: boolean;
  blockers: string[];
}

/** Null when the contract is an executed instrument. Fail closed on legacy rows. */
export function executionBlockReason(contract: ContractFile | undefined, nowIso = new Date().toISOString()): string | null {
  if (!contract) return "No contract is on record — there is nothing to execute.";
  if (contract.status === "EXECUTED" || contract.status === "COMPLETED") return null;
  const blockers: string[] = [];
  /* A legacy contract has no status at all: it predates execution and cannot
     become executed by inference. */
  if (contract.status === undefined) blockers.push("the contract has no execution record (LEGACY_UNEXECUTED)");
  if (!contract.supplierAcceptedAt) blockers.push("the supplier has not accepted the pack");
  if (!contract.supplierSignatory?.trim()) blockers.push("the supplier's signatory is not named");
  if (!contract.security) blockers.push("no performance security is recorded");
  else {
    if (!(contract.security.amount > 0)) blockers.push("the performance security states no amount");
    if (!contract.security.issuer?.trim()) blockers.push("the performance security names no issuer");
    if (!contract.security.validUntil || new Date(contract.security.validUntil).getTime() <= new Date(nowIso).getTime()) {
      blockers.push("the performance security has expired");
    }
  }
  if (!contract.insurance) blockers.push("no insurance is recorded");
  else {
    if (!contract.insurance.policyNo?.trim()) blockers.push("the insurance policy number is missing");
    if (!contract.insurance.validUntil || new Date(contract.insurance.validUntil).getTime() <= new Date(nowIso).getTime()) {
      blockers.push("the insurance has expired");
    }
  }
  if (!contract.packMd?.trim()) blockers.push("the signed contract pack is not on the record");
  if (!blockers.length) return null;
  return `The contract is not executed — ${blockers.join("; ")}. Record the supplier acceptance and the instruments before execution.`;
}

/** The money gate's refusal, before a human is asked to certify anything. */
export function paymentBlockReason(input: {
  contract: ContractFile | undefined;
  payment: ContractPayment | undefined;
  nowIso?: string;
}): string | null {
  const { contract, payment } = input;
  if (!contract) return "No contract is on record — a payment certifies against a contract.";
  if (contract.completedAt || contract.status === "COMPLETED") {
    return "The contract is completed — no further payment can be certified against a closed contract.";
  }
  if (contract.status !== "EXECUTED") {
    return "The contract is not executed — a payment cannot certify against a draft contract.";
  }
  const execution = executionBlockReason(contract, input.nowIso);
  if (execution) return execution;
  if (!payment) return "The payment this gate refers to is not on the contract register.";

  const net = paymentNet(payment);
  if (!(net > 0)) return "The payment's net value is zero or negative — there is nothing lawful to certify.";
  if (!payment.invoiceId?.trim()) return "A payment needs an invoice on record — no invoice, no certification.";
  if (!payment.milestoneId?.trim()) return "A payment needs a contract milestone — the money must attach to delivered scope.";
  const milestone = contract.milestones.find((m) => m.id === payment.milestoneId);
  if (!milestone) return `The payment names milestone "${payment.milestoneId}", which is not on this contract.`;
  if (milestone.status !== "DONE") return `Milestone "${milestone.title}" is still ${milestone.status} — a payment certifies only accepted delivery.`;
  if (!payment.goodsReceiptId?.trim()) {
    return "The three-way match is incomplete — an invoice, an accepted milestone and a goods/services receipt are all required.";
  }

  const already = cumulativePaymentNet(contract, payment.id);
  const cap = paymentCap(contract, payment);
  if (roundMoney(already + net) > roundMoney(cap) + MONEY_EPSILON) {
    return `The payment would take cumulative net to ${roundMoney(already + net).toLocaleString("en-US")} against a cap of ${cap.toLocaleString("en-US")} — a payment above the cap is refused, never clamped.`;
  }
  return null;
}

/** A variation above the cumulative cap needs a recorded override, not a shrug. */
export function variationBlockReason(input: {
  contract: ContractFile | undefined;
  valueDelta: number;
  capPct?: number;
  excludeVariationId?: string;
}): string | null {
  const { contract, valueDelta } = input;
  if (!contract) return "No contract is on record — a variation varies a contract.";
  if (contract.completedAt || contract.status === "COMPLETED") return "The contract is completed — a closed contract cannot be varied.";
  if (!Number.isFinite(valueDelta) || valueDelta === 0) {
    return "A variation needs a non-zero value (negative for a downward variation).";
  }
  const capPct = input.capPct ?? 25;
  const cumulative = cumulativeVariationPct(contract, valueDelta, input.excludeVariationId);
  if (cumulative > capPct) {
    return `The variation would take cumulative variations to ${cumulative}% of the contract value — above the ${capPct}% cap. A cap override needs the accounting officer and a second approver, recorded with a reason.`;
  }
  return null;
}

/** A commitment may only be created inside the line's remaining authority. */
export function commitmentBlockReason(line: BudgetLine | undefined, amount: number): string | null {
  if (!line) return "No budget line is selected — an award commits money against a budget line, not a hope.";
  if (!(amount > 0)) return "The commitment states no amount.";
  const remaining = roundMoney(line.approved - line.committed);
  if (roundMoney(line.committed + amount) > roundMoney(line.approved) + MONEY_EPSILON) {
    return `The award would commit ${roundMoney(line.committed + amount).toLocaleString("en-US")} against an approved ${line.approved.toLocaleString("en-US")} (${remaining.toLocaleString("en-US")} remaining). A budget overcommit needs the accounting officer and a second approver, recorded with a reason.`;
  }
  return null;
}

export interface CompletionInput {
  certificateId?: unknown;
  defectsLiabilityEndsAt?: unknown;
  performanceRating?: unknown;
}

/** Completion is a certificate and a defects period, not a status toggle. */
export function completionBlockReason(
  contract: ContractFile | undefined,
  input: CompletionInput,
  nowIso = new Date().toISOString(),
): string | null {
  if (!contract) return "No contract is on record — there is nothing to complete.";
  const execution = executionBlockReason(contract, nowIso);
  if (execution) return execution;
  const certificateId = typeof input.certificateId === "string" ? input.certificateId.trim() : "";
  if (!certificateId) return "Completion needs a completion certificate on record.";
  const endsAt = typeof input.defectsLiabilityEndsAt === "string" ? input.defectsLiabilityEndsAt.trim() : "";
  const ends = endsAt ? new Date(endsAt) : null;
  if (!ends || Number.isNaN(ends.getTime()) || ends.getTime() <= new Date(nowIso).getTime()) {
    return "Completion needs a defects-liability end date in the future — the liability period starts at completion.";
  }
  const rating = Number(input.performanceRating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return "Completion needs a supplier performance rating from 1 to 5.";
  }
  return null;
}
