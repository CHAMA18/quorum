/**
 * Quorum edge worker.
 *
 * Two jobs:
 *
 *  1. Put the Quorum API behind a managed HTTPS origin. This is a transparent
 *     reverse proxy: every app request goes to ORIGIN_URL, and cookies,
 *     redirects and streaming bodies are preserved.
 *
 *  2. Hold the R2 upload endpoints. They are deliberately gated by a
 *     server-to-server shared secret, never exposed to the browser. If R2 is
 *     not enabled (or TENDERS is not bound), the endpoint answers 503 instead
 *     of pretending an upload happened. Downloads support a single HTTP byte
 *     range, so a large tender document can be resumed or paged.
 *
 * This worker is stateless. The Quorum sidecar, JSON state and filesystem MCP
 * server run beside the Next.js API on Render's persistent disk; Workers are
 * not a replacement for that process.
 */

import { ifRangeAllows, parseByteRange } from "./http-range";

interface R2ObjectMeta {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
  size?: number;
  etag?: string;
  httpEtag?: string;
}

interface Env {
  ORIGIN_URL: string;
  EDGE_SHARED_SECRET?: string;
  MCP_REMOTE_TOKEN?: string;
  AI?: {
    run(model: string, input: Record<string, unknown>): Promise<unknown>;
  };
  TENDERS?: {
    put(
      key: string,
      value: ReadableStream | ArrayBuffer | string | null,
      options?: { httpMetadata?: { contentType?: string } }
    ): Promise<unknown>;
    head(key: string): Promise<Omit<R2ObjectMeta, "body"> | null>;
    get(
      key: string,
      options?: { range?: { offset: number; length: number } }
    ): Promise<R2ObjectMeta | null>;
    delete(key: string): Promise<void>;
    list(options: {
      prefix?: string;
      limit?: number;
      cursor?: string;
      include?: ("httpMetadata" | "customMetadata")[];
    }): Promise<{
      objects: Array<{
        key: string;
        size: number;
        etag?: string;
        httpEtag?: string;
        uploaded?: Date;
        httpMetadata?: { contentType?: string };
      }>;
      truncated?: boolean;
      cursor?: string;
    }>;
  };
}

const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

function json(body: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body, null, 2), { status, headers });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAuthorised(request: Request, env: Env): boolean {
  const supplied = request.headers.get("x-quorum-edge-key") ?? "";
  const expected = env.EDGE_SHARED_SECRET ?? "";
  return expected.length > 0 && constantTimeEqual(supplied, expected);
}

function safeKey(raw: string | null): string | null {
  if (!raw) return null;
  const key = raw.replace(/^\/+/, "").trim();
  if (!key || key.length > 512) return null;
  if (key.split("/").some((part) => part === ".." || part === ".")) return null;
  if (/[\u0000-\u001f\\]/.test(key)) return null;
  return key;
}

/** A directory prefix for listing: under tenders/, no traversal, trailing slash. */
function safePrefix(raw: string | null): string | null {
  if (!raw) return null;
  const prefix = raw.replace(/^\/+/, "").trim();
  if (!prefix || prefix.length > 512 || !prefix.endsWith("/")) return null;
  if (!prefix.startsWith("tenders/")) return null;
  if (/[\u0000-\u001f\\]/.test(prefix)) return null;
  const parts = prefix.slice(0, -1).split("/");
  if (parts.length < 2 || parts.some((part) => !part || part === "." || part === "..")) return null;
  return prefix;
}

async function upload(request: Request, env: Env, url: URL): Promise<Response> {
  if (!isAuthorised(request, env)) return json({ error: "unauthorised" }, 401);
  if (!env.TENDERS) return json({ error: "R2 is not enabled for this account or TENDERS is not bound" }, 503);
  const key = safeKey(url.searchParams.get("key") ?? request.headers.get("x-object-key"));
  if (!key) return json({ error: "a safe ?key= is required" }, 422);
  if (request.method !== "PUT" && request.method !== "POST") {
    return json({ error: "use PUT or POST" }, 405, { allow: "PUT, POST" });
  }
  await env.TENDERS.put(key, request.body, {
    httpMetadata: { contentType: request.headers.get("content-type") || "application/octet-stream" },
  });
  return json({ ok: true, key }, 201);
}

