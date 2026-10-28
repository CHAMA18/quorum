"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { ArrowRight, CircleAlert, Eye, EyeOff, FileText, Landmark, Loader2, Lock, ShieldCheck, UserRound } from "lucide-react";
import { QuorumLogo } from "@/components/quorum/logo";
import { MasterSwitcher } from "@/components/quorum/master-switcher";
import type { AuthMode, AuthUser } from "@/lib/auth-types";
import {
  completeGoogleRedirect,
  getVerifiedIdToken,
  signInWithGooglePopup,
  startEmailVerification,
  syncFirebaseIdentity,
  type GoogleSignInDenial,
} from "@/lib/firebase";
import { cn } from "@/lib/utils";

/*
 * The officer door. It is deliberately the SAME experience as the
 * organization door at /org — one visual system for both sides of the
 * desk: the night-and-grid story panel, the elevated card on ink &
 * paper (dark when the browser is), the engineering-mono micro labels,
 * ink buttons that ignite to brand red on hover. The doors differ by
 * DOOR and ACCOUNT SPACE, never by craft.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EASE = [0.22, 1, 0.36, 1] as const;

/*
 * Google sign-in denials, spelled out. The Firebase popup can fail for very
 * different reasons — the deployment's origin not being on the project's
 * authorised-domain list (the usual case for fresh deployments), the Google
 * provider being switched off in the console, a browser blocking the popup,
 * or plain cancellations — and each deserves its own honest message instead
 * of one generic "unavailable".
 */
const GOOGLE_DENIALS: Record<GoogleSignInDenial, string> = {
  "unauthorized-domain":
    "Google sign-in can't run from this address yet — this deployment's domain isn't on the Firebase project's authorised list. It's a one-step console fix (Authentication → Settings → Authorised domains — see README); locally and after that, it works. Until then, sign in with your email and password.",
  "provider-disabled":
    "Google sign-in is switched off in the Firebase console (Authentication → Sign-in method). Use your email and password.",
  "popup-blocked":
    "Your browser blocked the sign-in window. Allow popups for this site and try again, or use your email and password.",
  "popup-closed": "Google sign-in was cancelled before it finished. Try again when ready.",
  timeout: "Google sign-in didn't finish in time. Try again, or use your email and password.",
  network:
    "Google sign-in couldn't reach the network. Check your connection, or use your email and password.",
  unknown: "Google sign-in is unavailable right now. Use your email and password.",
};

