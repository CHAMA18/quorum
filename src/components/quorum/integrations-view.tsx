"use client";

import { useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  Cloud,
  Mail,
  MessageSquare,
  Radio,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Integration = {
  id: string;
  name: string;
  category: string;
  summary: string;
  use: string;
  requirements: string[];
  href?: string;
  icon: "whatsapp" | "slack" | "mail" | "calendar" | "cloud" | "data" | "teams";
};

const INTEGRATIONS: Integration[] = [
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    category: "MESSAGING",
    summary: "Send deadline reminders and receive officer alerts through the WhatsApp Business Platform.",
    use: "Useful for time-sensitive procurement notifications. This requires the official Business Platform; personal WhatsApp accounts are not supported.",
    requirements: ["Meta business portfolio and WhatsApp Business account", "Phone number ID and access token", "Verified webhook URL and approved message templates"],
    href: "https://developers.facebook.com/docs/whatsapp/cloud-api",
    icon: "whatsapp",
  },
  {
    id: "slack",
    name: "Slack",
    category: "MESSAGING",
    summary: "Route workspace alerts to a private procurement channel.",
    use: "Keep evaluation milestones, gate reminders and service notices visible to the team without sending bid documents into chat.",
    requirements: ["Slack app in your workspace", "Bot token and selected destination channel", "Approved event and message scopes"],
    href: "https://api.slack.com/messaging",
    icon: "slack",
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    category: "MESSAGING",
    summary: "Deliver operational alerts to an existing Teams workspace.",
    use: "A good fit for public-sector teams already using Microsoft 365.",
    requirements: ["Microsoft Entra app registration", "Approved Graph or Teams webhook permissions", "Destination team and channel"],
    href: "https://learn.microsoft.com/microsoftteams/platform/webhooks-and-connectors/what-are-webhooks-and-connectors",
    icon: "teams",
  },
  {
    id: "email",
    name: "Email",
    category: "NOTIFICATIONS",
    summary: "Send notices, deadline reminders and review completion summaries.",
    use: "Email is suitable for durable notices and digest delivery; sensitive bid files should remain in Quorum.",
    requirements: ["Workspace-approved SMTP or email provider", "Verified sender domain", "Recipient and notification policy"],
    icon: "mail",
  },
  {
    id: "calendar",
    name: "Google & Microsoft calendars",
    category: "SCHEDULING",
    summary: "Add committee sittings, closing dates and standstill deadlines to calendars.",
    use: "Calendar events can help officers track statutory clocks and committee meetings.",
    requirements: ["Google Workspace or Microsoft 365 administrator consent", "Calendar scopes and target calendar", "Timezone and event visibility policy"],
    icon: "calendar",
  },
  {
    id: "cloud-docs",
    name: "SharePoint & OneDrive",
    category: "DOCUMENTS",
    summary: "Connect approved document repositories for controlled tender-pack intake.",
    use: "A potential route for importing files into Quorum's existing extraction and review workflow.",
    requirements: ["Microsoft Entra app registration", "Repository and folder access policy", "Document retention and audit requirements"],
    href: "https://learn.microsoft.com/graph/onedrive-concept-overview",
    icon: "cloud",
  },
  {
    id: "ocds",
    name: "OCDS & procurement portals",
    category: "DATA SOURCES",
    summary: "Bring published tender notices and award records into the desk.",
    use: "Connect Open Contracting Data Standard feeds or a supported public procurement portal to reduce manual re-entry.",
    requirements: ["Published API/feed URL and schema", "Jurisdiction-specific field mapping", "Refresh, attribution and provenance policy"],
    href: "https://standard.open-contracting.org/",
    icon: "data",
  },
];

function IntegrationMark({ kind }: { kind: Integration["icon"] }) {
  if (kind === "whatsapp") {
    return (
      <svg viewBox="0 0 40 40" className="h-7 w-7" aria-hidden="true">
        <circle cx="20" cy="19" r="15" fill="#25D366" />
        <path d="M12.5 31.7 14 26.9a12.2 12.2 0 1 1 4.1 3.1l-5.6 1.7Z" fill="#25D366" />
        <path d="M16.4 12.5c-.4-.8-.8-.8-1.2-.8h-1c-.4 0-.9.2-1.3.7-.5.5-1.7 1.7-1.7 4.1s1.8 4.8 2 5.2c.2.3 3.5 5.6 8.6 7.6 4.2 1.6 5.1 1.3 6 .9.9-.4 2.8-1.2 3.2-2.4.4-1.2.4-2.2.3-2.4-.2-.2-.5-.4-1.1-.7l-3.3-1.6c-.5-.2-.9-.4-1.2.4-.4.8-1.4 1.6-1.7 2-.3.3-.6.4-1.1.1-.5-.2-2.1-.8-4-2.5a15 15 0 0 1-2.8-3.5c-.3-.5 0-.8.2-1 .2-.2.5-.6.8-.9.2-.3.3-.5.5-.9.2-.3.1-.7 0-.9l-1.2-3.4Z" fill="#fff" transform="translate(-1 -1) scale(.9)" />
      </svg>
    );
  }
  if (kind === "slack") {
    return (
      <svg viewBox="0 0 40 40" className="h-7 w-7" aria-hidden="true">
        <path fill="#36C5F0" d="M15.2 4.5a3.1 3.1 0 1 0-3.1 3.1h3.1V4.5Zm1.6 0a3.1 3.1 0 1 1 6.2 0v7.8a3.1 3.1 0 1 1-6.2 0V4.5Z" />
        <path fill="#2EB67D" d="M35.5 15.2a3.1 3.1 0 1 0-3.1-3.1v3.1h3.1Zm0 1.6a3.1 3.1 0 1 1 0 6.2h-7.8a3.1 3.1 0 1 1 0-6.2h7.8Z" />
        <path fill="#ECB22E" d="M24.8 35.5a3.1 3.1 0 1 0 3.1-3.1h-3.1v3.1Zm-1.6 0a3.1 3.1 0 1 1-6.2 0v-7.8a3.1 3.1 0 1 1 6.2 0v7.8Z" />
        <path fill="#E01E5A" d="M4.5 24.8a3.1 3.1 0 1 0 3.1 3.1v-3.1H4.5Zm0-1.6a3.1 3.1 0 1 1 0-6.2h7.8a3.1 3.1 0 1 1 0 6.2H4.5Z" />
      </svg>
    );
  }
  if (kind === "mail") return <Mail className="h-6 w-6 text-sky-400" aria-hidden="true" />;
  if (kind === "calendar") return <CalendarDays className="h-6 w-6 text-violet-400" aria-hidden="true" />;
  if (kind === "cloud") return <Cloud className="h-6 w-6 text-blue-400" aria-hidden="true" />;
  if (kind === "data") return <Radio className="h-6 w-6 text-emerald-400" aria-hidden="true" />;
  return <MessageSquare className="h-6 w-6 text-indigo-400" aria-hidden="true" />;
}

