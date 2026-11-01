"use client";

/**
 * MuseAssistant — the agentic voice chat bubble for the desk screens.
 *
 * One floating button, bottom right, over the workspace, the docs and the
 * org portal — never the public landing page or the auth door. Press it and
 * you get a panel you can either talk into
 * or type into:
 *
 *   · hearing  — the mic captures raw PCM, the browser encodes a WAV, and
 *     the server hears it: Muse Voice Transcribe (Meta Model API) when a
 *     key is configured, otherwise the quorum-edge Worker's speech
 *     recognition on Cloudflare Workers AI; a browser with neither server
 *     path falls back to its own built-in SpeechRecognition. Nothing is
 *     buffered to disk and no setup notice ever appears.
 *   · thinking — the sentence goes to /api/muse/chat, where the desk agent
 *     runs an agentic loop: reads (runs, approvals, deadlines, the committee
 *     register, one tender's record) execute at once, and a review assignment
 *     comes back as an HMAC-signed proposal card. A full LLM brain answers
 *     whenever Meta Muse is configured, with
 *     a deterministic local brain otherwise — the panel never shows a setup notice.
 *   · acting   — a proposal card waits for the signed-in user. The server
 *     checks their role and confirmation before it assigns a review. Final
 *     procurement decisions remain in the human Approvals workflow.
 *   · speaking — the reply is read aloud in a real neural voice. Deepgram
 *     Aura-2 runs through Cloudflare Workers AI; MeloTTS is the server-side
 *     fallback; the browser's installed voice is the last resort. The voice
 *     can be changed in the panel and is remembered on the device.
 *
 * The agent can do permitted preparatory work, but it never holds the gavel.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import { Ban, Check, ChevronRight, CircleHelp, Mic, MessageSquare, Send, ShieldAlert, Square, Volume2, VolumeX, X } from "lucide-react";
import type { Proposal } from "@/lib/muse-actions";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;

type ProposalState = "pending" | "confirmed" | "declined" | "executed" | "failed";
type Turn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  heard?: string;
  proposal?: Proposal;
  proposalState?: ProposalState;
};
type BarrySupportRequest = {
  id: string;
  subject: string;
  message: string;
  status: "OPEN" | "RESPONDED" | "CLOSED";
  response: string | null;
  respondedBy: string | null;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const SUGGESTIONS = [
  "What is waiting at the gate?",
  "Is quorum present?",
  "Explain the evidence on a pending gate",
  "What can you investigate for me?",
];

const VOICE_KEY = "quorum.muse.voice";
type AssistantSection = "chat" | "support";

/** Cloudflare Workers AI speakers; "browser" skips the edge and uses the device. */
const VOICE_PRESETS = [
  { id: "asteria", label: "Aura · warm", blurb: "Deepgram Aura-2" },
  { id: "orion", label: "Aura · deep", blurb: "Deepgram Aura-2" },
  { id: "luna", label: "Aura · bright", blurb: "Deepgram Aura-2" },
  { id: "atlas", label: "Aura · calm", blurb: "Deepgram Aura-2" },
  { id: "browser", label: "System", blurb: "installed browser voice" },
] as const;

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

/* ── The browser's own ears ─────────────────────────────────────────────
   The last hearing path: no server, no key. Chrome, Edge and Safari ship
   SpeechRecognition; where it exists, a clip round trip is unnecessary —
   the transcript streams live into the composer while the officer talks. */

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

function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/* ── The spoken reply ─────────────────────────────────────────────────────── */

function bestBrowserVoice(): SpeechSynthesisVoice | null {
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const preferred = [
    "samantha",
    "daniel",
    "karen",
    "moira",
    "tessa",
    "serena",
    "google uk english female",
    "google uk english male",
    "microsoft aria",
    "microsoft jenny",
    "microsoft sonia",
    "ava",
    "allison",
    "alex",
    "tom",
  ];
  for (const name of preferred) {
    const hit = voices.find((v) => v.name.toLowerCase().includes(name));
    if (hit) return hit;
  }
  return (
    voices.find((v) => /en[-_](ZA|GB|KE|NG)/i.test(v.lang)) ??
    voices.find((v) => /^en/i.test(v.lang)) ??
    null
  );
}

type SpeakerMode = "aura" | "browser";

