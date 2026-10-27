"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CirclePause, FileSearch, PenLine, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface LiveEntry {
  seq?: number;
  id?: string;
  ts?: string;
  tool?: string;
  kind?: string;
  runId?: string;
  status?: string;
  durationMs?: number;
}

type RowKind = "read" | "write" | "gate";

/* One row per audit-log entry from the quorum-mcp sidecar — nothing scripted.
   The kind chip mirrors the store's own taxonomy: READS / WRITES / the gate. */
function rowKind(e: LiveEntry): RowKind {
  if (e.status === "PENDING_GATE" || e.kind === "GATE_DECISION" || e.kind === "GATE") return "gate";
  if (e.kind === "WRITES") return "write";
  return "read";
}

function KindChip({ kind }: { kind: RowKind }) {
  const Icon = kind === "read" ? FileSearch : kind === "write" ? PenLine : CirclePause;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 font-code text-[8.5px] font-bold uppercase tracking-[0.14em]",
        kind === "read" && "border-white/10 bg-white/[0.05] text-ink-300",
        kind === "write" && "border-brand-500/25 bg-brand-500/10 text-brand-400",
        kind === "gate" && "border-brand-500/40 bg-brand-600/20 text-brand-300"
      )}
    >
      <Icon className="h-2.5 w-2.5" aria-hidden="true" />
      {kind}
    </span>
  );
}

