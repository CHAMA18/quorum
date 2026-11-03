import { describe, expect, test } from "bun:test";
import { summarizeQueue, summarizeToolEvents } from "./observability";

describe("run observability summaries", () => {
  test("reports low-cardinality latency and error metrics", () => {
    expect(summarizeToolEvents([
      { server: "langgraph.js", tool: "review_run", durationMs: 10, status: "OK", ts: "2026-11-01T00:00:00Z" },
      { server: "langgraph.js", tool: "review_run", durationMs: 50, status: "ERROR", ts: "2026-11-02T00:00:00Z" },
    ])).toEqual([{
      operation: "langgraph.js/review_run", calls: 2, errors: 1, p50Ms: 10, p95Ms: 50, latestAt: "2026-11-02T00:00:00Z",
    }]);
  });

  test("counts exhausted and active durable jobs", () => {
    const summary = summarizeQueue([
      { status: "PENDING", attempts: 0 },
      { status: "FAILED", attempts: 5, maxAttempts: 5 },
    ]);
    expect(summary.PENDING).toBe(1);
    expect(summary.RUNNING).toBe(0);
    expect(summary.FAILED).toBe(1);
    expect(summary.exhausted).toBe(1);
  });
});
