import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { recordSummons } from "@/lib/committee";
import { can } from "@/lib/permissions";

/**
 * POST /api/committee/summon — issue a real quorum call. A summons mints the
 * sitting: a fresh Jitsi room (open source, no accounts), the register frozen
 * into the door list, and the minutes open on the desk. One sitting at a
 * time — summoning while one is open returns it, it does not mint a second
 * room. The recomputed state (with the actual number of seats pending) and
 * `minted` are returned.
 */
export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const user = await getUserFromToken(token).catch(() => null);
    if (!user) {
      /* Committee records carry the officer's name — an anonymous write has
         no name to carry, so it is refused rather than filed as "unknown". */
      return NextResponse.json({ error: "Sign in to make changes — committee records carry the officer's name." }, { status: 401 });
    }
    if (!can(user.role, "manage_meetings")) {
      return NextResponse.json({ error: "Your workspace role cannot summon a sitting." }, { status: 403 });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const agenda = typeof body.agenda === "string" ? body.agenda : undefined;
    const state = await recordSummons(user, agenda);
    return NextResponse.json(state);
  } catch (err) {
    console.error("[api/committee/summon] failed:", err);
    return NextResponse.json({ error: "summons could not be recorded" }, { status: 500 });
  }
}
