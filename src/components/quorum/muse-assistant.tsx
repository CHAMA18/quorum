"use client";

/**
 * MuseAssistant — the voice chat bubble that sits on every screen.
 *
 * One floating button, bottom right, over the landing page, the workspace
 * and the docs alike. Press it and you get a panel you can either talk into
 * or type into:
 *
 *   · hearing  — the mic captures raw PCM, the browser encodes a WAV, and
 *     Muse Voice Transcribe (Meta Model API) turns it into the sentence.
 *     Nothing is buffered to disk; the clip goes to the model and back as
 *     text.
 *   · thinking — the sentence goes to /api/muse/chat, where Muse Spark runs
 *     an agentic loop over read-only desk tools (runs, approvals, deadlines,
 *     the committee register, one tender's record).
 *   · speaking — the reply is read aloud by the browser's own voice, and
 *     shown in full on screen.
 *
 * The assistant is read-only by construction — the same line the review
 * graph draws. It can tell you what waits at the gate; it cannot sign it.
 * With no MUSE_API_KEY set, the panel says so and typing still works; the
 * product never depends on a secret to boot.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Mic, Send, Sparkles, Square, Volume2, VolumeX, X } from "lucide-react";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;

type Turn = { id: string; role: "user" | "assistant"; text: string; heard?: string; tools?: string[] };

const SUGGESTIONS = [
  "What is waiting at the gate?",
  "Any overdue clocks?",
  "Is quorum present?",
  "How many evaluations are live?",
];

/* ── WAV encoding in the browser ──────────────────────────────────────────
   The mic gives us Float32 PCM from an AudioContext; Muse's file endpoint
   wants WAV. Encoding it here keeps the dependency count at zero and the
   clip on the device until the officer has already let go of the button. */

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const str = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); /* PCM */
  view.setUint16(22, 1, true); /* mono */
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: "audio/wav" });
}

