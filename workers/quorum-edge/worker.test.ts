import { describe, expect, test } from "bun:test";
import worker from "./src/index";

/**
 * In-process coverage for the R2 gate's HTTP surface. A small in-memory
 * bucket stands in for the TENDERS binding, so this runs everywhere (CI
 * included) without Cloudflare credentials, unlike the live r2-gate suite.
 */

const SECRET = "test-edge-secret";

interface Stored {
  bytes: Uint8Array;
  contentType: string;
  etag: string;
}

class FakeBucket {
  readonly objects = new Map<string, Stored>();

  async put(key: string, value: ReadableStream | ArrayBuffer | string | null, options?: { httpMetadata?: { contentType?: string } }) {
    const bytes = new Uint8Array(await new Response(value).arrayBuffer());
    const etag = `etag-${key.split("/").pop() ?? key}-${bytes.byteLength}`;
    this.objects.set(key, {
      bytes,
      contentType: options?.httpMetadata?.contentType ?? "application/octet-stream",
      etag,
    });
    return { key };
  }

  async head(key: string) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    return {
      size: stored.bytes.byteLength,
      etag: stored.etag,
      httpEtag: `"${stored.etag}"`,
      httpMetadata: { contentType: stored.contentType },
    };
  }

  async get(key: string, options?: { range?: { offset: number; length: number } }) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    const range = options?.range;
    const slice = range
      ? stored.bytes.slice(range.offset, range.offset + range.length)
      : stored.bytes;
    return {
      body: new Response(slice).body as ReadableStream,
      size: stored.bytes.byteLength,
      etag: stored.etag,
      httpEtag: `"${stored.etag}"`,
      httpMetadata: { contentType: stored.contentType },
    };
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async list(options: { prefix?: string; limit?: number; cursor?: string } = {}) {
    const prefix = options.prefix ?? "";
    const limit = options.limit ?? 1000;
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const slice = keys.slice(start, start + limit);
    const truncated = start + limit < keys.length;
    return {
      objects: slice.map((key) => {
        const stored = this.objects.get(key)!;
        return {
          key,
          size: stored.bytes.byteLength,
          etag: stored.etag,
          httpEtag: `"${stored.etag}"`,
          uploaded: new Date(0),
          httpMetadata: { contentType: stored.contentType },
        };
      }),
      truncated,
      cursor: truncated ? String(start + limit) : undefined,
    };
  }
}

type EnvArg = Parameters<typeof worker.fetch>[1];

function envWith(bucket: FakeBucket): EnvArg {
  return { ORIGIN_URL: "http://origin.test", EDGE_SHARED_SECRET: SECRET, TENDERS: bucket } as unknown as EnvArg;
}

function call(bucket: FakeBucket, path: string, init: RequestInit = {}) {
  return worker.fetch(
    new Request(`https://edge.test${path}`, {
      ...init,
      headers: { "x-quorum-edge-key": SECRET, ...(init.headers as Record<string, string> | undefined) },
    }),
    envWith(bucket),
  );
}

const KEY = "tenders/KE-MOH-2026-117/notice.txt";
const BODY = "0123456789abcdefghij";

async function seeded(): Promise<FakeBucket> {
  const bucket = new FakeBucket();
  const res = await call(bucket, `/__edge/upload?key=${encodeURIComponent(KEY)}`, {
    method: "PUT",
    headers: { "content-type": "text/plain" },
    body: BODY,
  });
  expect(res.status).toBe(201);
  return bucket;
}

