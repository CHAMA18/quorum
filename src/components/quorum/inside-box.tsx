"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Workflow, ShieldCheck } from "lucide-react";
import { Eyebrow, Reveal } from "@/components/quorum/reveal";
import { Aurora, Spotlight } from "@/components/quorum/motion-kit";

const DOES = [
  {
    lead: "Reads the whole tender.",
    body: "Notices, line items and awards straight from OCDS portals — no scraping, no re-keying.",
  },
  {
    lead: "Runs tools that do real work.",
    body: "Document checklists, bidder verification, price comparison — logged MCP tools, not read-only wrappers.",
  },
  {
    lead: "Borrows what is proven.",
    body: "Community and official MCP servers where they beat hand-rolled code — and says so in the log.",
  },
  {
    lead: "Runs on open weights.",
    body: "Procurement data often cannot leave the country. Open-weights models by default; frontier alongside if you allow it.",
  },
  {
    lead: "Logs every action.",
    body: "Inputs, outputs, timestamps — and a named human gate on every irreversible step.",
  },
  {
    lead: "Stops before the award.",
    body: "The file is prepared; the decision stays with the committee. Always.",
  },
];

const GETS = [
  {
    lead: "A sourced report",
    body: "findings with citations down to the page — ready for the committee pack.",
  },
  {
    lead: "A flag register,",
    body: "missing documents, lapsed registrations, price outliers — each with its evidence attached.",
  },
  {
    lead: "A full audit log",
    body: "every tool call with inputs, outputs and timestamps. Exportable for auditors and oversight bodies.",
  },
  {
    lead: "A one-page architecture brief,",
    body: "which tools run, which models, and exactly where your data lives.",
  },
  {
    lead: "An eval harness",
    body: "eight-plus test tasks with pass and fail results — trust the run before you scale it.",
  },
];

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * Inside the run — what Quorum does on every run, and what you get out of it.
 */
export function InsideRun() {
  const reduce = useReducedMotion();
  return (
    <section id="inside" className="relative scroll-mt-20 overflow-hidden bg-paper">
      <Aurora tone="soft" slow className="-right-48 top-40 h-[500px] w-[500px] opacity-80" />
      <div className="relative mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Reveal>
              <Eyebrow>Inside the run</Eyebrow>
            </Reveal>
            <Reveal delay={0.06}>
              <h2 className="mt-4 max-w-2xl font-display text-[34px] font-black leading-[1.06] tracking-[-0.025em] text-ink-950 sm:text-[44px]">
                Every run, the same standard. By default.
              </h2>
            </Reveal>
          </div>
          <Reveal delay={0.12}>
            <p className="flex max-w-sm items-start gap-2.5 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3.5 text-[13.5px] font-semibold leading-snug text-brand-800">
              <ShieldCheck className="mt-0.5 h-4.5 w-4.5 shrink-0 text-brand-600" aria-hidden="true" />
              Nothing below is an enterprise upsell — it ships in every run.
            </p>
          </Reveal>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {/* What it does */}
          <Reveal className="h-full">
            <Spotlight className="h-full rounded-3xl">
              <article className="flex h-full flex-col rounded-3xl border border-ink-100 bg-white p-6 shadow-[0_20px_50px_rgba(11,12,15,0.06)] transition-shadow duration-300 hover:shadow-[0_28px_60px_rgba(11,12,15,0.10)] sm:p-8">
                <header className="flex items-center gap-4 border-b border-ink-100 pb-5">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-ink-950 transition-transform duration-500 group-hover:rotate-6">
                    <Workflow className="h-5.5 w-5.5 text-brand-400" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="font-code text-[10px] font-semibold tracking-[0.26em] text-ink-500">
                      LIST 01
                    </p>
                    <h3 className="font-display text-[22px] font-extrabold tracking-tight text-ink-950">
                      What Quorum does
                    </h3>
                  </div>
                  <span className="ml-auto font-code text-[11px] font-semibold text-ink-400 tabular">
                    6 ITEMS
                  </span>
                </header>
                <ol className="mt-2 divide-y divide-ink-100">
                  {DOES.map((item, i) => (
                    <motion.li
                      key={item.lead}
                      initial={reduce ? false : { opacity: 0, x: -18 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true, margin: "-40px" }}
                      transition={{ delay: 0.08 * i, duration: 0.6, ease: EASE }}
                      className="flex gap-4 py-4"
                    >
                      <span className="mt-0.5 grid h-7 w-9 shrink-0 place-items-center rounded-lg bg-sand font-code text-[11px] font-bold text-brand-700">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <p className="text-[14.5px] leading-relaxed text-ink-600">
                        <span className="font-semibold text-ink-950">{item.lead}</span>{" "}
                        {item.body}
                      </p>
                    </motion.li>
                  ))}
                </ol>
              </article>
            </Spotlight>
          </Reveal>

          {/* What you get */}
          <Reveal delay={0.1} className="h-full">
            <Spotlight className="h-full rounded-3xl">
              <article className="flex h-full flex-col rounded-3xl border border-ink-100 bg-white p-6 shadow-[0_20px_50px_rgba(11,12,15,0.06)] transition-shadow duration-300 hover:shadow-[0_28px_60px_rgba(217,38,22,0.14)] sm:p-8">
                <header className="flex items-center gap-4 border-b border-ink-100 pb-5">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-600 transition-transform duration-500 group-hover:-rotate-6">
                    <ShieldCheck className="h-5.5 w-5.5 text-white" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="font-code text-[10px] font-semibold tracking-[0.26em] text-ink-500">
                      LIST 02
                    </p>
                    <h3 className="font-display text-[22px] font-extrabold tracking-tight text-ink-950">
                      What you get
                    </h3>
                  </div>
                  <span className="ml-auto font-code text-[11px] font-semibold text-ink-400 tabular">
                    5 ITEMS
                  </span>
                </header>
                <ol className="mt-2 divide-y divide-ink-100">
                  {GETS.map((item, i) => (
                    <motion.li
                      key={item.lead}
                      initial={reduce ? false : { opacity: 0, x: 18 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true, margin: "-40px" }}
                      transition={{ delay: 0.08 * i, duration: 0.6, ease: EASE }}
                      className="flex gap-4 py-4"
                    >
                      <span className="mt-0.5 grid h-7 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 font-code text-[11px] font-bold text-brand-700">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <p className="text-[14.5px] leading-relaxed text-ink-600">
                        <span className="font-semibold text-ink-950">{item.lead}</span>{" "}
                        {item.body}
                      </p>
                    </motion.li>
                  ))}
                </ol>
              </article>
            </Spotlight>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