function useSpeaker(enabled: boolean) {
  const [voice, setVoiceState] = useState<string>("asteria");
  const [mode, setMode] = useState<SpeakerMode>("aura");
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const primeRef = useRef<HTMLAudioElement | null>(null);
  const speechSeqRef = useRef(0);

  useEffect(() => {
    /* Deferred a frame so the restore never cascades a synchronous re-render. */
    const raf = requestAnimationFrame(() => {
      try {
        const saved = window.localStorage.getItem(VOICE_KEY);
        if (saved && VOICE_PRESETS.some((v) => v.id === saved)) setVoiceState(saved);
      } catch {
        /* private mode / storage blocked — the default is fine */
      }
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const cleanupAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    speechSeqRef.current += 1;
    cleanupAudio();
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [cleanupAudio]);

  const setVoice = useCallback(
    (next: string) => {
      stop();
      const allowed = VOICE_PRESETS.some((v) => v.id === next) ? next : "asteria";
      setVoiceState(allowed);
      setMode(allowed === "browser" ? "browser" : "aura");
      try {
        window.localStorage.setItem(VOICE_KEY, allowed);
      } catch {
        /* ignore storage failures */
      }
    },
    [stop]
  );

  /** Prime audio on the first real user gesture, so a later async reply can play. */
  const prime = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      if (!primeRef.current) {
        primeRef.current = new Audio(
          "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="
        );
        primeRef.current.volume = 0;
      }
      void primeRef.current.play().catch(() => undefined);
      if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
    } catch {
      /* the browser may still allow the real playback; this is only a nudge */
    }
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!enabled || typeof window === "undefined") return;
      stop();
      const seq = speechSeqRef.current;
      const clean = text
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/[*#`>_|]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!clean) return;

      /* 1. The real neural voice — Cloudflare Workers AI, via our own route. */
      if (voice !== "browser") {
        try {
          const res = await fetch("/api/muse/speak", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: clean, voice }),
          });
          const type = res.headers.get("content-type") ?? "";
          if (res.ok && type.startsWith("audio/")) {
            const blob = await res.blob();
            if (seq !== speechSeqRef.current) return;
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audioRef.current = audio;
            urlRef.current = url;
            audio.onended = () => {
              setSpeaking(false);
              cleanupAudio();
            };
            audio.onerror = () => {
              setSpeaking(false);
              cleanupAudio();
            };
            setMode("aura");
            setSpeaking(true);
            try {
              await audio.play();
              return;
            } catch {
              cleanupAudio();
            }
          }
        } catch {
          /* fall through to the installed voice */
        }
      }

      /* 2. The browser's own voice — the last fallback, never a silent failure. */
      if (seq !== speechSeqRef.current) return;
      if (!("speechSynthesis" in window)) {
        setSpeaking(false);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.rate = 1.02;
      utterance.pitch = 1;
      const pick = bestBrowserVoice();
      if (pick) utterance.voice = pick;
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      setMode("browser");
      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
    },
    [cleanupAudio, enabled, stop, voice]
  );

  useEffect(() => () => cleanupAudio(), [cleanupAudio]);

  return { speak, stop, prime, voice, setVoice, mode, speaking };
}

/* ── The bubble ───────────────────────────────────────────────────────────── */

let turnSeq = 0;
const nextId = () => `t${++turnSeq}`;

