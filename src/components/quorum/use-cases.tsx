"use client";

import { Activity, Banknote, Globe2, Scale, Stethoscope, Users } from "lucide-react";
import { Eyebrow, Reveal } from "@/components/quorum/reveal";
import { Aurora, Spotlight, TiltCard } from "@/components/quorum/motion-kit";

/**
 * The chosen theme — health & life sciences. One vertical, mastered:
 * the three checks every health commodity tender must survive, with the
 * remaining themes queued as the same workflow's next destinations.
 */

const CHECKS = [
  {
    icon: Stethoscope,
    no: "01",
    title: "Specs against clinical need",
    body: "Item specs checked against formularies, pharmacopoeia standards and regulator registrations — so the line item is what clinicians actually prescribe, not a supplier's rebrand of last year's catalogue.",
  },
  {
    icon: Activity,
    no: "02",
    title: "Quantities against real consumption",
    body: "Order sizes reconciled with consumption and stock levels at the facilities the goods are destined for — buying this year's caseload, not last year's budget line.",
  },
  {
    icon: Scale,
    no: "03",
    title: "Prices against other buyers",
    body: "Unit prices benchmarked against the same commodities bought by other public buyers on the same OCDS portals — the outlier is visible before the award, not in an audit two years later.",
  },
];

const NEXT_THEMES = [
  { icon: Banknote, label: "FINANCIAL SERVICES · VALUE FOR MONEY" },
  { icon: Globe2, label: "DIGITAL ECONOMY · OPEN CONTRACTING" },
  { icon: Users, label: "FUTURE OF WORK · INCLUSION & LOCAL ECONOMY" },
];

export function UseCases() {
  return (
    <section id="use-cases" className="relative scroll-mt-20 overflow-hidden bg-paper">
      <Aurora tone="soft" className="-left-48 top-1/3 h-[460px] w-[460px] opacity-80" />
      <div className="relative mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Reveal>
              <Eyebrow>The theme — health &amp; life sciences</Eyebrow>
            </Reveal>
            <Reveal delay={0.06}>
              <h2 className="mt-4 max-w-2xl font-display text-[34px] font-black leading-[1.06] tracking-[-0.025em] text-ink-950 sm:text-[44px]">
                Health commodity tenders. Checked against clinical reality.
              </h2>
            </Reveal>
          </div>
          <Reveal delay={0.12}>
            <p className="max-w-sm text-[15px] leading-relaxed text-ink-500">
              Medicines, devices and commodities are the largest, most error-prone lines of public
              health spending. One theme, mastered — depth beats breadth when the audit comes.
            </p>
          </Reveal>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CHECKS.map((check, i) => (
            <Reveal key={check.no} delay={0.08 * i} className="h-full">
              <TiltCard max={5} className="group h-full rounded-3xl">
              <Spotlight className="h-full rounded-3xl">
              <article className="group flex h-full flex-col rounded-3xl border border-ink-100 bg-white p-6 transition-all duration-300 hover:-translate-y-1 hover:border-brand-300 hover:shadow-[0_20px_44px_rgba(11,12,15,0.10)]">
                <div className="flex items-center justify-between">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 ring-1 ring-brand-200 transition-colors group-hover:bg-brand-600">
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

        {/* The same workflow, queued for the next themes */}
        <Reveal delay={0.1}>
          <div className="mt-10 flex flex-col gap-4 rounded-2xl border border-ink-100 bg-sand/60 px-5 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <p className="font-code text-[10px] font-semibold tracking-[0.24em] text-ink-500">
              ONE THEME SHIPS AT A TIME — THE SAME WORKFLOW, QUEUED NEXT
            </p>
            <ul className="flex flex-wrap gap-2.5" aria-label="Themes queued after health & life sciences">
              {NEXT_THEMES.map((theme) => (
                <li
                  key={theme.label}
                  className="inline-flex items-center gap-2 rounded-full border border-ink-100 bg-paper px-4 py-2 font-code text-[10px] font-semibold tracking-[0.12em] text-ink-600"
                >
                  <theme.icon className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" />
                  {theme.label}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
