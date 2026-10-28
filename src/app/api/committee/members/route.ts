import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { addCommitteeMember } from "@/lib/committee";
import { can } from "@/lib/permissions";

/**
 * POST /api/committee/members — register a member of the committee.
 *
 * The register is what the door of every open sitting reads: only names
 * registered here (plus the signed-in officer, who holds the gavel) are
 * admitted to a meeting, and only PRESENT members count toward quorum.
 * The response is the fresh committee state.
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
    if (!can(user.role, "manage_committee")) {
      return NextResponse.json({ error: "Only owners and admins can change the committee register." }, { status: 403 });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const out = await addCommitteeMember(
      { name: body.name, role: body.role, isChair: body.isChair, office: body.office },
      user,
    );
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.code });
    return NextResponse.json(out.state, { status: 201 });
  } catch (err) {
    console.error("[api/committee/members] failed:", err);
    return NextResponse.json({ error: "the member could not be registered" }, { status: 500 });
  }
}
