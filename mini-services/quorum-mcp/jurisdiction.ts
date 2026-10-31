/**
 * Jurisdiction clock packs.
 *
 * A statutory period is not "seven calendar days" — it is seven working days
 * in a named legal calendar, observed in a named timezone. Zambia and Kenya
 * both publish public holidays by year, and a closing time printed as
 * "17 October 2026, 10:00" means 10:00 in that jurisdiction, not UTC.
 *
 * Every pack is explicit and versioned. Nothing here reaches the network and
 * nothing is guessed: a year with no pack refuses the working-day calculation
 * rather than silently treating holidays as ordinary days.
 */

import type { JurisdictionId } from "./store";

export type HolidayKind = "PUBLIC" | "OBSERVED";

export interface Holiday {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  name: string;
  kind?: HolidayKind;
}

export interface JurisdictionPack {
  id: JurisdictionId;
  name: string;
  country: string;
  timezone: string;
  /** Fixed offset from UTC, in hours. Neither Kenya nor Zambia observes DST. */
  utcOffsetHours: number;
  /** The statutory working week. Both packs are Monday–Friday. */
  workingWeekdays: readonly number[];
  /** Working days an addendum must give before closing. */
  addendumMinNoticeDays: number;
  /** Working days for an abnormally-low-bid justification. */
  albResponseDays: number;
  /** Working days to lodge a standstill complaint. */
  standstillDays: number;
  /** Working days to answer a complaint. */
  complaintResponseDays: number;
  /** Every year with a published holiday list. A year outside this set is not guessed. */
  calendarYears: readonly number[];
  holidays: readonly Holiday[];
}

const WEEKDAYS = [1, 2, 3, 4, 5] as const;

