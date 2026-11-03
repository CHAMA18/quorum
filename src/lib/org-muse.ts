import type { OrganizationRow } from "@/lib/db";
import { museChat, museConfigFromEnv } from "@/lib/muse";
import { orgActor } from "@/lib/org-auth";
import { sidecarFetch } from "@/lib/org-sidecar";

/**
 * Barry on the supplier door.
 *
 * The floating assistant is mounted over the organization console too, but
 * /api/muse/chat is an officer session — so a signed-in supplier used to get
 * "Sign in to use the assistant" from a bubble the portal had just offered
 * them. An organization now gets its OWN assistant: the same model when one
 * is configured, the same deterministic answer otherwise, and only facts
 * about this organization's record — never another bidder, the matrix, the
 * buyer's internal gates or any officer-only surface.
 *
 * Reads go through the org sidecar identity (`org:<name>`, supplier
 * workspace), so the sidecar applies the same supplier scoping as the
 * contract page. A contract is reported only when it names this org.
 */

export interface OrgContractFact {
  ref: string;
  status: string;
  currency?: string;
  value: number;
  acceptedAt?: string;
  completedAt?: string;
  payments: number;
  netCertified: number;
}

export interface OrgAssistantFacts {
  organization: string;
  profile: { filled: number; total: number; missing: string[] };
  contracts: OrgContractFact[];
  applications: number;
}

const PROFILE_FIELDS: { key: keyof OrganizationRow; label: string }[] = [
  { key: "taxPin", label: "Tax PIN" },
  { key: "taxClearanceNo", label: "Tax clearance" },
  { key: "taxClearanceExpiry", label: "Clearance expiry" },
  { key: "regulator", label: "Sector regulator" },
  { key: "regulatorNo", label: "Regulator number" },
  { key: "contactName", label: "Contact name" },
  { key: "phone", label: "Phone" },
  { key: "address", label: "Address" },
  { key: "website", label: "Website" },
  { key: "description", label: "Description" },
];

const TENDER_REF = /\b[A-Z]{2,6}-[A-Z0-9]{2,}(?:-[A-Z0-9]+)*\b/g;

function money(value: number, currency?: string): string {
  const amount = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);
  return `${currency ? `${currency} ` : ""}${amount}`;
}

function date(iso?: string): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

async function contractFor(org: OrganizationRow, ref: string): Promise<OrgContractFact | null> {
  const clean = ref.trim().toUpperCase().slice(0, 80);
  if (!/^[A-Z0-9._-]+$/.test(clean)) return null;
  const { status, data } = await sidecarFetch(`/api/tenders/${encodeURIComponent(clean)}/contract`, {
    actor: orgActor(org),
  });
  if (status !== 200) return null;
  const contract = data.contract as
    | {
        supplier?: unknown;
        status?: unknown;
        value?: unknown;
        currency?: unknown;
        supplierAcceptedAt?: unknown;
        completedAt?: unknown;
        payments?: { net?: unknown; status?: unknown }[];
      }
    | undefined;
  const supplier = typeof contract?.supplier === "string" ? contract.supplier.trim().toLowerCase() : "";
  if (!contract || supplier !== org.name.trim().toLowerCase()) return null;
  const payments = Array.isArray(contract.payments) ? contract.payments : [];
  const certified = payments.filter((payment) => payment?.status === "CERTIFIED");
  const netCertified = certified.reduce((sum, payment) => sum + (typeof payment.net === "number" ? payment.net : 0), 0);
  return {
    ref: clean,
    status: typeof contract.status === "string" ? contract.status : "DRAFT",
    ...(typeof contract.currency === "string" ? { currency: contract.currency } : {}),
    value: typeof contract.value === "number" ? contract.value : 0,
    ...(typeof contract.supplierAcceptedAt === "string" ? { acceptedAt: contract.supplierAcceptedAt } : {}),
    ...(typeof contract.completedAt === "string" ? { completedAt: contract.completedAt } : {}),
    payments: certified.length,
    netCertified,
  };
}

