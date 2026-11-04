"use client";

import { useReducedMotion } from "@/lib/use-reduced-motion";

/**
 * StoryShowcase — the shared story-panel carousel for both product doors.
 *
 * The organization door used to list three value propositions statically;
 * they now rotate so the door can carry more of the product's story in the
 * same space without growing a scroll. Every slide states a fact the
 * portal actually honours — the fields the register asks for, the board,
 * supplier requirements and application history.
 *
 * Craft notes:
 *   · auto-advances on a fixed clock; the progress fill's animation duration
 *     and the timer share one constant, so they can never drift apart;
 *   · pauses while the pointer hovers or keyboard focus is anywhere inside,
 *     and stays still entirely for prefers-reduced-motion users;
 *   · arrows, clickable progress segments and arrow keys all move the same
 *     way; the live region announces the slide so it is operable by ear;
 *   · a fixed minimum height keeps the panel from jumping between slides.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Building2, ChevronLeft, ChevronRight, FileText, Landmark, Scale, ScrollText, ShieldCheck, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import { nextRovingTabIndex } from "@/lib/a11y";

const EASE = [0.22, 1, 0.36, 1] as const;
const INTERVAL_MS = 6_500;

const SUPPLIER_SLIDES = [
  {
    icon: Building2,
    kicker: "Your profile",
    title: "One profile, kept current",
    body: "Add your organization, tax and sector-registration details once, then use them for each tender application.",
  },
  {
    icon: Landmark,
    kicker: "Open tenders",
    title: "Find tenders accepting bids",
    body: "Every open tender with its closing date in one view. File an application in a single pass — no re-typing the same legal identity per tender.",
  },
  {
    icon: ShieldCheck,
    kicker: "Submission requirements",
    title: "Know when a submission can proceed",
    body: "One application per tender, submitted before closing. If a submission cannot proceed, the portal explains why.",
  },
  {
    icon: ScrollText,
    kicker: "Application history",
    title: "Applications have a clear history",
    body: "Each application is attributed to your registered organization and retained in the procurement history for authorised officers to review.",
  },
] as const;

const QUORUM_SLIDES = [
  {
    icon: FileText,
    kicker: "Tender reviews",
    title: "One record from review to decision",
    body: "Bring tender documents, findings, approvals and committee decisions together in a shared procurement record.",
  },
  {
    icon: ShieldCheck,
    kicker: "Evidence",
    title: "Findings stay linked to their source",
    body: "Review each issue against the cited page, clause or procurement record before deciding what to do.",
  },
  {
    icon: Scale,
    kicker: "Bid evaluation",
    title: "Compare bids against the published matrix",
    body: "AI helps surface evidence and recommendations for committee review; evaluators remain responsible for scores and decisions.",
  },
  {
    icon: Workflow,
    kicker: "Tender workflow",
    title: "Carry the record through award",
    body: "Follow notices, evaluation, award review periods and contract administration in one workspace.",
  },
] as const;

export function StoryShowcase({
  compact = false,
  audience = "supplier",
}: {
  compact?: boolean;
  audience?: "supplier" | "quorum";
}) {
  const slides = audience === "quorum" ? QUORUM_SLIDES : SUPPLIER_SLIDES;
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const idPrefix = useId();
  const regionRef = useRef<HTMLDivElement>(null);
  const count = slides.length;

  const go = useCallback((next: number) => setIndex(((next % count) + count) % count), [count]);
  const step = useCallback((dir: 1 | -1) => setIndex((i) => (((i + dir) % count) + count) % count), [count]);

  /* The auto-advance clock. Paused on hover/focus; off entirely when the
     visitor asked for less motion — the arrows and segments still work. */
  useEffect(() => {
    if (paused || reduce) return;
    const id = window.setTimeout(() => setIndex((i) => (i + 1) % count), INTERVAL_MS);
    return () => window.clearTimeout(id);
  }, [paused, reduce, index, count]);

  /* Arrow keys move the carousel when focus is inside it. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const next = nextRovingTabIndex(event.key, index, count);
    if (next === null) return;
    event.preventDefault();
    go(next);
    requestAnimationFrame(() => document.getElementById(`${idPrefix}-tab-${next}`)?.focus());
  };

  const slide = slides[index];
  const Icon = slide.icon;

  return (
    <div
      ref={regionRef}
      role="group"
      aria-roledescription="carousel"
      aria-label={audience === "quorum" ? "How Quorum supports procurement teams" : "What the supplier portal gives you"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={onKeyDown}
      className="relative"
    >
      {/* The slide — one fact at a time, on a stable stage. */}
      <div
        className={cn("relative", compact ? "min-h-[124px]" : "min-h-[148px]")}
        id={`${idPrefix}-slide`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-tab-${index}`}
        tabIndex={0}
        aria-live={paused || reduce ? "polite" : "off"}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.figure
            key={index}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10 }}
            transition={{ duration: reduce ? 0.15 : 0.4, ease: EASE }}
            aria-roledescription="slide"
            aria-label={`Slide ${index + 1} of ${count}: ${slide.title}`}
            className="flex gap-4"
          >
            <span
              className={cn(
                "mt-0.5 grid shrink-0 place-items-center rounded-xl border border-brand-400/25 bg-brand-400/10 text-brand-300",
                compact ? "h-9 w-9" : "h-10 w-10",
              )}
              aria-hidden="true"
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="font-code text-[10px] font-semibold tracking-[0.12em] text-brand-300/90">
                {String(index + 1).padStart(2, "0")} · {slide.kicker.toUpperCase()}
              </p>
              <p className={cn("font-semibold text-white", compact ? "mt-1.5 text-[14px]" : "mt-2 text-[15.5px]")}>
                {slide.title}
              </p>
              <p className={cn("leading-relaxed text-ink-400", compact ? "mt-1 text-[12px]" : "mt-1.5 text-[13px]")}>
                {slide.body}
              </p>
            </div>
          </motion.figure>
        </AnimatePresence>
      </div>

      {/* Controls — arrows, then the segmented clock. Both are real controls:
          a segment click is a jump, not a decoration. */}
      <div className="mt-4 flex items-center gap-3">
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Choose a slide">
          {slides.map((s, i) => (
            <button
              key={s.title}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${i}`}
              aria-selected={i === index}
              aria-controls={`${idPrefix}-slide`}
              tabIndex={i === index ? 0 : -1}
              aria-label={`Slide ${i + 1}: ${s.title}`}
              onClick={() => go(i)}
              className="focus-brand group/sig relative h-11 w-11 rounded-md"
            >
              <span className="absolute inset-x-0 bottom-2 top-auto block h-[3px] overflow-hidden rounded-full bg-white/12">
                {i === index ? (
                  <span
                    key={`fill-${index}-${paused ? "p" : "r"}`}
                    aria-hidden="true"
                    className="animate-showcase-fill block h-full w-full origin-left rounded-full bg-brand-500"
                    style={{
                      animationDuration: `${INTERVAL_MS}ms`,
                      animationPlayState: paused || reduce ? "paused" : "running",
                    }}
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "block h-full w-full origin-left rounded-full transition-colors group-hover/sig:bg-white/25",
                      i < index ? "bg-white/30" : "bg-white/12",
                    )}
                  />
                )}
              </span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="mr-1 font-code text-[10px] font-bold tabular tracking-[0.08em] text-ink-500" aria-hidden="true">
            {String(index + 1).padStart(2, "0")}/{String(count).padStart(2, "0")}
          </span>
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous slide"
            className="focus-brand grid h-11 w-11 place-items-center rounded-lg border border-white/12 text-ink-200 transition-colors hover:border-white/30 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next slide"
            className="focus-brand grid h-11 w-11 place-items-center rounded-lg border border-white/12 text-ink-200 transition-colors hover:border-white/30 hover:text-white"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