/** Downmix the stream to one channel at 16 kHz — small clips, quick uploads. */
function downMix(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

const TARGET_RATE = 16_000;
const MAX_RECORD_MS = 25_000;

/* ── The spoken reply ─────────────────────────────────────────────────────── */

function useSpeaker(enabled: boolean) {
  const stop = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);
  const speak = useCallback(
    (text: string) => {
      if (!enabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text.replace(/[*#`>|-]/g, " "));
      utterance.rate = 1.02;
      utterance.pitch = 1;
      const voices = window.speechSynthesis.getVoices();
      const pick =
        voices.find((v) => /en[-_](GB|ZA|KE|NG)/i.test(v.lang)) ??
        voices.find((v) => /^en/i.test(v.lang)) ??
        null;
      if (pick) utterance.voice = pick;
      window.speechSynthesis.speak(utterance);
    },
    [enabled]
  );
  return { speak, stop };
}

/* ── The bubble ───────────────────────────────────────────────────────────── */

let turnSeq = 0;
const nextId = () => `t${++turnSeq}`;

export function MuseAssistant({ name }: { name?: string }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [heardLevel, setHeardLevel] = useState(0);
  const [speakOn, setSpeakOn] = useState(true);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { speak, stop } = useSpeaker(speakOn && open);

  /* Chrome ships a new default voice list after the first utterance. */
  useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
    }
  }, []);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy, open]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 220);
  }, [open]);

  /* Esc closes the panel and mutes any reply mid-sentence. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const shut = useCallback(() => {
    stop();
    setOpen(false);
  }, [stop]);

  /* ── Asking ─────────────────────────────────────────────────────────────── */

  const ask = useCallback(
    async (raw: string, heard?: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setDraft("");
      setVoiceNote(null);
      const mine: Turn = { id: nextId(), role: "user", text, ...(heard ? { heard } : {}) };
      const history = turns.slice(-6).map((t) => ({ role: t.role, content: t.text }));
      setTurns((prev) => [...prev, mine]);
      setBusy(true);
      try {
        const res = await fetch("/api/muse/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: text, history, ...(name ? { who: name } : {}) }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          reply?: string;
          toolsRead?: string[];
          note?: string;
        };
        const reply = (data.reply ?? "I could not answer that just now.").trim();
        setTurns((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            text: reply,
            ...(data.toolsRead && data.toolsRead.length ? { tools: data.toolsRead } : {}),
          },
        ]);
        speak(reply);
      } catch {
        const note =
          "The assistant service is not answering right now. Nothing on the desk changed — try again in a moment.";
        setTurns((prev) => [...prev, { id: nextId(), role: "assistant", text: note }]);
      } finally {
        setBusy(false);
      }
    },
    [busy, name, speak, turns]
  );

  /* ── Hearing: capture PCM, encode WAV, transcribe, then ask ─────────────── */

  const stopHearing = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const recorder = recorderRef.current;
    const context = contextRef.current;
    const stream = streamRef.current;
    recorderRef.current = null;
    contextRef.current = null;
    streamRef.current = null;
    if (!recorder || !context) return;

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    stream?.getTracks().forEach((track) => track.stop());
    setHearing(false);
    setHeardLevel(0);

    const chunks = chunksRef.current;
    chunksRef.current = [];
    const length = chunks.reduce((sum, c) => sum + c.length, 0);
    if (length < TARGET_RATE / 4) return; /* under a quarter second — ignore */

    const merged = new Float32Array(length);
    let at = 0;
    for (const chunk of chunks) {
      merged.set(chunk, at);
      at += chunk.length;
    }
    const wav = encodeWav(downMix(merged, context.sampleRate, TARGET_RATE), TARGET_RATE);

    setBusy(true);
    try {
      const form = new FormData();
      form.append("audio", wav, "clip.wav");
      const res = await fetch("/api/muse/transcribe", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { text?: string; note?: string; error?: string };
      const heard = (data.text ?? "").trim();
      if (!heard) {
        setVoiceNote(data.note ?? (data.error ? "I could not make out that clip — try again." : null));
      } else {
        await ask(heard, heard);
      }
    } catch {
      setVoiceNote("The voice service is not answering — type your question instead.");
    } finally {
      setBusy(false);
      void context.close().catch(() => undefined);
    }
  }, [ask]);

  const startHearing = useCallback(async () => {
    if (busy || hearing) return;
    stop();
    setVoiceNote(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      /* The meter is the only reason for this node — it drives the bars. */
      const meter = context.createScriptProcessor(2048, 1, 1);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      meter.connect(context.destination);
      chunksRef.current = [];
      meter.onaudioprocess = (event) => {
        const data = event.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(data));
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        setHeardLevel(Math.min(1, Math.sqrt(sum / data.length) * 6));
      };
      source.connect(meter);

      const recorder = new MediaRecorder(stream);
      recorder.start();
      recorderRef.current = recorder;
      contextRef.current = context;
      streamRef.current = stream;
      setHearing(true);
      timerRef.current = setTimeout(() => void stopHearing(), MAX_RECORD_MS);
    } catch {
      setVoiceNote("The microphone is blocked in this browser — allow it, or type instead.");
    }
  }, [busy, hearing, stop, stopHearing]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void contextRef.current?.close().catch(() => undefined);
    },
    []
  );

  /* ── Render ─────────────────────────────────────────────────────────────── */

  return (
    <>
      {/* The launcher — always reachable, never in the way of the page's own controls */}
      <motion.button
        type="button"
        onClick={() => (open ? shut() : setOpen(true))}
        aria-label={open ? "Close the desk assistant" : "Open the desk assistant — talk or type"}
        aria-expanded={open}
        className="focus-brand group fixed bottom-5 right-5 z-[75] flex h-14 items-center gap-2.5 rounded-full bg-brand-600 pl-4 pr-5 text-white shadow-[0_1px_0_rgba(255,255,255,0.18)_inset,0_18px_40px_-16px_rgba(217,38,22,0.85)] transition-colors hover:bg-brand-700 sm:bottom-7 sm:right-7"
        whileHover={reduce ? undefined : { y: -2 }}
        whileTap={reduce ? undefined : { scale: 0.97 }}
      >
        <span className="relative grid h-6 w-6 place-items-center">
          {open ? (
            <X className="h-4.5 w-4.5" aria-hidden="true" />
          ) : (
            <>
              <Sparkles className="h-4.5 w-4.5 transition-transform group-hover:rotate-12" aria-hidden="true" />
              {!busy && !hearing && (
                <span
                  aria-hidden="true"
                  className="absolute -inset-1.5 animate-ping-slow rounded-full bg-brand-400/40"
                />
              )}
            </>
          )}
        </span>
        <span className="hidden font-code text-[9.5px] font-bold uppercase tracking-[0.18em] sm:inline">
          {open ? "Close" : "Ask the desk"}
        </span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="muse-panel"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.26, ease: EASE }}
            role="dialog"
            aria-label="Desk assistant — powered by Muse"
            className="fixed bottom-24 right-4 z-[76] flex max-h-[72vh] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[12px] border border-white/10 bg-night text-white shadow-[0_1px_0_rgba(255,255,255,0.07)_inset,0_40px_90px_-30px_rgba(11,12,15,0.9)] sm:right-7"
          >
            <div className="bg-grid-dark pointer-events-none absolute inset-0 opacity-50" aria-hidden="true" />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-500/70 to-transparent"
            />

            {/* Header */}
            <header className="relative flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3.5">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 font-code text-[8px] font-bold tracking-[0.22em] text-brand-400">
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  DESK ASSISTANT · MUSE
                </p>
                <p className="mt-1 truncate text-[12.5px] font-semibold text-ink-100">
                  Talk or type — it reads the desk, it never signs it
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setSpeakOn((s) => !s);
                    stop();
                  }}
                  aria-label={speakOn ? "Mute spoken replies" : "Unmute spoken replies"}
                  title={speakOn ? "Mute replies" : "Unmute replies"}
                  className={cn(
                    "grid h-8 w-8 place-items-center rounded-lg transition-colors",
                    speakOn ? "text-ink-300 hover:bg-white/10 hover:text-white" : "text-ink-500 hover:bg-white/10 hover:text-white"
                  )}
                >
                  {speakOn ? <Volume2 className="h-4 w-4" aria-hidden="true" /> : <VolumeX className="h-4 w-4" aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  onClick={shut}
                  aria-label="Close the assistant"
                  className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </header>

            {/* Transcript */}
            <div
              ref={scrollerRef}
              className="relative min-h-[180px] flex-1 space-y-3 overflow-y-auto px-4 py-4 [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar]:w-1"
              aria-live="polite"
            >
              {turns.length === 0 && (
                <div className="space-y-3">
                  <p className="text-[13px] leading-relaxed text-ink-300">
                    Ask about the desk — what is running, what waits at the gate, which clocks are running, what one
                    tender&apos;s record says. Answers come from the live record, and they are read aloud.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void ask(s)}
                        className="rounded-full border border-white/12 px-2.5 py-1.5 font-code text-[8px] font-semibold tracking-[0.12em] text-ink-200 transition-colors hover:border-brand-500/60 hover:text-white"
                      >
                        {s.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {turns.map((t) => (
                <div key={t.id} className={cn("flex", t.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-[10px] px-3.5 py-2.5",
                      t.role === "user"
                        ? "rounded-br-md bg-brand-600 text-white"
                        : "rounded-bl-md bg-white/[0.06] text-ink-100 ring-1 ring-inset ring-white/10"
                    )}
                  >
                    {t.heard && t.heard !== t.text && (
                      <p className="mb-1 font-code text-[7.5px] tracking-[0.14em] text-brand-200/80">
                        HEARD · {t.heard.toUpperCase()}
                      </p>
                    )}
                    <p className="text-[13px] leading-relaxed">{t.text}</p>
                    {t.tools && t.tools.length > 0 && (
                      <p className="mt-2 flex flex-wrap items-center gap-1 font-code text-[7px] tracking-[0.14em] text-ink-400">
                        READ THE DESK:
                        {t.tools.map((tool, i) => (
                          <span key={`${tool}-${i}`} className="rounded bg-white/[0.07] px-1.5 py-0.5 text-ink-300">
                            {tool.toUpperCase()}
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                </div>
              ))}

              {busy && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-1.5 rounded-[10px] rounded-bl-md bg-white/[0.06] px-3.5 py-3 ring-1 ring-inset ring-white/10">
                    {[0, 1, 2].map((i) => (
                      <motion.span
                        key={i}
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full bg-brand-400"
                        animate={reduce ? undefined : { opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
                        transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
                      />
                    ))}
                    <span className="ml-1 font-code text-[7.5px] tracking-[0.16em] text-ink-300">READING THE DESK</span>
                  </div>
                </div>
              )}

              {voiceNote && (
                <p className="rounded-xl border border-brand-500/30 bg-brand-500/10 px-3 py-2 font-code text-[8px] leading-[1.9] tracking-[0.1em] text-brand-200">
                  {voiceNote.toUpperCase()}
                </p>
              )}
            </div>

            {/* Composer */}
            <div className="relative border-t border-white/10 px-3 py-3">
              {/* The meter — the mic is honest about hearing you */}
              {hearing && (
                <div className="mb-2.5 flex items-center gap-2.5 rounded-xl bg-white/[0.05] px-3 py-2">
                  <div className="flex h-4 items-end gap-[3px]" aria-hidden="true">
                    {Array.from({ length: 12 }).map((_, i) => {
                      const seed = Math.sin(i * 1.7 + heardLevel * 9) * 0.5 + 0.5;
                      const h = 15 + (heardLevel * 85 + seed * 22) * (0.4 + 0.6 * seed);
                      return (
                        <motion.span
                          key={i}
                          className="w-[3px] rounded-full bg-brand-400"
                          animate={{ height: `${Math.min(100, h)}%` }}
                          transition={{ duration: 0.09 }}
                        />
                      );
                    })}
                  </div>
                  <span className="font-code text-[8px] font-bold tracking-[0.16em] text-brand-300">
                    LISTENING · RELEASE TO SEND
                  </span>
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(draft);
                }}
                className="flex items-center gap-2"
              >
                <button
                  type="button"
                  onClick={() => {
                    if (hearing) void stopHearing();
                    else void startHearing();
                  }}
                  disabled={busy}
                  aria-label={hearing ? "Stop listening and send" : "Ask by voice"}
                  title={hearing ? "Send" : "Hold a question by voice"}
                  className={cn(
                    "grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    hearing
                      ? "bg-brand-500 text-white shadow-[0_0_0_4px_rgba(232,56,42,0.25)]"
                      : "bg-white/[0.07] text-ink-200 ring-1 ring-inset ring-white/10 hover:bg-white/[0.12] hover:text-white"
                  )}
                >
                  {hearing ? <Square className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
                </button>
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={hearing ? "Listening…" : "Ask the desk…"}
                  disabled={hearing || busy}
                  maxLength={2000}
                  className="h-11 min-w-0 flex-1 rounded-full border border-white/12 bg-white/[0.05] px-4 text-[13px] text-white outline-none transition-colors placeholder:text-ink-500 focus:border-brand-500/60 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={busy || !draft.trim() || hearing}
                  aria-label="Send the question"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                </button>
              </form>
              <p className="mt-2 text-center font-code text-[7px] tracking-[0.16em] text-ink-500">
                MUSE SPARK + MUSE VOICE · READ-ONLY · THE GAVEL IS NOT IN THIS BUBBLE
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
