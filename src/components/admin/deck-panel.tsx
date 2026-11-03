"use client";

import { useMemo } from "react";
import {
  Activity,
  ArrowRight,
  Building2,
  CircleAlert,
  ClipboardCheck,
  Cpu,
  Fingerprint,
  Gavel,
  ShieldCheck,
  Stamp,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdminOverview } from "@/lib/admin-types";
import {
  Chip,
  DayBars,
  Dot,
  Empty,
  fmtAgo,
  fmtClock,
  fmtNum,
  hostOf,
  Metric,
  minutesSince,
  Panel,
  PanelHead,
  Readout,
  Ring,
  SectionHead,
  shortHash,
  type DayPoint,
  type Tone,
} from "@/components/admin/kit";
import { StatusChip } from "@/components/admin/console";
import type { AdminSection, PanelProps } from "@/components/admin/types";

/* ── Derived register ───────────────────────────────────────────────────── */

type Alert = {
  id: string;
  tone: Tone;
  title: string;
  detail: string;
  section: AdminSection;
  query?: string;
  cta: string;
};

const SEVERITY: Record<Tone, number> = {
  red: 0,
  brand: 1,
  amber: 2,
  sky: 3,
  violet: 3,
  emerald: 4,
  neutral: 5,
};

function alertsOf(data: AdminOverview, now: number): Alert[] {
  const alerts: Alert[] = [];
  const { desk, people, organizations, appeals, invites, committee, governance } = data;

  if (!desk.online) {
    alerts.push({
      id: "runtime",
      tone: "red",
      title: "The review service is unavailable",
      detail: desk.error ?? "The service health check did not respond. Tender reviews, approvals and recent audit activity may be unavailable.",
      section: "system",
      cta: "Open system",
    });
  }

  if (desk.health) {
    const spine = desk.health.auditSpine;
    const healthModel = desk.health.model;
    const agentMode = desk.health.agent?.mode;
    if (spine && (spine.stateCorrupt || spine.stateSaveFailing || spine.logWriteFailing)) {
      alerts.push({
        id: "spine-health",
        tone: "red",
        title: "Audit record health needs attention",
        detail: [
          spine.stateCorrupt ? "state file quarantined" : null,
          spine.stateSaveFailing ? "state writes failing" : null,
          spine.logWriteFailing ? "log writes failing" : null,
        ]
          .filter(Boolean)
          .join(" · "),
        section: "system",
        cta: "View system status",
      });
    }
    if (spine && spine.unsignedExecuted > 0) {
      alerts.push({
        id: "unsigned",
        tone: "red",
        title: `${spine.unsignedExecuted} completed approval${spine.unsignedExecuted === 1 ? "" : "s"} without a signature`,
        detail: "These decisions have no saved signature or completed identity check. Review the records before relying on them.",
        section: "audit",
        cta: "Read the trail",
      });
    }
    if (agentMode !== "enabled") {
      alerts.push({
        id: "agent-mode",
        tone: agentMode === "disabled" ? "red" : "amber",
        title: agentMode === "disabled" ? "Automated review is disabled" : "Automated review is in read-only mode",
        detail:
          agentMode === undefined
            ? "The service did not report its current mode."
            : "Existing reviews are available, but new reviews cannot be started.",
        section: "system",
        cta: "View system status",
      });
    }
    /* A configured chain with no recorded answer is worth saying out loud: the
       drafts below it are templates, not model output. */
    if (healthModel?.lastCall == null && healthModel?.configured) {
      alerts.push({
        id: "model-quiet",
        tone: "sky",
      title: "AI-assisted drafting is configured but has not been used",
      detail: "No AI-generated response has been recorded yet. Drafts are created from clearly labelled templates.",
        section: "system",
        cta: "Review system settings",
      });
    }
  }

  if (desk.verify && !desk.verify.ok) {
    alerts.push({
      id: "chain",
      tone: "red",
      title: "The audit record could not be verified",
      detail: `Verification failed at entry ${fmtNum(desk.verify.brokenAt ?? 0)} of ${fmtNum(desk.verify.lines)}. Review the record before relying on it.`,
      section: "audit",
      cta: "Review audit history",
    });
  }
  if (desk.ledger && !desk.ledger.ok) {
    alerts.push({
      id: "ledger",
      tone: "red",
      title: "The approval history could not be verified",
      detail: `Verification failed at entry ${fmtNum(desk.ledger.brokenAt ?? 0)}.`,
      section: "audit",
      cta: "Review approval history",
    });
  }

  const waiting = desk.gates.filter((gate) => gate.status === "PENDING" || gate.status === "AWAITING_SECOND");
  if (waiting.length > 0) {
    const oldest = waiting.reduce<string | null>(
      (earliest, gate) => (!earliest || gate.createdAt < earliest ? gate.createdAt : earliest),
      null,
    );
    alerts.push({
      id: "gates",
      tone: "amber",
      title: `${waiting.length} approval request${waiting.length === 1 ? "" : "s"} waiting for a decision`,
      detail: `The oldest request has been waiting ${minutesSince(oldest, now)} minutes. Only an authorized officer can approve it.`,
      section: "gates",
      cta: "Open the queue",
    });
  }

  const openAppeals = appeals.filter((appeal) => appeal.status === "OPEN");
  if (openAppeals.length > 0) {
    alerts.push({
      id: "appeals",
      tone: "amber",
      title: `${openAppeals.length} suspension appeal${openAppeals.length === 1 ? "" : "s"} undecided`,
      detail: "Review each appeal and record the decision before supplier access can be restored.",
      section: "orgs",
      cta: "Decide appeals",
    });
  }

  const failed = desk.runs.filter(
    (run) => run.status === "FAILED" && now - new Date(run.updatedAt).getTime() < 7 * 86_400_000,
  );
  if (failed.length > 0) {
    alerts.push({
      id: "failed-runs",
      tone: "amber",
      title: `${failed.length} review${failed.length === 1 ? "" : "s"} failed in the last seven days`,
      detail: failed[0].error ? failed[0].error.slice(0, 160) : "The review ended without a report. Open its record for details.",
      section: "work",
      cta: "Read evaluations",
    });
  }

  if (committee.present < committee.required) {
    alerts.push({
      id: "quorum",
      tone: "amber",
      title: "Not enough committee members are present",
      detail: `${committee.present} committee members are present; ${committee.required} are required before an approval can be made.`,
      section: "system",
      cta: "Read the roster",
    });
  }

  const suspendedPeople = people.filter((person) => person.status === "SUSPENDED");
  const suspendedOrgs = organizations.filter((org) => org.status === "SUSPENDED");
  if (suspendedPeople.length + suspendedOrgs.length > 0) {
    alerts.push({
      id: "suspended",
      tone: "neutral",
      title: `${suspendedPeople.length} member${suspendedPeople.length === 1 ? "" : "s"} and ${suspendedOrgs.length} organization${suspendedOrgs.length === 1 ? "" : "s"} suspended`,
      detail: "Suspension is enforced on every request, not just at sign-in. Review whether each still holds.",
      section: "people",
      cta: "Review access",
    });
  }

  const expiring = invites.filter((invite) => invite.status === "PENDING" && invite.expiresInDays <= 3);
  if (expiring.length > 0) {
    alerts.push({
      id: "invites",
      tone: "neutral",
      title: `${expiring.length} invitation${expiring.length === 1 ? "" : "s"} expiring within three days`,
      detail: "Codes are single-use and expire after 14 days. Issue a fresh one rather than letting it lapse.",
      section: "people",
      cta: "Open invitations",
    });
  }

  const unreadGovernance = governance.filter(
    (event) => now - new Date(event.createdAt).getTime() < 86_400_000,
  ).length;
  if (unreadGovernance > 0) {
    alerts.push({
      id: "governance",
      tone: "sky",
      title: `${unreadGovernance} governance change${unreadGovernance === 1 ? "" : "s"} in the last 24 hours`,
      detail: "Role, access and supplier organization changes are recorded separately from review activity.",
      section: "people",
      cta: "Read the log",
    });
  }

  return alerts.sort((a, b) => SEVERITY[a.tone] - SEVERITY[b.tone] || a.id.localeCompare(b.id));
}

