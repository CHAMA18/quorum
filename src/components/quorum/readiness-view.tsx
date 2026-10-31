"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleDashed, Loader2, PenLine, RefreshCw, ShieldAlert, Timer } from "lucide-react";
import { SpecBar } from "@/components/quorum/reveal";
import type { AuthUser } from "@/lib/auth-types";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/**
 * Readiness — the launch gate and the pilot's honest numbers.
 *
 * Every criterion is computed against the LIVE system each time this screen
 * loads: the chain verdict is recomputed link by link, the quality record is
 * the eval lab's own output file, the sign-off line is empty until a named
 * human signs. Nothing here can be prepared in advance to look ready.
 */

type Criterion = {
  id: string;
  label: string;
  status: "PASS" | "PENDING" | "FAIL";
  detail: string;
};

type ReadinessPayload = {
  generatedAt: string;
  verdict: "READY" | "NOT_READY";
  criteria: Criterion[];
  summary: { pass: number; pending: number; fail: number };
  pilotMetrics: {
    runsLaunched: number;
    runsFiled: number;
    humanOverrides: number;
    overrideRate: number | null;
    findingsRaised: number;
    findingsDisposed: number;
    findingsAccepted: number;
    findingsRejected: number;
    dispositionCoverage: number | null;
    auditChainEntries: number | null;
    note: string;
  };
  eval: {
    original?: { recallCovered?: number; recallAll?: number; precision?: number } | null;
    mutation?: { overallDetectionRate?: number } | null;
  } | null;
};

const card = "rounded-[12px] panel overflow-hidden";

const STATUS_TONE: Record<Criterion["status"], string> = {
  PASS: "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300",
  PENDING: "border-amber-500/40 bg-amber-500/[0.06] text-amber-700 dark:text-amber-300",
  FAIL: "border-brand-500/40 bg-brand-500/[0.06] text-brand-700 dark:text-brand-300",
};

