import Link from "next/link";
import { ArrowRight, ArrowUpRight, Fingerprint, ShieldCheck } from "lucide-react";
import { QuorumLogo } from "@/components/quorum/logo";
import { Aurora } from "@/components/quorum/motion-kit";
import { Reveal } from "@/components/quorum/reveal";

const PRODUCT_LINKS = [
  { label: "Overview", href: "#overview" },
  { label: "Use cases", href: "#use-cases" },
  { label: "Review outputs", href: "#inside" },
  { label: "Sample report", href: "#report" },
  { label: "Pricing", href: "#pricing" },
  { label: "Get started", href: "#get-started" },
];

/* The four national OCDS portals the data programme reads — linked at the
   publisher's own address, as published on the OCP registry. */
const DATA_LINKS = [
  { label: "NOCOPO", country: "Nigeria", href: "http://nocopo.bpp.gov.ng/OpenData.aspx" },
  { label: "GPP", country: "Uganda", href: "https://gpp.ppda.go.ug/public/open-data/ocds/ocds-datasets" },
  { label: "PPIP", country: "Kenya", href: "https://tenders.go.ke/ocds" },
  { label: "Umucyo", country: "Rwanda", href: "https://ocds.umucyo.gov.rw/OpenData" },
];

const STANDARDS = ["Open Contracting", "Source citations", "Institutional controls", "Committee approval"];

const PROCESS_STEPS = [
  { number: "01", title: "Notice", detail: "The published source", mark: "PUBLIC" },
  { number: "02", title: "Evidence", detail: "Every claim cited", mark: "SOURCED" },
  { number: "03", title: "Review", detail: "Criteria applied in view", mark: "SOURCED" },
  { number: "04", title: "Decision", detail: "Recorded by the committee", mark: "APPROVED" },
];

