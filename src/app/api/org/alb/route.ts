import { NextResponse, type NextRequest } from "next/server";
import { clientKey, getOrgFromToken, ORG_SESSION_COOKIE, rateLimit } from "@/lib/org-auth";
import { sidecarError, sidecarFetch } from "@/lib/org-sidecar";

const suffixes = new Set(["ltd", "limited", "plc", "inc", "llc", "co", "company", "corporation", "corp", "sa", "ag", "gmbh", "pty", "bv", "nv", "llp", "lp"]);

function entityKey(value: unknown): string {
  return (typeof value === "string" ? value : "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((part) => part && !suffixes.has(part))
    .join(" ");
}

function sameOrg(a: unknown, b: unknown): boolean {
  const left = entityKey(a);
  const right = entityKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = shorter === left ? right : left;
  return shorter.split(" ").length >= 2 && longer.includes(shorter);
}

/** The authenticated supplier's own ALB clarification requests only. */
export async function GET(req: NextRequest) {
  const org = getOrgFromToken(req.cookies.get(ORG_SESSION_COOKIE)?.value);
  if (!org) return NextResponse.json({ error: "Sign in as an organization to see clarification requests." }, { status: 401 });
  if (!rateLimit(clientKey(req, "org-alb-read"), 300, 15 * 60_000)) {
    return NextResponse.json({ error: "Too many clarification reads. Wait a few minutes and retry." }, { status: 429 });
  }

  const apps = await sidecarFetch(`/api/applications?orgId=${encodeURIComponent(org.id)}`);
  if (apps.status !== 200) return NextResponse.json({ error: sidecarError(apps.data, "Applications are not reachable right now.") }, { status: apps.status });
  const rows = Array.isArray(apps.data.applications) ? apps.data.applications as Record<string, unknown>[] : [];
  const refs = [...new Set(rows
    .filter((row) => row.status !== "WITHDRAWN")
    .map((row) => typeof row.tenderId === "string" ? row.tenderId.trim() : "")
    .filter((ref) => /^[A-Za-z0-9._-]+$/.test(ref)))].slice(0, 20);

  const results = await Promise.all(refs.map(async (tenderRef) => {
    const out = await sidecarFetch(`/api/tenders/${encodeURIComponent(tenderRef)}`);
    if (out.status !== 200) return { status: out.status, tenderRef, data: out.data, dossiers: [] as Record<string, unknown>[] };
    const cycle = out.data.cycle && typeof out.data.cycle === "object" ? out.data.cycle as Record<string, unknown> : {};
    const dossiers = Array.isArray(cycle.alb) ? cycle.alb as Record<string, unknown>[] : [];
    return {
      status: 200,
      tenderRef,
      data: out.data,
      dossiers: dossiers.filter((dossier) => sameOrg(dossier.bidder, org.name)).map((dossier) => ({
        id: dossier.id,
        tenderRef,
        bidder: dossier.bidder,
        openedAt: dossier.openedAt,
        letterMd: dossier.letterMd,
        responseDueAt: dossier.responseDueAt,
        response: dossier.response ?? null,
        noResponseRecordedAt: dossier.noResponseRecordedAt ?? null,
        resolution: dossier.resolution ?? null,
      })),
    };
  }));
  const failed = results.find((result) => result.status >= 500);
  if (failed) return NextResponse.json({ error: sidecarError(failed.data ?? {}, "Clarification requests are not reachable right now.") }, { status: failed.status });
  const dossiers = results.flatMap((result) => result.status === 200 ? result.dossiers ?? [] : []);
  return NextResponse.json({ dossiers }, { headers: { "cache-control": "no-store" } });
}

export const dynamic = "force-dynamic";
