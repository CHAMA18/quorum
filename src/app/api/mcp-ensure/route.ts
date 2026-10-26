import { NextResponse } from "next/server";
import { ensureMcpSidecar } from "@/lib/mcp-boot";

/**
 * GET /api/mcp-ensure — make sure the quorum-mcp sidecar is up.
 * Self-healing: if the port is free, the long-lived Next server respawns it.
 */
export async function GET() {
  const result = await ensureMcpSidecar();
  return NextResponse.json({ ok: result !== "unavailable", sidecar: result });
}
