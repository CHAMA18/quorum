import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, rateLimit, SESSION_COOKIE } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  listCompanions,
  napsterBaseUrl,
  napsterConfigured,
  napsterSessionConfigured,
  probeTextSession,
} from "@/lib/napster";

/**
 * GET /api/integrations/napster — connection diagnostics.
 *
 * GET proves the credential works and lists the companions in the key's
 * project. POST creates and immediately ends a text session, which is the
 * only honest test of whether the key can actually start conversations.
 *
 * Access is `manage_rules` (owners and admins). The key never leaves the
 * server: the response contains only public companion metadata.
 *
 * 200 → configured, connected, bounded companion list
 * 401 → no session  403 → not an administrator
 * 429 → this account or Napster rate-limited the check
 * 502 → Napster unreachable or returned an error
 * 503 → NAPSTER_API_KEY is not configured
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" } as const;

export async function GET(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to check the Napster integration." },
      { status: 401, headers: noStore },
    );
  }
  if (!can(user.role, "manage_rules")) {
    return NextResponse.json(
      { error: "Only workspace owners and admins can inspect integration credentials." },
      { status: 403, headers: noStore },
    );
  }
  if (!rateLimit(`napster-status:${user.id}`, 30, 60_000)) {
    return NextResponse.json(
      { error: "Too many integration checks. Wait a minute and try again." },
      { status: 429, headers: noStore },
    );
  }

  if (!napsterConfigured()) {
    return NextResponse.json(
      {
        configured: false,
        connected: false,
        sessionConfigured: napsterSessionConfigured(),
        error: "NAPSTER_API_KEY is not configured on this deployment.",
        docs: "docs/napster-integration.md",
      },
      { status: 503, headers: noStore },
    );
  }

  const result = await listCompanions({ pageSize: 12 });

  if (!result.ok) {
    return NextResponse.json(
      {
        configured: true,
        connected: false,
        sessionConfigured: napsterSessionConfigured(),
        error: result.error,
        code: result.code,
        ...(result.upstreamDetail ? { upstreamDetail: result.upstreamDetail } : {}),
        ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}),
        ...(result.requestId ? { requestId: result.requestId } : {}),
        checkedAt: new Date().toISOString(),
      },
      { status: result.status === 429 ? 429 : 502, headers: noStore },
    );
  }

  return NextResponse.json(
    {
      configured: true,
      connected: true,
      checkedAt: new Date().toISOString(),
      baseUrl: napsterBaseUrl(),
      access: "read-only",
      sessionConfigured: napsterSessionConfigured(),
      companions: {
        items: result.data.items,
        total: result.data.total,
        pageIndex: result.data.pageIndex,
        pageSize: result.data.pageSize,
        skipped: result.data.skipped,
      },
    },
    { headers: noStore },
  );
}

/**
 * POST /api/integrations/napster — probe whether this key can start a text
 * session. It creates a session and immediately ends it; no client connects,
 * so no conversation or billed call starts. The response is a report: a
 * credential that can read companions but cannot create sessions is the
 * common failure mode this surfaces.
 */
export async function POST(request: NextRequest) {
  const user = await getUserFromToken(request.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to check Napster session readiness." },
      { status: 401, headers: noStore },
    );
  }
  if (!can(user.role, "manage_rules")) {
    return NextResponse.json(
      { error: "Only workspace owners and admins can inspect integration credentials." },
      { status: 403, headers: noStore },
    );
  }
  if (!rateLimit(`napster-readiness:${user.id}`, 3, 60_000)) {
    return NextResponse.json(
      { error: "Too many readiness checks. Wait a minute and try again." },
      { status: 429, headers: noStore },
    );
  }
  if (!rateLimit("napster-session:upstream", 1, 1_500)) {
    return NextResponse.json(
      { error: "Napster is still opening a session. Try again in a moment." },
      { status: 429, headers: noStore },
    );
  }

  const checkedAt = new Date().toISOString();
  if (!napsterConfigured()) {
    return NextResponse.json(
      {
        configured: false,
        sessionConfigured: napsterSessionConfigured(),
        ready: false,
        code: "not_configured",
        error: "NAPSTER_API_KEY is not configured on this deployment.",
        checkedAt,
        docs: "docs/napster-integration.md",
      },
      { status: 503, headers: noStore },
    );
  }
  if (!napsterSessionConfigured()) {
    return NextResponse.json(
      {
        configured: true,
        sessionConfigured: false,
        ready: false,
        code: "not_configured",
        error: "Set NAPSTER_AGENT_ID or NAPSTER_COMPANION_ID before checking session readiness.",
        checkedAt,
        docs: "docs/napster-integration.md",
      },
      { status: 200, headers: noStore },
    );
  }

  const result = await probeTextSession();
  if (!result.ok) {
    return NextResponse.json(
      {
        configured: true,
        sessionConfigured: true,
        ready: false,
        code: result.code,
        error: result.error,
        ...(result.upstreamDetail ? { upstreamDetail: result.upstreamDetail } : {}),
        ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}),
        checkedAt,
      },
      { status: 200, headers: noStore },
    );
  }

  return NextResponse.json(
    {
      configured: true,
      sessionConfigured: true,
      ready: true,
      cleanedUp: result.data.cleanedUp,
      checkedAt,
    },
    { headers: noStore },
  );
}
