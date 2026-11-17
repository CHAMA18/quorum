import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromToken, rateLimit, SESSION_COOKIE } from "@/lib/auth";
import { kiraConfigFromEnv, kiraChat, type KiraMessage, type ModelUsage } from "@/lib/kira";
import {
  composeTenderDraft,
  composerReply,
  draftGaps,
  emptyDraft,
  extractJsonObject,
  normalizeDraft,
  preferVerbatim,
  type TenderDraft,
} from "@/lib/tender-draft";

/**
 * POST /api/assistant/tender — the Tender Builder's brain.
 *
 * The officer describes a tender in plain words; this returns one structured
 * brief. Two paths, in this order, always producing a draft:
 *
 *   1. the deterministic composer reads the words themselves (budget, closing
 *      date, buyer, category) and merges them into the draft the client sent;
 *   2. the workspace's open-weight model (Kira, llama3.2:3b on Ollama by
 *      default — keyless, so there is no credential that can expire) refines
 *      that draft and writes the reply.
 *
 * If the model is unreachable, times out or answers something that is not
 * JSON, step 1's draft and a plain reply are still returned. This surface has
 * no "AI is down" state: drafting a tender never depends on a remote model,
 * and nothing it produces is published — the officer commits it, by name.
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

const SYSTEM_PROMPT = `You are Quorum's tender builder: a public-procurement officer's drafting aide. You turn a conversation into one structured tender brief for review.

RULES
- Never invent a budget, a buyer, a closing date, a reference number or a committee. If the officer has not said it, leave the field as it is in CURRENT DRAFT and say what you still need.
- Keep every value in CURRENT DRAFT unless this message changes it. A refinement is an edit, not a rewrite.
- Write for the buyer's own regime (Kenya PPRA / KRA PIN, Rwanda RPPA / UMUCYO, Zambia ZPPA / ZRA, or as the brief states): use that regime's registration, tax-clearance and supplier-register names — never another country's. Plain words, no marketing language.
- Evaluation weights must add to 100.
- The draft is preparation only. Nothing is published, and you cannot award or approve anything.
- Return the whole tender object every time, not a patch. Keep the title, buyer, budget, closing date and contract term exactly as CURRENT DRAFT has them unless this message changes them.

ANSWER with one JSON object and nothing else — no prose before or after, no code fence:
{"tender":{"title":"","buyer":"","category":"","summary":"","budget":number|null,"currency":"ZMW","closingDate":"YYYY-MM-DD"|null,"contractMonths":number|null,"eligibility":[""],"evaluation":[{"criterion":"","weight":30}],"documents":[""]}}`;

async function refineWithModel(
  config: NonNullable<ReturnType<typeof kiraConfigFromEnv>>,
  message: string,
  draft: TenderDraft,
  history: { role: "user" | "assistant"; content: string }[],
): Promise<{ draft: TenderDraft; usage: ModelUsage }> {
  const messages: KiraMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
  for (const turn of history.slice(-MAX_HISTORY)) {
    messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({
    role: "user",
    content: `CURRENT DRAFT:\n${JSON.stringify(draft)}\n\nOFFICER: ${message}`,
  });

  const answer = await kiraChat(config, messages, [], {
    maxOutputTokens: 900,
    /* A local 3B model can take a while to load on the first request; a
       warm turn answers in seconds. 90s keeps that first draft alive. */
    timeoutMs: 90_000,
  });
  const parsed = extractJsonObject(answer.text);
  if (!parsed) throw new Error("the model did not answer with a tender object");
  const tender = parsed.tender && typeof parsed.tender === "object" ? parsed.tender : parsed;
  return { draft: preferVerbatim(draft, normalizeDraft(tender, draft)), usage: answer.usage };
}

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

  const seen = body.data.draft ? normalizeDraft(body.data.draft, emptyDraft()) : null;
  let draft = composeTenderDraft(body.data.message, seen ?? emptyDraft());
  let composer: "model" | "local" = "local";
  let model: string | null = null;
  let usage: ModelUsage | null = null;
  let modelCalls = 0;

  const config = kiraConfigFromEnv();
  if (config) {
    /* One retry: open-weight endpoints stutter (model loading, a dropped
       socket) far more often than they fail for good. */
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const refined = await refineWithModel(config, body.data.message, draft, body.data.history);
        draft = refined.draft;
        usage = refined.usage;
        modelCalls += 1;
        composer = "model";
        model = config.model;
        break;
      } catch {
        if (attempt === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }

  const reply = composerReply(draft, seen ?? undefined);

  return NextResponse.json(
    {
      reply,
      draft,
      gaps: draftGaps(draft),
      composer,
      model,
      usage,
      modelCalls,
      /* Named so the officer always knows what wrote the brief. */
      composedBy: composer === "model" ? model : "deterministic composer",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
