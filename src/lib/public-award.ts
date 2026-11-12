import { listUsers } from "@/lib/db";
import { attestSignature } from "@/lib/sidecar-attest";
import { sidecarOrigin } from "@/lib/sidecar-origin";

interface CycleShape {
  tenderId: string;
  awardReport?: { recommendation?: string; signedAt?: string; signedBy?: string; sha: string };
  matrix?: { bids: { bidder: string; verdict: string; financial?: { amount: number; currency?: string } }[] };
  findings?: { severity: string }[];
}

/** Signed cycles across this deployment's workspaces, read with the server seal. */
async function signedCycles(): Promise<CycleShape[]> {
  const workspaces = [...new Set(listUsers().map((u) => u.workspaceId).filter(Boolean))];
  const out: CycleShape[] = [];
  for (const ws of workspaces) {
    const ts = Date.now();
    const actor = "Quorum public record";
    const res = await fetch(`${sidecarOrigin()}/api/cycle`, {
      headers: { "x-quorum-actor": actor, "x-quorum-workspace": ws, "x-quorum-ts": String(ts), "x-quorum-attest": attestSignature("GET", "/api/cycle", actor, ts, ws) },
      cache: "no-store",
    }).catch(() => null);
    if (!res?.ok) continue;
    const data = (await res.json().catch(() => ({}))) as { cycles?: CycleShape[] };
    out.push(...(data.cycles ?? []));
  }
  return out;
}

/** Sanitized public award summary for one tender (winner, date, counts only). */
export async function publicAward(ref: string): Promise<Record<string, unknown> | null> {
  const cycles = await signedCycles().catch(() => [] as CycleShape[]);
  const cycle = cycles.find((c) => c.tenderId === ref);
  if (!cycle?.awardReport?.signedAt) return null;
  const winner = cycle.matrix?.bids.find((b) => b.bidder === cycle.awardReport?.recommendation) ?? cycle.matrix?.bids.find((b) => b.verdict === "RECOMMENDED");
  const bySeverity: Record<string, number> = {};
  for (const f of cycle.findings ?? []) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  return {
    tenderId: cycle.tenderId,
    recommendation: cycle.awardReport.recommendation ?? winner?.bidder ?? null,
    signedAt: cycle.awardReport.signedAt,
    signedBy: cycle.awardReport.signedBy ?? "accounting officer",
    reportSha: cycle.awardReport.sha,
    biddersConsidered: cycle.matrix?.bids.length ?? 0,
    awardValue: winner?.financial ? { amount: winner.financial.amount, currency: winner.financial.currency ?? null } : null,
    findingsBySeverity: bySeverity,
  };
}
