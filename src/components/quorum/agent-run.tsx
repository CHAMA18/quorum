"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ClipboardCheck, FileCheck2, FileSearch, RotateCw, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface ActivityEntry {
  id?: string;
  seq?: number;
  ts?: string;
  tool?: string;
  status?: string;
}

const ACTION_LABELS: Record<string, string> = {
  plan_review: "Review criteria selected",
  load_documents: "Tender documents opened",
  extract_requirements: "Tender requirements checked",
  flag_finding: "Review finding recorded",
  verify_finding: "Finding evidence verified",
  draft_redline: "Clarification draft prepared",
  propose_gate: "Approval requested",
  file_gate_submission: "Committee decision recorded",
  supplier_application: "Supplier application received",
  supplier_add: "Supplier profile added",
};

function actionLabel(tool?: string): string {
  if (!tool) return "Review activity recorded";
  if (ACTION_LABELS[tool]) return ACTION_LABELS[tool];
  return tool
    .replace(/^quorum_/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function timeLabel(timestamp?: string): string {
  if (!timestamp) return "Time unavailable";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusFor(entry: ActivityEntry): { label: string; tone: "neutral" | "brand" | "amber" } {
  if (entry.status === "PENDING_GATE") return { label: "Awaiting approval", tone: "amber" };
  if (entry.status === "ERROR" || entry.status === "FAILED") {
    return { label: "Needs attention", tone: "brand" };
  }
  if (entry.status === "OK") return { label: "Recorded", tone: "neutral" };
  return { label: "In progress", tone: "neutral" };
}

const ACTION_ICONS = [FileSearch, FileCheck2, ShieldCheck] as const;

/** A redacted, customer-facing view of recent review activity. */
export function AgentRun() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let alive = true;
    let pending = false;

    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch("/api/public/summary", { cache: "no-store" });
        if (!response.ok) throw new Error("Activity is unavailable");
        const data = (await response.json()) as { activity?: ActivityEntry[] };
        if (alive) {
          setEntries(data.activity ?? []);
          setUnavailable(false);
        }
      } catch {
        if (alive) setUnavailable(true);
      } finally {
        pending = false;
        if (alive) {
          setLoaded(true);
          setRefreshing(false);
        }
      }
    };

    void load();
    const interval = window.setInterval(() => void load(), 15_000);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [refreshKey]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((current) => current + 1);
  }, []);

  return (
    <section
      aria-label="Recent review activity"
      className="relative overflow-hidden rounded-[16px] border border-white/10 bg-night-2 shadow-[0_2px_4px_rgba(0,0,0,0.35),0_36px_72px_-44px_rgba(0,0,0,0.8)]"
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.04] via-transparent to-white/[0.015]" aria-hidden="true" />

      <div className="relative flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.09] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-brand-300">
            <ClipboardCheck className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-[13px] font-semibold text-white">Recent review activity</h2>
            <p className="mt-1 text-[11px] text-ink-400">Updates automatically every 15 seconds</p>
          </div>
        </div>
        <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 font-code text-[9px] font-semibold tracking-[0.1em] text-ink-300">
          PUBLIC PREVIEW
        </span>
      </div>

      <div className="relative min-h-[280px] space-y-2.5 px-4 py-5 sm:min-h-[320px] sm:px-6">
        {!loaded ? (
          <p className="rounded-xl border border-white/[0.08] bg-white/[0.025] px-4 py-5 text-[13px] text-ink-400">
            Loading recent activity…
          </p>
        ) : entries.length === 0 ? (
          <div className="flex min-h-[230px] flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.12] px-6 text-center">
            {unavailable ? (
              <AlertCircle className="h-5 w-5 text-ink-400" aria-hidden="true" />
            ) : (
              <ClipboardCheck className="h-5 w-5 text-ink-400" aria-hidden="true" />
            )}
            <p className="mt-3 text-[13px] font-medium text-ink-200">
              {unavailable ? "Activity is temporarily unavailable" : "No recent review activity"}
            </p>
            <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-ink-400">
              {unavailable
                ? "Please check again shortly."
                : "Updates will appear here after a review has started."}
            </p>
          </div>
        ) : (
          entries.slice(0, 8).map((entry, index) => {
            const status = statusFor(entry);
            const Icon = ACTION_ICONS[index % ACTION_ICONS.length];
            return (
              <article
                key={entry.id ?? `${entry.seq ?? "activity"}-${index}`}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3.5 py-3 transition-colors hover:border-white/[0.14] hover:bg-white/[0.045] sm:px-4"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-brand-300">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium text-white">{actionLabel(entry.tool)}</p>
                  <p className="mt-1 text-[10.5px] text-ink-400">{timeLabel(entry.ts)}</p>
                </div>
                <span
                  className={cn(
                    "inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                    status.tone === "neutral" && "border-white/10 bg-white/[0.035] text-ink-300",
                    status.tone === "brand" && "border-brand-400/25 bg-brand-500/10 text-brand-300",
                    status.tone === "amber" && "border-amber-300/20 bg-amber-400/10 text-amber-200"
                  )}
                >
                  {status.label}
                </span>
              </article>
            );
          })
        )}
      </div>

      <div className="relative flex items-center justify-between gap-3 border-t border-white/[0.09] bg-white/[0.025] px-5 py-3 sm:px-6">
        <p className="text-[11px] text-ink-400">Activity is redacted for this public preview.</p>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="focus-brand inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-ink-200 transition-colors hover:border-brand-400/60 hover:bg-brand-500/10 hover:text-white disabled:cursor-wait disabled:opacity-60"
        >
          <RotateCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} aria-hidden="true" />
          Refresh
        </button>
      </div>
    </section>
  );
}
