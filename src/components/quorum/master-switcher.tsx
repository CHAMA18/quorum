"use client";

import { useId } from "react";
import { motion } from "framer-motion";
import { Building2, Landmark } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The master tab switcher — the one control that governs both sides of the
 * desk. SUPPLIER and QUORUM are the two top-level tabs of the whole
 * experience: flip the tab and you cross from the organizations' portal to
 * the officer desk and back. The lower-level toggles (create/sign in,
 * register/sign in) stay scoped to their card; this one sits above them —
 * pinned over each full-screen door and carried inside every persistent
 * bar, so the switch is reachable from anywhere on any screen.
 */

export type MasterPortal = "supplier" | "quorum";

const EASE = [0.22, 1, 0.36, 1] as const;

const TABS: ReadonlyArray<{
  id: MasterPortal;
  label: string;
  seat: string;
  icon: typeof Building2;
  target: string;
}> = [
  { id: "supplier", label: "Supplier", seat: "the organizations' side", icon: Building2, target: "/org" },
  { id: "quorum", label: "Quorum", seat: "the officer desk", icon: Landmark, target: "/#/login" },
];

export function MasterSwitcher({
  active,
  variant = "inline",
  className,
}: {
  active: MasterPortal;
  /** inline — sits inside an existing bar; floating — pinned over a full-screen door */
  variant?: "inline" | "floating";
  className?: string;
}) {
  const thumbId = useId();

  const go = (tab: (typeof TABS)[number]) => {
    if (tab.id === active) {
      // On the officer doors (#/login, #/register) the active Quorum tab is
      // the way out of the overlay — it dismisses back to the main site.
      const here = window.location.pathname + window.location.hash;
      if (active === "quorum" && (here.endsWith("#/login") || here.endsWith("#/register"))) {
        window.location.assign("/");
      }
      return; // everywhere else, the live desk stays put
    }
    // The two tabs are different doors in different route trees with
    // different account spaces (separate cookies, separate stores) — a full
    // navigation is the honest crossing.
    window.location.assign(tab.target);
  };

  const tabs = (
    <>
      {TABS.map((tab) => {
        const isActive = active === tab.id;
        const floating = variant === "floating";
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => go(tab)}
            aria-current={isActive ? "page" : undefined}
            title={isActive ? `${tab.label} — this desk is live` : `Switch to ${tab.seat}`}
            className={cn(
              "relative rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500/60",
              floating ? "px-3.5 py-2" : "px-3 py-1.5",
              /* The active pill inverts against the surface beneath it, so the
                 label is pinned to the pill's own colour rather than to the
                 ink scale: ink-950 flips to near-white under .dark, which is
                 exactly how a white pill ends up with an invisible label. */
              isActive
                ? floating
                  ? "text-night"
                  : "text-paper dark:text-night"
                : floating
                  ? "text-white/60 transition-colors hover:text-white"
                  : "text-ink-500 transition-colors hover:text-ink-950 dark:text-ink-400 dark:hover:text-white",
            )}
          >
            {isActive && (
              <motion.span
                layoutId={`master-tab-${thumbId}`}
                className={cn(
                  "absolute inset-0 rounded-full",
                  floating ? "bg-white" : "bg-ink-950 dark:bg-white",
                )}
                transition={{ duration: 0.28, ease: EASE }}
                aria-hidden="true"
              />
            )}
            <span className="relative flex items-center gap-1.5">
              <tab.icon
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  isActive &&
                    (floating ? "text-brand-600" : "text-brand-500 dark:text-brand-600"),
                )}
                aria-hidden="true"
              />
              <span className="whitespace-nowrap font-code text-[10px] font-semibold uppercase tracking-[0.16em]">
                {tab.label}
              </span>
            </span>
          </button>
        );
      })}
    </>
  );

  if (variant === "floating") {
    return (
      /* Outer div owns the viewport pin (Tailwind translate); the inner
         motion div owns the entrance so the transforms never fight. */
      <div className={cn("fixed left-1/2 top-4 z-[70] -translate-x-1/2", className)}>
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          <nav
            aria-label="Master portal switcher"
            className="flex items-center gap-1 rounded-full bg-ink-950/90 p-1 shadow-[0_18px_50px_rgba(11,12,15,0.45)] ring-1 ring-white/15 backdrop-blur-md"
          >
            <span
              className="hidden px-2.5 font-code text-[8.5px] font-semibold tracking-[0.3em] text-white/40 sm:inline"
              aria-hidden="true"
            >
              MASTER
            </span>
            <span className="hidden h-4 w-px bg-white/15 sm:block" aria-hidden="true" />
            {tabs}
          </nav>
        </motion.div>
      </div>
    );
  }

  return (
    <nav
      aria-label="Master portal switcher"
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-ink-100/80 p-1 dark:bg-white/[0.07]",
        className,
      )}
    >
      {tabs}
    </nav>
  );
}
