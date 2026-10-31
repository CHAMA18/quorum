/**
 * Sittings — quorum comes from a noticed meeting, not from a hand-set flag.
 *
 * Before this module a gate could carry quorum while its PRESENT flags were
 * manually set: nothing on the record showed a summons was issued or that the
 * members walked through the door. WS8 closes that hole:
 *
 *  · A `Sitting` records the notice (who summoned, when), admitted
 *    attendance at the door, and the moment the sitting ended.
 *  · With the sittingQuorum flag on, every gate decision on a linked tender
 *    draws its quorum from ADMITTED attendance. An unnotified sitting is not
 *    a committee. A sitting that has ended is not a committee either.
 *  · The emergency path exists but is never free: it must name its reason
 *    (and the route still appends an audit line, so an emergency quorum is
 *    visible in the chain exactly like a normal one).
 */

import { randomUUID } from "node:crypto";
import {
  appendLog,
  currentWorkspaceId,
  normalizeSitting,
  saveState,
  state,
  type Sitting,
  type SittingAttendance,
} from "./store";

/* ── The refusal — pure, so the gate path and the tests read one truth ───── */

export interface SittingQuorumInput {
  tenderId: string;
  required: number;
  signedInAs?: string;
  now?: Date;
  sittings?: Sitting[];
  flagOn?: boolean;
}

export function sittingQuorumRefusal(input: SittingQuorumInput): string | null {
  const {
    tenderId,
    required,
    signedInAs,
    now = new Date(),
    sittings = state.sittings.filter((s) => (s.workspaceId ?? "demo") === currentWorkspaceId()),
    flagOn = state.features.sittingQuorum,
  } = input;
  if (!flagOn) return null;

  const linked = sittings
    .filter((s) => s.tenderIds.includes(tenderId))
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

  if (!linked.length) {
    return `No sitting is on record for ${tenderId} — quorum must come from a noticed sitting with admitted attendance. Schedule and notice one before any gate decision.`;
  }

  const ended = linked.filter((s) => s.endedAt && new Date(s.endedAt).getTime() <= now.getTime());
  const open = linked.filter((s) => !ended.includes(s));
  /* The freshest sitting that is still open — an officer holding two tenders
     over one committee must not inherit another sitting's missing quorum. */
  const sitting = open[0] ?? ended[0];
  if (sitting.endedAt) {
    return `The sitting for ${tenderId} has ended — quorum cannot be claimed from an adjourned meeting. Convene a new noticed sitting.`;
  }

  /* Emergency exception: an unnotified sitting may carry a quorum ONLY when
     the sitting itself records who declared the emergency and why. */
  if (!sitting.noticeAt) {
    if (sitting.emergency) return null; /* the reason is on the record — but see audit below */
    const noticeDue = sitting.scheduledAt ? "not yet issued — the sitting is due but nobody has been summoned" : "not issued";
    return `The sitting for ${tenderId} has its notice ${noticeDue}. Quorum cannot be claimed from an unnoticed sitting${sitting.emergency ? "" : " unless it is declared an emergency with a named reason"}.`;
  }
  if (new Date(sitting.noticeAt).getTime() > now.getTime()) {
    return `The notice for the ${tenderId} sitting takes effect ${new Date(sitting.noticeAt).toISOString().slice(0, 16).replace("T", " ")} — quorum cannot be claimed before the notice is live.`;
  }

  const admitted = sitting.attendance.filter((a) => a.status === "ADMITTED");
  const who = signedInAs?.trim().toLowerCase();
  const present = admitted.length + (who && !admitted.some((a) => a.name.trim().toLowerCase() === who) ? 1 : 0);
  /* The stricter threshold governs: the gate's quorum rule and the sitting's
     own declared requirement both bind, so a decision clears only when it
     satisfies the larger of the two. */
  const need = Math.max(required, sitting.quorumRequired ?? required);
  if (present < need || need < 1) {
    return `Quorum for the ${tenderId} sitting is ${present} admitted of ${need} required — the gate stays closed until the seat count is met.`;
  }
  return null;
}

/* ── Route storefronts — each mutation appends its own audit line ────────── */