/** Live view of the quorum-mcp audit log. Refreshes on its own; REFRESH forces it. */
export function AgentRun() {
  const [entries, setEntries] = useState<LiveEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const res = await fetch("/api/log?limit=14&XTransformPort=3031");
        const j = (await res.json()) as { entries?: LiveEntry[]; total?: number };
        if (!alive) return;
        setEntries(j.entries ?? []);
        setTotal(j.total ?? j.entries?.length ?? 0);
      } catch {
        /* sidecar briefly down — keep the last snapshot */
      }
    };
    void pull();
    const id = setInterval(() => void pull(), 3500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [refreshKey]);

  const begin = useCallback(() => setRefreshKey((n) => n + 1), []);

  /* oldest-first so the run reads top to bottom */
  const rows = useMemo(() => [...entries].reverse(), [entries]);
  const atGate = rows.filter((e) => e.status === "PENDING_GATE").length;
  const runId = rows.find((e) => e.runId)?.runId;
  const runTag = runId ? `RUN ${runId.replace(/^[^_]*_/, "").toUpperCase()}` : "RUN LIVE";
  const maxMs = Math.max(1, ...rows.map((e) => e.durationMs ?? 0));

  return (
    <div
      ref={rootRef}
      className="relative overflow-hidden rounded-3xl border border-white/10 bg-night-2 shadow-[0_32px_80px_rgba(11,12,15,0.4)]"
      role="img"
      aria-label="Live terminal of logged quorum-mcp tool calls, with a stop at any human gate"
    >
      {/* Scanline sweep — one thin light crossing the panel on a slow loop */}
      {!reduce && (
        <span
          aria-hidden="true"
          className="animate-scanline pointer-events-none absolute inset-x-6 top-0 z-10 h-px opacity-40"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(232,56,42,0.7), transparent)",
          }}
        />
      )}

      {/* Chrome */}
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-ink-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-ink-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />
          </span>
          <span className="flex items-center gap-2 font-code text-[10.5px] font-semibold tracking-[0.16em] text-ink-200">
            <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
            quorum-agent
          </span>
          <span className="hidden rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-code text-[9px] tracking-[0.14em] text-ink-400 sm:inline-block">
            {runTag}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden font-code text-[9px] tracking-[0.22em] text-ink-600 sm:block">
            MCP · AUDIT · LIVE
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-500/50 bg-brand-600/15 px-2 py-0.5 font-code text-[9px] font-bold tracking-[0.18em] text-brand-300">
            <span className="animate-pulse-dot h-1.5 w-1.5 rounded-full bg-brand-400" aria-hidden="true" />
            LIVE
          </span>
        </div>
      </div>

      {/* Rows */}
      <div className="min-h-[368px] space-y-[7px] px-5 py-5 sm:min-h-[356px] sm:px-6">
        {rows.length === 0 && (
          <p className="font-code text-[11.5px] text-ink-500">
            NO TOOL CALLS LOGGED YET — START A RUN TO SEE ACTIVITY
          </p>
        )}
        {rows.map((e, i) => {
          const kind = rowKind(e);
          const ms = e.durationMs ?? 0;
          /* sqrt scale — long reads read as long bars without flattening 0ms rows */
          const bar = Math.min(100, Math.round((Math.sqrt(ms) / Math.sqrt(maxMs)) * 100));
          return (
            <motion.div
              key={e.id ?? `${e.seq}-${i}`}
              initial={reduce ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              {kind === "gate" ? (
                <p className="animate-gate-breathe flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border-l-2 border-brand-500 bg-brand-600/10 px-3 py-2 font-code text-[11.5px] leading-relaxed sm:text-[12.5px]">
                  <span className="tabular text-ink-600">{e.seq}</span>
                  <span className="tabular text-ink-600">
                    {e.ts ? new Date(e.ts).toLocaleTimeString("en-GB", { hour12: false }) : "--:--:--"}
                  </span>
                  <KindChip kind="gate" />
                  <span className="font-semibold text-brand-300">{e.tool ?? "tool"}</span>
                  <CirclePause className="h-3.5 w-3.5 shrink-0 text-brand-300" aria-hidden="true" />
                  <span className="text-brand-300">held for a named approver</span>
                </p>
              ) : (
                <p className="flex items-center gap-x-2 gap-y-1 font-code text-[11.5px] leading-relaxed sm:text-[12.5px]">
                  <span className="tabular w-7 shrink-0 text-right text-ink-600">{e.seq}</span>
                  <span className="tabular hidden shrink-0 text-ink-600 sm:inline">
                    {e.ts ? new Date(e.ts).toLocaleTimeString("en-GB", { hour12: false }) : "--:--:--"}
                  </span>
                  <KindChip kind={kind} />
                  <span className="truncate font-semibold text-brand-400">{e.tool ?? "tool"}</span>
                  <span className="shrink-0 text-ink-500">
                    {e.status || "logged"} · {ms}ms
                  </span>
                  <span className="ml-auto hidden h-[3px] w-16 shrink-0 overflow-hidden rounded-full bg-white/[0.06] md:block" aria-hidden="true">
                    <span
                      className={cn(
                        "block h-full rounded-full",
                        kind === "write" ? "bg-brand-500" : "bg-brand-500/50"
                      )}
                      style={{ width: `${Math.max(bar, 6)}%` }}
                    />
                  </span>
                </p>
              )}
            </motion.div>
          );
        })}
        {/* The waiting prompt */}
        <p className="flex items-center gap-2 pt-1.5 font-code text-[12px] text-brand-400" aria-hidden="true">
          <span>$</span>
          <span className="animate-caret-blink inline-block h-3.5 w-[7px] bg-brand-400/90" />
        </p>
      </div>

      {/* Status bar — the counts the terminal is held to */}
      <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-white/[0.03] px-5 py-3 sm:px-6">
        <p className="font-code text-[9.5px] tracking-[0.16em] text-ink-500">
          <span className="tabular text-ink-300">{total}</span> CALLS LOGGED
          <span className="mx-1.5 text-ink-700">/</span>
          <span className="tabular text-brand-400">{atGate}</span> AT THE GATE
        </p>
        <button
          type="button"
          onClick={begin}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 font-code text-[10px] font-semibold tracking-[0.14em] text-ink-200 transition-colors hover:border-brand-500 hover:text-white"
        >
          <RotateCcw className="h-3 w-3" aria-hidden="true" />
          REFRESH
        </button>
      </div>
    </div>
  );
}
