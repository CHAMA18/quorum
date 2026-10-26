"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, LayoutDashboard, LogOut, Menu, X } from "lucide-react";
import { QuorumLogo } from "@/components/quorum/logo";
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
        "sticky top-0 z-50 w-full border-b bg-paper/85 backdrop-blur-xl transition-all duration-300",
        scrolled ? "border-ink-100 shadow-[0_1px_24px_rgba(11,12,15,0.07)]" : "border-transparent"
      )}
    >
      <div className="mx-auto flex h-[72px] w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="Quorum home" onClick={() => setOpen(false)}>
          <QuorumLogo />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="rounded-full px-3.5 py-2 text-[14px] font-medium text-ink-600 transition-colors hover:bg-ink-50 hover:text-ink-950"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* Desktop actions */}
        <div className="hidden items-center gap-2.5 lg:flex">
          <ThemeToggle />
          {!authReady ? (
            <div className="h-10 w-[196px] animate-pulse rounded-full bg-ink-100/70" aria-hidden="true" />
          ) : user ? (
            <>
              <span className="flex h-10 items-center gap-2.5 rounded-full border border-ink-200 bg-white py-1 pl-1 pr-4">
                <span
                  className="grid h-8 w-8 place-items-center rounded-full bg-ink-950 font-code text-[10px] font-bold text-white"
                  aria-hidden="true"
                >
                  {initialsOf(user.name)}
                </span>
                <span className="max-w-[168px] truncate text-[13px] font-semibold text-ink-900">
                  {user.name}
                </span>
              </span>
              <button
                type="button"
                onClick={onDashboard}
                className="group inline-flex h-10 items-center gap-1.5 rounded-full bg-ink-950 px-4 text-[13px] font-semibold text-white transition-all hover:bg-brand-600"
              >
                <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                Workspace
                <ArrowUpRight
                  className="h-3.5 w-3.5 opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                onClick={onSignOut}
                aria-label={`Sign out ${user.name}`}
                title="Sign out"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-600 transition-all hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </>
          ) : (
            <>
              <Link
                href="/org/dashboard"
                className="inline-flex h-10 items-center rounded-full bg-brand-600 px-5 text-[13.5px] font-semibold text-white shadow-[0_8px_20px_rgba(217,38,22,0.28)] transition-all hover:bg-brand-700 hover:shadow-[0_10px_26px_rgba(217,38,22,0.36)]"
              >
                Supplier
              </Link>
              <button
                type="button"
                onClick={onDashboard}
                className="group inline-flex h-10 items-center gap-1.5 rounded-full bg-brand-600 px-5 text-[13.5px] font-semibold text-white shadow-[0_8px_20px_rgba(217,38,22,0.28)] transition-all hover:bg-brand-700 hover:shadow-[0_10px_26px_rgba(217,38,22,0.36)]"
              >
                Quorum
                <ArrowUpRight
                  className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  aria-hidden="true"
                />
              </button>
            </>
          )}
        </div>

        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-900 lg:hidden"
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
            className="overflow-hidden border-t border-ink-100 bg-paper lg:hidden"
          >
            <nav aria-label="Mobile" className="flex flex-col gap-1 px-4 py-4">
              {NAV.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between rounded-xl px-4 py-3.5 text-[16px] font-semibold text-ink-800 transition-colors hover:bg-ink-50"
                >
                  {item.label}
                  <ArrowUpRight className="h-4 w-4 text-ink-300" aria-hidden="true" />
                </a>
              ))}

              {!authReady ? (
                <div className="mt-2 h-12 animate-pulse rounded-xl bg-ink-100/70" aria-hidden="true" />
              ) : user ? (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2.5 rounded-xl border border-ink-200 bg-white px-4 py-3">
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-950 font-code text-[10px] font-bold text-white"
                      aria-hidden="true"
                    >
                      {initialsOf(user.name)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-ink-900">
                      {user.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onSignOut();
                      }}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-ink-200 px-3.5 text-[12.5px] font-semibold text-ink-700 transition-all hover:border-brand-300 hover:text-brand-700"
                    >
                      <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                      Sign out
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onDashboard();
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink-950 px-4 py-3.5 text-[15px] font-semibold text-white"
                  >
                    <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                    Workspace
                    <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <>
                  <Link
                    href="/org"
                    onClick={() => setOpen(false)}
                    className="mt-2 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 text-[15px] font-semibold text-white shadow-[0_8px_20px_rgba(217,38,22,0.28)] transition-all hover:bg-brand-700 hover:shadow-[0_10px_26px_rgba(217,38,22,0.36)]"
                  >
                    Supplier portal — for organizations
                    <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onGetStarted();
                    }}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 text-[15px] font-semibold text-white"
                  >
                    Get started
                    <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onSignIn();
                    }}
                    className="inline-flex h-12 items-center justify-center rounded-xl border border-ink-200 bg-white text-[15px] font-semibold text-ink-900"
                  >
                    Sign in
                  </button>
                </>
              )}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
