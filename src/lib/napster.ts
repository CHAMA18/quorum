/**
 * Napster Omniagent API — server-only, read-only client.
 *
 * The Napster developer platform is an AI-agent service: a project holds
 * companions (agent identities), knowledge, tools, agents and sessions. Its
 * API authenticates with a project-scoped key in the `X-Api-Key` header.
 *
 * This module is deliberately narrow:
 *   · it only issues GET requests (no companion, agent, knowledge or session
 *     mutation can be triggered from Quorum);
 *   · it never returns the key, and never logs it;
 *   · it only accepts HTTPS asset URLs, so a hostile upstream record cannot
 *     hand the browser a `javascript:` or plain-HTTP link;
 *   · it degrades to a typed error instead of throwing into a route handler.
 *
 * Import it only from server code. The key must never be exposed with a
 * `NEXT_PUBLIC_` prefix or returned to the browser.
 */

export const NAPSTER_DEFAULT_BASE_URL = "https://companion-api.napster.com";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_PAGE_SIZE = 50;
const RESOURCE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const COMPANION_ID = RESOURCE_ID;

export type NapsterErrorCode =
  | "not_configured"
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "upstream"
  | "network"
  | "bad_response"
  | "inactive_subscription"
  | "agent_limit";

export type NapsterResult<T> =
  | { ok: true; status: number; data: T; requestId?: string }
  | {
      ok: false;
      status: number;
      code: NapsterErrorCode;
      error: string;
      upstreamDetail?: string;
      requestId?: string;
      retryAfter?: string;
    };

export interface NapsterCompanion {
  id: string;
  firstName: string | null;
  lastName: string | null;
  name: string;
  headline: string | null;
  status: string | null;
  /** HTTPS-only preview image, or null when the upstream value is unsafe. */
  previewUrl: string | null;
  /** HTTPS-only loop video, or null when the upstream value is unsafe. */
  videoLoopUrl: string | null;
  createdAt: number | null;
  versions: string[];
}

export interface NapsterCompanionPage {
  items: NapsterCompanion[];
  pageIndex: number;
  pageSize: number;
  total: number | null;
  /** Records the upstream returned that were discarded as malformed. */
  skipped: number;
}

export interface NapsterListOptions {
  pageSize?: number;
  pageIndex?: number;
}

export interface NapsterSessionConfig {
  /** An Omniagent id. Preferred when the project has one. */
  agentId: string | null;
  /** A companion id for a per-session text connection. */
  companionId: string | null;
  voiceId: string;
}

export interface NapsterTextSession {
  connectionId: string;
  /** Short-lived WebSocket URL. It contains a session token, not the API key. */
  url: string;
  expiresAt: string | null;
  modality: "text";
  agentId: string | null;
  companionId: string | null;
}

/** The base URL is fixed: no environment override can redirect the key. */
export function napsterBaseUrl(): string {
  return NAPSTER_DEFAULT_BASE_URL;
}

export function napsterConfigured(): boolean {
  return Boolean(process.env.NAPSTER_API_KEY?.trim());
}

/**
 * The session target is deliberately configuration, not a hard-coded id.
 * An agent id is preferred; a companion id is the fallback for projects that
 * have not created an Omniagent (or have hit the project's agent limit).
 */
export function napsterSessionConfig(): NapsterSessionConfig {
  const agentId = process.env.NAPSTER_AGENT_ID?.trim() || null;
  const companionId = process.env.NAPSTER_COMPANION_ID?.trim() || null;
  return {
    agentId: agentId && RESOURCE_ID.test(agentId) ? agentId : null,
    companionId: companionId && RESOURCE_ID.test(companionId) ? companionId : null,
    voiceId: process.env.NAPSTER_VOICE_ID?.trim() || "alloy",
  };
}

export function napsterSessionConfigured(): boolean {
  const config = napsterSessionConfig();
  return Boolean(config.agentId || config.companionId);
}

function apiKey(): string {
  return process.env.NAPSTER_API_KEY?.trim() ?? "";
}

function requestTimeoutMs(): number {
  const raw = Number(process.env.NAPSTER_TIMEOUT_MS ?? "");
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.round(raw), 1_000), 30_000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

