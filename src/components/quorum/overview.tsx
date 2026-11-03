"use client";

import { ClipboardCheck, FileText, Landmark, SearchCheck, ShieldCheck } from "lucide-react";
import { Reveal, SpecBar } from "@/components/quorum/reveal";
import { Aurora } from "@/components/quorum/motion-kit";

const STEPS = [
  {
    icon: FileText,
    number: "01",
    title: "Assemble the procurement record",
    body: "Bring the published notice, bid documents and supporting records into one review.",
  },
  {
    icon: ClipboardCheck,
    number: "02",
    title: "Apply the agreed criteria",
    body: "Check eligibility, technical requirements, quantities and prices against the tender and approved references.",
  },
  {
    icon: SearchCheck,
    number: "03",
    title: "Verify each finding",
    body: "Open the cited source, confirm the evidence and record how the finding was handled.",
  },
  {
    icon: Landmark,
    number: "04",
    title: "Record the committee decision",
    body: "An authorised committee member records the decision and its rationale in the audit history.",
  },
];

export function Overview() {
  return (
    <section id="overview" className="relative scroll-mt-20 overflow-hidden border-y border-ink-100 bg-sand/60">
      <Aurora tone="soft" className="pointer-events-none -right-40 top-0 h-[480px] w-[480px] opacity-70" />
      <div className="relative mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="min-w-0 lg:col-span-4">
            <Reveal>
              <SpecBar index="02" label="Review workflow" meta="From notice to decision" />
            </Reveal>
            <Reveal delay={0.06}>
              <h2 className="type-display mt-6 text-[34px] text-ink-950 sm:text-[44px]">
                One clear process. A record at every step.
              </h2>
            </Reveal>
            <Reveal delay={0.12}>
              <p className="mt-6 text-[16.5px] leading-relaxed text-ink-600">
                Quorum organizes the evidence and applies your review criteria consistently. Officers
                verify the findings, and the committee retains authority over the award.
              </p>
            </Reveal>
            <Reveal delay={0.18}>
              <div className="mt-8 flex items-start gap-4 rounded-[10px] border border-brand-200 bg-white p-5 shadow-sm">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 ring-1 ring-brand-200">
                  <ShieldCheck className="h-5 w-5 text-brand-600" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-code text-[10px] font-semibold tracking-[0.18em] text-brand-700">
                    ACCOUNTABILITY
                  </p>
                  <p className="mt-1 text-[14.5px] font-semibold leading-snug text-ink-900">
                    Every finding keeps its source and its disposition.
                  </p>
                </div>
              </div>
            </Reveal>
          </div>

          <div className="min-w-0 lg:col-span-8">
            <Reveal delay={0.08}>
              <div className="rounded-[16px] border border-ink-100 bg-white p-5 shadow-[0_24px_60px_rgba(11,12,15,0.08)] sm:p-8">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 pb-5">
                  <div>
                    <p className="font-code text-[10px] font-semibold tracking-[0.2em] text-brand-700">
                      THE REVIEW RECORD
                    </p>
                    <p className="mt-1 text-[14px] font-semibold text-ink-900">
                      Four steps from source material to accountable decision
                    </p>
                  </div>
                  <span className="rounded-full border border-ink-100 bg-paper px-3 py-1.5 font-code text-[10px] font-semibold tracking-[0.1em] text-ink-500">
                    OFFICER VERIFIED
                  </span>
                </div>

                <ol className="mt-5 grid gap-3 sm:grid-cols-2">
                  {STEPS.map((step) => (
                    <li key={step.number} className="h-full">
                      <article className="flex h-full gap-4 rounded-xl border border-ink-100 bg-paper/70 p-4 sm:p-5">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-brand-700 ring-1 ring-ink-100">
                          <step.icon className="h-4.5 w-4.5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-code text-[10px] font-semibold tracking-[0.16em] text-brand-700">
                            STEP {step.number}
                          </p>
                          <h3 className="mt-1 text-[14px] font-semibold leading-snug text-ink-950">
                            {step.title}
                          </h3>
                          <p className="mt-2 text-[13px] leading-relaxed text-ink-600">
                            {step.body}
                          </p>
                        </div>
                      </article>
                    </li>
                  ))}
                </ol>

                <div className="mt-4 flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50/70 px-4 py-3.5">
                  <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" />
                  <p className="text-[13px] leading-relaxed text-brand-900">
                    <span className="font-semibold">Decision authority stays with the committee.</span>{" "}
                    Quorum prepares and records the review; authorised officials make the award decision.
                  </p>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
