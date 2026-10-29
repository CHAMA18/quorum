/**
 * Muse action tools — the consent-gated write surface.
 *
 * The desk assistant is no longer read-only. It is genuinely agentic: it may
 * READ the desk freely, and it may ACT — but an action never runs because a
 * model asked. Every action is staged as a signed PROPOSAL, shown to the
 * officer as a confirmation card, and executed only after that human says go
 * (a gate decision additionally demands a fresh step-up signature, exactly
 * like the Approvals gate screen).
 *
 * The proposal is HMAC-signed by the server that staged it: the execute route
 * refuses a card whose tool, arguments or timestamp were edited in the
 * browser, so consent always maps to the exact action the officer read.
 *
 * Secrets resolve lazily and fail closed in production, the same contract
 * sidecar-attest.ts keeps.
 */

import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { GUIDE_IDS } from "@/lib/quorum-knowledge";

/* ── Definitions (these travel to the model) ─────────────────────────────── */

export interface DeskTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const ACTION_TOOLS: DeskTool[] = [
  {
    name: "approve_gate",
    description:
      "PROPOSE approving a gate that is waiting at the human gate (a PENDING approval) — this files the submission and executes the irreversible act (award filing, notice, contract step). Do NOT run it to merely look at a gate; list_approvals is the read. The desk will show the officer a confirmation card and the action runs only after they confirm, with a fresh step-up signature.",
    parameters: {
      type: "object",
      properties: {
        gateId: { type: "string", description: "The exact gate id, e.g. gate_1a2b3c4d, from list_approvals." },
        note: { type: "string", description: "One line the officer wants on the record as the approval note." },
      },
      required: ["gateId"],
    },
  },
  {
    name: "reject_gate",
    description:
      "PROPOSE returning a PENDING submission to the agent (a REJECT at the gate — the run goes back for clarification). Use reject when the officer says return / send back / not good enough. The desk shows a confirmation card; nothing moves until the officer confirms.",
    parameters: {
      type: "object",
      properties: {
        gateId: { type: "string", description: "The exact gate id, e.g. gate_1a2b3c4d, from list_approvals." },
        note: { type: "string", description: "Why the submission is being returned." },
      },
      required: ["gateId"],
    },
  },
  {
    name: "launch_review",
    description:
      "PROPOSE launching a full agentic review run on a tender — the agent reads the pack, raises cited findings and halts at the human gate when done. The desk shows a confirmation card; the run starts only after the officer confirms.",
    parameters: {
      type: "object",
      properties: {
        tenderId: { type: "string", description: "The tender reference, e.g. RW-RURA-2027-021." },
        detail: { type: "string", description: "Optional one-line context the officer gave about this review." },
      },
      required: ["tenderId"],
    },
  },
];

export function isActionTool(name: string): boolean {
  return ACTION_TOOLS.some((t) => t.name === name);
}

/* ── The staged proposal ─────────────────────────────────────────────────── */

export type ProposalRisk = "IRREVERSIBLE" | "DECISION" | "RUN";

export interface Proposal {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  label: string;
  summary: { key: string; value: string }[];
  risk: ProposalRisk;
  irreversible: boolean;
  needsStepUp: boolean;
  createdAt: number;
  sig?: string;
}

const CLEAN_NOTE = (raw: unknown): string | undefined => {
  const note = String(raw ?? "").trim();
  return note ? note.slice(0, 300) : undefined;
};

const GATE_ID = (raw: unknown): string => String(raw ?? "").trim().slice(0, 80);
const TENDER_ID = (raw: unknown): string => String(raw ?? "").trim().slice(0, 80);

/** Build + sign a proposal server-side. The model's args are normalised here —
    the browser never gets to invent fields the execute route would honour. */
export function buildProposal(tool: string, args: Record<string, unknown>): Proposal | { error: string } {
  const base = { id: `prop_${randomUUID().slice(0, 12)}`, createdAt: Date.now() };
  if (tool === "approve_gate" || tool === "reject_gate") {
    const gateId = GATE_ID(args.gateId);
    if (!gateId) return { error: "A gate id is required — read list_approvals first." };
    const note = CLEAN_NOTE(args.note);
    const approve = tool === "approve_gate";
    return signProposal({
      ...base,
      tool,
      args: { gateId, ...(note ? { note } : {}) },
      label: approve ? "Approve & file this gate" : "Return this submission to the agent",
      summary: [
        { key: "GATE", value: gateId },
        ...(note ? [{ key: "NOTE", value: note }] : []),
      ],
      risk: approve ? "IRREVERSIBLE" : "DECISION",
      irreversible: approve,
      needsStepUp: true,
    });
  }
  if (tool === "launch_review") {
    const tenderId = TENDER_ID(args.tenderId);
    if (!tenderId) return { error: "A tender reference is required." };
    const detail = CLEAN_NOTE(args.detail);
    return signProposal({
      ...base,
      tool,
      args: { tenderId, ...(detail ? { detail } : {}) },
      label: `Launch an agent review on ${tenderId}`,
      summary: [
        { key: "TENDER", value: tenderId },
        ...(detail ? [{ key: "CONTEXT", value: detail }] : []),
      ],
      risk: "RUN",
      irreversible: false,
      needsStepUp: false,
    });
  }
  return { error: `Unknown action tool "${tool}".` };
}

/* ── Signing ─────────────────────────────────────────────────────────────── */

const DEV_ACTION_SECRET = "quorum-dev-attest-secret";
const PROPOSAL_TTL_MS = 10 * 60_000;

function actionSecret(): string {
  const secret = process.env.MUSE_ACTION_SECRET?.trim() || process.env.GATE_SECRET?.trim() || DEV_ACTION_SECRET;
  if (process.env.NODE_ENV === "production" && secret === DEV_ACTION_SECRET) {
    throw new Error("MUSE_ACTION_SECRET (or GATE_SECRET) must be set in production.");
  }
  return secret;
}

function payloadOf(p: Proposal): string {
  return `${p.id}|${p.tool}|${JSON.stringify(p.args)}|${p.createdAt}`;
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
  if (!Number.isFinite(rest.createdAt) || Date.now() - rest.createdAt > PROPOSAL_TTL_MS) {
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
