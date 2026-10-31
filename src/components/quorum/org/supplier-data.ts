import type { PublicOrg } from "@/lib/org-auth";

/**
 * Shared shapes and formatters for the supplier console. The API routes hand
 * these through untouched (see /api/org/tenders and /api/org/applications), so
 * both the overview and the applications table read one language.
 */

export type Tender = {
  ref: string;
  title: string;
  buyer: string;
  sector: string;
  currency: string;
  budget: string;
  format: string;
  closingDate?: string;
  closingKnown: boolean;
  status: "OPEN" | "CLOSED";
  daysLeft?: number;
  applications: number;
};

export type Application = {
  id: string;
  tenderId: string;
  orgName: string;
  /* A sealed filing carries no price until the certified opening reveals it. */
  amount?: number;
  currency?: string;
  coverNote?: string;
  sealed?: boolean;
  receiptId?: string;
  version?: number;
  receivedAt: string;
  status: string;
};

/** The contract as the portal reads it: the signed instrument plus its acceptance. */
export type OrgContract = {
  tenderRef: string;
  contract: {
    tenderId: string;
    supplier: string;
    value: number;
    currency?: string;
    status?: "DRAFT" | "EXECUTED" | "COMPLETED";
    openedAt: string;
    executedAt?: string;
    supplierAcceptedAt?: string;
    supplierSignatory?: string;
    acceptanceHash?: string;
    retentionPct?: number;
    warrantyDays?: number;
    conditions?: { id: string; text: string }[];
    performanceSecurity?: { amount: number; issuer: string; validUntil: string; documentId?: string };
    insurance?: { policyNo: string; issuer: string; validUntil: string; cover?: string };
    milestones?: { id: string; title: string; dueDate?: string; status: string }[];
    completedAt?: string;
  };
  acceptance: { acceptedAt: string | null; signatory: string | null; acceptanceHash: string | null } | null;
};

export function money(amount: number, currency?: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: currency && currency.length === 3 ? "currency" : "decimal",
      currency: currency && currency.length === 3 ? currency : undefined,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency ?? ""} ${amount.toLocaleString()}`.trim();
  }
}

export function fmtDate(iso: string | Date | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** The audit log reads in UTC — a filing time is only meaningful with its zone. */
export function fmtStamp(iso: string | undefined): { day: string; time: string } {
  if (!iso) return { day: "—", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { day: String(iso), time: "" };
  return {
    day: d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }),
    time: `${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC`,
  };
}

export function completeness(o: PublicOrg): { filled: number; total: number; missing: string[] } {
  const checks: [string, unknown][] = [
    ["legal name", o.name],
    ["registration no", o.registrationNo],
    ["country", o.country],
    ["legal form", o.legalForm],
    ["tax PIN", o.taxPin],
    ["tax clearance", o.taxClearanceNo],
    ["clearance expiry", o.taxClearanceExpiry],
    ["sector regulator", o.regulator],
    ["contact person", o.contactName],
    ["phone", o.phone],
    ["address", o.address],
    ["description", o.description],
    ["categories", o.categories.length > 0],
  ];
  const missing = checks.filter(([, v]) => !v).map(([k]) => k);
  return { filled: checks.length - missing.length, total: checks.length, missing };
}

export type StatusTone = "progress" | "done" | "muted";

/** What the applicant sees. The desk's own adjudication states are not ours to invent. */
export function statusMeta(status: string): { label: string; tone: StatusTone; note: string } {
  switch (status.toUpperCase()) {
    case "RECEIVED":
      return { label: "Received", tone: "progress", note: "Sitting with the desk" };
    case "WITHDRAWN":
      return { label: "Withdrawn", tone: "muted", note: "Pulled from the record" };
    case "AMENDED":
      return { label: "Amended", tone: "muted", note: "Replaced by a later version" };
    default:
      return { label: status, tone: "muted", note: "" };
  }
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Q";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
