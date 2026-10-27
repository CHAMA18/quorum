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

/* ── terminal reveal engine ────────────────────────────────────────────────
   Rows type themselves in like a live console: metadata lands instantly,
   the tool name is typed character by character behind an inline caret, the
   status tail + duration bar pop in on completion, and the sequence pauses
   a beat before the gate row for drama. Replays on mount and REFRESH;
   appended poll rows continue the sequence instead of restarting it.
   honours prefers-reduced-motion by rendering the final state instantly. */
const CHAR_TICK_MS = 18; // per typing tick
const CHARS_PER_TICK = 3; // characters revealed per tick
const ROW_HOLD_MS = 90; // pause after a normal row lands
const GATE_HOLD_MS = 480; // dramatic pause before the gate row commits

function useCountUp(target: number, active: boolean, reduce: boolean | null) {
  const [value, setValue] = useState(() => (reduce || active ? target : 0));
  const fromRef = useRef(0);
  useEffect(() => {
    if (reduce) {
      setValue(target);
      fromRef.current = target;
      return;
    }
    if (!active) {
      setValue(0);
      fromRef.current = 0;
      return;
    }
    const from = fromRef.current;
    if (from === target) {
      setValue(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const dur = 750;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, reduce]);
  return value;
}

/** Live view of the quorum-mcp audit log. Refreshes on its own; REFRESH forces it. */
export function AgentRun() {
  const [entries, setEntries] = useState<LiveEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);

  /* reveal engine state */
  const [reveal, setReveal] = useState(0); // rows fully committed
  const [typing, setTyping] = useState(-1); // index currently typing
  const [chars, setChars] = useState(0); // chars typed in the active row
  const sigRef = useRef("");
  const forceReplayRef = useRef(false);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const res = await fetch("/api/log?limit=14&XTransformPort=3031");
        const j = (await res.json()) as { entries?: LiveEntry[]; total?: number };
        if (!alive) return;
        const next = j.entries ?? [];
        const sig = next.map((e) => e.id ?? e.seq).join(",");
        const force = forceReplayRef.current;
        if (sig !== sigRef.current || force) {
          const prefixStable =
            !force && sigRef.current !== "" && sig.startsWith(sigRef.current);
          const from = prefixStable ? reveal : 0;
          sigRef.current = sig;
          forceReplayRef.current = false;
          setEntries(next);
          setTotal(j.total ?? next.length ?? 0);
          if (reduce) {
            setReveal(next.length);
            setTyping(-1);
          } else {
            setReveal(Math.min(from, next.length));
            setTyping(-1);
            setChars(0);
          }
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, reduce]);

  const begin = useCallback(() => {
    forceReplayRef.current = true;
    setRefreshKey((n) => n + 1);
  }, []);

  /* oldest-first so the run reads top to bottom */
  const rows = useMemo(() => [...entries].reverse(), [entries]);
  const atGateCount = rows.filter((e) => e.status === "PENDING_GATE").length;
  const runId = rows.find((e) => e.runId)?.runId;
  const runTag = runId ? `RUN ${runId.replace(/^[^_]*_/, "").toUpperCase()}` : "RUN LIVE";
  const maxMs = Math.max(1, ...rows.map((e) => e.durationMs ?? 0));

  const done = reduce ? true : rows.length > 0 && reveal >= rows.length;

  /* sequence driver — whenever reveal advances, start typing the next row */
  useEffect(() => {
    if (reduce) return;
    if (reveal >= rows.length) {
      setTyping(-1);
      return;
    }
    setTyping(reveal);
    setChars(0);
  }, [reveal, rows.length, reduce]);

  /* character typer — drives the active row, then commits it after a hold */
  useEffect(() => {
    if (reduce || typing < 0) return;
    const row = rows[typing];
    if (!row) return;
    const text = row.tool ?? "tool";
    if (chars >= text.length) {
      const hold = rowKind(row) === "gate" ? GATE_HOLD_MS : ROW_HOLD_MS;
      const t = setTimeout(() => setReveal((r) => Math.max(r, typing + 1)), hold);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setChars((c) => c + CHARS_PER_TICK), CHAR_TICK_MS);
    return () => clearTimeout(t);
  }, [typing, chars, rows, reduce]);

  const shownTotal = useCountUp(total, done, reduce);
  const shownGate = useCountUp(atGateCount, done, reduce);

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
          if (!reduce && i > reveal && i !== typing) return null;
          const isTyping = !reduce && i === typing && !done;
          const kind = rowKind(e);
          const ms = e.durationMs ?? 0;
          /* sqrt scale — long reads read as long bars without flattening 0ms rows */
          const bar = Math.min(100, Math.round((Math.sqrt(ms) / Math.sqrt(maxMs)) * 100));
          const toolText = e.tool ?? "tool";
          const visibleTool = isTyping ? toolText.slice(0, chars) : toolText;
          const landed = !isTyping;
          return (
            <motion.div
              key={e.id ?? `${e.seq}-${i}`}
              initial={reduce ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              {kind === "gate" ? (
                <p
                  className={cn(
                    "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border-l-2 border-brand-500 bg-brand-600/10 px-3 py-2 font-code text-[11.5px] leading-relaxed sm:text-[12.5px]",
                    landed && "animate-gate-breathe"
                  )}
                >
                  <span className="tabular text-ink-600">{e.seq}</span>
                  <span className="tabular text-ink-600">
                    {e.ts ? new Date(e.ts).toLocaleTimeString("en-GB", { hour12: false }) : "--:--:--"}
                  </span>
                  <KindChip kind="gate" />
                  <span className="font-semibold text-brand-300">
                    {visibleTool}
                    {isTyping && (
                      <span className="animate-caret-blink ml-0.5 inline-block h-3 w-[6px] translate-y-[1px] bg-brand-300/90" />
                    )}
                  </span>
                  {landed && (
                    <motion.span
                      initial={reduce ? false : { opacity: 0, y: 2 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35 }}
                      className="inline-flex items-center gap-1.5"
                    >
                      <CirclePause className="h-3.5 w-3.5 shrink-0 text-brand-300" aria-hidden="true" />
                      <span className="text-brand-300">held for a named approver</span>
                    </motion.span>
                  )}
                </p>
              ) : (
                <p className="flex items-center gap-x-2 gap-y-1 font-code text-[11.5px] leading-relaxed sm:text-[12.5px]">
                  <span className="tabular w-7 shrink-0 text-right text-ink-600">{e.seq}</span>
                  <span className="tabular hidden shrink-0 text-ink-600 sm:inline">
                    {e.ts ? new Date(e.ts).toLocaleTimeString("en-GB", { hour12: false }) : "--:--:--"}
                  </span>
                  <KindChip kind={kind} />
                  <span className="truncate font-semibold text-brand-400">
                    {visibleTool}
                    {isTyping && (
                      <span className="animate-caret-blink ml-0.5 inline-block h-3 w-[6px] translate-y-[1px] bg-brand-400/90" />
                    )}
                  </span>
                  {landed && (
                    <>
                      <span className="shrink-0 text-ink-500">
                        {e.status || "logged"} · {ms}ms
                      </span>
                      <span
                        className="ml-auto hidden h-[3px] w-16 shrink-0 overflow-hidden rounded-full bg-white/[0.06] md:block"
                        aria-hidden="true"
                      >
                        <motion.span
                          initial={reduce ? false : { width: 0 }}
                          animate={{ width: `${Math.max(bar, 6)}%` }}
                          transition={{ duration: 0.45, ease: "easeOut" }}
                          className={cn(
                            "block h-full rounded-full",
                            kind === "write" ? "bg-brand-500" : "bg-brand-500/50"
                          )}
                        />
                      </span>
                    </>
                  )}
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
          <span className="tabular text-ink-300">{shownTotal}</span> CALLS LOGGED
          <span className="mx-1.5 text-ink-700">/</span>
          <span className="tabular text-brand-400">{shownGate}</span> AT THE GATE
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
