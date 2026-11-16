"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowUp,
  Check,
  CornerDownLeft,
  Loader2,
  Mic,
  ShieldCheck,
  Sparkles,
  Square,
  Wand2,
  X,
} from "lucide-react";
import type { Proposal } from "@/lib/muse-actions";
import { cn } from "@/lib/utils";

/**
 * DeskAgent — the agentic command surface on the workspace overview.
 *
 * This is not a mock chat box. It posts to /api/muse/chat, where the desk
 * agent runs its real loop: reads against the quorum-mcp sidecar (runs,
 * approvals, deadlines, the committee register, one tender's record), and an
 * assignment returned as an HMAC-signed proposal that only the signed-in
 * human can confirm through /api/muse/execute.
 *
 * Two modes:
 *   · Ask       — read the desk, explain, investigate, find contradictions.
 *   · Generate  — draft content (a notice, a brief, a redline) for review.
 *                 The instruction says "do not execute"; the agent still
 *                 cannot sign, approve or file anything.
 */

type Mode = "ask" | "generate";
type ProposalState = "pending" | "confirmed" | "executed" | "declined" | "failed";

type Turn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  model?: string | null;
  tools?: string[];
  proposal?: Proposal;
  proposalState?: ProposalState;
  note?: string;
};

/* Chips that have a deterministic destination go there; only genuinely open
   questions go to the model. "What needs approval" must never depend on a
   small model's reading of the gate queue. */
type Chip = {
  label: string;
  prompt?: string;
  action?: "gates" | "findings" | "new-run";
};

const ASK_CHIPS: Chip[] = [
  { label: "What is overdue?", prompt: "Which deadlines are overdue, and by how long?" },
  { label: "Committee attendance", prompt: "Does the committee meet its attendance requirement today?" },
  { label: "Approvals", action: "gates" },
];

const GENERATE_CHIPS: Chip[] = [
  {
    label: "Morning brief",
    prompt:
      "Write a short morning brief for me: the approvals waiting, the deadlines, and the one tender that most needs attention. Base it only on the live desk and name the records you read.",
  },
  {
    label: "Draft a committee brief",
    prompt:
      "Draft a short committee brief on the tender that most needs attention. Base it only on the live file, cite the records you read, and mark anything you could not verify.",
  },
  {
    label: "Draft a redline",
    prompt:
      "Draft a redline for the highest-risk finding on a pending review. Show the proposed clause and its rationale; do not apply it.",
  },
  {
    label: "Write an award summary",
    prompt:
      "Write a plain-language award summary for the last completed review, with the findings, the citation coverage and the decision still open for a human.",
  },
];

let turnSeq = 0;
const nextTurnId = () => `desk${++turnSeq}`;

function safeHistory(turns: Turn[]) {
  return turns
    .filter((turn) => turn.text.trim().length > 0)
    .slice(-6)
    .map((turn) => ({
      role: turn.role,
      content: turn.text.slice(0, 2000),
    }));
}

