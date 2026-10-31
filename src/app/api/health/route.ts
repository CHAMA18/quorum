import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIDECAR = process.env.QUORUM_SIDECAR_URL ?? "http://127.0.0.1:3031";

/** Public liveness/readiness probe for Render and external uptime monitors. */
export async function GET() {
  try {
    const response = await fetch(`${SIDECAR}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) throw new Error(`sidecar returned ${response.status}`);
    return NextResponse.json({ ok: true, service: "quorum-api", sidecar: "healthy" });
  } catch {
    return NextResponse.json(
      { ok: false, service: "quorum-api", sidecar: "unavailable" },
      { status: 503 },
    );
  }
}
