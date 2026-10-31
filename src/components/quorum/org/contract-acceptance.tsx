"use client";

import { useState } from "react";
import { Check, CircleAlert, CircleCheck, FileSignature, Loader2, RotateCw, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDate, money, type OrgContract } from "./supplier-data";

/**
 * Contracts the desk has signed with this organization.
 *
 * The supplier sees the instrument that names it, its terms, and — for a
 * signed pack that has not yet been accepted — the acceptance form. The
 * acceptance is a named human act: the signatory is recorded, sealed into
 * the contract hash, and cannot be repeated from this screen.
 */

const inputCls =
  "h-11 w-full rounded-xl border border-ink-200 bg-white px-3.5 text-[14px] text-ink-950 outline-none transition-all placeholder:text-ink-300 focus:border-ink-950 focus:ring-4 focus:ring-ink-950/10 dark:border-white/10 dark:bg-night-2 dark:text-white dark:placeholder:text-ink-500";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="font-code text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-500">{label}</span>
      {children}
    </label>
  );
}

function Chip({ tone, children }: { tone: "ok" | "warn" | "muted" | "brand"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : tone === "warn"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : tone === "brand"
          ? "border-brand-500/25 bg-brand-500/10 text-brand-700 dark:text-brand-300"
          : "border-ink-200 bg-ink-50 text-ink-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-500";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-code text-[9px] font-bold tracking-[0.13em]", cls)}>
      {children}
    </span>
  );
}

