import { NextResponse, type NextRequest } from "next/server";
import { clientKey, getOrgFromToken, ORG_SESSION_COOKIE, orgActor, rateLimit } from "@/lib/org-auth";
import { sidecarError, sidecarFetch } from "@/lib/org-sidecar";

/** POST /api/org/applications/:id/amend { amount, currency? } — re-seal before closing. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const org = getOrgFromToken(req.cookies.get(ORG_SESSION_COOKIE)?.value);
  if (!org) {
    return NextResponse.json({ error: "Sign in as an organization to amend a bid." }, { status: 401 });
  }
  if (!rateLimit(clientKey(req, "org-amend"), 20, 15 * 60_000)) {
    return NextResponse.json({ error: "Too many bid changes from this network. Wait a few minutes." }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Enter the amended bid amount — a positive number." }, { status: 422 });
  }

  const { id } = await params;
  const { status, data } = await sidecarFetch(`/api/applications/${encodeURIComponent(id)}/amend`, {
    method: "POST",
    actor: orgActor(org),
    body: {
      amount,
      currency: typeof body.currency === "string" && body.currency.trim() ? body.currency.trim() : undefined,
    },
  });
  if (status !== 201) {
    return NextResponse.json({ error: sidecarError(data, "The bid could not be amended.") }, { status });
  }
  return NextResponse.json(data, { status: 201, headers: { "cache-control": "no-store" } });
}
