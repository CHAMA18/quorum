import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { mutateSitting } from "@/lib/committee";
import { can } from "@/lib/permissions";

/**
 * PATCH /api/committee/sittings/:id — the desk writes into the sitting:
 *
 *  { notes }                    the minutes, autosaved as they are typed
 *  { attendance: [{memberId, admitted}] }  the door — admit or withdraw
 *  { close: true }              seal the sitting; minutes become evidence
 *
 * Everything is refused once the sitting is sealed — a record, not a draft.
 * The response is the fresh committee state so the desk re-renders from it.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const user = await getUserFromToken(token).catch(() => null);
    if (!user) {
      /* Committee records carry the officer's name — an anonymous write has
         no name to carry, so it is refused rather than filed as "unknown". */
      return NextResponse.json({ error: "Sign in to make changes — committee records carry the officer's name." }, { status: 401 });
    }
    if (!can(user.role, "manage_meetings")) {
      return NextResponse.json({ error: "Your workspace role cannot change a sitting." }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const attendance = Array.isArray(body.attendance)
      ? (body.attendance as unknown[])
          .slice(0, 60)
          .map((raw) => {
            const op = raw as { memberId?: unknown; admitted?: unknown };
            return { memberId: String(op.memberId ?? ""), admitted: op.admitted === true };
          })
          .filter((op) => op.memberId.length > 0)
      : undefined;

    const out = await mutateSitting(
      id,
      {
        notes: typeof body.notes === "string" ? body.notes : undefined,
        attendance,
        close: body.close === true,
      },
      user,
    );
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.code });
    return NextResponse.json(out.state);
  } catch (err) {
    console.error("[api/committee/sittings] failed:", err);
    return NextResponse.json({ error: "the sitting record could not be written" }, { status: 500 });
  }
}
