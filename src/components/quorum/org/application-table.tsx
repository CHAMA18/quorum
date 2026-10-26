"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Download, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fmtStamp,
  money,
  statusMeta,
  type Application,
  type StatusTone,
  type Tender,
} from "./supplier-data";

/**
 * The applications ledger. One table, two placements: the latest three on the
 * overview, the whole record (with status filters) on the Applications tab.
 * A row is an audited fact — nonce reference, bid, attested identity, filing
 * time in UTC — so every cell comes from the record, nothing is dressed up.
 */

const toneCls: Record<StatusTone, string> = {
  progress: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  done: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  muted: "border-ink-200 bg-ink-50 text-ink-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-600",
};

const dotCls: Record<StatusTone, string> = {
  progress: "bg-amber-500",
  done: "bg-emerald-500",
  muted: "bg-ink-300 dark:bg-ink-400",
};

const TH =
  "whitespace-nowrap py-2.5 font-code text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-500";

function receipt(a: Application, tender: Tender | undefined) {
  const payload = {
    application: a,
    tender: tender ?? null,
    attestedAs: `org:${a.orgName}`,
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${a.id}-receipt.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ApplicationTable({
  applications,
  tenders,
  onViewTender,
  onBrowse,
  limit,
  filterable = false,
  orgName,
}: {
  applications: Application[];
  tenders: Tender[];
  onViewTender: (ref: string) => void;
  onBrowse: () => void;
  /** Rows to show (the overview shows the latest three). */
  limit?: number;
  filterable?: boolean;
  orgName: string;
}) {
  const [filter, setFilter] = useState("ALL");

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of applications) {
      const k = a.status.toUpperCase();
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return map;
  }, [applications]);

  const filters = useMemo(() => {
    const base = [{ id: "ALL", label: "All", n: applications.length }];
    for (const [id, label] of [
      ["RECEIVED", "Received"],
      ["WITHDRAWN", "Withdrawn"],
    ] as const) {
      if ((counts.get(id) ?? 0) > 0) base.push({ id, label, n: counts.get(id) ?? 0 });
    }
    return base;
  }, [applications.length, counts]);

  const rows = useMemo(() => {
    const list = filter === "ALL" ? applications : applications.filter((a) => a.status.toUpperCase() === filter);
    return limit ? list.slice(0, limit) : list;
  }, [applications, filter, limit]);

  const tenderOf = (ref: string) => tenders.find((t) => t.ref === ref);

  if (rows.length === 0) {
    return (
      <div className="px-5 py-12 text-center">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-full border border-ink-100 bg-ink-50 text-ink-400 dark:border-white/10 dark:bg-white/[0.03]">
          <Inbox className="h-5 w-5" aria-hidden="true" />
        </span>
        <p className="mt-3 text-[14px] font-semibold text-ink-900 dark:text-ink-800">
          {filter === "ALL" ? "Nothing filed yet" : "No applications in this state"}
        </p>
        <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-ink-500">
          {filter === "ALL"
            ? "The first application lands on this record the moment you file it — with your attested identity and the filing time."
            : "Switch the filter to see the rest of the record."}
        </p>
        {filter === "ALL" ? (
          <button
            type="button"
            onClick={onBrowse}
            className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink-950 px-3.5 text-[12px] font-semibold text-white transition-colors hover:bg-brand-600 dark:bg-white dark:text-night dark:hover:bg-brand-500 dark:hover:text-white"
          >
            Browse opportunities
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      {filterable ? (
        <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
          <div className="inline-flex rounded-lg border border-ink-100 bg-sand/70 p-0.5 dark:border-white/10 dark:bg-white/[0.03]">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                className={cn(
                  "rounded-md px-2.5 py-1 font-code text-[10.5px] font-semibold tracking-[0.06em] transition-colors",
                  filter === f.id
                    ? "bg-white text-ink-950 shadow-sm dark:bg-white/10 dark:text-white"
                    : "text-ink-500 hover:text-ink-900 dark:hover:text-white",
                )}
              >
                {f.label} ({f.n})
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse text-left">
          <thead>
            <tr className="border-y border-ink-100 dark:border-white/[0.06]">
              <th scope="col" className={cn(TH, "pl-5 pr-3")}>
                Reference
              </th>
              <th scope="col" className={cn(TH, "px-3")}>
                Tender &amp; scope
              </th>
              <th scope="col" className={cn(TH, "px-3 text-right")}>
                Bid
              </th>
              <th scope="col" className={cn(TH, "px-3")}>
                Attested as
              </th>
              <th scope="col" className={cn(TH, "px-3")}>
                Submitted
              </th>
              <th scope="col" className={cn(TH, "px-3")}>
                Desk status
              </th>
              <th scope="col" className={cn(TH, "py-2.5 pl-3 pr-5 text-right")}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100/70 dark:divide-white/[0.05]">
            {rows.map((a) => {
              const meta = statusMeta(a.status);
              const stamp = fmtStamp(a.receivedAt);
              const t = tenderOf(a.tenderId);
              return (
                <tr key={a.id} className="group transition-colors hover:bg-ink-50/60 dark:hover:bg-white/[0.025]">
                  <td className="whitespace-nowrap py-3.5 pl-5 pr-3">
                    <div className="flex items-center gap-2">
                      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotCls[meta.tone])} aria-hidden="true" />
                      <span className="font-code text-[11.5px] font-semibold tracking-[0.02em] text-ink-900 dark:text-ink-800">
                        {a.tenderId}
                      </span>
                    </div>
                    <p className="mt-0.5 pl-3.5 font-code text-[9.5px] tracking-[0.08em] text-ink-500">{a.id}</p>
                  </td>
                  <td className="px-3 py-3.5">
                    <p className="max-w-[280px] truncate text-[13px] font-medium text-ink-900 dark:text-ink-800">
                      {t?.title ?? a.tenderId}
                    </p>
                    <p className="mt-0.5 max-w-[280px] truncate text-[11.5px] text-ink-500">
                      {t ? `${t.buyer} · ${t.format}` : "Tender pack no longer staged"}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3.5 text-right">
                    <span className="font-code text-[12px] font-semibold tabular text-ink-900 dark:text-ink-800">
                      {money(a.amount, a.currency ?? t?.currency)}
                    </span>
                  </td>
                  <td className="px-3 py-3.5">
                    <span className="inline-flex max-w-[200px] items-center gap-1.5 rounded-md bg-sand/80 px-2 py-1 font-code text-[10px] text-ink-600 dark:bg-white/[0.06] dark:text-ink-600">
                      <span className="truncate">org:{a.orgName || orgName}</span>
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3.5">
                    <p className="font-code text-[11px] text-ink-700 dark:text-ink-700">{stamp.day}</p>
                    <p className="mt-0.5 font-code text-[9.5px] tracking-[0.08em] text-ink-500">{stamp.time}</p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3.5">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-code text-[10px] font-semibold tracking-[0.04em]",
                        toneCls[meta.tone],
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", dotCls[meta.tone])} aria-hidden="true" />
                      {meta.label}
                    </span>
                    {meta.note ? <p className="mt-1 text-[10px] text-ink-500">{meta.note}</p> : null}
                  </td>
                  <td className="whitespace-nowrap py-3.5 pl-3 pr-5 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onViewTender(a.tenderId)}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-ink-100 bg-white px-2.5 text-[11px] font-semibold text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-700 dark:hover:border-brand-500/40 dark:hover:text-brand-300"
                      >
                        View tender
                      </button>
                      <button
                        type="button"
                        onClick={() => receipt(a, t)}
                        title="Download this application's receipt"
                        aria-label={`Download the receipt for application ${a.id}`}
                        className="grid h-8 w-8 place-items-center rounded-md text-ink-400 transition-colors hover:bg-ink-50 hover:text-brand-700 dark:hover:bg-white/[0.06] dark:hover:text-brand-300"
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
