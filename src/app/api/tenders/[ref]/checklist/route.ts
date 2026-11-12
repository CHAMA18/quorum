import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getSetting, setSetting } from "@/lib/db";

const keyFor = (ref: string) => `contract-checklist:${ref}`;
function readItems(ref: string): Record<string, boolean> {
  try {
    const raw = getSetting(keyFor(ref));
    const parsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const PostSchema = z.object({ items: z.record(z.string().max(200), z.boolean()) });

/** GET/POST /api/tenders/:ref/checklist — ticked state of the contract pack. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ ref: string }> }) {
  const user = await getUserFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { ref } = await ctx.params;
  return NextResponse.json({ items: readItems(ref) });
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ ref: string }> }) {
  const user = await getUserFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user.role, "run_reviews")) return NextResponse.json({ error: "Review access required." }, { status: 403 });
  const parsed = PostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid checklist." }, { status: 422 });
  const { ref } = await ctx.params;
  setSetting(keyFor(ref), JSON.stringify(parsed.data.items));
  return NextResponse.json({ items: parsed.data.items });
}
