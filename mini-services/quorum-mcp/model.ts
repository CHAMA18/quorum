import type { Run } from "./store";

/**
 * Model attribution — one vocabulary for the demo, the API and the report.
 *
 * The drafting path is deliberately provider-agnostic: any OpenAI-compatible
 * endpoint works. The hackathon build leads with **Muse Spark 1.3** through
 * Meta Model API, and keeps **Llama 3.2** through Ollama as the in-region
 * fallback. Attribution is not inferred from the env value alone — every draft
 * records the `model` string the endpoint actually returned, and the report
 * prints it.
 *
 * The two paths are not equivalent on data handling: the hosted path sends
 * redacted evidence (supplier names and amounts replaced) through the model
 * gateway, while the in-region path can see the full pack. The report says
 * which path answered and how many spans were redacted.
 */

export type ModelProvider = "ollama" | "meta-model-api" | "openai-compatible";
export type ModelProviderOrTemplate = ModelProvider | "template";
export type ModelMode = "llm" | "template";

export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  provider: ModelProvider;
  configuredBy: "llm-env" | "meta-model-api";
}

export interface ModelStatus {
  configured: boolean;
  mode: ModelMode;
  model: string | null;
  provider: ModelProviderOrTemplate;
  providerLabel: string;
  endpoint: string | null;
  configuredBy: LlmConfig["configuredBy"] | null;
  /* The in-region fallback, when one is configured. The UI shows it beside
     the primary so a judge can see the whole chain, not just the winner. */
  fallback: {
    model: string;
    provider: ModelProvider;
    providerLabel: string;
    endpoint: string;
  } | null;
}

export interface ModelCall {
  tool: "plan_review" | "draft_redline";
  model: string;
  source: "llm" | "template" | null;
  at: string;
  runId: string | null;
}

export interface RunModelAttribution {
  mode: "llm" | "mixed" | "template";
  planSource: "heuristic" | "llm" | null;
  planModel: string | null;
  draftTotal: number;
  draftLlm: number;
  draftTemplate: number;
  models: string[];
  promptTokens: number;
  completionTokens: number;
  /* Supplier names and currency amounts replaced before a hosted call. Zero
     is meaningful: the in-region path sent the evidence unchanged. */
  redactions: number;
}

export function providerLabel(provider: ModelProviderOrTemplate): string {
  if (provider === "ollama") return "Ollama · local";
  if (provider === "meta-model-api") return "Meta Model API · hosted";
  if (provider === "openai-compatible") return "OpenAI-compatible endpoint";
  return "Template fallback";
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** A safe display endpoint: origin only — never a path, never a key. */
export function modelEndpoint(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl.replace(/\/+$/, "");
  }
}

export function modelProvider(baseUrl: string, model: string): ModelProvider {
  const host = hostOf(baseUrl);
  const raw = `${baseUrl} ${model}`.toLowerCase();
  if (
    host === "api.meta.ai" ||
    host.endsWith(".api.meta.ai") ||
    host === "api.llama.com" ||
    host.endsWith(".api.llama.com") ||
    host === "dev.meta.ai"
  ) {
    return "meta-model-api";
  }
  if (raw.includes("11434") || raw.includes("ollama")) return "ollama";
  return "openai-compatible";
}

/**
 * Resolve the drafting endpoint.
 *
 * Precedence:
 *   1. LLM_BASE_URL + LLM_MODEL — the explicit endpoint (Llama via Ollama,
 *      Meta Model API, or any OpenAI-compatible service). This is what the
 *      live demo sets in .env.local.
 *   2. No LLM endpoint at all, but a Meta/Muse key — Meta Model API at
 *      https://api.meta.ai/v1 with META_MODEL / MUSE_MODEL.
 *   3. Nothing — template fallback.
 *
 * A half-configured LLM_* pair returns null rather than silently sending
 * procurement data to a different provider.
 */
export function llmConfigFromEnv(env: Record<string, string | undefined> = process.env): LlmConfig | null {
  const baseUrl = env.LLM_BASE_URL?.trim();
  const model = env.LLM_MODEL?.trim();
  const sharedKey = env.LLM_API_KEY?.trim() || env.META_MODEL_API_KEY?.trim() || env.MUSE_API_KEY?.trim() || undefined;

  if (baseUrl && model) {
    return {
      baseUrl,
      model,
      apiKey: sharedKey,
      provider: modelProvider(baseUrl, model),
      configuredBy: "llm-env",
    };
  }
  if (baseUrl || model) return null;

  const metaKey = env.META_MODEL_API_KEY?.trim() || env.MUSE_API_KEY?.trim() || env.LLM_API_KEY?.trim();
  if (!metaKey) return null;
  const metaBase = env.META_MODEL_BASE_URL?.trim() || env.MUSE_BASE_URL?.trim() || "https://api.meta.ai/v1";
  const metaModel = env.META_MODEL?.trim() || env.MUSE_MODEL?.trim() || "muse-spark-1.3";
  return {
    baseUrl: metaBase,
    model: metaModel,
    apiKey: metaKey,
    provider: modelProvider(metaBase, metaModel),
    configuredBy: "meta-model-api",
  };
}

