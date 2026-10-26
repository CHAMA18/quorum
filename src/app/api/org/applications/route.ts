import { NextResponse, type NextRequest } from "next/server";
import {
  clientKey,
  getOrgFromToken,
  ORG_SESSION_COOKIE,
  orgActor,
  publicOrg,
  rateLimit,
} from "@/lib/org-auth";
import { sidecarError, sidecarFetch } from "@/lib/org-sidecar";

/**
 * The organization's applications — the end of the supplier journey.
 *
 * GET /api/org/applications
 *   → this organization's applications only (orgId comes from the VERIFIED
 *     session, never from a query parameter the client could spoof).
 *
 * POST /api/org/applications { tenderRef, amount, currency?, coverNote? }
 *   → files the application into the procurement record through the
 *     sidecar, attested as org:<name>. The sidecar refuses late bids,
 *     duplicates and suspended suppliers on its own authority; this route
 *     refuses anything the org session can't vouch for.
 *
 * 201 → { application }   401 → no session   409 → duplicate
 * 422 → late / malformed   502 → sidecar down
 */
export async function GET(req: NextRequest) {
  const org = getOrgFromToken(req.cookies.get(ORG_SESSION_COOKIE)?.value);
  if (!org) {
    return NextResponse.json({ error: "Sign in as an organization to see your applications." }, { status: 401 });
  }
  const { status, data } = await sidecarFetch(`/api/applications?orgId=${encodeURIComponent(org.id)}`);
  if (status !== 200) {
    return NextResponse.json({ error: sidecarError(data, "Applications are not reachable right now.") }, { status });
  }
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const org = getOrgFromToken(req.cookies.get(ORG_SESSION_COOKIE)?.value);
  if (!org) {
    return NextResponse.json({ error: "Sign in as an organization to file an application." }, { status: 401 });
  }
  /* 30 per 15 min per network: honest abuse protection (no real desk files
     30 bids a quarter-hour) while repeated QA sweeps from one address stay
     deterministic — the sweep files probes each run and shares this bucket. */
  if (!rateLimit(clientKey(req, "org-apply"), 30, 15 * 60_000)) {
    return NextResponse.json(
      { error: "Too many applications from this network. Wait a few minutes before trying again." },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const tenderRef = typeof body.tenderRef === "string" ? body.tenderRef.trim() : "";
  const amount = Number(body.amount);
  const errors: Record<string, string> = {};
  if (!tenderRef) errors.tenderRef = "Name the tender you are applying to.";
  if (!Number.isFinite(amount) || amount <= 0) errors.amount = "Enter the bid amount — a positive number.";
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: "Check the highlighted fields.", errors }, { status: 400 });
  }

  const { status, data } = await sidecarFetch("/api/applications", {
    method: "POST",
    actor: orgActor(org),
    body: {
      tenderRef,
      amount,
      currency: typeof body.currency === "string" && body.currency.trim() ? body.currency.trim() : undefined,
      coverNote: typeof body.coverNote === "string" && body.coverNote.trim() ? body.coverNote.trim() : undefined,
      /* The org profile rides along for the supplier-register sync; the
         identity on the record remains the ATTESTED actor, never this body. */
      org: publicOrg(org),
    },
  });

  if (status !== 201) {
    return NextResponse.json({ error: sidecarError(data, "The application could not be filed.") }, { status });
  }
  return NextResponse.json(data, { status: 201 });
}
