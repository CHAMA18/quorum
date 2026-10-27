"use client";

/**
 * The Film — REEL 01, "The Twenty-Minute Tender".
 *
 * Five chapters, every frame model-generated (CogVideoX-3, open weights),
 * sequenced by a custom cinema player: title cards, chapter ticks, a master
 * clock pinned to ~02:00, 2.39:1 letterbox, grain, and a silent cut.
 * No embeds, no third-party player — the reel is ours end to end.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Maximize,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Volume,
} from "lucide-react";
import { cn } from "@/lib/utils";

const RATE = 0.8; // deliberate, cinematic pacing
const INTRO_MS = 7000;
const CARD_MS = 4200;
const OUTRO_MS = 10000;
const NOMINAL_CLIP_MS = 12500; // 10s clip @0.8× — replaced by real metadata

interface Chapter {
  id: number;
  title: string;
  kicker: string;
  line: string;
  src: string;
}

const CHAPTERS: Chapter[] = [
  {
    id: 1,
    title: "The Stack",
    kicker: "CHAPTER 01 — 14,000 PAGES",
    line: "Every page is someone's money. Nobody can read them all.",
    src: "/film/chapter-1.mp4",
  },
  {
    id: 2,
    title: "The Read",
    kicker: "CHAPTER 02 — 06:00 LOCAL",
    line: "The machine has been in the files since before the office wakes.",
    src: "/film/chapter-2.mp4",
  },
  {
    id: 3,
    title: "The Evidence",
    kicker: "CHAPTER 03 — PAGE AND LINE",
    line: "Every claim wired to its source. No citation, no finding.",
    src: "/film/chapter-3.mp4",
  },
  {
    id: 4,
    title: "The Flag",
    kicker: "CHAPTER 04 — THE PATTERN BREAKS",
    line: "Where a price breaks the peer pattern, a flag goes up.",
    src: "/film/chapter-4.mp4",
  },
  {
    id: 5,
    title: "The Gate",
    kicker: "CHAPTER 05 — THE HUMAN SIGNATURE",
    line: "One button the machine cannot press — the committee signs, the machine never does.",
    src: "/film/chapter-5.mp4",
  },
];

type Phase =
  | { kind: "poster" }
  | { kind: "intro" }
  | { kind: "card"; chapter: number }
  | { kind: "clip"; chapter: number }
  | { kind: "outro" };

/* flat timeline segments — the master clock walks this */
type Segment =
  | { type: "intro"; ms: number }
  | { type: "card"; chapter: number; ms: number }
  | { type: "clip"; chapter: number; ms: number }
  | { type: "outro"; ms: number };

