"use client";

import { ArrowRight, CircleAlert, RotateCw } from "lucide-react";
import { ApplicationTable } from "./application-table";
import type { Application, Tender } from "./supplier-data";

/**
 * The supplier's overview — the first thing the desk shows them.
 *
 * One clear next step, then two plain status cards. Everything else lives on
 * the tab it belongs to; nothing here is invented — when the record hasn't
 * answered yet, the card says so.
 */

export function SupplierOverview({
  orgName,
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
  const open = (tenders ?? []).filter((t) => t.status === "OPEN");
  const filed = applications ?? [];
  const received = filed.filter((a) => a.status.toUpperCase() === "RECEIVED").length;
  const needsProfile = profile.missing.length > 0;

  const nextStep = needsProfile
    ? {
        title: "Complete your profile",
        body: `Add ${profile.missing.length} ${profile.missing.length === 1 ? "detail" : "details"} so the procurement team can verify ${orgName}.`,
        cta: "Complete profile",
        action: () => onMissingField(profile.missing[0]),
      }
    : filed.length === 0
      ? {
          title: "Find your first tender",
          body: "Browse the tenders that are open for applications, then submit a bid when you are ready.",
          cta: "Browse tenders",
          action: onBrowse,
        }
      : {
          title: "Track your applications",
          body: `${filed.length} ${filed.length === 1 ? "application is" : "applications are"} on record. Check their status, or apply for another tender.`,
          cta: "View applications",
          action: () => onTab("applications"),
        };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <header>
        <p className="eyebrow text-brand-700 dark:text-brand-400">OVERVIEW</p>
        <h1 className="type-display mt-2 text-[27px] text-ink-950 dark:text-white sm:text-[31px]">
          Welcome back
        </h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-600 dark:text-ink-300">
          Here is where {orgName} stands, and what to do next.
        </p>
      </header>

      <section
        aria-labelledby="next-step-title"
        className="rounded-[12px] border border-ink-200/70 bg-white p-5 dark:border-white/10 dark:bg-night-2 sm:p-6"
      >
        <p className="type-micro text-brand-700 dark:text-brand-400">YOUR NEXT STEP</p>
        <h2 id="next-step-title" className="type-title mt-2 text-ink-950 dark:text-white">
          {nextStep.title}
        </h2>
        <p className="mt-2 max-w-[58ch] text-[13px] leading-relaxed text-ink-600 dark:text-ink-300">
          {nextStep.body}
        </p>
        <div className="mt-5 flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={nextStep.action}
            className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700"
          >
            {nextStep.cta}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          {needsProfile ? (
            <button
              type="button"
              onClick={onBrowse}
              className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink-200 px-4 text-[13px] font-semibold text-ink-700 transition-colors hover:border-ink-400 dark:border-white/15 dark:text-ink-200 dark:hover:border-white/30"
            >
              Browse tenders
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onTab("profile")}
              className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink-200 px-4 text-[13px] font-semibold text-ink-700 transition-colors hover:border-ink-400 dark:border-white/15 dark:text-ink-200 dark:hover:border-white/30"
            >
              View profile
            </button>
          )}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section
          aria-labelledby="overview-tenders-title"
          className="flex flex-col rounded-[12px] border border-ink-200/70 bg-white p-5 dark:border-white/10 dark:bg-night-2"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id="overview-tenders-title" className="text-[14px] font-semibold text-ink-950 dark:text-white">
              Tenders
            </h2>
            <span className="type-micro text-ink-500 dark:text-ink-400">
              {tenders === null ? "Loading" : `${open.length} open`}
            </span>
          </div>
          <p className="type-num mt-3 text-[34px] leading-none text-ink-950 dark:text-white">
            {tenders === null ? "—" : open.length}
          </p>
          <p className="mt-2 flex-1 text-[12.5px] leading-relaxed text-ink-600 dark:text-ink-300">
            {tenders === null
              ? tendersError ?? "Reading the tenders board…"
              : open.length === 0
                ? "No tenders are open right now. New ones will appear here."
                : "Open for applications now. Submissions close at each tender's deadline."}
          </p>
          <button
            type="button"
            onClick={onBrowse}
            className="focus-brand mt-4 inline-flex min-h-11 items-center gap-1.5 self-start text-[13px] font-semibold text-brand-700 transition-colors hover:text-brand-600 dark:text-brand-300 dark:hover:text-brand-200"
          >
            Browse tenders
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </section>

        <section
          aria-labelledby="overview-applications-title"
          className="flex flex-col rounded-[12px] border border-ink-200/70 bg-white p-5 dark:border-white/10 dark:bg-night-2"
        >
          <div className="flex items-center justify-between gap-3">
            <h2
              id="overview-applications-title"
              className="text-[14px] font-semibold text-ink-950 dark:text-white"
            >
              Applications
            </h2>
            <span className="type-micro text-ink-500 dark:text-ink-400">
              {applications === null ? "Loading" : `${filed.length} filed`}
            </span>
          </div>
          <p className="type-num mt-3 text-[34px] leading-none text-ink-950 dark:text-white">
            {applications === null ? "—" : filed.length}
          </p>
          <p className="mt-2 flex-1 text-[12.5px] leading-relaxed text-ink-600 dark:text-ink-300">
            {applications === null
              ? applicationsError ?? "Reading your applications…"
              : filed.length === 0
                ? "You have not filed any bids yet."
                : `${received} ${received === 1 ? "bid has" : "bids have"} been received by the procurement desk.`}
          </p>
          {applications === null && applicationsError ? (
            <button
              type="button"
              onClick={onRetry}
              className="focus-brand mt-4 inline-flex min-h-11 items-center gap-1.5 self-start text-[13px] font-semibold text-brand-700 dark:text-brand-300"
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onTab("applications")}
              className="focus-brand mt-4 inline-flex min-h-11 items-center gap-1.5 self-start text-[13px] font-semibold text-brand-700 transition-colors hover:text-brand-600 dark:text-brand-300 dark:hover:text-brand-200"
            >
              View applications
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </section>
      </div>

      {applicationsError && applications !== null ? (
        <p role="alert" className="flex items-start gap-2 text-[12.5px] text-ink-600 dark:text-ink-300">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />
          {applicationsError}
        </p>
      ) : null}

      {filed.length > 0 ? (
        <section
          aria-labelledby="overview-recent-title"
          className="overflow-hidden rounded-[12px] border border-ink-200/70 bg-white dark:border-white/10 dark:bg-night-2"
        >
          <div className="flex items-center justify-between gap-3 px-5 pt-5">
            <h2 id="overview-recent-title" className="text-[14px] font-semibold text-ink-950 dark:text-white">
              Recent applications
            </h2>
            <button
              type="button"
              onClick={() => onTab("applications")}
              className="focus-brand inline-flex min-h-11 items-center gap-1 text-[12.5px] font-semibold text-brand-700 dark:text-brand-300"
            >
              View all
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
          <div className="mt-2">
            <ApplicationTable
              applications={filed}
              tenders={tenders ?? []}
              onViewTender={onViewTender}
              onBrowse={onBrowse}
              limit={3}
              orgName={orgName}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
