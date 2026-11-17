import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromToken, rateLimit, SESSION_COOKIE } from "@/lib/auth";
import { kiraConfigFromEnv } from "@/lib/kira";
import { buildTenderDraft } from "@/lib/tender-build";

/**
 * POST /api/assistant/tender — the Tender Builder's brain.
 *
 * The officer describes a tender in plain words; this returns one structured
 * brief. The work lives in lib/tender-build (shared with the desk chat):
 * the deterministic composer reads the words and merges them into the
 * draft, then the open-weight model refines when one is wired. If the
 * model is unreachable, times out or answers something that is not JSON,
 * the composed draft and a plain reply are still returned. This surface
 * has no "AI is down" state: drafting a tender never depends on a remote
 * model, and nothing it produces is published — the officer commits it,
 * by name.
 */

const MAX_HISTORY = 8;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  message: z.string().trim().min(1).max(2000),
  draft: z.unknown().optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) }))
    .max(MAX_HISTORY)
    .optional()
    .default([]),
});

export async function GET() {
  const config = kiraConfigFromEnv();
  return NextResponse.json(
    {
      model: config?.model ?? null,
      modelAvailable: Boolean(config),
      /* The product's floor: drafting works with no model endpoint at all. */
      localComposer: true,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const user = await getUserFromToken(request.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in to draft a tender." }, { status: 401 });

  if (!rateLimit(`tender-builder:${user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: "That is a lot of drafts at once. Wait a minute and try again." }, { status: 429 });
  }

  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Send a sentence describing the tender." }, { status: 400 });
  }

  const result = await buildTenderDraft(body.data);

  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
