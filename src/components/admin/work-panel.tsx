"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ClipboardCheck,
  Download,
  ExternalLink,
  FileText,
  Search,
  Stamp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { systemReferenceLabel } from "@/lib/system-reference";
import type { AdminRun } from "@/lib/admin-types";
import {
  Button,
  Chip,
  CopyButton,
  Empty,
  fmtAgo,
  fmtNum,
  fmtStamp,
  inputCls,
  Panel,
  PanelHead,
  SectionHead,
  shortHash,
  type Tone,
} from "@/components/admin/kit";
import { StatusChip } from "@/components/admin/console";
import type { PanelProps } from "@/components/admin/types";

const FILTERS: { id: AdminRun["status"] | "ALL"; label: string }[] = [
  { id: "ALL", label: "ALL" },
  { id: "RUNNING", label: "IN PROGRESS" },
  { id: "AWAITING_GATE", label: "AWAITING APPROVAL" },
  { id: "REJECTED", label: "RETURNED" },
  { id: "FILED", label: "COMPLETE" },
  { id: "FAILED", label: "COULD NOT COMPLETE" },
];

function reviewStatusLabel(status: AdminRun["status"]): string {
  if (status === "RUNNING") return "In progress";
  if (status === "AWAITING_GATE") return "Awaiting approval";
  if (status === "REJECTED") return "Returned";
  if (status === "FILED") return "Complete";
  return "Could not complete";
}

function modeTone(mode: AdminRun["model"]["mode"]): Tone {
  if (mode === "llm") return "sky";
  if (mode === "mixed") return "amber";
  return "neutral";
}

