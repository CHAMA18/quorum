/**
 * The local brain — the desk agent that works with no model key.
 *
 * When MUSE_API_KEY is absent the bubble used to say "no model key yet".
 * It does not any more: this deterministic brain reads the same desk tools
 * and stages the same signed proposals, so the assistant stays genuinely
 * agentic — reads, numbers, deadlines, gate decisions, review launches —
 * with nothing but the sidecar behind it. When the Meta model key arrives,
 * the same loop hands over to Muse Spark and this file becomes the silent
 * fallback it always was.
 *
 * It is intentionally narrow: keyword intents over the live record, sharp
 * one-paragraph answers, and action proposals that go through exactly the
 * same consent card the model's proposals use. It never guesses a gate id
 * or a tender reference — it reads them from the desk.
 */

import { runDeskTool } from "@/lib/muse-desk-tools";
import { buildProposal, type Proposal } from "@/lib/muse-actions";
import { readSystemGuide } from "@/lib/quorum-knowledge";

export interface BrainAnswer {
  reply: string;
  tools: string[];
  proposal?: Proposal;
}

/* The projection list_approvals returns: id + display fields. */
type GateView = {
  id: string;
  tender: string;
  gate: string;
  status: string;
  filedAt: string;
  decidedAt?: string | null;
  signedBy?: string | null;
};

const has = (text: string, ...words: string[]) => words.some((w) => text.includes(w));

const TENDER_REF = /\b[A-Z]{1,4}(?:-[A-Z]{1,6})?-\d{4}-\d{2,4}\b/i;
const GATE_REF = /\bgate[_-][a-z0-9]{4,}\b/i;

/* The desk stores references upper-case; accept what the officer typed. */
function tenderRefIn(text: string): string | undefined {
  return text.match(TENDER_REF)?.[0]?.toUpperCase();
}

function trimSentences(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars);
  const dot = cut.lastIndexOf(". ");
  return dot > maxChars * 0.5 ? cut.slice(0, dot + 1) : `${cut.trimEnd()}…`;
}

async function readTool(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const raw = await runDeskTool(name, args);
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { error: raw.slice(0, 200) };
  }
}

/* ── Composers: the number that matters first, then the sentence ─────────── */

async function answerDeskSnapshot(): Promise<BrainAnswer> {
  const snap = await readTool("desk_snapshot");
  if (snap.error) {
    return { reply: "The desk could not be read just now — the agent service looks briefly unreachable. Nothing I can count yet; try again in a moment.", tools: ["desk_snapshot"] };
  }
  const ev = (snap.evaluations ?? {}) as Record<string, number>;
  const ap = (snap.approvals ?? {}) as Record<string, number>;
  const q = (snap.quorum ?? {}) as Record<string, unknown>;
  const agent = (snap.agent ?? {}) as Record<string, unknown>;
  const bits: string[] = [];
  bits.push(`${ev.total ?? 0} evaluations on the desk — ${ev.running ?? 0} running, ${ev.atGate ?? 0} at the gate, ${ev.filed ?? 0} filed.`);
  bits.push(`${ap.pending ?? 0} approval${(ap.pending ?? 0) === 1 ? "" : "s"} waiting for a human signature.`);
  if (q.present !== undefined) bits.push(`Committee: ${q.present} of ${q.seats ?? "?"} present — quorum ${q.met ? "is met" : "is not met"}.`);
  if (agent.online === false) bits.push("The agent service is not answering its health check right now.");
  return { reply: bits.join(" "), tools: ["desk_snapshot"] };
}

async function answerApprovals(): Promise<{ answer: BrainAnswer; pending: GateView[] }> {
  const data = await readTool("list_approvals", { limit: 12 });
  const list = ((data.approvals ?? []) as GateView[]).filter((g) => g.status?.startsWith("PENDING"));
  const total = Number(data.count ?? 0);
  if (!list.length) {
    return {
      answer: { reply: `No approvals are waiting at the gate right now — ${total ? "everything filed has been decided" : "the gate is empty"}.`, tools: ["list_approvals"] },
      pending: [],
    };
  }
  const names = list.slice(0, 4).map((g) => `${g.gate ?? "file"} for ${g.tender}`);
  const more = list.length > 4 ? ` — and ${list.length - 4} more` : "";
  return {
    answer: {
      reply: `${list.length} file${list.length === 1 ? " is" : "s are"} waiting at the gate: ${names.join(", ")}${more}. Say "approve it" or "return it" — or name the gate id — and I will stage the decision for your signature.`,
      tools: ["list_approvals"],
    },
    pending: list,
  };
}

