"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  ClipboardCheck,
  Gavel,
  Landmark,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";
import { SpecBar } from "@/components/quorum/reveal";
import type { AuthUser } from "@/lib/auth-types";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/**
 * Governance — the authority picture, on the record.
 *
 * Three readings of the same truth, all live:
 *   1. the AUTHORITY MATRIX — every governed action mapped to the role that
 *      attempts it, the office that registers it, the escalation rule and the
 *      evidence it must leave;
 *   2. the SEPARATION-OF-DUTIES rules and how each one is enforced;
 *   3. the ACCESS POSTURE — who holds power, who holds it without a second
 *      factor, and when the last access review was recorded.
 *
 * The approval bands and the governance sign-off are configuration the
 * operational owner confirms — changing them is a logged governance act.
 */

const SVC = "/api";

type GovernedAction = {
  id: string;
  action: string;
  role: string;
  capability: string;
  office: string | null;
  gated: boolean;
  escalation: string;
  basis: string;
  evidence: string;
};

type DutiesRule = { id: string; rule: string; enforcement: string; enforcedBy: string };

type Band = { id: string; label: string; currency: string; min: number; max?: number; approvalOffice: string; note?: string };

type GovernanceSnapshot = {
  actions: GovernedAction[];
  duties: DutiesRule[];
  bands: Band[];
  signedOff: { by: string; at: string; scope: string } | null;
  confirmed: boolean;
  note: string;
  updatedBy?: string | null;
  updatedAt?: string | null;
};

type AccessReview = {
  generatedAt: string;
  totals: { users: number; organizations: number; activeSessions: number; pendingInvites: number };
  byRole: Record<string, number>;
  privileged: { count: number; withoutMfa: { id: string; name: string; role: string }[]; mfaPolicyOn: boolean };
  suspended: { id: string; name: string }[];
  lastReview: { at: string; by: string; detail: string } | null;
  stepUpWindow: { tracked: number; latestAt: string | null };
};

type AccessSnapshot = { enabled: boolean; privilegedCount: number; blockedCount: number };

const OFFICE_LABEL: Record<string, string> = {
  PROCUREMENT_UNIT: "Procurement unit",
  EVALUATION_COMMITTEE: "Evaluation committee",
  ACCOUNTING_OFFICER: "Accounting officer",
  OVERSIGHT: "Oversight / audit",
};

const card = "rounded-[12px] panel overflow-hidden";

