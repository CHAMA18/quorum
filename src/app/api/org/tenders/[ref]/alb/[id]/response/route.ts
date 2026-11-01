import { NextResponse, type NextRequest } from "next/server";
import { clientKey, getOrgFromToken, ORG_SESSION_COOKIE, orgActor, rateLimit } from "@/lib/org-auth";
import { sidecarError, sidecarFetch } from "@/lib/org-sidecar";

/** POST /api/org/tenders/:ref/alb/:id/response — an authenticated bidder's explanation and evidence reference. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ ref: string; id: string }> }) {
  const org = getOrgFromToken(req.cookies.get(ORG_SESSION_COOKIE)?.value);
  if (!org) return NextResponse.json({ error: "Sign in as the bidder organization to answer this clarification." }, { status: 401 });
  if (!rateLimit(clientKey(req, "org-alb-response"), 8, 15 * 60_000)) {
    return NextResponse.json({ error: "Too many clarification responses. Wait a few minutes and retry." }, { status: 429 });
  }

  const { ref, id } = await params;
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(ref) || !/^[A-Za-z0-9._-]{1,100}$/.test(id)) {
    return NextResponse.json({ error: "Invalid tender or clarification reference." }, { status: 422 });
  }
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const response = typeof body.response === "string" ? body.response.trim() : "";
  const evidenceRef = typeof body.evidenceRef === "string" ? body.evidenceRef.trim() : "";
  if (response.length < 20 || response.length > 8_000 || !evidenceRef || evidenceRef.length > 240) {
    return NextResponse.json({ error: "Provide a reasoned response (20–8,000 characters) and a supporting evidence reference (up to 240 characters)." }, { status: 422 });
  }

  const apps = await sidecarFetch(`/api/applications?orgId=${encodeURIComponent(org.id)}`);
  if (apps.status !== 200) return NextResponse.json({ error: sidecarError(apps.data, "Your applications are not reachable right now.") }, { status: apps.status });
  const rows = Array.isArray(apps.data.applications) ? apps.data.applications as Record<string, unknown>[] : [];
  const ownsTender = rows.some((row) => row.tenderId === ref && row.status !== "WITHDRAWN");
  if (!ownsTender) return NextResponse.json({ error: "This organization has no active application for the tender named in this request." }, { status: 403 });

  const path = `/api/tenders/${encodeURIComponent(ref)}/alb/${encodeURIComponent(id)}/response`;
  const out = await sidecarFetch(path, {
    method: "POST",
    actor: orgActor(org),
    body: { response, evidenceRef },
  });
  if (out.status !== 201) return NextResponse.json({ error: sidecarError(out.data, "The clarification response could not be recorded.") }, { status: out.status });
  return NextResponse.json(out.data, { status: 201, headers: { "cache-control": "no-store" } });
}
