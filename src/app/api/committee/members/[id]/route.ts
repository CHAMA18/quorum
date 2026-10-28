import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { removeCommitteeMemberById, updateCommitteeMemberById } from "@/lib/committee";
import { can } from "@/lib/permissions";

/**
 * PATCH /api/committee/members/:id — update a registered member:
 *
 *  { status: "PRESENT" | "EXCUSED" }  excuse / return to the roll
 *  { isChair: true }                  move the chair seat (only one chair)
 *  { role }                           correct the role line
 *
 * DELETE /api/committee/members/:id — remove a member from the register.
 * An open sitting re-reads the register at its door; already-admitted
 * entries stay, because admissions are history.
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
    if (!can(user.role, "manage_committee")) {
      return NextResponse.json({ error: "Only owners and admins can change the committee register." }, { status: 403 });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const out = await updateCommitteeMemberById(
      id,
      { status: body.status, isChair: body.isChair, role: body.role, office: body.office },
      user,
    );
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.code });
    return NextResponse.json(out.state);
  } catch (err) {
    console.error("[api/committee/members/:id] failed:", err);
    return NextResponse.json({ error: "the roster update failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const user = await getUserFromToken(token).catch(() => null);
    if (!user) {
      /* Committee records carry the officer's name — an anonymous write has
         no name to carry, so it is refused rather than filed as "unknown". */
      return NextResponse.json({ error: "Sign in to make changes — committee records carry the officer's name." }, { status: 401 });
    }
    if (!can(user.role, "manage_committee")) {
      return NextResponse.json({ error: "Only owners and admins can change the committee register." }, { status: 403 });
    }

    const out = await removeCommitteeMemberById(id, user);
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.code });
    return NextResponse.json(out.state);
  } catch (err) {
    console.error("[api/committee/members/:id] failed:", err);
    return NextResponse.json({ error: "the member could not be removed" }, { status: 500 });
  }
}