function fmt(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function Film() {
  const reduce = useReducedMotion();
  const [started, setStarted] = useState(false); /* false = poster state */
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [durations, setDurations] = useState<Record<number, number>>({});
  const [offline, setOffline] = useState<Record<number, boolean>>({});
  const [posterSrc, setPosterSrc] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const segStart = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastClip = useRef<number>(-1);

  /* ── timeline ─────────────────────────────────────────────────────────── */
  const segments = useMemo<Segment[]>(() => {
    const segs: Segment[] = [{ type: "intro", ms: INTRO_MS }];
    for (const c of CHAPTERS) {
      segs.push({ type: "card", chapter: c.id, ms: CARD_MS });
      segs.push({ type: "clip", chapter: c.id, ms: durations[c.id] ?? NOMINAL_CLIP_MS });
    }
    segs.push({ type: "outro", ms: OUTRO_MS });
    return segs;
  }, [durations]);

  const total = useMemo(() => segments.reduce((a, s) => a + s.ms, 0), [segments]);

  const segElapsedBefore = useCallback(
    (idx: number) => segments.slice(0, idx).reduce((a, s) => a + s.ms, 0),
    [segments]
  );

  const currentSegIdx = useMemo(() => {
    let acc = 0;
    for (let i = 0; i < segments.length; i++) {
      acc += segments[i].ms;
      if (elapsed < acc) return i;
    }
    return segments.length - 1;
  }, [elapsed, segments]);

  /* nominal phase — derived from the master clock, never stored */
  const phase: Phase = useMemo(() => {
    if (!started) return { kind: "poster" };
    const seg = segments[currentSegIdx];
    if (!seg) return { kind: "outro" };
    if (seg.type === "intro") return { kind: "intro" };
    if (seg.type === "card") return { kind: "card", chapter: seg.chapter };
    if (seg.type === "clip") return { kind: "clip", chapter: seg.chapter };
    return { kind: "outro" };
  }, [currentSegIdx, segments, started]);

  /* ── master clock ─────────────────────────────────────────────────────── */
  const stopClock = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const finish = useCallback(() => {
    stopClock();
    setPlaying(false);
    setStarted(false);
    setElapsed(total);
    const v = videoRef.current;
    if (v) v.pause();
  }, [stopClock, total]);

  const tickRef = useRef<(idx: number, startedAt: number) => void>(() => undefined);
  const tick = useCallback(
    (idx: number, startedAt: number) => {
      rafRef.current = requestAnimationFrame(() => {
        const seg = segments[idx];
        if (!seg) return finish();
        let inSeg = performance.now() - startedAt;
        if (seg.type === "clip") {
          const v = videoRef.current;
          const dur = durations[seg.chapter] ?? NOMINAL_CLIP_MS;
          inSeg = v && !v.paused ? Math.min(dur, (v.currentTime * 1000) / RATE) : Math.min(dur, inSeg);
        }
        setElapsed(segElapsedBefore(idx) + Math.min(inSeg, seg.ms));
        if (inSeg >= seg.ms) {
          if (idx + 1 >= segments.length) return finish();
          segStart.current = performance.now();
          tickRef.current(idx + 1, segStart.current);
          return;
        }
        tickRef.current(idx, startedAt);
      });
    },
    [durations, finish, segElapsedBefore, segments]
  );

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const startAt = useCallback(
    (idx: number) => {
      stopClock();
      setElapsed(segElapsedBefore(idx));
      segStart.current = performance.now();
      setPlaying(true);
      tick(idx, segStart.current);
    },
    [segElapsedBefore, stopClock, tick]
  );

  /* ── playback control of the <video> for clip segments ────────────────── */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const seg = segments[currentSegIdx];
    if (phase.kind !== "poster" && seg?.type === "clip") {
      const ch = CHAPTERS.find((c) => c.id === seg.chapter);
      if (ch) {
        if (lastClip.current !== ch.id) {
          if (!v.src.endsWith(ch.src)) v.src = ch.src;
          try {
            v.currentTime = 0;
          } catch {
            /* metadata not ready — timeupdate will settle it */
          }
          lastClip.current = ch.id;
        }
        v.playbackRate = reduce ? 1 : RATE;
        if (playing) {
          v.play().catch(() => {
            /* autoplay guard — the clock keeps the film alive regardless */
          });
        } else v.pause();
      }
    } else {
      v.pause();
    }
     
  }, [currentSegIdx, phase.kind, playing]);

  /* chapter timers for card/intro/outro are handled by the master clock */

  const pause = useCallback(() => {
    stopClock();
    setPlaying(false);
  }, [stopClock]);

  const toggle = useCallback(() => {
    if (!started) {
      setStarted(true);
      startAt(0);
    } else if (playing) {
      pause();
    } else {
      /* resume from the exact point inside the current segment */
      const inSeg = elapsed - segElapsedBefore(currentSegIdx);
      segStart.current = performance.now() - inSeg;
      setPlaying(true);
      tick(currentSegIdx, segStart.current);
    }
  }, [currentSegIdx, elapsed, pause, playing, segElapsedBefore, startAt, started, tick]);

  const jumpChapter = useCallback(
    (chapterId: number) => {
      const idx = segments.findIndex((s) => "chapter" in s && s.chapter === chapterId);
      if (idx >= 0) {
        setStarted(true);
        startAt(idx);
      }
    },
    [segments, startAt]
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      const cards = segments.map((s, i) => ({ s, i })).filter(({ s }) => s.type === "card");
      if (!cards.length) return;
      const firstAtOrAfter = cards.findIndex(({ i }) => i >= currentSegIdx);
      const onCard = firstAtOrAfter >= 0 && cards[firstAtOrAfter].i === currentSegIdx;
      let targetIdx: number;
      if (dir === 1) {
        if (firstAtOrAfter === -1) return; /* in the outro — nowhere forward */
        targetIdx = firstAtOrAfter + (onCard ? 1 : 0);
        if (targetIdx >= cards.length) return;
      } else {
        targetIdx =
          firstAtOrAfter === -1
            ? cards.length - 1
            : Math.max(0, firstAtOrAfter - (onCard ? 1 : 0));
      }
      const seg = cards[targetIdx].s;
      if (seg.type === "card") {
        setStarted(true);
        startAt(cards[targetIdx].i);
      }
    },
    [currentSegIdx, segments, startAt]
  );

  const replay = useCallback(() => {
    setStarted(true);
    startAt(0);
  }, [startAt]);

  const fullscreen = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }, []);

  /* keyboard */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const stage = stageRef.current;
      if (!stage) return;
      const inView = stage.getBoundingClientRect().bottom > 80;
      if (!inView) return;
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.code === "ArrowRight") {
        const next = CHAPTERS.find((c) => segElapsedBefore(currentSegIdx) < segStartOffsetFor(c.id));
        if (next) jumpChapter(next.id);
      } else if (e.code === "ArrowLeft") {
        const prev = [...CHAPTERS].reverse().find((c) => segStartOffsetFor(c.id) < segElapsedBefore(currentSegIdx) - 500);
        if (prev) jumpChapter(prev.id);
      }
    };
    const segStartOffsetFor = (chapterId: number) => {
      const idx = segments.findIndex((s) => s.type === "card" && s.chapter === chapterId);
      return idx >= 0 ? segElapsedBefore(idx) : Number.MAX_SAFE_INTEGER;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
     
  }, [currentSegIdx, jumpChapter, segElapsedBefore, segments, toggle]);

  /* poster frame — grab the true first frame of chapter one */
  useEffect(() => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "metadata";
    v.src = CHAPTERS[0].src;
    const capture = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 960;
        canvas.height = Math.round(960 / 2.39);
        canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
        setPosterSrc(canvas.toDataURL("image/jpeg", 0.82));
      } catch {
        /* designed poster remains */
      }
    };
    v.addEventListener("loadeddata", capture, { once: true });
    v.addEventListener("error", () => setOffline((p) => ({ ...p, 1: true })), { once: true });
    return () => {
      v.removeEventListener("loadeddata", capture);
      v.src = "";
    };
  }, []);

  /* probe real durations for the master clock */
  useEffect(() => {
    CHAPTERS.forEach((c) => {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.src = c.src;
      v.addEventListener(
        "loadedmetadata",
        () => {
          if (Number.isFinite(v.duration) && v.duration > 0) {
            setDurations((p) => ({ ...p, [c.id]: (v.duration * 1000) / RATE }));
          }
        },
        { once: true }
      );
      v.addEventListener("error", () => setOffline((p) => ({ ...p, [c.id]: true })), { once: true });
    });
  }, []);

  useEffect(() => stopClock, [stopClock]);

  const activeChapter =
    phase.kind === "card" || phase.kind === "clip"
      ? CHAPTERS.find((c) => c.id === phase.chapter)
      : undefined;
  const showStage = phase.kind !== "poster";
  const progressPct = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;

  return (
    <section id="film" aria-label="The Quorum film" className="relative overflow-hidden bg-night text-white">
      <div className="bg-grid-dark pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/60 to-transparent"
        aria-hidden="true"
      />

      <div className="relative mx-auto w-full max-w-[1200px] px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
        {/* header */}
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <p className="flex items-center gap-2.5 font-code text-[11px] font-semibold uppercase tracking-[0.28em] text-ink-300">
              <span className="inline-block h-[2px] w-6 bg-brand-500" aria-hidden="true" />
              Reel 01 — Generated cinema
            </p>
            <h2 className="mt-4 max-w-3xl font-display text-[36px] font-black leading-[1.02] tracking-[-0.025em] sm:text-[56px]">
              THE TWENTY-MINUTE
              <br />
              TENDER<span className="text-brand-500">.</span>
            </h2>
            <p className="mt-4 max-w-xl text-[14.5px] leading-relaxed text-ink-300">
              A two-minute film in six chapters — every frame generated by an open-weights model, cut to the same
              visual system as the product. The story of a run: the stack, the read, the evidence, the flag, the
              gate, the award.
            </p>
          </div>
          <dl className="grid shrink-0 grid-cols-2 gap-x-8 gap-y-3 font-code text-[9.5px] tracking-[0.2em] text-ink-400 sm:grid-cols-1">
            {[
              ["RUNTIME", `≈ ${fmt(total)}`],
              ["ASPECT", "2.39 : 1"],
              ["SOUND", "SILENT CUT"],
              ["MODEL", "OPEN WEIGHTS"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-3 sm:justify-end">
                <dt className="text-ink-500">{k}</dt>
                <dd className="text-[11px] font-bold text-white">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* stage */}
        <div
          ref={stageRef}
          className="relative mt-10 overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_40px_120px_rgba(0,0,0,0.6)]"
        >
          <div className="relative aspect-[2.39/1] w-full">
            {/* designed poster — always the bedrock layer */}
            <div className="absolute inset-0" aria-hidden={showStage}>
              <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_50%_10%,#1a1c22_0%,#0c0d10_55%,#050506_100%)]" />
              <div className="absolute inset-0 opacity-[0.16] [background-image:repeating-linear-gradient(0deg,transparent_0_2px,rgba(255,255,255,0.35)_2px_3px)]" />
              <div className="absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <p className="font-code text-[10px] tracking-[0.4em] text-ink-400">QUORUM ORIGINALS</p>
                  <p className="mt-3 font-display text-[clamp(28px,6vw,72px)] font-black leading-none tracking-tight text-white">
                    THE TWENTY-MINUTE
                    <br />
                    TENDER<span className="text-brand-500">.</span>
                  </p>
                  <p className="mt-4 font-code text-[10px] tracking-[0.3em] text-ink-400">
                    A FILM IN SIX CHAPTERS · SHOT ENTIRELY BY MODELS
                  </p>
                </div>
              </div>
            </div>

            {/* true captured poster frame */}
            {posterSrc && !showStage && (
              <img
                src={posterSrc}
                alt="First frame of the film — a records archive lit by a single shaft of light"
                className="absolute inset-0 h-full w-full object-cover opacity-90"
              />
            )}

            {/* the reel */}
            {showStage && (
              <>
                <video
                  ref={videoRef}
                  className={cn(
                    "absolute inset-0 h-full w-full object-cover transition-opacity duration-500",
                    phase.kind === "clip" && !offline[phase.chapter] ? "opacity-100" : "opacity-0"
                  )}
                  muted
                  playsInline
                  preload="auto"
                  aria-label="Film footage"
                  onError={() => {
                    const ch = activeChapter?.id;
                    if (ch) setOffline((p) => ({ ...p, [ch]: true }));
                  }}
                />

                {/* offline chapter interlude — designed, still on the clock */}
                {phase.kind === "clip" && offline[phase.chapter] && (
                  <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(120%_120%_at_50%_20%,#191b21_0%,#0a0b0e_70%)]">
                    <div className="text-center">
                      <p className="font-code text-[10px] tracking-[0.4em] text-brand-500">REEL CHANGE — CHAPTER OFFLINE</p>
                      <p className="mt-3 font-display text-[clamp(24px,4.5vw,54px)] font-black tracking-tight">
                        {activeChapter?.title.toUpperCase()}
                      </p>
                      <p className="mt-3 max-w-md px-6 font-code text-[10.5px] leading-relaxed tracking-[0.14em] text-ink-400">
                        {activeChapter?.line.toUpperCase()}
                      </p>
                    </div>
                  </div>
                )}

                {/* title cards */}
                <AnimatePresence mode="wait">
                  {phase.kind === "intro" && (
                    <motion.div
                      key="intro"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, transition: { duration: 0.5 } }}
                      className="absolute inset-0 grid place-items-center bg-black"
                    >
                      <div className="px-8 text-center">
                        <motion.p
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.4, duration: 0.8 }}
                          className="font-code text-[10px] tracking-[0.5em] text-brand-500"
                        >
                          QUORUM ORIGINALS PRESENTS
                        </motion.p>
                        <motion.p
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 1.1, duration: 0.9 }}
                          className="mt-5 font-display text-[clamp(30px,6.5vw,84px)] font-black leading-[0.98] tracking-[-0.02em]"
                        >
                          THE TWENTY-MINUTE
                          <br />
                          TENDER<span className="text-brand-500">.</span>
                        </motion.p>
                        <motion.p
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 2.4, duration: 1 }}
                          className="mt-6 font-code text-[10px] tracking-[0.34em] text-ink-400"
                        >
                          SHOT ENTIRELY BY MODELS · SILENT CUT · 2.39 : 1
                        </motion.p>
                      </div>
                    </motion.div>
                  )}

                  {phase.kind === "card" && (
                    <motion.div
                      key={`card-${phase.chapter}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, transition: { duration: 0.4 } }}
                      transition={{ duration: 0.7 }}
                      className="absolute inset-0 grid place-items-center bg-black"
                    >
                      <div className="px-8 text-center">
                        <p className="font-code text-[10px] tracking-[0.44em] text-brand-500">
                          {activeChapter?.kicker}
                        </p>
                        <p className="mt-4 font-display text-[clamp(34px,7vw,92px)] font-black leading-none tracking-[-0.02em]">
                          {activeChapter?.title.toUpperCase()}
                        </p>
                        <p className="mx-auto mt-5 max-w-xl text-[13px] leading-relaxed text-ink-300 sm:text-[15px]">
                          {activeChapter?.line}
                        </p>
                      </div>
                    </motion.div>
                  )}

                  {phase.kind === "outro" && (
                    <motion.div
                      key="outro"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.9 }}
                      className="absolute inset-0 grid place-items-center bg-black"
                    >
                      <div className="px-8 text-center">
                        <p className="font-code text-[10px] tracking-[0.4em] text-ink-400">END OF REEL 01</p>
                        <p className="mx-auto mt-5 max-w-2xl font-display text-[clamp(26px,4.6vw,58px)] font-black leading-[1.02] tracking-[-0.02em]">
                          YOUR NEXT TENDER IS A
                          <br />
                          TWENTY-MINUTE STORY<span className="text-brand-500">.</span>
                        </p>
                        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                          <a
                            href="#get-started"
                            className="inline-flex h-12 items-center rounded-xl bg-brand-600 px-6 text-[14px] font-semibold text-white shadow-[0_12px_32px_rgba(217,38,22,0.4)] transition-all hover:bg-brand-700"
                          >
                            START YOUR FIRST RUN
                          </a>
                          <button
                            type="button"
                            onClick={replay}
                            className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/25 px-6 text-[14px] font-semibold text-white transition-colors hover:bg-white/10"
                          >
                            <RotateCcw className="h-4 w-4" aria-hidden="true" />
                            WATCH AGAIN
                          </button>
                        </div>
                        <p className="mt-8 font-code text-[9px] tracking-[0.3em] text-ink-500">
                          FRAMES · COGVIDEOX, OPEN WEIGHTS · CUT &amp; TYPE · QUORUM STUDIO
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}

            {/* grain + vignette */}
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.10] mix-blend-overlay"
              style={{
                backgroundImage:
                  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")",
              }}
              aria-hidden="true"
            />
            <div
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(115%_115%_at_50%_45%,transparent_62%,rgba(0,0,0,0.5)_100%)]"
              aria-hidden="true"
            />

            {/* poster play button */}
            {phase.kind === "poster" && (
              <div className="absolute inset-0 grid place-items-center">
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={toggle}
                    aria-label="Play the film"
                    className="group relative grid h-20 w-20 place-items-center rounded-full bg-brand-600 shadow-[0_16px_48px_rgba(217,38,22,0.45)] transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-400 sm:h-24 sm:w-24"
                  >
                    <span
                      className="absolute inset-0 animate-ping-slow rounded-full bg-brand-600/40"
                      aria-hidden="true"
                    />
                    <Play className="relative ml-1 h-8 w-8 text-white" aria-hidden="true" />
                  </button>
                  <p className="mt-5 font-code text-[10px] tracking-[0.34em] text-ink-300">
                    PLAY THE FILM · ≈ {fmt(total)}
                  </p>
                </div>
              </div>
            )}

            {/* now screening */}
            {showStage && (
              <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 backdrop-blur-sm sm:left-5 sm:top-5">
                <span className="relative flex h-1.5 w-1.5">
                  <span
                    className={cn("absolute inline-flex h-full w-full rounded-full", playing ? "animate-ping-slow bg-brand-500" : "bg-ink-400")}
                    aria-hidden="true"
                  />
                  <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", playing ? "bg-brand-500" : "bg-ink-300")} aria-hidden="true" />
                </span>
                <span className="font-code text-[9px] font-bold tracking-[0.24em] text-white">
                  {playing ? "NOW SCREENING" : "PAUSED"} · CH {String(activeChapter?.id ?? 0).padStart(2, "0")}
                </span>
              </div>
            )}
          </div>

          {/* control bar */}
          <div className="border-t border-white/10 bg-black/85 backdrop-blur">
            {/* progress with chapter ticks */}
            <div className="relative h-10">
              <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 bg-white/15" aria-hidden="true">
                <div
                  className="h-full bg-brand-500 transition-[width] duration-150 ease-linear"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              {CHAPTERS.map((c) => {
                const idx = segments.findIndex((s) => s.type === "card" && s.chapter === c.id);
                if (idx < 0) return null;
                const left = (segElapsedBefore(idx) / total) * 100;
                const active = activeChapter?.id === c.id && showStage;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => jumpChapter(c.id)}
                    aria-label={`Jump to chapter ${c.id} — ${c.title}`}
                    className="group absolute top-1/2 h-10 w-6 -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${left}%` }}
                  >
                    <span
                      className={cn(
                        "absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border transition-colors",
                        active ? "border-brand-400 bg-brand-500" : "border-white/50 bg-black group-hover:bg-white/70"
                      )}
                    />
                    <span
                      className={cn(
                        "absolute -top-4 left-1/2 -translate-x-1/2 font-code text-[8px] tracking-[0.1em] transition-opacity",
                        active ? "text-brand-400 opacity-100" : "text-ink-400 opacity-0 group-hover:opacity-100"
                      )}
                    >
                      {String(c.id).padStart(2, "0")}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-1.5 px-3 pb-3 sm:gap-2.5 sm:px-4">
              <button
                type="button"
                onClick={toggle}
                aria-label={playing ? "Pause" : "Play"}
                className="grid h-11 w-11 place-items-center rounded-full text-white transition-colors hover:bg-white/10"
              >
                {playing ? <Pause className="h-5 w-5" aria-hidden="true" /> : <Play className="ml-0.5 h-5 w-5" aria-hidden="true" />}
              </button>
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous chapter"
                className="grid h-11 w-11 place-items-center rounded-full text-white transition-colors hover:bg-white/10"
              >
                <SkipBack className="h-4.5 w-4.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next chapter"
                className="grid h-11 w-11 place-items-center rounded-full text-white transition-colors hover:bg-white/10"
              >
                <SkipForward className="h-4.5 w-4.5" aria-hidden="true" />
              </button>
              <span className="ml-1.5 font-code text-[10.5px] tabular-nums tracking-[0.14em] text-ink-300">
                {fmt(elapsed)} <span className="text-ink-500">/ ≈ {fmt(total)}</span>
              </span>
              <span className="ml-auto hidden font-code text-[9px] tracking-[0.22em] text-ink-500 md:block">
                SILENT CUT — THE DATA SPEAKS
              </span>
              <span className="hidden items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1 font-code text-[8.5px] tracking-[0.18em] text-ink-300 sm:inline-flex">
                <Volume className="h-3 w-3" aria-hidden="true" />
                MUTED
              </span>
              <button
                type="button"
                onClick={fullscreen}
                aria-label="Fullscreen"
                className="grid h-11 w-11 place-items-center rounded-full text-white transition-colors hover:bg-white/10"
              >
                <Maximize className="h-4.5 w-4.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        {/* chapter index */}
        <ol className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {CHAPTERS.map((c, ci) => (
            <motion.li
              key={c.id}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: 0.07 * ci, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            >
              <button
                type="button"
                onClick={() => jumpChapter(c.id)}
                className={cn(
                  "group w-full rounded-xl border px-3.5 py-3 text-left transition-all duration-300 hover:-translate-y-0.5",
                  activeChapter?.id === c.id && showStage
                    ? "border-brand-500/70 bg-brand-600/10"
                    : "border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.07]"
                )}
              >
                <span className="font-code text-[9px] tracking-[0.22em] text-ink-400">CH {String(c.id).padStart(2, "0")}</span>
                <span className="mt-1 block font-display text-[13px] font-black tracking-tight text-white">
                  {c.title.toUpperCase()}
                </span>
              </button>
            </motion.li>
          ))}
        </ol>

        <p className="mt-6 text-center font-code text-[8.5px] tracking-[0.26em] text-ink-500">
          EVERY FRAME MODEL-GENERATED · NO CAMERA, NO CREW, NO STOCK · CUT IN THE OPEN
        </p>
      </div>
    </section>
  );
}
