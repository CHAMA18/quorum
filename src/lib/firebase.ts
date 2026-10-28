/**
 * Firebase — project "public-tender".
 *
 * The web config below is the public, client-safe identifier set (Firebase
 * web configs are designed to ship in browser code; access is guarded by
 * Firebase Security Rules, not by secrecy of these values).
 *
 * Everything here is lazy and failure-tolerant by design:
 *  - modules load via dynamic import only when a feature first needs them;
 *  - if the Firebase project is unreachable, rate-limited or misconfigured
 *    (e.g. the Email/Password provider not yet enabled in the console),
 *    every helper resolves quietly to null/false and the product keeps
 *    working on its local stack (scrypt sessions, local vault).
 *
 * Used by:
 *  - FirebaseAnalytics  — page-view telemetry for the "public-tender" project
 *  - auth-screen        — best-effort identity mirror into Firebase Auth
 *                         + Google sign-in (signInWithGooglePopup)
 *
 * Tender document uploads no longer use Firebase Storage: the New Evaluation
 * wizard stores files through the quorum-edge R2 gate (see
 * src/lib/tender-upload.ts and /api/tenders/[ref]/docs).
 */

export const firebaseProjectId = "public-tender";

const firebaseConfig = {
  apiKey: "AIzaSyBZo3i75Zyel3TYKB5ya-LWtwRNRCpvqCg",
  authDomain: "public-tender.firebaseapp.com",
  projectId: "public-tender",
  storageBucket: "public-tender.firebasestorage.app",
  messagingSenderId: "755841617956",
  appId: "1:755841617956:web:7639c3e15c587830f9c8b1",
  measurementId: "G-4WV68QCHHL",
};

/** Public web API key — also used server-side for ID token verification. */
export const firebaseWebApiKey = firebaseConfig.apiKey;

/* ── internals ─────────────────────────────────────────────────────────────── */

type FirebaseAppModule = typeof import("firebase/app");
type AuthModule = typeof import("firebase/auth");

let appPromise: Promise<import("firebase/app").FirebaseApp | null> | null = null;

function debugLog(scope: string, err: unknown) {
  if (process.env.NODE_ENV !== "production") {
    const code =
      typeof err === "object" && err && "code" in err
        ? String((err as { code: unknown }).code)
        : "";
    // Expected when the Firebase console hasn't enabled a provider / domain yet.
    console.debug(`[firebase:${scope}] unavailable (${code || "error"}) — local stack carries on`);
  }
}

async function getApp(): Promise<import("firebase/app").FirebaseApp | null> {
  if (typeof window === "undefined") return null;
  if (!appPromise) {
    appPromise = (async () => {
      try {
        const mod: FirebaseAppModule = await import("firebase/app");
        return mod.getApps().length ? mod.getApp() : mod.initializeApp(firebaseConfig);
      } catch (err) {
        debugLog("app", err);
        return null;
      }
    })();
  }
  return appPromise;
}

async function getAuthLazy() {
  const app = await getApp();
  if (!app) return null;
  try {
    const mod: AuthModule = await import("firebase/auth");
    return { mod, auth: mod.getAuth(app) };
  } catch (err) {
    debugLog("auth", err);
    return null;
  }
}

/* ── Analytics ─────────────────────────────────────────────────────────────── */

let analyticsStarted = false;

/** Initialise Firebase Analytics once, in a supported browser, quietly. */
export async function initFirebaseAnalytics(): Promise<boolean> {
  if (analyticsStarted || typeof window === "undefined") return false;
  analyticsStarted = true;
  try {
    const app = await getApp();
    if (!app) return false;
    const mod: AnalyticsModule = await import("firebase/analytics");
    if (!(await mod.isSupported())) return false;
    mod.getAnalytics(app);
    return true;
  } catch (err) {
    debugLog("analytics", err);
    return false;
  }
}

type AnalyticsModule = typeof import("firebase/analytics");

/* ── Auth mirror ───────────────────────────────────────────────────────────── */

export interface FirebaseIdentityInput {
  name: string;
  email: string;
  password: string;
  mode: "login" | "register";
}

/**
 * Mirror a successful workspace sign-in/registration into Firebase Auth so
 * the "public-tender" project's user list matches the product's accounts.
 * Fire-and-forget: never blocks, never throws, never surfaces UI errors.
 */
export async function syncFirebaseIdentity(input: FirebaseIdentityInput): Promise<boolean> {
  try {
    const pair = await getAuthLazy();
    if (!pair) return false;
    const { mod, auth } = pair;
    if (input.mode === "register") {
      const cred = await mod.createUserWithEmailAndPassword(auth, input.email, input.password);
      if (cred.user && input.name) await mod.updateProfile(cred.user, { displayName: input.name });
    } else {
      await mod.signInWithEmailAndPassword(auth, input.email, input.password);
    }
    return true;
  } catch (err) {
    debugLog(input.mode, err);
    return false;
  }
}

/* ── Email verification ────────────────────────────────────────────────────── */

export interface EmailVerificationState {
  verified: boolean;
  sent: boolean;
}

/**
 * Make sure the Firebase identity for this email exists and has a verification
 * email on its way. Creates the user (or signs in to it when it already exists),
 * then sends `sendEmailVerification`. Resolves null when Firebase is unavailable
 * (e.g. Email/Password provider not enabled yet) so the UI can say so honestly.
 */
