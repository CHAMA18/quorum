import { NextResponse, type NextRequest } from "next/server";
import { ORG_SESSION_COOKIE, getOrgFromToken, publicOrg } from "@/lib/org-auth";

/**
 * GET /api/org/auth/me — who is this ORGANIZATION session?
 * Always 200: { org } when signed in, { org: null } when not.
 *
 * The officer door (/api/auth/me) set this shape and for the same reason:
 * the supplier door's session probe runs on every anonymous visit, and a 401
 * there is not an error — "nobody" is a valid answer to "who is this?".
 * Browsers log every 4xx fetch to the console (and the dev overlay counts
 * it as an issue), so an anonymous probe must never 401. Endpoints that
 * ACT on the session (profile PATCH, applications POST) keep their 401s.
 */
export async function GET(req: NextRequest) {
  const org = getOrgFromToken(req.cookies.get(ORG_SESSION_COOKIE)?.value);
  return NextResponse.json({ org: org ? publicOrg(org) : null });
}
