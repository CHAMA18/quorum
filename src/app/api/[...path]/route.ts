import { NextRequest, NextResponse } from "next/server";

/**
 * Same-origin gateway.
 *
 * The frontend calls the quorum-mcp sidecar as `/api/*?XTransformPort=3031`,
 * relying on the Caddy gateway (:81) to send the request through this Next.js
 * authorization layer. Next.js forwards to the loopback sidecar only after
 * checking the verified session's role.
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
 * Reads require a session and a role permission for the requested surface.
 */

import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { attestSignature } from "@/lib/sidecar-attest";
import { canMutateSidecar, canReadSidecar } from "@/lib/permissions";
import { sidecarOrigin } from "@/lib/sidecar-origin";

const ALLOWED_PORTS = new Set(["3031"]);
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function proxy(req: NextRequest) {
  const port = req.nextUrl.searchParams.get("XTransformPort");
  if (!port || !ALLOWED_PORTS.has(port)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  /* Identity comes from the session cookie, verified server-side — never
     from a header the client could set. Every sidecar read needs one too:
     bidder names, bid values, supplier contacts and the audit trail are not
     public data. The marketing surfaces read /api/public/summary instead. */
  const session = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json(
      {
        error: MUTATING.has(req.method)
          ? "Sign in to make changes — state-changing requests require a session."
          : "Sign in to read the record — the desk is not public.",
      },
      { status: 401 },
    );
  }
  const actor = session.name;
  const workspaceId = session.workspaceId;
  const traceId = crypto.randomUUID();
  const requestedPath = req.nextUrl.pathname;

  /* Reads are authorised per surface, not just per session: an auditor may read
     the trail and the file, not the rule configuration. */
  if (!MUTATING.has(req.method) && !canReadSidecar(session.role, requestedPath)) {
    return NextResponse.json(
      { error: `Your workspace role (${session.role}) cannot read this part of the desk.` },
      { status: 403 },
    );
  }

  const url = new URL(req.url);

  /* Role enforcement at the public door. The sidecar still enforces its own
     named-human and roster rules; this stops a read-only role from reaching a
     mutating sidecar tool at all. */
  if (MUTATING.has(req.method) && session && !canMutateSidecar(session.role, req.method, url.pathname)) {
    return NextResponse.json(
      { error: `Your workspace role (${session.role}) cannot perform this action.` },
      { status: 403 },
    );
  }

  url.searchParams.delete("XTransformPort");
  const search = url.searchParams.toString();
  const target = `${sidecarOrigin()}${url.pathname}${search ? `?${search}` : ""}`;

  try {
    /* Forward the content type, and the attested identity + HMAC seal the
       sidecar checks on every mutation. */
    const forward: Record<string, string> = {};
    forward["x-quorum-trace-id"] = traceId;
    const contentType = req.headers.get("content-type");
    if (contentType) forward["content-type"] = contentType;
    /* The browser's step-up token for an irreversible gate decision. The
       sidecar verifies and consumes it; the gateway never mints one. */
    const stepUp = req.headers.get("x-quorum-stepup");
    if (stepUp) forward["x-quorum-stepup"] = stepUp;
    if (session) {
      forward["x-quorum-workspace"] = workspaceId;
      forward["x-quorum-actor"] = actor;
      /* The user id is what office authority is bound to. The sidecar accepts
         it only on a request that also carries this HMAC seal. */
      if (session.id) forward["x-quorum-actor-id"] = session.id;
      const ts = Date.now();
      forward["x-quorum-ts"] = String(ts);
      forward["x-quorum-attest"] = attestSignature(req.method, url.pathname, actor, ts, workspaceId);
    }

    const upstream = await fetch(target, {
      method: req.method,
      headers: Object.keys(forward).length > 0 ? forward : undefined,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      cache: "no-store",
    });

    /* Reading supplier, bid or audit data is itself a recordable act. The line
       is written to the same spine, attested, and never blocks the response. */
    if (req.method === "GET" && isSensitiveRead(url.pathname)) {
      auditRead(session.name, session.workspaceId, url.pathname, upstream.status, traceId);
    }

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "x-quorum-trace-id": upstream.headers.get("x-quorum-trace-id") ?? traceId,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("must be set to a real secret")) {
      return NextResponse.json({ error: "The procurement gateway is not configured to authenticate service requests." }, { status: 503 });
    }
    return NextResponse.json(
      { error: "The procurement service request could not be completed. Check service availability and server configuration." },
      { status: 502 },
    );
  }
}

/* Which reads name bidders, money or the record itself. */
const SENSITIVE_READS = [
  "/api/suppliers",
  "/api/applications",
  "/api/gates",
  "/api/runs",
  "/api/log",
  "/api/decisions",
  "/api/cycle",
];

function isSensitiveRead(path: string): boolean {
  return SENSITIVE_READS.some((prefix) => path === prefix || path.startsWith(prefix + "/") || path.startsWith(prefix + "?"));
}

/** Write the read to the spine. A failure is quiet here and loud in the log. */
function auditRead(actor: string, workspaceId: string, path: string, status: number, traceId: string) {
  const ts = Date.now();
  void fetch(`${sidecarOrigin()}/api/audit/read`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-quorum-trace-id": traceId,
      "x-quorum-actor": actor,
      "x-quorum-workspace": workspaceId,
      "x-quorum-ts": String(ts),
      "x-quorum-attest": attestSignature("POST", "/api/audit/read", actor, ts, workspaceId),
    },
    body: JSON.stringify({ path, status }),
  }).catch(() => undefined);
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
