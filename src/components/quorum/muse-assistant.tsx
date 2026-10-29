"use client";

/**
 * MuseAssistant — the agentic voice chat bubble that sits on every screen.
 *
 * One floating button, bottom right, over the landing page, the workspace
 * and the docs alike. Press it and you get a panel you can either talk into
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
 *     register, one tender's record) execute at once, and actions — approve
 *     or return a gate, launch a review — come back as HMAC-signed proposal
 *     cards. A full LLM brain answers whenever a model is reachable (Meta
 *     key or the platform's own served model), with a deterministic local
 *     brain as the last resort — the panel never shows a setup notice.
 *   · acting   — a proposal card waits for the officer. Confirm stages it
 *     through /api/muse/execute under their own session; a gate decision
 *     opens the same step-up dialog the Approvals screen uses before the
 *     sidecar executes anything. Decline voids the card — nothing moves.
 *   · speaking — the reply is read aloud in a real neural voice. Deepgram
 *     Aura-2 runs through Cloudflare Workers AI; MeloTTS is the server-side
 *     fallback; the browser's installed voice is the last resort. The voice
 *     can be changed in the panel and is remembered on the device.
 *
 * The agent is consent-gated, not read-only: it can carry the gavel to the
 * desk, but it can only lift it when the officer's own hand is on the handle.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Ban, Check, Mic, Send, ShieldAlert, Sparkles, Square, Volume2, VolumeX, X } from "lucide-react";
import { requestStepUp, StepUpHost } from "@/components/quorum/step-up";
import type { Proposal } from "@/lib/muse-actions";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;

type ProposalState = "pending" | "confirmed" | "declined" | "executed" | "failed";
type Turn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  heard?: string;
  tools?: string[];
  model?: string;
  proposal?: Proposal;
  proposalState?: ProposalState;
};

const SUGGESTIONS = [
  "What is waiting at the gate?",
  "Is quorum present?",
  "Approve the pending gate",
  "Launch a review for a tender",
];

const VOICE_KEY = "quorum.muse.voice";

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

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
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
          model?: string;
          proposal?: Proposal;
        };
        const reply = (data.reply ?? "I could not answer that just now.").trim();
        setTurns((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            text: reply,
            ...(data.toolsRead && data.toolsRead.length ? { tools: data.toolsRead } : {}),
            ...(data.model ? { model: data.model } : {}),
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
        /* The gavel is personal: actions run under the signed-in officer. */
        const me = await fetch("/api/auth/me")
          .then((r) => r.json())
          .catch(() => null);
        if (!me?.user) {
          patchTurn(turnId, { proposalState: "pending" });
          say("You are not signed in — the agent's actions run under a named officer, never anonymously. Sign in to the workspace and ask me again.");
          void speak("Sign in first. The gavel is personal.");
          return;
        }

        /* A gate decision demands the officer's own step-up signature — the
           same dialog the Approvals screen opens, hosted by this bubble. */
        let stepUp: string | undefined;
        if (proposal.needsStepUp) {
          const token = await requestStepUp(String(proposal.args?.gateId ?? ""));
          if (!token) {
            patchTurn(turnId, { proposalState: "pending" });
            say("The step-up signature was cancelled — nothing was signed, nothing changed. The card stays open if you want it back.");
            void speak("Signature cancelled. Nothing changed.");
            return;
          }
          stepUp = token;
        }

        const res = await fetch("/api/muse/execute", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ proposal, consent: true, ...(stepUp ? { stepUp } : {}) }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          executed?: boolean;
          headline?: string;
          detail?: string[];
          tool?: string;
          needsStepUp?: boolean;
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
              tools: data.tool ? [data.tool] : undefined,
            },
          ]);
          void speak(data.headline ?? "Done.");
        } else if (data.needsStepUp) {
          patchTurn(turnId, { proposalState: "pending" });
          say(`${data.error ?? "The step-up signature was refused."} Confirm the card again when ready — nothing changed.`);
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
            prime();
            setOpen(true);
          }
        }}
        aria-label={open ? "Close the desk assistant" : "Open the desk assistant — talk or type"}
        aria-expanded={open}
        title={open ? "Close the desk assistant" : "Ask the desk"}
        className="focus-brand group fixed bottom-5 right-5 z-[75] grid h-14 w-14 place-items-center rounded-full bg-brand-600 p-0 text-white shadow-[0_1px_0_rgba(255,255,255,0.18)_inset,0_18px_40px_-16px_rgba(217,38,22,0.85)] transition-colors hover:bg-brand-700 sm:bottom-7 sm:right-7"
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
                  Reads the desk · acts on your consent · signs only with you
                </p>
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
                    "grid h-8 w-8 place-items-center rounded-lg transition-colors",
                    speakOn
                      ? speaking
                        ? "text-brand-300 hover:bg-white/10 hover:text-white"
                        : "text-ink-300 hover:bg-white/10 hover:text-white"
                      : "text-ink-500 hover:bg-white/10 hover:text-white"
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
                    This is the desk agent — it reads the live record (evaluations, approvals, quorum, statutory clocks,
                    audit, suppliers, one tender&apos;s file) and it can act: approve or return a file at the gate, launch a
                    review on a tender. Nothing moves on its word alone — every action lands as a confirmation card, and a
                    gate decision still wants your step-up signature. Answers are read aloud in a real neural voice.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          prime();
                          void ask(s);
                        }}
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

                    {/* The consent card — an action the agent staged, waiting
                        for the officer's hand. Nothing runs without it. */}
                    {t.proposal && (
                      <div className="mt-2.5 overflow-hidden rounded-lg border border-brand-500/40 bg-black/30">
                        <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-brand-500/10 px-2.5 py-1.5">
                          <span className="flex items-center gap-1.5 font-code text-[7.5px] font-bold tracking-[0.16em] text-brand-200">
                            <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                            {t.proposal.needsStepUp ? "GATE DECISION · NEEDS YOUR SIGNATURE" : "DESK ACTION · NEEDS YOUR CONSENT"}
                          </span>
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 font-code text-[6.5px] font-bold tracking-[0.14em]",
                              t.proposal.risk === "IRREVERSIBLE" ? "bg-brand-600 text-white" : "bg-white/10 text-ink-200"
                            )}
                          >
                            {t.proposal.risk}
                          </span>
                        </div>
                        <div className="px-2.5 py-2">
                          <p className="text-[12px] font-semibold leading-snug text-ink-100">{t.proposal.label}</p>
                          <div className="mt-1.5 space-y-0.5">
                            {t.proposal.summary.map((row) => (
                              <p key={row.key} className="font-code text-[7.5px] leading-relaxed tracking-[0.1em] text-ink-300">
                                <span className="text-ink-500">{row.key}</span> · {row.value}
                              </p>
                            ))}
                          </div>
                          {t.proposalState === "pending" && (
                            <div className="mt-2.5 flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => void confirmProposal(t.id, t.proposal!)}
                                disabled={!!confirmingId}
                                className="h-7 flex-1 rounded-md bg-brand-600 px-2 font-code text-[8px] font-bold tracking-[0.12em] text-white transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {confirmingId === t.id ? "CONFIRMING…" : t.proposal.needsStepUp ? "CONFIRM & SIGN" : "CONFIRM & RUN"}
                              </button>
                              <button
                                type="button"
                                onClick={() => declineProposal(t.id)}
                                disabled={!!confirmingId}
                                className="h-7 rounded-md border border-white/15 px-2.5 font-code text-[8px] font-bold tracking-[0.12em] text-ink-300 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                DECLINE
                              </button>
                            </div>
                          )}
                          {t.proposalState === "confirmed" && (
                            <p className="mt-2 font-code text-[7.5px] font-bold tracking-[0.14em] text-brand-200">
                              CONFIRMED · RUNNING…
                            </p>
                          )}
                          {t.proposalState === "executed" && (
                            <p className="mt-2 flex items-center gap-1 font-code text-[7.5px] font-bold tracking-[0.14em] text-emerald-300">
                              <Check className="h-3 w-3" aria-hidden="true" /> EXECUTED · RECEIPT ON THE RECORD
                            </p>
                          )}
                          {t.proposalState === "declined" && (
                            <p className="mt-2 flex items-center gap-1 font-code text-[7.5px] font-bold tracking-[0.14em] text-ink-400">
                              <Ban className="h-3 w-3" aria-hidden="true" /> DECLINED · NOTHING MOVED
                            </p>
                          )}
                          {t.proposalState === "failed" && (
                            <p className="mt-2 flex items-center gap-1 font-code text-[7.5px] font-bold tracking-[0.14em] text-brand-300">
                              <ShieldAlert className="h-3 w-3" aria-hidden="true" /> REFUSED · NOTHING MOVED
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {(t.tools?.length || t.model) && (
                      <p className="mt-2 flex flex-wrap items-center gap-1 font-code text-[7px] tracking-[0.14em] text-ink-400">
                        {t.tools && t.tools.length > 0 && <>DESK:
                          {t.tools.map((tool, i) => (
                            <span key={`${tool}-${i}`} className="rounded bg-white/[0.07] px-1.5 py-0.5 text-ink-300">
                              {tool.toUpperCase()}
                            </span>
                          ))}
                        </>}
                        {t.model && (
                          <span className="rounded bg-brand-500/15 px-1.5 py-0.5 text-brand-300">
                            MODEL · {t.model.toUpperCase()}
                          </span>
                        )}
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
                    LISTENING · TAP TO SEND
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The step-up host rides with the bubble: a gate decision staged in
          chat opens the same signature dialog the Approvals screen uses,
          on any screen. The dashboard's own host stays underneath it. */}
      {open && <StepUpHost />}
    </>
  );
}
