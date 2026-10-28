"use client";

import { useEffect, useState } from "react";
import { ArrowRight, CirclePause, FileText, PenLine } from "lucide-react";
import { Reveal, SpecBar } from "@/components/quorum/reveal";
import { cn } from "@/lib/utils";

type TabId = "report" | "flags" | "audit";

interface LiveFinding {
  id: string;
  rule: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  item: string;
  evidence: string;
  citation: string;
}

interface LiveRunModel {
  mode?: "llm" | "mixed" | "template";
  planSource?: "heuristic" | "llm" | null;
  planModel?: string | null;
  draftLlm?: number;
  draftTotal?: number;
  models?: string[];
  promptTokens?: number;
  completionTokens?: number;
}

interface LiveRun {
  id: string;
  tenderId: string;
  status: string;
  updatedAt: string;
  requirements: { id: string }[];
  findings: LiveFinding[];
  drafts: { id: string }[];
  model?: LiveRunModel;
}

interface LiveLogEntry {
  id: string;
  ts: string;
  tool: string;
  runId?: string;
  inputs: unknown;
  outputs: unknown;
  status: string;
}

const TICKS = [
  "Findings written in committee language, not model output",
  "Every claim carries the document, page and rows it came from",
  "Flags separated from clear items — nothing buried in prose",
  "The gate chip stays open until a human signs",
];

const SEVERITY_TONE = { HIGH: "red", MEDIUM: "amber", LOW: "green" } as const;

function short(value: unknown, max = 90): string {
  const s = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("en-GB", { hour12: false });
}

function SeverityChip({ severity, tag }: { severity: "red" | "amber" | "green"; tag: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-code text-[9px] font-bold uppercase tracking-[0.12em]",
        severity === "red" && "bg-brand-600/12 text-brand-700",
        severity === "amber" && "bg-amber-500/15 text-amber-700",
        severity === "green" && "bg-emerald-500/15 text-emerald-700"
      )}
    >
      {tag}
    </span>
  );
}

function Annotation({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute z-10 hidden select-none items-center gap-1.5 font-code text-[10px] font-semibold italic tracking-[0.06em] text-brand-600 xl:flex",
        className
      )}
      aria-hidden="true"
    >
      <PenLine className="h-3 w-3 -scale-x-100" />
      {children}
    </span>
  );
}

/**
 * The output — the sourced report Quorum hands to the committee, read live
 * from the latest run and the audit log on the quorum-mcp sidecar.
 */