async function list(request: Request, env: Env, url: URL): Promise<Response> {
  if (!isAuthorised(request, env)) return json({ error: "unauthorised" }, 401);
  if (!env.TENDERS) return json({ error: "R2 is not enabled for this account or TENDERS is not bound" }, 503);
  if (request.method !== "GET") return json({ error: "use GET" }, 405, { allow: "GET" });
  const prefix = safePrefix(url.searchParams.get("prefix"));
  if (!prefix) return json({ error: "a safe ?prefix= under tenders/ is required" }, 422);
  const limitRaw = Number(url.searchParams.get("limit") ?? 500);
  const limit = Number.isSafeInteger(limitRaw) ? Math.min(1000, Math.max(1, limitRaw)) : 500;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const result = await env.TENDERS.list({ prefix, limit, cursor, include: ["httpMetadata"] });
  return json({
    prefix,
    objects: result.objects.map((object) => ({
      key: object.key,
      size: object.size,
      etag: object.httpEtag ?? object.etag,
      uploaded: object.uploaded ?? null,
      contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
    })),
    truncated: result.truncated === true,
    cursor: result.truncated ? result.cursor : undefined,
  });
}

async function remove(request: Request, env: Env, url: URL): Promise<Response> {
  if (!isAuthorised(request, env)) return json({ error: "unauthorised" }, 401);
  if (!env.TENDERS) return json({ error: "R2 is not enabled for this account or TENDERS is not bound" }, 503);
  if (request.method !== "DELETE") return json({ error: "use DELETE" }, 405, { allow: "DELETE" });
  const key = safeKey(url.searchParams.get("key"));
  if (!key) return json({ error: "a safe ?key= is required" }, 422);
  await env.TENDERS.delete(key);
  return json({ ok: true, key });
}

async function download(request: Request, env: Env, url: URL): Promise<Response> {
  if (!isAuthorised(request, env)) return json({ error: "unauthorised" }, 401);
  if (!env.TENDERS) return json({ error: "R2 is not enabled for this account or TENDERS is not bound" }, 503);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "use GET" }, 405, { allow: "GET, HEAD" });
  }
  const key = safeKey(url.searchParams.get("key"));
  if (!key) return json({ error: "a safe ?key= is required" }, 422);

  /* A range needs the total size for Content-Range, and a stale If-Range
     needs the current ETag; one HEAD supplies both. Full downloads skip it. */
  const rangeHeader = request.headers.get("range");
  const head = rangeHeader ? await env.TENDERS.head(key) : null;
  if (rangeHeader && !head) return json({ error: "not found" }, 404);

  const headers = new Headers();
  headers.set("accept-ranges", "bytes");
  /* no-transform keeps the edge from gzipping a byte range: Content-Range
     describes the stored bytes, and compression strips Content-Length. */
  headers.set("cache-control", "private, max-age=0, no-transform");
  if (head?.httpEtag) headers.set("etag", head.httpEtag);
  else if (head?.etag) headers.set("etag", head.etag);

  const total = head?.size ?? 0;
  let range = parseByteRange(rangeHeader, total);
  if (range && !ifRangeAllows(request.headers.get("if-range"), head?.httpEtag ?? head?.etag)) {
    range = null;
  }

  if (range === "unsatisfiable") {
    headers.set("content-range", `bytes */${total}`);
    return json({ error: "range not satisfiable", size: total }, 416, headers);
  }

  if (range) {
    const object = await env.TENDERS.get(key, {
      range: { offset: range.offset, length: range.length },
    });
    if (!object) return json({ error: "not found" }, 404);
    headers.set("content-type", object.httpMetadata?.contentType ?? "application/octet-stream");
    headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${total}`);
    headers.set("content-length", String(range.length));
    return new Response(request.method === "HEAD" ? null : object.body, { status: 206, headers });
  }

  const object = await env.TENDERS.get(key);
  if (!object) return json({ error: "not found" }, 404);
  headers.set("content-type", object.httpMetadata?.contentType ?? "application/octet-stream");
  if (object.size !== undefined) headers.set("content-length", String(object.size));
  if (!head && (object.httpEtag || object.etag)) headers.set("etag", object.httpEtag ?? object.etag ?? "");
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

/* ── Text to speech ────────────────────────────────────────────────────────
   Deepgram Aura-2 through Workers AI is the natural voice. MeloTTS is the
   fallback because it is cheap and multilingual. The browser's own speech
   synthesis is the last fallback, on the client, so a Worker error never
   leaves the assistant mute. Failures are reported honestly: the 502 body
   carries the underlying model error, so a broken entitlement is visible
   in one curl instead of a silent swing to the browser voice. */

const VOICE_SPEAKERS = new Set(["asteria", "orion", "luna", "atlas"]);
const DEFAULT_SPEAKER = "asteria";
const MAX_SPEAK_CHARS = 1400;

function spokenText(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*#`>_|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SPEAK_CHARS);
}

