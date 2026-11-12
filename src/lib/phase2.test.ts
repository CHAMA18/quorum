import { describe, expect, it } from "bun:test";
import { reconcileFinancial } from "./bid-prices";
import { expiryStatus } from "./supplier-lights";
import { diffLines, diffSummary } from "./text-diff";
import { buildZip, crc32 } from "./zip-store";

describe("reconcileFinancial", () => {
  it("passes clean amounts and flags unverified corrections", () => {
    expect(reconcileFinancial({ amount: 100 }).status).toBe("OK");
    expect(reconcileFinancial({ amount: 100, correctedAmount: 90 }).status).toBe("UNVERIFIED_CORRECTION");
    expect(reconcileFinancial({ amount: 100, correctedAmount: 90, adjustments: { evidenceRef: "bid p.4", verifiedBy: "Officer" } }).status).toBe("CORRECTED");
  });
});

describe("expiryStatus", () => {
  it("grades expiry windows", () => {
    const now = new Date("2026-11-12");
    expect(expiryStatus("2027-06-01", now).state).toBe("pass");
    expect(expiryStatus("2026-11-20", now).state).toBe("warn");
    expect(expiryStatus("2026-01-01", now).state).toBe("fail");
  });
});

describe("diffLines", () => {
  it("marks additions and removals", () => {
    const d = diffLines("a\nb\nc", "a\nx\nc");
    expect(diffSummary(d)).toEqual({ added: 1, removed: 1, unchanged: 2 });
  });
});

describe("buildZip", () => {
  it("writes local headers, central directory and end record", () => {
    const zip = buildZip([{ name: "a.txt", data: new TextEncoder().encode("hello") }]);
    const text = Buffer.from(zip).toString("latin1");
    expect(text.startsWith("PK\x03\x04")).toBe(true);
    expect(text).toContain("a.txt");
    expect(text).toContain("PK\x05\x06");
    expect(crc32(new TextEncoder().encode("hello"))).toBe(0x3610a686);
  });
});