export function SiteFooter() {
  return (
    <footer
      aria-labelledby="site-footer-title"
      className="relative isolate mt-auto overflow-hidden bg-[#090a0d] text-white"
    >
      {/* Fine drafting grid and a quiet red light make the close feel like the
          inside of a well-kept record, without competing with the headline. */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid-dark opacity-[0.24]" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(920px 560px at 2% 0%, rgba(217,38,22,.18), transparent 62%), radial-gradient(620px 440px at 100% 48%, rgba(67,77,103,.14), transparent 67%), linear-gradient(180deg, #0c0d11 0%, #090a0d 58%, #07080a 100%)",
        }}
        aria-hidden="true"
      />
      <Aurora tone="red" slow className="-left-72 -top-96 h-[740px] w-[740px] opacity-[0.09]" />

      <div className="relative mx-auto w-full max-w-[1440px] px-5 pb-6 pt-12 sm:px-8 sm:pt-16 lg:px-12 lg:pt-[76px]">
        {/* The closing statement */}
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-y border-white/[0.09] py-3.5">
          <p className="flex items-center gap-2.5 font-code text-[10px] font-bold tracking-[0.08em] text-ink-200">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500/60" />
              <span className="relative h-2 w-2 rounded-full bg-brand-500" />
            </span>
            QUORUM · PROCUREMENT WITH A TRACE
          </p>
          <p className="font-code text-[10px] font-semibold tracking-[0.06em] text-ink-300">
            NOTICE <span className="mx-1.5 text-brand-500">/</span> EVIDENCE <span className="mx-1.5 text-brand-500">/</span> HUMAN DECISION
          </p>
        </div>

        <div className="grid gap-10 py-12 sm:py-16 lg:grid-cols-12 lg:items-center lg:gap-12 lg:py-[76px]">
          <Reveal delay={0.02} className="min-w-0 lg:col-span-7">
            <p className="font-code text-[10px] font-bold tracking-[0.1em] text-brand-300">
              FROM PUBLIC NOTICE TO SIGNED DECISION
            </p>
            <h2
              id="site-footer-title"
              className="mt-5 max-w-[820px] font-display text-[clamp(48px,8.2vw,104px)] font-black leading-[0.91] tracking-[-0.075em] text-white"
            >
              The file closes.
              <br />
              <span className="relative inline-block text-white">
                The trail <span className="text-brand-400">doesn&apos;t.</span>
                <span className="absolute -bottom-2 left-0 h-[3px] w-[73%] rounded-full bg-gradient-to-r from-brand-500 via-brand-500/60 to-transparent" aria-hidden="true" />
              </span>
            </h2>
            <p className="mt-7 max-w-[620px] text-[14px] leading-[1.75] text-ink-300 sm:text-[16px]">
              Quorum helps public institutions review tenders with consistent criteria, source-linked findings and a traceable decision history. The committee retains authority over the award.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#/register"
                className="group inline-flex min-h-12 items-center gap-3 rounded-full bg-brand-500 px-5 py-3 text-[12.5px] font-bold text-white shadow-[0_12px_34px_rgba(217,38,22,0.22)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-brand-400 hover:shadow-[0_16px_44px_rgba(217,38,22,0.32)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#090a0d]"
              >
                Build your workspace
                <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true" />
              </a>
              <a
                href="#inside"
                className="group inline-flex min-h-12 items-center gap-2 rounded-full border border-white/[0.15] px-5 py-3 text-[12px] font-semibold text-ink-200 transition-colors hover:border-white/30 hover:bg-white/[0.04] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                See how it works
                <ArrowUpRight className="h-3.5 w-3.5 text-ink-500 transition-colors group-hover:text-white" aria-hidden="true" />
              </a>
            </div>
          </Reveal>

          {/* A compact visual of the product promise: the record advances;
              authority does not move from the committee to the machine. */}
          <Reveal delay={0.1} y={18} className="min-w-0 lg:col-span-5">
            <div className="relative overflow-hidden rounded-[22px] border border-white/[0.12] bg-[#111318]/85 p-5 shadow-[0_30px_100px_rgba(0,0,0,0.32)] backdrop-blur-sm sm:p-6">
              <div
                className="pointer-events-none absolute -right-28 -top-36 h-[330px] w-[330px] rounded-full border border-white/[0.04]"
                aria-hidden="true"
              >
                <span className="absolute inset-7 rounded-full border border-white/[0.04]" />
                <span className="absolute inset-14 rounded-full border border-white/[0.04]" />
                <span className="absolute inset-[84px] rounded-full border border-brand-500/10" />
              </div>
              <div className="relative flex items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-lg border border-brand-400/20 bg-brand-500/10 text-brand-300">
                    <Fingerprint className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="font-code text-[10px] font-bold tracking-[0.06em] text-white">THE PROCUREMENT RECORD</p>
                    <p className="mt-0.5 font-code text-[10px] tracking-[0.04em] text-ink-300">ONE TRACE · FOUR CHECKPOINTS</p>
                  </div>
                </div>
                <span className="rounded-full border border-white/[0.1] px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.04em] text-ink-300">END TO END</span>
              </div>

              <div className="relative mt-5">
                <span className="pointer-events-none absolute bottom-[26px] left-[15px] top-[20px] w-px bg-gradient-to-b from-white/15 via-white/15 to-brand-500/70" aria-hidden="true" />
                <ol className="relative space-y-1">
                  {PROCESS_STEPS.map((step, index) => {
                    const finalStep = index === PROCESS_STEPS.length - 1;
                    return (
                      <li key={step.number} className="relative grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-1.5 py-2.5">
                        <span
                          className={`relative z-10 grid h-8 w-8 place-items-center rounded-full border font-code text-[10px] font-bold ${
                            finalStep
                              ? "border-brand-400/55 bg-[#2a1516] text-brand-300 shadow-[0_0_22px_rgba(217,38,22,0.18)]"
                              : "border-white/[0.12] bg-[#15171c] text-ink-400"
                          }`}
                        >
                          {step.number}
                        </span>
                        <div className="min-w-0">
                          <p className={`text-[12.5px] font-semibold ${finalStep ? "text-white" : "text-ink-200"}`}>{step.title}</p>
                          <p className="mt-0.5 truncate text-[10.5px] text-ink-400">{step.detail}</p>
                        </div>
                        <span className={`font-code text-[10px] font-bold tracking-[0.04em] ${finalStep ? "text-brand-300" : "text-ink-300"}`}>
                          {step.mark}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>

              <div className="relative mt-4 flex items-center gap-2.5 rounded-xl border border-brand-400/15 bg-brand-500/[0.06] px-3.5 py-3">
                <ShieldCheck className="h-4 w-4 shrink-0 text-brand-300" aria-hidden="true" />
                <p className="text-[10.5px] leading-relaxed text-ink-300">
                  The system prepares the record. <span className="font-semibold text-white">A person signs the decision.</span>
                </p>
              </div>
            </div>
          </Reveal>
        </div>

        {/* Link directory — intentionally calmer after the statement above. */}
        <div className="grid gap-10 border-t border-white/[0.09] py-10 sm:grid-cols-2 sm:gap-8 lg:grid-cols-12 lg:gap-10 lg:py-12">
          <Reveal delay={0.02} className="min-w-0 sm:col-span-2 lg:col-span-4">
            <Link href="/" aria-label="Quorum home" className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
              <QuorumLogo variant="light" />
            </Link>
            <p className="mt-5 max-w-[370px] text-[12.5px] leading-[1.8] text-ink-400">
              Procurement review software for public institutions. Evidence stays connected to each finding, and decisions remain with authorised committees.
            </p>
            <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.025] px-3.5 py-2 font-code text-[10px] font-semibold tracking-[0.05em] text-ink-200">
              SOURCE-LINKED FINDINGS <span className="text-brand-400">·</span> INSTITUTIONAL CONTROLS <span className="text-brand-400">·</span> AUDIT HISTORY
            </p>
          </Reveal>

          <Reveal delay={0.08} className="lg:col-span-2">
            <nav aria-label="Product">
              <p className="font-code text-[10px] font-bold tracking-[0.2em] text-ink-400">PRODUCT</p>
              <ul className="mt-4 space-y-3">
                {PRODUCT_LINKS.map((link) => (
                  <li key={link.label}>
                    <a href={link.href} className="group inline-flex items-center gap-1.5 text-[12px] text-ink-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:text-white">
                      {link.label}
                      <ArrowUpRight className="h-3 w-3 -translate-x-1 opacity-0 transition-[transform,opacity] group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100" aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </Reveal>

          <Reveal delay={0.13} className="lg:col-span-3">
            <nav aria-label="Open data portals">
              <p className="font-code text-[10px] font-bold tracking-[0.2em] text-ink-400">OPEN DATA · AFRICA</p>
              <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                {DATA_LINKS.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group inline-flex items-baseline gap-1.5 text-[11.5px] text-ink-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:text-white"
                    >
                      <span>{link.label}</span>
                      <span className="text-[10px] text-ink-400">{link.country}</span>
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-7 flex flex-wrap gap-1.5">
                {STANDARDS.map((standard) => (
                  <span key={standard} className="rounded-full border border-white/[0.1] px-2.5 py-1 font-code text-[10px] text-ink-300">
                    {standard}
                  </span>
                ))}
              </div>
            </nav>
          </Reveal>

          <Reveal delay={0.18} className="lg:col-span-3">
            <nav aria-label="Resources">
              <p className="font-code text-[10px] font-bold tracking-[0.2em] text-ink-400">GO DEEPER</p>
              <ul className="mt-4 space-y-3">
                <li>
                  <Link href="/docs" className="group inline-flex items-center gap-1.5 text-[12px] text-ink-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:text-white">
                    Documentation
                    <ArrowUpRight className="h-3 w-3 -translate-x-1 opacity-0 transition-[transform,opacity] group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100" aria-hidden="true" />
                  </Link>
                </li>
                <li>
                  <Link href="/api" className="group inline-flex items-center gap-1.5 text-[12px] text-ink-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:text-white">
                    API directory
                    <ArrowUpRight className="h-3 w-3 -translate-x-1 opacity-0 transition-[transform,opacity] group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100" aria-hidden="true" />
                  </Link>
                </li>
              </ul>
              <p className="mt-7 max-w-[270px] text-[11px] leading-[1.7] text-ink-400">
                Ask us about hosting, data-residency and integration requirements for your institution.
              </p>
            </nav>
          </Reveal>
        </div>

        {/* A restrained colophon gives the page a deliberate final note. */}
        <Reveal delay={0.12} y={12}>
          <div className="flex flex-col gap-4 border-t border-white/[0.09] pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="text-[11px] text-ink-400">© 2026 Quorum · Public procurement review</p>
              <span className="hidden h-3 w-px bg-white/10 sm:block" aria-hidden="true" />
              <span className="text-[11px] text-ink-400">A StackOne Solutions Limited product</span>
            </div>
            <p className="font-code text-[10px] font-bold tracking-[0.04em] text-ink-300">
              REVIEW SUPPORT <span className="mx-1 text-brand-500">·</span> COMMITTEE AUTHORITY
            </p>
          </div>
        </Reveal>
      </div>
    </footer>
  );
}
