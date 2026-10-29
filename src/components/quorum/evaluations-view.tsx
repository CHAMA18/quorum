"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Terminal,
  Search,
  ChevronDown,
  Clock,
  AlertTriangle,
  Check,
  Wifi,
  PanelLeftClose,
  Gavel,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { McRun } from "@/components/quorum/dashboard";

/* ── EvaluationsView ──────────────────────────────────────────────────────────
   The mission's working ledger: every evaluation the agent has touched, in one
   place, with the fewest possible decisions built into the reading. A desk
   officer should understand the state of the work in under five seconds and
   know exactly where to lean in when something needs attention.

   Design intent: dark-room precision. The list is authoritative, not dense —
   generous spacing, clear categorical buckets, and a single signal colour
   (the seal red) reserved for the things that need a named human. Everything
   else earns its place through clarity, not decoration.
*/

const FILTER_ALL = "ALL" as const;
const FILTER_IN_PROGRESS = "IN PROGRESS" as const;
const FILTER_NEEDS_APPROVAL = "NEEDS APPROVAL" as const;
const FILTER_COMPLETED = "COMPLETED" as const;

type Filter = typeof FILTER_ALL | typeof FILTER_IN_PROGRESS | typeof FILTER_NEEDS_APPROVAL | typeof FILTER_COMPLETED;

const FILTERS: { value: Filter; label: string }[] = [
  { value: FILTER_ALL, label: "ALL" },
  { value: FILTER_IN_PROGRESS, label: "IN PROGRESS" },
  { value: FILTER_NEEDS_APPROVAL, label: "NEEDS APPROVAL" },
  { value: FILTER_COMPLETED, label: "COMPLETED" },
];

/* ── Status text for chips ──────────────────────────────────────────────────── */

function statusLabel(status: McRun["status"]): string {
  switch (status) {
    case "running":
      return FILTER_IN_PROGRESS;
    case "gate":
      return FILTER_NEEDS_APPROVAL;
    case "complete":
      return FILTER_COMPLETED;
    case "queued":
      return FILTER_IN_PROGRESS;
    default:
      return FILTER_ALL;
  }
}

function filterForStatus(status: McRun["status"]): Filter {
  switch (status) {
    case "running":
    case "queued":
      return FILTER_IN_PROGRESS;
    case "gate":
      return FILTER_NEEDS_APPROVAL;
    case "complete":
      return FILTER_COMPLETED;
    default:
      return FILTER_ALL;
  }
}

/* ── Row card ──────────────────────────────────────────────────────────────────
   One evaluation, one row. The row is the unit of work: a human needs to read
   the tender reference, understand where it sits, and decide in one glance
   whether to open it. We lead with the reference (the system name), follow with
   the human name where the system has one, and only then surface the counts.
*/

