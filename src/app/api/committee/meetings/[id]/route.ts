import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { cancelScheduledMeeting } from "@/lib/committee";
import { can } from "@/lib/permissions";

/**
 * DELETE /api/committee/meetings/:id — take a meeting off the diary.
 *
 * A cancellation seals the record: the meeting disappears from the diary and
 * the calendar, and the officer who cancelled it is recorded. The row itself
 * stays in the store — a record, not a draft.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const user = await getUserFromToken(token).catch(() => null);
    if (!user) {
      return NextResponse.json({ error: "Sign in to cancel a meeting." }, { status: 401 });
    }
    if (!can(user.role, "manage_meetings")) {
      return NextResponse.json({ error: "Your workspace role cannot cancel a committee meeting." }, { status: 403 });
    }

    const out = await cancelScheduledMeeting(id, user);
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.code });
    return NextResponse.json(out.state);
  } catch (err) {
    console.error("[api/committee/meetings/:id] failed:", err);
    return NextResponse.json({ error: "the meeting could not be cancelled" }, { status: 500 });
  }
}
