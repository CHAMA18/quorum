import { describe, expect, test } from "bun:test";
import { claimJsonDueJobs, finishJsonJob, retryStaleJsonJobs, type DurableJob } from "./postgres";

const job = (overrides: Partial<DurableJob> = {}): DurableJob => ({
  id: "review:run_1",
  kind: "REVIEW_RUN",
  payload: { runId: "run_1" },
  status: "PENDING",
  attempts: 0,
  maxAttempts: 2,
  runAt: "2026-11-03T00:00:00.000Z",
  ...overrides,
});

describe("durable job lease and retry rules", () => {
  test("claims once and increments the attempt count exactly once", () => {
    const jobs = [job()];
    const claimed = claimJsonDueJobs(jobs, Date.parse("2026-11-03T00:00:01.000Z"));
    expect(claimed).toHaveLength(1);
    expect(claimed[0].attempts).toBe(1);
    expect(jobs[0].attempts).toBe(1);
    expect(claimJsonDueJobs(jobs, Date.parse("2026-11-03T00:00:02.000Z"))).toHaveLength(0);
  });

  test("failed jobs back off and stop after the configured attempts", () => {
    const jobs = [job({ status: "RUNNING", attempts: 2 })];
    finishJsonJob(jobs, jobs[0].id, "temporary error", Date.parse("2026-11-03T00:00:00.000Z"));
    expect(jobs[0].status).toBe("FAILED");
    expect(Date.parse(jobs[0].runAt)).toBeGreaterThan(Date.parse("2026-11-03T00:00:00.000Z"));
    expect(claimJsonDueJobs(jobs, Number.MAX_SAFE_INTEGER)).toHaveLength(0);
  });

  test("expired worker leases return to the retry queue", () => {
    const now = Date.parse("2026-11-03T00:10:00.000Z");
    const jobs = [job({ status: "RUNNING", attempts: 1, runAt: "2026-11-03T00:00:00.000Z" })];
    expect(retryStaleJsonJobs(jobs, 60_000, now)).toBe(1);
    expect(jobs[0].status).toBe("FAILED");
    expect(claimJsonDueJobs(jobs, now)).toHaveLength(1);
    expect(jobs[0].attempts).toBe(2);
  });
});