function EvaluationRow({
  run,
  index,
}: {
  run: McRun;
  index: number;
}) {
  const status = run.status;
  const statusRank =
    status === "gate"
      ? 0
      : status === "running"
        ? 1
        : status === "complete"
          ? 2
          : 3;
  const isLive = status === "running";
  const isWaiting = status === "gate" || status === "queued";
  const isDecided = status === "complete";

  const columnId = `${run.id}`.slice(0, 14);
  const [expanded, setExpanded] = useState(false);
  const [audit, setAudit] = useState<{
    entries: { seq: number; ts: string; actor: string; tool: string; status: string; durationMs: number; inputs: unknown; outputs: unknown; self?: string; prev?: string }[];
    loading: boolean;
    error: string;
  }>({ entries: [], loading: false, error: "" });

  const toggleExpanded = async () => {
    const next = !expanded;
    setExpanded(next);
    if (!next || audit.entries.length > 0 || audit.loading) return;
    if (!run.uid) {
      setAudit({ entries: [], loading: false, error: "This evaluation has no backend run ID." });
      return;
    }
    setAudit((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await fetch(`/api/log?runId=${encodeURIComponent(run.uid)}&limit=100&XTransformPort=3031`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Audit request failed (HTTP ${response.status}).`);
      const data = await response.json() as { entries?: typeof audit.entries };
      setAudit({ entries: data.entries ?? [], loading: false, error: "" });
    } catch (error) {
      setAudit({ entries: [], loading: false, error: error instanceof Error ? error.message : "Could not load this evaluation's audit trail." });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, delay: 0.04 * index, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "group relative flex items-start gap-4 rounded-2xl border px-5 py-4 transition-all duration-200",
        isWaiting
          ? "border-brand-500/20 bg-brand-500/[0.03] shadow-[inset_0_0_0_1px_rgba(220,38,38,0.12)]"
          : isDecided
            ? "border-white/[0.06] bg-white/[0.02]"
            : "border-white/[0.06] bg-white/[0.015] hover:border-white/[0.12] hover:bg-white/[0.03]"
      )}
    >
      {/* Lefty — reference + human title */}
      <div className="flex flex-1 flex-col gap-1.5 min-w-0">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "font-code text-[11px] font-bold tracking-[0.14em] tabular",
              isWaiting && "text-brand-300",
              isDecided && "text-ink-300",
              !isWaiting && !isDecided && "text-white"
            )}
          >
            {run.id}
          </span
          >
          {isLive && (
            <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
            </span>
          )}
          {isWaiting && (
            <span className="shrink-0 rounded-full bg-brand-500/10 p-0.5" aria-hidden="true">
              <AlertTriangle className="h-3 w-3 text-brand-400" />
            </span>
          )}

          {/* Deterministic rank chip — stable per reference, readable at a glance */}
          <span
            className={cn(
              "shrink-0 rounded-full bg-white/5 px-1.5 py-0.5 font-code text-[9px] font-bold tracking-wider text-ink-400",
              statusRank < 2 && "text-ink-300"
            )}
          >
            {columnId}
          </span>

          {run.attempt && run.attempt > 1 && (
            <span className="shrink-0 rounded-full bg-white/5 px-1.5 py-0.5 font-code text-[9px] font-bold tracking-wider text-ink-300">
              Attempt {run.attempt}
            </span>
          )}
        </div>
        <p
          className={cn(
            "truncate text-[13px] leading-snug",
            isWaiting
              ? "text-white/90"
              : isDecided
                ? "text-ink-300"
                : "text-ink-400"
          )}
          title={run.title}
        >
          {run.title}
        </p>
        {run.buyer && (
          <p className="truncate text-[11px] leading-snug text-ink-500" title={run.buyer}>
            {run.buyer}
          </p>
        )}
      </div>

      {/* Mid — the counts that matter at a glance */}
      <div className="flex shrink-0 items-center gap-6 sm:gap-8">
        <div className="flex items-center gap-1.5" title="Bids received">
          <Check
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              run.bids ? "text-brand-400" : "text-ink-500"
            )}
            aria-hidden="true"
          />
          <span
            className={cn(
              "font-code text-[12px] font-bold tabular",
              run.bids ? "text-white/90" : "text-ink-400"
            )}
          >
            {run.bids ?? "—"}
          </span>
        </div>
        <div className="flex items-center gap-1.5" title="Findings raised">
          {run.findings > 0 ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 font-code text-[12px] font-bold tabular",
                isWaiting
                  ? "text-brand-400"
                  : run.findings > 2
                    ? "text-amber-400"
                    : "text-white/70"
              )}
            >
              <AlertTriangle
                className={cn(
                  "h-3 w-3 shrink-0",
                  isWaiting && "text-brand-400",
                  run.findings > 2 && !isWaiting && "text-amber-400"
                )}
                aria-hidden="true"
              />
              {run.findings}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-code text-[11px] text-ink-500">
              <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
              0
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5" title="Citations sourced">
          <Wifi
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              run.citations > 0 ? "text-white/60" : "text-ink-500"
            )}
            aria-hidden="true"
          />
          <span
            className={cn(
              "font-code text-[11px] font-bold tabular",
              run.citations > 0 ? "text-white/70" : "text-ink-400"
            )}
          >
            {run.citations}/{run.findings}
          </span>
        </div>
      </div>

      {/* Right — status + time + open affordance */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex flex-col items-end gap-1">
          <span
            className={cn(
              "font-code text-[11px] font-bold tabular",
              isWaiting
                ? "text-brand-400"
                : isLive
                  ? "text-white"
                  : isDecided
                    ? "text-ink-400"
                    : "text-ink-400"
            )}
          >
            {run.startedAt}
          </span>
          <span className="inline-flex items-center gap-1 font-code text-[9px] tracking-wider text-ink-500">
            <Clock className="h-2.5 w-2.5" aria-hidden="true" />
            opened
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* The status chip — the single source of truth for where this sits */}
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-code text-[9px] font-bold tracking-[0.14em] tabular",
              isWaiting
                ? "border-brand-500/30 bg-brand-500/10 text-brand-300 hover:bg-brand-500/15"
                : isLive
                  ? "border-brand-500/25 bg-brand-500/5 text-brand-300"
                  : isDecided
                    ? "border-white/10 bg-white/5 text-ink-300"
                    : "border-white/10 bg-white/5 text-ink-300"
            )}
          >
            {isWaiting && <Gavel className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />}
            {isLive && (
              <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
              </span>
            )}
            {isDecided && <Check className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />}
            {statusLabel(status)}
          </span>

          {/* Open affordance — chevron with a hover lift */}
          <button
            type="button"
            aria-label={expanded ? `Close ${run.id} details` : `Open ${run.id} details`}
            aria-expanded={expanded}
            onClick={() => void toggleExpanded()}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-ink-400 transition-colors hover:bg-white/5 hover:text-white",
              isWaiting && "text-brand-300 hover:text-brand-200"
            )}
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">Open</span>
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="basis-full border-t border-white/[0.08] pt-4" aria-label={`Details for ${run.id}`}>
          <div className="grid gap-5 xl:grid-cols-2">
            <section>
              <h3 className="font-code text-[10px] font-bold tracking-[0.16em] text-ink-400 uppercase">Findings · {run.findingDetails?.length ?? run.findings}</h3>
              {run.findingDetails?.length ? (
                <ul className="mt-3 space-y-2.5">
                  {run.findingDetails.map((finding) => (
                    <li key={finding.id} className="rounded-xl border border-white/[0.08] bg-black/15 p-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-code text-[10px] font-bold text-white">{finding.id} · {finding.rule}</span>
                        <span className={cn("rounded-full px-2 py-0.5 font-code text-[9px] font-bold", finding.severity === "HIGH" ? "bg-brand-500/15 text-brand-300" : finding.severity === "MEDIUM" ? "bg-amber-400/10 text-amber-300" : "bg-white/5 text-ink-300")}>{finding.severity}</span>
                        {finding.repaired ? <span className="font-code text-[9px] text-emerald-300">VERIFIED / REPAIRED</span> : null}
                      </div>
                      <p className="mt-2 text-[12px] font-semibold text-ink-100">{finding.item}</p>
                      {finding.evidence ? <blockquote className="mt-2 border-l-2 border-white/15 pl-3 text-[11px] leading-relaxed text-ink-300">{finding.evidence}</blockquote> : null}
                      <p className="mt-2 break-words font-code text-[10px] text-brand-300">{finding.citation || "No citation recorded"}</p>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-3 text-[12px] text-ink-400">{run.findings ? "Detailed findings are unavailable for this run." : "No findings were recorded."}</p>}
              {run.progress?.length ? (
                <details className="mt-3 rounded-xl border border-white/[0.08] bg-black/15 p-3">
                  <summary className="cursor-pointer font-code text-[9px] font-bold tracking-[0.12em] text-ink-300">REVIEW PROGRESS · {run.progress.length} STEPS</summary>
                  <ol className="mt-2 list-inside list-decimal space-y-1 text-[10px] leading-relaxed text-ink-400">
                    {run.progress.map((step, i) => <li key={`${i}-${step}`}>{step}</li>)}
                  </ol>
                </details>
              ) : null}
            </section>
            <section>
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-code text-[10px] font-bold tracking-[0.16em] text-ink-400 uppercase">Audit trail</h3>
                <span className="font-code text-[9px] text-ink-500">{audit.entries.length} entries</span>
              </div>
              {audit.loading ? <p className="mt-3 text-[11px] text-ink-400">Loading audit entries…</p> : null}
              {audit.error ? <p role="alert" className="mt-3 text-[11px] text-brand-300">{audit.error}</p> : null}
              {!audit.loading && !audit.error && audit.entries.length === 0 ? <p className="mt-3 text-[11px] text-ink-400">No audit calls are linked to this evaluation yet.</p> : null}
              <ol className="mt-3 max-h-[390px] space-y-2 overflow-y-auto">
                {audit.entries.map((entry) => (
                  <li key={entry.seq} className="rounded-lg border border-white/[0.07] bg-black/15 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-code text-[10px] font-bold text-white">#{entry.seq} · {entry.tool}</span>
                      <span className="font-code text-[9px] text-ink-400">{entry.status} · {entry.durationMs} ms</span>
                    </div>
                    <p className="mt-1 text-[10px] text-ink-500">{entry.actor} · {entry.ts ? new Date(entry.ts).toLocaleString() : "—"}</p>
                    <details className="mt-2">
                      <summary className="cursor-pointer font-code text-[9px] text-ink-400">INPUTS, OUTPUTS & HASH LINKS</summary>
                      <div className="mt-2 grid gap-2 lg:grid-cols-2">
                        <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all rounded bg-black/20 p-2 font-code text-[9px] text-ink-300">{JSON.stringify(entry.inputs, null, 2)}</pre>
                        <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all rounded bg-black/20 p-2 font-code text-[9px] text-ink-300">{JSON.stringify(entry.outputs, null, 2)}</pre>
                      </div>
                      <p className="mt-1 break-all font-code text-[8px] text-ink-500">SELF {entry.self ?? "—"} · PREV {entry.prev ?? "—"}</p>
                    </details>
                  </li>
                ))}
              </ol>
              {run.uid ? <a href={`/api/runs/${encodeURIComponent(run.uid)}/report?XTransformPort=3031`} className="mt-3 inline-flex text-[10px] font-bold tracking-[0.1em] text-brand-300 hover:text-white">DOWNLOAD SOURCED REPORT ↗</a> : null}
            </section>
          </div>
        </div>
      ) : null}

      {/* Row hover: a hairline that lifts off the wall */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-r from-transparent via-brand-500/[0.02] to-transparent transition-transform duration-300",
          isWaiting && "opacity-100",
          "group-hover:opacity-100"
        )}
      />
    </motion.div>
  );
}

/* ── Filter pills ──────────────────────────────────────────────────────────────
   Four buckets, one active at a time. The active pill is filled dark with
   white text — the others are hairline-bounded ghosts. Choosing a filter
   should feel immediate but not jarring; we fade the list in under the
   re-sort so the eye never loses its place.

   Intent: filters are a reading aid, not a control panel. Their labels are
   the same phrases the status chips use, so the two speak the same language.
*/

function FilterPills({
  active,
  onChange,
}: {
  active: Filter;
  onChange: (f: Filter) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter evaluations">
      {FILTERS.map((f) => (
        <button
          key={f.value}
          type="button"
          onClick={() => onChange(f.value)}
          aria-pressed={active === f.value}
          className={cn(
            "inline-flex items-center rounded-full border px-4 py-1.5 font-code text-[10px] font-bold tracking-[0.16em] uppercase transition-all duration-150",
            active === f.value
              ? "border-white/10 bg-ink-950/95 text-white shadow-[0_1px_2px_rgba(0,0,0,0.4)]"
              : "border-white/8 bg-transparent text-ink-400 hover:border-white/20 hover:text-white/80"
          )}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

/* ── Empty state ───────────────────────────────────────────────────────────────
   When a filter returns nothing, we say so plainly and remind the officer what
   each bucket means — a moment of orientation rather than a dead end.
*/

function EmptyState({ filter }: { filter: Filter }) {
  const message =
    filter === FILTER_ALL
      ? "No evaluations yet. Queue a run to see it here."
      : filter === FILTER_IN_PROGRESS
        ? "No evaluations in progress. Queue a new run or wait for the agent to pick one up."
        : filter === FILTER_NEEDS_APPROVAL
          ? "Nothing waiting for the committee right now. New decisions will appear here."
          : "No completed evaluations in this window.";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex h-32 flex-col items-center justify-center rounded-2xl border border-white/6 bg-white/[0.02]"
    >
      <Terminal className="h-8 w-8 text-ink-500" aria-hidden="true" />
      <p className="mt-3 font-code text-[11px] tracking-[0.04em] text-ink-500">
        {message}
      </p>
    </motion.div>
  );
}

/* ── Header chrome ─────────────────────────────────────────────────────────────
   Breadcrumb that reads as a path, not a label. The search field is the one
   place in this view where the officer is invited to type — it stays subtle
   until focused, then steps forward with the rest of the chrome.
*/

function PageHeader({ onNewRun }: { onNewRun: () => void }) {
  return (
    <>
      {/* FIG line — the editorial surface this whole page sits on */}
      <div className="flex items-center gap-3">
        <span className="h-px w-8 bg-gradient-to-r from-brand-500/60 to-transparent" aria-hidden="true" />
        <span className="font-code text-[10px] font-bold tracking-[0.22em] text-ink-400 uppercase">
          FIG. 05
        </span>
      </div>

      <h1 className="mt-2 flex items-baseline gap-3">
        <span className="font-display text-[30px] font-bold tracking-tight text-white">
          Evaluations
        </span>
        <span className="shrink-0 rounded-full bg-brand-500/15 p-1" aria-hidden="true">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
          </span>
        </span>
      </h1>

      <p className="mt-2.5 max-w-2xl text-[13px] leading-[1.7] text-ink-400">
        Every file the agent has opened — live, queued, at a gate, or decided.
        Expand an evaluation for its top findings and its audit trail.
      </p>

      {/* Two action cards — purpose-first, not decoration-first */}
      <div className="mt-9 grid gap-5 sm:grid-cols-2">
        <NewRunPrompt onNewRun={onNewRun} />
        <StandingRuleCard />
      </div>
    </>
  );
}

/* ── "Put the agent in a file" prompt card ─────────────────────────────────────
   The entry point into the work. The card does three things: says what happens
   when you use it, says why it matters, and gives the next action in a button
   that cannot be mistaken for anything else.

   Intent: one action, one sentence of context. The button is the loudest thing
   on the page because starting a run is the primary action this view exists to
   make easy.
*/

function NewRunPrompt({ onNewRun }: { onNewRun: () => void }) {
  return (
    <div className="group relative rounded-2xl bg-night-2 px-5 py-5 sm:px-6 sm:py-6">
      {/* Subtle grid + top hairline for a little depth without decoration */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 rounded-2xl bg-grid-night opacity-40"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-500/40 to-transparent"
      />

      <div className="relative">
        <h2 className="font-display text-[17px] font-bold tracking-tight text-white">
          Put the agent in a file
        </h2>
        <p className="mt-2.5 font-body text-[12.5px] leading-relaxed text-ink-400">
          Point Quorum at a tender — OCDS, a PDF pack, or the email bag.
          Findings appear here as the agent reads the file.
        </p>
        <button
          type="button"
          onClick={onNewRun}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-brand-500 px-5 py-2.5 text-[12px] font-bold tracking-[0.08em] text-brand-950 transition-colors hover:bg-brand-400 active:scale-[0.98]"
        >
          <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
          QUEUE A RUN
        </button>
      </div>
    </div>
  );
}

/* ── "The standing rule" card ──────────────────────────────────────────────────
   The one thing an officer must internalise: the agent prepares, the committee
   signs. This card is not firm copy — it is the constitution of the desk, stated
   once and stated plainly. The final line carries the red because it is the one
   sentence that must never be ambiguous.
*/

function StandingRuleCard() {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-5 py-5 sm:px-6 sm:py-6">
      <h2 className="font-display text-[17px] font-bold tracking-tight text-white">
        The standing rule
      </h2>
      <div className="mt-3 rounded-lg bg-ink-950/40 p-4">
        <p className="font-code text-[11px] font-bold tracking-[0.14em] text-white/60 uppercase">
          Quorum&apos;s place at the desk
        </p>
        <blockquote className="mt-3 space-y-1 text-[13px] leading-[1.85] text-ink-100">
          <p>
            <span className="text-ink-300">Quorum prepares the file.</span>
          </p>
          <p>
            <span className="text-ink-300">It never awards the tender.</span>
          </p>
          <p className="text-brand-300">
            The committee signs — the agent never does.
          </p>
        </blockquote>
      </div>
      <a
        href="/docs/rules"
        className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-ink-300 transition-colors hover:text-white"
      >
        Read the rules
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
      </a>
    </div>
  );
}

/* ─── Main view ──────────────────────────────────────────────────────────────── */
export function EvaluationsSubview({
  runs,
  envelope,
  reachable,
  onNewRun,
}: {
  runs: McRun[];
  envelope: {
    total: number;
    inProgress: number;
    needsApproval: number;
    completed: number;
    bids: number;
    findings: number;
    unsourced: number;
    citations: number;
  };
  reachable: boolean;
  onNewRun?: () => void;
}) {
  const effectiveOnNewRun = onNewRun ?? (() => {});
  const [filter, setFilter] = useState<Filter>(FILTER_ALL);

  const filtered = useMemo(() => {
    if (filter === FILTER_ALL) return runs;
    return runs.filter((r) => filterForStatus(r.status) === filter);
  }, [runs, filter]);

  const coverage = envelope.findings > 0
    ? Math.round((envelope.citations / envelope.findings) * 100)
    : 100;

  return (
    <section aria-labelledby="evaluations-heading">
      <PageHeader onNewRun={effectiveOnNewRun} />

      {/* The list chrome — a single column under a clear section label */}
      <div className="mt-10 flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 id="evaluations-heading" className="font-display text-[15px] font-bold tracking-tight text-white">
              Recent evaluations
            </h2>
            <p className="font-code text-[10px] tracking-[0.14em] text-ink-500 uppercase">
              Last 7 days · {runs.length} of {runs.length} evaluations
            </p>
          </div>

          {/* Reachability indicator — quiet, never alarming */}
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-code text-[9px] tracking-[0.14em]",
              reachable
                ? "border-brand-500/25 bg-brand-500/5 text-brand-300"
                : "border-ink-200 bg-white/5 text-ink-500"
            )}
          >
            {reachable ? (
              <>
                <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
                </span>
                live
              </>
            ) : (
              <>
                <span className="relative flex h-1.5 w-1.5 rounded-full bg-ink-400" aria-hidden="true" />
                syncing
              </>
            )}
          </span>
        </div>

        <FilterPills active={filter} onChange={setFilter} />

        {/* Reading summary — a single editorial strip, not floating cards */}
        <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-5 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 text-[11px]">
            <span className="flex items-center gap-1.5 font-code tracking-[0.14em] uppercase text-ink-500">
              <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
              </span>
              <span className="text-white/80">{envelope.inProgress} in progress</span>
            </span>
            <span className="flex items-center gap-1.5 font-code tracking-[0.14em] uppercase text-ink-500">
              <Gavel className="h-3 w-3 shrink-0 text-brand-400" aria-hidden="true" />
              <span className="text-brand-300">{envelope.needsApproval} at a gate</span>
            </span>
            <span className="flex items-center gap-1.5 font-code tracking-[0.14em] uppercase text-ink-500">
              <Check className="h-3 w-3 shrink-0 text-white/50" aria-hidden="true" />
              <span className="text-ink-300">{envelope.completed} decided</span>
            </span>
            <span className="flex items-center gap-1.5 font-code tracking-[0.14em] uppercase text-ink-500">
              <span className="text-ink-300">{envelope.citations}/{envelope.findings} sourced</span>
            </span>
            <span className={cn(
              "font-code tracking-[0.14em] uppercase",
              envelope.unsourced > 0 ? "text-brand-300" : "text-ink-500"
            )}>
              {envelope.unsourced > 0 ? `${envelope.unsourced} await a source` : "every finding sourced"}
            </span>
          </div>
        </div>

        <div className="mt-1 flex flex-col gap-2.5">
          <AnimatePresence mode="wait">
            {filtered.length === 0 ? (
              <EmptyState key="empty" filter={filter} />
            ) : (
              filtered.map((run, i) => (
                <EvaluationRow key={run.id} run={run} index={i} />
              ))
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