export const JURISDICTION_PACKS: Record<JurisdictionId, JurisdictionPack> = {
  ZM: {
    id: "ZM",
    name: "Zambia public procurement calendar",
    country: "Zambia",
    timezone: "Africa/Lusaka",
    utcOffsetHours: 2,
    workingWeekdays: WEEKDAYS,
    addendumMinNoticeDays: 7,
    albResponseDays: 5,
    standstillDays: 10,
    complaintResponseDays: 14,
    calendarYears: [2026, 2027, 2028],
    holidays: [
      { date: "2026-01-01", name: "New Year's Day" },
      { date: "2026-03-08", name: "International Women's Day" },
      { date: "2026-03-09", name: "International Women's Day (observed)", kind: "OBSERVED" },
      { date: "2026-03-12", name: "Youth Day" },
      { date: "2026-04-03", name: "Good Friday" },
      { date: "2026-04-04", name: "Holy Saturday" },
      { date: "2026-05-01", name: "Labour Day" },
      { date: "2026-05-25", name: "Africa Freedom Day" },
      { date: "2026-07-06", name: "Heroes' Day" },
      { date: "2026-07-07", name: "Unity Day" },
      { date: "2026-08-03", name: "Farmers' Day" },
      { date: "2026-10-18", name: "National Prayer Day" },
      { date: "2026-10-19", name: "National Prayer Day (observed)", kind: "OBSERVED" },
      { date: "2026-10-24", name: "Independence Day" },
      { date: "2026-10-26", name: "Independence Day (observed)", kind: "OBSERVED" },
      { date: "2026-12-25", name: "Christmas Day" },
      { date: "2027-01-01", name: "New Year's Day" },
      { date: "2027-03-08", name: "International Women's Day" },
      { date: "2027-03-12", name: "Youth Day" },
      { date: "2027-03-26", name: "Good Friday" },
      { date: "2027-03-27", name: "Holy Saturday" },
      { date: "2027-05-01", name: "Labour Day" },
      { date: "2027-05-25", name: "Africa Freedom Day" },
      { date: "2027-07-05", name: "Heroes' Day" },
      { date: "2027-07-06", name: "Unity Day" },
      { date: "2027-08-02", name: "Farmers' Day" },
      { date: "2027-10-18", name: "National Prayer Day" },
      { date: "2027-10-24", name: "Independence Day" },
      { date: "2027-10-25", name: "Independence Day (observed)", kind: "OBSERVED" },
      { date: "2027-12-25", name: "Christmas Day" },
      { date: "2028-01-01", name: "New Year's Day" },
      { date: "2028-01-03", name: "New Year's Day (observed)", kind: "OBSERVED" },
      { date: "2028-03-08", name: "International Women's Day" },
      { date: "2028-03-12", name: "Youth Day" },
      { date: "2028-03-13", name: "Youth Day (observed)", kind: "OBSERVED" },
      { date: "2028-04-14", name: "Good Friday" },
      { date: "2028-04-15", name: "Holy Saturday" },
      { date: "2028-05-01", name: "Labour Day" },
      { date: "2028-05-25", name: "Africa Freedom Day" },
      { date: "2028-07-03", name: "Heroes' Day" },
      { date: "2028-07-04", name: "Unity Day" },
      { date: "2028-08-07", name: "Farmers' Day" },
      { date: "2028-10-18", name: "National Prayer Day" },
      { date: "2028-10-24", name: "Independence Day" },
      { date: "2028-12-25", name: "Christmas Day" },
    ],
  },
  KE: {
    id: "KE",
    name: "Kenya public procurement calendar",
    country: "Kenya",
    timezone: "Africa/Nairobi",
    utcOffsetHours: 3,
    workingWeekdays: WEEKDAYS,
    addendumMinNoticeDays: 7,
    albResponseDays: 5,
    standstillDays: 10,
    complaintResponseDays: 14,
    calendarYears: [2026, 2027, 2028],
    holidays: [
      { date: "2026-01-01", name: "New Year's Day" },
      { date: "2026-04-03", name: "Good Friday" },
      { date: "2026-04-06", name: "Easter Monday" },
      { date: "2026-05-01", name: "Labour Day" },
      { date: "2026-06-01", name: "Madaraka Day" },
      { date: "2026-10-20", name: "Mashujaa Day" },
      { date: "2026-12-12", name: "Jamhuri Day" },
      { date: "2026-12-25", name: "Christmas Day" },
      { date: "2026-12-26", name: "Boxing Day" },
      { date: "2026-12-28", name: "Boxing Day (observed)", kind: "OBSERVED" },
      { date: "2027-01-01", name: "New Year's Day" },
      { date: "2027-03-26", name: "Good Friday" },
      { date: "2027-03-29", name: "Easter Monday" },
      { date: "2027-05-01", name: "Labour Day" },
      { date: "2027-05-03", name: "Labour Day (observed)", kind: "OBSERVED" },
      { date: "2027-06-01", name: "Madaraka Day" },
      { date: "2027-10-20", name: "Mashujaa Day" },
      { date: "2027-12-12", name: "Jamhuri Day" },
      { date: "2027-12-13", name: "Jamhuri Day (observed)", kind: "OBSERVED" },
      { date: "2027-12-25", name: "Christmas Day" },
      { date: "2027-12-27", name: "Christmas Day (observed)", kind: "OBSERVED" },
      { date: "2028-01-01", name: "New Year's Day" },
      { date: "2028-01-03", name: "New Year's Day (observed)", kind: "OBSERVED" },
      { date: "2028-04-14", name: "Good Friday" },
      { date: "2028-04-17", name: "Easter Monday" },
      { date: "2028-05-01", name: "Labour Day" },
      { date: "2028-06-01", name: "Madaraka Day" },
      { date: "2028-10-20", name: "Mashujaa Day" },
      { date: "2028-12-12", name: "Jamhuri Day" },
      { date: "2028-12-25", name: "Christmas Day" },
      { date: "2028-12-26", name: "Boxing Day" },
    ],
  },
};

export const DEFAULT_JURISDICTION: JurisdictionId = "ZM";

export function isJurisdictionId(value: unknown): value is JurisdictionId {
  return value === "KE" || value === "ZM";
}

export function jurisdictionPack(id: JurisdictionId | string | undefined): JurisdictionPack {
  return JURISDICTION_PACKS[isJurisdictionId(id) ? id : DEFAULT_JURISDICTION];
}

function partsInZone(date: Date, timeZone: string): { y: number; m: number; d: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    weekday: weekdays[String(parts.weekday)] ?? 0,
  };
}

