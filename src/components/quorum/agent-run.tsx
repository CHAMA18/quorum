"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CirclePause, FileText, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

type Kind = "sys" | "tool" | "cite" | "agent" | "gate" | "done";

interface Line {
  kind: Kind;
  time?: string;
  label?: string;
  text: string;
}

interface LiveEntry {
  tool?: string;
  status?: string;
  durationMs?: number;
  ts?: string;
}

/* One row per audit-log entry from the quorum-mcp sidecar — nothing scripted. */
function toLine(e: LiveEntry): Line {
  const status = e.status ?? "";
  if (status === "PENDING_GATE") {
    return { kind: "gate", label: "human gate", text: `${e.tool ?? "tool"} — held for a named approver` };
  }
  return {
    kind: "tool",
    time: e.ts ? new Date(e.ts).toLocaleTimeString() : undefined,
    label: e.tool ?? "tool",
    text: `${status || "logged"} · ${e.durationMs ?? 0} ms`,
  };
}

function MonoChip({ children, tone = "dim" }: { children: React.ReactNode; tone?: "dim" | "red" | "solid" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-code text-[9px] font-semibold uppercase tracking-[0.14em]",
        tone === "dim" && "bg-white/[0.07] text-ink-400",
        tone === "red" && "bg-brand-600/20 text-brand-300",
        tone === "solid" && "bg-brand-600 text-white"
      )}
    >
      {children}
    </span>
  );
}

function LineRow({ line }: { line: Line }) {
  switch (line.kind) {
    case "sys":
      return (
        <p className="font-code text-[11.5px] leading-relaxed text-ink-400 sm:text-[12.5px]">
          <span className="mr-2 text-brand-400">$</span>
          {line.text}
        </p>
      );
    case "tool":
    case "agent":
      return (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-code text-[11.5px] leading-relaxed sm:text-[12.5px]">
          <span className="tabular text-ink-600">{line.time}</span>
          <MonoChip tone={line.kind === "agent" ? "solid" : "dim"}>{line.kind === "agent" ? "agent" : "tool"}</MonoChip>
          <span className="font-semibold text-brand-400">{line.label}</span>
          <span className="text-ink-200">{line.text}</span>
        </p>
      );
    case "cite":
      return (
        <p className="flex items-center gap-2 pl-2 font-code text-[10.5px] leading-relaxed text-ink-500 sm:pl-7 sm:text-[11px]">
          <FileText className="h-3 w-3 shrink-0 text-ink-600" aria-hidden="true" />
          <span className="tracking-[0.1em]">SRC</span>
          <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-ink-300">{line.text}</span>
        </p>
      );
    case "gate":
      return (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border-l-2 border-brand-500 bg-brand-600/10 px-3 py-2 font-code text-[11.5px] leading-relaxed sm:text-[12.5px]">
          <span className="tabular text-ink-600">{line.time}</span>
          <MonoChip tone="red">{line.label}</MonoChip>
          <CirclePause className="h-3.5 w-3.5 shrink-0 text-brand-300" aria-hidden="true" />
          <span className="text-brand-100">{line.text}</span>
        </p>
      );
    case "done":
      return (
        <p className="flex items-center gap-2 border-t border-white/10 pt-3 font-code text-[11.5px] font-semibold leading-relaxed text-white sm:text-[12.5px]">
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true">
            <path d="M2.5 8.5 6 12l7.5-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {line.text}
        </p>
      );
  }
}

/** Live view of the quorum-mcp audit log. Refreshes on its own; RE-RUN forces a refresh. */
export function AgentRun() {
  const [lines, setLines] = useState<Line[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const step = lines.length;

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const res = await fetch("/api/log?limit=12&XTransformPort=3031");
        const j = (await res.json()) as { entries?: LiveEntry[] };
        if (!alive) return;
        /* The log is newest-first; show oldest-first so the run reads top to bottom. */
        setLines((j.entries ?? []).slice(0, 12).reverse().map(toLine));
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

  return (
    <div
      ref={rootRef}
      className="relative overflow-hidden rounded-3xl border border-white/10 bg-night-2 shadow-[0_32px_80px_rgba(11,12,15,0.35)]"
      role="img"
      aria-label="Live terminal of logged quorum-mcp tool calls, with a stop at any human gate"
    >
      {/* Chrome */}
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-ink-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-ink-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />
          </span>
          <span className="font-code text-[10.5px] font-semibold tracking-[0.16em] text-ink-400">quorum-agent — live</span>
        </div>
        <span className="hidden font-code text-[9px] tracking-[0.22em] text-ink-600 sm:block">MCP · LOGGED · LIVE</span>
      </div>

      {/* Lines */}
      <div className="min-h-[368px] space-y-2 px-5 py-5 sm:min-h-[356px] sm:px-6">
        {step === 0 && (
          <p className="font-code text-[11.5px] text-ink-500">NO TOOL CALLS LOGGED YET — START A RUN TO SEE ACTIVITY</p>
        )}
        {lines.map((line, i) => (
          <motion.div
            key={i}
            initial={reduce ? false : { opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <LineRow line={line} />
          </motion.div>
        ))}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-white/[0.03] px-5 py-3 sm:px-6">
        <p className="font-code text-[9.5px] tracking-[0.18em] text-ink-500">
          EVERY TOOL CALL LOGGED — INPUTS, OUTPUTS, TIMESTAMPS
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
