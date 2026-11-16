"use client";

import { useState } from "react";

const INPUT =
  "h-11 w-full rounded-xl border border-ink-200 bg-white px-3.5 text-[14px] text-ink-950 outline-none transition-all placeholder:text-ink-400 focus:border-ink-950 focus:ring-4 focus:ring-ink-950/10 dark:bg-night-2 dark:text-white dark:placeholder:text-ink-500";

/** Completes a reset on the page the emailed link opened. */
export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Choose a passphrase of at least 8 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("Both passphrases must match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset-password/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && data?.ok) {
        setDone(true);
        return;
      }
      setError(data?.error ?? "The passphrase could not be changed. Request a new link.");
    } catch {
      setError("Cannot reach the server. Check your connection and try again.");
    }
    setBusy(false);
  }

  if (done) {
    return (
      <div className="mt-5">
        <p
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[12.5px] font-medium leading-snug text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          Passphrase changed and every other session signed out.
        </p>
        <a
          href="/#/login"
          className="mt-4 flex h-11 w-full items-center justify-center rounded-xl bg-ink-950 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-ink-950"
        >
          Sign in
        </a>
      </div>
    );
  }

  return (
    <form className="mt-5 space-y-3.5" onSubmit={submit} noValidate>
      <label className="block">
        <span className="font-code text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-600 dark:text-ink-300">
          New passphrase
        </span>
        <input
          className={`${INPUT} mt-1.5`}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
        />
      </label>
      <label className="block">
        <span className="font-code text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-600 dark:text-ink-300">
          Confirm passphrase
        </span>
        <input
          className={`${INPUT} mt-1.5`}
          type="password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
        />
      </label>
      {error ? (
        <p role="alert" className="text-[12px] font-medium leading-snug text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="flex h-11 w-full items-center justify-center rounded-xl bg-ink-950 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:bg-white dark:text-ink-950"
      >
        {busy ? "Saving…" : "Set new passphrase"}
      </button>
    </form>
  );
}
