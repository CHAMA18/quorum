"use client";

import type { MouseEvent, ReactNode } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import { ArrowDown, ArrowRight, CircleDot, Landmark, PenLine } from "lucide-react";
import { AgentRun } from "@/components/quorum/agent-run";
import { HeroFilm } from "@/components/quorum/hero-film";
import { SpecBar } from "@/components/quorum/reveal";
import { Magnetic } from "@/components/quorum/motion-kit";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/* The counted contract — four numbers the product is held to. Not marketing:
   the workspace dashboard reports exactly these figures back to officers. */
const CONTRACT: { value: string; label: string; meta: string }[] = [
  { value: "03", label: "review dimensions", meta: "REQUIREMENTS · SUPPLIERS · PRICES" },
  { value: "CITED", label: "findings linked to evidence", meta: "DOCUMENT · PAGE · RECORD" },
  { value: "NAMED", label: "approver for every decision", meta: "AUTHORISED COMMITTEE MEMBER" },
  { value: "RECORDED", label: "actions retained in the audit history", meta: "REVIEW · DISPOSITION · TIME" },
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
        transition={{ duration: 0.9, delay, ease: EASE }}
      >
        {children}
      </motion.span>
    </span>
  );
}

export function Hero({ onGetStarted }: { onGetStarted: () => void }) {
  const reduce = useReducedMotion();

  // Mouse parallax for the run panel: normalised cursor position, springed.
  // Held to ±2.5° — enough to feel the surface, never enough to distort text.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 110, damping: 22, mass: 0.7 });
  const sy = useSpring(py, { stiffness: 110, damping: 22, mass: 0.7 });
  const rotateY = useTransform(sx, [-0.5, 0.5], [-2.5, 2.5]);
  const rotateX = useTransform(sy, [-0.5, 0.5], [2, -2]);

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
      {/* ── Ground ─────────────────────────────────────────────────────────
          First light over a drafting sheet: the procurement film under a
          scrim, a masked engineering grid over it, and a single red source
          behind the run panel. The film is the room; the grid is the desk. */}
      <HeroFilm />

      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute inset-0 bg-grid-light [mask-image:radial-gradient(ellipse_92%_62%_at_50%_0%,black,transparent)]" />
        <div
          className="absolute right-[-18%] top-[2%] h-[620px] w-[900px] rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, rgba(232,56,42,0.16), rgba(232,56,42,0.04) 55%, transparent)",
          }}
        />
        <div
          className="absolute left-[-16%] top-[22%] h-[520px] w-[620px] rounded-full"
          style={{
            background: "radial-gradient(closest-side, rgba(232,56,42,0.09), transparent)",
          }}
        />
      </div>

      {/* Drafting-sheet edge rules, aligned to the text column */}
      <div className="pointer-events-none absolute inset-0 hidden justify-center lg:flex" aria-hidden="true">
        <div className="relative h-full w-full max-w-7xl px-8">
          <span className="rule-v absolute inset-y-0 left-8 w-px opacity-70" />
          <span className="rule-v absolute inset-y-0 right-8 w-px opacity-70" />
        </div>
      </div>

      <div className="relative mx-auto w-full max-w-7xl px-4 pb-14 pt-8 sm:px-6 sm:pb-16 sm:pt-14 lg:px-8 lg:pb-20 lg:pt-16">
        <motion.div
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={reduce ? { duration: 0 } : { duration: 0.6, ease: EASE }}
        >
          <SpecBar
            index="00"
            label="Tender review workspace · public health procurement"
            meta="Source-linked findings · accountable approvals"
          />
        </motion.div>

        <div className="mt-8 grid items-start gap-12 sm:mt-10 lg:mt-14 lg:grid-cols-12 lg:gap-10">
          {/* ── The claim ─────────────────────────────────────────────────── */}
          <div className="lg:col-span-6">
            {/* Headline — per-word masked reveal; the accent phrase set in the
                editorial italic serif, underlined by a stroke that draws in. */}
            <h1
              className="type-display type-display-xl text-ink-950"
              aria-label="One complete tender review. Every finding traceable."
            >
              <span aria-hidden="true">
                <MaskedWord delay={0.06}>One</MaskedWord>{" "}
                <MaskedWord delay={0.12}>complete</MaskedWord>{" "}
                <span className="relative inline-block sm:whitespace-nowrap">
                  <MaskedWord
                    delay={0.18}
                    className="font-editorial text-[1.04em] font-normal tracking-normal text-brand-500 dark:text-brand-400"
                  >
                    tender
                  </MaskedWord>{" "}
                  <MaskedWord
                    delay={0.24}
                    className="font-editorial text-[1.04em] font-normal tracking-normal text-brand-500 dark:text-brand-400"
                  >
                    review.
                  </MaskedWord>{" "}
                  <svg
                    viewBox="0 0 300 10"
                    className="absolute -bottom-[0.14em] left-0 h-[0.1em] w-full overflow-visible"
                    aria-hidden="true"
                    preserveAspectRatio="none"
                  >
                    <motion.path
                      d="M2 7.2 C 78 3.4, 214 3.2, 298 6.2"
                      stroke="#e8382a"
                      strokeWidth="3"
                      strokeLinecap="round"
                      fill="none"
                      initial={reduce ? false : { pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={reduce ? { duration: 0 } : { duration: 1.1, delay: 1.05, ease: EASE }}
                    />
                  </svg>
                </span>{" "}
                <MaskedWord delay={0.38}>Every</MaskedWord>{" "}
                <MaskedWord delay={0.44}>finding</MaskedWord>{" "}
                <MaskedWord delay={0.5}>traceable.</MaskedWord>
              </span>
            </h1>

            <motion.p
              initial={reduce ? false : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduce ? { duration: 0 } : { duration: 0.7, delay: 0.55, ease: EASE }}
              className="type-lede mt-6 max-w-[54ch] text-ink-600 dark:text-ink-400"
            >
              Quorum brings tender requirements, supplier documents and price checks into one
              review record. Officers verify the evidence;{" "}
              <span className="font-semibold text-ink-900 dark:text-ink-100">the committee makes the award decision.</span>
            </motion.p>

            {/* Put the next step directly after the product promise; the
                credentials remain available below without pushing it off
                the first mobile screen. */}
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduce ? { duration: 0 } : { duration: 0.7, delay: 0.7, ease: EASE }}
              className="mt-7 flex flex-wrap items-center gap-3.5 sm:mt-9"
            >
              <Magnetic strength={0.22}>
                <button
                  type="button"
                  onClick={onGetStarted}
                  className="focus-brand group relative inline-flex h-[54px] items-center gap-3 overflow-hidden rounded-full bg-brand-600 pl-7 pr-2.5 text-[15.5px] font-semibold text-white shadow-[0_1px_0_rgba(255,255,255,0.18)_inset,0_18px_38px_-16px_rgba(217,38,22,0.65)] transition-[background-color,box-shadow,transform] duration-300 hover:bg-brand-700 hover:shadow-[0_1px_0_rgba(255,255,255,0.22)_inset,0_22px_46px_-16px_rgba(217,38,22,0.8)] active:translate-y-px"
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/22 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                  />
                  <span className="relative">Create your workspace</span>
                  <span
                    aria-hidden="true"
                    className="relative grid h-9 w-9 place-items-center rounded-full bg-white/18 transition-transform duration-300 group-hover:translate-x-0.5"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </button>
              </Magnetic>
              <a
                href="#overview"
                className="focus-brand group inline-flex h-[54px] items-center gap-2.5 rounded-full border border-ink-200 bg-paper/60 px-7 text-[15px] font-semibold text-ink-900 backdrop-blur transition-colors hover:border-ink-300 hover:bg-white dark:border-white/12 dark:hover:border-white/20 dark:hover:bg-white/[0.04]"
              >
                See how it works
                <ArrowDown
                  className="h-4 w-4 text-ink-400 transition-transform duration-300 group-hover:translate-y-0.5"
                  aria-hidden="true"
                />
              </a>
            </motion.div>

            <motion.p
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={reduce ? { duration: 0 } : { duration: 0.7, delay: 0.9 }}
              className="type-micro mt-4 flex items-center gap-2.5 text-ink-500"
            >
              <CircleDot className="h-3 w-3 text-brand-500" aria-hidden="true" />
              Start with up to three tender reviews at no cost
            </motion.p>

            {/* Institutional standing */}
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduce ? { duration: 0 } : { duration: 0.7, delay: 0.62, ease: EASE }}
              className="mt-6 sm:mt-7"
            >
              <span className="inline-flex items-center gap-2.5 rounded-full border border-brand-500/25 bg-brand-500/[0.06] py-2 pl-2 pr-4 text-[13.5px] font-semibold text-brand-700 dark:border-brand-500/30 dark:text-brand-300">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-500/12">
                  <Landmark className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                Designed for ministries, medical stores and oversight bodies
              </span>
            </motion.div>

          </div>

          {/* ── The proof ─────────────────────────────────────────────────── */}
          <motion.div
            initial={reduce ? false : { opacity: 0, scale: 0.98, y: 22 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.9, delay: 0.25, ease: EASE }}
            className="relative lg:col-span-6"
          >
            <div className="relative">
              {/* Caption above the panel: what this artefact is, and the rule
                  it exists to prove. Marginalia as a datasheet, not a sticker. */}
              <div className="mb-3 flex items-end justify-between gap-4">
                <span className="type-micro flex items-center gap-2 text-ink-500">
                  <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
                  </span>
                  Recent review activity
                </span>
                <span className="type-micro hidden text-right text-ink-400 sm:block">
                  Findings linked to their source
                </span>
              </div>

              {/* Red source: the light the panel sits in */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  background:
                    "radial-gradient(closest-side, rgba(232,56,42,0.2), rgba(232,56,42,0.05) 58%, transparent)",
                }}
              />

              <motion.div
                style={{ rotateX, rotateY, transformPerspective: 1400 }}
                className="relative will-change-transform"
              >
                <AgentRun />
              </motion.div>

              {/* The gate, stated as the product's own rule rather than a chip
                  floating over the log. The terminal above proves it happens. */}
              <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border border-ink-200/70 border-l-2 border-l-brand-500 bg-white/70 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-white/[0.03]">
                <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-ink-900">
                  <PenLine className="h-4 w-4 text-brand-600" aria-hidden="true" />
                  Committee approval
                </span>
                <span className="text-[13px] text-ink-500">
                  Quorum prepares the review; an authorised official records the decision.
                </span>
                <span className="ml-auto type-micro hidden text-brand-700 sm:block dark:text-brand-300">
                  Approval required
                </span>
              </div>
            </div>
          </motion.div>
        </div>

        {/* ── The counted contract ──────────────────────────────────────── */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={reduce ? { duration: 0 } : { duration: 0.8, ease: EASE }}
          className="mt-16 lg:mt-20"
        >
          <SpecBar
            index="01"
            label="Safeguards in every review"
            meta="Evidence · authorised approvals · audit history"
          />
          <dl className="mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-[10px] border border-ink-200/70 bg-ink-200/60 sm:grid-cols-2 lg:grid-cols-4 dark:border-white/10 dark:bg-white/10">
            {CONTRACT.map((s, i) => (
              <div
                key={s.label}
                className="group/cell flex flex-col gap-3 bg-paper px-6 py-7 transition-colors duration-300 hover:bg-white lg:px-7 dark:hover:bg-white/[0.03]"
              >
                <span className="type-micro order-1 text-ink-400">
                  {String(i + 1).padStart(2, "0")} · {s.meta}
                </span>
                <dd className="type-num order-2 text-[34px] text-ink-950 sm:text-[38px] lg:text-[40px]">
                  {s.value}
                </dd>
                <dt className="order-3 text-[13px] leading-snug text-ink-500">{s.label}</dt>
              </div>
            ))}
          </dl>
        </motion.div>
      </div>

      {/* ── Source registry ──────────────────────────────────────────────
          The portals the agent reads, run as a wire of their own with a
          fixed collar, so the strip reads as provenance rather than filler. */}
      <div
        className="group relative flex items-center border-t border-ink-200/70 bg-paper/70 dark:border-white/10"
          aria-label="Public procurement data sources"
      >
        <span className="relative z-10 hidden shrink-0 items-center gap-2.5 bg-paper pl-4 pr-5 sm:flex sm:pl-6 lg:pl-8">
          <span className="type-micro flex items-center gap-2 text-ink-500">
            <span className="animate-pulse-dot h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
            Public sources
          </span>
          <span className="h-3.5 w-px bg-ink-200 dark:bg-white/12" aria-hidden="true" />
        </span>

        <div className="mask-x flex min-w-0 flex-1 overflow-hidden">
          <div className="flex w-max animate-marquee-slow items-center group-hover:[animation-play-state:paused]">
            {[...PORTAL_SOURCES, ...PORTAL_SOURCES].map((p, i) => (
              <span key={i} className="flex shrink-0 items-center" aria-hidden={i >= PORTAL_SOURCES.length || undefined}>
                <span className="type-micro whitespace-nowrap px-5 py-3.5 text-ink-500">{p}</span>
                <span className="h-3 w-px shrink-0 bg-ink-200 dark:bg-white/12" aria-hidden="true" />
              </span>
            ))}
          </div>
        </div>
        <p className="sr-only">Examples of public procurement sources across Africa.</p>
      </div>
    </section>
  );
}