/* ── Voice ────────────────────────────────────────────────────────────────────
   Speaking is dictation, not submission: the words land in the composer and
   the officer reads them before Enter. The browser's own recogniser is tried
   first — it answers instantly, needs no upload and spends no quota. A browser
   without one (Firefox) records a 16 kHz mono WAV and posts it to
   /api/muse/transcribe, where Muse Voice or the edge Worker does the hearing. */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
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
};

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function microphoneNote(error: unknown): string {
  const name = (error as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "The microphone is blocked — allow it in your browser, or type instead.";
  if (name === "NotFoundError") return "No microphone was found on this device — type the question instead.";
  if (name === "NotReadableError") return "The microphone is busy in another app — close it and try again.";
  return "The microphone did not open — allow it, or type instead.";
}

/* Whisper, Muse and the edge Worker all read PCM; WAV is the format the
   transcriber is told to expect, so the browser records exactly that. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let at = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(at, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    at += 2;
  }
  return new Blob([view], { type: "audio/wav" });
}

function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.max(1, Math.round(input.length / ratio)));
  for (let i = 0; i < out.length; i++) {
    const at = i * ratio;
    const low = Math.floor(at);
    const high = Math.min(input.length - 1, low + 1);
    out[i] = input[low] * (1 - (at - low)) + input[high] * (at - low);
  }
  return out;
}

/* ── The two doors ───────────────────────────────────────────────────────────
   Barry's floating bubble and this composer are the same agent. The bubble
   stands down on the Overview, so it carries a link here; the workspace asks
   it to open this section, and the composer takes focus once it is mounted. */

const DESK_COMPOSER_EVENT = "quorum:desk-composer";
let deskFocusPending = false;

/** Asked by the bubble. Returns true when a mounted workspace accepted it. */
export function requestDeskComposer(): boolean {
  const accepted = !window.dispatchEvent(new Event(DESK_COMPOSER_EVENT, { cancelable: true }));
  deskFocusPending = accepted;
  return accepted;
}

export function onDeskComposerRequest(handler: () => void): () => void {
  const listener = (event: Event) => {
    event.preventDefault();
    handler();
  };
  window.addEventListener(DESK_COMPOSER_EVENT, listener);
  return () => window.removeEventListener(DESK_COMPOSER_EVENT, listener);
}

function takeDeskComposerFocus(): boolean {
  const pending = deskFocusPending;
  deskFocusPending = false;
  return pending;
}

type Recorder = { stop: () => Promise<Blob>; cancel: () => void };

async function openMicrophone(): Promise<Recorder> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("no-microphone");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("no-audio-context");
  }
  let context: AudioContext;
  try {
    context = new AudioCtx({ sampleRate: 16_000 });
  } catch {
    context = new AudioCtx();
  }
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  /* A muted sink keeps the graph running without echoing the officer's own
     voice back through the speakers. */
  const sink = context.createGain();
  sink.gain.value = 0;
  source.connect(processor);
  processor.connect(sink);
  sink.connect(context.destination);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      processor.disconnect();
      source.disconnect();
      sink.disconnect();
    } catch {
      /* already detached */
    }
    stream.getTracks().forEach((track) => track.stop());
    void context.close().catch(() => {});
  };

  return {
    cancel: close,
    stop: async () => {
      const rate = context.sampleRate;
      close();
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const merged = new Float32Array(total);
      let at = 0;
      for (const chunk of chunks) {
        merged.set(chunk, at);
        at += chunk.length;
      }
      return encodeWav(resample(merged, rate, 16_000), 16_000);
    },
  };
}

