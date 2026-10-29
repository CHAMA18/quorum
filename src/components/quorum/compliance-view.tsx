"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookLock,
  CheckCircle2,
  FileWarning,
  Loader2,
  RefreshCw,
  ScrollText,
  ShieldAlert,
} from "lucide-react";
import { SpecBar } from "@/components/quorum/reveal";
import type { AuthUser } from "@/lib/auth-types";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/**
 * Compliance — the rules-driven control layer.
 *
 * Three live readings:
 *   1. the RULE PACK — every rule with its jurisdiction, legal basis, risk
 *      category, severity class, exception logic and the owner who signs for
 *      it. Citations name the act and its topic; the pack says plainly that
 *      the legal adviser has not confirmed section numbers yet.
 *   2. the PER-TENDER COMPLIANCE SUMMARY — findings, COI state and the
 *      artifact chain folded into one verdict, with hard-fail conditions
 *      that are never warnings.
 *   3. the EXCEPTION REGISTER — every departure from the standard route,
 *      each one riding a gate for the accounting officer.
 *
 * Plus the document register's review queue: low-confidence extractions stay
 * work items until a named reviewer clears them.
 */

const SVC = "/api";

type RuleMeta = {
  id: string;
  jurisdiction: string;
  legalReference: string;
  riskCategory: string;
  severity: string;
  status: "MANDATORY" | "ADVISORY";
  exceptionLogic: string;
  evidenceRequirement: string;
  signOffOwner: string;
};

type RulePack = {
  id: string;
  jurisdiction: string;
  name: string;
  description: string;
  legalInstrument: string;
  referencesConfirmed: boolean;
  hardFailRules: string[];
  rules: RuleMeta[];
};

type ComplianceLine = {
  rule: string;
  severity: string;
  status: string;
  hardFail: boolean;
  count: number;
  latestEvidence?: string;
  reviewed: number;
  accepted: number;
  rejected: number;
};

type ComplianceSummary = {
  tenderId: string;
  pack: { id: string; jurisdiction: string; referencesConfirmed: boolean };
  lines: ComplianceLine[];
  hardFails: { rule: string; detail: string; evidence?: string }[];
  chain: { valid: boolean; issues: string[] };
  coi: { declared: number; conflicts: string[] };
  exceptions: { id: string; kind: string; status: string; title: string }[];
  verdict: "CLEAR" | "FINDINGS" | "HARD_FAIL";
  note: string;
};

type ExceptionRow = {
  id: string;
  tenderId?: string;
  kind: string;
  title: string;
  justification: string;
  evidence: string[];
  requestedBy: string;
  requestedAt: string;
  status: "PENDING_GATE" | "APPROVED" | "REFUSED" | "WITHDRAWN";
  gateId?: string;
  decidedBy?: string;
  decidedAt?: string;
};

type DocumentRow = {
  id: string;
  tenderId?: string;
  key: string;
  title: string;
  kind: string;
  sha256: string;
  version: number;
  channel: string;
  capturedAt: string;
  extractionConfidence?: { level: "HIGH" | "MEDIUM" | "LOW"; reason?: string; reviewedBy?: string; reviewedAt?: string };
  retention: { schedule: string; years: number; disposeAfter?: string; status: "ACTIVE" | "ARCHIVED" };
};

const KIND_LABEL: Record<string, string> = {
  SINGLE_SOURCE: "Single-source",
  EMERGENCY: "Emergency",
  DIRECT_AWARD: "Direct award",
  NON_COMPLIANCE: "Non-compliance",
  POST_AWARD_CORRECTION: "Post-award correction",
};

const VERDICT_TONE: Record<ComplianceSummary["verdict"], string> = {
  CLEAR: "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300",
  FINDINGS: "border-amber-500/40 bg-amber-500/[0.06] text-amber-700 dark:text-amber-300",
  HARD_FAIL: "border-brand-500/40 bg-brand-500/[0.06] text-brand-700 dark:text-brand-300",
};

