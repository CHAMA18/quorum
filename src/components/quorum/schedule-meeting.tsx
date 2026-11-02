"use client";

/**
 * Schedule a meeting — the owner names the day and the players, and the
 * committee diary gets a real entry with a freshly minted Jitsi room.
 *
 * The guest list is deliberately wider than the register: committee members,
 * workspace players and named outside players (a supplier, oversight, anyone
 * off the roll) can all be invited. The owner is added automatically on the
 * server. Nothing is scheduled without at least one other named player.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowUpRight, CalendarPlus, Check, Copy, Users, X } from "lucide-react";
import { trapTabFocus } from "@/lib/a11y";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ── shapes shared with the committee view ─────────────────────────────── */

export type ScheduledMeetingAttendee = {
  key: string;
  name: string;
  email: string | null;
  source: "COMMITTEE" | "PLAYER" | "EXTERNAL";
};

export type ScheduledMeeting = {
  id: string;
  title: string;
  agenda: string | null;
  joinUrl: string;
  startsAt: string;
  durationMinutes: number;
  scheduledBy: string;
  scheduledById: string;
  createdAt: string;
  status: "SCHEDULED" | "CANCELLED";
  attendees: ScheduledMeetingAttendee[];
  /* Weekly series thread — 1 of 1 for a one-off meeting. */
  seriesId?: string | null;
  seriesIndex?: number;
  seriesCount?: number;
};

export type MeetingMember = {
  id: string;
  name: string;
  role: string;
  status: "PRESENT" | "EXCUSED";
};

export type MeetingDraft = {
  title: string;
  agenda: string;
  startsAt: string;
  durationMinutes: number;
  /* 1 = one-off; 2–12 writes a weekly series, one record per occurrence. */
  repeatWeeks: number;
  memberIds: string[];
  playerIds: string[];
  externals: { name: string; email: string }[];
};

/* ── small helpers ─────────────────────────────────────────────────────── */

const pad2 = (n: number) => String(n).padStart(2, "0");

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function defaultStart(): { date: string; time: string } {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return { date: localDateKey(d), time: "10:00" };
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "Q";
}

function whenOf(iso: string): { day: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { day: "—", time: "—:—" };
  return {
    day: d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" }).toUpperCase(),
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  };
}

function guestLine(attendees: ScheduledMeetingAttendee[]): string {
  return attendees
    .map((a) => a.name)
    .filter(Boolean)
    .join(" · ");
}

/* ── the scheduler ─────────────────────────────────────────────────────── */

