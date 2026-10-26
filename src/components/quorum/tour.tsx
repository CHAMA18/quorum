"use client";

/**
 * Quorum — the guided walkthrough layer.
 *
 * One engine for every tour in the product. A step names a `data-tour` key;
 * the layer finds that element, spotlights it (a padded cut-out floating in a
 * dimmed page), tracks it while the page scrolls or animates, and floats a
 * card beside it with the step's copy and controls.
 *
 * Deliberate choices, so the tour never lies to the officer:
 *  - The spotlight is re-measured every animation frame, so it survives
 *    smooth scrolling, Framer-Motion entrances and layout shifts — a tour
 *    can never point at where a control used to be.
 *  - A step whose element never appears is skipped, never stranded on.
 *  - The dimmed area takes the clicks (advance). The spotlit element is
 *    covered by an invisible catcher, so a guided tour can never trigger
 *    the very control it is explaining.
 *  - Escape exits; ← and → walk. Focus enters the card and hands itself
 *    back to the opener on close. Reduced-motion preferences are honoured.
 */

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, BookOpen, Check, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type TourStep = {
  /** Matches [data-tour="…"] on the element to spotlight. */
  target: string;
  title: string;
  body: string;
  /** Host view tab to open before spotlighting the target (committee tabs). */
  tab?: string;
  /** Preferred side of the target for the card; auto-chosen when omitted. */
  placement?: "top" | "bottom" | "left" | "right";
  /** Opaque action the host performs the moment the step opens. */
  action?: "open-wizard";
};

type Box = { top: number; left: number; width: number; height: number };

const PAD = 10; /* how far the spotlight breathes around the element */
const CARD_W = 356; /* card width, clamped to small viewports */
const CARD_H = 216; /* placement estimate; the real card re-clamps after render */
const GAP = 18; /* spotlight ↔ card distance */
const MISSING_MS = 2600; /* how long a step waits for its element before skipping */

const EASE = [0.22, 1, 0.36, 1] as const;

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), Math.max(min, max));
}

