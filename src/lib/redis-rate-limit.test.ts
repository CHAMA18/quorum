import { afterEach, describe, expect, test } from "bun:test";
import { redisRateLimit } from "./redis-rate-limit";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL = originalUrl;
  if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
});

describe("Redis rate limit", () => {
  test("fails closed when Redis credentials are missing", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const result = await redisRateLimit("test:key", 3, 60_000);
    expect(result).toMatchObject({ configured: false, allowed: false, remaining: 0 });
  });

  test("uses one atomic Redis script and returns the remaining quota", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    let sentBody: unknown;
    globalThis.fetch = (async (_input, init) => {
      sentBody = JSON.parse(String(init?.body));
      return Response.json({ result: [2, 14_000] });
    }) as unknown as typeof fetch;

    const result = await redisRateLimit("quorum:rate:test", 3, 60_000);
    expect(result).toEqual({ configured: true, allowed: true, remaining: 1, retryAfterSeconds: 14 });
    expect(Array.isArray(sentBody)).toBe(true);
    expect((sentBody as unknown[])[0]).toBe("EVAL");
  });

  test("refuses requests past the configured threshold", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    globalThis.fetch = (async () => Response.json({ result: [4, 800] })) as unknown as typeof fetch;

    const result = await redisRateLimit("quorum:rate:test", 3, 60_000);
    expect(result).toMatchObject({ configured: true, allowed: false, remaining: 0, retryAfterSeconds: 1 });
  });

  test("fails closed when Redis returns an error", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    globalThis.fetch = (async () => Response.json({ error: "unavailable" }, { status: 503 })) as unknown as typeof fetch;

    await expect(redisRateLimit("quorum:rate:test", 3, 60_000)).rejects.toThrow();
  });
});
