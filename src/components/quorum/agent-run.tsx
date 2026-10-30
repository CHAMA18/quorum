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
  /* Draft and plan log rows carry the model that actually answered. The
     sidecar caps outputs to a JSON string; in-memory rows can be objects. */
  outputs?: { model?: unknown; source?: unknown } | string;
}

function outputObject(outputs: LiveEntry["outputs"]): { model?: unknown; source?: unknown } {
  if (!outputs) return {};
  if (typeof outputs !== "string") return outputs;
  try {
    const parsed = JSON.parse(outputs) as unknown;
    if (parsed && typeof parsed === "object") return parsed as { model?: unknown; source?: unknown };
  } catch {
    /* The sidecar caps long outputs, so a draft row can end mid-JSON. The
       attribution fields are written first; recover them from the prefix. */
  }
  const model = /"model"\s*:\s*"([^"]+)"/.exec(outputs)?.[1];
  const source = /"source"\s*:\s*"([^"]+)"/.exec(outputs)?.[1];
  return model || source ? { model, source } : {};
}

interface ModelStatus {
  configured?: boolean;
  mode?: string;
  model?: string | null;
  providerLabel?: string;
  endpoint?: string | null;
  lastCall?: { tool?: string; model?: string; source?: string | null; at?: string } | null;
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
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    if (reduce || !active) {
      // Idle states derive their display from `target` on render, so the
      // counter simply rewinds here instead of re-rendering to do it.
      fromRef.current = 0;
      return;
    }
    const from = fromRef.current;
    if (from === target) return;
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

  // Derived, never stored: motion-off and not-yet-run states read instantly,
  // which also keeps the effect free of synchronous setState.
  if (reduce || !active) return reduce ? target : 0;
  return value;
}

