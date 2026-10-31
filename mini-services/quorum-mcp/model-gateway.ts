/**
 * The model gateway — procurement data goes where the workspace policy says.
 *
 * Two failure modes this closes:
 *  · SILENT DISCLOSURE — drafting prompts contain supplier names and prices;
 *    without a residency policy they flew straight to whatever endpoint
 *    LLM_BASE_URL pointed at, in whatever country that server lives. A
 *    workspace earns procurement data only when the call respects its
 *    residency and redaction rules.
 *  · UNATTRIBUTABLE CALLS — every call now lands in the audit chain with
 *    {provider, model, purpose, tokens, redactions, residency}, so a
 *    "which model drafted this?" is answered from the record, never from a
 *    claim about an environment.
 *
 * The policy is environmental (the sidecar serves one deployment, not many
 * tenants with separate providers):
 *   MODEL_RESIDENCY  IN_REGION (default) | HOSTED | HYBRID
 *   MODEL_REDACTION  on (default) | off   — honoured only for endpoints that
 *                       leave the region, and only when the operator has
 *                       also set MODEL_REDACTION_EXPLICIT=I ACCEPT.
 */

import type { ChatMessage, FetchLike } from "./engine";
import { appendLog, state } from "./store";

export type Residency = "IN_REGION" | "HOSTED" | "HYBRID";
export type EndpointClass = "LOCAL" | "HOSTED";

export interface ResidencyPolicy {
  residency: Residency;
  redactOn: boolean;
}

export function residencyFromEnv(env: Record<string, string | undefined> = process.env): ResidencyPolicy {
  const raw = (env.MODEL_RESIDENCY ?? env.LLM_RESIDENCY ?? "").trim().toUpperCase();
  const residency: Residency = raw === "HOSTED" || raw === "HYBRID" ? raw : "IN_REGION";
  const redactionRaw = (env.MODEL_REDACTION ?? "").trim().toLowerCase();
  const explicitAccept = (env.MODEL_REDACTION_EXPLICIT ?? "").trim().toUpperCase() === "I ACCEPT";
  /* Redaction is on unless the operator has explicitly written, in their own
     words, that they accept unredacted transmission. "off" alone does not do
     it — the acknowledgement does. */
  const redactOn = !(redactionRaw === "off" && explicitAccept);
  return { residency, redactOn };
}

export function endpointClass(baseUrl: string): EndpointClass {
  let host = "";
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return "HOSTED"; /* an unparseable endpoint is not provably local */
  }
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".local") ||
    host === "host.docker.internal"
  ) {
    return "LOCAL";
  }
  /* RFC1918+v6 ULA addresses are private-network endpoints — a model serving
     only the deployment's own network is local for policy purposes. */
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || /^fd[0-9a-f]{2}:/i.test(host)) {
    return "LOCAL";
  }
  return "HOSTED";
}

/** The refusal an IN_REGION workspace raises when the call would leave. */
export function residencyRefusal(policy: ResidencyPolicy, baseUrl: string): string | null {
  if (policy.residency === "HOSTED" || policy.residency === "HYBRID") return null;
  if (endpointClass(baseUrl) === "LOCAL") return null;
  return `Residency policy IN_REGION refuses a call to ${new URL(baseUrl, "http://x.invalid").host} — the endpoint is outside this region. Point LLM_BASE_URL at an in-region endpoint or set MODEL_RESIDENCY for an operator-approved hosted provider.`;
}

/* ── Redaction — names and prices never leave unmarked ──────────────────── */

const AMOUNT_RE = /(?:\b(?:USD|EUR|GBP|ZMW|RWF|KES|UGX|TZS|MWK|GHS|NGN|ZAR)\s?)?\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d{1,2})?\s?(?:million|billion)\b/gi;

/** Redact supplier names (word-boundary, case-insensitive) and currency
 *  amounts from text. Returns how many spans were replaced, so the
 *  provenance line can prove the redaction happened at all. */
