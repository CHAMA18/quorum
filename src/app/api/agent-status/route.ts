import { sidecarOrigin } from "@/lib/sidecar-origin";
import { NextResponse, type NextRequest } from "next/server";
import { ensureMcpSidecar } from "@/lib/mcp-boot";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";

/**
 * GET /api/agent-status — the real health of the agent stack, in one call.
 *
 * The sidecar's /api/health is the liveness signal — the same probe
 * /api/health uses. It is tried FIRST, with a generous timeout and one
 * retry: on a small or cold instance the first health read can take
 * seconds (Postgres cold start, fs-mcp handshake), and a badge that reads
 * "offline" because a 2.5s budget ran out is worse than a slower answer.
 * Only when the health read fails do we ask mcp-boot to heal (spawn the
 * sidecar when its port is down) and read again. The failure reason is
 * returned and logged — a status endpoint that swallows its own error
 * cannot be diagnosed from outside.
 */

async function readSidecarHealth(): Promise<unknown> {
  const origin = sidecarOrigin();
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(`${origin}/api/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`sidecar returned ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      /* One retry: a cold instance often answers on the second try. */
      if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("sidecar health read failed");
}

export async function GET(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in to read the agent status." }, { status: 401 });

  try {
    const health = await readSidecarHealth();
    return NextResponse.json({ sidecar: "running", health });
  } catch (firstError) {
    /* The sidecar did not answer — heal it (spawn when the port is down)
       and try once more before declaring the stack offline. */
    const sidecar = await ensureMcpSidecar();
    if (sidecar === "unavailable") {
      const message = firstError instanceof Error ? firstError.message : "sidecar health read failed";
      console.error("[agent-status] sidecar unavailable:", message);
      return NextResponse.json({ sidecar, health: null, error: message });
    }
    try {
      const health = await readSidecarHealth();
      return NextResponse.json({ sidecar, health });
    } catch (secondError) {
      const message = secondError instanceof Error ? secondError.message : "sidecar health read failed";
      console.error("[agent-status] sidecar health failed after heal:", message);
      return NextResponse.json({ sidecar, health: null, error: message });
    }
  }
}
