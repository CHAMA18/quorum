import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { attestSignature } from "@/lib/sidecar-attest";
import {
  appealReference,
  countOrgSessionsForOrg,
  countSessionsForUser,
  findOrganizationById,
  getSetting,
  listCommitteeMembers,
  listInvites,
  listOrganizations,
  listOrgAppeals,
  listOversightEvents,
  listSupportRequests,
  listUsers,
} from "@/lib/db";
import type {
  AdminAnchor,
  AdminAuditEntry,
  AdminChainVerdict,
  AdminDecision,
  AdminGate,
  AdminHealth,
  AdminOverview,
  AdminRun,
  AdminTool,
} from "@/lib/admin-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Control Room's single read.
 *
 * One server-side snapshot instead of a dozen browser fetches: the web store
 * (people, organizations, appeals, committee) and the sidecar (runs, gates,
 * audit spine, health) are read here, trimmed, and returned together. Writes
 * deliberately do NOT live on this route — the console calls the same enforced
 * endpoints the workspace uses (/api/team, /api/oversight, the gateway), so an
 * admin panel can never become a second, softer permission system.
 *
 * Access is the oversight capability: OWNER, ADMIN and AUDITOR read the room;
 * only owners and admins receive the writable flags.
 */

const SIDECAR = (process.env.QUORUM_SIDECAR_URL?.trim() || "http://127.0.0.1:3031").replace(/\/+$/, "");
const TIMEOUT_MS = 4000;

