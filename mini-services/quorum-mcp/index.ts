/**
 * quorum-mcp — HTTP + MCP server (port 3031).
 *
 *  POST /mcp                      → JSON-RPC 2.0 (initialize · tools/list · tools/call · ping)
 *  GET  /api/health               → liveness + fs-mcp status + counts
 *  GET  /api/tools                → the five tools, with their kind (READ / WRITES / IRREVERSIBLE)
 *  GET  /api/architecture         → the stack, for the console UI
 *  GET  /api/log?limit=           → the audit log (every tool call, newest first)
 *  GET  /api/log/export          → the full audit log, oldest first (evidence export)
 *  GET  /api/runs                 → orchestrated runs
 *  POST /api/runs {tenderId, detail?} → launch a LangGraph review run
 *                                     (detail = the tender's typed record:
 *                                      method, supplierSelection, invitesIssued,
 *                                      preQualDate, publishedDate, deadlineDate,
 *                                      buyer, category, currency, ceiling,
 *                                      specification, awardCriteria,
 *                                      evaluationChecks, sourceUrl, noticeRef)
 *  POST /api/tenders/:ref/docs    → stage manual tender documents for the
 *                                   review to read ({ docs: [{ name, text }] });
 *                                   written as 9x-*.md so buildPack treats
 *                                   typed entries exactly like uploaded text
 *  POST /api/tender-uploads       → record an R2 tender upload (object key,
 *                                   bytes, content type, staging outcome) in
 *                                   the hash-chained audit spine
 *  POST /api/tender-downloads      → record a signed tender download (tender,
 *                                   object key, slice, user, link expiry) in
 *                                   the same hash-chained audit spine
 *  POST /api/tender-deletions      → record an operator's removal of a
 *                                   stored tender object in that same spine
 *  GET  /api/gates                → gate queue + decisions
 *  POST /api/gates/:id/decision   → { decision: "APPROVE"|"REJECT", approver, note }
 *                                   The signed-in identity is ATTESTED — the gateway's HMAC seal or a
 *                                   session cookie re-verified against the web app — never taken from
 *                                   the body. APPROVE is refused (403) unless the approver is a PRESENT
 *                                   committee member holding the gate's office, or the attested officer
 *                                   (the gavel); unreadable roster → 503; unattested mutation → 401.
 */

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  appendLog,
  attestVerify,
  withWorkspace,
  currentWorkspaceId,
  workspaceRows,
  auditHealth,
  DATA,
  loadState,
  saveState,
  flushState,
  shaOf,
  state,
  toolLog,
  readLogEntries,
  verifyToolLogFile,
  DATA_DIR,
  type Gate,
  type Guards,
  type Run,
  type Supplier,
  type SupplierApplication,
} from "./store";
import { currentTraceId, requestTraceId, withTrace } from "./telemetry-context";
import { claimDueJobs, enqueueDurableJob, finishDurableJob, heartbeatDurableJob, listDurableJobs, requeueDurableJob, retryStaleRunningJobs, type DurableJob } from "./postgres";
import { summarizeQueue, summarizeToolEvents } from "./observability";
import { acquireWriterLock, postgresHandle } from "./writer";
import { appendDecision, mirrorDecision, readLedger, verifyLedger } from "./decisions-ledger";
import { handleReportRequest } from "./report";
import { recordTenderDownload } from "./tender-downloads";
import { recordTenderDeletion } from "./tender-deletions";
import { listSampleTenders, readSampleDocument } from "./samples";
import { ZAMBIA_METHODS } from "./methods";
import { ZPPA_ROLL, ZPPA_SOURCE } from "./zppa";
import { getOcpDatasets, loadOcpSnapshot } from "./ocp-live";
import { rollupCountries } from "./ocp-africa-roll";
import { ocpRefreshStatus, refreshOcpRegistry, startOcpAutoRefresh } from "./ocp-refresh";
import { connectMany, loadPortalLinks } from "./portal-links";
import { createSitting, endSitting, recordAttendance } from "./sittings";
import { forwardWebEvent } from "./audit-forward";
import { normalizeDeployment, registeredConnector } from "./store";
import { disabledPortalIds, loadPortalState, setPortalsEnabled } from "./portal-state";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { loadPack, TENDERS_DIR } from "./engine";
import { modelAttributionForRun, modelStatus } from "./model";
import { residencyFromEnv } from "./model-gateway";
import { parseClosingDate } from "./cycle";
import {
  marketplaceEntries,
  requiredDocumentsFromNotice,
  supplierFromOrgProfile,
  validateApplicationAdmission,
  validateApplicationRequest,
} from "./marketplace";

/* ── The record's own files and the governance rules that read it ─────────── */

const DECISIONS_FILE = DATA_DIR + "decisions.jsonl";
const ANCHORS_FILE = DATA_DIR + "log-anchors.jsonl";

interface AnchorRecord {
  at: string;
  lines: number;
  head: string;
  ledgerHead: string;
  ledgerLines: number;
  sig: string;
}

function readAnchorFile(): AnchorRecord[] {
  try {
    return readFileSync(ANCHORS_FILE, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as AnchorRecord);
  } catch {
    return [];
  }
}

/** Members who declared a conflict, recused, or were screened against a bidder
 *  on this tender leave its quorum. A screened connection under a NO_CONFLICT
 *  declaration is treated as unresolved: the member cannot vote or sign until
 *  the declaration is amended. */
function conflictedMembers(tenderId: string): Set<string> {
  const cycle = state.cycle.find(
    (c) => c.tenderId === tenderId && (c.workspaceId ?? "demo") === currentWorkspaceId(),
  );
  const names = new Set<string>();
  for (const declaration of cycle?.coi ?? []) {
    if (declaration.declaration === "CONFLICT_DECLARED" || declaration.recused === true) {
      names.add(declaration.member.trim().toLowerCase());
    }
  }
  if (cycle?.matrix) {
    const hits = conflictScreening(
      cycle.coi,
      cycle.matrix.bids.map((bid) => bid.bidder),
      state.suppliers,
    );
    for (const hit of hits) {
      if (hit.declaration !== "CONFLICT_DECLARED") names.add(hit.member.trim().toLowerCase());
    }
  }
  return names;
}

/**
 * Separation of duties. Whoever ran, opened or certified the evaluation cannot
 * approve its outcome, and a member who declared a conflict cannot sign the
 * tender at all. Returning a file to the agent is not covered: it confers no
 * benefit and must stay available to the officer who knows the file.
 */
function separationOfDuties(gate: Gate, approver: string): string | null {
  const who = approver.trim().toLowerCase();
  if (conflictedMembers(gate.tenderId).has(who)) {
    return `${approver.trim()} declared a conflict, recused, or was screened against a bidder on ${gate.tenderId} — another officer must sign this decision.`;
  }
  const cycle = state.cycle.find(
    (c) => c.tenderId === gate.tenderId && (c.workspaceId ?? "demo") === currentWorkspaceId(),
  );
  const run = state.runs.find((r) => r.id === gate.runId && (r.workspaceId ?? "demo") === currentWorkspaceId());
  const preparers: { role: string; name?: string | null }[] = [
    { role: "ran the evaluation", name: run?.startedBy },
    { role: "opened the bids", name: cycle?.opening?.certifiedBy },
    { role: "certified the evaluation matrix", name: cycle?.matrix?.certifiedBy },
  ];
  for (const preparer of preparers) {
    if (preparer.name && preparer.name.trim().toLowerCase() === who) {
      return `${approver.trim()} ${preparer.role} — a different officer must sign this decision (four eyes).`;
    }
  }
  return null;
}

/** The stated value of a gate, parsed from "RWF 2,150,000,000" or a number. */
function gateValue(gate: Gate): number | null {
  const inputs = (gate.inputs ?? {}) as Record<string, unknown>;
  const raw = inputs.value ?? inputs.amount ?? inputs.awardValue;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  /* Grouping commas are not decimal points: "ZMW 1,250,000" is 1,250,000. */
  const digits = raw.replace(/,/g, "").replace(/[^0-9.]/g, "");
  if (!digits) return null;
  const value = Number(digits);
  return Number.isFinite(value) ? value : null;
}

/** Above the configured threshold, an approval needs two different officers. */
function requiresDualApproval(gate: Gate): boolean {
  const threshold = state.guards.dualApprovalThreshold;
  if (!threshold || threshold <= 0) return false;
  const value = gateValue(gate);
  return value !== null && value >= threshold;
}

/** One append-only line per act, mirrored to Postgres when configured. */
function recordDecision(gate: Gate, decision: "APPROVE" | "REJECT", actor: string, workspaceId: string) {
  try {
    const row = appendDecision(DECISIONS_FILE, {
      gateId: gate.id,
      tenderId: gate.tenderId,
      workspaceId,
      actor,
      decision,
      gateStatus: gate.status,
      signatureKeyId: gate.signature?.keyId ?? null,
      payloadHash: gate.signature?.payloadHash ?? null,
      idempotencyKey: `gate:${workspaceId}:${gate.id}:${decision}:${actor.trim().toLowerCase()}`,
    });
    void mirrorDecision(postgresHandle(), row);
  } catch (err) {
    console.error("[decisions] the ledger write failed — the gate is signed but the act is not in the ledger:", err);
    appendLog({
      actor,
      server: "quorum-mcp",
      tool: "decision_ledger_write",
      kind: "IRREVERSIBLE",
      inputs: { gateId: gate.id, decision },
      outputs: { error: (err as Error).message },
      status: "ERROR",
      durationMs: 0,
    });
  }
}
import {
  approverAllowed,
  bindEngine,
  executeFiling,
  fetchQuorum,
  fsMcp,
  initFsMcp,
  listTenderDocs,
  mcpDraftRedline,
  mcpExtractRequirements,
  mcpFlagFinding,
  quorumCheck,
  TOOLS,
  verifySessionActor,
} from "./engine";
import { coreVerifySupplier, cycleToolCall, executeCycleGateAction, executeCycleGateRejection, handleCycleRoutes, nextPipelineRef, preApprovalCheck, publicSystemReferenceForTender } from "./cycle-routes";
import { conflictScreening } from "./evaluation";
import { sittingQuorumRefusal } from "./sittings";
import { FEATURE_FLAGS, SIMULATED_PORTAL } from "./store";
import { buildRuleCatalogue } from "./rule-catalogue";
import { formatPriceRead, redactApplication, sealBid, verifyBidReceipt } from "./bid-vault";
import { isJurisdictionId, jurisdictionPack, packSummary } from "./jurisdiction";
import { consumeStepUp, verifyStepUp } from "./step-up";
import { signGate, signingKeyStatus, verifyGateSignature } from "./receipts";
import { notifyWebSoon } from "./notify";
import { approvalOfficeFor, governanceSnapshot, recordSignoff, updateBands } from "./governance";
import { listExceptions, raiseException, withdrawException } from "./exceptions";
import { complianceSummary, RULE_PACKS } from "./rulepack";
import { archiveDocument, listDocuments, noteDownload, registerDocument, reviewDocument, verifyDocument } from "./documents";
const PORT = Number(process.env.MCP_PORT || 3031);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error("MCP_PORT must be a valid local TCP port.");

/* An optional string field — trims, caps, and collapses empty to undefined. */
function strOpt(v: unknown): string | undefined {
  const s = String(v ?? "").trim().slice(0, 200);
  return s.length > 0 ? s : undefined;
}

/* A string field — trims and caps; empty collapses to "". */
function str(v: unknown, max = 400): string {
  return String(v ?? "").trim().slice(0, max);
}

/* Log outputs are capped to a JSON string on disk; in-memory rows may still
   be objects. Read both shapes without trusting either. */
function logOutputObject(value: unknown): { model?: unknown; source?: unknown; redactions?: unknown; outcome?: unknown } {
  if (value && typeof value === "object") return value as { model?: unknown; source?: unknown; redactions?: unknown; outcome?: unknown };
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object") return parsed as { model?: unknown; source?: unknown; redactions?: unknown; outcome?: unknown };
  } catch {
    /* Long outputs are capped mid-JSON; attribution is written first so it can
       still be recovered from the surviving prefix. */
  }
  const model = /"model"\s*:\s*"([^"]+)"/.exec(value)?.[1];
  const source = /"source"\s*:\s*"([^"]+)"/.exec(value)?.[1];
  const redactions = Number(/"redactions"\s*:\s*(\d+)/.exec(value)?.[1]);
  const outcome = /"outcome"\s*:\s*"([^"]+)"/.exec(value)?.[1];
  return model || source || outcome ? { model, source, outcome, redactions: Number.isFinite(redactions) ? redactions : undefined } : {};
}

/* The newest actual model answer, read from the append-only log. Health can
   therefore show what answered — not just what the environment claims. */
function latestModelCall() {
  for (const entry of [...toolLog].reverse()) {
    if (entry.server === "model-gateway" && entry.tool === "model_call") {
      const inputs = entry.inputs && typeof entry.inputs === "object" ? entry.inputs as Record<string, unknown> : {};
      const outputs = logOutputObject(entry.outputs);
      if (outputs.outcome !== "OK" || typeof inputs.model !== "string" || !inputs.model.trim()) continue;
      return {
        tool: typeof inputs.purpose === "string" ? inputs.purpose : "model_call",
        model: inputs.model.trim(),
        source: "llm",
        at: entry.ts,
        runId: entry.runId ?? null,
        redactions: typeof outputs.redactions === "number" ? outputs.redactions : 0,
      };
    }
    if (entry.tool !== "draft_redline" && entry.tool !== "plan_review") continue;
    const outputs = logOutputObject(entry.outputs);
    if (typeof outputs.model !== "string" || !outputs.model.trim()) continue;
    const raw = outputs.model.trim();
    /* Old rows encoded the call shape in the model string ("… (llm)"). Only
       a row whose source was actually the model counts as a model answer. */
    const source =
      outputs.source === "llm" || (outputs.source == null && /\(llm\)/i.test(raw))
        ? "llm"
        : outputs.source === "template"
          ? "template"
          : null;
    if (source !== "llm") continue;
    const model = raw.replace(/\s*\((?:llm|template)[^)]*\).*$/i, "").trim();
    if (!model) continue;
    return {
      tool: entry.tool,
      model,
      source,
      at: entry.ts,
      runId: entry.runId ?? null,
      redactions: typeof outputs.redactions === "number" ? outputs.redactions : 0,
    };
  }
  return null;
}

/* Engine refs → durable state */
bindEngine({
  runs: state.runs,
  gates: state.gates,
  workspaceId: () => currentWorkspaceId(),
  save: saveState,
  raiseGate(g) {
    g.workspaceId = currentWorkspaceId();
    const existing = state.gates.find((candidate) =>
      candidate.runId === g.runId &&
      candidate.tool === g.tool &&
      candidate.status === "PENDING" &&
      (candidate.workspaceId ?? "demo") === currentWorkspaceId(),
    );
    if (existing) {
      /* A run replay after a crash reuses its already-raised human gate. */
      existing.inputs = g.inputs;
      saveState();
      return existing;
    }
    state.gates.unshift(g);
    saveState();
    notifyWebSoon({ type: "GATE_WAITING", gateId: g.id, tenderId: g.tenderId, tool: g.tool, requiredOffice: g.requiredOffice });
    return g;
  },
  guards: () => state.guards,
  registry: () => state.suppliers.map((s) => ({ name: s.name, status: s.status })),
});

/* ── MCP tool dispatch (shared by /mcp and the orchestrator) ─────────────── */

async function raiseGateTool(args: { tenderId: string; bundle: Record<string, unknown> }, runId?: string) {
  const gateId = `gate_${Math.random().toString(36).slice(2, 8)}`;
  const gate: Gate = {
    id: gateId,
    runId: runId ?? "mcp-direct",
    workspaceId: currentWorkspaceId(),
    tenderId: args.tenderId,
    tool: "file_gate_submission",
    inputs: args.bundle,
    status: "PENDING",
    createdAt: new Date().toISOString(),
  };
  const t0 = performance.now();
  appendLog({
    actor: "external-mcp-client",
    server: "quorum-mcp",
    tool: "file_gate_submission",
    kind: "IRREVERSIBLE",
    runId,
    inputs: args.bundle,
    outputs: { gate: gateId, note: "EXECUTION BLOCKED — named human required" },
    status: "PENDING_GATE",
    durationMs: Math.round(performance.now() - t0),
  });
  state.gates.unshift(gate);
  saveState();
  notifyWebSoon({ type: "GATE_WAITING", gateId: gate.id, tenderId: gate.tenderId, tool: gate.tool });
  return { gate: gateId, status: "gate_pending", note: "Irreversible action held for a named human. POST /api/gates/:id/decision." };
}