export function ReadinessView({ user, onToast }: { user: AuthUser | null; onToast: (msg: string) => void }) {
  const [data, setData] = useState<ReadinessPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const canManageRules = can(user?.role, "manage_rules");

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/readiness", { cache: "no-store" });
      if (!res.ok) throw new Error("refused");
      setData((await res.json()) as ReadinessPayload);
    } catch {
      setLoadError("The readiness gate could not be computed — the desk's services must all answer before the gate can read.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function signOff() {
    setBusy("signoff");
    try {
      const res = await fetch("/api/readiness", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const body = (await res.json()) as { error?: string; by?: string };
      if (!res.ok) throw new Error(body.error ?? "refused");
      onToast(`Launch sign-off recorded — ${body.by}. The gate now holds a named signature.`);
      setNote("");
      await load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "The sign-off was refused.");
    } finally {
      setBusy(null);
    }
  }

  const ready = data?.verdict === "READY";
  const metrics = data?.pilotMetrics;

  return (
    <div>
      <SpecBar index="RDY" label="Workspace" meta="Launch readiness" />
      <div className="mt-6 flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <h1 className="type-display text-[30px] text-ink-950 sm:text-[38px]">
            Launch readiness
            <span className="text-brand-600">.</span>
          </h1>
          <p className="type-lede mt-3 text-ink-600">
            The product launches when the machine can see the evidence — governance signed, roles segregated, the audit
            chain verified link by link, imports holding real proof, and a named human at the bottom of the gate.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pb-1.5">
          <button
            type="button"
            onClick={() => void load()}
            className="focus-brand inline-flex h-9 items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 font-code text-[8px] font-bold tracking-[0.14em] text-ink-700 transition-colors hover:border-ink-950"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            RECOMPUTE
          </button>
        </div>
      </div>

      {data && (
        <div
          className={cn(
            "mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-3.5",
            ready ? "border-emerald-500/30 bg-emerald-500/[0.06]" : "border-amber-500/40 bg-amber-500/[0.06]",
          )}
          role="status"
        >
          {ready ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
          ) : (
            <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          )}
          <p className={cn("font-code text-[9px] font-bold tracking-[0.18em]", ready ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")}>
            {ready ? "LAUNCH GATE · READY" : "LAUNCH GATE · NOT READY"}
          </p>
          <p className="text-[12px] text-ink-600">
            {data.summary.pass} of {data.criteria.length} criteria hold{data.summary.pending > 0 ? ` · ${data.summary.pending} pending` : ""}{data.summary.fail > 0 ? ` · ${data.summary.fail} FAILING` : ""} · computed {data.generatedAt.slice(0, 16).replace("T", " ")}
          </p>
        </div>
      )}

      {loadError && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3.5 text-[12.5px] leading-relaxed text-brand-900">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{loadError}</p>
        </div>
      )}

      {data && (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className={card} aria-label="Launch criteria">
            <div className="border-b border-ink-100 px-5 py-4">
              <p className="font-code text-[8px] font-semibold uppercase tracking-[0.22em] text-ink-400">
                The nine criteria — each checked live
              </p>
            </div>
            <ul className="divide-y divide-ink-100">
              {data.criteria.map((c) => (
                <li key={c.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {c.status === "PASS" ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    ) : c.status === "FAIL" ? (
                      <ShieldAlert className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
                    ) : (
                      <CircleDashed className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                    )}
                    <span className="text-[13.5px] font-semibold text-ink-950">{c.label}</span>
                    <span className={cn("inline-flex h-5 items-center rounded-full border px-2 font-code text-[7px] font-bold tracking-[0.12em]", STATUS_TONE[c.status])}>
                      {c.status}
                    </span>
                  </div>
                  <p className="mt-1.5 pl-6 text-[12px] leading-relaxed text-ink-600">{c.detail}</p>
                </li>
              ))}
            </ul>
            {canManageRules && (
              <div className="space-y-2 border-t border-ink-100 px-5 py-4">
                <label className="block text-[11px] font-semibold text-ink-700" htmlFor="launch-note">
                  The human sign-off — record it once the eight machine criteria hold
                  <textarea
                    id="launch-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    maxLength={400}
                    placeholder="Optional note for the record — what you reviewed, and on whose authority."
                    className="focus-brand mt-1 block w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[12.5px] text-ink-900 placeholder:text-ink-400"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void signOff()}
                  disabled={busy === "signoff"}
                  className="focus-brand inline-flex h-9 items-center gap-2 rounded-lg bg-brand-600 px-4 text-[12.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
                >
                  {busy === "signoff" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <PenLine className="h-3.5 w-3.5" aria-hidden="true" />}
                  Sign the launch gate
                </button>
              </div>
            )}
          </section>

          <div className="space-y-5">
            {metrics && (
              <section className={card} aria-label="Pilot metrics">
                <div className="border-b border-ink-100 px-5 py-4">
                  <p className="flex items-center gap-2 font-code text-[8px] font-semibold uppercase tracking-[0.22em] text-ink-400">
                    <Timer className="h-3 w-3" aria-hidden="true" />
                    Pilot metrics — read from live state
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-px bg-ink-100">
                  {[
                    { label: "RUNS LAUNCHED", value: metrics.runsLaunched },
                    { label: "FILED VIA GATE", value: metrics.runsFiled },
                    { label: "HUMAN OVERRIDES", value: metrics.humanOverrides },
                    { label: "FINDINGS RAISED", value: metrics.findingsRaised },
                    { label: "DISPOSITIONS", value: `${metrics.findingsDisposed}${metrics.dispositionCoverage !== null ? ` (${metrics.dispositionCoverage}%)` : ""}` },
                    { label: "ACCEPTED / REJECTED", value: `${metrics.findingsAccepted} / ${metrics.findingsRejected}` },
                    { label: "CHAIN ENTRIES", value: metrics.auditChainEntries ?? "—" },
                    { label: "OVERRIDE RATE", value: metrics.overrideRate !== null ? `${Math.round(metrics.overrideRate * 100)}%` : "—" },
                  ].map((m) => (
                    <div key={m.label} className="bg-white px-4 py-3">
                      <p className="font-code text-[7px] font-bold tracking-[0.18em] text-ink-400">{m.label}</p>
                      <p className="mt-1 text-[18px] font-semibold tracking-[-0.02em] text-ink-950 tabular">{m.value}</p>
                    </div>
                  ))}
                </div>
                <p className="border-t border-ink-100 px-5 py-3 text-[11px] leading-relaxed text-ink-500">{metrics.note}</p>
              </section>
            )}

            {data.eval?.original && (
              <section className={card} aria-label="Independent quality record">
                <div className="border-b border-ink-100 px-5 py-4">
                  <p className="font-code text-[8px] font-semibold uppercase tracking-[0.22em] text-ink-400">
                    The eval lab's own record
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-px bg-ink-100">
                  <div className="bg-white px-4 py-3">
                    <p className="font-code text-[7px] font-bold tracking-[0.18em] text-ink-400">RECALL (COVERED)</p>
                    <p className="mt-1 text-[18px] font-semibold text-ink-950 tabular">{Math.round(data.eval.original.recallCovered ?? 0)}%</p>
                  </div>
                  <div className="bg-white px-4 py-3">
                    <p className="font-code text-[7px] font-bold tracking-[0.18em] text-ink-400">PRECISION</p>
                    <p className="mt-1 text-[18px] font-semibold text-ink-950 tabular">{Math.round(data.eval.original.precision ?? 0)}%</p>
                  </div>
                  <div className="bg-white px-4 py-3">
                    <p className="font-code text-[7px] font-bold tracking-[0.18em] text-ink-400">MUTATION CATCH</p>
                    <p className="mt-1 text-[18px] font-semibold text-ink-950 tabular">{Math.round(data.eval.mutation?.overallDetectionRate ?? 0)}%</p>
                  </div>
                </div>
                <p className="border-t border-ink-100 px-5 py-3 text-[11px] leading-relaxed text-ink-500">
                  Produced by the eval lab against pre-written labels and mutation tests — the platform prints the files
                  verbatim rather than re-stating them.
                </p>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
