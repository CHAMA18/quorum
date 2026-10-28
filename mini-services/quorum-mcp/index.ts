/**
 * quorum-mcp — HTTP + MCP server (port 3031).
 *
 *  POST /mcp                      → JSON-RPC 2.0 (initialize · tools/list · tools/call · ping)
 *  GET  /api/health               → liveness + fs-mcp status + counts
 *  GET  /api/tools                → the five tools, with their kind (READ / WRITES / IRREVERSIBLE)
 *  GET  /api/architecture         → the stack, for the console UI
 *  GET  /api/log?limit=           → the audit log (every tool call, newest first)
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

import { randomUUID } from "node:crypto";
import {
  appendLog,
  attestVerify,
  auditHealth,
  loadState,
  saveState,
  shaOf,
  state,
  toolLog,
  verifyToolLogFile,
  type Gate,
  type Guards,
  type Run,
  type Supplier,
  type SupplierApplication,
} from "./store";
import { handleReportRequest } from "./report";
import { recordTenderDownload } from "./tender-downloads";
import { recordTenderDeletion } from "./tender-deletions";
import { listSampleTenders, readSampleDocument } from "./samples";
import { ZAMBIA_METHODS } from "./methods";
import { ZPPA_ROLL, ZPPA_SOURCE } from "./zppa";
import { OCP_AFRICA, OCP_AFRICA_SOURCE } from "./ocp-africa";
import { rollupAfrica } from "./ocp-africa-roll";
import { connectMany, loadPortalLinks } from "./portal-links";
import { disabledPortalIds, loadPortalState, setPortalsEnabled } from "./portal-state";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { TENDERS_DIR } from "./engine";
import { modelAttributionForRun, modelStatus } from "./model";
import { parseClosingDate } from "./cycle";
import {
  marketplaceEntries,
  supplierFromOrgProfile,
  validateApplicationAdmission,
  validateApplicationRequest,
} from "./marketplace";
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
import { cycleToolCall, executeCycleGateAction, handleCycleRoutes, nextPipelineRef, preApprovalCheck } from "./cycle-routes";
import { consumeStepUp, verifyStepUp } from "./step-up";
import { signGate, verifyGateSignature } from "./receipts";
import { notifyWebSoon } from "./notify";
const PORT = 3031;

/* An optional string field — trims, caps, and collapses empty to undefined. */
function strOpt(v: unknown): string | undefined {
  const s = String(v ?? "").trim().slice(0, 200);
  return s.length > 0 ? s : undefined;
}

/* Log outputs are capped to a JSON string on disk; in-memory rows may still
   be objects. Read both shapes without trusting either. */
function logOutputObject(value: unknown): { model?: unknown; source?: unknown } {
  if (value && typeof value === "object") return value as { model?: unknown; source?: unknown };
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object") return parsed as { model?: unknown; source?: unknown };
  } catch {
    /* Long outputs are capped mid-JSON; attribution is written first so it can
       still be recovered from the surviving prefix. */
  }
  const model = /"model"\s*:\s*"([^"]+)"/.exec(value)?.[1];
  const source = /"source"\s*:\s*"([^"]+)"/.exec(value)?.[1];
  return model || source ? { model, source } : {};
}

/* The newest actual model answer, read from the append-only log. Health can
   therefore show what answered — not just what the environment claims. */
function latestModelCall() {
  for (const entry of [...toolLog].reverse()) {
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
    };
  }
  return null;
}

