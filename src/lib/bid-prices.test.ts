import { describe, expect, it } from "bun:test";
import { buildPriceRows, parsePriceRead } from "./bid-prices";
import { supplierLights } from "./supplier-lights";

describe("buildPriceRows", () => {
  it("sorts low-to-high and flags outliers against the median", () => {
    const rows = buildPriceRows([
      { bidder: "Expensive", priceRead: "KES 14,000,000" },
      { bidder: "Cheap", priceRead: "KES 6,000,000" },
      { bidder: "Mid", priceRead: "KES 10,000,000" },
    ]);
    expect(rows.map((r) => r.bidder)).toEqual(["Cheap", "Mid", "Expensive"]);
    expect(rows[1].ratioToMedian).toBe(1);
    expect(rows[2].outlier).toBe("HIGH");
    expect(rows[0].outlier).toBe("LOW");
  });

  it("keeps unreadable prices last with no ratio", () => {
    const rows = buildPriceRows([{ bidder: "A", priceRead: "KES 100" }, { bidder: "B", priceRead: "not read" }]);
    expect(rows[1].bidder).toBe("B");
    expect(rows[1].ratioToMedian).toBeNull();
    expect(parsePriceRead("USD 1,250.50").amount).toBe(1250.5);
  });
});

describe("supplierLights", () => {
  const base = { registryStatus: "REGISTERED", taxStatus: "VALID", sanctions: "CLEAR", pep: "CLEAR", expiresAt: "2027-06-01" };
  it("is all green for a clean verification", () => {
    expect(supplierLights(base, new Date("2026-11-12")).every((l) => l.state === "pass")).toBe(true);
  });

  it("turns red on struck-off, sanctions match and expired check", () => {
    const lights = supplierLights({ ...base, registryStatus: "STRUCK_OFF", sanctionsMatches: ["X"], expiresAt: "2026-01-01" }, new Date("2026-11-12"));
    expect(lights.find((l) => l.key === "registry")?.state).toBe("fail");
    expect(lights.find((l) => l.key === "sanctions")?.state).toBe("fail");
    expect(lights.find((l) => l.key === "expiry")?.state).toBe("fail");
  });
});