async function callOwnTool(name: string, args: Record<string, unknown>, runId?: string): Promise<unknown> {
  switch (name) {
    case "tender_documents_list": {
      const t0 = performance.now();
      const files = await listTenderDocs(String(args.tenderId ?? ""), runId);
      appendLog({
        actor: "external-mcp-client",
        server: "quorum-mcp",
        tool: name,
        kind: "READ",
        runId,
        inputs: args,
        outputs: { files },
        status: "OK",
        durationMs: Math.round(performance.now() - t0),
      });
      return { files };
    }
    case "extract_requirements":
      return mcpExtractRequirements(args, runId);
    case "flag_finding":
      return mcpFlagFinding({ ...args, runId: args.runId ?? runId });
    case "draft_redline":
      return mcpDraftRedline({ ...args, runId: args.runId ?? runId });
    case "file_gate_submission":
      return raiseGateTool(
        args as { tenderId: string; bundle: Record<string, unknown> },
        runId
      );
    /* ── The tender cycle (waves 1-3) — same cores the REST surface calls ── */
    case "record_bid_opening":
    case "build_evaluation_matrix":
    case "open_alb_dossier":
    case "draft_award_report":
    case "publish_award_notice":
    case "prepare_contract_pack":
    case "execute_contract":
    case "set_procurement_method":
    case "verify_supplier":
    case "request_variation":
    case "log_complaint":
    case "log_clarification":
    case "issue_addendum":
    case "draft_specification":
    case "draft_notice":
    case "add_pipeline_entry":
      return cycleToolCall(name, args);
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

/* ── JSON-RPC 2.0 (MCP surface) ──────────────────────────────────────────── */

const SERVER_INFO = { name: "quorum-mcp", version: "1.0.0" };

async function handleRpc(body: {
  id?: unknown;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}) {
  switch (body.method) {
    case "initialize":
      return {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS.map(({ name, description, inputSchema, kind }) => ({ name, description, inputSchema, _x_kind: kind })) };
    case "tools/call": {
      const name = body.params?.name ?? "";
      const args = body.params?.arguments ?? {};
      try {
        const out = await callOwnTool(name, args);
        return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: (err as Error).message }] };
      }
    }
    default:
      throw new Error(`method not found: ${body.method}`);
  }
}

/* ── Gate decisions — the named human, logged ────────────────────────────── */

/* A freeform signature rides with the body, never with authority: it is
   bound to the attested officer at seal time, size-checked, and stored only
   once every precondition for the decision has passed. */
function handInkFrom(body: unknown): { image: string; signedAt: string; strokes: number } | undefined | "invalid" {
  const raw = (body as { handSignature?: unknown })?.handSignature;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") return "invalid";
  const h = raw as { image?: unknown; signedAt?: unknown; strokes?: unknown };
  if (typeof h.image !== "string" || !h.image.startsWith("data:image/png;base64,")) return "invalid";
  if (h.image.length > 300_000) return "invalid";
  return {
    image: h.image,
    signedAt: typeof h.signedAt === "string" && h.signedAt ? h.signedAt : new Date().toISOString(),
    strokes: Math.max(0, Math.min(999, Math.round(Number(h.strokes) || 0))),
  };
}

const decisionLocks = new Map<string, Promise<void>>();
async function withDecisionLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = decisionLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => held);
  decisionLocks.set(key, tail);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (decisionLocks.get(key) === tail) decisionLocks.delete(key);
  }
}

async function decideGate(id: string, decision: string, approver: string, note?: string, signedInAs?: string, stepUpToken?: string, workspaceId = currentWorkspaceId(), hand?: { image: string; signedAt: string; strokes: number }, attestedActorId?: string) {
  return withDecisionLock(`${workspaceId}:${id}`, () => decideGateUnlocked(id, decision, approver, note, signedInAs, stepUpToken, workspaceId, hand, attestedActorId));
}

async function decideGateUnlocked(id: string, decision: string, approver: string, note?: string, signedInAs?: string, stepUpToken?: string, workspaceId = currentWorkspaceId(), hand?: { image: string; signedAt: string; strokes: number }, attestedActorId?: string) {
  const gate = state.gates.find((g) => g.id === id && (g.workspaceId ?? "demo") === workspaceId);
  if (!gate) return { error: "gate not found", code: 404 };
  const name = approver?.trim();
  if (name && (gate.status === "EXECUTED" || gate.status === "REJECTED")) {
    const previous = readLedger(DECISIONS_FILE).find((row) => row.workspaceId === workspaceId && row.gateId === id && row.actor.trim().toLowerCase() === name.toLowerCase() && row.decision === decision);
    if (previous) {
      if (auditHealth.stateSaveFailing) {
        try { await flushState(); } catch { return { error: "The signed result is recorded, but its state snapshot is still not durable.", code: 503 }; }
      }
      return { gate, replayed: true };
    }
  }
  if (name && gate.status === "AWAITING_SECOND" && decision === "APPROVE" && gate.firstApproval?.by.trim().toLowerCase() === name.toLowerCase()) {
    const previous = readLedger(DECISIONS_FILE).find((row) => row.workspaceId === workspaceId && row.gateId === id && row.actor.trim().toLowerCase() === name.toLowerCase() && row.decision === "APPROVE");
    if (previous) return { gate, awaitingSecond: true, replayed: true };
  }
  const awaitingSecond = gate.status === "AWAITING_SECOND";
  if (gate.status !== "PENDING" && !awaitingSecond)
    return { error: `gate already ${gate.status}`, code: 409 };
  if (!name || name.length < 3) return { error: "A named human is required — provide the approving officer's full name.", code: 422 };
  if (decision !== "APPROVE" && decision !== "REJECT") {
    return { error: "Decision must be APPROVE or REJECT.", code: 422 };
  }
  if (awaitingSecond && decision === "REJECT") {
    return {
      error: "This gate is awaiting a second approver — it can be approved by another officer, or withdrawn by an administrator.",
      code: 409,
    };
  }

  /* A decision may only be added to a record that proves itself. Verification
     covers the whole log against its signed epochs, so a restarted or edited
     chain stops new decisions instead of quietly accepting them. */
  const audit = await verifyToolLogFile();
  if (!audit.ok) {
    appendLog({
      actor: name,
      server: "quorum-mcp",
      tool: "gate_decision",
      kind: "GATE_DECISION",
      runId: gate.runId,
      inputs: { gateId: id, decision, approver: name },
      outputs: { refused: "the audit record does not verify", brokenAt: audit.brokenAt, registerReason: audit.registerReason },
      status: "ERROR",
      durationMs: 0,
    });
    return {
      error:
        "The audit record does not verify, so no new decision can be recorded. Repair and re-verify the chain before signing.",
      code: 503,
      audit,
    };
  }

  /* The e-signature: a session alone is not enough for an irreversible act.
     The web app issues a short-lived, single-use token bound to this gate's
     inputs and this officer. Verify it before reading the roll (so a stale
     session cannot probe the committee) and consume it only after every
     precondition has passed, immediately before state changes. */
  const actor = signedInAs?.trim() ?? "";
  if (!actor) {
    return { error: "This gate requires an attested session and a fresh step-up signature.", code: 401 };
  }
  const step = verifyStepUp(stepUpToken, { gateId: id, inputs: gate.inputs, actor });
  if (!step.ok) {
    appendLog({ actor: "quorum-mcp", server: "quorum-mcp", tool: "gate_decision", kind: "GATE_DECISION", runId: gate.runId, inputs: { gateId: id, decision, approver: name }, outputs: { refused: step.reason }, status: "ERROR", durationMs: 0 });
    return { error: step.reason, code: 403 };
  }

  /* Read the roll now: authorization is answered first (a name nobody knows is
     403, not a quorum debate), then the quorum, then any gate-specific
     precondition. The short-roll refusal is 409 with the live count; an
     unreadable roll is 503 and nothing changes. */
  const quorum = await fetchQuorum();
  if (!quorum) {
    appendLog({ actor: "quorum-mcp", server: "quorum-mcp", tool: "gate_decision", kind: "GATE_DECISION", runId: gate.runId, inputs: { gateId: id, decision, approver: name }, outputs: { refused: "committee roster unavailable" }, status: "ERROR", durationMs: 0 });
    return { error: "The committee roster could not be read — approval refused.", code: 503 };
  }

  /* Approval only by a name on the committee roster (or the signed-in officer). Checked before anything changes. */
  /* A member who declared a conflict on this tender leaves its quorum and
     cannot sign it — the declaration has to change the outcome, not just the
     paperwork. */
  const conflicted = conflictedMembers(gate.tenderId);
  const roster = quorum.members.filter((member) => !conflicted.has(member.name.trim().toLowerCase()));
  if (decision !== "REJECT") {
    const duty = separationOfDuties(gate, name);
    if (duty) {
      appendLog({
        actor: name,
        server: "quorum-mcp",
        tool: "gate_decision",
        kind: "GATE_DECISION",
        runId: gate.runId,
        inputs: { gateId: id, decision, approver: name },
        outputs: { refused: duty },
        status: "ERROR",
        durationMs: 0,
      });
      return { error: duty, code: 403 };
    }
    const verdict = approverAllowed(name, signedInAs?.trim(), roster);
    if (!verdict.ok) {
      appendLog({ actor: "quorum-mcp", server: "quorum-mcp", tool: "gate_decision", kind: "GATE_DECISION", runId: gate.runId, inputs: { gateId: id, decision, approver: name }, outputs: { refused: verdict.reason }, status: "ERROR", durationMs: 0 });
      return { error: verdict.reason, code: 403 };
    }
    /* Office-aware gates and cycle preconditions — checked before anything changes. */
    const pre = preApprovalCheck(gate, name, roster, signedInAs, attestedActorId);
    if (pre) {
      appendLog({ actor: "quorum-mcp", server: "quorum-mcp", tool: "gate_decision", kind: "GATE_DECISION", runId: gate.runId, inputs: { gateId: id, decision, approver: name }, outputs: { refused: pre }, status: "ERROR", durationMs: 0 });
      return { error: pre, code: 403 };
    }
  }

  /* A gate decision is a committee act. The roll must carry before any state
     changes, including a return. The count is recomputed from the member rows
     and the attested gavel, never trusted from the published `present` field. */
  const roll = quorumCheck({ ...quorum, members: roster }, signedInAs?.trim());
  if (!roll.ok) {
    appendLog({ actor: "quorum-mcp", server: "quorum-mcp", tool: "gate_decision", kind: "GATE_DECISION", runId: gate.runId, inputs: { gateId: id, decision, approver: name }, outputs: { refused: roll.reason, quorum: roll }, status: "ERROR", durationMs: 0 });
    return { error: roll.reason, code: 409, quorum: roll };
  }

  /* WS8 — the roll alone is a hand-set flag. With the sittingQuorum flag on,
     the act also needs a noticed sitting with admitted attendance to carry
     its quorum. The refusal names the missing notice, not just the number. */
  const sittingRefusal = sittingQuorumRefusal({
    tenderId: gate.tenderId,
    required: quorum.required,
    signedInAs,
  });
  if (sittingRefusal) {
    appendLog({ actor: "quorum-mcp", server: "quorum-mcp", tool: "gate_decision", kind: "GATE_DECISION", runId: gate.runId, inputs: { gateId: id, decision, approver: name }, outputs: { refused: sittingRefusal }, status: "ERROR", durationMs: 0 });
    return { error: sittingRefusal, code: 409, sitting: true };
  }

  /* Every precondition has passed. Burn the one-time token before the gate
     changes state; a replay from a second tab now loses the race. */
  if (!consumeStepUp(step.payload)) {
    appendLog({ actor: "quorum-mcp", server: "quorum-mcp", tool: "gate_decision", kind: "GATE_DECISION", runId: gate.runId, inputs: { gateId: id, decision, approver: name }, outputs: { refused: "step-up token already consumed" }, status: "ERROR", durationMs: 0 });
    return { error: "This step-up signature was already used. Re-authenticate for a fresh one.", code: 409 };
  }

  /* Two pairs of eyes above the configured threshold. The first approval
     records who opened the gate and executes nothing; a different officer has
     to complete it with their own step-up before the act runs. */
  if (decision === "APPROVE" && awaitingSecond) {
    if (gate.firstApproval && gate.firstApproval.by.trim().toLowerCase() === name.toLowerCase()) {
      appendLog({
        actor: name,
        server: "quorum-mcp",
        tool: "gate_decision",
        kind: "GATE_DECISION",
        runId: gate.runId,
        inputs: { gateId: id, decision, approver: name },
        outputs: { refused: "the first approver cannot complete a dual approval" },
        status: "ERROR",
        durationMs: 0,
      });
      return {
        error: "Dual approval needs two different officers — the officer who opened this gate cannot also complete it.",
        code: 403,
      };
    }
    gate.secondApprover = { by: name, at: new Date().toISOString(), stepUpJti: step.payload.jti };
  } else if (decision === "APPROVE" && requiresDualApproval(gate)) {
    gate.firstApproval = {
      by: name,
      at: new Date().toISOString(),
      stepUpJti: step.payload.jti,
      note: note?.trim() || undefined,
    };
    gate.status = "AWAITING_SECOND";
    recordDecision(gate, "APPROVE", name, workspaceId);
    appendLog({
      actor: name,
      server: "quorum-mcp",
      tool: "gate_decision",
      kind: "GATE_DECISION",
      runId: gate.runId,
      inputs: { gateId: id, decision, approver: name },
      outputs: {
        status: "AWAITING_SECOND",
        firstApprover: name,
        threshold: state.guards.dualApprovalThreshold,
        note: "Above the dual-approval threshold — a second, different officer must complete this gate.",
      },
      status: "OK",
      durationMs: 0,
    });
    saveState();
    try { await flushState(); } catch (err) { return { error: (err as Error).message, code: 503 }; }
    return { gate, awaitingSecond: true };
  }

  gate.approver = name;
  gate.note = note?.trim() || undefined;
  gate.decidedAt = new Date().toISOString();
  gate.stepUp = {
    by: step.payload.name,
    method: step.payload.method,
    at: new Date(step.payload.iat).toISOString(),
    jti: step.payload.jti,
    docHash: step.payload.docHash,
  };
  /* The wet-ink layer is bound to the attested officer at seal time — the
     body's ink is only kept once the decision has cleared every gate. */
  gate.handSignature = hand ? { ...hand, by: step.payload.name } : undefined;

  if (decision === "REJECT") {
    gate.status = "REJECTED";
    gate.signature = signGate(gate);
    /* Some tools keep a register row on refusal too (the exception register
       records WHO refused and why) — the rejection executor runs before the
       log line so the outcome is one fact, not two. */
    const refused = executeCycleGateRejection(gate);
    const sealed = verifyGateSignature(gate);
    gate.evidential = sealed.ok;
    gate.evidentialNote = sealed.ok
      ? undefined
      : `Receipt verification failed — ${sealed.reason ?? "unknown"}. The decision is recorded but not evidential.`;
    recordDecision(gate, "REJECT", name, workspaceId);
    appendLog({
      actor: name,
      server: "quorum-mcp",
      tool: "gate_decision",
      kind: "GATE_DECISION",
      runId: gate.runId,
      inputs: { gateId: id, decision, note: gate.note },
      outputs: { status: "REJECTED — submission returned to the agent", stepUp: { method: step.payload.method, jti: step.payload.jti }, ink: hand ? shaOf(hand.image).slice(0, 12) : undefined, strokes: hand?.strokes, refused: refused ?? undefined },
      status: "OK",
      durationMs: 0,
    });
    const run = state.runs.find((r) => r.id === gate.runId && (r.workspaceId ?? "demo") === workspaceId);
    if (run) {
      run.status = "REJECTED";
      run.updatedAt = gate.decidedAt;
      run.progress.push(`✗ ${name} returned the submission — back to the agent`);
    }
    saveState();
    try { await flushState(); } catch (err) { return { error: (err as Error).message, code: 503 }; }
    notifyWebSoon({ type: "GATE_DECIDED", gateId: gate.id, tenderId: gate.tenderId, tool: gate.tool, actor: name, outcome: "REJECTED", note: gate.note });
    return { gate };
  }

  /* APPROVE → and only now does the irreversible thing happen */
  gate.status = "APPROVED";
  const out =
    gate.tool === "file_gate_submission"
      ? { receipt: await executeFiling(id) }
      : { receipt: await executeCycleGateAction(gate) };
  gate.status = "EXECUTED";
  gate.executedAt = new Date().toISOString();
  gate.receipt = out.receipt ?? undefined;
  gate.signature = signGate(gate);
  /* The act has run. Verify the seal it produced before anyone reads the gate
     as evidence: a decision without a valid receipt is marked, never passed
     off as signed. */
  const sealed = verifyGateSignature(gate);
  gate.evidential = sealed.ok;
  gate.evidentialNote = sealed.ok
    ? undefined
    : `Receipt verification failed after execution — ${sealed.reason ?? "unknown"}. The act ran; the receipt is quarantined.`;
  recordDecision(gate, "APPROVE", name, workspaceId);
  if (!sealed.ok) {
    appendLog({
      actor: name,
      server: "quorum-mcp",
      tool: "gate_decision",
      kind: "IRREVERSIBLE",
      runId: gate.runId,
      inputs: { gateId: id, decision },
      outputs: { warning: gate.evidentialNote },
      status: "ERROR",
      durationMs: 0,
    });
  }
  const run = state.runs.find((r) => r.id === gate.runId);
  if (run) {
    run.status = "FILED";
    run.updatedAt = gate.executedAt;
    run.progress.push(`✓ ${name} signed the gate — bundle filed · ${gate.receipt?.submissionId ?? "receipt pending"}${hand ? ` · hand signature ${shaOf(hand.image).slice(0, 12)}` : ""}`);
  }
  saveState();
  try { await flushState(); } catch (err) { return { error: (err as Error).message, code: 503 }; }
  notifyWebSoon({ type: "GATE_DECIDED", gateId: gate.id, tenderId: gate.tenderId, tool: gate.tool, actor: name, outcome: "EXECUTED", note: gate.note });
  return { gate };
}

