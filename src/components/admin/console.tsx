"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  Building2,
  ClipboardCheck,
  Command,
  Cpu,
  Download,
  LayoutDashboard,
  LogOut,
  LifeBuoy,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  ScrollText,
  Search,
  Stamp,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { QuorumLogo } from "@/components/quorum/logo";
import { ThemeToggle } from "@/components/quorum/theme-toggle";
import { HorizontalScrollRegion } from "@/components/quorum/horizontal-scroll-region";
import { cn } from "@/lib/utils";
import { preferredScrollBehavior, trapTabFocus } from "@/lib/a11y";
import { systemReferenceLabel } from "@/lib/system-reference";
import type { AdminOverview } from "@/lib/admin-types";
import { Chip, Dot, Skeleton, TONE, type Tone } from "@/components/admin/kit";
import { SECTIONS, isAdminSection, type AdminSection, type ToastTone } from "@/components/admin/types";
import { DeckPanel } from "@/components/admin/deck-panel";
import { PeoplePanel } from "@/components/admin/people-panel";
import { OrganizationsPanel } from "@/components/admin/orgs-panel";
import { WorkPanel } from "@/components/admin/work-panel";
import { GatesPanel } from "@/components/admin/gates-panel";
import { AuditPanel } from "@/components/admin/audit-panel";
import { SystemPanel } from "@/components/admin/system-panel";
import { SupportPanel } from "@/components/admin/support-panel";

/**
 * Workspace administration.
 *
 * One window over every surface of the desk — the officer roster, the supplier
 * door, the review runs, the human gates, and the hash-chained spine that
 * records all of it. Reads come from a single guarded snapshot; every write
 * goes through the same enforced endpoint the workspace uses, so this console
 * can never become a softer way in.
 */

const ICONS: Record<AdminSection, LucideIcon> = {
  deck: LayoutDashboard,
  people: Users,
  orgs: Building2,
  work: ClipboardCheck,
  gates: Stamp,
  audit: ScrollText,
  system: Cpu,
  support: LifeBuoy,
};

type Toast = { id: number; message: string; tone: ToastTone };

