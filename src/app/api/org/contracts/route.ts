import { NextResponse, type NextRequest } from "next/server";
import { clientKey, getOrgFromToken, ORG_SESSION_COOKIE, rateLimit } from "@/lib/org-auth";
import { sidecarFetch } from "@/lib/org-sidecar";

/**
 * GET /api/org/contracts — every contract that names this organization.
 *
 * Applications identify the tenders this org filed for; each is asked for its
 * contract, and only contracts naming the attested organization are returned.
 * A 404 per tender is expected (most applications never reach contract), and
 * one unreachable read does not fail the whole list.
 *
 * 200 → { contracts: [{ tenderRef, contract, acceptance }] }   401 → no session
 */
export async function GET(req: NextRequest) {
  const org = getOrgFromToken(req.cookies.get(ORG_SESSION_COOKIE)?.value);
  if (!org) {
    return NextResponse.json({ error: "Sign in as an organization to see your contracts." }, { status: 401 });
  }
  /* The console polls this list every 30s; the bucket is sized for the poll
     with headroom, not for a human clicking refresh. */
  if (!rateLimit(clientKey(req, "org-contracts"), 600, 15 * 60_000)) {
    return NextResponse.json({ error: "Too many contract reads from this network. Wait a few minutes." }, { status: 429 });
  }

  const apps = await sidecarFetch(`/api/applications?orgId=${encodeURIComponent(org.id)}`);
  const rows = Array.isArray(apps.data.applications) ? (apps.data.applications as Record<string, unknown>[]) : [];
  const refs = [...new Set(rows.map((row) => (typeof row.tenderId === "string" ? row.tenderId.trim() : "")))].filter(
    (ref) => ref && /^[A-Za-z0-9._-]+$/.test(ref),
  ).slice(0, 20);

  type ContractRow = { tenderRef: string; contract: unknown; acceptance: unknown; openedAt: string };
  const wanted = org.name.trim().toLowerCase();
  const reads = await Promise.all(
    refs.map(async (tenderRef): Promise<ContractRow | null> => {
      const out = await sidecarFetch(`/api/tenders/${encodeURIComponent(tenderRef)}/contract`);
      if (out.status !== 200) return null;
      const contract = out.data.contract as { supplier?: unknown; openedAt?: unknown } | undefined;
      const named = typeof contract?.supplier === "string" ? contract.supplier.trim().toLowerCase() : "";
      if (!named || named !== wanted) return null;
      return {
        tenderRef,
        contract: out.data.contract,
        acceptance: out.data.acceptance ?? null,
        openedAt: typeof contract?.openedAt === "string" ? contract.openedAt : "",
      };
    }),
  );

  const contracts = reads
    .filter((row): row is ContractRow => row !== null)
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
    .map((row) => ({ tenderRef: row.tenderRef, contract: row.contract, acceptance: row.acceptance }));

  return NextResponse.json({ contracts }, { headers: { "cache-control": "no-store" } });
}

export const dynamic = "force-dynamic";
