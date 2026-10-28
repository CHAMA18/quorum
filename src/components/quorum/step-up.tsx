"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Fingerprint, KeyRound, Loader2, ShieldCheck, X } from "lucide-react";

/**
 * The step-up gate.
 *
 * A signed-in session is not a signature. Before an irreversible decision the
 * desk asks the human to prove again — a passphrase or a current authenticator
 * code — and returns a short-lived, single-use token bound to that gate. The
 * caller puts the token in `x-quorum-stepup`; the sidecar verifies it.
 *
 * The dialog is mounted once at the dashboard root and driven by a tiny
 * module-level event bus, so any gate card (dashboard queue, stack console)
 * can await the same signature without prop-drilling through the whole tree.
 */

type Pending = { gateId: string; resolve: (token: string | null) => void };
type Listener = (pending: Pending) => void;

let listener: Listener | null = null;

export function requestStepUp(gateId: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!listener) {
      resolve(null);
      return;
    }
    listener({ gateId, resolve });
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
  const inputRef = useRef<HTMLInputElement>(null);

  const settle = useCallback((token: string | null) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    setValue("");
    setError("");
    setBusy(false);
    current?.resolve(token);
  }, []);

  useEffect(() => {
    const onRequest: Listener = (next) => {
      const previous = pendingRef.current;
      if (previous) previous.resolve(null);
      pendingRef.current = next;
      setPending(next);
      setValue("");
      setError("");
      setMode("password");
      void fetch("/api/auth/totp")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { enabled?: boolean } | null) => setTotpEnabled(d?.enabled === true))
        .catch(() => setTotpEnabled(false));
      window.setTimeout(() => inputRef.current?.focus(), 80);
    };
    listener = onRequest;
    return () => {
      if (listener === onRequest) listener = null;
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) settle(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, busy, settle]);

  const submit = async () => {
    if (!pending || busy) return;
    const clean = value.trim();
    if (!clean) {
      setError(mode === "totp" ? "Enter the current six-digit code." : "Enter your passphrase.");
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/step-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gateId: pending.gateId,
          ...(mode === "totp" ? { code: clean } : { password: value }),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        setError(data.error ?? "The step-up was refused. Try again.");
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

  return (
    <AnimatePresence>
      {pending ? (
        <motion.div
          className="fixed inset-0 z-[120] grid place-items-center bg-ink-950/45 px-4 backdrop-blur-[3px]"
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
            initial={{ opacity: 0, y: 14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-[440px] overflow-hidden rounded-2xl border border-ink-200 bg-[#fffdfb] shadow-[0_24px_80px_-24px_rgba(11,12,15,0.45)]"
          >
            <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid h-9 w-9 place-items-center rounded-full bg-brand-50 text-brand-700">
                  <Fingerprint className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <h2 id="stepup-title" className="text-[15px] font-semibold tracking-[-0.01em] text-ink-950">
                    Sign this gate
                  </h2>
                  <p className="mt-1 max-w-[32ch] text-[11.5px] leading-relaxed text-ink-500">
                    Re-authenticate to sign <span className="font-code text-[10.5px] text-ink-800">{pending.gateId}</span>.
                    The signature is single-use and expires in two minutes.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !busy && settle(null)}
                aria-label="Cancel step-up"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-400 transition-colors hover:bg-ink-950/[0.05] hover:text-ink-800"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="px-5 py-4">
              {totpEnabled && (
                <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg border border-ink-200/80 bg-paper p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setMode("password");
                      setValue("");
                      setError("");
                      window.setTimeout(() => inputRef.current?.focus(), 30);
                    }}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 font-code text-[8px] font-bold tracking-[0.14em] transition-colors ${
                      mode === "password" ? "bg-white text-ink-950 shadow-sm" : "text-ink-500 hover:text-ink-800"
                    }`}
                  >
                    <KeyRound className="h-3 w-3" aria-hidden="true" /> PASSPHRASE
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("totp");
                      setValue("");
                      setError("");
                      window.setTimeout(() => inputRef.current?.focus(), 30);
                    }}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 font-code text-[8px] font-bold tracking-[0.14em] transition-colors ${
                      mode === "totp" ? "bg-white text-ink-950 shadow-sm" : "text-ink-500 hover:text-ink-800"
                    }`}
                  >
                    <ShieldCheck className="h-3 w-3" aria-hidden="true" /> AUTHENTICATOR
                  </button>
                </div>
              )}

              <label htmlFor="stepup-value" className="font-code text-[8px] font-bold tracking-[0.2em] text-ink-500">
                {mode === "totp" ? "SIX-DIGIT CODE" : "PASSPHRASE"}
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
                className="focus-brand mt-2 h-11 w-full rounded-lg border border-ink-200 bg-white px-3.5 text-[14px] text-ink-950 outline-none transition-[border-color,box-shadow] placeholder:text-ink-300 focus:border-ink-950 focus:ring-[3px] focus:ring-ink-950/[0.07]"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "stepup-error" : undefined}
              />

              {error ? (
                <p id="stepup-error" role="alert" className="mt-2.5 text-[11.5px] leading-relaxed text-red-700">
                  {error}
                </p>
              ) : (
                <p className="mt-2.5 text-[10.5px] leading-relaxed text-ink-400">
                  {mode === "totp"
                    ? "Open your authenticator app and enter the current code for Quorum."
                    : "Your passphrase is checked by the web app; the sidecar verifies the signed token."}
                </p>
              )}

              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => settle(null)}
                  disabled={busy}
                  className="h-10 flex-1 rounded-lg border border-ink-200 bg-white px-3 text-[11px] font-semibold text-ink-700 transition-colors hover:bg-ink-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={busy || !value.trim()}
                  className="inline-flex h-10 flex-[1.35] items-center justify-center gap-2 rounded-lg bg-ink-950 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Fingerprint className="h-3.5 w-3.5" aria-hidden="true" />}
                  {busy ? "Signing…" : "Sign gate"}
                </button>
              </div>

              <p className="mt-3 flex items-center gap-1.5 font-code text-[7.5px] tracking-[0.12em] text-ink-400">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                NAMED HUMAN · SINGLE USE · HASH-BOUND TO THE BUNDLE
              </p>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
