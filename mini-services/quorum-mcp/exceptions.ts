/**
 * exceptions.ts — Phase 2: the formal exception register.
 *
 * Every departure from the standard procurement route — single-source,
 * emergency, direct award, non-compliance, post-award correction — is raised
 * here with its justification and evidence. The register row is created in
 * PENDING_GATE and a GATE is raised for the accounting officer's office in
 * the same breath: there is no path from "requested" to "approved" that does
 * not pass a named human, a step-up signature, a quorum and an Ed25519
 * receipt. The officer who requests never approves — the office gate sees to
 * that.
 *
 * Withdrawal is allowed only while nothing has been decided; once a gate is
 * pending, the committee decides it (a REJECT refuses the exception, and the
 * refusal is as much a record as the approval).
 */

import { appendLog, EXCEPTION_KIND_LABELS, EXCEPTION_KINDS, saveState, shaOf, state, type ExceptionKind, type ProcurementException } from "./store";
import { notifyWebSoon } from "./notify";

const ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function findException(id: string): ProcurementException | undefined {
  return state.exceptions.find((e) => e.id === id);
}

export function listExceptions(tenderId?: string): ProcurementException[] {
  const rows = [...state.exceptions].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  return tenderId ? rows.filter((e) => e.tenderId === tenderId) : rows;
}

export interface RaiseExceptionInput {
  tenderId?: unknown;
  kind?: unknown;
  title?: unknown;
  justification?: unknown;
  evidence?: unknown;
  valueImpact?: unknown;
}

export function raiseException(
  input: RaiseExceptionInput,
  actor: string,
): { ok: true; exception: ProcurementException; gateId: string } | { ok: false; error: string; code: number } {
  const kind = String(input.kind ?? "");
  if (!(EXCEPTION_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: `kind must be one of: ${EXCEPTION_KINDS.join(", ")}`, code: 422 };
  }
  const title = String(input.title ?? "").trim();
  if (title.length < 4 || title.length > 160) {
    return { ok: false, error: "title must be 4-160 characters", code: 422 };
  }
  const justification = String(input.justification ?? "").trim();
  if (justification.length < 30) {
    return { ok: false, error: "justification must be at least 30 characters — an exception without reasons is not an exception, it is a leak", code: 422 };
  }
  const evidence = Array.isArray(input.evidence)
    ? input.evidence.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim().slice(0, 200)).slice(0, 12)
    : [];
  if (evidence.length === 0) {
    return { ok: false, error: "evidence must list at least one reference (document key, file name or gate id)", code: 422 };
  }
  const tenderId = input.tenderId === undefined || input.tenderId === null || input.tenderId === "" ? undefined : String(input.tenderId).trim();
  if (tenderId && !ID_RE.test(tenderId)) {
    return { ok: false, error: "tenderId must be a plain reference", code: 422 };
  }
  let valueImpact: ProcurementException["valueImpact"];
  if (input.valueImpact !== undefined && input.valueImpact !== null) {
    const v = input.valueImpact as { amount?: unknown; currency?: unknown };
    const amount = Number(v.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: "valueImpact.amount must be a positive number", code: 422 };
    }
    valueImpact = { amount, ...(typeof v.currency === "string" && /^[A-Z]{3}$/.test(v.currency) ? { currency: v.currency } : {}) };
  }

  const now = new Date().toISOString();
  const exception: ProcurementException = {
    id: `exc_${Math.random().toString(36).slice(2, 8)}`,
    ...(tenderId ? { tenderId } : {}),
    kind: kind as ExceptionKind,
    title,
    justification: justification.slice(0, 4000),
    evidence,
    ...(valueImpact ? { valueImpact } : {}),
    requestedBy: actor,
    requestedAt: now,
    status: "PENDING_GATE",
  };

  /* The gate carries the exception id and the justifying inputs — the docHash
     of these inputs is what the step-up token binds to, so the justification
     cannot change between request and signature. */
  const gateInputs = {
    exceptionId: exception.id,
    kind: exception.kind,
    title: exception.title,
    justification: exception.justification,
    evidence: exception.evidence,
    ...(valueImpact ? { valueImpact } : {}),
  };

  state.exceptions.unshift(exception);
  saveState();

  const gate = {
    id: `gate_${Math.random().toString(36).slice(2, 8)}`,
    runId: "cycle",
    tenderId: exception.tenderId ?? exception.id,
    tool: "approve_exception",
    inputs: gateInputs,
    status: "PENDING" as const,
    createdAt: now,
    requiredOffice: "ACCOUNTING_OFFICER" as const,
  };
  exception.gateId = gate.id;
  state.gates.unshift(gate);
  saveState();

  appendLog({
    actor,
    server: "quorum-mcp",
    tool: "raise_exception",
    kind: "IRREVERSIBLE",
    runId: "cycle",
    inputs: { exceptionId: exception.id, kind: exception.kind, tenderId: exception.tenderId ?? null },
    outputs: {
      gate: gate.id,
      requiredOffice: "ACCOUNTING_OFFICER",
      note: "EXECUTION BLOCKED — the accounting officer must sign; the requester cannot approve their own exception.",
    },
    status: "PENDING_GATE",
    durationMs: 0,
  });
  notifyWebSoon({ type: "GATE_WAITING", gateId: gate.id, tenderId: gate.tenderId, tool: gate.tool, requiredOffice: gate.requiredOffice });
  return { ok: true, exception, gateId: gate.id };
}

