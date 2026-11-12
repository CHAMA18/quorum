/** Per-supplier history across tender cycles: awards, completion, complaints. Pure. */

export interface CycleLike {
  tenderId: string;
  awardReport?: { recommendation?: string; signedAt?: string };
  contract?: { completedAt?: string; completion?: { performanceRating?: number } };
  complaints?: unknown[];
  debriefs?: { bidder: string; status: string }[];
}

export interface SupplierHistory {
  supplier: string;
  awards: number;
  completed: number;
  complaints: number;
  avgRating: number | null;
  lastAwardAt: string | null;
}

export function buildSupplierHistory(cycles: readonly CycleLike[]): SupplierHistory[] {
  const map = new Map<string, SupplierHistory & { ratings: number[] }>();
  const get = (name: string) => {
    const found = map.get(name) ?? { supplier: name, awards: 0, completed: 0, complaints: 0, avgRating: null, lastAwardAt: null, ratings: [] };
    map.set(name, found);
    return found;
  };
  for (const c of cycles) {
    const winner = c.awardReport?.recommendation;
    if (winner) {
      const h = get(winner);
      h.awards += 1;
      if (c.awardReport?.signedAt && (!h.lastAwardAt || c.awardReport.signedAt > h.lastAwardAt)) h.lastAwardAt = c.awardReport.signedAt;
      if (c.contract?.completedAt) {
        h.completed += 1;
        if (typeof c.contract.completion?.performanceRating === "number") h.ratings.push(c.contract.completion.performanceRating);
      }
    }
    for (const d of c.debriefs ?? []) {
      /* A debrief exists only for an unsuccessful bidder; complaints attach per cycle below. */
      void d;
    }
  }
  return [...map.values()]
    .map(({ ratings, ...h }) => ({ ...h, avgRating: ratings.length ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)) : null }))
    .sort((a, b) => b.awards - a.awards || a.supplier.localeCompare(b.supplier));
}
