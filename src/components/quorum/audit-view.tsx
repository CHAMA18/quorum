"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileKey2,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { SpecBar } from "@/components/quorum/reveal";
import { cn } from "@/lib/utils";

/**
 * Audit explorer.
 *
 * The product's promise is "nothing happens silently". This page is where a
 * sceptic checks that promise: the hash-chained tool log, filtered and
 * exportable; the file-level chain verifier; and the Ed25519 receipt behind
 * every executed gate. It is deliberately read-only — auditing is not an
 * editing surface.
 */

type LogEntry = {
  seq: number;
  id: string;
  ts: string;
  actor: string;
  server: string;
  tool: string;
  kind: string;
  runId?: string;
  inputs: unknown;
  outputs: unknown;
  status: string;
  durationMs: number;
  prev?: string;
  self?: string;
};

type Gate = {
  id: string;
  runId: string;
  tenderId: string;
  tool: string;
  status: string;
  approver?: string;
  decidedAt?: string;
  executedAt?: string;
  receipt?: { submissionId?: string; hash?: string; [k: string]: unknown };
  stepUp?: { by: string; method: string; at: string; jti: string; docHash: string };
  signature?: { algorithm: string; keyId: string; payloadHash: string; value: string; signedAt: string };
  signatureValid?: boolean;
};

type ChainVerdict = { ok: boolean; brokenAt: number | null; checked: number; lines: number; error?: string };
type ReceiptVerdict = {
  gateId: string;
  tenderId: string;
  status: string;
  approver: string | null;
  decidedAt: string | null;
  receipt: unknown;
  stepUp: Gate["stepUp"] | null;
  signature: Gate["signature"] | null;
  signatureValid: boolean;
  reason: string | null;
};

const SVC = "/api";
const LIMIT = 300;

