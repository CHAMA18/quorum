/**
 * Atomic fixed-window rate limiting through the Upstash Redis REST API.
 *
 * This stays server-only: credentials are read at request time and are never
 * returned to callers. Callers fail closed when Redis is not configured or
 * unavailable so a deployment cannot silently lose its distributed limit.
 */

const INCREMENT_WINDOW_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return {count, redis.call("PTTL", KEYS[1])}
`;

export type RedisRateLimitResult = {
  configured: boolean;
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

function redisConfig() {
  const endpoint = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!endpoint || !token) return null;

  const url = new URL(endpoint);
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("Redis REST must use HTTPS outside localhost.");
  }
  return { endpoint: url.toString().replace(/\/+$/, ""), token };
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function redisRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RedisRateLimitResult> {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new Error("Redis rate-limit bounds must be positive integers.");
  }

  const config = redisConfig();
  if (!config) {
    return { configured: false, allowed: false, remaining: 0, retryAfterSeconds: 0 };
  }

  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(["EVAL", INCREMENT_WINDOW_SCRIPT, 1, key, windowMs]),
    cache: "no-store",
    signal: AbortSignal.timeout(1_500),
  });
  if (!response.ok) throw new Error(`Redis REST returned HTTP ${response.status}.`);

  const payload = (await response.json().catch(() => null)) as { result?: unknown; error?: unknown } | null;
  if (!payload || typeof payload !== "object" || payload.error) {
    throw new Error("Redis REST returned an invalid response.");
  }
  const result = payload.result;
  if (!Array.isArray(result) || result.length < 2) {
    throw new Error("Redis rate-limit script returned an invalid counter.");
  }
  const count = finiteNumber(result[0]);
  const ttlMs = finiteNumber(result[1]);
  if (count === null || ttlMs === null || count < 1 || ttlMs < 0) {
    throw new Error("Redis rate-limit script returned invalid values.");
  }

  return {
    configured: true,
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1_000)),
  };
}
