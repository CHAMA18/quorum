import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { QuorumLogo } from "@/components/quorum/logo";
import { Aurora } from "@/components/quorum/motion-kit";
import { Reveal } from "@/components/quorum/reveal";

const PRODUCT_LINKS = [
  { label: "Overview", href: "#overview" },
  { label: "Use cases", href: "#use-cases" },
  { label: "Inside the run", href: "#inside" },
  { label: "The report", href: "#report" },
  { label: "Pricing", href: "#pricing" },
  { label: "Get started", href: "#get-started" },
];

/* The four national OCDS portals the data programme reads — linked at the
   publisher's own address, as published on the OCP registry. */
const DATA_LINKS = [
  { label: "NOCOPO — Nigeria", href: "http://nocopo.bpp.gov.ng/OpenData.aspx" },
  { label: "GPP — Uganda", href: "https://gpp.ppda.go.ug/public/open-data/ocds/ocds-datasets" },
  { label: "PPIP — Kenya", href: "https://tenders.go.ke/ocds" },
  { label: "Umucyo — Rwanda", href: "https://ocds.umucyo.gov.rw/OpenData" },
];

const STANDARDS = ["MCP", "OCDS", "Open weights", "Human-in-the-loop"];

export function SiteFooter() {
  return (
    <footer className="relative mt-auto overflow-hidden bg-ink-950 text-ink-300">
      <Aurora tone="red" slow className="-left-52 -top-72 h-[620px] w-[620px] opacity-[0.14]" />
      <div className="relative mx-auto w-full max-w-7xl px-4 pb-10 pt-16 sm:px-6 lg:px-8 lg:pt-20">
        <div className="grid gap-12 lg:grid-cols-12">
          {/* Brand */}
          <Reveal delay={0.02} className="lg:col-span-5">
            <div>
              <Link href="/" aria-label="Quorum home">
                <QuorumLogo variant="light" />
              </Link>
              <p className="mt-5 max-w-sm text-[14.5px] leading-relaxed text-ink-400">
                Quorum is agentic procurement software — it reads public tenders end to end, cites
                every finding, and stops exactly where the law says a human decides.
              </p>
              <p className="mt-6 inline-flex items-center gap-2.5 rounded-full border border-white/12 px-4 py-2 text-[13px] font-semibold text-ink-200">
                Open weights · on-prem ready · audit-grade logs
              </p>
            </div>
          </Reveal>

          {/* Link columns */}
          <Reveal delay={0.08} className="lg:col-span-3">
            <nav aria-label="Product">
              <p className="font-code text-[10px] font-semibold tracking-[0.24em] text-ink-500">
                PRODUCT
              </p>
              <ul className="mt-4 space-y-2.5">
                {PRODUCT_LINKS.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      className="group inline-flex items-center gap-1.5 text-[14px] text-ink-300 transition-colors hover:text-white"
                    >
                      {l.label}
                      <ArrowUpRight
                        className="h-3 w-3 -translate-x-1 opacity-0 transition-[transform,opacity] group-hover:translate-x-0 group-hover:opacity-100"
                        aria-hidden="true"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </Reveal>

          <Reveal delay={0.14} className="lg:col-span-2">
            <nav aria-label="Open data">
              <p className="font-code text-[10px] font-semibold tracking-[0.24em] text-ink-500">
                OCDS PORTALS
              </p>
              <ul className="mt-4 space-y-2.5">
                {DATA_LINKS.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[14px] text-ink-300 transition-colors hover:text-white"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </Reveal>

          <Reveal delay={0.2} className="lg:col-span-2">
            <div>
              <p className="font-code text-[10px] font-semibold tracking-[0.24em] text-ink-500">
                STANDARDS
              </p>
              <ul className="mt-4 flex flex-wrap gap-2">
                {STANDARDS.map((o) => (
                  <li
                    key={o}
                    className="rounded-full border border-white/10 px-3 py-1 font-code text-[10.5px] text-ink-400"
                  >
                    {o}
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-[12.5px] leading-relaxed text-ink-500">
                Open standards end to end. Your data stays in-country.
              </p>
            </div>
          </Reveal>
        </div>

        {/* Bottom bar */}
        <Reveal delay={0.16} y={14}>
          <div className="mt-14 flex flex-col items-start justify-between gap-4 border-t border-white/8 pt-7 sm:flex-row sm:items-center">
            <p className="text-[12.5px] text-ink-500">
              © 2026 Quorum · Agentic procurement for Africa
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <span className="font-code text-[10px] tracking-[0.18em] text-ink-600">
                AGENTS PREPARE · COMMITTEES DECIDE
              </span>
              <span className="font-code text-[10px] tracking-[0.18em] text-ink-600">
                BUILT WITH LLAMA
              </span>
              <span className="font-code text-[10px] tracking-[0.18em] text-ink-600">NAIROBI · EAT</span>
            </div>
          </div>
        </Reveal>
      </div>
    </footer>
  );
}
