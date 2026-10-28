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
import { SpecBar } from "@/components/quorum/reveal";
import {
  fmtDate,
  fmtStamp,
  type Application,
  type Tender,
} from "./supplier-data";

/**
 * The supplier's overview — the first thing the desk shows them.
 *
 * Read as a register rather than a feed: every card opens with the same
 * numbered spec line (index · what it is · the fact it is held to), then leads
 * with the one figure that matters and the evidence behind it. Nothing here is
 * invented — when the record hasn't answered yet, the card says so.
 */

/** The shared panel: hairline frame, lit edge, and the number the card carries. */
function Panel({
  children,
  className,
  glow = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** One faint signal wash in the corner — used once, on the opening card. */
  glow?: boolean;
}) {
  return (
    <section
      className={`relative overflow-hidden rounded-[12px] panel dark:bg-night-2 ${className ?? ""}`}
    >
      {glow ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full bg-brand-500/[0.06] blur-3xl dark:bg-brand-500/[0.10]"
        />
      ) : null}
      <div className="relative">{children}</div>
    </section>
  );
}

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
      {/* ── 01 · Profile completeness — the desk's own view of the supplier ── */}
      <Panel glow className="p-5 sm:p-7">
        <SpecBar
          index="01"
          label="Profile completeness"
          meta={
            profile.missing.length === 0
              ? "Complete — nothing outstanding"
              : `${profile.missing.length} item${profile.missing.length === 1 ? "" : "s"} outstanding`
          }
        />

        <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-12">
          <div className="min-w-0 max-w-[58ch]">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-brand-500/20 bg-brand-500/[0.08] text-brand-600 dark:text-brand-300">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              </span>
              <h2 className="type-title text-ink-950 dark:text-white">The desk reads you here</h2>
            </div>
            <p className="type-lede mt-4 text-ink-500">
              {profile.missing.length > 0
                ? `A complete profile is what the desk verifies before your first application lands. ${profile.missing.length} verification ${
                    profile.missing.length === 1 ? "item is" : "items are"
                  } still open.`
                : "Complete — every item the desk verifies is on record. Applications can be filed as they are."}
            </p>
          </div>

          {/* The readout: one figure, read at a glance, with its denominator. */}
          <div className="flex shrink-0 items-end gap-4">
            <p className="type-num text-[52px] text-ink-950 dark:text-white">
              {profile.filled}
              <span className="text-ink-300 dark:text-ink-600">/{profile.total}</span>
            </p>
            <div className="pb-1.5">
              <p className="type-micro text-ink-500">Verified</p>
              <p className="mt-1 type-micro text-brand-600 tabular dark:text-brand-400">{pct}% on record</p>
            </div>
          </div>
        </div>

        {/* The rail: one tick per verification item, so the bar can be counted,
            not just estimated. The fill runs red → amber as the file completes. */}
        <div className="mt-7">
          <div
            role="progressbar"
            aria-label="Profile completeness"
            aria-valuemin={0}
            aria-valuemax={profile.total}
            aria-valuenow={profile.filled}
            className="relative h-2.5 w-full overflow-hidden rounded-full bg-ink-100/80 dark:bg-white/[0.06]"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-600 via-rose-500 to-amber-500 transition-[width] duration-700 ease-out"
              style={{ width: `${pct}%` }}
            />
            <span aria-hidden="true" className="absolute inset-0 flex justify-between px-0.5">
              {Array.from({ length: Math.max(profile.total, 1) }).map((_, i) => (
                <span key={i} className="h-full w-px bg-white/35 dark:bg-night/40" />
              ))}
            </span>
          </div>
          <div className="mt-3 flex flex-col justify-between gap-1 type-micro text-ink-400 sm:flex-row">
            <span>
              {profile.filled} of {profile.total} verification items on record
            </span>
            <span>The desk checks the statutory record against the register</span>
          </div>
        </div>

        {profile.missing.length > 0 ? (
          <div className="mt-7 border-t border-ink-200/70 pt-5 dark:border-white/10">
            <p className="flex items-center gap-2 type-micro text-ink-500">
              <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
              </span>
              Action required
            </p>
            <div className="mt-3.5 flex flex-wrap gap-2">
              {profile.missing.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onMissingField(m)}
                  className="focus-brand group inline-flex items-center gap-2.5 rounded-full border border-ink-200/80 bg-paper-2/50 py-2 pl-3.5 pr-2.5 text-left transition-colors hover:border-brand-400 hover:bg-brand-500/[0.06] dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-brand-500/40"
                >
                  <span className="text-[12.5px] font-semibold capitalize text-ink-800 dark:text-ink-100">
                    {m}
                  </span>
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-600 font-code text-[12px] font-bold leading-none text-white transition-transform duration-300 group-hover:translate-x-0.5">
                    +
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-7 flex items-center gap-2.5 border-t border-ink-200/70 pt-5 text-[13px] font-semibold text-ink-900 dark:border-white/10 dark:text-ink-100">
            <CircleCheck className="h-4 w-4 text-emerald-500" aria-hidden="true" />
            Nothing outstanding — the register sees everything it asks for.
          </p>
        )}

        <div className="mt-7 flex flex-col gap-3 border-t border-ink-200/70 pt-5 sm:flex-row sm:items-center sm:justify-between dark:border-white/10">
          <p className="flex items-start gap-2.5 text-[12px] leading-relaxed text-ink-500">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden="true" />
            <span>
              Registered <span className="text-ink-700 tabular dark:text-ink-200">{fmtDate(orgCreatedAt)}</span> ·
              applications are attested as{" "}
              <span className="font-code text-[10.5px] font-semibold text-brand-700 dark:text-brand-300">
                org:{orgName}
              </span>{" "}
              and refused after each tender&apos;s closing date.
            </span>
          </p>
          <button
            type="button"
            onClick={() => onTab("profile")}
            className="focus-brand group inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[12.5px] font-semibold text-ink-600 transition-colors hover:text-ink-950 dark:text-ink-400 dark:hover:text-white"
          >
            Open profile
            <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden="true" />
          </button>
        </div>
      </Panel>

      {/* ── 02 · Open opportunities ──────────────────────────────────────── */}
      <Panel className="p-5 sm:p-6 lg:p-7">
        <SpecBar
          index="02"
          label="Open opportunities"
          meta={
            tenders === null
              ? "Reading the board…"
              : `${open.length} live · ${closed} closed`
          }
        />

        {/* Two columns split by a hairline: the figure, then the evidence. */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,260px)_1px_minmax(0,1fr)] lg:gap-8">
          <div className="flex items-baseline gap-3">
            <p className="type-num text-[52px] text-ink-950 tabular dark:text-white">
              {tenders === null ? "—" : open.length}
            </p>
            <p className="pb-1 type-micro text-ink-500">
              live {open.length === 1 ? "tender" : "tenders"}
            </p>
          </div>

          <span aria-hidden="true" className="rule-v hidden w-px lg:block" />

          <div className="min-w-0">
            <p className="text-[13px] leading-relaxed text-ink-500">
              {tenders === null
                ? tendersError ?? "Reading the opportunities board…"
                : open.length === 0
                  ? "No tender packs are staged on the desk yet. The board fills the moment an officer stages one."
                  : `Open to bid across ${sectors.length} ${sectors.length === 1 ? "sector" : "sectors"}${
                      sectors.length > 0 ? ` — ${sectors.slice(0, 3).join(", ")}` : ""
                    }.`}
            </p>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {soonest.map((t) => (
                <span
                  key={t.ref}
                  className="rounded-full border border-ink-200/70 bg-paper-2/50 px-2.5 py-1 font-code text-[9.5px] tracking-[0.1em] text-ink-600 tabular dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-300"
                >
                  {t.ref} · {t.daysLeft}d
                </span>
              ))}
              {open.length > soonest.length ? (
                <span className="rounded-full border border-brand-500/30 bg-brand-500/[0.08] px-2.5 py-1 font-code text-[9.5px] font-semibold tracking-[0.1em] text-brand-700 tabular dark:text-brand-300">
                  +{open.length - soonest.length} more
                </span>
              ) : null}
              {closed > 0 ? (
                <span className="rounded-full border border-ink-200/70 px-2.5 py-1 font-code text-[9.5px] tracking-[0.1em] text-ink-400 tabular dark:border-white/10">
                  {closed} closed
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onBrowse}
          className="focus-brand group mt-6 inline-flex items-center gap-1.5 border-t border-ink-200/70 pt-4 text-[12.5px] font-semibold text-brand-700 transition-colors hover:text-brand-600 dark:border-white/10 dark:text-brand-300 dark:hover:text-brand-200"
        >
          Browse the board
          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden="true" />
        </button>
      </Panel>

      {/* ── 03 · Applications on record ──────────────────────────────────── */}
      <Panel className="p-5 sm:p-6 lg:p-7">
        <SpecBar
          index="03"
          label="Applications on record"
          meta={applications === null ? "Reading the ledger…" : `${filed.length} filed`}
        />

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,260px)_1px_minmax(0,1fr)] lg:gap-8">
          <div className="flex items-baseline gap-3">
            <p className="type-num text-[52px] text-ink-950 tabular dark:text-white">
              {applications === null ? "—" : String(filed.length).padStart(2, "0")}
            </p>
            <p className="inline-flex items-center gap-1.5 pb-1 type-micro text-emerald-700 dark:text-emerald-300">
              <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {received} received
            </p>
          </div>

          <span aria-hidden="true" className="rule-v hidden w-px lg:block" />

          <div className="min-w-0">
            <p className="text-[13px] leading-relaxed text-ink-500">
              {applications === null
                ? applicationsError ?? "Reading the applications ledger…"
                : filed.length === 0
                  ? "Nothing filed yet. Your first bid lands here with the desk's receipt time."
                  : "Attested submissions sitting with the desk, each stamped with your organization's identity."}
            </p>

            <dl className="mt-4 flex items-center justify-between gap-3 rounded-[10px] border border-ink-200/70 bg-paper-2/50 px-3.5 py-2.5 dark:border-white/10 dark:bg-white/[0.03]">
              <dt className="type-micro text-ink-400">Latest filing</dt>
              <dd className="text-right font-code text-[10px] text-ink-700 tabular dark:text-ink-200">
                {latestStamp ? (
                  <>
                    {latestStamp.day} <span className="text-ink-400">{latestStamp.time}</span>
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </dl>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onTab("applications")}
          className="focus-brand group mt-6 inline-flex items-center gap-1.5 border-t border-ink-200/70 pt-4 text-[12.5px] font-semibold text-brand-700 transition-colors hover:text-brand-600 dark:border-white/10 dark:text-brand-300 dark:hover:text-brand-200"
        >
          Track them
          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden="true" />
        </button>
      </Panel>

      {/* ── 04 · Latest applications ─────────────────────────────────────── */}
      <Panel>
        <div className="px-5 pt-5">
          <SpecBar
            index="04"
            label="Latest applications"
            meta={
              applications !== null
                ? `${filed.length} ${filed.length === 1 ? "submission" : "submissions"}`
                : "Reading…"
            }
          />
        </div>
        <div className="flex flex-col gap-3 px-5 pb-4 pt-4 sm:flex-row sm:items-end sm:justify-between">
          <p className="max-w-[62ch] text-[12.5px] leading-relaxed text-ink-500">
            Every bid you file, with its tender reference, attested identity and the desk&apos;s receipt time.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onBrowse}
              className="focus-brand inline-flex h-9 items-center gap-1.5 rounded-full border border-ink-200/80 bg-white px-3.5 text-[11.5px] font-semibold text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-200 dark:hover:border-brand-500/40 dark:hover:text-brand-300"
            >
              New submission
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onTab("applications")}
              className="focus-brand group inline-flex h-9 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-semibold text-brand-700 transition-colors hover:text-brand-600 dark:text-brand-300 dark:hover:text-brand-200"
            >
              View all
              <ArrowRight className="h-3 w-3 transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {applications === null ? (
          <div className="border-t border-ink-200/70 dark:border-white/10">
            {applicationsError ? (
              <div className="flex flex-col items-start gap-3 px-5 py-8 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-start gap-2 text-[12.5px] text-ink-600">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />
                  {applicationsError}
                </p>
                <button
                  type="button"
                  onClick={onRetry}
                  className="focus-brand inline-flex h-9 items-center gap-1.5 rounded-full border border-ink-200/80 px-3.5 text-[11.5px] font-semibold text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700 dark:border-white/15 dark:text-ink-200"
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
          <div className="border-t border-ink-200/70 dark:border-white/10">
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
      </Panel>
    </div>
  );
}
