import { ClipboardCheck, FileSearch, FileText, Landmark } from "lucide-react";
import { Reveal, SpecBar } from "@/components/quorum/reveal";

const PROCESS = [
  {
    icon: FileText,
    title: "Collect the source material",
    body: "Use the published notice and tender documents as the basis for review.",
  },
  {
    icon: ClipboardCheck,
    title: "Check the submission",
    body: "Review supplier documents, technical requirements, quantities and prices against the stated criteria.",
  },
  {
    icon: FileSearch,
    title: "Resolve the findings",
    body: "Open the cited evidence, confirm or amend each finding, and record the reviewer’s rationale.",
  },
  {
    icon: Landmark,
    title: "Record the decision",
    body: "The authorised committee records its decision and preserves it with the procurement history.",
  },
];

export function ReviewProcess() {
  return (
    <section id="review-process" className="relative overflow-hidden bg-night text-white">
      <div className="bg-grid-dark pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-28 top-0 h-[420px] w-[420px] rounded-full bg-brand-600/15 blur-[120px]" aria-hidden="true" />

      <div className="relative mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <Reveal>
              <SpecBar index="05" label="A documented workflow" meta="Notice · evidence · review · decision" tone="light" />
            </Reveal>
            <Reveal delay={0.06}>
              <h2 className="type-display mt-6 max-w-3xl text-[36px] text-white sm:text-[54px]">
                From tender notice to committee decision.
              </h2>
            </Reveal>
          </div>
          <Reveal delay={0.12} className="lg:col-span-5">
            <p className="max-w-lg text-[15px] leading-relaxed text-ink-300 sm:text-[16px]">
              Keep the source documents, review findings, officer dispositions and committee approval
              together in one traceable procurement record.
            </p>
          </Reveal>
        </div>

        <ol className="mt-12 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PROCESS.map((step, i) => (
            <li key={step.title} className="h-full">
              <Reveal delay={0.05 * i} className="h-full">
                <article className="flex h-full flex-col rounded-[14px] border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                  <div className="flex items-center justify-between">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/[0.07] text-brand-300 ring-1 ring-white/10">
                      <step.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="font-code text-[10px] font-semibold tracking-[0.16em] text-white/35">
                      STEP {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <h3 className="mt-6 text-[17px] font-semibold leading-snug text-white">
                    {step.title}
                  </h3>
                  <p className="mt-3 flex-1 text-[13.5px] leading-relaxed text-ink-300">
                    {step.body}
                  </p>
                </article>
              </Reveal>
            </li>
          ))}
        </ol>

        <Reveal delay={0.14}>
          <p className="mt-5 border-l-2 border-brand-500 pl-4 text-[13px] leading-relaxed text-ink-300">
            Quorum supports the review. The committee remains responsible for the award decision.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
