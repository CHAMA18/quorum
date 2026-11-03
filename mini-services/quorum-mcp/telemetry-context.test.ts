import { describe, expect, test } from "bun:test";
import { currentTraceId, requestTraceId, safeTraceId, withTrace } from "./telemetry-context";

describe("trace context", () => {
  test("accepts safe correlation IDs and replaces invalid header values", () => {
    expect(safeTraceId("0c85f7e1-9d70-4474-8c8b-74a968d6ad10")).toBe("0c85f7e1-9d70-4474-8c8b-74a968d6ad10");
    expect(safeTraceId("bad\nheader")).toBeNull();
    expect(requestTraceId("bad\nheader")).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("preserves the trace through asynchronous work without leaking to other requests", async () => {
    const traceId = "trace_run_123456";
    expect(currentTraceId()).toBeUndefined();
    const result = await withTrace(traceId, async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return currentTraceId();
    });
    expect(result).toBe(traceId);
    expect(currentTraceId()).toBeUndefined();
  });
});
