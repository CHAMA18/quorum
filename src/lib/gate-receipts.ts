/**
 * Gate receipts are not one shape.
 *
 * The filing executor returns `{ submissionId, hash, portal }`, but every
 * statutory cycle executor returns its own record: an opening register id and
 * sha, a payment id and amount, a complaint id and status, a completion
 * timestamp, and so on. No key is universal — a receipt may carry no hash at
 * all. This module is the one place that reads them, so a view never slices a
 * field the sidecar did not send.
 */

export type GateReceipt = {
  submissionId?: string;
  hash?: string;
  portal?: string;
  registerId?: string;
  sha?: string;
  admitted?: number;
  matrixId?: string;
  status?: string;
  recommended?: string;
  dossierId?: string;
  outcome?: string;
  recommendation?: string;
  standstillEndsAt?: string;
  debriefId?: string;
  bidder?: string;
  supplier?: string;
  value?: number;
  variationId?: string;
  pct?: number;
  paymentId?: string;
  amount?: number;
  completedAt?: string;
  complaintId?: string;
  noticeId?: string;
  published?: boolean;
  /* Receipts are extensible — a new executor must not break an older view. */
  [key: string]: unknown;
};

/* The identifier keys the executors use, in the order a receipt should state
   them. A receipt can carry exactly one of these. */
const ID_KEYS = [
  "submissionId",
  "registerId",
  "matrixId",
  "dossierId",
  "debriefId",
  "variationId",
  "paymentId",
  "complaintId",
  "noticeId",
] as const;

/** The receipt's own record id, or null when it has none. */
export function gateReceiptId(receipt: GateReceipt | null | undefined): string | null {
  if (!receipt || typeof receipt !== "object") return null;
  for (const key of ID_KEYS) {
    const value = receipt[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

/** The seal a receipt carries — `hash` on a filing, `sha` on the cycle. */
export function gateReceiptHash(receipt: GateReceipt | null | undefined): string | null {
  if (!receipt || typeof receipt !== "object") return null;
  for (const key of ["hash", "sha"] as const) {
    const value = receipt[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

/**
 * One honest line for any gate receipt: the record it names, the seal when it
 * has one, and the portal when one was told. A receipt with no id still says
 * it was filed — it never says `undefined`.
 */
export function formatGateReceipt(receipt: GateReceipt | null | undefined): string {
  if (!receipt || typeof receipt !== "object") return "RECEIPT FILED";

  const named =
    gateReceiptId(receipt) ??
    (typeof receipt.supplier === "string" && receipt.supplier.trim() ? receipt.supplier : null) ??
    (typeof receipt.bidder === "string" && receipt.bidder.trim() ? receipt.bidder : null) ??
    "RECEIPT FILED";

  const line = [named];
  const hash = gateReceiptHash(receipt);
  if (hash) line.push(`sha ${hash.slice(0, 12)}`);
  if (typeof receipt.portal === "string" && receipt.portal.trim()) line.push(receipt.portal);
  return line.join(" · ");
}
