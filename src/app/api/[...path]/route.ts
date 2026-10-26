import { NextRequest, NextResponse } from "next/server";

/**
 * Same-origin gateway.
 *
 * The frontend calls the quorum-mcp sidecar as `/api/*?XTransformPort=3031`,
 * relying on the Caddy gateway (:81) to rewrite the port. When that gateway
 * is not running the request lands here on the Next.js server — so we do the
 * forwarding ourselves instead of 404ing.
 *
 * Only requests that carry an explicit `XTransformPort` are proxied, and only
 * to the sidecar port — anything else falls through with a 404, exactly as
 * before, so existing Next API routes (/api/auth, /api/contact, …) keep
 * working untouched.
 *
 * ── Session + attestation ────────────────────────────────────────────────
 * The sidecar has no auth of its own (loopback-bound). This gateway is the
 * single public door and enforces:
 *   1. state-changing verbs (POST/PUT/PATCH/DELETE) require a signed-in
 *      session — anonymous callers get 401 before anything is forwarded;
 *   2. the actor identity is ALWAYS derived from the verified session and
 *      sent as `x-quorum-actor` — a client-declared actor header is dropped,
 *      so the audit trail can no longer be spoofed;
 *   3. every mutating forward carries an HMAC seal (x-quorum-attest over
 *      method|path|actor|ts) that the sidecar verifies — see
 *      src/lib/sidecar-attest.ts and mini-services store.attestVerify.
 * GET/HEAD stay open, except the applications list (officer session only).
 */

import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { attestSignature } from "@/lib/sidecar-attest";

const ALLOWED_PORTS = new Set(["3031"]);
const UPSTREAM_HOST = "127.0.0.1";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function proxy(req: NextRequest) {
  const port = req.nextUrl.searchParams.get("XTransformPort");
  if (!port || !ALLOWED_PORTS.has(port)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  /* Identity comes from the session cookie, verified server-side — never
     from a header the client could set. */
  const session = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (MUTATING.has(req.method) && !session) {
    return NextResponse.json(
      { error: "Sign in to make changes — state-changing requests require a session." },
      { status: 401 },
    );
  }
  const actor = session?.name ?? "";

  const url = new URL(req.url);

  /* The applications list names every bidder and its bid amount. It is an
     officer-desk read only: suppliers reach their own rows through the
     org-session routes, which attest directly to the sidecar. */
  if (req.method === "GET" && url.pathname === "/api/applications" && !session) {
    return NextResponse.json({ error: "Sign in to see the applications on the record." }, { status: 401 });
  }
  url.searchParams.delete("XTransformPort");
  const search = url.searchParams.toString();
  const target = `http://${UPSTREAM_HOST}:${port}${url.pathname}${search ? `?${search}` : ""}`;

  try {
    /* Forward the content type, and the attested identity + HMAC seal the
       sidecar checks on every mutation. Caddy passes these through
       untouched, and this fallback gateway keeps the same contract so the
       audit trail reads the same either way. */
    const forward: Record<string, string> = {};
    const contentType = req.headers.get("content-type");
    if (contentType) forward["content-type"] = contentType;
    if (actor) {
      forward["x-quorum-actor"] = actor;
      const ts = Date.now();
      forward["x-quorum-ts"] = String(ts);
      forward["x-quorum-attest"] = attestSignature(req.method, url.pathname, actor, ts);
    }

    const upstream = await fetch(target, {
      method: req.method,
      headers: Object.keys(forward).length > 0 ? forward : undefined,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      cache: "no-store",
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch {
    return NextResponse.json(
      { error: `sidecar on :${port} not reachable` },
      { status: 502 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
