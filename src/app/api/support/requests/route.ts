import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getUserFromToken, rateLimit, SESSION_COOKIE } from "@/lib/auth";
import { createSupportRequest, listSupportRequests } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  subject: z.string().trim().min(4).max(120),
  message: z.string().trim().min(12).max(2000),
});

function publicRequest(row: ReturnType<typeof createSupportRequest>) {
  return {
    id: row.id,
    subject: row.subject,
    message: row.message,
    status: row.status,
    response: row.response ?? null,
    respondedBy: row.respondedBy ?? null,
    respondedAt: row.respondedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in to view your support requests." }, { status: 401 });
  if (!rateLimit(`barry-support-read:${user.id}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many support inbox reads. Try again shortly." }, { status: 429 });
  }
  const requests = listSupportRequests(user.workspaceId, user.id).map(publicRequest);
  return NextResponse.json({ requests }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in before sending a support request." }, { status: 401 });
  if (!rateLimit(`barry-support-create:${user.id}`, 5, 15 * 60_000)) {
    return NextResponse.json({ error: "Too many support requests. Wait a few minutes and try again." }, { status: 429 });
  }

  const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Add a subject and at least 12 characters describing what you need help with." },
      { status: 422 },
    );
  }

  const row = createSupportRequest({
    workspaceId: user.workspaceId,
    requesterId: user.id,
    requesterName: user.name,
    requesterEmail: user.email,
    subject: parsed.data.subject,
    message: parsed.data.message,
  });
  return NextResponse.json({ request: publicRequest(row) }, { status: 201, headers: { "cache-control": "no-store" } });
}
