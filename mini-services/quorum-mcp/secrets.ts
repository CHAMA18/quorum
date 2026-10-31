/**
 * Purpose-scoped secrets.
 *
 * Every signing job used to share one GATE_SECRET, so a leak anywhere — an
 * attestation seal, a step-up token, a download link, a notification callback,
 * the audit register — compromised all of them. Each purpose now resolves its
 * own variable first and only falls back to GATE_SECRET, so existing
 * deployments keep working while an operator can rotate one key at a time.
 *
 * The guard lives at first use, not at module evaluation: production builds
 * import these modules with no runtime secrets in scope and must still load,
 * while a production process without a real secret still refuses to sign.
 */

const DEV_SECRET = "quorum-dev-attest-secret";

export type SecretPurpose = "attest" | "stepup" | "download" | "notify" | "audit" | "muse" | "bidvault";

/** The variables each purpose reads, most specific first. */
const SOURCES: Record<SecretPurpose, string[]> = {
  attest: ["ATTEST_SECRET", "GATE_SECRET"],
  stepup: ["STEP_UP_SECRET", "GATE_SECRET"],
  download: ["QUORUM_DOWNLOAD_SECRET", "GATE_SECRET"],
  notify: ["NOTIFY_SECRET", "GATE_SECRET"],
  audit: ["AUDIT_SECRET", "GATE_SECRET"],
  muse: ["MUSE_ACTION_SECRET", "GATE_SECRET"],
  bidvault: ["BID_VAULT_SECRET", "GATE_SECRET"],
};

export function secretFor(purpose: SecretPurpose): string {
  for (const name of SOURCES[purpose]) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `${SOURCES[purpose][0]} (or GATE_SECRET) must be set to a real secret in production — refusing to sign.`,
    );
  }
  return DEV_SECRET;
}

/** Which variable a purpose resolved from — a name, never a value. */
export function secretSource(purpose: SecretPurpose): string {
  for (const name of SOURCES[purpose]) {
    if (process.env[name]?.trim()) return name;
  }
  return "development default";
}