export function withdrawException(id: string, actor: string, note?: string): { ok: true; exception: ProcurementException } | { ok: false; error: string; code: number } {
  const exception = findException(id);
  if (!exception) return { ok: false, error: "exception not found", code: 404 };
  if (exception.status !== "PENDING_GATE") {
    return { ok: false, error: `a ${exception.status.toLowerCase()} exception is part of the record — it cannot be withdrawn`, code: 409 };
  }
  exception.status = "WITHDRAWN";
  exception.withdrawnAt = new Date().toISOString();
  exception.decisionNote = note?.trim().slice(0, 300) || undefined;
  saveState();
  appendLog({
    actor,
    server: "quorum-mcp",
    tool: "withdraw_exception",
    kind: "WRITES",
    runId: "cycle",
    inputs: { exceptionId: exception.id },
    outputs: { status: "WITHDRAWN", gateStillPending: exception.gateId ?? null },
    status: "OK",
    durationMs: 0,
  });
  return { ok: true, exception };
}

/** Called from the gate executor when the accounting officer APPROVES the gate. */
export function executeExceptionApproval(gate: { inputs: unknown; decidedAt?: string; approver?: string }): Record<string, unknown> | undefined {
  const input = gate.inputs as { exceptionId?: string } | null;
  if (!input?.exceptionId) return undefined;
  const exception = findException(input.exceptionId);
  if (!exception) return undefined;
  exception.status = "APPROVED";
  exception.decidedBy = gate.approver ?? "named human";
  exception.decidedAt = gate.decidedAt;
  saveState();
  return { exceptionId: exception.id, status: "APPROVED", kind: exception.kind };
}

/** Called from the REJECT path: the accounting officer refused the exception. */
export function executeExceptionRejection(gate: { inputs: unknown; decidedAt?: string; approver?: string; note?: string }): Record<string, unknown> | undefined {
  const input = gate.inputs as { exceptionId?: string } | null;
  if (!input?.exceptionId) return undefined;
  const exception = findException(input.exceptionId);
  if (!exception) return undefined;
  exception.status = "REFUSED";
  exception.decidedBy = gate.approver ?? "named human";
  exception.decidedAt = gate.decidedAt;
  exception.decisionNote = gate.note;
  saveState();
  return { exceptionId: exception.id, status: "REFUSED", kind: exception.kind };
}

export function exceptionKindLabel(kind: ExceptionKind): string {
  return EXCEPTION_KIND_LABELS[kind];
}

export function exceptionSummarySha(exception: ProcurementException): string {
  return shaOf({ id: exception.id, status: exception.status, decidedAt: exception.decidedAt ?? null });
}
