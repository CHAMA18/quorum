import type { AdminOverview } from "@/lib/admin-types";

export type AdminSection = "deck" | "people" | "orgs" | "work" | "gates" | "audit" | "system" | "support";

export type ToastTone = "ok" | "error" | "info";

export type Notify = (message: string, tone?: ToastTone) => void;

export type PanelProps = {
  data: AdminOverview;
  refresh: (silent?: boolean) => Promise<void>;
  notify: Notify;
  query: string;
  setQuery: (value: string) => void;
  now: number;
  navigate: (section: AdminSection, query?: string) => void;
};

export type SectionMeta = {
  id: AdminSection;
  index: string;
  label: string;
  blurb: string;
};

export const SECTIONS: SectionMeta[] = [
  { id: "deck", index: "01", label: "Overview", blurb: "Workspace activity and outstanding actions" },
  { id: "people", index: "02", label: "People & access", blurb: "Accounts, roles and invitations" },
  { id: "orgs", index: "03", label: "Supplier organizations", blurb: "Profiles, applications and appeals" },
  { id: "work", index: "04", label: "Tender reviews", blurb: "Review history, findings and outcomes" },
  { id: "gates", index: "05", label: "Approvals", blurb: "Pending actions and recorded decisions" },
  { id: "audit", index: "06", label: "Audit log", blurb: "A verifiable record of system activity" },
  { id: "system", index: "07", label: "System health", blurb: "Services, integrations and configuration" },
  { id: "support", index: "08", label: "Support requests", blurb: "Requests awaiting a response" },
];

export function isAdminSection(value: string): value is AdminSection {
  return SECTIONS.some((section) => section.id === value);
}
