import { describe, expect, test } from "bun:test";
import { fmtModelCost, modelCostLabel, modelCostUsd } from "./model-cost";

describe("modelCostUsd", () => {
  test("prices prompt and completion tokens at the Workers AI list rates", () => {
    // 1M in + 1M out = $0.0509 + $0.335
    expect(modelCostUsd({ promptTokens: 1_000_000, completionTokens: 1_000_000 })).toBeCloseTo(0.3859, 6);
  });

  test("a real desk answer costs sub-cent at list prices", () => {
    const usd = modelCostUsd({ promptTokens: 5383, completionTokens: 98 });
    expect(usd).toBeCloseTo((5383 * 0.0509 + 98 * 0.335) / 1_000_000, 8);
    expect(usd).toBeLessThan(0.01);
    expect(usd).toBeGreaterThan(0);
  });

  test("zero tokens cost zero", () => {
    expect(modelCostUsd({ promptTokens: 0, completionTokens: 0 })).toBe(0);
  });
});

describe("fmtModelCost / modelCostLabel", () => {
  test("formats sub-cent costs to four decimals with the approximation mark", () => {
    expect(fmtModelCost(0.000307)).toBe("≈ $0.0003");
  });

  test("formats zero as $0.00", () => {
    expect(fmtModelCost(0)).toBe("$0.00");
  });

  test("label names the price basis so local runs are not misread as bills", () => {
    expect(modelCostLabel({ promptTokens: 5383, completionTokens: 98 })).toContain("at hosted list prices");
  });
});
