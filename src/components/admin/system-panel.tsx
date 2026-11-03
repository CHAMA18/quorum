"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Cpu,
  Database,
  Gauge,
  KeyRound,
  Loader2,
  Lock,
  Radio,
  Rocket,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Button,
  Chip,
  Dot,
  Empty,
  fmtAgo,
  fmtNum,
  hostOf,
  inputCls,
  Panel,
  PanelHead,
  Ring,
  SectionHead,
  type Tone,
} from "@/components/admin/kit";
import { StatusChip } from "@/components/admin/console";
import type { PanelProps } from "@/components/admin/types";

type Criterion = { id: string; label: string; status: "PASS" | "PENDING" | "FAIL"; detail: string };

type Readiness = {
  verdict: "READY" | "NOT_READY";
  criteria: Criterion[];
  summary: { pass: number; pending: number; fail: number };
  pilotMetrics: {
    runsLaunched: number;
    runsFiled: number;
    humanOverrides: number;
    overrideRate: number | null;
    findingsRaised: number;
    findingsDisposed: number;
    dispositionCoverage: number | null;
    auditChainEntries: number | null;
  };
};

type WorkflowObservability = {
  traces: { traceId: string; startedAt: string; latestAt: string; events: number; errors: number; runIds: string[] }[];
  operations: { operation: string; calls: number; errors: number; p50Ms: number | null; p95Ms: number | null; latestAt: string | null }[];
  runs: { total: number; running: number; failed: number; awaitingGate: number };
  queue: { PENDING: number; RUNNING: number; DONE: number; FAILED: number; exhausted: number };
  storage: string;
  traceStore: string;
};

const SPINE_FLAGS: { key: keyof Spine; label: string; note: string; danger: boolean }[] = [
  { key: "logWriteFailing", label: "Log write", note: "the append path itself", danger: true },
  { key: "stateSaveFailing", label: "State save", note: "register persistence", danger: true },
  { key: "stateCorrupt", label: "State integrity", note: "register parse", danger: true },
  { key: "snapshotOverwriteRefused", label: "Snapshot guard", note: "stale overwrite refused", danger: true },
  { key: "unsignedExecuted", label: "Unsigned executions", note: "decisions with no seal", danger: true },
];

type Spine = {
  logWriteFailing: boolean;
  stateSaveFailing: boolean;
  stateCorrupt: boolean;
  stateCorruptFile: string | null;
  snapshotOverwriteRefused: boolean;
  unsignedExecuted: number;
  logChainEntries: number;
  decisions: number;
  forwardedKeys: number;
};

