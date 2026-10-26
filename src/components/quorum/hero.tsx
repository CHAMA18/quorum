"use client";

import type { CSSProperties, MouseEvent } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import { ArrowRight, CirclePause, FileCheck2, Landmark } from "lucide-react";
import { AgentRun } from "@/components/quorum/agent-run";
import { Eyebrow } from "@/components/quorum/reveal";
import { Aurora, CountUp, Magnetic, Parallax } from "@/components/quorum/motion-kit";

const STATS: { to?: number; text?: string; label: string }[] = [
  { to: 3, label: "checks on every bid — specs, bidders, prices" },
  { text: "Every", label: "finding cited to a source document" },
  { to: 1, label: "human gate before anything irreversible" },
];

/* The portals the agent actually reads — the same 9 countries, 22 datasets
   the workspace's Connected portals card tracks. Product truth, not decoration. */
const PORTAL_SOURCES = [
  "KENYA · PPRA",
  "KENYA · MAKUENI COUNTY",
  "GHANA · GH PORTAL",
  "NIGERIA · 13 STATE PORTALS",
  "RWANDA · RW",
  "UGANDA · UG",
  "TANZANIA · TZ",
  "ZAMBIA · ZM",
  "LIBERIA · LR",
  "SOUTH AFRICA · ZA",
];

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function Hero({ onGetStarted }: { onGetStarted: () => void }) {
  const reduce = useReducedMotion();

  // Mouse parallax for the agent-run visual: normalised cursor position, springed.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 120, damping: 20, mass: 0.6 });
  const sy = useSpring(py, { stiffness: 120, damping: 20, mass: 0.6 });
  const rotateY = useTransform(sx, [-0.5, 0.5], [-5, 5]);
  const rotateX = useTransform(sy, [-0.5, 0.5], [4, -4]);

  const onMove = (e: MouseEvent<HTMLElement>) => {
    if (reduce) return;
    const rect = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - rect.left) / rect.width - 0.5);
    py.set((e.clientY - rect.top) / rect.height - 0.5);
  };
  const onLeave = () => {
    px.set(0);
    py.set(0);
  };

  return (
    <section
      className="relative overflow-hidden bg-paper"
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      <div
        className="bg-grid-light pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]"
        aria-hidden="true"
      />
      <Parallax distance={44} className="pointer-events-none absolute inset-0">
        <Aurora className="-left-40 -top-40 h-[560px] w-[560px] opacity-70" />
      </Parallax>
      <Parallax distance={70} className="pointer-events-none absolute inset-0">
        <Aurora tone="soft" slow className="-right-48 top-24 h-[520px] w-[520px] opacity-90" />
      </Parallax>
      <Aurora tone="soft" className="left-1/3 top-1/2 h-[380px] w-[380px] opacity-50" />

      <div className="relative mx-auto w-full max-w-7xl px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:px-8 lg:pb-24 lg:pt-24">
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-10">
          {/* Copy */}
          <div className="lg:col-span-6">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE }}
            >
              <Eyebrow>Agentic tender review for public health procurement</Eyebrow>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 32, filter: "blur(10px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.9, delay: 0.08, ease: EASE }}
              className="mt-6 font-display text-[42px] font-black leading-[1.02] tracking-[-0.03em] text-ink-950 text-balance sm:text-[58px] lg:text-[64px]"
            >
              Do in{" "}
              <span className="relative inline-block">
                <span className="text-sheen">one review run</span>
                <svg
                  viewBox="0 0 220 12"
                  className="absolute -bottom-1 left-0 w-full overflow-visible"
                  aria-hidden="true"
                  preserveAspectRatio="none"
                >
                  <motion.path
                    d="M3 9 C 60 2, 160 2, 217 8"
                    stroke="#e8382a"
                    strokeWidth="4"
                    strokeLinecap="round"
                    fill="none"
                    initial={reduce ? false : { pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 1.1, delay: 0.9, ease: EASE }}
                  />
                </svg>
              </span>{" "}
              what takes a committee weeks of reading.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.18, ease: EASE }}
              className="mt-6 max-w-xl text-[17px] leading-relaxed text-ink-600"
            >
              Quorum reads a health tender end to end — specs against clinical need, quantities
              against real consumption, prices against other buyers. Every finding cited. Then it
              stops and hands over:{" "}
              <span className="font-semibold text-ink-900">the committee decides.</span>
            </motion.p>

            {/* Trust chip */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.24, ease: EASE }}
              className="mt-6"
            >
              <span className="inline-flex items-center gap-2.5 rounded-full border border-brand-200 bg-brand-50 px-4 py-2 text-[13.5px] font-semibold text-brand-700">
                <Landmark className="h-4 w-4" aria-hidden="true" />
                Built for ministries, medical stores &amp; oversight bodies
              </span>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.3, ease: EASE }}
              className="mt-8 flex flex-wrap items-center gap-3.5"
            >
              <Magnetic>
                <button
                  type="button"
                  onClick={onGetStarted}
                  className="group relative inline-flex h-[52px] items-center gap-2 overflow-hidden rounded-full bg-brand-600 px-7 text-[15px] font-semibold text-white shadow-[0_12px_30px_rgba(217,38,22,0.32)] transition-all hover:bg-brand-700 hover:shadow-[0_14px_36px_rgba(217,38,22,0.4)]"
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-shimmer bg-gradient-to-r from-transparent via-white/35 to-transparent"
                  />
                  <span className="relative">Start your first run</span>
                  <ArrowRight
                    className="relative h-4.5 w-4.5 transition-transform group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </button>
              </Magnetic>
              <a
                href="#overview"
                className="inline-flex h-[52px] items-center gap-2.5 rounded-full border border-ink-200 bg-white px-7 text-[15px] font-semibold text-ink-900 transition-all hover:-translate-y-0.5 hover:border-ink-300 hover:shadow-md"
              >
                See how it works
              </a>
            </motion.div>

            {/* Stats */}
            <motion.dl
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.42, ease: EASE }}
              className="mt-12 grid grid-cols-2 gap-x-6 gap-y-7 border-t border-ink-100 pt-8 sm:grid-cols-4"
            >
              {STATS.map((s) => (
                <div key={s.label}>
                  <dt className="order-2 mt-1 text-[12.5px] font-medium leading-snug text-ink-500">{s.label}</dt>
                  <dd className="order-1 font-display text-[30px] font-extrabold tracking-tight text-ink-950 tabular">
                    {s.to !== undefined ? <CountUp to={s.to} /> : s.text}
                  </dd>
                </div>
              ))}
            </motion.dl>
          </div>

          {/* Agent run — tilts toward the cursor, haloed by a slow conic light
              and two orbiting satellites that mark the agent's constant read */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.85, delay: 0.2, ease: EASE }}
            className="relative lg:col-span-6"
          >
            {/* Rotating conic halo — the light source behind the terminal */}
            <div
              aria-hidden="true"
              className="conic-halo animate-spin-slower pointer-events-none absolute -inset-10 hidden opacity-90 blur-[70px] sm:block lg:-inset-16"
            />
            {/* Orbiting satellites on two radii, opposite directions */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden sm:block">
              <div className="animate-orbit absolute left-1/2 top-1/2" style={{ "--orbit-r": "min(30vw, 340px)" } as CSSProperties}>
                <span className="block h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500 shadow-[0_0_16px_rgba(232,56,42,0.9)]" />
              </div>
              <div className="animate-orbit-rev absolute left-1/2 top-1/2" style={{ "--orbit-r": "min(24vw, 270px)" } as CSSProperties}>
                <span className="block h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand-400 bg-paper" />
              </div>
            </div>
            <motion.div
              style={{ rotateX, rotateY, transformPerspective: 1200 }}
              className="relative will-change-transform"
            >
              <AgentRun />

              {/* Floating proof chips */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.2, duration: 0.6 }}
                className="absolute -left-4 top-10 hidden md:block lg:-left-8"
              >
                <div className="animate-float flex items-center gap-2 rounded-xl border border-ink-100 bg-white/95 px-3.5 py-2.5 shadow-lg backdrop-blur">
                  <FileCheck2 className="h-4 w-4 text-brand-600" aria-hidden="true" />
                  <p className="text-[12.5px] font-semibold text-ink-900">
                    Every claim cited <span className="font-code text-[10px] font-medium text-ink-400">· or it doesn&apos;t count</span>
                  </p>
                </div>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.5, duration: 0.6 }}
                className="absolute -right-3 bottom-16 hidden md:block lg:-right-7"
              >
                <div className="animate-float-slow flex items-center gap-2 rounded-xl border border-ink-100 bg-white/95 px-3.5 py-2.5 shadow-lg backdrop-blur">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-600" />
                  </span>
                  <CirclePause className="h-4 w-4 text-brand-600" aria-hidden="true" />
                  <p className="text-[12.5px] font-semibold text-ink-900">Stops before the award</p>
                </div>
              </motion.div>
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* Portal sources strip — the registry the agent reads, end to end */}
      <div
        className="relative overflow-hidden border-t border-ink-100 bg-paper/70 backdrop-blur-sm"
        aria-label="Portal sources the agent reads"
      >
        <div className="flex w-max animate-marquee items-center gap-12 py-3.5 pr-12">
          {[...PORTAL_SOURCES, ...PORTAL_SOURCES].map((p, i) => (
            <span
              key={i}
              className="flex items-center gap-3 whitespace-nowrap font-code text-[10px] font-medium tracking-[0.22em] text-ink-400"
            >
              <span className="h-1 w-1 rounded-full bg-brand-500/70" aria-hidden="true" />
              {p}
            </span>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-paper to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-paper to-transparent" />
        <p className="sr-only">Sourced live from 22 datasets across 9 national and county portals.</p>
      </div>
    </section>
  );
}