export function WorkPanel({ data, query, setQuery, now, navigate }: PanelProps) {
  const [status, setStatus] = useState<AdminRun["status"] | "ALL">("ALL");
  const [open, setOpen] = useState<string | null>(data.desk.runs[0]?.id ?? null);

  const runs = data.desk.runs;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return runs.filter((run) => {
      if (status !== "ALL" && run.status !== status) return false;
      if (!needle) return true;
      return `${run.systemReference ?? ""} ${run.id} ${run.status} ${run.startedBy ?? ""} ${run.model.models?.join(" ") ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [runs, query, status]);

  const filed = runs.filter((run) => run.status === "FILED").length;
  const awaiting = runs.filter((run) => run.status === "AWAITING_GATE").length;
  const failed = runs.filter((run) => run.status === "FAILED").length;
  const findings = runs.reduce((sum, run) => sum + run.findings, 0);
  const drafts = runs.reduce((sum, run) => sum + run.drafts, 0);

  return (
    <div className="space-y-6">
      <SectionHead
        index="04"
        eyebrow="Tender reviews"
        title={
          <>
            Tender reviews <span className="text-brand-600">and findings.</span>
          </>
        }
        lede={
          <>
            The review service checks tender documents against the stated requirements, cites relevant sources and may
            suggest changes. An authorized officer reviews the results. Start a new review from the procurement
            workspace; this page keeps a read-only history.
          </>
        }
        actions={
          <a
            href="/#/dashboard"
            className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 py-2 font-code text-[10px] font-bold uppercase tracking-[0.08em] text-ink-700 transition-colors hover:border-ink-400 hover:text-ink-950 dark:border-white/12 dark:bg-white/[0.04] dark:text-ink-300 dark:hover:border-white/25 dark:hover:text-white"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            OPEN PROCUREMENT WORKSPACE
          </a>
        }
      />

      <div className="panel grid grid-cols-2 divide-x divide-y divide-ink-100 overflow-hidden rounded-2xl sm:grid-cols-4 dark:divide-white/8">
        {[
          { label: "Reviews", value: fmtNum(runs.length), note: `${fmtNum(findings)} cited findings` },
          { label: "Awaiting approval", value: fmtNum(awaiting), note: "requires an authorized officer" },
          { label: "Completed", value: fmtNum(filed), note: "saved with a verification receipt" },
          { label: "Drafts created", value: fmtNum(drafts), note: `${fmtNum(failed)} review${failed === 1 ? "" : "s"} failed` },
        ].map((stat) => (
          <div key={stat.label} className="px-4 py-3.5">
            <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">{stat.label}</p>
            <p className="mt-1.5 type-num text-[22px] text-ink-950">{stat.value}</p>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-600">{stat.note}</p>
          </div>
        ))}
      </div>

      <Panel>
        <PanelHead
          eyebrow="The register"
          title="Review history"
          description="Counts and results come from saved tender reviews. Draft attribution reflects the source that actually created the content."
          action={<Chip tone="neutral">{fmtNum(filtered.length)} shown</Chip>}
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-5 py-3 dark:border-white/8">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tender reference, review ID, officer or status…"
              aria-label="Search tender reviews"
              className={cn(inputCls, "w-full pl-8")}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by review status">
            {FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setStatus(filter.id)}
                aria-pressed={status === filter.id}
                className={cn(
                  "focus-brand inline-flex min-h-11 items-center rounded-lg border px-3 py-2 font-code text-[10px] font-bold uppercase tracking-[0.06em] transition-colors",
                  status === filter.id
                    ? "border-ink-950 bg-ink-950 text-white dark:border-white dark:bg-white dark:text-[#0b0c0f]"
                    : "border-ink-200 bg-white text-ink-500 hover:border-ink-400 dark:border-white/12 dark:bg-transparent dark:text-ink-400",
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <Empty
            title="No tender reviews found"
            body={
              runs.length === 0
                ? "No tender reviews have been started yet. Begin one from the procurement workspace."
                : "Clear the search or choose another status. Saved review history has not changed."
            }
          />
        ) : (
          <ul className="divide-y divide-ink-100 dark:divide-white/8">
            {filtered.map((run) => {
              const isOpen = open === run.id;
              const model = run.model;
              return (
                <li key={run.id}>
                  <div className="grid items-center gap-3 px-5 py-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,190px)_auto]">
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : run.id)}
                      aria-expanded={isOpen}
                      className="focus-brand flex min-w-0 items-start gap-3 text-left"
                    >
                      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-ink-200 bg-paper-2 text-ink-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-300">
                        <FileText className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate font-display text-[13.5px] font-black tracking-[-0.01em] text-ink-950">
                            {systemReferenceLabel(run.systemReference)}
                          </span>
                          <StatusChip status={run.status} label={reviewStatusLabel(run.status)} />
                        </span>
                        <span className="mt-0.5 block truncate text-[10.5px] text-ink-600">
                          {run.id} · {run.startedBy ?? "unattributed"} · started {fmtAgo(run.startedAt, now)}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-600">
                          <span>{fmtNum(run.requirements)} requirements</span>
                          <span>{fmtNum(run.findings)} findings</span>
                          <span>{fmtNum(run.drafts)} drafts</span>
                        </span>
                      </span>
                      <ChevronDown
                        className={cn("mt-1 h-3.5 w-3.5 shrink-0 text-ink-400 transition-transform", isOpen && "rotate-180")}
                        aria-hidden="true"
                      />
                    </button>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Chip tone={modeTone(model.mode)} dot>
                        {model.mode === "llm" ? "AI-ASSISTED" : model.mode === "mixed" ? "AI + RULES" : model.mode === "template" ? "STANDARD TEMPLATE" : "SOURCE NOT RECORDED"}
                      </Chip>
                      {model.models && model.models.length > 0 ? (
                        <span className="max-w-[150px] truncate text-[10.5px] text-ink-600" title={model.models.join(", ")}>
                          {model.models[0]}
                        </span>
                      ) : (
                        <span className="text-[10.5px] text-ink-600">rules-based</span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {run.gateId && (
                        <Button size="sm" onClick={() => navigate("gates", run.gateId ?? "")}>
                          <Stamp className="h-3 w-3" aria-hidden="true" /> APPROVAL
                        </Button>
                      )}
                      <a
                        href={`/api/runs/${encodeURIComponent(run.id)}/report?XTransformPort=3031`}
                        className="focus-brand inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 font-code text-[10px] font-bold uppercase tracking-[0.06em] text-ink-700 transition-colors hover:border-ink-400 hover:text-ink-950 dark:border-white/12 dark:bg-white/[0.04] dark:text-ink-200 dark:hover:border-white/25 dark:hover:text-white"
                      >
                        <Download className="h-3 w-3" aria-hidden="true" /> REPORT
                      </a>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-ink-100 bg-paper-2/50 px-5 py-4 dark:border-white/8 dark:bg-white/[0.02]">
                      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <div>
                          <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Plan</p>
                          <p className="mt-1 text-[11.5px] font-semibold text-ink-950">
                            {model.planSource === "llm" ? model.planModel ?? "AI-assisted review" : "rules-based document review"}
                          </p>
                          <p className="mt-0.5 text-[10px] text-ink-400">
                            {model.planSource === "llm" ? "the model decided this pack's depth" : "no model configured at plan time"}
                          </p>
                        </div>
                        <div>
                          <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Drafts</p>
                          <p className="mt-1 text-[11.5px] font-semibold text-ink-950">
                            {fmtNum(model.draftLlm ?? 0)} model · {fmtNum(model.draftTemplate ?? 0)} template
                          </p>
                          <p className="mt-0.5 text-[10px] text-ink-400">
                            {fmtNum(model.draftTotal ?? 0)} total · {fmtNum(model.redactions ?? 0)} redaction{(model.redactions ?? 0) === 1 ? "" : "s"} before hosted calls
                          </p>
                        </div>
                        <div>
                          <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">AI text processed</p>
                          <p className="mt-1 text-[11.5px] font-semibold text-ink-950 tabular">
                            {fmtNum(model.promptTokens ?? 0)} in · {fmtNum(model.completionTokens ?? 0)} out
                          </p>
                          <p className="mt-0.5 text-[10px] text-ink-400">recorded on the run, not estimated here</p>
                        </div>
                        <div>
                          <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Seal</p>
                          {run.seal ? (
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className="font-code text-[10px] tracking-[0.06em] text-ink-800">{shortHash(run.seal, 14)}</span>
                              <CopyButton value={run.seal} label="verification code" />
                            </div>
                          ) : (
                            <p className="mt-1 text-[11px] text-ink-400">Not filed — no award decision has been approved.</p>
                          )}
                          <p className="mt-0.5 text-[10px] text-ink-400">
                            {run.sealedBy ? `signed by ${run.sealedBy}` : "waiting on a named human"} ·{" "}
                            {run.decidedAt ? fmtStamp(run.decidedAt) : "no decision"}
                          </p>
                        </div>
                      </div>

                      {run.error && (
                        <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-[10.5px] leading-relaxed text-brand-900 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200">
                          <strong className="font-semibold">Review error:</strong> {run.error}
                        </div>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-200/70 pt-2.5 dark:border-white/8">
                        <ClipboardCheck className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
                        <p className="text-[10.5px] font-medium text-ink-600">
                          Last moved {fmtAgo(run.updatedAt, now)}
                        </p>
                        <CopyButton value={run.id} label="review ID" className="ml-auto" />
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="rounded-2xl border border-ink-200/80 bg-paper-2/60 px-5 py-3.5 dark:border-white/10 dark:bg-white/[0.02]">
        <p className="text-[10.5px] leading-relaxed text-ink-500">
          <strong className="font-semibold text-ink-700">This page is read-only.</strong> Start reviews, update findings
          and approve decisions in the procurement workspace, where access permissions are checked. This page shows
          the saved history and cannot change a review.
        </p>
      </div>
    </div>
  );
}
