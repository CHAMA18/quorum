"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Scroll-triggered reveal wrapper used across all sections: fade, rise and de-blur.
 */
export function Reveal({
  children,
  delay = 0,
  y = 28,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y, filter: "blur(8px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/**
 * SpecBar — the datasheet rule that opens a band.
 *
 * A hairline rule across the canvas carrying, left to right: the section
 * index in signal red, a divider, the section's name in mono uppercase, a
 * leader hairline that stretches to fill the row, and the band's technical
 * footnote right-aligned. It is the element that makes the page read as an
 * instrument report rather than a marketing page, and it costs one flex row.
 */
export function SpecBar({
  index,
  label,
  meta,
  tone = "dark",
  className,
}: {
  /** Two-digit section index, e.g. "01". */
  index: string;
  label: string;
  /** Right-aligned technical footnote — keeps the band honest about itself. */
  meta?: string;
  /** "dark" for light surfaces, "light" for bands that stay dark in both themes. */
  tone?: "dark" | "light";
  className?: string;
}) {
  const reduce = useReducedMotion();
  const light = tone === "light";
  return (
    <div className={cn("relative", className)}>
      <motion.span
        aria-hidden="true"
        className={cn("block h-px w-full origin-left", light ? "bg-white/15" : "bg-ink-200 dark:bg-white/12")}
        initial={reduce ? false : { scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
      <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5 pt-3">
        <span className={cn("type-micro", light ? "text-brand-400" : "text-brand-600 dark:text-brand-400")}>
          {index}
        </span>
        <span className={cn("h-2.5 w-px self-center", light ? "bg-white/15" : "bg-ink-200 dark:bg-white/15")} aria-hidden="true" />
        <span className={cn("type-micro", light ? "text-ink-300" : "text-ink-600 dark:text-ink-400")}>{label}</span>
        {meta ? (
          <>
            <span
              aria-hidden="true"
              className={cn("hidden h-px flex-1 self-center sm:block", light ? "bg-white/10" : "bg-ink-200/70 dark:bg-white/10")}
            />
            <span className={cn("type-micro", light ? "text-ink-500" : "text-ink-400 dark:text-ink-600")}>
              {meta}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
