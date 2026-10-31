"use client";

/**
 * MeetingNotes — the Meta agent's clerk for the committee diary.
 *
 * Every meeting the owner puts on the calendar appears here. The officer (or
 * the agent, through the same API) can capture the discussion — live in the
 * browser where SpeechRecognition exists, or by pasting a transcript — and
 * the Meta model drafts structured minutes against the meeting record. Both
 * the transcript and the minutes are filed and listed, so the notes are a
 * record, not a scratchpad.
 *
 * The capture never uploads audio: browser recognition transcribes locally.
 * When no Meta key is configured the server files a deterministic draft and
 * says so — the meeting still gets its minutes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Copy,
  Download,
  FileText,
  Loader2,
  Mic,
  RefreshCw,
  Sparkles,
  Square,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { minutesMarkdown, type MeetingMinutes, type MeetingNotePayload } from "@/lib/meeting-minutes";

const EASE = [0.22, 1, 0.36, 1] as const;

export type NotesMeeting = {
  id: string;
  title: string;
  agenda: string | null;
  startsAt: string;
  scheduledBy: string;
  status: "SCHEDULED" | "CANCELLED";
  attendees?: { name: string }[];
};

/* ── browser hearing (same contract the Muse assistant uses) ─────────────── */

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang?: string;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string } }>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/* ── small formatting helpers ────────────────────────────────────────────── */

function whenOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function filedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
}

