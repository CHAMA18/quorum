"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import { Reveal, SpecBar } from "@/components/quorum/reveal";
import { Aurora, Spotlight } from "@/components/quorum/motion-kit";
import { cn } from "@/lib/utils";

const TIERS = [
  {
    name: "INSTITUTIONAL",
    price: "Custom",
    per: "scoped to volume, deployment and support needs",
    blurb: "For public institutions adopting a shared review workflow across teams and committees.",
    features: [
      "Hosting and data-residency requirements agreed for your jurisdiction",
      "Integration planning for identity and public data sources",
      "Reviewer roles and committee approval rules",
      "Onboarding and training for procurement teams",
      "Support and service commitments set out in the proposal",
    ],
    cta: "Request a pilot",
    href: "#get-started",
    featured: false,
  },
];

/**
 * Institutional pricing is scoped to deployment and support requirements.
 */
export function Pricing() {
  const reduce = useReducedMotion();
  return (
    <section id="pricing" className="relative scroll-mt-20 overflow-hidden bg-paper">
      <Aurora tone="soft" slow className="-left-40 top-20 h-[460px] w-[460px] opacity-70" />
      <Aurora tone="soft" className="-right-40 bottom-0 h-[420px] w-[420px] opacity-70" />
      <div className="relative mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Reveal>
              <SpecBar index="09" label="Pricing" meta="Three tender reviews included at no cost" />
            </Reveal>
            <Reveal delay={0.06}>
              <h2 className="type-display mt-6 max-w-2xl text-[34px] text-ink-950 sm:text-[44px]">
                A pilot first. A tailored institutional plan when you are ready.
              </h2>
            </Reveal>
          </div>
          <Reveal delay={0.12}>
            <p className="max-w-sm text-[15px] leading-relaxed text-ink-500">
              Start with up to three tender reviews at no cost. Broader deployment is scoped to
              review volume, integrations, data-residency requirements and support.
            </p>
          </Reveal>
        </div>

        <div className="mt-14 grid items-stretch gap-6">
          {TIERS.map((tier, i) => (
            <Reveal key={tier.name} delay={0.08 * i} className="h-full">
              <Spotlight className="h-full rounded-[16px]">
              <article
                className={cn(
                  "relative flex h-full flex-col rounded-[16px] p-7 transition-all duration-500 hover:-translate-y-1 sm:p-8",
                  tier.featured
                    ? "border-2 border-brand-600 bg-white shadow-[0_28px_70px_rgba(217,38,22,0.18)] hover:shadow-[0_36px_80px_rgba(217,38,22,0.26)]"
                    : "border border-ink-100 bg-white shadow-[0_16px_40px_rgba(11,12,15,0.05)] hover:shadow-[0_24px_54px_rgba(11,12,15,0.10)]"
                )}
              >
                {tier.featured && (
                  <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-4 py-1.5 font-code text-[10px] font-bold tracking-[0.2em] text-white shadow-[0_8px_20px_rgba(217,38,22,0.35)]">
                    MOST RUN
                  </span>
                )}
                <p className="font-code text-[10px] font-bold tracking-[0.26em] text-ink-500">
                  {tier.name}
                </p>
                <p className="mt-4 font-display text-[40px] font-black leading-none tracking-tight text-ink-950">
                  {tier.price}
                  {tier.price !== "Custom" && (
                    <span className="ml-1 align-middle font-code text-[12px] font-semibold text-brand-600">
                      {tier.name === "COMMITTEE" ? "/MO" : ""}
                    </span>
                  )}
                </p>
                <p className="mt-2 font-code text-[10px] tracking-[0.14em] text-ink-400">
                  {tier.per.toUpperCase()}
                </p>
                <p className="mt-4 text-[14.5px] leading-relaxed text-ink-600">{tier.blurb}</p>

                <ul className="mt-6 space-y-3 border-t border-ink-100 pt-6">
                  {tier.features.map((f, fi) => (
                    <motion.li
                      key={f}
                      initial={reduce ? false : { opacity: 0, x: -10 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true, margin: "-40px" }}
                      transition={{ delay: 0.12 + 0.07 * fi, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                      className="flex items-start gap-3 text-[14px] font-medium text-ink-800">
                      <span
                        className={cn(
                          "mt-0.5 grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full",
                          tier.featured ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-600 ring-1 ring-brand-200"
                        )}
                      >
                        <Check className="h-2.5 w-2.5" strokeWidth={3.5} aria-hidden="true" />
                      </span>
                      {f}
                    </motion.li>
                  ))}
                </ul>

                <a
                  href={tier.href}
                  className={cn(
                    "group mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-full text-[14.5px] font-semibold transition-all",
                    tier.featured
                      ? "bg-brand-600 text-white shadow-[0_12px_28px_rgba(217,38,22,0.32)] hover:bg-brand-700"
                      : "border border-ink-200 bg-white text-ink-900 hover:border-ink-300 hover:shadow-md"
                  )}
                >
                  {tier.cta}
                  <ArrowRight
                    className="h-4 w-4 transition-transform group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </a>
              </article>
              </Spotlight>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
