import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, rateLimit, SESSION_COOKIE } from "@/lib/auth";
import { getOrgFromToken, ORG_SESSION_COOKIE } from "@/lib/org-auth";
import {
  createTextSession,
  napsterConfigured,
  napsterSessionConfigured,
} from "@/lib/napster";

/**
 * POST /api/napster/session — mint a short-lived Napster text session.
 *
 * The Napster project key never reaches the browser. This route creates the
 * session and returns only the WebSocket URL, which already contains its own
 * short-lived session token. The client opens that socket directly; Napster
 * records the transcript on its side.
 *
 * This channel is deliberately separate from /api/muse/chat:
 *   · Napster is conversational. It has no Quorum tools and cannot read or
 *     change procurement records.
 *   · Quorum's desk agent remains the only path that can stage a signed,
 *     consent-gated action. The client falls back to it when Napster cannot
 *     start a session.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
} as const;

const BARRY_INSTRUCTIONS = [
  "You are Barry, Quorum's procurement agent, in a live text channel with a signed-in procurement officer.",
  "Quorum is a public-procurement tender review desk. Its workspace covers tenders, evaluations, the human approval gate, committee quorum, suppliers, operational deadlines and an append-only audit trail. Final decisions are made by named humans in Approvals; no agent makes them.",
  "Be concise and practical: lead with the answer that matters, then the reason. Use plain words, not corporate padding.",
  "You do not have access to Quorum's live desk records in this channel. Do not claim to have read a tender, approval, supplier, deadline, audit entry or committee register. If asked for live data, say it is not available here and tell the officer to use Message Barry in the same panel, which can read the desk.",
  "You cannot approve, reject, award, sign, return or record a final procurement decision, and you cannot change Quorum records in this channel. Explain the process and route the human to Approvals.",
  "Never invent a tender, supplier, gate, date, approval, signature, permission or citation. If you are unsure, say so.",
  "Do not ask for passwords, API keys or unnecessary personal data.",
  "If the officer asks you to take an action, say plainly that this Napster channel is conversational and that Message Barry can stage the action for their explicit confirmation.",
].join(" ");

const INITIAL_SPEECH =
  "Introduce yourself as Barry, Quorum's procurement agent, in one short sentence, then ask what procurement question the officer needs help with.";

export async function POST(request: NextRequest) {
  const user = await getUserFromToken(request.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) {
    const org = getOrgFromToken(request.cookies.get(ORG_SESSION_COOKIE)?.value);
    return NextResponse.json(
      {
        error: org
          ? "Napster live sessions are for Quorum workspace staff. Quorum chat is still available."
          : "Sign in to speak to Barry.",
        fallback: "muse",
      },
      { status: org ? 403 : 401, headers: noStore },
    );
  }

  if (!rateLimit(`napster-session:${user.id}`, 6, 60_000)) {
    return NextResponse.json(
      { error: "Too many Napster sessions. Wait a minute and try again.", fallback: "muse" },
      { status: 429, headers: noStore },
    );
  }
  /* Napster rate-limits connection creation to roughly one request a second
     across the whole key, so keep a shared guard in front of it. */
  if (!rateLimit("napster-session:upstream", 1, 1_500)) {
    return NextResponse.json(
      { error: "Napster is still opening the previous session. Try again in a moment.", fallback: "muse" },
      { status: 429, headers: noStore },
    );
  }

  if (!napsterConfigured()) {
    return NextResponse.json(
      {
        error: "NAPSTER_API_KEY is not configured on this deployment.",
        code: "not_configured",
        fallback: "muse",
      },
      { status: 503, headers: noStore },
    );
  }
  if (!napsterSessionConfigured()) {
    return NextResponse.json(
      {
        error: "Set NAPSTER_AGENT_ID or NAPSTER_COMPANION_ID to start a Napster session.",
        code: "not_configured",
        fallback: "muse",
      },
      { status: 503, headers: noStore },
    );
  }

  const result = await createTextSession({
    initialSpeech: INITIAL_SPEECH,
    instructions: BARRY_INSTRUCTIONS,
  });

  if (!result.ok) {
    const status =
      result.code === "not_configured" ? 503 : result.code === "rate_limited" ? 429 : 502;
    return NextResponse.json(
      {
        error: result.error,
        code: result.code,
        fallback: "muse",
        ...(result.upstreamDetail ? { upstreamDetail: result.upstreamDetail } : {}),
        ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}),
      },
      { status, headers: noStore },
    );
  }

  return NextResponse.json(
    {
      session: {
        url: result.data.url,
        connectionId: result.data.connectionId,
        expiresAt: result.data.expiresAt,
        modality: result.data.modality,
        agentId: result.data.agentId,
        companionId: result.data.companionId,
      },
      transport: "napster",
      fallback: "muse",
    },
    { headers: noStore },
  );
}
