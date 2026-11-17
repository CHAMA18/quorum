"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Pause, Play, RefreshCw, Search } from "lucide-react";
import { HorizontalScrollRegion } from "@/components/quorum/horizontal-scroll-region";
import { cn } from "@/lib/utils";

/**
 * MCP tool-call log for the Settings view.
 *
 * A live stream of every call into the sidecar's tool layer — the same
 * hash-chained, append-only tool log the Activity Log audits. Read from
 * GET /api/log (in-memory window, newest first) and polled every 3s so
 * the stream updates while the view is open; pause stops the poll without
 * clearing the rows. Per-entry inputs/outputs are capped server-side.
 *
 * This is the user-facing mirror of the audit surface, so statuses and
 * kind labels follow audit-view.tsx's vocabulary.
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
};

const POLL_MS = 3000;
const LIMIT = 100;

function clockTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fullStamp(ts: string): string {
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

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    OK: "Succeeded",
    PENDING_GATE: "Awaiting approval",
    GATED: "Awaiting approval",
    PENDING: "Pending",
    APPROVED: "Approved",
    EXECUTED: "Completed",
    REJECTED: "Declined",
    ERROR: "Error",
  };
  return labels[status] ?? status.replace(/_/g, " ");
}

function kindLabel(kind: string): string {
  const labels: Record<string, string> = {
    READ: "Read",
    WRITES: "Write",
    IRREVERSIBLE: "Irreversible action",
    GATE_DECISION: "Approval decision",
  };
  return labels[kind] ?? kind.replace(/_/g, " ");
}

function renderValue(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2).slice(0, 900);
  } catch {
    return String(value);
  }
}

export function McpToolLogs() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [recorded, setRecorded] = useState(0);
  const [q, setQ] = useState("");
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const seqGuard = useRef(0);

  const pull = useCallback(async (query: string) => {
    const mySeq = (seqGuard.current += 1);
    try {
      const res = await fetch(
        `/api/log?XTransformPort=3031&limit=${LIMIT}${query ? `&q=${encodeURIComponent(query)}` : ""}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { entries?: LogEntry[]; total?: number; allTotal?: number };
      if (seqGuard.current !== mySeq) return;
      setEntries(Array.isArray(data.entries) ? data.entries : []);
      setTotal(typeof data.total === "number" ? data.total : 0);
      setRecorded(typeof data.allTotal === "number" ? data.allTotal : 0);
      setRefreshedAt(new Date());
      setUnreachable(false);
      setLoading(false);
    } catch {
      if (seqGuard.current !== mySeq) return;
      setUnreachable(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void pull(q);
  }, [pull, q]);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => void pull(q), POLL_MS);
    return () => clearInterval(id);
  }, [pull, q, live]);

  const latest = entries[0] ?? null;
  const errors = entries.filter((e) => e.status === "ERROR").length;
  const searching = q.trim().length > 0;

  const cardClass = "rounded-[12px] panel p-5 shadow-[0_1px_2px_rgba(11,12,15,0.04)]";
  const labelClass = "font-code text-[10px] font-semibold tracking-[0.08em] text-ink-600";
  const titleClass = "mt-1.5 font-display text-[15px] font-black tracking-[-0.01em] text-ink-950";

  return (
    <section data-tour="settings-mcp-logs" className={`${cardClass} lg:col-span-2`} aria-label="MCP tool log">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={labelClass}>MCP TOOL LOG</p>
          <h3 className={titleClass}>Live tool calls</h3>
          <p className="mt-1 text-[12.5px] text-ink-500">
            Every call into the review service&rsquo;s tools, newest first — the same append-only,
            hash-chained log the Activity Log audits. Streaming while this view is open.
          </p>
          <p className="mt-2 font-code text-[10px] tracking-[0.06em] text-ink-600">
            {live ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
                LIVE
                {refreshedAt ? ` · UPDATED ${clockTime(refreshedAt.toISOString())}` : ""}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-ink-300" aria-hidden="true" />
                PAUSED
                {refreshedAt ? ` · LAST UPDATED ${clockTime(refreshedAt.toISOString())}` : ""}
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter calls…"
              aria-label="Filter tool calls"
              className="focus-brand h-9 w-40 rounded-lg border border-ink-200 bg-white pl-8 pr-2 text-[12px] text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-950 sm:w-48"
            />
          </div>
          <button
            type="button"
            onClick={() => setLive((l) => !l)}
            aria-label={live ? "Pause the live stream" : "Resume the live stream"}
            aria-pressed={live}
            className="focus-brand inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 font-code text-[10px] font-bold tracking-[0.06em] text-ink-700 transition-colors hover:border-ink-300 hover:text-ink-950"
          >
            {live ? <Pause className="h-3 w-3" aria-hidden="true" /> : <Play className="h-3 w-3" aria-hidden="true" />}
            {live ? "PAUSE" : "RESUME"}
          </button>
          <button
            type="button"
            onClick={() => void pull(q)}
            aria-label="Refresh now"
            className="focus-brand inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 font-code text-[10px] font-bold tracking-[0.06em] text-ink-700 transition-colors hover:border-ink-300 hover:text-ink-950"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            REFRESH
          </button>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-ink-100 bg-white/60 px-3 py-2.5">
          <dt className={labelClass}>RECENT CALLS</dt>
          <dd className="mt-0.5 font-code text-[13px] font-bold text-ink-950">{entries.length.toLocaleString("en-US")}</dd>
        </div>
        <div className="rounded-lg border border-ink-100 bg-white/60 px-3 py-2.5">
          <dt className={labelClass}>ERRORS</dt>
          <dd className={cn("mt-0.5 font-code text-[13px] font-bold", errors ? "text-red-600" : "text-ink-950")}>
            {errors.toLocaleString("en-US")}
          </dd>
        </div>
        <div className="rounded-lg border border-ink-100 bg-white/60 px-3 py-2.5">
          <dt className={labelClass}>{searching ? "MATCHING" : "RECORDED (BUFFER)"}</dt>
          <dd className="mt-0.5 font-code text-[13px] font-bold text-ink-950">
            {(searching ? total : recorded).toLocaleString("en-US")}
          </dd>
        </div>
        <div className="rounded-lg border border-ink-100 bg-white/60 px-3 py-2.5">
          <dt className={labelClass}>LAST CALL</dt>
          <dd className="mt-0.5 truncate font-code text-[13px] font-bold text-ink-950">
            {latest ? clockTime(latest.ts) : "—"}
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        {loading ? (
          <p className="flex items-center gap-2 py-8 font-code text-[10px] tracking-[0.06em] text-ink-600">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            READING THE TOOL LOG…
          </p>
        ) : unreachable && entries.length === 0 ? (
          <p className="py-8 font-code text-[10px] tracking-[0.06em] text-red-600">
            TOOL LOG UNREACHABLE — THE REVIEW SERVICE IS NOT ANSWERING. RETRY OR CHECK ITS STATUS ABOVE.
          </p>
        ) : entries.length === 0 ? (
          <p className="py-8 font-code text-[10px] tracking-[0.06em] text-ink-600">
            {searching ? `NO CALLS MATCH “${q.trim().toUpperCase()}”.` : "NO TOOL CALLS RECORDED YET — RUN A REVIEW OR ASK THE DESK ASSISTANT."}
          </p>
        ) : (
          <HorizontalScrollRegion label="MCP tool calls — scroll horizontally on small screens">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <caption className="sr-only">MCP tool calls, newest first</caption>
              <thead>
                <tr className="border-b border-ink-100">
                  <th scope="col" className="py-2 pr-3 font-code text-[10px] font-semibold tracking-[0.08em] text-ink-600">
                    TIME
                  </th>
                  <th scope="col" className="py-2 pr-3 font-code text-[10px] font-semibold tracking-[0.08em] text-ink-600">
                    TOOL
                  </th>
                  <th scope="col" className="py-2 pr-3 font-code text-[10px] font-semibold tracking-[0.08em] text-ink-600">
                    ACTOR
                  </th>
                  <th scope="col" className="hidden py-2 pr-3 font-code text-[10px] font-semibold tracking-[0.08em] text-ink-600 lg:table-cell">
                    KIND
                  </th>
                  <th scope="col" className="py-2 pr-3 font-code text-[10px] font-semibold tracking-[0.08em] text-ink-600">
                    STATUS
                  </th>
                  <th scope="col" className="py-2 pr-3 font-code text-[10px] font-semibold tracking-[0.08em] text-ink-600">
                    TIME
                  </th>
                  <th scope="col" className="py-2 font-code text-[10px] font-semibold tracking-[0.08em] text-ink-600">
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const open = expanded === e.id;
                  return (
                    <tr key={e.id} className="border-b border-ink-100/70 align-top">
                      <td className="py-2 pr-3 font-code text-[11px] tabular text-ink-600" title={fullStamp(e.ts)}>
                        {clockTime(e.ts)}
                      </td>
                      <td className="py-2 pr-3 font-code text-[11px] font-bold text-ink-950">{e.tool}</td>
                      <td className="py-2 pr-3 font-code text-[11px] text-ink-700">{e.actor}</td>
                      <td className="hidden py-2 pr-3 font-code text-[11px] text-ink-600 lg:table-cell">{kindLabel(e.kind)}</td>
                      <td className="py-2 pr-3">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2 py-0.5 font-code text-[9px] font-bold tracking-[0.06em]",
                            statusTone(e.status),
                          )}
                        >
                          {statusLabel(e.status).toUpperCase()}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-code text-[11px] tabular text-ink-600">
                        {e.durationMs}ms
                      </td>
                      <td className="py-2">
                        <button
                          type="button"
                          onClick={() => setExpanded(open ? null : e.id)}
                          aria-expanded={open}
                          aria-label={`${open ? "Hide" : "Show"} call payload for ${e.tool}`}
                          className="focus-brand grid h-6 w-6 place-items-center rounded-md text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-950"
                        >
                          {open ? (
                            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                        </button>
                        {open && (
                          <div className="mt-2 grid gap-2 pr-2 sm:grid-cols-2">
                            <div className="rounded-lg border border-ink-100 bg-ink-50/60 px-3 py-2">
                              <p className={labelClass}>INPUTS</p>
                              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-code text-[10px] leading-relaxed text-ink-700">
                                {renderValue(e.inputs)}
                              </pre>
                            </div>
                            <div className="rounded-lg border border-ink-100 bg-ink-50/60 px-3 py-2">
                              <p className={labelClass}>OUTPUTS</p>
                              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-code text-[10px] leading-relaxed text-ink-700">
                                {renderValue(e.outputs)}
                              </pre>
                            </div>
                            <p className="font-code text-[9px] tracking-[0.06em] text-ink-500 sm:col-span-2">
                              SEQ {e.seq} · {e.id}
                              {e.runId ? ` · RUN ${e.runId}` : ""}
                            </p>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </HorizontalScrollRegion>
        )}
      </div>

      <p className="mt-4 font-code text-[9.5px] tracking-[0.05em] text-ink-500">
        THE SIDE-CAR KEEPS THE LATEST 600 CALLS IN MEMORY; THE COMPLETE CHAIN (EVERY CALL, VERIFIED) IS THE ACTIVITY
        LOG. PAYLOADS ARE CAPPED SERVER-SIDE.
      </p>
    </section>
  );
}
