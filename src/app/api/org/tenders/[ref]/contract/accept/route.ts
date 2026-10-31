import { NextResponse, type NextRequest } from "next/server";
import { clientKey, getOrgFromToken, ORG_SESSION_COOKIE, orgActor, rateLimit } from "@/lib/org-auth";
import { sidecarError, sidecarFetch } from "@/lib/org-sidecar";

/**
 * POST /api/org/tenders/:ref/contract/accept
 *
 * The awarded supplier's signed acceptance of the contract pack. Only the
 * organization the contract names can record it — the identity is the verified
 * org session, never a body field.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const org = getOrgFromToken(req.cookies.get(ORG_SESSION_COOKIE)?.value);
  if (!org) {
    return NextResponse.json({ error: "Sign in as an organization to accept a contract." }, { status: 401 });
  }
  if (!rateLimit(clientKey(req, "org-contract-accept"), 10, 15 * 60_000)) {
    return NextResponse.json({ error: "Too many contract actions from this network. Wait a few minutes." }, { status: 429 });
  }
  const { ref } = await params;
  if (!/^[A-Za-z0-9._-]+$/.test(ref)) {
    return NextResponse.json({ error: "invalid tender reference" }, { status: 422 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const signatory = typeof body.signatory === "string" ? body.signatory.trim().slice(0, 160) : "";
  if (!signatory) {
    return NextResponse.json({ error: "The accepting signatory must be named." }, { status: 422 });
  }
  const copyHash = typeof body.copyHash === "string" ? body.copyHash.trim().slice(0, 200) : undefined;
  const { status, data } = await sidecarFetch(`/api/tenders/${encodeURIComponent(ref)}/contract/acceptance`, {
    method: "POST",
    actor: orgActor(org),
    body: { signatory, ...(copyHash ? { copyHash } : {}) },
  });
  if (status !== 201) {
    return NextResponse.json({ error: sidecarError(data, "The contract acceptance could not be recorded.") }, { status });
  }
  return NextResponse.json(data, { status: 201, headers: { "cache-control": "no-store" } });
}
