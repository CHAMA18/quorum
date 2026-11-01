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
      title: "The agent runtime is not answering",
      detail: desk.error ?? "No health response from the sidecar. Runs, gates and the audit tail are unreadable.",
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
        title: "The audit spine is reporting its own wound",
        detail: [
          spine.stateCorrupt ? "state file quarantined" : null,
          spine.stateSaveFailing ? "state writes failing" : null,
          spine.logWriteFailing ? "log writes failing" : null,
        ]
          .filter(Boolean)
          .join(" · "),
        section: "system",
        cta: "Inspect vitals",
      });
    }
    if (spine && spine.unsignedExecuted > 0) {
      alerts.push({
        id: "unsigned",
        tone: "red",
        title: `${spine.unsignedExecuted} executed gate${spine.unsignedExecuted === 1 ? "" : "s"} without a signature`,
        detail: "A decided gate has neither a signature nor a consumed step-up. This is an evidence defect.",
        section: "audit",
        cta: "Read the trail",
      });
    }
    if (agentMode !== "enabled") {
      alerts.push({
        id: "agent-mode",
        tone: agentMode === "disabled" ? "red" : "amber",
        title: agentMode === "disabled" ? "The agent is switched off" : "The agent is read-only",
        detail:
          agentMode === undefined
            ? "The runtime did not declare its mode."
            : "Reviews can be read, but no new run can write to the file.",
        section: "system",
        cta: "Open runtime",
      });
    }
    /* A configured chain with no recorded answer is worth saying out loud: the
       drafts below it are templates, not model output. */
    if (healthModel?.lastCall == null && healthModel?.configured) {
      alerts.push({
        id: "model-quiet",
        tone: "sky",
        title: "The model chain is configured but has not answered",
        detail: `${healthModel.model ?? "the configured model"} is wired and has no call in the log. Drafts are template-generated and labelled so.`,
        section: "system",
        cta: "Read the chain",
      });
    }
  }

  if (desk.verify && !desk.verify.ok) {
    alerts.push({
      id: "chain",
      tone: "red",
      title: "The audit chain does not verify",
      detail: `Broken at entry ${fmtNum(desk.verify.brokenAt ?? 0)} of ${fmtNum(desk.verify.lines)}. Treat the record as suspect until explained.`,
      section: "audit",
      cta: "Read the verdict",
    });
  }
  if (desk.ledger && !desk.ledger.ok) {
    alerts.push({
      id: "ledger",
      tone: "red",
      title: "The decision ledger does not verify",
      detail: `The independent act ledger breaks at row ${fmtNum(desk.ledger.brokenAt ?? 0)}.`,
      section: "audit",
      cta: "Read the ledger",
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
      title: `${waiting.length} gate${waiting.length === 1 ? "" : "s"} waiting for a named human`,
      detail: `Oldest has waited ${minutesSince(oldest, now)} minutes. The machine cannot press this button.`,
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
      detail: "A closed supplier door has a lawful way back in; no decision is a decision to keep it shut.",
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
      detail: failed[0].error ? failed[0].error.slice(0, 160) : "The run ended without a file. Read the run record.",
      section: "work",
      cta: "Read evaluations",
    });
  }

  if (committee.present < committee.required) {
    alerts.push({
      id: "quorum",
      tone: "amber",
      title: "The roll is short of quorum",
      detail: `${committee.present} present against ${committee.required} required. A gate decision will be refused with 409 until the roll is restored.`,
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
      detail: "Role, access and supplier-door changes are recorded separately from the agent's tool log.",
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
        eyebrow="Command deck"
        title={
          <>
            Every desk. <span className="text-brand-600">One window.</span>
          </>
        }
        lede={
          <>
            Authority, suppliers, evaluations and the record itself — read as one instrument. The desk&apos;s work is
            prepared by the agent and awarded by named humans; this room watches both, and changes nothing it cannot
            attribute.
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
            className="focus-brand inline-flex h-9 items-center gap-2 rounded-lg bg-ink-950 px-3.5 font-code text-[9px] font-bold uppercase tracking-[0.16em] text-white transition-colors hover:bg-ink-800 dark:bg-white dark:text-ink-950 dark:hover:bg-ink-200"
          >
            <Fingerprint className="h-3.5 w-3.5" aria-hidden="true" />
            THE RECORD
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        }
      />

      {/* Instrument strip */}
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <Readout
          label="Agent runtime"
          value={desk.online ? "ONLINE" : "OFFLINE"}
          tone={desk.online ? "emerald" : "red"}
          pulse={desk.online}
          detail={health ? `up ${Math.floor((health.uptimeSec ?? 0) / 60)}m · ${health.fsMcp?.status === "connected" ? "fs-MCP attached" : `fs-MCP ${health.fsMcp?.status ?? "not declared"}`}` : "no health response"}
        />
        <Readout
          label="Audit spine"
          value={desk.verify ? (desk.verify.ok ? "CHAIN INTACT" : "CHAIN BROKEN") : "UNVERIFIED"}
          tone={desk.verify ? (desk.verify.ok ? "emerald" : "red") : "amber"}
          detail={desk.verify ? `${fmtNum(desk.verify.lines)} lines · ${fmtNum(desk.verify.segments)} segments` : "verification did not answer"}
        />
        <Readout
          label="Model chain"
          value={model?.configured ? (model.model ?? "configured") : "TEMPLATE FALLBACK"}
          tone={model?.configured ? "sky" : "neutral"}
          detail={model?.configured ? `${model.providerLabel ?? "model"} · ${model.residency?.residency ?? "residency not declared"}` : "deterministic redlines, labelled"}
        />
        <Readout
          label="Agent mode"
          value={(health?.agent?.mode ?? "unknown").toUpperCase()}
          tone={health?.agent?.mode === "enabled" ? "emerald" : health?.agent?.mode === "disabled" ? "red" : "amber"}
          detail={`${posture?.deploymentMode ?? "—"} deployment · key ${posture?.gateKey?.source ?? "—"}`}
        />
      </div>

      {/* Primary measures */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Evaluations"
          value={fmtNum(desk.runs.length)}
          tone="brand"
          icon={<ClipboardCheck className="h-4 w-4" aria-hidden="true" />}
          note={`${awaiting} awaiting a gate · ${filed} filed`}
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
          label="Awaiting signature"
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
              : "No irreversible act is parked. The desk is clear."
          }
          footer={
            waiting.length ? (
              <button
                type="button"
                onClick={() => navigate("gates")}
                className="font-code text-[7.5px] font-bold uppercase tracking-[0.16em] text-brand-700 hover:text-brand-800 dark:text-brand-300"
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
                    className="rounded border border-ink-200 px-1.5 py-0.5 font-code text-[7px] font-bold tracking-[0.1em] text-ink-500 dark:border-white/10"
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
              className="font-code text-[7.5px] font-bold uppercase tracking-[0.16em] text-ink-500 hover:text-ink-950 dark:hover:text-white"
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
              title="The desk's pulse"
              description="Every call that executed, by kind, from the append-only tool log. Reads include document and desk reads; gates are irreversible acts held for a human."
              action={
                <div className="text-right">
                  <p className="type-num text-[22px] text-ink-950">{fmtNum(totalCalls)}</p>
                  <p className="font-code text-[7px] font-bold uppercase tracking-[0.18em] text-ink-400">CALLS IN WINDOW</p>
                </div>
              }
            />
            <div className="px-5 py-5">
              <DayBars points={points} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-5 py-2.5 dark:border-white/8">
              <p className="font-code text-[7.5px] font-semibold uppercase tracking-[0.16em] text-ink-400">
                {fmtNum(desk.audit.allTotal)} lines in the chain · newest {desk.audit.entries[0] ? fmtAgo(desk.audit.entries[0].ts, now) : "—"}
              </p>
              <button
                type="button"
                onClick={() => navigate("audit")}
                className="font-code text-[7.5px] font-bold uppercase tracking-[0.16em] text-ink-500 hover:text-ink-950 dark:hover:text-white"
              >
                READ THE CHAIN →
              </button>
            </div>
          </Panel>

          {/* Attention */}
          <Panel>
            <PanelHead
              eyebrow="Attention"
              title="What needs a person"
              description="Derived from the live snapshot — no invented urgency. Every row opens the surface that can resolve it."
              action={<Chip tone={alerts.length ? "amber" : "emerald"} dot>{alerts.length ? `${alerts.length} open` : "all clear"}</Chip>}
            />
            {alerts.length === 0 ? (
              <Empty title="Nothing is on fire." body="Runtime healthy, chain intact, no gate parked and no appeal waiting. The desk is quiet — verified, not assumed." />
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
                      <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 font-code text-[7.5px] font-bold uppercase tracking-[0.14em] text-ink-400 transition-colors group-hover:text-brand-700 dark:group-hover:text-brand-300">
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
              title="The working record"
              description="One line each, read from the same snapshot as every other panel."
            />
            <dl className="grid grid-cols-2 divide-x divide-y divide-ink-100 sm:grid-cols-3 dark:divide-white/8">
              {[
                { label: "Findings flagged", value: findings, note: "each carries a citation" },
                { label: "Redlines drafted", value: drafts, note: "model or labelled template" },
                { label: "Requirements pinned", value: desk.runs.reduce((sum, run) => sum + run.requirements, 0), note: "SHALL/must clauses" },
                { label: "Committee present", value: `${committee.present}/${committee.required}`, note: "quorum threshold" },
                { label: "Pending invitations", value: pendingInvites, note: "single-use, 14 days" },
                { label: "Recent decisions", value: desk.decisions.length, note: "independent act ledger" },
              ].map((item) => (
                <div key={item.label} className="px-4 py-3.5">
                  <dt className="font-code text-[7px] font-bold uppercase tracking-[0.2em] text-ink-400">{item.label}</dt>
                  <dd className="mt-1.5 type-num text-[20px] text-ink-950">{typeof item.value === "number" ? fmtNum(item.value) : item.value}</dd>
                  <p className="mt-0.5 text-[9.5px] text-ink-400">{item.note}</p>
                </div>
              ))}
            </dl>
          </Panel>

          {/* Activity */}
          <Panel>
            <PanelHead
              eyebrow="Live activity"
              title="The agent's hands, as they moved"
              description="Newest first. Inputs and outputs stay in the audit spine; this is the readable surface."
              action={
                <button
                  type="button"
                  onClick={() => navigate("audit")}
                  className="font-code text-[7.5px] font-bold uppercase tracking-[0.16em] text-ink-500 hover:text-ink-950 dark:hover:text-white"
                >
                  ALL LINES →
                </button>
              }
            />
            {desk.audit.entries.length === 0 ? (
              <Empty title="No call recorded yet" body="The spine is empty. Nothing has executed on this desk — which is a fact, not a failure." />
            ) : (
              <ul className="divide-y divide-ink-100 dark:divide-white/8">
                {desk.audit.entries.slice(0, 8).map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="w-14 shrink-0 font-code text-[9px] tabular text-ink-400">{fmtClock(entry.ts).slice(0, 5)}</span>
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
                    <span className="hidden shrink-0 font-code text-[7.5px] font-bold uppercase tracking-[0.14em] text-ink-400 sm:inline">
                      {entry.kind}
                    </span>
                    <span className="w-10 shrink-0 text-right font-code text-[8.5px] tabular text-ink-400">
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
              title="Is the desk honest?"
              description="The spine reports its own durability — nothing degrades silently."
              action={
                <button
                  type="button"
                  onClick={() => navigate("system")}
                  className="font-code text-[7.5px] font-bold uppercase tracking-[0.16em] text-ink-400 hover:text-ink-950 dark:hover:text-white"
                >
                  DETAIL →
                </button>
              }
            />
            <div className="divide-y divide-ink-100 dark:divide-white/8">
              <VitalRow
                label="Agent runtime"
                value={desk.online ? "online" : "offline"}
                tone={desk.online ? "emerald" : "red"}
                detail={desk.online ? `answered · uptime ${Math.floor((health?.uptimeSec ?? 0) / 60)}m` : "no answer in 4s"}
              />
              <VitalRow
                label="Filesystem MCP"
                value={health ? (health.fsMcp?.status ?? "not declared") : "unknown"}
                tone={health?.fsMcp?.status === "connected" ? "emerald" : "amber"}
                detail={health?.fsMcp ? `${fmtNum(health.fsMcp.tools)} tools · official third-party server` : "the runtime did not publish its fs-MCP state"}
              />
              <VitalRow
                label="Audit chain"
                value={desk.verify ? (desk.verify.ok ? "intact" : "broken") : "unverified"}
                tone={desk.verify ? (desk.verify.ok ? "emerald" : "red") : "amber"}
                detail={desk.verify ? `${fmtNum(desk.verify.checked)} checked · ${fmtNum(desk.verify.epochs.length)} sealed epoch${desk.verify.epochs.length === 1 ? "" : "s"}` : "verify did not answer"}
              />
              <VitalRow
                label="Decision ledger"
                value={desk.ledger ? (desk.ledger.ok ? "intact" : "broken") : "unread"}
                tone={desk.ledger ? (desk.ledger.ok ? "emerald" : "red") : "amber"}
                detail={desk.ledger ? `head ${shortHash(desk.ledger.head, 12)}` : "ledger did not answer"}
              />
              <VitalRow
                label="Gate key custody"
                value={posture?.gateKey?.source ?? "not declared"}
                tone={posture?.gateKey?.source === "managed-dev" ? "amber" : posture ? "emerald" : "neutral"}
                detail={posture?.gateKey?.keyId ? `key id ${posture.gateKey.keyId}` : "the runtime has not published its seal key"}
              />
              <VitalRow
                label="Storage"
                value={health?.agent?.storage ?? "unknown"}
                tone="neutral"
                detail={health ? `${health.graphs.length} graphs wired` : "—"}
              />
            </div>
          </Panel>

          <Panel>
            <PanelHead eyebrow="Model chain" title="Who answered" description="Attribution is recorded, never inferred." />
            <div className="space-y-3 px-5 py-4">
              <div className="rounded-xl border border-ink-200/80 bg-white/60 px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.03]">
                <p className="font-code text-[7px] font-bold uppercase tracking-[0.2em] text-ink-400">PRIMARY</p>
                <p className="mt-1 truncate text-[12px] font-semibold text-ink-950">
                  {model?.configured ? model.model : "Deterministic template"}
                </p>
                <p className="truncate font-code text-[8px] tracking-[0.1em] text-ink-400">
                  {model?.configured
                    ? `${model.providerLabel ?? "model"} · ${hostOf(model.endpoint ?? null)}`
                    : "no endpoint configured · drafts labelled template"}
                </p>
              </div>
              <div className="rounded-xl border border-ink-200/80 bg-white/60 px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.03]">
                <p className="font-code text-[7px] font-bold uppercase tracking-[0.2em] text-ink-400">FALLBACK</p>
                <p className="mt-1 truncate text-[12px] font-semibold text-ink-950">
                  {model?.fallback?.model ?? "None configured"}
                </p>
                <p className="truncate font-code text-[8px] tracking-[0.1em] text-ink-400">
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
                <p className="font-code text-[7px] font-bold uppercase tracking-[0.2em] text-ink-400">NEWEST ATTRIBUTED ANSWER</p>
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
            <PanelHead eyebrow="Quorum" title="The roll behind the gavel" action={<Chip tone="neutral">{fmtNum(committee.seats)} seats</Chip>} />
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
                  A gate needs <strong className="text-ink-950">{committee.required}</strong> present names. The signed-in
                  officer holds the gavel and counts once.
                </p>
                <button
                  type="button"
                  onClick={() => navigate("system")}
                  className="mt-2 font-code text-[7.5px] font-bold uppercase tracking-[0.16em] text-ink-500 hover:text-ink-950 dark:hover:text-white"
                >
                  READ THE ROSTER →
                </button>
              </div>
            </div>
            {committee.members.length > 0 && (
              <ul className="border-t border-ink-100 dark:border-white/8">
                {committee.members.slice(0, 4).map((member) => (
                  <li key={member.id} className="flex items-center gap-2 px-5 py-2">
                    <Dot tone={member.status === "PRESENT" ? "emerald" : "neutral"} />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-ink-800">{member.name}</span>
                    <span className="shrink-0 font-code text-[7px] font-bold uppercase tracking-[0.12em] text-ink-400">
                      {member.office.replace(/_/g, " ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHead eyebrow="Governance" title="Changes to authority" description="Recorded in the desk store, separate from the agent's log." />
            {governance.length === 0 ? (
              <Empty title="No change recorded" body="No role, access or supplier-door change has been made on this desk." />
            ) : (
              <ol className="divide-y divide-ink-100 dark:divide-white/8">
                {governance.slice(0, 5).map((event) => (
                  <li key={event.id} className="px-5 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Activity className="h-3 w-3 shrink-0 text-ink-400" aria-hidden="true" />
                      <p className="font-code text-[7.5px] font-bold uppercase tracking-[0.14em] text-ink-700">
                        {event.action.replace(/_/g, " ")}
                      </p>
                      <span className="ml-auto font-code text-[7px] text-ink-400">{fmtAgo(event.createdAt, now)}</span>
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
            This room reads one snapshot at a time and writes only through the endpoints that already enforce the
            rules. Signing, filing and awarding are deliberately absent: those acts belong to named humans in the
            workspace, with a step-up and a receipt.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Gavel className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
          <span className="font-code text-[7.5px] font-bold uppercase tracking-[0.18em] text-ink-400">
            THE MACHINE NEVER HOLDS THE PEN
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
          <p className="shrink-0 font-code text-[8px] font-bold uppercase tracking-[0.12em] text-ink-500">{value}</p>
        </div>
        <p className="mt-0.5 truncate font-code text-[8px] tracking-[0.06em] text-ink-400">{detail}</p>
      </div>
    </div>
  );
}
