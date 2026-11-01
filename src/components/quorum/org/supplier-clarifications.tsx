"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, Loader2, Send } from "lucide-react";
import { fmtDate, fmtStamp } from "./supplier-data";

type Dossier = {
  id: string;
  tenderRef: string;
  bidder: string;
  openedAt: string;
  letterMd: string;
  responseDueAt: string;
  response: null | { text?: string; evidenceRef: string; receivedAt: string; receiptHash?: string };
  noResponseRecordedAt: string | null;
  resolution: null | { outcome: string; note: string; at: string };
};

const fieldClass = "w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-[12px] text-ink-900 outline-none placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 dark:border-white/10 dark:bg-night-2 dark:text-white dark:placeholder:text-ink-500";

export function SupplierClarifications() {
  const [dossiers, setDossiers] = useState<Dossier[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { response: string; evidenceRef: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/org/alb", { cache: "no-store" });
      const data = await res.json().catch(() => ({})) as { dossiers?: Dossier[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Clarification requests are not reachable right now.");
        return;
      }
      setError(null);
      setDossiers(data.dossiers ?? []);
    } catch {
      setError("Clarification requests are not reachable right now.");
    }
  }, []);

  useEffect(() => {
    const kick = setTimeout(() => void load(), 0);
    const poll = setInterval(() => void load(), 30_000);
    return () => { clearTimeout(kick); clearInterval(poll); };
  }, [load]);

  const update = (id: string, key: "response" | "evidenceRef", value: string) => {
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? { response: "", evidenceRef: "" }), [key]: value } }));
  };

  const submit = async (dossier: Dossier) => {
    const draft = drafts[dossier.id];
    if (!draft) return;
    setSaving(dossier.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/org/tenders/${encodeURIComponent(dossier.tenderRef)}/alb/${encodeURIComponent(dossier.id)}/response`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setMessage(data.error ?? "The response could not be submitted.");
        return;
      }
      setDrafts((current) => ({ ...current, [dossier.id]: { response: "", evidenceRef: "" } }));
      setMessage(`Response recorded for ${dossier.tenderRef}. The buyer's committee can now review it.`);
      await load();
    } catch {
      setMessage("The procurement service could not be reached. Your response has not been recorded.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="overflow-hidden rounded-[12px] panel dark:border-white/[0.07] dark:bg-night-2/80">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-5 py-3.5 dark:border-white/[0.06]">
        <div>
          <p className="font-code text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-500">Buyer clarification requests</p>
          <p className="mt-1 text-[11px] text-ink-400">Respond with an explanation and evidence before the recorded deadline.</p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-md px-2 py-1 text-[11px] font-semibold text-ink-500 hover:bg-ink-50 dark:hover:bg-white/[0.06]">Refresh</button>
      </div>

      {message ? <p aria-live="polite" className="border-b border-ink-100 px-5 py-2.5 text-[11.5px] text-ink-600 dark:border-white/[0.06] dark:text-ink-300">{message}</p> : null}
      {error ? (
        <div className="flex items-center gap-2 px-5 py-4 text-[12px] text-amber-800 dark:text-amber-300"><AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />{error}</div>
      ) : dossiers === null ? (
        <div className="flex items-center gap-2 px-5 py-5 text-[12px] text-ink-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Checking for clarification requests…</div>
      ) : dossiers.length === 0 ? (
        <div className="px-5 py-5 text-[12px] text-ink-500">No buyer clarification requests are open for this organization.</div>
      ) : (
        <ul className="divide-y divide-ink-100 dark:divide-white/[0.06]">
          {dossiers.map((dossier) => {
            const due = new Date(dossier.responseDueAt).getTime();
            const expired = Number.isFinite(due) && due < Date.now();
            const draft = drafts[dossier.id] ?? { response: "", evidenceRef: "" };
            return (
              <li key={`${dossier.tenderRef}-${dossier.id}`} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[12.5px] font-semibold text-ink-900 dark:text-white">{dossier.tenderRef} · Abnormally low bid clarification</p>
                    <p className="mt-1 flex items-center gap-1.5 font-code text-[9px] tracking-[0.08em] text-ink-500"><Clock3 className="h-3 w-3" aria-hidden="true" />Opened {fmtDate(dossier.openedAt)} · reply due {fmtDate(dossier.responseDueAt)}</p>
                  </div>
                  {dossier.resolution ? (
                    <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 font-code text-[8px] font-bold tracking-[0.12em] text-emerald-800 dark:text-emerald-300">{dossier.resolution.outcome}</span>
                  ) : dossier.response ? (
                    <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 font-code text-[8px] font-bold tracking-[0.12em] text-emerald-800 dark:text-emerald-300">RESPONSE RECEIVED</span>
                  ) : expired || dossier.noResponseRecordedAt ? (
                    <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 font-code text-[8px] font-bold tracking-[0.12em] text-amber-800 dark:text-amber-300">DEADLINE PASSED</span>
                  ) : (
                    <span className="rounded-full border border-brand-500/20 bg-brand-500/10 px-2 py-1 font-code text-[8px] font-bold tracking-[0.12em] text-brand-800 dark:text-brand-300">RESPONSE REQUIRED</span>
                  )}
                </div>
                {dossier.letterMd ? <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-ink-100 bg-paper p-3 font-sans text-[11.5px] leading-relaxed text-ink-700 dark:border-white/[0.06] dark:bg-white/[0.025] dark:text-ink-200">{dossier.letterMd}</pre> : null}
                {dossier.response ? (
                  <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3 text-[11.5px] dark:bg-emerald-500/[0.06]">
                    <p className="flex items-center gap-1.5 font-semibold text-emerald-900 dark:text-emerald-200"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Submitted {fmtStamp(dossier.response.receivedAt).time} · {fmtDate(dossier.response.receivedAt)}</p>
                    <p className="mt-2 whitespace-pre-wrap leading-relaxed text-ink-700 dark:text-ink-200">{dossier.response.text}</p>
                    <p className="mt-2 font-code text-[8px] tracking-[0.08em] text-ink-500">EVIDENCE {dossier.response.evidenceRef} · RECEIPT {dossier.response.receiptHash?.slice(0, 16) ?? "RECORDED"}</p>
                  </div>
                ) : null}
                {dossier.resolution?.note ? <p className="mt-2 text-[11.5px] leading-relaxed text-ink-600 dark:text-ink-300">Buyer review: {dossier.resolution.note}</p> : null}
                {!dossier.response && !dossier.resolution && !dossier.noResponseRecordedAt && !expired ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(220px,0.45fr)]">
                    <label className="space-y-1.5">
                      <span className="font-code text-[8px] font-semibold uppercase tracking-[0.13em] text-ink-500">Your explanation</span>
                      <textarea className={`${fieldClass} min-h-[88px] resize-y`} value={draft.response} onChange={(event) => update(dossier.id, "response", event.target.value)} maxLength={8_000} placeholder="Explain the cost, capacity, method, or other factors that make the offered price deliverable." />
                    </label>
                    <div className="flex flex-col justify-between gap-2">
                      <label className="space-y-1.5">
                        <span className="font-code text-[8px] font-semibold uppercase tracking-[0.13em] text-ink-500">Supporting evidence reference</span>
                        <input className={fieldClass} value={draft.evidenceRef} onChange={(event) => update(dossier.id, "evidenceRef", event.target.value)} maxLength={240} placeholder="Document name / page / attachment ref" />
                      </label>
                      <button type="button" onClick={() => void submit(dossier)} disabled={saving === dossier.id || draft.response.trim().length < 20 || !draft.evidenceRef.trim()} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 text-[11.5px] font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-brand-500 dark:hover:bg-brand-400">
                        {saving === dossier.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
                        Submit response
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
