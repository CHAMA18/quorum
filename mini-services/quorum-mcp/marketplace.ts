/**
 * quorum-mcp — the supplier-side marketplace.
 *
 * The organization portal's read model and the admission rules for
 * applications, as pure functions. Nothing here touches the filesystem or
 * the network: index.ts wires real tender packs, cycle records and the
 * supplier register into these functions, and the tests exercise them
 * without a live server.
 *
 * Two disciplines carry over from the paper world and are enforced here:
 *   - a bid that arrives after the closing date is refused, not quietly
 *     admitted (the same refusal the opening register applies);
 *   - one application per organization per tender.
 */

import type { Supplier, SupplierApplication, TenderCycle } from "./store";

/* ── The read model: what a supplier sees on the opportunities board ───── */

export interface MarketplaceTender {
  ref: string;
  title: string;
  buyer: string;
  sector: string;
  currency: string;
  budget: string;
  format: string;
  /** ISO date the tender closes — the cycle record's entry wins, the notice text is the fallback. */
  closingDate?: string;
  /** False only when neither the cycle nor the notice states a closing date — shown honestly as "not stated". */
  closingKnown: boolean;
  status: "OPEN" | "CLOSED";
  /** Whole days until closing, when OPEN and the closing date is known. */
  daysLeft?: number;
  applications: number;
}

export function marketplaceEntries(
  samples: { ref: string; title: string; buyer: string; sector: string; currency: string; budget: string; format: string }[],
  cycles: TenderCycle[],
  closingFromNotices: Record<string, string | undefined>,
  applicationCounts: Record<string, number>,
  now: Date,
): MarketplaceTender[] {
  return samples.map((s) => {
    const cycle = cycles.find((c) => c.tenderId === s.ref);
    const raw = cycle?.closingDate ?? closingFromNotices[s.ref];
    const closingDate = typeof raw === "string" && raw.trim() ? raw : undefined;
    const closing = closingDate ? new Date(closingDate) : null;
    const readable = closing !== null && !Number.isNaN(closing.getTime());
    const open = !readable || (closing as Date).getTime() > now.getTime();
    const daysLeft =
      open && readable
        ? Math.max(0, Math.ceil(((closing as Date).getTime() - now.getTime()) / 86_400_000))
        : undefined;
    return {
      ref: s.ref,
      title: s.title,
      buyer: s.buyer,
      sector: s.sector,
      currency: s.currency,
      budget: s.budget,
      format: s.format,
      closingDate: readable ? closingDate : undefined,
      closingKnown: readable,
      status: open ? "OPEN" : "CLOSED",
      daysLeft,
      applications: applicationCounts[s.ref] ?? 0,
    };
  });
}

/* ── The write discipline: what an application must survive before it lands ── */

export type AdmissionCheck = { ok: true } | { ok: false; code: number; error: string };

/** Shape checks that need no state: who is filing, and is the body a bid at all. */
/**
 * A tender reference is a single plain path segment. It must start and end
 * with a letter or digit, so `.`, `..`, `..x` and `x..` never pass, and the
 * reference can't climb out of TENDERS_DIR.
 */
export const TENDER_REF_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export function isSafeTenderRef(ref: unknown): ref is string {
  return typeof ref === "string" && TENDER_REF_RE.test(ref);
}

export function validateApplicationRequest(args: {
  actor: string;
  tenderRef: unknown;
  amount: unknown;
  currency?: unknown;
  coverNote?: unknown;
}): AdmissionCheck {
  const { actor, tenderRef, amount, currency, coverNote } = args;
  if (!actor.startsWith("org:") || actor.slice(4).trim().length === 0) {
    return {
      ok: false,
      code: 403,
      error:
        "Applications are filed by organization accounts — this endpoint only accepts the gateway's attested org:<name> identity.",
    };
  }
  const ref = typeof tenderRef === "string" ? tenderRef.trim() : "";
  if (!isSafeTenderRef(ref)) {
    return { ok: false, code: 422, error: "tenderRef is required — name the tender you are applying to." };
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { ok: false, code: 422, error: "amount must be a positive number — an application without a price is not a bid." };
  }
  if (currency !== undefined && currency !== null && String(currency).trim() !== "" && !/^[A-Za-z]{3,8}$/.test(String(currency).trim())) {
    return { ok: false, code: 422, error: "currency must be a 3–8 letter code (ZMW, KES, USD, RWF…)." };
  }
  if (coverNote !== undefined && coverNote !== null && String(coverNote).length > 1200) {
    return { ok: false, code: 422, error: "coverNote must be 1200 characters or fewer." };
  }
  return { ok: true };
}

/** State checks that decide whether the bid may be admitted at all. */
export function validateApplicationAdmission(args: {
  actor: string;
  tenderRef: string;
  amount: number;
  closingDate: string | undefined;
  existing: SupplierApplication[];
  registrationNo: string;
  supplierStatus?: Supplier["status"];
  now: Date;
}): AdmissionCheck {
  const { actor, tenderRef, amount, closingDate, existing, registrationNo, supplierStatus, now } = args;
  if (supplierStatus === "SUSPENDED" || supplierStatus === "BLACKLISTED") {
    return {
      ok: false,
      code: 403,
      error: `This organization is ${supplierStatus} on the supplier register — suspended and blacklisted suppliers cannot file applications.`,
    };
  }
  if (closingDate) {
    const closing = new Date(closingDate);
    if (!Number.isNaN(closing.getTime()) && closing.getTime() < now.getTime()) {
      return {
        ok: false,
        code: 422,
        error: `${tenderRef} closed at ${closing.toISOString()} — late applications are refused, exactly as late bids are refused at the public opening.`,
      };
    }
  }
  const reg = registrationNo.trim().toLowerCase();
  const dup = existing.find(
    (a) =>
      a.tenderId === tenderRef &&
      (a.actor.toLowerCase() === actor.toLowerCase() || (reg !== "" && a.registrationNo.trim().toLowerCase() === reg)),
  );
  if (dup) {
    return {
      ok: false,
      code: 409,
      error: `An application from this organization is already on record for ${tenderRef} (${dup.id}) — one bid per organization per tender.`,
    };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, code: 422, error: "amount must be a positive number — an application without a price is not a bid." };
  }
  return { ok: true };
}

/** The organization profile snapshot mapped onto the supplier register's shape. */
export function supplierFromOrgProfile(
  org: Record<string, unknown>,
  id: string,
  addedBy: string,
  nowIso: string,
): Supplier {
  const opt = (v: unknown): string | undefined => {
    const s = String(v ?? "").trim().slice(0, 200);
    return s.length > 0 ? s : undefined;
  };
  const categories = Array.isArray(org.categories)
    ? (org.categories as unknown[]).map((c) => String(c).trim().slice(0, 80)).filter(Boolean).slice(0, 12)
    : [];
  return {
    id,
    name: String(org.name ?? "").trim().slice(0, 160) || "Unnamed organization",
    registrationNo: String(org.registrationNo ?? "").trim().slice(0, 80) || "UNREGISTERED",
    taxPin: opt(org.taxPin),
    taxClearanceNo: opt(org.taxClearanceNo),
    taxClearanceExpiry: opt(org.taxClearanceExpiry),
    regulator: opt(org.regulator),
    regulatorNo: opt(org.regulatorNo),
    contactName: opt(org.contactName),
    email: opt(org.email),
    phone: opt(org.phone),
    address: opt(org.address),
    categories,
    metadata: {
      source: "supplier-portal registration",
      orgId: String(org.id ?? "").slice(0, 64),
    },
    status: "ACTIVE",
    addedBy,
    createdAt: nowIso,
  };
}
