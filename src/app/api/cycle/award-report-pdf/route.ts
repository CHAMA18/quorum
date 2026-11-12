import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { renderAwardPdf } from "@/lib/award-pdf";

const BodySchema = z.object({
  tenderId: z.string().min(3).max(80),
  recommendation: z.string().max(200).optional(),
  signedBy: z.string().max(120).optional(),
  signedAt: z.string().max(40).optional(),
  sha: z.string().max(80).optional(),
  bids: z.array(z.object({ bidder: z.string().max(200), total: z.union([z.number(), z.string().max(40)]).optional(), verdict: z.string().max(60).optional() })).max(30),
  findings: z.array(z.object({ rule: z.string().max(80), severity: z.string().max(20), item: z.string().max(300) })).max(40),
});

/** POST /api/cycle/award-report-pdf — render the recorded award report as PDF. */
export async function POST(request: NextRequest) {
  const user = await getUserFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user.role, "read_documents")) return NextResponse.json({ error: "Document access required." }, { status: 403 });
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid award report payload." }, { status: 422 });
  const pdf = await renderAwardPdf(parsed.data);
  return new NextResponse(Buffer.from(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="award-report-${parsed.data.tenderId}.pdf"` },
  });
}
