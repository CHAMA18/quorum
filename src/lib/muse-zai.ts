/**
 * Muse on the platform model — the full LLM-backed agentic brain that runs
 * when no MUSE_API_KEY is configured.
 *
 * The Meta Model API loop (muse.ts + chat/route.ts modelLoop) stays the
 * preferred brain: the moment a Meta key lands in the environment, the same
 * conversation runs on Muse Spark with native tool calls. Until then this
 * file keeps the agent genuinely LLM-backed on the platform's own served
 * model — same reads, same consent-staged actions, same voice — via
 * z-ai-web-dev-sdk (server-side only).
 *
 * The SDK exposes plain chat completions with no native function-calling, so
 * the tool loop rides a strict JSON dialect:
 *
 *   · the system prompt lists every desk tool with its schema;
 *   · to use one, the model answers with EXACTLY one JSON object —
 *       {"tool": "<name>", "args": { ... }}
 *     and nothing else;
 *   · the server runs the read (or stages the action) and hands the result
 *     back as a user-turn receipt, marked so the model cannot mistake it
 *     for the officer's voice;
 *   · any prose answer (or unparseable turn) ends the loop.
 *
 * Every answer reports the model id that produced it — provenance stays
 * visible, never implied. Nothing here depends on a secret: if the platform
 * call fails, the caller falls back to the deterministic local brain.
 */

import ZAI from "z-ai-web-dev-sdk";
import { runDeskTool } from "@/lib/muse-desk-tools";
import { buildProposal, isActionTool, proposalStagedNote, type Proposal } from "@/lib/muse-actions";

const MAX_ROUNDS = 5;

export interface ZaiAgentResult {
  reply: string;
  model: string;
  tools: string[];
  proposal?: Proposal;
}

const TOOL_PROTOCOL = `

HOW YOU USE TOOLS. You have no native function calls. To read the desk or stage an action, answer with EXACTLY one JSON object and nothing else — no prose, no code fence:
  {"tool": "<tool name>", "args": { ... }}
Tool names and argument names must match the list below exactly. The next message you receive will carry the tool's receipt, prefixed "(desk receipt". After reading a receipt, either call another tool the same way or answer the officer in plain prose. Plain prose (any text that is not a single JSON tool object) is your final answer to the officer — never wrap a final answer in JSON.
One tool call per turn. Never invent a receipt. If a read fails, say exactly what failed.

TOOLS:
`;

export async function zaiAgent(
  message: string,
  history: { role: "user" | "assistant"; content: string }[],
  who: string | undefined,
  tools: { name: string; description: string; parameters: Record<string, unknown> }[],
  systemPrompt: string,
  maxHistory = 12,
): Promise<ZaiAgentResult> {
  const zai = await ZAI.create();

  const toolSheet = tools
    .map((t) => `- ${t.name}: ${t.description} Args schema: ${JSON.stringify(t.parameters)}`)
    .join("\n");

  const greeted = who ? `\nThe officer asking is ${who}.` : "";
  const messages: { role: "assistant" | "user"; content: string }[] = [
    { role: "assistant", content: `${systemPrompt}${TOOL_PROTOCOL}${toolSheet}${greeted}`.trim() },
    ...history.slice(-maxHistory).map((m) => ({ role: m.role, content: m.content }) as const),
    { role: "user", content: message },
  ];

  const toolsRead: string[] = [];
  let staged: Proposal | undefined;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const completion = await zai.chat.completions.create({
      messages: [...messages],
      thinking: { type: "disabled" },
    });
    const model =
      (completion as { model?: string }).model?.trim() || "glm-4.6";
    const text = (completion.choices[0]?.message?.content ?? "").trim();
    if (!text) throw new Error("platform model returned an empty turn");

    const call = parseToolCall(text, tools);
    if (!call) {
      return { reply: text, model, tools: toolsRead, ...(staged ? { proposal: staged } : {}) };
    }

    if (isActionTool(call.tool)) {
      if (staged) {
        toolsRead.push(call.tool);
        messages.push({
          role: "user",
          content:
            '(desk receipt) A proposal is already staged for this turn. Wait for the officer\'s decision — answer in prose now.',
        });
        continue;
      }
      const built = buildProposal(call.tool, call.args);
      if ("error" in built) {
        toolsRead.push(call.tool);
        messages.push({
          role: "user",
          content: `(desk receipt) The desk refused to stage it: ${built.error} Answer the officer in prose.`,
        });
        continue;
      }
      staged = built;
      toolsRead.push(call.tool);
      messages.push({
        role: "user",
        content: `(desk receipt) ${proposalStagedNote(call.tool, built)} The card is on the officer's screen. Tell them plainly what is staged and why, in prose — one more tool call is not needed.`,
      });
      /* The staged action ends the loop: the officer's consent is the next
         event. One final pass produces the spoken explanation, with no tool
         allowed — anything JSON-shaped here would leak the dialect. */
      const spoken = await zai.chat.completions.create({
        messages: [
          ...messages,
          { role: "user", content: "(desk) Answer the officer in plain prose only. Do not call any tool." },
        ],
        thinking: { type: "disabled" },
      });
      const spokenModel = (spoken as { model?: string }).model?.trim() || model;
      return {
        reply: (spoken.choices[0]?.message?.content ?? "").trim() || built.label,
        model: spokenModel,
        tools: toolsRead,
        proposal: built,
      };
    }

    /* A read: run it now and hand the receipt back. */
    toolsRead.push(call.tool);
    let receipt: string;
    try {
      receipt = await runDeskTool(call.tool, call.args);
    } catch (err) {
      receipt = JSON.stringify({ error: (err as Error).message.slice(0, 200) });
    }
    messages.push({
      role: "user",
      content: `(desk receipt for ${call.tool}) ${receipt.slice(0, 6000)}`,
    });
  }

  /* Rounds exhausted — one prose pass from what it already read. */
  const final = await zai.chat.completions.create({
    messages: [
      ...messages,
      { role: "user", content: "(That is all the desk reads you get for this question. Answer now from what you already have, in plain prose.)" },
    ],
    thinking: { type: "disabled" },
  });
  return {
    reply: (final.choices[0]?.message?.content ?? "").trim() || "I could not finish that read — try again in a moment.",
    model: (final as { model?: string }).model?.trim() || "glm-4.6",
    tools: toolsRead,
    ...(staged ? { proposal: staged } : {}),
  };
}

/** Pull the single tool directive out of a turn, tolerating a code fence. */
function parseToolCall(
  text: string,
  tools: { name: string }[],
): { tool: string; args: Record<string, unknown> } | null {
  const known = new Set(tools.map((t) => t.name));
  const stripped = text.replace(/```[a-z]*\s*([\s\S]*?)```/gi, "$1").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  const candidate = stripped.slice(start, end + 1);
  try {
    const value: unknown = JSON.parse(candidate);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const tool = (value as { tool?: unknown }).tool;
    if (typeof tool !== "string" || !known.has(tool)) return null;
    const rawArgs = (value as { args?: unknown }).args;
    const args =
      rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : {};
    /* A JSON directive that also carries prose is ambiguous — accept it only
       when the JSON is the whole turn, so prose answers never fire tools. */
    if (stripped.replace(candidate, "").trim().length > 0) return null;
    return { tool, args };
  } catch {
    return null;
  }
}