describe("quorum-edge R2 gate ranges", () => {
  test("a ranged GET reads only the slice and reports 206", async () => {
    const bucket = await seeded();
    const res = await call(bucket, `/__edge/object?key=${encodeURIComponent(KEY)}`, {
      headers: { range: "bytes=5-9" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 5-9/${BODY.length}`);
    expect(res.headers.get("content-length")).toBe("5");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("etag")).toBeTruthy();
    expect(await res.text()).toBe("56789");
  });

  test("open-ended and suffix ranges resolve against the object size", async () => {
    const bucket = await seeded();
    const open = await call(bucket, `/__edge/object?key=${encodeURIComponent(KEY)}`, {
      headers: { range: "bytes=15-" },
    });
    expect(open.status).toBe(206);
    expect(open.headers.get("content-range")).toBe(`bytes 15-19/${BODY.length}`);
    expect(await open.text()).toBe("fghij");

    const suffix = await call(bucket, `/__edge/object?key=${encodeURIComponent(KEY)}`, {
      headers: { range: "bytes=-4" },
    });
    expect(suffix.status).toBe(206);
    expect(await suffix.text()).toBe("ghij");

    const oversized = await call(bucket, `/__edge/object?key=${encodeURIComponent(KEY)}`, {
      headers: { range: "bytes=5-999" },
    });
    expect(oversized.headers.get("content-range")).toBe(`bytes 5-19/${BODY.length}`);
    expect(await oversized.text()).toBe("56789abcdefghij");
  });

  test("an unsatisfiable range is 416 and never reads the body", async () => {
    const bucket = await seeded();
    const res = await call(bucket, `/__edge/object?key=${encodeURIComponent(KEY)}`, {
      headers: { range: "bytes=99-100" },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${BODY.length}`);
    const json = (await res.json()) as { error?: string; size?: number };
    expect(json).toEqual({ error: "range not satisfiable", size: BODY.length });
  });

  test("multi-range and malformed headers get the whole document", async () => {
    const bucket = await seeded();
    for (const range of ["bytes=0-1,4-5", "items=0-1", "bytes=abc"]) {
      const res = await call(bucket, `/__edge/object?key=${encodeURIComponent(KEY)}`, {
        headers: { range },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("accept-ranges")).toBe("bytes");
      expect(await res.text()).toBe(BODY);
    }
  });

  test("If-Range keeps a current ETag and drops a stale one", async () => {
    const bucket = await seeded();
    const full = await call(bucket, `/__edge/object?key=${encodeURIComponent(KEY)}`);
    const etag = full.headers.get("etag") ?? "";
    await full.text();

    const current = await call(bucket, `/__edge/object?key=${encodeURIComponent(KEY)}`, {
      headers: { range: "bytes=0-2", "if-range": etag },
    });
    expect(current.status).toBe(206);
    expect(await current.text()).toBe("012");

    const stale = await call(bucket, `/__edge/object?key=${encodeURIComponent(KEY)}`, {
      headers: { range: "bytes=0-2", "if-range": '"stale"' },
    });
    expect(stale.status).toBe(200);
    expect(await stale.text()).toBe(BODY);
  });

  test("lists only the objects under the requested tender prefix", async () => {
    const bucket = await seeded();
    const other = "tenders/OTHER-TENDER/secret.txt";
    const put = await call(bucket, `/__edge/upload?key=${encodeURIComponent(other)}`, {
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body: "not this tender",
    });
    expect(put.status).toBe(201);

    const res = await call(bucket, `/__edge/list?prefix=${encodeURIComponent(`tenders/KE-MOH-2026-117/`)}`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      objects?: Array<{ key?: string; size?: number; contentType?: string; etag?: string; uploaded?: string }>;
      truncated?: boolean;
    };
    expect(json.objects).toHaveLength(1);
    expect(json.objects?.[0]).toMatchObject({ key: KEY, size: BODY.length, contentType: "text/plain" });
    expect(json.objects?.[0]?.etag).toBeTruthy();
    expect(Number.isNaN(Date.parse(json.objects?.[0]?.uploaded ?? ""))).toBe(false);
    expect(json.truncated).toBe(false);
  });

  test("paginates a listing with the R2 cursor", async () => {
    const bucket = await seeded();
    const second = "tenders/KE-MOH-2026-117/second.txt";
    await call(bucket, `/__edge/upload?key=${encodeURIComponent(second)}`, {
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body: "second",
    });

    const first = await call(
      bucket,
      `/__edge/list?prefix=${encodeURIComponent(`tenders/KE-MOH-2026-117/`)}&limit=1`,
    );
    const firstJson = (await first.json()) as {
      objects?: Array<{ key?: string }>;
      truncated?: boolean;
      cursor?: string;
    };
    expect(firstJson.objects).toHaveLength(1);
    expect(firstJson.truncated).toBe(true);
    expect(firstJson.cursor).toBeTruthy();

    const next = await call(
      bucket,
      `/__edge/list?prefix=${encodeURIComponent(`tenders/KE-MOH-2026-117/`)}&limit=1&cursor=${encodeURIComponent(firstJson.cursor ?? "")}`,
    );
    const nextJson = (await next.json()) as { objects?: Array<{ key?: string }> };
    expect(nextJson.objects).toHaveLength(1);
    expect(nextJson.objects?.[0]?.key).not.toBe(firstJson.objects?.[0]?.key);
  });

  test("lists an organization's standing documents under orgs/", async () => {
    const bucket = await seeded();
    const profileKey = "orgs/org-7/uid-9/profile-documents/abc123/tax.pdf";
    const put = await call(bucket, `/__edge/upload?key=${encodeURIComponent(profileKey)}`, {
      method: "PUT",
      headers: { "content-type": "application/pdf" },
      body: "%PDF-1.7",
    });
    expect(put.status).toBe(201);

    const res = await call(
      bucket,
      `/__edge/list?prefix=${encodeURIComponent("orgs/org-7/uid-9/profile-documents/")}`,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { prefix?: string; objects?: Array<{ key?: string }> };
    expect(json.prefix).toBe("orgs/org-7/uid-9/profile-documents/");
    expect(json.objects?.map((object) => object.key)).toEqual([profileKey]);
  });

  test("refuses a listing prefix outside tenders/ and orgs/ or with traversal", async () => {
    const bucket = await seeded();
    for (const prefix of ["", "../", "tenders/KE-MOH-2026-117", "other/x/", "orgs/../"]) {
      const res = await call(bucket, `/__edge/list?prefix=${encodeURIComponent(prefix)}`);
      expect(res.status).toBe(422);
    }
  });

  test("deletes an object through the gate and is idempotent", async () => {
    const bucket = await seeded();
    const res = await call(bucket, `/__edge/delete?key=${encodeURIComponent(KEY)}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, key: KEY });

    const gone = await call(bucket, `/__edge/object?key=${encodeURIComponent(KEY)}`);
    expect(gone.status).toBe(404);

    const again = await call(bucket, `/__edge/delete?key=${encodeURIComponent(KEY)}`, {
      method: "DELETE",
    });
    expect(again.status).toBe(200);
  });

  test("delete refuses unsafe keys, the wrong method and a missing secret", async () => {
    const bucket = await seeded();
    const unsafe = await call(bucket, `/__edge/delete?key=${encodeURIComponent("../escape.txt")}`, {
      method: "DELETE",
    });
    expect(unsafe.status).toBe(422);

    const wrongMethod = await call(bucket, `/__edge/delete?key=${encodeURIComponent(KEY)}`);
    expect(wrongMethod.status).toBe(405);

    const noSecret = await worker.fetch(
      new Request(`https://edge.test/__edge/delete?key=${encodeURIComponent(KEY)}`, {
        method: "DELETE",
      }),
      envWith(bucket),
    );
    expect(noSecret.status).toBe(401);
    expect(bucket.objects.has(KEY)).toBe(true);
  });

  test("HEAD reports metadata without a body", async () => {
    const bucket = await seeded();
    const res = await call(bucket, `/__edge/object?key=${encodeURIComponent(KEY)}`, {
      method: "HEAD",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(BODY.length));
    expect(await res.text()).toBe("");
  });
});

describe("quorum-edge Kira chat completions", () => {
  type RunInput = { messages: { role: string; content: string }[] };

  function envWithAI(answer = "Kira is ready.", calls: { model: string; input: RunInput }[] = []) {
    return {
      ORIGIN_URL: "http://origin.test",
      EDGE_SHARED_SECRET: SECRET,
      AI: {
        async run(model: string, input: RunInput) {
          calls.push({ model, input });
          return { response: answer };
        },
      },
    } as unknown as EnvArg;
  }

  function chat(env: EnvArg, init: RequestInit = {}) {
    return worker.fetch(
      new Request("https://edge.test/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) },
        body: JSON.stringify({ model: "llama3.2:3b", messages: [{ role: "user", content: "Is the gate clear?" }] }),
        ...init,
      }),
      env,
    );
  }

  test("answers in the OpenAI chat-completions shape with the gated Kira model", async () => {
    const calls: { model: string; input: RunInput }[] = [];
    const res = await chat(envWithAI("  The gate is clear.  ", calls), { headers: { "x-quorum-edge-key": SECRET } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      object: string;
      model: string;
      choices: { message: { role: string; content: string }; finish_reason: string }[];
    };
    expect(body.object).toBe("chat.completion");
    expect(body.model).toBe("@cf/meta/llama-3.2-3b-instruct");
    expect(body.choices[0].message).toEqual({ role: "assistant", content: "The gate is clear." });
    expect(body.choices[0].finish_reason).toBe("stop");
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("@cf/meta/llama-3.2-3b-instruct");
    expect(calls[0].input.messages).toEqual([{ role: "user", content: "Is the gate clear?" }]);
  });

  test("reads the current Workers AI chat-completion shape, with its usage", async () => {
    /* Meta's llama build now answers like OpenAI. The legacy `{ response }`
       shape kept working in tests while the deployed route returned 502. */
    const env = {
      ORIGIN_URL: "http://origin.test",
      EDGE_SHARED_SECRET: SECRET,
      AI: {
        async run() {
          return {
            id: "chatcmpl-test",
            model: "@cf/meta/llama-3.2-3b-instruct-v2",
            choices: [{ index: 0, message: { role: "assistant", content: "  The gate is clear.  " }, finish_reason: "stop" }],
            usage: { prompt_tokens: 42, completion_tokens: 5, total_tokens: 47 },
          };
        },
      },
    } as unknown as EnvArg;
    const res = await chat(env, { headers: { "x-quorum-edge-key": SECRET } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    expect(body.choices[0].message.content).toBe("The gate is clear.");
    expect(body.usage).toEqual({ prompt_tokens: 42, completion_tokens: 5, total_tokens: 47 });
  });

  test("reads content returned as text parts, and reports an empty answer honestly", async () => {
    const parts = {
      ORIGIN_URL: "http://origin.test",
      EDGE_SHARED_SECRET: SECRET,
      AI: { async run() { return { choices: [{ message: { content: [{ type: "text", text: "The gate " }, { type: "text", text: "is clear." }] } }] }; } },
    } as unknown as EnvArg;
    const partsRes = await chat(parts, { headers: { "x-quorum-edge-key": SECRET } });
    expect(partsRes.status).toBe(200);
    expect(((await partsRes.json()) as { choices: { message: { content: string } }[] }).choices[0].message.content).toBe("The gate is clear.");

    const silent = {
      ORIGIN_URL: "http://origin.test",
      EDGE_SHARED_SECRET: SECRET,
      AI: { async run() { return { choices: [{ message: { content: "   " } }] }; } },
    } as unknown as EnvArg;
    const silentRes = await chat(silent, { headers: { "x-quorum-edge-key": SECRET } });
    expect(silentRes.status).toBe(502);
  });

  test("accepts the edge secret as a bearer token and refuses a missing one", async () => {
    const bearer = await chat(envWithAI(), { headers: { authorization: `Bearer ${SECRET}` } });
    expect(bearer.status).toBe(200);
    const anonymous = await chat(envWithAI());
    expect(anonymous.status).toBe(401);
  });

  test("refuses non-POST, streaming, tool roles and oversized conversations", async () => {
    const env = envWithAI();
    const get = await worker.fetch(
      new Request("https://edge.test/v1/chat/completions", { headers: { "x-quorum-edge-key": SECRET } }),
      env,
    );
    expect(get.status).toBe(405);

    const streaming = await chat(env, {
      headers: { "x-quorum-edge-key": SECRET },
      body: JSON.stringify({ stream: true, messages: [{ role: "user", content: "hi" }] }),
    });
    expect(streaming.status).toBe(400);

    const toolRole = await chat(env, {
      headers: { "x-quorum-edge-key": SECRET },
      body: JSON.stringify({ messages: [{ role: "tool", content: "result" }] }),
    });
    expect(toolRole.status).toBe(422);

    const huge = await chat(env, {
      headers: { "x-quorum-edge-key": SECRET },
      body: JSON.stringify({ messages: [{ role: "user", content: "x".repeat(120_001) }] }),
    });
    expect(huge.status).toBe(413);

    const empty = await chat(env, {
      headers: { "x-quorum-edge-key": SECRET },
      body: JSON.stringify({ messages: [] }),
    });
    expect(empty.status).toBe(422);
  });
});