export function MuseAssistant({ name }: { name?: string }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<AssistantSection>("chat");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [heardLevel, setHeardLevel] = useState(0);
  const [speakOn, setSpeakOn] = useState(true);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  /* Which ears the server offers: meta (Muse Voice Transcribe), edge
     (Workers AI) or browser (the device's own recognition). Probed once
     per open; the mic flow adapts before the officer ever presses it. */
  const [asrProvider, setAsrProvider] = useState<"meta" | "edge" | "browser">("browser");
  const [supportRequests, setSupportRequests] = useState<BarrySupportRequest[]>([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportSending, setSupportSending] = useState(false);
  const [supportSubject, setSupportSubject] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportError, setSupportError] = useState<string | null>(null);
  const [supportNotice, setSupportNotice] = useState<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const supportLoadSequenceRef = useRef(0);
  const supportMutationVersionRef = useRef(0);
  const chunksRef = useRef<Float32Array[]>([]);
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const asrModeRef = useRef<"wav" | "browser">("wav");
  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const finalHeardRef = useRef("");

  const { speak, stop, prime, speaking } = useSpeaker(speakOn && open);

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
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 220);
      /* One probe decides the mic's path before the officer presses it —
         the answer never names a key or a setup step, it only picks ears. */
      let alive = true;
      fetch("/api/muse/transcribe")
        .then((r) => r.json())
        .then((d: { provider?: string }) => {
          if (alive && (d.provider === "meta" || d.provider === "edge" || d.provider === "browser")) {
            setAsrProvider(d.provider);
          }
        })
        .catch(() => undefined);
      return () => {
        alive = false;
      };
    }
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

  const loadSupportRequests = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++supportLoadSequenceRef.current;
    const mutationVersion = supportMutationVersionRef.current;
    setSupportLoading(true);
    try {
      const res = await fetch("/api/support/requests", { cache: "no-store", signal });
      const body = (await res.json().catch(() => ({}))) as { requests?: BarrySupportRequest[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Your support requests could not be loaded.");
      if (sequence === supportLoadSequenceRef.current && mutationVersion === supportMutationVersionRef.current) {
        setSupportRequests(Array.isArray(body.requests) ? body.requests : []);
        setSupportError(null);
      }
    } catch (error) {
      if (signal?.aborted) return;
      if (sequence === supportLoadSequenceRef.current && mutationVersion === supportMutationVersionRef.current) {
        setSupportError((error as Error).message || "Your support requests could not be loaded.");
      }
    } finally {
      if (!signal?.aborted && sequence === supportLoadSequenceRef.current) setSupportLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || section !== "support") return;
    const controller = new AbortController();
    void loadSupportRequests(controller.signal);
    const timer = window.setInterval(() => void loadSupportRequests(), 30_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [open, section, loadSupportRequests]);

  const sendSupportRequest = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (supportSending) return;
    setSupportSending(true);
    setSupportError(null);
    setSupportNotice(null);
    try {
      const res = await fetch("/api/support/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: supportSubject.trim(), message: supportMessage.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { request?: BarrySupportRequest; error?: string };
      if (!res.ok || !body.request) throw new Error(body.error ?? "Your support request could not be sent.");
      supportMutationVersionRef.current += 1;
      setSupportSubject("");
      setSupportMessage("");
      setSupportRequests((current) => [body.request!, ...current.filter((request) => request.id !== body.request!.id)]);
      setSupportNotice("Request sent. A workspace admin will reply here.");
    } catch (error) {
      setSupportError((error as Error).message || "Your support request could not be sent.");
    } finally {
      setSupportSending(false);
    }
  }, [supportMessage, supportSending, supportSubject]);

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
          body: JSON.stringify({
            message: text,
            history,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          reply?: string;
          proposal?: Proposal;
          error?: string;
        };
        const reply = (data.reply ?? data.error ?? "I could not answer that just now.").trim();
        setTurns((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            text: reply,
            ...(data.proposal ? { proposal: data.proposal, proposalState: "pending" as const } : {}),
          },
        ]);
        void speak(reply);
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

  /* ── Acting: consent first, always ───────────────────────────────────── */

  const patchTurn = useCallback((id: string, patch: Partial<Turn>) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const say = useCallback((text: string) => {
    setTurns((prev) => [...prev, { id: nextId(), role: "assistant", text }]);
  }, []);

  const confirmProposal = useCallback(
    async (turnId: string, proposal: Proposal) => {
      if (confirmingId) return;
      setConfirmingId(turnId);
      patchTurn(turnId, { proposalState: "confirmed" });
      try {
        /* The server resolves identity and permissions from the signed-in session. */
        const me = await fetch("/api/auth/me")
          .then((r) => r.json())
          .catch(() => null);
        if (!me?.user) {
          patchTurn(turnId, { proposalState: "pending" });
          say("Sign in to Quorum first. The server checks your workspace role before it starts an assigned review.");
          void speak("Sign in to Quorum first.");
          return;
        }

        const res = await fetch("/api/muse/execute", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ proposal, consent: true }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          executed?: boolean;
          headline?: string;
          detail?: string[];
          tool?: string;
          error?: string;
        };
        if (res.ok && data.executed) {
          patchTurn(turnId, { proposalState: "executed" });
          setTurns((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "assistant",
              text: data.headline ?? "Done.",
            },
          ]);
          void speak(data.headline ?? "Done.");
        } else {
          patchTurn(turnId, { proposalState: "failed" });
          say(`${data.error ?? "The desk refused the action."} Nothing changed.`);
          void speak("The desk refused that action. Nothing changed.");
        }
      } catch {
        patchTurn(turnId, { proposalState: "failed" });
        say("The execution service did not answer — nothing changed. Try confirming again in a moment.");
      } finally {
        setConfirmingId(null);
      }
    },
    [confirmingId, patchTurn, say, speak]
  );

  const declineProposal = useCallback(
    (turnId: string) => {
      patchTurn(turnId, { proposalState: "declined" });
      say("Declined. The proposal is void — nothing on the desk moved, and the audit trail stays exactly as it was.");
      void speak("Declined. Nothing changed.");
    },
    [patchTurn, say, speak]
  );

  /* ── Hearing: three paths, zero setup ───────────────────────────────── */

  /* Browser ears — the live path when no server hearing is configured. */
  const finishBrowserHearing = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    recogRef.current = null;
    setHearing(false);
    setHeardLevel(0);
    const heard = finalHeardRef.current.trim();
    finalHeardRef.current = "";
    if (heard) {
      void ask(heard, heard);
    } else {
      setVoiceNote((prev) => prev ?? "I heard nothing — tap the mic and speak a little longer.");
    }
  }, [ask]);

  const startBrowserHearing = useCallback(() => {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) {
      setVoiceNote("Voice is not available in this browser — type your question.");
      return;
    }
    prime();
    stop();
    finalHeardRef.current = "";
    const recog = new Ctor();
    recog.continuous = true;
    recog.interimResults = true;
    recog.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) finalHeardRef.current += `${text} `;
        else interim += text;
      }
      const live = `${finalHeardRef.current} ${interim}`.trim();
      if (live) {
        setDraft(live);
        setHeardLevel(Math.min(1, 0.15 + live.length / 90));
      }
    };
    recog.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setVoiceNote("The microphone is blocked in this browser — allow it, or type instead.");
      } else if (event.error === "network") {
        setVoiceNote("The browser's ears need a network — type the question instead.");
      }
    };
    recog.onend = () => {
      if (recogRef.current === recog) finishBrowserHearing();
    };
    try {
      recog.start();
      asrModeRef.current = "browser";
      recogRef.current = recog;
      setHearing(true);
      setHeardLevel(0.15);
      timerRef.current = setTimeout(() => finishBrowserHearing(), MAX_RECORD_MS);
    } catch {
      setVoiceNote("The microphone did not open — type your question instead.");
    }
  }, [finishBrowserHearing, prime, stop]);

  const stopHearing = useCallback(async () => {
    if (asrModeRef.current === "browser") {
      const recog = recogRef.current;
      if (recog) {
        try {
          recog.stop(); /* onend finalises the transcript */
        } catch {
          finishBrowserHearing();
        }
      } else {
        setHearing(false);
      }
      return;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const context = contextRef.current;
    const stream = streamRef.current;
    contextRef.current = null;
    streamRef.current = null;
    if (!context) return;

    /* Let the last ScriptProcessor buffer land before closing the graph. */
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    stream?.getTracks().forEach((track) => track.stop());
    setHearing(false);
    setHeardLevel(0);

    const sampleRate = context.sampleRate;
    const chunks = chunksRef.current;
    chunksRef.current = [];
    const length = chunks.reduce((sum, c) => sum + c.length, 0);
    if (length < TARGET_RATE / 4) {
      /* Under a quarter second — ignore, but always close the microphone. */
      void context.close().catch(() => undefined);
      return;
    }

    const merged = new Float32Array(length);
    let at = 0;
    for (const chunk of chunks) {
      merged.set(chunk, at);
      at += chunk.length;
    }
    const wav = encodeWav(downMix(merged, sampleRate, TARGET_RATE), TARGET_RATE);

    setBusy(true);
    try {
      const form = new FormData();
      form.append("audio", wav, "clip.wav");
      const res = await fetch("/api/muse/transcribe", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { text?: string; note?: string; error?: string; provider?: string };
      const heard = (data.text ?? "").trim();
      if (data.provider === "browser") {
        /* The server's ears are not answering — next press uses the device's
           own recognition, with no setup language anywhere. */
        setAsrProvider("browser");
      }
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
  }, [ask, finishBrowserHearing]);

  const startHearing = useCallback(async () => {
    if (busy || hearing) return;
    setVoiceNote(null);
    if (asrProvider === "browser") {
      startBrowserHearing();
      return;
    }
    prime();
    stop();
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceNote("This browser has no microphone API — type instead.");
      return;
    }
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      context = new AudioContext();
      await context.resume();
      if (typeof context.createScriptProcessor !== "function") {
        throw new Error("ScriptProcessor is unavailable");
      }
      const source = context.createMediaStreamSource(stream);
      /* The meter is the only reason for this node — it drives the bars. */
      const meter = context.createScriptProcessor(2048, 1, 1);
      chunksRef.current = [];
      meter.onaudioprocess = (event) => {
        const data = event.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(data));
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        setHeardLevel(Math.min(1, Math.sqrt(sum / data.length) * 6));
      };
      source.connect(meter);
      meter.connect(context.destination);

      contextRef.current = context;
      streamRef.current = stream;
      asrModeRef.current = "wav";
      setHearing(true);
      timerRef.current = setTimeout(() => void stopHearing(), MAX_RECORD_MS);
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close().catch(() => undefined);
      contextRef.current = null;
      streamRef.current = null;
      setHearing(false);
      setHeardLevel(0);
      setVoiceNote("The microphone is blocked in this browser — allow it, or type instead.");
    }
  }, [asrProvider, busy, hearing, prime, startBrowserHearing, stopHearing]);

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
        onClick={() => {
          if (open) {
            shut();
          } else {
            setSection("chat");
            prime();
            setOpen(true);
          }
        }}
        aria-label={open ? "Close the desk assistant" : "Open the desk assistant — talk or type"}
        aria-expanded={open}
        title={open ? "Close Barry" : "Ask Barry"}
        className="focus-brand group fixed bottom-5 right-5 z-[75] grid h-14 w-14 place-items-center rounded-full bg-brand-600 p-0 text-white shadow-[0_1px_0_rgba(255,255,255,0.18)_inset,0_18px_40px_-16px_rgba(217,38,22,0.85)] transition-colors hover:bg-brand-700 sm:bottom-7 sm:right-7"
        whileHover={reduce ? undefined : { y: -2 }}
        whileTap={reduce ? undefined : { scale: 0.97 }}
      >
        <Image
          src="/logo.svg"
          width={38}
          height={38}
          alt=""
          aria-hidden="true"
          unoptimized
          className="h-[38px] w-[38px] rounded-[9px] transition-transform group-hover:scale-105"
        />
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
            aria-label="Barry — Quorum AI assistant"
            className="fixed bottom-[88px] right-3 z-[76] flex h-[min(680px,calc(100dvh-112px))] w-[min(400px,calc(100vw-24px))] flex-col overflow-hidden rounded-[24px] border border-black/[0.06] bg-white text-[#202124] shadow-[0_24px_80px_-20px_rgba(24,39,75,0.28)] dark:border-white/10 dark:bg-[#0c0d10] dark:text-ink-900 sm:right-7"
          >
            <header className="relative flex shrink-0 items-center justify-between gap-3 bg-brand-700 px-5 py-4 text-white dark:bg-brand-600">
              <div className="flex min-w-0 items-center gap-3">
                <Image
                  src="/logo.svg"
                  width={44}
                  height={44}
                  alt=""
                  aria-hidden="true"
                  unoptimized
                  className="h-11 w-11 shrink-0 rounded-[14px] border border-white/20 shadow-sm"
                />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold tracking-[-0.01em]">Quorum</p>
                  <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-white/75">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" aria-hidden="true" />
                    Barry is here to help
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    prime();
                    setSpeakOn((s) => !s);
                    stop();
                  }}
                  aria-label={speakOn ? "Mute spoken replies" : "Unmute spoken replies"}
                  title={speakOn ? "Mute replies" : "Unmute replies"}
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-full transition-colors",
                    speakOn
                      ? speaking
                        ? "bg-white/15 text-white"
                        : "text-white/80 hover:bg-white/15 hover:text-white"
                      : "text-white/60 hover:bg-white/15 hover:text-white"
                  )}
                >
                  {speakOn ? <Volume2 className="h-4 w-4" aria-hidden="true" /> : <VolumeX className="h-4 w-4" aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  onClick={shut}
                  aria-label="Close the assistant"
                  className="grid h-9 w-9 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/15 hover:text-white"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </header>

            <div
              ref={scrollerRef}
              className="relative min-h-0 flex-1 overflow-y-auto bg-[#f7f8fa] px-4 py-5 [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar]:w-1 dark:bg-[#0c0d10]"
              aria-live="polite"
            >
              {section === "chat" ? (
                <div id="barry-panel-chat" role="tabpanel" aria-labelledby="barry-tab-chat" className="space-y-5">
                  {turns.length === 0 && (
                    <div className="space-y-5">
                      <div className="flex items-start gap-2.5">
                        <Image
                          src="/logo.svg"
                          width={32}
                          height={32}
                          alt=""
                          aria-hidden="true"
                          unoptimized
                          className="mt-5 h-8 w-8 shrink-0 rounded-[10px] shadow-sm"
                        />
                        <div className="min-w-0">
                          <p className="mb-1.5 text-[11px] font-medium text-[#73777f] dark:text-ink-500">Barry · Quorum</p>
                          <div className="rounded-2xl rounded-tl-md border border-[#e8e9ec] bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(20,25,35,0.04)] dark:border-white/10 dark:bg-[#14161b]">
                            <p className="text-[14px] font-semibold leading-snug text-[#25272b] dark:text-white">
                              Hi{name ? ` ${name.split(" ")[0]}` : " there"}! How can I help?
                            </p>
                            <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#62666e] dark:text-ink-600">
                              Ask me about tenders, approvals, your committee, or the workspace.
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="pl-[42px]">
                        <p className="mb-2 text-[11px] font-medium text-[#858991] dark:text-ink-500">A few things you can ask</p>
                        <div className="space-y-2">
                          {SUGGESTIONS.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => {
                                prime();
                                void ask(s);
                              }}
                              className="group flex w-full items-center justify-between gap-3 rounded-xl border border-[#e6e8eb] bg-white px-3.5 py-3 text-left text-[12px] font-medium text-[#363a40] shadow-[0_1px_2px_rgba(20,25,35,0.03)] transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:border-white/10 dark:bg-[#14161b] dark:text-ink-700 dark:hover:border-brand-500/40 dark:hover:bg-white/[0.06]"
                            >
                              <span>{s}</span>
                              <ChevronRight className="h-4 w-4 shrink-0 text-[#9a9ea5] transition-transform group-hover:translate-x-0.5 group-hover:text-brand-700 dark:text-ink-500 dark:group-hover:text-brand-300" aria-hidden="true" />
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {turns.map((t) => (
                    <div key={t.id} className={cn("flex items-end gap-2", t.role === "user" ? "justify-end" : "justify-start")}>
                      {t.role === "assistant" && (
                        <Image
                          src="/logo.svg"
                          width={28}
                          height={28}
                          alt=""
                          aria-hidden="true"
                          unoptimized
                          className="mb-1 h-7 w-7 shrink-0 rounded-[9px] shadow-sm"
                        />
                      )}
                      <div className={cn("flex max-w-[86%] min-w-0 flex-col", t.role === "user" ? "items-end" : "items-start")}>
                        {t.role === "assistant" && <p className="mb-1.5 ml-1 text-[10.5px] font-medium text-[#73777f] dark:text-ink-500">Barry</p>}
                        <div
                          className={cn(
                            "max-w-full rounded-2xl px-3.5 py-3 shadow-[0_1px_2px_rgba(20,25,35,0.05)]",
                            t.role === "user"
                              ? "rounded-br-md bg-brand-700 text-white"
                              : "rounded-bl-md border border-[#e8e9ec] bg-white text-[#292c31] dark:border-white/10 dark:bg-[#14161b] dark:text-ink-800"
                          )}
                        >
                          {t.heard && t.heard !== t.text && (
                            <p className={cn("mb-1.5 text-[10px] leading-relaxed", t.role === "user" ? "text-white/70" : "text-[#838791] dark:text-ink-500")}>
                              Voice input · {t.heard}
                            </p>
                          )}
                          <p className="whitespace-pre-wrap text-[13px] leading-[1.55]">{t.text}</p>

                          {/* Staged actions remain explicit and consent-gated. */}
                          {t.proposal && (
                            <div className="mt-3 overflow-hidden rounded-xl border border-brand-200 bg-[#fffafa] dark:border-brand-500/30 dark:bg-[#1a1517]">
                              <div className="flex items-start justify-between gap-2 border-b border-brand-100 bg-brand-50 px-3 py-2 dark:border-brand-500/20 dark:bg-brand-500/10">
                                <span className="flex items-center gap-1.5 text-[10px] font-semibold leading-snug text-brand-900">
                                  <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  Review assignment · confirmation required
                                </span>
                                <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[8px] font-semibold text-[#6b4650] dark:bg-white/10 dark:text-brand-300">
                                  Agent task
                                </span>
                              </div>
                              <div className="p-3">
                                <p className="text-[12px] font-semibold leading-snug text-[#292c31] dark:text-white">{t.proposal.label}</p>
                                <p className="mt-1.5 text-[11px] leading-relaxed text-[#62666e] dark:text-ink-600">
                                  Quorum will analyze the tender and prepare cited findings. An authorized human keeps every final decision.
                                </p>
                                <div className="mt-2 space-y-1">
                                  {t.proposal.summary.map((row) => (
                                    <p key={row.key} className="text-[10px] leading-relaxed text-[#62666e] dark:text-ink-600">
                                      <span className="font-medium text-[#454950] dark:text-ink-700">{row.key}</span>: {row.value}
                                    </p>
                                  ))}
                                </div>
                                {t.proposalState === "pending" && (
                                  <div className="mt-3 flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => void confirmProposal(t.id, t.proposal!)}
                                      disabled={!!confirmingId}
                                      className="h-9 flex-1 rounded-full bg-brand-700 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      {confirmingId === t.id ? "Assigning…" : "Assign review"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => declineProposal(t.id)}
                                      disabled={!!confirmingId}
                                      className="h-9 rounded-full border border-[#d9dbe0] bg-white px-3 text-[11px] font-medium text-[#50545b] transition-colors hover:bg-[#f5f6f8] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-white/[0.04] dark:text-ink-700 dark:hover:bg-white/[0.08]"
                                    >
                                      Decline
                                    </button>
                                  </div>
                                )}
                                {t.proposalState === "confirmed" && <p className="mt-2 text-[11px] font-medium text-brand-800">Confirmed · running…</p>}
                                {t.proposalState === "executed" && <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-emerald-700"><Check className="h-3.5 w-3.5" aria-hidden="true" />Completed · receipt added</p>}
                                {t.proposalState === "declined" && <p className="mt-2 text-[11px] text-[#686c74] dark:text-ink-500">Declined · nothing changed</p>}
                                {t.proposalState === "failed" && <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-brand-800"><ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />Action could not be completed</p>}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

              {busy && (
                <div className="flex items-end gap-2">
                  <Image src="/logo.svg" width={28} height={28} alt="" aria-hidden="true" unoptimized className="h-7 w-7 rounded-[9px] shadow-sm" />
                  <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-[#e8e9ec] bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(20,25,35,0.05)] dark:border-white/10">
                    {[0, 1, 2].map((i) => (
                      <motion.span
                        key={i}
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full bg-brand-600"
                        animate={reduce ? undefined : { opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
                        transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
                      />
                    ))}
                    <span className="ml-1 text-[11px] text-[#747881] dark:text-ink-500">Barry is typing</span>
                  </div>
                </div>
              )}

              {voiceNote && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
                  {voiceNote}
                </p>
              )}
                </div>
              ) : null}
              {section === "support" ? (
                <section id="barry-panel-support" role="tabpanel" aria-labelledby="barry-tab-support" className="space-y-3.5">
                  <div className="rounded-[20px] bg-brand-700 p-5 text-white shadow-[0_8px_22px_rgba(130,25,20,0.16)] dark:bg-brand-600">
                    <p className="text-[11px] font-medium text-white/70">Quorum support</p>
                    <h3 className="mt-1 text-[21px] font-semibold tracking-[-0.02em]">How can we help?</h3>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-white/80">
                      Find a quick answer or start a conversation with Barry.
                    </p>
                  </div>
                  <a
                    href="/docs"
                    className="group flex items-center gap-3 rounded-2xl border border-[#e6e8eb] bg-white p-4 shadow-[0_1px_2px_rgba(20,25,35,0.04)] transition-colors hover:border-brand-300 dark:border-white/10 dark:bg-[#14161b] dark:hover:border-brand-500/40"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#f3f4f6] text-[#555b64] dark:bg-white/[0.06] dark:text-ink-600">
                      <CircleHelp className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-semibold text-[#30343a] dark:text-ink-800">Browse the Quorum guide</span>
                      <span className="mt-0.5 block text-[11px] text-[#777c84] dark:text-ink-500">Setup, tenders, approvals and more</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[#9a9ea5] transition-transform group-hover:translate-x-0.5 group-hover:text-brand-700 dark:text-ink-500 dark:group-hover:text-brand-300" aria-hidden="true" />
                  </a>
                  <button
                    type="button"
                    onClick={() => setSection("chat")}
                    className="group flex w-full items-center gap-3 rounded-2xl border border-[#e6e8eb] bg-white p-4 text-left shadow-[0_1px_2px_rgba(20,25,35,0.04)] transition-colors hover:border-brand-300 dark:border-white/10 dark:bg-[#14161b] dark:hover:border-brand-500/40"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300">
                      <MessageSquare className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-semibold text-[#30343a] dark:text-ink-800">Message Barry</span>
                      <span className="mt-0.5 block text-[11px] text-[#777c84] dark:text-ink-500">Ask about work in your Quorum workspace</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[#9a9ea5] transition-transform group-hover:translate-x-0.5 group-hover:text-brand-700 dark:text-ink-500 dark:group-hover:text-brand-300" aria-hidden="true" />
                  </button>
                  <form
                    onSubmit={(event) => void sendSupportRequest(event)}
                    className="space-y-3 rounded-2xl border border-[#e6e8eb] bg-white p-4 shadow-[0_1px_2px_rgba(20,25,35,0.04)] dark:border-white/10 dark:bg-[#14161b]"
                  >
                    <div>
                      <h4 className="text-[12px] font-semibold text-[#30343a] dark:text-ink-800">Send a manual support request</h4>
                      <p className="mt-1 text-[11px] leading-relaxed text-[#777c84] dark:text-ink-500">
                        A workspace admin will reply in this Support tab.
                      </p>
                    </div>
                    <label className="block space-y-1.5">
                      <span className="text-[10px] font-semibold text-[#50545b] dark:text-ink-600">Subject</span>
                      <input
                        value={supportSubject}
                        onChange={(event) => setSupportSubject(event.target.value)}
                        required
                        minLength={4}
                        maxLength={120}
                        placeholder="What do you need help with?"
                        className="h-10 w-full rounded-xl border border-[#e6e8eb] bg-[#f7f8fa] px-3 text-[12px] text-[#26292e] outline-none transition-colors placeholder:text-[#9a9ea5] focus:border-brand-400 focus:bg-white dark:border-white/10 dark:bg-[#0c0d10] dark:text-ink-800 dark:placeholder:text-ink-500 dark:focus:bg-[#14161b]"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-[10px] font-semibold text-[#50545b] dark:text-ink-600">Message</span>
                      <textarea
                        value={supportMessage}
                        onChange={(event) => setSupportMessage(event.target.value)}
                        required
                        minLength={12}
                        maxLength={2000}
                        rows={4}
                        placeholder="Describe what happened and what you need…"
                        className="w-full resize-y rounded-xl border border-[#e6e8eb] bg-[#f7f8fa] px-3 py-2.5 text-[12px] leading-relaxed text-[#26292e] outline-none transition-colors placeholder:text-[#9a9ea5] focus:border-brand-400 focus:bg-white dark:border-white/10 dark:bg-[#0c0d10] dark:text-ink-800 dark:placeholder:text-ink-500 dark:focus:bg-[#14161b]"
                      />
                    </label>
                    {supportError ? <p role="alert" className="text-[11px] leading-relaxed text-red-700 dark:text-red-300">{supportError}</p> : null}
                    {supportNotice ? <p role="status" className="text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-300">{supportNotice}</p> : null}
                    <button
                      type="submit"
                      disabled={supportSending || supportSubject.trim().length < 4 || supportMessage.trim().length < 12}
                      className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-full bg-brand-700 px-4 text-[11px] font-semibold text-white transition-colors hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Send className="h-3.5 w-3.5" aria-hidden="true" />
                      {supportSending ? "Sending request…" : "Send support request"}
                    </button>
                  </form>

                  <section aria-label="Your support requests" className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2 px-1">
                      <h4 className="text-[11px] font-semibold text-[#30343a] dark:text-ink-800">Your requests</h4>
                      <button
                        type="button"
                        onClick={() => void loadSupportRequests()}
                        disabled={supportLoading}
                        className="text-[10px] font-medium text-brand-800 hover:underline disabled:opacity-50 dark:text-brand-300"
                      >
                        {supportLoading ? "Refreshing…" : "Refresh"}
                      </button>
                    </div>
                    {supportRequests.length ? supportRequests.map((request) => (
                      <article key={request.id} className="rounded-2xl border border-[#e6e8eb] bg-white p-4 shadow-[0_1px_2px_rgba(20,25,35,0.04)] dark:border-white/10 dark:bg-[#14161b]">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h5 className="break-words text-[12px] font-semibold text-[#30343a] dark:text-ink-800">{request.subject}</h5>
                            <p className="mt-1 text-[9px] text-[#898e96] dark:text-ink-500">
                              {new Date(request.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                            </p>
                          </div>
                          <span className={cn(
                            "shrink-0 rounded-full px-2 py-1 text-[8px] font-bold uppercase tracking-[0.12em]",
                            request.status === "OPEN"
                              ? "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200"
                              : request.status === "RESPONDED"
                                ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200"
                                : "bg-[#f3f4f6] text-[#686c74] dark:bg-white/[0.06] dark:text-ink-500",
                          )}>{request.status === "OPEN" ? "Waiting" : request.status === "RESPONDED" ? "Replied" : "Closed"}</span>
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-[11px] leading-relaxed text-[#62666e] dark:text-ink-600">{request.message}</p>
                        {request.response ? (
                          <div className="mt-3 rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-3 py-2.5 dark:border-emerald-500/20 dark:bg-emerald-500/[0.05]">
                            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-800 dark:text-emerald-300">
                              Reply from {request.respondedBy ?? "Quorum Support"}
                            </p>
                            <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed text-[#454950] dark:text-ink-700">{request.response}</p>
                          </div>
                        ) : null}
                      </article>
                    )) : supportLoading ? (
                      <p className="rounded-xl border border-dashed border-[#dfe1e5] px-3 py-4 text-center text-[11px] text-[#777c84] dark:border-white/10 dark:text-ink-500">Loading your requests…</p>
                    ) : supportError ? (
                      <p className="rounded-xl border border-dashed border-[#dfe1e5] px-3 py-4 text-center text-[11px] text-[#777c84] dark:border-white/10 dark:text-ink-500">Sign in to see replies and manage your support requests.</p>
                    ) : (
                      <p className="rounded-xl border border-dashed border-[#dfe1e5] px-3 py-4 text-center text-[11px] text-[#777c84] dark:border-white/10 dark:text-ink-500">No requests yet. Send one above and replies will appear here.</p>
                    )}
                  </section>
                  <p className="px-1 pt-1 text-[11px] leading-relaxed text-[#777c84] dark:text-ink-500">
                    Barry can prepare actions for review. You always approve them before anything changes.
                  </p>
                </section>
              ) : null}
            </div>

            {/* Composer */}
            {section === "chat" ? <div className="relative border-t border-[#eceef0] bg-white px-3.5 py-3 dark:border-white/10">
              {/* The meter — the mic is honest about hearing you */}
              {hearing && (
                <div className="mb-2.5 flex items-center gap-2.5 rounded-xl bg-brand-50 px-3 py-2">
                  <div className="flex h-4 items-end gap-[3px]" aria-hidden="true">
                    {Array.from({ length: 12 }).map((_, i) => {
                      const seed = Math.sin(i * 1.7 + heardLevel * 9) * 0.5 + 0.5;
                      const h = 15 + (heardLevel * 85 + seed * 22) * (0.4 + 0.6 * seed);
                      return (
                        <motion.span
                          key={i}
                          className="w-[3px] rounded-full bg-brand-600"
                          animate={{ height: `${Math.min(100, h)}%` }}
                          transition={{ duration: 0.09 }}
                        />
                      );
                    })}
                  </div>
                  <span className="text-[11px] font-medium text-brand-900">
                    Listening · tap to send
                  </span>
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  prime();
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
                  title={hearing ? "Send the question" : "Tap to speak, then tap again to send"}
                  className={cn(
                    "grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    hearing
                      ? "bg-brand-700 text-white shadow-[0_0_0_3px_rgba(232,56,42,0.14)]"
                      : "bg-[#f1f2f4] text-[#656a72] hover:bg-[#e7e9ec] hover:text-[#30343a] dark:bg-white/[0.08] dark:text-ink-600 dark:hover:bg-white/[0.14] dark:hover:text-white"
                  )}
                >
                  {hearing ? <Square className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
                </button>
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={hearing ? "Listening…" : "Write a message…"}
                  disabled={hearing || busy}
                  maxLength={2000}
                  className="h-11 min-w-0 flex-1 rounded-full border border-[#e6e8eb] bg-[#f7f8fa] px-4 text-[13px] text-[#26292e] outline-none transition-colors placeholder:text-[#9a9ea5] focus:border-brand-400 focus:bg-white disabled:opacity-60 dark:border-white/10 dark:bg-[#0c0d10] dark:text-ink-800 dark:placeholder:text-ink-500 dark:focus:border-brand-400 dark:focus:bg-[#14161b]"
                />
                <button
                  type="submit"
                  disabled={busy || !draft.trim() || hearing}
                  aria-label="Send the question"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-700 text-white shadow-sm transition-colors hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                </button>
              </form>
            </div> : null}

            <nav role="tablist" aria-label="Chat and support" className="grid shrink-0 grid-cols-2 border-t border-[#eceef0] bg-white px-5 py-1.5 dark:border-white/10">
              {([
                { id: "chat", label: "Chat", Icon: MessageSquare },
                { id: "support", label: "Support", Icon: CircleHelp },
              ] as const).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`barry-tab-${id}`}
                  aria-selected={section === id}
                  aria-controls={`barry-panel-${id}`}
                  onClick={() => setSection(id)}
                  className={cn(
                    "flex h-[52px] flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium transition-colors",
                    section === id ? "text-brand-800" : "text-[#898e96] hover:bg-[#f7f8fa] hover:text-[#464a51] dark:text-ink-500 dark:hover:bg-white/[0.06] dark:hover:text-ink-700",
                  )}
                >
                  <Icon className={cn("h-[18px] w-[18px]", section === id && "fill-brand-100")} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>

    </>
  );
}
