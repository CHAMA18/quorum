const SYSTEM_REFERENCE_PATTERN = /^QRM-\d{4}-\d{3,6}$/i;

export function isSystemReference(value: unknown): value is string {
  return typeof value === "string" && SYSTEM_REFERENCE_PATTERN.test(value);
}

/** Only show references issued in Quorum's neutral, system-generated format. */
export function systemReferenceLabel(value: unknown, fallback = "SYSTEM REFERENCE PENDING"): string {
  return isSystemReference(value) ? value.toUpperCase() : fallback;
}