export async function orgAssistantFacts(org: OrganizationRow, message: string): Promise<OrgAssistantFacts> {
  const missing = PROFILE_FIELDS.filter((field) => !org[field.key]).map((field) => field.label);
  const refs = [...new Set((message.toUpperCase().match(TENDER_REF) ?? []).map((ref) => ref.trim()))].slice(0, 3);
  const contracts = (await Promise.all(refs.map((ref) => contractFor(org, ref)))).filter(
    (row): row is OrgContractFact => row !== null,
  );
  if (contracts.length === 0 && refs.length === 0) {
    /* No tender named: read the contracts the org has applications for, the
       same scoping the Contracts screen uses, and keep only rows naming it. */
    const apps = await sidecarFetch(`/api/applications?orgId=${encodeURIComponent(org.id)}`, { actor: orgActor(org) });
    const rows = Array.isArray(apps.data.applications) ? (apps.data.applications as Record<string, unknown>[]) : [];
    const appRefs = [...new Set(rows.map((row) => (typeof row.tenderId === "string" ? row.tenderId : "")))].filter(Boolean).slice(0, 10);
    const found = await Promise.all(appRefs.map((ref) => contractFor(org, ref)));
    contracts.push(...found.filter((row): row is OrgContractFact => row !== null));
  }
  return {
    organization: org.name,
    profile: { filled: PROFILE_FIELDS.length - missing.length, total: PROFILE_FIELDS.length, missing },
    contracts,
    applications: contracts.length,
  };
}

function deterministicReply(facts: OrgAssistantFacts, message: string): string {
  const asksProfile = /\b(profile|details?|missing|complete|readiness)\b/i.test(message);
  const contract = facts.contracts[0];

  if (asksProfile) {
    if (facts.profile.missing.length === 0) {
      return `Your organization profile is complete — all ${facts.profile.total} details are saved. The procurement team can verify ${facts.organization} and match it to opportunities.`;
    }
    return `Your profile is ${facts.profile.filled} of ${facts.profile.total} details (${Math.round((facts.profile.filled / facts.profile.total) * 100)}%). Still missing: ${facts.profile.missing.join(", ")}. Add them under Organization profile — the desk uses them to verify ${facts.organization} and match tenders.`;
  }

  if (contract) {
    const status = contract.status === "COMPLETED" ? "complete" : contract.status.toLowerCase().replaceAll("_", " ");
    const parts = [
      `Your contract on ${contract.ref} is ${status} — ${money(contract.value, contract.currency)}.`,
    ];
    if (contract.acceptedAt) parts.push(`The acceptance was recorded on ${date(contract.acceptedAt)}.`);
    if (contract.payments > 0) {
      parts.push(`${contract.payments} payment${contract.payments === 1 ? "" : "s"} certified, ${money(contract.netCertified, contract.currency)} net.`);
    } else {
      parts.push("No payment has been certified yet.");
    }
    if (contract.completedAt) parts.push(`The desk recorded completion on ${date(contract.completedAt)}.`);
    if (facts.profile.missing.length > 0) {
      parts.push(`Your profile still misses ${facts.profile.missing.length} detail${facts.profile.missing.length === 1 ? "" : "s"}: ${facts.profile.missing.join(", ")}.`);
    }
    return parts.join(" ");
  }

  const missing = facts.profile.missing.length
    ? `Your profile is ${facts.profile.filled} of ${facts.profile.total} details; still missing ${facts.profile.missing.join(", ")}.`
    : "Your profile is complete.";
  return `I can see ${facts.organization}'s own record only — no contract is on it yet. ${missing} Name a tender reference (for example KE-MOH-2026-117) and I will read its contract status.`;
}

/**
 * Answer a supplier's question. The model is used when configured, over a
 * facts block built from the org's own record; the deterministic reply is the
 * fallback so the door never depends on a key.
 */
export async function orgAssistantReply(
  org: OrganizationRow,
  message: string,
): Promise<{ reply: string; model?: string; toolsRead: string[] }> {
  const facts = await orgAssistantFacts(org, message);
  const toolsRead = ["org_profile", ...(facts.contracts.length ? ["org_contract"] : [])];
  const fallback = deterministicReply(facts, message);
  const cfg = museConfigFromEnv();
  if (!cfg) return { reply: fallback, toolsRead };

  try {
    const reply = await Promise.race([
      museChat(
        cfg,
        [
          {
            role: "system",
            content:
              `You are Barry, Quorum's supplier-portal assistant. You speak to ${org.name} only, and only about its own record. ` +
              "Never mention another bidder, the buyer's internal evaluation, gates, findings or officer-only data. " +
              "Answer in at most three short sentences, plain words, the number that matters first. " +
              "If the facts do not contain the answer, say what you can see and what is missing; never invent a figure, date or status.\n\n" +
              `FACTS (live read): ${JSON.stringify(facts)}`,
          },
          { role: "user", content: message },
        ],
        [],
        undefined,
        { maxOutputTokens: 260 },
      ),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("supplier assistant timed out")), 12_000)),
    ]);
    const text = reply.text.trim();
    return { reply: text || fallback, model: reply.model, toolsRead };
  } catch {
    return { reply: fallback, toolsRead };
  }
}
