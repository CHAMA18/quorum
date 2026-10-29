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
 *      TTL, so a card edited in the browser is refused, not honoured.
 *   2. The caller must be the signed-in officer (session cookie) with the
 *      workspace capability for the action — an AUDITOR cannot sign a gate
 *      through the bubble any more than through the UI.
 *   3. The request is forwarded to the quorum-mcp sidecar with the same
 *      HMAC attestation seal the gateway uses (method|path|actor|ts), so the
 *      sidecar's audit line names the officer, not "web-app".
 *   4. A gate decision additionally carries the officer's fresh step-up
 *      token (x-quorum-stepup), which the sidecar verifies and consumes —
 *      exactly the contract the Approvals screen obeys.
 *
 * The response is a trimmed receipt the bubble can read aloud: what ran,
 * what it produced, who signed. Failures name the reason and change nothing.
 */

const SIDECAR = (process.env.QUORUM_SIDECAR_URL?.trim() || "http://127.0.0.1:3031").replace(/\/+$/, "");

const BodySchema = z.object({
  proposal: z
    .object({
      id: z.string(),
      tool: z.string(),
      args: z.record(z.string(), z.unknown()),
      label: z.string(),
      summary: z.array(z.object({ key: z.string(), value: z.string() })),
      risk: z.string(),
      irreversible: z.boolean(),
      needsStepUp: z.boolean(),
      createdAt: z.number(),
      sig: z.string(),
    })
    .passthrough(),
  /* Explicit consent — a confirmed card is the only path here. */
  consent: z.literal(true),
  stepUp: z.string().max(4096).optional(),
  note: z.string().max(300).optional(),
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

  /* Identity: the session cookie is the officer; nothing in the body can
     rename them. The approver on a gate decision IS this account. */
  const user = await getUserFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to act — the agent's actions run under a named human, never anonymously." },
      { status: 401 },
    );
  }

  /* Build the sidecar call for the staged tool. */
  let path: string;
  let payload: Record<string, unknown>;
  let needsStepUp = false;
  if (proposal.tool === "approve_gate" || proposal.tool === "reject_gate") {
    const gateId = String(proposal.args.gateId ?? "").trim();
    if (!gateId) return NextResponse.json({ error: "The staged proposal is missing its gate id." }, { status: 422 });
    path = `/api/gates/${encodeURIComponent(gateId)}/decision`;
    payload = {
      decision: proposal.tool === "approve_gate" ? "APPROVE" : "REJECT",
      approver: user.name,
      note: parsed.data.note || proposal.args.note || `Confirmed via the desk assistant by ${user.name}.`,
    };
    needsStepUp = true;
  } else if (proposal.tool === "launch_review") {
    const tenderId = String(proposal.args.tenderId ?? "").trim();
    if (!tenderId) return NextResponse.json({ error: "The staged proposal is missing its tender reference." }, { status: 422 });
    /* The sidecar only accepts a typed detail object — a free-text context
       line is not part of the run record, so it stays in the chat. */
    path = "/api/runs";
    payload = { tenderId };
  } else {
    return NextResponse.json({ error: "Unknown action." }, { status: 422 });
  }

  /* Capability: the same role rules the gateway enforces for the screens. */
  if (!canMutateSidecar(user.role, "POST", path)) {
    return NextResponse.json(
      { error: `Your workspace role (${user.role}) cannot perform this action.` },
      { status: 403 },
    );
  }

  /* A gate decision needs the officer's step-up signature — fetched by the
     bubble's own dialog. Without it the sidecar refuses; we say so up front
     so the bubble can ask for the signature instead of failing blindly. */
  const stepUp = parsed.data.stepUp?.trim();
  if (needsStepUp && !stepUp) {
    return NextResponse.json(
      { needsStepUp: true, error: "This gate needs your step-up signature — re-authenticate to continue." },
      { status: 403 },
    );
  }

  const ts = Date.now();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-quorum-actor": user.name,
    "x-quorum-ts": String(ts),
    "x-quorum-attest": attestSignature("POST", path, user.name, ts),
    ...(stepUp ? { "x-quorum-stepup": stepUp } : {}),
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
    return NextResponse.json(
      {
        executed: false,
        needsStepUp: needsStepUp && upstream.status === 403 && /step-?up/i.test(reason),
        error: reason,
      },
      { status: upstream.status },
    );
  }

  return NextResponse.json(trimReceipt(proposal.tool, data));
}

/* ── The receipt the bubble reads aloud ──────────────────────────────────── */

function trimReceipt(tool: string, data: Record<string, unknown>): ExecOk {
  const gate = data.gate as Record<string, unknown> | undefined;
  if (gate) {
    const receipt = (gate.receipt ?? undefined) as Record<string, unknown> | undefined;
    const detail: string[] = [
      `GATE · ${String(gate.id ?? "?")}`,
      `TENDER · ${String(gate.tenderId ?? "?")}`,
      `STATUS · ${String(gate.status ?? "?")}`,
      `SIGNED BY · ${String(gate.approver ?? "?")}`,
    ];
    if (receipt?.submissionId) detail.push(`RECEIPT · ${String(receipt.submissionId)}`);
    if (receipt?.sealedAt) detail.push(`SEALED · ${String(receipt.sealedAt).slice(0, 19).replace("T", " ")}`);
    return {
      executed: true,
      tool,
      headline:
        tool === "approve_gate"
          ? `${gate.tenderId ?? "The tender"} is approved and filed — the bundle is sealed and receipted.`
          : `${gate.tenderId ?? "The submission"} was returned to the agent for clarification.`,
      detail,
      receipt,
    };
  }
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
