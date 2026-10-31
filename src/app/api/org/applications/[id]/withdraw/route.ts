import { NextResponse, type NextRequest } from "next/server";
import { clientKey, getOrgFromToken, ORG_SESSION_COOKIE, orgActor, rateLimit } from "@/lib/org-auth";
import { sidecarError, sidecarFetch } from "@/lib/org-sidecar";

/** POST /api/org/applications/:id/withdraw — the filing organization pulls its bid. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const org = getOrgFromToken(req.cookies.get(ORG_SESSION_COOKIE)?.value);
  if (!org) {
    return NextResponse.json({ error: "Sign in as an organization to withdraw a bid." }, { status: 401 });
  }
  if (!rateLimit(clientKey(req, "org-withdraw"), 20, 15 * 60_000)) {
    return NextResponse.json({ error: "Too many bid changes from this network. Wait a few minutes." }, { status: 429 });
  }
  const { id } = await params;
  const { status, data } = await sidecarFetch(`/api/applications/${encodeURIComponent(id)}/withdraw`, {
    method: "POST",
    actor: orgActor(org),
    body: {},
  });
  if (status !== 200) {
    return NextResponse.json({ error: sidecarError(data, "The bid could not be withdrawn.") }, { status });
  }
  return NextResponse.json(data, { status: 200, headers: { "cache-control": "no-store" } });
}