async function hashKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64Audio(audio: string, contentType: string): Response | null {
  try {
    const binary = atob(audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (bytes.length === 0) return null;
    return new Response(bytes, { headers: { "content-type": contentType } });
  } catch {
    return null;
  }
}

async function audioResult(result: unknown, contentType: string): Promise<Response | null> {
  if (result instanceof ReadableStream) {
    return new Response(result, { headers: { "content-type": contentType } });
  }
  if (result instanceof ArrayBuffer) {
    return result.byteLength ? new Response(result, { headers: { "content-type": contentType } }) : null;
  }
  if (ArrayBuffer.isView(result)) {
    return result.byteLength
      ? new Response(result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength), {
          headers: { "content-type": contentType },
        })
      : null;
  }
  if (result && typeof result === "object") {
    const obj = result as { audio?: unknown; result?: { audio?: unknown } };
    const audio = obj.audio ?? obj.result?.audio;
    if (typeof audio === "string") return base64Audio(audio, contentType);
  }
  return null;
}

async function speak(request: Request, env: Env): Promise<Response> {
  if (!isAuthorised(request, env)) return json({ error: "unauthorised" }, 401);
  if (!env.AI) return json({ error: "Workers AI is not bound to this worker" }, 503);
  if (request.method !== "POST") return json({ error: "use POST" }, 405, { allow: "POST" });

  let body: { text?: unknown; voice?: unknown };
  try {
    body = (await request.json()) as { text?: unknown; voice?: unknown };
  } catch {
    return json({ error: "expected JSON { text, voice? }" }, 400);
  }
  const text = spokenText(String(body.text ?? ""));
  if (text.length < 2) return json({ error: "text is required" }, 422);
  const voice = VOICE_SPEAKERS.has(String(body.voice ?? "")) ? String(body.voice) : DEFAULT_SPEAKER;

  const cacheKey = new Request(
    `https://quorum-edge.internal/tts/${voice}/${await hashKey(text)}`,
    { method: "GET" }
  );
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-quorum-voice", "cache");
    return new Response(cached.body, { status: 200, headers });
  }

  let audio: Response | null = null;
  let lastError = "";
  try {
    /* Aura-2 returns audio/mpeg directly from the Workers AI binding. */
    const result = await env.AI.run("@cf/deepgram/aura-2-en", { text, speaker: voice });
    audio = await audioResult(result, "audio/mpeg");
  } catch (err) {
    lastError = (err as Error).message.slice(0, 240);
    audio = null;
  }
  if (!audio) {
    try {
      /* MeloTTS returns { audio: base64(WAV) } and is the cheap fallback. */
      const result = await env.AI.run("@cf/myshell-ai/melotts", { prompt: text, lang: "en" });
      audio = await audioResult(result, "audio/wav");
    } catch (err) {
      lastError = lastError || (err as Error).message.slice(0, 240);
      audio = null;
    }
  }
  if (!audio) return json({ error: "text-to-speech is unavailable", detail: lastError || "both models returned no audio" }, 502);

  const headers = new Headers(audio.headers);
  headers.set("cache-control", "public, max-age=86400");
  headers.set("x-quorum-voice", "aura-2");
  const response = new Response(audio.body, { status: 200, headers });
  await caches.default.put(cacheKey, response.clone());
  return response;
}

