import { NextResponse, type NextRequest } from "next/server";
import { getOrgFromToken, ORG_SESSION_COOKIE } from "@/lib/org-auth";
import { sidecarError, sidecarFetch } from "@/lib/org-sidecar";

/** GET /api/org/applications/:id/receipt — the signed envelope receipt, never the price. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const org = getOrgFromToken(req.cookies.get(ORG_SESSION_COOKIE)?.value);
  if (!org) {
    return NextResponse.json({ error: "Sign in as an organization to read a bid receipt." }, { status: 401 });
  }
  const { id } = await params;
  const { status, data } = await sidecarFetch(
    `/api/applications/${encodeURIComponent(id)}/receipt?orgId=${encodeURIComponent(org.id)}`,
  );
  if (status !== 200) {
    return NextResponse.json({ error: sidecarError(data, "The receipt could not be read.") }, { status });
  }
  return NextResponse.json({ ...data, organization: { id: org.id, name: org.name } }, {
    headers: { "cache-control": "no-store" },
  });
}