function localDateKey(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function isHoliday(date: Date | string, pack: JurisdictionPack): Holiday | null {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return null;
  const key = localDateKey(d, pack.timezone);
  return pack.holidays.find((h) => h.date === key) ?? null;
}

export function isWorkingDay(date: Date | string, pack: JurisdictionPack): boolean {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return false;
  const p = partsInZone(d, pack.timezone);
  if (!pack.workingWeekdays.includes(p.weekday)) return false;
  return !isHoliday(d, pack);
}

/** Why a calendar day does not count — the reason shown on a deadline row. */
export function nonWorkingReason(date: Date | string, pack: JurisdictionPack): string | null {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "invalid date";
  const p = partsInZone(d, pack.timezone);
  if (!pack.workingWeekdays.includes(p.weekday)) return "weekend";
  const holiday = isHoliday(d, pack);
  return holiday ? holiday.name : null;
}

/** Add N working days in the jurisdiction's local calendar, preserving time of day. */
export function addWorkingDaysIn(iso: string, days: number, packOrId: JurisdictionPack | string): string {
  const pack = typeof packOrId === "string" ? jurisdictionPack(packOrId) : packOrId;
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) return iso;
  const cursor = new Date(start);
  let added = 0;
  while (added < days) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isWorkingDay(cursor, pack)) added += 1;
  }
  return cursor.toISOString();
}

/** Working days strictly after `a` and up to and including `b`. */
export function workingDaysBetweenIn(a: string, b: string, packOrId: JurisdictionPack | string): number {
  const pack = typeof packOrId === "string" ? jurisdictionPack(packOrId) : packOrId;
  const start = new Date(a);
  const end = new Date(b);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0;
  let n = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor <= end && isWorkingDay(cursor, pack)) n += 1;
  }
  return n;
}

/** A local date's end of day as a UTC instant: the closing time the notice implies. */
export function localEndOfDay(dateOnly: string, packOrId: JurisdictionPack | string): string | undefined {
  const pack = typeof packOrId === "string" ? jurisdictionPack(packOrId) : packOrId;
  const m = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const [, y, mo, d] = m;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), 23, 59, 59) - pack.utcOffsetHours * 3_600_000;
  return new Date(utc).toISOString();
}

/** A local wall-clock time as a UTC instant. */
export function localInstant(
  dateOnly: string,
  time: { hour: number; minute: number },
  packOrId: JurisdictionPack | string,
): string | undefined {
  const pack = typeof packOrId === "string" ? jurisdictionPack(packOrId) : packOrId;
  const m = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const [, y, mo, d] = m;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), time.hour, time.minute, 0) - pack.utcOffsetHours * 3_600_000;
  return new Date(utc).toISOString();
}

export interface AddendumNoticeState {
  closingDate: string;
  issuedAt: string;
  workingDaysLeft: number;
  minimumDays: number;
  requiresExtension: boolean;
  reason: string | null;
}

/**
 * The addendum fairness rule: an addendum issued inside the minimum-notice
 * window must move the closing date. Working days are counted in the local
 * calendar, so a Friday addendum before a Monday holiday is not treated as
 * giving bidders a full week.
 */
export function addendumNoticeState(
  closingDate: string | undefined,
  issuedAt: string,
  packOrId: JurisdictionPack | string,
): AddendumNoticeState | null {
  const pack = typeof packOrId === "string" ? jurisdictionPack(packOrId) : packOrId;
  if (!closingDate) return null;
  const closing = new Date(closingDate);
  if (Number.isNaN(closing.getTime())) return null;
  const left = workingDaysBetweenIn(issuedAt, closingDate, pack);
  const requiresExtension = left < pack.addendumMinNoticeDays;
  return {
    closingDate,
    issuedAt,
    workingDaysLeft: left,
    minimumDays: pack.addendumMinNoticeDays,
    requiresExtension,
    reason: requiresExtension
      ? `Only ${left} working day${left === 1 ? "" : "s"} remain before closing in ${pack.country} — the minimum is ${pack.addendumMinNoticeDays}. The addendum must extend the closing date.`
      : null,
  };
}

/** What the desk shows for a pack: its next holidays and its clock. */
export function calendarCoversYear(pack: JurisdictionPack, year: number): boolean {
  return pack.calendarYears.includes(year);
}

export function packSummary(pack: JurisdictionPack) {
  return {
    id: pack.id,
    name: pack.name,
    country: pack.country,
    timezone: pack.timezone,
    utcOffsetHours: pack.utcOffsetHours,
    addendumMinNoticeDays: pack.addendumMinNoticeDays,
    albResponseDays: pack.albResponseDays,
    standstillDays: pack.standstillDays,
    complaintResponseDays: pack.complaintResponseDays,
    calendarYears: [...pack.calendarYears],
    holidays: pack.holidays,
  };
}
