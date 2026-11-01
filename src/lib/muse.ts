/**
 * Muse — the client for Meta's Model API (https://dev.meta.ai), used by the
 * desk assistant and other model-assisted workflows:
 *
 *   · Muse Spark          — the chat/agent model behind the assistant bubble;
 *   · Muse Voice Transcribe — speech-to-text for the mic button.
 *
 * Meta agent calls use Responses with encrypted reasoning replay and storage
 * disabled. Local OpenAI-compatible endpoints retain Chat Completions. Voice
 * transcription uses the dedicated ASR route.
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
  reasoningEffort: "minimal" | "low" | "medium" | "high";
}

/**
 * The key may live under its own name or reuse the Meta hosting token the
 * repo already documents in .env.example — one console key, two jobs.
 */
export function museConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MuseConfig | null {
  const baseUrl = (env.MUSE_BASE_URL?.trim() || env.LLM_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
  const apiKey = env.MUSE_API_KEY?.trim() || env.LLM_API_KEY?.trim() || "";
  if (!apiKey) return null;
  const configuredEffort = env.MUSE_REASONING_EFFORT?.trim().toLowerCase();
  return {
    baseUrl,
    apiKey,
    model: env.MUSE_MODEL?.trim() || "muse-spark-1.3",
    voiceModel: env.MUSE_VOICE_MODEL?.trim() || "muse-voice-transcribe-1.0",
    reasoningEffort: configuredEffort === "minimal" || configuredEffort === "low" || configuredEffort === "high" ? configuredEffort : "medium",
  };
}

/* ── Responses API agent calls; Chat Completions remains for local endpoints ─ */

export type MuseToolCall = { id: string; name: string; args: Record<string, unknown> };
export type MuseRawToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export interface MuseChatReply {
  text: string;
  toolCalls: MuseToolCall[];
  rawToolCalls: MuseRawToolCall[];
  finish: string;
  model: string;
  /** Raw Responses output is replayed in the next stateless tool turn. It may
   * contain encrypted reasoning items; callers must keep it server-side. */
  responseItems?: unknown[];
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
      if (value && typeof value === "object" && !Array.isArray(value)) parsedArgs = value as Record<string, unknown>;
    } catch { /* malformed arguments are dropped, never guessed at */ }
    parsed.push({ id, name: fn.name, args: parsedArgs });
    raw.push({ id, type: "function", function: { name: fn.name, arguments: args } });
  }
  return { parsed, raw };
}

export type MuseMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: MuseRawToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface MuseGenerationOptions {
  responseSchema?: { name: string; schema: Record<string, unknown> };
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  maxOutputTokens?: number;
  safetyIdentifier?: string;
}

export function museUsesResponses(cfg: MuseConfig): boolean {
  try {
    const host = new URL(cfg.baseUrl).hostname.toLowerCase();
    return host === "api.meta.ai" || host.endsWith(".api.meta.ai");
  } catch { return false; }
}

export function museResponsesInput(messages: MuseMessage[]): unknown[] {
  const input: unknown[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      input.push({ type: "function_call_output", call_id: message.tool_call_id, output: message.content });
    } else if (message.role === "assistant" && message.tool_calls?.length) {
      if (message.content) input.push({ role: "assistant", content: message.content });
      for (const call of message.tool_calls) input.push({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments });
    } else {
      input.push({ role: message.role, content: message.content });
    }
  }
  return input;
}

export async function museChat(
  cfg: MuseConfig,
  messages: MuseMessage[],
  tools: { name: string; description: string; parameters: Record<string, unknown> }[],
  continuationInput?: unknown[],
  generation: MuseGenerationOptions = {},
): Promise<MuseChatReply> {
  if (museUsesResponses(cfg)) {
    const res = await fetch(`${cfg.baseUrl}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        input: continuationInput ?? museResponsesInput(messages),
        store: false,
        include: ["reasoning.encrypted_content"],
        reasoning: { effort: generation.reasoningEffort ?? cfg.reasoningEffort },
        max_output_tokens: generation.maxOutputTokens ?? 3000,
        ...(generation.safetyIdentifier ? { safety_identifier: generation.safetyIdentifier } : {}),
        ...(generation.responseSchema ? { text: { format: { type: "json_schema", name: generation.responseSchema.name, schema: generation.responseSchema.schema, strict: true } } } : {}),
        tools: tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters, strict: false })),
        tool_choice: tools.length ? "auto" : "none",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Muse Responses failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    const data = (await res.json().catch(() => null)) as { model?: string; output_text?: string; output?: unknown[]; status?: string } | null;
    if (data?.status && data.status !== "completed") throw new Error(`Muse Responses finished with status ${data.status}`);
    if (!data || !Array.isArray(data.output)) throw new Error("Muse Responses returned no output items");
    const calls: MuseToolCall[] = [];
    const rawCalls: MuseRawToolCall[] = [];
    const outputText: string[] = [];
    for (const value of data.output) {
      if (!value || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      if (item.type === "function_call" && typeof item.name === "string") {
        const id = String(item.call_id ?? item.id ?? item.name);
        const argsText = typeof item.arguments === "string" ? item.arguments : "{}";
        let args: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(argsText);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
        } catch { /* server-side permission and argument validation fail closed */ }
        calls.push({ id, name: item.name, args });
        rawCalls.push({ id, type: "function", function: { name: item.name, arguments: argsText } });
      }
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (!part || typeof part !== "object") continue;
          const text = (part as Record<string, unknown>).text;
          if (typeof text === "string") outputText.push(text);
        }
      }
    }
    return {
      text: (data.output_text ?? outputText.join("\n")).trim(),
      toolCalls: calls,
      rawToolCalls: rawCalls,
      finish: data.status ?? (calls.length ? "tool_calls" : "stop"),
      model: data.model ?? cfg.model,
      responseItems: data.output,
    };
  }

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      tools: tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
      tool_choice: tools.length ? "auto" : "none",
      temperature: 0.2,
      ...(generation.responseSchema ? { response_format: { type: "json_schema", json_schema: { name: generation.responseSchema.name, schema: generation.responseSchema.schema, strict: true } } } : {}),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Muse chat failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const data = (await res.json().catch(() => null)) as { model?: string; choices?: { finish_reason?: string; message?: { content?: string | null; tool_calls?: unknown[] } }[] } | null;
  const choice = data?.choices?.[0];
  if (!choice) throw new Error("Muse chat returned no choices");
  const calls = toolCallsOf(choice.message);
  return { text: (choice.message?.content ?? "").trim(), toolCalls: calls.parsed, rawToolCalls: calls.raw, finish: choice.finish_reason ?? "stop", model: data?.model ?? cfg.model };
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
