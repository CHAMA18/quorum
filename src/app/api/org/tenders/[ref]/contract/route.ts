import { NextResponse, type NextRequest } from "next/server";
import { getOrgFromToken, ORG_SESSION_COOKIE } from "@/lib/org-auth";
import { sidecarFetch } from "@/lib/org-sidecar";

/**
 * GET /api/org/tenders/:ref/contract
 *
 * The contract as the named supplier may see it. The sidecar read is
 * supplier-agnostic, so this route is the trust boundary: the contract is
 * returned only when it names the signed-in organization. Every other case —
 * no contract, another supplier's contract, an unreachable desk — gets the
 * same generic 404 so the endpoint cannot be used to discover who won.
 *
 * 200 → { contract, acceptance }   401 → no session   404 → not this org's
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const org = getOrgFromToken(req.cookies.get(ORG_SESSION_COOKIE)?.value);
  if (!org) {
    return NextResponse.json({ error: "Sign in as an organization to see your contract." }, { status: 401 });
  }
  const { ref } = await params;
  if (!/^[A-Za-z0-9._-]+$/.test(ref)) {
    return NextResponse.json({ error: "invalid tender reference" }, { status: 422 });
  }

  const { status, data } = await sidecarFetch(`/api/tenders/${encodeURIComponent(ref)}/contract`);
  const contract = data.contract as { supplier?: unknown } | undefined;
  const named = typeof contract?.supplier === "string" ? contract.supplier.trim().toLowerCase() : "";
  if (status !== 200 || !named || named !== org.name.trim().toLowerCase()) {
    return NextResponse.json({ error: "No contract is on record for this organization." }, { status: 404 });
  }

  return NextResponse.json(
    { contract: data.contract, acceptance: data.acceptance ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}

/* The sidecar error body is deliberately not relayed: it could name another
   supplier's tender. The generic refusal above is the whole answer. */
export const dynamic = "force-dynamic";
