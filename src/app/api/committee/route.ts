import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { getCommitteeState } from "@/lib/committee";

/**
 * GET /api/committee — the standing committee as stored data: members from
 * JSON store, seat capacity and quorum threshold from settings, the gavel seat
 * resolved from the signed-in user, and the present/open counts computed.
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const user = await getUserFromToken(token).catch(() => null);
    const state = await getCommitteeState(user);
    return NextResponse.json(state);
  } catch (err) {
    console.error("[api/committee] failed:", err);
    return NextResponse.json({ error: "committee state unavailable" }, { status: 500 });
  }
}
