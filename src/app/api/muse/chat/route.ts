import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { museChat, museConfigFromEnv, type MuseMessage } from "@/lib/muse";
import { DESK_TOOLS, runDeskTool } from "@/lib/muse-desk-tools";
import { ACTION_TOOLS, buildProposal, isActionTool, proposalStagedNote, type Proposal } from "@/lib/muse-actions";
import { localAgent } from "@/lib/muse-local-brain";
import { zaiAgent } from "@/lib/muse-zai";
import { SYSTEM_MAP } from "@/lib/quorum-knowledge";

/**
 * POST /api/muse/chat — the desk agent's brain.
 *
 * This is a genuinely agentic loop, not a read-only parlor trick:
 *
 *   · READS run at once. The model asks for the desk — runs, approvals,
 *     deadlines, the committee register, one tender's record, the manual —
 *     the server executes the read against the quorum-mcp sidecar and feeds
 *     the result back for the next pass, up to MAX_ROUNDS.
 *   · ACTIONS are staged, never executed. approve_gate, reject_gate and
 *     launch_review produce an HMAC-signed proposal that the UI shows as a
 *     confirmation card. The action runs only when the officer confirms —
 *     through /api/muse/execute, under their own verified session, with a
 *     fresh step-up signature for a gate decision. The gavel stays human;
 *     the agent just carries it to the desk and waits.
 *   · With no MUSE_API_KEY set, the same loop runs on the platform's own
 *     served model (muse-zai) — a full LLM brain over a strict JSON tool
 *     dialect, same reads, same proposals, same consent cards — and the
 *     deterministic local brain (muse-local-brain) is the last resort if
 *     even that is unreachable. There is no setup notice: the product never
 *     depends on a secret to be useful.
 */

const MAX_ROUNDS = 5;
const MAX_HISTORY = 12;

export async function GET() {
  const config = museConfigFromEnv();
  return NextResponse.json(
    {
      metaAvailable: Boolean(config),
      metaModel: config?.model ?? null,
      automaticLabel: config ? "Meta Muse" : "Quorum AI",
    },
    { headers: { "cache-control": "no-store" } },
  );
}

const ChatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) }))
    .max(MAX_HISTORY)
    .optional()
    .default([]),
  /* The officer's first name, when signed in — the agent greets by it. */
  who: z.string().trim().max(80).optional(),
  modelPreference: z.enum(["automatic", "meta", "platform"]).default("automatic"),
});

const ALL_TOOLS = [...DESK_TOOLS, ...ACTION_TOOLS];

const SYSTEM_PROMPT = `You are Barry, Quorum's desk agent — the procurement officer's aide on a public-procurement tender review desk. You are genuinely agentic, and you say so: you read the desk live, and you can act on it.

${SYSTEM_MAP}

HOW YOU ACT. Reads are free: desk_snapshot, list_evaluations, list_approvals, list_audit, list_suppliers, list_deadlines, committee_state, find_tender, system_guide all run the moment you call them, and you should call them before answering anything about live work. Never invent a tender, a gate id, a number, a name or a date.

ACTIONS NEED CONSENT. approve_gate, reject_gate and launch_review do not execute when you call them — the desk stages a signed proposal and shows the officer a confirmation card. The action runs only when the officer confirms that card in the UI, and a gate decision additionally demands their fresh step-up signature. So:
  · When the officer's intent is to act — approve, sign, release, award, return, send back, launch, run a review — first read what you need (never propose blind: list_approvals for a gate, find_tender for a run), then call the action tool with the exact ids you read, then tell them plainly what is staged and why.
  · Never say you executed something. The correct tense is staged. The receipt comes back only after the officer confirms; if they decline, nothing happened.
  · One staged action per turn. If they want two things, stage the first, let them confirm, then stage the next.
  · An approve is irreversible once confirmed. If the officer's instruction is vague or impulsive, read the file and say what you see before staging — you are the intelligence in the room, not a rubber stamp.

If one live read fails, say exactly what failed (for example, "the committee register could not be read") and answer the part you can from system_guide. Do not say the whole desk is unreachable when only one service is down.

Answer as Barry, a sharp colleague at the desk: short sentences, plain words, the number that matters first. No bullet-point walls for a simple answer. No corporate padding, no "great question". If a deadline is overdue, lead with that. If something is waiting on a human, say who it is waiting for.

You are sometimes spoken to through a microphone, so answers are read aloud: keep them to a few sentences unless the officer asks for detail. Do not use markdown tables or code blocks in a spoken answer.`;

