import { describe, expect, test } from "bun:test";
import { checkRegistry } from "./connectors";
import { markStepDone, resumeStep, startRun } from "./run-checkpoint";

describe("connectors", () => {
  test("registry: debarred hits, absence is UNKNOWN not a pass", () => {
    const recs = [{ name: "Acme Ltd", status: "DEBARRED" as const, owners: ["J Doe"] }];
    expect(checkRegistry("acme  ltd", recs).debarred).toBe(true);
    expect(checkRegistry("Missing Ltd", recs).status).toBe("UNKNOWN");
  });
  test("checkpoint resumes at first unfinished step, refuses out-of-order", () => {
    startRun("r1", ["parse", "review", "gate"]);
    expect(markStepDone("r1", "review")).toBe(false);
    expect(markStepDone("r1", "parse")).toBe(true);
    expect(resumeStep("r1")).toBe("review");
  });
});