function text(value: unknown, cap = 240): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim().slice(0, cap);
  return clean || null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function companionFrom(raw: unknown): NapsterCompanion | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = text(row.id, 80);
  if (!id || !COMPANION_ID.test(id)) return null;

  const firstName = text(row.firstName, 80);
  const lastName = text(row.lastName, 80);
  const versions = Array.isArray(row.versions)
    ? row.versions.filter((v): v is string => typeof v === "string").slice(0, 8)
    : [];

  return {
    id,
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(" ") || "Unnamed companion",
    headline: text(row.headline, 300),
    status: text(row.status, 40),
    previewUrl: httpsUrl(row.previewUrl),
    videoLoopUrl: httpsUrl(row.videoLoopUrl),
    createdAt: finiteNumber(row.createdAt),
    versions,
  };
}

function upstreamDetail(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const row = body as Record<string, unknown>;
  return (
    text(row.detail, 240) ??
    text(row.description, 240) ??
    text(row.title, 240) ??
    text(row.error, 240) ??
    undefined
  );
}

function errorForStatus(status: number): { code: NapsterErrorCode; error: string } {
  if (status === 401) {
    return { code: "unauthorized", error: "The Napster API rejected the configured credential." };
  }
  if (status === 403) {
    return { code: "forbidden", error: "The Napster credential is not allowed to use this project." };
  }
  if (status === 404) {
    return { code: "not_found", error: "The requested Napster resource was not found." };
  }
  if (status === 429) {
    return { code: "rate_limited", error: "The Napster API rate-limited this request. Retry shortly." };
  }
  if (status >= 500) {
    return { code: "upstream", error: "The Napster API is unavailable right now." };
  }
  return { code: "upstream", error: `The Napster API returned HTTP ${status}.` };
}

async function request<T>(
  path: string,
  query: Record<string, string | number> | undefined,
  fetchImpl: typeof fetch,
): Promise<NapsterResult<T>> {
  const key = apiKey();
  if (!key) {
    return {
      ok: false,
      status: 503,
      code: "not_configured",
      error: "NAPSTER_API_KEY is not configured on this deployment.",
    };
  }

  const url = new URL(path, NAPSTER_DEFAULT_BASE_URL);
  for (const [name, value] of Object.entries(query ?? {})) {
    url.searchParams.set(name, String(value));
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { "X-Api-Key": key, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(requestTimeoutMs()),
    });
  } catch {
    return {
      ok: false,
      status: 0,
      code: "network",
      error: "The Napster API could not be reached.",
    };
  }

  const raw = await response.text().catch(() => "");
  let body: unknown = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
  }

  const requestId =
    response.headers.get("x-request-id") ??
    response.headers.get("request-id") ??
    undefined;

  if (!response.ok) {
    const mapped = errorForStatus(response.status);
    return {
      ok: false,
      status: response.status,
      code: mapped.code,
      error: mapped.error,
      upstreamDetail: upstreamDetail(body),
      requestId,
      retryAfter: response.headers.get("retry-after") ?? undefined,
    };
  }

  if (!body || typeof body !== "object") {
    return {
      ok: false,
      status: 502,
      code: "bad_response",
      error: "The Napster API returned an unreadable response.",
      requestId,
    };
  }

  return { ok: true, status: response.status, data: body as T, requestId };
}

/**
 * List the companions created in the project the key is scoped to.
 * This never calls the stock-companion catalogue and never mutates anything.
 */
