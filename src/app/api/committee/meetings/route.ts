import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { scheduleMeeting } from "@/lib/committee";

/**
 * POST /api/committee/meetings — put a meeting on the committee diary.
 *
 * Body: {
 *   title, agenda?, startsAt, durationMinutes?,
 *   memberIds?: string[],   names on the committee register
 *   playerIds?: string[],   workspace accounts
 *   externals?: { name, email? }[]   players off the register
 * }
 *
 * The owner (the signed-in officer) is added to the guest list automatically.
 * A fresh, unlisted Jitsi room is minted at scheduling time so the invitation
 * carries a real address from the moment it is filed. One meeting record is
 * written — nothing is guessed or back-filled.
 */
export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const user = await getUserFromToken(token).catch(() => null);
    if (!user) {
      /* A meeting carries the officer's name — an anonymous diary entry has
         no name to carry, so it is refused rather than filed as "unknown". */
      return NextResponse.json({ error: "Sign in to schedule a meeting — the diary carries the officer's name." }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const out = await scheduleMeeting(
      {
        title: body.title,
        agenda: body.agenda,
        startsAt: body.startsAt,
        durationMinutes: body.durationMinutes,
        memberIds: body.memberIds,
        playerIds: body.playerIds,
        externals: body.externals,
      },
      user,
    );

    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.code });
    return NextResponse.json({ ...out.state, scheduled: out.meeting }, { status: 201 });
  } catch (err) {
    console.error("[api/committee/meetings] failed:", err);
    return NextResponse.json({ error: "the meeting could not be scheduled" }, { status: 500 });
  }
}
