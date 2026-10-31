import { describe, expect, test } from "bun:test";
import {
  addendumNoticeState,
  addWorkingDaysIn,
  calendarCoversYear,
  isWorkingDay,
  jurisdictionPack,
  localEndOfDay,
  workingDaysBetweenIn,
} from "./jurisdiction";
import { parseClosingDate } from "./cycle";

describe("jurisdiction clock packs", () => {
  const zm = jurisdictionPack("ZM");
  const ke = jurisdictionPack("KE");

  test("Zambian Heroes' and Unity Days are not working days", () => {
    expect(isWorkingDay("2026-07-06T10:00:00Z", zm)).toBe(false);
    expect(isWorkingDay("2026-07-07T10:00:00Z", zm)).toBe(false);
    expect(isWorkingDay("2026-07-08T10:00:00Z", zm)).toBe(true);
  });

  test("Kenyan Mashujaa Day and a normal Friday behave differently", () => {
    expect(isWorkingDay("2026-10-20T10:00:00Z", ke)).toBe(false);
    expect(isWorkingDay("2026-10-23T10:00:00Z", ke)).toBe(true);
  });

  test("adding one working day skips a weekend and a holiday", () => {
    /* Friday 3 July 2026 + 1 working day: Mon 6 and Tue 7 are Zambian holidays. */
    expect(addWorkingDaysIn("2026-07-03T09:00:00Z", 1, zm)).toBe("2026-07-08T09:00:00.000Z");
  });

  test("working-day count between two instants uses the local calendar", () => {
    expect(workingDaysBetweenIn("2026-10-16T08:00:00Z", "2026-10-23T08:00:00Z", ke)).toBe(4);
  });

  test("a date-only closing is the end of the local day, not UTC midnight", () => {
    expect(localEndOfDay("2026-10-20", ke)).toBe("2026-10-20T20:59:59.000Z");
    expect(parseClosingDate("**Closing date:** 20 October 2026", 3)).toBe("2026-10-20T20:59:59.000Z");
  });

  test("an explicit ISO UTC designator wins over the jurisdiction default", () => {
    expect(parseClosingDate("**Closing date:** 2026-10-30T14:00Z", 3)).toBe("2026-10-30T14:00:00.000Z");
    expect(parseClosingDate("**Closing date:** 2026-10-30T14:00+03:00", 2)).toBe("2026-10-30T11:00:00.000Z");
  });

  test("an addendum inside the notice window requires an extension", () => {
    const state = addendumNoticeState("2026-10-23T17:00:00Z", "2026-10-19T09:00:00Z", ke);
    expect(state?.requiresExtension).toBe(true);
    expect(state?.workingDaysLeft).toBe(3);
    expect(state?.reason).toContain("must extend");
  });

  test("an addendum outside the window is allowed without extension", () => {
    const state = addendumNoticeState("2026-11-13T17:00:00Z", "2026-10-19T09:00:00Z", ke);
    expect(state?.requiresExtension).toBe(false);
  });

  test("the published calendars cover 2028 and refuse to guess 2029", () => {
    expect(calendarCoversYear(zm, 2028)).toBe(true);
    expect(calendarCoversYear(ke, 2028)).toBe(true);
    expect(calendarCoversYear(zm, 2029)).toBe(false);
    expect(isWorkingDay("2028-07-03T10:00:00Z", zm)).toBe(false);
    expect(isWorkingDay("2028-10-20T10:00:00Z", ke)).toBe(false);
  });
});