/* ── Speech to text ────────────────────────────────────────────────────────
   The assistant's ears when no Meta Model API key is configured: the same
   AI binding that speaks also hears. Whisper is the long-available default;
   Deepgram Nova-3 is the fallback. The clip arrives as multipart (the web
   app forwards its WAV) or as a raw octet-stream body, and is never stored. */

async function audioBytes(request: Request): Promise<Uint8Array | null> {
  const type = request.headers.get("content-type") ?? "";
  if (type.startsWith("multipart/")) {
    const form = await request.formData().catch(() => null);
    const part = form?.get("audio");
    if (!(part instanceof Blob) || part.size === 0) return null;
    return new Uint8Array(await part.arrayBuffer());
  }
  const buffer = await request.arrayBuffer().catch(() => null);
  if (!buffer || buffer.byteLength === 0) return null;
  return new Uint8Array(buffer);
}

async function transcribe(request: Request, env: Env): Promise<Response> {
  if (!isAuthorised(request, env)) return json({ error: "unauthorised" }, 401);
  if (!env.AI) return json({ error: "Workers AI is not bound to this worker" }, 503);
  if (request.method !== "POST") return json({ error: "use POST" }, 405, { allow: "POST" });

  const bytes = await audioBytes(request);
  if (!bytes) return json({ error: "an audio clip is required" }, 422);

  /* The current audio schema wants `audio` as an object carrying the bytes
     and their content type; the byte-array form is the legacy shape. Both
     are tried — a schema rejection is deterministic, a quota or model error
     is not, so the loop stops at the first honest failure of each kind. */
  const arrayBody = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const attempts: { input: Record<string, unknown>; model: string }[] = [];
  for (const model of ["@cf/openai/whisper", "@cf/deepgram/nova-3"]) {
    attempts.push({ model, input: { audio: { body: arrayBody, contentType: "audio/wav" } } });
  }
  for (const model of ["@cf/openai/whisper", "@cf/deepgram/nova-3"]) {
    const samples = new Array<number>(bytes.length);
    for (let i = 0; i < bytes.length; i++) samples[i] = bytes[i];
    attempts.push({ model, input: { audio: { body: samples, contentType: "audio/wav" } } });
    attempts.push({ model, input: { audio: samples } });
  }

  let lastError = "";
  for (const attempt of attempts) {
    try {
      const result = (await env.AI.run(attempt.model, attempt.input)) as Record<string, unknown> | null;
      const text = transcriptOf(result);
      if (text) return json({ text, model: attempt.model.split("/")[1] });
      lastError = "model returned an empty transcript";
    } catch (err) {
      lastError = (err as Error).message.slice(0, 240);
      /* A schema rejection (5006) means this shape is wrong — try the next.
         Anything else (quota, model) would fail on every shape, so stop. */
      if (!/5006|schema|properties/i.test(lastError)) break;
    }
  }
  return json({ error: "speech-to-text is unavailable", detail: lastError || "no transcript" }, 502);
}

/** Pull the transcript out of whichever shape the ASR model answered with. */
function transcriptOf(result: Record<string, unknown> | null): string {
  if (!result) return "";
  const direct = result.text ?? result.transcript;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const deep = (result as {
    results?: { channels?: { alternatives?: { transcript?: unknown }[] }[] };
  }).results;
  const alt = deep?.channels?.[0]?.alternatives?.[0]?.transcript;
  return typeof alt === "string" ? alt.trim() : "";
}