export function TourLayer({
  chapterNo,
  chapterTotal,
  chapterTitle,
  steps,
  index,
  onIndex,
  onClose,
  onFinish,
  onNextChapter,
}: {
  chapterNo: number;
  chapterTotal: number;
  chapterTitle: string;
  steps: TourStep[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onFinish: () => void;
  onNextChapter?: () => void;
}) {
  const step = steps[index];
  const last = index === steps.length - 1;

  const [box, setBox] = useState<Box | null>(null);
  const [waiting, setWaiting] = useState(true);
  const [vw, setVw] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  const [vh, setVh] = useState(() => (typeof window === "undefined" ? 800 : window.innerHeight));
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false)
  );
  const [cardH, setCardH] = useState(CARD_H);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const advance = useCallback(() => {
    if (index + 1 < steps.length) onIndex(index + 1);
    else onFinish();
  }, [index, steps.length, onIndex, onFinish]);

  const back = useCallback(() => {
    if (index > 0) onIndex(index - 1);
  }, [index, onIndex]);

  /* Viewport metrics + motion preference — the initial values are seeded in
     state; this effect only subscribes to changes. */
  useEffect(() => {
    const onResize = () => {
      setVw(window.innerWidth);
      setVh(window.innerHeight);
    };
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    window.addEventListener("resize", onResize);
    mq.addEventListener?.("change", onChange);
    return () => {
      window.removeEventListener("resize", onResize);
      mq.removeEventListener?.("change", onChange);
    };
  }, []);

  /* Focus enters the card; hands itself back to the opener on close. */
  useEffect(() => {
    restoreFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const id = window.setTimeout(() => cardRef.current?.focus({ preventScroll: true }), 40);
    return () => {
      window.clearTimeout(id);
      const el = restoreFocus.current;
      if (el && el.isConnected) el.focus({ preventScroll: true });
    };
  }, []);

  /* Keyboard: Escape exits, arrows walk, Enter advances (unless a button
     inside the card is focused — that control handles its own click). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        advance();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      } else if (e.key === "Enter") {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "BUTTON" || t.tagName === "A")) return;
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, back, onClose]);

  /* Track the target every frame — boxes never go stale, and every setState
     runs inside the frame callback, never synchronously with the effect. A
     new step clears the old spotlight on its first frame; a target that
     never appears is skipped (and the host turns overflow into finish). */
  useEffect(() => {
    if (!step) return;
    const selector = `[data-tour="${CSS.escape(step.target)}"]`;
    const started = performance.now();
    let raf = 0;
    let applied: Box | null = null;
    let found = false;
    let scrolled = false;
    let decided = false;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(selector);
      const r = el ? el.getBoundingClientRect() : null;
      const usable = !!r && r.width > 2 && r.height > 2;
      if (!usable && !decided) {
        /* The new target is not on the page yet — drop the old spotlight. */
        decided = true;
        setBox(null);
        setWaiting(true);
      }
      if (usable && r) {
        decided = true;
        if (!found) {
          found = true;
          setWaiting(false);
        }
        if (!scrolled) {
          scrolled = true;
          const fullyVisible = r.top >= 8 && r.bottom <= window.innerHeight - 8;
          if (!fullyVisible) {
            el?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
          }
        }
        const next: Box = { top: r.top, left: r.left, width: r.width, height: r.height };
        if (
          !applied ||
          Math.abs(applied.top - next.top) > 0.5 ||
          Math.abs(applied.left - next.left) > 0.5 ||
          Math.abs(applied.width - next.width) > 0.5 ||
          Math.abs(applied.height - next.height) > 0.5
        ) {
          applied = next;
          setBox(next);
        }
        raf = requestAnimationFrame(tick);
        return;
      }
      if (!found && performance.now() - started > MISSING_MS) {
        advance();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [step?.target, index, reduced]);

  /* Keep the card inside the viewport once its real height is known — the
     observer reports asynchronously, so layout stays render-driven. */
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h && Math.abs(h - cardH) > 2) setCardH(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [cardH]);

  /* Card placement — prefer the step's side, fall back to where there is room. */
  const layout = useMemo(() => {
    if (!box) return null;
    const width = Math.min(CARD_W, vw - 24);
    const h = cardH;
    const spaceBelow = vh - (box.top + box.height + PAD) - GAP;
    const spaceAbove = box.top - PAD - GAP;
    let p: NonNullable<TourStep["placement"]> | "bottom" = step?.placement ?? "bottom";
    if (!step?.placement) p = spaceBelow >= h + 8 || spaceBelow >= spaceAbove ? "bottom" : "top";
    if (p === "top" && spaceAbove < h + 8 && spaceBelow > spaceAbove) p = "bottom";
    if (p === "bottom" && spaceBelow < h + 8 && spaceAbove > spaceBelow) p = "top";

    const centered = box.left + box.width / 2;
    let x: number;
    let y: number;
    if (p === "top") {
      x = centered - width / 2;
      y = box.top - PAD - GAP - h;
    } else if (p === "bottom") {
      x = centered - width / 2;
      y = box.top + box.height + PAD + GAP;
    } else if (p === "left") {
      x = box.left - PAD - GAP - width;
      y = box.top + box.height / 2 - h / 2;
      if (x < 12) {
        p = "right";
        x = box.left + box.width + PAD + GAP;
      }
    } else {
      x = box.left + box.width + PAD + GAP;
      y = box.top + box.height / 2 - h / 2;
      if (x + width > vw - 12) {
        p = "left";
        x = box.left - PAD - GAP - width;
      }
    }
    x = clamp(x, 12, vw - width - 12);
    y = clamp(y, 12, vh - h - 12);
    return { x, y, width };
  }, [box, cardH, vw, vh, step?.placement]);

  if (!step) return null;

  const stepNo = String(index + 1).padStart(2, "0");
  const chapterLabel = `CHAPTER ${String(chapterNo).padStart(2, "0")}/${String(chapterTotal).padStart(2, "0")}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Guided walkthrough — ${chapterTitle}`}
      data-tour-layer
    >
      {/* The dimmed page — clicking the dark advances, as every good tour does. */}
      <div
        className="fixed inset-0 z-[94] bg-ink-950/70"
        onClick={advance}
        aria-hidden="true"
      />

      {/* The spotlight — a cut-out that follows the target every frame. */}
      {box && (
        <div
          className={cn(
            "pointer-events-none fixed z-[95]",
            reduced ? "" : "transition-opacity duration-200",
            waiting ? "opacity-0" : "opacity-100"
          )}
          style={{
            top: box.top - PAD,
            left: box.left - PAD,
            width: box.width + PAD * 2,
            height: box.height + PAD * 2,
          }}
        >
          <div className="absolute inset-0 rounded-2xl border-[1.5px] border-brand-500/90 shadow-[0_0_0_9999px_rgba(11,12,15,0.72),0_18px_60px_rgba(11,12,15,0.45)]" />
          <div className={cn("absolute inset-0 rounded-2xl", !reduced && "animate-tour-pulse")} aria-hidden="true" />
          <div className="absolute -left-[3px] top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-brand-600" aria-hidden="true" />
          {/* Clicks on the highlighted control advance instead of firing it. */}
          <button
            type="button"
            tabIndex={-1}
            aria-label="Continue the walkthrough"
            onClick={advance}
            className="pointer-events-auto absolute inset-0 cursor-pointer rounded-2xl"
          />
        </div>
      )}

      {/* Waiting for the spot — never a dead screen. */}
      {!box && (
        <div className="fixed left-1/2 top-1/2 z-[95] -translate-x-1/2 -translate-y-1/2">
          <p
            className="flex items-center gap-2.5 rounded-full border border-white/15 bg-night px-4 py-2 font-code text-[9px] font-bold tracking-[0.22em] text-white shadow-2xl"
            role="status"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" aria-hidden="true" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-600" aria-hidden="true" />
            </span>
            FINDING THE SPOT…
          </p>
        </div>
      )}

      {/* The card — the step, the copy, the controls. */}
      <AnimatePresence mode="wait" initial={false}>
        {layout && (
          <motion.div
            key={`${chapterNo}-${index}`}
            ref={cardRef}
            tabIndex={-1}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.28, ease: EASE }}
            className="fixed z-[96] rounded-2xl border border-ink-100 bg-white shadow-[0_30px_80px_rgba(11,12,15,0.45)] outline-none"
            style={{ top: layout.y, left: layout.x, width: layout.width }}
            aria-live="polite"
          >
            {/* Progress rail */}
            <div className="absolute inset-x-0 top-0 h-[3px] overflow-hidden rounded-t-2xl bg-ink-100" aria-hidden="true">
              <div
                className="h-full rounded-full bg-brand-600 transition-[width] duration-300"
                style={{ width: `${((index + 1) / steps.length) * 100}%` }}
              />
            </div>

            <div className="px-5 pb-4 pt-5">
              <div className="flex items-start justify-between gap-3">
                <p className="flex items-center gap-2 font-code text-[8px] font-bold tracking-[0.22em] text-brand-700">
                  <BookOpen className="h-3 w-3" aria-hidden="true" />
                  WALKTHROUGH · {chapterLabel}
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="End the walkthrough"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-300 transition-colors hover:bg-paper hover:text-ink-700"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>

              <h3 className="mt-2.5 font-display text-[16px] font-black leading-snug tracking-[-0.01em] text-ink-950">
                {step.title}
              </h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-600">{step.body}</p>

              <div className="mt-4 flex items-center justify-between gap-3 border-t border-ink-100 pt-3.5">
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={back}
                    disabled={index === 0}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-ink-200 px-2.5 font-code text-[8.5px] font-bold tracking-[0.14em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <ArrowLeft className="h-3 w-3" aria-hidden="true" />
                    BACK
                  </button>
                  <p className="font-code text-[8px] font-bold tracking-[0.18em] text-ink-400" aria-label={`Step ${index + 1} of ${steps.length}`}>
                    STEP {stepNo} / {String(steps.length).padStart(2, "0")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {last && onNextChapter && (
                    <button
                      type="button"
                      onClick={onNextChapter}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ink-200 px-3 font-code text-[8.5px] font-bold tracking-[0.14em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950"
                    >
                      NEXT CHAPTER
                      <ArrowRight className="h-3 w-3" aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={last ? onFinish : advance}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 font-code text-[8.5px] font-bold tracking-[0.14em] text-white shadow-[0_8px_20px_rgba(217,38,22,0.28)] transition-colors hover:bg-brand-700"
                  >
                    {last ? (
                      <>
                        <Check className="h-3 w-3" aria-hidden="true" />
                        FINISH
                      </>
                    ) : (
                      <>
                        NEXT
                        <ArrowRight className="h-3 w-3" aria-hidden="true" />
                      </>
                    )}
                  </button>
                </div>
              </div>

              <p className="mt-2.5 font-code text-[7.5px] tracking-[0.18em] text-ink-300">
                CLICK THE HIGHLIGHT OR PRESS → TO CONTINUE · ESC TO EXIT
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="sr-only" role="status">
        Step {index + 1} of {steps.length}: {step.title}
      </p>
    </div>
  );
}
