"use client";

import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TopTicker } from "@/components/quorum/top-ticker";
import { SiteHeader } from "@/components/quorum/site-header";
import { Hero } from "@/components/quorum/hero";
import { Overview } from "@/components/quorum/overview";
import { RuleBand } from "@/components/quorum/rule-band";
import { UseCases } from "@/components/quorum/use-cases";
import { Film } from "@/components/quorum/film";
import { InsideRun } from "@/components/quorum/inside-box";
import { ReportMock } from "@/components/quorum/report-mock";
import { ProofBand } from "@/components/quorum/proof-band";
import { Pricing } from "@/components/quorum/pricing";
import { GetStarted } from "@/components/quorum/get-started";
import { SiteFooter } from "@/components/quorum/site-footer";
import { AuthScreen } from "@/components/quorum/auth-screen";
import { NoiseOverlay, ScrollProgress } from "@/components/quorum/motion-kit";
import { Dashboard } from "@/components/quorum/dashboard";
import type { AuthMode, AuthUser } from "@/lib/auth-types";

/**
 * Quorum — agentic tender review for public procurement.
 * Three views on one route: the landing page, the full-screen
 * authentication screen (#/register, #/login) and the workspace
 * (#/dashboard) — all back-button friendly via the URL hash.
 * The non-negotiable rule stands everywhere: Quorum prepares the file,
 * the committee awards the tender.
 */

/* The URL hash is the single source of truth for the active view. */
function subscribeHash(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener("hashchange", onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener("hashchange", onChange);
  };
}
const getHash = () => window.location.hash;
const getServerHash = () => "";

export default function Home() {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const hash = useSyncExternalStore(subscribeHash, getHash, getServerHash);

  const view: "landing" | "auth" | "dashboard" =
    hash === "#/register" || hash === "#/login"
      ? "auth"
      : hash === "#/dashboard"
        ? "dashboard"
        : "landing";
  const authMode: AuthMode = hash === "#/login" ? "login" : "register";

  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const scrollYRef = useRef(0);
  const prevViewRef = useRef<"landing" | "auth" | "dashboard">("landing");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* The server-verified httpOnly session is the sole source of identity. */
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("Session check failed");
        return r.json();
      })
      .then((d: { user?: AuthUser | null }) => {
        if (alive) setUser(d.user ?? null);
      })
      .catch(() => {
        if (alive) setUser(null);
      })
      .finally(() => {
        if (alive) setAuthReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  /* Scroll: save/restore when travelling between landing and auth */
  useEffect(() => {
    const prev = prevViewRef.current;
    if (view === "auth" && prev === "landing") {
      scrollYRef.current = window.scrollY;
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    } else if (view === "landing" && prev === "auth") {
      requestAnimationFrame(() => window.scrollTo(0, scrollYRef.current));
    }
    prevViewRef.current = view;
  }, [view]);

  /* A signed-out visitor deep-linking #/dashboard lands on sign-in instead */
  useEffect(() => {
    if (view === "dashboard" && authReady && !user) {
      window.history.replaceState(null, "", "#/login");
      bump();
    }
  }, [view, authReady, user, bump]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3400);
  }, []);

  const openAuth = useCallback((mode: AuthMode) => {
    if (window.location.hash !== `#/${mode}`) {
      window.location.hash = `/${mode}`; // fires hashchange → snapshot updates
    }
  }, []);

  const changeAuthMode = useCallback(
    (mode: AuthMode) => {
      // replaceState doesn't fire hashchange — bump the snapshot manually
      window.history.replaceState(null, "", `#/${mode}`);
      bump();
    },
    [bump]
  );

  const closeAuth = useCallback(() => {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    bump();
  }, [bump]);

  const handleAuthSuccess = useCallback((u: AuthUser) => {
    setUser(u);
  }, []);

  const enterWorkspace = useCallback(() => {
    if (window.location.hash !== "#/dashboard") {
      window.location.hash = "/dashboard"; // fires hashchange → snapshot updates
    }
  }, []);

  const exitDashboard = useCallback(() => {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    bump();
  }, [bump]);

  const handleCloseAuth = useCallback(() => {
    closeAuth();
    showToast(user ? `ACCESS GRANTED — SIGNED IN AS ${user.name.toUpperCase()}` : "");
  }, [closeAuth, showToast, user]);

  const signOut = useCallback(() => {
    fetch("/api/auth/logout", { method: "POST" })
      .catch(() => undefined)
      .finally(() => {
        setUser(null);
        showToast("SESSION CLOSED — SEE YOU AT THE NEXT RUN");
      });
  }, [showToast]);

  return (
    <>
      <AnimatePresence mode="wait" initial={false}>
        {view === "landing" ? (
          <motion.div
            key="landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.22 } }}
            transition={{ duration: 0.4 }}
          >
            <div className="flex min-h-screen flex-col bg-paper font-body text-ink-900 antialiased">
              <NoiseOverlay />
              <TopTicker />
              <SiteHeader
                user={user}
                authReady={authReady}
                onGetStarted={() => openAuth("register")}
                onSignIn={() => openAuth("login")}
                onSignOut={signOut}
                onDashboard={enterWorkspace}
              />
              <ScrollProgress />
              <main className="w-full flex-1">
                <Hero onGetStarted={() => openAuth("register")} />
                <Overview />
                <RuleBand />
                <UseCases />
                <Film />
                <InsideRun />
                <ReportMock />
                <ProofBand />
                <Pricing />
                <GetStarted
                  user={user}
                  onCreateAccount={() => openAuth("register")}
                  onSignIn={() => openAuth("login")}
                />
              </main>
              <SiteFooter />
            </div>
          </motion.div>
        ) : view === "auth" ? (
          <motion.div
            key="auth"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.18 } }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            <AuthScreen
              mode={authMode}
              onModeChange={changeAuthMode}
              onSuccess={handleAuthSuccess}
              onEnterWorkspace={enterWorkspace}
              onClose={handleCloseAuth}
            />
          </motion.div>
        ) : (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.18 } }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            <Dashboard
              user={user}
              onSignOut={signOut}
              onToast={showToast}
              onExit={exitDashboard}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            role="status"
            className="fixed bottom-5 left-5 z-[100] flex items-center gap-3 rounded-xl bg-ink-950 px-4 py-3 shadow-[0_18px_50px_rgba(11,12,15,0.4)]"
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
            <p className="font-code text-[10.5px] font-semibold tracking-[0.14em] text-white">
              {toast}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
