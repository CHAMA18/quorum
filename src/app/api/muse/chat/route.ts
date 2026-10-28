import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { museChat, museConfigFromEnv, type MuseMessage } from "@/lib/muse";
import { DESK_TOOLS, runDeskTool } from "@/lib/muse-desk-tools";

/**
 * POST /api/muse/chat — the desk assistant's brain.
 *
 * Muse Spark (Meta Model API) answers, and it is genuinely agentic: it may
 * ask to read the desk, the server runs that read against the quorum-mcp
 * sidecar, and the results go back to the model for a second pass — up to
 * MAX_ROUNDS times, so a chatty model cannot spin the sidecar.
 *
 * The tool surface is READ-ONLY by construction: the executors in
 * muse-desk-tools are all GETs, and there is no write path wired here. The
 * assistant can tell you what is waiting at the gate; it cannot sign it.
 * That is the same line the review graph draws, drawn again in the API.
 */

const MAX_ROUNDS = 4;
const MAX_HISTORY = 12;

const ChatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) }))
    .max(MAX_HISTORY)
    .optional()
    .default([]),
  /* The officer's first name, when signed in — the assistant greets by it. */
  who: z.string().trim().max(80).optional(),
});

const SYSTEM_PROMPT = `You are Quorum's desk assistant — a procurement officer's aide on a public-procurement tender review desk.

You are read-only. You can look at the desk; you can never change it. If someone asks you to award, sign, approve, return, file or summon anything, say plainly that only a named human on the committee can do that, at the Approvals gate or the Committee screen. Never imply you did it.

Use the tools. For anything about live work — what is running, what is waiting at the gate, what a tender's record says, whether quorum is present, which clocks are running — call a tool before you answer. Never invent a tender, a number, a name or a date. If a tool reports the desk unreachable, say the service is briefly unreachable; do not fill the gap with a guess.

Answer the way a sharp colleague at the desk talks: short sentences, plain words, the number that matters first. No bullet-point walls for a simple answer. No corporate padding, no "great question". If a deadline is overdue, lead with that. If something is waiting on a human, say who it is waiting for.

You are sometimes spoken to through a microphone, so answers are read aloud: keep them to a few sentences unless the officer asks for detail.`;

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

  const cfg = museConfigFromEnv();
  if (!cfg) {
    /* Same contract as the redline path: no key, nothing breaks — the UI
       shows the setup line instead of a fake answer. */
    return NextResponse.json({
      configured: false,
      reply:
        "The desk assistant has no model key yet. Set MUSE_API_KEY (or LLM_API_KEY) from your Meta developer console and reload — nothing else changes.",
    });
  }

  const { message, history, who } = parsed.data;
  const greeted = who ? `The officer asking is ${who}.` : "";

  const messages: MuseMessage[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${greeted}`.trim() },
    /* History is trimmed to the most recent turns so a long session never
       runs the meter. The client sends only user/assistant text turns. */
    ...history.slice(-MAX_HISTORY).map<MuseMessage>((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  const toolsRead: string[] = [];
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const reply = await museChat(cfg, messages, DESK_TOOLS);

      if (reply.toolCalls.length === 0) {
        return NextResponse.json({
          configured: true,
          reply: reply.text || "I have nothing on that — try naming a tender reference.",
          model: reply.model,
          toolsRead,
        });
      }

      /* Echo the assistant turn with its tool_calls intact — the API matches
         each result back to its call by id. The model picks tools by name
         only; it never writes a URL and never sees a session. */
      messages.push({ role: "assistant", content: reply.text || "", tool_calls: reply.rawToolCalls });
      for (const call of reply.toolCalls) {
        toolsRead.push(call.name);
        messages.push({ role: "tool", tool_call_id: call.id, content: await runDeskTool(call.name, call.args) });
      }
    }

    /* Rounds exhausted — say so once, then answer from what it already read. */
    messages.push({
      role: "user",
      content: "(That is all the desk reads you get for this question. Answer now from what you already have.)",
    });
    const final = await museChat(cfg, messages, []);
    return NextResponse.json({
      configured: true,
      reply: final.text || "I could not finish that read — try again in a moment.",
      model: final.model,
      toolsRead,
    });
  } catch (err) {
    return NextResponse.json(
      {
        configured: true,
        reply: "The model did not answer just now — try again in a moment. Nothing on the desk changed.",
        error: (err as Error).message.slice(0, 300),
      },
      { status: 502 }
    );
  }
}
