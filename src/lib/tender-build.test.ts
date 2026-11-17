import { describe, expect, test } from "bun:test";
import { isTenderBuildingIntent } from "./tender-build";

describe("isTenderBuildingIntent", () => {
  test("explicit build requests route to the builder", () => {
    expect(isTenderBuildingIntent("Draft a tender for ambulances", false)).toBe(true);
    expect(isTenderBuildingIntent("Build a new procurement brief for cleaning services", false)).toBe(true);
    expect(isTenderBuildingIntent("Create a tender for medical supplies", false)).toBe(true);
    expect(isTenderBuildingIntent("prepare a draft tender notice", false)).toBe(true);
  });

  test("tender descriptions with budget/closing signals route to the builder", () => {
    expect(
      isTenderBuildingIntent(
        "Supply and delivery of 12 ambulances to the Ministry of Health, budget ZMW 4.5 million, closing 15 December 2026",
        false,
      ),
    ).toBe(true);
    expect(isTenderBuildingIntent("Procurement of laptops, KES 3 million, closing soon", false)).toBe(true);
    expect(isTenderBuildingIntent("A 12-month cleaning contract for the council offices, budget ZMW 800,000", false)).toBe(true);
  });

  test("questions about tenders stay in the chat", () => {
    expect(isTenderBuildingIntent("What tenders are overdue?", false)).toBe(false);
    expect(isTenderBuildingIntent("Which approvals are waiting on tender QRM-2026-013?", false)).toBe(false);
    expect(isTenderBuildingIntent("Explain the findings on the last tender", false)).toBe(false);
    expect(isTenderBuildingIntent("Draft a committee brief on the tender that most needs attention", false)).toBe(false);
    expect(isTenderBuildingIntent("Write a morning brief", false)).toBe(false);
    expect(isTenderBuildingIntent("What is the budget for the ambulances tender?", false)).toBe(false);
  });

  test("Generate-mode wrapping does not hijack non-tender drafts", () => {
    const wrapped = "Prepare a draft for my review. Do not execute, publish or file anything; show the draft only. Draft a redline for the highest-risk finding";
    expect(isTenderBuildingIntent(wrapped, false)).toBe(false);
  });

  test("an active draft session routes every follow-up, keywords or not", () => {
    expect(isTenderBuildingIntent("budget ZMW 2 million", true)).toBe(true);
    expect(isTenderBuildingIntent("closing in 30 days", true)).toBe(true);
    expect(isTenderBuildingIntent("the buyer is the district council", true)).toBe(true);
  });
});
