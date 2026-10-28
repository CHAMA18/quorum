import { describe, expect, test } from "bun:test";

/**
 * End-to-end coverage for the quorum-edge R2 gate.
 *
 * This runs against the deployed Worker (QUORUM_EDGE_URL) with the
 * server-to-server secret (QUORUM_EDGE_SECRET), so it exercises the real
 * Cloudflare binding and the real bucket — not a mock. When either variable
 * is missing (for example in CI) the whole suite is skipped instead of
 * failing for lack of production credentials.
 *
 * The roundtrip reuses one fixed key. The gate deliberately has no delete
 * route, so the object stays in `quorum-tenders` after a run; it is a few
 * bytes under the reserved `__e2e/` prefix.
 */

const EDGE_URL = (process.env.QUORUM_EDGE_URL ?? "").trim().replace(/\/+$/, "");
const EDGE_SECRET = (process.env.QUORUM_EDGE_SECRET ?? "").trim();
const CONFIGURED = EDGE_URL.length > 0 && EDGE_SECRET.length > 0;

const KEY = "__e2e/r2-gate.txt";
const AUTH = { "x-quorum-edge-key": EDGE_SECRET };
const TIMEOUT = 30_000;

const suite = CONFIGURED ? describe : describe.skip;

async function edge(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${EDGE_URL}${path}`, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT - 5_000),
  });
}

suite("quorum-edge R2 gate (live)", () => {
  test("the worker is healthy and has the TENDERS binding", async () => {
    const res = await edge("/__edge/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; service?: string; r2Bound?: boolean };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("quorum-edge");
    expect(body.r2Bound).toBe(true);
  }, TIMEOUT);

  test("upload refuses a missing secret", async () => {
    const res = await edge(`/__edge/upload?key=${encodeURIComponent(KEY)}`, {
      method: "PUT",
      body: "no secret",
    });
    expect(res.status).toBe(401);
  }, TIMEOUT);

  test("upload refuses a wrong secret", async () => {
    const res = await edge(`/__edge/upload?key=${encodeURIComponent(KEY)}`, {
      method: "PUT",
      headers: { "x-quorum-edge-key": "not-the-secret" },
      body: "wrong secret",
    });
    expect(res.status).toBe(401);
  }, TIMEOUT);

  test("download refuses a missing secret", async () => {
    const res = await edge(`/__edge/object?key=${encodeURIComponent(KEY)}`);
    expect(res.status).toBe(401);
  }, TIMEOUT);

  test("a missing or unsafe key is refused with 422", async () => {
    const upload = await edge("/__edge/upload", { method: "PUT", headers: AUTH, body: "x" });
    expect(upload.status).toBe(422);

    const download = await edge("/__edge/object", { headers: AUTH });
    expect(download.status).toBe(422);

    const traversal = await edge(`/__edge/upload?key=${encodeURIComponent("../escape.txt")}`, {
      method: "PUT",
      headers: AUTH,
      body: "x",
    });
    expect(traversal.status).toBe(422);
  }, TIMEOUT);

  test("upload only accepts PUT or POST", async () => {
    const res = await edge(`/__edge/upload?key=${encodeURIComponent(KEY)}`, { headers: AUTH });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow") ?? "").toContain("PUT");
  }, TIMEOUT);

  test("upload accepts POST as well as PUT", async () => {
    const res = await edge(`/__edge/upload?key=${encodeURIComponent(KEY)}`, {
      method: "POST",
      headers: { ...AUTH, "content-type": "text/plain" },
      body: "post-path",
    });
    expect(res.status).toBe(201);
  }, TIMEOUT);

  test("upload then download roundtrips the exact bytes through R2", async () => {
    const body = `quorum-edge r2 e2e ${Date.now()}`;
    const put = await edge(`/__edge/upload?key=${encodeURIComponent(KEY)}`, {
      method: "PUT",
      headers: { ...AUTH, "content-type": "text/plain" },
      body,
    });
    expect(put.status).toBe(201);
    const stored = (await put.json()) as { ok?: boolean; key?: string };
    expect(stored.ok).toBe(true);
    expect(stored.key).toBe(KEY);

    const get = await edge(`/__edge/object?key=${encodeURIComponent(KEY)}`, { headers: AUTH });
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type") ?? "").toContain("text/plain");
    expect(await get.text()).toBe(body);
  }, TIMEOUT);

  test("download returns 404 for an object that does not exist", async () => {
    const missing = `__e2e/missing-${Date.now()}.txt`;
    const res = await edge(`/__edge/object?key=${encodeURIComponent(missing)}`, { headers: AUTH });
    expect(res.status).toBe(404);
  }, TIMEOUT);

  test("serves a closed, open-ended and suffix byte range as 206", async () => {
    const body = "0123456789abcdefghij";
    const put = await edge(`/__edge/upload?key=${encodeURIComponent(KEY)}`, {
      method: "PUT",
      headers: { ...AUTH, "content-type": "text/plain" },
      body,
    });
    expect(put.status).toBe(201);

    const closed = await edge(`/__edge/object?key=${encodeURIComponent(KEY)}`, {
      headers: { ...AUTH, range: "bytes=5-9" },
    });
    expect(closed.status).toBe(206);
    expect(closed.headers.get("content-range")).toBe(`bytes 5-9/${body.length}`);
    expect(closed.headers.get("accept-ranges")).toBe("bytes");
    expect(closed.headers.get("etag")).toBeTruthy();
    expect(await closed.text()).toBe("56789");

    const open = await edge(`/__edge/object?key=${encodeURIComponent(KEY)}`, {
      headers: { ...AUTH, range: "bytes=15-" },
    });
    expect(open.status).toBe(206);
    expect(open.headers.get("content-range")).toBe(`bytes 15-19/${body.length}`);
    expect(await open.text()).toBe("fghij");

    const suffix = await edge(`/__edge/object?key=${encodeURIComponent(KEY)}`, {
      headers: { ...AUTH, range: "bytes=-4" },
    });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get("content-range")).toBe(`bytes 16-19/${body.length}`);
    expect(await suffix.text()).toBe("ghij");
  }, TIMEOUT);

  test("an unsatisfiable range is 416 with the object size", async () => {
    const body = "range-416";
    const put = await edge(`/__edge/upload?key=${encodeURIComponent(KEY)}`, {
      method: "PUT",
      headers: { ...AUTH, "content-type": "text/plain" },
      body,
    });
    expect(put.status).toBe(201);

    const res = await edge(`/__edge/object?key=${encodeURIComponent(KEY)}`, {
      headers: { ...AUTH, range: "bytes=99-100" },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${body.length}`);
    const json = (await res.json()) as { error?: string; size?: number };
    expect(json.error).toBe("range not satisfiable");
    expect(json.size).toBe(body.length);
  }, TIMEOUT);

  test("a malformed or multi-range header gets the full 200 document", async () => {
    const body = "whole-document";
    const put = await edge(`/__edge/upload?key=${encodeURIComponent(KEY)}`, {
      method: "PUT",
      headers: { ...AUTH, "content-type": "text/plain" },
      body,
    });
    expect(put.status).toBe(201);

    for (const range of ["bytes=0-1,4-5", "items=0-1", "bytes=abc"]) {
      const res = await edge(`/__edge/object?key=${encodeURIComponent(KEY)}`, {
        headers: { ...AUTH, range },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("accept-ranges")).toBe("bytes");
      expect(await res.text()).toBe(body);
    }
  }, TIMEOUT);

  test("If-Range keeps a current range and falls back to 200 for a stale one", async () => {
    const body = "if-range-body";
    const put = await edge(`/__edge/upload?key=${encodeURIComponent(KEY)}`, {
      method: "PUT",
      headers: { ...AUTH, "content-type": "text/plain" },
      body,
    });
    expect(put.status).toBe(201);
    const full = await edge(`/__edge/object?key=${encodeURIComponent(KEY)}`, { headers: AUTH });
    const etag = full.headers.get("etag") ?? "";
    expect(etag).toBeTruthy();

    const current = await edge(`/__edge/object?key=${encodeURIComponent(KEY)}`, {
      headers: { ...AUTH, range: "bytes=0-2", "if-range": etag },
    });
    expect(current.status).toBe(206);
    expect(await current.text()).toBe("if-");

    const stale = await edge(`/__edge/object?key=${encodeURIComponent(KEY)}`, {
      headers: { ...AUTH, range: "bytes=0-2", "if-range": '"stale"' },
    });
    expect(stale.status).toBe(200);
    expect(await stale.text()).toBe(body);
  }, TIMEOUT);
});
