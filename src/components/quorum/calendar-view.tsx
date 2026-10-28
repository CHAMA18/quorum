"use client";

/**
 * CalendarView — the committee's calendar.
 *
 * One grid for every date the procurement desk answers to, and all of it is
 * read from records the system already keeps — nothing here is typed in by
 * hand and nothing is invented:
 *
 *   · statutory clocks  — the tender cycles' deadlines (closing, ALB
 *     response, standstill end, contract milestones, complaint responses),
 *     collected by the sidecar's own deadline core;
 *   · sittings          — the committee register's summoned sittings, live
 *     while the room is open;
 *   · the gate          — when a file was submitted for signature and when
 *     a named human signed or returned it.
 *
 * The record writes the dates; this page only reads them. An empty day says
 * so plainly rather than borrowing an item from somewhere else. Deadlines
 * that have passed stay on the grid in signal red — a calendar that quietly
 * forgives a missed statutory date would be worse than no calendar at all.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  Stamp,
} from "lucide-react";
import { SpecBar } from "@/components/quorum/reveal";
import { cn } from "@/lib/utils";

const SVC = "?XTransformPort=3031";
const EASE = [0.22, 1, 0.36, 1] as const;

const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];
const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/* ── what the sidecar already knows about time ──────────────────────────── */

type DeadlineDto = { tenderId: string; kind: string; dueAt: string; ref?: string; overdue?: boolean };

type SittingDto = {
  id: string;
  title: string;
  room: string;
  joinUrl: string;
  agenda: string | null;
  summonedBy: string;
  summonedAt: string;
  status: "OPEN" | "CLOSED";
  closedAt: string | null;
  attendance?: { admitted: boolean }[];
};

type MeetingDto = {
  id: string;
  title: string;
  agenda: string | null;
  startsAt: string;
  durationMinutes: number;
  scheduledBy: string;
  status: "SCHEDULED" | "CANCELLED";
  attendees?: { name: string }[];
};

type GateDto = {
  id: string;
  tenderId: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXECUTED";
  tool?: string;
  createdAt: string;
  decidedAt?: string;
  approver?: string;
};

/* ── events, one shape for every source ─────────────────────────────────── */

type EventTone = "clock" | "sitting" | "meeting" | "signed" | "returned" | "gate";

type CalEvent = {
  id: string;
  iso: string;
  /* The record's own clock time — absent for date-only statutory dates. */
  time?: string;
  tone: EventTone;
  kind: string;
  tender: string;
  detail: string;
  overdue?: boolean;
  live?: boolean;
};

const DEADLINE_LABEL: Record<string, string> = {
  CLOSING: "SUBMISSIONS CLOSE",
  ALB_DUE: "ALB RESPONSE DUE",
  STANDSTILL_END: "STANDSTILL ENDS",
  MILESTONE_DUE: "MILESTONE DUE",
  COMPLAINT_DUE: "COMPLAINT RESPONSE DUE",
};

const DEADLINE_DETAIL: Record<string, (ref?: string) => string> = {
  CLOSING: () => "The tender closes — a late bid stops counting here",
  ALB_DUE: (ref) => `${ref ?? "The bidder"} must justify the abnormally low bid`,
  STANDSTILL_END: () => "Standstill lifts — the award may be implemented",
  MILESTONE_DUE: (ref) => `${ref ?? "The milestone"} falls due on the contract`,
  COMPLAINT_DUE: (ref) => `${ref ?? "The complainant"} must receive a response`,
};

function humanTool(tool?: string): string {
  return (tool ?? "file_gate_submission").replace(/_/g, " ");
}

/* ── date helpers (local time throughout — the desk's own clock) ────────── */