async function answerEvaluations(): Promise<BrainAnswer> {
  const data = await readTool("list_evaluations", { limit: 6 });
  const list = (data.evaluations ?? []) as { tender: string; status: string; findings: number; citations: number }[];
  if (!list.length) return { reply: "No evaluations have been run yet. Name a tender reference and I will stage a review launch.", tools: ["list_evaluations"] };
  const lines = list.slice(0, 4).map((r) => `${r.tender}: ${r.status}, ${r.findings} finding${r.findings === 1 ? "" : "s"} (${r.citations} cited)`);
  return { reply: `${data.count} most recent evaluations — ${lines.join("; ")}.`, tools: ["list_evaluations"] };
}

async function answerCommittee(): Promise<BrainAnswer> {
  const cm = await readTool("committee_state");
  if (cm.error) return { reply: "The committee register could not be read just now — the web store looks briefly unreachable.", tools: ["committee_state"] };
  const present = Number(cm.present ?? 0);
  const required = Number(cm.required ?? 0);
  const members = (cm.members ?? []) as { name: string; status: string; chair?: boolean }[];
  const here = members.filter((m) => m.status === "PRESENT").map((m) => m.name).slice(0, 5);
  const sitting = cm.openSitting as { title?: string; status?: string } | null;
  const bits = [`${present} of ${cm.seats ?? members.length} seats present — quorum ${cm.quorumMet ? "is met" : "is not met"}${required ? ` (${required} required)` : ""}.`];
  if (here.length) bits.push(`In the room: ${here.join(", ")}.`);
  if (sitting?.status) bits.push(`A sitting is ${String(sitting.status).toLowerCase()}${sitting.title ? ` — ${sitting.title}` : ""}.`);
  return { reply: bits.join(" "), tools: ["committee_state"] };
}

async function answerDeadlines(): Promise<BrainAnswer> {
  const dl = await readTool("list_deadlines");
  const clocks = (dl.clocks ?? []) as { tender: string; kind: string; dueAt: string; overdue?: boolean }[];
  if (!clocks.length) return { reply: "No statutory clocks are running on the desk right now.", tools: ["list_deadlines"] };
  const overdue = clocks.filter((c) => c.overdue);
  const soon = clocks.slice(0, 3).map((c) => `${c.kind} on ${c.tender} due ${String(c.dueAt).slice(0, 10)}`);
  if (overdue.length) {
    return { reply: `${overdue.length} clock${overdue.length === 1 ? " is" : "s are"} OVERDUE — ${overdue.slice(0, 3).map((c) => `${c.kind} on ${c.tender}`).join(", ")}. ${clocks.length - overdue.length} others still running.`, tools: ["list_deadlines"] };
  }
  return { reply: `${clocks.length} statutory clocks running — next up: ${soon.join("; ")}.`, tools: ["list_deadlines"] };
}

async function answerAudit(): Promise<BrainAnswer> {
  const log = await readTool("list_audit", { limit: 8 });
  const entries = (log.entries ?? []) as { at: string; actor: string; tool: string; kind: string; status: string }[];
  if (!entries.length) return { reply: "The audit trail is empty — nothing has happened on the desk yet.", tools: ["list_audit"] };
  const last = entries[0];
  const lines = entries.slice(0, 3).map((e) => `${e.actor} · ${e.tool} · ${e.status}`);
  return { reply: `Latest on the audit trail (${entries.length} recent): ${lines.join("; ")}. The full hash-chained record is in the Audit trail screen.`, tools: ["list_audit"] };
}

async function answerSuppliers(): Promise<BrainAnswer> {
  const data = await readTool("list_suppliers", { limit: 25 });
  const list = (data.suppliers ?? []) as { name: string; status: string }[];
  if (!list.length) return { reply: "The supplier register is empty.", tools: ["list_suppliers"] };
  const active = list.filter((s) => s.status === "ACTIVE").length;
  const flagged = list.filter((s) => s.status === "SUSPENDED" || s.status === "BLACKLISTED");
  const bits = [`${data.count} suppliers on the register, ${active} active.`];
  if (flagged.length) bits.push(`Flagged: ${flagged.slice(0, 3).map((s) => `${s.name} (${s.status})`).join(", ")}.`);
  return { reply: bits.join(" "), tools: ["list_suppliers"] };
}

