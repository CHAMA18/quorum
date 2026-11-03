import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { can, isAdminRole } from "@/lib/permissions";
import { getSetting, listUsers, recordOversightEvent, setSetting } from "@/lib/db";

const SIDECAR = process.env.QUORUM_SIDECAR_URL ?? "http://127.0.0.1:3031";

/**
 * Phase 9 — the launch readiness gate, computed LIVE.
 *
 * Every criterion is checked against the system as it stands right now —
 * never a checklist someone once filled in. A criterion passes because the
 * machine can see the evidence; it pends (or fails) with the reason visible
 * and the exact thing to do next. The product does not launch on a promise.
 *
 * GET  — the gate: nine criteria, a verdict, and the pilot metrics computed
 *        from the same live state (run counts, human overrides, finding
 *        dispositions, audit completeness, the eval lab's honest numbers).
 * POST — the human sign-off (manage_rules): the last criterion. It records
 *        WHO signed and WHAT they saw, as a governance event.
 */

type Criterion = {
  id: string;
  label: string;
  status: "PASS" | "PENDING" | "FAIL";
  detail: string;
};

async function sidecarJson(path: string, workspaceId: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${SIDECAR}${path}`, {
      headers: { "x-quorum-workspace": workspaceId },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user.role, "view_oversight")) return NextResponse.json({ error: "Oversight access required." }, { status: 403 });

  /* Committee state lives in the WEB app's own store (roster, quorum) — read
     it from this same server, not from the sidecar. */
  const [governance, logVerify, docs, exceptions, links, runsData, gatesData, evalSummary, committee] = await Promise.all([
    sidecarJson("/api/governance", user.workspaceId),
    sidecarJson("/api/log/verify", user.workspaceId),
    sidecarJson("/api/documents?unreviewed=1", user.workspaceId),
    sidecarJson("/api/exceptions", user.workspaceId),
    sidecarJson("/api/portal-links", user.workspaceId),
    sidecarJson("/api/runs", user.workspaceId),
    sidecarJson("/api/gates", user.workspaceId),
    sidecarJson("/api/eval/summary", user.workspaceId),
    fetch(new URL("/api/committee", req.url), { headers: { cookie: req.headers.get("cookie") ?? "" }, cache: "no-store", signal: AbortSignal.timeout(4000) })
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, unknown>>) : null))
      .catch(() => null),
  ]);

  const users = listUsers(user.workspaceId);
  const roles = new Set(users.map((u) => u.role));
  const privileged = users.filter((u) => isAdminRole(u.role));
  const privilegedWithoutMfa = privileged.filter((u) => !u.totpEnabled).length;
  const mfaPolicyOn = getSetting("require_mfa_admins") === "1";

  const criteria: Criterion[] = [];

  /* 1 — governance controls signed off (sidecar governance sign-off) */
  const gov = governance as { confirmed?: boolean; signedOff?: { by: string; at: string; scope: string } | null; note?: string } | null;
  criteria.push({
    id: "governance-signed-off",
    label: "Roles and approval rules confirmed",
    status: gov?.confirmed ? "PASS" : "PENDING",
    detail: gov?.signedOff
      ? `Signed off by ${gov.signedOff.by} at ${gov.signedOff.at.slice(0, 10)} — scope: ${gov.signedOff.scope}.`
      : "Approval rules and responsibilities are available, but an administrator has not reviewed them. Open Roles & approvals and confirm the settings.",
  });

  /* 2 — role segregation enforced */
  const distinctRoles = roles.size;
  criteria.push({
    id: "role-segregation",
    label: "Separate roles assigned",
    status: distinctRoles >= 3 ? "PASS" : "PENDING",
    detail:
      distinctRoles >= 3
        ? `${distinctRoles} user roles are active. Each role has separate responsibilities for preparing, approving and reviewing procurements.`
        : `Only ${distinctRoles} user role(s) are active. The workspace needs separate preparer, approver and auditor roles before live use.`,
  });

  /* 3 — MFA for privileged users */
  criteria.push({
    id: "mfa-privilege",
    label: "Two-step sign-in required for administrators",
    status: mfaPolicyOn && privilegedWithoutMfa === 0 ? "PASS" : privilegedWithoutMfa > 0 && mfaPolicyOn ? "FAIL" : "PENDING",
    detail: mfaPolicyOn
      ? privilegedWithoutMfa === 0
        ? "Two-step sign-in is required and all administrator accounts have set it up."
        : `${privilegedWithoutMfa} administrator account(s) must set up two-step sign-in before approving actions.`
      : "Two-step sign-in is not required for administrator accounts. Turn it on in Roles & approvals before live use.",
  });

  /* 4 — audit trail tested and proven */
  const chain = logVerify as { ok?: boolean; checked?: number } | null;
  criteria.push({
    id: "audit-trail",
    label: "Activity log integrity verified",
    status: chain?.ok && (chain.checked ?? 0) > 0 ? "PASS" : "FAIL",
    detail: chain
      ? chain.ok
        ? `The integrity check passed for ${chain.checked} activity records.`
        : `The integrity check failed near record ${chain.checked}. Stop using the workspace and contact support.`
      : "The activity log could not be checked. Contact support before using the workspace for live procurements.",
  });

  /* 5 — data imports validated */
  const linksFile = links as { links?: Record<string, { registry?: { ok?: boolean } }>; updatedAt?: string } | null;
  const linkRows = Object.values(linksFile?.links ?? {});
  const importsOk = linkRows.length > 0 && linkRows.filter((l) => l.registry?.ok).length / linkRows.length >= 0.8;
  criteria.push({
    id: "imports-validated",
    label: "External data sources checked",
    status: importsOk ? "PASS" : "PENDING",
    detail: linkRows.length
      ? `${linkRows.filter((l) => l.registry?.ok).length} of ${linkRows.length} sources responded and confirmed their records (last checked ${linksFile?.updatedAt?.slice(0, 10) ?? "unknown"}). Unverified sources are identified in the workspace.`
      : "No external sources have been checked yet. Connect and verify the sources before live use.",
  });

  /* 6 — evidence handling verified */
  const docsFile = docs as { documents?: unknown[]; unreviewed?: number } | null;
  const docCount = docsFile?.documents?.length ?? 0;
  const unreviewed = docsFile?.unreviewed ?? 0;
  criteria.push({
    id: "evidence-handling",
    label: "Tender document handling checked",
    status: docCount > 0 && unreviewed === 0 ? "PASS" : docCount > 0 ? "PENDING" : "PENDING",
    detail:
      docCount === 0
        ? "No tender documents are on record yet. Add the required documents and confirm the retention period."
        : unreviewed === 0
          ? `${docCount} documents are on record with version history and retention details. No extracted information needs review.`
          : `${unreviewed} document(s) contain details that need a manual check.`,
  });

  /* 7 — reporting and oversight complete */
  const exceptionsFile = exceptions as { exceptions?: unknown[] } | null;
  const oversightReady = Array.isArray(exceptionsFile?.exceptions) && !!committee;
  criteria.push({
    id: "oversight-reporting",
    label: "Compliance reports and reviews available",
    status: oversightReady ? "PASS" : "PENDING",
    detail: oversightReady
      ? "Compliance reports, exception requests and review records are available."
      : "Some compliance reports or review records could not be loaded. Check system status or contact support.",
  });

  /* 8 — quality record (the honest lab numbers, not a promise) */
  const evalFile = evalSummary as { eval?: { original?: { recallCovered?: number; precision?: number } | null; mutation?: { overallDetectionRate?: number } | null } | null } | null;
  const evalOk = !!evalFile?.eval?.original;
  criteria.push({
    id: "quality-record",
    label: "Review quality measured",
    status: evalOk ? "PASS" : "PENDING",
    detail: evalOk
      ? `In prepared samples, the checks found ${Math.round(evalFile?.eval?.original?.recallCovered ?? 0)}% of expected issues, reviewers confirmed ${Math.round(evalFile?.eval?.original?.precision ?? 0)}% of flagged issues, and changed-file detection was ${Math.round(evalFile?.eval?.mutation?.overallDetectionRate ?? 0)}%.`
      : "No review quality report is available yet. Ask an administrator to complete the scheduled quality check.",
  });

  /* 9 — human signoff */
  const signoff = getSetting("launch_signoff");
  const signoffBy = getSetting("launch_signoff_by");
  criteria.push({
    id: "human-signoff",
    label: "Administrator approved workspace launch",
    status: signoff ? "PASS" : "PENDING",
    detail: signoff ? `${signoffBy} approved the workspace on ${signoff.slice(0, 10)}.` : "An administrator must review the checks above and confirm the workspace is ready.",
  });

  const failed = criteria.filter((c) => c.status === "FAIL");
  const pending = criteria.filter((c) => c.status === "PENDING");
  const verdict = failed.length > 0 ? "NOT_READY" : pending.length > 0 ? "NOT_READY" : "READY";

  /* Pilot metrics — computed from the same live state. */
  const runs = (runsData as { runs?: Array<{ id: string; status: string; startedAt: string; updatedAt?: string; findings?: Array<{ review?: { decision: string } }> }> } | null)?.runs ?? [];
  const gates = (gatesData as { gates?: Array<{ status: string; tool: string }> } | null)?.gates ?? [];
  const filed = runs.filter((r) => r.status === "FILED").length;
  const overridden = gates.filter((g) => g.status === "REJECTED").length;
  const allFindings = runs.flatMap((r) => r.findings ?? []);
  const disposed = allFindings.filter((f) => f.review).length;
  const accepted = allFindings.filter((f) => f.review?.decision === "ACCEPTED").length;

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    verdict,
    criteria,
    summary: { pass: criteria.length - pending.length - failed.length, pending: pending.length, fail: failed.length },
    pilotMetrics: {
      runsLaunched: runs.length,
      runsFiled: filed,
      humanOverrides: overridden,
      overrideRate: runs.length ? Math.round((overridden / runs.length) * 100) / 100 : null,
      findingsRaised: allFindings.length,
      findingsDisposed: disposed,
      findingsAccepted: accepted,
      findingsRejected: disposed - accepted,
      dispositionCoverage: allFindings.length ? Math.round((disposed / allFindings.length) * 100) : null,
      auditChainEntries: chain?.checked ?? null,
      note: "These totals come from recorded reviews, decisions and activity. No figures are estimated.",
    },
    eval: evalSummary?.eval ?? null,
  });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user.role, "manage_rules")) {
    return NextResponse.json({ error: "An administrator must approve workspace launch." }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { note?: string };
  const note = (body.note ?? "").trim().slice(0, 400);
  const at = new Date().toISOString();
  setSetting("launch_signoff", at);
  setSetting("launch_signoff_by", user.name);
  recordOversightEvent({
    actorId: user.id,
    actorName: user.name,
    action: "ACCESS_REVIEW",
    targetType: "ORGANIZATION",
    targetId: "launch-readiness",
    targetName: "Launch readiness",
    detail: note ? `Workspace launch approved. ${note}` : "Workspace launch approved after review of the readiness checks.",
  });
  return NextResponse.json({ signedOff: true, by: user.name, at }, { status: 201 });
}
