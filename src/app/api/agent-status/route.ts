import { sidecarOrigin } from "@/lib/sidecar-origin";
import { NextResponse, type NextRequest } from "next/server";
import { ensureMcpSidecar } from "@/lib/mcp-boot";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";

/**
 * GET /api/agent-status — the real health of the agent stack, in one call.
 *
 * Self-heals the sidecar if needed, then proxies the quorum-mcp /api/health
 * payload (fsMcp status, graphs, tool-call / run / gate counts). The UI
 * renders what this returns — no hardcoded "ONLINE" anywhere.
 */
export async function GET(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in to read the agent status." }, { status: 401 });

  const sidecar = await ensureMcpSidecar();
  if (sidecar === "unavailable") {
    return NextResponse.json({ sidecar, health: null });
  }
  try {
    const res = await fetch(`${sidecarOrigin()}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) throw new Error(`sidecar ${res.status}`);
    const health = await res.json();
    return NextResponse.json({ sidecar, health });
  } catch {
    return NextResponse.json({ sidecar, health: null });
  }
}
