import { firebaseWebApiKey } from "@/lib/firebase";

/**
 * Server-side calls to the Firebase Identity Toolkit REST API using the
 * project's public web API key. These power the flows the browser SDK
 * cannot do for us here:
 *
 *  - password-reset emails (`accounts:sendOobCode`) — sent by Firebase
 *    itself, so no SMTP configuration is needed and the reset link is
 *    hosted on the project's own authorised auth domain;
 *  - password sign-in (`accounts:signInWithPassword`) — used as the
 *    fallback identity check when the local scrypt hash and the Firebase
 *    password have drifted (e.g. after a self-service reset);
 *  - identity bootstrap (`accounts:signUp`) — guarantees a Firebase
 *    account exists for a locally-registered address before a reset email
 *    is requested, even when the client-side mirror never ran.
 *
 * Every helper resolves to a discriminated result instead of throwing:
 * callers decide what the user sees; nothing here leaks stack traces.
 */

export type FirebaseRestCode =
  | "EMAIL_EXISTS"
  | "EMAIL_NOT_FOUND"
  | "INVALID_LOGIN_CREDENTIALS"
  | "TOO_MANY_ATTEMPTS_TRY_LATER"
  | "OPERATION_NOT_ALLOWED"
  | "NETWORK"
  | "UNAVAILABLE";

export type FirebaseRestResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: FirebaseRestCode };

const IDENTITY_BASE = "https://identitytoolkit.googleapis.com/v1";

function mapHttpCode(status: number, message: string): FirebaseRestCode {
  if (message.includes("EMAIL_EXISTS")) return "EMAIL_EXISTS";
  if (message.includes("EMAIL_NOT_FOUND")) return "EMAIL_NOT_FOUND";
  if (message.includes("INVALID_LOGIN_CREDENTIALS") || message.includes("INVALID_PASSWORD"))
    return "INVALID_LOGIN_CREDENTIALS";
  if (message.includes("TOO_MANY_ATTEMPTS")) return "TOO_MANY_ATTEMPTS_TRY_LATER";
  if (message.includes("OPERATION_NOT_ALLOWED")) return "OPERATION_NOT_ALLOWED";
  if (status === 429) return "TOO_MANY_ATTEMPTS_TRY_LATER";
  if (status >= 500) return "UNAVAILABLE";
  return "UNAVAILABLE";
}

async function callIdentityToolkit<T>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<FirebaseRestResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${IDENTITY_BASE}/${endpoint}?key=${encodeURIComponent(firebaseWebApiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return { ok: false, code: "NETWORK" };
  }

  const data = (await res.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null;

  if (!res.ok || !data) {
    const message = data?.error?.message ?? "";
    return { ok: false, code: mapHttpCode(res.status, message) };
  }
  return { ok: true, value: data };
}

/* ── Identity bootstrap ──────────────────────────────────────────────────── */

/**
 * Ensure a Firebase email/password account exists for this address.
 * Returns "exists" when the account was created here or already existed;
 * a false result means Firebase could not be reached or refused — the
 * reset email may then not arrive, and callers surface that honestly.
 */
export function firebaseRestEnsureAccount(
  email: string,
  temporaryPassword: string
): Promise<FirebaseRestResult<"created" | "exists">> {
  return callIdentityToolkit<{ kind?: string; localId?: string }>(
    "accounts:signUp",
    { email, password: temporaryPassword, returnSecureToken: false }
  ).then((res) =>
    res.ok
      ? { ok: true as const, value: "created" as const }
      : res.code === "EMAIL_EXISTS"
        ? { ok: true as const, value: "exists" as const }
        : { ok: false as const, code: res.code }
  );
}

/* ── Password reset emails ───────────────────────────────────────────────── */

/**
 * Ask Firebase to email a password-reset link for this address. Firebase
 * returns 200 whether or not the account exists (anti-enumeration); for
 * unknown addresses it simply sends nothing.
 */
export function firebaseRestSendPasswordReset(email: string): Promise<FirebaseRestResult<{ sent: true }>> {
  return callIdentityToolkit<{ kind?: string; email?: string }>(
    "accounts:sendOobCode",
    { requestType: "PASSWORD_RESET", email }
  ).then((res) =>
    res.ok ? { ok: true as const, value: { sent: true } as const } : { ok: false as const, code: res.code }
  );
}

/* ── Password sign-in (fallback identity check) ──────────────────────────── */

export interface FirebasePasswordSignIn {
  idToken: string;
  localId: string;
}

/**
 * Verify an email + password pair against Firebase Auth itself. Used ONLY
 * as the fallback when the local scrypt hash rejects: a success here means
 * the caller proved control of the Firebase password (set at registration
 * or through the emailed reset link).
 */
export function firebaseRestSignInWithPassword(
  email: string,
  password: string
): Promise<FirebaseRestResult<FirebasePasswordSignIn>> {
  return callIdentityToolkit<{ idToken?: string; localId?: string }>(
    "accounts:signInWithPassword",
    { email, password, returnSecureToken: true }
  ).then((res) => {
    if (!res.ok) return { ok: false as const, code: res.code };
    const { idToken, localId } = res.value;
    if (!idToken || !localId) return { ok: false as const, code: "UNAVAILABLE" as const };
    return { ok: true as const, value: { idToken, localId } };
  });
}
