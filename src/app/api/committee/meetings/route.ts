import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { scheduleMeeting } from "@/lib/committee";
import { can } from "@/lib/permissions";

/**
 * POST /api/committee/meetings — put a meeting on the committee diary.
 *
 * Body: {
 *   title, agenda?, startsAt, durationMinutes?,
 *   repeatWeeks?: 1–12,     weekly occurrences (1 or omitted = one-off)
 *   memberIds?: string[],   names on the committee register
 *   playerIds?: string[],   workspace accounts
 *   externals?: { name, email? }[]   players off the register
 * }
 *
 * The owner (the signed-in officer) is added to the guest list automatically.
 * A fresh, unlisted Jitsi room is minted at scheduling time so the invitation
 * carries a real address from the moment it is filed. A weekly series writes
 * one record per occurrence, each with its own room and all sharing a series
 * id — nothing is guessed or back-filled.
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
    if (!can(user.role, "manage_meetings")) {
      return NextResponse.json({ error: "Your workspace role cannot schedule a committee meeting." }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const out = await scheduleMeeting(
      {
        title: body.title,
        agenda: body.agenda,
        startsAt: body.startsAt,
        durationMinutes: body.durationMinutes,
        repeatWeeks: body.repeatWeeks,
        memberIds: body.memberIds,
        playerIds: body.playerIds,
        externals: body.externals,
      },
      user,
    );

    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.code });
    return NextResponse.json(
      { ...out.state, scheduled: out.meeting, scheduledCount: out.scheduledCount },
      { status: 201 },
    );
  } catch (err) {
    console.error("[api/committee/meetings] failed:", err);
    return NextResponse.json({ error: "the meeting could not be scheduled" }, { status: 500 });
  }
}