/* Engine refs → durable state */
bindEngine({
  runs: state.runs,
  gates: state.gates,
  save: saveState,
  raiseGate(g) {
    state.gates.unshift(g);
    saveState();
    notifyWebSoon({ type: "GATE_WAITING", gateId: g.id, tenderId: g.tenderId, tool: g.tool, requiredOffice: g.requiredOffice });
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

async function decideGate(id: string, decision: string, approver: string, note?: string, signedInAs?: string, stepUpToken?: string) {
  const gate = state.gates.find((g) => g.id === id);
  if (!gate) return { error: "gate not found", code: 404 };
  if (gate.status !== "PENDING") return { error: `gate already ${gate.status}`, code: 409 };
  const name = approver?.trim();
  if (!name || name.length < 3) return { error: "A named human is required — provide the approving officer's full name.", code: 422 };
  if (decision !== "APPROVE" && decision !== "REJECT") {
    return { error: "Decision must be APPROVE or REJECT.", code: 422 };
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
  if (decision !== "REJECT") {
    const roster = quorum.members;
    const verdict = approverAllowed(name, signedInAs?.trim(), roster);
    if (!verdict.ok) {
      appendLog({ actor: "quorum-mcp", server: "quorum-mcp", tool: "gate_decision", kind: "GATE_DECISION", runId: gate.runId, inputs: { gateId: id, decision, approver: name }, outputs: { refused: verdict.reason }, status: "ERROR", durationMs: 0 });
      return { error: verdict.reason, code: 403 };
    }
    /* Office-aware gates and cycle preconditions — checked before anything changes. */
    const pre = preApprovalCheck(gate, name, roster, signedInAs);
    if (pre) {
      appendLog({ actor: "quorum-mcp", server: "quorum-mcp", tool: "gate_decision", kind: "GATE_DECISION", runId: gate.runId, inputs: { gateId: id, decision, approver: name }, outputs: { refused: pre }, status: "ERROR", durationMs: 0 });
      return { error: pre, code: 403 };
    }
  }

  /* A gate decision is a committee act. The roll must carry before any state
     changes, including a return. The count is recomputed from the member rows
     and the attested gavel, never trusted from the published `present` field. */
  const roll = quorumCheck(quorum, signedInAs?.trim());
  if (!roll.ok) {
    appendLog({ actor: "quorum-mcp", server: "quorum-mcp", tool: "gate_decision", kind: "GATE_DECISION", runId: gate.runId, inputs: { gateId: id, decision, approver: name }, outputs: { refused: roll.reason, quorum: roll }, status: "ERROR", durationMs: 0 });
    return { error: roll.reason, code: 409, quorum: roll };
  }

  /* Every precondition has passed. Burn the one-time token before the gate
     changes state; a replay from a second tab now loses the race. */
  if (!consumeStepUp(step.payload)) {
    appendLog({ actor: "quorum-mcp", server: "quorum-mcp", tool: "gate_decision", kind: "GATE_DECISION", runId: gate.runId, inputs: { gateId: id, decision, approver: name }, outputs: { refused: "step-up token already consumed" }, status: "ERROR", durationMs: 0 });
    return { error: "This step-up signature was already used. Re-authenticate for a fresh one.", code: 409 };
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

  if (decision === "REJECT") {
    gate.status = "REJECTED";
    gate.signature = signGate(gate);
    appendLog({
      actor: name,
      server: "quorum-mcp",
      tool: "gate_decision",
      kind: "GATE_DECISION",
      runId: gate.runId,
      inputs: { gateId: id, decision, note: gate.note },
      outputs: { status: "REJECTED — submission returned to the agent", stepUp: { method: step.payload.method, jti: step.payload.jti } },
      status: "OK",
      durationMs: 0,
    });
    const run = state.runs.find((r) => r.id === gate.runId);
    if (run) {
      run.status = "REJECTED";
      run.updatedAt = gate.decidedAt;
      run.progress.push(`✗ ${name} returned the submission — back to the agent`);
    }
    saveState();
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
  const run = state.runs.find((r) => r.id === gate.runId);
  if (run) {
    run.status = "FILED";
    run.updatedAt = gate.executedAt;
    run.progress.push(`✓ ${name} signed the gate — bundle filed · ${gate.receipt?.submissionId ?? "receipt pending"}`);
  }
  saveState();
  notifyWebSoon({ type: "GATE_DECIDED", gateId: gate.id, tenderId: gate.tenderId, tool: gate.tool, actor: name, outcome: "EXECUTED", note: gate.note });
  return { gate };
}

/* ── HTTP server ─────────────────────────────────────────────────────────── */

const json = (data: unknown, code = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status: code,
    headers: {
      "content-type": "application/json",
    },
  });

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

Bun.serve({
  port: PORT,
  /* Loopback only — the sidecar has no auth of its own; the Next gateway
     (session check + HMAC attestation) is the only public door. */
  hostname: "127.0.0.1",
  idleTimeout: 120,
  async fetch(req) {
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
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS" && path !== "/mcp") {
      const seal = attestVerify(req.method, path, req.headers);
      if (seal.ok) {
        attestedActor = seal.actor;
      } else {
        const sessionActor = await verifySessionActor(req.headers.get("cookie"));
        if (!sessionActor) {
          return json(
            {
              error: `${seal.reason} Sign in (a verified session is accepted) and retry.`,
            },
            401,
          );
        }
        attestedActor = sessionActor;
      }
    }

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
      return json({
        ok: true,
        service: "quorum-mcp",
        version: "1.0.0",
        uptimeSec: Math.round(performance.now() / 1000),
        fsMcp: { status: fsMcp.status, tools: fsMcp.tools },
        graphs: ["review_graph (8 nodes)", "filing_graph (2 nodes)"],
        /* Configured endpoint + the newest real model answer in the log. */
        model: { ...modelStatus(), lastCall: latestModelCall() },
        counts: { toolCalls: toolLog.length, runs: state.runs.length, gates: state.gates.length, pendingGates: state.gates.filter((g) => g.status === "PENDING").length },
        auditSpine: {
          logWriteFailing: auditHealth.logWriteFailing,
          stateSaveFailing: auditHealth.stateSaveFailing,
          stateCorrupt: auditHealth.stateCorrupt,
          stateCorruptFile: auditHealth.stateCorruptFile,
          logChainEntries: toolLog.length,
        },
      });
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
              ? `OpenAI-compatible at ${model.endpoint}. Every draft records the exact model string the endpoint returns; the key is never exposed.`
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

    if (path === "/api/log/verify" && req.method === "GET") {
      return json(await verifyToolLogFile());
    }

    /* Receipt verification is deliberately offline-friendly: the signature
       carries its public key, so a downloaded receipt can be checked without
       this service. This endpoint is the same check for the UI. */
    if (/^\/api\/(?:gates|receipts)\/[^/]+\/verify$/.test(path) && req.method === "GET") {
      const id = decodeURIComponent(path.split("/")[3] ?? "");
      const gate = state.gates.find((g) => g.id === id);
      if (!gate) return json({ error: "gate not found" }, 404);
      const verdict = verifyGateSignature(gate);
      return json({
        gateId: gate.id,
        tenderId: gate.tenderId,
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
      const runs = [...state.runs].reverse().map((r) => {
        const gate = r.gateId ? state.gates.find((g) => g.id === r.gateId) : undefined;
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

    if (path === "/api/runs" && req.method === "POST") {
      const body = await readBody(req);
      const tenderId = String(body.tenderId ?? "").trim();
      if (!tenderId) return json({ error: "tenderId required" }, 422);
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
        tenderId,
        status: "RUNNING",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        progress: [`▸ review_graph invoked — langgraph.js · tender ${tenderId}`],
        requirements: [],
        findings: [],
        drafts: [],
        ...(detail ? { detail } : {}),
      };
      state.runs.unshift(run);
      saveState();
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
      void import("./engine").then((m) => m.runReview(run));
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

    /* ── The ZPPA roll — the published e-GP record, read in at intake ───── */
    if (path === "/api/zppa-roll") {
      return json({ source: ZPPA_SOURCE, roll: ZPPA_ROLL });
    }

    /* ── The OCP Data Registry, read for Africa — as published, nothing added */
    if (path === "/api/ocp-africa") {
      return json({
        source: OCP_AFRICA_SOURCE,
        countries: rollupAfrica(OCP_AFRICA),
        datasets: OCP_AFRICA,
        links: loadPortalLinks(),
        state: loadPortalState(),
      });
    }

    /* ── Portal enable/disable — the committee's switch, persisted and logged */
    if (path === "/api/portal-state" && req.method === "POST") {
      const body = await readBody(req);
      const rawIds = body.publicationIds;
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        return json({ error: "publicationIds must be a non-empty array of the registry's publication ids" }, 422);
      }
      const ids = [...new Set(rawIds.map((x: unknown) => Number(x)).filter((n: number) => Number.isInteger(n)))];
      const known = new Set(OCP_AFRICA.map((d) => d.publicationId));
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
        ids = disabled.size > 0 ? OCP_AFRICA.filter((d) => !disabled.has(d.publicationId)).map((d) => d.publicationId) : null;
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

    /* ── The tunable guards — written here by name, obeyed by the engine ─── */
    if (path === "/api/guards" && req.method === "GET") {
      return json({ guards: state.guards });
    }

    if (path === "/api/guards" && (req.method === "PATCH" || req.method === "PUT")) {
      const body = await readBody(req);
      if (body.priceVariancePct === undefined && body.checklist === undefined && body.registryCrossCheck === undefined) {
        return json({ error: "no guard fields supplied" }, 422);
      }
      const actor = (attestedActor || strOpt(body.actor) || "unknown").slice(0, 80);
      const before = {
        priceVariancePct: state.guards.priceVariancePct,
        checklist: state.guards.checklist,
        registryCrossCheck: state.guards.registryCrossCheck,
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
      /* A no-op is not a change — nothing moves, nothing is logged. */
      const touched =
        before.priceVariancePct !== next.priceVariancePct ||
        before.checklist !== next.checklist ||
        before.registryCrossCheck !== next.registryCrossCheck;
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
      for (const s of samples) {
        for (const name of ["01-tender-notice.md", "01-manual-notice.md"]) {
          try {
            const text = await Bun.file(TENDERS_DIR + s.ref + "/" + name).text();
            const closing = parseClosingDate(text);
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
        tenders: marketplaceEntries(samples, state.cycle, closingFromNotices, counts, new Date()),
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
      return json({ applications: rows, total: rows.length });
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
            closingDate = parseClosingDate(text) ?? undefined;
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
      const application: SupplierApplication = {
        id: `app_${randomUUID().slice(0, 8)}`,
        tenderId: tenderRef,
        orgId: String(orgBlock.id ?? "").trim().slice(0, 64),
        orgName: (actorName || String(orgBlock.name ?? "unknown")).slice(0, 160),
        actor: attestedActor,
        supplierId,
        registrationNo,
        amount: Number(body.amount),
        currency: strOpt(body.currency),
        coverNote: typeof body.coverNote === "string" && body.coverNote.trim() ? body.coverNote.trim().slice(0, 1200) : undefined,
        receivedAt: new Date().toISOString(),
        status: "RECEIVED",
      };
      state.applications.push(application);
      saveState();
      appendLog({
        actor: attestedActor,
        server: "quorum-mcp",
        tool: "supplier_application",
        kind: "WRITES",
        inputs: { tenderId: application.tenderId, amount: application.amount, currency: application.currency },
        outputs: { id: application.id, orgName: application.orgName, supplierId: supplierId ?? null, closingDate: closingDate ?? null, status: "RECEIVED" },
        status: "OK",
        durationMs: 0,
      });
      return json({ application }, 201);
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
      const out = await decideGate(
        id,
        String(body.decision ?? ""),
        String(body.approver ?? ""),
        body.note ? String(body.note) : undefined,
        attestedActor || undefined,
        req.headers.get("x-quorum-stepup") ?? undefined,
      );
      if (out.error) return json(out, out.code ?? 400);
      return json(out);
    }

    if (path === "/api/gates") {
      return json({
        gates: state.gates.map((g) => ({ ...g, signatureValid: g.signature ? verifyGateSignature(g).ok : false })),
      });
    }

    /* The register issues the next reference before the planner types anything. */
    if (path === "/api/pipeline/next-ref" && req.method === "GET") {
      return json({
        ref: nextPipelineRef({
          expectedPublication: url.searchParams.get("publication") ?? undefined,
          currency: url.searchParams.get("currency") ?? undefined,
        }),
      });
    }

    /* ── The tender cycle — solicitation to closure (waves 1-3) ───────── */
    if (path.startsWith("/api/cycle") || path.startsWith("/api/procurement-file") || path.startsWith("/api/pipeline") || /^\/api\/tenders\/[A-Za-z0-9._-]+\/(closing|opening|coi|matrix|alb|award-report|award-notice|standstill|debrief|contract|complaints|clarifications|addenda|notices|specs)/.test(path) || /^\/api\/tenders\/[A-Za-z0-9._-]+$/.test(path)) {
      const cycleBody = req.method === "POST" ? await readBody(req) : {};
      return (await handleCycleRoutes(path, req.method, cycleBody)) ?? json({ error: "not found" }, 404);
    }

    return json({ error: "not found" }, 404);
  },
});

await loadState();
void initFsMcp();
console.log(`quorum-mcp listening on :${PORT} — MCP surface POST /mcp · audit ${toolLog.length} calls restored`);
