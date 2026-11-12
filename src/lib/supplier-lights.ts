/** Supplier assurance as per-domain traffic lights. Pure mapping, UI renders it. */

export type LightState = "pass" | "warn" | "fail";
export interface SupplierLight {
  key: string;
  label: string;
  state: LightState;
  detail: string;
}

interface VerificationLike {
  registryStatus: string;
  taxStatus: string;
  sanctions: string;
  pep: string;
  sanctionsMatches?: string[];
  pepMatches?: string[];
  expiresAt: string;
}

export function supplierLights(v: VerificationLike, now = new Date()): SupplierLight[] {
  const registry: LightState = v.registryStatus === "REGISTERED" ? "pass" : "fail";
  const tax: LightState = v.taxStatus === "VALID" ? "pass" : v.taxStatus === "EXPIRED" ? "warn" : "fail";
  const sanctions: LightState = (v.sanctionsMatches?.length ?? 0) > 0 ? "fail" : v.sanctions === "CLEAR" ? "pass" : "warn";
  const pep: LightState = (v.pepMatches?.length ?? 0) > 0 ? "warn" : v.pep === "CLEAR" ? "pass" : "warn";
  const expiryMs = new Date(v.expiresAt).getTime();
  const expiry: LightState = !Number.isFinite(expiryMs) ? "warn" : expiryMs < now.getTime() ? "fail" : expiryMs - now.getTime() < 30 * 86_400_000 ? "warn" : "pass";
  return [
    { key: "registry", label: "Registry", state: registry, detail: v.registryStatus.replace(/_/g, " ") },
    { key: "tax", label: "Tax", state: tax, detail: v.taxStatus.replace(/_/g, " ") },
    { key: "sanctions", label: "Sanctions", state: sanctions, detail: (v.sanctionsMatches?.length ?? 0) > 0 ? `${v.sanctionsMatches!.length} match` : v.sanctions },
    { key: "pep", label: "PEP", state: pep, detail: (v.pepMatches?.length ?? 0) > 0 ? `${v.pepMatches!.length} match` : v.pep },
    { key: "expiry", label: "Check expiry", state: expiry, detail: v.expiresAt.slice(0, 10) },
  ];
}

export const LIGHT_COLOR: Record<LightState, string> = { pass: "#177245", warn: "#b45309", fail: "#b52b22" };

/** Certificate/check expiry status for tracker lists. */
export function expiryStatus(expiresAt: string | undefined, now = new Date()): { state: LightState; label: string } {
  if (!expiresAt) return { state: "warn", label: "no expiry recorded" };
  const ms = new Date(expiresAt).getTime();
  if (!Number.isFinite(ms)) return { state: "warn", label: "expiry unreadable" };
  const days = Math.ceil((ms - now.getTime()) / 86_400_000);
  if (days < 0) return { state: "fail", label: `expired ${Math.abs(days)}d ago` };
  if (days <= 30) return { state: "warn", label: `${days}d left` };
  return { state: "pass", label: `${days}d left` };
}