interface ChatOk {
  reply: string;
  model?: string;
  toolsRead: string[];
  proposal?: Proposal;
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = ChatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "A message is required." }, { status: 422 });
  }

  const { message, history, who, modelPreference } = parsed.data;
  const cfg = museConfigFromEnv();
  if (modelPreference === "meta" && !cfg) {
    return NextResponse.json(
      {
        error: "Meta Muse is not configured for this workspace. Choose Automatic or ask your workspace administrator to configure Meta access.",
      },
      { status: 503 },
    );
  }
  if (cfg && modelPreference !== "platform") {
    return NextResponse.json(await modelLoop(cfg, message, history, who));
  }
  /* No Meta key: the platform model carries the same agency, with the
     deterministic brain as the last resort. Every answer labels its model. */
  try {
    const result = await zaiAgent(message, history, who, ALL_TOOLS, SYSTEM_PROMPT, MAX_HISTORY);
    return NextResponse.json({ reply: result.reply, model: result.model, toolsRead: result.tools, ...(result.proposal ? { proposal: result.proposal } : {}) });
  } catch {
    return NextResponse.json(await localLoop(message, who));
  }
}

/* ── The model loop — Muse Spark with reads + consent-staged actions ─────── */

async function modelLoop(
  cfg: NonNullable<ReturnType<typeof museConfigFromEnv>>,
  message: string,
  history: { role: "user" | "assistant"; content: string }[],
  who?: string,
): Promise<ChatOk | { reply: string; error: string; toolsRead: string[] }> {
  const greeted = who ? `The officer asking is ${who}.` : "";
  const messages: MuseMessage[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${greeted}`.trim() },
    ...history.slice(-MAX_HISTORY).map<MuseMessage>((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  const toolsRead: string[] = [];
  let staged: Proposal | undefined;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const reply = await museChat(cfg, messages, staged ? DESK_TOOLS : ALL_TOOLS);

      if (reply.toolCalls.length === 0) {
        return { reply: reply.text || "I have nothing on that — try naming a tender reference.", model: reply.model, toolsRead };
      }

      /* Echo the assistant turn with its tool_calls intact — the API matches
         each result back to its call by id. The model picks tools by name
         only; it never writes a URL and never sees a session. */
      messages.push({ role: "assistant", content: reply.text || "", tool_calls: reply.rawToolCalls });

      let stagedThisRound = false;
      for (const call of reply.toolCalls) {
        /* An action call: stage it, tell the model, and stop the loop — the
           officer's consent is the next event, not another model pass. */
        if (isActionTool(call.name)) {
          if (staged) {
            toolsRead.push(call.name);
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify({ staged: false, note: "A proposal is already staged for this turn. Wait for the officer's decision before staging another." }),
            });
            continue;
          }
          const built = buildProposal(call.name, call.args);
          if ("error" in built) {
            toolsRead.push(call.name);
            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ staged: false, error: built.error }) });
            continue;
          }
          staged = built;
          toolsRead.push(call.name);
          messages.push({ role: "tool", tool_call_id: call.id, content: proposalStagedNote(call.name, built) });
          stagedThisRound = true;
          continue;
        }
        /* A read: run it now. */
        toolsRead.push(call.name);
        messages.push({ role: "tool", tool_call_id: call.id, content: await runDeskTool(call.name, call.args) });
      }

      /* The action is staged — one more pass so the model can explain the
         card in its own words, with no tools left to call. */
      if (stagedThisRound && staged) {
        const spoken = await museChat(cfg, messages, []);
        return { reply: spoken.text || staged.label, model: spoken.model, toolsRead, proposal: staged };
      }
    }

    /* Rounds exhausted — say so once, then answer from what it already read. */
    messages.push({
      role: "user",
      content: "(That is all the desk reads you get for this question. Answer now from what you already have.)",
    });
    const final = await museChat(cfg, messages, []);
    return { reply: final.text || "I could not finish that read — try again in a moment.", model: final.model, toolsRead };
  } catch (err) {
    return {
      reply: staged
        ? `${staged.label} is staged and still awaiting your confirmation on the card.`
        : "The model did not answer just now — try again in a moment. Nothing on the desk changed.",
      error: (err as Error).message.slice(0, 300),
      toolsRead,
    };
  }
}

/* ── The local loop — no key, no notice, same agency ─────────────────────── */

async function localLoop(message: string, who?: string): Promise<ChatOk> {
  try {
    const answer = await localAgent(message, who);
    return { reply: answer.reply, toolsRead: answer.tools, proposal: answer.proposal };
  } catch {
    return {
      reply:
        "The desk could not be read just now — the agent service looks briefly unreachable. Nothing changed, and nothing I could have staged moved.",
      toolsRead: [],
    };
  }
}
