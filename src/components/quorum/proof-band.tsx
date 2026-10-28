"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { Reveal, SpecBar } from "@/components/quorum/reveal";
import { WordReveal } from "@/components/quorum/motion-kit";

interface LiveRun {
  tenderId: string;
  findings: unknown[];
  drafts: unknown[];
}

interface LiveTotals {
  tenders: number;
  findings: number;
  drafts: number;
  runs: number;
}

const EMPTY: LiveTotals = { tenders: 0, findings: 0, drafts: 0, runs: 0 };

function CountUp({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(0);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Arm the animation when the counter first scrolls into view.
  useEffect(() => {
    const el = ref.current;
    if (!el || started) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || started) return;
        io.disconnect();
        setStarted(true);
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [started]);

  // One eased count-up, cancelled cleanly; the final value is derived at render time
  // (`done`), so later live-data changes show up without touching state in an effect.
  useEffect(() => {
    if (!started || reduce || done) return;
    const t0 = performance.now();
    const DURATION = 1400;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / DURATION);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(value * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setDone(true);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, reduce, value, done]);

  const shown = !started ? 0 : done ? value : display;
  return <span ref={ref}>{Math.round(shown).toLocaleString("en-US")}</span>;
}

/**
 * Proof band — counters computed from the runs on the quorum-mcp sidecar.
 * Shows zero until a run exists; nothing is invented.
 */
export function ProofBand() {
  const [totals, setTotals] = useState<LiveTotals>(EMPTY);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/runs?XTransformPort=3031");
        const json = (await res.json()) as { runs?: LiveRun[] };
        if (!alive) return;
        const runs = json.runs ?? [];
        setTotals({
          tenders: new Set(runs.map((r) => r.tenderId)).size,
          findings: runs.reduce((n, r) => n + r.findings.length, 0),
          drafts: runs.reduce((n, r) => n + r.drafts.length, 0),
          runs: runs.length,
        });
      } catch {
        /* Sidecar unreachable — counters stay at zero rather than showing invented numbers. */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const STATS = [
    { value: totals.tenders, label: "tenders reviewed" },
    { value: totals.runs, label: "review runs" },
    { value: totals.findings, label: "findings flagged" },
    { value: totals.drafts, label: "redlines drafted" },
  ];

  return (
    <section id="proof" className="relative scroll-mt-20 overflow-hidden bg-ink-950 text-white">
      <div className="bg-grid-dark absolute inset-0" aria-hidden="true" />
      <div
        className="pointer-events-none absolute -left-32 -bottom-32 h-96 w-96 rounded-full bg-brand-600/20 blur-[120px]"
        aria-hidden="true"
      />
      {/* Scanning light along the top edge — the band's live-data heartbeat */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px overflow-hidden" aria-hidden="true">
        <div className="animate-scan h-px w-1/3 bg-gradient-to-r from-transparent via-brand-400/80 to-transparent" />
      </div>
      <div className="relative mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Reveal>
              <SpecBar index="08" label="Live from this workspace" tone="light" />
            </Reveal>
            <Reveal delay={0.06}>
              <h2 className="type-display mt-6 max-w-2xl text-[34px] text-white sm:text-[44px]">
                <WordReveal text="What the agent has actually done." stagger={0.06} />
              </h2>
            </Reveal>
          </div>
          <Reveal delay={0.12}>
            <p className="max-w-sm text-[15px] leading-relaxed text-ink-400">
              Counted from the review runs on this server. Zero means no run has happened yet.
            </p>
          </Reveal>
        </div>

        <dl className="mt-12 grid grid-cols-2 gap-y-10 sm:gap-x-6 lg:grid-cols-4">
          {STATS.map((s, i) => (
            <Reveal key={s.label} delay={0.07 * i}>
              <div className="border-l-2 border-brand-600/60 pl-5">
                <dd className="font-display text-[38px] font-black leading-none tracking-tight text-white tabular sm:text-[46px]">
                  <CountUp value={s.value} />
                </dd>
                <dt className="mt-2.5 text-[13px] font-medium leading-snug text-ink-400">{s.label}</dt>
              </div>
            </Reveal>
          ))}
        </dl>
      </div>
    </section>
  );
}
