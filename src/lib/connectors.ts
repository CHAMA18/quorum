/** Supplier registry screening. */

export interface RegistryRecord { name: string; status: "ACTIVE" | "DEBARRED" | "SUSPENDED"; owners?: string[] }
export interface RegistryCheck { found: boolean; status: RegistryRecord["status"] | "UNKNOWN"; debarred: boolean; owners: string[] }

/** Screen a supplier against a supplied registry snapshot. Absence is UNKNOWN, never a pass. */
export function checkRegistry(supplierName: string, records: readonly RegistryRecord[]): RegistryCheck {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const hit = records.find((r) => norm(r.name) === norm(supplierName));
  if (!hit) return { found: false, status: "UNKNOWN", debarred: false, owners: [] };
  return { found: true, status: hit.status, debarred: hit.status === "DEBARRED", owners: hit.owners ?? [] };
}
