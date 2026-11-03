export interface ObservableEvent {
  id?: string;
  traceId?: string;
  runId?: string;
  ts?: string;
  server?: string;
  tool?: string;
  status?: string;
  durationMs?: number;
}

function percentile(samples: number[], p: number): number | null {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

/** Low-cardinality operational metrics: no tender text, bidder data, or actors. */
export function summarizeToolEvents(events: ObservableEvent[]) {
  const groups = new Map<string, ObservableEvent[]>();
  for (const event of events) {
    const key = (event.server ?? "unknown") + "/" + (event.tool ?? "unknown");
    const rows = groups.get(key) ?? [];
    rows.push(event);
    groups.set(key, rows);
  }
  return [...groups.entries()].map(([operation, rows]) => {
    const durations = rows.map((row) => Math.max(0, Number(row.durationMs) || 0));
    return {
      operation,
      calls: rows.length,
      errors: rows.filter((row) => row.status === "ERROR").length,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      latestAt: rows.map((row) => row.ts ?? "").sort().at(-1) ?? null,
    };
  }).sort((a, b) => a.operation.localeCompare(b.operation));
}

export function summarizeQueue(jobs: { status: string; attempts: number; maxAttempts?: number }[]): {
  PENDING: number;
  RUNNING: number;
  DONE: number;
  FAILED: number;
  exhausted: number;
} {
  const counts: Record<string, number> = { PENDING: 0, RUNNING: 0, DONE: 0, FAILED: 0 };
  for (const job of jobs) counts[job.status] = (counts[job.status] ?? 0) + 1;
  return {
    PENDING: counts.PENDING,
    RUNNING: counts.RUNNING,
    DONE: counts.DONE,
    FAILED: counts.FAILED,
    exhausted: jobs.filter((job) => job.status === "FAILED" && job.attempts >= (job.maxAttempts ?? 5)).length,
  };
}
