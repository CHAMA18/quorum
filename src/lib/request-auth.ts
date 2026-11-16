import type { NextRequest } from "next/server";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { getOrgFromToken, ORG_SESSION_COOKIE } from "@/lib/org-auth";
import type { AuthUser } from "@/lib/auth-types";
import type { OrganizationRow } from "@/lib/db";

export type RequestActor =
  | { kind: "user"; id: string; user: AuthUser }
  | { kind: "org"; id: string; org: OrganizationRow };

/**
 * Resolve the signed-in actor for a route that may be used from either door.
 * The officer session wins; the supplier session is a separate cookie and
 * never inherits a workspace role. Callers still enforce their own capability.
 */
export async function requestActor(req: NextRequest): Promise<RequestActor | null> {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (user) return { kind: "user", id: user.id, user };
  const org = getOrgFromToken(req.cookies.get(ORG_SESSION_COOKIE)?.value);
  if (org) return { kind: "org", id: org.id, org };
  return null;
}

export function actorLimitKey(scope: string, actor: RequestActor): string {
  return `${scope}:${actor.kind}:${actor.id}`;
}
