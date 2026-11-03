"use client";

import { Activity, Scale, Stethoscope } from "lucide-react";
import { Reveal, SpecBar } from "@/components/quorum/reveal";
import { Aurora, Spotlight, TiltCard } from "@/components/quorum/motion-kit";

/**
 * The product's initial focus: public health and medical supply tenders.
 */

const CHECKS = [
  {
    icon: Stethoscope,
    no: "01",
    title: "Technical requirements and clinical suitability",
    body: "Compare submitted specifications with the tender requirements and approved clinical references. Reviewers can trace each concern to its source.",
  },
  {
    icon: Activity,
    no: "02",
    title: "Quantities and demand",
    body: "Review order quantities against available consumption and stock information for delivery facilities, then flag discrepancies for officer review.",
  },
  {
    icon: Scale,
    no: "03",
    title: "Prices and market context",
    body: "Compare quoted prices with recorded public awards and other approved reference data. Officers decide whether a variance needs further review.",
  },
];

export function UseCases() {
  return (
    <section id="use-cases" className="relative scroll-mt-20 overflow-hidden bg-paper">
      <Aurora tone="soft" className="-left-48 top-1/3 h-[460px] w-[460px] opacity-80" />
      <div className="relative mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Reveal>
              <SpecBar index="04" label="Health procurement" meta="Evidence-led review checks" />
            </Reveal>
            <Reveal delay={0.06}>
              <h2 className="type-display mt-6 max-w-2xl text-[34px] text-ink-950 sm:text-[44px]">
                Review checks for health commodity tenders.
              </h2>
            </Reveal>
          </div>
          <Reveal delay={0.12}>
            <p className="max-w-sm text-[15px] leading-relaxed text-ink-500">
              Medicines, devices and essential supplies require careful review across technical
              requirements, supplier documents, demand and price.
            </p>
          </Reveal>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CHECKS.map((check, i) => (
            <Reveal key={check.no} delay={0.08 * i} className="h-full">
              <TiltCard max={5} className="group h-full rounded-[16px]">
              <Spotlight className="h-full rounded-[16px]">
              <article className="group flex h-full flex-col rounded-[16px] border border-ink-100 bg-white p-6 transition-all duration-300 hover:-translate-y-1 hover:border-brand-300 hover:shadow-[0_20px_44px_rgba(11,12,15,0.10)]">
                <div className="flex items-center justify-between">
                  <span className="grid h-12 w-12 place-items-center rounded-[10px] bg-brand-50 ring-1 ring-brand-200 transition-colors group-hover:bg-brand-600">
                    <check.icon
                      className="h-5.5 w-5.5 text-brand-600 transition-colors group-hover:text-white"
                      aria-hidden="true"
                    />
                  </span>
                  <span className="font-code text-[10px] font-semibold text-ink-300 tabular">
                    CHECK {check.no}
                  </span>
                </div>
                <h3 className="mt-6 font-display text-[21px] font-extrabold leading-snug tracking-[-0.01em] text-ink-950">
                  {check.title}
                </h3>
                <p className="mt-3 text-[14px] leading-relaxed text-ink-600">{check.body}</p>
              </article>
              </Spotlight>
              </TiltCard>
            </Reveal>
          ))}
        </div>

        {/* Keep the product scope clear and describe where the checks come from. */}
        <Reveal delay={0.1}>
          <div className="mt-10 rounded-[10px] border border-ink-100 bg-sand/60 px-5 py-4 sm:px-6">
            <p className="text-[13.5px] leading-relaxed text-ink-600">
              Review criteria can be configured to reflect the tender requirements, institutional
              policies and jurisdictional rules that apply to each procurement.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
