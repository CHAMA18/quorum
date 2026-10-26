import { firebaseWebApiKey } from "@/lib/firebase";

export interface VerifiedFirebaseIdentity {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
  providers: string[];
}

type LookupUser = {
  localId?: string;
  email?: string;
  emailVerified?: boolean;
  displayName?: string;
  providerUserInfo?: { providerId?: string }[];
};

/**
 * Verify a Firebase ID token server-side. Firebase checks the signature and
 * expiry; a token it rejects (or any lookup failure) resolves to null.
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseIdentity | null> {
  if (!idToken || idToken.length > 8192) return null;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseWebApiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
        cache: "no-store",
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { users?: LookupUser[] };
    const user = data.users?.[0];
    if (!user?.localId || !user.email) return null;
    return {
      uid: user.localId,
      email: user.email.toLowerCase(),
      emailVerified: user.emailVerified === true,
      name: user.displayName ?? "",
      providers: (user.providerUserInfo ?? []).map((p) => p.providerId ?? ""),
    };
  } catch {
    return null;
  }
}
