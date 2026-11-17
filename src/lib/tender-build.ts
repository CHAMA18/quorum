/**
 * The tender-building path, shared by the builder endpoint and the desk
 * chat. One place owns "turn a message into a structured brief": the
 * deterministic composer reads the words, then the open-weight model
 * refines when one is wired. Either way a draft comes back — this
 * surface has no "AI is down" state, and nothing it produces is
 * published; the officer commits it, by name.
 *
 * The desk chat routes here only on a deterministic intent signal
 * (isTenderBuildingIntent), never on the model's judgement — a question
 * about tenders must never be mistaken for a request to build one.
 */

import { kiraConfigFromEnv, kiraChat, type KiraMessage, type ModelUsage } from "@/lib/kira";
import {
  composeTenderDraft,
  composerReply,
  draftGaps,
  emptyDraft,
  extractJsonObject,
  normalizeDraft,
  preferVerbatim,
  type DraftGap,
  type TenderDraft,
} from "@/lib/tender-draft";

const MAX_HISTORY = 8;

export interface BuildTenderDraftResult {
  reply: string;
  draft: TenderDraft;
  gaps: DraftGap[];
  composer: "model" | "local";
  model: string | null;
  usage: ModelUsage | null;
  modelCalls: number;
  /** Named so the officer always knows what wrote the brief. */
  composedBy: string;
}

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

export async function buildTenderDraft(input: {
  message: string;
  draft?: unknown;
  history?: { role: "user" | "assistant"; content: string }[];
}): Promise<BuildTenderDraftResult> {
  const seen = input.draft ? normalizeDraft(input.draft, emptyDraft()) : null;
  let draft = composeTenderDraft(input.message, seen ?? emptyDraft());
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
        const refined = await refineWithModel(config, input.message, draft, input.history ?? []);
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

  return {
    reply: composerReply(draft, seen ?? undefined),
    draft,
    gaps: draftGaps(draft),
    composer,
    model,
    usage,
    modelCalls,
    composedBy: composer === "model" ? (model ?? "model") : "deterministic composer",
  };
}

/* ── Intent routing ──────────────────────────────────────────────────────── */

/**
 * Does this message ask to build a tender? Deterministic and narrow on
 * purpose: the desk chat also answers questions *about* tenders, and
 * those must stay in the chat. Three signals, any one is enough:
 *
 *   1. an explicit build/draft verb with "tender" or "procurement";
 *   2. a tender description that opens with a procurement verb and
 *      carries a budget, currency or closing signal (the builder's
 *      starter sentences);
 *   3. an active draft session — the client sends the current draft
 *      with every follow-up, so a refinement ("budget ZMW 2 million")
 *      needs no keywords at all.
 */
export function isTenderBuildingIntent(message: string, hasDraft: boolean): boolean {
  if (hasDraft) return true;
  const text = message.toLowerCase();
  /* Explicit request: a build verb with "tender"/"procurement" close
     behind it. Proximity matters — "draft a committee brief on the
     tender" is a question about a tender, not a build request. */
  if (/\b(draft|build|create|prepare|write|new|start|open)\b[^.]{0,24}\b(tender|procurement)\b/.test(text)) {
    return true;
  }
  /* A tender description: opens with a procurement verb (after an
     optional article and duration — "A 12-month cleaning contract…")
     and carries a budget, currency or closing signal. */
  const opening = text
    .replace(/^\s*(a|an|the)\s+/, "")
    .replace(/^\s*\d+\s*[- ]?months?\s+/, "");
  const hasProcurementSignal =
    /(budget|zmw|kes|usd|million|closing|closes?|deadline|january|february|march|april|may|june|july|august|september|october|november|december|in \d+ days?|\d{4}-\d{2}-\d{2})/.test(
      text,
    );
  if (
    hasProcurementSignal &&
    (/^\s*(supply|procurement|delivery|deliver|provision|hire|lease|consultancy|contract for|services for|construction of)\b/.test(
      opening,
    ) ||
      /\bcontract\b/.test(opening))
  ) {
    return true;
  }
  return false;
}