function readableStatus(status: string): string {
  const labels: Record<string, string> = {
    AWAITING_GATE: "Awaiting approval",
    AWAITING_SECOND: "Awaiting second approval",
    EXECUTED: "Approved",
    FAILED: "Could not complete",
    FILED: "Complete",
    PENDING: "Awaiting approval",
    REJECTED: "Returned",
    RUNNING: "In progress",
  };
  return labels[status] ?? status.replace(/_/g, " ").toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function AdminConsole({ user }: { user: { id: string; name: string; email: string; role: string } }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoaded, setLastLoaded] = useState<number | null>(null);
  const [live, setLive] = useState(true);
  const [section, setSection] = useState<AdminSection>("deck");
  const [navCollapsed, setNavCollapsed] = useState(false);
  useEffect(() => {
    try {
      setNavCollapsed(window.localStorage.getItem("quorum.navCollapsed") === "1");
    } catch {
      /* private mode — start with the full rail */
    }
  }, []);
  const setNavCollapsedPersisted = useCallback((collapsed: boolean) => {
    setNavCollapsed(collapsed);
    try {
      window.localStorage.setItem("quorum.navCollapsed", collapsed ? "1" : "0");
    } catch {
      /* private mode — the choice simply won't survive reloads */
    }
  }, []);
  const [queries, setQueries] = useState<Record<AdminSection, string>>({
    deck: "",
    people: "",
    orgs: "",
    work: "",
    gates: "",
    audit: "",
    system: "",
    support: "",
  });
  const [now, setNow] = useState(() => Date.now());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteReturnFocusRef = useRef<HTMLElement | null>(null);
  const mainContentRef = useRef<HTMLElement | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const hasLoaded = useRef(false);

  const openPalette = useCallback((trigger?: HTMLElement | null) => {
    const activeElement =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    const visibleSearchTrigger = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-admin-search-trigger]"),
    ).find((button) => button.getClientRects().length > 0);
    paletteReturnFocusRef.current = trigger ?? activeElement ?? visibleSearchTrigger ?? null;
    setPaletteOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    requestAnimationFrame(() => {
      const trigger = paletteReturnFocusRef.current;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
  }, []);

  const notify = useCallback((message: string, tone: ToastTone = "info") => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((prev) => [...prev.slice(-3), { id, message, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 5200);
  }, []);

  const refresh = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch("/api/admin/overview", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/#/login";
        return;
      }
      const body = (await res.json().catch(() => ({}))) as AdminOverview & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "The administration workspace could not be loaded.");
      setData(body);
      setError(null);
      setLastLoaded(Date.now());
      hasLoaded.current = true;
    } catch (err) {
      setError((err as Error).message || "The administration workspace could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* Section follows the URL hash, so every panel is linkable and the back
     button behaves like a page — the console is an instrument, not a wizard. */
  useEffect(() => {
    const read = () => {
      const raw = window.location.hash.replace(/^#\/?/, "");
      setSection(isAdminSection(raw) ? raw : "deck");
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  /* A quiet cadence, never a hidden one: the switch in the top bar turns it
     off, and a background tab is left alone. */
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, 20_000);
    return () => clearInterval(id);
  }, [live, refresh]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (paletteOpen) closePalette();
        else openPalette();
      }
      if (event.key === "/" && !paletteOpen) {
        const target = event.target as HTMLElement | null;
        const typing =
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable);
        if (!typing) {
          event.preventDefault();
          openPalette();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closePalette, openPalette, paletteOpen]);

  const navigate = useCallback((next: AdminSection, query?: string) => {
    if (query !== undefined) setQueries((prev) => ({ ...prev, [next]: query }));
    if (window.location.hash !== `#${next}`) window.location.hash = next;
    setSection(next);
    setPaletteOpen(false);
    window.scrollTo({ top: 0, behavior: preferredScrollBehavior() });
    requestAnimationFrame(() => mainContentRef.current?.focus({ preventScroll: true }));
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/";
    }
  }, []);

  const counts = useMemo(() => {
    if (!data) return {} as Record<AdminSection, number | undefined>;
    const pending = data.desk.gates.filter(
      (gate) => gate.status === "PENDING" || gate.status === "AWAITING_SECOND",
    ).length;
    return {
      deck: undefined,
      people: data.people.length,
      orgs: data.organizations.length,
      work: data.desk.runs.length,
      gates: pending,
      audit: data.desk.audit.allTotal,
      system: undefined,
      support: data.supportRequests.filter((request) => request.status === "OPEN").length,
    };
  }, [data]);

  const current = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];

  useEffect(() => {
    const previous = document.title;
    document.title = `${current.label} · Quorum Administration`;
    return () => {
      document.title = previous;
    };
  }, [current.label]);

  const panel = (() => {
    if (!data) return null;
    const props = {
      data,
      refresh,
      notify,
      query: queries[section],
      setQuery: (value: string) => setQueries((prev) => ({ ...prev, [section]: value })),
      now,
      navigate,
    };
    switch (section) {
      case "people":
        return <PeoplePanel {...props} />;
      case "orgs":
        return <OrganizationsPanel {...props} />;
      case "work":
        return <WorkPanel {...props} />;
      case "gates":
        return <GatesPanel {...props} />;
      case "audit":
        return <AuditPanel {...props} />;
      case "system":
        return <SystemPanel {...props} />;
      case "support":
        return <SupportPanel {...props} />;
      default:
        return <DeckPanel {...props} />;
    }
  })();

  return (
    <div className="admin-surface admin-workspace-canvas min-h-screen font-body text-ink-900 antialiased">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[90] focus:rounded-lg focus:bg-ink-950 focus:px-4 focus:py-2 focus:text-[13px] focus:font-semibold focus:text-white"
      >
        Skip to administration
      </a>
      <div className={cn("lg:grid", navCollapsed ? "lg:grid-cols-1" : "lg:grid-cols-[252px_minmax(0,1fr)]")}>
        {/* ── Rail ─────────────────────────────────────────────────────── */}
        {!navCollapsed && <aside className="sidebar-rail-surface relative hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
          <button
            type="button"
            onClick={() => setNavCollapsedPersisted(true)}
            aria-label="Collapse sidebar"
            title="Collapse the sidebar"
            className="focus-brand absolute right-3 top-5 z-10 grid h-11 w-11 place-items-center rounded-lg text-ink-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          </button>
          <div className="border-b border-white/10 px-5 py-5 pr-14">
            <QuorumLogo variant="light" tagline={false} />
            <p className="mt-3 font-code text-[10px] font-bold uppercase tracking-[0.12em] text-brand-300">
              ADMINISTRATION
            </p>
          </div>

          <nav aria-label="Administration sections" className="flex-1 overflow-y-auto px-2.5 py-4">
            <p className="px-2.5 pb-2 font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-300">
              ADMINISTRATION
            </p>
            <ul className="space-y-1">
              {SECTIONS.map((item) => {
                const Icon = ICONS[item.id];
                const active = item.id === section;
                const count = counts[item.id];
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => navigate(item.id)}
                      aria-current={active ? "page" : undefined}
                      title={item.label}
                      className={cn(
                        "focus-brand group relative flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                        active
                          ? "bg-white/[0.07] text-white ring-1 ring-inset ring-white/10"
                          : "text-ink-400 hover:bg-white/[0.04] hover:text-white",
                      )}
                    >
                      {active && (
                        <span className="absolute bottom-2 left-0 top-2 w-[2px] rounded-r bg-brand-500" aria-hidden="true" />
                      )}
                      <Icon className={cn("h-4 w-4 shrink-0", active ? "text-brand-400" : "text-ink-300")} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{item.label}</span>
                      {count !== undefined && (
                        <span
                          className={cn(
                            "rounded-full px-2 py-1 font-code text-[10px] font-bold tabular",
                            active
                              ? "bg-white/10 text-white"
                              : (item.id === "gates" || item.id === "support") && count > 0
                                ? "bg-brand-500/15 text-brand-300"
                                : "bg-white/[0.05] text-ink-400",
                          )}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>

          </nav>

          <div className="border-t border-white/10 px-3 py-3">
            <div className="flex items-center gap-2.5 px-1.5 pb-2.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 font-code text-[10px] font-bold text-white">
                {initials(user.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11.5px] font-semibold text-white">{user.name}</p>
                <p className="truncate text-[10px] font-semibold text-ink-300">
                  {user.role} · {user.email}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <ThemeToggle variant="ghost" />
              <a
                href="/#/dashboard"
                title="Return to the workspace"
                className="focus-brand grid h-11 w-11 place-items-center rounded-lg text-ink-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Return to the workspace</span>
              </a>
              <button
                type="button"
                onClick={() => void signOut()}
                title="Sign out"
                className="focus-brand ml-auto grid h-11 w-11 place-items-center rounded-lg text-ink-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Sign out</span>
              </button>
            </div>
          </div>
        </aside>}

        {/* ── Work surface ─────────────────────────────────────────────── */}
        <div className="min-w-0">
          <header className="sticky top-0 z-40 border-b border-ink-200/80 bg-paper/85 backdrop-blur-xl dark:border-white/10">
            <div className="mx-auto flex w-full max-w-[1500px] items-center gap-2 px-4 py-2.5 sm:px-6 lg:px-8">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <a href="/admin" className="lg:hidden" aria-label="Administration home">
                  <span className="grid h-11 w-11 place-items-center rounded-lg bg-ink-950">
                    <span className="h-2 w-2 rounded-full bg-brand-500" aria-hidden="true" />
                  </span>
                </a>
                {navCollapsed && (
                  <button
                    type="button"
                    onClick={() => setNavCollapsedPersisted(false)}
                    aria-label="Expand sidebar"
                    title="Expand the sidebar"
                    className="focus-brand hidden h-11 w-11 shrink-0 place-items-center rounded-lg border border-ink-200 bg-white text-ink-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 lg:grid dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-400"
                  >
                    <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
                <div className="min-w-0">
                  <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">
                    QUORUM · ADMINISTRATION
                  </p>
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12.5px] font-semibold text-ink-950">{current.label}</span>
                    <span className="hidden text-[10px] text-ink-600 sm:inline">
                      / {String(data?.desk.audit.allTotal ?? 0)} RECORDED ACTIONS
                    </span>
                  </div>
                </div>
              </div>

              <div className="hidden items-center gap-2 md:flex">
                <SnapshotLine
                  offline={data ? !data.desk.online : false}
                  lastLoaded={lastLoaded}
                  now={now}
                />
                <span className="h-5 w-px bg-ink-200 dark:bg-white/10" aria-hidden="true" />
              </div>

              <button
                type="button"
                onClick={() => setLive((value) => !value)}
                role="switch"
                aria-checked={live}
                title={live ? "Auto-refresh every 20 seconds — click to pause" : "Auto-refresh paused — click to resume"}
                className={cn(
                  "focus-brand inline-flex min-h-11 items-center gap-2 rounded-full border px-3 font-code text-[10px] font-bold uppercase tracking-[0.06em] transition-colors",
                  live
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                    : "border-ink-200 bg-white text-ink-500 dark:border-white/12 dark:bg-white/[0.04] dark:text-ink-400",
                )}
              >
                <Dot tone={live ? "emerald" : "neutral"} pulse={live} />
                {live ? "LIVE" : "PAUSED"}
              </button>

              <button
                type="button"
                onClick={() => void refresh(true)}
                disabled={refreshing}
                title="Refresh the snapshot"
                className="focus-brand grid h-11 w-11 place-items-center rounded-lg border border-ink-200 bg-white text-ink-600 transition-colors hover:border-ink-400 hover:text-ink-950 disabled:opacity-50 dark:border-white/12 dark:bg-white/[0.04] dark:text-ink-400 dark:hover:border-white/25 dark:hover:text-white"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} aria-hidden="true" />
                <span className="sr-only">Refresh</span>
              </button>

              <button
                type="button"
                onClick={(event) => openPalette(event.currentTarget)}
                data-admin-search-trigger
                className="focus-brand hidden min-h-11 items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 text-ink-500 transition-colors hover:border-ink-400 hover:text-ink-950 sm:inline-flex dark:border-white/12 dark:bg-white/[0.04] dark:text-ink-400 dark:hover:border-white/25 dark:hover:text-white"
              >
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="font-code text-[10px] font-bold uppercase tracking-[0.06em]">Search</span>
                <kbd className="rounded border border-ink-200 bg-ink-50 px-1.5 py-1 font-code text-[10px] font-bold text-ink-600 dark:border-white/10 dark:bg-white/[0.06] dark:text-ink-300">
                  ⌘K
                </kbd>
              </button>
              <button
                type="button"
                onClick={(event) => openPalette(event.currentTarget)}
                data-admin-search-trigger
                aria-label="Search administration"
                className="focus-brand grid h-11 w-11 place-items-center rounded-lg border border-ink-200 bg-white text-ink-500 sm:hidden dark:border-white/12 dark:bg-white/[0.04] dark:text-ink-400"
              >
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            {/* Mobile section strip */}
            <nav aria-label="Control room sections" className="border-t border-ink-100 px-2 py-1.5 lg:hidden dark:border-white/8">
              <HorizontalScrollRegion
                label="Administration sections"
                hint="Swipe or scroll to see every section. Focus this row and use the arrow keys to scroll."
                hintClassName="px-2 py-1 text-[10.5px]"
                className="flex gap-1 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {SECTIONS.map((item) => {
                  const active = item.id === section;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigate(item.id)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "focus-brand inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3 py-2 font-code text-[10px] font-bold uppercase tracking-[0.06em] transition-colors",
                        active
                          ? "bg-ink-950 text-white dark:bg-white dark:text-[#0b0c0f]"
                          : "text-ink-500 hover:bg-ink-100 dark:hover:bg-white/[0.06]",
                      )}
                    >
                      {item.label}
                      {counts[item.id] !== undefined && (
                        <span className={cn("tabular", active ? "opacity-80" : "text-ink-400")}>
                          {counts[item.id]}
                        </span>
                      )}
                    </button>
                  );
                })}
              </HorizontalScrollRegion>
            </nav>
          </header>

          <main
            id="admin-main"
            ref={mainContentRef}
            tabIndex={-1}
            aria-label={`${current.label} section`}
            className="mx-auto w-full max-w-[1500px] px-4 pb-24 pt-6 outline-none sm:px-6 lg:px-8"
          >
            {!data && loading ? (
              <ConsoleSkeleton />
            ) : !data ? (
              <div className="panel rounded-2xl px-6 py-10">
                <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-brand-700">
                  Snapshot unavailable
                </p>
                <h1 className="mt-2 font-display text-[24px] font-black tracking-[-0.02em] text-ink-950">
                  The administration workspace could not load its data.
                </h1>
                <p className="mt-2 max-w-[60ch] text-[12.5px] leading-relaxed text-ink-500">
                  {error ?? "The snapshot request failed."} No data was shown rather than stale data being passed
                  off as current.
                </p>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="focus-brand mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-ink-950 px-4 py-2 font-code text-[10px] font-bold uppercase tracking-[0.08em] text-white"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  TRY AGAIN
                </button>
              </div>
            ) : (
              <>
                {error && (
                  <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-[11.5px] leading-relaxed text-brand-900 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200">
                    <Dot tone="brand" />
                    <p>
                      The last refresh failed — showing the snapshot from {lastLoaded ? new Date(lastLoaded).toLocaleTimeString("en-GB") : "earlier"}. {error}
                    </p>
                  </div>
                )}
                {panel}
              </>
            )}
          </main>

          <footer className="mx-auto flex w-full max-w-[1500px] flex-wrap items-center justify-between gap-3 border-t border-ink-200/70 px-4 py-5 text-[10px] font-semibold text-ink-600 sm:px-6 lg:px-8 dark:border-white/10">
            <span>QUORUM · ADMINISTRATION · {data?.actor.role ?? user.role} ACCESS</span>
            <span className="flex items-center gap-3">
              <a href="/" className="focus-brand inline-flex min-h-11 items-center px-2 hover:text-ink-950 dark:hover:text-white">Landing</a>
              <a href="/#/dashboard" className="focus-brand inline-flex min-h-11 items-center px-2 hover:text-ink-950 dark:hover:text-white">Workspace</a>
              <a
                href="/api/log/export?XTransformPort=3031"
                className="focus-brand inline-flex min-h-11 items-center px-2 hover:text-ink-950 dark:hover:text-white"
              >
                AUDIT EXPORT
              </a>
            </span>
          </footer>
        </div>
      </div>

      {paletteOpen && data && (
        <CommandPalette
          data={data}
          onClose={closePalette}
          onNavigate={navigate}
          onRefresh={() => void refresh(true)}
        />
      )}

      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[170] flex w-[min(92vw,380px)] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="panel pointer-events-auto flex items-start gap-2.5 rounded-xl px-3.5 py-2.5"
          >
            <span className="mt-1">
              <Dot tone={toast.tone === "ok" ? "emerald" : toast.tone === "error" ? "red" : "brand"} />
            </span>
            <p className="text-[11.5px] font-medium leading-relaxed text-ink-900">{toast.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "Q"
  );
}

