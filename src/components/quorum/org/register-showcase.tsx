"use client";

/**
 * RegisterShowcase — the story panel's carousel.
 *
 * The organization door used to list three value propositions statically;
 * they now rotate so the door can carry more of the product's story in the
 * same space without growing a scroll. Every slide states a fact the
 * portal actually honours — the fields the register asks for, the board,
 * the audit spine, the disciplines — nothing invented for decoration.
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

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Building2, ChevronLeft, ChevronRight, Landmark, ScrollText, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;
const INTERVAL_MS = 6_500;

const SLIDES = [
  {
    icon: Building2,
    kicker: "Your profile",
    title: "One profile, kept current",
    body: "Legal identity, tax clearance, sector registrations — the exact fields the register asks for, verified once and reused on every application.",
  },
  {
    icon: Landmark,
    kicker: "The board",
    title: "Apply from the board",
    body: "Every open tender with its closing date in one view. File an application in a single pass — no re-typing the same legal identity per tender.",
  },
  {
    icon: ShieldCheck,
    kicker: "The disciplines",
    title: "Refused honestly, on the record",
    body: "One bid per tender, and nothing accepted after the closing date. The register refuses the rest — and tells you exactly why.",
  },
  {
    icon: ScrollText,
    kicker: "The record",
    title: "Nothing happens silently",
    body: "Each application is attested as org:<name> and appended to the same audit spine the officer's desk reads — receipts, not promises.",
  },
] as const;

export function RegisterShowcase({ compact = false }: { compact?: boolean }) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const regionRef = useRef<HTMLDivElement>(null);
  const count = SLIDES.length;

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
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    }
  };

  const slide = SLIDES[index];
  const Icon = slide.icon;

  return (
    <div
      ref={regionRef}
      role="group"
      aria-roledescription="carousel"
      aria-label="What the supplier portal gives you"
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
              <p className="font-code text-[8.5px] font-semibold tracking-[0.22em] text-brand-300/90">
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
          {SLIDES.map((s, i) => (
            <button
              key={s.title}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Slide ${i + 1}: ${s.title}`}
              onClick={() => go(i)}
              className="focus-brand group/sig relative h-6 w-9 rounded-md py-2.5"
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
          <span className="mr-1 font-code text-[8px] font-bold tabular tracking-[0.14em] text-ink-500" aria-hidden="true">
            {String(index + 1).padStart(2, "0")}/{String(count).padStart(2, "0")}
          </span>
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous slide"
            className="focus-brand grid h-8 w-8 place-items-center rounded-lg border border-white/12 text-ink-300 transition-colors hover:border-white/30 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next slide"
            className="focus-brand grid h-8 w-8 place-items-center rounded-lg border border-white/12 text-ink-300 transition-colors hover:border-white/30 hover:text-white"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