const pad2 = (n: number) => String(n).padStart(2, "0");

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function clockTime(iso: string): string | undefined {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || (d.getHours() === 0 && d.getMinutes() === 0)) return undefined;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Countdown in the desk's voice: IN 5 D · TOMORROW · TODAY · 3 D OVERDUE. */
function relClock(iso: string, now: Date): { label: string; overdue: boolean; soon: boolean } {
  const ms = new Date(iso).getTime() - now.getTime();
  const days = Math.ceil(ms / 86_400_000);
  if (days > 1) return { label: `IN ${days} D`, overdue: false, soon: days <= 3 };
  if (days === 1) return { label: "TOMORROW", overdue: false, soon: true };
  if (days === 0) return { label: "TODAY", overdue: false, soon: true };
  return { label: `${-days} D OVERDUE`, overdue: true, soon: true };
}

/** Six stable weeks, Monday-first — the grid never jumps between months. */
function monthMatrix(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/* ── tone → colour, one vocabulary across cells, chips and the agenda ───── */

const DOT_CLS: Record<EventTone, string> = {
  clock: "bg-brand-500",
  sitting: "bg-ink-950 dark:bg-white",
  meeting: "bg-brand-400 dark:bg-brand-300",
  signed: "bg-emerald-500",
  returned: "bg-brand-300 dark:bg-brand-400",
  gate: "bg-ink-300 dark:bg-ink-400",
};

function chipCls(e: CalEvent): string {
  if (e.live) return "bg-emerald-600 text-white";
  if (e.overdue) return "bg-brand-600 text-white";
  switch (e.tone) {
    case "clock":
      return "bg-brand-50 text-brand-700 dark:bg-brand-500/12 dark:text-brand-300";
    case "sitting":
      return "bg-ink-950 text-white dark:bg-white dark:text-ink-950";
    case "meeting":
      return "border border-brand-300 bg-white text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300";
    case "signed":
      return "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-300";
    case "returned":
      return "border border-brand-200 bg-brand-50/60 text-brand-700 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-300";
    default:
      return "bg-ink-100 text-ink-600 dark:bg-white/10 dark:text-ink-200";
  }
}

function barCls(e: CalEvent): string {
  if (e.live) return "bg-emerald-500";
  if (e.overdue) return "bg-brand-600";
  switch (e.tone) {
    case "clock":
      return "bg-brand-500";
    case "sitting":
      return "bg-ink-950 dark:bg-white";
    case "meeting":
      return "bg-brand-400 dark:bg-brand-300";
    case "signed":
      return "bg-emerald-500";
    case "returned":
      return "bg-brand-300 dark:bg-brand-400";
    default:
      return "bg-ink-200 dark:bg-ink-400";
  }
}

/* ── the .ics round-trip: the month, out of the browser and into a diary ── */

function downloadIcs(filename: string, events: CalEvent[], now: Date): void {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const utcStamp = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Quorum//Committee Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const e of events) {
    const d = new Date(e.iso);
    const start = e.time
      ? `DTSTART:${d.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`
      : `DTSTART;VALUE=DATE:${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@quorum`,
      `DTSTAMP:${utcStamp}`,
      start,
      `SUMMARY:${esc(`${e.kind} — ${e.tender}`)}`,
      ...(e.detail ? [`DESCRIPTION:${esc(e.detail)}`] : []),
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ── small pieces ───────────────────────────────────────────────────────── */

function Stat({ label, value, alert }: { label: string; value: ReactNode; alert?: boolean }) {
  return (
    <div className="rounded-[12px] panel p-4 shadow-[0_1px_2px_rgba(11,12,15,0.04)]">
      <p className="font-code text-[8px] font-semibold tracking-[0.22em] text-ink-400">{label}</p>
      <p
        className={cn(
          "mt-2 font-display text-[28px] font-black leading-none tracking-[-0.02em] tabular",
          alert && value !== 0 ? "text-brand-600 dark:text-brand-400" : "text-ink-950"
        )}
      >
        {value}
      </p>
    </div>
  );
}

const LEGEND: { tone: EventTone | "overdue"; label: string }[] = [
  { tone: "clock", label: "STATUTORY CLOCK" },
  { tone: "overdue", label: "OVERDUE" },
  { tone: "sitting", label: "COMMITTEE SITTING" },
  { tone: "meeting", label: "SCHEDULED MEETING" },
  { tone: "gate", label: "AT THE GATE" },
  { tone: "signed", label: "SIGNED" },
  { tone: "returned", label: "RETURNED" },
];

/* ── the view ───────────────────────────────────────────────────────────── */

export function CalendarView({
  onToast,
  onGoCommittee,
}: {
  onToast: (m: string) => void;
  onGoCommittee: () => void;
}) {
  const reduce = useReducedMotion();

  /* The clock is only real once the browser answers — no SSR-guessed dates. */
  const [now, setNow] = useState<Date | null>(null);
  const [cursor, setCursor] = useState<{ y: number; m: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const [deadlines, setDeadlines] = useState<DeadlineDto[]>([]);
  const [sittings, setSittings] = useState<SittingDto[]>([]);
  const [meetings, setMeetings] = useState<MeetingDto[]>([]);
  const [gates, setGates] = useState<GateDto[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    const first = requestAnimationFrame(() => {
      const d = new Date();
      setNow(d);
      setCursor({ y: d.getFullYear(), m: d.getMonth() });
      setSelected(dayKey(d));
    });
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => {
      cancelAnimationFrame(first);
      clearInterval(id);
    };
  }, []);

  /* Poll the records this grid reads. When a source is unreachable the last
     snapshot stays on screen and the strip says so — a gap is reported, never
     filled with an invented date. */
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const [dl, cm, gt, sm] = await Promise.all([
          fetch(`/api/cycle/deadlines${SVC}`).then((x) => x.json()),
          fetch("/api/committee").then((x) => x.json()),
          fetch(`/api/gates${SVC}`).then((x) => x.json()),
          fetch(`/api/sample-tenders${SVC}`).then((x) => x.json()),
        ]);
        if (!alive) return;
        setDeadlines((dl.deadlines ?? []) as DeadlineDto[]);
        setSittings((cm.sittings ?? []) as SittingDto[]);
        setMeetings((cm.meetings ?? []) as MeetingDto[]);
        setGates((gt.gates ?? []) as GateDto[]);
        const map: Record<string, string> = {};
        for (const s of (sm.samples ?? []) as { ref: string; title?: string }[]) {
          if (s?.ref) map[s.ref] = s.title || s.ref;
        }
        setTitles(map);
        setUnreachable(false);
      } catch {
        if (alive) setUnreachable(true);
      }
    };
    void pull();
    const id = setInterval(() => void pull(), 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  /* Every source flattened into one event shape, newest record first. */
  const events = useMemo<CalEvent[]>(() => {
    if (!now) return [];
    const out: CalEvent[] = [];
    for (const d of deadlines) {
      const key = (d.kind || "DEADLINE").toUpperCase();
      const label = DEADLINE_LABEL[key] ?? "DEADLINE";
      out.push({
        id: `clock-${d.tenderId}-${key}-${d.dueAt}`,
        iso: d.dueAt,
        time: clockTime(d.dueAt),
        tone: "clock",
        kind: label,
        tender: d.tenderId,
        detail: (DEADLINE_DETAIL[key] ?? (() => "Falls due on the tender's own record"))(d.ref),
        overdue: d.overdue ?? new Date(d.dueAt).getTime() < now.getTime(),
      });
    }
    for (const s of sittings) {
      const live = s.status === "OPEN";
      const admitted = (s.attendance ?? []).filter((a) => a.admitted).length;
      out.push({
        id: `sitting-${s.id}`,
        iso: s.summonedAt,
        time: clockTime(s.summonedAt),
        tone: "sitting",
        kind: live ? "SITTING LIVE" : "COMMITTEE SITTING",
        tender: s.room.toUpperCase(),
        detail: s.title,
        live,
      });
      if (admitted > 0) {
        /* The door record sits on the same day as the summons it belongs to. */
        out.push({
          id: `door-${s.id}`,
          iso: s.summonedAt,
          time: clockTime(s.summonedAt),
          tone: "signed",
          kind: "DOOR RECORD",
          tender: s.room.toUpperCase(),
          detail: `${admitted} member${admitted === 1 ? "" : "s"} admitted to the sitting${s.agenda ? ` — ${s.agenda}` : ""}`,
        });
      }
    }
    for (const m of meetings) {
      if (m.status !== "SCHEDULED") continue;
      const invited = (m.attendees ?? []).length;
      out.push({
        id: `meeting-${m.id}`,
        iso: m.startsAt,
        time: clockTime(m.startsAt),
        tone: "meeting",
        kind: "SCHEDULED MEETING",
        tender: m.title,
        detail: `${m.durationMinutes} min with ${invited} player${invited === 1 ? "" : "s"} — called by ${m.scheduledBy}${
          m.agenda ? ` · ${m.agenda}` : ""
        }`,
      });
    }
    for (const g of gates) {
      if (g.status === "PENDING") {
        out.push({
          id: `gate-${g.id}`,
          iso: g.createdAt,
          time: clockTime(g.createdAt),
          tone: "gate",
          kind: "AT THE GATE",
          tender: g.tenderId,
          detail: `${humanTool(g.tool)} — submitted, awaiting a named signature`,
        });
      } else if (g.decidedAt) {
        const returned = g.status === "REJECTED";
        out.push({
          id: `decided-${g.id}`,
          iso: g.decidedAt,
          time: clockTime(g.decidedAt),
          tone: returned ? "returned" : "signed",
          kind: returned ? "RETURNED FOR REVIEW" : "AWARD SIGNED",
          tender: g.tenderId,
          detail: returned
            ? `${g.approver ?? "The committee"} sent the file back for clarification`
            : `${g.approver ?? "A named signer"} released the sealed filing`,
        });
      }
    }
    return out.sort((a, b) => b.iso.localeCompare(a.iso));
  }, [deadlines, sittings, meetings, gates, now]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of events) {
      const key = dayKey(new Date(e.iso));
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
    }
    return map;
  }, [events]);

  const todayKey = now ? dayKey(now) : "";

  const monthEvents = useMemo(() => {
    if (!cursor) return [];
    return events.filter((e) => {
      const d = new Date(e.iso);
      return d.getFullYear() === cursor.y && d.getMonth() === cursor.m;
    });
  }, [events, cursor]);

  const clocksThisMonth = monthEvents.filter((e) => e.tone === "clock").length;
  const overdueTotal = events.filter((e) => e.tone === "clock" && e.overdue).length;
  const sittingsThisMonth = monthEvents.filter((e) => e.tone === "sitting").length;
  const meetingsThisMonth = monthEvents.filter((e) => e.tone === "meeting").length;
  const signedThisMonth = monthEvents.filter((e) => e.tone === "signed" && e.kind === "AWARD SIGNED").length;

  /* Next on the clock — the open statutory dates, soonest first. */
  const upcoming = useMemo(() => {
    if (!now) return [];
    return events
      .filter((e) => e.tone === "clock" && new Date(e.iso).getTime() >= now.getTime())
      .sort((a, b) => a.iso.localeCompare(b.iso))
      .slice(0, 5);
  }, [events, now]);

  const dayEvents = selected ? (byDay.get(selected) ?? []) : [];
  const selectedDate = selected ? new Date(`${selected}T00:00:00`) : null;

  const turnMonth = (delta: number) =>
    setCursor((c) => {
      if (!c) return c;
      const d = new Date(c.y, c.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });

  const goToday = () => {
    if (!now) return;
    setCursor({ y: now.getFullYear(), m: now.getMonth() });
    setSelected(dayKey(now));
  };

  /* Jump the grid to the day a clock falls on — the rail drives the month. */
  const followEvent = (e: CalEvent) => {
    const d = new Date(e.iso);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
    setSelected(dayKey(d));
  };

  const exportMonth = () => {
    if (!cursor || monthEvents.length === 0) return;
    downloadIcs(`quorum-calendar-${cursor.y}-${pad2(cursor.m + 1)}.ics`, monthEvents, now ?? new Date());
    onToast(`CALENDAR EXPORTED — ${monthEvents.length} ITEM${monthEvents.length === 1 ? "" : "S"} · ICS`);
  };

  const cells = cursor ? monthMatrix(cursor.y, cursor.m) : [];
  const gridKey = cursor ? `${cursor.y}-${cursor.m}` : "boot";

  return (
    <div>
      <SpecBar index="17" label="Workspace" meta="Calendar" />

      {/* ── Head ── */}
      <div className="mt-6 flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <h1 className="type-display text-[30px] text-ink-950 sm:text-[38px]">
            Calendar<span className="text-brand-600">.</span>
          </h1>
          <p className="type-lede mt-3 max-w-[56ch] text-ink-600">
            Every date the desk answers to — statutory clocks from the tender cycles, sittings from the committee
            register, signatures from the gate. The record writes the dates; this page only reads them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goToday}
            className="focus-brand inline-flex h-10 items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 font-code text-[9px] font-bold tracking-[0.18em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950"
          >
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            TODAY
          </button>
          <button
            type="button"
            onClick={exportMonth}
            disabled={monthEvents.length === 0}
            title="Download this month's items as an .ics calendar file"
            className="focus-brand inline-flex h-10 items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 font-code text-[9px] font-bold tracking-[0.18em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            EXPORT .ICS
          </button>
        </div>
      </div>

      {unreachable && (
        <p
          role="status"
          className="mt-5 rounded-[10px] border border-brand-200 bg-brand-50 px-4 py-3 font-code text-[8.5px] tracking-[0.16em] text-brand-800 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-300"
        >
          A CALENDAR SOURCE IS UNREACHABLE — THE LAST READ RECORDS STAY ON THE GRID; NOTHING IS INVENTED IN THE GAP
        </p>
      )}

      {/* ── Stat strip ── */}
      <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {[
          { label: "CLOCKS THIS MONTH", value: clocksThisMonth },
          { label: "OVERDUE", value: overdueTotal, alert: true },
          { label: "SITTINGS THIS MONTH", value: sittingsThisMonth },
          { label: "AWARDS SIGNED THIS MONTH", value: signedThisMonth },
        ].map((s) => (
          <Stat key={s.label} label={s.label} value={s.value} alert={s.alert} />
        ))}
      </div>

      {/* ── Grid + agenda ── */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
        <div data-tour="cal-month" className="min-w-0 lg:col-span-2">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="overflow-hidden rounded-[12px] panel shadow-[0_1px_2px_rgba(11,12,15,0.04)]"
          >
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200/70 px-5 py-4 dark:border-white/10">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-500/10">
                  <CalendarDays className="h-4 w-4 text-brand-600 dark:text-brand-300" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="type-title text-ink-950" aria-live="polite">
                    {cursor ? `${MONTHS[cursor.m]} ${cursor.y}` : "LOADING"}
                  </h2>
                  <p className="mt-1 type-micro text-ink-400">
                    {monthEvents.length} item{monthEvents.length === 1 ? "" : "s"} on the record ·{" "}
                    {sittingsThisMonth} sitting{sittingsThisMonth === 1 ? "" : "s"} · {meetingsThisMonth} meeting
                    {meetingsThisMonth === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => turnMonth(-1)}
                  aria-label="Previous month"
                  className="focus-brand grid h-9 w-9 place-items-center rounded-xl border border-ink-200 bg-white text-ink-500 transition-colors hover:border-ink-950 hover:text-ink-950 dark:border-white/10 dark:hover:border-white/30"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => turnMonth(1)}
                  aria-label="Next month"
                  className="focus-brand grid h-9 w-9 place-items-center rounded-xl border border-ink-200 bg-white text-ink-500 transition-colors hover:border-ink-950 hover:text-ink-950 dark:border-white/10 dark:hover:border-white/30"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </header>

            <div className="px-3 pb-4 pt-3 sm:px-4">
              <div className="grid grid-cols-7 px-1 pb-1.5">
                {WEEKDAYS.map((w, i) => (
                  <span
                    key={w}
                    className={cn(
                      "text-center font-code text-[8px] font-bold tracking-[0.18em] text-ink-400",
                      i > 4 && "text-ink-400 dark:text-ink-500"
                    )}
                  >
                    {w}
                  </span>
                ))}
              </div>

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={gridKey}
                  initial={reduce ? false : { opacity: 0, x: 18 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduce ? undefined : { opacity: 0, x: -18 }}
                  transition={{ duration: 0.22, ease: EASE }}
                  className="grid grid-cols-7 gap-1"
                >
                  {cells.map((d) => {
                    const key = dayKey(d);
                    const inMonth = d.getMonth() === cursor?.m;
                    const isToday = key === todayKey;
                    const isSelected = key === selected;
                    const evs = byDay.get(key) ?? [];
                    return (
                      <button
                        key={key}
                        type="button"
                        tabIndex={inMonth ? 0 : -1}
                        onClick={() => setSelected(key)}
                        aria-pressed={isSelected}
                        aria-label={`${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} — ${evs.length} item${evs.length === 1 ? "" : "s"} on the record`}
                        className={cn(
                          "focus-brand flex min-h-[62px] flex-col gap-1 rounded-xl border p-1.5 text-left transition-colors sm:min-h-[96px]",
                          isSelected
                            ? "border-ink-950 bg-ink-950/[0.04] dark:border-white/25 dark:bg-white/[0.06]"
                            : "border-transparent hover:border-ink-200 hover:bg-paper dark:hover:border-white/10",
                          !inMonth && "opacity-45"
                        )}
                      >
                        <span className="flex items-center justify-between gap-1">
                          <span
                            className={cn(
                              "grid h-5 min-w-5 place-items-center rounded-full px-1 font-code text-[9px] font-bold tabular",
                              isToday
                                ? "bg-brand-600 text-white"
                                : "text-ink-500 dark:text-ink-400"
                            )}
                          >
                            {d.getDate()}
                          </span>
                          <span className="flex shrink-0 gap-[3px]" aria-hidden="true">
                            {evs.slice(0, 3).map((e) => (
                              <span key={e.id} className={cn("h-1.5 w-1.5 rounded-full", DOT_CLS[e.tone])} />
                            ))}
                          </span>
                        </span>
                        <span className="hidden flex-col gap-1 sm:flex" aria-hidden="true">
                          {evs.slice(0, 2).map((e) => (
                            <span
                              key={e.id}
                              className={cn(
                                "truncate rounded-md px-1 py-[2px] font-code text-[7px] font-bold leading-none tracking-[0.1em]",
                                chipCls(e)
                              )}
                            >
                              {e.kind}
                            </span>
                          ))}
                          {evs.length > 2 && (
                            <span className="font-code text-[7px] tracking-[0.12em] text-ink-400">
                              +{evs.length - 2} MORE
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </motion.div>
              </AnimatePresence>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-ink-100 px-1 pt-3 dark:border-white/10">
                {LEGEND.map((l) => (
                  <span key={l.label} className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        l.tone === "overdue" ? "bg-brand-600" : DOT_CLS[l.tone as EventTone]
                      )}
                      aria-hidden="true"
                    />
                    <span className="font-code text-[7.5px] font-semibold tracking-[0.16em] text-ink-400">
                      {l.label}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          </motion.div>
        </div>

        {/* ── Right column: the day, then the clock ── */}
        <div className="grid content-start gap-4 sm:gap-6">
          <motion.div
            data-tour="cal-agenda"
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.08, ease: EASE }}
            className="overflow-hidden rounded-[12px] panel shadow-[0_1px_2px_rgba(11,12,15,0.04)]"
          >
            <header className="flex items-center justify-between gap-3 border-b border-ink-200/70 px-5 py-4 dark:border-white/10">
              <div>
                <p className="font-code text-[8px] font-semibold tracking-[0.24em] text-ink-400">
                  {selectedDate && !Number.isNaN(selectedDate.getTime())
                    ? selectedDate
                        .toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long" })
                        .toUpperCase()
                    : "—"}
                  {selected === todayKey && now ? ` · ${`${pad2(now.getHours())}:${pad2(now.getMinutes())}`}` : ""}
                </p>
                <h2 className="type-title mt-1 text-ink-950">The day&apos;s agenda</h2>
              </div>
              <span
                className={cn(
                  "inline-flex h-7 shrink-0 items-center rounded-full px-2.5 font-code text-[8.5px] font-bold tracking-[0.16em]",
                  dayEvents.length > 0
                    ? "bg-ink-950 text-white dark:bg-white dark:text-ink-950"
                    : "border border-ink-200 text-ink-400 dark:border-white/15"
                )}
              >
                {dayEvents.length} {dayEvents.length === 1 ? "ITEM" : "ITEMS"}
              </span>
            </header>

            <ul className="max-h-[420px] divide-y divide-ink-100 overflow-y-auto px-2 py-2 [scrollbar-width:thin] dark:divide-white/5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-ink-200 [&::-webkit-scrollbar]:w-1">
              <AnimatePresence initial={false}>
                {dayEvents.map((e) => {
                  const rel = e.tone === "clock" ? relClock(e.iso, now ?? new Date()) : null;
                  const title = titles[e.tender];
                  return (
                    <motion.li
                      key={e.id}
                      layout
                      initial={reduce ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.25, ease: EASE }}
                      className="flex gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-paper dark:hover:bg-white/[0.03]"
                    >
                      <span className={cn("mt-0.5 w-[3px] shrink-0 self-stretch rounded-full", barCls(e))} aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="font-code text-[8px] tracking-[0.18em] text-ink-400">
                          {e.time ?? "ALL DAY"} · {e.kind}
                        </p>
                        <p className="mt-1 text-[13px] font-semibold leading-snug text-ink-900">{e.detail}</p>
                        <p className="mt-0.5 truncate font-code text-[8.5px] tracking-[0.12em] text-ink-500">
                          {e.tender}
                          {title && title !== e.tender ? ` · ${title}` : ""}
                        </p>
                        {(rel || e.live) && (
                          <span className="mt-1.5 flex flex-wrap gap-1.5">
                            {e.live && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-code text-[7.5px] font-bold tracking-[0.14em] text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-300">
                                <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                                  <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-emerald-500" />
                                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-600" />
                                </span>
                                ROOM LIVE
                              </span>
                            )}
                            {rel && (
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full px-2 py-0.5 font-code text-[7.5px] font-bold tracking-[0.14em]",
                                  rel.overdue
                                    ? "bg-brand-600 text-white"
                                    : rel.soon
                                      ? "bg-brand-50 text-brand-700 dark:bg-brand-500/12 dark:text-brand-300"
                                      : "bg-ink-100 text-ink-500 dark:bg-white/10 dark:text-ink-300"
                                )}
                              >
                                {rel.label}
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
              {dayEvents.length === 0 && (
                <li className="px-4 py-8 text-center">
                  <p className="font-code text-[9px] font-bold tracking-[0.2em] text-ink-400">
                    NOTHING ON THE RECORD FOR THIS DATE
                  </p>
                  <p className="mx-auto mt-2 max-w-[240px] text-[12.5px] leading-relaxed text-ink-500">
                    No clock falls due, no sitting was summoned and no gate was signed on this day. Pick another date,
                    or summon the committee.
                  </p>
                  <button
                    type="button"
                    onClick={onGoCommittee}
                    className="focus-brand mt-4 inline-flex h-9 items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-4 font-code text-[9px] font-bold tracking-[0.18em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950"
                  >
                    <Stamp className="h-3.5 w-3.5" aria-hidden="true" />
                    OPEN THE COMMITTEE
                  </button>
                </li>
              )}
            </ul>
          </motion.div>

          <motion.div
            data-tour="cal-clocks"
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.14, ease: EASE }}
            className="overflow-hidden rounded-[12px] panel shadow-[0_1px_2px_rgba(11,12,15,0.04)]"
          >
            <header className="border-b border-ink-200/70 px-5 py-4 dark:border-white/10">
              <h2 className="type-title text-ink-950">Next on the clock</h2>
              <p className="mt-1 type-micro text-ink-400">Open statutory dates, soonest first · select one to jump</p>
            </header>
            <ul className="divide-y divide-ink-100 px-2 py-1.5 dark:divide-white/5">
              {upcoming.map((e) => {
                const rel = relClock(e.iso, now ?? new Date());
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => followEvent(e)}
                      className="focus-brand flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-paper dark:hover:bg-white/[0.03]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-semibold text-ink-900">{e.kind}</span>
                        <span className="mt-0.5 block truncate font-code text-[8px] tracking-[0.12em] text-ink-400">
                          {e.tender}
                          {titles[e.tender] && titles[e.tender] !== e.tender ? ` · ${titles[e.tender]}` : ""}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center rounded-full px-2 py-1 font-code text-[8px] font-bold tracking-[0.14em]",
                          rel.overdue
                            ? "bg-brand-600 text-white"
                            : rel.soon
                              ? "bg-brand-50 text-brand-700 dark:bg-brand-500/12 dark:text-brand-300"
                              : "bg-ink-100 text-ink-500 dark:bg-white/10 dark:text-ink-300"
                        )}
                      >
                        {rel.label}
                      </span>
                    </button>
                  </li>
                );
              })}
              {now && upcoming.length === 0 && (
                <li className="px-4 py-8 text-center">
                  <p className="font-code text-[9px] font-bold tracking-[0.2em] text-ink-400">NO OPEN CLOCKS</p>
                  <p className="mx-auto mt-2 max-w-[240px] text-[12.5px] leading-relaxed text-ink-500">
                    Every statutory date on the record has passed or been cleared. New clocks appear the moment a
                    tender cycle writes one.
                  </p>
                </li>
              )}
              {!now && (
                <li className="h-[124px] animate-pulse rounded-xl bg-ink-50/60" aria-hidden="true" />
              )}
            </ul>
          </motion.div>

          {/* The standing rule, restated for the calendar's own job */}
          <div className="relative overflow-hidden rounded-[12px] border border-ink-950 bg-night p-5 text-white shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_28px_60px_-30px_rgba(11,12,15,0.6)]">
            <div className="bg-grid-dark pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-500/70 to-transparent"
            />
            <div className="relative">
              <h3 className="type-title">The calendar keeps no opinions</h3>
              <p className="mt-3 font-code text-[9px] leading-[2] tracking-[0.16em] text-ink-300">
                EVERY DATE HERE WAS WRITTEN
                <br />
                BY A RECORD — A CLOSING, A SUMMONS,
                <br />A SIGNATURE.
                <br />
                <span className="text-brand-400">THE AGENT CANNOT MOVE A CLOCK. IT CAN ONLY MEET ONE.</span>
              </p>
              <button
                type="button"
                onClick={onGoCommittee}
                className="focus-brand mt-4 inline-flex items-center gap-1.5 font-code text-[8.5px] font-bold tracking-[0.2em] text-ink-300 transition-colors hover:text-white"
              >
                OPEN THE COMMITTEE REGISTER
                <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
