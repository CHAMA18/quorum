import { attestSignature } from "@/lib/sidecar-attest";

/**
 * Server-to-server calls from the org API routes to the quorum-mcp sidecar.
 *
 * The sidecar is loopback-bound and trusts exactly two identities: the web
 * gateway's HMAC seal, or a re-verified officer session. Organization
 * routes do NOT ride the public gateway (its door is officer-only by
 * design) — they attest directly, with the actor derived from the verified
 * org session: `org:<name>`. The formula must mirror store.ts exactly.
 */

const SIDECAR = "http://127.0.0.1:3031";

export async function sidecarFetch(
  path: string,
  init?: { method?: string; body?: unknown; actor?: string }
): Promise<{ status: number; data: Record<string, unknown> }> {
  const method = init?.method ?? "GET";
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers["content-type"] = "application/json";
  if (init?.actor && method !== "GET" && method !== "HEAD") {
    const ts = Date.now();
    headers["x-quorum-actor"] = init.actor;
    headers["x-quorum-ts"] = String(ts);
    headers["x-quorum-attest"] = attestSignature(method, path, init.actor, ts);
  }
  try {
    const res = await fetch(`${SIDECAR}${path}`, {
      method,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, data };
  } catch {
    return {
      status: 502,
      data: { error: "The procurement service (sidecar :3031) is not reachable — try again shortly." },
    };
  }
}

export function sidecarError(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === "string" && data.error ? data.error : fallback;
}