function SnapshotLine({
  offline,
  lastLoaded,
  now,
}: {
  offline: boolean;
  lastLoaded: number | null;
  now: number;
}) {
  const age = lastLoaded ? Math.max(0, Math.round((now - lastLoaded) / 1000)) : null;
  return (
    <div className="text-right">
      <p className="font-code text-[10px] font-bold uppercase tracking-[0.08em] text-ink-600">Snapshot</p>
      <p className="text-[10.5px] font-semibold text-ink-700">
        {offline ? (
          <span className="text-brand-700">RUNTIME OFFLINE</span>
        ) : lastLoaded ? (
          `${new Date(lastLoaded).toLocaleTimeString("en-GB")} · ${age !== null && age < 60 ? `${age}s` : `${Math.round((age ?? 0) / 60)}m`} ago`
        ) : (
          "—"
        )}
      </p>
    </div>
  );
}

function ConsoleSkeleton() {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-10 w-[min(100%,460px)]" />
        <Skeleton className="h-3 w-[min(100%,620px)]" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-[128px] rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-12">
        <div className="space-y-5 xl:col-span-8">
          <Skeleton className="h-[280px] rounded-2xl" />
          <Skeleton className="h-[260px] rounded-2xl" />
        </div>
        <div className="space-y-5 xl:col-span-4">
          <Skeleton className="h-[220px] rounded-2xl" />
          <Skeleton className="h-[220px] rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

/* ── Command palette ────────────────────────────────────────────────────── */

type PaletteResult = {
  id: string;
  group: string;
  label: string;
  sub: string;
  section?: AdminSection;
  query?: string;
  action?: "refresh" | "export" | "workspace";
  icon: ReactNode;
};

function CommandPalette({
  data,
  onClose,
  onNavigate,
  onRefresh,
}: {
  data: AdminOverview;
  onClose: () => void;
  onNavigate: (section: AdminSection, query?: string) => void;
  onRefresh: () => void;
}) {
  const [value, setValue] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const trapPaletteTab = (event: ReactKeyboardEvent<HTMLDivElement>) =>
    trapTabFocus(event, dialogRef.current);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const results = useMemo<PaletteResult[]>(() => {
    const needle = value.trim().toLowerCase();
    const out: PaletteResult[] = [];
    const push = (result: PaletteResult) => {
      if (!needle || `${result.label} ${result.sub}`.toLowerCase().includes(needle)) out.push(result);
    };

    push({
      id: "action-refresh",
      group: "ACTIONS",
      label: "Refresh the snapshot",
      sub: "Read every surface again, now",
      action: "refresh",
      icon: <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />,
    });
    push({
      id: "action-export",
      group: "ACTIONS",
      label: "Export the audit package",
      sub: "Complete activity history, oldest first",
      action: "export",
      icon: <Download className="h-3.5 w-3.5" aria-hidden="true" />,
    });
    push({
      id: "action-workspace",
      group: "ACTIONS",
      label: "Open the workspace",
      sub: "Return to the procurement workspace",
      action: "workspace",
      icon: <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />,
    });

    for (const section of SECTIONS) {
      push({
        id: `section-${section.id}`,
        group: "SECTIONS",
        label: section.label,
        sub: section.blurb,
        section: section.id,
        icon: <Command className="h-3.5 w-3.5" aria-hidden="true" />,
      });
    }

    if (needle) {
      for (const person of data.people.slice(0, 40)) {
        push({
          id: `person-${person.id}`,
          group: "PEOPLE",
          label: person.name,
          sub: `${person.role} · ${person.email}`,
          section: "people",
          query: person.name,
          icon: <Users className="h-3.5 w-3.5" aria-hidden="true" />,
        });
      }
      for (const org of data.organizations.slice(0, 40)) {
        push({
          id: `org-${org.id}`,
          group: "ORGANIZATIONS",
          label: org.name,
          sub: `${org.registrationNo} · ${org.country}`,
          section: "orgs",
          query: org.name,
          icon: <Building2 className="h-3.5 w-3.5" aria-hidden="true" />,
        });
      }
      for (const run of data.desk.runs.slice(0, 40)) {
        push({
          id: `run-${run.id}`,
          group: "TENDER REVIEWS",
          label: systemReferenceLabel(run.systemReference),
          sub: `${readableStatus(run.status)} · ${run.id}`,
          section: "work",
          query: run.systemReference ?? run.id,
          icon: <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />,
        });
      }
      for (const gate of data.desk.gates.slice(0, 40)) {
        push({
          id: `gate-${gate.id}`,
          group: "APPROVALS",
          label: `${systemReferenceLabel(gate.systemReference)} · ${readableStatus(gate.status)}`,
          sub: gate.id,
          section: "gates",
          query: gate.id,
          icon: <Stamp className="h-3.5 w-3.5" aria-hidden="true" />,
        });
      }
      for (const entry of data.desk.audit.entries.slice(0, 60)) {
        push({
          id: `audit-${entry.id}`,
          group: "AUDIT",
          label: `${entry.tool} · ${entry.actor}`,
          sub: `${entry.kind} · ${entry.status} · #${entry.seq}`,
          section: "audit",
          query: entry.tool,
          icon: <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />,
        });
      }
    }

    return out.slice(0, 26);
  }, [data, value]);

  /* Clamped at render rather than in an effect: a shorter result set must not
     need a second render just to move the highlight. */
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));

  const select = (result: PaletteResult) => {
    if (result.action === "refresh") {
      onRefresh();
      onClose();
      return;
    }
    if (result.action === "export") {
      window.open("/api/log/export?XTransformPort=3031", "_blank", "noopener");
      onClose();
      return;
    }
    if (result.action === "workspace") {
      window.location.href = "/#/dashboard";
      return;
    }
    if (result.section) onNavigate(result.section, result.query);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && results[activeIndex]) {
      event.preventDefault();
      select(results[activeIndex]);
    }
  };

  let lastGroup = "";

  return (
    <div className="fixed inset-0 z-[160] flex items-start justify-center px-4 pt-[10vh]">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink-950/60 backdrop-blur-[3px]"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="control-room-search-title"
        onKeyDown={trapPaletteTab}
        className="panel panel-lift relative w-full max-w-xl overflow-hidden rounded-2xl"
      >
        <h2 id="control-room-search-title" className="sr-only">Search administration</h2>
        <div className="flex items-center gap-2.5 border-b border-ink-100 px-4 py-3 dark:border-white/8">
          <Search className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-autocomplete="list"
            aria-activedescendant={results[activeIndex] ? `palette-${results[activeIndex].id}` : undefined}
            placeholder="Search people, tenders, approvals or audit history…"
            className="min-h-11 min-w-0 flex-1 bg-transparent text-[14px] text-ink-950 outline-none placeholder:text-ink-400 dark:text-ink-900"
          />
          <kbd className="rounded border border-ink-200 bg-ink-50 px-1.5 py-1 font-code text-[10px] font-bold text-ink-600 dark:border-white/10 dark:bg-white/[0.06] dark:text-ink-300">
            ESC
          </kbd>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="focus-brand grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-950 dark:text-ink-400 dark:hover:bg-white/[0.08] dark:hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div id="palette-results" role="listbox" aria-label="Search results" className="max-h-[54vh] overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <p className="px-4 py-8 text-center text-[11.5px] text-ink-500">
              Nothing in this snapshot matches “{value}”.
            </p>
          ) : (
            results.map((result, index) => {
              const showGroup = result.group !== lastGroup;
              lastGroup = result.group;
              return (
                <div key={result.id}>
                  {showGroup && (
                    <p className="px-4 pb-1 pt-2 font-code text-[10px] font-bold uppercase tracking-[0.08em] text-ink-600">
                      {result.group}
                    </p>
                  )}
                  <button
                    type="button"
                    id={`palette-${result.id}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === activeIndex}
                    onMouseEnter={() => setActive(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => select(result)}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors",
                      index === activeIndex
                        ? "bg-brand-50 text-ink-950 dark:bg-brand-500/10 dark:text-white"
                        : "text-ink-700 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-white/[0.04]",
                    )}
                  >
                    <span className={cn("shrink-0", index === activeIndex ? "text-brand-600" : "text-ink-400")}>
                      {result.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold">{result.label}</span>
                      <span className="block truncate text-[10.5px] text-ink-600">
                        {result.sub}
                      </span>
                    </span>
                    {result.section && (
                      <span className={cn("shrink-0 rounded-full border px-2 py-1 font-code text-[10px] font-bold uppercase tracking-[0.03em]", TONE.neutral as string)}>
                        {result.section}
                      </span>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="flex items-center justify-between border-t border-ink-100 px-4 py-2.5 text-[10px] font-semibold text-ink-600 dark:border-white/8">
          <span className="flex items-center gap-2">
            <span>↑↓ navigate</span>
            <span>↵ open</span>
          </span>
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5", TONE.neutral as string)}>
            <Dot tone="emerald" pulse />
            {data.desk.online ? "SERVICE ONLINE" : "SERVICE OFFLINE"}
          </span>
        </div>
      </div>
    </div>
  );
}

export function PanelGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-5 xl:grid-cols-12", className)}>{children}</div>;
}

export function toneForStatus(status: string): Tone {
  switch (status) {
    case "EXECUTED":
    case "FILED":
    case "ACTIVE":
    case "REINSTATED":
    case "OK":
    case "APPROVED":
      return "emerald";
    case "PENDING":
    case "AWAITING_GATE":
    case "AWAITING_SECOND":
    case "OPEN":
    case "RUNNING":
      return "amber";
    case "FAILED":
    case "SUSPENDED":
    case "BROKEN":
      return "red";
    case "REJECTED":
    case "UPHELD":
    case "SKIPPED":
      return "neutral";
    case "CLAIMED":
      return "sky";
    default:
      return "neutral";
  }
}

export function StatusChip({ status, label }: { status: string; label?: string }) {
  return (
    <Chip tone={toneForStatus(status)} dot>
      {label ?? status.replace(/_/g, " ")}
    </Chip>
  );
}
