import { NextRequest, NextResponse } from "next/server";
import { publicAward } from "@/lib/public-award";

/** GET /api/public/award/:ref — no session; the signed award is a public record. */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ ref: string }> }) {
  const { ref } = await ctx.params;
  const award = await publicAward(ref).catch(() => null);
  if (!award) return NextResponse.json({ error: "No signed award for this tender." }, { status: 404 });
  return NextResponse.json(award, { headers: { "cache-control": "public, max-age=300" } });
}