function stamp(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function statusTone(status: string): string {
  if (status === "OK" || status === "EXECUTED") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (status === "PENDING_GATE" || status === "PENDING") return "border-amber-300 bg-amber-50 text-amber-800";
  if (status === "ERROR" || status === "REJECTED") return "border-red-300 bg-red-50 text-red-700";
  return "border-ink-200 bg-white text-ink-600";
}

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function AuditView({ onToast }: { onToast: (msg: string) => void }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [allTotal, setAllTotal] = useState(0);
  const [gates, setGates] = useState<Gate[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [chain, setChain] = useState<ChainVerdict | null>(null);
  const [chainBusy, setChainBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptVerdict | null>(null);
  const [receiptBusy, setReceiptBusy] = useState<string | null>(null);
  const [filters, setFilters] = useState({ q: "", actor: "", tool: "", status: "", kind: "", from: "", to: "" });

  const query = useMemo(() => {
    const p = new URLSearchParams({ limit: String(LIMIT), XTransformPort: "3031" });
    for (const [k, v] of Object.entries(filters)) if (v.trim()) p.set(k, v.trim());
    return p.toString();
  }, [filters]);

  const pull = useCallback(async () => {
    setLoading(true);
    try {
      const [logRes, gateRes] = await Promise.all([
        fetch(`${SVC}/log?${query}`, { cache: "no-store" }),
        fetch(`${SVC}/gates?XTransformPort=3031`, { cache: "no-store" }),
      ]);
      if (!logRes.ok) throw new Error(String(logRes.status));
      const log = (await logRes.json()) as { entries?: LogEntry[]; total?: number; allTotal?: number };
      setEntries(log.entries ?? []);
      setTotal(log.total ?? log.entries?.length ?? 0);
      setAllTotal(log.allTotal ?? log.entries?.length ?? 0);
      if (gateRes.ok) {
        const g = (await gateRes.json()) as { gates?: Gate[] };
        setGates(g.gates ?? []);
      }
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void pull();
  }, [pull]);

  const verifyChain = async () => {
    setChainBusy(true);
    try {
      const res = await fetch(`${SVC}/log/verify?XTransformPort=3031`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as ChainVerdict;
      setChain(data);
      onToast(data.ok ? `AUDIT CHAIN VERIFIED — ${data.checked} ENTRIES` : `AUDIT CHAIN BROKEN AT ENTRY ${data.brokenAt ?? "?"}`);
    } catch {
      setChain({ ok: false, brokenAt: null, checked: 0, lines: 0, error: "The log verifier is unreachable." });
      onToast("AUDIT CHAIN VERIFIER UNREACHABLE");
    } finally {
      setChainBusy(false);
    }
  };

  const verifyReceipt = async (id: string) => {
    setReceiptBusy(id);
    try {
      const res = await fetch(`${SVC}/gates/${encodeURIComponent(id)}/verify?XTransformPort=3031`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as ReceiptVerdict;
      setReceipt(data);
      onToast(data.signatureValid ? `RECEIPT VERIFIED — ${id}` : `RECEIPT NOT VALID — ${data.reason ?? "signature mismatch"}`);
    } catch {
      onToast("RECEIPT VERIFIER UNREACHABLE");
    } finally {
      setReceiptBusy(null);
    }
  };

  const exportLog = (format: "json" | "csv") => {
    const stampName = new Date().toISOString().replace(/[:.]/g, "-");
    if (format === "json") {
      download(`quorum-audit-${stampName}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), filters, entries }, null, 2), "application/json");
    } else {
      const cols = ["seq", "ts", "actor", "tool", "kind", "status", "runId", "durationMs", "self", "prev"];
      const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const body = [cols.join(","), ...entries.map((e) => cols.map((c) => esc(e[c as keyof LogEntry])).join(","))].join("\n");
      download(`quorum-audit-${stampName}.csv`, body, "text/csv");
    }
    onToast(`AUDIT EXPORTED — ${entries.length} ENTRIES · ${format.toUpperCase()}`);
  };

  const signedGates = gates.filter((g) => g.signature);
  const pending = gates.filter((g) => g.status === "PENDING").length;

  const tools = useMemo(() => [...new Set(entries.map((e) => e.tool))].sort(), [entries]);

  return (
    <div className="space-y-7">
      <section>
        <SpecBar index="Audit" label="The record" meta="Hash-chained · exportable · read-only" />
        <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="type-display text-[32px] text-ink-950 sm:text-[40px]">Every action, checkable.</h1>
            <p className="type-lede mt-3 max-w-[62ch] text-ink-600">
              The sidecar appends every tool call to a hash-chained log, and every executed gate carries an Ed25519
              signature over its inputs, approver and receipt. Verify the chain, inspect a receipt, export the file.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void pull()}
              className="focus-brand inline-flex h-9 items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 font-code text-[8px] font-bold tracking-[0.14em] text-ink-700 transition-colors hover:border-ink-950"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} aria-hidden="true" /> REFRESH
            </button>
            <button
              type="button"
              onClick={() => exportLog("csv")}
              disabled={entries.length === 0}
              className="focus-brand inline-flex h-9 items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 font-code text-[8px] font-bold tracking-[0.14em] text-ink-700 transition-colors hover:border-ink-950 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> CSV
            </button>
            <button
              type="button"
              onClick={() => exportLog("json")}
              disabled={entries.length === 0}
              className="focus-brand inline-flex h-9 items-center gap-2 rounded-lg bg-ink-950 px-3 font-code text-[8px] font-bold tracking-[0.14em] text-white transition-colors hover:bg-ink-800 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> EXPORT JSON
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "LOG ENTRIES", value: allTotal.toLocaleString(), note: `${entries.length} in this view` },
          { label: "CHAIN STATUS", value: chain ? (chain.ok ? "VERIFIED" : "BROKEN") : "UNVERIFIED", note: chain ? `${chain.checked} checked` : "Run the verifier" },
          { label: "SIGNED RECEIPTS", value: String(signedGates.length), note: `${gates.length} gates on record` },
          { label: "PENDING GATES", value: String(pending), note: "waiting on a named human" },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-ink-200/80 bg-white px-4 py-3.5">
            <p className="font-code text-[7.5px] font-bold tracking-[0.2em] text-ink-400">{card.label}</p>
            <p className="mt-2 text-[22px] font-semibold tracking-[-0.02em] text-ink-950">{card.value}</p>
            <p className="mt-0.5 text-[10.5px] text-ink-500">{card.note}</p>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-ink-200/80 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[13px] font-semibold text-ink-950">Hash-chain verification</h2>
            <p className="mt-1 max-w-[70ch] text-[11.5px] leading-relaxed text-ink-500">
              Re-reads <span className="font-code text-[10.5px] text-ink-800">tool-log.jsonl</span> from disk and
              recomputes every <span className="font-code text-[10.5px] text-ink-800">prev</span>/<span className="font-code text-[10.5px] text-ink-800">self</span> link.
              A broken link names the exact entry.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void verifyChain()}
            disabled={chainBusy}
            className="focus-brand inline-flex h-9 items-center gap-2 rounded-lg border border-ink-950 bg-white px-3 font-code text-[8px] font-bold tracking-[0.14em] text-ink-950 transition-colors hover:bg-ink-950 hover:text-white disabled:opacity-50"
          >
            {chainBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}
            {chainBusy ? "VERIFYING…" : "VERIFY CHAIN"}
          </button>
        </div>
        {chain ? (
          <div
            className={cn(
              "mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2.5",
              chain.ok ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50",
            )}
          >
            {chain.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" /> : <ShieldAlert className="h-4 w-4 text-red-700" aria-hidden="true" />}
            <p className={cn("text-[11.5px] font-semibold", chain.ok ? "text-emerald-900" : "text-red-900")}>
              {chain.ok ? `Chain intact — ${chain.checked} entries checked.` : chain.error ?? `Chain broken at entry ${chain.brokenAt}.`}
            </p>
            <p className="font-code text-[8px] tracking-[0.12em] text-ink-500">
              {chain.lines} LINES · {chain.checked} CHECKED · VERIFIED {new Date().toLocaleTimeString("en-GB")}
            </p>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-ink-200/80 bg-white">
        <div className="border-b border-ink-100 px-4 py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[13px] font-semibold text-ink-950">Tool-call log</h2>
            <p className="font-code text-[8px] font-bold tracking-[0.16em] text-ink-400">
              {total.toLocaleString()} MATCHING · {allTotal.toLocaleString()} TOTAL
            </p>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <label className="relative sm:col-span-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" aria-hidden="true" />
              <input
                value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                placeholder="Search inputs, outputs, actors…"
                aria-label="Search audit entries"
                className="focus-brand h-9 w-full rounded-lg border border-ink-200 bg-white pl-8 pr-2.5 text-[12px] text-ink-900 outline-none focus:border-ink-950"
              />
            </label>
            <input
              value={filters.actor}
              onChange={(e) => setFilters((f) => ({ ...f, actor: e.target.value }))}
              placeholder="Actor"
              aria-label="Filter by actor"
              className="focus-brand h-9 rounded-lg border border-ink-200 bg-white px-2.5 text-[12px] text-ink-900 outline-none focus:border-ink-950"
            />
            <select
              value={filters.tool}
              onChange={(e) => setFilters((f) => ({ ...f, tool: e.target.value }))}
              aria-label="Filter by tool"
              className="focus-brand h-9 rounded-lg border border-ink-200 bg-white px-2 text-[11.5px] text-ink-900 outline-none focus:border-ink-950"
            >
              <option value="">All tools</option>
              {tools.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              aria-label="Filter by status"
              className="focus-brand h-9 rounded-lg border border-ink-200 bg-white px-2 text-[11.5px] text-ink-900 outline-none focus:border-ink-950"
            >
              <option value="">All statuses</option>
              {["OK", "PENDING_GATE", "GATED", "ERROR"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={filters.kind}
              onChange={(e) => setFilters((f) => ({ ...f, kind: e.target.value }))}
              aria-label="Filter by tool kind"
              className="focus-brand h-9 rounded-lg border border-ink-200 bg-white px-2 text-[11.5px] text-ink-900 outline-none focus:border-ink-950"
            >
              <option value="">All kinds</option>
              {["READ", "WRITES", "IRREVERSIBLE", "GATE_DECISION"].map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={filters.from}
                onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
                aria-label="From date"
                className="focus-brand h-9 min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-1.5 text-[10.5px] text-ink-900 outline-none focus:border-ink-950"
              />
              <span className="text-[9px] text-ink-400">to</span>
              <input
                type="date"
                value={filters.to}
                onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
                aria-label="To date"
                className="focus-brand h-9 min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-1.5 text-[10.5px] text-ink-900 outline-none focus:border-ink-950"
              />
            </div>
          </div>
          {(filters.q || filters.actor || filters.tool || filters.status || filters.kind || filters.from || filters.to) ? (
            <button
              type="button"
              onClick={() => setFilters({ q: "", actor: "", tool: "", status: "", kind: "", from: "", to: "" })}
              className="mt-2 inline-flex items-center gap-1 font-code text-[8px] font-bold tracking-[0.14em] text-brand-700 hover:underline"
            >
              <X className="h-3 w-3" aria-hidden="true" /> CLEAR FILTERS
            </button>
          ) : null}
        </div>

        {failed ? (
          <div className="px-4 py-8 text-center">
            <p className="text-[12.5px] font-medium text-ink-800">The audit service is unreachable.</p>
            <button type="button" onClick={() => void pull()} className="mt-2 font-code text-[8px] font-bold tracking-[0.16em] text-brand-700 hover:underline">
              RETRY
            </button>
          </div>
        ) : loading && entries.length === 0 ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 font-code text-[8px] font-bold tracking-[0.18em] text-ink-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> READING THE SPINE…
          </div>
        ) : entries.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-ink-500">No entries match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-b border-ink-100 bg-paper/50">
                  {["", "Seq", "When", "Actor", "Tool", "Kind", "Status", "Run"].map((h) => (
                    <th key={h} className="px-3 py-2 font-code text-[7px] font-bold tracking-[0.18em] text-ink-400 first:pl-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const open = expanded === e.id;
                  return (
                    <FragmentRow key={e.id} entry={e} open={open} onToggle={() => setExpanded(open ? null : e.id)} />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-ink-200/80 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-4 py-3.5">
          <div>
            <h2 className="text-[13px] font-semibold text-ink-950">Signed gate receipts</h2>
            <p className="mt-0.5 text-[11px] text-ink-500">Ed25519 over the decision, approver, inputs hash and filing receipt.</p>
          </div>
          <span className="font-code text-[8px] font-bold tracking-[0.16em] text-ink-400">{signedGates.length} SIGNED</span>
        </div>
        {signedGates.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12.5px] text-ink-500">No gate has been signed yet. Sign one from Approvals.</p>
        ) : (
          <div className="divide-y divide-ink-100">
            {signedGates.slice(0, 12).map((g) => (
              <div key={g.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <FileKey2 className="h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-ink-950">
                    {g.tenderId} <span className="font-normal text-ink-400">·</span>{" "}
                    <span className="font-code text-[10px] font-normal text-ink-500">{g.id}</span>
                  </p>
                  <p className="mt-0.5 font-code text-[9px] tracking-[0.05em] text-ink-500">
                    {g.approver ?? "UNSIGNED"} · {g.status} · {g.signature?.keyId ?? "NO KEY"} ·{" "}
                    {g.signatureValid ? "SIGNATURE VALID" : "SIGNATURE INVALID"}
                  </p>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-code text-[7.5px] font-bold tracking-[0.12em]",
                    g.signatureValid ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-red-300 bg-red-50 text-red-700",
                  )}
                >
                  {g.signatureValid ? <ShieldCheck className="h-3 w-3" aria-hidden="true" /> : <ShieldAlert className="h-3 w-3" aria-hidden="true" />}
                  {g.signatureValid ? "VERIFIED" : "CHECK"}
                </span>
                <button
                  type="button"
                  onClick={() => void verifyReceipt(g.id)}
                  disabled={receiptBusy === g.id}
                  className="focus-brand inline-flex h-8 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2.5 font-code text-[7.5px] font-bold tracking-[0.12em] text-ink-700 transition-colors hover:border-ink-950 disabled:opacity-50"
                >
                  {receiptBusy === g.id ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <FileKey2 className="h-3 w-3" aria-hidden="true" />}
                  DETAIL
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {receipt ? (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-ink-950/45 px-4 backdrop-blur-[3px]" role="dialog" aria-modal="true" aria-labelledby="receipt-title">
          <div className="max-h-[86vh] w-full max-w-[720px] overflow-auto rounded-2xl border border-ink-200 bg-[#fffdfb] shadow-2xl">
            <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-ink-100 bg-[#fffdfb] px-5 py-4">
              <div>
                <h3 id="receipt-title" className="text-[14px] font-semibold text-ink-950">Gate receipt · {receipt.gateId}</h3>
                <p className="mt-0.5 font-code text-[9px] tracking-[0.08em] text-ink-500">{receipt.tenderId} · {receipt.status}</p>
              </div>
              <button type="button" onClick={() => setReceipt(null)} aria-label="Close receipt" className="grid h-8 w-8 place-items-center rounded-full text-ink-400 hover:bg-ink-950/[0.05] hover:text-ink-800">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2.5", receipt.signatureValid ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50")}>
                {receipt.signatureValid ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />}
                <div>
                  <p className={cn("text-[12px] font-semibold", receipt.signatureValid ? "text-emerald-900" : "text-red-900")}>
                    {receipt.signatureValid ? "Ed25519 signature verifies" : "Signature does not verify"}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-600">
                    {receipt.signatureValid ? "The gate record is exactly what the key signed." : receipt.reason ?? "The record changed after signing."}
                  </p>
                </div>
              </div>
              <dl className="grid gap-2 text-[11.5px] sm:grid-cols-2">
                <div><dt className="font-code text-[7.5px] font-bold tracking-[0.16em] text-ink-400">APPROVER</dt><dd className="mt-0.5 text-ink-900">{receipt.approver ?? "—"}</dd></div>
                <div><dt className="font-code text-[7.5px] font-bold tracking-[0.16em] text-ink-400">DECIDED</dt><dd className="mt-0.5 text-ink-900">{receipt.decidedAt ? stamp(receipt.decidedAt) : "—"}</dd></div>
                <div><dt className="font-code text-[7.5px] font-bold tracking-[0.16em] text-ink-400">STEP-UP</dt><dd className="mt-0.5 text-ink-900">{receipt.stepUp ? `${receipt.stepUp.by} · ${receipt.stepUp.method}` : "—"}</dd></div>
                <div><dt className="font-code text-[7.5px] font-bold tracking-[0.16em] text-ink-400">KEY ID</dt><dd className="mt-0.5 font-code text-[10.5px] text-ink-900">{receipt.signature?.keyId ?? "—"}</dd></div>
              </dl>
              <details className="rounded-lg border border-ink-200 bg-white">
                <summary className="cursor-pointer px-3 py-2 font-code text-[8px] font-bold tracking-[0.14em] text-ink-600">SIGNED RECEIPT JSON</summary>
                <pre className="max-h-[300px] overflow-auto border-t border-ink-100 p-3 font-code text-[10px] leading-relaxed text-ink-800">{JSON.stringify(receipt, null, 2)}</pre>
              </details>
              <button
                type="button"
                onClick={() => download(`quorum-receipt-${receipt.gateId}.json`, JSON.stringify(receipt, null, 2), "application/json")}
                className="focus-brand inline-flex h-9 items-center gap-2 rounded-lg bg-ink-950 px-3 font-code text-[8px] font-bold tracking-[0.14em] text-white hover:bg-ink-800"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" /> DOWNLOAD RECEIPT
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FragmentRow({ entry: e, open, onToggle }: { entry: LogEntry; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className={cn("border-b border-ink-50 align-top transition-colors hover:bg-paper/50", open && "bg-paper/50")}>
        <td className="pl-4 pr-1 py-2.5">
          <button type="button" onClick={onToggle} aria-label={open ? "Collapse entry" : "Expand entry"} aria-expanded={open} className="grid h-5 w-5 place-items-center rounded text-ink-400 hover:bg-ink-950/[0.06] hover:text-ink-800">
            {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
        </td>
        <td className="px-3 py-2.5 font-code text-[9px] text-ink-500">{e.seq}</td>
        <td className="whitespace-nowrap px-3 py-2.5 text-[10.5px] text-ink-600">{stamp(e.ts)}</td>
        <td className="px-3 py-2.5 text-[11px] font-medium text-ink-900">{e.actor}</td>
        <td className="px-3 py-2.5 font-code text-[10px] text-ink-800">{e.tool}</td>
        <td className="px-3 py-2.5 font-code text-[8px] tracking-[0.08em] text-ink-500">{e.kind}</td>
        <td className="px-3 py-2.5">
          <span className={cn("inline-flex rounded-full border px-2 py-0.5 font-code text-[7px] font-bold tracking-[0.08em]", statusTone(e.status))}>{e.status}</span>
        </td>
        <td className="max-w-[140px] truncate px-3 py-2.5 font-code text-[9px] text-ink-500">{e.runId ?? "—"}</td>
      </tr>
      {open ? (
        <tr className="border-b border-ink-100 bg-paper/40">
          <td />
          <td colSpan={7} className="px-3 py-3">
            <div className="grid gap-2 lg:grid-cols-2">
              <div>
                <p className="font-code text-[7.5px] font-bold tracking-[0.16em] text-ink-400">INPUTS</p>
                <pre className="mt-1 max-h-[180px] overflow-auto rounded-lg border border-ink-200 bg-white p-2.5 font-code text-[9.5px] leading-relaxed text-ink-800">{JSON.stringify(e.inputs, null, 2)}</pre>
              </div>
              <div>
                <p className="font-code text-[7.5px] font-bold tracking-[0.16em] text-ink-400">OUTPUTS</p>
                <pre className="mt-1 max-h-[180px] overflow-auto rounded-lg border border-ink-200 bg-white p-2.5 font-code text-[9.5px] leading-relaxed text-ink-800">{JSON.stringify(e.outputs, null, 2)}</pre>
              </div>
            </div>
            <p className="mt-2 font-code text-[8px] tracking-[0.08em] text-ink-400">
              SELF {e.self ?? "—"} · PREV {e.prev ?? "—"} · {e.durationMs}ms
            </p>
          </td>
        </tr>
      ) : null}
    </>
  );
}
