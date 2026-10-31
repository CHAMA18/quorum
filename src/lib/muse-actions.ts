/**
 * Muse action tools — the consent-gated write surface.
 *
 * The desk assistant is genuinely agentic: it may READ permitted desk records
 * and may assign a review — but an action never runs because a
 * model asked. Every action is staged as a signed PROPOSAL, shown to the
 * officer as a confirmation card, and executed only after that human says go.
 * Final gate decisions are deliberately absent: only the named human can sign
 * or return a file through the Approvals workflow.
 *
 * The proposal is HMAC-signed by the server that staged it: the execute route
 * refuses a card whose action, arguments, summary or timestamp were edited in
 * the browser, so consent always maps to the exact action the officer read.
 *
 * Secrets resolve lazily and fail closed in production, the same contract
 * sidecar-attest.ts keeps.
 */

import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { secretFor } from "@/lib/secrets";
import { GUIDE_IDS } from "@/lib/quorum-knowledge";

/* ── Definitions (these travel to the model) ─────────────────────────────── */

export interface DeskTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const ACTION_TOOLS: DeskTool[] = [
  {
    name: "launch_review",
    description:
      "PROPOSE assigning Quorum's review agent to a tender. Use only when the signed-in user explicitly asks you to review, assess, investigate, or read a tender pack. First use find_tender to inspect the current record. This starts a cited evaluation and stops at the human gate; it never approves, rejects, awards, signs, or makes the final procurement decision. The desk shows the exact tender and asks for explicit confirmation before the review starts.",
    parameters: {
      type: "object",
      properties: {
        tenderId: { type: "string", description: "The tender reference, e.g. RW-RURA-2027-021." },
      },
      required: ["tenderId"],
    },
  },
];

export function isActionTool(name: string): boolean {
  return ACTION_TOOLS.some((t) => t.name === name);
}

/* ── The staged proposal ─────────────────────────────────────────────────── */

export type ProposalRisk = "RUN";

export interface Proposal {
  id: string;
  actorId: string;
  workspaceId: string;
  tool: string;
  args: Record<string, unknown>;
  label: string;
  summary: { key: string; value: string }[];
  risk: ProposalRisk;
  irreversible: boolean;
  createdAt: number;
  sig?: string;
}

const TENDER_ID = (raw: unknown): string => String(raw ?? "").trim().slice(0, 80);
export interface ProposalActor {
  id: string;
  workspaceId: string;
}

/** Build + sign a proposal server-side. The model's args are normalised here —
    the browser never gets to invent fields the execute route would honour. */
export function buildProposal(tool: string, args: Record<string, unknown>, actor: ProposalActor): Proposal | { error: string } {
  if (!actor.id || !actor.workspaceId) return { error: "A signed-in user and workspace are required to stage an action." };
  const base = { id: `prop_${randomUUID().slice(0, 12)}`, actorId: actor.id, workspaceId: actor.workspaceId, createdAt: Date.now() };
  if (tool === "launch_review") {
    const tenderId = TENDER_ID(args.tenderId);
    if (!tenderId) return { error: "A tender reference is required." };
    return signProposal({
      ...base,
      tool,
      args: { tenderId },
      label: `Assign Quorum's review agent to ${tenderId}`,
      summary: [{ key: "TENDER", value: tenderId }],
      risk: "RUN",
      irreversible: false,
    });
  }
  return { error: `Unknown action tool "${tool}".` };
}

/* ── Signing ─────────────────────────────────────────────────────────────── */

const PROPOSAL_TTL_MS = 10 * 60_000;

function actionSecret(): string {
  return secretFor("muse");
}

function payloadOf(p: Proposal): string {
  return JSON.stringify({
    id: p.id,
    actorId: p.actorId,
    workspaceId: p.workspaceId,
    tool: p.tool,
    args: p.args,
    label: p.label,
    summary: p.summary,
    risk: p.risk,
    irreversible: p.irreversible,
    createdAt: p.createdAt,
  });
}

export function signProposal(p: Proposal): Proposal {
  return { ...p, sig: createHmac("sha256", actionSecret()).update(payloadOf(p)).digest("hex") };
}

export function verifyProposal(
  incoming: Proposal | undefined | null,
): { ok: true; proposal: Proposal } | { ok: false; reason: string } {
  if (!incoming || typeof incoming !== "object") return { ok: false, reason: "No proposal was staged." };
  const { sig, ...rest } = incoming as Proposal;
  if (!sig) return { ok: false, reason: "The proposal was not signed." };
  const expected = createHmac("sha256", actionSecret()).update(payloadOf(rest)).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig));
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "The proposal does not match its signature — it was edited after the desk staged it." };
  }
  if (!isActionTool(rest.tool)) return { ok: false, reason: "Unknown action." };
  const now = Date.now();
  if (!Number.isFinite(rest.createdAt) || rest.createdAt > now + 5_000 || now - rest.createdAt > PROPOSAL_TTL_MS) {
    return { ok: false, reason: "The proposal expired — ask again and confirm the fresh card." };
  }
  return { ok: true, proposal: rest };
}

/* ── What the model sees when it stages an action ────────────────────────── */

export function proposalStagedNote(tool: string, p: Proposal): string {
  return JSON.stringify({
    staged: true,
    tool,
    proposalId: p.id,
    note:
      "PROPOSAL STAGED — the desk is now showing the officer a confirmation card. " +
      "The action has NOT run. Tell the officer plainly what you staged and why, in one or two sentences, and stop. " +
      "Never claim the action executed: the receipt arrives only after the officer confirms.",
  });
}

/* ── Local brain intent helpers (shared with the chat route) ─────────────── */

export const GUIDE_TOPICS = [...GUIDE_IDS];

/** Require an affirmative, direct request for the named tender. Questions
    about whether to act, negative instructions, and hypothetical discussion
    must never be converted into an assignment proposal. */
export function hasAffirmativeReviewIntent(message: string): boolean {
  if (/\b(?:don't|do not|didn't|did not|not|never|cancel|stop|should|whether|recommend|consider|how (?:to|do i|can i)|what if|can i|could i|would i|do you think|do you want me)\b/i.test(message)) {
    return false;
  }
  const verb = "(?:assign|delegate|review|assess|evaluate|investigate|examine|audit|launch|start|run|read)";
  const directRequest = new RegExp(
    `(?:^\\s*(?:please\\s+)?${verb}\\b|\\b(?:please|can|could|would|will)\\s+you\\s+(?:please\\s+)?${verb}\\b|\\b(?:i want|i need|i would like|i'd like)\\s+(?:you|the agent|quorum)\\s+to\\s+${verb}\\b|\\b(?:have|ask|task)\\s+(?:the\\s+)?(?:agent|you)\\s+(?:to\\s+)?${verb}\\b)`,
    "i",
  );
  return directRequest.test(message);
}

export function explicitReviewAssignment(message: string, tenderId: string): boolean {
  return Boolean(tenderId && message.toLowerCase().includes(tenderId.toLowerCase()) && hasAffirmativeReviewIntent(message));
}
