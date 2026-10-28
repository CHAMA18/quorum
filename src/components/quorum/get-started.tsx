"use client";

import { useState } from "react";
import { ArrowRight, Check, Gauge, Send } from "lucide-react";
import { Reveal } from "@/components/quorum/reveal";
import type { AuthUser } from "@/lib/auth-types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const CHECKLIST = [
  { id: "portal", label: "Connect a portal — OCDS in, no scraping" },
  { id: "checklist", label: "Map your checklist — the documents your committee requires" },
  { id: "pilot", label: "Run a pilot tender — unedited, on live notices" },
  { id: "review", label: "Review findings — every claim carries its citation" },
  { id: "gate", label: "Sign the gate — the committee awards" },
];

type FormState = "idle" | "sending" | "sent" | "error";

/**
 * Get started — the product path from portal to first sourced report,
 * an interactive first-run readiness checklist, and a pilot-request
 * form persisted through /api/contact.
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
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({
    name: user?.name ?? "",
    email: user?.email ?? "",
    institution: user?.organization ?? "",
  });
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const count = CHECKLIST.filter((c) => checked[c.id]).length;
  const ready = count === CHECKLIST.length;

  function toggle(id: string) {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
    if (form.name.trim().length < 2 || !emailOk) {
      setError("Please give a name and a valid work email.");
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
          message: `Pilot request — institution: ${form.institution.trim() || "not specified"}.`,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Could not send your request.");
      }
      setState("sent");
      toast({
        title: "Request received",
        description: "We'll reply within one working day with your pilot portal list.",
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
                Start with one tender. Scale when the file convinces you.
              </h2>
            </Reveal>
            <Reveal delay={0.16}>
              <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-white/85">
                Your first run reads the tender end to end, on a real portal, with real notices.
              </p>
            </Reveal>
            <Reveal delay={0.22}>
              <div className="mt-9 flex flex-wrap items-center gap-3.5">
                <button
                  type="button"
                  onClick={onCreateAccount}
                  className="group inline-flex h-[52px] items-center gap-2 rounded-full bg-ink-950 px-7 text-[15px] font-semibold text-white transition-all hover:bg-ink-900 hover:shadow-[0_14px_36px_rgba(11,12,15,0.35)]"
                >
                  Create your account
                  <ArrowRight
                    className="h-4.5 w-4.5 transition-transform group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </button>
                <a
                  href="#pricing"
                  className="inline-flex h-[52px] items-center rounded-full border border-white/35 px-7 text-[15px] font-semibold text-white transition-all hover:border-white hover:bg-white/10"
                >
                  Compare tiers
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

          {/* First-run readiness checklist */}
          <Reveal delay={0.14} className="lg:col-span-5">
            <div className="rounded-[16px] bg-white p-6 shadow-[0_32px_80px_rgba(11,12,15,0.35)] sm:p-8">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 ring-1 ring-brand-200">
                    <Gauge className="h-5 w-5 text-brand-600" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="font-code text-[9.5px] font-semibold tracking-[0.24em] text-ink-500">
                      FIRST-RUN READINESS
                    </p>
                    <p className="font-display text-[18px] font-extrabold tracking-tight text-ink-950">
                      {ready ? "Ready for your first run" : `${count} of ${CHECKLIST.length} ready`}
                    </p>
                  </div>
                </div>
                <span
                  className={cn(
                    "font-code text-[12px] font-bold tabular",
                    ready ? "text-brand-600" : "text-ink-400"
                  )}
                >
                  {Math.round((count / CHECKLIST.length) * 100)}%
                </span>
              </div>

              {/* Progress bar */}
              <div
                className="mt-5 h-2 w-full overflow-hidden rounded-full bg-ink-100"
                role="progressbar"
                aria-valuenow={count}
                aria-valuemin={0}
                aria-valuemax={CHECKLIST.length}
                aria-label="First-run readiness"
              >
                <div
                  className="h-full rounded-full bg-brand-600 transition-all duration-500 ease-out"
                  style={{ width: `${(count / CHECKLIST.length) * 100}%` }}
                />
              </div>

              <ul className="mt-5 space-y-2.5">
                {CHECKLIST.map((item) => {
                  const on = !!checked[item.id];
                  return (
                    <li key={item.id}>
                      <label
                        htmlFor={`chk-${item.id}`}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-all focus-within:ring-2 focus-within:ring-brand-600/40 focus-within:ring-offset-2",
                          on
                            ? "border-brand-300 bg-brand-50/70"
                            : "border-ink-100 bg-paper hover:border-ink-200"
                        )}
                      >
                        <input
                          id={`chk-${item.id}`}
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(item.id)}
                          className="peer sr-only"
                        />
                        <span
                          aria-hidden="true"
                          className={cn(
                            "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-all",
                            on ? "border-brand-600 bg-brand-600 text-white" : "border-ink-300 bg-white"
                          )}
                        >
                          {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                        </span>
                        <span
                          className={cn(
                            "text-[13.5px] font-medium leading-snug transition-colors",
                            on ? "text-brand-900" : "text-ink-700"
                          )}
                        >
                          {item.label}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>

              <p
                aria-live="polite"
                className={cn(
                  "mt-5 rounded-xl px-4 py-3 text-center font-code text-[10.5px] font-semibold tracking-[0.16em] transition-colors",
                  ready ? "bg-brand-600 text-white" : "bg-sand text-ink-500"
                )}
              >
                {ready
                  ? "FIVE FOR FIVE — READY FOR YOUR FIRST RUN"
                  : "TICK ALL FIVE — THEN LAUNCH YOUR FIRST RUN"}
              </p>
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
                    We&apos;ll reply within one working day with your pilot portal list.
                  </p>
                </div>
                <p className="font-code text-[9.5px] tracking-[0.18em] text-brand-600">
                  GATE RULE APPLIES TO US TOO — A HUMAN REPLIES, NOT A BOT
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-code text-[9.5px] font-semibold tracking-[0.24em] text-brand-700">
                      REQUEST A PILOT
                    </p>
                    <p className="mt-1 text-[15px] font-semibold text-ink-950">
                      Three tenders, free — on your own portals.
                    </p>
                  </div>
                  <p className="font-code text-[9px] tracking-[0.16em] text-ink-400">
                    NO CARD · NO DECK · A REAL RUN
                  </p>
                </div>

                <form onSubmit={submit} className="mt-5 grid gap-3 sm:grid-cols-[1fr_1.2fr_1fr_auto]" noValidate>
                  <div>
                    <label htmlFor="pilot-name" className="mb-1 block font-code text-[9px] font-semibold tracking-[0.18em] text-ink-500">
                      NAME
                    </label>
                    <input
                      id="pilot-name"
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Amina Mwangi"
                      autoComplete="name"
                      className="h-12 w-full rounded-lg border border-ink-200 bg-paper px-4 text-[14px] text-ink-900 outline-none transition-all placeholder:text-ink-300 focus:border-ink-950 focus:bg-white focus:ring-2 focus:ring-ink-950/10"
                    />
                  </div>
                  <div>
                    <label htmlFor="pilot-email" className="mb-1 block font-code text-[9px] font-semibold tracking-[0.18em] text-ink-500">
                      WORK EMAIL
                    </label>
                    <input
                      id="pilot-email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="a.mwangi@county.go.ke"
                      autoComplete="email"
                      className="h-12 w-full rounded-lg border border-ink-200 bg-paper px-4 text-[14px] text-ink-900 outline-none transition-all placeholder:text-ink-300 focus:border-ink-950 focus:bg-white focus:ring-2 focus:ring-ink-950/10"
                    />
                  </div>
                  <div>
                    <label htmlFor="pilot-org" className="mb-1 block font-code text-[9px] font-semibold tracking-[0.18em] text-ink-500">
                      INSTITUTION · OPTIONAL
                    </label>
                    <input
                      id="pilot-org"
                      type="text"
                      value={form.institution}
                      onChange={(e) => setForm((f) => ({ ...f, institution: e.target.value }))}
                      placeholder="County health agency"
                      autoComplete="organization"
                      className="h-12 w-full rounded-lg border border-ink-200 bg-paper px-4 text-[14px] text-ink-900 outline-none transition-all placeholder:text-ink-300 focus:border-ink-950 focus:bg-white focus:ring-2 focus:ring-ink-950/10"
                    />
                  </div>
                  <div className="flex items-end">
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