function deriveName(email: string): string {
  const parts = email.split("@")[0].split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return "Procurement Officer";
  return parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

const inputCls =
  "h-11 w-full rounded-xl border border-ink-200 bg-white px-3.5 text-[14px] text-ink-950 outline-none transition-all placeholder:text-ink-300 focus:border-ink-950 focus:ring-4 focus:ring-ink-950/10 dark:bg-night-2 dark:text-white dark:placeholder:text-ink-500";

function Field({ label, error, children, hint }: { label: string; error?: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="font-code text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-500 dark:text-ink-400">
        {label}
      </span>
      {children}
      {hint ? <span className="block text-[11.5px] leading-relaxed text-ink-400 dark:text-ink-500">{hint}</span> : null}
      {error ? <span className="block text-[12px] font-medium text-brand-700 dark:text-brand-300">{error}</span> : null}
    </label>
  );
}

/* The official four-colour G — drawn inline so it stays crisp and needs no asset. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.51 6.16-4.51Z"
      />
    </svg>
  );
}

function ThemedLogo() {
  return (
    <>
      <span className="dark:hidden">
        <QuorumLogo />
      </span>
      <span className="hidden dark:inline-flex">
        <QuorumLogo variant="light" />
      </span>
    </>
  );
}

/* ── The live audit spine, from the officer's seat ───────────────────────── */

type LineKind = "cmd" | "step" | "ok" | "gate";
type LiveLogEntry = { tool?: string; status?: string };

/* Live activity from the quorum-mcp audit log — nothing scripted. */
function GateTerminal({ grantedFirstName }: { grantedFirstName: string | null }) {
  const [feed, setFeed] = useState<{ text: string; kind: LineKind }[]>([]);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const res = await fetch("/api/log?limit=8&XTransformPort=3031");
        const j = (await res.json()) as { entries?: LiveLogEntry[] };
        if (!alive) return;
        setFeed(
          (j.entries ?? []).slice(0, 8).reverse().map((e) => {
            const status = e.status ?? "";
            const kind: LineKind = status === "PENDING_GATE" ? "gate" : status === "OK" ? "ok" : "step";
            const prefix = kind === "gate" ? "⏸" : kind === "ok" ? "✓" : "▸";
            return { text: `${prefix} ${e.tool ?? "event"} · ${status || "logged"}`, kind };
          })
        );
      } catch {
        /* sidecar briefly down — keep the last snapshot */
      }
    };
    void pull();
    const id = setInterval(() => void pull(), 3500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="w-full max-w-md overflow-hidden rounded-[10px] border border-white/10 bg-night-2/90 shadow-[0_36px_90px_rgba(0,0,0,0.5)]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <p className="font-code text-[9px] font-semibold tracking-[0.22em] text-ink-400">
          OFFICER GATE · LIVE AUDIT
        </p>
        <span className="flex items-center gap-1.5 font-code text-[9px] tracking-[0.18em] text-brand-400">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-600" />
          </span>
          APPEND-ONLY
        </span>
      </div>
      <div
        className="min-h-[178px] px-4 py-4 font-code text-[10.5px] leading-[1.95] sm:text-[11.5px]"
        role="img"
        aria-label="Live terminal: a Quorum agent run ingesting a tender, checking documents, citing findings and stopping at the human gate"
      >
        {feed.map((line, i) => (
          <p
            key={`${i}-${line.text}`}
            className={cn(
              "transition-colors",
              line.kind === "cmd" && "text-ink-200",
              line.kind === "step" && "text-ink-400",
              line.kind === "ok" && "font-semibold text-white",
              line.kind === "gate" && "text-brand-300"
            )}
          >
            {line.kind === "cmd" && <span className="mr-2 text-brand-400">$</span>}
            {line.text}
          </p>
        ))}
        {feed.length === 0 && (
          <p className="text-ink-500">▸ waiting for the quorum-mcp audit log…</p>
        )}
        <span className="mt-1 inline-block h-3.5 w-[7px] animate-pulse bg-brand-500" aria-hidden="true" />
        {grantedFirstName && (
          <p className="mt-1 font-semibold text-brand-300">
            ✓ session issued — welcome, {grantedFirstName}
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Story panel (left, dark) — the organization door's composition ─────── */

function StoryPanel({ grantedFirstName }: { grantedFirstName: string | null }) {
  return (
    <aside className="relative hidden overflow-hidden bg-night lg:flex lg:flex-col lg:justify-between lg:p-12">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(640px 420px at 18% 12%, rgba(217,38,22,0.15), transparent 60%), radial-gradient(520px 380px at 82% 88%, rgba(217,38,22,0.09), transparent 60%)",
        }}
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute -left-44 top-1/3 h-[420px] w-[420px] rounded-full bg-brand-600/10 blur-[130px]" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0 bg-grid-dark opacity-60" aria-hidden="true" />

      <div className="relative flex items-center justify-between">
        <QuorumLogo variant="light" />
      </div>

      <div className="relative max-w-xl space-y-6">
        <h1 className="type-display text-[42px] text-white">
          The agent reads the file.
          <br />
          <span className="text-brand-500">You</span> still award the tender.
        </h1>
        <p className="text-[15.5px] leading-relaxed text-ink-300">
          Your account is the last mile of that promise — every run, every finding and every sign-off
          is tied to a named human. No ghost decisions, no silent awards, one audit spine.
        </p>
        <ul className="space-y-3.5">
          {[
            { icon: ShieldCheck, title: "Named-human gates", body: "Every signature is an officer's — the agent stops and waits at twenty gate points across the cycle." },
            { icon: FileText, title: "Every finding cited", body: "The agent prepares the file with citations you can open; the committee reads before it awards." },
            { icon: Landmark, title: "One audit spine", body: "Runs, gates and awards append to the same record the supplier portal reads — nothing happens silently." },
          ].map((item) => (
            <li key={item.title} className="flex gap-3.5">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-brand-400/25 bg-brand-400/10 text-brand-300">
                <item.icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-[14.5px] font-semibold text-white">{item.title}</p>
                <p className="text-[13px] leading-relaxed text-ink-400">{item.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="relative">
        <GateTerminal grantedFirstName={grantedFirstName} />
      </div>
    </aside>
  );
}

/* ── Compact brand band (mobile) ─────────────────────────────────────────── */

function MobileBrandBand() {
  return (
    <div className="relative mb-5 overflow-hidden rounded-[10px] bg-night p-5 lg:hidden">
      <div className="pointer-events-none absolute inset-0 bg-grid-dark opacity-60" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-brand-600/20 blur-[70px]" aria-hidden="true" />
      <div className="relative">
        <p className="font-code text-[9px] font-semibold tracking-[0.22em] text-brand-300">OFFICER DESK</p>
        <h2 className="type-display mt-2 text-[22px] text-white">
          The agent reads. <span className="text-brand-500">You</span> award.
        </h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-400">
          Sign in to the desk where every finding is cited and every award carries a named human&apos;s
          signature.
        </p>
      </div>
    </div>
  );
}

/* ── Password discipline ─────────────────────────────────────────────────── */

const PW_CHECKS: { label: string; test: (pw: string) => boolean }[] = [
  { label: "8+ CHARS", test: (pw) => pw.length >= 8 },
  { label: "NUMBER", test: (pw) => /\d/.test(pw) },
  { label: "UPPER + LOWER", test: (pw) => /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
  { label: "SYMBOL", test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

const PW_META = [
  { label: "AWAITING INPUT", seg: "bg-ink-300" },
  { label: "WEAK", seg: "bg-brand-600" },
  { label: "FAIR", seg: "bg-brand-400" },
  { label: "GOOD", seg: "bg-ink-500" },
  { label: "STRONG", seg: "bg-ink-950" },
];

/* ── Verify panel — the inbox checkpoint ─────────────────────────────────── */

function VerifyPanel({
  email,
  busy,
  note,
  onCheck,
  onResend,
  onBack,
}: {
  email: string;
  busy: boolean;
  note: string | null;
  onCheck: () => void;
  onResend: () => void;
  onBack: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, transition: { duration: 0.18 } }}
      transition={{ duration: 0.28, ease: EASE }}
    >
      <div className="flex items-baseline justify-between">
        <p className="font-code text-[9px] font-semibold tracking-[0.2em] text-ink-400">OFFICER ACCESS</p>
        <p className="font-code text-[9px] font-semibold tracking-[0.2em] text-ink-400">FIG. 03 — VERIFY</p>
      </div>          <h2 className="type-display mt-5 text-[26px] text-ink-950 dark:text-white">
        Check your inbox<span className="text-brand-600">.</span>
      </h2>
      <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-600 dark:text-ink-300">
        We sent a verification link to <span className="font-semibold text-ink-900 dark:text-white">{email}</span>. Open it,
        then come back here to continue.
      </p>
      {note && (
        <p role="status" className="mt-4 rounded-xl border border-ink-200 bg-sand px-3.5 py-2.5 text-[12.5px] font-medium leading-snug text-ink-700 dark:bg-ink-900/40 dark:text-ink-200">
          {note}
        </p>
      )}
      <button
        type="button"
        onClick={onCheck}
        disabled={busy}
        className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink-950 text-[14px] font-semibold text-white shadow-[0_8px_20px_rgba(11,12,15,0.18)] transition-all hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4" aria-hidden="true" />}
        I&apos;ve verified my email
      </button>
      <button
        type="button"
        onClick={onResend}
        disabled={busy}
        className="mt-2.5 inline-flex h-11 w-full items-center justify-center rounded-xl border border-ink-200 text-[13.5px] font-semibold text-ink-700 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-ink-200 dark:hover:bg-ink-900"
      >
        Resend verification email
      </button>
      <button
        type="button"
        onClick={onBack}
        className="mt-4 w-full text-center text-[12.5px] font-semibold text-brand-700 underline decoration-brand-300 underline-offset-4 transition-colors hover:text-brand-800 dark:text-brand-300 dark:decoration-brand-800 dark:hover:text-brand-200"
      >
        Use a different email
      </button>
    </motion.div>
  );
}

/* ── Success panel — the stamp ───────────────────────────────────────────── */

function SuccessPanel({
  user,
  mode,
  onClose,
  onEnterWorkspace,
}: {
  user: AuthUser;
  mode: AuthMode;
  onClose: () => void;
  onEnterWorkspace: () => void;
}) {
  const firstName = user.name.trim().split(/\s+/)[0];
  const autoEnter = mode === "login";
  const enteredRef = useRef(false);

  const enter = () => {
    if (enteredRef.current) return;
    enteredRef.current = true;
    onEnterWorkspace();
  };

  /* Sign-ins open the workspace automatically — no extra click. */
  useEffect(() => {
    if (!autoEnter) return;
    const t = setTimeout(enter, 1900);
    return () => clearTimeout(t);
  }, [autoEnter]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="text-center"
      aria-live="polite"
    >
      <motion.div
        initial={{ scale: 2.3, opacity: 0, rotate: -17 }}
        animate={{ scale: 1, opacity: 1, rotate: -6 }}
        transition={{ type: "spring", stiffness: 240, damping: 16, delay: 0.18 }}
        className="mx-auto inline-block rounded-lg border-[3px] border-brand-600 px-6 py-3 shadow-[0_20px_50px_rgba(217,38,22,0.28)]"
      >
        <p className="type-display text-[19px] tracking-[0.1em] text-brand-600 sm:text-[22px]">
          ACCESS GRANTED
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.34, ease: EASE }}
      >
        <h2 className="type-display mt-7 text-[24px] text-ink-950 dark:text-white">
          {mode === "register" ? (
            <>
              Account opened<span className="text-brand-600">.</span>
            </>
          ) : (
            <>
              Welcome back<span className="text-brand-600">,</span>
            </>
          )}{" "}
          {firstName}.
        </h2>
        <p className="mx-auto mt-2.5 max-w-sm text-[13.5px] leading-relaxed text-ink-600 dark:text-ink-300">
          {mode === "register"
            ? "Your workspace is live. Connect a portal, map your checklist — and remember: the committee still holds the pen."
            : "The file is where you left it. Every finding still cited, every gate still human."}
        </p>

        {autoEnter && (
          <div className="mx-auto mt-6 w-full max-w-sm" aria-hidden="true">
            <div className="flex items-center justify-between font-code text-[8.5px] tracking-[0.2em] text-ink-400">
              <span>OPENING WORKSPACE</span>
              <span>SESSION · HTTPONLY</span>
            </div>
            <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
              <motion.div
                initial={{ width: "4%" }}
                animate={{ width: "100%" }}
                transition={{ duration: 1.85, ease: "linear" }}
                className="h-full rounded-full bg-brand-600"
              />
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={enter}
          className="group mt-6 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-ink-950 px-7 text-[15px] font-semibold text-white shadow-[0_8px_20px_rgba(11,12,15,0.18)] transition-all hover:bg-brand-600"
        >
          Enter workspace
          <ArrowRight
            className="h-4.5 w-4.5 transition-transform group-hover:translate-x-1"
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mt-3.5 text-[13px] font-semibold text-ink-500 underline decoration-ink-300 underline-offset-4 transition-colors hover:text-brand-700 hover:decoration-brand-400 dark:text-ink-400 dark:decoration-ink-700 dark:hover:text-brand-300"
        >
          Back to the site
        </button>

        <dl className="mx-auto mt-7 grid max-w-sm grid-cols-3 divide-x divide-ink-100 rounded-[12px] border border-ink-200/70 bg-white dark:border-white/10 py-4 dark:bg-night-2">
          {[
            ["SESSION", "HTTPONLY"],
            ["PASSWORD", "SCRYPT"],
            ["GATE", "HUMAN"],
          ].map(([k, v]) => (
            <div key={k} className="px-2">
              <dt className="font-code text-[8.5px] tracking-[0.22em] text-ink-400">{k}</dt>
              <dd className="mt-1 font-code text-[11px] font-bold tracking-[0.06em] text-ink-950 dark:text-white">
                {v}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-4 font-code text-[8.5px] tracking-[0.2em] text-ink-400">
          SIGNED IN AS {user.email.toUpperCase()}
        </p>
      </motion.div>
    </motion.div>
  );
}

/* ── The screen ──────────────────────────────────────────────────────────── */

interface AuthScreenProps {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onSuccess: (user: AuthUser) => void;
  onEnterWorkspace: () => void;
  onClose: () => void;
}

export function AuthScreen({ mode, onModeChange, onSuccess, onEnterWorkspace, onClose }: AuthScreenProps) {
  const [values, setValues] = useState({ name: "", email: "", organization: "", inviteCode: "", password: "" });
  const [remember, setRemember] = useState(true);
  const [terms, setTerms] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<"form" | "sending" | "success" | "verify">("form");
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null);
  const [verifyNote, setVerifyNote] = useState<string | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  /* Credentials kept in memory only, so "Resend" can re-open the Firebase identity. */
  const pendingRef = useRef<{ name: string; email: string; password: string } | null>(null);
  const [granted, setGranted] = useState<AuthUser | null>(null);
  const [googleFlow, setGoogleFlow] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetStatus, setResetStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [resetError, setResetError] = useState<string | null>(null);
  const redirectHandled = useRef(false);
  const shake = useAnimationControls();

  const pwScore = PW_CHECKS.filter((c) => c.test(values.password)).length;
  const pwMeta = PW_META[pwScore];
  const firstName = granted?.name.trim().split(/\s+/)[0] ?? null;

  function set(field: keyof typeof values, v: string) {
    setValues((prev) => ({ ...prev, [field]: v }));
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (mode === "login") {
      if (!EMAIL_RE.test(values.email.trim())) e.email = "Enter your work email.";
      if (values.password.length === 0) e.password = "Enter your password.";
    }
    if (mode === "register") {
      if (values.name.trim().length < 2) e.name = "Enter your full name.";
      if (!terms) e.terms = "Please accept the terms to continue.";
      if (!EMAIL_RE.test(values.email.trim())) e.email = "Enter a valid work email.";
      if (values.password.length < 8) e.password = "Use at least 8 characters.";
    }
    return e;
  }

  function grant(u: AuthUser) {
    setGranted(u);
    setStatus("success");
    onSuccess(u);
  }

  /* Exchange a Google identity (popup or redirect) for a product session. */
  async function exchangeGoogleIdentity(idToken: string): Promise<boolean> {
    try {
      const res = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const data = (await res.json().catch(() => null)) as
        | { user?: AuthUser; error?: string }
        | null;
      if (res.ok && data?.user) {
        grant(data.user);
        return true;
      }
      setFormError(
        data?.error ?? "Google sign-in could not be confirmed. Try again or use your email."
      );
    } catch {
      setFormError("Cannot reach the server. Check your connection and try again.");
    }
    return false;
  }

  /* A Google sign-in that completed via the redirect flow (popup blocked,
   * then redirected) lands here after Google bounces back and the page
   * reloads. Nothing to consume on every normal load. */
  useEffect(() => {
    if (redirectHandled.current) return;
    redirectHandled.current = true;
    void (async () => {
      const result = await completeGoogleRedirect();
      if (!result || result.status !== "ok") return;
      setGoogleFlow(true);
      setStatus("sending");
      const ok = await exchangeGoogleIdentity(result.identity.idToken);
      setGoogleFlow(false);
      if (!ok) setStatus("form");
    })();
  }, []);

  /* Send (or re-send) the Firebase verification email, then show the verify step. */
  async function beginVerification(creds: { name: string; email: string; password: string }) {
    pendingRef.current = creds;
    setVerifyEmail(creds.email);
    setVerifyNote(null);
    setVerifyBusy(true);
    setStatus("verify");
    const state = await startEmailVerification(creds);
    setVerifyNote(
      state === null
        ? "We couldn't reach Firebase to send the verification email. Use Resend in a moment."
        : state.verified
          ? "This email is already verified. Continue to finish signing in."
          : `Verification link sent to ${creds.email}.`
    );
    setVerifyBusy(false);
  }

  /* Reload the Firebase user; once verified, the server checks the token and opens the session. */
  async function completeVerification() {
    setVerifyBusy(true);
    setVerifyNote(null);
    const idToken = await getVerifiedIdToken();
    if (!idToken) {
      setVerifyNote("Not verified yet. Open the link in the email from Quorum, then press the button again.");
      setVerifyBusy(false);
      return;
    }
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const data = (await res.json().catch(() => null)) as { user?: AuthUser; error?: string } | null;
      if (res.ok && data?.user) {
        pendingRef.current = null;
        grant(data.user);
        return;
      }
      setVerifyNote(data?.error ?? "Verification could not be confirmed. Try again.");
    } catch {
      setVerifyNote("Cannot reach the server. Check your connection and try again.");
    }
    setVerifyBusy(false);
  }

  async function resendVerification() {
    const creds = pendingRef.current;
    if (!creds) {
      setVerifyNote("Sign in again to request a new link.");
      return;
    }
    await beginVerification(creds);
  }

  function backToForm() {
    pendingRef.current = null;
    setVerifyEmail(null);
    setVerifyNote(null);
    setStatus("form");
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setGoogleFlow(false);
    setFormError(null);
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      await shake.start({ x: [0, -10, 10, -6, 6, 0], transition: { duration: 0.38 } });
      return;
    }

    setStatus("sending");

    if (mode === "login") {
      const email = values.email.trim();
      const password = values.password;

      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, remember }),
        });
        const data = (await res.json().catch(() => null)) as
          | { user?: AuthUser; error?: string; code?: string }
          | null;
        if (res.ok && data?.user) {
          void syncFirebaseIdentity({ name: data.user.name, email, password, mode: "login" });
          grant(data.user);
          return;
        }

        /* Known credentials, but the email hasn't been verified yet: verify before access. */
        if (res.status === 403 && data?.code === "EMAIL_UNVERIFIED") {
          await beginVerification({ name: deriveName(email), email, password });
          return;
        }

        /* Wrong credentials or no account — no silent provisioning. */
        setFormError(
          res.status === 401
            ? "Incorrect email or password. Check your credentials, or create an account."
            : data?.error ?? "Sign-in is unavailable right now. Try again shortly."
        );
        await shake.start({ x: [0, -10, 10, -6, 6, 0], transition: { duration: 0.38 } });
        setStatus("form");
      } catch {
        setFormError("Cannot reach the server. Check your connection and try again.");
        setStatus("form");
      }
      return;
    }

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name.trim(),
          email: values.email.trim(),
          password: values.password,
          organization: values.organization.trim() || undefined,
          inviteCode: values.inviteCode.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { user?: AuthUser; error?: string; errors?: Record<string, string> }
        | null;

      if (!res.ok || !data?.user) {
        if (data?.errors) setErrors(data.errors);
        setFormError(data?.error ?? "Something went wrong on our side. Try again.");
        setStatus("form");
        return;
      }

      /* No session yet — the account opens once the verification link is confirmed. */
      await beginVerification({
        name: data.user.name,
        email: values.email.trim(),
        password: values.password,
      });
    } catch {
      setFormError("Cannot reach the server. Check your connection and try again.");
      setStatus("form");
    }
  }

  /*
   * Google sign-in — the real Firebase popup first (project "public-tender").
   * A successful popup grants the Google identity and mirrors it into the
   * product's own account stack. When Google denies, the message says
   * precisely why (unauthorised origin / provider off / popup blocked) —
   * no fallback identity is ever granted.
   */
  async function signInWithGoogle() {
    if (status !== "form") return;
    setFormError(null);
    setGoogleFlow(true);
    setStatus("sending");

    const result = await signInWithGooglePopup();
    if (result.status === "ok") {
      const ok = await exchangeGoogleIdentity(result.identity.idToken);
      if (ok) return;
      setGoogleFlow(false);
      setStatus("form");
      return;
    }

    /* Google denied — say exactly why; no fallback identity is ever granted. */
    setGoogleFlow(false);
    setFormError(GOOGLE_DENIALS[result.reason]);
    setStatus("form");
  }

  /* Self-service passphrase reset — Firebase emails the link itself. */
  async function requestPasswordReset() {
    const email = resetEmail.trim();
    if (!EMAIL_RE.test(email)) {
      setResetError("Enter a valid work email first.");
      return;
    }
    setResetError(null);
    setResetStatus("sending");
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => null)) as
        | { sent?: boolean; error?: string }
        | null;
      if (res.ok && data?.sent) {
        setResetStatus("sent");
        return;
      }
      setResetError(
        data?.error ?? "The reset service is unavailable right now. Try again shortly."
      );
      setResetStatus("idle");
    } catch {
      setResetError("Cannot reach the server. Check your connection and try again.");
      setResetStatus("idle");
    }
  }

  return (
    <div className="grid min-h-screen bg-paper font-body text-ink-900 antialiased lg:grid-cols-[1.05fr_1fr] dark:bg-night dark:text-white">
      {/* The master tab switcher — pinned over the door, above every other control */}
      <MasterSwitcher active="quorum" variant="floating" />
      <StoryPanel grantedFirstName={firstName} />

      {/* Auth panel */}
      <div className="flex flex-col bg-paper dark:bg-night">
        {/* pt-16 clears the floating master switcher above */}
        <div className="flex items-center justify-between px-5 pb-4 pt-16 lg:hidden">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to the Quorum site"
            className="rounded-lg outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <ThemedLogo />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="font-code text-[10px] font-semibold tracking-[0.16em] text-ink-500 transition-colors hover:text-ink-900 dark:text-ink-400 dark:hover:text-white"
          >
            MAIN SITE →
          </button>
        </div>

        <div className="flex flex-1 items-center justify-center px-4 pb-10 pt-4 lg:px-12">
          <div className="w-full max-w-[480px]">
            <MobileBrandBand />

            {/* The master switcher above is the way back — the rail keeps only the portal tag */}
            <div className="mb-5 hidden items-center justify-end lg:flex">
              <span className="font-code text-[9.5px] font-semibold tracking-[0.2em] text-brand-700 dark:text-brand-400">OFFICER PORTAL · /</span>
            </div>

            <div className="rounded-[12px] border border-ink-200/70 bg-white dark:border-white/10 p-6 shadow-[0_16px_48px_rgba(11,12,15,0.08)] sm:p-8 dark:bg-night-2">
              <AnimatePresence mode="wait">
                {status === "success" && granted ? (
                  <SuccessPanel
                    key="success"
                    user={granted}
                    mode={mode}
                    onClose={onClose}
                    onEnterWorkspace={onEnterWorkspace}
                  />
                ) : status === "verify" && verifyEmail ? (
                  <VerifyPanel
                    key="verify"
                    email={verifyEmail}
                    busy={verifyBusy}
                    note={verifyNote}
                    onCheck={completeVerification}
                    onResend={resendVerification}
                    onBack={backToForm}
                  />
                ) : (
                  <motion.div
                    key="form"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8, transition: { duration: 0.18 } }}
                    transition={{ duration: 0.22, ease: EASE }}
                  >
                    <div className="mb-6">
                      <ThemedLogo />
                    </div>

                    {/* Door toggle — the organization door's segmented control */}
                    <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-ink-50 p-1 dark:bg-ink-900">
                      {(["register", "login"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => onModeChange(m)}
                          className={cn(
                            "relative rounded-lg py-2.5 text-[13px] font-semibold transition-colors",
                            mode === m ? "text-white dark:text-night" : "text-ink-500 hover:text-ink-900 dark:hover:text-white",
                          )}
                        >
                          {mode === m ? (
                            <motion.span
                              layoutId="auth-mode-pill"
                              className="absolute inset-0 rounded-lg bg-ink-950 dark:bg-white"
                              transition={{ duration: 0.24, ease: EASE }}
                              aria-hidden="true"
                            />
                          ) : null}
                          <span className="relative flex items-center justify-center gap-1.5">
                            {m === "register" ? (
                              <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : (
                              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            {m === "register" ? "Create account" : "Sign in"}
                          </span>
                        </button>
                      ))}
                    </div>

                    {/* Mono rail — the organization door's step-rail line */}
                    <div className="flex items-baseline justify-between">
                      <p className="font-code text-[9px] font-semibold tracking-[0.2em] text-ink-400">OFFICER ACCESS</p>
                      <p className="font-code text-[9px] font-semibold tracking-[0.2em] text-ink-400">
                        {mode === "register" ? "FIG. 01 — REQUEST ACCESS" : "FIG. 02 — SIGN IN"}
                      </p>
                    </div>
                    <p className="mt-3 text-[12.5px] text-ink-500 dark:text-ink-400">
                      {mode === "register"
                        ? "One account for your procurement team — the agent prepares the file, you keep the gavel."
                        : "Sign in to your Quorum workspace. The file is waiting, every finding cited."}
                    </p>

                    <div className="mt-4 space-y-3.5">
                      {/* Federated access */}
                      <button
                        type="button"
                        onClick={signInWithGoogle}
                        disabled={status === "sending"}
                        className="inline-flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-ink-200 bg-white text-[14px] font-semibold text-ink-900 transition-all hover:border-ink-300 hover:bg-ink-50 focus-visible:ring-2 focus-visible:ring-brand-600/15 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:bg-night-2 dark:text-white dark:hover:bg-ink-900"
                      >
                        {status === "sending" && googleFlow ? (
                          <>
                            <span
                              className="h-4 w-4 animate-spin rounded-full border-2 border-ink-200 border-t-ink-900"
                              aria-hidden="true"
                            />
                            Connecting to Google…
                          </>
                        ) : (
                          <>
                            <GoogleMark />
                            Continue with Google
                          </>
                        )}
                      </button>
                      <div className="flex items-center gap-3" aria-hidden="true">
                        <span className="h-px flex-1 bg-ink-100 dark:bg-ink-800" />
                        <span className="font-code text-[8.5px] font-semibold tracking-[0.22em] text-ink-400">
                          OR CONTINUE WITH EMAIL
                        </span>
                        <span className="h-px flex-1 bg-ink-100 dark:bg-ink-800" />
                      </div>

                      <motion.div animate={shake}>
                        <form onSubmit={submit} noValidate className="space-y-3.5">
                          <AnimatePresence initial={false}>
                            {mode === "register" && (
                              <motion.div
                                key="name"
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.28, ease: EASE }}
                                className="overflow-hidden"
                              >
                                <Field label="Full name" error={errors.name}>
                                  <input
                                    id="auth-name"
                                    type="text"
                                    value={values.name}
                                    onChange={(e) => set("name", e.target.value)}
                                    placeholder="Your full name"
                                    autoComplete="name"
                                    autoFocus
                                    aria-invalid={!!errors.name}
                                    aria-describedby={errors.name ? "auth-name-error" : undefined}
                                    className={inputCls}
                                  />
                                </Field>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          <Field label="Work email" error={errors.email}>
                            <input
                              id="auth-email"
                              type="email"
                              value={values.email}
                              onChange={(e) => set("email", e.target.value)}
                              placeholder="you@agency.gov"
                              autoComplete="email"
                              {...(mode === "login" ? { autoFocus: true } : {})}
                              aria-invalid={!!errors.email}
                              aria-describedby={errors.email ? "auth-email-error" : undefined}
                              className={inputCls}
                            />
                          </Field>

                          <AnimatePresence initial={false}>
                            {mode === "register" && (
                              <motion.div
                                key="org"
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.28, ease: EASE }}
                                className="overflow-hidden"
                              >
                                <Field label="Organisation · optional" error={errors.organization}>
                                  <input
                                    id="auth-org"
                                    type="text"
                                    value={values.organization}
                                    onChange={(e) => set("organization", e.target.value)}
                                    placeholder="Public procurement authority"
                                    autoComplete="organization"
                                    aria-invalid={!!errors.organization}
                                    aria-describedby={errors.organization ? "auth-org-error" : undefined}
                                    className={inputCls}
                                  />
                                </Field>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          <AnimatePresence initial={false}>
                            {mode === "register" && (
                              <motion.div
                                key="invite"
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.28, ease: EASE }}
                                className="overflow-hidden"
                              >
                                <Field
                                  label="Workspace invite code · optional"
                                  hint="Invited by a teammate? Paste the code they shared — it joins you to their workspace."
                                >
                                  <input
                                    id="auth-invite"
                                    type="text"
                                    value={values.inviteCode}
                                    onChange={(e) => set("inviteCode", e.target.value)}
                                    placeholder="Q-XXXX-XXXX"
                                    autoCapitalize="characters"
                                    className={inputCls}
                                  />
                                </Field>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          <Field label="Password" error={errors.password}>
                            <div className="relative">
                              <input
                                id="auth-password"
                                type={showPw ? "text" : "password"}
                                value={values.password}
                                onChange={(e) => set("password", e.target.value)}
                                placeholder={mode === "register" ? "Create a password" : "Your password"}
                                autoComplete={mode === "register" ? "new-password" : "current-password"}
                                aria-invalid={!!errors.password}
                                aria-describedby={errors.password ? "auth-password-error" : undefined}
                                className={cn(inputCls, "pr-11")}
                              />
                              <button
                                type="button"
                                onClick={() => setShowPw((v) => !v)}
                                aria-label={showPw ? "Hide password" : "Show password"}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 transition-colors hover:text-ink-700 dark:hover:text-white"
                              >
                                {showPw ? (
                                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                                ) : (
                                  <Eye className="h-4 w-4" aria-hidden="true" />
                                )}
                              </button>
                            </div>
                          </Field>

                          {/* Strength meter */}
                          {mode === "register" && values.password.length > 0 && (
                            <div aria-live="polite">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex gap-1" aria-hidden="true">
                                  {[0, 1, 2, 3].map((i) => (
                                    <span
                                      key={i}
                                      className={cn(
                                        "h-1 w-9 rounded-full transition-colors duration-300",
                                        i < pwScore ? pwMeta.seg : "bg-ink-100 dark:bg-ink-800"
                                      )}
                                    />
                                  ))}
                                </div>
                                <p className="font-code text-[9px] font-bold tracking-[0.18em] text-ink-500 dark:text-ink-400">
                                  {pwMeta.label}
                                </p>
                              </div>
                              <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Password requirements">
                                {PW_CHECKS.map((c) => {
                                  const ok = c.test(values.password);
                                  return (
                                    <li
                                      key={c.label}
                                      className={cn(
                                        "rounded-md px-2 py-1 font-code text-[8.5px] font-semibold tracking-[0.14em] transition-colors duration-300",
                                        ok
                                          ? "bg-ink-950 text-white dark:bg-white dark:text-ink-950"
                                          : "bg-ink-50 text-ink-400 dark:bg-ink-900 dark:text-ink-500"
                                      )}
                                    >
                                      {ok ? "✓ " : ""}
                                      {c.label}
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          )}

                          {/* Mode-specific row */}
                          {mode === "register" ? (
                            <div>
                              <label className="flex cursor-pointer items-start gap-3 rounded-xl px-0.5 py-1">
                                <input
                                  type="checkbox"
                                  className="peer sr-only"
                                  checked={terms}
                                  onChange={(e) => {
                                    setTerms(e.target.checked);
                                    setErrors((prev) => {
                                      if (!prev.terms) return prev;
                                      const next = { ...prev };
                                      delete next.terms;
                                      return next;
                                    });
                                  }}
                                  aria-invalid={!!errors.terms}
                                  aria-describedby={errors.terms ? "auth-terms-error" : undefined}
                                />
                                <span
                                  aria-hidden="true"
                                  className={cn(
                                    "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-all",
                                    terms
                                      ? "border-brand-600 bg-brand-600 text-white"
                                      : errors.terms
                                        ? "border-brand-500 bg-white dark:bg-night-2"
                                        : "border-ink-300 bg-white dark:bg-night-2"
                                  )}
                                >
                                  <svg
                                    viewBox="0 0 12 12"
                                    className="h-3 w-3"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.4"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <path d="m2.5 6.5 2.4 2.4L9.5 4" />
                                  </svg>
                                </span>
                                <span className="text-[13px] leading-snug text-ink-600 dark:text-ink-300">
                                  I agree to the{" "}
                                  <span className="font-semibold text-ink-900 dark:text-white">terms of use</span> and
                                  the <span className="font-semibold text-ink-900 dark:text-white">acceptable-use policy</span>.
                                </span>
                              </label>
                              {errors.terms ? (
                                <p id="auth-terms-error" className="mt-1.5 text-[12px] font-medium text-brand-700 dark:text-brand-300">
                                  {errors.terms}
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <div>
                              <div className="flex items-center justify-between">
                                <label className="flex cursor-pointer items-center gap-2.5">
                                  <input
                                    type="checkbox"
                                    className="peer sr-only"
                                    checked={remember}
                                    onChange={(e) => setRemember(e.target.checked)}
                                  />
                                  <span
                                    aria-hidden="true"
                                    className={cn(
                                      "grid h-5 w-5 place-items-center rounded-md border transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-brand-600/30",
                                      remember
                                        ? "border-brand-600 bg-brand-600 text-white"
                                        : "border-ink-300 bg-white dark:bg-night-2"
                                    )}
                                  >
                                    <svg
                                      viewBox="0 0 12 12"
                                      className="h-3 w-3"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2.4"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <path d="m2.5 6.5 2.4 2.4L9.5 4" />
                                    </svg>
                                  </span>
                                  <span className="text-[13px] font-medium text-ink-700 dark:text-ink-200">
                                    Keep me signed in
                                  </span>
                                </label>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setResetEmail((cur) => cur || values.email);
                                    setResetError(null);
                                    setMemoOpen((v) => !v);
                                  }}
                                  aria-expanded={memoOpen}
                                  className="text-[13px] font-semibold text-ink-600 underline decoration-ink-300 underline-offset-4 transition-colors hover:text-brand-700 hover:decoration-brand-400 dark:text-ink-300 dark:decoration-ink-700 dark:hover:text-brand-300"
                                >
                                  Forgot access?
                                </button>
                              </div>
                              <AnimatePresence initial={false}>
                                {memoOpen && (
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.28, ease: EASE }}
                                    className="overflow-hidden"
                                  >
                                    <div
                                      className="mt-3 rounded-xl border border-ink-200 bg-sand px-4 py-3.5 dark:bg-ink-900/40"
                                      role="note"
                                    >
                                      <p className="font-code text-[9px] font-semibold tracking-[0.2em] text-ink-500 dark:text-ink-400">
                                        ACCESS RESET
                                      </p>

                                      {resetStatus === "sent" ? (
                                        <div aria-live="polite">
                                          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-700 dark:text-ink-200">
                                            If an account exists for{" "}
                                            <span className="font-semibold text-ink-900 dark:text-white">
                                              {resetEmail.trim()}
                                            </span>
                                            , a reset link is on its way. Open it, choose a new
                                            password, then come back and sign in — the link expires
                                            in one hour.
                                          </p>
                                          <button
                                            type="button"
                                            onClick={requestPasswordReset}
                                            className="mt-2 text-[12.5px] font-semibold text-brand-700 underline decoration-brand-300 underline-offset-4 transition-colors hover:text-brand-800 dark:text-brand-300 dark:decoration-brand-800 dark:hover:text-brand-200"
                                          >
                                            Send it again
                                          </button>
                                        </div>
                                      ) : (
                                        <>
                                          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-700 dark:text-ink-200">
                                            Enter your work email and we&apos;ll send a self-service
                                            reset link. Pilot users can also reply to their onboarding
                                            mail to reach the gate administrator.
                                          </p>
                                          <div className="mt-3 flex items-stretch gap-2">
                                            <input
                                              type="email"
                                              value={resetEmail}
                                              onChange={(e) => {
                                                setResetEmail(e.target.value);
                                                setResetError(null);
                                              }}
                                              onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                  e.preventDefault();
                                                  void requestPasswordReset();
                                                }
                                              }}
                                              placeholder="you@agency.gov"
                                              autoComplete="email"
                                              aria-label="Work email for the reset link"
                                              aria-invalid={!!resetError}
                                              className={cn(inputCls, "h-11 min-w-0 flex-1 text-[13.5px]")}
                                            />
                                            <button
                                              type="button"
                                              onClick={requestPasswordReset}
                                              disabled={resetStatus === "sending"}
                                              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-ink-950 bg-ink-950 px-4 text-[13px] font-semibold text-white transition-all hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-70 dark:border-white dark:bg-white dark:text-ink-950 dark:hover:bg-brand-500 dark:hover:text-white"
                                            >
                                              {resetStatus === "sending" ? (
                                                <span
                                                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"
                                                  aria-hidden="true"
                                                />
                                              ) : null}
                                              Email link
                                            </button>
                                          </div>
                                          {resetError && (
                                            <p
                                              role="alert"
                                              className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-brand-700 dark:text-brand-300"
                                            >
                                              <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                              {resetError}
                                            </p>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          )}

                          {/* Form-level error */}
                          <AnimatePresence>
                            {formError && (
                              <motion.p
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                role="alert"
                                className="flex items-start gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-[13px] font-medium leading-snug text-brand-800 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-200"
                              >
                                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                                {formError}
                              </motion.p>
                            )}
                          </AnimatePresence>

                          {/* Submit */}
                          <button
                            type="submit"
                            disabled={status === "sending"}
                            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink-950 text-[14px] font-semibold text-white shadow-[0_8px_20px_rgba(11,12,15,0.18)] transition-all hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {status === "sending" ? (
                              <>
                                <span
                                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                                  aria-hidden="true"
                                />
                                {googleFlow
                                  ? "One moment…"
                                  : mode === "register"
                                    ? "Opening account…"
                                    : "Verifying…"}
                              </>
                            ) : (
                              <>
                                {mode === "register" ? "Create account" : "Sign in"}
                                <ArrowRight
                                  className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                                  aria-hidden="true"
                                />
                              </>
                            )}
                          </button>
                        </form>
                      </motion.div>
                    </div>

                    {/* Switch mode */}
                    <p className="mt-4 text-center text-[13px] text-ink-500 dark:text-ink-400">
                      {mode === "register" ? "Already have access?" : "New to Quorum?"}{" "}
                      <button
                        type="button"
                        onClick={() => onModeChange(mode === "register" ? "login" : "register")}
                        className="font-semibold text-brand-700 underline decoration-brand-300 underline-offset-4 transition-colors hover:text-brand-800 hover:decoration-brand-500 dark:text-brand-300 dark:decoration-brand-800 dark:hover:text-brand-200"
                      >
                        {mode === "register" ? "Sign in" : "Create an account"}
                      </button>
                    </p>

                    <p className="mt-5 text-center font-code text-[8.5px] tracking-[0.22em] text-ink-400">
                      SCRYPT-HASHED PASSWORDS · HTTPONLY SESSIONS · NO TRACKERS
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <p className="mt-5 text-center text-[12px] leading-relaxed text-ink-400 dark:text-ink-500">
              Officers sign in here only — organizations have their own door at /org.
              <br />
              The committee signs — the agent never does.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