export function GovernanceView({ user, onToast }: { user: AuthUser | null; onToast: (msg: string) => void }) {
  const [gov, setGov] = useState<GovernanceSnapshot | null>(null);
  const [access, setAccess] = useState<AccessReview | null>(null);
  const [mfa, setMfa] = useState<AccessSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const canManageRules = can(user?.role, "manage_rules");
  const canManagePeople = can(user?.role, "manage_people");

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [g, a, m] = await Promise.all([
        fetch(`${SVC}/governance?XTransformPort=3031`, { cache: "no-store" }),
        fetch(`${SVC}/access-review`, { cache: "no-store" }),
        fetch(`${SVC}/policy/mfa`, { cache: "no-store" }),
      ]);
      if (!g.ok) throw new Error("governance service unreachable");
      setGov((await g.json()) as GovernanceSnapshot);
      if (a.ok) setAccess((await a.json()) as AccessReview);
      if (m.ok) setMfa((await m.json()) as AccessSnapshot);
    } catch {
      setLoadError("The governance service did not answer. The desk still runs — try the refresh control in a moment.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function signOff() {
    setBusy("signoff");
    try {
      const res = await fetch(`${SVC}/governance/signoff?XTransformPort=3031`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "authority matrix, approval bands and separation of duties — reviewed for pilot use" }),
      });
      const data = (await res.json()) as { signedOff?: { by: string }; error?: string };
      if (!res.ok) throw new Error(data.error ?? "refused");
      onToast(`Governance sign-off recorded — ${data.signedOff?.by ?? "named actor"}.`);
      await load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "The sign-off could not be recorded.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleMfa(enabled: boolean) {
    setBusy("mfa");
    try {
      const res = await fetch(`${SVC}/policy/mfa`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "refused");
      onToast(enabled ? "MFA for privileged accounts is ON — gate signatures now demand a second factor." : "MFA policy OFF — a passphrase alone signs gates again.");
      await load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "The policy change was refused.");
    } finally {
      setBusy(null);
    }
  }

  async function recordAccessReview() {
    setBusy("review");
    try {
      const res = await fetch(`${SVC}/access-review`, { method: "POST" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "refused");
      onToast("Access review recorded in the governance log.");
      await load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "The access review could not be recorded.");
    } finally {
      setBusy(null);
    }
  }

  const stats = [
    { label: "GOVERNED ACTIONS", value: String(gov?.actions.length ?? "—"), note: "each mapped to role, office and evidence" },
    { label: "SEPARATION RULES", value: String(gov?.duties.length ?? "—"), note: "enforced in code, not in slides" },
    { label: "APPROVAL BANDS", value: String(gov?.bands.length ?? "—"), note: gov?.confirmed ? "confirmed by the operational owner" : "illustrative — awaiting sign-off" },
    { label: "PRIVILEGED ACCOUNTS", value: access ? String(access.privileged.count) : "—", note: mfa?.enabled ? "MFA policy ON" : "MFA policy OFF" },
  ];

  return (
    <div>
      <SpecBar index="GOV" label="Workspace" meta="Governance" />
      <div className="mt-6 flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <h1 className="type-display text-[30px] text-ink-950 sm:text-[38px]">
            Governance
            <span className="text-brand-600">.</span>
          </h1>
          <p className="type-lede mt-3 text-ink-600">
            The system supports procurement decisions; it does not replace procurement authority. This is the authority
            picture on the record — who may do what, which office must sign, and how segregation is enforced in code.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pb-1.5">
          <button
            type="button"
            onClick={() => void load()}
            className="focus-brand inline-flex h-9 items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 font-code text-[8px] font-bold tracking-[0.14em] text-ink-700 transition-colors hover:border-ink-950"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            REFRESH
          </button>
          {canManageRules && (
            <button
              type="button"
              onClick={() => void signOff()}
              disabled={busy === "signoff" || !!gov?.confirmed}
              className="focus-brand inline-flex h-9 items-center gap-2 rounded-lg bg-ink-950 px-3 font-code text-[8px] font-bold tracking-[0.14em] text-white transition-colors hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === "signoff" ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <BadgeCheck className="h-3 w-3" aria-hidden="true" />}
              {gov?.confirmed ? "SIGN-OFF RECORDED" : "RECORD SIGN-OFF"}
            </button>
          )}
        </div>
      </div>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Governance summary">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-ink-200/80 bg-white px-4 py-3.5">
            <p className="font-code text-[7.5px] font-bold tracking-[0.2em] text-ink-400">{stat.label}</p>
            <p className="mt-2 text-[24px] font-semibold tracking-[-0.02em] text-ink-950 tabular">{stat.value}</p>
            <p className="mt-0.5 text-[10.5px] text-ink-500">{stat.note}</p>
          </div>
        ))}
      </section>

      {loadError && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3.5 text-[12.5px] leading-relaxed text-brand-900">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{loadError}</p>
        </div>
      )}

      {gov && !gov.confirmed && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3.5 text-[12.5px] leading-relaxed text-amber-900">
          <Gavel className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <strong>The approval bands are illustrative defaults.</strong> They name the office that approves in each band
            but the operational owner has not signed this configuration yet. {canManageRules ? "Record the sign-off once you have reviewed the matrix below." : "Ask an administrator to record the sign-off after review."}
          </p>
        </div>
      )}

      {gov && (
        <>
          {/* Authority matrix */}
          <section className={`${card} mt-5`} aria-labelledby="gov-matrix">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
              <p id="gov-matrix" className="font-code text-[8px] font-semibold uppercase tracking-[0.22em] text-ink-400">
                Authority matrix — every governed action
              </p>
              <p className="font-code text-[8px] tracking-[0.14em] text-ink-400">
                {gov.updatedBy ? `bands updated by ${gov.updatedBy}${gov.updatedAt ? ` · ${gov.updatedAt.slice(0, 10)}` : ""}` : "defaults in force"}
              </p>
            </div>
            <ul className="divide-y divide-ink-100">
              {gov.actions.map((action) => (
                <li key={action.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <span className="text-[13.5px] font-semibold text-ink-950">{action.action}</span>
                    {action.gated && (
                      <span className="inline-flex h-5 items-center rounded-full border border-brand-300 bg-brand-50 px-2 font-code text-[7.5px] font-bold tracking-[0.14em] text-brand-800 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300">
                        GATE
                      </span>
                    )}
                    {action.office && (
                      <span className="inline-flex h-5 items-center rounded-full border border-ink-200 bg-[#fffdfb] px-2 font-code text-[7.5px] font-bold tracking-[0.14em] text-ink-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-ink-300">
                        {OFFICE_LABEL[action.office] ?? action.office}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 grid gap-x-8 gap-y-1 text-[12px] leading-relaxed text-ink-600 md:grid-cols-2">
                    <p><span className="font-code text-[7.5px] font-bold tracking-[0.16em] text-ink-400">ROLE · </span>{action.role}</p>
                    <p><span className="font-code text-[7.5px] font-bold tracking-[0.16em] text-ink-400">ESCALATION · </span>{action.escalation}</p>
                    <p className="md:col-span-2"><span className="font-code text-[7.5px] font-bold tracking-[0.16em] text-ink-400">BASIS · </span>{action.basis}</p>
                    <p className="md:col-span-2"><span className="font-code text-[7.5px] font-bold tracking-[0.16em] text-ink-400">EVIDENCE · </span>{action.evidence}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            {/* Separation of duties */}
            <section className={card} aria-labelledby="gov-duties">
              <div className="border-b border-ink-100 px-5 py-4">
                <p id="gov-duties" className="font-code text-[8px] font-semibold uppercase tracking-[0.22em] text-ink-400">
                  Separation of duties — and how it is enforced
                </p>
              </div>
              <ul className="divide-y divide-ink-100">
                {gov.duties.map((duty) => (
                  <li key={duty.id} className="px-5 py-4">
                    <p className="flex items-start gap-2 text-[13px] font-semibold text-ink-950">
                      <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden="true" />
                      {duty.rule}
                    </p>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-ink-600">{duty.enforcement}</p>
                    <p className="mt-1 font-code text-[7.5px] tracking-[0.14em] text-ink-400">ENFORCED BY · {duty.enforcedBy}</p>
                  </li>
                ))}
              </ul>
            </section>

            {/* Approval bands + access posture */}
            <div className="space-y-5">
              <section className={card} aria-labelledby="gov-bands">
                <div className="border-b border-ink-100 px-5 py-4">
                  <p id="gov-bands" className="font-code text-[8px] font-semibold uppercase tracking-[0.22em] text-ink-400">
                    Approval bands — value to office
                  </p>
                </div>
                <ul className="divide-y divide-ink-100">
                  {gov.bands.map((band) => (
                    <li key={band.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-[13px] font-semibold text-ink-950">{band.label}</p>
                        <p className="font-code text-[10px] tracking-[0.08em] text-ink-500 tabular">
                          {band.currency} {band.min.toLocaleString()} — {band.max !== undefined ? band.max.toLocaleString() : "∞"}
                        </p>
                      </div>
                      <p className="mt-1 text-[12px] text-ink-600">
                        Approving office: <span className="font-semibold text-ink-900">{OFFICE_LABEL[band.approvalOffice] ?? band.approvalOffice}</span>
                      </p>
                      {band.note && <p className="mt-1 text-[11px] leading-relaxed text-ink-500">{band.note}</p>}
                    </li>
                  ))}
                </ul>
              </section>

              {access && (
                <section className={card} aria-labelledby="gov-access">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
                    <p id="gov-access" className="font-code text-[8px] font-semibold uppercase tracking-[0.22em] text-ink-400">
                      Access posture — live
                    </p>
                    {canManagePeople && (
                      <button
                        type="button"
                        onClick={() => void recordAccessReview()}
                        disabled={busy === "review"}
                        className="focus-brand inline-flex h-8 items-center gap-2 rounded-lg border border-ink-200 bg-white px-2.5 font-code text-[8px] font-bold tracking-[0.14em] text-ink-700 transition-colors hover:border-ink-950 disabled:opacity-50"
                      >
                        {busy === "review" ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <ClipboardCheck className="h-3 w-3" aria-hidden="true" />}
                        RECORD REVIEW
                      </button>
                    )}
                  </div>
                  <div className="px-5 py-4">
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[12.5px]">
                      <div>
                        <dt className="font-code text-[7.5px] font-bold tracking-[0.16em] text-ink-400">ACCOUNTS</dt>
                        <dd className="mt-0.5 text-ink-900 tabular">{access.totals.users} · by role: {Object.entries(access.byRole).map(([r, n]) => `${r.toLowerCase()} ${n}`).join(", ") || "—"}</dd>
                      </div>
                      <div>
                        <dt className="font-code text-[7.5px] font-bold tracking-[0.16em] text-ink-400">LIVE SESSIONS</dt>
                        <dd className="mt-0.5 text-ink-900 tabular">{access.totals.activeSessions} · {access.totals.pendingInvites} invite(s) pending</dd>
                      </div>
                      <div>
                        <dt className="font-code text-[7.5px] font-bold tracking-[0.16em] text-ink-400">MFA POLICY</dt>
                        <dd className="mt-0.5 flex items-center gap-2">
                          <span className={cn("inline-flex h-5 items-center rounded-full border px-2 font-code text-[7.5px] font-bold tracking-[0.14em]", mfa?.enabled ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700" : "border-amber-500/40 bg-amber-500/[0.06] text-amber-700")}>
                            {mfa?.enabled ? "ON" : "OFF"}
                          </span>
                          {canManagePeople && (
                            <button
                              type="button"
                              onClick={() => void toggleMfa(!(mfa?.enabled ?? false))}
                              disabled={busy === "mfa"}
                              className="focus-brand font-code text-[7.5px] font-bold tracking-[0.14em] text-ink-600 underline decoration-dotted underline-offset-2 hover:text-ink-950 disabled:opacity-50"
                            >
                              {busy === "mfa" ? "…" : mfa?.enabled ? "TURN OFF" : "TURN ON"}
                            </button>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-code text-[7.5px] font-bold tracking-[0.16em] text-ink-400">LAST ACCESS REVIEW</dt>
                        <dd className="mt-0.5 text-ink-900">
                          {access.lastReview ? `${access.lastReview.by} · ${access.lastReview.at.slice(0, 10)}` : "none recorded yet"}
                        </dd>
                      </div>
                    </dl>
                    {access.privileged.withoutMfa.length > 0 && (
                      <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">
                        <UserCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        Privileged without a second factor: {access.privileged.withoutMfa.map((u) => `${u.name} (${u.role.toLowerCase()})`).join(", ")}.
                        {mfa?.enabled ? " They cannot sign gates until they enroll." : " Turn the policy on to require enrollment."}
                      </p>
                    )}
                  </div>
                </section>
              )}
            </div>
          </div>

          <p className="mt-5 flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-500">
            <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {gov.note} The matrix above is served live by the same service that enforces it — this screen cannot drift from
            the code the way a document can.
          </p>
        </>
      )}
    </div>
  );
}
