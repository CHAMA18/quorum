import { describe, expect, test } from "bun:test";
import { buildRuleCatalogue } from "./rule-catalogue";

function guards(priceVariancePct: 15 | 25 | 40 = 25, checklist: "STANDARD" | "STRICT" = "STANDARD", registryCrossCheck = true) {
  return { priceVariancePct, checklist, registryCrossCheck };
}

function row(priceVariancePct: 15 | 25 | 40, id: string) {
  return buildRuleCatalogue(guards(priceVariancePct)).find((rule) => rule.id === id);
}

describe("live rule catalogue", () => {
  test("the price rule states the live variance guard, never a stale multiple", () => {
    const rule = row(25, "R-PRICE-OUTLIER");
    expect(rule?.catches).toContain("25%");
    expect(rule?.catches.toLowerCase()).not.toContain("two times");
    expect(row(40, "R-PRICE-OUTLIER")?.catches).toContain("40%");
    expect(row(15, "R-PRICE-OUTLIER")?.catches).toContain("15%");
  });

  test("the document rule names the active checklist mode", () => {
    expect(row(25, "R-DOC-MISSING")?.catches).toContain("Standard");
    const strict = buildRuleCatalogue(guards(25, "STRICT")).find((rule) => rule.id === "R-DOC-MISSING");
    expect(strict?.catches).toContain("Strict");
  });

  test("the registry rule tells the truth when the cross-check is off", () => {
    const on = buildRuleCatalogue(guards(25)).find((rule) => rule.id === "R-REGISTRY-STATUS");
    const off = buildRuleCatalogue(guards(25, "STANDARD", false)).find((rule) => rule.id === "R-REGISTRY-STATUS");
    expect(on?.catches).toContain("cross-check is on");
    expect(off?.catches).toContain("cross-check is off");
  });

  test("every rule has a unique id, a severity and an action", () => {
    const rules = buildRuleCatalogue(guards());
    expect(new Set(rules.map((rule) => rule.id)).size).toBe(rules.length);
    for (const rule of rules) {
      expect(rule.id.startsWith("R-")).toBe(true);
      expect(["HIGH", "MEDIUM", "LOW"]).toContain(rule.severity);
      expect(rule.catches.length).toBeGreaterThan(10);
      expect(rule.action.length).toBeGreaterThan(10);
    }
  });
});
