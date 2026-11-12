import { describe, expect, test } from "bun:test";
import { publishEvent, recentEvents } from "./event-bus";
import { computeOversightMetrics } from "./oversight-metrics";
import { summarizeStudy } from "./officer-study";
import { t } from "./i18n";

describe("platform features", () => {
  test("event bus sequences and catches up late subscribers", () => {
    const a = publishEvent("run.started");
    publishEvent("gate.pending");
    const got = recentEvents(a.seq);
    expect(got.length).toBe(1);
    expect(got[0].type).toBe("gate.pending");
  });
  test("oversight metrics count backlog, exceptions, delays", () => {
    const m = computeOversightMetrics(
      [{ status: "COMPLETED", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T02:00:00Z" }, { status: "RUNNING" }],
      [{ ref: "T1", stage: "EVALUATION", deadline: "2020-01-01", exceptions: [1, 2] }],
      new Date("2026-01-02T00:00:00Z"),
    );
    expect(m.backlog).toBe(1);
    expect(m.avgCycleHours).toBe(2);
    expect(m.exceptionCount).toBe(2);
    expect(m.delayedTenders).toContain("T1");
  });
  test("study summary refuses to claim benefit below paired minimum", () => {
    const s = summarizeStudy([{ officerId: "o1", caseId: "c1", assisted: true, minutes: 30, materialIssuesFound: 3, materialIssuesTotal: 4, corrections: 0 }]);
    expect(s.claimable).toBe(false);
    expect(s.timeSavedPct).toBeNull();
  });
  test("study summary computes time saved when paired", () => {
    const mk = (assisted: boolean, minutes: number) => ({ officerId: "o", caseId: "c", assisted, minutes, materialIssuesFound: 4, materialIssuesTotal: 4, corrections: 0 });
    const s = summarizeStudy([mk(true, 30), mk(true, 30), mk(false, 60), mk(false, 60)]);
    expect(s.claimable).toBe(true);
    expect(s.timeSavedPct).toBe(50);
  });
  test("i18n translates, falls back to English, never blanks", () => {
    expect(t("fr", "review.start")).not.toBe("Start review");
    expect(t("de", "review.start")).toBe("Start review");
    expect(t("en", "missing.key")).toBe("missing.key");
  });
});