export function SystemPanel({ data, query, setQuery, now, refresh, notify }: PanelProps) {
  const health = data.desk.health;
  const actor = data.actor;
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [loadingReadiness, setLoadingReadiness] = useState(false);
  const [workflow, setWorkflow] = useState<WorkflowObservability | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadReadiness = useCallback(async () => {
    setLoadingReadiness(true);
    try {
      const res = await fetch("/api/readiness", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as Readiness & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Workspace readiness checks could not be loaded.");
      setReadiness(body);
      setReadinessError(null);
    } catch (err) {
      setReadinessError((err as Error).message);
    } finally {
      setLoadingReadiness(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => { void loadReadiness(); }, 0);
    return () => window.clearTimeout(initial);
  }, [loadReadiness]);

  const loadWorkflow = useCallback(async () => {
    try {
      const res = await fetch("/api/observability?XTransformPort=3031", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as WorkflowObservability & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Run and queue metrics could not be loaded.");
      setWorkflow(body);
      setWorkflowError(null);
    } catch (err) {
      setWorkflowError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => { void loadWorkflow(); }, 0);
    const timer = setInterval(() => { void loadWorkflow(); }, 15_000);
    return () => {
      window.clearTimeout(initial);
      clearInterval(timer);
    };
  }, [loadWorkflow]);

  const runAccessReview = async () => {
    setBusy("review");
    try {
      const res = await fetch("/api/access-review", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "The review could not be recorded.");
      notify(`Access review recorded. ${body.detail ?? ""}`.trim(), "ok");
      await refresh(true);
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const signLaunch = async () => {
    setBusy("launch");
    try {
      const res = await fetch("/api/readiness", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: "Signed in administration against the current readiness check." }),
      });
      const body = (await res.json().catch(() => ({}))) as { by?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "The sign-off was refused.");
      notify(`Workspace readiness confirmed by ${body.by ?? actor.name}.`, "ok");
      await loadReadiness();
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const model = health?.model;
  const posture = health?.governance;
  const spine = health?.auditSpine as Spine | undefined;
  const committee = data.committee;
  const quorumMet = committee.present >= committee.required;
  const tools = data.desk.tools;
  const filteredTools = tools.filter((tool) =>
    query.trim() ? `${tool.name} ${tool.description ?? ""} ${tool.kind ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()) : true,
  );
  const irreversible = tools.filter((tool) => tool.irreversible === true).length;

  return (
    <div className="space-y-6">
      <SectionHead
        index="07"
        eyebrow="System"
        title={
          <>
            What is running, <span className="text-brand-600">and what proves it.</span>
          </>
        }
        lede={
          <>
            Current service health, AI drafting settings, committee attendance, workspace readiness and system
            protections. These values are read from the running service.
          </>
        }
        actions={
          <>
            {actor.canManagePeople && (
              <Button size="sm" onClick={() => void runAccessReview()} disabled={busy !== null}>
                {busy === "review" ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <ClipboardList className="h-3 w-3" aria-hidden="true" />}
                RECORD ACCESS REVIEW
              </Button>
            )}
            <Button size="sm" onClick={() => { void refresh(); void loadWorkflow(); }}>
              <Activity className="h-3 w-3" aria-hidden="true" /> REFRESH STATUS
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ReadoutCard
          label="Review service"
          tone={data.desk.online ? "emerald" : "red"}
          pulse={data.desk.online}
          value={data.desk.online ? "ONLINE" : "OFFLINE"}
          note={
            data.desk.online
              ? `Version ${health?.version ?? "?"} · available ${uptime(health?.uptimeSec ?? 0)} · document access ${health?.fsMcp?.status === "connected" ? "connected" : health?.fsMcp?.status ?? "not reported"}`
              : data.desk.error ?? "The review service did not respond."
          }
        />
        <ReadoutCard
          label="Drafting support"
          tone={model?.configured ? "emerald" : "amber"}
          value={model?.configured ? (model.model ?? "configured") : "TEMPLATE ONLY"}
          note={
            model?.lastCall
              ? `last answer: ${model.lastCall.model} · ${fmtAgo(model.lastCall.at, now)}`
              : "no model answer recorded in the log yet"
          }
        />
        <ReadoutCard
          label="Automated review access"
          tone={health?.agent?.mode === "enabled" ? "amber" : health?.agent?.mode === "read-only" ? "sky" : "neutral"}
          value={(health?.agent?.mode ?? "unknown").replace(/-/g, " ").toUpperCase()}
          note={`Access limited to this workspace · storage ${health?.agent?.storage ?? "not reported"}`}
        />
        <ReadoutCard
          label="Committee attendance"
          tone={quorumMet ? "emerald" : "amber"}
          pulse={!quorumMet}
          value={`${committee.present}/${committee.required}`}
          note={`${committee.seats} committee seats · ${quorumMet ? "enough members are present to approve" : "more members must attend before approval"}`}
        />
      </div>

      <Panel>
        <PanelHead
          eyebrow="Workflow operations"
          title="Run health and trace history"
          description="Follow review requests from the authenticated gateway through the durable worker and audit events."
          icon={<Gauge className="h-4 w-4 text-ink-400" aria-hidden="true" />}
          action={workflow ? <Chip tone={workflow.queue.exhausted ? "red" : "emerald"}>{workflow.storage.toUpperCase()} · REFRESHES EVERY 15S</Chip> : <Chip tone="neutral">LOADING</Chip>}
        />
        {workflowError && !workflow ? (
          <p role="status" className="px-5 py-4 text-[11px] text-ink-500">Workflow metrics are unavailable: {workflowError}</p>
        ) : workflow ? (
          <div className="space-y-4 px-5 py-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
              {[
                ["RUNS", workflow.runs.total, "neutral"],
                ["IN PROGRESS", workflow.runs.running, workflow.runs.running ? "sky" : "neutral"],
                ["AWAITING APPROVAL", workflow.runs.awaitingGate, workflow.runs.awaitingGate ? "amber" : "neutral"],
                ["FAILED RUNS", workflow.runs.failed, workflow.runs.failed ? "red" : "emerald"],
                ["QUEUED", workflow.queue.PENDING, workflow.queue.PENDING ? "sky" : "neutral"],
                ["WORKING", workflow.queue.RUNNING, workflow.queue.RUNNING ? "sky" : "neutral"],
                ["COMPLETED JOBS", workflow.queue.DONE, "emerald"],
                ["RETRIES EXHAUSTED", workflow.queue.exhausted, workflow.queue.exhausted ? "red" : "emerald"],
              ].map(([label, value, tone]) => (
                <div key={String(label)} className="rounded-xl border border-ink-100 bg-paper-2/50 px-3 py-2 dark:border-white/8 dark:bg-white/[0.02]">
                  <p className="font-code text-[9px] font-bold uppercase tracking-[0.08em] text-ink-600">{label}</p>
                  <p className="mt-1 type-num text-[19px] text-ink-950">{fmtNum(Number(value))}</p>
                  <Chip tone={tone as Tone}>{String(label) === "RETRIES EXHAUSTED" && Number(value) ? "NEEDS ATTENTION" : "RECORDED"}</Chip>
                </div>
              ))}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="min-w-0">
                <p className="font-code text-[10px] font-bold uppercase tracking-[0.08em] text-ink-600">Recent request traces</p>
                {workflow.traces.length ? (
                  <ul className="mt-2 divide-y divide-ink-100 rounded-xl border border-ink-100 dark:divide-white/8 dark:border-white/10">
                    {workflow.traces.slice(0, 6).map((trace) => (
                      <li key={trace.traceId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                        <code className="min-w-0 flex-1 truncate text-[10px] text-ink-700" title={trace.traceId}>{trace.traceId}</code>
                        <span className="font-code text-[9px] text-ink-500">{trace.events} events · {trace.errors} errors · {fmtAgo(trace.latestAt, now)}</span>
                        <a
                          href={`/api/traces/${encodeURIComponent(trace.traceId)}?XTransformPort=3031`}
                          target="_blank"
                          rel="noreferrer"
                          className="focus-brand rounded px-1.5 py-1 font-code text-[9px] font-bold uppercase text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/10"
                        >
                          OPEN TRACE
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-2 rounded-xl border border-dashed border-ink-200 px-3 py-4 text-[10.5px] text-ink-500 dark:border-white/10">No correlated request traces have been recorded yet.</p>}
              </div>
              <div className="min-w-0">
                <p className="font-code text-[10px] font-bold uppercase tracking-[0.08em] text-ink-600">Operation latency</p>
                {workflow.operations.length ? (
                  <ul className="mt-2 divide-y divide-ink-100 rounded-xl border border-ink-100 dark:divide-white/8 dark:border-white/10">
                    {workflow.operations.slice(0, 6).map((operation) => (
                      <li key={operation.operation} className="flex items-center gap-3 px-3 py-2">
                        <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink-800">{operation.operation}</span>
                        <span className="shrink-0 font-code text-[9px] text-ink-500">p50 {operation.p50Ms ?? "—"} ms · p95 {operation.p95Ms ?? "—"} ms</span>
                        <Chip tone={operation.errors ? "red" : "emerald"}>{operation.errors} errors</Chip>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-2 rounded-xl border border-dashed border-ink-200 px-3 py-4 text-[10.5px] text-ink-500 dark:border-white/10">No operation timings have been recorded yet.</p>}
              </div>
            </div>
            <p className="text-[10px] text-ink-500">Trace store: {workflow.traceStore}. Review recovery replays a failed run from its start and reuses its pending gate; it does not restore an internal graph node.</p>
            {workflowError && <p role="status" className="text-[10px] text-amber-700 dark:text-amber-300">Latest refresh failed: {workflowError}</p>}
          </div>
        ) : <p className="px-5 py-4 text-[11px] text-ink-500">Loading workflow metrics…</p>}
      </Panel>

      <div className="grid gap-5 xl:grid-cols-12">
        <div className="space-y-5 xl:col-span-8">
          <Panel>
            <PanelHead
              eyebrow="AI drafting settings"
              title="Drafting providers"
              description="Review the primary and backup providers, where requests are processed and the source of the latest generated draft."
              action={<Chip tone={model?.configured ? "emerald" : "amber"} dot>{model?.configured ? "CONFIGURED" : "NOT CONFIGURED"}</Chip>}
              icon={<Cpu className="h-4 w-4 text-ink-400" aria-hidden="true" />}
            />
            <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
              <Field label="PRIMARY" value={model?.model ?? "—"} note={`${model?.providerLabel ?? "—"} · ${hostOf(model?.endpoint ?? null)}`} />
              <Field
                label="BACKUP PROVIDER"
                value={model?.fallback?.model ?? "none"}
                note={model?.fallback ? `${model.fallback.providerLabel} · ${hostOf(model.fallback.endpoint)}` : "no secondary model is wired — a primary failure degrades to templates"}
              />
              <Field label="MODE" value={(model?.mode ?? "—").toUpperCase()} note={model?.configuredBy ? `configured by ${model.configuredBy}` : "configured from the environment"} />
              <Field
                label="DATA PROCESSING LOCATION"
                value={(model?.residency?.residency ?? "not declared").toUpperCase()}
                note={
                  model?.residency
                    ? model.residency.redactOn
                      ? "redaction on for outbound prompts"
                      : "Sensitive details are not removed before requests are sent. Review this setting before enabling AI drafting."
                    : "No data processing location is reported. Confirm where requests are handled before enabling AI drafting."
                }
              />
              <div className="sm:col-span-2 rounded-xl border border-ink-200/80 bg-paper-2/50 px-3.5 py-3 dark:border-white/10 dark:bg-white/[0.02]">
                <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Latest AI-generated response</p>
                {model?.lastCall ? (
                  <>
                    <p className="mt-1 text-[12px] font-semibold text-ink-900">
                      {model.lastCall.model}{" "}
                      <span className="font-code text-[10px] font-bold uppercase tracking-[0.06em] text-ink-600">
                        via {model.lastCall.tool.replace(/_/g, " ")} · {model.lastCall.source}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[10px] text-ink-500">
                      {fmtAgo(model.lastCall.at, now)} · {model.lastCall.redactions} redaction
                      {model.lastCall.redactions === 1 ? "" : "s"}
                      {model.lastCall.runId ? ` · run ${model.lastCall.runId}` : ""}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-[11px] text-ink-500">
                    No AI-generated response has been recorded. Drafts currently use clearly labelled templates.
                  </p>
                )}
              </div>
            </div>
            <div className="border-t border-ink-100 px-5 py-3 dark:border-white/8">
              <p className="text-[10px] leading-relaxed text-ink-400">
                A model that fails is not retried into a different vendor silently. The fallback is declared, the
                template path always exists, and the source used for a draft is recorded in the audit log.
              </p>
            </div>
          </Panel>

          <Panel>
            <PanelHead
              eyebrow="Workspace readiness"
              title="Nine live readiness checks"
              description="Each requirement is checked against the running system whenever this page opens."
              icon={<Rocket className="h-4 w-4 text-ink-400" aria-hidden="true" />}
              action={
                <>
                  <Button size="sm" onClick={() => void loadReadiness()} disabled={loadingReadiness}>
                    {loadingReadiness ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Gauge className="h-3 w-3" aria-hidden="true" />}
                    RE-CHECK
                  </Button>
                  {actor.canManageRules && readiness?.verdict === "READY" && (
                    <Button size="sm" variant="brand" onClick={() => void signLaunch()} disabled={busy !== null}>
                      {busy === "launch" ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Rocket className="h-3 w-3" aria-hidden="true" />}
                      CONFIRM READINESS
                    </Button>
                  )}
                </>
              }
            />
            {loadingReadiness && !readiness ? (
              <div className="grid place-items-center px-5 py-10">
                <Loader2 className="h-4 w-4 animate-spin text-ink-400" aria-hidden="true" />
              </div>
            ) : readinessError && !readiness ? (
              <div className="px-5 py-6">
                <p className="text-[11.5px] text-ink-500">Workspace readiness checks could not be loaded: {readinessError}</p>
              </div>
            ) : readiness ? (
              <>
                <div className="flex flex-wrap items-center gap-4 border-b border-ink-100 px-5 py-4 dark:border-white/8">
                  <Ring
                    value={readiness.summary.pass}
                    max={readiness.criteria.length}
                    tone={readiness.verdict === "READY" ? "emerald" : readiness.summary.fail > 0 ? "red" : "amber"}
                    label={`${readiness.summary.pass}/${readiness.criteria.length}`}
                    sub="MET"
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "font-display text-[19px] font-black tracking-[-0.01em]",
                        readiness.verdict === "READY"
                          ? "text-emerald-700 dark:text-emerald-300"
                          : readiness.summary.fail > 0
                            ? "text-red-700 dark:text-red-300"
                            : "text-amber-700 dark:text-amber-300",
                      )}
                    >
                      {readiness.verdict === "READY" ? "READY" : "NOT READY"}
                    </p>
                    <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-500">
                      {readiness.summary.pass} met · {readiness.summary.pending} pending · {readiness.summary.fail} failed.
                      Resolve every failed requirement before launch.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-3 text-[10px] font-semibold text-ink-600">
                      <span>{readiness.pilotMetrics.runsFiled}/{readiness.pilotMetrics.runsLaunched} reviews filed</span>
                      <span>{readiness.pilotMetrics.findingsDisposed}/{readiness.pilotMetrics.findingsRaised} findings resolved</span>
                      <span>{readiness.pilotMetrics.humanOverrides} manual change{readiness.pilotMetrics.humanOverrides === 1 ? "" : "s"}</span>
                      <span>{readiness.pilotMetrics.auditChainEntries ?? "—"} verified audit entries</span>
                    </div>
                  </div>
                </div>
                <ul className="divide-y divide-ink-100 dark:divide-white/8">
                  {readiness.criteria.map((criterion, index) => (
                    <li key={criterion.id} className="flex items-start gap-2.5 px-5 py-2.5">
                      <span className="mt-0.5 shrink-0">
                        {criterion.status === "PASS" ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-label="pass" />
                        ) : criterion.status === "FAIL" ? (
                          <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" aria-label="fail" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-label="pending" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[11.5px] font-semibold text-ink-900">
                          <span className="mr-1.5 font-code text-[10px] text-ink-600">{String(index + 1).padStart(2, "0")}</span>
                          {criterion.label}
                        </p>
                        <p className="mt-0.5 text-[10px] leading-relaxed text-ink-500">{criterion.detail}</p>
                      </div>
                      <span className="ml-auto shrink-0">
                        <Chip tone={criterion.status === "PASS" ? "emerald" : criterion.status === "FAIL" ? "red" : "amber"}>
                          {criterion.status}
                        </Chip>
                      </span>
                    </li>
                  ))}
                </ul>
                {!actor.canManageRules && (
                  <p className="border-t border-ink-100 px-5 py-2.5 text-[10px] text-ink-400 dark:border-white/8">
                    Sign-off needs rule-management authority. This view is read-only for your role.
                  </p>
                )}
              </>
            ) : null}
          </Panel>
        </div>

        <div className="space-y-5 xl:col-span-4">
          <Panel>
            <PanelHead
              eyebrow="Posture"
              title="Access controls"
              icon={<ShieldCheck className="h-4 w-4 text-ink-400" aria-hidden="true" />}
            />
            <dl className="divide-y divide-ink-100 dark:divide-white/8">
              <Row label="Deployment" value={(posture?.deploymentMode ?? "not declared").toUpperCase()} />
              <Row
                label="Connector"
                value={posture?.connector ? posture.connector.name : "none"}
                note={posture?.connector ? (posture.connector.active ? "active" : "inactive") : "no external connector bound"}
              />
              <Row
                label="Meetings"
                value={posture ? fmtNum(posture.sittings) : "—"}
                note={posture ? (posture.sittingQuorumFlag ? "a committee meeting is open" : "no open committee meeting") : "meeting status not reported"}
              />
              <Row
                label="Approval signing key"
                value={posture?.gateKey.keyId ?? "—"}
                note={posture?.gateKey ? `source ${posture.gateKey.source}` : "No signing key reported."}
              />
              <Row label="Decisions" value={fmtNum(spine?.decisions ?? 0)} note={`${fmtNum(spine?.forwardedKeys ?? 0)} verified application requests`} />
            </dl>
          </Panel>

          <Panel>
            <PanelHead
              eyebrow="Committee"
              title="Member attendance"
              icon={<Users className="h-4 w-4 text-ink-400" aria-hidden="true" />}
              action={<Chip tone={quorumMet ? "emerald" : "amber"} dot>{quorumMet ? "REQUIREMENT MET" : "MORE MEMBERS NEEDED"}</Chip>}
            />
            <div className="px-5 py-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="type-num text-[26px] text-ink-950">
                  {committee.present}
                  <span className="text-[14px] text-ink-400"> / {committee.required}</span>
                </p>
                <p className="font-code text-[10px] font-bold uppercase tracking-[0.08em] text-ink-600">
                  {committee.seats} MEMBERS
                </p>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100 dark:bg-white/10">
                <div
                  className={cn("h-full rounded-full transition-all", quorumMet ? "bg-emerald-500" : "bg-amber-500")}
                  style={{ width: `${Math.min(100, (committee.present / Math.max(1, committee.seats)) * 100)}%` }}
                />
              </div>
              <ul className="mt-3 space-y-1.5">
                {committee.members.slice(0, 9).map((member) => (
                  <li key={member.id} className="flex items-center gap-2">
                    <Dot tone={member.status === "PRESENT" ? "emerald" : "neutral"} />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-ink-800">{member.name}</span>
                    {member.isChair && <Chip tone="violet">CHAIR</Chip>}
                    <span className="font-code text-[10px] uppercase tracking-[0.05em] text-ink-600">
                      {member.office.replace(/_/g, " ").slice(0, 14)}
                    </span>
                  </li>
                ))}
                {committee.members.length === 0 && (
                  <li className="text-[10.5px] text-ink-400">
                    No committee members are assigned. Approvals remain unavailable until members are added.
                  </li>
                )}
              </ul>
            </div>
            <div className="border-t border-ink-100 px-5 py-2.5 dark:border-white/8">
              <a href="/#/committee" className="focus-brand inline-flex min-h-11 items-center rounded-lg px-2 font-code text-[10px] font-bold uppercase tracking-[0.06em] text-brand-800 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/10">
                MANAGE COMMITTEE MEMBERS →
              </a>
            </div>
          </Panel>

          <Panel>
            <PanelHead
              eyebrow="System protections"
              title="Audit and safety checks"
              icon={<Database className="h-4 w-4 text-ink-400" aria-hidden="true" />}
            />
            {spine ? (
              <ul className="divide-y divide-ink-100 dark:divide-white/8">
                {SPINE_FLAGS.map((flag) => {
                  const raw = spine[flag.key];
                  const tripped = typeof raw === "number" ? raw > 0 : raw === true;
                  return (
                    <li key={flag.key} className="flex items-center gap-2.5 px-5 py-2">
                      <span className="shrink-0">
                        {tripped ? (
                          <XCircle className={cn("h-3.5 w-3.5", flag.danger ? "text-red-600 dark:text-red-400" : "text-amber-600")} aria-hidden="true" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium text-ink-800">{flag.label}</p>
                        <p className="text-[10px] leading-relaxed text-ink-600">{flag.note}</p>
                      </div>
                      <span className={cn("font-code text-[10px] font-bold tabular", tripped ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
                        {typeof raw === "number" ? fmtNum(raw) : tripped ? "TRIPPED" : "CLEAR"}
                      </span>
                    </li>
                  );
                })}
                <li className="flex items-center gap-2.5 px-5 py-2">
                  <Lock className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-ink-800">Verified activity history</p>
                    <p className="text-[10px] leading-relaxed text-ink-600">Entries checked for changes</p>
                  </div>
                  <span className="font-code text-[10px] font-bold tabular text-ink-700">{fmtNum(spine.logChainEntries)}</span>
                </li>
              </ul>
            ) : (
              <Empty title="System checks unavailable" body="The review service did not return its safety checks. Their status cannot be confirmed." />
            )}
          </Panel>
        </div>
      </div>

      <Panel>
        <PanelHead
          eyebrow="Review service"
          title="Available review actions"
          description="Actions available to the review service. Any action that changes a tender or approval requires an authorized person."
          icon={<Boxes className="h-4 w-4 text-ink-400" aria-hidden="true" />}
          action={
            <div className="flex items-center gap-1.5">
              <Chip tone="neutral">{fmtNum(tools.length)} actions</Chip>
              <Chip tone="amber">{fmtNum(irreversible)} require approval</Chip>
            </div>
          }
        />
        <div className="border-b border-ink-100 px-5 py-3 dark:border-white/8">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search available actions…"
            aria-label="Search available review actions"
            className={cn(inputCls, "w-full max-w-sm")}
          />
        </div>
        {filteredTools.length === 0 ? (
          <Empty
            title="No actions found"
            body={tools.length === 0 ? "The review service did not return its available actions. Check service status." : "Clear the search to view all available actions."}
          />
        ) : (
          <ul className="grid divide-y divide-ink-100 sm:grid-cols-2 sm:divide-y-0 dark:divide-white/8">
            {filteredTools.map((tool) => (
              <li
                key={tool.name}
                className="flex items-start gap-2.5 border-b border-ink-100 px-5 py-2.5 last:border-0 dark:border-white/8"
              >
                <span className="mt-1 shrink-0">
                  <Dot tone={tool.irreversible ? "amber" : "sky"} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span className="font-code text-[10px] font-semibold tracking-[0.03em] text-ink-900">{tool.name}</span>
                    {tool.irreversible && <Chip tone="amber">APPROVAL REQUIRED</Chip>}
                    {tool.kind && <span className="font-code text-[10px] uppercase tracking-[0.05em] text-ink-600">{tool.kind}</span>}
                  </p>
                  {tool.description && <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-ink-500">{tool.description}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="rounded-2xl border border-ink-200/80 bg-paper-2/60 px-5 py-4 dark:border-white/10 dark:bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <KeyRound className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
            <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Requests are verified</p>
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink-500">
            The application verifies each request before passing it to the review service. The approver's identity
            comes from the signed-in account and cannot be entered as someone else.
          </p>
        </div>
        <div className="rounded-2xl border border-ink-200/80 bg-paper-2/60 px-5 py-4 dark:border-white/10 dark:bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <Radio className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
            <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Review workflows</p>
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink-500">
            {(health?.graphs ?? []).length > 0
              ? `Available workflows: ${(health?.graphs ?? []).join(", ")}. A completed tender review is submitted only after an authorized officer approves it.`
              : "No review workflows were reported by the service."}
          </p>
        </div>
        <div className="rounded-2xl border border-ink-200/80 bg-paper-2/60 px-5 py-4 dark:border-white/10 dark:bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
            <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Safe failure behavior</p>
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink-500">
            If the committee roster or saved activity history cannot be checked, the service blocks the approval.
            Work pauses until the required information is available.
          </p>
        </div>
      </div>
    </div>
  );
}

function ReadoutCard({
  label,
  value,
  note,
  tone,
  pulse,
}: {
  label: string;
  value: string;
  note: string;
  tone: Tone;
  pulse?: boolean;
}) {
  return (
    <div className="panel rounded-2xl px-4 py-3.5">
      <div className="flex items-center gap-1.5">
        <Dot tone={tone} pulse={pulse} />
        <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">{label}</p>
      </div>
      <p className="mt-1.5 truncate font-display text-[15px] font-black tracking-[-0.01em] text-ink-950">{value}</p>
      <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-ink-600">{note}</p>
    </div>
  );
}

function Field({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">{label}</p>
      <p className="mt-1 truncate font-code text-[10.5px] font-semibold tracking-[0.02em] text-ink-900">{value}</p>
      <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-ink-600">{note}</p>
    </div>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 py-2">
      <div className="min-w-0">
        <dt className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">{label}</dt>
        {note && <dd className="mt-0.5 text-[10.5px] text-ink-600">{note}</dd>}
      </div>
      <dd className="max-w-[58%] truncate text-right font-code text-[10.5px] font-semibold text-ink-800">{value}</dd>
    </div>
  );
}

function uptime(seconds: number): string {
  if (!seconds) return "0m";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