export async function listCompanions(
  options: NapsterListOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<NapsterResult<NapsterCompanionPage>> {
  const pageSize = clamp(options.pageSize ?? 20, 1, MAX_PAGE_SIZE);
  const pageIndex = Math.max(0, Math.floor(options.pageIndex ?? 0));

  const result = await request<Record<string, unknown>>(
    "/public/companions",
    { pageSize, pageIndex },
    fetchImpl,
  );
  if (!result.ok) return result;

  const rawItems = Array.isArray(result.data.items) ? result.data.items : [];
  const items = rawItems
    .map(companionFrom)
    .filter((item): item is NapsterCompanion => item !== null);

  return {
    ok: true,
    status: result.status,
    requestId: result.requestId,
    data: {
      items,
      pageIndex,
      pageSize,
      total: finiteNumber(result.data.total) ?? finiteNumber(result.data.totalCount),
      skipped: rawItems.length - items.length,
    },
  };
}

/** Read one companion by id. The id is validated before any request is made. */
export async function getCompanion(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NapsterResult<NapsterCompanion>> {
  const clean = typeof id === "string" ? id.trim() : "";
  if (!COMPANION_ID.test(clean)) {
    return {
      ok: false,
      status: 0,
      code: "invalid_request",
      error: "The companion id is not valid.",
    };
  }

  const result = await request<unknown>(
    `/public/companions/${encodeURIComponent(clean)}`,
    undefined,
    fetchImpl,
  );
  if (!result.ok) return result;

  const companion = companionFrom(result.data);
  if (!companion) {
    return {
      ok: false,
      status: 502,
      code: "bad_response",
      error: "The Napster API returned an unreadable companion record.",
    };
  }

  return { ok: true, status: result.status, data: companion, requestId: result.requestId };
}

/* ── Text sessions ──────────────────────────────────────────────────────── */

function sessionError(status: number, body: unknown): { code: NapsterErrorCode; error: string } {
  const row = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
  const upstreamCode = text(row?.code, 80);

  if (upstreamCode === "InactiveSubscription") {
    return {
      code: "inactive_subscription",
      error: "The Napster project has no active subscription, so it cannot start a conversation.",
    };
  }
  if (upstreamCode === "AgentLimitExceeded") {
    return {
      code: "agent_limit",
      error: "The Napster organization has reached its agent limit, so it cannot create the configured agent.",
    };
  }
  if (upstreamCode === "VoiceIdRequired") {
    return {
      code: "invalid_request",
      error: "Napster requires a valid text-session voice id.",
    };
  }

  const mapped = errorForStatus(status);
  if (status === 403) {
    return {
      code: "forbidden",
      error: "Napster refused to start a conversation for this project.",
    };
  }
  return mapped;
}

async function sendJson<T>(
  method: "POST" | "DELETE",
  path: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<NapsterResult<T>> {
  const key = apiKey();
  if (!key) {
    return {
      ok: false,
      status: 503,
      code: "not_configured",
      error: "NAPSTER_API_KEY is not configured on this deployment.",
    };
  }

  let response: Response;
  try {
    response = await fetchImpl(new URL(path, NAPSTER_DEFAULT_BASE_URL), {
      method,
      headers: {
        "X-Api-Key": key,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      signal: AbortSignal.timeout(requestTimeoutMs()),
    });
  } catch {
    return {
      ok: false,
      status: 0,
      code: "network",
      error: "The Napster API could not be reached.",
    };
  }

  const raw = await response.text().catch(() => "");
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  const requestId =
    response.headers.get("x-request-id") ??
    response.headers.get("request-id") ??
    undefined;

  if (!response.ok) {
    const mapped = sessionError(response.status, parsed);
    return {
      ok: false,
      status: response.status,
      code: mapped.code,
      error: mapped.error,
      upstreamDetail: upstreamDetail(parsed),
      requestId,
      retryAfter: response.headers.get("retry-after") ?? undefined,
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      ok: false,
      status: 502,
      code: "bad_response",
      error: "The Napster API returned an unreadable response.",
      requestId,
    };
  }

  return { ok: true, status: response.status, data: parsed as T, requestId };
}

/** The token is base64 JSON whose `url` already embeds the session token. */
function decodeSessionToken(token: unknown): { url: string; expiresAt: string | null } | null {
  if (typeof token !== "string" || !token || token.length > 20_000) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(token, "base64").toString("utf8"));
  } catch {
    return null;
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null;

  const row = decoded as Record<string, unknown>;
  if (typeof row.url !== "string") return null;

  let url: URL;
  try {
    url = new URL(row.url);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "wss:") return null;
  url.protocol = "wss:";

  return {
    url: url.toString(),
    expiresAt: typeof row.expiresAt === "string" ? row.expiresAt.slice(0, 80) : null,
  };
}

export interface NapsterTextSessionOptions {
  /** Instruction for how the agent should open the conversation. */
  initialSpeech?: string;
  /** Per-session instructions. Agent sessions inherit their own instructions. */
  instructions?: string;
}

/**
 * Start a text-only WebSocket session. The browser receives only the
 * short-lived session URL; the project API key stays on this server.
 */
export async function createTextSession(
  options: NapsterTextSessionOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<NapsterResult<NapsterTextSession>> {
  const config = napsterSessionConfig();
  if (!config.agentId && !config.companionId) {
    return {
      ok: false,
      status: 503,
      code: "not_configured",
      error: "Set NAPSTER_AGENT_ID or NAPSTER_COMPANION_ID to start a Napster text session.",
    };
  }

  const initialSpeech = text(options.initialSpeech, 600) ?? undefined;
  const instructions = text(options.instructions, 6_000) ?? undefined;

  const path = config.agentId
    ? `/public/agents/${encodeURIComponent(config.agentId)}/connections`
    : "/public/ws-connections";
  const body = config.agentId
    ? {
        channelType: "websocket",
        modality: "text",
        ...(initialSpeech ? { initialSpeech } : {}),
      }
    : {
        companionId: config.companionId,
        modality: "text",
        providerConfig: {
          voiceId: config.voiceId,
          settings: {
            temperature: 0.3,
            ...(instructions ? { instructions } : {}),
          },
        },
        ...(initialSpeech ? { initialSpeech } : {}),
      };

  const result = await sendJson<Record<string, unknown>>("POST", path, body, fetchImpl);
  if (!result.ok) return result;

  const connection = result.data.connection;
  const connectionId =
    connection && typeof connection === "object" && !Array.isArray(connection)
      ? text((connection as Record<string, unknown>).id, 100)
      : null;
  const decoded = decodeSessionToken(result.data.token);

  if (!connectionId || !decoded) {
    return {
      ok: false,
      status: 502,
      code: "bad_response",
      error: "The Napster API created a session without a usable connection.",
      requestId: result.requestId,
    };
  }

  return {
    ok: true,
    status: result.status,
    requestId: result.requestId,
    data: {
      connectionId,
      url: decoded.url,
      expiresAt: decoded.expiresAt,
      modality: "text",
      agentId: config.agentId,
      companionId: config.agentId ? null : config.companionId,
    },
  };
}

/** End a session, used to clean up a readiness probe and on browser close. */
export async function endConnection(
  connectionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NapsterResult<{ ended: true }>> {
  const clean = typeof connectionId === "string" ? connectionId.trim() : "";
  if (!RESOURCE_ID.test(clean)) {
    return {
      ok: false,
      status: 0,
      code: "invalid_request",
      error: "The Napster connection id is not valid.",
    };
  }

  const key = apiKey();
  if (!key) {
    return {
      ok: false,
      status: 503,
      code: "not_configured",
      error: "NAPSTER_API_KEY is not configured on this deployment.",
    };
  }

  let response: Response;
  try {
    response = await fetchImpl(
      new URL(`/public/connections/${encodeURIComponent(clean)}`, NAPSTER_DEFAULT_BASE_URL),
      {
        method: "DELETE",
        headers: { "X-Api-Key": key, accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(requestTimeoutMs()),
      },
    );
  } catch {
    return { ok: false, status: 0, code: "network", error: "The Napster API could not be reached." };
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    let parsed: unknown = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }
    const mapped = sessionError(response.status, parsed);
    return {
      ok: false,
      status: response.status,
      code: mapped.code,
      error: mapped.error,
      upstreamDetail: upstreamDetail(parsed),
      requestId: response.headers.get("x-request-id") ?? undefined,
    };
  }

  return { ok: true, status: response.status, data: { ended: true } };
}

/**
 * Create and immediately end a text session. This is the only honest way to
 * test whether the key can start conversations; a read-only call cannot prove
 * it. The probe does not connect a client, so it does not start a billed call.
 */
export async function probeTextSession(
  fetchImpl: typeof fetch = fetch,
): Promise<NapsterResult<{ ready: true; connectionId: string; cleanedUp: boolean }>> {
  const created = await createTextSession(
    { instructions: "This is a connection readiness probe. Do not start a conversation." },
    fetchImpl,
  );
  if (!created.ok) return created;

  const ended = await endConnection(created.data.connectionId, fetchImpl);
  return {
    ok: true,
    status: created.status,
    requestId: created.requestId,
    data: {
      ready: true,
      connectionId: created.data.connectionId,
      cleanedUp: ended.ok,
    },
  };
}