/** Live view of the quorum-mcp audit log. Refreshes on its own; REFRESH forces it. */
export function AgentRun() {
  const [entries, setEntries] = useState<LiveEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  /* Reveal engine state. The row currently typing is always the first
     uncommitted one, so it is derived from `reveal` rather than stored —
     no effect has to mirror one piece of state into another. */
  const [reveal, setReveal] = useState(0); // rows fully committed
  const [chars, setChars] = useState(0); // chars typed in the active row
  const sigRef = useRef("");
  const forceReplayRef = useRef(false);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const [res, statusRes] = await Promise.all([
          fetch("/api/public/summary"),
          fetch("/api/agent-status").catch(() => null),
        ]);
        const j = (await res.json()) as { activity?: LiveEntry[]; total?: number };
        const status = statusRes?.ok
          ? ((await statusRes.json()) as { health?: { model?: ModelStatus } })
          : null;
        if (!alive) return;
        if (status?.health?.model) setModelStatus(status.health.model);
        const next = j.activity ?? [];
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
          setReveal(reduce ? next.length : Math.min(from, next.length));
          if (!reduce) setChars(0);
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
  }, [refreshKey, reduce]);

  const begin = useCallback(() => {
    forceReplayRef.current = true;
    setRefreshKey((n) => n + 1);
  }, []);

  /* oldest-first so the run reads top to bottom */
  const rows = useMemo(() => [...entries].reverse(), [entries]);
  const atGateCount = rows.filter((e) => e.status === "PENDING_GATE").length;
  const modelCall = useMemo(
    () =>
      entries.find((e) => {
        if (e.tool !== "draft_redline" && e.tool !== "plan_review") return false;
        const out = outputObject(e.outputs);
        return (
          out.source === "llm" &&
          typeof out.model === "string" &&
          out.model.trim().length > 0
        );
      }),
    [entries],
  );
  const modelCallOutputs = modelCall ? outputObject(modelCall.outputs) : null;
  const lastCall = modelStatus?.lastCall;
  const answeredModel =
    typeof modelCallOutputs?.model === "string"
      ? modelCallOutputs.model
      : lastCall?.source === "llm" && lastCall.model
        ? lastCall.model
        : null;
  const modelLabel = answeredModel ?? modelStatus?.model ?? (modelStatus ? "template fallback" : "…");
  const modelDetail = answeredModel
    ? `Answered by ${modelStatus?.providerLabel ?? "the configured endpoint"}${modelCall?.tool ? ` · ${modelCall.tool}` : lastCall?.tool ? ` · ${lastCall.tool}` : ""}`
    : !modelStatus
      ? "Reading the configured drafting endpoint…"
      : modelStatus.configured
        ? `${modelStatus.providerLabel ?? "model"} is configured; no model-attributed call in the last 14 log rows`
        : "No model configured — deterministic template drafting";
  const runId = rows.find((e) => e.runId)?.runId;
  const runTag = runId ? `RUN ${runId.replace(/^[^_]*_/, "").toUpperCase()}` : "RUN LIVE";
  const maxMs = Math.max(1, ...rows.map((e) => e.durationMs ?? 0));

  const done = reduce ? true : rows.length > 0 && reveal >= rows.length;
  const progress = rows.length ? Math.min(100, (Math.max(reveal, 0) / rows.length) * 100) : 0;
  const typing = reduce || reveal >= rows.length ? -1 : reveal;

  /* character typer — drives the active row, then commits it after a hold;
     the commit also rewinds the caret for the next row in the same tick */
  useEffect(() => {
    if (reduce || typing < 0) return;
    const row = rows[typing];
    if (!row) return;
    const text = row.tool ?? "tool";
    if (chars >= text.length) {
      const hold = rowKind(row) === "gate" ? GATE_HOLD_MS : ROW_HOLD_MS;
      const t = setTimeout(() => {
        setChars(0);
        setReveal((r) => Math.max(r, typing + 1));
      }, hold);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setChars((c) => c + CHARS_PER_TICK), CHAR_TICK_MS);
    return () => clearTimeout(t);
  }, [typing, chars, rows, reduce]);

  /* The viewport behaves like a terminal tail: as each row commits, the log
     scrolls itself so the newest line — and the gate when it lands — is the
     one in view, while the lines above recede into the fade. */
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [reveal, typing, rows.length]);

  const shownTotal = useCountUp(total, done, reduce);
  const shownGate = useCountUp(atGateCount, done, reduce);

  return (
    <section
      ref={rootRef}
      aria-label="Live terminal of logged quorum-mcp tool calls, stopping at a human gate"
      className="relative overflow-hidden rounded-[16px] border border-white/10 bg-night-2 shadow-[0_2px_4px_rgba(0,0,0,0.5),0_44px_90px_-44px_rgba(0,0,0,0.9)]"
    >
      {/* Interior light: a vertical wash from the top edge so the panel reads
          as a physical console rather than a flat plate. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.045] via-transparent to-white/[0.015]"
      />
      <span aria-hidden="true" className="lit-top pointer-events-none absolute inset-x-0 top-0 h-px" />

      {/* Scanline sweep — one thin light crossing the panel on a slow loop */}
      {!reduce && (
        <span
          aria-hidden="true"
          className="animate-scanline pointer-events-none absolute inset-x-8 top-0 z-10 h-px opacity-40"
          style={{
            background: "linear-gradient(90deg, transparent, rgba(232,56,42,0.7), transparent)",
          }}
        />
      )}

      {/* Chrome */}
      <div className="relative flex items-center justify-between gap-3 border-b border-white/[0.09] px-5 py-3.5">
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
          <span
            className="hidden max-w-[210px] truncate font-code text-[9px] tracking-[0.18em] text-ink-400 sm:block"
            title={modelDetail}
          >
            MODEL · {modelLabel.toUpperCase()}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-500/50 bg-brand-600/15 px-2 py-0.5 font-code text-[9px] font-bold tracking-[0.18em] text-brand-300">
            <span className="animate-pulse-dot h-1.5 w-1.5 rounded-full bg-brand-400" aria-hidden="true" />
            LIVE
          </span>
        </div>
      </div>

      {/* Run rail — the sequence's own progress: it fills as the log types in,
          so the panel reports its state the way the rest of the product does. */}
      <div className="relative h-px w-full overflow-hidden bg-white/[0.07]" aria-hidden="true">
        <motion.span
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-brand-600 to-brand-400"
          initial={false}
          animate={{ width: `${progress}%` }}
          transition={{ duration: reduce ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>

      {/* Rows — a fixed-height viewport that scrolls itself like a terminal
          tail, so a long run never ends in a half-cropped line and the gate
          row is always the one you land on. */}
      <div className="relative" aria-hidden="true">
        <div
          ref={viewportRef}
          className="mask-tail h-[360px] overflow-hidden px-5 py-5 sm:h-[400px] sm:px-6 lg:h-[420px]"
        >
          {rows.length === 0 && (
            <p className="font-code text-[11.5px] text-ink-500">
              NO TOOL CALLS LOGGED YET — START A RUN TO SEE ACTIVITY
            </p>
          )}
          <div className="space-y-[7px]">
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
              const time = e.ts
                ? new Date(e.ts).toLocaleTimeString("en-GB", { hour12: false })
                : "--:--:--";
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
                        "flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-brand-500/25 border-l-2 border-l-brand-500 bg-brand-500/[0.07] px-3 py-2 font-code text-[11.5px] leading-relaxed sm:text-[12.5px]",
                        landed && "animate-gate-breathe"
                      )}
                    >
                      <span className="tabular text-ink-600">{e.seq}</span>
                      <span className="tabular hidden text-ink-600 sm:inline">{time}</span>
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
                    <p className="grid grid-cols-[1.75rem_auto_1fr_auto] items-center gap-x-2.5 font-code text-[11.5px] leading-relaxed transition-colors duration-200 hover:bg-white/[0.02] sm:grid-cols-[1.75rem_4.5rem_auto_1fr_auto] sm:text-[12.5px] md:grid-cols-[1.75rem_4.5rem_auto_1fr_auto_4.5rem]">
                      <span className="tabular text-right text-ink-600">{e.seq}</span>
                      <span className="tabular hidden text-ink-600 sm:inline">{time}</span>
                      <KindChip kind={kind} />
                      <span className="truncate font-semibold text-brand-400">
                        {visibleTool}
                        {isTyping && (
                          <span className="animate-caret-blink ml-0.5 inline-block h-3 w-[6px] translate-y-[1px] bg-brand-400/90" />
                        )}
                      </span>
                      {landed ? (
                        <span className="tabular shrink-0 text-ink-500">
                          {e.status || "logged"} · {ms}ms
                        </span>
                      ) : (
                        <span />
                      )}
                      {landed ? (
                        <span
                          className="hidden h-[3px] shrink-0 overflow-hidden rounded-full bg-white/[0.07] md:block"
                          aria-hidden="true"
                        >
                          <motion.span
                            initial={reduce ? false : { width: 0 }}
                            animate={{ width: `${Math.max(bar, 6)}%` }}
                            transition={{ duration: 0.45, ease: "easeOut" }}
                            className={cn(
                              "block h-full rounded-full",
                              kind === "write" ? "bg-brand-500" : "bg-brand-500/45"
                            )}
                          />
                        </span>
                      ) : (
                        <span className="hidden md:block" />
                      )}
                    </p>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* The prompt rides the fading tail rather than sitting under it —
            the live caret is always the last line of the log. */}
        <p className="pointer-events-none absolute bottom-3 left-5 flex items-center gap-2 font-code text-[12px] text-brand-400 sm:left-6">
          <span>$</span>
          <span className="animate-caret-blink inline-block h-3.5 w-[7px] bg-brand-400/90" />
        </p>
      </div>

      {/* Status bar — the counts the terminal is held to */}
      <div className="relative flex items-center justify-between gap-3 border-t border-white/[0.09] bg-white/[0.03] px-5 py-3 sm:px-6">
        <p className="font-code text-[9.5px] tracking-[0.16em] text-ink-500">
          <span className="tabular text-ink-200">{shownTotal}</span> CALLS LOGGED
          <span className="mx-1.5 text-ink-700">/</span>
          <span className="tabular text-brand-400">{shownGate}</span> AT THE GATE
        </p>
        <button
          type="button"
          onClick={begin}
          className="focus-brand inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 font-code text-[10px] font-semibold tracking-[0.14em] text-ink-200 transition-colors hover:border-brand-500 hover:bg-brand-500/10 hover:text-white"
        >
          <RotateCcw className="h-3 w-3" aria-hidden="true" />
          REFRESH
        </button>
      </div>
    </section>
  );
}
