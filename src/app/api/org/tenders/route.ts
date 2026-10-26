import { NextResponse, type NextRequest } from "next/server";
import { ORG_SESSION_COOKIE, getOrgFromToken } from "@/lib/org-auth";
import { sidecarFetch, sidecarError } from "@/lib/org-sidecar";

/**
 * GET /api/org/tenders — the opportunities board for the signed-in
 * ORGANIZATION: every tender pack staged on the procurement desk, with the
 * closing date resolved from the cycle record first and the notice text
 * second, the honest OPEN/CLOSED status and the applications already on
 * record. Read model by the sidecar's GET /api/marketplace — this route
 * only gates it behind the org session.
 *
 * 200 → { tenders: MarketplaceTender[] }   401 → no session   502 → sidecar down
 */
export async function GET(req: NextRequest) {
  const org = getOrgFromToken(req.cookies.get(ORG_SESSION_COOKIE)?.value);
  if (!org) {
    return NextResponse.json({ error: "Sign in as an organization to browse available tenders." }, { status: 401 });
  }

  const { status, data } = await sidecarFetch("/api/marketplace");
  if (status !== 200) {
    return NextResponse.json({ error: sidecarError(data, "The marketplace is not reachable right now.") }, { status });
  }
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
