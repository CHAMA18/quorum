"use client";

import { motion, useReducedMotion } from "framer-motion";
import { CirclePause, ScrollText } from "lucide-react";
import { Eyebrow, Reveal } from "@/components/quorum/reveal";
import { Aurora, Parallax, WordReveal } from "@/components/quorum/motion-kit";

const TASKS = [
  "Sorting bids",
  "Ticking off documents",
  "Checking each bidder",
  "Comparing prices",
  "Writing the report",
];

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * Overview — the committee's manual work vs Quorum's review run, ending at
 * a hard human gate.
 */
export function Overview() {
  const reduce = useReducedMotion();
  return (
    <section id="overview" className="relative scroll-mt-20 overflow-hidden border-y border-ink-100 bg-sand/60">
      <Parallax distance={48} className="pointer-events-none absolute inset-0">
        <Aurora tone="soft" className="-right-40 top-0 h-[480px] w-[480px] opacity-80" />
      </Parallax>
      <Parallax distance={64} className="pointer-events-none absolute inset-0">
        <Aurora tone="soft" slow className="-left-40 bottom-0 h-[420px] w-[420px] opacity-70" />
      </Parallax>
      <div className="relative mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-14">
          {/* Copy */}
          <div className="min-w-0 lg:col-span-5">
            <Reveal>
              <Eyebrow>Overview</Eyebrow>
            </Reveal>
            <Reveal delay={0.06}>
              <h2 className="mt-4 font-display text-[34px] font-black leading-[1.06] tracking-[-0.025em] text-ink-950 sm:text-[44px]">
                <WordReveal text="The same job. Two very different clocks." stagger={0.055} />
              </h2>
            </Reveal>
            <Reveal delay={0.12}>
              <p className="mt-6 text-[16.5px] leading-relaxed text-ink-600">
                Sorting bids, ticking off documents, checking each bidder, comparing prices and
                writing the report is{" "}
                <span className="font-semibold text-ink-900">committee work, done by hand</span>.
                Quorum does the same work in a single review run — and then stops.
              </p>
            </Reveal>
            <Reveal delay={0.18}>
              <div className="mt-8 flex items-start gap-4 rounded-2xl border border-brand-200 bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(217,38,22,0.12)]">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 ring-1 ring-brand-200">
                  <ScrollText className="h-5 w-5 text-brand-600" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-code text-[10px] font-semibold tracking-[0.22em] text-brand-700">
                    AUDIT TRAIL
                  </p>
                  <p className="mt-1 text-[15.5px] font-semibold leading-snug text-ink-900">
                    Every tool call logged — inputs, outputs, timestamps.
                  </p>
                </div>
              </div>
            </Reveal>
          </div>

          {/* Timeline visual */}
          <Reveal delay={0.1} className="min-w-0 lg:col-span-7">
            <div className="rounded-3xl border border-ink-100 bg-white p-6 shadow-[0_24px_60px_rgba(11,12,15,0.08)] sm:p-8">
              <div className="flex items-center justify-between gap-4">
                <p className="font-code text-[10px] font-semibold tracking-[0.26em] text-ink-500">
                  ONE TENDER, END TO END
                </p>
                <p className="font-code text-[10px] tracking-[0.18em] text-ink-400">FIG. 01 — THE CLOCK</p>
              </div>

              {/* Bar — draws in from the left; the red sliver marks Quorum's share */}
              <div className="relative mt-14">
                <motion.div
                  className="relative flex h-14 w-full items-stretch overflow-hidden rounded-xl bg-ink-950 sm:h-16"
                  initial={reduce ? false : { clipPath: "inset(0 100% 0 0 round 12px)" }}
                  whileInView={{ clipPath: "inset(0 0% 0 0 round 12px)" }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 1.2, ease: EASE }}
                >
                  <div className="bg-grid-dark absolute inset-0 opacity-60" aria-hidden="true" />
                  <p className="relative flex-1 self-center truncate px-4 font-code text-[10.5px] font-semibold tracking-[0.18em] text-ink-200 sm:text-[11.5px]">
                    COMMITTEE WORK, BY HAND
                  </p>
                  <motion.span
                    className="relative h-full w-[3px] shrink-0 bg-brand-600 shadow-[0_0_14px_rgba(232,56,42,0.9)]"
                    role="img"
                    aria-label="The red sliver: Quorum's share of the work"
                    initial={reduce ? false : { opacity: 0 }}
                    whileInView={{ opacity: [0, 1, 0.4, 1] }}
                    viewport={{ once: true }}
                    transition={{ delay: 1.1, duration: 1.2 }}
                  />
                </motion.div>
              </div>

              {/* The two clocks, stated plainly */}
              <div className="mt-4 flex items-start justify-between gap-4">
                <div>
                  <p className="font-code text-[20px] font-extrabold leading-none tracking-[-0.02em] text-ink-950 tabular sm:text-[24px]">
                    26<span className="ml-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">days</span>
                  </p>
                  <p className="mt-1.5 font-code text-[9.5px] tracking-[0.14em] text-ink-500">
                    COMMITTEE WORK, BY HAND
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-code text-[20px] font-extrabold leading-none tracking-[-0.02em] text-brand-600 tabular sm:text-[24px]">
                    ~20<span className="ml-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-600/70">min</span>
                  </p>
                  <p className="mt-1.5 font-code text-[9.5px] tracking-[0.14em] text-ink-500">
                    WHAT YOUR AGENT SHOULD TAKE
                  </p>
                </div>
              </div>

              {/* Measured, not marketed — the bench behind the clock figures */}
              <p className="mt-3 font-code text-[9.5px] leading-relaxed tracking-[0.12em] text-ink-400 sm:mt-4">
                MEASURED, NOT CLAIMED — on the record's staged packs, the shipped
                review graph (files → requirements → cited findings → human gate)
                runs in 4–9 ms deterministic, 20–28 s on the configured model. The
                read-and-flag pipeline scales to volume measured at ~0.9 s per MB
                of pack text. The ~20 min stays the envelope for full real-world
                packs — still two orders of magnitude inside 26 days, and the
                gavel stays human either way.
              </p>

              {/* Task chips over the committee segment */}
              <div className="mt-5 flex flex-wrap gap-2">
                {TASKS.map((t, i) => (
                  <motion.span
                    key={t}
                    initial={reduce ? false : { opacity: 0, y: 10, scale: 0.94 }}
                    whileInView={{ opacity: 1, y: 0, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.15 + i * 0.09, duration: 0.5, ease: EASE }}
                    className="inline-flex items-center gap-2 rounded-full border border-ink-100 bg-paper px-3 py-1.5 text-[12px] font-medium text-ink-700 transition-colors hover:border-brand-300 hover:bg-brand-50"
                  >
                    <span className="font-code text-[9.5px] font-semibold text-brand-600 tabular">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {t}
                  </motion.span>
                ))}
              </div>
              <p className="mt-2.5 font-code text-[10px] tracking-[0.14em] text-ink-400">
                ↑ THE FIVE JOBS ABOVE ARE THE 26 DAYS · THE RED SLICE IS THE ~20 MIN ↑
              </p>

              {/* Human gate */}
              <div className="mt-6 flex items-start gap-4 rounded-xl border-2 border-dashed border-brand-300 bg-brand-50/60 p-4 sm:p-5">
                <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white">
                  {!reduce && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 animate-ping-slow rounded-xl bg-brand-500/50"
                    />
                  )}
                  <CirclePause className="relative h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-code text-[10.5px] font-bold tracking-[0.22em] text-brand-700">
                    COMMITTEE DECIDES
                  </p>
                  <p className="mt-1 text-[14.5px] font-medium leading-snug text-ink-800">
                    Quorum stops here and hands over a sourced report.
                  </p>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