async function answerTender(ref: string): Promise<BrainAnswer> {
  const data = await readTool("find_tender", { tenderId: ref });
  if (data.error) {
    return { reply: `I could not find "${ref}" on the desk — check the reference. The ones I can see are on the Evaluations screen.`, tools: ["find_tender"] };
  }
  const cycle = data.cycle as Record<string, unknown> | null;
  const gates = (data.gates ?? []) as { gate: string; status: string }[];
  const evals = (data.evaluations ?? []) as { status: string }[];
  const bits = [`${ref}: ${evals.length ? `latest evaluation ${evals[0].status}` : "no evaluation run yet"}${cycle?.closingDate ? `, closed ${String(cycle.closingDate).slice(0, 10)}` : ""}.`];
  if (gates.length) bits.push(`Gates: ${gates.map((g) => `${g.gate} ${g.status}`).join(", ")}.`);
  if (cycle && typeof cycle.albOpen === "number" && cycle.albOpen > 0) bits.push(`${cycle.albOpen} ALB dossier(s) still open.`);
  if (cycle?.contract) bits.push("A contract is on the record for this tender.");
  return { reply: bits.join(" "), tools: ["find_tender"] };
}

function answerGuide(text: string): BrainAnswer {
  const topicMap: [RegExp, string][] = [
    [/gate|approval|sign|step.?up|gavel|receipt/i, "gate"],
    [/audit|trail|hash|log/i, "audit"],
    [/role|permission|who can|owner|admin|officer|auditor/i, "roles"],
    [/screen|where (is|do|can)|navigate|tab/i, "screens"],
    [/cycle|standstill|award notice|opening|matrix|complaint|debrief|contract/i, "cycle"],
    [/source|ocds|ocp|portal data|registry/i, "sources"],
    [/meeting|sitting|summon|calendar|jitsi/i, "meetings"],
    [/supplier|bidder|vendor|org portal/i, "suppliers"],
    [/notif|clock|deadline|inbox|email|whatsapp/i, "notifications"],
    [/upload|document|pack|pdf|ocr/i, "documents"],
    [/model|muse|spark|voice|provenance|llm/i, "models"],
    [/security|injection|safe|prompt/i, "security"],
    [/deploy|hosting|worker|ec2|storage/i, "deployment"],
    [/roadmap|not yet|limit|real|honest/i, "limits"],
    [/review|pipeline|finding|redline|citation/i, "review"],
  ];
  const hit = topicMap.find(([re]) => re.test(text));
  const topic = hit?.[1] ?? "overview";
  const full = readSystemGuide(topic);
  const title = full.split("\n")[0] ?? "Quorum";
  const body = full.slice(full.indexOf("\n") + 1);
  return {
    reply: `${title} — ${trimSentences(body, 460)} Ask me about another topic, or the desk itself.`,
    tools: ["system_guide"],
  };
}

function capabilityReply(who?: string): string {
  return `I am Quorum's desk agent${who ? `, ${who}` : ""}. I read the desk live — evaluations, approvals, quorum, statutory clocks, audit, suppliers, one tender's record — and I can act: approve or return a file at the gate, launch a review on a tender. Nothing moves on my word alone: you get a confirmation card, and a gate decision needs your step-up signature. Ask, or tell me what to do.`;
}

/* ── Action staging ──────────────────────────────────────────────────────── */

async function stageGateDecision(
  text: string,
  approve: boolean,
  who?: string,
): Promise<BrainAnswer> {
  const rawGate = text.match(GATE_REF)?.[0];
  const tenderRef = tenderRefIn(text);
  const data = await readTool("list_approvals", { limit: 40 });
  const pending = ((data.approvals ?? []) as GateView[]).filter(
    (g) => g.status === "PENDING" || g.status.startsWith("PENDING —"),
  );

  if (!pending.length) {
    return { reply: "There is nothing at the gate to decide — no PENDING approvals on the desk right now.", tools: ["list_approvals"] };
  }

  let gate = pending.find((g) => rawGate && g.id.toLowerCase() === rawGate.toLowerCase());
  if (!gate && tenderRef) gate = pending.find((g) => g.tender.toLowerCase() === tenderRef.toLowerCase());
  if (!gate && pending.length === 1) gate = pending[0];
  if (!gate) {
    const names = pending.slice(0, 5).map((g) => `${g.id} (${g.tender})`).join(", ");
    return { reply: `Several files are waiting — name one and I will stage it: ${names}.`, tools: ["list_approvals"] };
  }

  const verb = approve ? "approve and file" : "return to the agent";
  const proposal = buildProposal(approve ? "approve_gate" : "reject_gate", {
    gateId: gate.id,
    note: `Staged from the desk assistant${who ? ` for ${who}` : ""}.`,
  });
  if ("error" in proposal) return { reply: proposal.error, tools: [] };
  return {
    reply: `Staged: ${verb} ${gate.id} — ${gate.gate} for ${gate.tender}. Nothing moves until you confirm the card. Approving files the bundle for good; signing needs your step-up.`,
    tools: ["list_approvals", approve ? "approve_gate" : "reject_gate"],
    proposal,
  };
}

