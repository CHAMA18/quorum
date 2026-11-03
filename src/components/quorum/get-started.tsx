"use client";

import { useState } from "react";
import { ArrowRight, Check, ClipboardCheck, Send } from "lucide-react";
import { Reveal } from "@/components/quorum/reveal";
import type { AuthUser } from "@/lib/auth-types";
import { useToast } from "@/hooks/use-toast";

type FormState = "idle" | "sending" | "sent" | "error";

/**
 * Get started — account access and a direct request for an institutional pilot.
 */
export function GetStarted({
  user,
  onCreateAccount,
  onSignIn,
}: {
  user?: AuthUser | null;
  onCreateAccount?: () => void;
  onSignIn?: () => void;
}) {
  const [form, setForm] = useState({
    name: user?.name ?? "",
    email: user?.email ?? "",
    institution: user?.organization ?? "",
    notes: "",
  });
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
    if (form.name.trim().length < 2 || !emailOk) {
      setError("Enter your name and a valid work email to continue.");
      return;
    }

    setState("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          company: form.institution.trim() || undefined,
          notes: form.notes.trim(),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Could not send your request.");
      }
      setState("sent");
      toast({
        title: "Request received",
        description: "Your request and notes have been sent to our team. We’ll reply within one working day.",
      });
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Could not send your request.");
    }
  }

  return (
    <section id="get-started" className="scroll-mt-20 bg-brand-600">
      <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-16">
          {/* Statement */}
          <div className="lg:col-span-7">
            <Reveal>
              {/* This band is solid signal red, so the rule runs in white and
                  the index stays legible rather than tinted on red. */}
              <div>
                <span aria-hidden="true" className="block h-px w-full bg-white/25" />
                <p className="mt-3 type-micro text-white/75">10 · Getting started</p>
              </div>
            </Reveal>
            <Reveal delay={0.08}>
              <h2 className="type-display mt-6 text-[36px] text-white sm:text-[52px]">
                Start with a focused review. Expand across your institution when ready.
              </h2>
            </Reveal>
            <Reveal delay={0.16}>
              <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-white/85">
                Begin with a published notice or your own tender documents. Review the evidence and
                workflow with your team before expanding.
              </p>
            </Reveal>
            <Reveal delay={0.22}>
              <div className="mt-9 flex flex-wrap items-center gap-3.5">
                <button
                  type="button"
                  onClick={onCreateAccount}
                  className="group inline-flex h-[52px] items-center gap-2 rounded-full bg-ink-950 px-7 text-[15px] font-semibold text-white transition-all hover:bg-ink-900 hover:shadow-[0_14px_36px_rgba(11,12,15,0.35)]"
                >
                  Create an officer account
                  <ArrowRight
                    className="h-4.5 w-4.5 transition-transform group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </button>
                <a
                  href="#pricing"
                  className="inline-flex h-[52px] items-center rounded-full border border-white/35 px-7 text-[15px] font-semibold text-white transition-all hover:border-white hover:bg-white/10"
                >
                  View pricing
                </a>
              </div>
            </Reveal>
            <Reveal delay={0.28}>
              <p className="mt-4 text-[14px] text-white/75">
                Already have access?{" "}
                <button
                  type="button"
                  onClick={onSignIn}
                  className="font-semibold text-white underline decoration-white/50 underline-offset-4 transition-colors hover:decoration-white"
                >
                  Sign in
                </button>
              </p>
            </Reveal>
          </div>

          {/* Materials to prepare for a first review */}
          <Reveal delay={0.14} className="lg:col-span-5">
            <div className="rounded-[16px] bg-white p-6 shadow-[0_32px_80px_rgba(11,12,15,0.35)] sm:p-8">
              <div className="flex items-center gap-3 border-b border-ink-100 pb-5">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-200">
                  <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-code text-[10px] font-semibold tracking-[0.18em] text-ink-500">
                    PREPARING FOR A PILOT
                  </p>
                  <p className="mt-1 font-display text-[18px] font-extrabold tracking-tight text-ink-950">
                    What your team will need
                  </p>
                </div>
              </div>

              <p className="mt-4 text-[13.5px] leading-relaxed text-ink-600">
                Start with a tender your team knows well and the criteria already used to review it.
              </p>

              <ul className="mt-5 space-y-3">
                {[
                  "The published notice and tender requirements",
                  "Bid submissions and supporting documents",
                  "Your evaluation criteria and approved references",
                ].map((item, index) => (
                  <li key={item} className="flex items-start gap-3 rounded-xl border border-ink-100 bg-paper/70 px-3.5 py-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white font-code text-[10px] font-bold text-brand-700 ring-1 ring-ink-100">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="pt-0.5 text-[13.5px] font-medium leading-snug text-ink-700">
                      {item}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>

        {/* Pilot request form */}
        <Reveal delay={0.1}>
          <div className="mx-auto mt-12 w-full max-w-4xl rounded-[16px] bg-white p-6 shadow-[0_32px_80px_rgba(11,12,15,0.35)] sm:p-8">
            {state === "sent" ? (
              <div className="flex flex-col items-center gap-4 py-6 text-center" aria-live="polite">
                <span className="grid h-14 w-14 place-items-center rounded-[10px] bg-brand-600 text-white">
                  <Check className="h-7 w-7" strokeWidth={3} aria-hidden="true" />
                </span>
                <div>
                  <p className="font-display text-[22px] font-black tracking-tight text-ink-950">
                    Request received.
                  </p>
                  <p className="mt-1.5 text-[14.5px] text-ink-600">
                    Your request and notes have been sent to the Quorum team. A member will reply within one working day.
                  </p>
                </div>
                <p className="font-code text-[10px] tracking-[0.18em] text-brand-600">
                  SENT TO THE QUORUM TEAM
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-code text-[10px] font-semibold tracking-[0.24em] text-brand-700">
                      PILOT ACCESS
                    </p>
                    <p className="mt-1 text-[15px] font-semibold text-ink-950">
                      Up to three tender reviews at no cost.
                    </p>
                  </div>
                  <p className="font-code text-[10px] tracking-[0.16em] text-ink-400">
                    REVIEW VOLUME · DATA SOURCES · DEPLOYMENT NEEDS
                  </p>
                </div>

                <form onSubmit={submit} className="mt-5 grid gap-3 sm:grid-cols-3" noValidate>
                  <div>
                    <label htmlFor="pilot-name" className="mb-1 block font-code text-[10px] font-semibold tracking-[0.06em] text-ink-600">
                      NAME
                    </label>
                    <input
                      id="pilot-name"
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Amina Mwangi"
                      autoComplete="name"
                      className="h-12 w-full rounded-lg border border-ink-200 bg-paper px-4 text-[14px] text-ink-900 outline-none transition-all placeholder:text-ink-400 focus:border-ink-950 focus:bg-white focus:ring-2 focus:ring-ink-950/10 dark:placeholder:text-ink-400"
                    />
                  </div>
                  <div>
                    <label htmlFor="pilot-email" className="mb-1 block font-code text-[10px] font-semibold tracking-[0.06em] text-ink-600">
                      WORK EMAIL
                    </label>
                    <input
                      id="pilot-email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="a.mwangi@county.go.ke"
                      autoComplete="email"
                      className="h-12 w-full rounded-lg border border-ink-200 bg-paper px-4 text-[14px] text-ink-900 outline-none transition-all placeholder:text-ink-400 focus:border-ink-950 focus:bg-white focus:ring-2 focus:ring-ink-950/10 dark:placeholder:text-ink-400"
                    />
                  </div>
                  <div>
                    <label htmlFor="pilot-org" className="mb-1 block font-code text-[10px] font-semibold tracking-[0.06em] text-ink-600">
                      INSTITUTION · OPTIONAL
                    </label>
                    <input
                      id="pilot-org"
                      type="text"
                      value={form.institution}
                      onChange={(e) => setForm((f) => ({ ...f, institution: e.target.value }))}
                      placeholder="County health agency"
                      autoComplete="organization"
                      className="h-12 w-full rounded-lg border border-ink-200 bg-paper px-4 text-[14px] text-ink-900 outline-none transition-all placeholder:text-ink-400 focus:border-ink-950 focus:bg-white focus:ring-2 focus:ring-ink-950/10 dark:placeholder:text-ink-400"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <div className="mb-1">
                      <label htmlFor="pilot-notes" className="font-code text-[10px] font-semibold tracking-[0.06em] text-ink-600">
                        NOTES · OPTIONAL
                      </label>
                      <p id="pilot-notes-hint" className="mt-1 text-[12px] leading-relaxed text-ink-500">
                        Sent to our team with your request. Share review volume, data sources, or deployment needs.
                      </p>
                    </div>
                    <textarea
                      id="pilot-notes"
                      value={form.notes}
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                      placeholder="Tell us what your team would like to review."
                      rows={3}
                      maxLength={3000}
                      aria-describedby="pilot-notes-hint pilot-notes-count"
                      className="w-full resize-y rounded-lg border border-ink-200 bg-paper px-4 py-3 text-[14px] leading-relaxed text-ink-900 outline-none transition-all placeholder:text-ink-400 focus:border-ink-950 focus:bg-white focus:ring-2 focus:ring-ink-950/10"
                    />
                    <p id="pilot-notes-count" className="mt-1 text-right text-[11px] tabular-nums text-ink-400">
                      {form.notes.length.toLocaleString()} / 3,000
                    </p>
                  </div>
                  <div className="flex items-end sm:col-span-3 sm:justify-end">
                    <button
                      type="submit"
                      disabled={state === "sending"}
                      className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink-950 px-6 text-[14.5px] font-semibold text-white transition-all hover:bg-ink-900 disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
                    >
                      {state === "sending" ? (
                        <>
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
                          Sending
                        </>
                      ) : (
                        <>
                          Request pilot
                          <Send className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
                        </>
                      )}
                    </button>
                  </div>
                </form>

                <div aria-live="polite">
                  {error && (
                    <p role="alert" className="mt-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-[13px] font-semibold text-brand-800">
                      {error}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
