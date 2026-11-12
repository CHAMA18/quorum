import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getSetting, setSetting } from "@/lib/db";

interface FindingMeta {
  assignee?: string;
  due?: string;
  comments: { by: string; at: string; text: string }[];
}

const keyFor = (runId: string, findingId: string) => `finding-meta:${runId}:${findingId}`;
function readMeta(runId: string, findingId: string): FindingMeta {
  try {
    const raw = getSetting(keyFor(runId, findingId));
    const parsed = raw ? (JSON.parse(raw) as FindingMeta) : null;
    return { assignee: parsed?.assignee, due: parsed?.due, comments: Array.isArray(parsed?.comments) ? parsed!.comments : [] };
  } catch {
    return { comments: [] };
  }
}

const PostSchema = z.object({
  runId: z.string().min(1).max(80),
  findingId: z.string().min(1).max(80),
  assignee: z.string().max(120).optional(),
  due: z.string().max(20).optional(),
  comment: z.string().max(1000).optional(),
});

/** GET/POST /api/findings/meta — assignment and comments on a run finding. */
export async function GET(request: NextRequest) {
  const user = await getUserFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const runId = request.nextUrl.searchParams.get("run") ?? "";
  const findingId = request.nextUrl.searchParams.get("finding") ?? "";
  if (!runId || !findingId) return NextResponse.json({ error: "run and finding are required." }, { status: 422 });
  return NextResponse.json({ meta: readMeta(runId, findingId) });
}

export async function POST(request: NextRequest) {
  const user = await getUserFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user.role, "run_reviews")) return NextResponse.json({ error: "Review access required." }, { status: 403 });
  const parsed = PostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid finding metadata." }, { status: 422 });
  const meta = readMeta(parsed.data.runId, parsed.data.findingId);
  if (parsed.data.assignee !== undefined) meta.assignee = parsed.data.assignee || undefined;
  if (parsed.data.due !== undefined) meta.due = parsed.data.due || undefined;
  if (parsed.data.comment?.trim()) meta.comments = [...meta.comments, { by: user.name, at: new Date().toISOString(), text: parsed.data.comment.trim() }].slice(-50);
  setSetting(keyFor(parsed.data.runId, parsed.data.findingId), JSON.stringify(meta));
  return NextResponse.json({ meta });
}
