"use client";

import type { MouseEvent, ReactNode } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import { ArrowDown, ArrowRight, Landmark } from "lucide-react";
import { AgentRun } from "@/components/quorum/agent-run";
import { Eyebrow } from "@/components/quorum/reveal";
import { CountUp } from "@/components/quorum/motion-kit";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/* The counted contract — four numbers the product is held to. Not marketing:
   the workspace dashboard reports exactly these figures back to officers. */
const CONTRACT: { to: number; suffix?: string; label: string }[] = [
  { to: 3, label: "checks on every bid — specs, bidders, prices" },
  { to: 100, suffix: "%", label: "of findings cited to a source document" },
  { to: 22, label: "datasets read live across 9 portals" },
  { to: 1, label: "human gate — nothing awards without a signature" },
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

/**
 * One word rising out of an overflow-clipped line — the masked reveal that
 * gives the headline its typographic entrance. Reduced motion: static.
 */
function MaskedWord({
  children,
  delay,
  className,
}: {
  children: ReactNode;
  delay: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <span className="inline-block overflow-hidden pb-[0.1em] align-bottom" aria-hidden="true">
      <motion.span
        className={`inline-block will-change-transform ${className ?? ""}`}
        initial={reduce ? false : { y: "112%" }}
        animate={{ y: "0%" }}
        transition={{ duration: 0.85, delay, ease: EASE }}
      >
        {children}
      </motion.span>
    </span>
  );
}

export function Hero({ onGetStarted }: { onGetStarted: () => void }) {
  const reduce = useReducedMotion();

  // Mouse parallax for the agent-run visual: normalised cursor position, springed.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 120, damping: 20, mass: 0.6 });
  const sy = useSpring(py, { stiffness: 120, damping: 20, mass: 0.6 });
  const rotateY = useTransform(sx, [-0.5, 0.5], [-4, 4]);
  const rotateX = useTransform(sy, [-0.5, 0.5], [3, -3]);

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
      {/* Dawn-line background: faint engineering grid + three red radial washes
          that read as a first light over the page, not as decoration blobs. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute inset-0 bg-grid-light [mask-image:radial-gradient(ellipse_85%_70%_at_50%_0%,black,transparent)]" />
        <div
          className="absolute -top-40 left-[-12%] h-[540px] w-[700px] rounded-full blur-[130px]"
          style={{ background: "radial-gradient(closest-side, rgba(232,56,42,0.15), transparent)" }}
        />
        <div
          className="absolute right-[-14%] top-[6%] h-[580px] w-[580px] rounded-full blur-[140px]"
          style={{ background: "radial-gradient(closest-side, rgba(232,56,42,0.12), transparent)" }}
        />
        <div
          className="absolute left-[38%] top-[38%] h-[420px] w-[540px] rounded-full blur-[150px]"
          style={{ background: "radial-gradient(closest-side, rgba(232,56,42,0.06), transparent)" }}
        />
        {/* Two quiet satellites — the agent's constant read, reduced to dots. */}
        <span className="animate-pulse-dot absolute right-[13%] top-[22%] hidden h-2 w-2 rounded-full bg-brand-500 shadow-[0_0_18px_rgba(232,56,42,0.8)] lg:block" />
        <span className="absolute right-[9%] top-[31%] hidden h-3 w-3 rounded-full border border-brand-400/70 lg:block" />
      </div>

      <div className="relative mx-auto w-full max-w-7xl px-4 pb-14 pt-16 sm:px-6 sm:pt-24 lg:px-8 lg:pb-20 lg:pt-28">
        <div className="grid items-center gap-14 lg:grid-cols-12 lg:gap-10">
          {/* Copy */}
          <div className="lg:col-span-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE }}
            >
              <Eyebrow>Agentic tender review · public health procurement</Eyebrow>
            </motion.div>

            {/* Headline — per-word masked reveal; the accent phrase set in the
                editorial italic serif with an underline that draws itself in. */}
            <h1
              className="mt-7 font-display text-[42px] font-black leading-[1.02] tracking-[-0.03em] text-ink-950 sm:text-[56px] lg:text-[64px]"
              aria-label="Do in one review run what takes a committee weeks of reading."
            >
              <span aria-hidden="true">
                <MaskedWord delay={0.06}>Do</MaskedWord>{" "}
                <MaskedWord delay={0.12}>in</MaskedWord>{" "}
                <span className="relative inline-block whitespace-nowrap">
                  <MaskedWord delay={0.18} className="font-editorial font-normal tracking-normal text-brand-500">
                    one
                  </MaskedWord>{" "}
                  <MaskedWord delay={0.24} className="font-editorial font-normal tracking-normal text-brand-500">
                    review
                  </MaskedWord>{" "}
                  <MaskedWord delay={0.3} className="font-editorial font-normal tracking-normal text-brand-500">
                    run
                  </MaskedWord>
                  <svg
                    viewBox="0 0 220 12"
                    className="absolute -bottom-1.5 left-0 w-full overflow-visible"
                    aria-hidden="true"
                    preserveAspectRatio="none"
                  >
                    <motion.path
                      d="M3 9 C 60 2, 160 2, 217 8"
                      stroke="#e8382a"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      fill="none"
                      initial={reduce ? false : { pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 1.1, delay: 1.05, ease: EASE }}
                    />
                  </svg>
                </span>{" "}
                <MaskedWord delay={0.38}>what</MaskedWord>{" "}
                <MaskedWord delay={0.44}>takes</MaskedWord>{" "}
                <MaskedWord delay={0.5}>a</MaskedWord>{" "}
                <MaskedWord delay={0.56}>committee</MaskedWord>{" "}
                <MaskedWord delay={0.62}>weeks</MaskedWord>{" "}
                <MaskedWord delay={0.68}>of</MaskedWord>{" "}
                <MaskedWord delay={0.74}>reading.</MaskedWord>
              </span>
            </h1>

            <motion.p
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.55, ease: EASE }}
              className="mt-7 max-w-xl text-[17px] leading-relaxed text-ink-600"
            >
              Quorum reads a health tender end to end — specs against clinical need, quantities
              against real consumption, prices against other buyers. Every finding cited. Then it
              stops and hands over:{" "}
              <span className="font-semibold text-ink-900">the committee decides.</span>
            </motion.p>

            {/* Trust chip */}
            <motion.div
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.62, ease: EASE }}
              className="mt-7"
            >
              <span className="inline-flex items-center gap-2.5 rounded-full border border-brand-500/25 bg-brand-500/[0.06] px-4 py-2 text-[13.5px] font-semibold text-brand-600 dark:text-brand-300">
                <Landmark className="h-4 w-4" aria-hidden="true" />
                Built for ministries, medical stores &amp; oversight bodies
              </span>
            </motion.div>

            {/* CTAs — primary carries the arrow inside a struck circle; the
                secondary answers with a down arrow into the page. */}
            <motion.div
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.7, ease: EASE }}
              className="mt-9 flex flex-wrap items-center gap-4"
            >
              <button
                type="button"
                onClick={onGetStarted}
                className="group inline-flex h-[54px] items-center gap-3 rounded-full bg-brand-600 pl-7 pr-2.5 text-[15.5px] font-semibold text-white shadow-[0_16px_36px_rgba(217,38,22,0.32)] transition-all hover:bg-brand-700 hover:shadow-[0_18px_42px_rgba(217,38,22,0.42)]"
              >
                Start your first run
                <span
                  aria-hidden="true"
                  className="grid h-9 w-9 place-items-center rounded-full bg-white/20 transition-transform duration-300 group-hover:translate-x-0.5"
                >
                  <ArrowRight className="h-4 w-4" />
                </span>
              </button>
              <a
                href="#overview"
                className="group inline-flex h-[54px] items-center gap-2.5 rounded-full border border-ink-200 bg-paper px-7 text-[15px] font-semibold text-ink-900 transition-all hover:border-ink-300 hover:bg-ink-50"
              >
                See how it works
                <ArrowDown
                  className="h-4 w-4 text-ink-400 transition-transform duration-300 group-hover:translate-y-0.5"
                  aria-hidden="true"
                />
              </a>
            </motion.div>
          </div>

          {/* Agent run — tilts toward the cursor; proof chips pin to the frame
              edges like marginalia, not floating cards. */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 26 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.85, delay: 0.25, ease: EASE }}
            className="relative lg:col-span-6"
          >
            <motion.div
              style={{ rotateX, rotateY, transformPerspective: 1200 }}
              className="relative will-change-transform"
            >
              <AgentRun />

              {/* Frame-pinned proof chips */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.25, duration: 0.6 }}
                className="absolute -left-3 -top-5 hidden md:block lg:-left-7"
              >
                <div className="animate-float flex items-center gap-2 rounded-xl border border-ink-100 bg-white/95 px-3.5 py-2.5 shadow-[0_14px_36px_rgba(11,12,15,0.18)] backdrop-blur">
                  <span className="grid h-5 w-5 place-items-center rounded-md bg-brand-500/15" aria-hidden="true">
                    <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                  </span>
                  <p className="text-[12.5px] font-semibold text-ink-900">
                    Every claim cited{" "}
                    <span className="font-code text-[10px] font-medium text-ink-400">
                      · or it doesn&apos;t count
                    </span>
                  </p>
                </div>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.5, duration: 0.6 }}
                className="absolute -right-3 hidden md:block lg:-right-6"
                style={{ top: "42%" }}
              >
                <div className="animate-float-slow flex items-center gap-2 rounded-xl border border-ink-100 bg-white/95 px-3.5 py-2.5 shadow-[0_14px_36px_rgba(11,12,15,0.18)] backdrop-blur">
                  <span className="relative flex h-2 w-2" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-600" />
                  </span>
                  <p className="text-[12.5px] font-semibold text-ink-900">Stops before the award</p>
                </div>
              </motion.div>
            </motion.div>
          </motion.div>
        </div>

        {/* The counted contract — hairline-divided row the hero is held to */}
        <motion.dl
          initial={{ opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.8, ease: EASE }}
          className="mt-16 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-ink-100 bg-ink-100 lg:mt-20 lg:grid-cols-4"
        >
          {CONTRACT.map((s) => (
            <div key={s.label} className="flex flex-col bg-paper px-6 py-7 lg:px-8">
              <dt className="order-2 mt-2.5 text-[12px] font-medium leading-snug text-ink-500">
                {s.label}
              </dt>
              <dd className="order-1 font-display text-[38px] font-extrabold leading-none tracking-tight text-ink-950 tabular lg:text-[44px]">
                <CountUp to={s.to} />
                {s.suffix ? <span className="text-brand-500">{s.suffix}</span> : null}
              </dd>
            </div>
          ))}
        </motion.dl>
      </div>

      {/* Portal sources strip — the registry the agent reads, end to end */}
      <div
        className="group relative overflow-hidden border-t border-ink-100 bg-paper/70 backdrop-blur-sm"
        aria-label="Portal sources the agent reads"
      >
        <div className="flex w-max animate-marquee-slow items-center gap-12 py-3.5 pr-12 group-hover:[animation-play-state:paused]">
          {[...PORTAL_SOURCES, ...PORTAL_SOURCES].map((p, i) => (
            <span
              key={i}
              className="flex items-center gap-3 whitespace-nowrap font-code text-[10px] font-medium tracking-[0.22em] text-ink-500"
            >
              <span className="h-1 w-1 rounded-full bg-brand-500/70" aria-hidden="true" />
              {p}
            </span>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-paper to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-paper to-transparent" />
        <p className="sr-only">Sourced live from 22 datasets across 9 national and county portals.</p>
      </div>
    </section>
  );
}
