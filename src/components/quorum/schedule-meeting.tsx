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

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, CalendarPlus, Check, Copy, Users, X } from "lucide-react";
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
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [playerIds, setPlayerIds] = useState<string[]>([]);
  const [externals, setExternals] = useState<{ name: string; email: string }[]>([]);
  const [extName, setExtName] = useState("");
  const [extEmail, setExtEmail] = useState("");
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [players, setPlayers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [playersLoaded, setPlayersLoaded] = useState(false);
  const [playersFailed, setPlayersFailed] = useState(false);

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
      if (e.key === "Escape" && !busy) onClose();
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
      role="dialog"
      aria-modal="true"
      aria-label="Schedule a committee meeting"
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12 }}
        transition={{ duration: 0.28, ease: EASE }}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[min(92dvh,900px)] w-full max-w-2xl overflow-y-auto rounded-[12px] panel panel-lift p-5 sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2.5 font-code text-[8px] font-semibold tracking-[0.24em] text-ink-400">
              <span className="inline-block h-[2px] w-5 bg-brand-600" aria-hidden="true" />
              THE COMMITTEE DIARY
            </p>
            <h3 className="mt-1.5 font-display text-[22px] font-black tracking-[-0.02em] text-ink-950">
              Schedule a meeting<span className="text-brand-600">.</span>
            </h3>
            <p className="mt-1.5 max-w-lg text-[12.5px] leading-relaxed text-ink-500">
              Set the day, name the players. A fresh unlisted Jitsi room is minted now, so every invitation carries a
              real address — no accounts, nothing installed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!busy) onClose();
            }}
            aria-label="Close without scheduling"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-paper hover:text-ink-900"
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
            <span className="font-code text-[7.5px] font-bold tracking-[0.18em] text-ink-400">MEETING TITLE</span>
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setLocalErr(null);
              }}
              placeholder="e.g. Award decision — KE-MOH-2026-041"
              maxLength={140}
              aria-required="true"
              className="mt-1.5 h-10 w-full rounded-xl border border-ink-200 bg-white px-3.5 text-[13px] text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-ink-950"
            />
          </label>

          <label className="block">
            <span className="font-code text-[7.5px] font-bold tracking-[0.18em] text-ink-400">
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

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="font-code text-[7.5px] font-bold tracking-[0.18em] text-ink-400">DATE</span>
              <input
                type="date"
                value={date}
                min={localDateKey(new Date())}
                onChange={(e) => {
                  setDate(e.target.value);
                  setLocalErr(null);
                }}
                aria-required="true"
                className="mt-1.5 h-10 w-full rounded-xl border border-ink-200 bg-white px-3 text-[12.5px] text-ink-950 outline-none transition focus:border-ink-950"
              />
            </label>
            <label className="block">
              <span className="font-code text-[7.5px] font-bold tracking-[0.18em] text-ink-400">STARTS</span>
              <input
                type="time"
                value={time}
                onChange={(e) => {
                  setTime(e.target.value);
                  setLocalErr(null);
                }}
                aria-required="true"
                className="mt-1.5 h-10 w-full rounded-xl border border-ink-200 bg-white px-3 text-[12.5px] text-ink-950 outline-none transition focus:border-ink-950"
              />
            </label>
            <label className="col-span-2 block sm:col-span-1">
              <span className="font-code text-[7.5px] font-bold tracking-[0.18em] text-ink-400">MINUTES</span>
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
                className="mt-1.5 h-10 w-full rounded-xl border border-ink-200 bg-white px-3 text-[12.5px] tabular text-ink-950 outline-none transition focus:border-ink-950"
              />
            </label>
          </div>

          <div className="rounded-xl border border-ink-100 bg-paper/50 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 font-code text-[8px] font-bold tracking-[0.2em] text-ink-500">
                <Users className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" />
                OTHER PLAYERS
              </p>
              <p className="font-code text-[7.5px] tracking-[0.16em] text-ink-400">
                {invited} INVITED · YOU ARE ADDED AUTOMATICALLY
              </p>
            </div>

            <div className="mt-3 space-y-4">
              <fieldset>
                <legend className="w-full font-code text-[7.5px] font-bold tracking-[0.18em] text-ink-400">
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
                            "flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-colors",
                            on ? "border-ink-950 bg-ink-950/[0.05]" : "border-ink-200 bg-white hover:border-ink-400"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => setMemberIds((x) => toggle(x, m.id))}
                            className="h-3.5 w-3.5 shrink-0 accent-brand-600"
                          />
                          <span
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink-950 font-code text-[8px] font-bold text-white"
                            aria-hidden="true"
                          >
                            {initialsOf(m.name)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] font-semibold text-ink-950">{m.name}</span>
                            <span className="block truncate font-code text-[6.5px] tracking-[0.12em] text-ink-400">
                              {m.role}
                            </span>
                          </span>
                          {m.status === "EXCUSED" && (
                            <span className="ml-auto shrink-0 font-code text-[6.5px] tracking-[0.12em] text-ink-400">
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
                <legend className="w-full font-code text-[7.5px] font-bold tracking-[0.18em] text-ink-400">
                  WORKSPACE PLAYERS
                </legend>
                {!playersLoaded ? (
                  <p className="mt-1.5 font-code text-[7.5px] tracking-[0.16em] text-ink-400">READING THE TEAM ROSTER…</p>
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
                            "flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-colors",
                            on ? "border-ink-950 bg-ink-950/[0.05]" : "border-ink-200 bg-white hover:border-ink-400"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => setPlayerIds((x) => toggle(x, p.id))}
                            className="h-3.5 w-3.5 shrink-0 accent-brand-600"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] font-semibold text-ink-950">{p.name}</span>
                            <span className="block truncate font-code text-[6.5px] tracking-[0.12em] text-ink-400">
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
                <legend className="w-full font-code text-[7.5px] font-bold tracking-[0.18em] text-ink-400">
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
                    className="h-9 min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-3 text-[12.5px] text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-ink-950"
                  />
                  <input
                    value={extEmail}
                    onChange={(e) => {
                      setExtEmail(e.target.value);
                      setLocalErr(null);
                    }}
                    placeholder="Email — optional"
                    aria-label="Outside player's email, optional"
                    className="h-9 min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-3 text-[12.5px] text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-ink-950"
                  />
                  <button
                    type="button"
                    onClick={addExternal}
                    className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-ink-200 bg-white px-3.5 font-code text-[8px] font-bold tracking-[0.16em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950"
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
                        {x.email && <span className="font-code text-[7px] tracking-[0.08em] text-ink-400">{x.email}</span>}
                        <button
                          type="button"
                          onClick={() => setExternals((list) => list.filter((_, idx) => idx !== i))}
                          aria-label={`Remove ${x.name} from the guest list`}
                          className="grid h-4 w-4 place-items-center rounded-full text-ink-400 transition-colors hover:bg-brand-50 hover:text-brand-700"
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
            <p className="max-w-[38ch] font-code text-[7px] leading-[1.9] tracking-[0.14em] text-ink-400">
              THE ROOM IS MINTED NOW · THE DIARY AND THE CALENDAR READ THE SAME RECORD
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!busy) onClose();
                }}
                className="inline-flex h-10 items-center rounded-xl border border-ink-200 px-4 font-code text-[8.5px] font-bold tracking-[0.14em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950"
              >
                CANCEL
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-600 px-5 text-[12.5px] font-semibold text-white shadow-[0_10px_26px_rgba(217,38,22,0.24)] transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
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
          <p className="font-code text-[9px] font-bold tracking-[0.22em] text-ink-950">SCHEDULED MEETINGS</p>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-500">
            {upcoming.length === 0
              ? "Nothing on the diary — the owner can call a meeting with any player."
              : `${upcoming.length} on the diary — the room link is minted once and stays.`}
          </p>
        </div>
        <button
          type="button"
          onClick={onSchedule}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-ink-950 px-3.5 font-code text-[8px] font-bold tracking-[0.16em] text-white transition-colors hover:bg-brand-600"
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
                  <p className="font-code text-[7.5px] font-bold tracking-[0.16em] text-ink-400">{when.day}</p>
                  <p className="mt-0.5 font-display text-[17px] font-black leading-none tracking-[-0.02em] text-ink-950 tabular">
                    {when.time}
                  </p>
                  <p className="mt-1 font-code text-[6.5px] tracking-[0.14em] text-ink-400">
                    {m.durationMinutes} MIN
                  </p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-semibold text-ink-950">{m.title}</p>
                  <p className="mt-0.5 truncate text-[11.5px] text-ink-500" title={guestLine(m.attendees)}>
                    {guestLine(m.attendees)}
                  </p>
                  <p className="mt-0.5 truncate font-code text-[6.5px] tracking-[0.14em] text-ink-400">
                    SCHEDULED BY {m.scheduledBy.toUpperCase()} · JITSI ROOM
                  </p>
                </div>
                <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
                  <a
                    href={m.joinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-3 font-code text-[7.5px] font-bold tracking-[0.14em] text-white transition-colors hover:bg-brand-700"
                  >
                    OPEN ROOM
                    <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                  </a>
                  <button
                    type="button"
                    onClick={() => void copyLink(m)}
                    aria-label={`Copy the room link for ${m.title}`}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-ink-200 bg-white text-ink-500 transition-colors hover:border-ink-950 hover:text-ink-950"
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
                      "whitespace-nowrap font-code text-[6.5px] font-bold tracking-[0.14em] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      armId === m.id ? "text-brand-600" : "text-ink-400 hover:text-brand-600"
                    )}
                  >
                    {cancelBusy === m.id ? "CANCELLING…" : armId === m.id ? "TAP AGAIN — CANCEL" : "CANCEL"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {upcoming.length > 3 && (
        <footer className="border-t border-ink-100 px-5 py-2.5 dark:border-white/5">
          <p className="font-code text-[7px] tracking-[0.16em] text-ink-400">
            +{upcoming.length - 3} MORE ON THE DIARY · ALL OF THEM ON THE CALENDAR
          </p>
        </footer>
      )}
    </section>
  );
}