async function readSidecar<T>(
  path: string,
  actor: { name: string; workspaceId: string },
): Promise<T | null> {
  const ts = Date.now();
  const pathname = path.split("?")[0];
  try {
    const res = await fetch(`${SIDECAR}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "x-quorum-actor": actor.name,
        "x-quorum-workspace": actor.workspaceId,
        "x-quorum-ts": String(ts),
        "x-quorum-attest": attestSignature("GET", pathname, actor.name, ts, actor.workspaceId),
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return "";
}

function text(value: unknown, cap = 900): string {
  try {
    const raw = typeof value === "string" ? value : JSON.stringify(value ?? "");
    return raw.length > cap ? `${raw.slice(0, cap)}…` : raw;
  } catch {
    return "";
  }
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function GET(req: NextRequest) {
  const actor = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!actor) {
    return NextResponse.json({ error: "Sign in to open the control room." }, { status: 401 });
  }
  if (!can(actor.role, "view_oversight")) {
    return NextResponse.json(
      { error: "Control room access is limited to owners, admins and auditors." },
      { status: 403 },
    );
  }

  const scope = { name: actor.name, workspaceId: actor.workspaceId };

  const [health, toolsBody, logBody, verify, anchorBody, runsBody, gatesBody, decisionsBody] =
    await Promise.all([
      readSidecar<AdminHealth>("/api/health", scope),
      readSidecar<{ tools?: AdminTool[] }>("/api/tools", scope),
      readSidecar<{
        entries?: Record<string, unknown>[];
        total?: number;
        allTotal?: number;
      }>("/api/log?limit=200", scope),
      readSidecar<AdminChainVerdict>("/api/log/verify", scope),
      readSidecar<{ anchor?: AdminAnchor; count?: number }>("/api/log/anchor", scope),
      readSidecar<{ runs?: Record<string, unknown>[] }>("/api/runs", scope),
      readSidecar<{ gates?: Record<string, unknown>[] }>("/api/gates", scope),
      readSidecar<{
        ledger?: { ok: boolean; brokenAt: number | null; checked: number; lines: number; head: string };
        decisions?: AdminDecision[];
      }>("/api/decisions", scope),
    ]);

  const runs: AdminRun[] = (runsBody?.runs ?? []).map((raw) => {
    const model = (raw.model ?? {}) as Record<string, unknown>;
    return {
      id: String(raw.id ?? ""),
      tenderId: String(raw.tenderId ?? ""),
      status: (raw.status as AdminRun["status"]) ?? "RUNNING",
      startedBy: typeof raw.startedBy === "string" ? raw.startedBy : null,
      startedAt: iso(raw.startedAt),
      updatedAt: iso(raw.updatedAt),
      requirements: Array.isArray(raw.requirements) ? raw.requirements.length : 0,
      findings: Array.isArray(raw.findings) ? raw.findings.length : 0,
      drafts: Array.isArray(raw.drafts) ? raw.drafts.length : 0,
      gateId: typeof raw.gateId === "string" ? raw.gateId : null,
      error: typeof raw.error === "string" ? raw.error : null,
      seal: typeof raw.seal === "string" ? raw.seal : null,
      sealedBy: typeof raw.sealedBy === "string" ? raw.sealedBy : null,
      decidedAt: typeof raw.decidedAt === "string" ? raw.decidedAt : null,
      model: {
        mode: model.mode as AdminRun["model"]["mode"],
        planSource: typeof model.planSource === "string" ? model.planSource : null,
        planModel: typeof model.planModel === "string" ? model.planModel : null,
        draftTotal: Number(model.draftTotal ?? 0),
        draftLlm: Number(model.draftLlm ?? 0),
        draftTemplate: Number(model.draftTemplate ?? 0),
        models: Array.isArray(model.models) ? model.models.map(String).slice(0, 4) : [],
        redactions: Number(model.redactions ?? 0),
        promptTokens: Number(model.promptTokens ?? 0),
        completionTokens: Number(model.completionTokens ?? 0),
      },
    };
  });

  const gates: AdminGate[] = (gatesBody?.gates ?? []).map((raw) => {
    const receipt = (raw.receipt ?? {}) as Record<string, unknown>;
    const stepUp = (raw.stepUp ?? null) as Record<string, unknown> | null;
    const first = (raw.firstApproval ?? null) as Record<string, unknown> | null;
    const second = (raw.secondApprover ?? null) as Record<string, unknown> | null;
    return {
      id: String(raw.id ?? ""),
      runId: String(raw.runId ?? ""),
      tenderId: String(raw.tenderId ?? ""),
      tool: String(raw.tool ?? ""),
      status: (raw.status as AdminGate["status"]) ?? "PENDING",
      createdAt: iso(raw.createdAt),
      decidedAt: typeof raw.decidedAt === "string" ? raw.decidedAt : null,
      approver: typeof raw.approver === "string" ? raw.approver : null,
      note: typeof raw.note === "string" ? raw.note.slice(0, 500) : null,
      requiredOffice: typeof raw.requiredOffice === "string" ? raw.requiredOffice : null,
      receiptHash: typeof receipt.hash === "string" ? receipt.hash : null,
      signatureValid: raw.signatureValid === true,
      stepUp:
        stepUp && typeof stepUp.by === "string"
          ? {
              by: stepUp.by,
              method: String(stepUp.method ?? "password"),
              at: typeof stepUp.at === "string" ? stepUp.at : "",
            }
          : null,
      evidential: raw.evidential === true,
      firstApproval:
        first && typeof first.by === "string"
          ? { by: first.by, at: typeof first.at === "string" ? first.at : "" }
          : null,
      secondApprover:
        second && typeof second.by === "string"
          ? { by: second.by, at: typeof second.at === "string" ? second.at : "" }
          : null,
    };
  });

  const entries: AdminAuditEntry[] = (logBody?.entries ?? []).map((raw) => ({
    seq: Number(raw.seq ?? 0),
    id: String(raw.id ?? ""),
    ts: iso(raw.ts),
    actor: String(raw.actor ?? "unknown"),
    server: String(raw.server ?? "quorum-mcp"),
    tool: String(raw.tool ?? ""),
    kind: String(raw.kind ?? "READ"),
    status: String(raw.status ?? "OK"),
    durationMs: Number(raw.durationMs ?? 0),
    runId: typeof raw.runId === "string" ? raw.runId : null,
    inputs: text(raw.inputs),
    outputs: text(raw.outputs),
    prev: typeof raw.prev === "string" ? raw.prev : null,
    self: typeof raw.self === "string" ? raw.self : null,
  }));

  const committeeRows = listCommitteeMembers();
  const gavelOnRoll = committeeRows.some(
    (member) => member.status === "PRESENT" && normalizeName(member.name) === normalizeName(actor.name),
  );
  const committeePresent = committeeRows.filter((member) => member.status === "PRESENT").length + (gavelOnRoll ? 0 : 1);

  const payload: AdminOverview = {
    generatedAt: new Date().toISOString(),
    actor: {
      id: actor.id,
      name: actor.name,
      email: actor.email,
      role: actor.role,
      canManagePeople: can(actor.role, "manage_people"),
      canManageOrgs: can(actor.role, "manage_orgs"),
      canManageRules: can(actor.role, "manage_rules"),
      readOnly: !can(actor.role, "manage_people") && !can(actor.role, "manage_orgs") && !can(actor.role, "manage_rules"),
    },
    people: listUsers(actor.workspaceId).map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      organization: user.organization,
      role: user.role,
      status: user.status,
      totpEnabled: user.totpEnabled === true,
      sessions: countSessionsForUser(user.id),
      joined: user.createdAt.toISOString(),
      currentAccount: user.id === actor.id,
    })),
    invites: listInvites(60, actor.workspaceId).map((invite) => ({
      id: invite.id,
      code: can(actor.role, "manage_people") && invite.status === "PENDING" ? invite.code : null,
      email: invite.email,
      role: invite.role as AdminOverview["invites"][number]["role"],
      status: invite.status,
      inviterName: invite.inviterName,
      emailDeliveryStatus: invite.emailDeliveryStatus ?? null,
      createdAt: invite.createdAt.toISOString(),
      expiresInDays: Math.max(
        0,
        Math.ceil((invite.createdAt.getTime() + 14 * 86_400_000 - Date.now()) / 86_400_000),
      ),
    })),
    organizations: listOrganizations().map((org) => ({
      id: org.id,
      name: org.name,
      email: org.email,
      registrationNo: org.registrationNo,
      country: org.country,
      legalForm: org.legalForm ?? null,
      categories: org.categories ?? [],
      status: org.status,
      sessions: countOrgSessionsForOrg(org.id),
      createdAt: org.createdAt.toISOString(),
    })),
    appeals: listOrgAppeals().map((appeal) => {
      const org = findOrganizationById(appeal.orgId);
      return {
        id: appeal.id,
        reference: appealReference(appeal.id),
        reason: appeal.reason,
        status: appeal.status,
        reviewer: appeal.reviewer ?? null,
        reviewNote: appeal.reviewNote ?? null,
        createdAt: appeal.createdAt.toISOString(),
        decidedAt: appeal.decidedAt ? appeal.decidedAt.toISOString() : null,
        organization: org
          ? {
              id: org.id,
              name: org.name,
              email: org.email,
              registrationNo: org.registrationNo,
              status: org.status,
            }
          : null,
      };
    }),
    governance: listOversightEvents(50).map((event) => ({
      id: event.id,
      actorName: event.actorName,
      action: event.action,
      targetType: event.targetType,
      targetName: event.targetName,
      detail: event.detail,
      createdAt: event.createdAt.toISOString(),
    })),
    supportRequests: listSupportRequests(actor.workspaceId).map((request) => ({
      id: request.id,
      requesterId: request.requesterId,
      requesterName: request.requesterName,
      requesterEmail: request.requesterEmail,
      source: request.source,
      subject: request.subject,
      message: request.message,
      status: request.status,
      response: request.response ?? null,
      respondedBy: request.respondedBy ?? null,
      respondedAt: request.respondedAt?.toISOString() ?? null,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
    })),
    committee: {
      seats: Math.max(1, parseInt(getSetting("committee_seats") ?? "9", 10) || 9),
      required: Math.max(1, parseInt(getSetting("quorum_required") ?? "5", 10) || 5),
      present: committeePresent,
      members: committeeRows.map((member) => ({
        id: member.id,
        name: member.name,
        role: member.role,
        isChair: member.isChair,
        status: member.status === "EXCUSED" ? "EXCUSED" : "PRESENT",
        office: member.office ?? (member.isChair ? "ACCOUNTING_OFFICER" : "EVALUATION_COMMITTEE"),
      })),
    },
    desk: {
      online: health?.ok === true,
      error:
        health?.ok === true
          ? null
          : `The agent runtime on ${SIDECAR.replace(/^https?:\/\//, "")} did not answer within ${TIMEOUT_MS} ms.`,
      health: health ?? null,
      tools: toolsBody?.tools ?? [],
      runs,
      gates,
      audit: {
        entries,
        total: Number(logBody?.total ?? entries.length),
        allTotal: Number(logBody?.allTotal ?? entries.length),
      },
      verify: verify ?? null,
      anchor: anchorBody?.anchor ?? null,
      anchorCount: Number(anchorBody?.count ?? 0),
      decisions: (decisionsBody?.decisions ?? []).slice(0, 20),
      ledger: decisionsBody?.ledger ?? null,
    },
  };

  return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
}
