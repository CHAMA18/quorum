"use client";

import { useEffect, useState } from "react";
import { useLocale, LocaleSwitcher } from "@/components/quorum/locale-provider";
import type { OversightMetrics } from "@/lib/oversight-metrics";

interface MetricsPayload {
  metrics: OversightMetrics;
  sidecarReachable: boolean;
  source: { runs: number; tenders: number };
  integrations: {
    registryOrganizations: number;
    persistedCheckpoints: number;
  };
}

/** Live oversight metrics over /api/oversight/metrics, localized via the layout's LocaleProvider. */
export function OversightMetricsPanel() {
  const { t } = useLocale();
  const [data, setData] = useState<MetricsPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/oversight/metrics", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("metrics"))))
      .then((j) => { if (live) setData(j as MetricsPayload); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  const m = data?.metrics;
  const cells: Array<{ label: string; value: string }> = m
    ? [
        { label: t("oversight.totalRuns"), value: String(m.totalRuns) },
        { label: t("oversight.backlog"), value: String(m.backlog) },
        { label: t("oversight.completed"), value: String(m.completed) },
        { label: t("oversight.avgCycle"), value: m.avgCycleHours === null ? "—" : `${m.avgCycleHours.toFixed(1)}${t("oversight.hours")}` },
        { label: t("oversight.exceptions"), value: String(m.exceptionCount) },
        { label: t("integrations.registry"), value: String(data.integrations.registryOrganizations) },
        { label: t("integrations.checkpoints"), value: String(data.integrations.persistedCheckpoints) },
      ]
    : [];

  return (
    <section aria-label={t("oversight.title")} className="rounded-xl border border-ink-200/80 bg-white px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[16px] font-black tracking-[-0.01em] text-ink-950">{t("oversight.title")}</h2>
        <LocaleSwitcher />
      </div>
      {failed || (data && !data.sidecarReachable) ? (
        <p className="mt-3 text-[12px] text-ink-500">{t("oversight.unavailable")}</p>
      ) : !m ? (
        <p className="mt-3 text-[12px] text-ink-500">…</p>
      ) : (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {cells.map((c) => (
              <div key={c.label} className="border-t border-ink-100 pt-2">
                <p className="font-code text-[10px] font-bold tracking-[0.1em] text-ink-500">{c.label.toUpperCase()}</p>
                <p className="mt-1 text-[20px] font-semibold text-ink-950 tabular">{c.value}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-ink-600">
            {t("oversight.delayed")}: {m.delayedTenders.length ? m.delayedTenders.join(", ") : t("oversight.none")}
          </p>
          <p className="mt-1 text-[11px] text-ink-500">{t("gate.pending")} · {t("common.committeeDecides")}</p>
        </>
      )}
    </section>
  );
}