function dayPoints(entries: AdminOverview["desk"]["audit"]["entries"]): DayPoint[] {
  const points: DayPoint[] = [];
  const today = new Date();
  for (let i = 13; i >= 0; i -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    points.push({
      key,
      label: date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
      read: 0,
      write: 0,
      gate: 0,
      error: 0,
    });
  }
  const index = new Map(points.map((point) => [point.key, point]));
  for (const entry of entries) {
    const date = new Date(entry.ts);
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const point = index.get(key);
    if (!point) continue;
    if (entry.status === "ERROR") point.error += 1;
    else if (entry.kind === "GATE_DECISION" || entry.kind === "IRREVERSIBLE") point.gate += 1;
    else if (entry.kind === "WRITES") point.write += 1;
    else point.read += 1;
  }
  return points;
}

/* ── Panel ──────────────────────────────────────────────────────────────── */

export function DeckPanel({ data, now, navigate }: PanelProps) {
  const { desk, people, organizations, appeals, invites, committee, governance } = data;
  const health = desk.health;
  const points = useMemo(() => dayPoints(desk.audit.entries), [desk.audit.entries]);
  const alerts = useMemo(() => alertsOf(data, now), [data, now]);

  const waiting = desk.gates.filter((gate) => gate.status === "PENDING" || gate.status === "AWAITING_SECOND");
  const filed = desk.runs.filter((run) => run.status === "FILED").length;
  const awaiting = desk.runs.filter((run) => run.status === "AWAITING_GATE").length;
  const findings = desk.runs.reduce((sum, run) => sum + run.findings, 0);
  const drafts = desk.runs.reduce((sum, run) => sum + run.drafts, 0);
  const activePeople = people.filter((person) => person.status === "ACTIVE").length;
  const sessions = people.reduce((sum, person) => sum + person.sessions, 0);
  const twoFactor = people.filter((person) => person.totpEnabled).length;
  const openAppeals = appeals.filter((appeal) => appeal.status === "OPEN").length;
  const pendingInvites = invites.filter((invite) => invite.status === "PENDING").length;
  /* A control room must survive a sidecar that is a version behind: a field
     the running build does not publish renders as "not declared", never as a
     crash that takes the whole desk down with it. */
  const model = health?.model;
  const posture = health?.governance;
  const lastCall = model?.lastCall ?? null;
  const totalCalls = points.reduce((sum, point) => sum + point.read + point.write + point.gate + point.error, 0);

  return (
    <div className="space-y-6">
      <SectionHead
        index="01"
        eyebrow="Administration overview"
        title={
          <>
            Procurement oversight<span className="text-brand-600">, in one place.</span>
          </>
        }
        lede={
          <>
            Manage user access, supplier organizations, review activity and audit records from one workspace.
            Administrative actions remain tied to the signed-in account and assigned permissions.
          </>
        }
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="neutral" dot>
              {data.actor.role} access
            </Chip>
            <Chip tone={data.actor.readOnly ? "amber" : "emerald"} dot>
              {data.actor.readOnly ? "Read only" : "Writable"}
            </Chip>
          </div>
        }
        actions={
          <button
            type="button"
            onClick={() => navigate("audit")}
            className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-lg bg-ink-950 px-3.5 font-code text-[10px] font-bold uppercase tracking-[0.1em] text-white transition-colors hover:bg-ink-800 dark:bg-white dark:text-[#0b0c0f] dark:hover:bg-[#e9eaec]"
          >
            <Fingerprint className="h-3.5 w-3.5" aria-hidden="true" />
            AUDIT HISTORY
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        }
      />

      {/* Instrument strip */}
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <Readout
          label="Review service"
          value={desk.online ? "ONLINE" : "OFFLINE"}
          tone={desk.online ? "emerald" : "red"}
          pulse={desk.online}
          detail={health ? `Available for ${Math.floor((health.uptimeSec ?? 0) / 60)} minutes · document access ${health.fsMcp?.status === "connected" ? "connected" : health.fsMcp?.status ?? "not reported"}` : "Status unavailable"}
        />
        <Readout
          label="Audit record"
          value={desk.verify ? (desk.verify.ok ? "VERIFIED" : "CHECK FAILED") : "NOT CHECKED"}
          tone={desk.verify ? (desk.verify.ok ? "emerald" : "red") : "amber"}
          detail={desk.verify ? `${fmtNum(desk.verify.lines)} lines · ${fmtNum(desk.verify.segments)} segments` : "verification did not answer"}
        />
        <Readout
          label="Drafting support"
          value={model?.configured ? "AI AVAILABLE" : "TEMPLATES"}
          tone={model?.configured ? "sky" : "neutral"}
          detail={model?.configured ? "AI-assisted drafting is enabled; generated content is identified." : "Drafts use clearly labelled templates."}
        />
        <Readout
          label="Automated review"
          value={(health?.agent?.mode ?? "unknown").toUpperCase()}
          tone={health?.agent?.mode === "enabled" ? "emerald" : health?.agent?.mode === "disabled" ? "red" : "amber"}
          detail={`${posture?.deploymentMode ?? "—"} environment · approval signing key ${posture?.gateKey?.source ?? "—"}`}
        />
      </div>

      {/* Primary measures */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Tender reviews"
          value={fmtNum(desk.runs.length)}
          tone="brand"
          icon={<ClipboardCheck className="h-4 w-4" aria-hidden="true" />}
          note={`${awaiting} awaiting approval · ${filed} completed`}
          footer={
            <div className="flex h-1 overflow-hidden rounded-full bg-ink-100 dark:bg-white/10">
              <span
                className="bg-emerald-500"
                style={{ width: `${desk.runs.length ? (filed / desk.runs.length) * 100 : 0}%` }}
              />
              <span
                className="bg-amber-500"
                style={{ width: `${desk.runs.length ? (awaiting / desk.runs.length) * 100 : 0}%` }}
              />
            </div>
          }
        />
        <Metric
          label="Pending approvals"
          value={fmtNum(waiting.length)}
          tone={waiting.length ? "amber" : "emerald"}
          icon={<Stamp className="h-4 w-4" aria-hidden="true" />}
          note={
            waiting.length
              ? `oldest waits ${minutesSince(
                  waiting.reduce<string | null>(
                    (earliest, gate) => (!earliest || gate.createdAt < earliest ? gate.createdAt : earliest),
                    null,
                  ),
                  now,
                )}m · committee signs in the workspace`
              : "No approval requests are waiting."
          }
          footer={
            waiting.length ? (
              <button
                type="button"
                onClick={() => navigate("gates")}
                className="focus-brand inline-flex min-h-11 items-center rounded-lg px-2 font-code text-[10px] font-bold uppercase tracking-[0.06em] text-brand-800 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/10"
              >
                OPEN THE QUEUE →
              </button>
            ) : undefined
          }
        />
        <Metric
          label="Workspace people"
          value={fmtNum(people.length)}
          tone="sky"
          icon={<Users className="h-4 w-4" aria-hidden="true" />}
          note={`${activePeople} active · ${sessions} live session${sessions === 1 ? "" : "s"} · ${twoFactor} with 2FA`}
          footer={
            <div className="flex flex-wrap gap-1">
              {(["OWNER", "ADMIN", "OFFICER", "COMMITTEE", "AUDITOR"] as const).map((role) => {
                const count = people.filter((person) => person.role === role).length;
                return count > 0 ? (
                  <span
                    key={role}
                    className="rounded border border-ink-200 px-2 py-1 font-code text-[10px] font-bold tracking-[0.03em] text-ink-600 dark:border-white/10"
                  >
                    {role.slice(0, 3)} {count}
                  </span>
                ) : null;
              })}
            </div>
          }
        />
        <Metric
          label="Supplier door"
          value={fmtNum(organizations.length)}
          tone="violet"
          icon={<Building2 className="h-4 w-4" aria-hidden="true" />}
          note={`${organizations.filter((org) => org.status === "SUSPENDED").length} suspended · ${openAppeals} open appeal${openAppeals === 1 ? "" : "s"}`}
          footer={
            <button
              type="button"
              onClick={() => navigate("orgs")}
              className="focus-brand inline-flex min-h-11 items-center rounded-lg px-2 font-code text-[10px] font-bold uppercase tracking-[0.06em] text-ink-600 hover:bg-ink-100 hover:text-ink-950 dark:hover:bg-white/[0.06] dark:hover:text-white"
            >
              {openAppeals > 0 ? "DECIDE APPEALS →" : "OPEN THE REGISTER →"}
            </button>
          }
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-12">
        <div className="space-y-5 xl:col-span-8">
          {/* Signal */}
          <Panel>
            <PanelHead
              eyebrow="Signal · 14 days"
              title="Recent activity"
              description="Actions recorded by the workspace, including document access, changes, approvals and errors."
              action={
                <div className="text-right">
                  <p className="type-num text-[22px] text-ink-950">{fmtNum(totalCalls)}</p>
                  <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Actions in this period</p>
                </div>
              }
            />
            <div className="px-5 py-5">
              <DayBars points={points} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-5 py-2.5 dark:border-white/8">
              <p className="text-[10.5px] leading-relaxed text-ink-600">
                {fmtNum(desk.audit.allTotal)} recorded actions · latest {desk.audit.entries[0] ? fmtAgo(desk.audit.entries[0].ts, now) : "—"}
              </p>
              <button
                type="button"
                onClick={() => navigate("audit")}
                className="focus-brand inline-flex min-h-11 items-center rounded-lg px-2 font-code text-[10px] font-bold uppercase tracking-[0.06em] text-ink-600 hover:bg-ink-100 hover:text-ink-950 dark:hover:bg-white/[0.06] dark:hover:text-white"
              >
                VIEW AUDIT HISTORY →
              </button>
            </div>
          </Panel>

          {/* Attention */}
          <Panel>
            <PanelHead
              eyebrow="Attention"
              title="Needs attention"
              description="Derived from the live snapshot — no invented urgency. Every row opens the surface that can resolve it."
              action={<Chip tone={alerts.length ? "amber" : "emerald"} dot>{alerts.length ? `${alerts.length} open` : "all clear"}</Chip>}
            />
            {alerts.length === 0 ? (
              <Empty title="No urgent actions" body="The review service is available, the audit record is verified, and no approvals or appeals are waiting." />
            ) : (
              <ul className="divide-y divide-ink-100 dark:divide-white/8">
                {alerts.slice(0, 7).map((alert) => (
                  <li key={alert.id}>
                    <button
                      type="button"
                      onClick={() => navigate(alert.section, alert.query)}
                      className="focus-brand group flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-ink-50/70 dark:hover:bg-white/[0.03]"
                    >
                      <span className="mt-1.5">
                        <Dot tone={alert.tone} pulse={alert.tone === "red"} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-semibold text-ink-950">{alert.title}</span>
                        <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-500">{alert.detail}</span>
                      </span>
                      <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-ink-600 transition-colors group-hover:text-brand-700 dark:group-hover:text-brand-300">
                        {alert.cta}
                        <ArrowRight className="h-3 w-3" aria-hidden="true" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* Secondary register */}
          <Panel>
            <PanelHead
              eyebrow="Register"
              title="Workspace summary"
              description="Current totals for reviews, findings, committee attendance and recent decisions."
            />
            <dl className="grid grid-cols-2 divide-x divide-y divide-ink-100 sm:grid-cols-3 dark:divide-white/8">
              {[
                { label: "Findings flagged", value: findings, note: "each carries a citation" },
                { label: "Redlines drafted", value: drafts, note: "model or labelled template" },
                { label: "Requirements identified", value: desk.runs.reduce((sum, run) => sum + run.requirements, 0), note: "from the tender documents" },
                { label: "Committee attendance", value: `${committee.present}/${committee.required}`, note: "minimum required to approve" },
                { label: "Pending invitations", value: pendingInvites, note: "single-use, 14 days" },
                { label: "Recent decisions", value: desk.decisions.length, note: "saved approval history" },
              ].map((item) => (
                <div key={item.label} className="px-4 py-3.5">
                  <dt className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">{item.label}</dt>
                  <dd className="mt-1.5 type-num text-[20px] text-ink-950">{typeof item.value === "number" ? fmtNum(item.value) : item.value}</dd>
                  <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-600">{item.note}</p>
                </div>
              ))}
            </dl>
          </Panel>

          {/* Activity */}
          <Panel>
            <PanelHead
              eyebrow="Live activity"
              title="Latest recorded actions"
              description="Most recent first. Requests and responses are saved in the audit history."
              action={
                <button
                  type="button"
                  onClick={() => navigate("audit")}
                  className="focus-brand inline-flex min-h-11 items-center rounded-lg px-2 font-code text-[10px] font-bold uppercase tracking-[0.06em] text-ink-600 hover:bg-ink-100 hover:text-ink-950 dark:hover:bg-white/[0.06] dark:hover:text-white"
                >
                  ALL LINES →
                </button>
              }
            />
            {desk.audit.entries.length === 0 ? (
              <Empty title="No activity recorded yet" body="Actions will appear here after the workspace is used." />
            ) : (
              <ul className="divide-y divide-ink-100 dark:divide-white/8">
                {desk.audit.entries.slice(0, 8).map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="w-14 shrink-0 font-code text-[10px] tabular text-ink-600">{fmtClock(entry.ts).slice(0, 5)}</span>
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        entry.status === "ERROR" ? "bg-red-500" : entry.kind === "GATE_DECISION" ? "bg-brand-500" : entry.kind === "WRITES" ? "bg-amber-500" : "bg-sky-500/70",
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-800">
                      <span className="font-semibold text-ink-950">{entry.tool.replace(/_/g, " ")}</span>
                      <span className="text-ink-400"> · {entry.actor}</span>
                    </span>
                    <span className="hidden shrink-0 text-[10px] font-semibold text-ink-600 sm:inline">
                      {entry.kind}
                    </span>
                    <span className="w-10 shrink-0 text-right font-code text-[10px] tabular text-ink-600">
                      {entry.durationMs}ms
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* Right rail */}
        <div className="space-y-5 xl:col-span-4">
          <Panel>
            <PanelHead
              eyebrow="Vitals"
              title="Service and record status"
              description="Check service availability and confirm the integrity of saved audit and approval records."
              action={
                <button
                  type="button"
                  onClick={() => navigate("system")}
                  className="focus-brand inline-flex min-h-11 items-center rounded-lg px-2 font-code text-[10px] font-bold uppercase tracking-[0.06em] text-ink-600 hover:bg-ink-100 hover:text-ink-950 dark:hover:bg-white/[0.06] dark:hover:text-white"
                >
                  DETAIL →
                </button>
              }
            />
            <div className="divide-y divide-ink-100 dark:divide-white/8">
              <VitalRow
                label="Automated review service"
                value={desk.online ? "online" : "offline"}
                tone={desk.online ? "emerald" : "red"}
                detail={desk.online ? `answered · uptime ${Math.floor((health?.uptimeSec ?? 0) / 60)}m` : "no answer in 4s"}
              />
              <VitalRow
                label="Document access"
                value={health ? (health.fsMcp?.status ?? "not declared") : "unknown"}
                tone={health?.fsMcp?.status === "connected" ? "emerald" : "amber"}
                detail={health?.fsMcp ? `${fmtNum(health.fsMcp.tools)} available actions` : "The service did not report document access status."}
              />
              <VitalRow
                label="Audit history"
                value={desk.verify ? (desk.verify.ok ? "verified" : "check failed") : "not checked"}
                tone={desk.verify ? (desk.verify.ok ? "emerald" : "red") : "amber"}
                detail={desk.verify ? `${fmtNum(desk.verify.checked)} entries checked · ${fmtNum(desk.verify.epochs.length)} record groups verified` : "Verification status unavailable"}
              />
              <VitalRow
                label="Approval history"
                value={desk.ledger ? (desk.ledger.ok ? "intact" : "broken") : "unread"}
                tone={desk.ledger ? (desk.ledger.ok ? "emerald" : "red") : "amber"}
                detail={desk.ledger ? `Latest verification code ${shortHash(desk.ledger.head, 12)}` : "Approval history status unavailable"}
              />
              <VitalRow
                label="Signing key status"
                value={posture?.gateKey?.source ?? "not declared"}
                tone={posture?.gateKey?.source === "managed-dev" ? "amber" : posture ? "emerald" : "neutral"}
                detail={posture?.gateKey?.keyId ? `Key ID ${posture.gateKey.keyId}` : "Signing key status has not been reported"}
              />
              <VitalRow
                label="Storage"
                value={health?.agent?.storage ?? "unknown"}
                tone="neutral"
                detail={health ? `${health.graphs.length} connected services` : "—"}
              />
            </div>
          </Panel>

          <Panel>
            <PanelHead eyebrow="Drafting support" title="Draft source" description="The system records whether each draft came from AI or a template." />
            <div className="space-y-3 px-5 py-4">
              <div className="rounded-xl border border-ink-200/80 bg-white/60 px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.03]">
                <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Primary</p>
                <p className="mt-1 truncate text-[12px] font-semibold text-ink-950">
                  {model?.configured ? model.model : "Standard template"}
                </p>
                <p className="truncate text-[10.5px] text-ink-600">
                  {model?.configured
                    ? `${model.providerLabel ?? "model"} · ${hostOf(model.endpoint ?? null)}`
                    : "no endpoint configured · drafts labelled template"}
                </p>
              </div>
              <div className="rounded-xl border border-ink-200/80 bg-white/60 px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.03]">
                <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Fallback</p>
                <p className="mt-1 truncate text-[12px] font-semibold text-ink-950">
                  {model?.fallback?.model ?? "None configured"}
                </p>
                <p className="truncate text-[10.5px] text-ink-600">
                  {model?.fallback
                    ? `${model.fallback.providerLabel} · ${hostOf(model.fallback.endpoint)}`
                    : "the template is the last resort"}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Chip tone="sky">{model?.residency?.residency ?? "Residency not declared"}</Chip>
                <Chip tone={model?.residency ? (model.residency.redactOn ? "emerald" : "amber") : "neutral"}>
                  {model?.residency ? (model.residency.redactOn ? "Redaction on" : "Redaction off") : "Redaction unknown"}
                </Chip>
                <Chip tone="neutral">{model?.providerLabel ?? "template"}</Chip>
              </div>
              <div className="border-t border-ink-100 pt-3 dark:border-white/8">
                <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Newest attributed answer</p>
                {lastCall ? (
                  <>
                    <p className="mt-1 truncate text-[11.5px] font-semibold text-ink-950">{lastCall.model}</p>
                    <p className="mt-0.5 text-[10px] text-ink-500">
                      {lastCall.tool.replace(/_/g, " ")} · {fmtAgo(lastCall.at, now)} · {lastCall.redactions} redaction
                      {lastCall.redactions === 1 ? "" : "s"}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-[10.5px] leading-relaxed text-ink-500">
                    No model answer is in the log yet. Any draft you see came from the template and says so.
                  </p>
                )}
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHead eyebrow="Committee" title="Member attendance" action={<Chip tone="neutral">{fmtNum(committee.seats)} members</Chip>} />
            <div className="flex items-center gap-4 px-5 py-4">
              <Ring
                value={committee.present}
                max={Math.max(committee.required, committee.present, 1)}
                tone={committee.present >= committee.required ? "emerald" : "amber"}
                label={`${committee.present}/${committee.required}`}
                sub="present"
              />
              <div className="min-w-0">
                <p className="text-[11.5px] leading-relaxed text-ink-600">
                  At least <strong className="text-ink-950">{committee.required}</strong> committee members must be present
                  before an authorized officer can approve a decision.
                </p>
                <button
                  type="button"
                  onClick={() => navigate("system")}
                  className="focus-brand mt-2 inline-flex min-h-11 items-center rounded-lg px-2 font-code text-[10px] font-bold uppercase tracking-[0.06em] text-ink-600 hover:bg-ink-100 hover:text-ink-950 dark:hover:bg-white/[0.06] dark:hover:text-white"
                >
                  VIEW COMMITTEE MEMBERS →
                </button>
              </div>
            </div>
            {committee.members.length > 0 && (
              <ul className="border-t border-ink-100 dark:border-white/8">
                {committee.members.slice(0, 4).map((member) => (
                  <li key={member.id} className="flex items-center gap-2 px-5 py-2">
                    <Dot tone={member.status === "PRESENT" ? "emerald" : "neutral"} />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-ink-800">{member.name}</span>
                    <span className="shrink-0 text-[10px] font-semibold text-ink-600">
                      {member.office.replace(/_/g, " ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHead eyebrow="Governance" title="Changes to authority" description="Recorded in the administration log, separate from review activity." />
            {governance.length === 0 ? (
              <Empty title="No changes recorded" body="No user access or supplier organization changes have been recorded." />
            ) : (
              <ol className="divide-y divide-ink-100 dark:divide-white/8">
                {governance.slice(0, 5).map((event) => (
                  <li key={event.id} className="px-5 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Activity className="h-3 w-3 shrink-0 text-ink-400" aria-hidden="true" />
                      <p className="font-code text-[10px] font-bold uppercase tracking-[0.06em] text-ink-800">
                        {event.action.replace(/_/g, " ")}
                      </p>
                      <span className="ml-auto text-[10px] text-ink-600">{fmtAgo(event.createdAt, now)}</span>
                    </div>
                    <p className="mt-1 truncate text-[11px] font-semibold text-ink-950">{event.targetName}</p>
                    <p className="truncate text-[10px] text-ink-500">
                      {event.actorName} · {event.detail}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-200/80 bg-paper-2/60 px-5 py-3.5 dark:border-white/10 dark:bg-white/[0.02]">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
          <p className="max-w-[86ch] text-[10.5px] leading-relaxed text-ink-500">
            This console shows current workspace information and records administrative changes. Tender approvals,
            submissions and award decisions must be completed by authorized officers in the procurement workspace,
            with an identity check and a saved receipt.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Gavel className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
          <span className="text-[10px] font-semibold text-ink-600">
            DECISIONS REQUIRE AN AUTHORIZED OFFICER
          </span>
        </div>
      </div>
    </div>
  );
}

function VitalRow({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: string;
  tone: Tone;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-2.5 px-5 py-2.5">
      <span className="mt-1">
        <Dot tone={tone} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[11px] font-semibold text-ink-800">{label}</p>
          <p className="shrink-0 font-code text-[10px] font-bold uppercase tracking-[0.05em] text-ink-600">{value}</p>
        </div>
        <p className="mt-0.5 truncate text-[10.5px] text-ink-600">{detail}</p>
      </div>
    </div>
  );
}
