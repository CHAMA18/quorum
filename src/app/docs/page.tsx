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
    "The complete Quorum handbook: the agentic review pipeline, every rule the agent applies, the gate protocol, the supplier list and Zambia's procurement law — written for first-time officers and auditors alike.",
};

export default function DocsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      {/* Reading header — the way back to the workspace, kept one click away. */}
      <header className="sticky top-0 z-50 border-b border-ink-100 bg-paper/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] w-full max-w-6xl items-center justify-between gap-4 px-5">
          <div className="flex min-w-0 items-center gap-3">
            <a href="/" aria-label="Quorum — back to the site" className="shrink-0">
              <QuorumLogo tagline={false} />
            </a>
            <span className="hidden font-code text-[9px] font-bold tracking-[0.26em] text-ink-400 sm:inline">
              · DOCUMENTATION
            </span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/"
              className="hidden h-10 items-center rounded-xl border border-ink-200 bg-white px-4 font-code text-[9px] font-bold tracking-[0.16em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950 sm:inline-flex"
            >
              BACK TO SITE
            </a>
            <a
              href="/#/dashboard"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-600 px-4 font-code text-[9px] font-bold tracking-[0.16em] text-white shadow-[0_10px_26px_rgba(217,38,22,0.28)] transition-colors hover:bg-brand-700"
            >
              OPEN WORKSPACE
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
        </div>
      </header>

      {/* The handbook */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10 sm:py-12">
        <DocumentationView />
      </main>

      {/* Footer — the rule, one last time. */}
      <footer className="border-t border-ink-100">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6">
          <p className="font-code text-[8px] tracking-[0.22em] text-ink-400">
            QUORUM · AGENTIC PROCUREMENT · THE HANDBOOK
          </p>
          <p className="font-code text-[8px] tracking-[0.22em] text-ink-400">
            THE AGENT PREPARES THE FILE — THE COMMITTEE SIGNS
          </p>
        </div>
      </footer>
    </div>
  );
}
