"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Slow drifting colour glow — keeps flat sections alive without competing
 * with the content. Position it with `className` (absolute, inset, etc.).
 */
export function Aurora({
  className,
  tone = "red",
  slow = false,
}: {
  className?: string;
  tone?: "red" | "soft";
  slow?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute rounded-full blur-[110px]",
        tone === "red" ? "bg-brand-500/25" : "bg-brand-200/55",
        slow ? "animate-aurora-slow" : "animate-aurora",
        className
      )}
    />
  );
}

/** Thin red bar pinned to the top edge — fills as the visitor scrolls. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 30, restDelta: 0.001 });
  return (
    <motion.div
      aria-hidden="true"
      style={{ scaleX }}
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2px] origin-left bg-gradient-to-r from-brand-500 via-brand-400 to-brand-600 shadow-[0_0_12px_rgba(232,56,42,0.7)]"
    />
  );
}

/** Counts from 0 to `to` the first time the number scrolls into view. */
export function CountUp({
  to,
  duration = 1.6,
  className,
}: {
  to: number;
  duration?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [value, setValue] = useState(reduce ? to : 0);

  useEffect(() => {
    if (!inView || reduce) return;
    const controls = animate(0, to, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setValue(Math.round(v)),
    });
    return () => controls.stop();
  }, [inView, reduce, to, duration]);

  return (
    <span ref={ref} className={className}>
      {value}
    </span>
  );
}

/**
 * Wrapper that paints a soft red light following the cursor. Pure CSS
 * variables, so the hover state never re-renders React.
 */
export function Spotlight({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--my", `${e.clientY - rect.top}px`);
  };

  return (
    <div ref={ref} onMouseMove={onMove} className={cn("group relative", className)}>
      {children}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(420px circle at var(--mx, 50%) var(--my, 50%), rgba(232,56,42,0.11), transparent 60%)",
        }}
      />
    </div>
  );
}

/** Pulls its child gently toward the cursor — for primary calls to action. */
export function Magnetic({
  children,
  strength = 0.28,
  className,
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 18, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 220, damping: 18, mass: 0.4 });

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    if (reduce) return;
    const rect = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - (rect.left + rect.width / 2)) * strength);
    y.set((e.clientY - (rect.top + rect.height / 2)) * strength);
  };
  const reset = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      onMouseMove={onMove}
      onMouseLeave={reset}
      style={{ x: sx, y: sy }}
      className={cn("inline-flex", className)}
    >
      {children}
    </motion.div>
  );
}

/**
 * Headline-grade text reveal: each word rises out of an overflow-clipped line
 * with a blur that resolves as it lands. `text-sheen` on a word keeps the
 * sweeping highlight intact — the reveal animates the wrapper, not the fill.
 */
export function WordReveal({
  text,
  className,
  wordClassName,
  delay = 0,
  stagger = 0.05,
}: {
  text: string;
  className?: string;
  wordClassName?: string;
  delay?: number;
  stagger?: number;
}) {
  const reduce = useReducedMotion();
  const words = text.split(" ");
  return (
    <span className={cn("inline", className)} aria-label={text} role="text">
      {words.map((word, i) => (
        <span
          key={`${word}-${i}`}
          aria-hidden="true"
          className="inline-block overflow-hidden pb-[0.08em] align-bottom"
        >
          <motion.span
            className={cn("inline-block will-change-transform", wordClassName)}
            initial={reduce ? false : { y: "108%", opacity: 0, filter: "blur(6px)" }}
            whileInView={{ y: "0%", opacity: 1, filter: "blur(0px)" }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{
              duration: 0.7,
              delay: delay + i * stagger,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            {word}
            {i < words.length - 1 ? " " : ""}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

/**
 * Scroll-linked drift: the child moves `distance` px (negative → upward) as
 * the section travels through the viewport. Springed so it never feels tied
 * to a scrollbar. Disabled entirely for reduced-motion users.
 */
export function Parallax({
  children,
  distance = 56,
  className,
}: {
  children: ReactNode;
  distance?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [distance, -distance]);
  const smooth = useSpring(y, { stiffness: 60, damping: 20, mass: 0.5 });

  return (
    <div ref={ref} className={className}>
      <motion.div style={reduce ? undefined : { y: smooth }} className="will-change-transform">
        {children}
      </motion.div>
    </div>
  );
}

/**
 * Card-grade 3D tilt: the surface leans toward the cursor and a glare bar
 * sweeps across it. Pure transforms — compositing only, never layout.
 */
export function TiltCard({
  children,
  className,
  max = 6,
  glare = true,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
  glare?: boolean;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement | null>(null);
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const gx = useMotionValue(50);
  const srx = useSpring(rx, { stiffness: 180, damping: 18, mass: 0.4 });
  const sry = useSpring(ry, { stiffness: 180, damping: 18, mass: 0.4 });
  const glareBg = useTransform(
    gx,
    (v) =>
      `linear-gradient(105deg, transparent ${v - 22}%, rgba(255,255,255,0.14) ${
        v - 8
      }%, rgba(255,255,255,0.03) ${v + 8}%, transparent ${v + 24}%)`
  );

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    if (reduce) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    ry.set((nx - 0.5) * max * 2);
    rx.set((0.5 - ny) * max * 2);
    gx.set(nx * 100);
  };
  const reset = () => {
    rx.set(0);
    ry.set(0);
    gx.set(50);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={reset}
      style={reduce ? undefined : { rotateX: srx, rotateY: sry, transformPerspective: 900 }}
      className={cn("relative will-change-transform [transform-style:preserve-3d]", className)}
    >
      {children}
      {glare && !reduce && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{ background: glareBg }}
        />
      )}
    </motion.div>
  );
}

/** Fixed filmic grain over the whole page — one element, zero re-renders. */
export function NoiseOverlay() {
  return (
    <span
      aria-hidden="true"
      className="noise-overlay pointer-events-none fixed inset-0 z-[70] opacity-[0.035] mix-blend-overlay"
    />
  );
}
