"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Fingerprint, KeyRound, Loader2, ShieldCheck, X } from "lucide-react";
import { trapTabFocus } from "@/lib/a11y";

/**
 * The step-up gate.
 *
 * A signed-in session is not a signature. Before an irreversible decision the
 * desk asks the human to prove again — a passphrase or a current authenticator
 * code — and returns a short-lived, single-use token bound to that gate. The
 * caller puts the token in `x-quorum-stepup`; the sidecar verifies it.
 *
 * The dialog is mounted at the dashboard root, and the Muse assistant bubble
 * mounts its own while it is open — so a gate decision staged in chat can be
 * signed right there, on any screen. Hosts register on a stack and
 * requestStepUp always opens the topmost (most recently mounted) one.
 */

type Pending = { gateId: string; resolve: (token: string | null) => void };
type Listener = (pending: Pending) => void;

const listeners: Listener[] = [];

export function requestStepUp(gateId: string): Promise<string | null> {
  return new Promise((resolve) => {
    const host = listeners[listeners.length - 1];
    if (!host) {
      resolve(null);
      return;
    }
    host({ gateId, resolve });
  });
}

export function StepUpHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const [mode, setMode] = useState<"password" | "totp">("password");
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /* Signers must hold a second factor. When the account has none, the dialog
     switches to enrolment instead of refusing and leaving the officer stuck. */
  const [stage, setStage] = useState<"sign" | "enrol">("sign");
  const [enrolment, setEnrolment] = useState<{ secret: string; uri: string } | null>(null);
  const [enrolBusy, setEnrolBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const settle = useCallback((token: string | null) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    setValue("");
    setError("");
    setBusy(false);
    const returnFocus = returnFocusRef.current;
    returnFocusRef.current = null;
    if (returnFocus?.isConnected) window.requestAnimationFrame(() => returnFocus.focus());
    current?.resolve(token);
  }, []);

  const beginEnrolment = useCallback(async () => {
    setStage("enrol");
    setEnrolBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/totp", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        secret?: string;
        uri?: string;
        error?: string;
      };
      if (!res.ok || !data.secret || !data.uri) {
        setError(data.error ?? "An authenticator key could not be issued. Try again.");
        setEnrolBusy(false);
        return;
      }
      setEnrolment({ secret: data.secret, uri: data.uri });
      setTotpEnabled(false);
      setValue("");
      window.setTimeout(() => inputRef.current?.focus(), 80);
    } catch {
      setError("The signature service is unreachable. Try again.");
    }
    setEnrolBusy(false);
  }, []);

  useEffect(() => {
    const onRequest: Listener = (next) => {
      const previous = pendingRef.current;
      if (!previous) {
        const active = document.activeElement;
        returnFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
      }
      if (previous) previous.resolve(null);
      pendingRef.current = next;
      setPending(next);
      setValue("");
      setError("");
      setMode("password");
      setStage("sign");
      setEnrolment(null);
      setCopied(false);
      void fetch("/api/auth/totp")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { enabled?: boolean; required?: boolean } | null) => {
          const enabled = d?.enabled === true;
          setTotpEnabled(enabled);
          if (!enabled && d?.required !== false) void beginEnrolment();
        })
        .catch(() => setTotpEnabled(false));
      window.setTimeout(() => inputRef.current?.focus(), 80);
    };
    listeners.push(onRequest);
    return () => {
      const at = listeners.indexOf(onRequest);
      if (at !== -1) listeners.splice(at, 1);
    };
  }, [beginEnrolment]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) settle(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, busy, settle]);

  const sign = async (credentials: { code?: string; password?: string }) => {
    if (!pending) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/step-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gateId: pending.gateId, ...credentials }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        token?: string;
        error?: string;
        totpRequired?: boolean;
      };
      if (data.totpRequired) {
        setBusy(false);
        await beginEnrolment();
        setError(data.error ?? "Enrol an authenticator app before signing.");
        return;
      }
      if (!res.ok || !data.token) {
        setError(data.error ?? "Identity check failed. Please try again.");
        setBusy(false);
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      settle(data.token);
    } catch {
      setError("The signature service is unreachable. Try again.");
      setBusy(false);
    }
  };

  const confirmEnrolment = async (code: string) => {
    if (!pending || enrolBusy) return;
    setBusy(true);
    setEnrolBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/totp", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json().catch(() => ({}))) as { enabled?: boolean; error?: string };
      if (!res.ok || data.enabled !== true) {
        setError(data.error ?? "That code was not accepted. Check the app's clock and try the current code.");
        setBusy(false);
        setEnrolBusy(false);
        inputRef.current?.focus();
        return;
      }
      setTotpEnabled(true);
      setStage("sign");
      setMode("totp");
      setEnrolBusy(false);
      /* The same code is still current — finish the signature now rather than
         asking for a second glance at the phone. */
      await sign({ code });
    } catch {
      setError("The signature service is unreachable. Try again.");
      setBusy(false);
      setEnrolBusy(false);
    }
  };

  const submit = async () => {
    if (!pending || busy) return;
    const clean = value.trim();
    if (!clean) {
      setError(
        stage === "enrol"
          ? "Enter the six-digit code from your authenticator app."
          : mode === "totp"
            ? "Enter the current six-digit code."
            : "Enter your passphrase.",
      );
      inputRef.current?.focus();
      return;
    }
    if (stage === "enrol") {
      await confirmEnrolment(clean);
      return;
    }
    await sign(mode === "totp" ? { code: clean } : { password: value });
  };

  return (
    <AnimatePresence>
      {pending ? (
        <motion.div
          className="paper-sheet fixed inset-0 z-[120] grid place-items-center bg-ink-950/45 px-4 backdrop-blur-[3px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="stepup-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) settle(null);
          }}
        >
          <motion.div
            ref={dialogRef}
            initial={{ opacity: 0, y: 14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            tabIndex={-1}
            onKeyDown={(event) => trapTabFocus(event, dialogRef.current)}
            className="max-h-[calc(100dvh-2rem)] w-full max-w-[440px] overflow-y-auto overscroll-contain rounded-2xl border border-ink-200 bg-[#fffdfb] shadow-[0_24px_80px_-24px_rgba(11,12,15,0.45)]"
          >
            <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid h-9 w-9 place-items-center rounded-full bg-brand-50 text-brand-700">
                  <Fingerprint className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <h2 id="stepup-title" className="text-[15px] font-semibold tracking-[-0.01em] text-ink-950">
                    Confirm this approval
                  </h2>
                  <p className="mt-1 max-w-[32ch] text-[11.5px] leading-relaxed text-ink-500">
                    {stage === "enrol" ? "Set up two-step sign-in, then approve" : "Confirm your identity to approve"}{" "}
                    <span className="font-code text-[10.5px] text-ink-800">{pending.gateId}</span>. This check can be used once and expires in two minutes.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !busy && settle(null)}
                disabled={busy}
                aria-label="Cancel identity check"
                className="focus-brand grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-600 transition-colors hover:bg-ink-950/[0.05] hover:text-ink-900 disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="px-5 py-4">
              {stage === "sign" && totpEnabled && (
                <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg border border-ink-200/80 bg-paper p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setMode("password");
                      setValue("");
                      setError("");
                      window.setTimeout(() => inputRef.current?.focus(), 30);
                    }}
                    className={`focus-brand inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 font-code text-[10px] font-bold tracking-[0.06em] transition-colors ${
                      mode === "password" ? "bg-white text-ink-950 shadow-sm" : "text-ink-500 hover:text-ink-800"
                    }`}
                  >
                    <KeyRound className="h-3 w-3" aria-hidden="true" /> PASSWORD
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("totp");
                      setValue("");
                      setError("");
                      window.setTimeout(() => inputRef.current?.focus(), 30);
                    }}
                    className={`focus-brand inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 font-code text-[10px] font-bold tracking-[0.06em] transition-colors ${
                      mode === "totp" ? "bg-white text-ink-950 shadow-sm" : "text-ink-500 hover:text-ink-800"
                    }`}
                  >
                    <ShieldCheck className="h-3 w-3" aria-hidden="true" /> AUTHENTICATOR APP
                  </button>
                </div>
              )}

              {stage === "enrol" && (
                <div className="mb-4 rounded-lg border border-ink-200/80 bg-paper px-3.5 py-3">
                  <p className="text-[11.5px] leading-relaxed text-ink-600">
                    To protect approval decisions, add Quorum to an authenticator app and enter the current six-digit code.
                  </p>
                  {enrolment ? (
                    <>
                      <p className="mt-3 font-code text-[10px] font-bold tracking-[0.08em] text-ink-600">Setup key</p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <code className="flex-1 select-all overflow-hidden rounded-md border border-ink-200 bg-white px-2.5 py-2 font-code text-[10.5px] tracking-[0.06em] text-ink-900">
                          {enrolment.secret.replace(/(.{4})/g, "$1 ").trim()}
                        </code>
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard
                              ?.writeText(enrolment.secret)
                              .then(() => {
                                setCopied(true);
                                window.setTimeout(() => setCopied(false), 2000);
                              })
                              .catch(() => setCopied(false));
                          }}
                          className="focus-brand min-h-11 shrink-0 rounded-md border border-ink-200 bg-white px-3 font-code text-[10px] font-bold tracking-[0.06em] text-ink-800 transition-colors hover:bg-ink-50"
                        >
                          {copied ? "COPIED" : "COPY"}
                        </button>
                      </div>
                      <a
                        href={enrolment.uri}
                        className="focus-brand mt-2 inline-flex min-h-11 items-center font-code text-[10px] font-bold tracking-[0.06em] text-brand-800 underline decoration-brand-300 underline-offset-2"
                      >
                        OPEN IN AUTHENTICATOR APP
                      </a>
                    </>
                  ) : (
                    <p className="mt-2 inline-flex items-center gap-1.5 text-[10.5px] text-ink-500">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      Issuing a setup key…
                    </p>
                  )}
                </div>
              )}

              <label htmlFor="stepup-value" className="font-code text-[10.5px] font-bold tracking-[0.08em] text-ink-600">
                {stage === "enrol" ? "SIX-DIGIT CODE" : mode === "totp" ? "SIX-DIGIT CODE" : "PASSWORD"}
              </label>
              <input
                ref={inputRef}
                id="stepup-value"
                type={mode === "totp" ? "text" : "password"}
                inputMode={mode === "totp" ? "numeric" : undefined}
                autoComplete={mode === "totp" ? "one-time-code" : "current-password"}
                maxLength={mode === "totp" ? 6 : 128}
                value={value}
                onChange={(e) => setValue(mode === "totp" ? e.target.value.replace(/[^\d]/g, "") : e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
                placeholder={mode === "totp" ? "000000" : "Your Quorum passphrase"}
                className="focus-brand mt-2 h-11 w-full rounded-lg border border-ink-200 bg-white px-3.5 text-[14px] text-ink-950 outline-none transition-[border-color,box-shadow] placeholder:text-ink-400 focus:border-ink-950 focus:ring-[3px] focus:ring-ink-950/[0.07] dark:placeholder:text-ink-400"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "stepup-error" : undefined}
              />

              {error ? (
                <p id="stepup-error" role="alert" className="mt-2.5 text-[11.5px] leading-relaxed text-red-700">
                  {error}
                </p>
              ) : (
                <p className="mt-2.5 text-[10.5px] leading-relaxed text-ink-400">
                  {stage === "enrol"
                    ? "Confirming this code enables two-step sign-in and records the approval."
                    : mode === "totp"
                      ? "Open your authenticator app and enter the current code for Quorum."
                      : "Your sign-in details are checked securely before the approval is recorded."}
                </p>
              )}

              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => settle(null)}
                  disabled={busy}
                className="focus-brand min-h-11 flex-1 rounded-lg border border-ink-200 bg-white px-3 text-[12px] font-semibold text-ink-800 transition-colors hover:bg-ink-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={busy || !value.trim() || (stage === "enrol" && !enrolment)}
                className="focus-brand inline-flex min-h-11 flex-[1.35] items-center justify-center gap-2 rounded-lg bg-ink-950 px-3 text-[12px] font-semibold text-white transition-colors hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Fingerprint className="h-3.5 w-3.5" aria-hidden="true" />}
                  {busy ? "Checking…" : stage === "enrol" ? "Enable and approve" : "Confirm approval"}
                </button>
              </div>

              <p className="mt-3 flex items-center gap-1.5 text-[10.5px] leading-relaxed text-ink-600">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                Recorded under your name · can be used once · expires after two minutes
              </p>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