export function ReportMock() {
  const [tab, setTab] = useState<TabId>("report");
  const [run, setRun] = useState<LiveRun | null>(null);
  const [log, setLog] = useState<LiveLogEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const [runsRes, logRes] = await Promise.all([
          fetch("/api/runs?XTransformPort=3031"),
          fetch("/api/log?limit=40&XTransformPort=3031"),
        ]);
        const runsJson = (await runsRes.json()) as { runs?: LiveRun[] };
        const logJson = (await logRes.json()) as { entries?: LiveLogEntry[] };
        if (!alive) return;
        const runs = runsJson.runs ?? [];
        /* Newest run that has produced findings; otherwise the newest run. */
        setRun(runs.find((r) => (r.findings?.length ?? 0) > 0) ?? runs[0] ?? null);
        setLog(logJson.entries ?? []);
      } catch {
        /* sidecar unreachable — keep the last snapshot */
      } finally {
        if (alive) setLoaded(true);
      }
    };
    void pull();
    const id = setInterval(() => void pull(), 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const findings = run?.findings ?? [];
  const flags = findings.filter((f) => f.severity === "HIGH");
  const auditRows = run ? log.filter((e) => e.runId === run.id).reverse() : [];

  const TABS: { id: TabId; label: string; count: number }[] = [
    { id: "report", label: "REPORT", count: findings.length },
    { id: "flags", label: "FLAGS", count: flags.length },
    { id: "audit", label: "AUDIT LOG", count: auditRows.length },
  ];

  return (
    <section id="report" className="scroll-mt-20 border-y border-ink-100 bg-sand/60">
      <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-14">
          {/* Copy */}
          <div className="min-w-0 lg:col-span-4">
            <Reveal>
              <SpecBar index="07" label="The output" meta="Every finding cited" />
            </Reveal>
            <Reveal delay={0.06}>
              <h2 className="type-display mt-6 text-[34px] text-ink-950 sm:text-[44px]">
                What lands in the committee pack.
              </h2>
            </Reveal>
            <Reveal delay={0.12}>
              <p className="mt-6 text-[16.5px] leading-relaxed text-ink-600">
                One document, three panes. The report the committee reads, the flag register it
                rules on, and the audit log that proves how every line got there.
              </p>
            </Reveal>
            <Reveal delay={0.18}>
              <ul className="mt-7 space-y-3.5">
                {TICKS.map((t) => (
                  <li key={t} className="flex items-start gap-3 text-[14.5px] font-medium text-ink-800">
                    <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true">
                      <path d="M2.5 8.5 6 12l7.5-8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {t}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal delay={0.24}>
              <a
                href="#inside"
                className="group mt-8 inline-flex items-center gap-2 text-[15px] font-semibold text-brand-700 transition-colors hover:text-brand-800"
              >
                See everything inside the run
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </a>
            </Reveal>
          </div>

          {/* Document sheet */}
          <Reveal delay={0.1} className="min-w-0 lg:col-span-8">
            <div className="relative rounded-[10px] border border-ink-200/70 bg-white shadow-[0_32px_80px_rgba(11,12,15,0.14)]">
              {/* Punched holes for the pack metaphor */}
              <div className="absolute left-3 top-0 hidden h-full flex-col justify-center gap-16 sm:flex" aria-hidden="true">
                <span className="h-3 w-3 rounded-full bg-sand ring-1 ring-ink-200" />
                <span className="h-3 w-3 rounded-full bg-sand ring-1 ring-ink-200" />
                <span className="h-3 w-3 rounded-full bg-sand ring-1 ring-ink-200" />
              </div>

              <div className="relative sm:pl-7">
                {/* Doc header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4 sm:px-7">
                  <p className="font-code text-[10px] font-bold tracking-[0.2em] text-ink-950">
                    {run ? `SOURCED REPORT · TENDER ${run.tenderId}` : "SOURCED REPORT"}
                  </p>
                  {run && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-300 bg-brand-50 px-3 py-1 font-code text-[9px] font-bold tracking-[0.14em] text-brand-700">
                      <CirclePause className="h-3 w-3" aria-hidden="true" />
                      {run.status === "AWAITING_GATE" ? "GATE: PENDING SIGN-OFF" : `STATUS: ${run.status}`}
                    </span>
                  )}
                </div>
                <p className="border-b border-ink-100 bg-paper px-5 py-2.5 font-code text-[9.5px] tracking-[0.14em] text-ink-400 sm:px-7">
                  {run
                    ? `${run.requirements?.length ?? 0} REQUIREMENTS · ${findings.length} FINDINGS · ${run.drafts?.length ?? 0} DRAFTS · MODEL ${(run.model?.models?.length ? run.model.models.join(", ") : "template").toUpperCase()} · EVERY CLAIM CITED`
                    : "NO RUN YET · EVERY CLAIM CITED"}
                </p>

                {/* Tabs */}
                <div role="tablist" aria-label="Report panes" className="flex gap-1 border-b border-ink-100 px-4 pt-3 sm:px-6">
                  {TABS.map((t) => {
                    const active = tab === t.id;
                    return (
                      <button
                        key={t.id}
                        role="tab"
                        id={`tab-${t.id}`}
                        aria-selected={active}
                        aria-controls={`pane-${t.id}`}
                        onClick={() => setTab(t.id)}
                        className={cn(
                          "relative -mb-px inline-flex items-center gap-1.5 rounded-t-lg px-3.5 py-2.5 font-code text-[10px] font-bold tracking-[0.16em] transition-colors",
                          active
                            ? "border border-b-white border-ink-100 bg-white text-ink-950"
                            : "border border-transparent text-ink-400 hover:text-ink-700"
                        )}
                      >
                        {t.label}
                        <span
                          className={cn(
                            "rounded px-1 py-0.5 text-[8.5px] tabular",
                            active ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-500"
                          )}
                        >
                          {t.count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Panes */}
                <div className="min-h-[352px] px-5 py-5 sm:px-7">
                  {!run && (
                    <p className="pt-10 text-center font-code text-[11px] tracking-[0.12em] text-ink-400">
                      {loaded
                        ? "NO REVIEW RUN YET — THE REPORT APPEARS HERE ONCE THE AGENT FILES A RUN."
                        : "LOADING FROM THE QUORUM AGENT…"}
                    </p>
                  )}

                  {run && tab === "report" && (
                    <div role="tabpanel" id="pane-report" aria-labelledby="tab-report" className="relative divide-y divide-ink-100">
                      <Annotation className="-right-2 top-1">every claim cited to a page</Annotation>
                      {findings.length === 0 && (
                        <p className="py-6 font-code text-[11px] text-ink-400">NO FINDINGS RAISED IN THIS RUN.</p>
                      )}
                      {findings.map((f) => (
                        <div key={f.id} className="relative flex flex-col gap-1.5 py-3.5 first:pt-1 last:pb-1 sm:flex-row sm:items-start sm:gap-3">
                          <SeverityChip severity={SEVERITY_TONE[f.severity]} tag={f.rule} />
                          <div className="min-w-0 flex-1">
                            <p className="text-[13.5px] font-medium leading-snug text-ink-800">
                              <span className="font-semibold text-ink-900">{f.item}</span> — {f.evidence}
                            </p>
                            <p className="mt-1.5 flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center gap-1.5 rounded border border-ink-200 bg-paper px-1.5 py-0.5 font-code text-[9.5px] tracking-[0.06em] text-ink-500">
                                <FileText className="h-2.5 w-2.5" aria-hidden="true" />
                                {f.citation}
                              </span>
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {run && tab === "flags" && (
                    <div role="tabpanel" id="pane-flags" aria-labelledby="tab-flags" className="relative space-y-3">
                      <Annotation className="-right-2 top-0">nothing buried in prose</Annotation>
                      {flags.length === 0 && (
                        <p className="py-6 font-code text-[11px] text-ink-400">NO HIGH-SEVERITY FLAGS IN THIS RUN.</p>
                      )}
                      {flags.map((f, i) => (
                        <div key={f.id} className="relative rounded-xl border border-ink-100 bg-paper p-4">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span className="font-code text-[10px] font-bold text-ink-400">FLAG-{String(i + 1).padStart(2, "0")}</span>
                            <span className="inline-flex items-center rounded bg-brand-600/12 px-1.5 py-0.5 font-code text-[9px] font-bold tracking-[0.12em] text-brand-700">
                              {f.rule}
                            </span>
                          </div>
                          <p className="mt-2 text-[13.5px] font-semibold text-ink-900">{f.item}</p>
                          <p className="mt-1 text-[12.5px] text-ink-500">{f.evidence}</p>
                        </div>
                      ))}
                      <p className="pt-1 font-code text-[9.5px] tracking-[0.14em] text-ink-400">
                        FLAGS ARE ADVICE — THE RULING BELONGS TO THE COMMITTEE.
                      </p>
                    </div>
                  )}

                  {run && tab === "audit" && (
                    <div role="tabpanel" id="pane-audit" aria-labelledby="tab-audit" className="relative space-y-1.5">
                      <Annotation className="-right-2 top-0">inputs, outputs, timestamps</Annotation>
                      {auditRows.length === 0 && (
                        <p className="py-6 font-code text-[11px] text-ink-400">NO TOOL CALLS LOGGED FOR THIS RUN YET.</p>
                      )}
                      {auditRows.map((a) => {
                        const paused = a.status === "PENDING_GATE";
                        return (
                          <p
                            key={a.id}
                            className={cn(
                              "flex flex-wrap items-baseline gap-x-3 font-code text-[10.5px] leading-relaxed sm:text-[11px]",
                              paused ? "rounded-lg border-l-2 border-brand-500 bg-brand-600/10 px-3 py-2" : "text-ink-600"
                            )}
                          >
                            <span className="tabular text-ink-400">{clock(a.ts)}</span>
                            <span className={cn("font-bold", paused ? "text-brand-700" : "text-brand-600")}>{a.tool}</span>
                            <span className={paused ? "text-brand-800" : "text-ink-500"}>
                              {paused ? "⏸ awaiting sign-off — committee chair" : `in: ${short(a.inputs)}  →  out: ${short(a.outputs)}`}
                            </span>
                          </p>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Doc footer */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-5 py-3 sm:px-7">
                  <p className="font-code text-[9px] tracking-[0.18em] text-ink-400">
                    {run ? `UPDATED ${clock(run.updatedAt)} · QUORUM` : "QUORUM"}
                  </p>
                  <p className="font-code text-[9px] tracking-[0.18em] text-brand-600">
                    THE COMMITTEE SIGNS — THE AGENT NEVER DOES
                  </p>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