export async function startEmailVerification(input: {
  name: string;
  email: string;
  password: string;
}): Promise<EmailVerificationState | null> {
  try {
    const pair = await getAuthLazy();
    if (!pair) return null;
    const { mod, auth } = pair;
    let user;
    try {
      const cred = await mod.createUserWithEmailAndPassword(auth, input.email, input.password);
      user = cred.user;
      if (input.name) await mod.updateProfile(user, { displayName: input.name });
    } catch (err) {
      if (!(typeof err === "object" && err && "code" in err && err.code === "auth/email-already-in-use")) {
        throw err;
      }
      user = (await mod.signInWithEmailAndPassword(auth, input.email, input.password)).user;
    }
    if (user.emailVerified) return { verified: true, sent: false };
    await mod.sendEmailVerification(user);
    return { verified: false, sent: true };
  } catch (err) {
    debugLog("verify-email", err);
    return null;
  }
}

/**
 * Reload the signed-in Firebase user. If their email is now verified, return a
 * fresh ID token for the server to check; otherwise null.
 */
export async function getVerifiedIdToken(): Promise<string | null> {
  try {
    const pair = await getAuthLazy();
    const user = pair?.auth.currentUser;
    if (!user) return null;
    await user.reload();
    if (!user.emailVerified) return null;
    return await user.getIdToken(true);
  } catch (err) {
    debugLog("verify-check", err);
    return null;
  }
}

/* ── Google sign-in ────────────────────────────────────────────────────────── */

export interface GoogleIdentity {
  /** Firebase ID token — the server verifies it before opening a session. */
  idToken: string;
  uid: string;
  name: string;
  email: string;
}

export type GoogleSignInDenial =
  | "unauthorized-domain" /* this origin is not on the project's authorised-domain list */
  | "provider-disabled" /* Google provider off in the Firebase console */
  | "popup-blocked" /* browser/iframe blocked the popup */
  | "popup-closed" /* user closed the popup before finishing */
  | "timeout" /* popup never resolved within the budget */
  | "network" /* Firebase unreachable */
  | "unknown";

export type GoogleSignInResult =
  | { status: "ok"; identity: GoogleIdentity }
  | { status: "denied"; reason: GoogleSignInDenial };

function mapAuthError(scope: string, err: unknown): GoogleSignInDenial {
  const code =
    typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "";
  debugLog(scope, err);
  switch (code) {
    case "auth/unauthorized-domain":
      return "unauthorized-domain";
    case "auth/operation-not-allowed":
    case "auth/admin-restricted-operation":
      return "provider-disabled";
    case "auth/popup-blocked":
      return "popup-blocked";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "popup-closed";
    case "auth/network-request-failed":
      return "network";
    default:
      return "unknown";
  }
}

/**
 * Open the Firebase Google sign-in popup for the "public-tender" project.
 * Resolves `{ status: "ok" }` with the signed-in Google identity, or
 * `{ status: "denied" }` with the precise reason — unauthorised origin,
 * provider switched off, popup blocked/closed, timeout — so the UI can say
 * exactly what happened instead of a generic failure. No fallback identity
 * is ever granted.
 */
export async function signInWithGooglePopup(): Promise<GoogleSignInResult> {
  try {
    const pair = await getAuthLazy();
    if (!pair) return { status: "denied", reason: "unknown" };
    const { mod, auth } = pair;
    const provider = new mod.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    const popup = mod
      .signInWithPopup(auth, provider, mod.browserPopupRedirectResolver)
      .then(
        async (cred) => {
          if (!cred.user?.email) return { status: "denied" as const, reason: "unknown" as const };
          const idToken = await cred.user.getIdToken();
          return {
            status: "ok" as const,
            identity: {
              idToken,
              uid: cred.user.uid,
              name: cred.user.displayName ?? "",
              email: cred.user.email,
            },
          };
        },
        (err) => ({ status: "denied" as const, reason: mapAuthError("google-signin", err) })
      );

    /* Hard budget: a never-resolving popup must not hang the flow. */
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<GoogleSignInResult>((resolve) => {
      timer = setTimeout(() => resolve({ status: "denied", reason: "timeout" }), 15_000);
    });
    const result = await Promise.race([popup, budget]);
    if (timer) clearTimeout(timer);

    /* A blocked popup is retried with the redirect flow: it survives
     * restrictive iframes once this origin is authorised. When the
     * redirect itself is refused we still report the precise reason. */
    if (result.status === "denied" && result.reason === "popup-blocked") {
      try {
        await mod.signInWithRedirect(auth, provider, mod.browserPopupRedirectResolver);
        /* Navigation is starting — keep the pending state until unload. */
        await new Promise(() => {});
      } catch (err) {
        return { status: "denied", reason: mapAuthError("google-redirect", err) };
      }
    }
    return result;
  } catch (err) {
    return { status: "denied", reason: mapAuthError("google-signin", err) };
  }
}

/**
 * Consume a Google sign-in that completed via the redirect flow (the page
 * reloads after Google returns). Resolves null when there is nothing to
 * consume — the common case on every normal page load.
 */
export async function completeGoogleRedirect(): Promise<GoogleSignInResult | null> {
  try {
    const pair = await getAuthLazy();
    if (!pair) return null;
    const { mod, auth } = pair;
    const cred = await mod.getRedirectResult(auth, mod.browserPopupRedirectResolver);
    if (!cred?.user?.email) return null;
    const identity = {
      idToken: await cred.user.getIdToken(),
      uid: cred.user.uid,
      name: cred.user.displayName ?? "",
      email: cred.user.email,
    };
    return { status: "ok", identity };
  } catch (err) {
    return { status: "denied", reason: mapAuthError("google-redirect-result", err) };
  }
}

/** True once the Firebase app has been initialised in this browser. */
export async function firebaseAvailable(): Promise<boolean> {
  return (await getApp()) !== null;
}
