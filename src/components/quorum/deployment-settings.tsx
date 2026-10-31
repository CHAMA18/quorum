"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, LockKeyhole, RefreshCw, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

type Deployment = {
  mode: "RECORD_ONLY" | "CONNECTED";
  publication: { mode: "SIMULATED" | "CONNECTED"; portal: string; receiptId?: string; verifiedAt?: string };
  updatedAt: string | null;
  updatedBy: string | null;
};

type Flag = {
  key: string;
  label: string;
  description: string;
  phase: string;
  default: boolean;
  locked?: boolean;
};

type Jurisdiction = {
  id: "KE" | "ZM";
  country: string;
  timezone: string;
  utcOffsetHours: number;
  addendumMinNoticeDays: number;
  standstillDays: number;
  complaintResponseDays: number;
  calendarYears: number[];
};

/**
 * Deployment truth and the feature registry.
 *
 * The sidecar owns both records. This panel only renders them and sends named
 * changes; a refusal is shown and the pill goes back. Flag changes cannot
 * bypass a gate — they decide whether a workstream's code path is reachable.
 */
export function DeploymentSettings({ onToast }: { onToast?: (message: string) => void }) {
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [values, setValues] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction | null>(null);
  const [settingJurisdiction, setSettingJurisdiction] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [deploymentRes, flagsRes, jurisdictionRes] = await Promise.all([
        fetch("/api/deployment?XTransformPort=3031"),
        fetch("/api/features?XTransformPort=3031"),
        fetch("/api/jurisdiction?XTransformPort=3031"),
      ]);
      if (!deploymentRes.ok || !flagsRes.ok) throw new Error("deployment service refused");
      const deploymentData = (await deploymentRes.json()) as { deployment?: Deployment };
      const flagsData = (await flagsRes.json()) as { features?: Record<string, boolean>; registry?: Flag[] };
      setDeployment(deploymentData.deployment ?? null);
      setFlags(Array.isArray(flagsData.registry) ? flagsData.registry : []);
      setValues(flagsData.features ?? {});
      if (jurisdictionRes.ok) {
        const j = (await jurisdictionRes.json()) as { jurisdiction?: Jurisdiction };
        setJurisdiction(j.jurisdiction ?? null);
      }
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const chooseJurisdiction = async (id: "KE" | "ZM") => {
    if (!jurisdiction || settingJurisdiction || jurisdiction.id === id) return;
    setSettingJurisdiction(true);
    try {
      const res = await fetch("/api/jurisdiction?XTransformPort=3031", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = (await res.json()) as { id?: "KE" | "ZM"; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? `refused (${res.status})`);
      /* Re-read the pack so the statutory numbers on screen are the server's. */
      const refreshed = await fetch("/api/jurisdiction?XTransformPort=3031");
      const j = (await refreshed.json()) as { jurisdiction?: Jurisdiction };
      if (j.jurisdiction) setJurisdiction(j.jurisdiction);
      onToast?.(`JURISDICTION CLOCK — ${id === "ZM" ? "ZAMBIA" : "KENYA"}`);
    } catch (error) {
      onToast?.(`JURISDICTION REFUSED — ${error instanceof Error ? error.message.toUpperCase() : "NO ANSWER FROM THE SIDE-CAR"}`);
    } finally {
      setSettingJurisdiction(false);
    }
  };

  const toggle = async (flag: Flag) => {
    if (flag.locked || busy) return;
    const next = !values[flag.key];
    setBusy(flag.key);
    setValues((current) => ({ ...current, [flag.key]: next }));
    try {
      const res = await fetch("/api/features?XTransformPort=3031", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ features: { [flag.key]: next } }),
      });
      const data = (await res.json()) as { features?: Record<string, boolean>; error?: string };
      if (!res.ok || !data.features) throw new Error(data.error ?? `refused (${res.status})`);
      setValues(data.features);
      onToast?.(`FLAG ${next ? "ENABLED" : "DISABLED"} — ${flag.label.toUpperCase()}`);
    } catch (error) {
      setValues((current) => ({ ...current, [flag.key]: !next }));
      onToast?.(
        `FLAG REFUSED — ${error instanceof Error ? error.message.toUpperCase() : "NO ANSWER FROM THE SIDE-CAR"}`,
      );
    } finally {
      setBusy(null);
    }
  };

  if (!deployment && !failed) {
    return (
      <div className="mt-6 rounded-[12px] panel p-5 font-code text-[8px] tracking-[0.2em] text-ink-400">
        SYNCING DEPLOYMENT TRUTH…
      </div>
    );
  }

  if (failed || !deployment) {
    return (
      <div className="mt-6 flex items-start gap-3 rounded-[12px] border border-amber-300/70 bg-amber-50 p-5 text-amber-950 dark:border-amber-400/25 dark:bg-amber-400/[0.07] dark:text-amber-100">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-code text-[8px] font-bold tracking-[0.2em]">DEPLOYMENT STATUS UNREACHABLE</p>
          <p className="mt-1 text-[12px] leading-relaxed">
            The sidecar did not answer. Treat the workspace as record-only until the status is verified.
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 inline-flex items-center gap-1.5 font-code text-[8px] font-bold tracking-[0.18em] underline underline-offset-4"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" /> RETRY
          </button>
        </div>
      </div>
    );
  }

  const recordOnly = deployment.mode !== "CONNECTED";

  return (
    <div className="mt-6 grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
      <section className="rounded-[12px] panel p-5 shadow-[0_1px_2px_rgba(11,12,15,0.04)]">
        <p className="font-code text-[8px] font-semibold tracking-[0.22em] text-ink-400">DEPLOYMENT</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <h3 className="font-display text-[15px] font-black tracking-[-0.01em] text-ink-950">
            {recordOnly ? "Record-only" : "Connected"}
          </h3>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-code text-[7.5px] font-bold tracking-[0.14em]",
              recordOnly
                ? "border-amber-300/70 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/[0.08] dark:text-amber-200"
                : "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-300",
            )}
          >
            {recordOnly ? "RECORD_ONLY" : "CONNECTED"}
          </span>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-500">
          {recordOnly
            ? "Contracts and payment certification are refused by the sidecar. Evaluations, findings and award rehearsals remain available, and every export states that it is not a publication receipt."
            : "A verified external publication receipt is on record. Contract and payment paths are open, subject to every statutory gate."}
        </p>
        <div className="mt-4 rounded-lg border border-ink-100 bg-paper px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.03]">
          <p className="font-code text-[7.5px] tracking-[0.16em] text-ink-400">PUBLICATION</p>
          <p className="mt-1 font-code text-[9px] leading-relaxed text-ink-700 dark:text-ink-300">
            {deployment.publication.portal.toUpperCase()}
          </p>
          {deployment.publication.receiptId ? (
            <p className="mt-1 font-code text-[8px] text-emerald-700 dark:text-emerald-300">
              RECEIPT {deployment.publication.receiptId}
            </p>
          ) : (
            <p className="mt-1 font-code text-[8px] text-amber-700 dark:text-amber-300">
              NO EXTERNAL RECEIPT — SIMULATED
            </p>
          )}
        </div>
      </section>

      <section className="rounded-[12px] panel p-5 shadow-[0_1px_2px_rgba(11,12,15,0.04)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-code text-[8px] font-semibold tracking-[0.22em] text-ink-400">FEATURE FLAGS</p>
            <h3 className="mt-1.5 font-display text-[15px] font-black tracking-[-0.01em] text-ink-950">
              What has actually shipped
            </h3>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Reload feature flags"
            className="grid h-7 w-7 place-items-center rounded-full border border-ink-100 text-ink-400 transition-colors hover:border-ink-950 hover:text-ink-950"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-1 text-[12px] text-ink-500">
          New workflows ship dark. Enabling a flag does not bypass a gate.
        </p>
        <ul className="mt-3 max-h-[360px] space-y-1.5 overflow-y-auto pr-1 [scrollbar-width:thin]">
          {flags.map((flag) => {
            const on = !!values[flag.key];
            return (
              <li
                key={flag.key}
                className="flex items-start gap-3 rounded-lg border border-ink-100 px-3 py-2.5 dark:border-white/10"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-ink-900 dark:text-ink-100">
                    {flag.label}{" "}
                    <span className="ml-1 font-code text-[7px] tracking-[0.14em] text-ink-400">{flag.phase}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">{flag.description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={flag.label}
                  disabled={!!flag.locked || busy === flag.key}
                  onClick={() => void toggle(flag)}
                  className={cn(
                    "mt-0.5 inline-flex h-7 min-w-[54px] items-center justify-center gap-1 rounded-full border px-2 font-code text-[7.5px] font-bold tracking-[0.12em] transition-colors",
                    flag.locked
                      ? "cursor-not-allowed border-ink-200 bg-paper text-ink-400"
                      : on
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "border-ink-200 bg-white text-ink-500 hover:border-ink-950 hover:text-ink-950 dark:border-white/15 dark:bg-white/[0.03]",
                  )}
                >
                  {flag.locked ? (
                    <>
                      <LockKeyhole className="h-2.5 w-2.5" aria-hidden="true" /> LOCKED
                    </>
                  ) : on ? (
                    <>
                      <Check className="h-2.5 w-2.5" aria-hidden="true" /> ON
                    </>
                  ) : (
                    "OFF"
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-[12px] panel p-5 shadow-[0_1px_2px_rgba(11,12,15,0.04)] lg:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-code text-[8px] font-semibold tracking-[0.22em] text-ink-400">JURISDICTION CLOCK</p>
            <h3 className="mt-1.5 font-display text-[15px] font-black tracking-[-0.01em] text-ink-950">
              The calendar statutory periods run on
            </h3>
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-ink-500">
              Working days skip weekends and the selected country's published public holidays. Closing dates are read in its timezone. An addendum inside the notice window must extend the closing date.
            </p>
          </div>
          <div className="flex gap-2">
            {(["ZM", "KE"] as const).map((id) => (
              <button
                key={id}
                type="button"
                disabled={settingJurisdiction}
                onClick={() => void chooseJurisdiction(id)}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 font-code text-[8px] font-bold tracking-[0.16em] transition-colors",
                  jurisdiction?.id === id
                    ? "border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-200"
                    : "border-ink-200 bg-white text-ink-500 hover:border-ink-950 hover:text-ink-950 dark:border-white/15 dark:bg-white/[0.03]",
                )}
              >
                {jurisdiction?.id === id ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
                {id === "ZM" ? "ZAMBIA" : "KENYA"}
              </button>
            ))}
          </div>
        </div>
        {jurisdiction ? (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["TIMEZONE", jurisdiction.timezone],
                ["STANDSTILL", `${jurisdiction.standstillDays} WORKING DAYS`],
                ["ADDENDUM NOTICE", `${jurisdiction.addendumMinNoticeDays} WORKING DAYS`],
                ["COMPLAINT REPLY", `${jurisdiction.complaintResponseDays} WORKING DAYS`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-ink-100 bg-paper px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
                  <dt className="font-code text-[7px] tracking-[0.16em] text-ink-400">{label}</dt>
                  <dd className="mt-1 font-code text-[9px] text-ink-700 dark:text-ink-300">{value}</dd>
                </div>
              ))}
            </dl>
            {(() => {
              const first = jurisdiction.calendarYears[0];
              const last = jurisdiction.calendarYears[jurisdiction.calendarYears.length - 1];
              const current = new Date().getFullYear();
              const covered = jurisdiction.calendarYears.includes(current);
              return (
                <p
                  className={cn(
                    "mt-3 rounded-lg border px-3 py-2 font-code text-[8px] leading-relaxed tracking-[0.14em]",
                    covered
                      ? "border-ink-100 bg-paper text-ink-500 dark:border-white/10 dark:bg-white/[0.03]"
                      : "border-amber-400/40 bg-amber-400/[0.08] text-amber-800 dark:text-amber-200",
                  )}
                >
                  CALENDAR {first}–{last} · {covered ? `${current} COVERED` : `${current} NOT COVERED — ADD A HOLIDAY PACK BEFORE RELYING ON STATUTORY DATES`}
                </p>
              );
            })()}
          </>
        ) : null}
      </section>
    </div>
  );
}
