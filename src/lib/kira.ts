/**
 * Kira — Quorum's open-weight model client, used by the desk assistant and
 * the model-assisted review workflows.
 *
 * Kira is served through an OpenAI-compatible Chat Completions endpoint. The
 * local development default is Ollama at http://localhost:11434/v1 with
 * llama3.2:3b; a deployed or customized open-weight model can be selected
 * with KIRA_BASE_URL and KIRA_MODEL without changing any caller.
 *
 * Nothing here is required to boot: with no Kira endpoint configured, the
 * assistant uses its deterministic local brain and review drafting uses the
 * template fallback.
 *
 * ── Environment ────────────────────────────────────────────────────────────
 *   KIRA_BASE_URL     default http://localhost:11434/v1 (Ollama)
 *   KIRA_API_KEY      optional bearer token; local Ollama needs none
 *   KIRA_MODEL        default llama3.2:3b (open weights)
 *   KIRA_REASONING_EFFORT  minimal|low|medium|high, forwarded when supported
 *
 *   LLM_BASE_URL / LLM_MODEL / LLM_API_KEY are the older explicit names; they
 *   are read only when the corresponding KIRA_ variable is absent.
 */

const DEFAULT_KIRA_BASE = "http://localhost:11434/v1";
const DEFAULT_KIRA_MODEL = "llama3.2:3b";

export interface KiraConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort: "minimal" | "low" | "medium" | "high";
}

/**
 * Resolve the open-weight Kira endpoint. KIRA_ variables are authoritative;
 * the older LLM_ names remain a migration fallback so an existing deployment
 * does not lose its model on upgrade. Local Ollama is the final default and
 * is deliberately keyless.
 */
export function kiraConfigFromEnv(env: Record<string, string | undefined> = process.env): KiraConfig | null {
  const explicitKiraBase = env.KIRA_BASE_URL?.trim();
  const configuredBase = explicitKiraBase || env.LLM_BASE_URL?.trim();
  const configuredModel = env.KIRA_MODEL?.trim() || env.LLM_MODEL?.trim();
  /* No model wiring at all means the deterministic local brain, not a silent
     attempt to reach a developer's Ollama instance in production. */
  if (!configuredBase && !configuredModel) return null;
  const baseUrl = (configuredBase || DEFAULT_KIRA_BASE).replace(/\/+$/, "");
  const apiKey = env.KIRA_API_KEY?.trim() || env.LLM_API_KEY?.trim() || "";
  const isLocal = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1])(?::\d+)?(?:\/|$)/i.test(baseUrl);
  if (!apiKey && !isLocal) return null;
  const configuredEffort = env.KIRA_REASONING_EFFORT?.trim().toLowerCase();
  return {
    baseUrl,
    apiKey,
    model: env.KIRA_MODEL?.trim() || (explicitKiraBase ? DEFAULT_KIRA_MODEL : configuredModel || DEFAULT_KIRA_MODEL),
    reasoningEffort: configuredEffort === "minimal" || configuredEffort === "low" || configuredEffort === "high" ? configuredEffort : "medium",
  };
}

export type KiraToolCall = { id: string; name: string; args: Record<string, unknown> };
export type KiraRawToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** A zeroed usage record — used when an endpoint does not report token counts. */
export function emptyUsage(): ModelUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

export function addUsage(total: ModelUsage, usage: ModelUsage): ModelUsage {
  const promptTokens = total.promptTokens + usage.promptTokens;
  const completionTokens = total.completionTokens + usage.completionTokens;
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

export interface KiraChatReply {
  text: string;
  toolCalls: KiraToolCall[];
  rawToolCalls: KiraRawToolCall[];
  finish: string;
  model: string;
  /** The endpoint's own usage report; zeroed when it does not send one. */
  usage: ModelUsage;
}

function toolCallsOf(message: unknown): { parsed: KiraToolCall[]; raw: KiraRawToolCall[] } {
  const rawIn = (message as { tool_calls?: unknown[] })?.tool_calls ?? [];
  const parsed: KiraToolCall[] = [];
  const raw: KiraRawToolCall[] = [];
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

export type KiraMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: KiraRawToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface KiraGenerationOptions {
  responseSchema?: { name: string; schema: Record<string, unknown> };
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  maxOutputTokens?: number;
  safetyIdentifier?: string;
  /** Cold starts (a 3B model loading from disk) need longer than a warm turn. */
  timeoutMs?: number;
}

export async function kiraChat(
  cfg: KiraConfig,
  messages: KiraMessage[],
  tools: { name: string; description: string; parameters: Record<string, unknown> }[],
  generation: KiraGenerationOptions = {},
): Promise<KiraChatReply> {
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
    signal: AbortSignal.timeout(generation.timeoutMs ?? 45_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Kira chat failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const data = (await res.json().catch(() => null)) as {
    model?: string;
    choices?: { finish_reason?: string; message?: { content?: string | null; tool_calls?: unknown[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  } | null;
  const choice = data?.choices?.[0];
  if (!choice) throw new Error("Kira chat returned no choices");
  const calls = toolCallsOf(choice.message);
  const promptTokens = Math.max(0, Number(data?.usage?.prompt_tokens) || 0);
  const completionTokens = Math.max(0, Number(data?.usage?.completion_tokens) || 0);
  return {
    text: (choice.message?.content ?? "").trim(),
    toolCalls: calls.parsed,
    rawToolCalls: calls.raw,
    finish: choice.finish_reason ?? "stop",
    model: data?.model ?? cfg.model,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: Math.max(0, Number(data?.usage?.total_tokens) || 0) || promptTokens + completionTokens,
    },
  };
}
