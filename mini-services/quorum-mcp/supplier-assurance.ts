/**
 * Supplier assurance (WS6).
 *
 * A supplier's good standing is a point-in-time check, not a badge on a
 * register row: registry standing, tax standing, who ultimately owns the
 * firm, sanctions/PEP screening, and the documents behind it. Each check is
 * labelled with its source — a live registry lookup or a manual attestation —
 * and carries an expiry, because a clean check last year says nothing about
 * the firm being awarded today.
 *
 * The rules here are pure and fail closed. The register layer records what
 * was checked; this module decides whether that record is good enough to
 * award, sign and execute. Absence of a check is never a pass.
 */

import type { Supplier, SupplierVerification } from "./store";

export const VERIFICATION_SOURCES = ["REGISTRY_LOOKUP", "MANUAL_ATTESTATION"] as const;
export const REGISTRY_STATUSES = ["REGISTERED", "NOT_FOUND", "STRUCK_OFF"] as const;
export const TAX_STATUSES = ["VALID", "EXPIRED", "NOT_FOUND"] as const;
export const SCREENING_RESULTS = ["CLEAR", "HIT"] as const;

/** How long a check stays usable when the caller does not state an expiry. */
export const DEFAULT_VERIFICATION_DAYS = 180;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function isoOrNull(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Normalise a verification request into a record. Invalid shapes are refused
 * with the exact field named; a well-formed but unsuccessful check is still
 * recorded (status FAILED) so the file shows what was found, not silence.
 */
export function normalizeVerification(
  raw: Record<string, unknown>,
  input: { checkedBy: string; now?: Date },
): SupplierVerification {
  const now = input.now ?? new Date();
  const checkedBy = input.checkedBy.trim().slice(0, 120);
  if (!checkedBy) throw new Error("A verification must name the officer who checked it.");

  const source = str(raw.source).toUpperCase();
  if (!(VERIFICATION_SOURCES as readonly string[]).includes(source)) {
    throw new Error('source must be "REGISTRY_LOOKUP" (a live registry check) or "MANUAL_ATTESTATION" (an officer\'s labelled manual check).');
  }
  const registryStatus = str(raw.registryStatus).toUpperCase();
  if (!(REGISTRY_STATUSES as readonly string[]).includes(registryStatus)) {
    throw new Error("registryStatus must be REGISTERED, NOT_FOUND or STRUCK_OFF — the registry answer is recorded, not inferred.");
  }
  const taxStatus = str(raw.taxStatus).toUpperCase();
  if (!(TAX_STATUSES as readonly string[]).includes(taxStatus)) {
    throw new Error("taxStatus must be VALID, EXPIRED or NOT_FOUND — the tax check is recorded, not inferred.");
  }
  const sanctions = str(raw.sanctions).toUpperCase();
  const pep = str(raw.pep).toUpperCase();
  for (const [field, value] of [["sanctions", sanctions], ["pep", pep]] as const) {
    if (!(SCREENING_RESULTS as readonly string[]).includes(value)) {
      throw new Error(`${field} must be CLEAR or HIT — a screening result must be stated, not omitted.`);
    }
  }

  const ownersRaw = Array.isArray(raw.beneficialOwners) ? raw.beneficialOwners : [];
  const beneficialOwners = ownersRaw
    .slice(0, 20)
    .map((entry) => {
      const o = (entry ?? {}) as Record<string, unknown>;
      return {
        name: str(o.name).slice(0, 160),
        ...(str(o.role) ? { role: str(o.role).slice(0, 80) } : {}),
        ...(Number.isFinite(Number(o.ownershipPct)) ? { ownershipPct: Math.max(0, Math.min(100, Number(o.ownershipPct))) } : {}),
        ...(str(o.nationality) ? { nationality: str(o.nationality).slice(0, 60) } : {}),
        ...(str(o.idNo) ? { idNo: str(o.idNo).slice(0, 80) } : {}),
      };
    })
    .filter((owner) => owner.name);
  if (ownersRaw.length > 20) throw new Error("At most 20 beneficial owners can be recorded in one check.");
  if (ownersRaw.length > beneficialOwners.length) {
    throw new Error("Every beneficial owner needs a name — an unnamed owner is not a disclosure.");
  }

  const docsRaw = Array.isArray(raw.documents) ? raw.documents : [];
  const documents = docsRaw
    .slice(0, 20)
    .map((entry, i) => {
      const d = (entry ?? {}) as Record<string, unknown>;
      const issuedAt = isoOrNull(d.issuedAt);
      const expiresAt = isoOrNull(d.expiresAt);
      return {
        id: str(d.id) || `doc_${i + 1}`,
        kind: str(d.kind).slice(0, 80),
        ...(str(d.reference) ? { reference: str(d.reference).slice(0, 120) } : {}),
        ...(issuedAt ? { issuedAt } : {}),
        ...(expiresAt ? { expiresAt } : {}),
      };
    })
    .filter((doc) => doc.kind);
  if (docsRaw.length > 20) throw new Error("At most 20 verification documents can be recorded in one check.");
  if (docsRaw.length > documents.length) {
    throw new Error("Every verification document needs a kind (e.g. TAX CLEARANCE, REGISTRY EXTRACT, SANCTIONS SCREEN).");
  }

  const statedExpiry = isoOrNull(raw.expiresAt);
  const expiresAt = statedExpiry ?? new Date(now.getTime() + DEFAULT_VERIFICATION_DAYS * 86_400_000).toISOString();

  const sanctionsMatches = (Array.isArray(raw.sanctionsMatches) ? raw.sanctionsMatches : [])
    .map((m) => str(m).slice(0, 200))
    .filter(Boolean)
    .slice(0, 10);
  const pepMatches = (Array.isArray(raw.pepMatches) ? raw.pepMatches : [])
    .map((m) => str(m).slice(0, 200))
    .filter(Boolean)
    .slice(0, 10);

  const status: SupplierVerification["status"] =
    registryStatus === "REGISTERED" &&
    taxStatus === "VALID" &&
    sanctions === "CLEAR" &&
    pep === "CLEAR" &&
    beneficialOwners.length > 0 &&
    documents.length > 0
      ? "VERIFIED"
      : "FAILED";

  return {
    status,
    registryStatus: registryStatus as SupplierVerification["registryStatus"],
    taxStatus: taxStatus as SupplierVerification["taxStatus"],
    beneficialOwners,
    sanctions: sanctions as SupplierVerification["sanctions"],
    pep: pep as SupplierVerification["pep"],
    ...(sanctionsMatches.length ? { sanctionsMatches } : {}),
    ...(pepMatches.length ? { pepMatches } : {}),
    documents,
    checkedAt: now.toISOString(),
    expiresAt,
    source: source as SupplierVerification["source"],
    checkedBy,
    ...(str(raw.notes) ? { notes: str(raw.notes).slice(0, 600) } : {}),
  };
}

/** Everything wrong with a recorded check, in the order a reviewer reads it. */
export function verificationFailures(
  verification: SupplierVerification | undefined,
  now = new Date(),
): string[] {
  if (!verification) return ["no assurance check is on record"];
  const failures: string[] = [];
  if (verification.registryStatus !== "REGISTERED") {
    failures.push(`registry status is ${verification.registryStatus.replace(/_/g, " ")}`);
  }
  if (verification.taxStatus !== "VALID") {
    failures.push(`tax status is ${verification.taxStatus}`);
  }
  if (verification.sanctions !== "CLEAR") {
    failures.push(
      `sanctions screening returned HIT${verification.sanctionsMatches?.length ? ` (${verification.sanctionsMatches.join("; ")})` : ""}`,
    );
  }
  if (verification.pep !== "CLEAR") {
    failures.push(
      `PEP screening returned HIT${verification.pepMatches?.length ? ` (${verification.pepMatches.join("; ")})` : ""}`,
    );
  }
  if (verification.beneficialOwners.length === 0) failures.push("no beneficial owner was collected");
  if (verification.documents.length === 0) failures.push("no verification document is attached");
  if (verification.status !== "VERIFIED") failures.push("the check did not pass");
  const expires = new Date(verification.expiresAt);
  if (Number.isNaN(expires.getTime())) failures.push("the expiry is not a date");
  else if (expires.getTime() <= now.getTime()) {
    failures.push(`the check expired on ${verification.expiresAt.slice(0, 10)}`);
  }
  return failures;
}

/** Whether a check is good enough to award, sign and execute. */
export function verificationOk(verification: SupplierVerification | undefined, now = new Date()): boolean {
  return verificationFailures(verification, now).length === 0;
}

/**
 * The award/contract refusal for a named bidder. It names the missing check
 * and every failed element, so the desk cannot clear one field and discover
 * the next at the gate.
 */
export function assuranceBlockReason(
  suppliers: Supplier[],
  bidder: string | undefined,
  now = new Date(),
): string | null {
  const winner = (bidder ?? "").trim();
  if (!winner) return null;
  const supplier = suppliers.find((s) => s.name.trim().toLowerCase() === winner.toLowerCase());
  if (!supplier) {
    return `${winner} is not on the supplier register — a bidder must be registered and verified before it can be awarded.`;
  }
  if (supplier.status !== "ACTIVE") {
    return `${supplier.name} is ${supplier.status} on the supplier register — a suspended or blacklisted bidder cannot be awarded, whatever its assurance check says.`;
  }
  const failures = verificationFailures(supplier.verification, now);
  if (!failures.length) return null;
  const source = supplier.verification
    ? ` (${supplier.verification.source === "MANUAL_ATTESTATION" ? "manual attestation" : "registry lookup"} by ${supplier.verification.checkedBy}, ${supplier.verification.checkedAt.slice(0, 10)})`
    : "";
  return `Supplier assurance fails for ${supplier.name}: ${failures.join("; ")}${source}. Verify the supplier before the award or contract proceeds.`;
}

/** A compact standing for the file and the desk. */
export function assuranceStanding(supplier: Supplier | undefined, now = new Date()) {
  const failures = verificationFailures(supplier?.verification, now);
  return {
    supplier: supplier?.name ?? null,
    status: failures.length === 0 ? ("VERIFIED" as const) : supplier?.verification ? ("FAILED" as const) : ("UNVERIFIED" as const),
    failures,
    verification: supplier?.verification ?? null,
  };
}
