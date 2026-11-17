import { afterEach, describe, expect, test } from "bun:test";
import { kiraChat, kiraConfigFromEnv } from "./kira";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Kira model configuration", () => {
  test("uses the local open-weight default when Kira is configured without a model", () => {
    const cfg = kiraConfigFromEnv({ KIRA_BASE_URL: "http://localhost:11434/v1" });
    expect(cfg).toMatchObject({
      baseUrl: "http://localhost:11434/v1",
      model: "llama3.2:3b",
      apiKey: "",
      reasoningEffort: "medium",
    });
  });

  test("stays off when no model endpoint is configured", () => {
    expect(kiraConfigFromEnv({})).toBeNull();
  });

  test("prefers KIRA_* over the legacy LLM_* names", () => {
    const cfg = kiraConfigFromEnv({
      KIRA_BASE_URL: "https://kira.example/v1/",
      KIRA_MODEL: "kira-procurement-1",
      KIRA_API_KEY: "kira-key",
      KIRA_REASONING_EFFORT: "low",
      LLM_BASE_URL: "https://legacy.example/v1",
      LLM_MODEL: "legacy-model",
    });
    expect(cfg).toEqual({
      baseUrl: "https://kira.example/v1",
      model: "kira-procurement-1",
      apiKey: "kira-key",
      reasoningEffort: "low",
    });
  });

  test("does not call a remote Kira host without a key", () => {
    expect(kiraConfigFromEnv({ KIRA_BASE_URL: "https://kira.example/v1" })).toBeNull();
  });

  test("sends the configured model id on a chat-completions call", async () => {
    let body: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          model: "kira-procurement-1",
          choices: [
            {
              finish_reason: "stop",
              message: { role: "assistant", content: "Ready." },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const reply = await kiraChat(
      {
        baseUrl: "https://kira.example/v1",
        apiKey: "kira-key",
        model: "kira-procurement-1",
        reasoningEffort: "medium",
      },
      [{ role: "user", content: "Test" }],
      [],
    );

    expect(body?.model).toBe("kira-procurement-1");
    expect(reply.model).toBe("kira-procurement-1");
    expect(reply.text).toBe("Ready.");
    expect(reply.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  test("reports the endpoint's measured token usage", async () => {
    globalThis.fetch = (async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          model: "kira-procurement-1",
          choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Ready." } }],
          usage: { prompt_tokens: 512, completion_tokens: 64, total_tokens: 576 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    const reply = await kiraChat(
      {
        baseUrl: "https://kira.example/v1",
        apiKey: "kira-key",
        model: "kira-procurement-1",
        reasoningEffort: "medium",
      },
      [{ role: "user", content: "Test" }],
      [],
    );

    expect(reply.usage).toEqual({ promptTokens: 512, completionTokens: 64, totalTokens: 576 });
  });
});
