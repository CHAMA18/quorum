"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Scroll-triggered reveal wrapper used across all sections: fade, rise and de-blur. */
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

/** Section eyebrow: red tick that draws itself in, plus a mono label. */
export function Eyebrow({
  children,
  tone = "dark",
  className,
}: {
  children: ReactNode;
  tone?: "dark" | "light";
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <p
      className={cn(
        "flex items-center gap-2.5 font-code text-[11px] font-semibold uppercase tracking-[0.28em]",
        tone === "dark" ? "text-ink-500" : "text-ink-300",
        className
      )}
    >
      <motion.span
        className={cn("inline-block h-[2px] w-6 origin-left", tone === "dark" ? "bg-brand-600" : "bg-brand-400")}
        aria-hidden="true"
        initial={reduce ? false : { scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      />
      {children}
    </p>
  );
}
