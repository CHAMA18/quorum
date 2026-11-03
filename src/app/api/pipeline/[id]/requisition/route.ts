import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { canMutateSidecar } from "@/lib/permissions";
import { getUserFromToken, rateLimit, SESSION_COOKIE } from "@/lib/auth";
import { attestSignature } from "@/lib/sidecar-attest";
import { redisRateLimit } from "@/lib/redis-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIDECAR = (process.env.QUORUM_SIDECAR_URL?.trim() || "http://127.0.0.1:3031").replace(/\/+$/, "");
const REQUISITION_LIMIT = 20;
const REQUISITION_WINDOW_MS = 15 * 60_000;

function rateKey(userId: string, workspaceId: string): string {
  const identity = createHash("sha256").update(`${workspaceId}\0${userId}`).digest("hex");
  return `quorum:rate:v1:pipeline-requisition:${identity}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in to validate a requisition." }, { status: 401 });

  const { id } = await params;
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) {
    return NextResponse.json({ error: "Invalid pipeline entry id." }, { status: 400 });
  }
  const path = `/api/pipeline/${encodeURIComponent(id)}/requisition`;
  if (!canMutateSidecar(user.role, "POST", path)) {
    return NextResponse.json({ error: "Your workspace role cannot validate requisitions." }, { status: 403 });
  }

  let quota: Awaited<ReturnType<typeof redisRateLimit>>;
  try {
    quota = await redisRateLimit(rateKey(user.id, user.workspaceId), REQUISITION_LIMIT, REQUISITION_WINDOW_MS);
  } catch {
    return NextResponse.json({ error: "Redis rate limiting is unavailable. Try again shortly." }, { status: 503 });
  }
  if (!quota.configured) {
    /* Redis is optional hardening. Local and self-hosted deployments use the
       same file-backed limiter as the rest of the app, so a missing Redis
       configuration must not make requisition validation impossible. */
    const allowed = rateLimit(rateKey(user.id, user.workspaceId), REQUISITION_LIMIT, REQUISITION_WINDOW_MS);
    quota = {
      configured: true,
      allowed,
      remaining: allowed ? REQUISITION_LIMIT - 1 : 0,
      retryAfterSeconds: Math.ceil(REQUISITION_WINDOW_MS / 1000),
    };
  }
  if (!quota.allowed) {
    return NextResponse.json(
      { error: "Too many requisition updates. Wait before trying again." },
      { status: 429, headers: { "retry-after": String(quota.retryAfterSeconds) } },
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (typeof body.budgetValidated !== "boolean") {
    return NextResponse.json({ error: "budgetValidated must be true or false." }, { status: 422 });
  }
  const budgetReference = typeof body.budgetReference === "string" ? body.budgetReference.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (budgetReference.length > 120 || note.length > 300) {
    return NextResponse.json({ error: "The budget reference or note is too long." }, { status: 422 });
  }
  if (body.budgetValidated && !budgetReference) {
    return NextResponse.json({ error: "Enter the vote-book reference before validating the budget." }, { status: 422 });
  }

  const timestamp = Date.now();
  try {
    const upstream = await fetch(`${SIDECAR}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-quorum-workspace": user.workspaceId,
        "x-quorum-actor": user.name,
        "x-quorum-actor-id": user.id,
        "x-quorum-ts": String(timestamp),
        "x-quorum-attest": attestSignature("POST", path, user.name, timestamp, user.workspaceId),
      },
      body: JSON.stringify({
        budgetValidated: body.budgetValidated,
        ...(budgetReference ? { budgetReference } : {}),
        ...(note ? { note } : {}),
        actor: user.name,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
        "x-ratelimit-limit": String(REQUISITION_LIMIT),
        "x-ratelimit-remaining": String(quota.remaining),
      },
    });
  } catch {
    return NextResponse.json({ error: "The tender-cycle service did not answer." }, { status: 502 });
  }
}
