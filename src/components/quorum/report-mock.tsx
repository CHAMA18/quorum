"use client";

import { useState } from "react";
import { FileSearch, FileText, Landmark, ListChecks, ShieldCheck } from "lucide-react";
import { Reveal, SpecBar } from "@/components/quorum/reveal";
import { nextRovingTabIndex } from "@/lib/a11y";
import { cn } from "@/lib/utils";

const PANES = [
  {
    id: "findings",
    label: "Findings",
    icon: FileSearch,
    eyebrow: "SOURCE-LINKED REVIEW",
    title: "A finding is connected to its source.",
    body: "Reviewers can open the source document and locate the page, clause or reference behind an observation.",
    detail: "Source document · page or clause",
  },
  {
    id: "dispositions",
    label: "Review notes",
    icon: ListChecks,
    eyebrow: "OFFICER DISPOSITION",
    title: "A reviewer records how each finding was handled.",
    body: "Confirm, amend or clear a finding, with a rationale tied to the tender criteria and supporting evidence.",
    detail: "Disposition · reviewer · rationale",
  },
  {
    id: "decisions",
    label: "Decision history",
    icon: Landmark,
    eyebrow: "COMMITTEE RECORD",
    title: "The committee decision stays with the review.",
    body: "An authorised committee member records the decision and its rationale in the procurement history.",
    detail: "Decision · authorised member · record",
  },
] as const;

type PaneId = (typeof PANES)[number]["id"];

export function ReportMock() {
  const [activePane, setActivePane] = useState<PaneId>(PANES[0].id);
  const activeIndex = PANES.findIndex((pane) => pane.id === activePane);
  const pane = PANES[activeIndex];

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const next = nextRovingTabIndex(event.key, activeIndex, PANES.length);
    if (next === null) return;
    event.preventDefault();
    setActivePane(PANES[next].id);
    requestAnimationFrame(() => document.getElementById(`report-preview-tab-${PANES[next].id}`)?.focus());
  };

  return (
    <section id="report" className="scroll-mt-20 border-y border-ink-100 bg-sand/60">
      <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="min-w-0 lg:col-span-4">
            <Reveal>
              <SpecBar index="07" label="Review output" meta="Illustrative record layout" />
            </Reveal>
            <Reveal delay={0.06}>
              <h2 className="type-display mt-6 text-[34px] text-ink-950 sm:text-[44px]">
                Evidence, findings and approvals in one record.
              </h2>
            </Reveal>
            <Reveal delay={0.12}>
              <p className="mt-6 text-[16.5px] leading-relaxed text-ink-600">
                Each review brings its source references, officer dispositions and committee decision
                together. The preview shows the record structure and contains no live tender or supplier data.
              </p>
            </Reveal>
            <Reveal delay={0.18}>
              <ul className="mt-7 space-y-3.5">
                {[
                  "Open a source reference from a finding",
                  "Record a reviewer’s disposition and rationale",
                  "Keep authorised decisions with the review history",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-[14.5px] font-medium text-ink-800">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          <Reveal delay={0.1} className="min-w-0 lg:col-span-8">
            <div className="relative overflow-hidden rounded-[10px] border border-ink-200/70 bg-white shadow-[0_32px_80px_rgba(11,12,15,0.14)]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4 sm:px-7">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
                    <FileText className="h-4.5 w-4.5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="font-code text-[10px] font-bold tracking-[0.16em] text-ink-950">
                      ILLUSTRATIVE REVIEW RECORD
                    </p>
                    <p className="mt-1 text-[12px] text-ink-500">Example structure · no live case data</p>
                  </div>
                </div>
                <span className="rounded-full border border-ink-200 bg-paper px-3 py-1.5 font-code text-[10px] font-semibold tracking-[0.1em] text-ink-500">
                  SAMPLE LAYOUT
                </span>
              </div>

              <div
                role="tablist"
                aria-label="Illustrative review record sections"
                onKeyDown={handleKeyDown}
                className="flex gap-1 border-b border-ink-100 px-4 pt-3 sm:px-6"
              >
                {PANES.map((item) => {
                  const selected = item.id === activePane;
                  return (
                    <button
                      key={item.id}
                      id={`report-preview-tab-${item.id}`}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls="report-preview-panel"
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setActivePane(item.id)}
                      className={cn(
                        "focus-brand relative -mb-px inline-flex min-h-11 items-center gap-2 rounded-t-lg px-3.5 py-2.5 text-[12px] font-semibold transition-colors",
                        selected
                          ? "border border-b-white border-ink-100 bg-white text-ink-950"
                          : "border border-transparent text-ink-500 hover:text-ink-800"
                      )}
                    >
                      <item.icon className="h-3.5 w-3.5" aria-hidden="true" />
                      {item.label}
                    </button>
                  );
                })}
              </div>

              <div
                role="tabpanel"
                id="report-preview-panel"
                aria-labelledby={`report-preview-tab-${pane.id}`}
                tabIndex={0}
                className="min-h-[280px] px-5 py-7 sm:px-7 sm:py-9"
              >
                <div className="flex items-start gap-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-ink-100 bg-paper text-brand-700">
                    <pane.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-code text-[10px] font-bold tracking-[0.16em] text-brand-700">
                      {pane.eyebrow}
                    </p>
                    <h3 className="mt-2 max-w-xl text-[19px] font-semibold leading-snug text-ink-950 sm:text-[22px]">
                      {pane.title}
                    </h3>
                    <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink-600">
                      {pane.body}
                    </p>
                  </div>
                </div>
                <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-100 bg-paper/80 px-4 py-3.5">
                  <span className="font-code text-[10px] font-semibold tracking-[0.1em] text-ink-700">
                    {pane.detail}
                  </span>
                  <span className="rounded-full border border-ink-200 bg-white px-2.5 py-1 font-code text-[9px] font-semibold tracking-[0.12em] text-ink-500">
                    EXAMPLE
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 bg-paper/60 px-5 py-3 sm:px-7">
                <p className="text-[11px] text-ink-500">Illustrative interface only</p>
                <p className="font-code text-[10px] font-semibold tracking-[0.1em] text-ink-600">
                  THE COMMITTEE RETAINS DECISION AUTHORITY
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