export function IntegrationsView() {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <section className="panel overflow-hidden rounded-[12px]">
        <div className="relative overflow-hidden px-5 py-6 sm:px-7 sm:py-8">
          <div className="pointer-events-none absolute -right-10 -top-20 h-56 w-56 rounded-full bg-brand-500/10 blur-3xl" aria-hidden="true" />
          <div className="relative flex items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-600 text-white shadow-lg shadow-brand-950/15">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="max-w-3xl">
              <p className="font-code text-[8px] font-bold tracking-[0.2em] text-brand-700 dark:text-brand-300">CONNECTED WORKSPACE · INTEGRATIONS</p>
              <h1 className="mt-1 font-display text-[25px] font-black tracking-[-0.025em] text-ink-950 dark:text-white sm:text-[30px]">Bring your procurement tools together.</h1>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-600 dark:text-ink-300">
                Review the providers that fit Quorum. Connections are not enabled yet; no external messages, files or calendar events are being sent from this catalog.
              </p>
            </div>
          </div>
          <div className="relative mt-5 flex flex-wrap gap-2">
            <span className="rounded-full border border-ink-200/80 bg-white/70 px-2.5 py-1 font-code text-[7.5px] font-bold tracking-[0.13em] text-ink-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-300">{INTEGRATIONS.length} PROVIDERS</span>
            <span className="rounded-full border border-ink-200/80 bg-white/70 px-2.5 py-1 font-code text-[7.5px] font-bold tracking-[0.13em] text-ink-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-300">ADMIN SETUP REQUIRED</span>
          </div>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {INTEGRATIONS.map((integration) => {
          const isExpanded = expanded === integration.id;
          return (
            <article key={integration.id} className="panel flex min-w-0 flex-col overflow-hidden rounded-[12px]">
              <div className="flex items-start gap-3.5 px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-ink-100 bg-white dark:border-white/[0.08] dark:bg-white/[0.035]">
                  <IntegrationMark kind={integration.icon} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-code text-[7px] font-bold tracking-[0.16em] text-ink-400">{integration.category}</p>
                  <h2 className="mt-1 text-[13px] font-bold leading-snug text-ink-950 dark:text-white">{integration.name}</h2>
                  <span className="mt-1.5 inline-flex items-center gap-1.5 font-code text-[7px] font-bold tracking-[0.12em] text-ink-500 dark:text-ink-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-ink-300 dark:bg-ink-500" aria-hidden="true" />
                    NOT CONNECTED
                  </span>
                </div>
              </div>
              <p className="px-4 text-[11px] leading-relaxed text-ink-600 dark:text-ink-300 sm:px-5">{integration.summary}</p>
              <div className="mt-4 border-t border-ink-100/80 px-4 py-3 dark:border-white/[0.06] sm:px-5">
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() => setExpanded(isExpanded ? null : integration.id)}
                  className="inline-flex min-h-8 items-center gap-1.5 text-[10px] font-semibold text-ink-600 transition-colors hover:text-brand-700 dark:text-ink-300 dark:hover:text-brand-300"
                >
                  {isExpanded ? "Hide setup requirements" : "Review setup requirements"}
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isExpanded && "rotate-180")} aria-hidden="true" />
                </button>
                {isExpanded ? (
                  <div className="mt-2.5 space-y-2.5 rounded-lg border border-ink-100 bg-paper/70 p-3 dark:border-white/[0.07] dark:bg-white/[0.025]">
                    <p className="text-[10px] leading-relaxed text-ink-600 dark:text-ink-300">{integration.use}</p>
                    <ul className="space-y-1.5">
                      {integration.requirements.map((requirement) => (
                        <li key={requirement} className="flex gap-2 text-[9.5px] leading-relaxed text-ink-500 dark:text-ink-400">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                          {requirement}
                        </li>
                      ))}
                    </ul>
                    {integration.href ? (
                      <a href={integration.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-code text-[7px] font-bold tracking-[0.12em] text-brand-700 hover:text-brand-600 dark:text-brand-300">
                        PROVIDER DOCUMENTATION <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <p className="flex items-start gap-2 rounded-xl border border-ink-200/80 bg-white/60 px-4 py-3 text-[10px] leading-relaxed text-ink-500 dark:border-white/[0.08] dark:bg-white/[0.025] dark:text-ink-400">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" aria-hidden="true" />
        Provider credentials should be stored in a secured server-side secret store, never in the browser or a tender document. Enable an integration only after workspace security and retention review.
      </p>
    </div>
  );
}
