/**
 * Kira — Quorum's open-weight model client, used by the desk assistant and
 * the model-assisted review workflows.
 *
 * Kira is served through an OpenAI-compatible endpoint. The local development
 * default is Ollama at http://localhost:11434/v1 with llama3.2:3b; a deployed
 * or customized open-weight model can be selected with KIRA_BASE_URL and
 * KIRA_MODEL without changing any caller. Meta's API is still supported when
 * the base URL points at api.meta.ai; those calls use Responses with encrypted
 * reasoning replay and storage disabled.
 *
 * Voice remains a separate Meta model: Muse Voice Transcribe is the
 * speech-to-text path behind the mic button. It has its own endpoint and key
 * so switching Kira never silently moves audio to the Kira host.
 *
 * Nothing here is required to boot: with no Kira endpoint configured, the
 * assistant uses its deterministic local brain and review drafting uses the
 * template fallback.
 *
 * ── Environment ────────────────────────────────────────────────────────────
 *   KIRA_BASE_URL     default http://localhost:11434/v1 (Ollama)
 *   KIRA_API_KEY      optional bearer token; local Ollama needs none
 *   KIRA_MODEL        default llama3.2:3b (open weights)
 *   KIRA_REASONING_EFFORT  minimal|low|medium|high (Meta Responses only)
 *
 *   MUSE_VOICE_BASE_URL  default https://api.meta.ai/v1
 *   MUSE_VOICE_API_KEY   falls back to MUSE_API_KEY / LLM_API_KEY
 *   MUSE_VOICE_MODEL     default muse-voice-transcribe-1.0
 */

const DEFAULT_KIRA_BASE = "http://localhost:11434/v1";
const DEFAULT_VOICE_BASE = "https://api.meta.ai/v1";
const DEFAULT_KIRA_MODEL = "llama3.2:3b";
const DEFAULT_VOICE_MODEL = "muse-voice-transcribe-1.0";

export interface KiraConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort: "minimal" | "low" | "medium" | "high";
}

export interface MuseVoiceConfig {
  baseUrl: string;
  apiKey: string;
  voiceModel: string;
}

/**
 * Resolve the open-weight Kira endpoint. KIRA_ variables are authoritative;
 * the older LLM_ and MUSE_ names remain a migration fallback so an existing
 * deployment does not lose its model on upgrade. Local Ollama is the final
 * default and is deliberately keyless.
 */
export function kiraConfigFromEnv(env: Record<string, string | undefined> = process.env): KiraConfig | null {
  const explicitKiraBase = env.KIRA_BASE_URL?.trim();
  const configuredBase = explicitKiraBase || env.LLM_BASE_URL?.trim() || env.MUSE_BASE_URL?.trim();
  const configuredModel = env.KIRA_MODEL?.trim() || env.LLM_MODEL?.trim() || env.MUSE_MODEL?.trim();
  /* No model wiring at all means the deterministic local brain, not a silent
     attempt to reach a developer's Ollama instance in production. */
  if (!configuredBase && !configuredModel) return null;
  const baseUrl = (configuredBase || DEFAULT_KIRA_BASE).replace(/\/+$/, "");
  const apiKey = env.KIRA_API_KEY?.trim() || env.LLM_API_KEY?.trim() || env.MUSE_API_KEY?.trim() || "";
  const isLocal = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1])(?::\d+)?(?:\/|$)/i.test(baseUrl);
  if (!apiKey && !isLocal) return null;
  const configuredEffort = (env.KIRA_REASONING_EFFORT ?? env.MUSE_REASONING_EFFORT)?.trim().toLowerCase();
  return {
    baseUrl,
    apiKey,
    model: env.KIRA_MODEL?.trim() || (explicitKiraBase ? DEFAULT_KIRA_MODEL : configuredModel || DEFAULT_KIRA_MODEL),
    reasoningEffort: configuredEffort === "minimal" || configuredEffort === "low" || configuredEffort === "high" ? configuredEffort : "medium",
  };
}

/** Resolve the separate Meta voice endpoint; never reuse Kira's host. */
export function museVoiceConfigFromEnv(env: Record<string, string | undefined> = process.env): MuseVoiceConfig | null {
  const baseUrl = (env.MUSE_VOICE_BASE_URL?.trim() || env.MUSE_BASE_URL?.trim() || DEFAULT_VOICE_BASE).replace(/\/+$/, "");
  const apiKey = env.MUSE_VOICE_API_KEY?.trim() || env.MUSE_API_KEY?.trim() || env.LLM_API_KEY?.trim() || "";
  if (!apiKey) return null;
  return {
    baseUrl,
    apiKey,
    voiceModel: env.MUSE_VOICE_MODEL?.trim() || DEFAULT_VOICE_MODEL,
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
  /** Use stateless Chat Completions for simple single-turn calls. */
  useChatCompletions?: boolean;
}

export function museUsesResponses(cfg: Pick<KiraConfig, "baseUrl">): boolean {
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
  cfg: KiraConfig,
  messages: MuseMessage[],
  tools: { name: string; description: string; parameters: Record<string, unknown> }[],
  continuationInput?: unknown[],
  generation: MuseGenerationOptions = {},
): Promise<MuseChatReply> {
  if (museUsesResponses(cfg) && !generation.useChatCompletions) {
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
      throw new Error(`Kira Responses failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    const data = (await res.json().catch(() => null)) as { model?: string; output_text?: string; output?: unknown[]; status?: string } | null;
    if (data?.status && data.status !== "completed") throw new Error(`Kira Responses finished with status ${data.status}`);
    if (!data || !Array.isArray(data.output)) throw new Error("Kira Responses returned no output items");
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

  const responseFormat = generation.responseSchema
    ? {
        type: "json_schema",
        json_schema: {
          name: generation.responseSchema.name,
          schema: generation.responseSchema.schema,
          strict: true,
        },
      }
    : undefined;

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      ...(tools.length ? {
        tools: tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
        tool_choice: "auto",
      } : {}),
      ...(generation.maxOutputTokens ? { max_completion_tokens: generation.maxOutputTokens } : {}),
      ...(generation.reasoningEffort ? { reasoning_effort: generation.reasoningEffort } : {}),
      ...(generation.safetyIdentifier ? { safety_identifier: generation.safetyIdentifier } : {}),
      store: false,
      ...(responseFormat ? { response_format: responseFormat } : {}),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Kira chat failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const data = (await res.json().catch(() => null)) as { model?: string; choices?: { finish_reason?: string; message?: { content?: string | null; tool_calls?: unknown[] } }[] } | null;
  const choice = data?.choices?.[0];
  if (!choice) throw new Error("Kira chat returned no choices");
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
  cfg: MuseVoiceConfig,
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
