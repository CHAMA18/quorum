/**
 * Purpose-scoped secrets — the web side of the same contract the sidecar keeps.
 *
 * One shared key meant that a leak in the notification callback could forge a
 * gate attestation. Each purpose reads its own variable first and falls back to
 * GATE_SECRET so an existing deployment keeps working, while an operator can
 * rotate one key at a time. The formula and the fallback order must match
 * mini-services/quorum-mcp/secrets.ts exactly, or a seal will not verify.
 */

const DEV_SECRET = "quorum-dev-attest-secret";

export type SecretPurpose = "attest" | "stepup" | "download" | "notify" | "muse";

const SOURCES: Record<SecretPurpose, string[]> = {
  attest: ["ATTEST_SECRET", "GATE_SECRET"],
  stepup: ["STEP_UP_SECRET", "GATE_SECRET"],
  download: ["QUORUM_DOWNLOAD_SECRET", "GATE_SECRET"],
  notify: ["NOTIFY_SECRET", "GATE_SECRET"],
  muse: ["MUSE_ACTION_SECRET", "GATE_SECRET"],
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
