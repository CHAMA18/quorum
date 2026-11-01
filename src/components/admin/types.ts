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
  { id: "deck", index: "01", label: "Command Deck", blurb: "The whole desk, one readout" },
  { id: "people", index: "02", label: "People", blurb: "Authority, sessions, invitations" },
  { id: "orgs", index: "03", label: "Organizations", blurb: "The supplier door and its appeals" },
  { id: "work", index: "04", label: "Evaluations", blurb: "Runs, findings and model attribution" },
  { id: "gates", index: "05", label: "Human Gates", blurb: "The signature the machine cannot press" },
  { id: "audit", index: "06", label: "Audit Spine", blurb: "The hash-chained record" },
  { id: "system", index: "07", label: "System", blurb: "Runtime, model chain, roster" },
  { id: "support", index: "08", label: "Support", blurb: "Barry requests waiting for a reply" },
];

export function isAdminSection(value: string): value is AdminSection {
  return SECTIONS.some((section) => section.id === value);
}
