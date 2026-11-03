import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { getCommitteeState } from "@/lib/committee";
import { verifyAttest } from "@/lib/sidecar-attest";

/**
 * GET /api/committee — the standing committee as stored data: members from
 * JSON store, seat capacity and quorum threshold from settings, the gavel seat
 * resolved from the signed-in user, and the present/open counts computed.
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const user = await getUserFromToken(token).catch(() => null);
    if (!user) {
      /* The sidecar's gate and COI checks need the roll, but the register is
         not public. It presents the same HMAC seal the gateway uses, over a
         read of this exact path, so there is no second service credential. */
      const seal = verifyAttest("GET", "/api/committee", req.headers);
      if (!seal.ok || seal.actor !== "quorum-mcp") {
        return NextResponse.json({ error: "Sign in to read the committee register." }, { status: 401 });
      }
      return NextResponse.json(await getCommitteeState(null));
    }
    const state = await getCommitteeState(user);
    return NextResponse.json(state);
  } catch (err) {
    console.error("[api/committee] failed:", err);
    return NextResponse.json({ error: "committee state unavailable" }, { status: 500 });
  }
}
