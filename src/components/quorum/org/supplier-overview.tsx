"use client";

import {
  ArrowRight,
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  Lock,
  RotateCw,
  ShieldCheck,
} from "lucide-react";
import { ApplicationTable } from "./application-table";
import {
  fmtDate,
  fmtStamp,
  type Application,
  type Tender,
} from "./supplier-data";

/**
 * The supplier's overview — the first thing the desk shows them. One reading
 * order: how complete the profile is (what the desk verifies), what is open to
 * bid on, what has been filed, and the ledger itself. Every figure is read from
 * the record; when the record hasn't answered yet the card says so instead of
 * inventing a number.
 */

export function SupplierOverview({
  orgName,
  orgCreatedAt,
  profile,
  tenders,
  applications,
  tendersError,
  applicationsError,
  onTab,
  onMissingField,
  onBrowse,
  onViewTender,
  onRetry,
}: {
  orgName: string;
  orgCreatedAt?: string | Date;
  profile: { filled: number; total: number; missing: string[] };
  tenders: Tender[] | null;
  applications: Application[] | null;
  tendersError: string | null;
  applicationsError: string | null;
  onTab: (tab: "profile" | "opportunities" | "applications") => void;
  onMissingField: (field: string) => void;
  onBrowse: () => void;
  onViewTender: (ref: string) => void;
  onRetry: () => void;
}) {
  const pct = Math.round((profile.filled / profile.total) * 100);
  const open = (tenders ?? []).filter((t) => t.status === "OPEN");
  const sectors = Array.from(new Set(open.map((t) => t.sector).filter(Boolean)));
  const soonest = [...open]
    .filter((t) => t.daysLeft !== undefined)
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
    .slice(0, 2);
  const filed = applications ?? [];
  const received = filed.filter((a) => a.status.toUpperCase() === "RECEIVED").length;
  const latest = filed[0];
  const latestStamp = latest ? fmtStamp(latest.receivedAt) : null;
  const closed = (tenders ?? []).filter((t) => t.status === "CLOSED").length;

  return (
    <div className="flex flex-col gap-5">
      {/* ── Profile completeness — the desk's own view of the supplier ───── */}
      <section className="relative overflow-hidden rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(11,12,15,0.05)] sm:p-7 dark:bg-night-2 dark:shadow-[0_24px_70px_-40px_rgba(0,0,0,0.9)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full bg-brand-500/[0.06] blur-3xl dark:bg-brand-500/[0.12]"
        />
        <div className="relative">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="grid h-7 w-7 place-items-center rounded-lg border border-brand-500/20 bg-brand-500/10 text-brand-600 dark:text-brand-300">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <h1 className="text-[19px] font-bold tracking-[-0.01em] text-ink-950 dark:text-white">
                  Profile completeness
                </h1>
              </div>
              <p className="mt-2 max-w-[56ch] text-[13px] leading-relaxed text-ink-500">
                {profile.missing.length > 0
                  ? `The desk reads a complete profile when your first application lands. ${profile.missing.length} verification ${
                      profile.missing.length === 1 ? "item" : "items"
                    } remaining.`
                  : "Complete — every item the desk verifies is on record. Applications can be filed as they are."}
              </p>
            </div>

            <div className="flex shrink-0 items-baseline gap-1.5 self-start rounded-xl bg-sand/70 px-3 py-1.5 dark:bg-white/[0.03]">
              <span className="font-code text-[22px] font-extrabold leading-none tabular text-ink-950 dark:text-white">
                {profile.filled}
              </span>
              <span className="font-code text-[10.5px] uppercase tracking-[0.1em] text-ink-400">
                / {profile.total} verified
              </span>
              <span className="ml-1 rounded bg-brand-500/10 px-1.5 py-0.5 font-code text-[10px] font-semibold text-brand-700 dark:text-brand-300">
                {pct}%
              </span>
            </div>
          </div>

          <div className="mt-5">
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-ink-100/70 p-0.5 dark:bg-white/[0.05]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-500 via-rose-500 to-amber-500 shadow-[0_0_18px_-4px_rgba(232,56,42,0.65)] transition-[width] duration-700 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-2 flex flex-col justify-between gap-1 font-code text-[9.5px] tracking-[0.06em] text-ink-500 sm:flex-row">
              <span>
                {profile.filled} of {profile.total} verification items on record
              </span>
              <span>The desk checks the statutory record against the register</span>
            </div>
          </div>

          {profile.missing.length > 0 ? (
            <div className="mt-6 border-t border-ink-100 pt-5 dark:border-white/[0.06]">
              <p className="flex items-center gap-1.5 font-code text-[9.5px] font-semibold uppercase tracking-[0.18em] text-ink-500">
                Action required <span className="text-[13px] leading-none text-brand-500">●</span>
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {profile.missing.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onMissingField(m)}
                    className="group inline-flex items-center gap-2 rounded-xl bg-ink-50/80 px-3 py-2 text-left transition-colors hover:bg-brand-500/[0.07] dark:bg-white/[0.05] dark:hover:bg-brand-500/[0.12]"
                  >
                    <span className="text-[12.5px] font-medium capitalize text-ink-700 dark:text-ink-700">{m}</span>
                    <span className="font-code text-[10.5px] text-brand-600 transition-transform group-hover:translate-x-0.5 dark:text-brand-400">
                      — add +
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-6 flex items-center gap-2 border-t border-ink-100 pt-5 text-[12.5px] font-semibold text-ink-900 dark:border-white/[0.06] dark:text-ink-800">
              <CircleCheck className="h-4 w-4 text-emerald-500" aria-hidden="true" />
              Nothing outstanding — the register sees everything it asks for.
            </p>
          )}

          <div className="mt-5 flex flex-col gap-2 border-t border-ink-100 pt-4 text-[11px] leading-relaxed text-ink-500 sm:flex-row sm:items-center sm:justify-between dark:border-white/[0.06]">
            <p className="flex items-start gap-2">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
              <span>
                Registered <span className="text-ink-600 dark:text-ink-600">{fmtDate(orgCreatedAt)}</span> · applications
                are attested as{" "}
                <span className="font-code text-[10.5px] font-semibold text-brand-700 dark:text-brand-300">
                  org:{orgName}
                </span>{" "}
                and refused after each tender&apos;s closing date.
              </span>
            </p>
            <button
              type="button"
              onClick={() => onTab("profile")}
              className="inline-flex shrink-0 items-center gap-1 font-semibold text-ink-500 transition-colors hover:text-ink-900 dark:hover:text-white"
            >
              Open profile
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      {/* ── Open opportunities ───────────────────────────────────────────── */}
      <article className="flex flex-col rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(11,12,15,0.05)] sm:p-6 lg:p-7 dark:bg-night-2 dark:shadow-[0_24px_70px_-40px_rgba(0,0,0,0.9)]">
          <div className="flex items-center justify-between">
            <p className="font-code text-[9.5px] font-semibold uppercase tracking-[0.18em] text-ink-500">
              Open opportunities
            </p>
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
            </span>
          </div>

          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
            <div className="flex items-baseline gap-2 lg:w-[300px] lg:shrink-0">
              <span className="font-code text-[38px] font-extrabold leading-none tabular tracking-tight text-ink-950 dark:text-white">
                {tenders === null ? "—" : open.length}
              </span>
              <span className="text-[12px] font-medium text-ink-500">
                live {open.length === 1 ? "tender" : "tenders"}
              </span>
            </div>

            <div className="min-w-0 lg:max-w-[760px] lg:flex-1">
              <p className="text-[12px] leading-relaxed text-ink-500">
                {tenders === null
                  ? tendersError ?? "Reading the opportunities board…"
                  : open.length === 0
                    ? "No tender packs are staged on the desk yet. The board fills the moment an officer stages one."
                    : `Open to bid across ${sectors.length} ${sectors.length === 1 ? "sector" : "sectors"}${
                        sectors.length > 0 ? ` — ${sectors.slice(0, 3).join(", ")}` : ""
                      }.`}
              </p>

              <div className="mt-3 flex flex-wrap gap-1.5">
            {soonest.map((t) => (
              <span
                key={t.ref}
                className="rounded-md bg-sand/80 px-2 py-0.5 font-code text-[9.5px] text-ink-600 dark:bg-white/[0.05] dark:text-ink-600"
              >
                {t.ref} · {t.daysLeft}d
              </span>
            ))}
            {open.length > soonest.length ? (
              <span className="rounded-md bg-brand-500/10 px-2 py-0.5 font-code text-[9.5px] font-semibold text-brand-700 dark:text-brand-300">
                +{open.length - soonest.length} more
              </span>
            ) : null}
            {closed > 0 ? (
              <span className="rounded-md bg-ink-100/60 px-2 py-0.5 font-code text-[9.5px] text-ink-400 dark:bg-white/[0.05]">
                {closed} closed
              </span>
            ) : null}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onBrowse}
            className="group mt-5 inline-flex items-center gap-1.5 border-t border-ink-100 pt-4 text-[12.5px] font-semibold text-brand-700 transition-colors hover:text-brand-600 dark:border-white/[0.06] dark:text-brand-300 dark:hover:text-brand-200"
          >
            Browse the board
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </button>
        </article>

        <article className="flex flex-col rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(11,12,15,0.05)] sm:p-6 lg:p-7 dark:bg-night-2 dark:shadow-[0_24px_70px_-40px_rgba(0,0,0,0.9)]">
          <div className="flex items-center justify-between">
            <p className="font-code text-[9.5px] font-semibold uppercase tracking-[0.18em] text-ink-500">
              Applications on record
            </p>
            <span className="rounded bg-sand/80 px-1.5 py-0.5 font-code text-[9.5px] text-ink-500 dark:bg-white/[0.04] dark:text-ink-600">
              {applications === null ? "—" : `${filed.length} filed`}
            </span>
          </div>

          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
            <div className="flex items-baseline gap-2 lg:w-[300px] lg:shrink-0">
              <span className="font-code text-[38px] font-extrabold leading-none tabular tracking-tight text-ink-950 dark:text-white">
                {applications === null ? "—" : String(filed.length).padStart(2, "0")}
              </span>
              <span className="inline-flex items-center gap-1 font-code text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-300">
                <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />
                {received} received
              </span>
            </div>

            <div className="min-w-0 lg:max-w-[760px] lg:flex-1">
              <p className="text-[12px] leading-relaxed text-ink-500">
                {applications === null
                  ? applicationsError ?? "Reading the applications ledger…"
                  : filed.length === 0
                    ? "Nothing filed yet. Your first bid lands here with the desk's receipt time."
                    : "Attested submissions sitting with the desk, each stamped with your organization's identity."}
              </p>

              <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-sand/60 px-3 py-2 font-code text-[10px] dark:bg-white/[0.03]">
                <span className="text-ink-500">Latest filing</span>
            <span className="text-right text-ink-700 dark:text-ink-700">
              {latestStamp ? (
                <>
                  {latestStamp.day} <span className="text-ink-400">{latestStamp.time}</span>
                </>
              ) : (
                "—"
              )}
            </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onTab("applications")}
            className="group mt-5 inline-flex items-center gap-1.5 border-t border-ink-100 pt-4 text-[12.5px] font-semibold text-brand-700 transition-colors hover:text-brand-600 dark:border-white/[0.06] dark:text-brand-300 dark:hover:text-brand-200"
          >
            Track them
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </button>
        </article>

      {/* ── Latest applications ─────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(11,12,15,0.05)] dark:bg-night-2 dark:shadow-[0_24px_70px_-40px_rgba(0,0,0,0.9)]">
        <div className="flex flex-col gap-3 px-5 pb-4 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-[15.5px] font-bold tracking-[-0.01em] text-ink-950 dark:text-white">
                Latest applications
              </h2>
              {applications !== null ? (
                <span className="rounded-full bg-sand/80 px-2 py-0.5 font-code text-[9.5px] text-ink-500 dark:bg-white/[0.05] dark:text-ink-600">
                  {filed.length} {filed.length === 1 ? "submission" : "submissions"}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-[12px] text-ink-500">
              Every bid you file, with its tender reference, attested identity and the desk&apos;s receipt time.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBrowse}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ink-100 bg-white px-3 text-[11.5px] font-semibold text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-700 dark:hover:border-brand-500/40 dark:hover:text-brand-300"
            >
              New submission
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onTab("applications")}
              className="group inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11.5px] font-semibold text-brand-700 transition-colors hover:text-brand-600 dark:text-brand-300 dark:hover:text-brand-200"
            >
              View all
              <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {applications === null ? (
          <div className="border-t border-ink-100 dark:border-white/[0.06]">
            {applicationsError ? (
              <div className="flex flex-col items-start gap-3 px-5 py-8 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-start gap-2 text-[12.5px] text-ink-600 dark:text-ink-600">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />
                  {applicationsError}
                </p>
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ink-200 px-3 text-[11.5px] font-semibold text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700 dark:border-white/15 dark:text-ink-700"
                >
                  <RotateCw className="h-3 w-3" aria-hidden="true" /> Retry
                </button>
              </div>
            ) : (
              <div className="space-y-3 px-5 py-6" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-4">
                    <div className="h-3 w-24 animate-pulse rounded bg-ink-100 dark:bg-white/[0.06]" />
                    <div className="h-3 flex-1 animate-pulse rounded bg-ink-100/80 dark:bg-white/[0.04]" />
                    <div className="h-3 w-20 animate-pulse rounded bg-ink-100 dark:bg-white/[0.06]" />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="border-t border-ink-100 dark:border-white/[0.06]">
            <ApplicationTable
              applications={filed}
              tenders={tenders ?? []}
              onViewTender={onViewTender}
              onBrowse={onBrowse}
              limit={3}
              orgName={orgName}
            />
          </div>
        )}
      </section>
    </div>
  );
}