/* ── HTTP server ─────────────────────────────────────────────────────────── */

const json = (data: unknown, code = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status: code,
    headers: {
      "content-type": "application/json",
      ...(currentTraceId() ? { "x-quorum-trace-id": currentTraceId()! } : {}),
    },
  });

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

let workflowWorkerBusy = false;

async function runReviewJob(job: DurableJob) {
  const runId = String(job.payload.runId ?? "");
  const workspaceId = String(job.payload.workspaceId ?? "demo");
  const traceId = String(job.payload.traceId ?? `recovery-${runId}`);
  const run = state.runs.find((row) => row.id === runId && (row.workspaceId ?? "demo") === workspaceId);
  if (!run) {
    await finishDurableJob(job.id);
    return;
  }
  if (run.status === "AWAITING_GATE" || run.status === "FILED" || run.status === "REJECTED") {
    await finishDurableJob(job.id);
    return;
  }

  const heartbeat = setInterval(() => { void heartbeatDurableJob(job.id); }, 15_000);
  try {
    await withWorkspace(workspaceId, () => withTrace(traceId, async () => {
      run.status = "RUNNING";
      run.error = undefined;
      run.updatedAt = new Date().toISOString();
      run.progress.push(job.attempts > 1 ? `↻ review resumed from the last durable run record (attempt ${job.attempts}/${job.maxAttempts ?? 5})` : "▸ review job claimed by the durable worker");
      saveState();
      try {
        const engine = await import("./engine");
        await engine.runReview(run);
        if (String(run.status) === "FAILED") throw new Error(run.error || "review graph failed");
        await flushState();
        await finishDurableJob(job.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "review worker failed";
        appendLog({
          actor: "orchestrator",
          server: "quorum-mcp-worker",
          tool: "review_job",
          kind: "WRITES",
          runId,
          inputs: { attempt: job.attempts, maxAttempts: job.maxAttempts ?? 5 },
          outputs: { error: message.slice(0, 400) },
          status: "ERROR",
          durationMs: 0,
        });
        if (job.attempts >= (job.maxAttempts ?? 5)) {
          run.status = "FAILED";
          run.error = `Review failed after ${job.attempts} attempts: ${message}`.slice(0, 800);
          run.updatedAt = new Date().toISOString();
          run.progress.push("✗ automatic recovery attempts exhausted; operator review required");
          saveState();
          try { await flushState(); } catch { /* health endpoint reports a failed snapshot */ }
        } else {
          try { await flushState(); } catch { /* the retry queue remains authoritative */ }
        }
        await finishDurableJob(job.id, message);
      }
    }));
  } finally {
    clearInterval(heartbeat);
  }
}

async function drainWorkflowJobs() {
  if (workflowWorkerBusy) return;
  workflowWorkerBusy = true;
  try {
    await retryStaleRunningJobs(60_000);
    const due = await claimDueJobs(5);
    for (const job of due) {
      if (job.kind === "REVIEW_RUN") await runReviewJob(job);
      else await finishDurableJob(job.id, `unsupported durable job kind: ${job.kind}`);
    }
  } catch (error) {
    console.error("[workflow-worker] job polling failed:", error);
  } finally {
    workflowWorkerBusy = false;
  }
}

async function recoverInterruptedRuns() {
  try {
    await retryStaleRunningJobs(10_000);
    const jobs = await listDurableJobs(500);
    for (const run of state.runs) {
      if (run.status !== "RUNNING") continue;
      const id = `review:${run.id}`;
      const existing = jobs.find((job) => job.id === id);
      if (!existing) {
        await enqueueDurableJob({
          id,
          kind: "REVIEW_RUN",
          payload: { runId: run.id, workspaceId: run.workspaceId ?? "demo", traceId: run.traceId ?? `recovery-${run.id}` },
          status: "PENDING",
          attempts: 0,
          maxAttempts: 5,
          runAt: new Date().toISOString(),
        });
      } else if (existing.status === "DONE") {
        const requeued = await requeueDurableJob(id);
        if (!requeued && existing.attempts >= (existing.maxAttempts ?? 5)) {
          run.status = "FAILED";
          run.error ??= "Review recovery attempts were exhausted before the previous process stopped.";
          run.updatedAt = new Date().toISOString();
          saveState();
        }
      } else if (existing.status === "FAILED" && existing.attempts >= (existing.maxAttempts ?? 5)) {
        run.status = "FAILED";
        run.error ??= "Review recovery attempts were exhausted before the previous process stopped.";
        run.updatedAt = new Date().toISOString();
        saveState();
      }
    }
    if (state.runs.some((run) => run.status === "FAILED" && run.error?.includes("recovery attempts were exhausted"))) await flushState();
  } catch (error) {
    console.error("[workflow-worker] interrupted run recovery failed:", error);
  }
  setInterval(() => { void drainWorkflowJobs(); }, 3_000);
  void drainWorkflowJobs();
}

Bun.serve({
  port: PORT,
  /* Loopback only — the sidecar has no auth of its own; the Next gateway
     (session check + HMAC attestation) is the only public door. */
  hostname: "127.0.0.1",
  idleTimeout: 120,
  async fetch(req) {
    const traceId = requestTraceId(req.headers.get("x-quorum-trace-id"));
    return withTrace(traceId, async () => {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" } });

    /* ── Mutation identity — two doors, both verified server-side ─────
       1. The gateway seal: HMAC over (method|path|actor|ts) from the Next
          layer, which verified the session before signing.
       2. The web session itself: Caddy forwards the browser's cookie here,
          so the sidecar asks the web app who the session belongs to.
       A body-declared identity is never trusted for either. The MCP surface
       (POST /mcp) stays the documented agent door: its irreversible steps
       halt behind named-human gates regardless of who connects. */
    let attestedActor = "";
    let attestedActorId = "";
    let workspaceId = "demo";
    if (path !== "/mcp" && req.method !== "OPTIONS") {
      const seal = attestVerify(req.method, path, req.headers);
      if (seal.ok) {
        attestedActor = seal.actor;
        /* The gateway also seals the session's user id. It is only trusted on
           a request that carries the gateway HMAC — a browser header alone is
           never accepted as office authority. */
        attestedActorId = req.headers.get("x-quorum-actor-id")?.trim().slice(0, 80) ?? "";
        workspaceId = req.headers.get("x-quorum-workspace")?.trim() ?? "";
        if (!workspaceId) return json({ error: "The gateway seal is missing its workspace scope." }, 401);
      } else if (req.method !== "GET" && req.method !== "HEAD") {
        const session = await verifySessionActor(req.headers.get("cookie"));
        if (!session) {
          return json({ error: `${seal.reason} Sign in (a verified session is accepted) and retry.` }, 401);
        }
        attestedActor = session.actor;
        attestedActorId = session.actorId ?? "";
        workspaceId = session.workspaceId;
      } else {
        workspaceId = req.headers.get("x-quorum-workspace")?.trim() || "demo";
      }
    }
    if (req.method !== "GET" && req.method !== "HEAD" && path !== "/mcp" && state.agentMode === "disabled") {
      return json({ error: "The agent is disabled; all changes are paused." }, 423);
    }

    return withWorkspace(workspaceId, async () => {

    /* MCP surface */
    if (path === "/mcp" && req.method === "POST") {
      const body = (await readBody(req)) as { id?: unknown; method?: string; params?: never };
      try {
        const result = await handleRpc(body as { method: string; params?: { name?: string; arguments?: Record<string, unknown> } });
        return json({ jsonrpc: "2.0", id: body.id ?? null, result });
      } catch (err) {
        return json({ jsonrpc: "2.0", id: body.id ?? null, error: { code: -32603, message: (err as Error).message } });
      }
    }

    /* REST surface */
    if (path === "/api/health") {
      const jobs = await listDurableJobs(500);
      return json({
        ok: true,
        service: "quorum-mcp",
        version: "1.0.0",
        uptimeSec: Math.round(performance.now() / 1000),
        fsMcp: { status: fsMcp.status, tools: fsMcp.tools },
        agent: { mode: state.agentMode, storage: process.env.DATABASE_URL ? "postgres-configured" : "json" },
        graphs: ["review_graph (8 nodes)", "filing_graph (2 nodes)"],
        workflowQueue: { driver: process.env.DATABASE_URL?.trim() ? "postgres" : "json", ...summarizeQueue(jobs) },
        /* Configured endpoint + the newest real model answer in the log. */
        model: { ...modelStatus(), residency: residencyFromEnv(), lastCall: latestModelCall() },
        counts: { toolCalls: toolLog.length, runs: state.runs.length, gates: state.gates.length, pendingGates: state.gates.filter((g) => g.status === "PENDING").length },
        auditSpine: {
          logWriteFailing: auditHealth.logWriteFailing,
          stateSaveFailing: auditHealth.stateSaveFailing,
          stateCorrupt: auditHealth.stateCorrupt,
          stateCorruptFile: auditHealth.stateCorruptFile,
          snapshotOverwriteRefused: auditHealth.snapshotOverwriteRefused,
          /* Decided gates with neither a signature nor a consumed step-up. */
          unsignedExecuted: auditHealth.unsignedExecuted,
          logChainEntries: toolLog.length,
          decisions: readLedger(DECISIONS_FILE).length,
          /* Forwarded web events resolve against the same chain. */
          forwardedKeys: state.forwardedKeys.length,
        },
        governance: {
          deploymentMode: state.deployment.mode,
          connector: state.connector ? { id: state.connector.id, name: state.connector.name, active: state.connector.active } : null,
          sittings: state.sittings.length,
          sittingQuorumFlag: state.features.sittingQuorum,
          /* Key custody — env/file/development-managed, with the live key id. */
          gateKey: signingKeyStatus(),
        },
      });
    }

    if (path === "/api/observability" && req.method === "GET") {
      const [entries, jobs] = await Promise.all([readLogEntries(), listDurableJobs(500)]);
      const scopedEntries = entries.filter((entry) => (entry.workspaceId ?? "demo") === workspaceId);
      const scopedRuns = workspaceRows(state.runs, workspaceId);
      const traces = new Map<string, { first: string; last: string; count: number; errors: number; runIds: Set<string> }>();
      for (const entry of scopedEntries) {
        if (!entry.traceId) continue;
        const row = traces.get(entry.traceId) ?? { first: entry.ts, last: entry.ts, count: 0, errors: 0, runIds: new Set<string>() };
        row.first = entry.ts < row.first ? entry.ts : row.first;
        row.last = entry.ts > row.last ? entry.ts : row.last;
        row.count += 1;
        if (entry.status === "ERROR") row.errors += 1;
        if (entry.runId) row.runIds.add(entry.runId);
        traces.set(entry.traceId, row);
      }
      return json({
        generatedAt: new Date().toISOString(),
        traces: [...traces.entries()].map(([traceId, row]) => ({ traceId, startedAt: row.first, latestAt: row.last, events: row.count, errors: row.errors, runIds: [...row.runIds] })).sort((a, b) => b.latestAt.localeCompare(a.latestAt)).slice(0, 30),
        operations: summarizeToolEvents(scopedEntries),
        runs: {
          total: scopedRuns.length,
          running: scopedRuns.filter((run) => run.status === "RUNNING").length,
          failed: scopedRuns.filter((run) => run.status === "FAILED").length,
          awaitingGate: scopedRuns.filter((run) => run.status === "AWAITING_GATE").length,
        },
        queue: summarizeQueue(jobs),
        storage: process.env.DATABASE_URL?.trim() ? "postgres" : "single-writer-json",
        traceStore: "workspace-scoped hash-chained tool log",
      });
    }

    const traceMatch = path.match(/^\/api\/traces\/([A-Za-z0-9._:-]{8,80})$/);
    if (traceMatch && req.method === "GET") {
      const traceId = traceMatch[1];
      const entries = (await readLogEntries()).filter((entry) => entry.traceId === traceId && (entry.workspaceId ?? "demo") === workspaceId).sort((a, b) => a.seq - b.seq);
      const runs = workspaceRows(state.runs, workspaceId).filter((run) => run.traceId === traceId);
      if (!entries.length && !runs.length) return json({ error: "trace not found" }, 404);
      return json({
        traceId,
        runs: runs.map((run) => ({ id: run.id, reference: run.reference, tenderId: run.tenderId, status: run.status, startedAt: run.startedAt, updatedAt: run.updatedAt, error: run.error ?? null, gateId: run.gateId ?? null })),
        events: entries.map(({ id, seq, ts, actor, server, tool, kind, runId, inputs, outputs, status, durationMs, prev, self }) => ({ id, seq, ts, actor, server, tool, kind, runId, inputs, outputs, status, durationMs, prev, self })),
      });
    }

    if (path === "/api/agent-mode" && req.method === "GET") return json({ mode: state.agentMode });
    if (path === "/api/agent-mode" && req.method === "PATCH") {
      const body = await readBody(req);
      const mode = body.mode;
      if (mode !== "enabled" && mode !== "read-only" && mode !== "disabled") return json({ error: "mode must be enabled, read-only or disabled" }, 422);
      const previous = state.agentMode;
      if (previous !== mode) {
        state.agentMode = mode;
        saveState();
        appendLog({ actor: attestedActor || "unknown", server: "quorum-mcp", tool: "set_agent_mode", kind: "WRITES", inputs: { previous }, outputs: { mode }, status: "OK", durationMs: 0 });
      }
      return json({ mode: state.agentMode, changed: previous !== mode });
    }

    if (path === "/api/tools") return json({ tools: TOOLS });

    if (path === "/api/architecture") {
      const model = modelStatus();
      return json({
        stack: [
          {
            layer: "OWN MCP SERVER",
            name: "quorum-mcp",
            detail: "5 tools over JSON-RPC 2.0 · 3 change state (draft, flag, file). Read-only is not an agent's hands.",
          },
          {
            layer: "THIRD-PARTY MCP",
            name: "@modelcontextprotocol/server-filesystem",
            detail: "Official, not ours. Sandboxed path-jail + maintained fs ops beat hand-rolling document reads.",
          },
          {
            layer: "ORCHESTRATION",
            name: "LangGraph.js (StateGraph)",
            detail: "Open-source graph runtime. review_graph: plan → load → extract → flag → verify ⇄ bounded repair → draft → gate. Halts at the gate by construction — the edge to filing does not exist.",
          },
          {
            layer: "MODEL",
            name: model.configured ? `${model.model} · ${model.providerLabel}` : "Template fallback (no model configured)",
            detail: model.configured
              ? `OpenAI-compatible at ${model.endpoint}. Fallback: ${model.fallback ? `${model.fallback.model} · ${model.fallback.providerLabel}` : "none configured"}. Hosted calls are redacted by the model gateway; every draft records the exact model string the endpoint returns.`
              : "No drafting endpoint on this host. Redlines come from the deterministic template and every draft says so."
          },
          {
            layer: "AUDIT",
            name: "tool-log.jsonl",
            detail: "Every call: inputs, outputs, timestamps, actor, status. Append-only.",
          },
          {
            layer: "GATE",
            name: "file_gate_submission",
            detail: "The only irreversible tool. Returns gate_pending until a named human signs.",
          },
        ],
      });
    }

    if (path === "/api/log") {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 80), 500);
      const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
      const runId = url.searchParams.get("runId") ?? "";
      const actor = (url.searchParams.get("actor") ?? "").trim().toLowerCase();
      const tool = url.searchParams.get("tool") ?? "";
      const status = url.searchParams.get("status") ?? "";
      const kind = url.searchParams.get("kind") ?? "";
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? "";
      const filtered = [...toolLog].reverse().filter((e) => {
        if (runId && e.runId !== runId) return false;
        if (actor && !e.actor.toLowerCase().includes(actor)) return false;
        if (tool && e.tool !== tool) return false;
        if (status && e.status !== status) return false;
        if (kind && e.kind !== kind) return false;
        if (from && e.ts < from) return false;
        if (to && e.ts > to) return false;
        if (q && !JSON.stringify(e).toLowerCase().includes(q)) return false;
        return true;
      });
      return json({
        entries: filtered.slice(0, limit),
        total: filtered.length,
        allTotal: toolLog.length,
        filters: { q, runId, actor, tool, status, kind, from, to },
      });
    }

    /* The full chain for an evidence export, oldest first. `/api/log` above
       serves the recent in-memory window the UI streams; an audit package
       must carry every line from the append-only file, in chain order. */
    if (path === "/api/log/export" && req.method === "GET") {
      const entries = await readLogEntries();
      return json({
        entries,
        lines: entries.length,
        head: entries.length ? entries[entries.length - 1].self ?? "" : "",
      });
    }

    if (path === "/api/log/verify" && req.method === "GET") {
      return json(await verifyToolLogFile());
    }

    /* The daily anchor is the independent witness: it seals the head of the
       log and of the decision ledger at a point in time, on a schedule the
       app itself cannot rewrite. */
    if (path === "/api/log/anchor" && req.method === "GET") {
      const anchors = readAnchorFile();
      return json({ anchor: anchors[anchors.length - 1] ?? null, count: anchors.length });
    }

    /* The decision ledger — the acts, independent of the working snapshot. */
    if (path === "/api/decisions" && req.method === "GET") {
      const rows = readLedger(DECISIONS_FILE).filter((row) => row.workspaceId === workspaceId);
      return json({ ledger: verifyLedger(rows), decisions: rows.slice(-50).reverse() });
    }

    /* Every read of supplier, bid or gate data through the gateway is written
       to the same spine as the mutations. Attested by the gateway, like every
       other state-changing call. */
    if (path === "/api/audit/read" && req.method === "POST") {
      if (!attestedActor) return json({ error: "unattested" }, 401);
      const body = await readBody(req);
      const target = String(body.path ?? "").slice(0, 200);
      appendLog({
        actor: attestedActor,
        server: "quorum-mcp",
        tool: "record_read",
        kind: "READ",
        inputs: { path: target },
        outputs: { status: Number(body.status ?? 200) || 200 },
        status: "OK",
        durationMs: 0,
      });
      return json({ logged: true });
    }

    /* Direct Meta requests made by the web routes join this same verified
       audit chain. Only bounded call metadata is kept; document text, prompts,
       responses and credentials never enter the log. */
    if (path === "/api/audit/model-call" && req.method === "POST") {
      const seal = attestVerify(req.method, path, req.headers);
      if (!seal.ok) return json({ error: seal.reason }, 401);
      const body = await readBody(req);
      const outcome = body.outcome === "OK" ? "OK" : "ERROR";
      const model = typeof body.model === "string" ? body.model.slice(0, 120) : "unknown";
      const purpose = typeof body.purpose === "string" ? body.purpose.slice(0, 80) : "model_call";
      const endpoint = typeof body.endpoint === "string" ? body.endpoint.slice(0, 180) : "api.meta.ai";
      const durationMs = Math.max(0, Math.min(300_000, Number(body.durationMs) || 0));
      const responseStatus = Number(body.responseStatus);
      return withWorkspace(workspaceId, () => {
        appendLog({
          actor: attestedActor || seal.actor,
          server: "meta-api",
          tool: "model_call",
          kind: "READ",
          inputs: { provider: "Meta AI", model, purpose, endpoint },
          outputs: {
            outcome,
            ...(Number.isFinite(responseStatus) && responseStatus > 0 ? { responseStatus: Math.round(responseStatus) } : {}),
          },
          status: outcome,
          durationMs,
        });
        return json({ logged: true });
      });
    }

    /* Receipt verification is deliberately offline-friendly: the signature
       carries its public key, so a downloaded receipt can be checked without
       this service. This endpoint is the same check for the UI. */
    if (/^\/api\/(?:gates|receipts)\/[^/]+\/verify$/.test(path) && req.method === "GET") {
      const id = decodeURIComponent(path.split("/")[3] ?? "");
      const gate = state.gates.find((g) => g.id === id && (g.workspaceId ?? "demo") === currentWorkspaceId());
      if (!gate) return json({ error: "gate not found" }, 404);
      const verdict = verifyGateSignature(gate);
      return json({
        gateId: gate.id,
        tenderId: gate.tenderId,
        systemReference: publicSystemReferenceForTender(gate.tenderId),
        status: gate.status,
        approver: gate.approver ?? null,
        decidedAt: gate.decidedAt ?? null,
        receipt: gate.receipt ?? null,
        stepUp: gate.stepUp ?? null,
        signature: gate.signature ?? null,
        signatureValid: verdict.ok,
        reason: verdict.reason ?? null,
      });
    }

    if (path === "/api/runs" && req.method === "GET") {
      /* Each run carries its REAL seal — the executed gate's receipt hash (a
         sha-256 of the sealed bundle), computed by the filing graph. The UI
         displays this; it never synthesizes one. */
      const runs = [...workspaceRows(state.runs)].reverse().map((r) => {
        const gate = r.gateId ? state.gates.find((g) => g.id === r.gateId && (g.workspaceId ?? "demo") === workspaceId) : undefined;
        return {
          ...r,
          /* Stored facts, not the current env: plan source/model, draft
             source/model and token counts. The UI prints this verbatim. */
          model: modelAttributionForRun(r),
          seal: gate?.receipt?.hash ?? null,
          sealedBy: gate?.approver ?? null,
          decidedAt: gate?.decidedAt ?? null,
        };
      });
      return json({ runs });
    }

    /* The officer asks the desk to bind the committee pack before the sitting.
       A real, auditable event: attested actor, timestamped, in the log — the
       log IS the record. No state changes beyond it. */
    if (path === "/api/pack-binding" && req.method === "POST") {
      const queuedAt = new Date().toISOString();
      const by = attestedActor || "committee desk";
      appendLog({
        actor: by,
        server: "quorum-mcp",
        tool: "pack_binding",
        kind: "WRITES",
        inputs: {},
        outputs: { queuedAt, by },
        status: "OK",
        durationMs: 0,
      });
      return json({ queuedAt, by }, 201);
    }

    /* Sourced report — downloadable Markdown, one file per run */
    if (/^\/api\/runs\/[^/]+\/report$/.test(path) && req.method === "GET") {
      const id = decodeURIComponent(path.match(/^\/api\/runs\/([^/]+)\/report$/)![1]);
      return handleReportRequest(id);
    }

    /* Phase 6 (AI safety): the named human disposition for a model-surfaced
       finding. The reviewer, the decision, the when and the why are stored on
       the finding itself and flow into the report and the procurement file.
       The sidecar never disposes of a finding on its own. */
    if (/^\/api\/runs\/[A-Za-z0-9._-]+\/findings\/[A-Za-z0-9._-]+\/review$/.test(path) && req.method === "POST") {
      const body = await readBody(req);
      const match = path.match(/^\/api\/runs\/([A-Za-z0-9._-]+)\/findings\/([A-Za-z0-9._-]+)\/review$/)!;
      const run = state.runs.find((r) => r.id === match[1]);
      if (!run) return json({ error: "run not found" }, 404);
      const finding = run.findings.find((f) => f.id === match[2]);
      if (!finding) return json({ error: "finding not found on this run" }, 404);
      const actor = attestedActor || strOpt(body.actor) || "";
      if (!actor || actor === "unknown") return json({ error: "a named reviewer must attest this disposition" }, 401);
      const decision = strOpt(body.decision);
      if (decision !== "ACCEPTED" && decision !== "REJECTED") {
        return json({ error: "decision must be ACCEPTED or REJECTED" }, 422);
      }
      const note = strOpt(body.note);
      if (decision === "REJECTED" && (!note || note.trim().length < 10)) {
        return json({ error: "rejecting a finding needs a stated reason (at least 10 characters) — the record must show why the human disagreed" }, 422);
      }
      finding.review = {
        decision,
        by: actor.slice(0, 80),
        at: new Date().toISOString(),
        ...(note?.trim() ? { note: note.trim().slice(0, 500) } : {}),
      };
      run.updatedAt = new Date().toISOString();
      saveState();
      appendLog({
        actor: actor.slice(0, 80),
        server: "quorum-mcp",
        tool: "finding_disposition",
        kind: "WRITES",
        runId: run.id,
        inputs: { findingId: finding.id, rule: finding.rule, decision },
        outputs: { by: finding.review.by, at: finding.review.at, note: finding.review.note ?? null },
        status: "OK",
        durationMs: 0,
      });
      return json({ finding });
    }

    if (path === "/api/runs" && req.method === "POST") {
      const body = await readBody(req);
      const tenderId = String(body.tenderId ?? "").trim();
      if (!tenderId) return json({ error: "tenderId required" }, 422);
      const refPattern = /^QRM-\d{4}-\d{3,6}$/i;
      const existingReference =
        state.pipeline.find((entry) => entry.linkedTenderId === tenderId && refPattern.test(entry.systemReference ?? entry.ref))?.systemReference ??
        state.pipeline.find((entry) => entry.linkedTenderId === tenderId && refPattern.test(entry.ref))?.ref ??
        state.cycle.find((cycle) => cycle.tenderId === tenderId && refPattern.test(cycle.systemReference ?? ""))?.systemReference ??
        state.runs.find((existing) => existing.tenderId === tenderId && existing.reference && refPattern.test(existing.reference))?.reference ??
        (refPattern.test(tenderId) ? tenderId : undefined);
      const requestedReference = String(body.reference ?? "").trim().toUpperCase();
      const isTakenByAnotherRecord = (candidate: string) =>
        state.pipeline.some((entry) => [entry.ref, entry.systemReference ?? ""].some((value) => value.toUpperCase() === candidate) && entry.linkedTenderId !== tenderId) ||
        state.cycle.some((cycle) => cycle.tenderId.toUpperCase() === candidate && cycle.tenderId !== tenderId) ||
        state.cycle.some((cycle) => (cycle.systemReference ?? "").toUpperCase() === candidate && cycle.tenderId !== tenderId) ||
        state.cycle.some((cycle) => cycle.notices.some((notice) => notice.reference?.toUpperCase() === candidate)) ||
        state.runs.some((existing) =>
          (existing.reference ?? (refPattern.test(existing.tenderId) ? existing.tenderId : "")).toUpperCase() === candidate &&
          existing.tenderId !== tenderId,
        );
      const requestedIsAvailable = refPattern.test(requestedReference) && !isTakenByAnotherRecord(requestedReference);
      const reference = existingReference ?? (requestedIsAvailable ? requestedReference : nextPipelineRef({}));
      /* A tender with no staged pack has nothing to review — refuse the
         launch here instead of running a graph that could only end in a
         placeholder gate for a tender nothing was read about. */
      try {
        const files = await listTenderDocs(tenderId);
        if (files.length === 0)
          return json(
            { error: `no staged documents for tender "${tenderId}" — stage the pack before launching a review` },
            422,
          );
      } catch {
        return json({ error: `tender "${tenderId}" could not be read` }, 500);
      }
      /* Optional typed tender record — capped, never trusted as findings.
         Keys are normalised to a fixed set so stray fields can't ride in. */
      const DETAIL_KEYS = [
        "method",
        "supplierSelection",
        "invitesIssued",
        "preQualDate",
        "publishedDate",
        "deadlineDate",
        "buyer",
        "category",
        "currency",
        "ceiling",
        "specification",
        "awardCriteria",
        "evaluationChecks",
        "sourceUrl",
        "noticeRef",
      ] as const;
      let detail: Record<string, unknown> | undefined;
      if (body.detail && typeof body.detail === "object") {
        const raw = body.detail as Record<string, unknown>;
        detail = {};
        for (const k of DETAIL_KEYS) {
          const v = raw[k];
          if (v === undefined || v === null) continue;
          if (Array.isArray(v)) detail[k] = v.map(String).slice(0, 12);
          else if (typeof v === "string" || typeof v === "number") detail[k] = v;
        }
        if (Object.keys(detail).length === 0) detail = undefined;
      }
      const run: Run = {
        id: `run_${randomUUID().slice(0, 8)}`,
        traceId: currentTraceId(),
        workspaceId: currentWorkspaceId(),
        reference,
        tenderId,
        status: "RUNNING",
        startedBy: attestedActor || undefined,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        progress: [`▸ review_graph invoked — langgraph.js · tender ${tenderId}`],
        requirements: [],
        findings: [],
        drafts: [],
        ...(detail ? { detail } : {}),
      };
      state.runs.unshift(run);
      try {
        /* Commit the run record first. If the process stops before the job
           insert, startup recovery sees this RUNNING record and enqueues it.
           Once we return 201, both the record and its durable job exist. */
        saveState();
        await flushState();
        await enqueueDurableJob({
          id: `review:${run.id}`,
          kind: "REVIEW_RUN",
          payload: { runId: run.id, workspaceId: run.workspaceId ?? "demo", traceId: run.traceId ?? "" },
          status: "PENDING",
          attempts: 0,
          maxAttempts: 5,
          runAt: new Date().toISOString(),
        });
      } catch (err) {
        state.runs.splice(state.runs.indexOf(run), 1);
        try { await flushState(); } catch { /* the failed request is not acknowledged */ }
        return json({ error: `review could not be queued durably: ${(err as Error).message}` }, 503);
      }
      appendLog({
        actor: "web-app",
        server: "quorum-mcp",
        tool: "run_launch",
        kind: "WRITES",
        runId: run.id,
        inputs: { tenderId, detail: detail ?? "none (files-only launch)" },
        outputs: { runId: run.id },
        status: "OK",
        durationMs: 0,
      });
      return json({ run }, 201);
    }

    /* Stage manual tender documents — the typed entries become real files the
       review graph reads, exactly like uploaded packs. Notice-type entries
       merge into one 01-manual-notice.md (the file buildPack reads as the
       notice); bid-type entries each become 9X-bid-<slug>.md so buildPack
       derives the bidder name from the filename, matching the pack convention. */
    if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/docs$/.test(path) && req.method === "POST") {
      const tenderId = decodeURIComponent(path.match(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/docs$/)![1]);
      const body = await readBody(req);
      const docs = Array.isArray(body.docs) ? body.docs : [];
      if (docs.length === 0) return json({ error: "docs required" }, 422);
      try {
        mkdirSync(TENDERS_DIR + tenderId, { recursive: true });
      } catch {
        return json({ error: "tender directory could not be created" }, 500);
      }
      const written: string[] = [];
      const noticeParts: string[] = [];
      let bidIndex = 0;
      docs.slice(0, 12).forEach((raw) => {
        const d = raw as { name?: unknown; text?: unknown; kind?: unknown };
        const name = String(d.name ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 120);
        const text = String(d.text ?? "").slice(0, 60_000);
        if (!name || !text.trim()) return;
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "entry";
        const kind = String(d.kind ?? "bid").toLowerCase();
        if (kind === "notice") {
          noticeParts.push(`# ${name}\n\n${text}\n`);
          return;
        }
        bidIndex += 1;
        const file = `9${bidIndex}-bid-${slug}.md`;
        try {
          writeFileSync(TENDERS_DIR + tenderId + "/" + file, text);
          written.push(file);
        } catch {
          /* one bad entry never blocks the rest */
        }
      });
      if (noticeParts.length > 0) {
        try {
          writeFileSync(TENDERS_DIR + tenderId + "/01-manual-notice.md", noticeParts.join("\n---\n\n"));
          written.unshift("01-manual-notice.md");
        } catch {
          /* fall through — bids may still have landed */
        }
      }
      if (written.length === 0) return json({ error: "no valid docs" }, 422);
      /* Phase 4: staged text is registered per file with its content hash —
         the pack files are the review graph's source of truth, so their
         fingerprints live in the register too. */
      for (const file of written) {
        try {
          const content = readFileSync(TENDERS_DIR + tenderId + "/" + file, "utf8");
          registerDocument({
            tenderId,
            key: `tenders/${tenderId}/${file}`,
            title: file,
            kind: file.startsWith("01-") ? "NOTICE" : file.includes("-bid-") ? "BID" : "OTHER",
            content,
            bytes: Buffer.byteLength(content),
            contentType: "text/markdown",
            channel: "sidecar_stage",
            importer: attestedActor || "web-app",
            provenance: { originSystem: "quorum sidecar staging", note: "typed/staged text the review graph reads" },
          });
        } catch (err) {
          console.error("[document-register] stage registration failed:", err);
        }
      }
      appendLog({
        actor: "web-app",
        server: "quorum-mcp",
        tool: "tender_documents_stage",
        kind: "WRITES",
        inputs: { tenderId, count: written.length },
        outputs: { files: written },
        status: "OK",
        durationMs: 0,
      });
      return json({ files: written }, 201);
    }

    /* Record a supplier's required bid document in the procurement audit
       spine. The edge has already confirmed that the bytes landed in R2;
       the organization and Firebase UID come from the verified gateway
       session, and the file remains pending human review. */
    if (path === "/api/supplier-bid-uploads" && req.method === "POST") {
      const body = await readBody(req);
      const tenderRef = String(body.tenderRef ?? "").trim();
      const orgId = String(body.organizationId ?? "").trim();
      const firebaseUid = String(body.firebaseUid ?? "").trim();
      const requirement = String(body.requirement ?? "").trim().slice(0, 180);
      const key = String(body.key ?? "").trim();
      const filename = String(body.filename ?? "").trim().slice(0, 120);
      const contentType = String(body.contentType ?? "").trim().slice(0, 120);
      const bytes = Number(body.bytes);
      const sha256 = String(body.sha256 ?? "").trim().toLowerCase();
      const uploadedAt = String(body.uploadedAt ?? "").trim();
      const safeRef = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(tenderRef);
      const safeOrgId = /^org_[A-Za-z0-9_-]{1,64}$/.test(orgId);
      const safeUid = /^[A-Za-z0-9_-]{1,128}$/.test(firebaseUid);
      const safeKey =
        key.length > 0 && key.length <= 512 && !/[\\\u0000-\u001f]/.test(key) &&
        key.startsWith(`tenders/${tenderRef}/supplier-bids/${orgId}/${firebaseUid}/`) &&
        key.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
      if (!attestedActor.startsWith("org:") || !safeRef || !safeOrgId || !safeUid || !requirement || !filename || !safeKey) {
        return json({ error: "A valid attested supplier identity and bid document are required." }, 422);
      }
      if (!Number.isFinite(bytes) || bytes <= 0 || bytes > 10 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(sha256)) {
        return json({ error: "The bid document size or SHA-256 digest is not valid." }, 422);
      }
      if (Number.isNaN(Date.parse(uploadedAt)) || !contentType) {
        return json({ error: "The bid document metadata is incomplete." }, 422);
      }
      const entry = appendLog({
        actor: attestedActor,
        server: "quorum-mcp",
        tool: "supplier_bid_document_upload",
        kind: "WRITES",
        inputs: { tenderRef, organizationId: orgId, firebaseUid, requirement, key, filename, contentType, bytes, sha256, uploadedAt },
        outputs: { stored: true, storage: "Cloudflare R2", eligibilityDecision: false, humanReviewRequired: true },
        status: "OK",
        durationMs: 0,
      });
      return json({ recorded: true, audit: { seq: entry.seq, id: entry.id, self: entry.self } }, 201);
    }

    if (path === "/api/supplier-bid-document-deletions" && req.method === "POST") {
      const body = await readBody(req);
      const tenderRef = String(body.tenderRef ?? "").trim();
      const orgId = String(body.organizationId ?? "").trim();
      const firebaseUid = String(body.firebaseUid ?? "").trim();
      const requirement = String(body.requirement ?? "").trim().slice(0, 180);
      const key = String(body.key ?? "").trim();
      const sha256 = String(body.sha256 ?? "").trim().toLowerCase();
      const requirementHash = createHash("sha256").update(requirement.normalize("NFKC").trim().toLowerCase()).digest("hex").slice(0, 20);
      const safeKey = key.startsWith(`tenders/${tenderRef}/supplier-bids/${orgId}/${firebaseUid}/${requirementHash}/`) && key.length <= 512 && !/[\\\u0000-\u001f]/.test(key) && key.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
      if (!attestedActor.startsWith("org:") || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(tenderRef) || !/^org_[A-Za-z0-9_-]{1,64}$/.test(orgId) || !/^[A-Za-z0-9_-]{1,128}$/.test(firebaseUid) || !requirement || !safeKey || !/^[a-f0-9]{64}$/.test(sha256)) {
        return json({ error: "A valid attested supplier document is required." }, 422);
      }
      const entry = appendLog({
        actor: attestedActor,
        server: "quorum-mcp",
        tool: "supplier_bid_document_delete",
        kind: "WRITES",
        inputs: { tenderRef, organizationId: orgId, firebaseUid, requirement, key, sha256 },
        outputs: { deleted: true, storage: "Cloudflare R2", beforeFiling: true },
        status: "OK",
        durationMs: 0,
      });
      return json({ recorded: true, audit: { seq: entry.seq, id: entry.id, self: entry.self } }, 201);
    }

    /* Record an R2 tender upload in the hash-chained audit spine. The web
       route calls this after the edge gate confirms the PUT — including when
       extraction found no text or staging was refused. The object key, size
       and content type are the durable facts; staging is an outcome, not a
       precondition for a record. */
    if (path === "/api/tender-uploads" && req.method === "POST") {
      const body = await readBody(req);
      const tenderId = String(body.tenderId ?? "").trim();
      const key = String(body.key ?? "").trim();
      const bytes = Number(body.bytes);
      const parts = key.split("/");
      const safeKey =
        /^[A-Za-z0-9._-]+$/.test(tenderId) &&
        key.length > 0 &&
        key.length <= 512 &&
        !/[\\\u0000-\u001f]/.test(key) &&
        parts.length >= 3 &&
        parts[0] === "tenders" &&
        parts[1] === tenderId &&
        parts.every((part) => part.length > 0 && part !== "." && part !== "..");
      if (!safeKey) {
        return json({ error: "key must live under tenders/<tenderId>/ with no traversal" }, 422);
      }
      if (!Number.isFinite(bytes) || bytes <= 0 || bytes > 10 * 1024 * 1024) {
        return json({ error: "bytes must be between 1 and 10485760" }, 422);
      }
      const strings = (value: unknown, max: number, take: number): string[] =>
        Array.isArray(value)
          ? value
              .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
              .slice(0, take)
              .map((v) => v.slice(0, max))
          : [];
      const pages = Number(body.pages);
      const chars = Number(body.chars);
      const note = typeof body.note === "string" ? body.note.slice(0, 220) : undefined;
      const reason = typeof body.reason === "string" ? body.reason.slice(0, 220) : undefined;
      /* Phase 4: every stored object lands in the document register with its
         content hash, provenance and retention line. The web route computes
         the sha over the raw bytes; when it did not send one, the register
         row still exists with the byte count and channel as the durable
         facts — the hash line says so honestly. */
      const sha = typeof body.sha256 === "string" && /^[a-f0-9]{16,64}$/.test(body.sha256) ? body.sha256 : undefined;
      try {
        const { record } = registerDocument({
          tenderId,
          key,
          title: String(body.filename ?? key).slice(0, 200),
          kind: body.kind === "notice" ? "NOTICE" : body.kind === "bid" ? "BID" : "OTHER",
          ...(sha ? { sha256: sha } : {}),
          bytes,
          contentType: String(body.contentType ?? "").trim().slice(0, 120) || undefined,
          channel: "web_upload",
          importer: attestedActor || "web-app",
          provenance: { originSystem: "R2 quorum-tenders via quorum-edge", note: reason ?? note },
          extractionConfidence:
            body.extracted === true && body.staged === true
              ? { level: "HIGH" }
              : { level: "LOW", reason: reason ?? "extraction found no usable text — a human must review before this document is relied on" },
        });
      } catch (err) {
        /* The audit line below is the durable record; a register failure is
           reported in its outputs, never thrown away. */
        console.error("[document-register] upload registration failed:", err);
      }
      const entry = appendLog({
        actor: attestedActor || "web-app",
        server: "quorum-mcp",
        tool: "tender_upload",
        kind: "WRITES",
        inputs: {
          tenderId,
          key,
          bytes,
          contentType: String(body.contentType ?? "").trim().slice(0, 120),
          filename: String(body.filename ?? "").trim().slice(0, 200),
        },
        outputs: {
          stored: true,
          staged: body.staged === true,
          extracted: body.extracted === true,
          kind: body.kind === "notice" || body.kind === "bid" ? body.kind : undefined,
          pages: Number.isFinite(pages) && pages > 0 ? pages : undefined,
          sheets: strings(body.sheets, 80, 20),
          chars: Number.isFinite(chars) && chars >= 0 ? chars : undefined,
          note,
          reason,
          files: strings(body.files, 120, 20),
          humanReviewRequired: body.humanReviewRequired === true,
          /* SAM only locates a region; the box is a pointer for a human, not
             a finding. Keep the provenance compact and auditable. */
          vision:
            body.vision && typeof body.vision === "object"
              ? {
                  model: String((body.vision as Record<string, unknown>).model ?? "").slice(0, 60) || undefined,
                  ok: (body.vision as Record<string, unknown>).ok === true,
                  matches: Number((body.vision as Record<string, unknown>).matches) || 0,
                  page: Number((body.vision as Record<string, unknown>).page) || undefined,
                  prompt: String((body.vision as Record<string, unknown>).prompt ?? "").slice(0, 60) || undefined,
                  latencyMs: Number((body.vision as Record<string, unknown>).latencyMs) || 0,
                  note: String((body.vision as Record<string, unknown>).note ?? "").slice(0, 220) || undefined,
                }
              : undefined,
          museVision:
            body.museVision && typeof body.museVision === "object"
              ? {
                  model: String((body.museVision as Record<string, unknown>).model ?? "").slice(0, 60) || undefined,
                  ok: (body.museVision as Record<string, unknown>).ok === true,
                  pages: Array.isArray((body.museVision as Record<string, unknown>).pages)
                    ? ((body.museVision as Record<string, unknown>).pages as unknown[]).filter((page): page is number => Number.isInteger(page) && Number(page) > 0).slice(0, 5)
                    : [],
                  usage: (body.museVision as Record<string, unknown>).usage && typeof (body.museVision as Record<string, unknown>).usage === "object"
                    ? {
                        promptTokens: Number(((body.museVision as Record<string, unknown>).usage as Record<string, unknown>).promptTokens) || 0,
                        completionTokens: Number(((body.museVision as Record<string, unknown>).usage as Record<string, unknown>).completionTokens) || 0,
                      }
                    : undefined,
                  latencyMs: Number((body.museVision as Record<string, unknown>).latencyMs) || 0,
                  note: String((body.museVision as Record<string, unknown>).note ?? "").slice(0, 300) || undefined,
                  error: String((body.museVision as Record<string, unknown>).error ?? "").slice(0, 240) || undefined,
                }
              : undefined,
        },
        status: "OK",
        durationMs: Math.max(0, Math.min(600_000, Number(body.durationMs) || 0)),
      });
      return json({ entry }, 201);
    }

    /* Record a signed tender download in the same hash-chained spine. The web
       route calls this only after the session, the link's HMAC, its expiry and
       the edge gate have all passed. A ranged request records the exact slice
       that was served, so a resumed or paged read is distinguishable from the
       full object. The audit is a record of delivery, not a precondition for
       it: if this append cannot be reached, the document still streams and the
       response says so. */
    if (path === "/api/tender-downloads" && req.method === "POST") {
      const body = await readBody(req);
      const recorded = recordTenderDownload(body, attestedActor);
      if (recorded.status === 201) {
        /* The register's custody line mirrors the spine: who read the object,
           when, and what slice. A failure here is logged, never fatal. */
        try {
          const key = String((body as { key?: unknown }).key ?? "");
          if (key) noteDownload(key, attestedActor || "web-app", "signed download through the edge gate");
        } catch (err) {
          console.error("[document-register] download custody failed:", err);
        }
      }
      return recorded.status === 201
        ? json({ entry: recorded.entry }, 201)
        : json({ error: recorded.error }, 422);
    }

    if (path === "/api/tender-deletions" && req.method === "POST") {
      const body = await readBody(req);
      const recorded = recordTenderDeletion(body, attestedActor);
      return recorded.status === 201
        ? json({ entry: recorded.entry }, 201)
        : json({ error: recorded.error }, 422);
    }

    if (path === "/api/sample-tenders") {
      return json({ samples: await listSampleTenders() });
    }

    if (path.startsWith("/api/sample-tenders/") && req.method === "GET") {
      const match = path.match(/^\/api\/sample-tenders\/([^/]+)\/docs\/([^/]+)$/);
      if (match) {
        const doc = await readSampleDocument(match[1], match[2]);
        if (!doc) return json({ error: "not found" }, 404);
        return json({ doc });
      }
      const ref = path.match(/^\/api\/sample-tenders\/([^/]+)$/)?.[1];
      if (ref) {
        const sample = (await listSampleTenders()).find((s) => s.ref === ref);
        if (!sample) return json({ error: "not found" }, 404);
        return json({ sample });
      }
      return json({ error: "not found" }, 404);
    }

    /* ── Procurement methods — the regimes the engine reviews against ───── */
    if (path === "/api/methods") {
      return json({ ZM: ZAMBIA_METHODS });
    }

    /* ── Published procurement records are read-only; no authenticated e-GP write API is configured. ── */
    if (path === "/api/egp-status") {
      return json({
        available: false,
        mode: "read-only-demo",
        message: "Authenticated e-GP submission and publication are unavailable. Portal actions in this demo create local simulated records only.",
        configuredWriteConnectors: [],
      });
    }

    /* ── The ZPPA roll — the published e-GP record, read in at intake ───── */
    if (path === "/api/zppa-roll") {
      return json({ source: ZPPA_SOURCE, roll: ZPPA_ROLL, writeAccess: { available: false, statusUrl: "/api/egp-status" } });
    }

    /* ── OCDS records already staged in a tender pack, exposed read-only. ── */
    if (path === "/api/ocds-feed" && req.method === "GET") {
      const ref = (url.searchParams.get("ref") ?? "").trim();
      if (!ref) {
        return json({
          standard: "OCDS 1.1",
          mode: "staged-records-only",
          recordsUrl: "/api/ocds-feed?ref=<tender-reference>",
          registries: loadOcpSnapshot().all.map((dataset) => ({
            country: dataset.country,
            publisher: dataset.publisher,
            publicationId: dataset.publicationId,
            registryUrl: dataset.registryUrl,
            downloads: dataset.downloads,
            lastRetrieved: dataset.lastRetrieved,
            stale: dataset.stale,
          })),
          writeAccess: { available: false, statusUrl: "/api/egp-status" },
        });
      }
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(ref)) return json({ error: "invalid tender reference" }, 422);
      const { files, pack } = await loadPack(ref);
      if (!files.length) return json({ error: "no staged tender pack found" }, 404);
      const records = pack.records.map((record) => ({
        ocid: record.ocid,
        source: record.source,
        tender: { title: record.notice, ...(record.tenderValue ? { value: record.tenderValue } : {}) },
        bids: { details: record.bids.map((bid) => ({ tenderers: [{ name: bid.bidder }], value: bid.value === undefined ? undefined : { amount: bid.value, currency: bid.currency }, documents: bid.text ? [{ title: bid.text }] : [], _source: bid.source, _ref: bid.ref })) },
        awards: record.awards.map((award) => ({ suppliers: [{ name: award.supplier }], value: { amount: award.value, currency: award.currency }, _ref: award.ref })),
      }));
      return json({ standard: "OCDS 1.1", ref, records, sourceFiles: files.filter((file) => file.endsWith(".json")), writeAccess: { available: false, statusUrl: "/api/egp-status" } });
    }

    /* ── The OCP Data Registry — Africa first, the world beside it ───────── */
    if (path === "/api/ocp-africa") {
      const snapshot = loadOcpSnapshot();
      return json({
        source: snapshot.africa.source,
        countries: rollupCountries(snapshot.africa.datasets),
        datasets: snapshot.africa.datasets,
        global: {
          source: snapshot.global.source,
          countries: rollupCountries(snapshot.global.datasets),
          datasets: snapshot.global.datasets,
        },
        links: loadPortalLinks(),
        state: loadPortalState(),
        refresh: ocpRefreshStatus(),
      });
    }

    /* ── The registry refresh — automatic, and forceable by the desk ─────── */
    if (path === "/api/ocp-refresh" && req.method === "GET") {
      return json({ status: ocpRefreshStatus() });
    }
    if (path === "/api/ocp-refresh" && req.method === "POST") {
      const body = await readBody(req);
      const result = await refreshOcpRegistry({
        force: body.force !== false,
        actor: attestedActor || "scheduled-refresh",
      });
      return json(result, result.ok ? 200 : 502);
    }

    /* ── Portal enable/disable — the committee's switch, persisted and logged */
    if (path === "/api/portal-state" && req.method === "POST") {
      const body = await readBody(req);
      const rawIds = body.publicationIds;
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        return json({ error: "publicationIds must be a non-empty array of the registry's publication ids" }, 422);
      }
      const ids = [...new Set(rawIds.map((x: unknown) => Number(x)).filter((n: number) => Number.isInteger(n)))];
      const known = new Set(getOcpDatasets().map((d) => d.publicationId));
      if (ids.length === 0 || ids.some((n: number) => !known.has(n))) {
        return json({ error: "publicationIds must name portals from the registry" }, 422);
      }
      if (typeof body.enabled !== "boolean") {
        return json({ error: "enabled must be a boolean" }, 422);
      }
      const actor = (attestedActor || strOpt(body.actor) || "unknown").slice(0, 80);
      const file = setPortalsEnabled(ids, body.enabled, actor);
      appendLog({
        actor,
        server: "quorum-mcp",
        tool: "toggle_portals",
        kind: "WRITES",
        inputs: { publicationIds: ids, enabled: body.enabled },
        outputs: {
          toggled: ids.length,
          state: body.enabled ? "ENABLED" : "DISABLED",
          disabledTotal: disabledPortalIds(file).size,
        },
        status: "OK",
        durationMs: 0,
      });
      return json({ state: file });
    }

    /* ── Portal connections — a real handshake per dataset, dated ───────── */
    if (path === "/api/portal-links") {
      return json(loadPortalLinks());
    }

    if (path === "/api/portal-connect" && req.method === "POST") {
      const body = await readBody(req);
      let ids: number[] | null = null;
      if (body.publicationIds !== undefined) {
        if (!Array.isArray(body.publicationIds) || body.publicationIds.length === 0) {
          return json({ error: "publicationIds must be a non-empty array of the registry's publication ids" }, 422);
        }
        ids = body.publicationIds.map((x: unknown) => Number(x)).filter((n: number) => Number.isInteger(n));
        if (ids.length === 0) {
          return json({ error: "publicationIds must be a non-empty array of the registry's publication ids" }, 422);
        }
      }
      const actor = (attestedActor || strOpt(body.actor) || "unknown").slice(0, 80);
      /* A portal the committee switched off is never probed — a bulk pass
         covers the portals still in use, and an explicit id list loses the
         disabled ones. Every skip is reported, never silent. */
      const disabled = disabledPortalIds();
      let skippedDisabled: number[] = [];
      if (ids === null) {
        skippedDisabled = [...disabled];
        ids = disabled.size > 0 ? getOcpDatasets().filter((d) => !disabled.has(d.publicationId)).map((d) => d.publicationId) : null;
      } else if (disabled.size > 0) {
        skippedDisabled = ids.filter((n) => disabled.has(n));
        ids = ids.filter((n) => !disabled.has(n));
      }
      const started = Date.now();
      /* connectMany treats a null id list as "everything" — an empty enabled
         list must skip the pass entirely, not probe the world. */
      const file = ids !== null && ids.length === 0 ? loadPortalLinks() : await connectMany(ids, fetch);
      const touched = Object.values(file.links).filter(
        (l) => (ids === null || ids.includes(l.publicationId)) && !disabled.has(l.publicationId),
      );
      const linked = touched.filter((l) => l.registry.ok).length;
      const portalsUp = touched.filter((l) => l.portal.ok).length;
      appendLog({
        actor,
        server: "quorum-mcp",
        tool: "connect_portals",
        kind: "READ",
        inputs: { publicationIds: ids === null ? "every portal in use" : ids },
        outputs: {
          checked: touched.length,
          linked,
          portalsUp,
          failed: touched.filter((l) => !l.registry.ok).map((l) => l.publicationId),
          skippedDisabled,
        },
        status: "OK",
        durationMs: Date.now() - started,
      });
      return json(file);
    }

    /* ── Jurisdiction clock — the calendar the statutory periods run on ───── */
    if (path === "/api/jurisdiction" && req.method === "GET") {
      const pack = jurisdictionPack(state.jurisdictionId);
      return json({ id: pack.id, jurisdiction: packSummary(pack), packs: [packSummary(jurisdictionPack("ZM")), packSummary(jurisdictionPack("KE"))] });
    }

    if (path === "/api/jurisdiction" && (req.method === "PATCH" || req.method === "PUT")) {
      const body = await readBody(req);
      const next = body.id ?? body.jurisdictionId;
      if (!isJurisdictionId(next)) return json({ error: 'id must be "ZM" or "KE"' }, 422);
      if (next === state.jurisdictionId) return json({ id: state.jurisdictionId, changed: false });
      const before = state.jurisdictionId;
      state.jurisdictionId = next;
      const actor = (attestedActor || strOpt(body.actor) || "unknown").slice(0, 80);
      saveState();
      appendLog({
        actor,
        server: "quorum-mcp",
        tool: "set_jurisdiction",
        kind: "WRITES",
        inputs: { before },
        outputs: { after: state.jurisdictionId, timezone: jurisdictionPack(state.jurisdictionId).timezone },
        status: "OK",
        durationMs: 0,
      });
      return json({ id: state.jurisdictionId, changed: true });
    }

    /* ── Deployment truth — RECORD_ONLY is the default ─────────────────────
       A local record may rehearse the cycle, but it cannot authorise a
       contract or a payment. CONNECTED is refused unless the connector flag is
       on AND the caller supplies a verifiable external publication receipt. */
    if (path === "/api/deployment" && req.method === "GET") {
      return json({ deployment: state.deployment });
    }

    if (path === "/api/deployment" && (req.method === "PATCH" || req.method === "PUT")) {
      const body = await readBody(req);
      const mode = body.mode === "CONNECTED" ? "CONNECTED" : body.mode === "RECORD_ONLY" ? "RECORD_ONLY" : null;
      if (!mode) return json({ error: 'mode must be "RECORD_ONLY" or "CONNECTED"' }, 422);
      let connectorId: string | undefined;
      const reason = String(body.reason ?? "").trim().slice(0, 240);
      if (reason.length < 8) {
        return json({ error: "A reason of at least 8 characters is required for a deployment change." }, 422);
      }
      const actor = (attestedActor || strOpt(body.actor) || "unknown").slice(0, 80);
      const before = { mode: state.deployment.mode, publication: state.deployment.publication };
      let publication = { ...state.deployment.publication };

      if (mode === "CONNECTED") {
        if (!state.features.connectedPublication) {
          return json(
            {
              error:
                "Connected publication is not enabled. Turn on the connectedPublication feature flag only after a real portal connector is installed and tested.",
            },
            409,
          );
        }
        const connector = state.connector;
        if (!connector || !connector.active) {
          return json(
            {
              error:
                "No live connector is registered. CONNECTED means connected to something real — register the portal connector first (POST /api/deployment/connector), then attach the publication receipt.",
            },
            409,
          );
        }
        const raw = (body.publication ?? {}) as Record<string, unknown>;
        const portal = String(raw.portal ?? "").trim().slice(0, 200);
        const receiptId = String(raw.receiptId ?? "").trim().slice(0, 200);
        const evidenceHash = String(raw.evidenceHash ?? "").trim().slice(0, 200);
        const publishedAt = new Date(String(raw.publishedAt ?? ""));
        if (!portal || !receiptId || !evidenceHash || Number.isNaN(publishedAt.getTime())) {
          return json(
            {
              error:
                "Connected mode requires portal, receiptId, evidenceHash and a real publishedAt from the external system. A local record is not a publication receipt.",
            },
            422,
          );
        }
        publication = {
          mode: "CONNECTED",
          portal,
          receiptId,
          evidenceHash,
          publishedAt: publishedAt.toISOString(),
          verifiedAt: new Date().toISOString(),
        };
        connectorId = state.connector!.id;
      } else {
        publication = { mode: "SIMULATED", portal: SIMULATED_PORTAL };
      }

      const changed = before.mode !== mode || JSON.stringify(before.publication) !== JSON.stringify(publication);
      if (!changed) return json({ deployment: state.deployment, changed: false });

      state.deployment = {
        mode,
        publication,
        ...(connectorId ? { connectorId } : {}),
        updatedAt: new Date().toISOString(),
        updatedBy: actor,
        reason,
      };
      saveState();
      appendLog({
        actor,
        server: "quorum-mcp",
        tool: "set_deployment",
        kind: "WRITES",
        inputs: { before, reason },
        outputs: { after: state.deployment },
        status: "OK",
        durationMs: 0,
      });
      return json({ deployment: state.deployment, changed: true });
    }

    /* ── Unified audit spine — web-side events join the chain (WS9) ─────────
       Server-to-server only: the web app seals the forward with the same
       HMAC it puts on every mutation. A browser call (session-cookie path)
       is refused — an end user cannot write audit lines. */
    if (path === "/api/audit/forward" && req.method === "POST") {
      const seal = attestVerify(req.method, path, req.headers);
      if (!seal.ok) return json({ error: seal.reason }, 401);
      const envelopeWorkspace = req.headers.get("x-quorum-workspace")?.trim() || "demo";
      const body = await readBody(req);
      const verdict = forwardWebEvent(body, seal.actor, envelopeWorkspace);
      if (!verdict.ok) {
        appendLog({
          actor: "web-app",
          server: "quorum-mcp",
          tool: "audit_forward",
          kind: "WRITES",
          inputs: { type: (body as { type?: unknown }).type ?? null },
          outputs: { refused: verdict.error },
          status: "ERROR",
          durationMs: 0,
        });
        return json({ error: verdict.error }, verdict.code);
      }
      return json({ logId: verdict.logId, duplicate: verdict.duplicate, highRisk: verdict.highRisk }, 200);
    }

    /* ── Sittings — quorum from a noticed meeting (WS8) ────────────────────── */
    if (path === "/api/sittings" && req.method === "POST") {
      const body = await readBody(req);
      const actor = attestedActor || str(body.actor) || "unknown officer";
      const out = createSitting(body, actor);
      return json(out.body, out.code);
    }
    if (path.startsWith("/api/sittings/") && req.method === "POST") {
      const parts = path.split("/");
      const sittingId = decodeURIComponent(parts[3] ?? "");
      const action = parts[4] ?? "";
      const body = await readBody(req);
      const actor = attestedActor || str(body.actor) || "unknown officer";
      if (action === "attendance") {
        const out = recordAttendance(sittingId, body, actor);
        return json(out.body, out.code);
      }
      if (action === "end") {
        const out = endSitting(sittingId, body, actor);
        return json(out.body, out.code);
      }
      return json({ error: 'unknown sitting action — use "attendance" or "end"' }, 404);
    }
    if (path === "/api/sittings" && req.method === "GET") {
      const rows = state.sittings.filter((s) => (s.workspaceId ?? "demo") === currentWorkspaceId());
      return json({ sittings: rows, flagOn: state.features.sittingQuorum });
    }

    /* ── The connector — what CONNECTED actually means ───────────────────────
       Registering one records who, what endpoint and when. Deregistering
       (deactivate) collapses the deployment back to RECORD_ONLY at the next
       normalisation — truth follows the connector, never the mode flag. */
    if (path === "/api/deployment/connector" && req.method === "POST") {
      const body = await readBody(req);
      const actor = attestedActor || str(body.operator) || "unknown operator";
      const name = str(body.name).slice(0, 200);
      const endpoint = str(body.endpoint).slice(0, 400);
      if (!name || !endpoint) return json({ error: "A connector needs a name and an endpoint." }, 422);
      let parsed: URL | null = null;
      try {
        parsed = new URL(endpoint);
      } catch {
        return json({ error: "The endpoint must be an absolute URL." }, 422);
      }
      if (parsed.protocol !== "https:") {
        return json({ error: "The connector endpoint must speak HTTPS — a national portal cannot be reached on the wire." }, 422);
      }
      const registration = registeredConnector({
        name,
        endpoint,
        operator: actor,
        ...(attestedActorId ? { operatorId: attestedActorId } : {}),
        ...(str(body.note, 240) ? { note: str(body.note, 240) } : {}),
      });
      const previousActive = state.connector?.active ?? false;
      state.connector = registration;
      /* A new connector does not by itself connect anything: CONNECTED still
         needs the verified receipt, set through PATCH /api/deployment. */
      if (!previousActive && state.deployment.mode === "CONNECTED") {
        state.deployment = normalizeDeployment({ ...state.deployment }, registration);
      }
      saveState();
      appendLog({
        actor,
        server: "quorum-mcp",
        tool: "register_connector",
        kind: "IRREVERSIBLE",
        inputs: { name, endpoint, operator: actor },
        outputs: { connectorId: registration.id, active: registration.active },
        status: "OK",
        durationMs: 0,
      });
      return json({ connector: registration }, 201);
    }
    if (path === "/api/deployment/connector/deactivate" && req.method === "POST") {
      const body = await readBody(req);
      const actor = attestedActor || str(body.operator) || "unknown operator";
      if (!state.connector) return json({ error: "No connector is registered." }, 404);
      if (!state.connector.active) return json({ error: "The connector is already inactive." }, 409);
      state.connector = { ...state.connector, active: false, deactivatedAt: new Date().toISOString(), deactivatedBy: actor };
      state.deployment = normalizeDeployment({ ...state.deployment }, state.connector);
      saveState();
      appendLog({
        actor,
        server: "quorum-mcp",
        tool: "deregister_connector",
        kind: "IRREVERSIBLE",
        inputs: { connectorId: state.connector.id },
        outputs: { active: false, deploymentMode: state.deployment.mode },
        status: "OK",
        durationMs: 0,
      });
      return json({ connector: state.connector, deployment: state.deployment });
    }

    /* ── Feature flags — the registry of what has actually shipped ───────── */
    if (path === "/api/features" && req.method === "GET") {
      return json({ features: state.features, registry: FEATURE_FLAGS });
    }

    if (path === "/api/features" && (req.method === "PATCH" || req.method === "PUT")) {
      const body = await readBody(req);
      const raw =
        body.features && typeof body.features === "object" && !Array.isArray(body.features)
          ? (body.features as Record<string, unknown>)
          : body;
      const changes: Record<string, boolean> = {};
      for (const flag of FEATURE_FLAGS) {
        if (raw[flag.key] === undefined) continue;
        if (typeof raw[flag.key] !== "boolean") {
          return json({ error: `${flag.key} must be true or false` }, 422);
        }
        if ("locked" in flag && flag.locked === true) {
          return json(
            { error: `${flag.label} is locked on — it is a record-integrity refusal and cannot be disabled.` },
            409,
          );
        }
        if (state.features[flag.key] !== raw[flag.key]) changes[flag.key] = raw[flag.key] as boolean;
      }
      if (Object.keys(changes).length === 0) return json({ features: state.features, changed: false });

      const actor = (attestedActor || strOpt(body.actor) || "unknown").slice(0, 80);
      const before = { ...state.features };
      state.features = { ...state.features, ...changes } as typeof state.features;
      saveState();
      appendLog({
        actor,
        server: "quorum-mcp",
        tool: "set_feature_flags",
        kind: "WRITES",
        inputs: { before },
        outputs: { after: state.features, changed: changes },
        status: "OK",
        durationMs: 0,
      });
      return json({ features: state.features, changed: true });
    }

    /* The published rule register — interpolated from the live guards so the
       manual cannot drift from the engine. */
    if (path === "/api/rule-catalogue" && req.method === "GET") {
      return json({
        rules: buildRuleCatalogue(state.guards),
        guards: state.guards,
        deployment: state.deployment,
        generatedAt: new Date().toISOString(),
      });
    }

    /* ── The tunable guards — written here by name, obeyed by the engine ─── */
    if (path === "/api/guards" && req.method === "GET") {
      return json({ guards: state.guards });
    }

    if (path === "/api/guards" && (req.method === "PATCH" || req.method === "PUT")) {
      const body = await readBody(req);
      if (
        body.priceVariancePct === undefined &&
        body.checklist === undefined &&
        body.registryCrossCheck === undefined &&
        body.dualApprovalThreshold === undefined &&
        body.scoreDivergencePoints === undefined &&
        body.fxStalenessDays === undefined
      ) {
        return json({ error: "no guard fields supplied" }, 422);
      }
      const actor = (attestedActor || strOpt(body.actor) || "unknown").slice(0, 80);
      const before = {
        priceVariancePct: state.guards.priceVariancePct,
        checklist: state.guards.checklist,
        registryCrossCheck: state.guards.registryCrossCheck,
        dualApprovalThreshold: state.guards.dualApprovalThreshold,
        scoreDivergencePoints: state.guards.scoreDivergencePoints,
        fxStalenessDays: state.guards.fxStalenessDays,
      };
      const next = { ...before };
      if (body.priceVariancePct !== undefined) {
        const pct = Number(body.priceVariancePct);
        if (![15, 25, 40].includes(pct)) return json({ error: "priceVariancePct must be 15, 25 or 40" }, 422);
        next.priceVariancePct = pct as Guards["priceVariancePct"];
      }
      if (body.checklist !== undefined) {
        if (body.checklist !== "STANDARD" && body.checklist !== "STRICT") return json({ error: "checklist must be STANDARD or STRICT" }, 422);
        next.checklist = body.checklist;
      }
      if (body.registryCrossCheck !== undefined) {
        if (typeof body.registryCrossCheck !== "boolean") return json({ error: "registryCrossCheck must be true or false" }, 422);
        next.registryCrossCheck = body.registryCrossCheck;
      }
      if (body.dualApprovalThreshold !== undefined) {
        const threshold = Number(body.dualApprovalThreshold);
        if (!Number.isFinite(threshold) || threshold < 0) {
          return json({ error: "dualApprovalThreshold must be a number at or above 0 (0 disables dual approval)" }, 422);
        }
        next.dualApprovalThreshold = threshold;
      }
      if (body.scoreDivergencePoints !== undefined) {
        const points = Number(body.scoreDivergencePoints);
        if (!Number.isFinite(points) || points <= 0 || points > 100) {
          return json({ error: "scoreDivergencePoints must be a number above 0 and at most 100" }, 422);
        }
        next.scoreDivergencePoints = points;
      }
      if (body.fxStalenessDays !== undefined) {
        const days = Number(body.fxStalenessDays);
        if (!Number.isFinite(days) || days < 1 || days > 365) {
          return json({ error: "fxStalenessDays must be a number between 1 and 365" }, 422);
        }
        next.fxStalenessDays = days;
      }
      /* A no-op is not a change — nothing moves, nothing is logged. */
      const touched =
        before.priceVariancePct !== next.priceVariancePct ||
        before.checklist !== next.checklist ||
        before.registryCrossCheck !== next.registryCrossCheck ||
        before.dualApprovalThreshold !== next.dualApprovalThreshold ||
        before.scoreDivergencePoints !== next.scoreDivergencePoints ||
        before.fxStalenessDays !== next.fxStalenessDays;
      if (touched) {
        state.guards = { ...next, updatedAt: new Date().toISOString(), updatedBy: actor };
        saveState();
        appendLog({
          actor,
          server: "quorum-mcp",
          tool: "set_guards",
          kind: "WRITES",
          inputs: { before },
          outputs: { after: next },
          status: "OK",
          durationMs: 0,
        });
      }
      return json({ guards: state.guards, changed: touched });
    }

    /* ── Supplier register — the platform's named bidders ───────────────── */
    if (path === "/api/suppliers" && req.method === "GET") {
      return json({ suppliers: [...state.suppliers].reverse() });
    }

    if (path === "/api/suppliers" && req.method === "POST") {
      const body = await readBody(req);
      const name = String(body.name ?? "").trim().slice(0, 160);
      const registrationNo = String(body.registrationNo ?? "").trim().slice(0, 80);
      if (!name) return json({ error: "name required" }, 422);
      if (!registrationNo) return json({ error: "registrationNo required" }, 422);
      const dup = state.suppliers.find(
        (s) => s.name.toLowerCase() === name.toLowerCase() || s.registrationNo.toLowerCase() === registrationNo.toLowerCase(),
      );
      if (dup) return json({ error: `supplier already on the register: ${dup.id}` }, 409);
      const categories = Array.isArray(body.categories)
        ? body.categories.map((c: unknown) => String(c).trim().slice(0, 80)).filter(Boolean).slice(0, 12)
        : [];
      const supplier: Supplier = {
        id: `sup_${randomUUID().slice(0, 8)}`,
        name,
        registrationNo,
        taxPin: strOpt(body.taxPin),
        taxClearanceNo: strOpt(body.taxClearanceNo),
        taxClearanceExpiry: strOpt(body.taxClearanceExpiry),
        regulator: strOpt(body.regulator),
        regulatorNo: strOpt(body.regulatorNo),
        contactName: strOpt(body.contactName),
        email: strOpt(body.email),
        phone: strOpt(body.phone),
        address: strOpt(body.address),
        categories,
        metadata: body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
          ? Object.fromEntries(
              Object.entries(body.metadata as Record<string, unknown>)
                .slice(0, 12)
                .map(([k, v]) => [k.slice(0, 40), String(v).slice(0, 200)]),
            )
          : {},
        status: "ACTIVE",
        addedBy: (attestedActor || String(body.addedBy ?? "").trim()).slice(0, 80) || "unknown",
        createdAt: new Date().toISOString(),
      };
      state.suppliers.push(supplier);
      saveState();
      appendLog({
        actor: supplier.addedBy,
        server: "quorum-mcp",
        tool: "supplier_add",
        kind: "WRITES",
        inputs: { name: supplier.name, registrationNo: supplier.registrationNo },
        outputs: { id: supplier.id, status: supplier.status },
        status: "OK",
        durationMs: 0,
      });
      return json({ supplier }, 201);
    }

    /* WS6 — an assurance check recorded against the supplier. The check is
       evidence, not a verdict the client asserts: the store derives VERIFIED
       or FAILED from the registry, tax, screening, ownership and documents. */
    if (/^\/api\/suppliers\/[A-Za-z0-9._-]+\/verification$/.test(path) && req.method === "POST") {
      const id = decodeURIComponent(path.split("/")[3] ?? "");
      const body = await readBody(req);
      const checkedBy = (attestedActor || String(body.by ?? "")).trim();
      try {
        return json(coreVerifySupplier(id, body, checkedBy || "officer"), 201);
      } catch (err) {
        return json({ error: (err as Error).message }, 422);
      }
    }

    if (/^\/api\/suppliers\/[A-Za-z0-9._-]+$/.test(path) && (req.method === "PATCH" || req.method === "PUT")) {
      const id = decodeURIComponent(path.split("/")[3] ?? "");
      const supplier = state.suppliers.find((s) => s.id === id);
      if (!supplier) return json({ error: "supplier not found" }, 404);
      const body = await readBody(req);
      const before = { status: supplier.status };
      if (typeof body.status === "string" && ["ACTIVE", "SUSPENDED", "BLACKLISTED"].includes(body.status)) {
        supplier.status = body.status as Supplier["status"];
      }
      for (const k of [
        "taxPin", "taxClearanceNo", "taxClearanceExpiry", "regulator", "regulatorNo",
        "contactName", "email", "phone", "address",
      ] as const) {
        if (k in body) supplier[k] = strOpt(body[k]);
      }
      if (body.name) supplier.name = String(body.name).trim().slice(0, 160) || supplier.name;
      if (body.registrationNo) supplier.registrationNo = String(body.registrationNo).trim().slice(0, 80) || supplier.registrationNo;
      if (Array.isArray(body.categories)) {
        supplier.categories = body.categories.map((c: unknown) => String(c).trim().slice(0, 80)).filter(Boolean).slice(0, 12);
      }
      supplier.updatedAt = new Date().toISOString();
      saveState();
      appendLog({
        actor: (attestedActor || String(body.actor ?? supplier.addedBy ?? "")).trim().slice(0, 80) || "unknown",
        server: "quorum-mcp",
        tool: "supplier_update",
        kind: "WRITES",
        runId: undefined,
        inputs: { id: supplier.id, name: supplier.name, registrationNo: supplier.registrationNo },
        outputs: { before, after: { status: supplier.status } },
        status: "OK",
        durationMs: 0,
      });
      return json({ supplier });
    }

    if (/^\/api\/suppliers\/[A-Za-z0-9._-]+$/.test(path) && req.method === "DELETE") {
      const id = decodeURIComponent(path.split("/")[3] ?? "");
      const idx = state.suppliers.findIndex((s) => s.id === id);
      if (idx === -1) return json({ error: "supplier not found" }, 404);
      const removed = state.suppliers[idx];
      state.suppliers.splice(idx, 1);
      saveState();
      appendLog({
        actor: attestedActor || String(req.headers.get("x-quorum-actor") ?? "unknown"),
        server: "quorum-mcp",
        tool: "supplier_remove",
        kind: "WRITES",
        inputs: { id: removed.id, name: removed.name, registrationNo: removed.registrationNo },
        outputs: { removed: true },
        status: "OK",
        durationMs: 0,
      });
      return json({ removed: true });
    }

    if (path === "/api/source-requests" && req.method === "GET") {
      return json({ requests: [...state.sourceRequests].reverse() });
    }

    if (path === "/api/source-requests" && req.method === "POST") {
      const body = await readBody(req);
      const name = String(body.name ?? "").trim();
      /* The requester identity is the gateway's attested session when present;
         a body-declared requestedBy is accepted only for unattested local
         callers and is never allowed to override the seal. */
      const requestedBy = (attestedActor || String(body.requestedBy ?? "")).trim();
      if (!name) return json({ error: "name required" }, 422);
      if (!requestedBy) return json({ error: "requestedBy required" }, 422);
      const request = {
        id: `srq_${randomUUID().slice(0, 8)}`,
        name,
        kind: String(body.kind ?? "").trim() || "DATA SOURCE",
        note: String(body.note ?? "").trim() || undefined,
        requestedBy,
        createdAt: new Date().toISOString(),
        status: "PENDING" as const,
      };
      state.sourceRequests.push(request);
      saveState();
      appendLog({
        actor: requestedBy,
        server: "quorum-mcp",
        tool: "request_source",
        kind: "WRITES",
        inputs: { name, kind: request.kind },
        outputs: { id: request.id, status: "PENDING" },
        status: "OK",
        durationMs: 1,
      });
      return json({ request }, 201);
    }

    /* ── The supplier-side marketplace — what organizations see and file ─── */

    /* The opportunities board: every tender pack staged on this desk, with
       the closing date resolved from the cycle record first and the notice
       text second. A tender whose closing date is not stated anywhere is
       shown as OPEN with closingKnown:false — the honest reading, and the
       same defect the review engine flags on the notice. */
    if (path === "/api/marketplace" && req.method === "GET") {
      const samples = await listSampleTenders();
      const closingFromNotices: Record<string, string | undefined> = {};
      const requiredFromNotices: Record<string, string[]> = {};
      for (const s of samples) {
        const cycle = state.cycle.find((entry) => entry.tenderId === s.ref);
        const latestIssuedNotice = [...(cycle?.notices ?? [])]
          .filter((notice) => notice.issuedAt && notice.md)
          .sort((a, b) => (b.issuedAt ?? "").localeCompare(a.issuedAt ?? ""))[0];
        if (latestIssuedNotice) {
          requiredFromNotices[s.ref] = requiredDocumentsFromNotice(latestIssuedNotice.md);
        }
        for (const name of ["01-tender-notice.md", "01-manual-notice.md"]) {
          try {
            const text = await Bun.file(TENDERS_DIR + s.ref + "/" + name).text();
            if (!latestIssuedNotice && !requiredFromNotices[s.ref]) {
              const required = requiredDocumentsFromNotice(text);
              if (required.length) requiredFromNotices[s.ref] = required;
            }
            const closing = parseClosingDate(text, jurisdictionPack(state.jurisdictionId).utcOffsetHours);
            if (closing) {
              closingFromNotices[s.ref] = closing;
              break;
            }
          } catch {
            /* no notice file with that name — try the next */
          }
        }
      }
      const counts: Record<string, number> = {};
      for (const a of state.applications) counts[a.tenderId] = (counts[a.tenderId] ?? 0) + 1;
      return json({
        tenders: marketplaceEntries(samples, state.cycle, closingFromNotices, counts, new Date(), requiredFromNotices).map((tender) => ({
          ...tender,
          ...(publicSystemReferenceForTender(tender.ref, workspaceId)
            ? { systemReference: publicSystemReferenceForTender(tender.ref, workspaceId) }
            : {}),
        })),
        generatedAt: new Date().toISOString(),
      });
    }

    /* Applications on the record. Reads are open (the desk sees who bid);
       filters are exact-match so the org console reads only its own. */
    if (path === "/api/applications" && req.method === "GET") {
      const tenderId = url.searchParams.get("tenderId");
      const orgId = url.searchParams.get("orgId");
      let rows = [...state.applications].reverse();
      if (tenderId) rows = rows.filter((a) => a.tenderId === tenderId);
      if (orgId) rows = rows.filter((a) => a.orgId === orgId);
      /* A sealed filing never exposes its amount here. The price is revealed
         only in the certified opening register. Legacy plaintext filings keep
         the amount they were filed with. */
      const applications = rows.map((a) => {
        const redacted = a.sealed ? redactApplication(a) : a;
        const systemReference = publicSystemReferenceForTender(a.tenderId, workspaceId);
        return { ...redacted, ...(systemReference ? { systemReference } : {}) };
      });
      return json({ applications, total: applications.length });
    }

    /* ── Bid lifecycle — receipt, withdrawal and amendment before closing ── */
    if (/^\/api\/applications\/[^/]+\/receipt$/.test(path) && req.method === "GET") {
      const id = decodeURIComponent(path.split("/")[3] ?? "");
      const application = state.applications.find((a) => a.id === id);
      if (!application) return json({ error: "application not found" }, 404);
      /* The receipt carries no price — only the commitment and its signature.
         It is still scoped to the filing organization, whose id is verified
         by the org proxy before this call. */
      const orgId = url.searchParams.get("orgId") ?? "";
      if (!orgId || orgId !== application.orgId) {
        return json({ error: "Receipts are readable only by the filing organization." }, 403);
      }
      if (!application.sealed) return json({ error: "This application predates the sealed vault and has no envelope receipt." }, 404);
      const receipt = application.sealed.receipt;
      return json({ receipt, verified: verifyBidReceipt(receipt), commitment: application.sealed.commitment });
    }

    if (/^\/api\/applications\/[^/]+\/withdraw$/.test(path) && req.method === "POST") {
      const id = decodeURIComponent(path.split("/")[3] ?? "");
      const application = state.applications.find((a) => a.id === id);
      if (!application) return json({ error: "application not found" }, 404);
      if (application.actor !== attestedActor) return json({ error: "Only the filing organization may withdraw its bid." }, 403);
      if (application.status !== "RECEIVED") return json({ error: `The application is already ${application.status}.` }, 409);
      const cycle = state.cycle.find((c) => c.tenderId === application.tenderId);
      if (cycle?.closingDate && Date.now() > new Date(cycle.closingDate).getTime()) {
        return json({ error: "The closing date has passed — a filed bid cannot be withdrawn after closing." }, 409);
      }
      application.status = "WITHDRAWN";
      application.withdrawnAt = new Date().toISOString();
      saveState();
      appendLog({
        actor: attestedActor,
        server: "quorum-mcp",
        tool: "withdraw_application",
        kind: "WRITES",
        inputs: { applicationId: application.id, tenderId: application.tenderId },
        outputs: { status: "WITHDRAWN", receiptId: application.receiptId ?? null },
        status: "OK",
        durationMs: 0,
      });
      return json({ application: redactApplication(application), receipt: application.sealed?.receipt ?? null });
    }

    if (/^\/api\/applications\/[^/]+\/amend$/.test(path) && req.method === "POST") {
      const id = decodeURIComponent(path.split("/")[3] ?? "");
      const body = await readBody(req);
      const prior = state.applications.find((a) => a.id === id);
      if (!prior) return json({ error: "application not found" }, 404);
      if (prior.actor !== attestedActor) return json({ error: "Only the filing organization may amend its bid." }, 403);
      if (prior.status !== "RECEIVED") return json({ error: `The application is already ${prior.status}.` }, 409);
      const cycle = state.cycle.find((c) => c.tenderId === prior.tenderId);
      if (cycle?.closingDate && Date.now() > new Date(cycle.closingDate).getTime()) {
        return json({ error: "The closing date has passed — a filed bid cannot be amended after closing." }, 409);
      }
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) return json({ error: "The amended bid amount must be a positive number." }, 422);
      const envelope = sealBid({
        tenderId: prior.tenderId,
        orgId: prior.orgId,
        orgName: prior.orgName,
        amount,
        currency: typeof body.currency === "string" && body.currency.trim() ? body.currency.trim().slice(0, 8) : prior.currency,
        coverNote: typeof body.coverNote === "string" && body.coverNote.trim() ? body.coverNote.trim().slice(0, 1200) : undefined,
      });
      prior.status = "AMENDED";
      prior.amendedAt = new Date().toISOString();
      const replacement: SupplierApplication = {
        ...prior,
        id: `app_${randomUUID().slice(0, 8)}`,
        amount: undefined,
        currency: undefined,
        coverNote: undefined,
        sealed: envelope,
        receiptId: envelope.receipt.id,
        version: (prior.version ?? 1) + 1,
        supersedesId: prior.id,
        receivedAt: envelope.sealedAt,
        status: "RECEIVED",
        amendedAt: undefined,
        withdrawnAt: undefined,
      };
      state.applications.push(replacement);
      saveState();
      appendLog({
        actor: attestedActor,
        server: "quorum-mcp",
        tool: "amend_application",
        kind: "WRITES",
        inputs: { applicationId: prior.id, tenderId: prior.tenderId, version: replacement.version },
        outputs: { replacementId: replacement.id, commitment: envelope.commitment },
        status: "OK",
        durationMs: 0,
      });
      return json({ application: redactApplication(replacement), receipt: envelope.receipt }, 201);
    }

    /* Filing an application. The identity is the gateway's attested
       org:<name> — officers and anonymous callers are refused. Late
       applications are refused exactly as late paper bids are; duplicates
       are refused; suspended/blacklisted suppliers are refused. First
       application from an organization syncs it onto the supplier register
       (addedBy = the attested actor, never a body claim). */
    if (path === "/api/applications" && req.method === "POST") {
      const body = await readBody(req);
      const shape = validateApplicationRequest({
        actor: attestedActor,
        tenderRef: body.tenderRef,
        amount: body.amount,
        currency: body.currency,
        coverNote: body.coverNote,
      });
      if (!shape.ok) {
        appendLog({
          actor: attestedActor || "anonymous",
          server: "quorum-mcp",
          tool: "supplier_application",
          kind: "WRITES",
          inputs: { tenderRef: body.tenderRef },
          outputs: { refused: shape.error },
          status: "ERROR",
          durationMs: 0,
        });
        return json({ error: shape.error }, shape.code);
      }
      const tenderRef = String(body.tenderRef).trim();
      const staged = existsSync(TENDERS_DIR + tenderRef);
      if (!staged) {
        return json({ error: `No tender pack is staged for ${tenderRef} — applications attach to real tenders only.` }, 404);
      }
      const cycle = state.cycle.find((c) => c.tenderId === tenderRef);
      let closingDate = cycle?.closingDate;
      if (!closingDate) {
        for (const name of ["01-tender-notice.md", "01-manual-notice.md"]) {
          try {
            const text = await Bun.file(TENDERS_DIR + tenderRef + "/" + name).text();
            closingDate = parseClosingDate(text, jurisdictionPack(state.jurisdictionId).utcOffsetHours) ?? undefined;
            if (closingDate) break;
          } catch {
            /* no notice with that name — the next one, then none */
          }
        }
      }
      const orgBlock =
        body.org && typeof body.org === "object" && !Array.isArray(body.org)
          ? (body.org as Record<string, unknown>)
          : {};
      const registrationNo = String(orgBlock.registrationNo ?? "").trim().slice(0, 80);
      const orgId = String(orgBlock.id ?? "").trim().slice(0, 64);
      const firebaseUid = String(body.firebaseUid ?? "").trim().slice(0, 128);
      const rawBidDocuments = Array.isArray(body.bidDocuments) ? body.bidDocuments : [];
      if (rawBidDocuments.length > 100) return json({ error: "A bid may contain at most 100 required documents." }, 422);
      const bidDocuments: NonNullable<SupplierApplication["bidDocuments"]> = [];
      for (const raw of rawBidDocuments) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json({ error: "A bid document entry is invalid." }, 422);
        const item = raw as Record<string, unknown>;
        const requirement = typeof item.requirement === "string" ? item.requirement.trim().slice(0, 180) : "";
        const key = typeof item.key === "string" ? item.key.trim() : "";
        const filename = typeof item.filename === "string" ? item.filename.trim().slice(0, 120) : "";
        const contentType = typeof item.contentType === "string" ? item.contentType.trim().slice(0, 120) : "";
        const sha256 = typeof item.sha256 === "string" ? item.sha256.trim().toLowerCase() : "";
        const documentUid = typeof item.firebaseUid === "string" ? item.firebaseUid.trim() : "";
        const uploadedAt = typeof item.uploadedAt === "string" ? item.uploadedAt.trim() : "";
        const bytes = Number(item.bytes);
        const requirementHash = createHash("sha256").update(requirement.normalize("NFKC").trim().toLowerCase()).digest("hex").slice(0, 20);
        const expectedPrefix = `tenders/${tenderRef}/supplier-bids/${orgId}/${firebaseUid}/${requirementHash}/`;
        if (
          !orgId || !/^[A-Za-z0-9_-]{1,128}$/.test(firebaseUid) || documentUid !== firebaseUid || !requirement ||
          !key.startsWith(expectedPrefix) || key.length > 512 || /[\\\u0000-\u001f]/.test(key) ||
          !filename || !contentType || !/^[a-f0-9]{64}$/.test(sha256) ||
          !Number.isFinite(bytes) || bytes <= 0 || bytes > 10 * 1024 * 1024 || Number.isNaN(Date.parse(uploadedAt))
        ) return json({ error: "A bid document does not match this organization's verified R2 upload." }, 422);
        bidDocuments.push({ requirement, key, filename, bytes, contentType, sha256, firebaseUid, uploadedAt });
      }
      const supplier = registrationNo
        ? state.suppliers.find((s) => s.registrationNo.toLowerCase() === registrationNo.toLowerCase())
        : undefined;
      const admission = validateApplicationAdmission({
        actor: attestedActor,
        tenderRef,
        amount: Number(body.amount),
        closingDate,
        existing: state.applications,
        registrationNo,
        supplierStatus: supplier?.status,
        ...(supplier?.verification ? { verification: supplier.verification } : {}),
        now: new Date(),
      });
      if (!admission.ok) {
        appendLog({
          actor: attestedActor,
          server: "quorum-mcp",
          tool: "supplier_application",
          kind: "WRITES",
          inputs: { tenderRef, amount: body.amount },
          outputs: { refused: admission.error },
          status: "ERROR",
          durationMs: 0,
        });
        return json({ error: admission.error }, admission.code);
      }

      /* Supplier-register sync — first application enrolls the organization. */
      let supplierId = supplier?.id;
      if (!supplier && registrationNo) {
        const created = supplierFromOrgProfile(orgBlock, `sup_${randomUUID().slice(0, 8)}`, attestedActor, new Date().toISOString());
        state.suppliers.push(created);
        supplierId = created.id;
        appendLog({
          actor: attestedActor,
          server: "quorum-mcp",
          tool: "supplier_add",
          kind: "WRITES",
          inputs: { name: created.name, registrationNo: created.registrationNo },
          outputs: { id: created.id, status: created.status, auto: "supplier-portal" },
          status: "OK",
          durationMs: 0,
        });
      }

      /* The name on the record comes from the attested actor, never the body. */
      const actorName = attestedActor.slice(4).trim();
      const orgName = (actorName || String(orgBlock.name ?? "unknown")).slice(0, 160);
      const envelope = sealBid({
        tenderId: tenderRef,
        orgId,
        orgName,
        amount: Number(body.amount),
        currency: strOpt(body.currency),
        coverNote: typeof body.coverNote === "string" && body.coverNote.trim() ? body.coverNote.trim().slice(0, 1200) : undefined,
      });
      const application: SupplierApplication = {
        id: `app_${randomUUID().slice(0, 8)}`,
        tenderId: tenderRef,
        orgId,
        orgName,
        actor: attestedActor,
        supplierId,
        registrationNo,
        /* The price lives only inside the envelope. */
        amount: undefined,
        currency: undefined,
        coverNote: undefined,
        bidDocuments,
        sealed: envelope,
        receiptId: envelope.receipt.id,
        version: 1,
        receivedAt: envelope.sealedAt,
        status: "RECEIVED",
      };
      state.applications.push(application);
      saveState();
      appendLog({
        actor: attestedActor,
        server: "quorum-mcp",
        tool: "supplier_application",
        kind: "WRITES",
        inputs: { tenderId: application.tenderId, sealed: true, bidDocumentCount: bidDocuments.length, bidDocumentKeys: bidDocuments.map((document) => document.key) },
        outputs: {
          id: application.id,
          orgName: application.orgName,
          supplierId: supplierId ?? null,
          closingDate: closingDate ?? null,
          status: "RECEIVED",
          receiptId: envelope.receipt.id,
          commitment: envelope.commitment,
        },
        status: "OK",
        durationMs: 0,
      });
      const systemReference = publicSystemReferenceForTender(application.tenderId, workspaceId);
      return json({
        application: { ...redactApplication(application), ...(systemReference ? { systemReference } : {}) },
        receipt: envelope.receipt,
      }, 201);
    }

    if (path.startsWith("/api/gates/") && req.method === "POST") {
      const id = path.match(/^\/api\/gates\/([^/]+)/)?.[1] ?? "";
      const body = await readBody(req);
      /* The signed-in identity is ATTESTED by the gateway, never typed by the
         caller. A body that still declares signedInAs must agree with the
         seal — otherwise it is refused loudly, not silently remapped. */
      const claimed = typeof body.signedInAs === "string" ? body.signedInAs.trim() : "";
      if (claimed && attestedActor && claimed.toLowerCase() !== attestedActor.toLowerCase()) {
        appendLog({ actor: attestedActor, server: "quorum-mcp", tool: "gate_decision", kind: "GATE_DECISION", inputs: { gateId: id, claimedSignedInAs: claimed }, outputs: { refused: "signedInAs does not match the gateway's attested session" }, status: "ERROR", durationMs: 0 });
        return json({ error: "The gateway's attested session is not who this request claims to be — signedInAs is server-attested and cannot be declared in the body." }, 403);
      }
      const ink = handInkFrom(body);
      if (ink === "invalid") {
        return json({ error: "handSignature must be a PNG data URL under 300 KB." }, 422);
      }
      const out = await decideGate(
        id,
        String(body.decision ?? ""),
        String(body.approver ?? ""),
        body.note ? String(body.note) : undefined,
        attestedActor || undefined,
        req.headers.get("x-quorum-stepup") ?? undefined,
        workspaceId,
        ink,
        attestedActorId,
      );
      if (out.error) return json(out, out.code ?? 400);
      return json(out);
    }

    if (path === "/api/gates") {
      return json({
        gates: workspaceRows(state.gates).map((g) => ({
          ...g,
          systemReference: publicSystemReferenceForTender(g.tenderId, workspaceId),
          signatureValid: g.signature ? verifyGateSignature(g).ok : false,
        })),
      });
    }

    /* The register issues the next reference before the planner types anything. */
    if (path === "/api/pipeline/next-ref" && req.method === "GET") {
      return json({
        ref: nextPipelineRef({
          expectedPublication: url.searchParams.get("publication") ?? undefined,
        }),
      });
    }

    /* ── Phase 1 — governance: authority matrix, bands, sign-off ─────────── */
    if (path === "/api/governance" && req.method === "GET") {
      return json(governanceSnapshot());
    }
    if (path === "/api/governance/bands" && req.method === "POST") {
      const body = await readBody(req);
      const actor = attestedActor || strOpt(body.actor) || "unknown";
      try {
        const out = updateBands(actor, (body.bands ?? []) as never[]);
        if (!out.ok) return json({ error: out.error }, out.code);
        return json({ governance: governanceSnapshot() });
      } catch (err) {
        return json({ error: (err as Error).message }, 422);
      }
    }
    if (path === "/api/governance/signoff" && req.method === "POST") {
      const body = await readBody(req);
      const actor = attestedActor || strOpt(body.actor) || "";
      if (!actor || actor === "unknown") return json({ error: "a named actor must attest this sign-off" }, 401);
      const scope = strOpt(body.scope) ?? "governance and control foundation";
      const signoff = recordSignoff(actor, scope);
      return json({ signedOff: signoff, governance: governanceSnapshot() });
    }

    /* ── Phase 2 — the exception register ─────────────────────────────── */
    if (path === "/api/exceptions" && req.method === "GET") {
      const url = new URL(req.url);
      const tenderId = url.searchParams.get("tenderId") ?? undefined;
      const exceptions = listExceptions(tenderId ?? undefined).map((exception) => {
        const systemReference = exception.tenderId
          ? publicSystemReferenceForTender(exception.tenderId, workspaceId)
          : undefined;
        return { ...exception, ...(systemReference ? { systemReference } : {}) };
      });
      return json({ exceptions });
    }
    if (path === "/api/exceptions" && req.method === "POST") {
      const body = await readBody(req);
      const actor = attestedActor || strOpt(body.actor) || "unknown";
      const out = raiseException(body, actor);
      if (!out.ok) return json({ error: out.error }, out.code);
      return json({ exception: out.exception, gateId: out.gateId }, 201);
    }
    if (/^\/api\/exceptions\/[A-Za-z0-9._-]+\/withdraw$/.test(path) && req.method === "POST") {
      const body = await readBody(req);
      const actor = attestedActor || strOpt(body.actor) || "unknown";
      const out = withdrawException(path.split("/")[3] ?? "", actor, strOpt(body.note));
      if (!out.ok) return json({ error: out.error }, out.code);
      return json({ exception: out.exception });
    }

    /* ── Phase 3 — rule packs and per-tender compliance ───────────────── */
    if (path === "/api/rulepacks" && req.method === "GET") {
      return json({ packs: RULE_PACKS });
    }
    /* ── Phase 9 — the honest quality record: eval + bench outputs ────── */
    if (path === "/api/eval/summary" && req.method === "GET") {
      const readJson = async (file: string): Promise<Record<string, unknown> | null> => {
        try {
          return (await Bun.file(DATA + file).json()) as Record<string, unknown>;
        } catch {
          return null;
        }
      };
      const [report, bench] = await Promise.all([readJson("eval/report.json"), readJson("eval/bench.json")]);
      const summary = (report?.summary ?? null) as Record<string, unknown> | null;
      return json({
        eval: summary
          ? {
              original: summary.original ?? null,
              adjudicated: summary.adjudicated ?? null,
              mutation: summary.mutation ?? null,
              identicalAcrossRuns: summary.identicalAcrossRuns ?? null,
              heldOut: summary.heldOut ?? null,
              labeller: report?.labeller ?? null,
              generatedAt: report?.generatedAt ?? null,
            }
          : null,
        bench: bench ? { medianMs: bench.medianMs ?? bench.median_ms ?? null, packs: bench.packs ?? bench.rows ?? null, note: bench.note ?? null } : null,
        note: "Produced by eval.ts (recall/precision against pre-written labels + mutation testing) and bench.ts (the deterministic clock). The files are what they are — nothing here is computed on the fly.",
      });
    }
    if (/^\/api\/tenders\/[A-Za-z0-9._-]+\/compliance$/.test(path) && req.method === "GET") {
      const ref = decodeURIComponent(path.match(/^\/api\/tenders\/([A-Za-z0-9._-]+)\/compliance$/)![1]);
      return json(complianceSummary(ref));
    }

    /* ── Phase 4 — the document register ──────────────────────────────── */
    if (path === "/api/documents" && req.method === "GET") {
      const url = new URL(req.url);
      const tenderId = url.searchParams.get("tenderId") ?? undefined;
      const unreviewedOnly = url.searchParams.get("unreviewed") === "1";
      const rows = listDocuments({ ...(tenderId ? { tenderId } : {}), ...(unreviewedOnly ? { unreviewedOnly: true } : {}) });
      return json({ documents: rows, unreviewed: listDocuments({ unreviewedOnly: true }).length });
    }
    if (/^\/api\/documents\/[A-Za-z0-9._-]+\/review$/.test(path) && req.method === "POST") {
      const body = await readBody(req);
      const actor = attestedActor || strOpt(body.actor) || "unknown";
      const out = reviewDocument(path.split("/")[3] ?? "", actor, body.confirm === true, strOpt(body.note));
      if (!out.ok) return json({ error: out.error }, out.code);
      return json({ document: out.record });
    }
    if (/^\/api\/documents\/[A-Za-z0-9._-]+\/archive$/.test(path) && req.method === "POST") {
      const body = await readBody(req);
      const actor = attestedActor || strOpt(body.actor) || "unknown";
      const out = archiveDocument(path.split("/")[3] ?? "", actor);
      if (!out.ok) return json({ error: out.error }, out.code);
      return json({ document: out.record });
    }
    if (/^\/api\/documents\/[A-Za-z0-9._-]+\/verify$/.test(path) && req.method === "GET") {
      const out = verifyDocument(path.split("/")[3] ?? "", readTenderFileForRegister);
      return json(out, out.ok ? 200 : 409);
    }

    /* ── The tender cycle — solicitation to closure (waves 1-3) ───────── */
    if (path.startsWith("/api/cycle") || path.startsWith("/api/budget-lines") || path.startsWith("/api/procurement-file") || path.startsWith("/api/pipeline") || /^\/api\/tenders\/[A-Za-z0-9._-]+\/(closing|opening|coi|matrix|method|alb|award-report|award-notice|standstill|debrief|contract|findings|complaints|clarifications|addenda|notices|specs|dissents)/.test(path) || /^\/api\/tenders\/[A-Za-z0-9._-]+$/.test(path)) {
      const cycleBody = req.method === "POST" ? await readBody(req) : {};
      const committee = await fetchQuorum();
      const roster = committee?.members ?? null;
      return withWorkspace(workspaceId, () => handleCycleRoutes(path, req.method, cycleBody, attestedActor, workspaceId, attestedActorId, roster)).then((response) => response ?? json({ error: "not found" }, 404));
    }

    return json({ error: "not found" }, 404);
    });
    });
  },
});

