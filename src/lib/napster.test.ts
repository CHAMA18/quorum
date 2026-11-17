import { afterEach, describe, expect, it } from "bun:test";
import {
  NAPSTER_DEFAULT_BASE_URL,
  createTextSession,
  getCompanion,
  listCompanions,
  napsterBaseUrl,
  napsterConfigured,
  probeTextSession,
} from "./napster";

const originalKey = process.env.NAPSTER_API_KEY;
const originalAgentId = process.env.NAPSTER_AGENT_ID;
const originalCompanionId = process.env.NAPSTER_COMPANION_ID;
const originalFetch = globalThis.fetch;

function configureSession(companionId = "companion_test") {
  delete process.env.NAPSTER_AGENT_ID;
  process.env.NAPSTER_COMPANION_ID = companionId;
}

function sessionToken(url = "https://ws.example.test/session?token=abc") {
  return Buffer.from(JSON.stringify({ url, expiresAt: "2026-11-12T15:00:00Z" })).toString("base64");
}

function configureKey(value = "test_napster_key") {
  process.env.NAPSTER_API_KEY = value;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

afterEach(() => {
  if (originalKey === undefined) delete process.env.NAPSTER_API_KEY;
  else process.env.NAPSTER_API_KEY = originalKey;
  if (originalAgentId === undefined) delete process.env.NAPSTER_AGENT_ID;
  else process.env.NAPSTER_AGENT_ID = originalAgentId;
  if (originalCompanionId === undefined) delete process.env.NAPSTER_COMPANION_ID;
  else process.env.NAPSTER_COMPANION_ID = originalCompanionId;
  globalThis.fetch = originalFetch;
});

describe("Napster client", () => {
  it("is unconfigured without a key and never calls the network", async () => {
    delete process.env.NAPSTER_API_KEY;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return json({ items: [] });
    }) as unknown as typeof fetch;

    expect(napsterConfigured()).toBe(false);
    const result = await listCompanions();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_configured");
    expect(called).toBe(false);
  });

  it("sends the key server-side and maps a companion page", async () => {
    configureKey();
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestInit = init;
      return json({
        items: [
          {
            id: "170927c4-faee-4a3d-807c-e69d9e75cfaf",
            firstName: "Frank",
            lastName: "Rivera",
            headline: "Helping retailers make confident buying decisions.",
            status: "completed",
            previewUrl: "https://cdn.example.test/frank.jpg",
            videoLoopUrl: "http://insecure.example.test/frank.mp4",
            createdAt: 1780819043,
            versions: ["v1"],
          },
          { id: "", firstName: "Discarded" },
        ],
        total: 2,
      });
    }) as unknown as typeof fetch;

    const result = await listCompanions({ pageSize: 5 });

    expect(result.ok).toBe(true);
    expect(napsterBaseUrl()).toBe(NAPSTER_DEFAULT_BASE_URL);
    expect(requestUrl).toBe(
      "https://companion-api.napster.com/public/companions?pageSize=5&pageIndex=0",
    );
    expect((requestInit?.headers as Record<string, string>)["X-Api-Key"]).toBe("test_napster_key");
    if (result.ok) {
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0].name).toBe("Frank Rivera");
      expect(result.data.items[0].previewUrl).toBe("https://cdn.example.test/frank.jpg");
      expect(result.data.items[0].videoLoopUrl).toBeNull();
      expect(result.data.skipped).toBe(1);
      expect(result.data.total).toBe(2);
    }
  });

  it("clamps an oversized page request", async () => {
    configureKey();
    let requestUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestUrl = String(input);
      return json({ items: [] });
    }) as unknown as typeof fetch;

    await listCompanions({ pageSize: 999, pageIndex: -4 });

    expect(requestUrl).toContain("pageSize=50");
    expect(requestUrl).toContain("pageIndex=0");
  });

  it("maps a rejected credential without leaking the key", async () => {
    configureKey("super_secret_value");
    globalThis.fetch = (async () =>
      json(
        { title: "Unauthorized", detail: "Invalid API key", status: 401 },
        401,
        { "content-type": "application/problem+json" },
      )) as unknown as typeof fetch;

    const result = await listCompanions();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unauthorized");
      expect(result.status).toBe(401);
      expect(result.upstreamDetail).toBe("Invalid API key");
    }
    expect(JSON.stringify(result)).not.toContain("super_secret_value");
  });

  it("reports rate limiting and the retry window", async () => {
    configureKey();
    globalThis.fetch = (async () =>
      json({ title: "Too many requests" }, 429, { "retry-after": "30" })) as unknown as typeof fetch;

    const result = await listCompanions();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("rate_limited");
      expect(result.retryAfter).toBe("30");
    }
  });

  it("rejects an unsafe companion id before calling the API", async () => {
    configureKey();
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return json({});
    }) as unknown as typeof fetch;

    const result = await getCompanion("../../secret");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_request");
    expect(called).toBe(false);
  });

  it("treats a non-JSON success as an unreadable response", async () => {
    configureKey();
    globalThis.fetch = (async () =>
      new Response("<html>not json</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;

    const result = await listCompanions();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("bad_response");
  });

  it("reports an unreachable API as a network error", async () => {
    configureKey();
    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;

    const result = await listCompanions();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("network");
      expect(result.status).toBe(0);
    }
  });

  it("creates a companion text session and returns only the short-lived socket URL", async () => {
    configureKey("session_secret");
    configureSession();
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestInit = init;
      return json({ token: sessionToken(), connection: { id: "conn_test" } });
    }) as unknown as typeof fetch;

    const result = await createTextSession({
      initialSpeech: "Introduce yourself as the desk agent.",
      instructions: "You are the desk agent, a procurement assistant.",
    });

    expect(result.ok).toBe(true);
    expect(requestUrl).toBe("https://companion-api.napster.com/public/ws-connections");
    expect(requestInit?.method).toBe("POST");
    expect((requestInit?.headers as Record<string, string>)["X-Api-Key"]).toBe("session_secret");
    const body = JSON.parse(String(requestInit?.body));
    expect(body.companionId).toBe("companion_test");
    expect(body.modality).toBe("text");
    expect(body.initialSpeech).toContain("desk agent");
    expect(body.providerConfig.settings.instructions).toContain("procurement");
    if (result.ok) {
      expect(result.data.url).toBe("wss://ws.example.test/session?token=abc");
      expect(result.data.connectionId).toBe("conn_test");
      expect(result.data.modality).toBe("text");
    }
    expect(JSON.stringify(result)).not.toContain("session_secret");
  });

  it("prefers a configured agent over a companion", async () => {
    configureKey();
    delete process.env.NAPSTER_COMPANION_ID;
    process.env.NAPSTER_AGENT_ID = "agent_test";
    let requestUrl = "";
    let requestBody = "";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestBody = String(init?.body ?? "");
      return json({ token: sessionToken(), connection: { id: "conn_agent" } });
    }) as unknown as typeof fetch;

    const result = await createTextSession({ initialSpeech: "Say hello." });

    expect(result.ok).toBe(true);
    expect(requestUrl).toBe("https://companion-api.napster.com/public/agents/agent_test/connections");
    expect(JSON.parse(requestBody)).toMatchObject({ channelType: "websocket", modality: "text" });
    expect(JSON.parse(requestBody).providerConfig).toBeUndefined();
  });

  it("maps an inactive subscription to a clear session error", async () => {
    configureKey();
    configureSession();
    globalThis.fetch = (async () =>
      json(
        { code: "InactiveSubscription", description: "Access is denied" },
        403,
      )) as unknown as typeof fetch;

    const result = await createTextSession();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("inactive_subscription");
      expect(result.error).toContain("no active subscription");
    }
  });

  it("does not call Napster when no session target is configured", async () => {
    configureKey();
    delete process.env.NAPSTER_AGENT_ID;
    delete process.env.NAPSTER_COMPANION_ID;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return json({});
    }) as unknown as typeof fetch;

    const result = await createTextSession();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_configured");
    expect(called).toBe(false);
  });

  it("probes a session by creating and ending it", async () => {
    configureKey();
    configureSession();
    const calls: { url: string; method: string }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: String(init?.method) });
      if (init?.method === "DELETE") return json({ ok: true });
      return json({ token: sessionToken(), connection: { id: "conn_probe" } });
    }) as unknown as typeof fetch;

    const result = await probeTextSession();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.ready).toBe(true);
      expect(result.data.cleanedUp).toBe(true);
    }
    expect(calls.map((call) => call.method)).toEqual(["POST", "DELETE"]);
    expect(calls[1].url).toBe("https://companion-api.napster.com/public/connections/conn_probe");
  });
});
