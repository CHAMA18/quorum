"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, LayoutDashboard, LogOut, Menu, X } from "lucide-react";
import { QuorumLogo } from "@/components/quorum/logo";
import { MasterSwitcher } from "@/components/quorum/master-switcher";
import type { AuthUser } from "@/lib/auth-types";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/quorum/theme-toggle";

const NAV = [
  { label: "Overview", href: "#overview" },
  { label: "Use cases", href: "#use-cases" },
  { label: "Pricing", href: "#pricing" },
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "Q";
}

/**
 * Section spy — which band the reader is currently inside.
 *
 * The header reports position instead of guessing it: on every scroll frame
 * (rAF-coalesced) each nav target is measured against a probe line just under
 * the bar, and the last one above that line wins. Sections that do not exist
 * yet are skipped silently, so the rail stays correct while the page grows.
 */
function useSectionSpy(hrefs: string[]) {
  const [active, setActive] = useState("");
  const ref = useRef(0);

  useEffect(() => {
    const probe = 132; // px from the viewport top — just past the bar
    const measure = () => {
      ref.current = 0;
      let current = "";
      for (const href of hrefs) {
        const el = document.querySelector<HTMLElement>(href);
        if (!el) continue;
        if (el.getBoundingClientRect().top - probe <= 0) current = href;
      }
      setActive((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => {
      if (!ref.current) ref.current = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (ref.current) cancelAnimationFrame(ref.current);
    };
  }, [hrefs.join("|")]);

  return active;
}

export function SiteHeader({
  user,
  authReady,
  onGetStarted,
  onSignIn,
  onSignOut,
  onDashboard,
}: {
  user: AuthUser | null;
  authReady: boolean;
  onGetStarted: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onDashboard: () => void;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const activeSection = useSectionSpy(NAV.map((n) => n.href));
  const lit = hovered ?? activeSection;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll while the mobile menu is open. Close it on Escape and
  // when the viewport grows to the desktop layout, so a resize never leaves
  // the page stuck with scrolling disabled.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    desktop.addEventListener("change", onDesktop);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", onDesktop);
    };
  }, [open]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full border-b backdrop-blur-xl transition-[background-color,border-color,box-shadow] duration-500",
        scrolled
          ? "border-ink-200/80 bg-paper/80 shadow-[0_18px_44px_-40px_rgba(11,12,15,0.55)] dark:border-white/10 dark:bg-night/80"
          : "border-transparent bg-paper/60"
      )}
    >
      <div className="mx-auto grid h-[68px] w-full max-w-7xl grid-cols-[1fr_auto] items-center gap-3 px-4 sm:px-6 lg:grid-cols-[1fr_auto_1fr] lg:px-8">
        <Link
          href="/"
          aria-label="Quorum home"
          onClick={() => setOpen(false)}
          className="focus-brand justify-self-start rounded-xl"
        >
          <QuorumLogo />
        </Link>

        {/* Section rail — a centred segmented control whose ink follows the
            reader: it slides to the hovered label, and settles on the band
            currently in view so the header doubles as a position indicator. */}
        <nav
          aria-label="Primary"
          onMouseLeave={() => setHovered(null)}
          className="relative hidden items-center rounded-full border border-ink-200/70 bg-white/70 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] backdrop-blur lg:flex lg:justify-self-center dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none"
        >
          {NAV.map((item) => {
            const isLit = lit === item.href;
            const isCurrent = activeSection === item.href;
            return (
              <a
                key={item.label}
                href={item.href}
                aria-current={isCurrent ? "true" : undefined}
                onMouseEnter={() => setHovered(item.href)}
                onFocus={() => setHovered(item.href)}
                onBlur={() => setHovered(null)}
                className={cn(
                  "focus-brand relative rounded-full px-4 py-2 text-[13.5px] font-medium transition-colors duration-300",
                  isLit ? "text-white" : "text-ink-600 hover:text-ink-950 dark:text-ink-400 dark:hover:text-white"
                )}
              >
                {isLit && (
                  <motion.span
                    layoutId="nav-rail-ink"
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full bg-ink-950 dark:bg-white/10 dark:ring-1 dark:ring-white/10"
                    transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.6 }}
                  />
                )}
                <span className="relative">{item.label}</span>
              </a>
            );
          })}
        </nav>

        {/* Actions */}
        <div className="hidden items-center gap-2 justify-self-end lg:flex">
          <ThemeToggle className="h-10 w-10 rounded-full" />
          {!authReady ? (
            <div className="h-10 w-[196px] animate-pulse rounded-full bg-ink-100/70" aria-hidden="true" />
          ) : user ? (
            <>
              <span className="flex h-10 items-center gap-2.5 rounded-full border border-ink-200/80 bg-white py-1 pl-1 pr-3.5 dark:border-white/10 dark:bg-white/[0.04]">
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-950 font-code text-[10px] font-bold text-white ring-2 ring-brand-500/25"
                  aria-hidden="true"
                >
                  {initialsOf(user.name)}
                </span>
                <span className="min-w-0 leading-none">
                  <span className="block max-w-[150px] truncate text-[13px] font-semibold text-ink-900">
                    {user.name}
                  </span>
                  <span className="mt-1 block max-w-[150px] truncate type-micro text-ink-400">
                    {user.organization ?? "Officer desk"}
                  </span>
                </span>
              </span>
              <button
                type="button"
                onClick={onDashboard}
                className="focus-brand group inline-flex h-10 items-center gap-2 rounded-full bg-ink-950 pl-4 pr-3 text-[13px] font-semibold text-white shadow-[0_10px_28px_-14px_rgba(11,12,15,0.8)] transition-colors hover:bg-brand-600"
              >
                <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                Workspace
                <ArrowUpRight
                  className="h-3.5 w-3.5 opacity-70 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                onClick={onSignOut}
                aria-label={`Sign out ${user.name}`}
                title="Sign out"
                className="focus-brand inline-flex h-10 w-10 items-center justify-center rounded-full border border-ink-200/80 bg-white text-ink-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-brand-500/10"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </>
          ) : (
            <>
              <MasterSwitcher active="quorum" />
              <button
                type="button"
                onClick={onDashboard}
                className="focus-brand group inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-semibold text-ink-950 transition-colors hover:text-brand-600"
              >
                Enter workspace
                <ArrowUpRight
                  className="h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </button>
            </>
          )}
        </div>

        <button
          type="button"
          className="focus-brand inline-flex h-11 w-11 items-center justify-center justify-self-end rounded-full border border-ink-200/80 bg-white text-ink-900 lg:hidden dark:border-white/10 dark:bg-white/[0.04]"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            id="mobile-menu"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-ink-100 bg-paper lg:hidden dark:border-white/10"
          >
            <nav aria-label="Mobile" className="flex flex-col px-4 py-3 sm:px-6">
              {NAV.map((item, i) => (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="focus-brand flex items-center gap-3.5 border-b border-ink-100 py-4 last:border-b-0 dark:border-white/10"
                >
                  <span className="type-micro text-brand-600 dark:text-brand-400">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[17px] font-semibold text-ink-900">{item.label}</span>
                  <ArrowUpRight className="ml-auto h-4 w-4 text-ink-300" aria-hidden="true" />
                </a>
              ))}

              <div className="flex items-center justify-between gap-3 pb-1 pt-4">
                <MasterSwitcher active="quorum" />
                <ThemeToggle className="h-10 w-10 rounded-full" />
              </div>

              {!authReady ? (
                <div className="mt-4 h-12 animate-pulse rounded-xl bg-ink-100/70" aria-hidden="true" />
              ) : user ? (
                <div className="mt-4 space-y-2.5">
                  <div className="flex items-center gap-3 rounded-[10px] border border-ink-200/80 bg-white px-4 py-3 dark:border-white/10 dark:bg-white/[0.04]">
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-950 font-code text-[10px] font-bold text-white"
                      aria-hidden="true"
                    >
                      {initialsOf(user.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-semibold text-ink-900">
                        {user.name}
                      </span>
                      <span className="mt-0.5 block truncate type-micro text-ink-400">
                        {user.organization ?? "Officer desk"}
                      </span>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onDashboard();
                    }}
                    className="focus-brand flex w-full items-center justify-center gap-2 rounded-xl bg-ink-950 px-4 py-3.5 text-[15px] font-semibold text-white"
                  >
                    <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                    Workspace
                    <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onSignOut();
                    }}
                    className="focus-brand inline-flex w-full items-center justify-center gap-2 rounded-xl border border-ink-200 px-4 py-3.5 text-[15px] font-semibold text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-700 dark:border-white/10"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    Sign out
                  </button>
                </div>
              ) : (
                <div className="mt-4 grid gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onGetStarted();
                    }}
                    className="focus-brand inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 text-[15px] font-semibold text-white"
                  >
                    Start your first run
                    <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onSignIn();
                    }}
                    className="focus-brand inline-flex h-12 items-center justify-center rounded-xl border border-ink-200 bg-white text-[15px] font-semibold text-ink-900 dark:border-white/10 dark:bg-white/[0.04]"
                  >
                    Sign in
                  </button>
                </div>
              )}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