export function DeskAgent({
  roleLabel,
  counts,
  canRun,
  onNewRun,
  onNavigate,
  onExecuted,
  onToast,
}: {
  roleLabel: string;
  counts: { runs: number; gates: number; findings: number };
  canRun: boolean;
  onNewRun: () => void;
  onNavigate: (section: "mc-runs" | "mc-gates" | "mc-findings" | "mc-cycle") => void;
  onExecuted: () => void;
  onToast: (message: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("ask");
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /* Voice is dictation into the composer: nothing is sent until the officer
     reads what was heard and presses Enter. */
  const [voice, setVoice] = useState<"idle" | "starting" | "listening" | "uploading">("idle");
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const providerRef = useRef<"meta" | "edge" | "browser" | null>(null);

  const chips = mode === "ask" ? ASK_CHIPS : GENERATE_CHIPS;

  const statusLine = useMemo(() => {
    const parts: string[] = [];
    if (counts.gates > 0) parts.push(`${counts.gates} awaiting a named human`);
    if (counts.runs > 0) parts.push(`${counts.runs} review${counts.runs === 1 ? "" : "s"} in progress`);
    if (counts.findings > 0) parts.push(`${counts.findings} finding${counts.findings === 1 ? "" : "s"} on file`);
    return parts.length > 0 ? parts.join(" · ") : "No work waiting. Start a review or ask about a tender.";
  }, [counts]);

  const patchTurn = useCallback((id: string, patch: Partial<Turn>) => {
    setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)));
  }, []);

  const ask = useCallback(
    async (rawOverride?: string) => {
      const raw = (rawOverride ?? text).trim();
      if (!raw || busy) return;

      /* Generate mode changes the instruction, not the authority: the agent may
         draft, but this surface never offers it a way to execute. */
      const message =
        mode === "generate"
          ? `Prepare a draft for my review. Do not execute, publish or file anything; show the draft only. ${raw}`
          : raw;
      const history = safeHistory(turns);

      setBusy(true);
      setError(null);
      setText("");
      setTurns((prev) => [...prev, { id: nextTurnId(), role: "user", text: raw }]);

      try {
        const res = await fetch("/api/muse/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message, history }),
        });
        const data = (await res.json().catch(() => null)) as
          | {
              reply?: string;
              model?: string | null;
              toolsRead?: string[];
              proposal?: Proposal;
              error?: string;
            }
          | null;

        if (!res.ok) {
          setError(data?.error ?? "The desk agent did not answer. Nothing changed — try again.");
          return;
        }

        setTurns((prev) => [
          ...prev,
          {
            id: nextTurnId(),
            role: "assistant",
            text: data?.reply?.trim() || "I have nothing on that — try naming a tender reference.",
            model: data?.model ?? null,
            tools: data?.toolsRead ?? [],
            proposal: data?.proposal,
            proposalState: data?.proposal ? "pending" : undefined,
            note: data?.error,
          },
        ]);

      } catch {
        setError("The desk agent could not be reached. Nothing changed.");
      } finally {
        setBusy(false);
      }
    },
    [busy, mode, text, turns],
  );

  const insertHeard = useCallback((heard: string) => {
    setText((prev) => (prev.trim().length > 0 ? `${prev.trim()} ${heard}` : heard).slice(0, 2000));
    setError(null);
    setVoiceNote(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const hearInBrowser = useCallback(
    (Ctor: new () => SpeechRecognitionLike) => {
      const recognition = new Ctor();
      recognition.lang = "en-GB";
      recognition.continuous = false;
      recognition.interimResults = false;
      let heard = "";
      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          heard += event.results[i][0]?.transcript ?? "";
        }
      };
      recognition.onerror = (event) => {
        setVoiceNote(
          event.error === "not-allowed" || event.error === "service-not-allowed"
            ? "The microphone is blocked — allow it in your browser, or type instead."
            : event.error === "no-speech"
              ? "I did not catch that — press the mic and speak again."
              : event.error === "network"
                ? "The browser's speech service needs a network — type the question instead."
                : "Voice input stopped — try again, or type instead.",
        );
      };
      recognition.onend = () => {
        recognitionRef.current = null;
        setVoice("idle");
        const said = heard.trim();
        if (said) insertHeard(said);
      };
      try {
        recognition.start();
        recognitionRef.current = recognition;
        setVoice("listening");
      } catch {
        setVoice("idle");
        setVoiceNote("The microphone did not open — allow it in your browser, or type instead.");
      }
    },
    [insertHeard],
  );

  const startListening = useCallback(async () => {
    if (voice !== "idle" || busy) return;
    setError(null);
    setVoiceNote(null);

    const Ctor = recognitionCtor();
    if (Ctor) {
      hearInBrowser(Ctor);
      return;
    }

    /* No browser ears — ask the server which hearing path it has before
       opening the microphone, so a browser with neither does not record a
       clip only to be told it will not be heard. */
    setVoice("starting");
    try {
      if (!providerRef.current) {
        const probe = await fetch("/api/muse/transcribe", { cache: "no-store" })
          .then((res) => res.json() as Promise<{ provider?: string }>)
          .catch(() => null);
        providerRef.current =
          probe?.provider === "meta" || probe?.provider === "edge" ? probe.provider : "browser";
      }
      if (providerRef.current === "browser") {
        setVoice("idle");
        setVoiceNote("This browser has no speech recognition — type the question instead.");
        return;
      }
      recorderRef.current = await openMicrophone();
      setVoice("listening");
    } catch (err) {
      providerRef.current = null;
      setVoice("idle");
      setVoiceNote(microphoneNote(err));
    }
  }, [busy, hearInBrowser, voice]);

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        /* already closed */
      }
      return;
    }

    const recorder = recorderRef.current;
    if (!recorder) {
      setVoice("idle");
      return;
    }
    recorderRef.current = null;
    setVoice("uploading");
    void (async () => {
      try {
        const clip = await recorder.stop();
        if (clip.size < 8_000) {
          setVoiceNote("That was very short — hold on, speak the whole question, then stop.");
          return;
        }
        const form = new FormData();
        form.append("audio", clip, "clip.wav");
        const res = await fetch("/api/muse/transcribe", { method: "POST", body: form });
        const body = (await res.json().catch(() => null)) as {
          text?: string;
          note?: string;
          error?: string;
        } | null;
        const heard = String(body?.text ?? "").trim();
        if (!res.ok) {
          setVoiceNote(body?.note ?? body?.error ?? "The voice service did not answer — type the question instead.");
          return;
        }
        if (!heard) {
          setVoiceNote(body?.note ?? "I could not make out that clip — try again, closer to the mic.");
          return;
        }
        insertHeard(heard);
      } catch {
        setVoiceNote("The clip could not be transcribed — type the question instead.");
      } finally {
        setVoice("idle");
      }
    })();
  }, [insertHeard]);

  /* Arrived here from Barry's bubble: put the caret in the composer. The
     mount pass covers the usual case (the Overview mounts because of the
     request); the listener covers the composer already being on screen. */
  const focusComposer = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.scrollIntoView({ block: "center" });
  }, []);

  useEffect(() => {
    if (takeDeskComposerFocus()) focusComposer();
  }, [focusComposer]);

  useEffect(
    () =>
      onDeskComposerRequest(() => {
        takeDeskComposerFocus();
        focusComposer();
      }),
    [focusComposer],
  );

  /* The microphone must never outlive the composer. */
  useEffect(
    () => () => {
      recorderRef.current?.cancel();
      recorderRef.current = null;
      const recognition = recognitionRef.current;
      if (recognition) {
        try {
          recognition.stop();
        } catch {
          /* already closed */
        }
        recognitionRef.current = null;
      }
    },
    [],
  );

  const confirm = useCallback(
    async (turnId: string, proposal: Proposal) => {
      if (confirming) return;
      setConfirming(turnId);
      setError(null);
      patchTurn(turnId, { proposalState: "confirmed" });

      try {
        const res = await fetch("/api/muse/execute", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ proposal, consent: true }),
        });
        const data = (await res.json().catch(() => null)) as
          | { executed?: boolean; headline?: string; error?: string }
          | null;

        if (res.ok && data?.executed) {
          patchTurn(turnId, { proposalState: "executed" });
          onExecuted();
          onToast("REVIEW ASSIGNED — THE DESK IS READING THE PACK");
        } else {
          patchTurn(turnId, { proposalState: "failed" });
          setError(data?.error ?? "The action did not complete. Nothing changed.");
        }
      } catch {
        patchTurn(turnId, { proposalState: "failed" });
        setError("The execution service did not answer. Nothing changed.");
      } finally {
        setConfirming(null);
      }
    },
    [confirming, onExecuted, onToast, patchTurn],
  );

  /* Follow the newest turn inside the panel without moving the page. */
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [turns, busy]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || voice !== "idle") return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void ask();
    }
  };

  const visibleTurns = turns.slice(-6);

  return (
    <section aria-labelledby="desk-agent-title" className="mt-6">
      <div className="overflow-hidden rounded-[16px] border border-ink-200/70 bg-white shadow-[0_1px_2px_rgba(11,12,15,0.04),0_20px_48px_-30px_rgba(11,12,15,0.4)] dark:border-white/[0.09] dark:bg-[#0c0d10] dark:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-ink-100/80 px-4 py-3 dark:border-white/[0.06] sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ink-950 text-white dark:bg-white/[0.1] dark:text-brand-300">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <h2 id="desk-agent-title" className="truncate text-[13px] font-semibold text-ink-900">
              Desk agent
            </h2>
            <span className="hidden font-code text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400 sm:inline">
              {roleLabel} · this workspace
            </span>
          </div>

          <div
            role="group"
            aria-label="Desk agent mode"
            className="flex shrink-0 items-center gap-0.5 rounded-full border border-ink-200/80 bg-paper p-0.5 dark:border-white/[0.1] dark:bg-white/[0.04]"
          >
            {(
              [
                { id: "ask", label: "Ask", icon: CornerDownLeft },
                { id: "generate", label: "Generate", icon: Wand2 },
              ] as const
            ).map((option) => {
              const Icon = option.icon;
              const selected = mode === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setMode(option.id);
                    inputRef.current?.focus();
                  }}
                  className={cn(
                    "focus-brand inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[11.5px] font-semibold transition-colors",
                    selected
                      ? "bg-ink-950 text-white dark:bg-brand-600 dark:text-white"
                      : "text-ink-500 hover:text-ink-900 dark:text-ink-300 dark:hover:text-white",
                  )}
                >
                  <Icon className="h-3 w-3" aria-hidden="true" />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-4 pb-3 pt-4 sm:px-5">
          <label htmlFor="desk-agent-input" className="sr-only">
            Ask the desk agent or describe a draft
          </label>
          <textarea
            id="desk-agent-input"
            ref={inputRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={2000}
            placeholder={
              mode === "ask"
                ? "Ask anything about this desk — an approval, a tender, the committee, a deadline…"
                : "Describe the draft you need — a notice, a committee brief, a redline, an award summary…"
            }
            className="focus-brand block max-h-[220px] min-h-[62px] w-full resize-none rounded-xl border border-ink-200/80 bg-[#fffdfb] px-3.5 py-3 text-[14.5px] leading-relaxed text-ink-900 shadow-[inset_0_1px_1px_rgba(11,12,15,0.03)] outline-none transition-[border-color,box-shadow] placeholder:text-ink-400 focus:border-ink-950 focus:ring-[3px] focus:ring-ink-950/[0.07] dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-white dark:placeholder:text-ink-500 dark:focus:border-white/35 dark:focus:ring-white/[0.06]"
          />

          {mode === "generate" && (
            <p className="mt-2 flex items-center gap-1.5 text-[11.5px] font-medium text-brand-800 dark:text-brand-300">
              <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
              AI generation · drafts for your review · nothing is signed or filed
            </p>
          )}

          {voiceNote ? (
            <p
              role="status"
              className="mt-2 rounded-lg bg-amber-50/80 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-amber-800 dark:bg-amber-500/[0.08] dark:text-amber-300"
            >
              {voiceNote}
            </p>
          ) : null}

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="min-w-0 text-[11.5px] leading-relaxed text-ink-500 dark:text-ink-400">
              {voice === "listening"
                ? "Listening — speak the question, then press stop."
                : voice === "uploading"
                  ? "Transcribing your question…"
                  : busy
                    ? "Reading the live desk…"
                    : statusLine}
            </p>
            <div className="flex items-center gap-2.5">
              <span className="hidden font-code text-[10px] font-bold uppercase tracking-[0.08em] text-ink-400 sm:inline">
                Enter to send
              </span>
              <button
                type="button"
                onClick={() => (voice === "listening" ? stopListening() : void startListening())}
                disabled={busy || voice === "starting" || voice === "uploading"}
                aria-label={
                  voice === "listening"
                    ? "Stop listening and transcribe"
                    : voice === "uploading"
                      ? "Transcribing your question"
                      : "Ask by voice"
                }
                aria-pressed={voice === "listening"}
                title={voice === "listening" ? "Stop and transcribe" : "Ask by voice"}
                className={cn(
                  "focus-brand grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  voice === "listening"
                    ? "border-brand-600 bg-brand-600 text-white hover:bg-brand-700"
                    : "border-ink-200 bg-white text-ink-600 hover:border-ink-300 hover:bg-ink-50 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-ink-300 dark:hover:bg-white/[0.08]",
                )}
              >
                {voice === "starting" || voice === "uploading" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : voice === "listening" ? (
                  <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                ) : (
                  <Mic className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                onClick={() => void ask()}
                disabled={busy || voice !== "idle" || text.trim().length === 0}
                aria-label={mode === "ask" ? "Ask the desk agent" : "Generate a draft"}
                className="focus-brand grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-400 dark:disabled:bg-white/[0.08] dark:disabled:text-ink-500"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-ink-100/80 pt-3 dark:border-white/[0.06]">
            {[...chips, ...(mode === "ask" && canRun ? [{ label: "Start a review", action: "new-run" as const }] : [])].map(
              (chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => {
                    if ("action" in chip && chip.action === "gates") onNavigate("mc-gates");
                    else if ("action" in chip && chip.action === "findings") onNavigate("mc-findings");
                    else if ("action" in chip && chip.action === "new-run") onNewRun();
                    else void ask(chip.prompt);
                  }}
                  disabled={busy}
                  className={cn(
                    "focus-brand inline-flex h-7 items-center rounded-full border px-3 text-[11.5px] font-medium transition-colors disabled:opacity-50",
                    "action" in chip && chip.action === "new-run"
                      ? "border-ink-950 bg-ink-950 text-white hover:bg-ink-800 dark:border-white/[0.14] dark:bg-white/[0.1] dark:hover:bg-white/[0.16]"
                      : "border-ink-200/80 bg-white text-ink-700 hover:border-ink-300 hover:text-ink-950 dark:border-white/[0.1] dark:bg-white/[0.03] dark:text-ink-300 dark:hover:border-white/25 dark:hover:text-white",
                  )}
                >
                  {chip.label}
                </button>
              ),
            )}
          </div>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-2 flex items-start gap-2 rounded-[10px] border border-brand-500/30 bg-brand-500/[0.07] px-3.5 py-2.5 text-[12px] leading-relaxed text-brand-900 dark:text-brand-200"
        >
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      {visibleTurns.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-[14px] border border-ink-200/70 bg-[#fffdfb] dark:border-white/[0.09] dark:bg-white/[0.02]">
          <div
            ref={listRef}
            aria-live="polite"
            className="max-h-[360px] space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
          >
            {visibleTurns.map((turn) =>
              turn.role === "user" ? (
                <p
                  key={turn.id}
                  className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-500 dark:text-ink-400"
                >
                  <CornerDownLeft className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">{turn.text}</span>
                </p>
              ) : (
                <div key={turn.id} className="min-w-0">
                  <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-ink-900 dark:text-ink-100">
                    {turn.text}
                  </p>

                  {turn.tools && turn.tools.length > 0 && (
                    <p className="mt-2 font-code text-[10px] font-bold uppercase tracking-[0.08em] text-ink-400 dark:text-ink-500">
                      Read {turn.tools.length} record{turn.tools.length === 1 ? "" : "s"} ·{" "}
                      {turn.tools.slice(0, 5).join(" · ")}
                    </p>
                  )}

                  {turn.note && (
                    <p className="mt-2 text-[11.5px] leading-relaxed text-brand-800 dark:text-brand-300">
                      {turn.note}
                    </p>
                  )}

                  {turn.model && (
                    <p className="mt-1 font-code text-[10px] tracking-[0.04em] text-ink-400 dark:text-ink-500">
                      Answered by {turn.model}
                    </p>
                  )}

                  {turn.proposal && (
                    <div className="mt-3 rounded-[10px] border border-ink-200/80 bg-white p-3.5 dark:border-white/[0.1] dark:bg-white/[0.04]">
                      <p className="flex items-center gap-1.5 font-code text-[10px] font-bold uppercase tracking-[0.12em] text-brand-700 dark:text-brand-300">
                        <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                        Confirmation required
                      </p>
                      <p className="mt-1.5 text-[12.5px] font-semibold leading-snug text-ink-900 dark:text-white">
                        {turn.proposal.label}
                      </p>
                      <dl className="mt-2 space-y-1">
                        {turn.proposal.summary.map((row) => (
                          <div key={row.key} className="flex gap-2 text-[11.5px]">
                            <dt className="shrink-0 text-ink-400">{row.key}</dt>
                            <dd className="min-w-0 break-words font-medium text-ink-700 dark:text-ink-200">
                              {row.value}
                            </dd>
                          </div>
                        ))}
                      </dl>

                      {turn.proposalState === "pending" && (
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void confirm(turn.id, turn.proposal!)}
                            disabled={!!confirming}
                            className="focus-brand inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-[11.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
                          >
                            {confirming === turn.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                            ) : (
                              <Check className="h-3 w-3" aria-hidden="true" />
                            )}
                            {confirming === turn.id ? "Assigning…" : "Assign review"}
                          </button>
                          <button
                            type="button"
                            onClick={() => patchTurn(turn.id, { proposalState: "declined" })}
                            disabled={!!confirming}
                            className="focus-brand inline-flex h-8 items-center gap-1 rounded-lg border border-ink-200 px-2.5 text-[11.5px] font-medium text-ink-600 transition-colors hover:border-ink-300 hover:text-ink-900 disabled:opacity-60 dark:border-white/[0.12] dark:text-ink-300 dark:hover:text-white"
                          >
                            <X className="h-3 w-3" aria-hidden="true" />
                            Decline
                          </button>
                        </div>
                      )}

                      {turn.proposalState === "confirmed" && (
                        <p className="mt-2 text-[11px] font-medium text-brand-800 dark:text-brand-300">
                          Confirmed · running…
                        </p>
                      )}
                      {turn.proposalState === "executed" && (
                        <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          Completed · receipt added
                        </p>
                      )}
                      {turn.proposalState === "declined" && (
                        <p className="mt-2 text-[11px] text-ink-500">Declined · nothing changed</p>
                      )}
                      {turn.proposalState === "failed" && (
                        <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-brand-800 dark:text-brand-300">
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          Action could not be completed
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ),
            )}
            {busy && (
              <p className="flex items-center gap-2 text-[12px] text-ink-500 dark:text-ink-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Reading the desk…
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-ink-100/80 bg-ink-50/40 px-4 py-2 dark:border-white/[0.06] dark:bg-white/[0.02] sm:px-5">
            <p className="text-[10.5px] leading-relaxed text-ink-500 dark:text-ink-400">
              The agent prepares the file. It cannot sign, approve or award.
            </p>
            <button
              type="button"
              onClick={() => {
                setTurns([]);
                setError(null);
                inputRef.current?.focus();
              }}
              className="focus-brand font-code text-[10px] font-bold uppercase tracking-[0.08em] text-ink-500 transition-colors hover:text-ink-900 dark:text-ink-400 dark:hover:text-white"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