export function redactForModel(
  text: string,
  supplierNames: string[],
): { text: string; redacted: number } {
  let spans = 0;
  let out = text;
  for (const name of supplierNames) {
    const clean = name.trim();
    if (clean.length < 3) continue;
    const esc = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${esc}\\b`, "gi");
    out = out.replace(re, () => {
      spans += 1;
      return "‏REDACTED-SUPPLIER";
    });
  }
  out = out.replace(AMOUNT_RE, () => {
    spans += 1;
    return "REDACTED-AMOUNT";
  });
  return { text: out, redacted: spans };
}

export interface ModelProvenance {
  provider: string;
  model: string;
  purpose: "plan_review" | "draft_redline" | "repair" | "muse_chat" | "transcribe";
  runId: string | null;
  endpoint: string | null;
  residency: Residency;
  redactions: number;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  outcome: "OK" | "REFUSED" | "ERROR";
}

function supplierNamesForRedaction(): string[] {
  return state.suppliers.map((s) => s.name).filter((n) => typeof n === "string" && n.trim().length >= 3);
}

/** Log one provenance line — the chain is where attribution becomes evidence. */
export function logModelProvenance(p: ModelProvenance): void {
  appendLog({
    actor: "quorum-agent",
    server: "model-gateway",
    tool: "model_call",
    kind: "READ",
    runId: p.runId ?? undefined,
    inputs: { purpose: p.purpose, provider: p.provider, model: p.model, endpoint: p.endpoint, residency: p.residency },
    outputs: {
      outcome: p.outcome,
      redactions: p.redactions,
      promptTokens: p.promptTokens,
      completionTokens: p.completionTokens,
      latencyMs: p.latencyMs,
    },
    status: p.outcome === "REFUSED" ? "ERROR" : "OK",
    durationMs: p.latencyMs,
  });
}

/** The wrapper every model call goes through: policy refusal, redaction,
 *  provenance, the call itself. Refusal throws — the caller falls back to
 *  its template path and the record shows exactly why. */
export async function callModel(
  cfg: {
    baseUrl: string;
    model: string;
    provider: string;
    apiKey?: string;
  },
  messages: ChatMessage[],
  fetchImpl: FetchLike,
  options: {
    purpose: ModelProvenance["purpose"];
    runId: string | null;
    policy?: ResidencyPolicy;
  },
): Promise<{ model: string; content: string; usage: { promptTokens: number; completionTokens: number }; redactions: number }> {
  const policy = options.policy ?? residencyFromEnv();
  const started = performance.now();
  const refusal = residencyRefusal(policy, cfg.baseUrl);
  if (refusal) {
    logModelProvenance({
      provider: cfg.provider,
      model: cfg.model,
      purpose: options.purpose,
      runId: options.runId,
      endpoint: cfg.baseUrl,
      residency: policy.residency,
      redactions: 0,
      promptTokens: 0,
      completionTokens: 0,
      latencyMs: Math.round(performance.now() - started),
      outcome: "REFUSED",
    });
    throw new Error(refusal);
  }

  const leaveRegion = endpointClass(cfg.baseUrl) === "HOSTED";
  const redact = policy.redactOn && leaveRegion;
  let outgoing = messages;
  let redactions = 0;
  if (redact) {
    const names = supplierNamesForRedaction();
    outgoing = messages.map((m) => {
      const { text, redacted } = redactForModel(m.content, names);
      redactions += redacted;
      return { role: m.role, content: text };
    });
  }

  try {
    const res = await fetchImpl(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      /* Muse Spark is a reasoning model: the answer arrives after a reasoning
         pass, so the cap must leave room for both. 4k is a ceiling, not a
         charge — only tokens actually generated are billed. */
      body: JSON.stringify({ model: cfg.model, messages: outgoing, temperature: 0.2, max_tokens: 4096 }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`llm endpoint answered ${res.status}`);
    const data = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const latent = {
      model: data.model ?? cfg.model,
      content: data.choices?.[0]?.message?.content ?? "",
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
      },
      redactions,
    };
    logModelProvenance({
      provider: cfg.provider,
      model: latent.model,
      purpose: options.purpose,
      runId: options.runId,
      endpoint: cfg.baseUrl,
      residency: policy.residency,
      redactions,
      promptTokens: latent.usage.promptTokens,
      completionTokens: latent.usage.completionTokens,
      latencyMs: Math.round(performance.now() - started),
      outcome: "OK",
    });
    return latent;
  } catch (err) {
    logModelProvenance({
      provider: cfg.provider,
      model: cfg.model,
      purpose: options.purpose,
      runId: options.runId,
      endpoint: cfg.baseUrl,
      residency: policy.residency,
      redactions,
      promptTokens: 0,
      completionTokens: 0,
      latencyMs: Math.round(performance.now() - started),
      outcome: "ERROR",
    });
    throw err;
  }
}