function MinutesBody({ minutes }: { minutes: MeetingMinutes }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="font-code text-[7.5px] font-bold tracking-[0.2em] text-ink-400">SUMMARY</p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-800 dark:text-ink-200">
          {minutes.summary || "No summary was produced."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="font-code text-[7.5px] font-bold tracking-[0.2em] text-ink-400">DECISIONS</p>
          {minutes.decisions.length ? (
            <ul className="mt-1.5 space-y-1.5">
              {minutes.decisions.map((decision, i) => (
                <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-ink-700 dark:text-ink-300">
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  {decision}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-[12px] text-ink-400">No explicit decision was recorded.</p>
          )}
        </div>

        <div>
          <p className="font-code text-[7.5px] font-bold tracking-[0.2em] text-ink-400">ATTENDEES</p>
          {minutes.attendees.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {minutes.attendees.map((attendee, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-full border border-ink-200/80 bg-white px-2 py-0.5 font-code text-[8px] font-semibold tracking-[0.06em] text-ink-600 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-ink-300"
                >
                  <Users className="h-2.5 w-2.5" aria-hidden="true" />
                  {attendee}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1.5 text-[12px] text-ink-400">No attendee was named in the transcript.</p>
          )}
        </div>
      </div>

      <div>
        <p className="font-code text-[7.5px] font-bold tracking-[0.2em] text-ink-400">ACTIONS</p>
        {minutes.actions.length ? (
          <ul className="mt-1.5 divide-y divide-ink-100 dark:divide-white/[0.05]">
            {minutes.actions.map((action, i) => (
              <li key={i} className="flex items-start gap-2.5 py-2">
                <span
                  className="mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded border border-ink-300 dark:border-white/25"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-ink-700 dark:text-ink-300">
                  {action.action}
                  <span className="mt-0.5 block font-code text-[7.5px] tracking-[0.1em] text-ink-400">
                    {action.owner.toUpperCase()}
                    {action.due ? ` · DUE ${action.due.toUpperCase()}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-[12px] text-ink-400">No action was recorded.</p>
        )}
      </div>

      {minutes.quotes.length ? (
        <div>
          <p className="font-code text-[7.5px] font-bold tracking-[0.2em] text-ink-400">VERBATIM</p>
          <div className="mt-1.5 space-y-1.5">
            {minutes.quotes.map((quote, i) => (
              <blockquote
                key={i}
                className="border-l-2 border-brand-300 pl-2.5 text-[12px] italic leading-relaxed text-ink-600 dark:border-brand-500/40 dark:text-ink-300"
              >
                “{quote}”
              </blockquote>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ── the section ─────────────────────────────────────────────────────────── */

export function MeetingNotes({
  meetings,
  onToast,
}: {
  meetings: NotesMeeting[];
  onToast: (m: string) => void;
}) {
  const [notes, setNotes] = useState<MeetingNotePayload[]>([]);
  const [notesFailed, setNotesFailed] = useState(false);
  const [capture, setCapture] = useState<NotesMeeting | null>(null);
  const [viewing, setViewing] = useState<MeetingNotePayload | null>(null);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [canListen, setCanListen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const listeningRef = useRef(false);

  const diary = useMemo(
    () =>
      [...meetings]
        .filter((meeting) => meeting.status === "SCHEDULED")
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [meetings],
  );

  const loadNotes = useCallback(async () => {
    try {
      const res = await fetch("/api/meetings/notes", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { notes?: MeetingNotePayload[] };
      if (!res.ok) throw new Error("unreachable");
      setNotes(data.notes ?? []);
      setNotesFailed(false);
    } catch {
      setNotesFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    setCanListen(!!recognitionCtor());
  }, []);

  /* Stop the microphone when the dialog is closed or the section unmounts. */
  const stopHearing = () => {
    listeningRef.current = false;
    try {
      recogRef.current?.stop();
    } catch {
      /* already closed */
    }
    setListening(false);
    setInterim("");
  };

  useEffect(
    () => () => {
      listeningRef.current = false;
      try {
        recogRef.current?.stop();
      } catch {
        /* no microphone open */
      }
    },
    [],
  );

  useEffect(() => {
    if (!capture && !viewing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      listeningRef.current = false;
      try {
        recogRef.current?.stop();
      } catch {
        /* already closed */
      }
      setListening(false);
      setInterim("");
      setCapture(null);
      setViewing(null);
    };
    const prior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prior;
      window.removeEventListener("keydown", onKey);
    };
  }, [capture, viewing]);

  const openCapture = (meeting: NotesMeeting) => {
    stopHearing();
    setTranscript("");
    setError(null);
    setVoiceNote(null);
    setCapture(meeting);
  };

  const closeCapture = () => {
    stopHearing();
    setCapture(null);
  };

  const startHearing = () => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setVoiceNote("This browser has no live transcription — paste the transcript instead.");
      return;
    }
    const recog = new Ctor();
    recog.continuous = true;
    recog.interimResults = true;
    recog.lang = "en-GB";
    recog.onresult = (event) => {
      let pending = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          const stamp = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
          setTranscript((prev) => `${prev}${prev.trim() ? "\n" : ""}[${stamp}] ${text.trim()}`);
        } else {
          pending += text;
        }
      }
      setInterim(pending);
    };
    recog.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setVoiceNote("The microphone is blocked — allow it, or paste the transcript.");
        listeningRef.current = false;
        setListening(false);
      } else if (event.error === "network") {
        setVoiceNote("Live transcription needs a network — paste the transcript instead.");
        listeningRef.current = false;
        setListening(false);
      }
    };
    recog.onend = () => {
      if (listeningRef.current) {
        try {
          recog.start();
          return;
        } catch {
          /* fall through to stopped */
        }
      }
      setListening(false);
      setInterim("");
    };
    try {
      recog.start();
      recogRef.current = recog;
      listeningRef.current = true;
      setListening(true);
      setVoiceNote(null);
    } catch {
      setVoiceNote("The microphone did not open — allow it, or paste the transcript.");
    }
  };

  const draft = async () => {
    if (!capture || busy) return;
    stopHearing();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/meetings/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ meetingId: capture.id, transcript }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        note?: MeetingNotePayload;
        fallbackReason?: string;
        error?: string;
      };
      if (!res.ok || !data.note) throw new Error(data.error ?? `The agent could not file the minutes (HTTP ${res.status}).`);
      setNotes((prev) => [data.note as MeetingNotePayload, ...prev]);
      setCapture(null);
      setViewing(data.note);
      onToast(
        data.note.provider === "meta"
          ? `MINUTES FILED — ${String(data.note.model).toUpperCase()}`
          : "MINUTES FILED — LOCAL DRAFT (META AI NOT CONFIGURED)",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "The agent could not draft the minutes.");
    } finally {
      setBusy(false);
    }
  };

  const copyNote = async (note: MeetingNotePayload) => {
    try {
      await navigator.clipboard.writeText(minutesMarkdown(note));
      setCopied(true);
      onToast("MINUTES COPIED AS MARKDOWN");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onToast("THE BROWSER BLOCKED THE CLIPBOARD — DOWNLOAD THE MARKDOWN INSTEAD");
    }
  };

  const downloadNote = (note: MeetingNotePayload) => {
    const blob = new Blob([minutesMarkdown(note)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `minutes-${note.meetingId}-${note.createdAt.slice(0, 10)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section aria-labelledby="meeting-notes-h" className="mt-4 sm:mt-6">
      <div className="relative overflow-hidden rounded-[12px] panel">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-200/70 px-5 py-4 dark:border-white/10">
          <div className="min-w-0">
            <p className="flex items-center gap-2 eyebrow">
              <Sparkles className="h-3 w-3 text-brand-600 dark:text-brand-400" aria-hidden="true" />
              Meta agent / Meeting notes
            </p>
            <h2
              id="meeting-notes-h"
              className="mt-1.5 font-display text-[20px] font-black tracking-[-0.02em] text-ink-950 dark:text-white"
            >
              Minutes, taken live<span className="text-brand-600 dark:text-brand-400">.</span>
            </h2>
            <p className="mt-1 max-w-[78ch] text-[12.5px] leading-relaxed text-ink-500 dark:text-ink-400">
              The agent sits in on a meeting, transcribes the discussion and files the minutes against the meeting
              record. The transcript stays with the note; nothing is invented beyond what was said.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ink-200/80 px-3 font-code text-[8px] font-bold tracking-[0.14em] text-ink-500 dark:border-white/10 dark:text-ink-300">
              <FileText className="h-3 w-3" aria-hidden="true" />
              {notes.length} {notes.length === 1 ? "NOTE" : "NOTES"} FILED
            </span>
            <button
              type="button"
              onClick={() => void loadNotes()}
              aria-label="Refresh meeting notes"
              className="grid h-8 w-8 place-items-center rounded-lg border border-ink-200/80 text-ink-500 transition-colors hover:border-ink-950 hover:text-ink-950 dark:border-white/10 dark:text-ink-400 dark:hover:border-white/30 dark:hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2">
          {/* Meetings the agent can attend */}
          <div className="border-b border-ink-100/80 lg:border-b-0 lg:border-r dark:border-white/[0.06]">
            <div className="flex items-center justify-between gap-3 px-5 pb-1 pt-3.5">
              <p className="font-code text-[8px] font-bold tracking-[0.2em] text-ink-400">MEETINGS ON THE DIARY</p>
              <span className="font-code text-[8px] font-bold tracking-[0.12em] text-ink-400 tabular">{diary.length}</span>
            </div>
            <ul className="max-h-[340px] divide-y divide-ink-100/70 overflow-y-auto px-2 py-1.5 dark:divide-white/[0.05]">
              {diary.map((meeting) => {
                const filed = notes.filter((note) => note.meetingId === meeting.id).length;
                const invited = meeting.attendees?.length ?? 0;
                return (
                  <li key={meeting.id}>
                    <div className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-paper dark:hover:bg-white/[0.03]">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/12 dark:text-brand-300">
                        <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-code text-[8px] tracking-[0.12em] text-ink-400">{whenOf(meeting.startsAt)}</p>
                        <p className="mt-0.5 truncate text-[12.5px] font-semibold text-ink-900 dark:text-ink-100">
                          {meeting.title}
                        </p>
                        <p className="mt-0.5 font-code text-[7.5px] tracking-[0.1em] text-ink-400">
                          {invited} INVITED · CALLED BY {meeting.scheduledBy.toUpperCase()}
                          {filed > 0 ? ` · ${filed} ${filed === 1 ? "NOTE" : "NOTES"} FILED` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openCapture(meeting)}
                        className="focus-brand inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-ink-200 bg-white px-2.5 font-code text-[8px] font-bold tracking-[0.1em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-ink-200 dark:hover:border-white/30 dark:hover:text-white"
                      >
                        TAKE NOTES
                        <ArrowRight className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
              {diary.length === 0 && (
                <li className="px-4 py-8 text-center">
                  <p className="font-code text-[9px] font-bold tracking-[0.2em] text-ink-400">NO MEETING ON THE DIARY</p>
                  <p className="mx-auto mt-2 max-w-[260px] text-[12px] leading-relaxed text-ink-500">
                    Schedule a meeting from the committee register and the agent will be ready to take its notes.
                  </p>
                </li>
              )}
            </ul>
          </div>

          {/* Filed notes */}
          <div>
            <div className="flex items-center justify-between gap-3 px-5 pb-1 pt-3.5">
              <p className="font-code text-[8px] font-bold tracking-[0.2em] text-ink-400">NOTES ON THE RECORD</p>
              <span className="font-code text-[8px] font-bold tracking-[0.12em] text-ink-400 tabular">{notes.length}</span>
            </div>
            <ul className="max-h-[340px] divide-y divide-ink-100/70 overflow-y-auto px-2 py-1.5 dark:divide-white/[0.05]">
              {notes.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => setViewing(note)}
                    className="focus-brand w-full rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-paper dark:hover:bg-white/[0.03]"
                  >
                    <span className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink-900 dark:text-ink-100">
                        {note.meetingTitle}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 font-code text-[6.5px] font-bold tracking-[0.12em]",
                          note.provider === "meta"
                            ? "bg-brand-50 text-brand-700 dark:bg-brand-500/12 dark:text-brand-300"
                            : "bg-ink-100 text-ink-500 dark:bg-white/[0.06] dark:text-ink-300",
                        )}
                      >
                        {note.provider === "meta" ? "META AGENT" : "LOCAL DRAFT"}
                      </span>
                    </span>
                    <span className="mt-1 block font-code text-[7.5px] tracking-[0.1em] text-ink-400">
                      {filedAt(note.createdAt)} · {note.createdBy.toUpperCase()} · {note.minutes.decisions.length} DECISIONS ·{" "}
                      {note.minutes.actions.length} ACTIONS
                    </span>
                  </button>
                </li>
              ))}
              {notes.length === 0 && (
                <li className="px-4 py-8 text-center">
                  <p className="font-code text-[9px] font-bold tracking-[0.2em] text-ink-400">NO MINUTES FILED YET</p>
                  <p className="mx-auto mt-2 max-w-[260px] text-[12px] leading-relaxed text-ink-500">
                    {notesFailed
                      ? "The notes service could not be read. Refresh to try again — nothing is lost."
                      : "Take notes at a meeting and the filed minutes — decisions, actions and transcript — appear here."}
                  </p>
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>

      {/* Capture */}
      <AnimatePresence>
        {capture ? (
          <motion.div
            key="meeting-note-capture"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[95] grid place-items-center bg-night/70 p-3 backdrop-blur-sm sm:p-5"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !busy) closeCapture();
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="meeting-note-capture-title"
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.99 }}
              transition={{ duration: 0.28, ease: EASE }}
              className="panel panel-lift flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-[12px]"
            >
              <header className="flex shrink-0 items-start justify-between gap-4 border-b border-ink-100 px-5 py-4 dark:border-white/[0.06] sm:px-7">
                <div className="min-w-0">
                  <p className="font-code text-[8.5px] font-bold tracking-[0.2em] text-brand-700 dark:text-brand-300">
                    MEETING NOTES · {whenOf(capture.startsAt).toUpperCase()}
                  </p>
                  <h3
                    id="meeting-note-capture-title"
                    className="mt-1 font-display text-[19px] font-black tracking-[-0.02em] text-ink-950 dark:text-white"
                  >
                    {capture.title}
                  </h3>
                  <p className="mt-1 text-[11.5px] text-ink-500 dark:text-ink-400">
                    {capture.attendees?.length ?? 0} invited · called by {capture.scheduledBy}
                    {capture.agenda ? ` · ${capture.agenda}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeCapture}
                  disabled={busy}
                  aria-label="Close meeting notes capture"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900 disabled:opacity-50 dark:hover:bg-white/[0.06] dark:hover:text-white"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-7">
                <div className="flex flex-wrap items-center gap-2">
                  {listening ? (
                    <button
                      type="button"
                      onClick={stopHearing}
                      className="inline-flex h-9 items-center gap-2 rounded-full bg-brand-600 px-4 font-code text-[8.5px] font-bold tracking-[0.14em] text-white transition-colors hover:bg-brand-700"
                    >
                      <Square className="h-3 w-3" aria-hidden="true" />
                      STOP LISTENING
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={startHearing}
                      disabled={busy}
                      className="inline-flex h-9 items-center gap-2 rounded-full bg-ink-950 px-4 font-code text-[8.5px] font-bold tracking-[0.14em] text-white transition-colors hover:bg-brand-600 disabled:opacity-50 dark:bg-white dark:text-ink-950 dark:hover:bg-brand-400"
                    >
                      <Mic className="h-3 w-3" aria-hidden="true" />
                      START LISTENING
                    </button>
                  )}
                  {listening && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 font-code text-[7.5px] font-bold tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                      <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      </span>
                      LIVE
                    </span>
                  )}
                  <span className="font-code text-[7.5px] tracking-[0.1em] text-ink-400">
                    {canListen ? "BROWSER TRANSCRIPTION · AUDIO NEVER UPLOADED" : "PASTE THE TRANSCRIPT BELOW"}
                  </span>
                </div>

                {interim ? (
                  <p className="mt-2 rounded-lg bg-paper-2/70 px-3 py-2 text-[11.5px] italic text-ink-500 dark:bg-white/[0.03] dark:text-ink-400">
                    … {interim}
                  </p>
                ) : null}

                <label className="mt-3 block">
                  <span className="sr-only">Meeting transcript</span>
                  <textarea
                    value={transcript}
                    onChange={(event) => setTranscript(event.target.value)}
                    rows={10}
                    autoFocus
                    placeholder="Speak, or paste the transcript of the meeting here…"
                    className="focus-brand w-full resize-y rounded-[10px] border border-ink-200/80 bg-[#fffdfb] px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-900 shadow-[inset_0_1px_1px_rgba(11,12,15,0.03)] outline-none transition-[border-color] duration-200 placeholder:text-ink-400 focus:border-ink-950 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-white dark:focus:border-white/35"
                  />
                </label>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 font-code text-[7.5px] tracking-[0.12em] text-ink-400">
                  <span>{transcript.trim() ? `${transcript.trim().split(/\s+/).length} WORDS CAPTURED` : "NOTHING CAPTURED YET"}</span>
                  <span>THE TRANSCRIPT IS KEPT WITH THE NOTE</span>
                </div>

                {voiceNote ? (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                    {voiceNote}
                  </p>
                ) : null}
                {error ? (
                  <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-[11.5px] text-brand-800 dark:bg-brand-500/10 dark:text-brand-300">
                    {error}
                  </p>
                ) : null}
              </div>

              <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-5 py-3.5 dark:border-white/[0.06] sm:px-7">
                <p className="max-w-[52ch] text-[10.5px] leading-relaxed text-ink-400">
                  {transcript.trim().length < 20
                    ? "At least a sentence is needed before the agent can draft the minutes."
                    : "The agent reads only this transcript — it does not add facts."}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={closeCapture}
                    disabled={busy}
                    className="inline-flex h-9 items-center rounded-lg border border-ink-200/80 px-3.5 font-code text-[8px] font-bold tracking-[0.16em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950 disabled:opacity-50 dark:border-white/[0.12] dark:text-ink-300 dark:hover:border-white/30 dark:hover:text-white"
                  >
                    CANCEL
                  </button>
                  <button
                    type="button"
                    onClick={() => void draft()}
                    disabled={busy || transcript.trim().length < 20}
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-600 px-4 font-code text-[8.5px] font-bold tracking-[0.14em] text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {busy ? "THE AGENT IS READING…" : "DRAFT MINUTES"}
                  </button>
                </div>
              </footer>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Viewer */}
      <AnimatePresence>
        {viewing ? (
          <motion.div
            key="meeting-note-viewer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[95] grid place-items-center bg-night/70 p-3 backdrop-blur-sm sm:p-5"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setViewing(null);
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="meeting-note-view-title"
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.99 }}
              transition={{ duration: 0.28, ease: EASE }}
              className="panel panel-lift flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-[12px]"
            >
              <header className="flex shrink-0 items-start justify-between gap-4 border-b border-ink-100 px-5 py-4 dark:border-white/[0.06] sm:px-7">
                <div className="min-w-0">
                  <p className="font-code text-[8.5px] font-bold tracking-[0.2em] text-brand-700 dark:text-brand-300">
                    FILED MINUTES · {filedAt(viewing.createdAt)}
                  </p>
                  <h3
                    id="meeting-note-view-title"
                    className="mt-1 font-display text-[19px] font-black tracking-[-0.02em] text-ink-950 dark:text-white"
                  >
                    {viewing.meetingTitle}
                  </h3>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-500 dark:text-ink-400">
                    {whenOf(viewing.meetingStartsAt)} · recorded by {viewing.createdBy}
                    <span className="rounded-full bg-ink-100 px-2 py-0.5 font-code text-[6.5px] font-bold tracking-[0.12em] text-ink-500 dark:bg-white/[0.06] dark:text-ink-300">
                      {viewing.provider === "meta" ? `META · ${viewing.model.toUpperCase()}` : "DETERMINISTIC DRAFT"}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setViewing(null)}
                  aria-label="Close the filed minutes"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900 dark:hover:bg-white/[0.06] dark:hover:text-white"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-7">
                <MinutesBody minutes={viewing.minutes} />
                <details className="mt-4 rounded-[10px] border border-ink-100/80 dark:border-white/[0.07]">
                  <summary className="cursor-pointer px-3 py-2 font-code text-[7.5px] font-bold tracking-[0.16em] text-ink-500 dark:text-ink-400">
                    FULL TRANSCRIPT · {viewing.transcript.length.toLocaleString("en-US")} CHARS
                  </summary>
                  <pre className="max-h-[280px] overflow-y-auto whitespace-pre-wrap border-t border-ink-100/80 px-3 py-2.5 font-code text-[10px] leading-relaxed text-ink-600 dark:border-white/[0.06] dark:text-ink-400">
                    {viewing.transcript}
                  </pre>
                </details>
              </div>

              <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-5 py-3.5 dark:border-white/[0.06] sm:px-7">
                <button
                  type="button"
                  onClick={() => downloadNote(viewing)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-200/80 px-3.5 font-code text-[8px] font-bold tracking-[0.14em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950 dark:border-white/[0.12] dark:text-ink-300 dark:hover:border-white/30 dark:hover:text-white"
                >
                  <Download className="h-3 w-3" aria-hidden="true" />
                  DOWNLOAD
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void copyNote(viewing)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-200/80 px-3.5 font-code text-[8px] font-bold tracking-[0.14em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950 dark:border-white/[0.12] dark:text-ink-300 dark:hover:border-white/30 dark:hover:text-white"
                  >
                    <Copy className="h-3 w-3" aria-hidden="true" />
                    {copied ? "COPIED" : "COPY"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewing(null)}
                    className="inline-flex h-9 items-center rounded-lg bg-ink-950 px-4 font-code text-[8.5px] font-bold tracking-[0.14em] text-white transition-colors hover:bg-brand-600 dark:bg-white dark:text-ink-950 dark:hover:bg-brand-400"
                  >
                    DONE
                  </button>
                </div>
              </footer>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