export function ScheduleMeetingDialog({
  members,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  members: MeetingMember[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (draft: MeetingDraft) => void;
}) {
  const initial = useMemo(() => defaultStart(), []);
  const [title, setTitle] = useState("");
  const [agenda, setAgenda] = useState("");
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [duration, setDuration] = useState("60");
  const [repeat, setRepeat] = useState<"NONE" | "WEEKLY">("NONE");
  const [weeks, setWeeks] = useState("4");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [playerIds, setPlayerIds] = useState<string[]>([]);
  const [externals, setExternals] = useState<{ name: string; email: string }[]>([]);
  const [extName, setExtName] = useState("");
  const [extEmail, setExtEmail] = useState("");
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [players, setPlayers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [playersLoaded, setPlayersLoaded] = useState(false);
  const [playersFailed, setPlayersFailed] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const active = document.activeElement;
    const opener = active instanceof HTMLElement ? active : null;
    const frame = requestAnimationFrame(() => titleRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      if (opener?.isConnected) requestAnimationFrame(() => opener.focus());
    };
  }, []);

  /* Workspace accounts are optional guests — if the roster cannot be read the
     dialog still works from the register and named outside players. */
  useEffect(() => {
    let alive = true;
    fetch("/api/team")
      .then((r) => {
        if (!r.ok) throw new Error("failed");
        return r.json() as Promise<{ members?: { id: string; name: string; email: string; currentAccount?: boolean }[] }>;
      })
      .then((d) => {
        if (!alive) return;
        setPlayers(
          (d.members ?? [])
            .filter((m) => !m.currentAccount)
            .map((m) => ({ id: m.id, name: m.name, email: m.email }))
        );
        setPlayersLoaded(true);
      })
      .catch(() => {
        if (alive) {
          setPlayersFailed(true);
          setPlayersLoaded(true);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy) return;
      const focusedModal = document.activeElement?.closest('[role="dialog"][aria-modal="true"]');
      if (focusedModal && focusedModal !== dialogRef.current) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const addExternal = () => {
    const name = extName.trim();
    const email = extEmail.trim().toLowerCase();
    if (name.length < 2) {
      setLocalErr("Name the outside player — a meeting needs a person, not a placeholder.");
      return;
    }
    if (email && !EMAIL_RE.test(email)) {
      setLocalErr("That does not look like an email address. Leave it blank to invite by name only.");
      return;
    }
    if (
      externals.some(
        (x) => (email && x.email.toLowerCase() === email) || (!email && x.name.trim().toLowerCase() === name.toLowerCase())
      )
    ) {
      setLocalErr("That player is already on the guest list.");
      return;
    }
    setExternals((x) => [...x, { name, email }]);
    setExtName("");
    setExtEmail("");
    setLocalErr(null);
  };

  const invited = memberIds.length + playerIds.length + externals.length;
  const minutes = Number(duration);
  const occurrences = repeat === "WEEKLY" ? Number(weeks) : 1;

  /* The last date in a weekly run — shown before the owner commits, so the
     series end is a stated date rather than mental arithmetic. */
  const lastDate = (() => {
    if (repeat !== "WEEKLY") return null;
    const start = new Date(`${date}T${time || "00:00"}`);
    if (Number.isNaN(start.getTime())) return null;
    const count = Number(weeks);
    if (!Number.isFinite(count) || count < 2) return null;
    start.setDate(start.getDate() + (Math.min(12, Math.round(count)) - 1) * 7);
    return start.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
  })();

  const submission = () => {
    if (busy) return;
    if (title.trim().length < 3) {
      setLocalErr("Give the meeting a title of at least three characters.");
      return;
    }
    const when = new Date(`${date}T${time || "00:00"}`);
    if (Number.isNaN(when.getTime())) {
      setLocalErr("Pick a real date and start time for the meeting.");
      return;
    }
    if (when.getTime() < Date.now() + 60_000) {
      setLocalErr("Pick a start time at least a minute ahead — a meeting cannot travel backwards.");
      return;
    }
    if (!Number.isFinite(minutes) || minutes < 15 || minutes > 480) {
      setLocalErr("A meeting runs between 15 and 480 minutes.");
      return;
    }
    if (repeat === "WEEKLY" && (!Number.isInteger(occurrences) || occurrences < 2 || occurrences > 12)) {
      setLocalErr("A weekly series runs between 2 and 12 meetings.");
      return;
    }
    if (invited === 0) {
      setLocalErr("Name at least one other player — the owner is already on the list.");
      return;
    }
    setLocalErr(null);
    onSubmit({
      title: title.trim(),
      agenda: agenda.trim(),
      startsAt: when.toISOString(),
      durationMinutes: Math.round(minutes),
      repeatWeeks: repeat === "WEEKLY" ? occurrences : 1,
      memberIds,
      playerIds,
      externals,
    });
  };

  const shownError = localErr ?? error;

  return (
    <motion.div
      key="meeting-modal"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[70] grid place-items-center bg-night/70 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-meeting-title"
        tabIndex={-1}
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12 }}
        transition={{ duration: 0.28, ease: EASE }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(event) => trapTabFocus(event, dialogRef.current)}
        className="max-h-[min(92dvh,900px)] w-full max-w-2xl overflow-y-auto rounded-[12px] panel panel-lift p-5 sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2.5 font-code text-[10px] font-semibold tracking-[0.1em] text-ink-500">
              <span className="inline-block h-[2px] w-5 bg-brand-600" aria-hidden="true" />
              THE COMMITTEE DIARY
            </p>
            <h3 id="schedule-meeting-title" className="mt-1.5 font-display text-[22px] font-black tracking-[-0.02em] text-ink-950">
              Schedule a meeting<span className="text-brand-600">.</span>
            </h3>
            <p className="mt-1.5 max-w-lg text-[12.5px] leading-relaxed text-ink-500">
              Set a date, then invite committee members, workspace colleagues, or outside guests. Quorum creates a
              unlisted meeting room and includes its link in each invitation; guests do not need a Quorum account or an app.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!busy) onClose();
            }}
            aria-label="Close without scheduling"
            className="focus-brand grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-paper hover:text-ink-900"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submission();
          }}
        >
          <label className="block">
            <span className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-500">MEETING TITLE</span>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setLocalErr(null);
              }}
              placeholder="e.g. Award decision — QRM-2026-041"
              minLength={3}
              maxLength={140}
              required
              aria-required="true"
              className="mt-1.5 h-11 w-full rounded-xl border border-ink-200 bg-white px-3.5 text-[13px] text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-ink-950"
            />
          </label>

          <label className="block">
            <span className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-500">
              AGENDA <span className="text-ink-300">· OPTIONAL</span>
            </span>
            <textarea
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="What the meeting decides, and what each player brings."
              className="mt-1.5 w-full resize-none rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-ink-950"
            />
          </label>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="block">
              <span className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-500">DATE</span>
              <input
                type="date"
                value={date}
                min={localDateKey(new Date())}
                onChange={(e) => {
                  setDate(e.target.value);
                  setLocalErr(null);
                }}
                required
                aria-required="true"
                className="mt-1.5 h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-[12.5px] text-ink-950 outline-none transition focus:border-ink-950"
              />
            </label>
            <label className="block">
              <span className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-500">STARTS</span>
              <input
                type="time"
                value={time}
                onChange={(e) => {
                  setTime(e.target.value);
                  setLocalErr(null);
                }}
                required
                aria-required="true"
                className="mt-1.5 h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-[12.5px] text-ink-950 outline-none transition focus:border-ink-950"
              />
            </label>
            <label className="block">
              <span className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-500">MINUTES</span>
              <input
                type="number"
                inputMode="numeric"
                min={15}
                max={480}
                step={15}
                value={duration}
                onChange={(e) => {
                  setDuration(e.target.value);
                  setLocalErr(null);
                }}
                className="mt-1.5 h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-[12.5px] tabular text-ink-950 outline-none transition focus:border-ink-950"
              />
            </label>
            <label className="col-span-2 block sm:col-span-1">
              <span className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-500">REPEAT</span>
              <select
                value={repeat}
                onChange={(e) => {
                  setRepeat(e.target.value === "WEEKLY" ? "WEEKLY" : "NONE");
                  setLocalErr(null);
                }}
                className="mt-1.5 h-11 w-full rounded-xl border border-ink-200 bg-white px-2.5 text-[12.5px] text-ink-950 outline-none transition focus:border-ink-950"
              >
                <option value="NONE">Does not repeat</option>
                <option value="WEEKLY">Weekly</option>
              </select>
            </label>
            {repeat === "WEEKLY" && (
              <div className="col-span-2 flex flex-wrap items-end justify-between gap-3 rounded-xl border border-ink-100 bg-paper/50 px-3.5 py-3 sm:col-span-4">
                <label className="block">
                  <span className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-500">
                    NUMBER OF WEEKLY MEETINGS
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={2}
                    max={12}
                    step={1}
                    value={weeks}
                    onChange={(e) => {
                      setWeeks(e.target.value);
                      setLocalErr(null);
                    }}
                    aria-label="Number of weekly meetings, 2 to 12"
                    className="mt-1.5 h-11 w-24 rounded-lg border border-ink-200 bg-white px-3 text-[12.5px] tabular text-ink-950 outline-none transition focus:border-ink-950"
                  />
                </label>
                <p className="max-w-[36ch] text-[11.5px] leading-relaxed text-ink-500">
                  Every 7 days.{lastDate ? ` Last meeting ${lastDate}.` : ""} Each week gets its own diary record and
                  its own room, so a meeting can be moved or cancelled on its own.
                </p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-ink-100 bg-paper/50 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 font-code text-[10px] font-bold tracking-[0.08em] text-ink-600">
                <Users className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" />
                OTHER PLAYERS
              </p>
              <p className="font-code text-[10px] tracking-[0.04em] text-ink-500">
                {invited} INVITED · YOU ARE ADDED AUTOMATICALLY
              </p>
            </div>

            <div className="mt-3 space-y-4">
              <fieldset>
                <legend className="w-full font-code text-[10px] font-bold tracking-[0.08em] text-ink-500">
                  THE COMMITTEE REGISTER
                </legend>
                {members.length > 0 ? (
                  <div className="mt-1.5 grid max-h-40 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                    {members.map((m) => {
                      const on = memberIds.includes(m.id);
                      return (
                        <label
                          key={m.id}
                          className={cn(
                            "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-colors",
                            on ? "border-ink-950 bg-ink-950/[0.05]" : "border-ink-200 bg-white hover:border-ink-400"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => setMemberIds((x) => toggle(x, m.id))}
                            className="h-4 w-4 shrink-0 accent-brand-600"
                          />
                          <span
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink-950 font-code text-[10px] font-bold text-white"
                            aria-hidden="true"
                          >
                            {initialsOf(m.name)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] font-semibold text-ink-950">{m.name}</span>
                            <span className="block truncate font-code text-[10px] tracking-[0.02em] text-ink-500">
                              {m.role}
                            </span>
                          </span>
                          {m.status === "EXCUSED" && (
                            <span className="ml-auto shrink-0 font-code text-[10px] tracking-[0.02em] text-ink-500">
                              EXCUSED
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-ink-500">
                    The register is empty — invite workspace players or name an outside player below.
                  </p>
                )}
              </fieldset>

              <fieldset>
                <legend className="w-full font-code text-[10px] font-bold tracking-[0.08em] text-ink-500">
                  WORKSPACE PLAYERS
                </legend>
                {!playersLoaded ? (
                  <p className="mt-1.5 font-code text-[10px] tracking-[0.04em] text-ink-500">Reading the team roster…</p>
                ) : playersFailed ? (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-ink-500">
                    The workspace roster could not be read — the register and outside players still work.
                  </p>
                ) : players.length > 0 ? (
                  <div className="mt-1.5 grid max-h-36 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                    {players.map((p) => {
                      const on = playerIds.includes(p.id);
                      return (
                        <label
                          key={p.id}
                          className={cn(
                            "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-colors",
                            on ? "border-ink-950 bg-ink-950/[0.05]" : "border-ink-200 bg-white hover:border-ink-400"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => setPlayerIds((x) => toggle(x, p.id))}
                            className="h-4 w-4 shrink-0 accent-brand-600"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] font-semibold text-ink-950">{p.name}</span>
                            <span className="block truncate font-code text-[10px] tracking-[0.02em] text-ink-500">
                              {p.email}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-ink-500">
                    No other workspace accounts are registered yet.
                  </p>
                )}
              </fieldset>

              <fieldset>
                <legend className="w-full font-code text-[10px] font-bold tracking-[0.08em] text-ink-500">
                  OUTSIDE PLAYERS <span className="text-ink-300">· SUPPLIER, OVERSIGHT, ANYONE OFF THE ROLL</span>
                </legend>
                <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                  <input
                    value={extName}
                    onChange={(e) => {
                      setExtName(e.target.value);
                      setLocalErr(null);
                    }}
                    placeholder="Full name"
                    aria-label="Outside player's full name"
                    className="h-11 min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-3 text-[12.5px] text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-ink-950"
                  />
                  <input
                    value={extEmail}
                    onChange={(e) => {
                      setExtEmail(e.target.value);
                      setLocalErr(null);
                    }}
                    placeholder="Email — optional"
                    aria-label="Outside player's email, optional"
                    className="h-11 min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-3 text-[12.5px] text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-ink-950"
                  />
                  <button
                    type="button"
                    onClick={addExternal}
                    className="focus-brand inline-flex h-11 min-h-11 shrink-0 items-center justify-center rounded-lg border border-ink-200 bg-white px-3.5 font-code text-[10px] font-bold tracking-[0.08em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950"
                  >
                    ADD
                  </button>
                </div>
                {externals.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {externals.map((x, i) => (
                      <span
                        key={`${x.email || x.name}-${i}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white py-1 pl-2.5 pr-1.5 text-[11px] text-ink-600"
                      >
                        <span className="font-semibold text-ink-900">{x.name}</span>
                        {x.email && <span className="font-code text-[10px] tracking-[0.02em] text-ink-500">{x.email}</span>}
                        <button
                          type="button"
                          onClick={() => setExternals((list) => list.filter((_, idx) => idx !== i))}
                          aria-label={`Remove ${x.name} from the guest list`}
                          className="focus-brand grid h-11 w-11 place-items-center rounded-full text-ink-400 transition-colors hover:bg-brand-50 hover:text-brand-700"
                        >
                          <X className="h-2.5 w-2.5" aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </fieldset>
            </div>
          </div>

          {shownError && (
            <p
              role="alert"
              className="rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-brand-800"
            >
              {shownError}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="max-w-[38ch] text-[10px] leading-relaxed text-ink-500">
              A room is created when you schedule. The diary and calendar use the same meeting record.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!busy) onClose();
                }}
                className="focus-brand inline-flex h-11 min-h-11 items-center rounded-xl border border-ink-200 px-4 font-code text-[10px] font-bold tracking-[0.08em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950"
              >
                CANCEL
              </button>
              <button
                type="submit"
                disabled={busy}
                className="focus-brand inline-flex h-11 min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-5 text-[13px] font-semibold text-white shadow-[0_10px_26px_rgba(217,38,22,0.24)] transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                {busy ? "Minting the room…" : "Schedule the meeting"}
              </button>
            </div>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

/* ── the diary, on the committee page ──────────────────────────────────── */

export function ScheduledMeetingsPanel({
  meetings,
  onSchedule,
  onCancel,
  cancelBusy,
  onToast,
}: {
  meetings: ScheduledMeeting[];
  onSchedule: () => void;
  onCancel: (id: string) => void;
  cancelBusy: string | null;
  onToast: (m: string) => void;
}) {
  const [armId, setArmId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const upcoming = useMemo(
    () =>
      meetings
        .filter((m) => m.status === "SCHEDULED" && new Date(m.startsAt).getTime() >= Date.now() - 5 * 60_000)
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [meetings]
  );

  const copyLink = async (m: ScheduledMeeting) => {
    try {
      await navigator.clipboard.writeText(m.joinUrl);
      setCopiedId(m.id);
      setTimeout(() => setCopiedId((cur) => (cur === m.id ? null : cur)), 2400);
      onToast("ROOM LINK COPIED — SHARE IT WITH THE NAMED PLAYERS");
    } catch {
      onToast("COPY REFUSED BY THE BROWSER — SELECT THE ADDRESS BY HAND");
    }
  };

  const requestCancel = (id: string) => {
    if (armId !== id) {
      setArmId(id);
      setTimeout(() => setArmId((cur) => (cur === id ? null : cur)), 6000);
      return;
    }
    setArmId(null);
    onCancel(id);
  };

  return (
    <section
      aria-label="Scheduled meetings"
      className="mb-4 overflow-hidden rounded-[12px] panel sm:mb-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200/70 px-5 py-3.5 dark:border-white/10">
        <div className="min-w-0">
          <p className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-950">SCHEDULED MEETINGS</p>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-500">
            {upcoming.length === 0
              ? "Nothing on the diary — the owner can call a meeting with any player."
              : `${upcoming.length} on the diary — the room link is minted once and stays.`}
          </p>
        </div>
        <button
          type="button"
          onClick={onSchedule}
          className="focus-brand inline-flex h-11 min-h-11 shrink-0 items-center gap-2 rounded-xl bg-ink-950 px-3.5 font-code text-[10px] font-bold tracking-[0.08em] text-white transition-colors hover:bg-brand-600"
        >
          <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
          SCHEDULE MEETING
        </button>
      </header>

      {upcoming.length === 0 ? (
        <div className="px-5 py-4">
          <p className="flex items-center gap-2.5 text-[12.5px] leading-relaxed text-ink-500">
            <Users className="h-4 w-4 shrink-0 text-ink-300" aria-hidden="true" />
            A meeting can include the committee register, workspace players, and named outside players — the owner
            sets the day and the room is minted on the spot.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-ink-100 dark:divide-white/5">
          {upcoming.slice(0, 3).map((m) => {
            const when = whenOf(m.startsAt);
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-5 py-3">
                <div className="w-[78px] shrink-0">
                  <p className="font-code text-[10px] font-bold tracking-[0.06em] text-ink-500">{when.day}</p>
                  <p className="mt-0.5 font-display text-[17px] font-black leading-none tracking-[-0.02em] text-ink-950 tabular">
                    {when.time}
                  </p>
                  <p className="mt-1 text-[10px] text-ink-500">
                    {m.durationMinutes} min
                  </p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-semibold text-ink-950">{m.title}</p>
                  <p className="mt-0.5 truncate text-[11.5px] text-ink-500" title={guestLine(m.attendees)}>
                    {guestLine(m.attendees)}
                  </p>
                  <p className="mt-0.5 truncate text-[10.5px] text-ink-500">
                    Scheduled by {m.scheduledBy} · Room link ready
                    {m.seriesCount && m.seriesCount > 1
                      ? ` · WEEKLY ${m.seriesIndex ?? 1}/${m.seriesCount}`
                      : ""}
                  </p>
                </div>
                <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
                  <a
                    href={m.joinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="focus-brand inline-flex h-11 min-h-11 items-center gap-1.5 rounded-lg bg-brand-600 px-3 font-code text-[10px] font-bold tracking-[0.06em] text-white transition-colors hover:bg-brand-700"
                  >
                    OPEN ROOM
                    <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                  </a>
                  <button
                    type="button"
                    onClick={() => void copyLink(m)}
                    aria-label={`Copy the room link for ${m.title}`}
                    className="focus-brand grid h-11 w-11 place-items-center rounded-lg border border-ink-200 bg-white text-ink-500 transition-colors hover:border-ink-950 hover:text-ink-950"
                  >
                    {copiedId === m.id ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => requestCancel(m.id)}
                    disabled={cancelBusy === m.id}
                    className={cn(
                      "focus-brand inline-flex min-h-11 items-center rounded-lg px-2 font-code text-[10px] font-bold tracking-[0.04em] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      armId === m.id ? "text-brand-600" : "text-ink-400 hover:text-brand-600"
                    )}
                  >
                    {cancelBusy === m.id ? "Cancelling…" : armId === m.id ? "Tap again to cancel" : "Cancel"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {upcoming.length > 3 && (
        <footer className="border-t border-ink-100 px-5 py-2.5 dark:border-white/5">
          <p className="text-[11px] text-ink-500">
            {upcoming.length - 3} more {upcoming.length - 3 === 1 ? "meeting" : "meetings"} on the calendar
          </p>
        </footer>
      )}
    </section>
  );
}
