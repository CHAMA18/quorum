import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { attestSignature } from "@/lib/sidecar-attest";
import { canMutateSidecar } from "@/lib/permissions";
import { verifyProposal } from "@/lib/muse-actions";

/**
 * POST /api/muse/execute — the consent gate for the desk agent's actions.
 *
 * The chat loop never executes a write. When the officer confirms a proposal
 * card, the bubble posts it here and — only here — the action actually runs:
 *
 *   1. The proposal is verified against its HMAC signature and a 10-minute
 *      TTL, so edited or stale cards are refused.
 *   2. The caller must have a signed-in session and the workspace capability
 *      to assign review runs.
 *   3. The request is forwarded to the quorum-mcp sidecar with a workspace
 *      scoped HMAC attestation identifying the human who confirmed it.
 *   4. This route cannot approve, reject, award or sign a procurement gate.
 *
 * The response is a trimmed receipt the bubble can read aloud: what ran,
 * what it produced, who signed. Failures name the reason and change nothing.
 */

const SIDECAR = (process.env.QUORUM_SIDECAR_URL?.trim() || "http://127.0.0.1:3031").replace(/\/+$/, "");

const BodySchema = z.object({
  proposal: z
    .object({
      id: z.string(),
      actorId: z.string(),
      workspaceId: z.string(),
      tool: z.string(),
      args: z.record(z.string(), z.unknown()),
      label: z.string(),
      summary: z.array(z.object({ key: z.string(), value: z.string() })),
      risk: z.string(),
      irreversible: z.boolean(),
      createdAt: z.number(),
      sig: z.string(),
    })
    .passthrough(),
  /* Explicit consent — a confirmed card is the only path here. */
  consent: z.literal(true),
});

interface ExecOk {
  executed: true;
  tool: string;
  headline: string;
  detail: string[];
  receipt?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "A signed proposal and explicit consent are required." }, { status: 422 });
  }

  const check = verifyProposal(parsed.data.proposal as never);
  if (!check.ok) {
    return NextResponse.json({ error: check.reason }, { status: 400 });
  }
  const proposal = check.proposal;

  /* Identity comes from the session cookie; the request body cannot rename
     the person assigning this run. */
  const user = await getUserFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to act — the agent's actions run under a named human, never anonymously." },
      { status: 401 },
    );
  }

  if (proposal.actorId !== user.id || proposal.workspaceId !== user.workspaceId) {
    return NextResponse.json(
      { error: "This confirmation belongs to a different user or workspace. Ask the agent to stage a fresh assignment." },
      { status: 403 },
    );
  }

  /* This endpoint is intentionally unable to issue a procurement decision.
     The only assistant write assigns an evaluation run to the agent. */
  if (proposal.tool !== "launch_review" || proposal.irreversible || proposal.risk !== "RUN") {
    return NextResponse.json({ error: "The assistant can prepare reviews, but final gate decisions belong to an authorized human." }, { status: 403 });
  }
  const tenderId = String(proposal.args.tenderId ?? "").trim();
  if (!tenderId) return NextResponse.json({ error: "The staged proposal is missing its tender reference." }, { status: 422 });
  /* Keep free-text conversation context out of the sidecar. Only the exact
     tender reference shown on the confirmed card crosses this boundary. */
  const path = "/api/runs";
  const payload: Record<string, unknown> = { tenderId };

  /* Capability: the same role rules the gateway enforces for the screens. */
  if (!canMutateSidecar(user.role, "POST", path)) {
    return NextResponse.json(
      { error: `Your workspace role (${user.role}) cannot perform this action.` },
      { status: 403 },
    );
  }

  const ts = Date.now();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-quorum-actor": user.name,
    "x-quorum-actor-id": user.id,
    "x-quorum-workspace": user.workspaceId,
    "x-quorum-ts": String(ts),
    "x-quorum-attest": attestSignature("POST", path, user.name, ts, user.workspaceId),
  };

  let upstream: Response;
  try {
    upstream = await fetch(`${SIDECAR}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return NextResponse.json({ error: "The sidecar is unreachable — nothing was changed. Try again in a moment." }, { status: 502 });
  }

  const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
  if (!upstream.ok) {
    const reason = String(data.error ?? `sidecar ${upstream.status}`);
    return NextResponse.json({ executed: false, error: reason }, { status: upstream.status });
  }

  return NextResponse.json(trimReceipt(proposal.tool, data));
}

/* ── The receipt the bubble reads aloud ──────────────────────────────────── */

function trimReceipt(tool: string, data: Record<string, unknown>): ExecOk {
  const run = data.run as Record<string, unknown> | undefined;
  if (run) {
    return {
      executed: true,
      tool,
      headline: `The review run on ${String(run.tenderId ?? "the tender")} is live — the agent is reading the pack now.`,
      detail: [
        `RUN · ${String(run.id ?? "?")}`,
        `TENDER · ${String(run.tenderId ?? "?")}`,
        `STATUS · ${String(run.status ?? "RUNNING")}`,
      ],
      receipt: run,
    };
  }
  return { executed: true, tool, headline: "The action ran.", detail: [] };
}
