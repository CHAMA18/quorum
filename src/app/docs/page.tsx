import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { QuorumLogo } from "@/components/quorum/logo";
import { DocumentationView } from "@/components/quorum/documentation";

/**
 * /docs — the handbook, at its own address.
 *
 * Documentation is deliberately not a workspace section: it lives at a
 * real URL so it can be opened, bookmarked, shared and read without the
 * workspace around it. The sidebar links here; this page links back.
 */

export const metadata: Metadata = {
  title: "Documentation — Quorum",
  description:
    "Guidance for procurement officers, committees and administrators using Quorum to review tenders, record evidence, manage approvals and maintain a traceable procurement history.",
};

export default function DocsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      {/* Reading header — the way back to the workspace, kept one click away. */}
      <header className="sticky top-0 z-50 border-b border-ink-100 bg-paper/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <a href="/" aria-label="Quorum — back to the site" className="shrink-0">
              <QuorumLogo tagline={false} />
            </a>
            <span className="hidden h-7 w-px bg-ink-200 sm:inline-block" aria-hidden="true" />
            <span className="hidden font-code text-[10px] font-bold tracking-[0.12em] text-ink-600 sm:inline">
              FIELD GUIDE
            </span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/org"
              className="hidden min-h-11 items-center rounded-xl px-3 font-code text-[9px] font-bold tracking-[0.07em] text-ink-600 transition-colors hover:text-ink-950 md:inline-flex"
            >
              SUPPLIER PORTAL
            </a>
            <a
              href="/api"
              className="hidden min-h-11 items-center rounded-xl px-3 font-code text-[9px] font-bold tracking-[0.07em] text-ink-600 transition-colors hover:text-ink-950 sm:inline-flex"
            >
              API REFERENCE
            </a>
            <a
              href="/#/dashboard"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 font-code text-[10px] font-bold tracking-[0.08em] text-white shadow-[0_10px_26px_rgba(217,38,22,0.28)] transition-colors hover:bg-brand-700"
            >
              OPEN WORKSPACE
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
        </div>
      </header>

      {/* The handbook */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-7 sm:px-6 sm:py-10">
        <DocumentationView />
      </main>

      {/* Footer — the rule, one last time. */}
      <footer className="border-t border-ink-100">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-6 sm:px-6">
          <p className="font-code text-[10px] tracking-[0.08em] text-ink-500">
            QUORUM · PROCUREMENT REVIEW HANDBOOK
          </p>
          <p className="font-code text-[10px] tracking-[0.08em] text-ink-500">
            SOURCE-LED · HUMAN-DECIDED
          </p>
        </div>
      </footer>
    </div>
  );
}
