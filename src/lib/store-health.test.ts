import { describe, expect, test } from "bun:test";
import { storeHealth } from "./db";

describe("web store health", () => {
  test("reports a writable store with a byte count", () => {
    const health = storeHealth();
    expect(health.writable).toBe(true);
    expect(health.bytes).toBeGreaterThan(0);
  });
});
