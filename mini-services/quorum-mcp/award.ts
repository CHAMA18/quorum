/**
 * Award legality.
 *
 * The award gate used to ask one question: is the matrix certified? That is
 * necessary, not sufficient. A HIGH finding could stand against the winning
 * bid, a complaint could be running, and the bidder could have been suspended
 * between evaluation and signature — and the report would still sign.
 *
 * This module holds the fail-closed rules in one place so the pre-approval
 * check, the executor and the report composer cannot disagree:
 *
 *   - a HIGH finding is OPEN until a named human dispositions it;
 *   - a waiver is a second pair of eyes, never a silent override;
 *   - an OPEN or ESCALATED complaint suspends the contract and payment path;
 *   - the winner is revalidated against the register, the debarment list and
 *     the findings before the award is signed.
 *
 * Nothing here needs a clock, a model or the network.
 */

import { DEBARMENT_LIST } from "./debarment";
import type { Complaint, EvalMatrix, Finding, Supplier } from "./store";

export const DISPOSITION_STATUSES = ["CLEARED", "WAIVED", "RE_CHECK"] as const;

export function isDispositionStatus(value: unknown): value is NonNullable<Finding["disposition"]>["status"] {
  return value === "CLEARED" || value === "WAIVED" || value === "RE_CHECK";
}

/** A finding is open while it is HIGH and has no clearance, or was sent back. */
export function findingIsOpen(finding: Finding): boolean {
  if (finding.severity !== "HIGH") return false;
  const disposition = finding.disposition;
  if (!disposition) return true;
  return disposition.status === "RE_CHECK";
}

/** Findings that name a bidder anywhere in their own evidence. */
export function findingsAgainstBidder(findings: Finding[], bidder: string | undefined): Finding[] {
  const needle = (bidder ?? "").trim().toLowerCase();
  if (!needle) return [];
  return findings.filter((f) =>
    [f.item, f.evidence, f.citation].some((field) => field.toLowerCase().includes(needle)),
  );
}

export function openHighFindings(findings: Finding[], bidder: string | undefined): Finding[] {
  return findingsAgainstBidder(findings, bidder).filter(findingIsOpen);
}

/**
 * The award refusal. It names every open finding so the desk cannot fix "one"
 * and discover the next at the next attempt.
 */
export function awardFindingBlockReason(findings: Finding[], bidder: string | undefined): string | null {
  const open = openHighFindings(findings, bidder);
  if (!open.length) return null;
  const named = open.slice(0, 6).map((f) => `${f.id} ${f.rule}`).join(", ");
  return `${open.length} HIGH finding${open.length === 1 ? "" : "s"} against ${bidder ?? "the recommended bid"} ${open.length === 1 ? "is" : "are"} undispositioned (${named}). Clear or waive each finding at a named disposition before the award is signed.`;
}

/** Every complaint that suspends the contract and payment path. */
export function openComplaints(complaints: Complaint[]): Complaint[] {
  return complaints.filter((c) => c.status === "OPEN" || c.status === "ESCALATED");
}

export function complaintBlockReason(complaints: Complaint[]): string | null {
  const open = openComplaints(complaints);
  if (!open.length) return null;
  const named = open.slice(0, 5).map((c) => `${c.id} (${c.subject})`).join(", ");
  return `${open.length} complaint${open.length === 1 ? " is" : "s are"} still open (${named}). A complaint suspends the contract and payment path until it is ANSWERED, independently reviewed, or CLOSED.`;
}

