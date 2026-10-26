/**
 * Portal connections — the handshake, tested without the network.
 *
 * A connection is only real if the bytes are read: these tests prove the
 * slice parser takes a complete gzip, a truncated 256 KB-style slice, and
 * plain JSONL alike, and that connectOne records an honest result either
 * way — success with the first OCID, or a failure that never throws.
 */

import { describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { OCP_AFRICA } from "./ocp-africa";
import { connectOne, firstOcidFrom } from "./portal-links";

const release = (i: number) =>
  JSON.stringify({ ocid: `ocds-synthetic-${i}`, date: "2026-01-01", tender: { id: String(i) }, tag: ["compiled"] });

const jsonl = (n: number) => Array.from({ length: n }, (_, i) => release(i)).join("\n") + "\n";

describe("first OCDS release from a slice", () => {
  test("a complete published file yields its first release", async () => {
    expect(await firstOcidFrom(gzipSync(Buffer.from(jsonl(40))))).toBe("ocds-synthetic-0");
  });

  test("a truncated slice still yields the first complete release", async () => {
    const gz = gzipSync(Buffer.from(jsonl(5000)));
    const slice = gz.subarray(0, Math.floor(gz.length * 0.4));
    expect(slice.length).toBeLessThan(gz.length);
    expect(await firstOcidFrom(slice)).toBe("ocds-synthetic-0");
  });

  test("plain JSONL (no gzip) is read too", async () => {
    expect(await firstOcidFrom(Buffer.from(jsonl(3)))).toBe("ocds-synthetic-0");
  });

  test("garbage and empty slices yield null, never a throw", async () => {
    expect(await firstOcidFrom(Buffer.from("not gzip, not json"))).toBe(null);
    expect(await firstOcidFrom(Buffer.alloc(0))).toBe(null);
  });

  test("a slice with no complete release yields null", async () => {
    const gz = gzipSync(Buffer.from(jsonl(2)));
    expect(await firstOcidFrom(gz.subarray(0, 5))).toBe(null);
  });
});

describe("connectOne", () => {
  const dataset = OCP_AFRICA.find((d) => d.publicationId === 85);
  if (!dataset) throw new Error("Ghana PPA (publication 85) missing from the registry snapshot");

  test("records the handshake — status, bounded bytes, first OCID — and the portal answer", async () => {
    const gz = gzipSync(Buffer.from(jsonl(3)));
    const calls: Array<{ url: string; method: string }> = [];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      return new Response(gz, { status: 206, headers: { "content-type": "application/gzip" } });
    }) as unknown as typeof fetch;

    const link = await connectOne(dataset, fakeFetch);
    expect(link.publicationId).toBe(85);
    expect(link.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(link.registry.ok).toBe(true);
    expect(link.registry.status).toBe(206);
    expect(link.registry.bytes).toBe(gz.length);
    expect(link.registry.ocid).toBe("ocds-synthetic-0");
    expect(link.registry.error).toBe(null);
    expect(link.portal.ok).toBe(true);
    expect(link.portal.status).toBe(206);
    /* The registry slice asked for 256 KB and the portal was asked by name. */
    expect(calls.some((c) => c.url.includes("publication/85/download"))).toBe(true);
    expect(calls.some((c) => c.url === dataset.portalUrl)).toBe(true);
  });

  test("a refused handshake is recorded as a failure, never thrown", async () => {
    const fakeFetch = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const link = await connectOne(dataset, fakeFetch);
    expect(link.registry.ok).toBe(false);
    expect(link.registry.status).toBe(500);
    expect(link.registry.error).toBe("HTTP 500");
    expect(link.portal.ok).toBe(false);
    expect(link.portal.error).toBe("HTTP 500");
  });
});
