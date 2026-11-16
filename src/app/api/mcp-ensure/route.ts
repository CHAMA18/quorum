import { NextResponse, type NextRequest } from "next/server";
import { ensureMcpSidecar } from "@/lib/mcp-boot";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { isAdminRole } from "@/lib/permissions";

/**
 * GET /api/mcp-ensure — make sure the quorum-mcp sidecar is up.
 * Self-healing: if the port is free, the long-lived Next server respawns it.
 */
export async function GET(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!isAdminRole(user.role)) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });

  const result = await ensureMcpSidecar();
  return NextResponse.json({ ok: result !== "unavailable", sidecar: result });
}