async function stageReviewLaunch(text: string): Promise<BrainAnswer> {
  const tenderRef = tenderRefIn(text);
  if (!tenderRef) {
    const data = await readTool("list_evaluations", { limit: 5 });
    const known = ((data.evaluations ?? []) as { tender: string }[]).map((r) => r.tender);
    const hint = known.length ? ` Recent ones on the desk: ${known.slice(0, 4).join(", ")}.` : "";
    return { reply: `Give me the tender reference to review — for example RW-RURA-2027-021.${hint}`, tools: known.length ? ["list_evaluations"] : [] };
  }
  const detail = await readTool("find_tender", { tenderId: tenderRef });
  const known = !detail.error;
  /* A missing typed record does not block staging: the launch reads the
     staged pack, which may exist without a record. Staging is reversible —
     the consent card and the sidecar's own checks still guard the run. */
  const caveat = known ? "" : " The typed record is not on the desk — if no pack is staged either, the launch will be refused honestly.";
  const proposal = buildProposal("launch_review", { tenderId: tenderRef });
  if ("error" in proposal) return { reply: proposal.error, tools: [] };
  return {
    reply: `Staged: a full agent review on ${tenderRef} — the agent reads the pack, raises cited findings and halts at the gate. The run starts when you confirm the card.${caveat}`,
    tools: ["find_tender", "launch_review"],
    proposal,
  };
}

/* ── The brain itself ────────────────────────────────────────────────────── */

export async function localAgent(message: string, who?: string): Promise<BrainAnswer> {
  const text = message.toLowerCase().trim();

  /* Actions first — consent-gated, never executed here. */
  const wantsApprove = has(text, "approve", "sign", "release", "award", "file it", "file the", "accept", "execute", "go ahead", "confirm it", "confirm the", "grant");
  const wantsReject = has(text, "reject", "return", "send back", "decline", "refuse", "not good enough", "kick back");
  const wantsLaunch = has(text, "launch", "run a review", "run the review", "start a review", "start the review", "review tender", "evaluate", "kick off", "assess", "read the pack");

  if ((wantsApprove || wantsReject) && (GATE_REF.test(text) || TENDER_REF.test(text) || has(text, "gate", "approval", "pending", "it", "them", "submission"))) {
    return stageGateDecision(text, wantsApprove && !wantsReject, who);
  }
  if (wantsLaunch && (TENDER_REF.test(text) || !wantsApprove)) {
    return stageReviewLaunch(text);
  }
  if (wantsApprove || wantsReject) {
    return stageGateDecision(text, wantsApprove && !wantsReject, who);
  }

  /* Reads — the same tools the model loop uses. */
  if (has(text, "waiting", "pending", "gate", "approval", "sign off", "queue") && !has(text, "how")) {
    const { answer } = await answerApprovals();
    return answer;
  }
  if (has(text, "quorum", "committee", "present", "sitting", "roll", "roster")) {
    return answerCommittee();
  }
  if (has(text, "deadline", "clock", "due", "overdue", "standstill", "closing")) {
    return answerDeadlines();
  }
  if (has(text, "audit", "who signed", "recent", "activity", "log", "trail")) {
    return answerAudit();
  }
  if (has(text, "supplier", "bidder", "vendor", "register")) {
    return answerSuppliers();
  }
  if (has(text, "evaluation", "review", "finding", "run", "progress", "status")) {
    const ref = tenderRefIn(message);
    if (ref) return answerTender(ref);
    return answerEvaluations();
  }
  const ref = tenderRefIn(message);
  if (ref) {
    return answerTender(ref);
  }
  if (has(text, "what is happening", "what's happening", "whats happening", "snapshot", "overview of the desk", "summar", "how does the desk look", "status")) {
    return answerDeskSnapshot();
  }
  if (has(text, "how does", "how do", "what is the", "what's the", "whats the", "who can", "where do", "where is", "explain", "guide", "manual", "roadmap", "architecture", "what is quorum", "whats quorum")) {
    return answerGuide(text);
  }
  if (has(text, "hello", "hi ", "hey", "good morning", "good afternoon", "who are you", "what can you do", "help", "capab")) {
    return { reply: capabilityReply(who), tools: [] };
  }

  /* Fallback: a one-line desk read so even a vague question gets a live answer. */
  try {
    const snap = await readTool("desk_snapshot");
    const ev = (snap.evaluations ?? {}) as Record<string, number>;
    const ap = (snap.approvals ?? {}) as Record<string, number>;
    return {
      reply: `${capabilityReply(who)} Right now: ${ev.total ?? 0} evaluations, ${ap.pending ?? 0} approval${(ap.pending ?? 0) === 1 ? "" : "s"} waiting at the gate.`,
      tools: ["desk_snapshot"],
    };
  } catch {
    return { reply: capabilityReply(who), tools: [] };
  }
}