const EXCEPTION_TONE: Record<ExceptionRow["status"], string> = {
  PENDING_GATE: "border-amber-500/40 bg-amber-500/[0.06] text-amber-700",
  APPROVED: "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700",
  REFUSED: "border-brand-500/40 bg-brand-500/[0.06] text-brand-700",
  WITHDRAWN: "border-ink-200 bg-[#fffdfb] text-ink-500 dark:border-white/10 dark:bg-white/[0.03]",
};

const card = "rounded-[12px] panel overflow-hidden";

export function ComplianceView({ user, onToast }: { user: AuthUser | null; onToast: (msg: string) => void }) {
  const [pack, setPack] = useState<RulePack | null>(null);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [tenderIds, setTenderIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [summary, setSummary] = useState<ComplianceSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showRaise, setShowRaise] = useState(false);
  const [form, setForm] = useState({ kind: "SINGLE_SOURCE", title: "", justification: "", evidence: "", tenderId: "" });

  const canRun = can(user?.role, "run_reviews");

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [p, e, d, t] = await Promise.all([
        fetch(`${SVC}/rulepacks?XTransformPort=3031`, { cache: "no-store" }),
        fetch(`${SVC}/exceptions?XTransformPort=3031`, { cache: "no-store" }),
        fetch(`${SVC}/documents?XTransformPort=3031&unreviewed=0`, { cache: "no-store" }),
        fetch(`${SVC}/cycle?XTransformPort=3031`, { cache: "no-store" }),
      ]);
      if (!p.ok) throw new Error("compliance service unreachable");
      const packData = (await p.json()) as { packs?: RulePack[] };
      setPack(packData.packs?.[0] ?? null);
      if (e.ok) setExceptions(((await e.json()) as { exceptions?: ExceptionRow[] }).exceptions ?? []);
      if (d.ok) setDocs(((await d.json()) as { documents?: DocumentRow[] }).documents ?? []);
      if (t.ok) {
        const cycles = (await t.json()) as { cycles?: { tenderId: string }[] };
        const ids = (cycles.cycles ?? []).map((c) => c.tenderId);
        setTenderIds(ids);
        setSelected((prev) => prev ?? ids[0] ?? null);
      }
    } catch {
      setLoadError("The compliance service did not answer. The desk still runs — try the refresh control in a moment.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setSummary(null);
    void (async () => {
      try {
        const res = await fetch(`${SVC}/tenders/${encodeURIComponent(selected)}/compliance?XTransformPort=3031`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as ComplianceSummary;
        if (!cancelled) setSummary(data);
      } catch {
        if (!cancelled) setSummary(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  async function raiseException(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy("raise");
    try {
      const res = await fetch(`${SVC}/exceptions?XTransformPort=3031`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: form.kind,
          title: form.title,
          justification: form.justification,
          evidence: form.evidence.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
          ...(form.tenderId.trim() ? { tenderId: form.tenderId.trim() } : {}),
        }),
      });
      const data = (await res.json()) as { error?: string; gateId?: string };
      if (!res.ok) throw new Error(data.error ?? "refused");
      onToast(`Exception raised — gate ${data.gateId} waits on the accounting officer.`);
      setShowRaise(false);
      setForm({ kind: "SINGLE_SOURCE", title: "", justification: "", evidence: "", tenderId: "" });
      await load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "The exception was refused.");
    } finally {
      setBusy(null);
    }
  }

  async function clearExtraction(docId: string) {
    setBusy(`doc-${docId}`);
    try {
      const res = await fetch(`${SVC}/documents/${docId}/review?XTransformPort=3031`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "refused");
      onToast("Extraction confirmed by a named reviewer — the work item clears.");
      await load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "The review was refused.");
    } finally {
      setBusy(null);
    }
  }

  const reviewQueue = useMemo(() => docs.filter((d) => d.extractionConfidence && d.extractionConfidence.level !== "HIGH" && !d.extractionConfidence.reviewedBy), [docs]);
  const stats = [
    { label: "RULES IN PACK", value: String(pack?.rules.length ?? "—"), note: `${pack?.hardFailRules.length ?? "—"} hard-fail conditions` },
    { label: "HARD FAILS LIVE", value: String(summary?.hardFails.length ?? "—"), note: selected ? `on ${selected}` : "no tender selected" },
    { label: "EXCEPTIONS", value: String(exceptions.length), note: `${exceptions.filter((x) => x.status === "PENDING_GATE").length} at the gate` },
    { label: "OCR REVIEW QUEUE", value: String(reviewQueue.length), note: "low-confidence extractions awaiting a human" },
  ];

  return (
    <div>
      <SpecBar index="CMP" label="Workspace" meta="Compliance" />
      <div className="mt-6 flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <h1 className="type-display text-[30px] text-ink-950 sm:text-[38px]">
            Compliance
            <span className="text-brand-600">.</span>
          </h1>
          <p className="type-lede mt-3 text-ink-600">
            The platform evaluates every dossier against a stated rule set. Hard-fail conditions are never warnings;
            findings are evidence-linked; exceptions ride a gate — the register is the record, not an email thread.
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
          {canRun && (
            <button
              type="button"
              onClick={() => setShowRaise((v) => !v)}
              className="focus-brand inline-flex h-9 items-center gap-2 rounded-lg bg-ink-950 px-3 font-code text-[8px] font-bold tracking-[0.14em] text-white transition-colors hover:bg-ink-800"
            >
              <FileWarning className="h-3 w-3" aria-hidden="true" />
              {showRaise ? "CLOSE" : "RAISE EXCEPTION"}
            </button>
          )}
        </div>
      </div>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Compliance summary">
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
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{loadError}</p>
        </div>
      )}

      {showRaise && canRun && (
        <form onSubmit={raiseException} className={`${card} mt-4 space-y-3 px-5 py-4`} aria-label="Raise a procurement exception">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[11px] font-semibold text-ink-700">
              Kind
              <select
                value={form.kind}
                onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
                className="focus-brand mt-1 block w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[12.5px] text-ink-900"
              >
                {Object.entries(KIND_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] font-semibold text-ink-700">
              Tender reference (optional)
              <input
                value={form.tenderId}
                onChange={(e) => setForm((f) => ({ ...f, tenderId: e.target.value }))}
                placeholder="e.g. KE-MOH-2026-117"
                className="focus-brand mt-1 block w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[12.5px] text-ink-900 placeholder:text-ink-400"
              />
            </label>
          </div>
          <label className="block text-[11px] font-semibold text-ink-700">
            Title
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
              minLength={4}
              maxLength={160}
              placeholder="What is being departed from the standard route?"
              className="focus-brand mt-1 block w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[12.5px] text-ink-900 placeholder:text-ink-400"
            />
          </label>
          <label className="block text-[11px] font-semibold text-ink-700">
            Justification (at least 30 characters — the record must show the reasons)
            <textarea
              value={form.justification}
              onChange={(e) => setForm((f) => ({ ...f, justification: e.target.value }))}
              required
              minLength={30}
              rows={3}
              className="focus-brand mt-1 block w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[12.5px] text-ink-900 placeholder:text-ink-400"
            />
          </label>
          <label className="block text-[11px] font-semibold text-ink-700">
            Evidence references (comma-separated: document keys, file names, gate ids)
            <input
              value={form.evidence}
              onChange={(e) => setForm((f) => ({ ...f, evidence: e.target.value }))}
              required
              placeholder="01-tender-notice.md, gate_abc123"
              className="focus-brand mt-1 block w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[12.5px] text-ink-900 placeholder:text-ink-400"
            />
          </label>
          <p className="text-[11.5px] leading-relaxed text-ink-500">
            Raising an exception raises a GATE for the accounting officer — your request cannot approve itself, and the
            officer who requests never signs.
          </p>
          <button
            type="submit"
            disabled={busy === "raise"}
            className="focus-brand inline-flex h-9 items-center gap-2 rounded-lg bg-brand-600 px-4 text-[12.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {busy === "raise" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FileWarning className="h-3.5 w-3.5" aria-hidden="true" />}
            Raise and send to the gate
          </button>
        </form>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          {/* Per-tender compliance */}
          <section className={card} aria-labelledby="cmp-tender">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
              <p id="cmp-tender" className="font-code text-[8px] font-semibold uppercase tracking-[0.22em] text-ink-400">
                Tender compliance summary
              </p>
              <select
                value={selected ?? ""}
                onChange={(e) => setSelected(e.target.value || null)}
                className="focus-brand max-w-[260px] rounded-lg border border-ink-200 bg-white px-2 py-1.5 font-code text-[9px] tracking-[0.06em] text-ink-700"
                aria-label="Choose a tender"
              >
                {tenderIds.length === 0 && <option value="">no cycles on record</option>}
                {tenderIds.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </div>
            {selected && summary && (
              <div className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("inline-flex h-7 items-center rounded-full border px-3 font-code text-[8px] font-bold tracking-[0.16em]", VERDICT_TONE[summary.verdict])}>
                    {summary.verdict.replace("_", " · ")}
                  </span>
                  <span className="font-code text-[8px] tracking-[0.14em] text-ink-400">
                    PACK {summary.pack.id.toUpperCase()} · {summary.lines.length} RULE LINE(S)
                  </span>
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-ink-600">{summary.note}</p>
                {summary.hardFails.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {summary.hardFails.map((h) => (
                      <li key={`${h.rule}-${h.detail}`} className="flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-[12px] leading-relaxed text-brand-900">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span><strong className="font-code text-[8px] tracking-[0.14em]">{h.rule}</strong> — {h.detail}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {summary.lines.length > 0 && (
                  <ul className="mt-3 divide-y divide-ink-100">
                    {summary.lines.map((line) => (
                      <li key={line.rule} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                        <div className="min-w-0">
                          <p className="font-code text-[9px] font-bold tracking-[0.1em] text-ink-800">
                            {line.rule}{line.hardFail && <span className="ml-1.5 text-brand-600">HARD-FAIL</span>}
                          </p>
                          <p className="mt-0.5 line-clamp-1 text-[11.5px] text-ink-500">{line.latestEvidence}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3 font-code text-[8px] tracking-[0.12em] text-ink-500">
                          <span>×{line.count}</span>
                          <span>SEV {line.severity.slice(0, 3)}</span>
                          <span>{line.reviewed > 0 ? `${line.accepted}✓ ${line.rejected}✗` : "AWAITING HUMAN"}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {summary.chain.issues.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {summary.chain.issues.map((issue) => (
                      <li key={issue} className="text-[11.5px] leading-relaxed text-brand-900">· {issue}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {selected && !summary && (
              <div className="flex items-center gap-2 px-5 py-6 text-[12px] text-ink-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Reading the live record for {selected}…
              </div>
            )}
            {!selected && <p className="px-5 py-6 text-[12px] text-ink-500">No tender cycle is on record yet — summaries appear once a cycle exists.</p>}
          </section>

          {/* Rule pack */}
          {pack && (
            <section className={card} aria-labelledby="cmp-pack">
              <div className="border-b border-ink-100 px-5 py-4">
                <p id="cmp-pack" className="font-code text-[8px] font-semibold uppercase tracking-[0.22em] text-ink-400">
                  Rule pack — {pack.name}
                </p>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-500">{pack.description}</p>
              </div>
              <ul className="divide-y divide-ink-100">
                {pack.rules.map((rule) => (
                  <li key={rule.id} className="px-5 py-3.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-code text-[9px] font-bold tracking-[0.1em] text-ink-900">{rule.id}</span>
                      <span className={cn("inline-flex h-5 items-center rounded-full border px-2 font-code text-[7px] font-bold tracking-[0.12em]", rule.status === "MANDATORY" ? "border-ink-300 text-ink-600 dark:border-white/20 dark:text-ink-300" : "border-ink-200 text-ink-400")}>
                        {rule.status}
                      </span>
                      {pack.hardFailRules.some((h) => rule.id === h || rule.id.startsWith(`${h}:`)) && (
                        <span className="inline-flex h-5 items-center rounded-full border border-brand-500/40 bg-brand-500/[0.06] px-2 font-code text-[7px] font-bold tracking-[0.12em] text-brand-700">
                          HARD-FAIL
                        </span>
                      )}
                      <span className="font-code text-[7.5px] tracking-[0.1em] text-ink-400">{rule.severity}</span>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-ink-700">{rule.riskCategory} · {rule.legalReference}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500"><span className="font-code text-[7px] font-bold tracking-[0.14em] text-ink-400">EXCEPTION · </span>{rule.exceptionLogic}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500"><span className="font-code text-[7px] font-bold tracking-[0.14em] text-ink-400">SIGN-OFF · </span>{rule.signOffOwner}</p>
                  </li>
                ))}
              </ul>
              <div className="border-t border-ink-100 px-5 py-3">
                <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-500">
                  <BookLock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {pack.referencesConfirmed
                    ? "Citations confirmed by the legal adviser."
                    : "References cite the act and its topic; the legal adviser has not confirmed section numbers. The pack says so rather than pretending."}
                </p>
              </div>
            </section>
          )}
        </div>

        <div className="space-y-5">
          {/* Exception register */}
          <section className={card} aria-labelledby="cmp-exceptions">
            <div className="border-b border-ink-100 px-5 py-4">
              <p id="cmp-exceptions" className="font-code text-[8px] font-semibold uppercase tracking-[0.22em] text-ink-400">
                Exception register
              </p>
            </div>
            {exceptions.length === 0 ? (
              <p className="px-5 py-6 text-[12px] leading-relaxed text-ink-500">No exceptions on record. Departures from the standard route live here — with evidence, and never without a signature.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {exceptions.slice(0, 12).map((exc) => (
                  <li key={exc.id} className="px-5 py-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("inline-flex h-5 items-center rounded-full border px-2 font-code text-[7px] font-bold tracking-[0.12em]", EXCEPTION_TONE[exc.status])}>
                        {exc.status.replace("_", " ")}
                      </span>
                      <span className="font-code text-[7.5px] tracking-[0.12em] text-ink-400">{KIND_LABEL[exc.kind] ?? exc.kind}{exc.tenderId ? ` · ${exc.tenderId}` : ""}</span>
                    </div>
                    <p className="mt-1 text-[12.5px] font-semibold text-ink-950">{exc.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-ink-500">{exc.justification}</p>
                    <p className="mt-1 font-code text-[7.5px] tracking-[0.12em] text-ink-400">
                      REQUESTED BY {exc.requestedBy.toUpperCase()} · {exc.requestedAt.slice(0, 10)}{exc.decidedBy ? ` · DECIDED BY ${exc.decidedBy.toUpperCase()}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* OCR review queue */}
          <section className={card} aria-labelledby="cmp-ocr">
            <div className="border-b border-ink-100 px-5 py-4">
              <p id="cmp-ocr" className="font-code text-[8px] font-semibold uppercase tracking-[0.22em] text-ink-400">
                Document review queue — person in the loop
              </p>
            </div>
            {reviewQueue.length === 0 ? (
              <p className="flex items-start gap-2 px-5 py-6 text-[12px] leading-relaxed text-ink-500">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                Nothing waiting — every registered document's extraction is either high-confidence or reviewed by a named human.
              </p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {reviewQueue.slice(0, 8).map((doc) => (
                  <li key={doc.id} className="px-5 py-3.5">
                    <p className="truncate font-code text-[9px] font-bold tracking-[0.06em] text-ink-900">{doc.title}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">{doc.extractionConfidence?.reason ?? "low-confidence extraction"} · sha {doc.sha256.slice(0, 10)}…</p>
                    {canRun && (
                      <button
                        type="button"
                        onClick={() => void clearExtraction(doc.id)}
                        disabled={busy === `doc-${doc.id}`}
                        className="focus-brand mt-2 inline-flex h-7 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2.5 font-code text-[7.5px] font-bold tracking-[0.12em] text-ink-700 transition-colors hover:border-ink-950 disabled:opacity-50"
                      >
                        {busy === `doc-${doc.id}` ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <ScrollText className="h-3 w-3" aria-hidden="true" />}
                        CONFIRM EXTRACTION
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {docs.length > 0 && (
            <p className="px-1 text-[11px] leading-relaxed text-ink-500">
              {docs.length} document(s) registered with content hashes, provenance, custody lines and retention schedules
              ({docs.filter((d) => d.retention.status === "ARCHIVED").length} archived). A document cannot be silently
              replaced — a changed hash is a version, and the previous hash stays on the record.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
