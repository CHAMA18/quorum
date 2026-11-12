import { describe, expect, test } from "bun:test";
import { evaluateRulePack, getRulePack } from "./rule-packs";

describe("rule packs", () => {
  test("known packs resolve, unknown fails closed", () => {
    expect(getRulePack("zm")?.currency).toBe("ZMW");
    expect(getRulePack("XX")).toBeNull();
    expect(evaluateRulePack("XX", []).canProceed).toBe(false);
  });
  test("passing evidence proceeds", () => {
    const r = evaluateRulePack("ZM", [{ ruleId: "ZM-DOC-REQUIRED", evidence: "bid doc p.1" }]);
    expect(r.canProceed).toBe(true);
  });
  test("missing mandatory evidence hard-fails", () => {
    const r = evaluateRulePack("ZM", [{ ruleId: "ZM-DOC-REQUIRED" }]);
    expect(r.hardFailures).toContain("ZM-DOC-REQUIRED");
    expect(r.canProceed).toBe(false);
  });
  test("named exception does not hard-fail, unknown rule does", () => {
    const r = evaluateRulePack("ZM", [
      { ruleId: "ZM-OVER-BUDGET", exceptionApprover: "Director Procurement" },
      { ruleId: "ZM-NOPE", evidence: "x" },
    ]);
    expect(r.results[0].status).toBe("EXCEPTION");
    expect(r.canProceed).toBe(false);
  });
  test("advisory failure warns without blocking", () => {
    const r = evaluateRulePack("KE", [{ ruleId: "KE-OVER-BUDGET" }]);
    expect(r.failures).toContain("KE-OVER-BUDGET");
    expect(r.canProceed).toBe(true);
  });
});
