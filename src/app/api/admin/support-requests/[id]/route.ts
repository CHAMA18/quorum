import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getUserFromToken, rateLimit, SESSION_COOKIE } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { respondToSupportRequest } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ReplySchema = z.object({ response: z.string().trim().min(2).max(4000) });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in to reply to a support request." }, { status: 401 });
  if (!can(user.role, "manage_people")) {
    return NextResponse.json({ error: "Only workspace owners and admins can respond to support requests." }, { status: 403 });
  }
  if (!rateLimit(`barry-support-reply:${user.id}`, 30, 15 * 60_000)) {
    return NextResponse.json({ error: "Too many support replies. Try again shortly." }, { status: 429 });
  }

  const { id } = await params;
  if (!/^sup_[A-Za-z0-9-]{8,20}$/.test(id)) {
    return NextResponse.json({ error: "Support request not found." }, { status: 404 });
  }
  const parsed = ReplySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Write a response between 2 and 4,000 characters." }, { status: 422 });
  }
  const request = respondToSupportRequest(id, user.workspaceId, user.name, parsed.data.response);
  if (!request) return NextResponse.json({ error: "Support request not found in this workspace." }, { status: 404 });

  return NextResponse.json({
    request: {
      id: request.id,
      status: request.status,
      response: request.response,
      respondedBy: request.respondedBy,
      respondedAt: request.respondedAt?.toISOString() ?? null,
      updatedAt: request.updatedAt.toISOString(),
    },
  }, { headers: { "cache-control": "no-store" } });
}
