"use client";

import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  CircleAlert,
  CircleCheck,
  Lock,
  RotateCw,
} from "lucide-react";
import { ApplicationTable } from "./application-table";
import { SpecBar } from "@/components/quorum/reveal";
import {
  fmtDate,
  fmtStamp,
  publicReferenceLabel,
  type Application,
  type Tender,
} from "./supplier-data";

/**
 * The supplier's overview — the first thing the desk shows them.
 *
 * Read as a register rather than a feed: lead with the useful figure and the
 * evidence behind it. Nothing here is invented — when the record hasn't
 * answered yet, the card says so.
 */

/** The shared panel: hairline frame, lit edge, and the number the card carries. */
function Panel({
  children,
  className,
  glow = false,
  labelledBy,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  /** One faint signal wash in the corner — used once, on the opening card. */
  glow?: boolean;
  labelledBy?: string;
  label?: string;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      aria-label={label}
      className={`relative overflow-hidden rounded-[12px] supplier-panel panel dark:bg-night-2 ${className ?? ""}`}
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
  onTab: (tab: "profile" | "opportunities" | "applications" | "documents") => void;
  onMissingField: (field: string) => void;
  onBrowse: () => void;
  onViewTender: (ref: string) => void;
  onRetry: () => void;
}) {
  const pct = profile.total > 0 ? Math.round((profile.filled / profile.total) * 100) : 0;
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
      <header className="flex flex-col gap-3 border-b border-ink-200/70 pb-4 dark:border-white/10 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow text-brand-700 dark:text-brand-400">SUPPLIER PORTAL</p>
          <h1 className="type-display mt-2 text-[26px] text-ink-950 dark:text-white sm:text-[30px]">Overview</h1>
          <p className="mt-1.5 max-w-[64ch] text-[13px] leading-relaxed text-ink-600 dark:text-ink-300">
            Track profile readiness, live tender opportunities and filed applications.
          </p>
        </div>
      </header>

      <Panel glow labelledBy="supplier-profile-status-title" className="p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-brand-500/20 bg-brand-500/[0.08] text-brand-600 dark:text-brand-300">
                <Building2 className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <p className="eyebrow text-brand-700 dark:text-brand-400">PROFILE READINESS</p>
                <h2 id="supplier-profile-status-title" className="type-title mt-1 text-ink-950 dark:text-white">
                  {profile.missing.length > 0 ? "Complete your supplier profile" : "Your supplier profile is complete"}
                </h2>
              </div>
            </div>
            <p className="mt-2.5 max-w-[62ch] text-[13px] leading-relaxed text-ink-600 dark:text-ink-300">
              {profile.missing.length > 0
                ? `Add these ${profile.missing.length} details so the procurement desk can verify your identity and match relevant opportunities.`
                : "Your profile details are on record for verification and opportunity matching."}
            </p>
          </div>
          <div className="flex shrink-0 items-center justify-between gap-4 rounded-xl border border-ink-200/70 bg-paper/80 px-4 py-3 dark:border-white/10 dark:bg-white/[0.035] sm:min-w-[220px]">
            <div>
              <p className="type-micro text-ink-600 dark:text-ink-300">ON RECORD</p>
              <p className="mt-1 text-[13px] font-semibold text-ink-700 dark:text-ink-200">{profile.filled} of {profile.total} details</p>
            </div>
            <p className="type-num text-[36px] text-ink-950 dark:text-white">
              {pct}<span className="text-[19px] text-ink-400">%</span>
            </p>
          </div>
        </div>

        <div className="mt-4">
          <div
            role="progressbar"
            aria-label="Supplier profile details on record"
            aria-valuemin={0}
            aria-valuemax={profile.total}
            aria-valuenow={profile.filled}
            className="h-2.5 w-full overflow-hidden rounded-full bg-ink-100/80 dark:bg-white/[0.08]"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-600 via-rose-500 to-amber-500 transition-[width] duration-700 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11.5px] font-medium text-ink-600 dark:text-ink-300">
            <span>{profile.filled} on record</span>
            <span>{profile.missing.length === 0 ? "No details outstanding" : `${profile.missing.length} to complete`}</span>
          </div>
        </div>

        <div className="mt-4 border-t border-ink-200/70 pt-4 dark:border-white/10">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-[13px] font-semibold text-ink-900 dark:text-white">Profile details to complete</h3>
              <p className="mt-0.5 max-w-[72ch] text-[12px] text-ink-600 dark:text-ink-300">
                {profile.missing.length > 0
                  ? "Choose an organization field. The bid documents you keep on record live under Documents."
                  : "Every organization field is on record. Your bid documents live under Documents."}
              </p>
            </div>
            {profile.missing.length > 0 ? (
              <button
                type="button"
                onClick={() => onMissingField(profile.missing[0])}
                className="focus-brand inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 text-[12px] font-semibold text-white transition-colors hover:bg-brand-700"
              >
                Complete profile <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onTab("profile")}
                className="focus-brand inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-ink-200/80 px-3.5 text-[12px] font-semibold text-ink-700 transition-colors hover:border-ink-400 dark:border-white/15 dark:text-ink-200 dark:hover:border-white/30"
              >
                Review profile <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          {profile.missing.length > 0 ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {profile.missing.map((field) => (
                <button
                  key={field}
                  type="button"
                  onClick={() => onMissingField(field)}
                  className="focus-brand group flex min-h-11 items-center justify-between gap-3 rounded-lg border border-ink-200/80 bg-white/70 px-3 text-left text-[12.5px] font-medium capitalize text-ink-800 transition-colors hover:border-brand-400 hover:bg-brand-50 dark:border-white/10 dark:bg-white/[0.025] dark:text-ink-100 dark:hover:border-brand-500/40 dark:hover:bg-brand-500/[0.06]"
                >
                  <span className="min-w-0 truncate">{field}</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-400 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-3 flex items-center gap-2 text-[12.5px] font-semibold text-emerald-800 dark:text-emerald-300">
              <CircleCheck className="h-4 w-4" aria-hidden="true" /> All requested profile details are on record.
            </p>
          )}

          <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-ink-500 dark:text-ink-400">
            <span>Bid documents are held in one place on the overall record.</span>
            <button
              type="button"
              onClick={() => onTab("documents")}
              className="focus-brand inline-flex items-center gap-1 rounded font-semibold text-brand-700 transition-colors hover:text-brand-600 dark:text-brand-300 dark:hover:text-brand-200"
            >
              Open Documents
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </button>
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-ink-200/70 pt-3 text-[11.5px] leading-relaxed text-ink-500 dark:border-white/10 dark:text-ink-400">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Registered {fmtDate(orgCreatedAt)} · submissions are attested as <span className="font-semibold text-brand-700 dark:text-brand-300">org:{orgName}</span>.</span>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Open opportunities */}
        <Panel labelledBy="supplier-opportunities-heading" className="p-4 sm:p-5">
          <h2 id="supplier-opportunities-heading" className="sr-only">Open opportunities</h2>
          <SpecBar
            index="01"
            label="Open opportunities"
            meta={tenders === null ? "Reading the board…" : `${open.length} live · ${closed} closed`}
          />

          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,140px)_minmax(0,1fr)] sm:items-center sm:gap-5">
            <div className="flex items-baseline gap-2.5">
              <p className="type-num text-[44px] text-ink-950 tabular dark:text-white">
                {tenders === null ? "—" : open.length}
              </p>
              <p className="pb-1 type-micro text-ink-600 dark:text-ink-300">
                live {open.length === 1 ? "tender" : "tenders"}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[12.5px] leading-relaxed text-ink-600 dark:text-ink-300">
                {tenders === null
                  ? tendersError ?? "Reading the opportunities board…"
                  : open.length === 0
                    ? "No live tenders are available right now. New opportunities will appear here when published."
                    : `Open to bid across ${sectors.length} ${sectors.length === 1 ? "sector" : "sectors"}${
                        sectors.length > 0 ? ` — ${sectors.slice(0, 3).join(", ")}` : ""
                      }.`}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {soonest.map((t) => (
                  <span
                    key={t.ref}
                    className="rounded-full border border-ink-200/70 bg-paper-2/50 px-2.5 py-1 font-code text-[10px] tracking-[0.06em] text-ink-600 tabular dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-300"
                  >
                    {publicReferenceLabel(t.systemReference)} · {t.daysLeft}d
                  </span>
                ))}
                {open.length > soonest.length ? (
                  <span className="rounded-full border border-brand-500/30 bg-brand-500/[0.08] px-2.5 py-1 font-code text-[10px] font-semibold tracking-[0.06em] text-brand-700 tabular dark:text-brand-300">
                    +{open.length - soonest.length} more
                  </span>
                ) : null}
                {closed > 0 ? (
                  <span className="rounded-full border border-ink-200/70 px-2.5 py-1 font-code text-[10px] tracking-[0.06em] text-ink-500 dark:border-white/10 dark:text-ink-300">
                    {closed} closed
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onBrowse}
            className="focus-brand group mt-4 inline-flex min-h-11 w-full items-center justify-between gap-1.5 border-t border-ink-200/70 pt-3 text-[13px] font-semibold text-brand-700 transition-colors hover:text-brand-600 dark:border-white/10 dark:text-brand-300 dark:hover:text-brand-200"
          >
            Browse tenders
            <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden="true" />
          </button>
        </Panel>

        {/* Applications on record */}
        <Panel labelledBy="supplier-applications-heading" className="p-4 sm:p-5">
          <h2 id="supplier-applications-heading" className="sr-only">Applications on record</h2>
          <SpecBar
            index="02"
            label="Applications on record"
            meta={applications === null ? "Reading the ledger…" : `${filed.length} filed`}
          />

          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,140px)_minmax(0,1fr)] sm:items-center sm:gap-5">
            <div className="flex items-baseline gap-2.5">
              <p className="type-num text-[44px] text-ink-950 tabular dark:text-white">
                {applications === null ? "—" : filed.length}
              </p>
              <p className="inline-flex items-center gap-1.5 pb-1 type-micro text-emerald-700 dark:text-emerald-300">
                <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />
                {applications === null ? "— received" : `${received} received`}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[12.5px] leading-relaxed text-ink-600 dark:text-ink-300">
                {applications === null
                  ? applicationsError ?? "Reading the applications ledger…"
                  : filed.length === 0
                    ? "Your filed bids and their receipt times will appear here."
                    : "Your submissions are recorded with your organization's attested identity."}
              </p>
              <dl className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-ink-200/70 bg-paper-2/50 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
                <dt className="text-[11px] font-medium text-ink-600 dark:text-ink-300">Latest filing</dt>
                <dd className="text-right text-[11px] font-medium text-ink-700 tabular dark:text-ink-200">
                  {latestStamp ? <>{latestStamp.day} <span className="text-ink-500 dark:text-ink-400">{latestStamp.time}</span></> : "—"}
                </dd>
              </dl>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onTab("applications")}
            className="focus-brand group mt-4 inline-flex min-h-11 w-full items-center justify-between gap-1.5 border-t border-ink-200/70 pt-3 text-[13px] font-semibold text-brand-700 transition-colors hover:text-brand-600 dark:border-white/10 dark:text-brand-300 dark:hover:text-brand-200"
          >
            Track applications
            <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden="true" />
          </button>
        </Panel>
      </div>

      {/* ── 03 · Latest applications ─────────────────────────────────────── */}
      <Panel label="Latest applications">
        <div className="px-5 pt-5">
          <SpecBar
            index="03"
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
              className="focus-brand inline-flex min-h-11 items-center gap-1.5 rounded-full border border-ink-200/80 bg-white px-3.5 text-[12.5px] font-semibold text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-200 dark:hover:border-brand-500/40 dark:hover:text-brand-300"
            >
              New submission
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onTab("applications")}
              className="focus-brand group inline-flex min-h-11 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-semibold text-brand-700 transition-colors hover:text-brand-600 dark:text-brand-300 dark:hover:text-brand-200"
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
                <p role="alert" className="flex items-start gap-2 text-[12.5px] text-ink-600">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />
                  {applicationsError}
                </p>
                <button
                  type="button"
                  onClick={onRetry}
                  className="focus-brand inline-flex min-h-11 items-center gap-1.5 rounded-full border border-ink-200/80 px-3.5 text-[12.5px] font-semibold text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700 dark:border-white/15 dark:text-ink-200"
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
