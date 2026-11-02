"use client";

import { useEffect, useId, useRef, useState, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type HorizontalScrollRegionProps = Omit<HTMLAttributes<HTMLDivElement>, "aria-label" | "role" | "tabIndex"> & {
  label: string;
  hint?: string;
  hintClassName?: string;
};

/** Give horizontally overflowing content a named, keyboard-scrollable region. */
export function HorizontalScrollRegion({
  label,
  hint = "Swipe, scroll, or use the arrow keys while this region is focused.",
  hintClassName,
  className,
  children,
  "aria-describedby": describedBy,
  ...props
}: HorizontalScrollRegionProps) {
  const regionRef = useRef<HTMLDivElement | null>(null);
  const hintId = useId();
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const region = regionRef.current;
    if (!region) return;

    const measure = () => {
      const next = region.scrollWidth > region.clientWidth + 1;
      setOverflows((current) => (current === next ? current : next));
    };
    measure();

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(region);
    const observedChildren = new Set<Element>();
    const observeChildren = () => {
      const currentChildren = new Set(Array.from(region.children));
      for (const child of observedChildren) {
        if (!currentChildren.has(child)) {
          observer?.unobserve(child);
          observedChildren.delete(child);
        }
      }
      for (const child of currentChildren) {
        if (observedChildren.has(child)) continue;
        observer?.observe(child);
        observedChildren.add(child);
      }
    };
    observeChildren();
    const contentObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(() => {
          measure();
          observeChildren();
        });
    contentObserver?.observe(region, {
      attributes: true,
      attributeFilter: ["class", "hidden", "style"],
      characterData: true,
      childList: true,
      subtree: true,
    });
    window.addEventListener("resize", measure, { passive: true });
    return () => {
      observer?.disconnect();
      contentObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return (
    <>
      {overflows ? (
        <p
          id={hintId}
          className={cn("px-5 py-2 text-[11.5px] leading-relaxed text-ink-600 dark:text-ink-300", hintClassName)}
        >
          {hint}
        </p>
      ) : null}
      <div
        {...props}
        ref={regionRef}
        role={overflows ? "region" : undefined}
        aria-label={overflows ? label : undefined}
        aria-describedby={overflows ? [describedBy, hintId].filter(Boolean).join(" ") : describedBy}
        tabIndex={overflows ? 0 : undefined}
        className={cn(
          "overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-2",
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}
