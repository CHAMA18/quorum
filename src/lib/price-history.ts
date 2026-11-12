/** Historical price benchmarks across tenders, from recorded price signals. Pure. */

export interface PriceSignalLike {
  item: string;
  peerMedian?: number;
  currency?: string;
  tenderId: string;
}

export interface Benchmark {
  item: string;
  tenders: number;
  medianOfMedians: number | null;
  low: number | null;
  high: number | null;
  currency: string | null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** One benchmark per line item, built only from tenders other than the current one. */
export function buildBenchmarks(signals: readonly PriceSignalLike[], excludeTenderId?: string): Benchmark[] {
  const byItem = new Map<string, { medians: number[]; tenders: Set<string>; currency: string | null }>();
  for (const s of signals) {
    if (excludeTenderId && s.tenderId === excludeTenderId) continue;
    if (typeof s.peerMedian !== "number" || !Number.isFinite(s.peerMedian)) continue;
    const key = s.item.trim().toLowerCase();
    if (!key) continue;
    const entry = byItem.get(key) ?? { medians: [], tenders: new Set<string>(), currency: s.currency ?? null };
    entry.medians.push(s.peerMedian);
    entry.tenders.add(s.tenderId);
    byItem.set(key, entry);
  }
  return [...byItem.entries()]
    .map(([item, e]) => ({ item, tenders: e.tenders.size, medianOfMedians: median(e.medians), low: Math.min(...e.medians), high: Math.max(...e.medians), currency: e.currency }))
    .sort((a, b) => b.tenders - a.tenders || a.item.localeCompare(b.item));
}
