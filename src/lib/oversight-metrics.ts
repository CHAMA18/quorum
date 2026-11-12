/**
 * Oversight metrics for the desk: backlog, cycle time, exceptions, delays.
 * Pure over run/tender shapes the sidecar already returns, so it can be
 * tested without a server and reused by any dashboard surface.
 */

export interface RunLike { id?: string; status?: string; createdAt?: string; updatedAt?: string; tenderId?: string }
export interface TenderLike { ref?: string; stage?: string; deadline?: string; exceptions?: unknown[] }

export interface OversightMetrics {
  totalRuns: number;
  backlog: number;
  completed: number;
  avgCycleHours: number | null;
  exceptionCount: number;
  delayedTenders: string[];
}

const DONE = new Set(["COMPLETED", "DONE", "FILED", "SIGNED"]);

export function computeOversightMetrics(
  runs: readonly RunLike[],
  tenders: readonly TenderLike[],
  now = new Date(),
): OversightMetrics {
  const completedRuns = runs.filter((r) => DONE.has((r.status ?? "").toUpperCase()));
  const durations = completedRuns
    .map((r) => {
      const a = Date.parse(r.createdAt ?? ""), b = Date.parse(r.updatedAt ?? "");
      return Number.isFinite(a) && Number.isFinite(b) && b >= a ? (b - a) / 3_600_000 : null;
    })
    .filter((v): v is number => v !== null);
  const avgCycleHours = durations.length ? durations.reduce((x, y) => x + y, 0) / durations.length : null;
  const delayedTenders = tenders
    .filter((t) => t.deadline && Date.parse(t.deadline) < now.getTime() && (t.stage ?? "").toUpperCase() !== "COMPLETED")
    .map((t) => t.ref ?? "")
    .filter(Boolean);
  return {
    totalRuns: runs.length,
    backlog: runs.length - completedRuns.length,
    completed: completedRuns.length,
    avgCycleHours,
    exceptionCount: tenders.reduce((n, t) => n + (t.exceptions?.length ?? 0), 0),
    delayedTenders,
  };
}