/**
 * The in-region fallback, when configured. Kept separate from the primary so
 * a hosted primary can fail over to Llama on the desk instead of dropping to
 * the template. A half-configured fallback is ignored rather than guessed.
 */
export function fallbackConfigFromEnv(env: Record<string, string | undefined> = process.env): LlmConfig | null {
  const baseUrl = env.LLM_FALLBACK_BASE_URL?.trim();
  const model = env.LLM_FALLBACK_MODEL?.trim();
  if (!baseUrl || !model) return null;
  const apiKey = env.LLM_FALLBACK_API_KEY?.trim() || undefined;
  return {
    baseUrl,
    model,
    apiKey,
    provider: modelProvider(baseUrl, model),
    configuredBy: "llm-env",
  };
}

/**
 * The drafting chain, in order: the configured primary (Muse Spark by
 * default in the hackathon build) and then the in-region Llama fallback.
 * Duplicate endpoints are collapsed so a single-endpoint deployment does not
 * pay for the same call twice.
 */
export function llmConfigChainFromEnv(env: Record<string, string | undefined> = process.env): LlmConfig[] {
  const chain: LlmConfig[] = [];
  const primary = llmConfigFromEnv(env);
  if (primary) chain.push(primary);
  const fallback = fallbackConfigFromEnv(env);
  if (fallback && !chain.some((c) => c.baseUrl === fallback.baseUrl && c.model === fallback.model)) {
    chain.push(fallback);
  }
  return chain;
}

export function modelStatus(env: Record<string, string | undefined> = process.env): ModelStatus {
  const cfg = llmConfigFromEnv(env);
  const fallback = fallbackConfigFromEnv(env);
  const fallbackStatus = fallback
    ? {
        model: fallback.model,
        provider: fallback.provider,
        providerLabel: providerLabel(fallback.provider),
        endpoint: modelEndpoint(fallback.baseUrl),
      }
    : null;
  if (!cfg) {
    return {
      configured: false,
      mode: "template",
      model: null,
      provider: "template",
      providerLabel: providerLabel("template"),
      endpoint: null,
      configuredBy: null,
      fallback: fallbackStatus,
    };
  }
  return {
    configured: true,
    mode: "llm",
    model: cfg.model,
    provider: cfg.provider,
    providerLabel: providerLabel(cfg.provider),
    endpoint: modelEndpoint(cfg.baseUrl),
    configuredBy: cfg.configuredBy,
    fallback: fallbackStatus,
  };
}

/** The actual endpoint-returned model, stripped of old "(llm)" annotations. */
function actualModel(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s*\((?:llm|template)[^)]*\).*$/i, "").trim();
  if (!cleaned || /^template\b/i.test(cleaned)) return null;
  return cleaned;
}

/**
 * Per-run attribution from stored facts, not the current environment:
 * plan source/model, draft source/model, token counts. Old rows that only
 * encoded "(llm)" in the model string are still read correctly.
 */
export function modelAttributionForRun(
  run: Pick<Run, "plan" | "drafts" | "usage">,
): RunModelAttribution {
  const drafts = Array.isArray(run.drafts) ? run.drafts : [];
  const planSource = run.plan?.source ?? null;
  const planModel = actualModel(run.plan?.model);
  const models = new Set<string>();
  if (planSource === "llm" && planModel) models.add(planModel);

  let draftLlm = 0;
  let draftTemplate = 0;
  let redactions = 0;
  for (const draft of drafts) {
    const isLlm = draft.source === "llm" || /\(llm\)/i.test(draft.model ?? "");
    const model = actualModel(draft.model);
    if (isLlm) {
      draftLlm += 1;
      if (model) models.add(model);
    } else {
      draftTemplate += 1;
    }
    if (typeof draft.redactions === "number" && draft.redactions > 0) redactions += draft.redactions;
  }

  const promptTokens = run.usage?.promptTokens ?? 0;
  const completionTokens = run.usage?.completionTokens ?? 0;
  const mode =
    planSource === "llm" || draftLlm > 0
      ? draftTemplate > 0
        ? "mixed"
        : "llm"
      : "template";

  return {
    mode,
    planSource,
    planModel,
    draftTotal: drafts.length,
    draftLlm,
    draftTemplate,
    models: [...models],
    promptTokens,
    completionTokens,
    redactions,
  };
}
