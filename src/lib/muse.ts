/**
 * Muse — the client for Meta's Model API (https://dev.meta.ai), used by the
 * desk assistant's two model calls:
 *
 *   · Muse Spark          — the chat/agent model behind the assistant bubble;
 *   · Muse Voice Transcribe — speech-to-text for the mic button.
 *
 * Both ride the same base URL and bearer key, and both are OpenAI-shaped, so
 * this stays a thin fetch wrapper with no SDK dependency — the same call the
 * redline path makes to any OpenAI-compatible endpoint (LLM_BASE_URL).
 *
 * Nothing here is required to boot: with no key the routes answer with a
 * labelled "not configured" notice and the product is otherwise unaffected —
 * the same contract the redline template fallback keeps.
 *
 * ── Environment ────────────────────────────────────────────────────────────
 *   MUSE_API_KEY      bearer token from the Meta developer console
 *                     (falls back to LLM_API_KEY, which the hackathon wiring
 *                     already uses for the hosted Meta endpoint)
 *   MUSE_BASE_URL     default https://api.meta.ai/v1
 *   MUSE_MODEL        default muse-spark-1.3   (chat)
 *   MUSE_VOICE_MODEL  default muse-voice-transcribe-1.0
 */

const DEFAULT_BASE = "https://api.meta.ai/v1";

export interface MuseConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  voiceModel: string;
}

/**
 * The key may live under its own name or reuse the Meta hosting token the
 * repo already documents in .env.example — one console key, two jobs.
 */
export function museConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MuseConfig | null {
  const baseUrl = (env.MUSE_BASE_URL?.trim() || env.LLM_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
  const apiKey = env.MUSE_API_KEY?.trim() || env.LLM_API_KEY?.trim() || "";
  if (!apiKey) return null;
  return {
    baseUrl,
    apiKey,
    model: env.MUSE_MODEL?.trim() || "muse-spark-1.3",
    voiceModel: env.MUSE_VOICE_MODEL?.trim() || "muse-voice-transcribe-1.0",
  };
}

/* ── Chat completions (OpenAI-compatible) ────────────────────────────────── */

export type MuseToolCall = { id: string; name: string; args: Record<string, unknown> };

/* The wire shape the API asks to see echoed back on the assistant turn that
   requested the calls — `tool_call_id` on each result must match an id here. */
export type MuseRawToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export interface MuseChatReply {
  text: string;
  /* Present when the model asked to read the desk — the caller runs them and
     feeds the results back for a second pass. */
  toolCalls: MuseToolCall[];
  rawToolCalls: MuseRawToolCall[];
  finish: string;
  model: string;
}

function toolCallsOf(message: unknown): { parsed: MuseToolCall[]; raw: MuseRawToolCall[] } {
  const rawIn = (message as { tool_calls?: unknown[] })?.tool_calls ?? [];
  const parsed: MuseToolCall[] = [];
  const raw: MuseRawToolCall[] = [];
  for (const call of rawIn) {
    const fn = (call as { function?: { name?: string; arguments?: string } })?.function;
    if (!fn?.name) continue;
    const id = String((call as { id?: string })?.id ?? fn.name);
    const args = fn.arguments ?? "{}";
    let parsedArgs: Record<string, unknown> = {};
    try {
      const value: unknown = JSON.parse(args);
      if (value && typeof value === "object") parsedArgs = value as Record<string, unknown>;
    } catch {
      /* an unparseable argument blob is dropped, never guessed at */
    }
    parsed.push({ id, name: fn.name, args: parsedArgs });
    raw.push({ id, type: "function", function: { name: fn.name, arguments: args } });
  }
  return { parsed, raw };
}

export type MuseMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: MuseRawToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export async function museChat(
  cfg: MuseConfig,
  messages: MuseMessage[],
  tools: { name: string; description: string; parameters: Record<string, unknown> }[]
): Promise<MuseChatReply> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      /* The desk assistant only ever READS: every exposed tool is a GET
         against records that already exist. There is no tool here that can
         sign, award, return, file or summon — the gavel is not in this API. */
      tools: tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      tool_choice: "auto",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Muse chat failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const data = (await res.json().catch(() => null)) as
    | {
        model?: string;
        choices?: { finish_reason?: string; message?: { content?: string | null; tool_calls?: unknown[] } }[];
      }
    | null;
  const choice = data?.choices?.[0];
  if (!choice) throw new Error("Muse chat returned no choices");
  const calls = toolCallsOf(choice.message);
  return {
    text: (choice.message?.content ?? "").trim(),
    toolCalls: calls.parsed,
    rawToolCalls: calls.raw,
    finish: choice.finish_reason ?? "stop",
    model: data?.model ?? cfg.model,
  };
}

/* ── Voice transcribe (speech-to-text) ───────────────────────────────────── */

export interface MuseTranscript {
  text: string;
  turns: string[];
}

/**
 * POST /v1/asr/transcribe — one recording, one request.
 * multipart/form-data: `request` (JSON settings) + `audio` (the clip).
 * The response shape is read defensively: the turn array is the documented
 * form, but a bare transcript body is accepted too.
 */
export async function museTranscribe(
  cfg: MuseConfig,
  audio: Blob,
  filename: string
): Promise<MuseTranscript> {
  const form = new FormData();
  form.append(
    "request",
    new Blob(
      [
        JSON.stringify({
          model: cfg.voiceModel,
          audioEncoding: "WAV",
          mode: "PUSH_TO_TALK",
          languageBias: ["English"],
          /* Procurement vocabulary the recognizer would otherwise mangle. */
          keywords: [
            "Quorum", "tender", "procurement", "RWF", "KRA", "PACRA", "ZRA", "OCDS",
            "RURA", "ZPPA", "standstill", "ALB", "quorum", "gate",
          ],
        }),
      ],
      { type: "application/json" }
    )
  );
  form.append("audio", audio, filename || "clip.wav");

  const res = await fetch(`${cfg.baseUrl}/asr/transcribe`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.apiKey}`,
      accept: "application/json",
    },
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Muse voice failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data) return { text: "", turns: [] };

  const turnsRaw = (data.turns ?? data.results) as unknown;
  const turns = Array.isArray(turnsRaw)
    ? turnsRaw
        .map((t) =>
          typeof t === "string"
            ? t
            : String(((t as { transcript?: unknown })?.transcript ?? "") as string).trim()
        )
        .filter(Boolean)
    : [];
  const text = String(data.text ?? data.transcript ?? turns.join(" ")).trim();
  return { text, turns };
}
