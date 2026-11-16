/**
 * Client-side identity helpers.
 *
 * These replace the Firebase browser SDK. Sign-in, Google, verification and
 * reset are ordinary same-origin requests now: Google runs as a full-page
 * redirect through Quorum's own OAuth routes, and the emailed links land on
 * routes that open the session server-side.
 */

export type GoogleDenial =
  | "unconfigured"
  | "cancelled"
  | "state"
  | "code"
  | "exchange"
  | "token"
  | "unverified"
  | "invite"
  | "exists"
  | "invitation-only"
  | "suspended"
  | "network";

/** Read the breach-free reason Google sign-in stopped, from `?google=`. */
export function googleDenialFromLocation(search: string): GoogleDenial | null {
  const reason = new URLSearchParams(search).get("google");
  if (!reason) return null;
  const known: GoogleDenial[] = [
    "unconfigured",
    "cancelled",
    "state",
    "code",
    "exchange",
    "token",
    "unverified",
    "invite",
    "exists",
    "invitation-only",
    "suspended",
    "network",
  ];
  return (known as string[]).includes(reason) ? (reason as GoogleDenial) : "network";
}

/** Start Google sign-in: a full-page redirect, no popup and no SDK. */
export function startGoogleSignIn(inviteCode?: string): void {
  const params = new URLSearchParams();
  if (inviteCode?.trim()) params.set("invite", inviteCode.trim().toUpperCase());
  const query = params.toString();
  window.location.assign(`/api/auth/google/start${query ? `?${query}` : ""}`);
}

export interface VerificationSendResult {
  sent: boolean;
  verified?: boolean;
  detail?: string;
  verificationUrl?: string;
  error?: string;
}

/** Ask the server to (re)send the confirmation link. */
export async function resendVerificationEmail(email: string): Promise<VerificationSendResult> {
  try {
    const res = await fetch("/api/auth/verify-email/resend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = (await res.json().catch(() => null)) as VerificationSendResult | null;
    if (!res.ok) return { sent: false, error: data?.error ?? "The link could not be sent." };
    return data ?? { sent: true };
  } catch {
    return { sent: false, error: "Cannot reach the server. Check your connection and try again." };
  }
}