export function ContractAcceptance({
  contracts,
  error,
  onRefresh,
}: {
  contracts: OrgContract[] | null;
  error: string | null;
  onRefresh: () => void | Promise<void>;
}) {
  const [signatory, setSignatory] = useState<Record<string, string>>({});
  const [reference, setReference] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState<Record<string, string>>({});

  const accept = async (row: OrgContract) => {
    const name = (signatory[row.tenderRef] ?? "").trim();
    if (!name) {
      setActionError((p) => ({ ...p, [row.tenderRef]: "Name the officer signing for the organization." }));
      return;
    }
    setBusy(row.tenderRef);
    setActionError((p) => {
      const next = { ...p };
      delete next[row.tenderRef];
      return next;
    });
    try {
      const res = await fetch(`/api/org/tenders/${encodeURIComponent(row.tenderRef)}/contract/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signatory: name,
          copyHash: (reference[row.tenderRef] ?? "").trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; acceptanceHash?: string };
      if (!res.ok) {
        setActionError((p) => ({ ...p, [row.tenderRef]: data.error ?? "The acceptance could not be recorded." }));
        return;
      }
      if (data.acceptanceHash) setAccepted((p) => ({ ...p, [row.tenderRef]: data.acceptanceHash as string }));
      await onRefresh();
    } catch {
      setActionError((p) => ({ ...p, [row.tenderRef]: "The portal is unreachable — try again shortly." }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-code text-[9px] font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-400">
            The instrument
          </p>
          <h1 className="type-display mt-2 flex items-center gap-2.5 text-[22px] text-ink-950 dark:text-white">
            Contracts
            {contracts !== null ? (
              <span className="rounded-full border border-ink-100 bg-sand/80 px-2 py-0.5 font-code text-[9.5px] font-semibold text-ink-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-600">
                {contracts.length} on record
              </span>
            ) : null}
          </h1>
          <p className="mt-1.5 max-w-[66ch] text-[13px] leading-relaxed text-ink-500">
            A contract appears here after the desk awards and signs a pack for one of your applications. Its
            acceptance is recorded against the organization session, sealed into the contract hash, and read by the
            procurement officer at execution.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onRefresh()}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-lg border border-ink-100 bg-white px-3 text-[12px] font-semibold text-ink-600 transition-colors hover:border-ink-200 hover:text-ink-900 sm:self-auto dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-600 dark:hover:border-white/20 dark:hover:text-white"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh
        </button>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-[13px] text-brand-800 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-200">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error}
        </div>
      ) : null}

      {contracts === null ? (
        <div className="grid gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="h-[240px] animate-pulse rounded-[12px] border border-ink-100 bg-ink-50/60 dark:border-white/[0.07] dark:bg-white/[0.03]" />
          ))}
        </div>
      ) : contracts.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-ink-200 px-6 py-16 text-center dark:border-white/15">
          <FileSignature className="mx-auto h-6 w-6 text-ink-400" aria-hidden="true" />
          <p className="mt-3 text-[14px] font-semibold text-ink-700 dark:text-ink-700">No contract is on record yet</p>
          <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-400">
            Contracts appear here after the desk awards a tender and signs the contract pack for one of this
            organization&apos;s applications. Nothing is invented to fill this screen.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {contracts.map((row) => {
            const c = row.contract;
            const acceptedAt = c.supplierAcceptedAt ?? row.acceptance?.acceptedAt ?? null;
            const acceptanceHash = c.acceptanceHash ?? row.acceptance?.acceptanceHash ?? null;
            const signer = c.supplierSignatory ?? row.acceptance?.signatory ?? null;
            const status = c.status ?? "LEGACY_UNEXECUTED";
            const canAccept = c.status === "DRAFT" && !acceptedAt;
            const err = actionError[row.tenderRef];
            const freshHash = accepted[row.tenderRef];
            return (
              <section
                key={row.tenderRef}
                className="overflow-hidden rounded-[12px] border border-ink-200/70 bg-white shadow-[0_1px_2px_rgba(11,12,15,0.04)] dark:border-white/[0.07] dark:bg-night-2/80"
              >
                <div className="flex flex-col gap-3 border-b border-ink-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between dark:border-white/[0.06]">
                  <div className="min-w-0">
                    <p className="font-code text-[9.5px] font-semibold tracking-[0.16em] text-brand-700 dark:text-brand-400">
                      {row.tenderRef}
                    </p>
                    <h2 className="mt-1 truncate text-[16px] font-bold tracking-[-0.01em] text-ink-950 dark:text-white">
                      {c.supplier}
                    </h2>
                    <p className="mt-0.5 text-[12px] text-ink-500">
                      {money(c.value, c.currency)} · opened {fmtDate(c.openedAt)}
                      {c.executedAt ? ` · executed ${fmtDate(c.executedAt)}` : ""}
                      {c.completedAt ? ` · completed ${fmtDate(c.completedAt)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <Chip tone={status === "COMPLETED" || status === "LEGACY_UNEXECUTED" ? "muted" : status === "EXECUTED" ? "ok" : canAccept ? "brand" : "ok"}>
                      {status === "DRAFT" && canAccept ? "AWAITING YOUR ACCEPTANCE" : status}
                    </Chip>
                    {acceptedAt ? <Chip tone="ok">ACCEPTED</Chip> : null}
                  </div>
                </div>

                <div className="grid gap-5 px-5 py-4 lg:grid-cols-[1.15fr_1fr]">
                  <div className="space-y-3">
                    <p className="font-code text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-400">
                      The terms the desk signed
                    </p>
                    <dl className="grid gap-2 text-[12.5px] sm:grid-cols-2">
                      <div>
                        <dt className="text-ink-400">Contract value</dt>
                        <dd className="font-semibold text-ink-900 dark:text-ink-100">{money(c.value, c.currency)}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-400">Retention</dt>
                        <dd className="font-semibold text-ink-900 dark:text-ink-100">{c.retentionPct ?? 0}%</dd>
                      </div>
                      <div>
                        <dt className="text-ink-400">Warranty</dt>
                        <dd className="font-semibold text-ink-900 dark:text-ink-100">{c.warrantyDays ?? 0} days</dd>
                      </div>
                      <div>
                        <dt className="text-ink-400">Performance security</dt>
                        <dd className="font-semibold text-ink-900 dark:text-ink-100">
                          {c.performanceSecurity
                            ? `${money(c.performanceSecurity.amount, c.currency)} · valid to ${fmtDate(c.performanceSecurity.validUntil)}`
                            : "Not recorded"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-ink-400">Insurance</dt>
                        <dd className="font-semibold text-ink-900 dark:text-ink-100">
                          {c.insurance ? `${c.insurance.policyNo} · valid to ${fmtDate(c.insurance.validUntil)}` : "Not recorded"}
                        </dd>
                      </div>
                    </dl>

                    {c.conditions?.length ? (
                      <div>
                        <p className="font-code text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-400">
                          Conditions
                        </p>
                        <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[12.5px] text-ink-600 dark:text-ink-500">
                          {c.conditions.map((condition) => (
                            <li key={condition.id}>{condition.text}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {c.milestones?.length ? (
                      <div>
                        <p className="font-code text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-400">
                          Milestones
                        </p>
                        <ul className="mt-1.5 space-y-1 text-[12.5px] text-ink-600 dark:text-ink-500">
                          {c.milestones.map((m) => (
                            <li key={m.id} className="flex items-center justify-between gap-3 rounded-lg bg-paper px-2.5 py-1.5 dark:bg-white/[0.03]">
                              <span>{m.title}{m.dueDate ? <span className="text-ink-400"> · due {fmtDate(m.dueDate)}</span> : null}</span>
                              <span className="font-code text-[8.5px] tracking-[0.12em] text-ink-400">{m.status}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-xl border border-ink-100 bg-paper/60 p-4 dark:border-white/[0.07] dark:bg-white/[0.02]">
                    <p className="flex items-center gap-2 font-code text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Acceptance
                    </p>
                    {acceptedAt ? (
                      <div className="mt-2 space-y-1.5 text-[12.5px] text-ink-600 dark:text-ink-500">
                        <p className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300">
                          <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" /> Accepted {fmtDate(acceptedAt)}
                        </p>
                        <p>Signatory: <span className="font-semibold text-ink-900 dark:text-ink-100">{signer ?? "—"}</span></p>
                        {acceptanceHash ? (
                          <p className="break-all font-code text-[9.5px] leading-relaxed text-ink-500">
                            SEAL {acceptanceHash}
                          </p>
                        ) : null}
                        {freshHash ? (
                          <p className="break-all font-code text-[9.5px] text-emerald-700 dark:text-emerald-300">
                            NEW SEAL {freshHash}
                          </p>
                        ) : null}
                        <p className="text-[11.5px] text-ink-400">
                          The desk reads this acceptance at contract execution. A second acceptance is not offered.
                        </p>
                      </div>
                    ) : canAccept ? (
                      <div className="mt-2 space-y-2">
                        <p className="text-[12px] leading-relaxed text-ink-500">
                          Signing here records the organization&apos;s acceptance of the signed pack and its terms.
                        </p>
                        <Field label="Full name of the signatory">
                          <input
                            className={inputCls}
                            autoComplete="name"
                            placeholder="e.g. A. Director"
                            value={signatory[row.tenderRef] ?? ""}
                            onChange={(e) => setSignatory((p) => ({ ...p, [row.tenderRef]: e.target.value }))}
                          />
                        </Field>
                        <Field label="Copy hash or document reference (optional)">
                          <input
                            className={inputCls}
                            placeholder="Reference on the signed copy you hold"
                            value={reference[row.tenderRef] ?? ""}
                            onChange={(e) => setReference((p) => ({ ...p, [row.tenderRef]: e.target.value }))}
                          />
                        </Field>
                        {err ? (
                          <p className="flex items-start gap-1.5 text-[11.5px] text-brand-700 dark:text-brand-300">
                            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {err}
                          </p>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void accept(row)}
                          disabled={busy === row.tenderRef || (signatory[row.tenderRef] ?? "").trim().length < 3}
                          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(217,38,22,0.22)] transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {busy === row.tenderRef ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Check className="h-4 w-4" aria-hidden="true" />
                          )}
                          {busy === row.tenderRef ? "Recording acceptance…" : "Accept this contract"}
                        </button>
                      </div>
                    ) : (
                      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-500">
                        {status === "LEGACY_UNEXECUTED"
                          ? "This contract predates the execution register and cannot be accepted here. Contact the procurement desk."
                          : `This contract is ${status.toLowerCase()} and is not awaiting acceptance. Its instrument stands on the desk's record.`}
                      </p>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