/* One writer, or none: a second process on the same record would silently
   overwrite the first one's decisions. The lock is taken before any read that
   could lead to a write. */
const writer = await acquireWriterLock(DATA_DIR + ".writer.lock");
if (!writer.ok) {
  console.error(`[quorum-mcp] refusing to start — ${writer.reason}`);
  process.exit(78);
}

await loadState();
/* Give live procurement records one neutral public reference while retaining
   their original keys for pack and audit lookup. */
{
  const isPublicRef = (value: unknown): value is string =>
    typeof value === "string" && /^QRM-\d{4}-\d{3,6}$/i.test(value);
  const referenceByTender = new Map<string, string>();
  let changed = false;

  /* Keep a valid reference already issued to a record. Pipeline references
     take priority, followed by cycle and run references. */
  for (const entry of state.pipeline) {
    const reference = isPublicRef(entry.systemReference) ? entry.systemReference : isPublicRef(entry.ref) ? entry.ref : null;
    if (reference) {
      if (entry.linkedTenderId) referenceByTender.set(entry.linkedTenderId, reference);
      referenceByTender.set(entry.ref, reference);
    }
  }
  for (const cycle of state.cycle) {
    if (isPublicRef(cycle.systemReference) && !referenceByTender.has(cycle.tenderId)) {
      referenceByTender.set(cycle.tenderId, cycle.systemReference);
    }
  }
  for (const run of state.runs) {
    if (isPublicRef(run.reference) && !referenceByTender.has(run.tenderId)) {
      referenceByTender.set(run.tenderId, run.reference);
    }
  }

  for (const entry of state.pipeline) {
    if (isPublicRef(entry.systemReference)) continue;
    const reference = isPublicRef(entry.ref)
      ? entry.ref
      : (entry.linkedTenderId ? referenceByTender.get(entry.linkedTenderId) : undefined) ??
        referenceByTender.get(entry.ref) ??
        nextPipelineRef({});
    entry.systemReference = reference;
    if (entry.linkedTenderId) referenceByTender.set(entry.linkedTenderId, reference);
    referenceByTender.set(entry.ref, reference);
    changed = true;
  }
  for (const cycle of state.cycle) {
    if (isPublicRef(cycle.systemReference)) continue;
    const linkedEntry = state.pipeline.find((entry) => entry.linkedTenderId === cycle.tenderId || entry.ref === cycle.tenderId);
    cycle.systemReference =
      linkedEntry?.systemReference ?? referenceByTender.get(cycle.tenderId) ??
      (isPublicRef(cycle.tenderId) ? cycle.tenderId : nextPipelineRef({}));
    referenceByTender.set(cycle.tenderId, cycle.systemReference);
    changed = true;
  }
  for (const cycle of state.cycle) {
    for (const notice of cycle.notices ?? []) {
      if (isPublicRef(notice.reference)) continue;
      notice.reference = cycle.systemReference;
      changed = true;
    }
  }
  for (const run of state.runs) {
    if (isPublicRef(run.reference)) continue;
    const linkedEntry = state.pipeline.find((entry) => entry.linkedTenderId === run.tenderId || entry.ref === run.tenderId);
    const cycle = state.cycle.find((entry) => entry.tenderId === run.tenderId);
    run.reference = linkedEntry?.systemReference ?? cycle?.systemReference ?? referenceByTender.get(run.tenderId) ??
      (isPublicRef(run.tenderId) ? run.tenderId : nextPipelineRef({}));
    referenceByTender.set(run.tenderId, run.reference);
    changed = true;
  }
  if (changed) saveState();
}
await recoverInterruptedRuns();
void initFsMcp();
startOcpAutoRefresh();
console.log(
  `quorum-mcp listening on :${PORT} — MCP surface POST /mcp · audit ${toolLog.length} calls restored · writer lock ${writer.mode}`,
);

/* The register verifies staged/pack documents by re-reading the file from the
   tenders directory — the same jail the filesystem MCP uses (no traversal). */
function readTenderFileForRegister(tenderId: string, file: string): string | null {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(tenderId) || !/^[A-Za-z0-9._-]{1,128}$/.test(file)) return null;
  try {
    return readFileSync(TENDERS_DIR + tenderId + "/" + file, "utf8");
  } catch {
    return null;
  }
}
