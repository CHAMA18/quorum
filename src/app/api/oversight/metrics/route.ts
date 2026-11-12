import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { sidecarOrigin } from "@/lib/sidecar-origin";
import { attestSignature } from "@/lib/sidecar-attest";
import { computeOversightMetrics, type RunLike, type TenderLike } from "@/lib/oversight-metrics";
import { persistedCheckpointCount } from "@/lib/persisted-features";
import { listOrganizations } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Oversight metrics for the dashboard panel: backlog, cycle time, exceptions
 * and delayed tenders over the sidecar's runs/pipeline, plus integration
 * status (registry size, persisted checkpoints). When the
 * sidecar is unreachable the metrics degrade to empty with
 * `sidecarReachable: false` — never a fabricated zero-state pass.
 */

const SIDECAR = sidecarOrigin();

async function readSidecar<T>(path: string, actor: { name: string; workspaceId: string }): Promise<T | null> {
  const ts = Date.now();
  try {
    const res = await fetch(`${SIDECAR}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
      headers: {
        "x-quorum-actor": actor.name,
        "x-quorum-workspace": actor.workspaceId,
        "x-quorum-ts": String(ts),
        "x-quorum-attest": attestSignature("GET", path.split("?")[0], actor.name, ts, actor.workspaceId),
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const actor = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!actor) return NextResponse.json({ error: "Sign in to open oversight metrics." }, { status: 401 });
  if (!can(actor.role, "view_oversight"))
    return NextResponse.json({ error: "Oversight access is limited to owners, admins and auditors." }, { status: 403 });

  const scope = { name: actor.name, workspaceId: actor.workspaceId };
  const [runsBody, pipelineBody] = await Promise.all([
    readSidecar<{ runs?: RunLike[] }>("/api/runs", scope),
    readSidecar<{ pipeline?: Array<Record<string, unknown>>; tenders?: Array<Record<string, unknown>> }>("/api/pipeline", scope),
  ]);
  const runs = runsBody?.runs ?? [];
  const tenderRows = pipelineBody?.pipeline ?? pipelineBody?.tenders ?? [];
  const tenders: TenderLike[] = tenderRows.map((p) => ({
    ref: typeof p.ref === "string" ? p.ref : typeof p.id === "string" ? p.id : "",
    stage: typeof p.stage === "string" ? p.stage : "",
    deadline: typeof p.closingDate === "string" ? p.closingDate : typeof p.deadline === "string" ? p.deadline : undefined,
    exceptions: Array.isArray(p.exceptions) ? p.exceptions : [],
  }));
  return NextResponse.json({
    metrics: computeOversightMetrics(runs, tenders),
    sidecarReachable: runsBody !== null,
    source: { runs: runs.length, tenders: tenders.length },
    integrations: {
      registryOrganizations: listOrganizations().length,
      persistedCheckpoints: persistedCheckpointCount(),
    },
  });
}
