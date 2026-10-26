"use client";

import { useSyncExternalStore } from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}

/**
 * Labeled dark/light switch row for the dark sidebar.
 */
export function ThemeModeRow({ className, collapsed = false }: { className?: string; collapsed?: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const isDark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={collapsed ? (isDark ? "Switch to light mode" : "Switch to dark mode") : undefined}
      title={collapsed ? (isDark ? "Switch to light mode" : "Switch to dark mode") : undefined}
      className={cn(
        "flex w-full items-center rounded-xl border px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50",
        collapsed
          ? "h-11 justify-center border-ink-200 bg-white text-ink-600 hover:bg-ink-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-ink-300 dark:hover:bg-white/5"
          : "justify-between gap-3 border-ink-200 bg-white/70 hover:bg-ink-50 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/5",
        className
      )}
    >
      <span className={cn("flex items-center", collapsed ? "justify-center" : "gap-2.5")}>
        {isDark ? (
          <Moon className="h-4 w-4 text-ink-500 dark:text-ink-300" aria-hidden="true" />
        ) : (
          <Sun className="h-4 w-4 text-ink-500 dark:text-ink-300" aria-hidden="true" />
        )}
        {!collapsed ? (
          <span className="font-code text-[9px] font-semibold tracking-[0.22em] text-ink-600 dark:text-ink-300">
            DARK / LIGHT MODE
          </span>
        ) : null}
      </span>
      {!collapsed ? (
        <span
          className={cn(
            "relative h-5 w-9 shrink-0 rounded-full transition-colors",
            isDark ? "bg-brand-600" : "bg-ink-300 dark:bg-ink-600"
          )}
          aria-hidden="true"
        >
          <span
            className={cn(
              "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
              isDark ? "translate-x-[18px]" : "translate-x-0.5"
            )}
          />
        </span>
      ) : null}
    </button>
  );
}

/**
 * Sun/moon toggle. Renders a neutral placeholder until mounted so the server
 * and client markup match (next-themes only knows the theme on the client).
 */
export function ThemeToggle({
  className,
  variant = "outline",
}: {
  className?: string;
  /** "outline" for light surfaces, "ghost" for the dark sidebar. */
  variant?: "outline" | "ghost";
}) {
  const { resolvedTheme, setTheme } = useTheme();
  // False on the server and during hydration, true once the client mounts.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const isDark = mounted && resolvedTheme === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={label}
      title={label}
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors",
        variant === "outline"
          ? "border border-ink-200 bg-white text-ink-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
          : "text-ink-400 hover:bg-white/10 hover:text-white",
        className
      )}
    >
      {isDark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}
