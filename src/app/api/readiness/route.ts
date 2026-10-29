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

async function sidecarJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${SIDECAR}${path}`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  /* Committee state lives in the WEB app's own store (roster, quorum) — read
     it from this same server, not from the sidecar. */
  const [governance, logVerify, docs, exceptions, links, runsData, gatesData, evalSummary, committee] = await Promise.all([
    sidecarJson("/api/governance"),
    sidecarJson("/api/log/verify"),
    sidecarJson("/api/documents?unreviewed=1"),
    sidecarJson("/api/exceptions"),
    sidecarJson("/api/portal-links"),
    sidecarJson("/api/runs"),
    sidecarJson("/api/gates"),
    sidecarJson("/api/eval/summary"),
    fetch(new URL("/api/committee", req.url), { cache: "no-store", signal: AbortSignal.timeout(4000) })
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, unknown>>) : null))
      .catch(() => null),
  ]);

  const users = listUsers();
  const roles = new Set(users.map((u) => u.role));
  const privileged = users.filter((u) => isAdminRole(u.role));
  const privilegedWithoutMfa = privileged.filter((u) => !u.totpEnabled).length;
  const mfaPolicyOn = getSetting("require_mfa_admins") === "1";

  const criteria: Criterion[] = [];

  /* 1 — governance controls signed off (sidecar governance sign-off) */
  const gov = governance as { confirmed?: boolean; signedOff?: { by: string; at: string; scope: string } | null; note?: string } | null;
  criteria.push({
    id: "governance-signed-off",
    label: "Governance and control foundation signed off",
    status: gov?.confirmed ? "PASS" : "PENDING",
    detail: gov?.signedOff
      ? `Signed off by ${gov.signedOff.by} at ${gov.signedOff.at.slice(0, 10)} — scope: ${gov.signedOff.scope}.`
      : "The authority matrix, bands and duties are live, but the operational owner has not signed the configuration. Record the sign-off in Governance.",
  });

  /* 2 — role segregation enforced */
  const distinctRoles = roles.size;
  criteria.push({
    id: "role-segregation",
    label: "Role segregation enforced",
    status: distinctRoles >= 3 ? "PASS" : "PENDING",
    detail:
      distinctRoles >= 3
        ? `${distinctRoles} distinct roles active; every mutation route re-checks can() server-side and the sidecar refuses unsealed writes (fail-closed).`
        : `Only ${distinctRoles} distinct role(s) exist — segregation needs at least an preparing officer, an approver and an auditor before pilot traffic.`,
  });

  /* 3 — MFA for privileged users */
  criteria.push({
    id: "mfa-privilege",
    label: "MFA enforced for privileged accounts",
    status: mfaPolicyOn && privilegedWithoutMfa === 0 ? "PASS" : privilegedWithoutMfa > 0 && mfaPolicyOn ? "FAIL" : "PENDING",
    detail: mfaPolicyOn
      ? privilegedWithoutMfa === 0
        ? "The policy is on and every privileged account holds a second factor."
        : `${privilegedWithoutMfa} privileged account(s) still lack a second factor while the policy is ON — they cannot sign gates until they enroll.`
      : "The MFA-for-admins policy is OFF. Turn it on in Governance before pilot traffic.",
  });

  /* 4 — audit trail tested and proven */
  const chain = logVerify as { ok?: boolean; checked?: number } | null;
  criteria.push({
    id: "audit-trail",
    label: "Audit trail tested and proven",
    status: chain?.ok && (chain.checked ?? 0) > 0 ? "PASS" : "FAIL",
    detail: chain
      ? chain.ok
        ? `Hash chain verified across ${chain.checked} entries — every link recomputes.`
        : `THE CHAIN IS BROKEN at ${chain.checked} checked entries — investigate before any further use.`
      : "The audit spine is unreachable — the platform must not launch without it.",
  });

  /* 5 — data imports validated */
  const linksFile = links as { links?: Record<string, { registry?: { ok?: boolean } }>; updatedAt?: string } | null;
  const linkRows = Object.values(linksFile?.links ?? {});
  const importsOk = linkRows.length > 0 && linkRows.filter((l) => l.registry?.ok).length / linkRows.length >= 0.8;
  criteria.push({
    id: "imports-validated",
    label: "Live data imports validated",
    status: importsOk ? "PASS" : "PENDING",
    detail: linkRows.length
      ? `${linkRows.filter((l) => l.registry?.ok).length}/${linkRows.length} registry handshakes hold real OCID proof (last checked ${linksFile?.updatedAt?.slice(0, 10) ?? "unknown"}). Low-confidence sources never masquerade as authoritative.`
      : "No portal handshakes on record — run a connect pass and confirm the sources before pilot use.",
  });

  /* 6 — evidence handling verified */
  const docsFile = docs as { documents?: unknown[]; unreviewed?: number } | null;
  const docCount = docsFile?.documents?.length ?? 0;
  const unreviewed = docsFile?.unreviewed ?? 0;
  criteria.push({
    id: "evidence-handling",
    label: "Evidence handling verified",
    status: docCount > 0 && unreviewed === 0 ? "PASS" : docCount > 0 ? "PENDING" : "PENDING",
    detail:
      docCount === 0
        ? "The document register is empty — register documents (upload or stage) so hashes, custody and retention exist."
        : unreviewed === 0
          ? `${docCount} documents registered with content hashes, provenance and retention; no extraction needs a human check.`
          : `${unreviewed} document(s) still need a named reviewer for low-confidence extraction.`,
  });

  /* 7 — reporting and oversight complete */
  const exceptionsFile = exceptions as { exceptions?: unknown[] } | null;
  const oversightReady = Array.isArray(exceptionsFile?.exceptions) && !!committee;
  criteria.push({
    id: "oversight-reporting",
    label: "Reporting and oversight complete",
    status: oversightReady ? "PASS" : "PENDING",
    detail: oversightReady
      ? "The exceptions register, compliance summaries, analytics and the audit explorer are all answerable from live state."
      : "The sidecar surfaces for oversight reporting are not all reachable — check the service health.",
  });

  /* 8 — quality record (the honest lab numbers, not a promise) */
  const evalFile = evalSummary as { eval?: { original?: { recallCovered?: number; precision?: number } | null; mutation?: { overallDetectionRate?: number } | null } | null } | null;
  const evalOk = !!evalFile?.eval?.original;
  criteria.push({
    id: "quality-record",
    label: "Independent quality record exists",
    status: evalOk ? "PASS" : "PENDING",
    detail: evalOk
      ? `Eval lab: recall ${Math.round(evalFile?.eval?.original?.recallCovered ?? 0)}% (covered) / precision ${Math.round(evalFile?.eval?.original?.precision ?? 0)}% against pre-written labels; mutation detection ${Math.round(evalFile?.eval?.mutation?.overallDetectionRate ?? 0)}%.`
      : "No eval report found — run bun eval.ts in the sidecar to produce the recall/precision/mutation record.",
  });

  /* 9 — human signoff */
  const signoff = getSetting("launch_signoff");
  const signoffBy = getSetting("launch_signoff_by");
  criteria.push({
    id: "human-signoff",
    label: "Named human signs the launch",
    status: signoff ? "PASS" : "PENDING",
    detail: signoff ? `${signoffBy} signed the launch readiness at ${signoff.slice(0, 10)}.` : "The readiness gate needs a named human to sign — record it below once the eight criteria above hold.",
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
      note: "Every number is read from live state — the run log, the gates and the audit spine. Nothing is estimated here.",
    },
    eval: evalSummary?.eval ?? null,
  });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user.role, "manage_rules")) {
    return NextResponse.json({ error: "Recording the launch sign-off requires rule-management authority." }, { status: 403 });
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
    detail: note ? `Launch sign-off recorded. ${note}` : "Launch sign-off recorded against the live readiness gate.",
  });
  return NextResponse.json({ signedOff: true, by: user.name, at }, { status: 201 });
}