function rewriteLocation(location: string, publicOrigin: string, origin: URL): string {
  try {
    const parsed = new URL(location, origin);
    if (parsed.origin === origin.origin) {
      return `${publicOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    /* relative Location — leave it alone */
  }
  return location;
}

async function proxy(request: Request, env: Env, url: URL): Promise<Response> {
  const origin = new URL(env.ORIGIN_URL);
  const target = new URL(`${url.pathname}${url.search}`, origin);
  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP) headers.delete(name);
  /* Keep the public host in Host so Next's absolute links, redirects and
     cookies resolve to the worker hostname rather than the EC2 IP. */
  headers.set("host", url.host);
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", "https");
  const clientIp = request.headers.get("cf-connecting-ip");
  if (clientIp) headers.set("x-real-ip", clientIp);

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  const response = await fetch(target.toString(), init);
  const out = new Headers();
  response.headers.forEach((value, name) => {
    if (name === "set-cookie" || HOP_BY_HOP.includes(name)) return;
    out.set(name, value);
  });
  /* Workers decompresses the origin body, so the original encoding/length are
     no longer true. Let the edge compute them again. */
  out.delete("content-encoding");
  out.delete("content-length");

  const cookies =
    typeof (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (response.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : [];
  for (const cookie of cookies) out.append("set-cookie", cookie);

  const location = out.get("location");
  if (location) out.set("location", rewriteLocation(location, url.origin, origin));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: out,
  });
}

const MCP_CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "content-type, mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
  vary: "Origin",
};

function mcpUnauthorized(): Response {
  return json({ error: "A valid Quorum MCP bearer token is required." }, 401, {
    ...MCP_CORS_HEADERS,
    "www-authenticate": 'Bearer realm="Quorum MCP"',
  });
}

async function remoteMcp(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });
  if (request.method !== "POST" && request.method !== "GET") {
    return json({ error: "Use POST for MCP JSON-RPC requests." }, 405, { ...MCP_CORS_HEADERS, allow: "POST, GET, OPTIONS" });
  }

  const configuredToken = env.MCP_REMOTE_TOKEN ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!configuredToken || !match || !constantTimeEqual(match[1], configuredToken)) return mcpUnauthorized();
  if (!env.EDGE_SHARED_SECRET) return json({ error: "MCP origin authentication is not configured." }, 503, MCP_CORS_HEADERS);

  // Authenticate callers here, then authenticate the edge-to-origin hop too.
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.set("x-quorum-edge-key", env.EDGE_SHARED_SECRET);
  const upstreamRequest = new Request(request, { headers });
  // Keep the public endpoint at /mcp while using the Next route under /api,
  // which also lets static-export builds omit server routes cleanly.
  const originRoute = new URL("/api/mcp", url.origin);
  const response = await proxy(upstreamRequest, env, originRoute);
  const responseHeaders = new Headers(response.headers);
  for (const [name, value] of Object.entries(MCP_CORS_HEADERS)) responseHeaders.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/__edge/health") {
      return json({
        ok: true,
        service: "quorum-edge",
        origin: env.ORIGIN_URL,
        r2Bound: Boolean(env.TENDERS),
        aiBound: Boolean(env.AI),
        now: new Date().toISOString(),
      });
    }
    if (url.pathname === "/__edge/upload") return upload(request, env, url);
    if (url.pathname === "/__edge/object") return download(request, env, url);
    if (url.pathname === "/__edge/list") return list(request, env, url);
    if (url.pathname === "/__edge/delete") return remove(request, env, url);
    if (url.pathname === "/__edge/tts") return speak(request, env);
    if (url.pathname === "/__edge/asr") return transcribe(request, env);

    if (url.pathname === "/mcp") {
      try {
        return await remoteMcp(request, env, url);
      } catch (err) {
        return json({ error: "MCP origin unreachable", detail: (err as Error).message.slice(0, 240) }, 502, MCP_CORS_HEADERS);
      }
    }

    try {
      return await proxy(request, env, url);
    } catch (err) {
      return json(
        {
          error: "origin unreachable",
          detail: (err as Error).message.slice(0, 300),
        },
        502
      );
    }
  },
};

export default worker;