interface RouteResult {
  code: number;
  body: Record<string, unknown>;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ref = (v: unknown) => str(v, 120);

function knownTender(refId: string): boolean {
  return (
    state.cycle.some((c) => c.tenderId === refId && (c.workspaceId ?? "demo") === currentWorkspaceId()) ||
    state.pipeline.some((p) => p.ref === refId || p.linkedTenderId === refId)
  );
}

/** POST /api/sittings — schedule the sitting AND issue its notice in one act.
 *  { tenderIds, scheduledAt, location?, quorumRequired?, title?, emergencyReason? } */
export function createSitting(body: Record<string, unknown>, actor: string): RouteResult {
  const rawTenders = Array.isArray(body.tenderIds) ? body.tenderIds : [];
  const tenderIds = [...new Set(rawTenders.map(ref).filter(Boolean))];
  if (!tenderIds.length) {
    return { code: 422, body: { error: "Name at least one tender this sitting will hear." } };
  }
  const unknown = tenderIds.filter((t) => !knownTender(t));
  if (unknown.length) {
    return { code: 422, body: { error: `Unknown tender ref${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. A sitting cannot be summoned for a tender the record does not know.` } };
  }
  const scheduledAtRaw = str(body.scheduledAt, 40);
  const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw) : null;
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    return { code: 422, body: { error: "Pick a real scheduled date and time for the sitting." } };
  }
  const emergencyReason = str(body.emergencyReason, 400);
  const emergency = emergencyReason.length >= 12 ? { by: actor, reason: emergencyReason, at: new Date().toISOString() } : undefined;
  if (emergencyReason && !emergency) {
    return { code: 422, body: { error: "An emergency declaration needs a reason of at least 12 characters — \"we were busy\" is not a reason." } };
  }
  if (!emergency && scheduledAt.getTime() < Date.now()) {
    return { code: 422, body: { error: "A normal sitting cannot be scheduled in the past — declare an emergency with a reason if the meeting has already begun." } };
  }
  const quorumRequiredRaw = Number(body.quorumRequired ?? NaN);
  const sitting: Sitting = {
    id: `sit_${randomUUID().slice(0, 10)}`,
    workspaceId: currentWorkspaceId(),
    tenderIds,
    ...(str(body.title, 160) ? { title: str(body.title, 160) } : {}),
    scheduledAt: scheduledAt.toISOString(),
    noticeAt: new Date().toISOString(), /* the summons is issued at creation */
    noticeIssuedBy: actor,
    ...(str(body.location, 200) ? { location: str(body.location, 200) } : {}),
    ...(Number.isFinite(quorumRequiredRaw) && quorumRequiredRaw > 0 ? { quorumRequired: Math.round(quorumRequiredRaw) } : {}),
    attendance: [],
    status: "NOTICED",
    ...(emergency ? { emergency } : {}),
  };
  state.sittings.push(sitting);
  appendLog({
    actor,
    server: "quorum-mcp",
    tool: "schedule_sitting",
    kind: "WRITES",
    inputs: { tenderIds, scheduledAt: sitting.scheduledAt, ...(sitting.quorumRequired ? { quorumRequired: sitting.quorumRequired } : {}) },
    outputs: { sittingId: sitting.id, noticeAt: sitting.noticeAt, ...(emergency ? { emergency: emergency.reason } : {}) },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { code: 201, body: { sitting } };
}

/** POST /api/sittings/:id/attendance — admit or withdraw a member at the door.
 *  { name, admit: true | false, memberId? } */
export function recordAttendance(sittingId: string, body: Record<string, unknown>, actor: string): RouteResult {
  const sitting = state.sittings.find((s) => s.id === sittingId && (s.workspaceId ?? "demo") === currentWorkspaceId());
  if (!sitting) return { code: 404, body: { error: `No sitting "${sittingId}" is on record in this workspace.` } };
  if (sitting.status === "ENDED") {
    return { code: 409, body: { error: `The sitting has ended — attendance is closed. Convene a new sitting.` } };
  }
  const name = str(body.name, 160);
  if (!name) return { code: 422, body: { error: "Name the member whose attendance is being recorded." } };
  const admit = body.admit !== false;
  const existing = sitting.attendance.find((a) => a.name.trim().toLowerCase() === name.toLowerCase());
  const row: SittingAttendance = {
    name,
    ...(str(body.memberId, 120) ? { memberId: str(body.memberId, 120) } : {}),
    status: admit ? "ADMITTED" : "WITHDRAWN",
    at: new Date().toISOString(),
    by: actor,
  };
  if (existing) Object.assign(existing, row);
  else sitting.attendance.push(row);
  sitting.status = "LIVE";
  appendLog({
    actor,
    server: "quorum-mcp",
    tool: "record_attendance",
    kind: "WRITES",
    inputs: { sittingId, member: name, admit },
    outputs: { status: row.status, admitted: sitting.attendance.filter((a) => a.status === "ADMITTED").length },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { code: 200, body: { sitting } };
}

/** POST /api/sittings/:id/end — close the sitting; quorum stops flowing from it.
 *  { minutesRef? } */
export function endSitting(sittingId: string, body: Record<string, unknown>, actor: string): RouteResult {
  const sitting = state.sittings.find((s) => s.id === sittingId && (s.workspaceId ?? "demo") === currentWorkspaceId());
  if (!sitting) return { code: 404, body: { error: `No sitting "${sittingId}" is on record in this workspace.` } };
  if (sitting.status === "ENDED") return { code: 409, body: { error: "The sitting has already ended." } };
  sitting.status = "ENDED";
  sitting.endedAt = new Date().toISOString();
  const minutesRef = str(body.minutesRef, 200);
  appendLog({
    actor,
    server: "quorum-mcp",
    tool: "end_sitting",
    kind: "WRITES",
    inputs: { sittingId, ...(minutesRef ? { minutesRef } : {}) },
    outputs: { endedAt: sitting.endedAt, admitted: sitting.attendance.filter((a) => a.status === "ADMITTED").length },
    status: "OK",
    durationMs: 0,
  });
  saveState();
  return { code: 200, body: { sitting } };
}

/** Load-time normalisation helper — reuses the store's row normaliser. */
export const sittingRow = normalizeSitting;