/** A disposition needs a decision, a reason, and a second name for a waiver. */
export function dispositionReason(input: {
  status: unknown;
  note: unknown;
  by: string;
  secondedBy?: string;
}): string | null {
  if (!isDispositionStatus(input.status)) {
    return `The disposition must be CLEARED, WAIVED or RE_CHECK — "${String(input.status ?? "")}" is not a lawful disposition.`;
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (!note) {
    return "A disposition needs a stated reason — an empty reason is a silent override, not a decision.";
  }
  const by = input.by.trim();
  if (!by) return "The disposition must name the officer who made it.";
  if (input.status === "WAIVED") {
    const secondedBy = input.secondedBy?.trim() ?? "";
    if (!secondedBy) {
      return "A waiver needs a second, different officer — one signature cannot waive a HIGH finding.";
    }
    if (secondedBy.toLowerCase() === by.toLowerCase()) {
      return "A waiver needs a second, different officer — the same person cannot second their own waiver.";
    }
  }
  return null;
}

export interface AwardRevalidation {
  ok: boolean;
  winner?: string;
  blockers: string[];
  checks: {
    recommended: boolean;
    responsiveness: string | null;
    supplierStatus: string | null;
    debarment: boolean;
    openFindings: string[];
  };
}

/**
 * Revalidate the award at the moment it is signed. The evaluation is a past
 * finding; the register and the complaint book are current facts.
 */
export function revalidateAward(input: {
  matrix: EvalMatrix | undefined;
  bidder?: string;
  findings: Finding[];
  suppliers: Supplier[];
  debarment?: readonly { name: string }[];
}): AwardRevalidation {
  const blockers: string[] = [];
  const matrix = input.matrix;
  const winner =
    input.bidder?.trim() ||
    matrix?.bids
      .filter((b) => b.responsiveness === "RESPONSIVE")
      .sort((a, b) => (b.total ?? 0) - (a.total ?? 0))[0]?.bidder;
  const row = matrix?.bids.find((b) => b.bidder.toLowerCase() === (winner ?? "").toLowerCase());

  if (!matrix) blockers.push("No evaluation matrix is on record — an award cannot rest on a matrix that does not exist.");
  else if (matrix.status !== "CERTIFIED") blockers.push("The evaluation matrix is not certified — certify it before the award is signed.");
  if (!winner) blockers.push("No responsive bidder is recommended — there is nothing to award.");

  if (winner) {
    if (!row) blockers.push(`${winner} is not on the evaluation matrix — the recommendation does not reconcile to the scoring record.`);
    else if (row.responsiveness !== "RESPONSIVE" || row.verdict === "DISQUALIFIED") {
      blockers.push(`${winner} is recorded ${row.responsiveness.toLowerCase().replace(/_/g, " ")} — a non-responsive bid cannot be awarded.`);
    }
  }

  const open = openHighFindings(input.findings, winner);
  for (const finding of open) blockers.push(`${finding.id} ${finding.rule} is a HIGH finding with no disposition.`);

  const supplier = winner
    ? input.suppliers.find((s) => s.name.trim().toLowerCase() === winner.trim().toLowerCase())
    : undefined;
  const supplierStatus = supplier?.status ?? null;
  if (supplier && supplier.status !== "ACTIVE") {
    blockers.push(`${supplier.name} is ${supplier.status} on the supplier register — a suspended or blacklisted bidder cannot be awarded.`);
  }

  const register = input.debarment ?? DEBARMENT_LIST;
  const debarred = !!winner && register.some((entry) => entry.name.trim().toLowerCase() === winner.trim().toLowerCase());
  if (debarred) blockers.push(`${winner} appears on the debarment register — the award fails closed.`);

  return {
    ok: blockers.length === 0,
    ...(winner ? { winner } : {}),
    blockers,
    checks: {
      recommended: !!row && row.verdict === "RECOMMENDED",
      responsiveness: row?.responsiveness ?? null,
      supplierStatus,
      debarment: debarred,
      openFindings: open.map((f) => f.id),
    },
  };
}

/** The award report's disposition table — what was decided, by whom, why. */
export function dispositionTableRows(findings: Finding[], bidder?: string): string[] {
  const rows = findingsAgainstBidder(findings, bidder);
  if (!rows.length) return [];
  return rows.map((f) => {
    const d = f.disposition;
    const status = d?.status ?? "OPEN";
    const by = d?.by ? `${d.by}${d.secondedBy ? ` (seconded ${d.secondedBy})` : ""}` : "—";
    const reason = d?.note ? d.note.replace(/\|/g, "\\|") : "—";
    return `| ${f.id} | ${f.rule} | ${f.severity} | ${status} | ${by} | ${reason} |`;
  });
}
