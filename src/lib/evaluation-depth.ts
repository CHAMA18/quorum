/**
 * Deeper price evaluation than a weighted matrix alone.
 *
 * Pure screens over submitted bid prices. Every screen is advisory: it flags
 * for the committee, it never scores or disqualifies. Non-finite or missing
 * prices are excluded and reported, never silently treated as zero.
 */

export interface BidPrice {
  bidder: string;
  total: number;
  /** Optional bill-of-quantities line prices, in submitted order. */
  lines?: number[];
}

export interface PriceScreen {
  median: number | null;
  flagged: Array<{ bidder: string; reason: string; detail: string }>;
  excluded: string[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Flag abnormally low/high bids against the peer median and estimate. */
export function screenBidPrices(
  bids: readonly BidPrice[],
  opts: { estimate?: number; lowRatio?: number; highRatio?: number } = {},
): PriceScreen {
  const lowRatio = opts.lowRatio ?? 0.7;
  const highRatio = opts.highRatio ?? 1.3;
  const valid = bids.filter((b) => Number.isFinite(b.total) && b.total > 0);
  const excluded = bids.filter((b) => !(Number.isFinite(b.total) && b.total > 0)).map((b) => b.bidder);
  const med = median(valid.map((b) => b.total));
  const flagged: PriceScreen["flagged"] = [];
  if (med !== null) {
    for (const b of valid) {
      if (b.total < med * lowRatio)
        flagged.push({ bidder: b.bidder, reason: "ABNORMALLY_LOW", detail: `${b.total} is below ${lowRatio} x median ${med}` });
      else if (b.total > med * highRatio)
        flagged.push({ bidder: b.bidder, reason: "ABNORMALLY_HIGH", detail: `${b.total} is above ${highRatio} x median ${med}` });
    }
  }
  if (opts.estimate && Number.isFinite(opts.estimate) && opts.estimate > 0) {
    for (const b of valid) {
      if (b.total > opts.estimate)
        flagged.push({ bidder: b.bidder, reason: "OVER_ESTIMATE", detail: `${b.total} exceeds estimate ${opts.estimate}` });
    }
  }
  return { median: med, flagged, excluded };
}

/** Flag BOQ lines that sit far from the peer median for the same line. */
export function screenBoqLines(bids: readonly BidPrice[], ratio = 2): PriceScreen["flagged"] {
  const flagged: PriceScreen["flagged"] = [];
  const maxLines = Math.max(0, ...bids.map((b) => b.lines?.length ?? 0));
  for (let i = 0; i < maxLines; i++) {
    const present = bids.filter((b) => b.lines && Number.isFinite(b.lines[i]) && b.lines[i] > 0);
    const med = median(present.map((b) => b.lines![i]));
    if (med === null) continue;
    for (const b of present) {
      const v = b.lines![i];
      if (v > med * ratio || v < med / ratio)
        flagged.push({ bidder: b.bidder, reason: "BOQ_LINE_OUTLIER", detail: `line ${i + 1}: ${v} vs peer median ${med}` });
    }
  }
  return flagged;
}

/**
 * Collusion signals: identical totals or near-identical line patterns across
 * supposedly independent bids. A signal is a prompt to investigate, not proof.
 */
export function collusionSignals(bids: readonly BidPrice[]): Array<{ bidders: string[]; reason: string }> {
  const signals: Array<{ bidders: string[]; reason: string }> = [];
  const valid = bids.filter((b) => Number.isFinite(b.total) && b.total > 0);
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const a = valid[i], b = valid[j];
      if (a.total === b.total) signals.push({ bidders: [a.bidder, b.bidder], reason: "IDENTICAL_TOTALS" });
      if (a.lines && b.lines && a.lines.length > 0 && a.lines.length === b.lines.length) {
        const same = a.lines.filter((v, k) => v === b.lines![k]).length;
        if (same / a.lines.length >= 0.8) signals.push({ bidders: [a.bidder, b.bidder], reason: "NEAR_IDENTICAL_LINES" });
      }
    }
  }
  return signals;
}
