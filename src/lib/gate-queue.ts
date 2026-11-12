/** Approval-queue ordering: as-recorded, by risk, or by urgency. Pure. */

export interface GateLike {
  flags: number;
  tool: string;
  status: string;
  agoHours?: number;
}

export type GateSortMode = "queue" | "risk" | "urgency";

const TOOL_WEIGHT: Record<string, number> = { file_gate_submission: 25, publish_award_notice: 18, execute_contract: 18, record_bid_opening: 8 };

export function gateRisk(g: GateLike): number {
  return g.flags * 10 + (TOOL_WEIGHT[g.tool] ?? 5) + (g.status === "AWAITING_SECOND" ? 10 : 0);
}

export function sortGateQueue<T extends GateLike>(queue: readonly T[], mode: GateSortMode): T[] {
  if (mode === "queue") return [...queue];
  const score = (g: GateLike) => gateRisk(g) + (mode === "urgency" ? Math.min(g.agoHours ?? 0, 72) / 3 : 0);
  return [...queue].sort((a, b) => score(b) - score(a));
}
