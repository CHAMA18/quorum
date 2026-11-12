/** Bid price ordering: parse opening-register price reads, sort, benchmark. Pure. */

export interface PriceRow {
  bidder: string;
  raw: string;
  currency: string | null;
  amount: number | null;
  ratioToMedian: number | null;
  outlier: "HIGH" | "LOW" | null;
}

export function parsePriceRead(raw: string | undefined): { currency: string | null; amount: number | null } {
  if (!raw) return { currency: null, amount: null };
  const m = raw.match(/([A-Z]{3})?\s*([\d][\d,]*(?:\.\d+)?)/);
  if (!m) return { currency: null, amount: null };
  const amount = Number(m[2].replace(/,/g, ""));
  return { currency: m[1] ?? null, amount: Number.isFinite(amount) ? amount : null };
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Rows sorted low-to-high; outliers flagged against the peer median. */
export function buildPriceRows(rows: { bidder: string; priceRead?: string }[]): PriceRow[] {
  const parsed = rows.map((r) => ({ bidder: r.bidder, raw: r.priceRead ?? "", ...parsePriceRead(r.priceRead) }));
  const med = median(parsed.map((p) => p.amount).filter((a): a is number => a !== null));
  return parsed
    .map((p) => {
      const ratioToMedian = p.amount !== null && med ? Number((p.amount / med).toFixed(2)) : null;
      const outlier = ratioToMedian === null ? null : ratioToMedian >= 1.4 ? "HIGH" : ratioToMedian <= 0.7 ? "LOW" : null;
      return { ...p, ratioToMedian, outlier } as PriceRow;
    })
    .sort((a, b) => (a.amount ?? Number.POSITIVE_INFINITY) - (b.amount ?? Number.POSITIVE_INFINITY));
}

export interface FinancialLike {
  amount: number;
  correctedAmount?: number;
  evaluatedAmount?: number;
  adjustments?: { arithmeticCorrection?: number; evidenceRef: string; verifiedBy: string };
}

/** Stated → corrected → evaluated, with the evidence check on any correction. */
export function reconcileFinancial(f: FinancialLike): { stated: number; corrected: number; evaluated: number; delta: number; verified: boolean; status: "OK" | "CORRECTED" | "UNVERIFIED_CORRECTION" } {
  const corrected = f.correctedAmount ?? f.amount;
  const evaluated = f.evaluatedAmount ?? corrected;
  const delta = corrected - f.amount;
  const verified = delta === 0 || Boolean(f.adjustments?.evidenceRef && f.adjustments?.verifiedBy);
  return { stated: f.amount, corrected, evaluated, delta, verified, status: delta === 0 ? "OK" : verified ? "CORRECTED" : "UNVERIFIED_CORRECTION" };
}

export function formatAmount(amount: number | null, currency: string | null): string {
  if (amount === null) return "—";
  return `${currency ? currency + " " : ""}${amount.toLocaleString("en-KE")}`;
}
