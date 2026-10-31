"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Building2,
  Cable,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CloudUpload,
  Command as CommandIcon,
  Copy,
  Database,
  Download,
  Eye,
  FileText,
  FileUp,
  Files,
  Gavel,
  Gauge,
  HardDrive,
  Library,
  ListChecks,
  Lock,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  PenLine,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Scale,
  Search,
  ScrollText,
  Settings,
  ShieldCheck,
  Stamp,
  Terminal,
  Trash2,
  Users,
  UserPlus,
  Video,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { AuditView } from "@/components/quorum/audit-view";
import { OversightView } from "@/components/quorum/oversight-view";
import { CalendarView } from "@/components/quorum/calendar-view";
import { IntegrationsView } from "@/components/quorum/integrations-view";
import { CycleView } from "@/components/quorum/cycle-view";
import { SpecBar } from "@/components/quorum/reveal";
import { QuorumLogo } from "@/components/quorum/logo";
import { NotificationBell } from "@/components/quorum/notification-bell";
import { DeploymentBanner } from "@/components/quorum/deployment-banner";
import { DeploymentSettings } from "@/components/quorum/deployment-settings";
import { StackConsole } from "@/components/quorum/stack-console";
import { StepUpHost, requestStepUp } from "@/components/quorum/step-up";
import {
  AwardSignatureHost,
  SignatureReceiptDialog,
  requestAwardSignature,
  type AwardHandSignature,
  type SignatureReceipt,
} from "@/components/quorum/award-signature";
import {
  ASSIGNABLE_ROLES,
  ROLE_LABELS,
  can as canDo,
  type AssignableRole,
  type Capability,
  type WorkspaceRole,
} from "@/lib/permissions";
import { TenderPackPreview, type TenderPackRow } from "@/components/quorum/tender-pack-preview";
import { TourLayer, type TourStep } from "@/components/quorum/tour";
import {
  ScheduleMeetingDialog,
  ScheduledMeetingsPanel,
  type MeetingDraft,
  type ScheduledMeeting,
} from "@/components/quorum/schedule-meeting";
import { WorkspacePalette, type PaletteGroup } from "@/components/quorum/workspace-palette";
import type { AuthUser } from "@/lib/auth-types";
import { signedTenderDownloadUrl, uploadTenderDocument } from "@/lib/tender-upload";
import { StoredDocsBrowser } from "@/components/quorum/stored-docs-browser";
import { cn } from "@/lib/utils";
import { ThemeModeRow } from "@/components/quorum/theme-toggle";
import { gateFact, type GateInputs } from "@/components/quorum/gate-facts";

/**
 * Quorum — Workspace.
 * The signed-in workspace: a living picture of every run, every finding
 * and every gate waiting on a named human. The agent prepares the file;
 * the committee awards the tender — so the gavel sits in the UI, not in
 * the pipeline.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

/* ── Data model ──────────────────────────────────────────────────────────── */

type RunStatus = "running" | "queued" | "gate" | "complete";

export type McRun = {
  id: string;
  /* Backend run identity (`run_…`) — unique even when the same tender is
     reviewed twice. React keys use this; `id` stays the human-facing ref. */
  uid?: string;
  /* 1-based attempt number for this tender (review 2 of 3, …). */
  attempt?: number;
  title: string;
  buyer: string;
  bids: number | null;
  findings: number;
  citations: number;
  unsourced: number;
  status: RunStatus;
  startedAt: string;
  /* The exact backend instant behind `startedAt` — the date filter reads
     this, never the human clock string. */
  startedAtIso: string;
  /* The REAL seal from the sidecar — the executed gate's receipt hash, a
     sha-256 of the sealed bundle. Null until the gate signs. */
  seal?: string | null;
  sealedBy?: string | null;
  /* Documents ingested at launch — set when the run was briefed
     through the guided wizard (seeded runs have no pack attached). */
  docs?: number;
  progress?: string[];
  findingDetails?: {
    id: string;
    rule: string;
    severity: "HIGH" | "MEDIUM" | "LOW";
    item: string;
    evidence: string;
    citation: string;
    repaired?: boolean;
  }[];
};

type GateItem = {
  id: string;
  tender: string;
  title: string;
  supplier: string;
  /* The one fact the card states below the supplier: a contract value, the
     bid register, or the record the gate acts on. */
  factLabel: string;
  factText: string;
  /* A contract always has a contract value — set when this gate would open
     one without a stated value. */
  valueMissing: boolean;
  flags: number;
  ago: string;
  tool: string;
  requiredOffice?: string;
  /* Dual approval: the gate is open but needs a different second officer. */
  status: "PENDING" | "AWAITING_SECOND";
  firstApprover?: string;
  firstApprovalAt?: string;
};

type LedgerRow = {
  id?: string;
  tender: string;
  action: "AWARDED" | "RETURNED";
  by: string;
  at: string;
  toolLabel?: string;
  /* The appended freeform signature and the executed receipt, when the
     decision carries them — the ledger row opens the ink receipt. */
  hand?: { image: string; signedAt: string; strokes: number; by: string } | null;
  receipt?: { submissionId?: string; hash?: string } | null;
};

/* ── Live mission data — every run, gate, decision and finding comes from
   the quorum-mcp sidecar. Nothing is seeded on the client. ───────────── */

type BackendRun = {
  id: string;
  tenderId: string;
  status: "RUNNING" | "AWAITING_GATE" | "REJECTED" | "FILED" | "FAILED";
  startedAt: string;
  findings: { id: string; rule: string; item: string; citation: string }[];
  gateId?: string;
  seal?: string | null;
  sealedBy?: string | null;
  /* Set once the review plan is decided; pack.bids is the bids staged for the run. */
  plan?: { pack?: { bids?: number } } | null;
};

type BackendGate = {
  id: string;
  tenderId: string;
  status: "PENDING" | "AWAITING_SECOND" | "APPROVED" | "REJECTED" | "EXECUTED";
  tool?: string;
  requiredOffice?: string;
  inputs: GateInputs;
  createdAt: string;
  decidedAt?: string;
  approver?: string;
  /* The wet-ink layer — the officer's freeform signature, set by the sidecar
     on every decision that cleared the award dialog. */
  handSignature?: { image: string; signedAt: string; strokes: number; by: string };
  receipt?: { submissionId?: string; hash?: string; portal?: string };
  firstApproval?: { by: string; at: string; note?: string };
  secondApprover?: { by: string; at: string };
};

/* What each gate kind is called at the desk — the queue renders it on the card. */
const GATE_TOOL_LABEL: Record<string, string> = {
  file_gate_submission: "Filing",
  record_bid_opening: "Bid opening register",
  certify_evaluation: "Evaluation matrix",
  resolve_alb: "ALB resolution",
  sign_award_report: "Award report",
  publish_award_notice: "Notice of award",
  issue_debrief: "Debrief letter",
  sign_contract_pack: "Contract pack",
  approve_variation: "Contract variation",
  certify_payment: "Payment certification",
  record_contract_completion: "Contract completion",
  respond_complaint: "Complaint response",
  publish_notice: "Tender notice",
};

const OFFICE_SHORT: Record<string, string> = {
  PROCUREMENT_UNIT: "PROCUREMENT UNIT",
  EVALUATION_COMMITTEE: "EVALUATION COMMITTEE",
  ACCOUNTING_OFFICER: "ACCOUNTING OFFICER",
  OVERSIGHT: "OVERSIGHT",
};

const MEMBER_OFFICES = ["PROCUREMENT_UNIT", "EVALUATION_COMMITTEE", "ACCOUNTING_OFFICER", "OVERSIGHT"] as const;
const MEMBER_OFFICE_LABELS: Record<string, string> = {
  PROCUREMENT_UNIT: "Procurement unit",
  EVALUATION_COMMITTEE: "Evaluation committee",
  ACCOUNTING_OFFICER: "Accounting officer",
  OVERSIGHT: "Oversight / audit",
};

const RUN_STATUS: Record<BackendRun["status"], RunStatus> = {
  RUNNING: "running",
  AWAITING_GATE: "gate",
  REJECTED: "complete",
  FILED: "complete",
  FAILED: "complete",
};

const FINDING_CLASSES: FindingClass[] = ["DOCUMENT", "COMPLIANCE", "REGISTRY", "PRICING", "ARITHMETIC", "DISCLOSURE", "LOGISTICS", "SECURITY"];

function classOf(rule: string): FindingClass {
  const upper = rule.toUpperCase();
  if (upper.includes("PROMPT-INJECTION")) return "SECURITY";
  return FINDING_CLASSES.find((c) => upper.includes(c)) ?? "DOCUMENT";
}

function clockOf(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/* Live rows come off the wire with optional detail: a persisted run can lose
   its findings array, a gate can lose its inputs object. Normalize once at the
   fetch boundary so every downstream count and card reads a safe shape. */
function normalizeRun(r: BackendRun): BackendRun {
  return { ...r, findings: Array.isArray(r.findings) ? r.findings : [] };
}

function normalizeGate(g: BackendGate): BackendGate {
  return {
    ...g,
    inputs: (g.inputs && typeof g.inputs === "object" ? g.inputs : {}) as GateInputs,
  };
}

/* The roll rides alongside the runs: the gate queue must state whether the
   committee is quorate before it offers a signature. Malformed committee
   payloads are treated as unread, not as a present roll. */
function normalizeCommittee(value: unknown): CommitteeData | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Partial<CommitteeData>;
  if (!Array.isArray(c.members)) return null;
  if (typeof c.seats !== "number" || typeof c.required !== "number" || typeof c.present !== "number") return null;
  return c as CommitteeData;
}

/* Polls the sidecar's runs and gates; derives every view the dashboard renders. */
function useMissionData() {
  const [rawRuns, setRawRuns] = useState<BackendRun[]>([]);
  const [rawGates, setRawGates] = useState<BackendGate[]>([]);
  const [committee, setCommittee] = useState<CommitteeData | null>(null);
  const [reachable, setReachable] = useState(false);
  /* Tender registry — the sidecar knows each pack's proper name and buyer.
     Runs and gates only carry the reference, so the views look the human
     name up here instead of echoing the reference twice. */
  const [registry, setRegistry] = useState<Record<string, { title: string; buyer: string }>>({});

  const pullRegistry = useCallback(async () => {
    try {
      const d = await fetch("/api/sample-tenders?XTransformPort=3031").then((x) => x.json());
      const map: Record<string, { title: string; buyer: string }> = {};
      for (const s of (d.samples ?? []) as { ref: string; title?: string; buyer?: string }[]) {
        if (s?.ref) map[s.ref] = { title: s.title || s.ref, buyer: s.buyer ?? "" };
      }
      setRegistry(map);
    } catch {
      /* cosmetic layer only — every view falls back to the reference */
    }
  }, []);

  const refresh = useCallback(async () => {
    void pullRegistry();
    try {
      const [r, g, c] = await Promise.all([
        fetch("/api/runs?XTransformPort=3031").then((x) => x.json()),
        fetch("/api/gates?XTransformPort=3031").then((x) => x.json()),
        fetch("/api/committee").then((x) => (x.ok ? x.json() : null)).catch(() => null),
      ]);
      setRawRuns((r.runs ?? []).map(normalizeRun));
      setRawGates((g.gates ?? []).map(normalizeGate));
      const roll = normalizeCommittee(c);
      if (roll) setCommittee(roll);
      setReachable(true);
    } catch {
      setReachable(false);
    }
  }, [pullRegistry]);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      void pullRegistry();
      try {
        const [r, g, c] = await Promise.all([
          fetch("/api/runs?XTransformPort=3031").then((x) => x.json()),
          fetch("/api/gates?XTransformPort=3031").then((x) => x.json()),
          fetch("/api/committee").then((x) => (x.ok ? x.json() : null)).catch(() => null),
        ]);
        if (!alive) return;
        setRawRuns((r.runs ?? []).map(normalizeRun));
        setRawGates((g.gates ?? []).map(normalizeGate));
        const roll = normalizeCommittee(c);
        if (roll) setCommittee(roll);
        setReachable(true);
      } catch {
        if (alive) setReachable(false);
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 3500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pullRegistry]);

  const runs = useMemo<McRun[]>(() => {
    /* rawRuns arrives newest-first; count attempts oldest-first per tender. */
    const seen = new Map<string, number>();
    const attemptOf = new Map<string, number>();
    for (const r of [...rawRuns].reverse()) {
      const n = (seen.get(r.tenderId) ?? 0) + 1;
      seen.set(r.tenderId, n);
      attemptOf.set(r.id, n);
    }
    return rawRuns.map((r) => {
        const citations = r.findings.filter((f) => f.citation).length;
        const known = registry[r.tenderId];
        return {
          id: r.tenderId,
          uid: r.id,
          attempt: attemptOf.get(r.id),
          title: known?.title ?? r.tenderId,
          buyer: known?.buyer ?? "",
          bids: r.plan?.pack?.bids ?? null,
          findings: r.findings.length,
          citations,
          unsourced: r.findings.length - citations,
          status: RUN_STATUS[r.status],
          startedAt: clockOf(r.startedAt),
          startedAtIso: r.startedAt,
          seal: r.seal ?? null,
          sealedBy: r.sealedBy ?? null,
        };
      });
  }, [rawRuns, registry]);

  const queue = useMemo<GateItem[]>(
    () =>
      rawGates
        .filter((g) => g.status === "PENDING" || g.status === "AWAITING_SECOND")
        /* Oldest first: the longest-waiting decision is at the top. */
        .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
        .map((g) => {
          const tool = g.tool ?? "file_gate_submission";
          const fact = gateFact(tool, g.inputs, g.id);
          return {
            id: g.id,
            tender: g.tenderId,
            title: registry[g.tenderId]?.title ?? g.tenderId,
            supplier: g.inputs.bidder ?? "—",
            factLabel: fact.label,
            factText: fact.text,
            valueMissing: fact.missing,
            flags: g.inputs.findings?.length ?? 0,
            ago: clockOf(g.createdAt),
            tool,
            status: g.status === "AWAITING_SECOND" ? "AWAITING_SECOND" : "PENDING",
            ...(g.requiredOffice ? { requiredOffice: g.requiredOffice } : {}),
            ...(g.firstApproval?.by ? { firstApprover: g.firstApproval.by } : {}),
            ...(g.firstApproval?.at ? { firstApprovalAt: clockOf(g.firstApproval.at) } : {}),
          };
        }),
    [rawGates, registry]
  );

  const ledger = useMemo<LedgerRow[]>(
    () =>
      rawGates
        .filter((g) => g.status !== "PENDING" && g.decidedAt)
        .map((g) => ({
          id: g.id,
          tender: g.tenderId,
          action: g.status === "REJECTED" ? "RETURNED" : "AWARDED",
          by: g.approver ?? "—",
          at: clockOf(g.decidedAt),
          toolLabel: g.tool ? (GATE_TOOL_LABEL[g.tool] ?? g.tool) : undefined,
          hand: g.handSignature ?? null,
          receipt: g.receipt?.hash || g.receipt?.submissionId ? { submissionId: g.receipt?.submissionId, hash: g.receipt?.hash } : null,
        })),
    [rawGates]
  );

  const verdicts = useMemo<Record<string, "AWARDED" | "RETURNED">>(() => {
    const map: Record<string, "AWARDED" | "RETURNED"> = {};
    for (const row of [...ledger].reverse()) map[row.tender] = row.action;
    return map;
  }, [ledger]);

  const findings = useMemo<SeedFinding[]>(
    () =>
      rawRuns.flatMap((r) =>
        r.findings.map((f) => ({ run: r.tenderId, note: f.item, cls: classOf(f.rule), src: f.citation }))
      ),
    [rawRuns]
  );

  const notes = useMemo<Record<string, string[]>>(() => {
    const map: Record<string, string[]> = {};
    for (const r of rawRuns) map[r.tenderId] = r.findings.map((f) => f.item);
    return map;
  }, [rawRuns]);

  return { runs, queue, ledger, verdicts, findings, notes, committee, reachable, refresh };
}

/* Grouped navigation — the options that fit an agentic procurement
   workspace: command the mission, inspect the evidence, sit as the
   committee, govern the system. */
type SectionId =
  | "mc-overview"
  | "mc-runs"
  | "mc-gates"
  | "mc-cycle"
  | "mc-activity"
  | "mc-findings"
  | "mc-reports"
  | "mc-sources"
  | "mc-ledger"
  | "mc-committee"
  | "mc-oversight"
  | "mc-calendar"
  | "mc-suppliers"
  | "mc-integrations"
  | "mc-rules"
  | "mc-stack"
  | "mc-audit"
  | "mc-settings"
  | "mc-walkthrough";

type NavBadge = "runs" | "gates" | "findings";

const NAV_GROUPS: {
  group: string;
  /* An item with `href` opens its own URL — a real page, not a section. */
  items: { id: string; label: string; icon: LucideIcon; badge?: NavBadge; href?: string }[];
}[] = [
  {
    group: "COMMAND",
    items: [
      { id: "mc-overview", label: "Overview", icon: Gauge },
      { id: "mc-runs", label: "Evaluations", icon: Terminal, badge: "runs" },
      { id: "mc-gates", label: "Approvals", icon: Stamp, badge: "gates" },
      { id: "mc-cycle", label: "Tender Cycle", icon: Workflow },
      { id: "mc-activity", label: "Live Activity", icon: Radio },
    ],
  },
  {
    group: "EVIDENCE",
    items: [
      { id: "mc-findings", label: "Findings", icon: ListChecks, badge: "findings" },
      { id: "mc-reports", label: "Reports", icon: Files },
      { id: "mc-sources", label: "Data Sources", icon: Database },
    ],
  },
  {
    group: "COMMITTEE",
    items: [
      { id: "mc-ledger", label: "Award History", icon: Gavel },
      { id: "mc-committee", label: "Committee", icon: Users },
      { id: "mc-calendar", label: "Calendar", icon: CalendarDays },
    ],
  },
  {
    group: "SUPPLIERS",
    items: [
      { id: "mc-suppliers", label: "Suppliers", icon: Building2 },
    ],
  },
  {
    group: "SYSTEM",
    items: [
      { id: "mc-oversight", label: "Oversight", icon: Scale },
      { id: "mc-audit", label: "Audit Trail", icon: ScrollText },
      { id: "mc-rules", label: "Rules & Safeguards", icon: ShieldCheck },
      { id: "mc-settings", label: "Settings", icon: Settings },
      { id: "docs", label: "Documentation", icon: Library, href: "/docs" },
    ],
  },
];

/* Which capability opens a section. Items absent from this map are open to
   every signed-in desk role (overview, award history, calendar, settings).
   Hiding the destination is convenience; every route repeats the check. */
const SECTION_CAPABILITY: Partial<Record<SectionId, Capability>> = {
  "mc-runs": "run_reviews",
  "mc-gates": "sign_gates",
  "mc-cycle": "run_reviews",
  "mc-activity": "run_reviews",
  "mc-findings": "run_reviews",
  "mc-reports": "run_reviews",
  "mc-sources": "manage_sources",
  "mc-committee": "manage_meetings",
  "mc-calendar": "manage_meetings",
  "mc-suppliers": "manage_suppliers",
  "mc-rules": "manage_rules",
  "mc-oversight": "view_oversight",
  "mc-audit": "read_audit",
};

function canOpenSection(user: AuthUser | null, id: SectionId): boolean {
  const capability = SECTION_CAPABILITY[id];
  return !capability || canDo(user?.role, capability);
}

function navGroupsFor(user: AuthUser | null) {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      item.href ? true : canOpenSection(user, item.id as SectionId),
    ),
  })).filter((group) => group.items.length > 0);
}

const SECTION_LABEL = Object.fromEntries(
  NAV_GROUPS.flatMap((g) => g.items.filter((i) => !i.href).map((i) => [i.id, i.label] as const))
) as Record<SectionId, string>;

function firstNameOf(user: AuthUser | null): string {
  return user?.name.trim().split(/\s+/)[0] ?? "Officer";
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "Q";
}

function clockNow(d: Date): string {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function dateLine(d: Date): string {
  return d
    .toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric" })
    .toUpperCase();
}

/* ── Motion primitives ───────────────────────────────────────────────────── */

function useCountUp(target: number, duration = 1100): number {
  const reduce = useReducedMotion();
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (reduce) {
      const id = requestAnimationFrame(() => setVal(target));
      return () => cancelAnimationFrame(id);
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      setVal(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduce]);
  return val;
}

function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const first = requestAnimationFrame(() => setNow(new Date()));
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => {
      cancelAnimationFrame(first);
      clearInterval(id);
    };
  }, []);
  return (
    <span className="tabular" aria-label={now ? `Local time ${clockNow(now)}` : "Local time"}>
      {now ? clockNow(now) : "--:--:--"}
    </span>
  );
}

/* ── Real agent status (polled, never assumed) ─────────────────────────── */

type AgentHealth = {
  ok: boolean;
  service: string;
  version: string;
  uptimeSec: number;
  fsMcp: { status: string; tools: string[] };
  graphs: string[];
  counts: { toolCalls: number; runs: number; gates: number; pendingGates: number };
};

type AgentStatus = { sidecar: string | null; health: AgentHealth | null };

type AgentMode = "online" | "offline" | "linking";

function agentModeOf(s: AgentStatus): AgentMode {
  if (s.sidecar === null) return "linking"; /* first poll still in flight */
  return s.health?.ok ? "online" : "offline";
}

/**
 * Polls /api/agent-status — the server self-heals the quorum-mcp sidecar
 * and proxies its /api/health payload. The UI shows what this returns:
 * no hardcoded "ONLINE" anywhere.
 */
function useAgentStatus(): AgentStatus {
  const [status, setStatus] = useState<AgentStatus>({ sidecar: null, health: null });
  useEffect(() => {
    let alive = true;
    const pull = () =>
      fetch("/api/agent-status")
        .then((r) => r.json())
        .then((d: { sidecar?: string; health?: AgentHealth | null }) => {
          if (alive) setStatus({ sidecar: d.sidecar ?? "unavailable", health: d.health ?? null });
        })
        .catch(() => {
          if (alive) setStatus((p) => ({ ...p, health: null }));
        });
    void pull();
    const id = setInterval(pull, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return status;
}

function AgentStatusBadge({ mode, className }: { mode: AgentMode; className?: string }) {
  const label =
    mode === "online" ? "Agent · online" : mode === "offline" ? "Agent · offline" : "Agent · linking";
  return (
    <span
      role="status"
      aria-label={`Agent status: ${mode}`}
      className={cn(
        /* shrink-0 + nowrap: the pill is a status instrument, never a widget
           that yields its width — squeezed, it used to wrap onto two lines. */
        "inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 type-micro",
        mode === "online" &&
          "border-brand-500/30 bg-brand-500/[0.06] text-brand-700 dark:border-brand-500/35 dark:text-brand-300",
        mode === "offline" && "border-ink-200 bg-white text-ink-400 dark:border-white/10 dark:bg-white/[0.04]",
        mode === "linking" && "border-ink-200 bg-white text-ink-500 dark:border-white/10 dark:bg-white/[0.04]",
        className
      )}
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
        {mode === "online" && (
          <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" />
        )}
        <span
          className={cn(
            "relative inline-flex h-1.5 w-1.5 rounded-full",
            mode === "online" && "bg-brand-600",
            mode === "offline" && "bg-ink-300",
            mode === "linking" && "animate-pulse bg-ink-400"
          )}
        />
      </span>
      {label}
    </span>
  );
}

/* ── Agent feed terminal ─────────────────────────────────────────────────── */

type FeedKind = "step" | "ok" | "gate";
type FeedLine = { text: string; kind: FeedKind };
type LiveLogEntry = { tool?: string; status?: string; kind?: string; runId?: string };

/* Live activity from the quorum-mcp audit log — no scripted replay. */
function AgentFeed() {
  const [feed, setFeed] = useState<FeedLine[]>([]);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const res = await fetch("/api/log?limit=8&XTransformPort=3031");
        const j = (await res.json()) as { entries?: LiveLogEntry[] };
        if (!alive) return;
        const lines: FeedLine[] = (j.entries ?? []).slice(0, 8).reverse().map((e) => {
          const status = e.status ?? "";
          const kind: FeedKind =
            status === "PENDING_GATE" ? "gate" : status === "OK" ? "ok" : "step";
          const prefix = kind === "gate" ? "⏸" : kind === "ok" ? "✓" : "▸";
          const label = status === "PENDING_GATE" ? "waiting for approval" : status === "OK" ? "done" : status || "logged";
          return { text: `${prefix} ${e.tool ?? "event"} · ${label}`, kind };
        });
        setFeed(lines);
      } catch {
        /* sidecar briefly down — keep the last snapshot */
      }
    };
    void pull();
    const id = setInterval(() => void pull(), 3500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div
      data-tour="agent-feed"
      className="relative overflow-hidden rounded-[16px] border border-white/10 bg-night-2 shadow-[0_2px_4px_rgba(0,0,0,0.5),0_40px_85px_-45px_rgba(0,0,0,0.85)]"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.045] via-transparent to-white/[0.015]"
      />
      <span aria-hidden="true" className="lit-top pointer-events-none absolute inset-x-0 top-0 h-px" />

      {/* Chrome — the same console as the landing's live run, one desk over */}
      <div className="relative flex items-center justify-between gap-3 border-b border-white/[0.09] px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-ink-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-ink-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />
          </span>
          <span className="type-micro text-ink-200">Agent activity</span>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-brand-500/50 bg-brand-600/15 px-2 py-0.5 font-code text-[9px] font-bold tracking-[0.18em] text-brand-300">
          <span className="animate-pulse-dot h-1.5 w-1.5 rounded-full bg-brand-400" aria-hidden="true" />
          LIVE
        </span>
      </div>

      <div className="relative">
        <div
          data-tour="agent-feed-stream"
          className="mask-tail h-[248px] overflow-hidden px-5 py-4 font-code text-[11px] leading-[2] sm:text-[11.5px]"
          role="img"
          aria-label="Live agent activity log"
        >
          {feed.map((line, i) => (
            <p
              key={`${i}-${line.text}`}
              className={cn(
                "grid grid-cols-[1.1rem_1fr] gap-x-2",
                line.kind === "step" && "text-white/55",
                line.kind === "ok" && "font-semibold text-white",
                line.kind === "gate" && "text-brand-300"
              )}
            >
              <span className="text-right text-white/30 tabular" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="truncate">{line.text}</span>
            </p>
          ))}
          {feed.length === 0 && <p className="text-white/55">▸ waiting for the agent&apos;s first step…</p>}
        </div>
        <p
          aria-hidden="true"
          className="pointer-events-none absolute bottom-3 left-5 flex items-center gap-2 font-code text-[12px] text-brand-400"
        >
          <span>$</span>
          <span className="animate-caret-blink inline-block h-3.5 w-[7px] bg-brand-400/90" />
        </p>
      </div>

      {/* Footer — what the tail is, so the panel is never just decoration */}
      <div className="relative flex items-center justify-between gap-3 border-t border-white/[0.09] bg-white/[0.03] px-5 py-3">
        <p className="type-micro text-white/55">quorum-mcp · tail</p>
        <p className="type-micro text-white/50">Every tool call logged</p>
      </div>
    </div>
  );
}

/* ── Small pieces ────────────────────────────────────────────────────────── */

/* One chip vocabulary for every run state — same height, same tracking, same
   signal colour meaning as the rest of the product. */
function StatusChip({ status }: { status: RunStatus }) {
  const base =
    "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 font-code text-[8.5px] font-bold tracking-[0.16em] tabular";
  if (status === "running")
    return (
      <span
        className={cn(
          base,
          "border-brand-500/30 bg-brand-50 text-brand-700 dark:border-brand-500/35 dark:bg-brand-500/10 dark:text-brand-300"
        )}
      >
        <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-600" />
        </span>
        IN PROGRESS
      </span>
    );
  if (status === "queued")
    return (
      <span
        className={cn(
          base,
          "border-ink-200 bg-white text-ink-500 dark:border-white/10 dark:bg-white/[0.04]"
        )}
      >
        QUEUED
      </span>
    );
  if (status === "gate")
    return (
      <span
        className={cn(
          base,
          "border-brand-500/40 text-brand-700 transition-colors hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/10"
        )}
      >
        <Gavel className="h-2.5 w-2.5" aria-hidden="true" />
        NEEDS APPROVAL
      </span>
    );
  return (
    <span
      className={cn(
        base,
        "border-ink-950 bg-ink-950 text-white dark:border-white/15 dark:bg-white/10"
      )}
    >
      <CircleCheck className="h-2.5 w-2.5" aria-hidden="true" />
      COMPLETED
    </span>
  );
}

function Spark({ data, tone = "ink" }: { data: number[]; tone?: "ink" | "brand" }) {
  return (
    <div className="flex h-8 items-end gap-[3px]" aria-hidden="true">
      {data.map((h, i) => (
        <motion.span
          key={i}
          initial={{ height: 2 }}
          animate={{ height: `${h}%` }}
          transition={{ duration: 0.7, delay: 0.5 + i * 0.045, ease: EASE }}
          className={cn("w-[4px] rounded-full", tone === "ink" ? "bg-ink-200" : "bg-brand-200")}
        />
      ))}
    </div>
  );
}

function StatCard({
  index,
  label,
  value,
  suffix,
  sub,
  spark,
  featured,
  pulse,
  delay,
}: {
  /* The cell's own number in the band — the same spec-sheet indexing the
     landing's contract table uses, so the two read as one system. */
  index: string;
  label: string;
  value: number;
  suffix?: string;
  sub: string;
  /* Optional: only rendered when real trend data exists — never a constant
     standing in for data the system does not have. */
  spark?: number[];
  featured?: boolean;
  pulse?: boolean;
  delay: number;
}) {
  const n = useCountUp(value);
  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay, ease: EASE }}
      className={cn(
        /* Flat editorial cell — the stat band wrapper owns the frame, the
           hairlines, the rounding and the elevation. The featured cell keeps
           the light surface by day and earns its weight from the brand rule,
           the pulse and the red suffix; only after dark does it go night. */
        "relative h-full overflow-hidden p-5 transition-colors duration-300 lg:p-6",
        featured
          ? "bg-paper text-ink-950 dark:bg-night dark:text-white"
          : "bg-paper hover:bg-white dark:hover:bg-white/[0.03]"
      )}
    >
      {featured && (
        <>
          <div className="bg-grid-dark pointer-events-none absolute inset-0 hidden opacity-60 dark:block" aria-hidden="true" />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-600/70 to-transparent dark:via-brand-500/70"
          />
        </>
      )}
      <div className="relative flex h-full flex-col">
        <div className="flex items-center justify-between gap-2">
          <p className={cn("type-micro text-ink-400", featured && "dark:text-ink-300")}>
            {index} · {label}
          </p>
          {pulse && (
            <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
            </span>
          )}
        </div>
        <p className="type-num mt-5 flex items-baseline gap-1 text-[42px] lg:text-[46px]">
          {n}
          {suffix && (
            <span className={cn("text-[24px] text-brand-600", featured && "dark:text-brand-400")}>
              {suffix}
            </span>
          )}
        </p>
        <div className="mt-auto flex items-end justify-between gap-3 pt-5">
          <p className={cn("type-micro leading-[1.9] text-ink-500", featured && "dark:text-ink-400")}>
            {sub}
          </p>
          {spark && <Spark data={spark} tone={featured ? "brand" : "ink"} />}
        </div>
      </div>
    </motion.div>
  );
}

/* ── New-run wizard: brief → documents → scope ───────────────────────────── */

const WIZARD_STEPS = ["DETAILS", "DOCUMENTS", "SCOPE"] as const;

type StagedDoc = {
  id: string;
  name: string;
  size: string;
  status: "RECEIVED" | "PARSING" | "INDEXED";
  /* R2 mirror state — present only for uploaded files. SYNCING → CLOUD | LOCAL. */
  storage?: "SYNCING" | "CLOUD" | "LOCAL";
  /* Extraction/staging result, shown under the filename. */
  note?: string;
  /* The stored object (R2 key + tender) — the citation for a signed download. */
  key?: string;
  ref?: string;
};

const SCOPE_CHECKS = [
  { id: "specs", label: "Specs against clinical need", desc: "Every line item read against the clinical requirement." },
  { id: "quantities", label: "Quantities against consumption", desc: "Volumes checked against real offtake, not optimism." },
  { id: "prices", label: "Prices against other buyers", desc: "Unit rates benchmarked across the buyer network." },
] as const;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}


/* ── Tender-reference autofill ─────────────────────────────────────────────
   The reference is ready before the officer types a character. It drafts
   itself three ways, in order of authority: a reference-shaped token in the
   staged pack wins (the documents speak), then the register's own sequence
   continues (KE-MOH-2026-014 → 015, never colliding), then a fresh
   registry-shaped reference for the year. Every draft is labelled inline
   and freely editable — autofill proposes, the officer disposes. */

interface RefSeed {
  prefix: string;
  year: number;
  seq: number;
}

/** Parse a procurement-shaped reference: KE-MOH-2026-014. */
function parseRefSeed(raw: string): RefSeed | null {
  const m = raw.trim().toUpperCase().match(/^([A-Z]{2,10})-([A-Z0-9]{2,10})-(\d{4})-(\d{1,6})$/);
  if (!m) return null;
  return { prefix: `${m[1]}-${m[2]}`, year: Number(m[3]), seq: Number(m[4]) };
}

function formatRefSeed(seed: RefSeed): string {
  return `${seed.prefix}-${seed.year}-${String(seed.seq).padStart(3, "0")}`;
}

/** The highest sequence per prefix across the register. */
function latestRefSeed(refs: string[]): RefSeed | null {
  let best: RefSeed | null = null;
  for (const raw of refs) {
    const seed = parseRefSeed(raw);
    if (!seed) continue;
    if (!best || seed.year > best.year || (seed.year === best.year && seed.seq > best.seq)) best = seed;
  }
  return best;
}

/** Next in the register's sequence — skipping any reference already taken. */
function nextRefFrom(refs: string[], now = new Date()): string | null {
  const latest = latestRefSeed(refs);
  if (!latest) return null;
  /* A new procurement year resets the sequence to 001, prefix intact. */
  let seed: RefSeed = latest.year < now.getFullYear() ? { ...latest, year: now.getFullYear(), seq: 0 } : { ...latest };
  const taken = new Set(refs.map((r) => r.trim().toUpperCase()));
  do {
    seed = { ...seed, seq: seed.seq + 1 };
  } while (taken.has(formatRefSeed(seed)) && seed.seq < 9999);
  return formatRefSeed(seed);
}

/** A fresh registry-shaped reference when the register has none to continue. */
function freshRef(now = new Date()): string {
  return formatRefSeed({ prefix: "KE-MOH", year: now.getFullYear(), seq: 1 });
}

/** A reference-shaped token inside a staged filename claims the field. */
function extractRef(names: string[]): string | null {
  for (const name of names) {
    /* Negative lookahead, not \b — an underscore after the token is still a
       boundary ("KE-MOH-2026-021_bid.pdf" must match). */
    const m = name.toUpperCase().match(/([A-Z]{2,10}-[A-Z0-9]{2,10}-\d{4}-\d{1,6})(?![A-Z0-9])/);
    if (m) return m[1];
  }
  return null;
}

/** Draft the tender title from the first staged filename worth reading. */
function draftTitleFrom(names: string[]): string | null {
  for (const name of names) {
    const cleaned = name
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[A-Z]{2,10}-[A-Z0-9]{2,10}-\d{4}-\d{1,6}/gi, " ")
      .replace(/[_\-.]+/g, " ")
      .replace(/\b\d{4}\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length < 4) continue;
    return cleaned.replace(/(^|\s|["'(])([a-z])/g, (_match: string, sep: string, ch: string) => sep + ch.toUpperCase());
  }
  return null;
}

function DocStatusChip({ status }: { status: StagedDoc["status"] }) {
  if (status === "INDEXED")
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ink-950 px-2 py-0.5 font-code text-[7.5px] font-bold tracking-[0.14em] text-white">
        <CircleCheck className="h-2.5 w-2.5" aria-hidden="true" />
        INDEXED
      </span>
    );
  if (status === "PARSING")
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand-50 px-2 py-0.5 font-code text-[7.5px] font-bold tracking-[0.14em] text-brand-700">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" aria-hidden="true" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-600" aria-hidden="true" />
        </span>
        PARSING
      </span>
    );
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-ink-200 px-2 py-0.5 font-code text-[7.5px] font-bold tracking-[0.14em] text-ink-400">
      RECEIVED
    </span>
  );
}

/* Storage chip for real uploads — Cloudflare R2 through the edge gate when
   it accepts the file, the local vault when it doesn't. Never an error. */
function StorageChip({ storage }: { storage: NonNullable<StagedDoc["storage"]> }) {
  if (storage === "SYNCING")
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 font-code text-[7.5px] font-bold tracking-[0.14em] text-brand-700">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" aria-hidden="true" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-600" aria-hidden="true" />
        </span>
        SYNC
      </span>
    );
  if (storage === "CLOUD")
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ink-200 bg-white px-2 py-0.5 font-code text-[7.5px] font-bold tracking-[0.14em] text-ink-600">
        <CloudUpload className="h-2.5 w-2.5" aria-hidden="true" />
        R2
      </span>
    );
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ink-200 bg-white px-2 py-0.5 font-code text-[7.5px] font-bold tracking-[0.14em] text-ink-400">
      <HardDrive className="h-2.5 w-2.5" aria-hidden="true" />
      VAULT
    </span>
  );
}

function NewRunModal({
  open,
  onClose,
  onLaunch,
  pastRefs = [],
  canDeleteDocs = false,
}: {
  open: boolean;
  onClose: () => void;
  onLaunch: (ref: string, title: string, format: string, docs: number, checks: number) => void;
  /* The register's references — the sequence the draft continues. */
  pastRefs?: string[];
  /* Operator capability: removing an R2 object, enforced again by the route. */
  canDeleteDocs?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [ref, setRef] = useState("");
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState("OCDS");
  const [docs, setDocs] = useState<StagedDoc[]>([]);
  /* Bumped after each successful R2 upload so the stored-document browser
     re-reads the tender's prefix instead of waiting for a page reload. */
  const [storedVersion, setStoredVersion] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [checks, setChecks] = useState<Record<string, boolean>>({ specs: true, quantities: true, prices: true });
  const [detailsError, setDetailsError] = useState("");
  const [launchError, setLaunchError] = useState("");
  const [launching, setLaunching] = useState(false);
  /* Sample tenders — comprehensive packs shipped with the agent stack. */
  const [samples, setSamples] = useState<SampleTenderRow[]>([]);
  const [samplesOpen, setSamplesOpen] = useState(false);
  const [previewSample, setPreviewSample] = useState<TenderPackRow | null>(null);
  /* Where the current ref/title draft came from — shown inline, cleared the
     moment the officer edits (then it's theirs, not a suggestion). */
  const [refSource, setRefSource] = useState<"" | "sequence" | "fresh" | "document" | "sample">("");
  const [titleSource, setTitleSource] = useState<"" | "document" | "sample">("");
  const titleTouchedRef = useRef(false);
  const refInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docsRef = useRef<StagedDoc[]>([]);
  const filesRef = useRef<Map<string, File>>(new Map());
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  /* Every fresh open is a fresh tender: back to step one, no pack staged.
     The register's references arrive through a ref so a mid-session refresh
     never re-runs this effect and never stomps a wizard in progress. */
  const pastRefsRef = useRef(pastRefs);
  pastRefsRef.current = pastRefs;
  useEffect(() => {
    if (!open) return;
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    docsRef.current = [];
    filesRef.current.clear();
    const id = requestAnimationFrame(() => {
      setStep(0);
      setRef("");
      setTitle("");
      setRefSource("");
      setTitleSource("");
      setFormat("OCDS");
      setDocs([]);
      setDragging(false);
      setChecks({ specs: true, quantities: true, prices: true });
      setDetailsError("");
      setLaunchError("");
      setLaunching(false);
      setSamplesOpen(false);
      titleTouchedRef.current = false;
      /* Autofill the reference the instant the modal opens — the register's
         sequence continues itself; a fresh registry shape when there is none. */
      const refs = pastRefsRef.current;
      const next = nextRefFrom(refs);
      setRef(next ?? freshRef());
      setRefSource(next ? "sequence" : "fresh");
      refInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  /* The sample registry loads with the modal — real packs the stack can run. */
  useEffect(() => {
    if (!open || samples.length > 0) return;
    fetch("/api/sample-tenders?XTransformPort=3031")
      .then((x) => x.json())
      .then((d) =>
        setSamples(
          ((d.samples ?? []) as SampleTenderRow[]).map((s) => ({
            ...s,
            /* A pack without a readable file list still renders; the reader
               says no document is selected instead of crashing on `.map`. */
            files: Array.isArray(s.files) ? s.files : [],
          }))
        )
      )
      .catch(() => setSamples([]));
  }, [open, samples.length]);

  /* Escape closes; pending parse timers die with the modal. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !launching) onClose();
    };
    window.addEventListener("keydown", onKey);
    const timers = timersRef.current;
    return () => {
      window.removeEventListener("keydown", onKey);
      timers.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [open, onClose, launching]);

  /* The ingestion pipeline every staged document walks:
     RECEIVED → PARSING → INDEXED — visible, never silent. */
  const runPipeline = (fresh: StagedDoc[]) => {
    fresh.forEach((d, idx) => {
      timersRef.current.push(
        setTimeout(() => {
          setDocs((cur) => cur.map((x) => (x.id === d.id ? { ...x, status: "PARSING" } : x)));
        }, 420 + idx * 340)
      );
      timersRef.current.push(
        setTimeout(() => {
          setDocs((cur) => cur.map((x) => (x.id === d.id ? { ...x, status: "INDEXED" } : x)));
        }, 1450 + idx * 340)
      );
    });
  };

  /* Documents outrank the register: a reference-shaped token in a staged
     filename claims the field instantly — the pack identifies its own tender. */
  const adoptFromDocs = (names: string[]) => {
    const docRef = extractRef(names);
    if (docRef) {
      setRef(docRef);
      setRefSource("document");
      setDetailsError("");
    }
    if (!titleTouchedRef.current) {
      const draft = draftTitleFrom(names);
      if (draft) {
        setTitle(draft);
        setTitleSource("document");
      }
    }
  };

  /* A sample tender stages itself: reference, title, format and the pack —
     the files behind it are real documents the review graph will read. */
  const stageSample = (s: SampleTenderRow) => {
    setRef(s.ref);
    setRefSource("sample");
    setTitle(s.title);
    setTitleSource("sample");
    setFormat(s.format);
    setDetailsError("");
    const staged: StagedDoc[] = s.files.map((name, i) => ({
      id: `sample-${s.ref}-${i}-${name}`,
      name,
      size: "PACK",
      status: "INDEXED" as const,
    }));
    docsRef.current = staged;
    filesRef.current.clear();
    setDocs(staged);
    setSamplesOpen(false);
  };

  const addDocs = (items: { name: string; size: string; file?: File }[]) => {
    const seen = new Set(docsRef.current.map((d) => d.name));
    const fresh = items
      .filter((i) => !seen.has(i.name))
      .slice(0, 12)
      .map((i, idx) => {
        const id = `doc-${Date.now()}-${idx}-${i.name}`;
        if (i.file) filesRef.current.set(id, i.file);
        return {
          id,
          name: i.name,
          size: i.size,
          status: "RECEIVED" as const,
        };
      });
    if (fresh.length === 0) return [];
    docsRef.current = [...docsRef.current, ...fresh];
    setDocs(docsRef.current);
    runPipeline(fresh);
    return fresh;
  };

  const stageLocalFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const fresh = addDocs(
      Array.from(list).map((f) => ({ name: f.name, size: formatBytes(f.size), file: f }))
    );
    /* The staged pack speaks for the tender — adopt its reference and title. */
    adoptFromDocs(fresh.map((d) => d.name));
    /* Every real file is stored in Cloudflare R2 through the edge gate in
       parallel with the ingestion pipeline. The edge secret stays on the
       server; if the gate is unreachable the document stays in the local
       vault — never an error. Use the reference the pack itself adopted,
       not a stale state read. */
    const uploadRef = extractRef(fresh.map((d) => d.name)) ?? (ref.trim() || "UNREFERENCED");
    fresh.forEach((d) => {
      const file = filesRef.current.get(d.id);
      if (!file) return;
      setDocs((cur) => cur.map((x) => (x.id === d.id ? { ...x, storage: "SYNCING" } : x)));
      void uploadTenderDocument(uploadRef, file).then((result) => {
        const pages = result?.pages
          ? ` · ${result.pages} PAGE${result.pages === 1 ? "" : "S"}`
          : result?.sheets?.length
            ? ` · ${result.sheets.length} SHEET${result.sheets.length === 1 ? "" : "S"}`
            : "";
        const auditTag = result
          ? result.audited
            ? result.audit?.seq
              ? ` · AUDIT #${result.audit.seq}`
              : " · AUDITED"
            : result.auditReason
              ? ` · AUDIT NOT RECORDED — ${result.auditReason}`
              : " · AUDIT NOT RECORDED"
          : "";
        const note = result
          ? (result.staged
              ? `STAGED AS ${(result.kind ?? "doc").toUpperCase()}${pages}${result.note ? ` · ${result.note}` : ""}`
              : result.reason ?? result.note ?? "STORED IN R2 — NOT STAGED FOR REVIEW") + auditTag
          : "KEPT IN THE LOCAL VAULT — R2 GATE UNAVAILABLE";
        setDocs((cur) =>
          cur.map((x) =>
            x.id === d.id
              ? {
                  ...x,
                  storage: result ? "CLOUD" : "LOCAL",
                  note,
                  key: result?.key,
                  ref: result?.key ? uploadRef : undefined,
                }
              : x
          )
        );
        if (result?.key) setStoredVersion((v) => v + 1);
      });
    });
  };

  const indexed = docs.filter((d) => d.status === "INDEXED").length;
  const cloudSynced = docs.filter((d) => d.storage === "CLOUD").length;
  const checksOn = SCOPE_CHECKS.filter((c) => checks[c.id]).length;
  const canLeaveDocs = docs.length > 0 && indexed === docs.length;
  /* Review time scales with the checks chosen: 3 checks ≈ 11 min. */
  const estMinutes = 2 + 3 * checksOn;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="fixed inset-0 z-[80] grid place-items-center bg-night/70 p-4 backdrop-blur-sm"
          onClick={() => {
            if (!launching) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-evaluation-title"
            initial={{ opacity: 0, y: 26, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.98 }}
            transition={{ duration: 0.32, ease: EASE }}
            className="max-h-[min(92dvh,900px)] w-full max-w-3xl overflow-y-auto rounded-[12px] panel panel-lift p-5 sm:rounded-[16px] sm:p-8 lg:p-10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-2.5 font-code text-[9px] font-semibold uppercase tracking-[0.28em] text-ink-500">
                  <span className="inline-block h-[2px] w-6 bg-brand-600" aria-hidden="true" />
                  LAUNCH AN EVALUATION
                </p>
                <h2 id="new-evaluation-title" className="mt-3 font-display text-[28px] font-black tracking-[-0.035em] text-ink-950 sm:text-[36px]">
                  New evaluation<span className="text-brand-600">.</span>
                </h2>
                <p className="mt-1.5 max-w-lg text-[12.5px] leading-relaxed text-ink-500 sm:text-[13px]">
                  Set the tender, stage its source documents, and choose what the review should verify.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!launching) onClose();
                }}
                disabled={launching}
                aria-label="Close"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-ink-200 text-ink-500 transition-colors hover:border-ink-400 hover:bg-ink-50 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-50 sm:h-12 sm:w-12"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* Step rail — 01 details · 02 documents · 03 scope */}
            <div data-tour="wiz-rail" className="mt-6 rounded-[10px] border border-ink-100 bg-paper/70 px-3 py-3 sm:mt-7 sm:px-5 sm:py-4">
              <ol className="flex items-center gap-2 sm:gap-3" aria-label="Evaluation setup, three steps">
              {WIZARD_STEPS.map((label, i) => {
                const state = i === step ? "current" : i < step ? "done" : "todo";
                return (
                  <li key={label} className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                    <button
                      type="button"
                      onClick={() => i <= step && setStep(i)}
                      disabled={i > step}
                      aria-current={state === "current" ? "step" : undefined}
                      className={cn(
                        "flex min-w-0 items-center gap-1.5 font-code text-[8px] font-bold tracking-[0.12em] transition-colors sm:gap-2 sm:text-[9px] sm:tracking-[0.16em]",
                        state === "current" && "text-brand-700",
                        state === "done" && "text-ink-900 hover:text-brand-700",
                        state === "todo" && "cursor-default text-ink-400"
                      )}
                    >
                      {state === "done" ? (
                        <CircleCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
                      ) : (
                        <span
                          className={cn(
                            "grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[7.5px]",
                            state === "current" && "border-brand-600 bg-brand-50 text-brand-700",
                            state === "todo" && "border-ink-200 text-ink-400"
                          )}
                          aria-hidden="true"
                        >
                          {i + 1}
                        </span>
                      )}
                      <span className="truncate">
                        0{i + 1} {label}
                      </span>
                    </button>
                    {i < WIZARD_STEPS.length - 1 && (
                      <span className={cn("h-px flex-1", i < step ? "bg-ink-950" : "bg-ink-100")} aria-hidden="true" />
                    )}
                  </li>
                );
              })}
              </ol>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-ink-100" aria-hidden="true">
                <motion.div
                  className="h-full rounded-full bg-brand-600"
                  initial={false}
                  animate={{ width: `${((step + 1) / WIZARD_STEPS.length) * 100}%` }}
                  transition={{ duration: 0.35, ease: EASE }}
                />
              </div>
            </div>

            <form
              data-tour="wiz-body"
              className="mt-6 sm:mt-7"
              onSubmit={async (e) => {
                e.preventDefault();
                if (step < 2) {
                  if (step === 0 && (!ref.trim() || !title.trim())) {
                    setDetailsError("Add both the tender reference and its published title to continue.");
                    if (!ref.trim()) refInputRef.current?.focus();
                    return;
                  }
                  if (step === 1 && !canLeaveDocs) return;
                  setStep(step + 1);
                  setLaunchError("");
                  return;
                }
                if (checksOn === 0 || launching) return;
                setLaunching(true);
                setLaunchError("");
                try {
                  await onLaunch(ref.trim(), title.trim(), format, docs.length, checksOn);
                } catch (error) {
                  setLaunchError(error instanceof Error ? error.message : "The run could not be launched. Please try again.");
                } finally {
                  setLaunching(false);
                }
              }}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 18 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -14 }}
                  transition={{ duration: 0.24, ease: EASE }}
                  className="space-y-5 sm:space-y-6"
                >
                  {step === 0 && (
                    <>
                      <div className="rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3">
                        <p className="font-code text-[8px] font-bold tracking-[0.18em] text-brand-700">01 / TENDER DETAILS</p>
                        <p className="mt-1 text-[12px] leading-relaxed text-ink-600">Identify the procurement record the committee and audit trail will refer to.</p>
                      </div>
                      <div>
                        <label htmlFor="nr-ref" className="mb-1.5 block font-code text-[9px] font-semibold tracking-[0.18em] text-ink-500">
                          TENDER REFERENCE <span className="text-brand-600" aria-hidden="true">*</span>
                        </label>
                        <input
                          id="nr-ref"
                          ref={refInputRef}
                          type="text"
                          value={ref}
                          readOnly
                          aria-readonly="true"
                          placeholder="e.g. KE-MOH-2026-014"
                          autoComplete="off"
                          aria-required="true"
                          aria-invalid={Boolean(detailsError && !ref.trim())}
                          className="h-12 w-full rounded-xl border border-ink-200 bg-white px-4 font-code text-[13px] tracking-[0.04em] text-ink-900 outline-none transition-all placeholder:font-sans placeholder:tracking-normal placeholder:text-ink-400 read-only:cursor-default read-only:focus:ring-0 read-only:focus:ring-offset-0 sm:h-[52px]"
                        />
                        {refSource !== "" && !detailsError && (
                          <p className="mt-1.5 flex items-center gap-1.5 font-code text-[8px] tracking-[0.14em] text-ink-400" aria-live="polite">
                            <CircleCheck className="h-2.5 w-2.5 text-brand-600" aria-hidden="true" />
                            {refSource === "sequence" && "ASSIGNED BY QUORUM — CONTINUES YOUR REFERENCE SEQUENCE · LOCKED"}
                            {refSource === "fresh" && "ASSIGNED BY QUORUM — NEW REFERENCE SEQUENCE · LOCKED"}
                            {refSource === "document" && "READ FROM THE STAGED PACK · LOCKED"}
                            {refSource === "sample" && "SAMPLE PACK — LOADED FROM THE BUILT-IN PACKS · LOCKED"}
                          </p>
                        )}
                      </div>
                      <div>
                        <label htmlFor="nr-title" className="mb-1.5 block font-code text-[9px] font-semibold tracking-[0.18em] text-ink-500">
                          PUBLISHED TENDER TITLE <span className="text-brand-600" aria-hidden="true">*</span>
                        </label>
                        <input
                          id="nr-title"
                          type="text"
                          value={title}
                          onChange={(e) => {
                            titleTouchedRef.current = true;
                            setTitle(e.target.value);
                            setTitleSource("");
                            setDetailsError("");
                          }}
                          placeholder="Use the title exactly as published"
                          aria-required="true"
                          aria-invalid={Boolean(detailsError && !title.trim())}
                          className="h-12 w-full rounded-xl border border-ink-200 bg-white px-4 text-[13.5px] text-ink-900 outline-none transition-all placeholder:text-ink-400 focus:border-ink-950 focus:ring-2 focus:ring-ink-950/10 sm:h-[52px]"
                        />
                        {titleSource === "sample" && (
                          <p className="mt-1.5 flex items-center gap-1.5 font-code text-[8px] tracking-[0.14em] text-ink-400" aria-live="polite">
                            <CircleCheck className="h-2.5 w-2.5 text-brand-600" aria-hidden="true" />
                            SAMPLE PACK TITLE — LOADED · EDIT FREELY
                          </p>
                        )}
                        {titleSource === "document" && (
                          <p className="mt-1.5 flex items-center gap-1.5 font-code text-[8px] tracking-[0.14em] text-ink-400" aria-live="polite">
                            <CircleCheck className="h-2.5 w-2.5 text-brand-600" aria-hidden="true" />
                            DRAFTED FROM THE STAGED PACK — REPLACE WITH THE PUBLISHED TITLE
                          </p>
                        )}
                      </div>
                      <div>
                        <div className="mb-2 flex items-end justify-between gap-3">
                          <div>
                            <p className="font-code text-[9px] font-semibold tracking-[0.18em] text-ink-500">SOURCE FORMAT</p>
                            <p className="mt-1 text-[11.5px] text-ink-400">Choose the format of the original procurement record.</p>
                          </div>
                          <span className="font-code text-[8px] tracking-[0.12em] text-ink-400">REQUIRED</span>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3" role="group" aria-label="Source format">
                          {["OCDS", "PDF PACK", "EMAIL BAG"].map((f) => (
                            <button
                              key={f}
                              type="button"
                              onClick={() => setFormat(f)}
                              aria-pressed={format === f}
                              className={cn(
                                "flex min-h-12 items-center justify-center gap-2 rounded-xl border px-3 font-code text-[9px] font-bold tracking-[0.12em] transition-all sm:min-h-[54px] sm:text-[9.5px] sm:tracking-[0.14em]",
                                format === f
                                  ? "border-ink-950 bg-ink-950 text-white shadow-[0_6px_16px_rgba(11,12,15,0.14)]"
                                  : "border-ink-200 bg-white text-ink-500 hover:border-ink-400 hover:bg-paper"
                              )}
                            >
                              {format === f && <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                              {f}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* SAMPLE TENDER — one click stages a real evaluation pack */}
                      <div>
                        <button
                          type="button"
                          onClick={() => setSamplesOpen(!samplesOpen)}
                          aria-expanded={samplesOpen}
                          className="flex w-full items-center justify-between gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3 transition-colors hover:border-ink-400"
                        >
                          <span className="flex items-center gap-2.5">
                            <BookOpen className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" />
                            <span className="font-code text-[9px] font-bold tracking-[0.18em] text-ink-900">SAMPLE TENDER</span>
                          </span>
                          <span className="flex items-center gap-2 font-code text-[8px] tracking-[0.14em] text-ink-400">
                            {samples.length > 0 && `${samples.length} PACKS`}
                            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-300", samplesOpen && "rotate-180")} aria-hidden="true" />
                          </span>
                        </button>
                        <p className="mt-1.5 text-[11.5px] text-ink-400">
                          Real, comprehensive packs shipped with the stack — pick one and the review runs the agent’s own documents.
                        </p>
                        {samplesOpen && (
                          <div className="mt-2.5 space-y-2 rounded-xl border border-ink-100 bg-paper/60 p-2.5" role="list" aria-label="Sample tenders">
                            {samples.length === 0 && (
                              <p className="px-2 py-3 text-center font-code text-[9px] tracking-[0.14em] text-ink-400">
                                SAMPLE PACKS COULDN’T BE LOADED — CHECK THAT THE AGENT SERVICE IS RUNNING
                              </p>
                            )}
                            {samples.map((s) => (
                              <div
                                key={s.ref}
                                role="listitem"
                                className="block w-full rounded-lg border border-ink-100 bg-white px-3.5 py-3 transition-all hover:border-brand-400 hover:shadow-[0_2px_10px_rgba(217,38,22,0.07)]"
                              >
                                <span className="flex flex-wrap items-center gap-2">
                                  <span className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-950">{s.ref}</span>
                                  <span className="rounded-full bg-ink-950 px-2 py-0.5 font-code text-[7px] font-bold tracking-[0.14em] text-white">{s.sector}</span>
                                  <span className="ml-auto font-code text-[7.5px] tracking-[0.12em] text-ink-400">{s.budget} · {s.bids} BIDS</span>
                                </span>
                                <span className="mt-1 block truncate text-[12.5px] font-medium text-ink-800">{s.title}</span>
                                <span className="mt-1 block text-[11.5px] leading-relaxed text-ink-500">{s.challenges}</span>
                                <span className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setPreviewSample(s)}
                                    aria-label={`Preview the full contents of tender pack ${s.ref}`}
                                    className="flex items-center gap-1.5 rounded-md border border-ink-200 px-2.5 py-1.5 font-code text-[7.5px] font-bold tracking-[0.14em] text-ink-700 transition-colors hover:border-ink-500 hover:bg-ink-50"
                                  >
                                    <Eye className="h-3 w-3" aria-hidden="true" />
                                    PREVIEW PACK
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => stageSample(s)}
                                    className="flex items-center gap-1.5 font-code text-[7.5px] font-bold tracking-[0.14em] text-brand-700 transition-colors hover:text-brand-600"
                                  >
                                    <Plus className="h-2.5 w-2.5" aria-hidden="true" />
                                    STAGE THIS PACK
                                  </button>
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {detailsError && <p role="alert" className="rounded-lg bg-brand-50 px-3.5 py-2.5 text-[12px] font-medium text-brand-800">{detailsError}</p>}
                      <TenderPackPreview
                        sample={previewSample}
                        onClose={() => setPreviewSample(null)}
                        onStage={(s) => {
                          stageSample(s);
                          setPreviewSample(null);
                        }}
                      />
                    </>
                  )}

                  {step === 1 && (
                    <>
                      <div className="rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3">
                        <p className="font-code text-[8px] font-bold tracking-[0.18em] text-brand-700">02 / SOURCE DOCUMENTS</p>
                        <p className="mt-1 text-[12px] leading-relaxed text-ink-600">Add the tender notice and bid pack. We’ll index each file before the review begins.</p>
                      </div>
                      <div>
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="font-code text-[9px] font-semibold tracking-[0.18em] text-ink-500">TENDER PACK</p>
                          <p className="font-code text-[8.5px] tracking-[0.14em] text-ink-400" aria-live="polite">
                            {docs.length === 0
                              ? "NO DOCUMENTS STAGED"
                              : `INDEXED ${indexed} OF ${docs.length}${cloudSynced > 0 ? ` · ${cloudSynced} R2` : ""}`}
                          </p>
                        </div>
                        <div
                          onDragOver={(e) => {
                            e.preventDefault();
                            setDragging(true);
                          }}
                          onDragLeave={() => setDragging(false)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDragging(false);
                            stageLocalFiles(e.dataTransfer.files);
                          }}
                          aria-label="Tender document upload area"
                          className={cn(
                            "relative mt-2 grid min-h-40 place-items-center rounded-[10px] border-2 border-dashed px-4 py-7 text-center transition-all sm:min-h-48 sm:py-9",
                            dragging ? "scale-[1.005] border-brand-500 bg-brand-50 shadow-[0_0_0_4px_rgba(217,38,22,0.06)]" : "border-ink-200 bg-paper/60 hover:border-ink-400 hover:bg-paper"
                          )}
                        >
                          <input
                            ref={fileInputRef}
                            id="nr-files"
                            type="file"
                            multiple
                            accept=".pdf,.json,.zip,.xlsx,.csv,.docx,.eml"
                            className="sr-only"
                            onChange={(e) => {
                              stageLocalFiles(e.target.files);
                              e.target.value = "";
                            }}
                          />
                          <span className={cn("grid h-11 w-11 place-items-center rounded-xl transition-colors", dragging ? "bg-brand-100" : "bg-white shadow-sm")}>
                            <FileUp className={cn("h-5 w-5", dragging ? "text-brand-600" : "text-ink-400")} aria-hidden="true" />
                          </span>
                          <p className="mt-3 text-[14px] font-semibold text-ink-900">Drop the tender pack here</p>
                          <p className="mt-1 text-[12px] text-ink-500">or browse files from your device</p>
                          <p className="mt-2 font-code text-[8px] tracking-[0.14em] text-ink-400">
                            NOTICE · BIDS · OCDS JSON · PRICE SCHEDULES · EMAILS — UP TO 12 FILES
                          </p>
                          <p className="mt-1.5 font-code text-[7.5px] tracking-[0.12em] text-ink-400">
                            REAL FILES STORE IN CLOUDFLARE R2 · EDGE-GATED · 10 MB EACH
                          </p>
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-ink-950 px-4 font-code text-[9px] font-bold tracking-[0.14em] text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                          >
                            <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
                            BROWSE FILES
                          </button>
                        </div>
                      </div>
                      {docs.length > 0 && (
                        <div>
                          <div
                            className="h-1 w-full overflow-hidden rounded-full bg-ink-100"
                            role="progressbar"
                            aria-label="Documents indexed"
                            aria-valuemin={0}
                            aria-valuemax={docs.length}
                            aria-valuenow={indexed}
                          >
                            <motion.div
                              className="h-full rounded-full bg-brand-600"
                              initial={false}
                              animate={{ width: `${(indexed / docs.length) * 100}%` }}
                              transition={{ duration: 0.5, ease: EASE }}
                            />
                          </div>
                          <ul className="mt-2.5 max-h-40 space-y-1.5 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-ink-200 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1">
                            {docs.map((d) => (
                              <li key={d.id} className="flex items-center gap-2.5 rounded-xl border border-ink-100 bg-white px-3 py-2.5">
                                <FileText className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden="true" />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[12px] font-medium text-ink-800">{d.name}</span>
                                  {d.note && (
                                    <span className="mt-0.5 block truncate font-code text-[7.5px] tracking-[0.08em] text-ink-400">{d.note}</span>
                                  )}
                                </span>
                                <span className="shrink-0 font-code text-[8px] tracking-[0.08em] text-ink-400">{d.size}</span>
                                <DocStatusChip status={d.status} />
                                {d.storage && <StorageChip storage={d.storage} />}
                                {d.key && d.ref && (
                                  <button
                                    type="button"
                                    aria-label={`Download ${d.name}`}
                                    onClick={() => {
                                      const key = d.key;
                                      const docRef = d.ref;
                                      if (!key || !docRef) return;
                                      void signedTenderDownloadUrl(docRef, key).then((url) => {
                                        if (!url) return;
                                        const a = document.createElement("a");
                                        a.href = url;
                                        a.download = d.name;
                                        a.rel = "noopener";
                                        a.click();
                                      });
                                    }}
                                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-400 transition-colors hover:bg-brand-50 hover:text-brand-700"
                                  >
                                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  aria-label={`Remove ${d.name}`}
                                  onClick={() => {
                                    filesRef.current.delete(d.id);
                                    docsRef.current = docsRef.current.filter((item) => item.id !== d.id);
                                    setDocs(docsRef.current);
                                  }}
                                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-400 transition-colors hover:bg-brand-50 hover:text-brand-700"
                                >
                                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {ref.trim() && (
                        <StoredDocsBrowser
                          key={`${ref}:${storedVersion}`}
                          tenderRef={ref}
                          canDelete={canDeleteDocs}
                        />
                      )}
                    </>
                  )}

                  {step === 2 && (
                    <>
                      <div className="rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3">
                        <p className="font-code text-[8px] font-bold tracking-[0.18em] text-brand-700">03 / REVIEW SCOPE</p>
                        <p className="mt-1 text-[12px] leading-relaxed text-ink-600">Choose the checks for this run. Page-level citations remain on for every finding.</p>
                      </div>
                      <div>
                        <p className="font-code text-[9px] font-semibold tracking-[0.18em] text-ink-500">SCOPE OF REVIEW</p>
                        <ul className="mt-2.5 space-y-2">
                          {SCOPE_CHECKS.map((c) => {
                            const on = checks[c.id];
                            return (
                              <li key={c.id}>
                                <button
                                  type="button"
                                  onClick={() => setChecks((prev) => ({ ...prev, [c.id]: !prev[c.id] }))}
                                  aria-pressed={on}
                                  className={cn(
                                    "flex w-full items-start gap-3.5 rounded-[10px] border px-4 py-3.5 text-left transition-all sm:px-5 sm:py-4",
                                    on ? "border-ink-950 bg-paper shadow-[0_2px_8px_rgba(11,12,15,0.04)]" : "border-ink-200 bg-white hover:border-ink-400 hover:bg-paper/60"
                                  )}
                                >
                                  <motion.span
                                    animate={{ scale: on ? 1 : 0.9 }}
                                    transition={{ duration: 0.2, ease: EASE }}
                                    className={cn(
                                      "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border transition-colors",
                                      on ? "border-ink-950 bg-ink-950 text-white" : "border-ink-300 bg-white text-transparent"
                                    )}
                                    aria-hidden="true"
                                  >
                                    <CircleCheck className="h-4 w-4" />
                                  </motion.span>
                                  <span className="min-w-0">
                                    <span className={cn("block text-[14px] font-semibold", on ? "text-ink-950" : "text-ink-600")}>
                                      {c.label}
                                    </span>
                                    <span className="mt-1 block text-[12.5px] leading-relaxed text-ink-500">{c.desc}</span>
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                      <div className="flex items-center gap-3 rounded-xl border border-ink-100 bg-paper px-4 py-3">
                        <Lock className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-semibold text-ink-800">Page-level citations — always on</p>
                          <p className="mt-0.5 font-code text-[8px] tracking-[0.14em] text-ink-400">
                            EVERY CLAIM CARRIES A PAGE, CLAUSE OR REGISTRY ID. NO EXCEPTIONS.
                          </p>
                        </div>
                      </div>
                      <p className="rounded-xl bg-paper px-4 py-3 text-center font-code text-[9px] font-bold tracking-[0.16em] text-ink-700">
                        {docs.length} DOCUMENT{docs.length === 1 ? "" : "S"}
                        {cloudSynced > 0 ? ` · ${cloudSynced} R2` : ""} · {checksOn} CHECK{checksOn === 1 ? "" : "S"} · EST. {estMinutes} MIN
                      </p>
                      {checksOn === 0 && (
                        <p role="status" className="text-center text-[11.5px] text-brand-700">Select at least one review check to launch this run.</p>
                      )}
                    </>
                  )}
                </motion.div>
              </AnimatePresence>

              {/* Footer nav — the wizard always shows the next step */}
              {launchError && (
                <div role="alert" className="mt-5 flex items-start gap-2.5 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-[12px] leading-relaxed text-brand-800">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{launchError}</span>
                </div>
              )}
              <div className="mt-6 flex items-center gap-2.5 border-t border-ink-100 pt-5 sm:mt-7 sm:pt-6">
                {step > 0 && (
                  <button
                    type="button"
                    onClick={() => setStep(step - 1)}
                    disabled={launching}
                    className="inline-flex h-12 items-center gap-1.5 rounded-xl border border-ink-200 px-4 text-[13.5px] font-semibold text-ink-600 transition-colors hover:border-ink-400 hover:text-ink-900 disabled:opacity-50 sm:h-[54px]"
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    Back
                  </button>
                )}
                <button
                  type="submit"
                  data-tour="wiz-next"
                  disabled={(step === 1 && !canLeaveDocs) || (step === 2 && (checksOn === 0 || launching))}
                  className="group inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-600 text-[14px] font-semibold text-white shadow-[0_10px_26px_rgba(217,38,22,0.3)] transition-all hover:-translate-y-0.5 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0 sm:h-[54px] sm:text-[15px]"
                >
                  {step === 0 && "Continue to documents"}
                  {step === 1 && "Continue to scope"}
                  {step === 2 && (launching ? "Launching your run…" : "Launch run")}
                  {step === 2 && launching ? (
                    <Radio className="h-4.5 w-4.5 animate-pulse" aria-hidden="true" />
                  ) : (
                    <ArrowRight
                      className={cn("h-4.5 w-4.5 transition-transform group-hover:translate-x-1", step === 1 && !canLeaveDocs && "hidden")}
                      aria-hidden="true"
                    />
                  )}
                </button>
              </div>
              {step === 2 && launching && (
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-label="Launching the evaluation">
                  <motion.div
                    className="h-full w-1/3 rounded-full bg-brand-600"
                    animate={{ x: ["-100%", "300%"] }}
                    transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
                  />
                </div>
              )}
              {step === 1 && docs.length === 0 && (
                <p role="status" className="mt-2.5 text-center font-code text-[8px] tracking-[0.18em] text-brand-700">
                  STAGE AT LEAST ONE DOCUMENT — DROP A FILE TO CONTINUE
                </p>
              )}
              {step === 1 && docs.length > 0 && !canLeaveDocs && (
                <p role="status" className="mt-2.5 text-center font-code text-[8px] tracking-[0.18em] text-brand-700">
                  WAIT FOR EVERY DOCUMENT TO FINISH INDEXING BEFORE CONTINUING
                </p>
              )}
              <p className="mt-4 text-center font-code text-[7.5px] tracking-[0.16em] text-ink-400 sm:text-[8px] sm:tracking-[0.2em]">
                THE AGENT PREPARES THE FILE — THE COMMITTEE STILL AWARDS
              </p>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── Sidebar (shared by desktop rail + mobile drawer) ────────────────────── */

function SidebarContent({
  active,
  user,
  counts,
  agent,
  onNavigate,
  onSignOut,
  onExit,
}: {
  active: SectionId;
  user: AuthUser | null;
  counts: { runs: number; gates: number; findings: number };
  agent: AgentStatus;
  onNavigate: (id: SectionId) => void;
  onSignOut: () => void;
  onExit: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="relative flex items-center overflow-hidden px-5 pb-5 pt-6">
        <QuorumLogo variant="light" />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -left-10 top-0 h-24 w-40 rounded-full bg-brand-600/[0.13] blur-3xl"
        />
      </div>
      <div className="mx-5 h-px bg-gradient-to-r from-white/[0.12] via-white/[0.06] to-transparent" aria-hidden="true" />

      <nav
        aria-label="Workspace sections"
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-1 [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1"
      >
        {navGroupsFor(user).map((group, gi) => (
          <div key={group.group} className={cn(gi > 0 && "mt-4", gi === 0 && "pt-1")}>
            <p className="flex items-center gap-2.5 px-3 pb-2">
              <span className="font-code text-[8px] font-semibold uppercase tracking-[0.24em] text-ink-600">
                {group.group}
              </span>
              <span className="h-px flex-1 bg-white/[0.055]" aria-hidden="true" />
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = active === item.id;
                const badge = item.badge ? counts[item.badge] : null;
                const itemClass = cn(
                  "focus-brand group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-[background-color,color] duration-200",
                  isActive
                    ? "bg-gradient-to-r from-white/[0.085] to-white/[0.035] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_2px_rgba(0,0,0,0.35)] ring-1 ring-inset ring-white/[0.07]"
                    : "text-ink-400 hover:bg-white/[0.04] hover:text-ink-100"
                );
                return (
                  <li key={item.id}>
                    {item.href ? (
                      /* An item that lives at its own URL — leaving the workspace on purpose. */
                      <a href={item.href} className={itemClass}>
                        <Icon
                          className="h-[15px] w-[15px] shrink-0 text-ink-500 transition-colors group-hover:text-ink-300"
                          aria-hidden="true"
                          strokeWidth={1.8}
                        />
                        <span className="flex-1 truncate text-[12.5px] font-medium tracking-[-0.005em]">
                          {item.label}
                        </span>
                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-ink-500" aria-hidden="true" />
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onNavigate(item.id as SectionId)}
                        aria-current={isActive ? "true" : undefined}
                        className={itemClass}
                      >
                        {isActive && (
                          <motion.span
                            layoutId="mc-nav-rail"
                            className="absolute -left-2.5 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-full bg-brand-500 shadow-[0_0_14px_rgba(232,56,42,0.65)]"
                            aria-hidden="true"
                          />
                        )}
                        <Icon
                          className={cn(
                            "h-[15px] w-[15px] shrink-0 transition-colors",
                            isActive ? "text-brand-400" : "text-ink-500 group-hover:text-ink-300"
                          )}
                          aria-hidden="true"
                          strokeWidth={1.8}
                        />
                        <span className="flex-1 truncate text-[12.5px] font-medium tracking-[-0.005em]">
                          {item.label}
                        </span>
                        {badge !== null && badge > 0 && (
                          <span
                            className={cn(
                              "grid h-[18px] min-w-[18px] place-items-center rounded-full px-1.5 font-code text-[8.5px] font-bold tabular",
                              item.id === "mc-gates"
                                ? "bg-brand-600 text-white shadow-[0_0_12px_rgba(232,56,42,0.45)]"
                                : "bg-white/[0.09] text-ink-600 ring-1 ring-inset ring-white/10"
                            )}
                          >
                            {badge}
                          </span>
                        )}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/[0.07] px-3 pb-5 pt-4">
        {/* The rail reports the sidecar it is talking to, not just a brand */}
        <div className="mb-3 flex items-center gap-2.5 px-1" aria-label={`Agent ${agentModeOf(agent)}`}>
          <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
            <span
              className={cn(
                "absolute inline-flex h-full w-full animate-ping-slow rounded-full",
                agentModeOf(agent) === "online" ? "bg-brand-500" : "bg-ink-500"
              )}
            />
            <span
              className={cn(
                "relative inline-flex h-1.5 w-1.5 rounded-full",
                agentModeOf(agent) === "online" ? "bg-brand-500" : "bg-ink-500"
              )}
            />
          </span>
          <span className="type-micro text-ink-500">
            {agentModeOf(agent) === "online"
              ? "Agent online"
              : agentModeOf(agent) === "linking"
                ? "Agent linking"
                : "Agent offline"}
          </span>
          <span className="ml-auto type-micro text-ink-600">mcp · 3031</span>
        </div>
        <div>
          <ThemeModeRow />
        </div>

        <div className="mt-3 flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-2.5 py-2">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 font-code text-[10px] font-bold text-white ring-2 ring-brand-500/25"
            aria-hidden="true"
          >
            {initialsOf(user?.name ?? "Quorum")}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-white">{user?.name ?? "Guest officer"}</span>
            <span className="block truncate font-code text-[8px] tracking-[0.14em] text-ink-500">
              {user?.role ? `${ROLE_LABELS[user.role].toUpperCase()} · ${user.email.toUpperCase()}` : "NOT SIGNED IN"}
            </span>
          </span>
          <button
            type="button"
            onClick={onSignOut}
            aria-label="Sign out"
            title="Sign out"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          onClick={onExit}
          className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 font-code text-[8.5px] font-semibold tracking-[0.22em] text-ink-500 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          BACK TO SITE
        </button>
      </div>
    </div>
  );
}

/* ── Run register table ──────────────────────────────────────────────────── */

type RunFilter = "all" | "live" | "gates" | "done";

const RUN_FILTERS: { id: RunFilter; label: string }[] = [
  { id: "all", label: "ALL" },
  { id: "live", label: "IN PROGRESS" },
  { id: "gates", label: "NEEDS APPROVAL" },
  { id: "done", label: "COMPLETED" },
];

type RunDateWindow = "all" | "7d" | "30d" | "90d";

const RUN_DATE_WINDOWS: { id: RunDateWindow; label: string; days: number }[] = [
  { id: "all", label: "ALL DATES", days: 0 },
  { id: "7d", label: "LAST 7 DAYS", days: 7 },
  { id: "30d", label: "LAST 30 DAYS", days: 30 },
  { id: "90d", label: "LAST 90 DAYS", days: 90 },
];

function runDateLabel(window: RunDateWindow): string {
  return RUN_DATE_WINDOWS.find((w) => w.id === window)?.label ?? "ALL DATES";
}

function RunRegister({
  runs,
  query,
  onQuery,
  filter,
  onFilter,
  onToast,
  notes,
  canDeleteDocuments = false,
}: {
  runs: McRun[];
  query: string;
  onQuery: (v: string) => void;
  filter: RunFilter;
  onFilter: (f: RunFilter) => void;
  onToast: (m: string) => void;
  notes: Record<string, string[]>;
  canDeleteDocuments?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dateWindow, setDateWindow] = useState<RunDateWindow>("all");

  const filtered = runs.filter((r) => {
    const q = query.trim().toLowerCase();
    const matches =
      q.length === 0 ||
      r.id.toLowerCase().includes(q) ||
      r.title.toLowerCase().includes(q) ||
      r.buyer.toLowerCase().includes(q);
    const inFilter =
      filter === "all" ||
      (filter === "live" && (r.status === "running" || r.status === "queued")) ||
      (filter === "gates" && r.status === "gate") ||
      (filter === "done" && r.status === "complete");
    const windowDays = RUN_DATE_WINDOWS.find((w) => w.id === dateWindow)?.days ?? 0;
    const inWindow =
      windowDays === 0 ||
      Date.parse(r.startedAtIso) >= Date.now() - windowDays * 24 * 60 * 60 * 1000;
    return matches && inFilter && inWindow;
  });

  /* Bids are a property of the register, not a column: the count rides with each
     evaluation and the register header carries the live total. */
  const totalBids = filtered.reduce((n, r) => n + (r.bids ?? 0), 0);

  return (
    <section id="mc-runs" aria-labelledby="mc-runs-h" className="scroll-mt-24">
      <motion.div
        data-tour="run-register"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15, ease: EASE }}
        className="overflow-hidden rounded-[12px] panel"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200/70 px-5 py-4 dark:border-white/10">
          <div>
            <h2 id="mc-runs-h" className="type-title text-ink-950">
              Recent evaluations
              <span className="ml-2 inline-flex translate-y-[-1px] items-center rounded-full border border-ink-200/70 bg-paper-2/80 px-2 py-0.5 align-middle font-code text-[7.5px] font-bold tracking-[0.14em] text-ink-500 dark:border-white/10 dark:bg-white/[0.05] dark:text-ink-300">
                {totalBids} BIDS
              </span>
            </h2>
            <p className="mt-1 type-micro text-ink-400">
              {runDateLabel(dateWindow)} · {filtered.length} of {runs.length} evaluations
            </p>
          </div>
          <div
            data-tour="run-filters"
            role="group"
            aria-label="Filter evaluations"
            className="flex items-center gap-1 rounded-full border border-ink-200/70 bg-paper-2/70 p-1 dark:border-white/10 dark:bg-white/[0.04]"
          >
            {RUN_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onFilter(f.id)}
                aria-pressed={filter === f.id}
                className={cn(
                  "focus-brand relative h-7 rounded-full px-3 font-code text-[8.5px] font-bold tracking-[0.14em] transition-colors duration-200",
                  filter === f.id
                    ? "text-white"
                    : "text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white"
                )}
              >
                {filter === f.id && (
                  <motion.span
                    layoutId="run-filter-ink"
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full bg-ink-950 dark:bg-white/10 dark:ring-1 dark:ring-white/10"
                    transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.6 }}
                  />
                )}
                <span className="relative">{f.label}</span>
              </button>
            ))}
          </div>
        </header>

        {/* The register's own search — the top-bar search stays, but the
            section is usable on its own once the officer has scrolled here. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-200/70 px-5 py-3 dark:border-white/10">
          <label className="relative block w-full min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Search by reference, title or buyer…"
              aria-label="Search recent evaluations by reference, title or buyer"
              className="focus-brand h-9 w-full rounded-lg border border-ink-200/80 bg-[#fffdfb] pl-9 pr-3.5 text-[12.5px] text-ink-900 shadow-[inset_0_1px_1px_rgba(11,12,15,0.03)] outline-none transition-[border-color,background-color] duration-300 placeholder:text-ink-400 focus:border-ink-950 focus:ring-[3px] focus:ring-ink-950/[0.07] dark:border-white/[0.1] dark:bg-white/[0.04] dark:focus:border-white/35 dark:focus:ring-white/[0.06]"
            />
          </label>
          <label className="relative inline-flex h-9 shrink-0 items-center">
            <span className="sr-only">Filter evaluations by date</span>
            <select
              value={dateWindow}
              onChange={(e) => setDateWindow(e.target.value as RunDateWindow)}
              aria-label="Filter evaluations by date"
              className="focus-brand h-9 appearance-none rounded-lg border border-ink-200/80 bg-[#fffdfb] pl-3 pr-8 font-code text-[8px] font-bold tracking-[0.14em] text-ink-600 outline-none transition-colors focus:border-ink-950 focus:ring-[3px] focus:ring-ink-950/[0.07] dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-ink-300 dark:focus:border-white/35 dark:focus:ring-white/[0.06]"
            >
              {RUN_DATE_WINDOWS.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-2.5 h-3 w-3 text-ink-400"
              aria-hidden="true"
            />
          </label>
          {query && (
            <button
              type="button"
              onClick={() => onQuery("")}
              className="font-code text-[8px] font-bold tracking-[0.16em] text-ink-500 transition-colors hover:text-ink-950"
            >
              CLEAR
            </button>
          )}
          <span
            aria-live="polite"
            className="ml-auto shrink-0 font-code text-[8px] font-bold tracking-[0.16em] text-ink-400 tabular"
          >
            {filtered.length} OF {runs.length} RESULTS
          </span>
        </div>

        {/* Table */}
        <div data-tour="run-rows" className="overflow-x-auto">
          <table className="w-full min-w-[660px] border-collapse text-left">
            <caption className="sr-only">Recent evaluations with their status, findings and citations</caption>
            <thead>
              <tr className="border-b border-ink-200/70 bg-paper-2/70 dark:border-white/10 dark:bg-white/[0.02]">
                {["Evaluation", "Issues", "Sourced", "Status", "Time", ""].map((h, i) => (
                  <th
                    key={i}
                    scope="col"
                    className={cn(
                      "px-4 py-3 type-micro font-semibold text-ink-400",
                      i === 0 && "pl-5",
                      i === 5 && "w-10",
                      (i === 1 || i === 2) && "text-right",
                      i === 4 && "text-right"
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((run) => {
                const isOpen = expanded === (run.uid ?? run.id);
                const notesFor = notes[run.id] ?? [];
                return (
                  <Fragment key={run.uid ?? run.id}>
                    <tr
                      className={cn(
                        "cursor-pointer border-b border-ink-100/70 transition-colors last:border-b-0 hover:bg-paper-2/60 dark:border-white/[0.06] dark:hover:bg-white/[0.02]",
                        isOpen && "bg-paper-2/50 dark:bg-white/[0.02]"
                      )}
                      tabIndex={0}
                      onClick={() => setExpanded(!isOpen ? run.uid ?? run.id : null)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setExpanded(!isOpen ? run.uid ?? run.id : null);
                        }
                      }}
                      aria-expanded={isOpen}
                      aria-label={`${run.id} — ${run.title}. Toggle run details.`}
                    >
                      <td className="min-w-[260px] py-3.5 pl-5 pr-4 align-top">
                        <p className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-950">
                          {run.id}
                          {run.attempt && run.attempt > 1 ? (
                            <span className="ml-2 rounded bg-ink-100 px-1.5 py-0.5 text-[8.5px] tracking-[0.14em] text-ink-500">
                              REVIEW {run.attempt}
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 max-w-[440px] whitespace-normal break-words text-[12.5px] font-medium leading-snug text-ink-600">{run.title}</p>
                        <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-ink-200/70 bg-paper-2/70 px-2 py-0.5 font-code text-[7px] font-bold tracking-[0.12em] text-ink-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-300">
                          <span className="tabular text-[8px] text-ink-800 dark:text-white">{run.bids ?? 0}</span>
                          BID{(run.bids ?? 0) === 1 ? "" : "S"}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {run.findings > 0 ? (
                          <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-brand-700 tabular">
                            <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                            {run.findings}
                          </span>
                        ) : (
                          <span className="text-[13px] text-ink-400 tabular">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right text-[13px] font-semibold text-ink-800 tabular">
                        {run.status === "running" || run.status === "queued" ? "—" : `${run.citations}/${run.findings}`}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusChip status={run.status} />
                      </td>
                      <td className="px-4 py-3.5 text-right font-code text-[9px] tracking-[0.12em] text-ink-500 tabular">
                        {run.startedAt}
                      </td>
                      <td className="pr-4">
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 text-ink-400 transition-transform duration-300",
                            isOpen && "rotate-180 text-ink-600"
                          )}
                          aria-hidden="true"
                        />
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-ink-100 bg-paper">
                        <td colSpan={7} className="px-5 py-4">
                          <div className="rounded-xl border border-ink-100 bg-white p-4">
                            {run.status === "running" || run.status === "queued" ? (
                              <p className="text-[13px] leading-relaxed text-ink-600">
                                <span className="font-semibold text-ink-900">
                                  Run in progress — reading the pack you staged.
                                </span>{" "}
                                Findings stream in at completion — every claim will carry a page citation, and the file
                                stops at your gate before anything is awarded.
                              </p>
                            ) : (
                              <>
                                <p className="font-code text-[8.5px] font-semibold tracking-[0.2em] text-ink-400">
                                  TOP ISSUES · {run.findings} FLAGGED · {run.citations} SOURCED · {run.unsourced} WITHOUT A SOURCE
                                </p>
                                <ul className="mt-2.5 flex flex-wrap gap-1.5">
                                  {notesFor.map((note, ni) => (
                                    <li
                                      key={`${run.uid ?? run.id}-note-${ni}`}
                                      className="rounded-md bg-brand-50 px-2.5 py-1.5 text-[11.5px] font-medium text-brand-800"
                                    >
                                      {note}
                                    </li>
                                  ))}
                                  {run.findings > notesFor.length && (
                                    <li className="rounded-md bg-ink-50 px-2.5 py-1.5 font-code text-[10px] font-semibold tracking-[0.1em] text-ink-500">
                                      +{run.findings - notesFor.length} MORE IN THE SOURCED REPORT
                                    </li>
                                  )}
                                </ul>
                              </>
                            )}
                            {/* A pack ingested at launch follows the run everywhere */}
                            {typeof run.docs === "number" && (
                              <p className="mt-3 font-code text-[8px] tracking-[0.18em] text-ink-400">
                                PACK AT LAUNCH · {run.docs} DOCUMENT{run.docs === 1 ? "" : "S"} INDEXED · INGESTED BY QUORUM-AGENT
                              </p>
                            )}
                            {run.status === "complete" && (
                              <div className="mt-3.5">
                                <StoredDocsBrowser
                                  tenderRef={run.id}
                                  canDelete={canDeleteDocuments}
                                  title="STORED TENDER DOCUMENTS"
                                />
                              </div>
                            )}
                            <div className="mt-3.5 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  /* Real download: GET /api/runs/:uid/report on the sidecar
                                     returns the sourced report as an attached .md file. */
                                  if (!run.uid) {
                                    onToast("REPORT UNAVAILABLE — NO BACKEND ID FOR THIS RUN");
                                    return;
                                  }
                                  onToast(
                                    `SOURCED REPORT — ${run.id} · ${run.findings} FINDINGS · ${run.citations} CITATIONS · DOWNLOADING`
                                  );
                                  fetch(`/api/runs/${encodeURIComponent(run.uid)}/report?XTransformPort=3031`)
                                    .then(async (res) => {
                                      if (!res.ok) throw new Error(`HTTP ${res.status}`);
                                      const blob = await res.blob();
                                      const m = (res.headers.get("content-disposition") ?? "").match(/filename="?([^";]+)"?/);
                                      const url = URL.createObjectURL(blob);
                                      const a = document.createElement("a");
                                      a.href = url;
                                      a.download = m?.[1] ?? `quorum-report-${run.id}-${run.uid}.md`;
                                      document.body.appendChild(a);
                                      a.click();
                                      a.remove();
                                      URL.revokeObjectURL(url);
                                      onToast(`REPORT DOWNLOADED — ${run.id}`);
                                    })
                                    .catch(() => onToast("REPORT FAILED — AGENT SERVICE UNREACHABLE"));
                                }}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink-950 px-3 font-code text-[9px] font-bold tracking-[0.14em] text-white transition-colors hover:bg-brand-600"
                              >
                                <Download className="h-3 w-3" aria-hidden="true" />
                                SOURCED REPORT
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const log = `quorum audit — ${run.id} — ${run.findings} findings · ${run.citations} citations · ${sealText(run)}`;
                                  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(log).catch(() => undefined);
                                  onToast("AUDIT TRAIL COPIED TO CLIPBOARD");
                                }}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ink-200 px-3 font-code text-[9px] font-bold tracking-[0.14em] text-ink-600 transition-colors hover:border-ink-400 hover:text-ink-900"
                              >
                                <Copy className="h-3 w-3" aria-hidden="true" />
                                COPY AUDIT TRAIL
                              </button>
                              <span className="ml-auto font-code text-[8px] tracking-[0.16em] text-ink-400">
                                BUYER · {run.buyer.toUpperCase()}
                              </span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center">
                    <p className="font-code text-[10px] tracking-[0.18em] text-ink-400">
                      {query.trim()
                        ? `NO RUNS MATCH “${query.trim().toUpperCase()}”`
                        : `NO RUNS IN ${runDateLabel(dateWindow)}`}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        onQuery("");
                        onFilter("all");
                        setDateWindow("all");
                      }}
                      className="mt-3 inline-flex h-8 items-center rounded-lg border border-ink-200 px-3.5 text-[12px] font-semibold text-ink-600 transition-colors hover:border-ink-400"
                    >
                      Clear search, filters & dates
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>
    </section>
  );
}

/* The roll beside the gate queue. A signature is a committee act, so the
   officer sees whether the committee is quorate before acting — and the
   sidecar refuses the decision even if this screen is bypassed. */
function QuorumRoll({ quorum, onOpenRoll }: { quorum: CommitteeData | null; onOpenRoll?: () => void }) {
  if (!quorum) return null;

  const you = quorum.you;
  const youKey = you ? rosterNameKey(you.name) : null;
  const present = quorum.members.filter((m) => m.status === "PRESENT");
  const excused = quorum.members.filter(
    (m) => m.status === "EXCUSED" && !(youKey && rosterNameKey(m.name) === youKey)
  );
  const youAlreadyPresent =
    !!you && present.some((m) => rosterNameKey(m.name) === rosterNameKey(you.name));
  const presentCount = quorumPresentCount(quorum);
  const met = presentCount >= quorum.required;
  const short = Math.max(0, quorum.required - presentCount);
  const seats = Math.max(1, quorum.seats);
  const roll = [
    ...present.map((m) => ({ name: m.name, state: "PRESENT" as const })),
    ...(you && !youAlreadyPresent
      ? [{ name: `${you.name} — you`, state: "GAVEL" as const }]
      : []),
    ...excused.map((m) => ({ name: m.name, state: "EXCUSED" as const })),
  ];

  return (
    <div
      aria-label="Committee quorum roll call"
      className={cn(
        "border-b px-5 py-4",
        met
          ? "border-ink-200/70 bg-paper/60 dark:border-white/10"
          : "border-brand-500/25 bg-brand-500/[0.035]"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-code text-[8.5px] font-bold tracking-[0.18em] text-ink-500">
          <Users className="h-3 w-3" aria-hidden="true" />
          QUORUM ROLL CALL
        </p>
        <span
          className={cn(
            "tabular rounded-full border px-2.5 py-1 font-code text-[8px] font-bold tracking-[0.14em]",
            met
              ? "border-ink-950 bg-ink-950 text-white dark:border-white/20"
              : "border-brand-500/40 bg-white text-brand-700 dark:bg-brand-950/30 dark:text-brand-300"
          )}
        >
          {presentCount} OF {quorum.required} REQUIRED
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-hidden="true">
        {Array.from({ length: seats }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-2.5 w-5 rounded-[2px] border",
              i < presentCount
                ? "border-ink-950 bg-ink-950"
                : i < quorum.required
                  ? "border-brand-500/50 bg-brand-500/10"
                  : "border-ink-200 bg-transparent dark:border-white/15"
            )}
          />
        ))}
        <span
          className={cn(
            "ml-2 font-code text-[8px] font-bold tracking-[0.14em]",
            met ? "text-ink-950 dark:text-white" : "text-brand-700 dark:text-brand-300"
          )}
        >
          {met ? "QUORUM PRESENT" : `${short} MORE NEEDED`}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-[12px] leading-relaxed text-ink-600 dark:text-ink-300">
          {met
            ? "The roll carries — the committee can decide."
            : "The roll is short — every gate decision is refused until enough members are marked PRESENT."}
        </p>
        {onOpenRoll && (
          <button
            type="button"
            onClick={onOpenRoll}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 font-code text-[8px] font-bold tracking-[0.14em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950 dark:border-white/15 dark:bg-transparent dark:text-ink-300 dark:hover:border-white/40 dark:hover:text-white"
          >
            OPEN THE ROLL
            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
      </div>

      <details className="mt-2.5">
        <summary className="cursor-pointer font-code text-[8px] font-bold tracking-[0.16em] text-ink-400 transition-colors hover:text-ink-700 dark:hover:text-ink-200">
          READ THE ROLL · {presentCount} PRESENT
        </summary>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {roll.map((m, i) => (
            <li
              key={`${m.name}-${i}`}
              className="flex items-center justify-between gap-2 rounded border border-ink-100 bg-white px-2.5 py-1.5 dark:border-white/10 dark:bg-white/[0.03]"
            >
              <span className="min-w-0 truncate text-[11.5px] font-medium text-ink-800 dark:text-ink-100">{m.name}</span>
              <span
                className={cn(
                  "shrink-0 font-code text-[7px] font-bold tracking-[0.14em]",
                  m.state === "EXCUSED"
                    ? "text-ink-400"
                    : m.state === "GAVEL"
                      ? "text-brand-600 dark:text-brand-300"
                      : "text-ink-600 dark:text-ink-300"
                )}
              >
                {m.state}
              </span>
            </li>
          ))}
          {roll.length === 0 && (
            <li className="font-code text-[8px] tracking-[0.14em] text-ink-400">NO MEMBERS ON THE ROLL</li>
          )}
        </ul>
      </details>
    </div>
  );
}

function rosterNameKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/* Mirror the sidecar's count: PRESENT rows plus the signed-in gavel, once. */
function quorumPresentCount(quorum: CommitteeData): number {
  const present = quorum.members.filter((m) => m.status === "PRESENT").length;
  const you = quorum.you;
  const youAlreadyPresent =
    !!you && quorum.members.some((m) => m.status === "PRESENT" && rosterNameKey(m.name) === rosterNameKey(you.name));
  return present + (you && !youAlreadyPresent ? 1 : 0);
}

/* ── Human gate queue ────────────────────────────────────────────────────── */

export function GateQueue({
  queue,
  ledger,
  quorum,
  onSign,
  onReturn,
  onOpenRoll,
  canSign = true,
  query,
  onQuery,
}: {
  queue: GateItem[];
  ledger: LedgerRow[];
  quorum: CommitteeData | null;
  onSign: (g: GateItem) => void;
  onReturn: (g: GateItem) => void;
  onOpenRoll?: () => void;
  /* Read-only roles see the queue but never the signature controls. */
  canSign?: boolean;
  /* GatesView owns the term so the authority strip shares it; the overview
     screen leaves these out and the queue keeps its own. */
  query?: string;
  onQuery?: (value: string) => void;
}) {
  const [, setDecided] = useState<Record<string, "AWARDED" | "RETURNED">>({});
  /* The ink receipt opened from the decision history. */
  const [receiptRow, setReceiptRow] = useState<SignatureReceipt | null>(null);
  /* The section-wide term, lifted so the authority strip reads it too. */
  const [localQ, setLocalQ] = useState("");
  const q = query ?? localQ;
  const setQ = onQuery ?? setLocalQ;
  const needle = q.trim().toLowerCase();
  const visible = needle
    ? queue.filter((g) =>
        `${g.tender} ${g.title} ${g.supplier} ${GATE_TOOL_LABEL[g.tool] ?? g.tool} ${g.firstApprover ?? ""} ${g.status}`
          .toLowerCase()
          .includes(needle),
      )
    : queue;
  /* The same term reads the ledger below the queue. */
  const visibleLedger = needle
    ? ledger.filter((row) =>
        `${row.tender} ${row.action} ${row.by} ${row.toolLabel ?? ""}`.toLowerCase().includes(needle),
      )
    : ledger;
  const presentCount = quorum ? quorumPresentCount(quorum) : 0;
  const blocked = !!quorum && presentCount < quorum.required;
  const short = quorum ? Math.max(0, quorum.required - presentCount) : 0;

  const act = (g: GateItem, kind: "AWARDED" | "RETURNED") => {
    setDecided((prev) => ({ ...prev, [g.id]: kind }));
    if (kind === "AWARDED") onSign(g);
    else onReturn(g);
  };

  return (
    <section id="mc-gates" aria-labelledby="mc-gates-h" className="scroll-mt-24">
      <motion.div
        data-tour="gate-queue"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.22, ease: EASE }}
        className="flex h-full flex-col overflow-hidden rounded-[12px] panel"
      >
        <header className="flex items-center justify-between gap-3 border-b border-ink-200/70 px-5 py-4 dark:border-white/10">
          <div>
            <h2 id="mc-gates-h" className="flex items-center gap-2 type-title text-ink-950">
              <Gavel className="h-4 w-4 text-brand-600" aria-hidden="true" />
              Decision queue
            </h2>
            <p className="mt-1 type-micro text-ink-400">
              {queue.length === 0 ? "Nothing to approve right now" : `${queue.length} waiting for a decision`}
            </p>
          </div>
          <span
            aria-live="polite"
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 font-code text-[8.5px] font-bold tracking-[0.16em] tabular",
              queue.length === 0
                ? "border-ink-950 bg-ink-950 text-white dark:border-white/15"
                : "border-brand-500/40 bg-brand-500/[0.08] text-brand-700 dark:text-brand-300"
            )}
          >
            {queue.length > 0 && (
              <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-600" />
              </span>
            )}
            {queue.length === 0 ? "ALL CLEAR" : "ACTION NEEDED"}
          </span>
        </header>

        {/* The queue's own search — the top-bar search covers runs, so the
            decision register carries a filter of its own. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-200/70 px-5 py-3 dark:border-white/10">
          <label className="relative block w-full min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by reference, title, supplier or office…"
              aria-label="Search approvals by reference, title, supplier or office"
              className="focus-brand h-9 w-full rounded-lg border border-ink-200/80 bg-[#fffdfb] pl-9 pr-3.5 text-[12.5px] text-ink-900 shadow-[inset_0_1px_1px_rgba(11,12,15,0.03)] outline-none transition-[border-color,background-color] duration-300 placeholder:text-ink-400 focus:border-ink-950 focus:ring-[3px] focus:ring-ink-950/[0.07] dark:border-white/[0.1] dark:bg-white/[0.04] dark:focus:border-white/35 dark:focus:ring-white/[0.06]"
            />
          </label>
          {needle && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="font-code text-[8px] font-bold tracking-[0.16em] text-ink-500 transition-colors hover:text-ink-950"
            >
              CLEAR
            </button>
          )}
          <span
            aria-live="polite"
            className="ml-auto shrink-0 font-code text-[8px] font-bold tracking-[0.16em] text-ink-400 tabular"
          >
            {visible.length} OF {queue.length} GATES
          </span>
        </div>

        <QuorumRoll quorum={quorum} onOpenRoll={onOpenRoll} />

        <div className="grid flex-1 grid-cols-1 items-start gap-3 px-4 py-4" aria-live="polite">
          <AnimatePresence initial={false}>
            {visible.map((g) => (
              <motion.article
                key={g.id}
                layout
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 32, transition: { duration: 0.3 } }}
                transition={{ duration: 0.4, ease: EASE }}
                className="rounded-[10px] border border-ink-200/70 bg-paper p-4 transition-colors duration-300 hover:bg-white dark:border-white/10 dark:hover:bg-white/[0.03]"
              >
                {g.status === "AWAITING_SECOND" ? (
                  <p className="mb-3 rounded-md border border-amber-400/40 bg-amber-400/[0.1] px-2.5 py-1.5 font-code text-[8px] font-bold leading-relaxed tracking-[0.12em] text-amber-800 dark:text-amber-200">
                    SECOND SIGNATURE REQUIRED — OPENED BY {String(g.firstApprover ?? "AN OFFICER").toUpperCase()}
                    {g.firstApprovalAt ? ` ${g.firstApprovalAt.toUpperCase()}` : ""}. A DIFFERENT OFFICER MUST COMPLETE IT.
                  </p>
                ) : null}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-code text-[9.5px] font-bold tracking-[0.1em] text-ink-950">{g.tender}</p>
                    <p className="mt-0.5 truncate text-[13.5px] font-semibold text-ink-800">{g.title}</p>
                    <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-ink-950 px-2 py-0.5 font-code text-[7.5px] font-bold tracking-[0.14em] text-white">
                      <Stamp className="h-2.5 w-2.5" aria-hidden="true" />
                      {GATE_TOOL_LABEL[g.tool] ?? g.tool}
                      {g.requiredOffice ? ` · ${OFFICE_SHORT[g.requiredOffice] ?? g.requiredOffice}` : ""}
                    </p>
                  </div>
                  {g.flags > 0 && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-2 py-1 font-code text-[8.5px] font-bold tracking-[0.1em] text-brand-700">
                      <CircleAlert className="h-2.5 w-2.5" aria-hidden="true" />
                      {g.flags} {g.flags === 1 ? "FLAG" : "FLAGS"}
                    </span>
                  )}
                </div>
                <dl className="mt-3.5 grid grid-cols-2 gap-2 border-t border-ink-200/70 pt-3.5 font-code text-[8.5px] tracking-[0.12em] text-ink-500 dark:border-white/10">
                  <div>
                    <dt className="text-ink-500">PROPOSED SUPPLIER</dt>
                    <dd className="mt-0.5 font-semibold text-ink-800">{g.supplier}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">{g.factLabel}</dt>
                    <dd className={cn("mt-0.5 font-semibold", g.valueMissing ? "text-brand-700" : "text-ink-800")}>
                      {g.factText}
                    </dd>
                  </div>
                </dl>
                {blocked && (
                  <p className="mt-3.5 rounded-md border border-brand-200 bg-brand-50 px-2.5 py-1.5 font-code text-[8px] font-bold leading-relaxed tracking-[0.12em] text-brand-800 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-200">
                    QUORUM SHORT — {short} MORE PRESENT NEEDED BEFORE THIS GATE CAN BE DECIDED
                  </p>
                )}
                {canSign ? (
                <div data-tour="gate-actions" className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => act(g, "AWARDED")}
                    disabled={g.valueMissing || blocked}
                    title={
                      blocked
                        ? `Quorum not present — ${presentCount} of ${quorum?.required ?? 0}. Mark members PRESENT in Committee before signing.`
                        : g.valueMissing
                          ? "A contract always has a contract value — record the award value before this is signed."
                          : undefined
                    }
                    className="focus-brand inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-brand-600 text-[12.5px] font-bold tracking-[0.02em] text-white shadow-[0_1px_0_rgba(255,255,255,0.18)_inset,0_12px_26px_-14px_rgba(217,38,22,0.9)] transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Stamp className="h-3.5 w-3.5" aria-hidden="true" />
                    {g.status === "AWAITING_SECOND" ? "Second signature" : "Award"}
                  </button>
                  {g.status !== "AWAITING_SECOND" ? (
                    <button
                      type="button"
                      onClick={() => act(g, "RETURNED")}
                      disabled={blocked}
                      title={
                        blocked
                          ? `Quorum not present — ${presentCount} of ${quorum?.required ?? 0}. Mark members PRESENT in Committee before deciding.`
                          : undefined
                      }
                      className="focus-brand inline-flex h-10 flex-1 items-center justify-center rounded-full border border-ink-200/80 text-[12.5px] font-semibold text-ink-700 transition-colors hover:border-ink-400 hover:bg-white hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/12 dark:hover:bg-white/[0.04]"
                    >
                      Return for review
                    </button>
                  ) : null}
                </div>
                ) : (
                  <p className="mt-4 rounded-md border border-ink-200 bg-paper px-2.5 py-2 font-code text-[8px] font-bold leading-relaxed tracking-[0.12em] text-ink-500">
                    READ-ONLY — YOUR WORKSPACE ROLE CANNOT SIGN THIS GATE
                  </p>
                )}
                <p className="mt-3 type-micro text-ink-400">
                  File submitted {g.ago} · every flag cited
                </p>
              </motion.article>
            ))}
          </AnimatePresence>

          {queue.length === 0 && (
            <motion.div
              key="empty-queue"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, ease: EASE }}
              className="grid place-items-center rounded-xl border border-dashed border-ink-200 px-4 py-10 text-center"
            >
              <CircleCheck className="h-7 w-7 text-ink-400" aria-hidden="true" />
              <p className="mt-3 type-title text-ink-900">Nothing needs a decision.</p>
              <p className="mt-1.5 max-w-[240px] text-[12.5px] leading-relaxed text-ink-500">
                No tender is waiting on you or the committee. The agent keeps preparing new files in the meantime.
              </p>
            </motion.div>
          )}

          {queue.length > 0 && visible.length === 0 && (
            <p className="rounded-xl border border-dashed border-ink-200 px-4 py-10 text-center font-code text-[8.5px] font-bold tracking-[0.16em] text-ink-400 dark:border-white/10">
              NO GATE MATCHES “{q.trim().toUpperCase()}”
            </p>
          )}
        </div>

        {/* Ledger */}
        <div data-tour="gate-ledger" className="border-t border-ink-200/70 px-5 py-4 dark:border-white/10">
          <p className="type-micro text-ink-400">Decision history</p>
          <ul className="mt-2.5 space-y-2">
            <AnimatePresence initial={false}>
              {visibleLedger.slice(0, 4).map((row) => (
                <motion.li
                  key={row.id ?? `${row.tender}-${row.at}-${row.action}`}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: EASE }}
                  className="flex items-center justify-between gap-2 font-code text-[8.5px] tracking-[0.12em]"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setReceiptRow({
                        tender: row.tender,
                        action: row.action,
                        by: row.by,
                        at: row.at,
                        toolLabel: row.toolLabel,
                        image: row.hand?.image,
                        strokes: row.hand?.strokes,
                        signedAt: row.hand?.signedAt,
                        submissionId: row.receipt?.submissionId,
                        hash: row.receipt?.hash,
                      })
                    }
                    title="Open the decision receipt — the appended signature and its seal"
                    className="group inline-flex min-w-0 items-center gap-1.5 rounded text-left transition-colors hover:text-ink-950"
                  >
                    <span className="font-bold text-ink-800 group-hover:text-ink-950">{row.tender}</span>
                    {row.hand && <PenLine className="h-2.5 w-2.5 shrink-0 text-brand-600" aria-hidden="true" />}
                  </button>
                  <span className={cn("font-bold", row.action === "AWARDED" ? "text-ink-950" : "text-brand-600")}>
                    {row.action}
                  </span>
                  <span className="ml-auto text-ink-400">
                    {row.by} · {row.at}
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
            {visibleLedger.length === 0 && (
              <li className="font-code text-[8.5px] tracking-[0.12em] text-ink-400">
                {ledger.length === 0 ? "NO DECISIONS YET" : `NO DECISION MATCHES “${q.trim().toUpperCase()}”`}
              </li>
            )}
          </ul>
        </div>
      </motion.div>

      {/* The ink receipt, reachable from the desk's decision history. */}
      <SignatureReceiptDialog row={receiptRow} onClose={() => setReceiptRow(null)} />
    </section>
  );
}

/* ── Portal sync + audit ─────────────────────────────────────────────────── */

/* ── The OCP Data Registry, read for Africa ────────────────────────────────
   The Sources screen draws the registry exactly as the registry states it:
   one row per African country, one detail row per published dataset — read
   through the quorum-mcp sidecar (mine-ocp-africa.py is the generator). */

interface OcpDownload {
  format: string;
  size: string;
  url: string;
}

interface OcpDataset {
  country: string;
  iso: string;
  publisher: string;
  publicationId: number;
  registryUrl: string;
  portalUrl: string | null;
  policyUrl: string | null;
  coverageFrom: string;
  coverageTo: string;
  stale: boolean;
  updateFrequency: string | null;
  lastRetrieved: string;
  recordModified: string | null;
  retrievedNote: string | null;
  downloads: OcpDownload[];
  license: string | null;
  licenseUrl: string | null;
  language: string | null;
  ocidPrefix: string | null;
  counts: Record<string, number>;
}

interface OcpCountry {
  country: string;
  iso: string;
  datasets: number;
  stale: number;
  publishers: string[];
  coverageFrom: string;
  coverageTo: string;
  lastRetrieved: string;
  formats: string[];
  searchUrl: string;
}

interface OcpRegistryHandshake {
  ok: boolean;
  status: number | null;
  bytes: number;
  ocid: string | null;
  ms: number;
  error: string | null;
}

interface OcpPortalProbe {
  ok: boolean;
  status: number | null;
  ms: number;
  error: string | null;
}

interface OcpPortalLink {
  publicationId: number;
  checkedAt: string;
  registry: OcpRegistryHandshake;
  portal: OcpPortalProbe;
}

interface OcpLinks {
  updatedAt: string;
  links: Record<string, OcpPortalLink>;
}

/* The committee's own switch, kept by the sidecar: which portals are in use.
   Absent from the map means enabled — the registry's record is never edited. */
interface OcpPortalState {
  updatedAt: string;
  overrides: Record<string, { enabled: boolean; at: string; by: string }>;
}

interface OcpSource {
  registry: string;
  via: string;
  retrieved: string;
  scope: string;
  licenseNote: string;
  note: string;
}

interface OcpRefreshStatus {
  enabled: boolean;
  running: boolean;
  intervalDays: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  nextDueAt: string | null;
  sourceRetrieved: string | null;
  generatedAt: string | null;
  fromRuntimeSnapshot: boolean;
}

interface OcpRegistry {
  source: OcpSource;
  countries: OcpCountry[];
  datasets: OcpDataset[];
  global?: {
    source: OcpSource;
    countries: OcpCountry[];
    datasets: OcpDataset[];
  };
  links: OcpLinks;
  state?: OcpPortalState;
  refresh?: OcpRefreshStatus;
}

const ISO_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/* "2026-10-18" → "18 OCT 2026" — registry dates, day-precise as the record
   keeps them. */
function codeDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${ISO_MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
}

/* An instant → "18 OCT 2026 01:13" — local clock, whole stamp from one Date. */
function codeStamp(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, "0")} ${ISO_MONTHS[d.getMonth()]} ${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

/* The registry refreshes itself in the sidecar; this line states what really
   happened, including a failure, so an old snapshot is never dressed as new. */
function refreshStatusLine(refresh: OcpRefreshStatus | undefined): string {
  if (!refresh) return "AUTO-REFRESH · STATUS NOT REPORTED";
  if (!refresh.enabled) return "AUTO-REFRESH · OFF";
  const last = refresh.lastSuccessAt
    ? `LAST SUCCESS ${codeStamp(refresh.lastSuccessAt)}`
    : refresh.generatedAt
      ? `SNAPSHOT GENERATED ${codeStamp(refresh.generatedAt)}`
      : "NOT YET";
  const next = refresh.nextDueAt ? codeDate(refresh.nextDueAt.slice(0, 10)) : "NOW";
  if (refresh.running) return `AUTO-REFRESH · RUNNING NOW · ${last}`;
  if (refresh.lastError) {
    return `AUTO-REFRESH · LAST ATTEMPT FAILED — ${refresh.lastError.slice(0, 140).toUpperCase()} · ${last} · NEXT ${next}`;
  }
  return `AUTO-REFRESH · EVERY ${refresh.intervalDays} DAY${refresh.intervalDays === 1 ? "" : "S"} · ${last} · NEXT ${next}`;
}

function useOcpRegistry() {
  const [data, setData] = useState<OcpRegistry | null>(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch("/api/ocp-africa?XTransformPort=3031")
      .then((x) => (x.ok ? x.json() : Promise.reject(new Error(String(x.status)))))
      .then((d: OcpRegistry) => {
        if (alive) {
          setData(d);
          setFailed(false);
        }
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, failed, reload, setData };
}

/* The portal switch — the committee turns a source off and on. A real
   switch: role, checked state, keyboard focus, and a knob that moves. */
function PortalSwitch({
  on,
  mixed,
  busy,
  ariaLabel,
  title,
  onToggle,
}: {
  on: boolean;
  mixed?: boolean;
  busy?: boolean;
  ariaLabel: string;
  title: string;
  onToggle: () => void;
}) {
  return (
    <span
      role="switch"
      aria-checked={mixed ? "mixed" : on}
      aria-label={ariaLabel}
      title={title}
      tabIndex={busy ? -1 : 0}
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) onToggle();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          if (!busy) onToggle();
        }
      }}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border align-middle transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        mixed ? "border-ink-950 bg-white" : on ? "border-ink-950 bg-ink-950" : "border-ink-300 bg-white",
        busy && "cursor-wait opacity-60",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "block h-3.5 w-3.5 rounded-full shadow-[0_1px_2px_rgba(11,12,15,0.35)] transition-all duration-200",
          mixed
            ? "mx-auto translate-x-0 bg-ink-950"
            : on
              ? "ml-[18px] bg-white"
              : "ml-[3px] bg-ink-400",
        )}
      />
    </span>
  );
}

/* One dataset, exactly as the registry publishes it — licence, coverage,
   counts, formats, and the publisher's own portal, each linked back. The
   connection line is a real check: the registry handshake that opened the
   published file (with the first OCDS release it read) and the portal probe.
   The committee can switch any portal off — the row says who set it and when,
   and the sidecar leaves it out of the connection passes until it's back on. */
function OcpDatasetRow({
  d,
  link,
  onRecheck,
  rechecking,
  busy,
  enabled,
  override,
  toggling,
  onToggle,
}: {
  d: OcpDataset;
  link?: OcpPortalLink;
  onRecheck?: (id: number) => void;
  rechecking?: boolean;
  busy?: boolean;
  enabled: boolean;
  override?: { enabled: boolean; at: string; by: string };
  toggling?: boolean;
  onToggle?: (id: number, enabled: boolean) => void;
}) {
  const licenceIsUrl = d.license?.startsWith("http") ?? false;
  const counts = (
    [
      ["TENDERS", d.counts.tenders],
      ["AWARDS", d.counts.awards],
      ["CONTRACTS", d.counts.contracts],
      ["PARTIES", d.counts.parties],
      ["DOCUMENTS", d.counts.documents],
    ] as [string, number | undefined][]
  ).filter((entry): entry is [string, number] => (entry[1] ?? 0) > 0);
  const files = d.downloads.map((x) => (x.size ? `${x.format} ${x.size}` : x.format)).join(" · ");
  const linkClass =
    "inline-flex items-center gap-1 rounded-md border border-ink-200 px-2 py-1 font-code text-[7px] font-bold tracking-[0.14em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950";
  return (
    <li className="border-t border-ink-100 px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-code text-[9.5px] font-bold tracking-[0.1em] text-ink-950">{d.publisher}</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-code text-[7px] font-bold tracking-[0.14em] text-white",
                d.stale ? "bg-brand-600" : "bg-ink-950"
              )}
            >
              {d.stale ? "NO LONGER UPDATED" : "UPDATING"}
            </span>
            {!enabled && (
              <span className="rounded-full bg-ink-500 px-2 py-0.5 font-code text-[7px] font-bold tracking-[0.14em] text-white">
                OFF
              </span>
            )}
          </div>
          {override && (
            <p className="mt-0.5 font-code text-[7px] tracking-[0.16em] text-ink-400">
              {enabled ? "IN USE" : "NOT READ BY THE AGENT"} — SET BY {override.by.toUpperCase() || "UNKNOWN"} · {codeStamp(override.at).toUpperCase()}
            </p>
          )}
        </div>
        {onToggle && (
          <PortalSwitch
            on={enabled}
            busy={toggling}
            ariaLabel={`${enabled ? "Disable" : "Enable"} the ${d.publisher} portal`}
            title={
              enabled
                ? `Turn the ${d.publisher} portal off — the sidecar will leave it out of the connection passes and it will not be read`
                : `Turn the ${d.publisher} portal back on — it rejoins the connection passes immediately`
            }
            onToggle={() => onToggle(d.publicationId, !enabled)}
          />
        )}
      </div>
      <div className={cn(!enabled && "opacity-55")} aria-disabled={!enabled}>
        <p className="mt-1 font-code text-[7.5px] leading-[1.9] tracking-[0.14em] text-ink-400">
          RECORD {d.coverageFrom} → {d.coverageTo}
          {d.updateFrequency ? ` · ${d.updateFrequency.toUpperCase()}` : ""}
          {" · "}RETRIEVED {d.lastRetrieved || "NOT STATED"}
          {d.retrievedNote ? ` (${d.retrievedNote})` : ""}
          {d.ocidPrefix ? ` · ${d.ocidPrefix}` : ""}
        </p>
        <p className="mt-0.5 font-code text-[7.5px] leading-[1.9] tracking-[0.14em] text-ink-400">
          {!d.license
            ? "LICENCE — NOT STATED ON THE REGISTRY"
            : licenceIsUrl
              ? "LICENCE — PUBLISHER'S OWN TERMS"
              : `LICENCE — ${d.license.toUpperCase()}`}
          {files ? ` · ${files.toUpperCase()}` : ""}
        </p>
        {counts.length > 0 && (
          <p className="mt-0.5 font-code text-[7.5px] leading-[1.9] tracking-[0.14em] text-ink-500">
            {counts.map(([k, n]) => `${k} ${n.toLocaleString("en-US")}`).join(" · ")}
          </p>
        )}
        <p className="mt-0.5 font-code text-[7.5px] leading-[1.9] tracking-[0.14em]">
          {link ? (
            link.registry.ok ? (
              <>
                <span className="font-bold text-ink-950">LINKED</span>
                <span className="text-ink-400">
                  {" "}
                  {codeStamp(link.checkedAt)} · REGISTRY HTTP {link.registry.status} ·{" "}
                  {Math.max(1, Math.round(link.registry.bytes / 1024))} KB READ · FIRST OCDS RELEASE{" "}
                  {link.registry.ocid} ·{" "}
                </span>
                {link.portal.ok ? (
                  <span className="text-ink-400">PORTAL HTTP {link.portal.status}</span>
                ) : (
                  <span className="text-brand-700">
                    PORTAL {(link.portal.error ?? "UNREACHABLE").toUpperCase()}
                  </span>
                )}
              </>
            ) : (
              <span className="text-brand-700">
                LINK FAILED — {(link.registry.error ?? "UNKNOWN").toUpperCase()} · CHECKED {codeStamp(link.checkedAt)}
              </span>
            )
          ) : (
            <span className="text-ink-400">NOT YET CONNECTED — USE THE CONNECT BUTTON AT THE TOP OF THIS CARD</span>
          )}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <a href={d.registryUrl} target="_blank" rel="noreferrer" className={linkClass}>
            REGISTRY PAGE
            <ArrowUpRight className="h-2.5 w-2.5" aria-hidden="true" />
          </a>
          {d.portalUrl && (
            <a href={d.portalUrl} target="_blank" rel="noreferrer" className={linkClass}>
              PUBLISHER PORTAL
              <ArrowUpRight className="h-2.5 w-2.5" aria-hidden="true" />
            </a>
          )}
          {d.licenseUrl && (
            <a href={d.licenseUrl} target="_blank" rel="noreferrer" className={linkClass}>
              LICENCE
              <ArrowUpRight className="h-2.5 w-2.5" aria-hidden="true" />
            </a>
          )}
          {d.policyUrl && (
            <a href={d.policyUrl} target="_blank" rel="noreferrer" className={linkClass}>
              PUBLISHING POLICY
              <ArrowUpRight className="h-2.5 w-2.5" aria-hidden="true" />
            </a>
          )}
          {onRecheck && (
            <button
              type="button"
              onClick={() => onRecheck(d.publicationId)}
              disabled={!enabled || rechecking || busy}
              className={cn(linkClass, "disabled:cursor-not-allowed disabled:opacity-50")}
              title={
                !enabled
                  ? "The portal is switched off — turn it on to re-check it"
                  : "Open the published file again, read its first release, and re-check the publisher's portal"
              }
            >
              <RefreshCw className={cn("h-2.5 w-2.5", rechecking && "animate-spin")} aria-hidden="true" />
              {rechecking ? "CHECKING" : "RE-CHECK"}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function RegistryCountries({
  countries,
  datasets,
  links,
  overrides,
  pendingToggleIds,
  togglePortals,
  connectDatasets,
  connecting,
  rechecking,
  query = "",
  emptyNote = "NO JURISDICTION MATCHES THAT FILTER",
}: {
  countries: OcpCountry[];
  datasets: OcpDataset[];
  links: Record<string, OcpPortalLink>;
  overrides: Record<string, { enabled: boolean; at: string; by: string }>;
  pendingToggleIds: number[];
  togglePortals: (ids: number[], enabled: boolean, okMsg: string) => Promise<void>;
  connectDatasets: (ids: number[]) => Promise<void>;
  connecting: boolean;
  rechecking: number | null;
  query?: string;
  emptyNote?: string;
}) {
  const [openCountry, setOpenCountry] = useState<string | null>(null);
  const enabledOf = (id: number) => overrides[String(id)]?.enabled ?? true;
  const needle = query.trim().toLowerCase();
  const visible = countries.filter((c) => {
    if (!needle) return true;
    if (c.country.toLowerCase().includes(needle)) return true;
    return datasets.some((d) => d.country === c.country && d.publisher.toLowerCase().includes(needle));
  });

  if (visible.length === 0) {
    return (
      <p className="px-5 py-6 font-code text-[8px] tracking-[0.18em] text-ink-400">{emptyNote}</p>
    );
  }

  return (
    <ul>
      {visible.map((c) => {
        const rows = datasets.filter((d) => d.country === c.country);
        const open = openCountry === c.country;
        const status = c.stale === c.datasets ? "ARCHIVED" : "UPDATING";
        /* The country's master switch: all-on flips the whole country off;
           mixed or all-off brings every portal back. */
        const offInCountry = rows.filter((d) => !enabledOf(d.publicationId)).length;
        const allOn = offInCountry === 0;
        const mixedCountry = offInCountry > 0 && offInCountry < rows.length;
        const countryBusy = rows.some((d) => pendingToggleIds.includes(d.publicationId));
        const masterToggle = () => {
          const ids = rows.map((d) => d.publicationId);
          const turnOn = !allOn;
          const n = ids.length;
          void togglePortals(
            ids,
            turnOn,
            turnOn
              ? `${c.country.toUpperCase()} ON — ${n} PORTAL${n === 1 ? "" : "S"} BACK IN THE PASS`
              : `${c.country.toUpperCase()} OFF — ${n} PORTAL${n === 1 ? "" : "S"} OUT OF THE PASS`,
          );
        };
        return (
          <li key={c.country} className="border-b border-ink-100 last:border-b-0">
            <div className="flex w-full items-center gap-3 px-5 py-4">
              <button
                type="button"
                onClick={() => setOpenCountry(open ? null : c.country)}
                aria-expanded={open}
                className="flex min-w-0 flex-1 flex-wrap items-center gap-3 text-left transition-colors hover:bg-sand/50"
              >
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    offInCountry === rows.length ? "bg-ink-300" : status === "ARCHIVED" ? "bg-ink-400" : "bg-ink-950",
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "font-code text-[10px] font-bold tracking-[0.12em]",
                        offInCountry === rows.length ? "text-ink-400" : "text-ink-950",
                      )}
                    >
                      {c.country.toUpperCase()}
                    </span>
                    <span className="rounded border border-ink-200 px-1 py-px font-code text-[7px] tracking-[0.16em] text-ink-400">
                      {c.iso}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 font-code text-[7px] font-bold tracking-[0.16em] text-white",
                        status === "UPDATING" ? "bg-ink-950" : "bg-ink-400",
                      )}
                      title={
                        status === "UPDATING"
                          ? c.stale > 0
                            ? `The live portals are still being updated · ${c.stale} archived dataset${c.stale === 1 ? "" : "s"} stay readable and are flagged individually`
                            : "Every dataset from this country is still being updated by its publisher"
                          : "Every dataset from this country is no longer updated by its publisher"
                      }
                    >
                      {status}
                    </span>
                    {offInCountry > 0 && (
                      <span className="rounded-full bg-ink-500 px-2 py-0.5 font-code text-[7px] font-bold tracking-[0.16em] text-white">
                        {offInCountry === rows.length ? "ALL OFF" : `${offInCountry} OFF`}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block font-code text-[7.5px] tracking-[0.18em] text-ink-400">
                    {c.datasets} {c.datasets === 1 ? "DATASET" : "DATASETS"} · {c.publishers.length}{" "}
                    {c.publishers.length === 1 ? "PUBLISHER" : "PUBLISHERS"} · RECORD {c.coverageFrom} →{" "}
                    {c.coverageTo} · RETRIEVED {c.lastRetrieved || "NOT STATED"}
                  </span>
                </span>
                <ChevronDown
                  className={cn("h-3.5 w-3.5 shrink-0 text-ink-400 transition-transform", open && "rotate-180")}
                  aria-hidden="true"
                />
              </button>
              <PortalSwitch
                on={allOn}
                mixed={mixedCountry}
                busy={countryBusy}
                ariaLabel={`Turn ${c.country}'s ${rows.length} portal${rows.length === 1 ? "" : "s"} ${allOn ? "off" : "on"}`}
                title={
                  allOn
                    ? `Turn all ${rows.length} of ${c.country}'s portals off — none of them will be probed or read`
                    : mixedCountry
                      ? `${offInCountry} of ${rows.length} of ${c.country}'s portals are off — click to bring them all back on`
                      : `Turn ${c.country}'s portals back on — they rejoin the connection passes immediately`
                }
                onToggle={masterToggle}
              />
            </div>
            {open && (
              <ul className="bg-sand/40">
                {rows.map((d) => (
                  <OcpDatasetRow
                    key={d.publicationId}
                    d={d}
                    link={links[String(d.publicationId)]}
                    onRecheck={(id) => void connectDatasets([id])}
                    rechecking={rechecking === d.publicationId}
                    busy={connecting || rechecking !== null}
                    enabled={enabledOf(d.publicationId)}
                    override={overrides[String(d.publicationId)]}
                    toggling={pendingToggleIds.includes(d.publicationId)}
                    onToggle={(id, on) =>
                      void togglePortals(
                        [id],
                        on,
                        on
                          ? `PORTAL ON — ${d.publisher.toUpperCase()} IS BACK IN THE PASS`
                          : `PORTAL OFF — ${d.publisher.toUpperCase()} IS OUT OF THE PASS`,
                      )
                    }
                  />
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function PortalSync() {
  const { data, failed } = useOcpRegistry();
  const countries = data?.countries ?? [];
  const datasets = data?.datasets ?? [];
  const links = data?.links.links ?? {};
  const linkedByCountry = new Map<string, number>();
  for (const d of datasets) {
    if (links[String(d.publicationId)]?.registry.ok) {
      linkedByCountry.set(d.country, (linkedByCountry.get(d.country) ?? 0) + 1);
    }
  }
  return (
    <div className="rounded-[12px] panel p-5 shadow-[0_1px_2px_rgba(11,12,15,0.04)]">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-[15px] font-black tracking-[-0.01em] text-ink-950">Connected portals</h3>
        <span className="type-micro text-ink-400">
          {data
            ? `${countries.length} countries · ${datasets.length} datasets`
            : failed
              ? "Registry unreachable"
              : "Reading the registry…"}
        </span>
      </div>
      {data ? (
        <ul className="mt-4 space-y-3">
          {countries.map((c) => (
            <li key={c.country} className="flex items-start gap-3">
              <span
                className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", c.stale > 0 ? "bg-brand-600" : "bg-ink-950")}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate type-micro text-ink-800">{c.country}</span>
                  <span className="shrink-0 type-micro text-ink-400 tabular">
                    retr. {c.lastRetrieved || "not stated"}
                  </span>
                </span>
                <span className="mt-1 block type-micro text-ink-400 tabular">
                  {c.datasets} {c.datasets === 1 ? "dataset" : "datasets"}
                  {(linkedByCountry.get(c.country) ?? 0) > 0 ? ` · ${linkedByCountry.get(c.country)} linked` : ""}
                  {c.stale > 0 ? ` · ${c.stale} not updated` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 font-code text-[8.5px] leading-[1.9] tracking-[0.16em] text-ink-400">
          {failed
            ? "THE OCP DATA REGISTRY SNAPSHOT COULD NOT BE READ — SIDECAR OFFLINE"
            : "READING THE OCP DATA REGISTRY…"}
        </p>
      )}
      <p className="mt-4 font-code text-[7px] leading-[1.8] tracking-[0.14em] text-ink-400">
        {data
          ? `OCP DATA REGISTRY · RETRIEVED ${codeDate(data.source.retrieved)}`
          : "OCP DATA REGISTRY · data.open-contracting.org"}
      </p>
      <div className="mt-4 flex items-center gap-2.5 rounded-[10px] border border-ink-200/70 bg-sand/70 px-3.5 py-3 dark:border-white/10">
        <ShieldCheck className="h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" />
        <p className="type-micro leading-[1.9] text-ink-600">
          Activity log locked against edits · can run on your own servers
        </p>
      </div>
    </div>
  );
}

/* ── Shared view furniture ───────────────────────────────────────────────── */

function ViewShell({
  fig,
  title,
  sub,
  action,
  summary,
  children,
}: {
  fig: string;
  title: string;
  sub: string;
  action?: ReactNode;
  /* The dossier strip under the header — the screen's instrument reading. */
  summary?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <DeploymentBanner />
      <SpecBar index={fig} label="Workspace" meta={title} />
      <div className="mt-6 flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <h1 className="type-display text-[30px] text-ink-950 sm:text-[38px]">
            {title}
            <span className="text-brand-600">.</span>
          </h1>
          {/* The lede runs the full measure — the officer asked for the
              whole width; the container itself keeps the line sane. */}
          <p className="type-lede mt-3 text-ink-600">{sub}</p>
        </div>
        {action ? <div className="shrink-0 pb-1.5">{action}</div> : null}
      </div>
      {summary ? <div className="mt-6">{summary}</div> : null}
      <div className={summary ? "mt-4" : "mt-9"}>{children}</div>
    </div>
  );
}

/** A quiet status pill for a section header — live, clear, or idle. */
function DeskStatus({ tone, children }: { tone: "live" | "clear" | "idle"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full border px-3 font-code text-[8.5px] font-bold tracking-[0.16em]",
        tone === "live" &&
          "border-brand-500/35 bg-brand-500/[0.06] text-brand-700 dark:border-brand-500/40 dark:text-brand-300",
        tone === "clear" &&
          "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:border-emerald-400/30 dark:text-emerald-300",
        tone === "idle" &&
          "border-ink-200 bg-[#fffdfb] text-ink-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-ink-400",
      )}
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
        {tone === "live" ? (
          <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" />
        ) : null}
        <span
          className={cn(
            "relative inline-flex h-1.5 w-1.5 rounded-full",
            tone === "live" ? "bg-brand-600" : tone === "clear" ? "bg-emerald-500" : "bg-ink-400",
          )}
        />
      </span>
      {children}
    </span>
  );
}

/**
 * StageStrip — the desk's distribution rail.
 *
 * The tender cycle owns the *progression* rail (seven stages, one active).
 * A queue has a different shape: it is a set of loads across stages or
 * offices. Same grammar — hairline cells, a count, a label, a share meter —
 * so the two screens read as one instrument.
 */
function StageStrip({
  label,
  meta,
  items,
  search,
}: {
  label: string;
  meta?: ReactNode;
  items: { key: string; label: string; count: number; caption: string; tone?: "brand" | "emerald" | "idle" }[];
  /* An optional local filter, rendered in the strip's own header. */
  search?: ReactNode;
}) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return (
    <section className="panel overflow-hidden rounded-[12px]" aria-label={label}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3.5 pt-4">
        <p className="eyebrow">{label}</p>
        <div className="flex flex-wrap items-center gap-3">
          {search}
          {meta ? (
            <div className="font-code text-[8.5px] font-bold tracking-[0.16em] text-ink-400 tabular">{meta}</div>
          ) : null}
        </div>
      </div>
      {items.length === 0 ? (
        <p className="border-t border-ink-100/80 px-5 py-5 font-code text-[8.5px] font-bold tracking-[0.16em] text-ink-400 dark:border-white/[0.06]">
          NO OFFICE MATCHES THIS SEARCH
        </p>
      ) : (
      <div
        className={cn(
          "grid grid-cols-2 gap-px border-t border-ink-100/80 bg-ink-100/70 dark:border-white/[0.06] dark:bg-white/[0.07]",
          items.length >= 4 ? "sm:grid-cols-4" : items.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
        )}
      >
        {items.map((item) => {
          const share = total > 0 ? Math.round((item.count / total) * 100) : 0;
          const tone = item.tone ?? "idle";
          return (
            <div key={item.key} className="flex min-h-[112px] min-w-0 flex-col bg-[#fffdfb] px-5 py-3.5 dark:bg-[#12141a]">
              <div className="flex items-baseline justify-between gap-2">
                <p
                  className={cn(
                    "font-display text-[24px] font-bold leading-none tracking-[-0.025em] tabular",
                    tone === "emerald" && "text-emerald-600 dark:text-emerald-400",
                    tone === "brand" && "text-brand-600 dark:text-brand-400",
                    tone === "idle" && "text-ink-900",
                  )}
                >
                  {item.count}
                </p>
                <span className="font-code text-[8px] font-bold tracking-[0.08em] text-ink-400 tabular">
                  {share}%
                </span>
              </div>
              <p className="eyebrow mt-2 text-[8px] tracking-[0.16em]">{item.label.toUpperCase()}</p>
              <p className="mt-1 truncate text-[10.5px] leading-tight text-ink-400">{item.caption}</p>
              <div className="mt-auto pt-3" aria-hidden="true">
                <span className="block h-[2px] overflow-hidden rounded-full bg-ink-100 dark:bg-white/[0.08]">
                  <motion.span
                    className={cn(
                      "block h-full rounded-full",
                      tone === "emerald" && "bg-emerald-500",
                      tone === "brand" && "bg-brand-500",
                      tone === "idle" && "bg-ink-300 dark:bg-white/25",
                    )}
                    initial={false}
                    animate={{ width: `${share}%` }}
                    transition={{ duration: 0.6, ease: EASE }}
                  />
                </span>
              </div>
            </div>
          );
        })}
      </div>
      )}
    </section>
  );
}

function StandingRuleCard() {
  return (
    <div className="relative overflow-hidden rounded-[12px] border border-ink-950 bg-night p-5 text-white shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_28px_60px_-30px_rgba(11,12,15,0.6)]">
      <div className="bg-grid-dark pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-500/70 to-transparent"
      />
      <div className="relative">
        <h3 className="type-title">The standing rule</h3>
        <p className="mt-3 font-code text-[9px] leading-[2] tracking-[0.16em] text-ink-300">
          QUORUM PREPARES THE FILE.
          <br />
          IT NEVER AWARDS THE TENDER.
          <br />
          <span className="text-brand-400">THE COMMITTEE SIGNS — THE AGENT NEVER DOES.</span>
        </p>
        <a
          href="/docs#docs-safeguards"
          className="mt-4 inline-flex items-center gap-1.5 font-code text-[8.5px] font-bold tracking-[0.2em] text-ink-300 transition-colors hover:text-white"
        >
          READ THE RULES
          <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

function NewRunCard({ onNewRun }: { onNewRun: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-[12px] border border-ink-950 bg-night p-5 text-white shadow-[0_22px_55px_rgba(11,12,15,0.3)]">
      <div className="bg-grid-dark pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
      <div className="relative">
        <h3 className="font-display text-[15px] font-black tracking-[-0.01em]">Put the agent in a file</h3>
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-300">
          Point Quorum at a tender — OCDS, a PDF pack or the email bag. Findings appear here as the agent reads the file.
        </p>
        <button
          type="button"
          onClick={onNewRun}
          className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-4 font-code text-[9px] font-bold tracking-[0.18em] text-white transition-colors hover:bg-brand-700"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          QUEUE A RUN
        </button>
      </div>
    </div>
  );
}

function GavelProtocolCard() {
  return (
    <div className="rounded-[12px] panel p-5 shadow-[0_1px_2px_rgba(11,12,15,0.04)]">
      <h3 className="font-display text-[15px] font-black tracking-[-0.01em] text-ink-950">The gavel protocol</h3>
      <ol className="mt-4 space-y-3">
        {[
          "THE AGENT QUEUES THE FILE AT THE GATE",
          "THE COMMITTEE READS THE CITED FLAGS",
          "AWARD OR RETURN — BY NAMED HUMANS",
          "THE LEDGER LOGS IT, PERMANENTLY",
        ].map((step, i) => (
          <li key={step} className="flex gap-3 font-code text-[8.5px] tracking-[0.16em] text-ink-600">
            <span className="shrink-0 font-bold text-brand-600">0{i + 1}</span>
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ── Findings ledger ─────────────────────────────────────────────────────── */

type FindingClass =
  | "DOCUMENT"
  | "COMPLIANCE"
  | "PRICING"
  | "REGISTRY"
  | "ARITHMETIC"
  | "DISCLOSURE"
  | "LOGISTICS"
  | "SECURITY";
type FindingStatus = "OPEN" | "CLEARED" | "RE-CHECK";
type SeedFinding = { run: string; note: string; cls: FindingClass; src: string };
type FindingRow = SeedFinding & { id: string; tender: string; status: FindingStatus };

function buildFindingRows(
  seed: SeedFinding[],
  runs: McRun[],
  verdicts: Record<string, "AWARDED" | "RETURNED">
): FindingRow[] {
  return seed.flatMap((f, i) => {
    const run = runs.find((r) => r.id === f.run);
    if (!run) return [];
    /* A run still in flight has no findings yet — except one the committee
       has returned, whose flags re-open as RE-CHECK while the agent re-verifies. */
    if (run.status === "queued") return [];
    if (run.status === "running" && verdicts[f.run] !== "RETURNED") return [];
    const status: FindingStatus =
      verdicts[f.run] === "AWARDED" ? "CLEARED" : verdicts[f.run] === "RETURNED" ? "RE-CHECK" : "OPEN";
    return [{ ...f, id: `${f.run}-f${i}`, tender: run.title, status }];
  });
}

function FindingStatusChip({ status }: { status: FindingStatus }) {
  if (status === "OPEN")
    return (
      <span className="inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 font-code text-[8.5px] font-bold tracking-[0.16em] text-brand-800">
        OPEN
      </span>
    );
  if (status === "RE-CHECK")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-2.5 py-1 font-code text-[8.5px] font-bold tracking-[0.16em] text-white">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-white" aria-hidden="true" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" />
        </span>
        RE-CHECK
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ink-950 px-2.5 py-1 font-code text-[8.5px] font-bold tracking-[0.16em] text-white">
      <CircleCheck className="h-2.5 w-2.5" aria-hidden="true" />
      CLEARED
    </span>
  );
}

function FindingsView({ rows, onOpenRun }: { rows: FindingRow[]; onOpenRun: () => void }) {
  const [f, setF] = useState<"ALL" | FindingStatus>("ALL");
  const filtered = f === "ALL" ? rows : rows.filter((r) => r.status === f);
  const open = rows.filter((r) => r.status === "OPEN").length;
  const classCounts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.cls] = (acc[r.cls] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <ViewShell
      fig="08"
      title="Findings"
      sub="Every flag the agent has raised — classed, cited, and traceable to the page it came from. When the committee clears a gate, its flags clear with it."
    >
      <div className="grid grid-cols-1 gap-4 sm:gap-6">
        <div className="min-w-0">
          <div className="overflow-hidden rounded-[12px] panel shadow-[0_1px_2px_rgba(11,12,15,0.04)]">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
              <div>
                <h2 className="font-display text-[17px] font-black tracking-[-0.01em] text-ink-950">All findings</h2>
                <p className="mt-0.5 font-code text-[8.5px] tracking-[0.2em] text-ink-400">
                  {rows.length} FLAGS · {open} OPEN · {rows.filter((x) => !x.src).length} UNSOURCED
                </p>
              </div>
              <div data-tour="findings-filters" className="flex items-center gap-1.5" role="group" aria-label="Filter findings by status">
                {(["ALL", "OPEN", "CLEARED", "RE-CHECK"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setF(k)}
                    aria-pressed={f === k}
                    className={cn(
                      "h-7 rounded-full border px-3 font-code text-[8.5px] font-bold tracking-[0.14em] transition-all",
                      f === k
                        ? "border-ink-950 bg-ink-950 text-white"
                        : "border-ink-200 bg-white text-ink-500 hover:border-ink-400"
                    )}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </header>
            <div data-tour="findings-rows" className="max-h-[520px] overflow-y-auto [scrollbar-width:thin]">
              <table className="w-full min-w-[620px] border-collapse text-left">
                <caption className="sr-only">Findings — every flag with its class, status and source</caption>
                <thead className="sticky top-0 z-10 bg-paper/95 backdrop-blur">
                  <tr className="border-b border-ink-100">
                    {["FINDING", "CLASS", "STATUS", "SOURCE", "RUN"].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className="px-4 py-2.5 font-code text-[8px] font-semibold tracking-[0.22em] text-ink-400 first:pl-5 first:pr-4 last:pr-5"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr
                      key={row.id}
                      tabIndex={0}
                      onClick={onOpenRun}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenRun();
                        }
                      }}
                      aria-label={`Show details for evaluation ${row.run}`}
                      className="cursor-pointer border-b border-ink-100 transition-colors hover:bg-paper"
                    >
                      <td className="max-w-[280px] py-3.5 pl-5 pr-4">
                        <p className="text-[13px] font-semibold text-ink-900">{row.note}</p>
                        <p className="mt-0.5 truncate text-[11.5px] text-ink-400">{row.tender}</p>
                      </td>
                      <td className="px-4">
                        <span className="inline-flex rounded-md border border-ink-200 bg-white px-2 py-1 font-code text-[7.5px] font-bold tracking-[0.14em] text-ink-600">
                          {row.cls}
                        </span>
                      </td>
                      <td className="px-4">
                        <FindingStatusChip status={row.status} />
                      </td>
                      <td className="px-4 font-code text-[8.5px] tracking-[0.1em] text-ink-500">{row.src}</td>
                      <td className="py-3.5 pr-5 font-code text-[9.5px] font-bold tracking-[0.06em] text-ink-950">{row.run}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-10 text-center font-code text-[10px] tracking-[0.18em] text-ink-400">
                        NO FINDINGS IN THIS VIEW
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
          <div className="relative overflow-hidden rounded-[12px] border border-ink-950 bg-night p-5 text-white shadow-[0_22px_55px_rgba(11,12,15,0.3)]">
            <div className="bg-grid-dark pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
            <div className="relative">
              <h3 className="font-display text-[15px] font-black tracking-[-0.01em]">The invariant</h3>
              <p className="mt-3 font-code text-[9px] leading-[2] tracking-[0.16em] text-ink-300">
                0 UNSOURCED CLAIMS.
                <br />
                EVERY FLAG CARRIES A PAGE,
                <br />
                A CLAUSE OR A REGISTRY ID —
                <br />
                <span className="text-brand-400">BY CONSTRUCTION, NOT BY PROMISE.</span>
              </p>
            </div>
          </div>
          <div className="rounded-[12px] panel p-5 shadow-[0_1px_2px_rgba(11,12,15,0.04)]">
            <h3 className="font-display text-[15px] font-black tracking-[-0.01em] text-ink-950">Class map</h3>
            <ul className="mt-4 space-y-2.5">
              {Object.entries(classCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([cls, n]) => (
                  <li key={cls} className="flex items-center gap-3">
                    <span className="w-[96px] shrink-0 font-code text-[8px] font-bold tracking-[0.16em] text-ink-600">{cls}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                      <span
                        className="block h-full rounded-full bg-brand-500"
                        style={{ width: `${rows.length > 0 ? (n / rows.length) * 100 : 0}%` }}
                      />
                    </span>
                    <span className="w-6 text-right font-code text-[9px] font-bold text-ink-800 tabular">{n}</span>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      </div>
    </ViewShell>
  );
}

/* ── Report packs ────────────────────────────────────────────────────────── */

/* The REAL seal comes from the sidecar — the executed gate's receipt hash, a
   sha-256 of the sealed bundle computed by the filing graph. Nothing in the
   UI synthesizes a hash; until the gate signs, the pack says so. */
function sealText(run: Pick<McRun, "seal">): string {
  return run.seal ? `seal ${run.seal}` : "unsealed — seals at the gate";
}

/* The sealed pack leaves the desk as a real file — the evidence, portable.
   Every number on it is real: the size is this file's own byte length, the
   seal is the sidecar's receipt hash. Nothing is estimated. */
function packMarkdown(run: McRun, findings: SeedFinding[], verdict: "AWARDED" | "RETURNED" | null): string {
  const lines = [
    `# Quorum — committee pack · ${run.id}`,
    "",
    `- Run record: ${run.uid ?? run.id}`,
    `- Status: SEALED${verdict ? ` · ${verdict}` : " AT THE GATE"}`,
    `- Findings: ${run.findings} · Citations: ${run.citations} · Unsourced: ${run.unsourced}`,
    `- ${run.seal ? `Seal: ${run.seal}` : "Seal: pending gate signature"}${run.sealedBy ? ` · signed by ${run.sealedBy}` : ""}`,
    "",
    "## Sourced findings",
    ...(findings.length
      ? findings.map((f) => `- [${f.cls}] ${f.note}${f.src ? ` — ${f.src}` : " — NO SOURCE ON FILE"}`)
      : ["- The bound findings are listed in the sealed file."]),
    "",
    "## Audit trail",
    "- Every finding above cites the page, clause or registry ID it was read from.",
    `- Decision: ${verdict ? `${verdict} — signed at the gate.` : "seals at the gate."}`,
  ];
  const base = lines.join("\n");
  const kb = (new TextEncoder().encode(base).length / 1024).toFixed(1);
  lines.push("", `- Pack size: ${kb} KB as downloaded · verify the seal against the audit log (Tools & models).`);
  return lines.join("\n");
}

/* The draft pack, opened for reading: exactly what sealing will carry,
   export still locked. The preview the walkthrough promises. */
function PackPreviewModal({
  run,
  findings,
  onClose,
  onOpenApprovals,
}: {
  run: McRun | null;
  findings: SeedFinding[];
  onClose: () => void;
  onOpenApprovals: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  /* Focus moves into the sheet; Escape hands the desk back — and the
     officer's focus returns to the button that opened the preview. */
  useEffect(() => {
    if (!run) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const t = setTimeout(() => closeRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, [run, onClose]);

  /* Tab stays inside the dialog. */
  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const nodes = Array.from(
      cardRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [],
    );
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !cardRef.current?.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const rows = useMemo(() => (run ? findings.filter((f) => f.run === run.id) : []), [run, findings]);
  const shown = rows.slice(0, 5);

  return (
    <AnimatePresence>
      {run && (
        <motion.div
          key="pack-preview"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[70] grid place-items-center bg-night/70 p-4 backdrop-blur-sm"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pack-preview-title"
        >
          <motion.div
            ref={cardRef}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.28, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={trapTab}
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[12px] panel panel-lift p-5 sm:p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-code text-[8px] font-semibold tracking-[0.24em] text-ink-400">REPORT PACK · DRAFT PREVIEW</p>
                <h3 id="pack-preview-title" className="mt-1 font-display text-[22px] font-black tracking-[-0.015em] text-ink-950">
                  Committee pack — draft
                </h3>
                <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-ink-500">
                  The pack is drafted in full. Nothing leaves the desk until the gate signs — this sheet is exactly what
                  the sealed file will carry.
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label="Close the preview"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-paper hover:text-ink-900"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* The sheet — a draft of the sealed document, marked as such */}
            <div className="relative mt-5 overflow-hidden rounded-[10px] border border-ink-100 bg-paper p-5 sm:p-6">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -right-2 top-7 rotate-12 select-none font-display text-[64px] font-black leading-none tracking-[-0.02em] text-ink-950/[0.05]"
              >
                DRAFT
              </span>
              <div className="relative">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded-md bg-ink-950 font-display text-[10px] font-black text-white">
                      Q
                    </span>
                    <p className="font-code text-[8.5px] font-bold tracking-[0.22em] text-ink-950">
                      QUORUM · PROCUREMENT REVIEW
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-2.5 py-1 font-code text-[7.5px] font-bold tracking-[0.16em] text-ink-600">
                    <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                    UNSEALED · PENDING GATE
                  </span>
                </div>

                <p className="mt-4 font-code text-[8px] tracking-[0.2em] text-ink-400">TENDER</p>
                <p className="mt-1 font-display text-[24px] font-black tracking-[-0.02em] text-ink-950">{run.id}</p>
                <p className="mt-1 font-code text-[8.5px] tracking-[0.14em] text-ink-500">
                  RUN {run.uid ?? run.id} · STARTED {run.startedAt} · PREPARED FOR THE COMMITTEE
                </p>

                <dl className="mt-5 grid grid-cols-2 gap-3 border-y border-ink-950/10 py-3.5 sm:grid-cols-4">
                  {[
                    { k: "FINDINGS", v: String(run.findings), tone: "text-ink-950" },
                    { k: "CITED", v: String(run.citations), tone: "text-ink-950" },
                    { k: "UNSOURCED", v: String(run.unsourced), tone: "text-brand-700" },
                    { k: "SEAL", v: run.seal ? `${run.seal.slice(0, 10)}…` : "PENDING", tone: "text-ink-950" },
                  ].map((cell) => (
                    <div key={cell.k}>
                      <dt className="font-code text-[7.5px] tracking-[0.18em] text-ink-400">{cell.k}</dt>
                      <dd className={cn("mt-1 text-[14px] font-bold tabular", cell.tone)}>{cell.v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 font-code text-[8px] tracking-[0.14em] text-ink-400">
                  {sealText(run).toUpperCase()}
                  {run.sealedBy ? ` · BY ${run.sealedBy.toUpperCase()}` : ""}
                </p>

                <p className="mt-5 font-code text-[8.5px] font-bold tracking-[0.22em] text-ink-950">THE PACK BINDS</p>
                <ul className="mt-2.5 space-y-2">
                  {[
                    {
                      n: "01",
                      t: `${run.findings} sourced findings`,
                      d: "classed and cited to the page, clause or registry each was read from.",
                    },
                    {
                      n: "02",
                      t: `${run.citations} citations`,
                      d: "the evidence behind every finding, filed with the run.",
                    },
                    {
                      n: "03",
                      t: run.seal ? `Audit seal · ${run.seal}` : "Audit seal · applied at the gate",
                      d: "a sha-256 of the sealed bundle — verify it against the audit log.",
                    },
                    {
                      n: "04",
                      t: "Decision sheet",
                      d: "unsigned — the committee's signature seals the pack.",
                    },
                  ].map((item) => (
                    <li key={item.n} className="flex items-baseline gap-2.5">
                      <span className="font-code text-[8px] font-bold tracking-[0.14em] text-ink-400">{item.n}</span>
                      <span className="min-w-0">
                        <span className="text-[12.5px] font-semibold text-ink-900">{item.t}</span>
                        <span className="text-[12px] text-ink-500"> — {item.d}</span>
                      </span>
                    </li>
                  ))}
                </ul>

                <p className="mt-5 font-code text-[8.5px] font-bold tracking-[0.22em] text-ink-950">
                  FIRST FINDINGS, AS THEY&apos;LL SEAL
                </p>
                <ul className="mt-2.5 space-y-2.5">
                  {shown.map((f, i) => (
                    <li key={`${f.run}-${i}`} className="flex gap-2.5">
                      <span className="mt-px inline-flex h-fit shrink-0 rounded-md border border-ink-200 bg-white px-2 py-1 font-code text-[7px] font-bold tracking-[0.14em] text-ink-600">
                        {f.cls}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12px] leading-snug text-ink-800">{f.note}</span>
                        <span className="mt-0.5 block font-code text-[7.5px] tracking-[0.12em] text-ink-400">
                          {f.src || "NO SOURCE ON FILE"}
                        </span>
                      </span>
                    </li>
                  ))}
                  {rows.length === 0 && (
                    <li className="font-code text-[8.5px] tracking-[0.16em] text-ink-400">
                      FINDING DETAIL BINDS AT SEAL TIME
                    </li>
                  )}
                </ul>
                {rows.length > shown.length && (
                  <p className="mt-2.5 font-code text-[8px] tracking-[0.16em] text-ink-400">
                    + {rows.length - shown.length} MORE FINDINGS — ALL BOUND IN THE SEALED PACK
                  </p>
                )}

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-100 bg-white px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink-950 text-white">
                      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="font-code text-[8.5px] font-bold tracking-[0.18em] text-ink-950">EXPORT LOCKED</p>
                      <p className="mt-0.5 text-[11.5px] leading-snug text-ink-500">
                        Seals the moment the committee signs at the gate.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled
                    className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-lg border border-ink-100 px-3 font-code text-[8px] font-bold tracking-[0.16em] text-ink-400"
                  >
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    UNLOCKS ON SIGNATURE
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-sm text-[11.5px] leading-relaxed text-ink-400">
                The verdict prints on the cover once the gate records it — AWARDED or RETURNED.
              </p>
              <div className="flex items-center gap-2">
                {run.status === "gate" && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenApprovals();
                    }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-ink-200 px-3.5 font-code text-[8.5px] font-bold tracking-[0.16em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950"
                  >
                    GO TO APPROVALS
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-9 items-center rounded-xl bg-ink-950 px-4 font-code text-[8.5px] font-bold tracking-[0.16em] text-white transition-colors hover:bg-brand-600"
                >
                  CLOSE PREVIEW
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ReportPacksView({
  runs,
  verdicts,
  findings,
  onToast,
  onOpenApprovals,
}: {
  runs: McRun[];
  verdicts: Record<string, "AWARDED" | "RETURNED">;
  findings: SeedFinding[];
  onToast: (m: string) => void;
  onOpenApprovals: () => void;
}) {
  const packs = runs.filter((r) => r.findings > 0 && (r.status === "gate" || r.status === "complete"));
  const [preview, setPreview] = useState<McRun | null>(null);
  /* Stable close — the dialog's Escape listener must not churn as polls land. */
  const closePreview = useCallback(() => setPreview(null), []);

  /* Real, auditable pack binding: the request lands in the sidecar's
     append-only log with the attested actor, and the latest event is
     restored from the log on mount — the log IS the record. */
  const [binding, setBinding] = useState<{ queuedAt: string; by?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/log?limit=200&XTransformPort=3031")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { entries?: { tool?: string; outputs?: { queuedAt?: string }; actor?: string }[] } | null) => {
        if (!alive) return;
        const hit = (j?.entries ?? []).find((e) => e.tool === "pack_binding" && e.outputs?.queuedAt);
        if (hit?.outputs?.queuedAt) setBinding({ queuedAt: hit.outputs.queuedAt, by: hit.actor });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const queueBinding = () => {
    fetch("/api/pack-binding?XTransformPort=3031", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
      .then(async (r) => {
        if (r.status === 401) {
          onToast("SIGN IN FIRST — BINDING IS RECORDED IN THE AUDIT LOG");
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { queuedAt: string; by?: string };
        setBinding(j);
        onToast(`PACK BINDING QUEUED — ${new Date(j.queuedAt).toLocaleTimeString()} · IN THE AUDIT LOG`);
      })
      .catch(() => onToast("BINDING FAILED — AGENT SERVICE UNREACHABLE"));
  };

  return (
    <>
    <ViewShell
      fig="09"
      title="Reports"
      sub="The sourced report is the deliverable — findings, citations and the audit hash, bound to each evaluation. A pack seals the moment the committee signs; after that it is evidence, not a document."
    >
      <div data-tour="reports-intro" className="relative overflow-hidden rounded-[12px] border border-ink-950 bg-night p-5 text-white shadow-[0_22px_55px_rgba(11,12,15,0.3)] sm:p-6">
        <div className="bg-grid-dark pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="font-display text-[15px] font-black tracking-[-0.01em]">The committee pack</h3>
            <p className="mt-2 max-w-md text-[12.5px] leading-relaxed text-ink-300">
              Every sealed report for the sitting, bound into one cited file with a shared audit hash — the pack the
              committee actually reads.
            </p>
          </div>
          <button
            type="button"
            onClick={queueBinding}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-600 px-4 font-code text-[9px] font-bold tracking-[0.18em] text-white transition-colors hover:bg-brand-700"
          >
            <Files className="h-3.5 w-3.5" aria-hidden="true" />
            QUEUE BINDING
          </button>
        </div>
        {binding && (
          <p className="relative mt-3 border-t border-white/10 pt-2.5 font-code text-[8px] tracking-[0.16em] text-ink-400">
            BINDING QUEUED {new Date(binding.queuedAt).toLocaleString().toUpperCase()}
            {binding.by ? ` · BY ${binding.by.toUpperCase()}` : ""} · RECORDED IN THE AUDIT LOG
          </p>
        )}
      </div>

      <div data-tour="reports-list" className="mt-4 grid grid-cols-1 gap-4 sm:mt-6 sm:grid-cols-2 sm:gap-6">
        {packs.map((run, i) => {
          const assembling = run.status === "gate";
          const v = verdicts[run.id];
          const decision =
            v === "AWARDED"
              ? "AWARDED — SIGNED AT THE GATE"
              : v === "RETURNED"
                ? "RETURNED — RE-FILED AFTER CLARIFICATION"
                : null;
          const packFindings = findings.filter((f) => f.run === run.id);
          return (
            <motion.article
              key={run.uid ?? run.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.05 * i, ease: EASE }}
              className="flex flex-col rounded-[12px] panel p-5 shadow-[0_1px_2px_rgba(11,12,15,0.04)]"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-950">{run.id}</p>
                {assembling ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 font-code text-[8px] font-bold tracking-[0.16em] text-brand-700">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" aria-hidden="true" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-600" aria-hidden="true" />
                    </span>
                    ASSEMBLING
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-ink-950 px-2.5 py-1 font-code text-[8px] font-bold tracking-[0.16em] text-white">
                    <CircleCheck className="h-2.5 w-2.5" aria-hidden="true" />
                    SEALED
                  </span>
                )}
              </div>
              <p className="mt-1.5 truncate text-[13.5px] font-semibold text-ink-700">{run.title}</p>
              <dl className="mt-4 grid grid-cols-3 gap-2 border-y border-ink-100 py-3 font-code text-[8px] tracking-[0.14em]">
                <div>
                  <dt className="text-ink-500">FINDINGS</dt>
                  <dd className="mt-1 text-[13px] font-bold text-ink-950 tabular">{run.findings}</dd>
                </div>
                <div>
                  <dt className="text-ink-500">CITED</dt>
                  <dd className="mt-1 text-[13px] font-bold text-ink-950 tabular">{run.citations}</dd>
                </div>
                <div>
                  <dt className="text-ink-500">UNSOURCED</dt>
                  <dd className="mt-1 text-[13px] font-bold text-brand-700 tabular">{run.unsourced}</dd>
                </div>
              </dl>
              <p className="mt-3 font-code text-[7.5px] leading-[1.9] tracking-[0.14em] text-ink-400">
                {sealText(run).toUpperCase()}
                {decision && (
                  <>
                    <br />
                    DECISION · {decision}
                  </>
                )}
              </p>
              <div data-tour="report-download" className="mt-auto flex items-center gap-2 pt-4">
                {assembling ? (
                  <button
                    type="button"
                    onClick={() => setPreview(run)}
                    aria-haspopup="dialog"
                    className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-ink-200 px-3 font-code text-[8.5px] font-bold tracking-[0.14em] text-ink-500 transition-colors hover:border-ink-400 hover:text-ink-800"
                  >
                    <Eye className="h-3 w-3" aria-hidden="true" />
                    PREVIEW ONLY
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      downloadText(
                        `quorum-${run.id.replace(/[^\w-]+/g, "-")}-pack.md`,
                        packMarkdown(run, packFindings, v ?? null),
                      );
                      onToast(`PACK DOWNLOADED — ${run.id} · MARKDOWN + AUDIT HASH`);
                    }}
                    className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink-950 px-3 font-code text-[8.5px] font-bold tracking-[0.14em] text-white transition-colors hover:bg-brand-600"
                  >
                    <Download className="h-3 w-3" aria-hidden="true" />
                    DOWNLOAD PACK
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (navigator.clipboard?.writeText)
                      navigator.clipboard.writeText(`quorum audit — ${run.id} — ${sealText(run)}`).catch(() => undefined);
                    onToast("AUDIT TRAIL COPIED TO CLIPBOARD");
                  }}
                  aria-label={`Copy audit trail for ${run.id}`}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-ink-200 text-ink-500 transition-colors hover:border-ink-400 hover:text-ink-900"
                >
                  <Copy className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            </motion.article>
          );
        })}
      </div>
    </ViewShell>

    <PackPreviewModal
      run={preview}
      findings={findings}
      onClose={closePreview}
      onOpenApprovals={onOpenApprovals}
    />
    </>
  );
}

/* ── Sources & portals ───────────────────────────────────────────────────── */

type SampleTenderRow = {
  ref: string;
  title: string;
  buyer: string;
  sector: string;
  currency: string;
  budget: string;
  bids: number;
  format: string;
  challenges: string;
  files: string[];
};

type SourceRequestRow = {
  id: string;
  name: string;
  kind: string;
  note?: string;
  requestedBy: string;
  createdAt: string;
  status: "PENDING" | "CONNECTED" | "DISMISSED";
};

/* Pending source requests, read live from the sidecar. Visible proof that
   REQUEST A SOURCE actually files — not a toast into the void. */
function RequestsPanel({ requests }: { requests: SourceRequestRow[] }) {
  if (requests.length === 0) return null;
  return (
    <div className="mb-4 overflow-hidden rounded-[12px] panel shadow-[0_1px_2px_rgba(11,12,15,0.04)] sm:mb-6">
      <header className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
        <div>
          <h2 className="font-display text-[17px] font-black tracking-[-0.01em] text-ink-950">Source requests</h2>
          <p className="mt-0.5 font-code text-[8.5px] tracking-[0.2em] text-ink-400">
            {requests.filter((r) => r.status === "PENDING").length} PENDING · {requests.length} FILED
          </p>
        </div>
      </header>
      <ul>
        {requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-ink-100 px-5 py-3.5 last:border-b-0">
            <span className="min-w-0 w-full sm:w-auto sm:flex-1">
              <span className="block truncate font-code text-[10px] font-bold tracking-[0.12em] text-ink-950">{r.name}</span>
              <span className="mt-0.5 block font-code text-[7.5px] tracking-[0.18em] text-ink-400">
                {r.kind} · BY {r.requestedBy.toUpperCase()} · {clockOf(r.createdAt).toUpperCase()}
              </span>
            </span>
            {r.note && <span className="min-w-0 flex-1 truncate text-[12px] text-ink-500 sm:max-w-[320px] sm:flex-none">{r.note}</span>}
            <span
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 font-code text-[8px] font-bold tracking-[0.16em]",
                r.status === "PENDING" ? "bg-brand-600 text-white" : "bg-ink-950 text-white"
              )}
            >
              {r.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourcesView({ onToast, firstName }: { onToast: (m: string) => void; firstName: string }) {
  const standards = ["OCDS 1.1", "MCP TOOLS", "LLM DRAFTING", "PAGE CITATIONS"];
  const { data: registry, failed: registryFailed, reload: reloadRegistry, setData: setRegistry } = useOcpRegistry();
  const [connecting, setConnecting] = useState(false);
  const [connectProgress, setConnectProgress] = useState<{ done: number; total: number } | null>(null);
  const [rechecking, setRechecking] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [globalQuery, setGlobalQuery] = useState("");

  /* Connection truth, straight from the sidecar's saved checks. */
  const links = registry?.links?.links ?? {};
  const datasets = registry?.datasets ?? [];
  const overrides = registry?.state?.overrides ?? {};
  const enabledOf = useCallback((id: number) => overrides[String(id)]?.enabled ?? true, [overrides]);
  const disabledDatasets = datasets.filter((d) => !enabledOf(d.publicationId));
  const disabledCount = disabledDatasets.length;
  const linkedCount = datasets.filter((d) => links[String(d.publicationId)]?.registry.ok).length;
  const portalUpCount = datasets.filter((d) => links[String(d.publicationId)]?.portal.ok).length;
  const missingLinks = datasets.filter((d) => enabledOf(d.publicationId) && !links[String(d.publicationId)]?.registry.ok).length;
  const global = registry?.global;
  const globalDatasets = global?.datasets ?? [];
  const globalCountries = global?.countries ?? [];
  const globalDisabledCount = globalDatasets.filter((d) => !enabledOf(d.publicationId)).length;
  const globalLinkedCount = globalDatasets.filter((d) => links[String(d.publicationId)]?.registry.ok).length;
  const globalPortalUpCount = globalDatasets.filter((d) => links[String(d.publicationId)]?.portal.ok).length;
  const globalMissingLinks = globalDatasets.filter((d) => enabledOf(d.publicationId) && !links[String(d.publicationId)]?.registry.ok).length;
  const refresh = registry?.refresh;

  /* Live source requests from the quorum-mcp sidecar — pending ones show
     up right on the page; every request is audit-logged on the sidecar. */
  const [requests, setRequests] = useState<SourceRequestRow[]>([]);
  const [reqOpen, setReqOpen] = useState(false);
  const [reqName, setReqName] = useState("");
  const [reqKind, setReqKind] = useState("DATA SOURCE");
  const [reqNote, setReqNote] = useState("");
  const [reqError, setReqError] = useState("");
  const [reqBusy, setReqBusy] = useState(false);
  const reqNameRef = useRef<HTMLInputElement | null>(null);

  /* The committee's switch — one place, one truth. Optimistic on purpose:
     the row moves the instant it is clicked, the sidecar's saved state
     replaces it a beat later, and a failed POST rolls the row back. */
  const [pendingToggleIds, setPendingToggleIds] = useState<number[]>([]);
  const togglePortals = useCallback(
    async (ids: number[], enabled: boolean, okMsg: string) => {
      if (ids.length === 0) return;
      const snapshot = registry;
      const now = new Date().toISOString();
      if (snapshot) {
        const next = { ...(snapshot.state?.overrides ?? {}) };
        for (const id of ids) next[String(id)] = { enabled, at: now, by: firstName || "you" };
        setRegistry({ ...snapshot, state: { updatedAt: now, overrides: next } });
      }
      setPendingToggleIds((p) => [...p, ...ids]);
      try {
        const res = await fetch("/api/portal-state?XTransformPort=3031", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ publicationIds: ids, enabled, actor: firstName || "unknown" }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = (await res.json()) as { state?: OcpPortalState };
        if (snapshot && d.state) setRegistry({ ...snapshot, state: d.state });
        onToast(okMsg);
      } catch {
        if (snapshot) setRegistry(snapshot);
        onToast("THE SWITCH DID NOT LAND — THE PORTAL IS UNCHANGED");
      } finally {
        setPendingToggleIds((p) => p.filter((x) => !ids.includes(x)));
      }
    },
    [firstName, onToast, registry, setRegistry],
  );

  const loadRequests = useCallback(() => {
    fetch("/api/source-requests?XTransformPort=3031")
      .then((x) => x.json())
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => setRequests([]));
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const submitRequest = async () => {
    if (!reqName.trim()) {
      setReqError("Name the source you need — the registry, portal or feed.");
      return;
    }
    setReqBusy(true);
    setReqError("");
    try {
      const res = await fetch("/api/source-requests?XTransformPort=3031", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: reqName.trim(),
          kind: reqKind,
          note: reqNote.trim() || undefined,
          requestedBy: firstName || "the committee",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      void loadRequests();
      setReqOpen(false);
      setReqName("");
      setReqNote("");
      setReqKind("DATA SOURCE");
      onToast("SOURCE REQUEST FILED — WRITTEN TO THE AUDIT TRAIL");
    } catch {
      setReqError("The request could not be filed — try again.");
    } finally {
      setReqBusy(false);
    }
  };

  /* A real connection pass: the agent opens each published file, reads its
     first OCDS release and checks the publisher's portal. Batched so the
     card can show honest progress; every result is saved by the sidecar. */
  const connectDatasets = useCallback(
    async (ids: number[]) => {
      if (ids.length === 0) return;
      const single = ids.length === 1;
      if (single) setRechecking(ids[0]);
      else {
        setConnecting(true);
        setConnectProgress({ done: 0, total: ids.length });
      }
      try {
        for (let i = 0; i < ids.length; i += 4) {
          const chunk = ids.slice(i, i + 4);
          const res = await fetch("/api/portal-connect?XTransformPort=3031", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ publicationIds: chunk, actor: firstName || "unknown" }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          if (!single) setConnectProgress({ done: Math.min(i + chunk.length, ids.length), total: ids.length });
        }
        reloadRegistry();
        onToast(single ? "PORTAL RE-CHECKED — THE RESULT IS SAVED" : "CONNECTION PASS COMPLETE — EVERY CHECK IS SAVED");
      } catch {
        onToast("THE CONNECTION CHECK COULD NOT RUN — NOTHING WAS RECORDED");
      } finally {
        setConnecting(false);
        setConnectProgress(null);
        setRechecking(null);
      }
    },
    [firstName, onToast, reloadRegistry],
  );

  /* The registry is refreshed automatically in the sidecar. This is the
     officer's force button: run the miner now, then read the new snapshot. */
  const refreshNow = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/ocp-refresh?XTransformPort=3031", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const d = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !d?.ok) throw new Error(d?.error || `HTTP ${res.status}`);
      reloadRegistry();
      onToast("OCP REGISTRY REFRESHED — THE LIVE SNAPSHOT IS UPDATED");
    } catch {
      reloadRegistry();
      onToast("THE REGISTRY REFRESH FAILED — THE LAST SNAPSHOT IS STILL IN USE");
    } finally {
      setRefreshing(false);
    }
  }, [onToast, reloadRegistry]);

  return (
    <ViewShell
      fig="10"
      title="Data Sources"
      sub="A finding is only as lawful as its source. Every bid is read against national portals, supplier registries and the OCDS record — and each finding cites which."
      action={
        <button
          type="button"
          data-tour="sources-request-btn"
          onClick={() => {
            setReqOpen(true);
            requestAnimationFrame(() => reqNameRef.current?.focus());
          }}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 font-code text-[9px] font-bold tracking-[0.18em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          REQUEST A SOURCE
        </button>
      }
    >
      <div data-tour="sources-standards" className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {standards.map((s, i) => (
          <motion.div
            key={s}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 * i, ease: EASE }}
            className="rounded-[12px] panel p-4 shadow-[0_1px_2px_rgba(11,12,15,0.04)]"
          >
            <p className="font-code text-[9.5px] font-bold tracking-[0.18em] text-ink-900">{s}</p>
            <p className="mt-1.5 font-code text-[7px] tracking-[0.18em] text-ink-400">STANDARD {String(i + 1).padStart(2, "0")}</p>
          </motion.div>
        ))}
      </div>

      <div className="mt-4 grid content-start gap-4 sm:mt-6 sm:gap-6">
        <div className="min-w-0">
          <RequestsPanel requests={requests} />
          <div data-tour="sources-portals" className="overflow-hidden rounded-[12px] panel shadow-[0_1px_2px_rgba(11,12,15,0.04)]">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
              <div>
                <h2 className="font-display text-[17px] font-black tracking-[-0.01em] text-ink-950">Connected portals — Africa</h2>
                <p className="mt-0.5 font-code text-[8.5px] tracking-[0.2em] text-ink-400">
                  {registry
                    ? `${registry.countries.length} COUNTRIES · ${registry.datasets.length} DATASETS · ${linkedCount}/${registry.datasets.length} LINKED · ${
                        registry.datasets.filter((d) => d.stale).length
                      } NO LONGER UPDATED${disabledCount > 0 ? ` · ${disabledCount} SWITCHED OFF` : ""}`
                    : registryFailed
                      ? "THE REGISTRY SNAPSHOT COULD NOT BE READ"
                      : "READING THE OCP DATA REGISTRY…"}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1.5 font-code text-[8px] font-semibold tracking-[0.18em] text-ink-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-ink-950" aria-hidden="true" />
                  OCP REGISTRY{registry ? ` · ${codeDate(registry.source.retrieved)}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => void refreshNow()}
                  disabled={refreshing || Boolean(refresh?.running)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 font-code text-[8px] font-bold tracking-[0.16em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Refresh the OCP registry snapshot now — the source pages are read again and the new record is saved"
                >
                  <RefreshCw
                    className={cn("h-3 w-3", (refreshing || refresh?.running) && "animate-spin")}
                    aria-hidden="true"
                  />
                  {refreshing || refresh?.running ? "REFRESHING" : "REFRESH"}
                </button>
                <button
                  type="button"
                  onClick={() => void connectDatasets(datasets.filter((d) => enabledOf(d.publicationId)).map((d) => d.publicationId))}
                  disabled={!registry || connecting || rechecking !== null || disabledCount === datasets.length}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 font-code text-[8px] font-bold tracking-[0.16em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-50"
                  title={
                    disabledCount === datasets.length
                      ? "Every portal is switched off — turn one on and the connection pass can run again"
                      : "Open every published file in use, read its first OCDS release, and check the publisher's portal — each result is dated and saved. Portals switched off are skipped."
                  }
                >
                  {connecting ? (
                    <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <Cable className="h-3 w-3" aria-hidden="true" />
                  )}
                  {connecting && connectProgress
                    ? `CHECKING ${connectProgress.done}/${connectProgress.total}`
                    : missingLinks > 0
                      ? `CONNECT ${missingLinks} PORTAL${missingLinks === 1 ? "" : "S"}`
                      : "RE-CHECK CONNECTIONS"}
                </button>
              </div>
            </header>
            {registryFailed && !registry ? (
              <div className="flex flex-wrap items-center gap-3 px-5 py-5">
                <p className="min-w-0 flex-1 font-code text-[8.5px] leading-[1.9] tracking-[0.16em] text-ink-400">
                  THE OCP DATA REGISTRY SNAPSHOT COULD NOT BE READ — THE quorum-mcp SIDECAR IS NOT RESPONDING
                </p>
                <button
                  type="button"
                  onClick={reloadRegistry}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ink-200 px-3 font-code text-[8px] font-bold tracking-[0.16em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950"
                >
                  <RefreshCw className="h-3 w-3" aria-hidden="true" />
                  RETRY
                </button>
              </div>
            ) : (
              <RegistryCountries
                countries={registry?.countries ?? []}
                datasets={datasets}
                links={links}
                overrides={overrides}
                pendingToggleIds={pendingToggleIds}
                togglePortals={togglePortals}
                connectDatasets={connectDatasets}
                connecting={connecting}
                rechecking={rechecking}
              />
            )}
            <footer className="border-t border-ink-100 bg-sand px-5 py-3.5">
              <p className="font-code text-[7px] leading-[2] tracking-[0.14em] text-ink-500">
                READ FROM THE OCP DATA REGISTRY ·{" "}
                <a
                  href="https://data.open-contracting.org/en/search/"
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-ink-300 underline-offset-2 transition-colors hover:text-ink-950"
                >
                  data.open-contracting.org/en/search
                </a>
                {registry
                  ? ` · ${registry.source.scope.toUpperCase()} · RETRIEVED ${codeDate(registry.source.retrieved)}`
                  : ""}
                <br />
                {registry
                  ? `${registry.source.note.toUpperCase()} ${registry.source.licenseNote.toUpperCase()}`
                  : "EVERY FIELD IS THE REGISTRY'S OWN — COUNTRIES, PUBLISHERS, COVERAGE, RETRIEVALS, FORMATS, LICENCES AND COUNTS."}
                <br />
                {registry
                  ? `CONNECTIONS · EVERY DATASET OPENED AND ITS FIRST OCDS RELEASE READ · ${linkedCount}/${registry.datasets.length} LINKED · ${portalUpCount}/${registry.datasets.length} PUBLISHER PORTALS ANSWERED${disabledCount > 0 ? ` · ${disabledCount} SWITCHED OFF AND SKIPPED BY THE PASS` : ""} · LAST CHECK ${
                      registry.links.updatedAt ? codeStamp(registry.links.updatedAt) : "NOT YET"
                    }`
                  : "CONNECTIONS · THE SIDECAR OPENS EVERY PUBLISHED FILE AND CHECKS EACH PUBLISHER PORTAL."}
                <br />
                {refreshStatusLine(refresh)}
              </p>
            </footer>
          </div>

          {/* Global jurisdictions — the same registry, kept separate from the
              African desk so a cross-border supplier can still be checked. */}
          <div data-tour="sources-global" className="mt-4 overflow-hidden rounded-[12px] panel shadow-[0_1px_2px_rgba(11,12,15,0.04)] sm:mt-6">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
              <div>
                <h2 className="font-display text-[17px] font-black tracking-[-0.01em] text-ink-950">Global jurisdictions</h2>
                <p className="mt-0.5 font-code text-[8.5px] tracking-[0.2em] text-ink-400">
                  {registry
                    ? `${globalCountries.length} COUNTRIES · ${globalDatasets.length} DATASETS · ${globalLinkedCount}/${globalDatasets.length} LINKED · ${
                        globalDatasets.filter((d) => d.stale).length
                      } NO LONGER UPDATED${globalDisabledCount > 0 ? ` · ${globalDisabledCount} SWITCHED OFF` : ""}`
                    : registryFailed
                      ? "THE GLOBAL SNAPSHOT COULD NOT BE READ"
                      : "READING THE OCP DATA REGISTRY…"}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1.5 font-code text-[8px] font-semibold tracking-[0.18em] text-ink-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-ink-950" aria-hidden="true" />
                  NON-AFRICAN{global ? ` · ${codeDate(global.source.retrieved)}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => void connectDatasets(globalDatasets.filter((d) => enabledOf(d.publicationId)).map((d) => d.publicationId))}
                  disabled={!registry || connecting || rechecking !== null || globalDisabledCount === globalDatasets.length}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 font-code text-[8px] font-bold tracking-[0.16em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-50"
                  title={
                    globalDisabledCount === globalDatasets.length
                      ? "Every global portal is switched off — turn one on and the connection pass can run again"
                      : "Open every global published file in use, read its first OCDS release, and check the publisher's portal — each result is dated and saved"
                  }
                >
                  {connecting ? (
                    <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <Cable className="h-3 w-3" aria-hidden="true" />
                  )}
                  {connecting && connectProgress
                    ? `CHECKING ${connectProgress.done}/${connectProgress.total}`
                    : globalMissingLinks > 0
                      ? `CONNECT ${globalMissingLinks} PORTAL${globalMissingLinks === 1 ? "" : "S"}`
                      : "RE-CHECK CONNECTIONS"}
                </button>
              </div>
            </header>
            {registryFailed && !registry ? (
              <div className="flex flex-wrap items-center gap-3 px-5 py-5">
                <p className="min-w-0 flex-1 font-code text-[8.5px] leading-[1.9] tracking-[0.16em] text-ink-400">
                  THE GLOBAL SNAPSHOT COULD NOT BE READ — THE quorum-mcp SIDECAR IS NOT RESPONDING
                </p>
                <button
                  type="button"
                  onClick={reloadRegistry}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ink-200 px-3 font-code text-[8px] font-bold tracking-[0.16em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950"
                >
                  <RefreshCw className="h-3 w-3" aria-hidden="true" />
                  RETRY
                </button>
              </div>
            ) : !registry ? (
              <p className="px-5 py-6 font-code text-[8.5px] tracking-[0.16em] text-ink-400">READING THE OCP DATA REGISTRY…</p>
            ) : globalDatasets.length === 0 ? (
              <p className="px-5 py-6 font-code text-[8.5px] tracking-[0.16em] text-ink-400">NO GLOBAL SNAPSHOT IS PRESENT — REFRESH THE REGISTRY</p>
            ) : (
              <>
                <div className="border-b border-ink-100 px-5 py-3">
                  <label className="relative block max-w-md">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      value={globalQuery}
                      onChange={(e) => setGlobalQuery(e.target.value)}
                      placeholder={`Filter ${globalCountries.length} countries or publishers…`}
                      aria-label="Filter global jurisdictions"
                      className="focus-brand h-9 w-full rounded-xl border border-ink-200 bg-white pl-9 pr-3 text-[12.5px] text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-950 focus:ring-2 focus:ring-ink-950/10"
                    />
                  </label>
                </div>
                <div className="max-h-[34rem] overflow-y-auto">
                  <RegistryCountries
                    countries={globalCountries}
                    datasets={globalDatasets}
                    links={links}
                    overrides={overrides}
                    pendingToggleIds={pendingToggleIds}
                    togglePortals={togglePortals}
                    connectDatasets={connectDatasets}
                    connecting={connecting}
                    rechecking={rechecking}
                    query={globalQuery}
                    emptyNote="NO GLOBAL JURISDICTION MATCHES THAT FILTER"
                  />
                </div>
              </>
            )}
            <footer className="border-t border-ink-100 bg-sand px-5 py-3.5">
              <p className="font-code text-[7px] leading-[2] tracking-[0.14em] text-ink-500">
                SAME OCP RETRIEVAL AS THE AFRICAN DESK ·{" "}
                {global ? `${global.source.scope.toUpperCase()} · RETRIEVED ${codeDate(global.source.retrieved)}` : "READ FROM THE OCP DATA REGISTRY"}
                <br />
                {global
                  ? `GLOBAL CONNECTIONS · ${globalLinkedCount}/${globalDatasets.length} LINKED · ${globalPortalUpCount}/${globalDatasets.length} PUBLISHER PORTALS ANSWERED${globalDisabledCount > 0 ? ` · ${globalDisabledCount} SWITCHED OFF AND SKIPPED BY THE PASS` : ""}`
                  : "GLOBAL CONNECTIONS · EVERY PUBLISHED FILE OPENED AND EACH PUBLISHER PORTAL CHECKED."}
              </p>
            </footer>
          </div>
        </div>
        <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
          <div className="rounded-[12px] panel p-5 shadow-[0_1px_2px_rgba(11,12,15,0.04)]">
            <h3 className="font-display text-[15px] font-black tracking-[-0.01em] text-ink-950">Why sources matter</h3>
            <p className="mt-3 text-[12.5px] leading-relaxed text-ink-600">
              A price is not “high” until the framework median says so. A bidder is not “related” until the registry says
              so. Quorum cites the source — or it does not speak.
            </p>
          </div>
          <div className="flex items-start gap-3 rounded-[10px] border border-ink-100 bg-sand p-5">
            <ShieldCheck className="h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" />
            <p className="font-code text-[7.5px] leading-[1.9] tracking-[0.14em] text-ink-600">
              AUDIT LOGS sha256-SEALED · ON-PREM READY · NO TRACKERS
            </p>
          </div>
        </div>
      </div>
      {/* Request modal — files a real, audit-logged source request. */}
      <AnimatePresence>
        {reqOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[80] grid place-items-center bg-night/70 p-4 backdrop-blur-sm"
            onClick={() => {
              if (!reqBusy) setReqOpen(false);
            }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="req-source-title"
              initial={{ opacity: 0, y: 22, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.28, ease: EASE }}
              className="w-full max-w-lg rounded-[12px] panel panel-lift p-6 sm:p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="flex items-center gap-2.5 font-code text-[9px] font-semibold uppercase tracking-[0.28em] text-ink-500">
                <span className="inline-block h-[2px] w-6 bg-brand-600" aria-hidden="true" />
                REQUEST A SOURCE
              </p>
              <h2 id="req-source-title" className="mt-3 font-display text-[24px] font-black tracking-[-0.03em] text-ink-950 sm:text-[28px]">
                File a source request.
              </h2>
              <p className="mt-1.5 text-[12.5px] text-ink-500">
                Name the registry, portal or feed. It lands in the audit trail with your name and a pending status.
              </p>
              <form
                className="mt-5 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitRequest();
                }}
              >
                <div>
                  <label htmlFor="req-name" className="mb-1.5 block font-code text-[9px] font-semibold tracking-[0.18em] text-ink-500">
                    SOURCE NAME <span className="text-brand-600" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="req-name"
                    ref={reqNameRef}
                    type="text"
                    value={reqName}
                    onChange={(e) => {
                      setReqName(e.target.value);
                      setReqError("");
                    }}
                    placeholder="e.g. Kenya OR Code — beneficial ownership registry"
                    autoComplete="off"
                    aria-required="true"
                    aria-invalid={Boolean(reqError && !reqName.trim())}
                    className="h-12 w-full rounded-xl border border-ink-200 bg-white px-4 text-[13.5px] text-ink-900 outline-none transition-all placeholder:text-ink-400 focus:border-ink-950 focus:ring-2 focus:ring-ink-950/10"
                  />
                </div>
                <div>
                  <label htmlFor="req-kind" className="mb-1.5 block font-code text-[9px] font-semibold tracking-[0.18em] text-ink-500">
                    KIND
                  </label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label="Source kind">
                    {["NATIONAL PORTAL", "REGISTRY", "DATA SOURCE"].map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setReqKind(k)}
                        aria-pressed={reqKind === k}
                        className={cn(
                          "flex min-h-10 items-center justify-center rounded-xl border px-2 font-code text-[9px] font-bold tracking-[0.12em] transition-all",
                          reqKind === k
                            ? "border-ink-950 bg-ink-950 text-white"
                            : "border-ink-200 bg-white text-ink-500 hover:border-ink-400"
                        )}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label htmlFor="req-note" className="mb-1.5 block font-code text-[9px] font-semibold tracking-[0.18em] text-ink-500">
                    NOTE
                  </label>
                  <textarea
                    id="req-note"
                    value={reqNote}
                    onChange={(e) => setReqNote(e.target.value)}
                    rows={3}
                    placeholder="What it must supply, and why — optionally."
                    className="w-full resize-none rounded-xl border border-ink-200 bg-white px-4 py-3 text-[13.5px] text-ink-900 outline-none transition-all placeholder:text-ink-400 focus:border-ink-950 focus:ring-2 focus:ring-ink-950/10"
                  />
                </div>
                {reqError && (
                  <p role="alert" className="rounded-lg bg-brand-50 px-3.5 py-2.5 text-[12px] font-medium text-brand-800">
                    {reqError}
                  </p>
                )}
                <div className="flex items-center justify-end gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (!reqBusy) setReqOpen(false);
                    }}
                    className="inline-flex h-10 items-center rounded-xl border border-ink-200 px-4 font-code text-[9px] font-bold tracking-[0.14em] text-ink-600 transition-colors hover:border-ink-900 hover:text-ink-950"
                  >
                    CANCEL
                  </button>
                  <button
                    type="submit"
                    disabled={reqBusy}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-ink-950 px-5 font-code text-[9px] font-bold tracking-[0.14em] text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {reqBusy ? "FILING…" : "FILE REQUEST"}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </ViewShell>
  );
}


/* ── Award ledger ────────────────────────────────────────────────────────── */

function AwardLedgerView({
  ledger,
  awaiting,
}: {
  ledger: LedgerRow[];
  awaiting: number;
}) {
  const awarded = ledger.filter((l) => l.action === "AWARDED").length;
  const returned = ledger.filter((l) => l.action === "RETURNED").length;
  /* The ink receipt: any signed row opens the appended signature. */
  const [receiptRow, setReceiptRow] = useState<SignatureReceipt | null>(null);

  return (
    <ViewShell
      fig="11"
      title="Award History"
      sub="Every decision made at a gate — who signed, what they signed, and when. The agent writes everything else; only this page carries the gavel."
    >
      <div className="grid grid-cols-1 gap-4 sm:gap-6">
        <div className="min-w-0 space-y-4 sm:space-y-6">
          <div data-tour="ledger-stats" className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            {[
              { label: "DECISIONS LOGGED", value: ledger.length },
              { label: "AWARDED", value: awarded },
              { label: "RETURNED", value: returned },
              { label: "AWAITING GATE", value: awaiting },
            ].map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.05 * i, ease: EASE }}
                className="rounded-[12px] panel p-4 shadow-[0_1px_2px_rgba(11,12,15,0.04)]"
              >
                <p className="font-code text-[8px] font-semibold tracking-[0.22em] text-ink-400">{s.label}</p>
                <p className="mt-2 font-display text-[28px] font-black leading-none tracking-[-0.02em] tabular">{s.value}</p>
              </motion.div>
            ))}
          </div>

          <div data-tour="ledger-rows" className="overflow-hidden rounded-[12px] panel shadow-[0_1px_2px_rgba(11,12,15,0.04)]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <caption className="sr-only">Award History — decisions signed at the approval gate</caption>
                <thead>
                  <tr className="border-b border-ink-100 bg-paper/60">
                    {["TENDER", "DECISION", "SIGNED BY", "LOGGED", "INK"].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className="px-4 py-2.5 font-code text-[8px] font-semibold tracking-[0.22em] text-ink-400 first:pl-5 first:pr-4 last:pr-5"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((row) => (
                    <tr
                      key={row.id ?? `${row.tender}-${row.at}-${row.action}`}
                      onClick={() =>
                        setReceiptRow({
                          tender: row.tender,
                          action: row.action,
                          by: row.by,
                          at: row.at,
                          toolLabel: row.toolLabel,
                          image: row.hand?.image,
                          strokes: row.hand?.strokes,
                          signedAt: row.hand?.signedAt,
                          submissionId: row.receipt?.submissionId,
                          hash: row.receipt?.hash,
                        })
                      }
                      title="Open the decision receipt — the appended signature and its seal"
                      className="cursor-pointer border-b border-ink-100 transition-colors last:border-b-0 hover:bg-paper"
                    >
                      <td className="py-3.5 pl-5 pr-4 font-code text-[10px] font-bold tracking-[0.08em] text-ink-950">
                        {row.tender}
                      </td>
                      <td className="px-4">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-code text-[8.5px] font-bold tracking-[0.16em]",
                            row.action === "AWARDED"
                              ? "bg-ink-950 text-white"
                              : "border border-brand-200 bg-brand-50 text-brand-800"
                          )}
                        >
                          {row.action === "AWARDED" ? (
                            <CircleCheck className="h-2.5 w-2.5" aria-hidden="true" />
                          ) : (
                            <CircleAlert className="h-2.5 w-2.5" aria-hidden="true" />
                          )}
                          {row.action}
                        </span>
                      </td>
                      <td className="px-4 text-[13px] font-semibold text-ink-700">{row.by}</td>
                      <td className="py-3.5 pr-4 font-code text-[8.5px] tracking-[0.12em] text-ink-400">{row.at}</td>
                      <td className="py-3.5 pr-5">
                        {row.hand ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 font-code text-[7.5px] font-bold tracking-[0.14em] text-brand-800">
                            <PenLine className="h-2.5 w-2.5" aria-hidden="true" />
                            APPENDED
                          </span>
                        ) : (
                          <span className="font-code text-[8.5px] tracking-[0.14em] text-ink-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {ledger.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-10 text-center font-code text-[10px] tracking-[0.18em] text-ink-400">
                        THE LEDGER IS BLANK — DECISIONS APPEAR THE MOMENT A GATE SIGNS
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="grid content-start gap-4 sm:gap-6 lg:grid-cols-2">
          <div className="relative overflow-hidden rounded-[12px] border border-ink-950 bg-night p-5 text-white shadow-[0_22px_55px_rgba(11,12,15,0.3)]">
            <div className="bg-grid-dark pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
            <div className="relative">
              <h3 className="font-display text-[15px] font-black tracking-[-0.01em]">The gavel has no autoplay</h3>
              <p className="mt-3 font-code text-[9px] leading-[2] tracking-[0.16em] text-ink-300">
                EVERY LINE CARRIES A NAME
                <br />
                AND A TIMESTAMP.
                <br />
                <span className="text-brand-400">THE AGENT PREPARES, FLAGS AND CITES — IT CAN NEVER SIGN.</span>
              </p>
            </div>
          </div>
          <StandingRuleCard />
        </div>
      </div>

      {/* The ink receipt — the officer's own hand, with the seal it travelled under. */}
      <SignatureReceiptDialog row={receiptRow} onClose={() => setReceiptRow(null)} />
    </ViewShell>
  );
}

/* ── Committee ───────────────────────────────────────────────────────────── */

type SittingAttendanceView = {
  memberId: string;
  name: string;
  role: string;
  expected: "PRESENT" | "EXCUSED" | "OFFICER";
  admitted: boolean;
  admittedAt: string | null;
  admittedBy: string | null;
};

type SittingView = {
  id: string;
  title: string;
  room: string;
  joinUrl: string;
  agenda: string | null;
  summonedBy: string;
  summonedAt: string;
  status: "OPEN" | "CLOSED";
  closedAt: string | null;
  notes: string;
  notesUpdatedAt: string | null;
  notesUpdatedBy: string | null;
  attendance: SittingAttendanceView[];
};

type CommitteeData = {
  seats: number;
  required: number;
  present: number;
  open: number;
  members: {
    id: string;
    name: string;
    role: string;
    isChair: boolean;
    status: "PRESENT" | "EXCUSED";
    office?: string;
  }[];
  you: { name: string } | null;
  lastSummonsAt: string | null;
  sitting: SittingView | null;
  sittings: SittingView[];
  meetings: ScheduledMeeting[];
};

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
];

function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

function capWord(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function summonsClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function dayOf(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

/* A guard change's moment, to the minute — the audit line's timestamp. */
function stampOf(iso: string): string {
  try {
    return new Date(iso)
      .toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
      .toUpperCase();
  } catch {
    return "—";
  }
}

/* The minutes leave the desk as a real file — the record, portable. */
function minutesMarkdown(s: SittingView): string {
  const lines = [
    `# Quorum — committee minutes · ${s.title}`,
    "",
    `- Summoned: ${dayOf(s.summonedAt)}, ${summonsClock(s.summonedAt)} — by ${s.summonedBy}`,
    `- Room: ${s.joinUrl} (Jitsi Meet — open source, Apache-2.0)`,
    s.status === "OPEN"
      ? "- Status: OPEN — the room is live"
      : `- Status: SEALED${s.closedAt ? ` at ${dayOf(s.closedAt)}, ${summonsClock(s.closedAt)}` : ""}`,
    ...(s.agenda ? [`- Agenda: ${s.agenda}`] : []),
    "",
    "## The door — admitted to the meeting",
    ...s.attendance.map(
      (a) =>
        `- [${a.admitted ? "x" : " "}] ${a.name} — ${a.role}${
          a.admitted && a.admittedAt
            ? ` (admitted ${summonsClock(a.admittedAt)}${a.admittedBy ? ` by ${a.admittedBy}` : ""})`
            : a.expected === "EXCUSED"
              ? " (excused)"
              : ""
        }`,
    ),
    "",
    "## The minutes — written from the Quorum desk",
    s.notes.trim() ? s.notes.trim() : "(no minutes were written)",
  ];
  if (s.notesUpdatedAt) {
    lines.push("", `_Last written ${dayOf(s.notesUpdatedAt)}, ${summonsClock(s.notesUpdatedAt)} by ${s.notesUpdatedBy ?? "—"}._`);
  }
  return lines.join("\n");
}

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type CommitteeTab = "roll" | "quorum" | "desk";

function CommitteeView({ user, onToast }: { user: AuthUser | null; onToast: (m: string) => void }) {
  /* The register is an admin surface; running a sitting is not. A committee
     member may summon, admit and write minutes (manage_meetings) without
     being able to change who holds a seat. */
  const canManageRegister = canDo(user?.role, "manage_committee");
  const [data, setData] = useState<CommitteeData | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [summoning, setSummoning] = useState(false);
  const [tab, setTab] = useState<CommitteeTab>("roll");

  /* The guided tour opens the tab each step spotlights. */
  useEffect(() => {
    const onTab = (e: Event) => {
      const t = (e as CustomEvent<CommitteeTab>).detail;
      if (t === "roll" || t === "quorum" || t === "desk") setTab(t);
    };
    window.addEventListener("mc-committee-tab", onTab);
    return () => window.removeEventListener("mc-committee-tab", onTab);
  }, []);

  /* The sitting room — desk state */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [agenda, setAgenda] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [notesState, setNotesState] = useState<"idle" | "dirty" | "saving" | "error">("idle");
  const [notesSavedAt, setNotesSavedAt] = useState<string | null>(null);
  const [admitBusy, setAdmitBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [memberOpen, setMemberOpen] = useState(false);
  const [memberDraft, setMemberDraft] = useState({ name: "", role: "", isChair: false });
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberErr, setMemberErr] = useState<string | null>(null);
  const [armRemove, setArmRemove] = useState<string | null>(null);
  const [meetOpen, setMeetOpen] = useState(false);
  const [meetBusy, setMeetBusy] = useState(false);
  const [meetErr, setMeetErr] = useState<string | null>(null);
  const [meetCancelBusy, setMeetCancelBusy] = useState<string | null>(null);
  const notesRef = useRef("");
  const deskRef = useRef<HTMLDivElement | null>(null);
  const closeArmRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    let alive = true;
    setLoadErr(false);
    fetch("/api/committee")
      .then((r) => r.json())
      .then((d: CommitteeData | { error: string }) => {
        if (!alive) return;
        if ("error" in d) setLoadErr(true);
        else {
          setData(d);
          setLoadErr(false);
        }
      })
      .catch(() => {
        if (alive) setLoadErr(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => load(), [load]);

  /* Which sitting the desk reads: the officer's pick, else the open one. */
  const deskSitting = useMemo(() => {
    if (!data) return null;
    if (selectedId) return data.sittings.find((s) => s.id === selectedId) ?? data.sitting;
    return data.sitting;
  }, [data, selectedId]);
  const openSitting = useMemo(() => data?.sittings.find((s) => s.status === "OPEN") ?? null, [data]);

  /* The notes draft follows the sitting on the desk; it resets only when the
     desk switches records — never mid-typing. */
  useEffect(() => {
    setNotesDraft(deskSitting?.notes ?? "");
    notesRef.current = deskSitting?.notes ?? "";
    setNotesState("idle");
    setNotesSavedAt(deskSitting?.notesUpdatedAt ?? null);
  }, [deskSitting?.id]);

  const summon = async () => {
    if (summoning) return;
    setSummoning(true);
    try {
      const res = await fetch("/api/committee/summon", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agenda: agenda.trim() || undefined }),
      });
      const d = (await res.json()) as (CommitteeData & { minted?: boolean }) | { error: string };
      if (!res.ok || "error" in d) throw new Error("error" in d ? d.error : "failed");
      setData(d);
      setSelectedId(null);
      setAgenda("");
      onToast(
        d.minted
          ? d.open === 0
            ? "QUORUM PRESENT — ROOM MINTED; THE SITTING CAN PROCEED"
            : `SITTING SUMMONS ISSUED — ROOM MINTED; ${d.open} SEAT${d.open === 1 ? "" : "S"} STILL PENDING QUORUM CALL`
          : "A SITTING IS ALREADY OPEN — ITS ROOM IS ON THE DESK"
      );
      if (d.minted) {
        setTab("desk");
        window.setTimeout(() => {
          deskRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 180);
      }
    } catch {
      onToast("SUMMONS FAILED — COMMITTEE SERVICE UNREACHABLE");
    } finally {
      setSummoning(false);
    }
  };

  /* Autosave: one write 1.2s after the typing stops. A failure parks in
     "error" and waits — retrying is a deliberate act, not a hot loop. */
  const flushNotes = useCallback(async () => {
    const s = deskSitting;
    if (!s || s.status !== "OPEN") return;
    const text = notesRef.current;
    setNotesState("saving");
    try {
      const res = await fetch(`/api/committee/sittings/${s.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: text }),
      });
      const d = (await res.json()) as CommitteeData | { error: string };
      if (!res.ok || "error" in d) throw new Error("failed");
      setData(d);
      setNotesSavedAt(d.sitting?.notesUpdatedAt ?? new Date().toISOString());
      setNotesState(notesRef.current === text ? "idle" : "dirty");
    } catch {
      setNotesState("error");
    }
  }, [deskSitting]);

  useEffect(() => {
    if (notesState !== "dirty") return;
    const t = setTimeout(() => void flushNotes(), 1200);
    return () => clearTimeout(t);
  }, [notesDraft, notesState, flushNotes]);

  const admit = async (memberId: string, admitted: boolean) => {
    const s = deskSitting;
    if (!s || s.status !== "OPEN" || admitBusy) return;
    setAdmitBusy(memberId);
    try {
      const res = await fetch(`/api/committee/sittings/${s.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ attendance: [{ memberId, admitted }] }),
      });
      const d = (await res.json()) as CommitteeData | { error: string };
      if (!res.ok || "error" in d) throw new Error("failed");
      setData(d);
      onToast(admitted ? "ADMITTED — ON THE DOOR RECORD" : "ADMISSION WITHDRAWN — THE DOOR NARROWS");
    } catch {
      onToast("THE DOOR REFUSED THE CHANGE — RETRY");
    } finally {
      setAdmitBusy(null);
    }
  };

  const closeSitting = async () => {
    const s = deskSitting;
    if (!s || s.status !== "OPEN") return;
    if (!confirmClose) {
      setConfirmClose(true);
      if (closeArmRef.current) clearTimeout(closeArmRef.current);
      closeArmRef.current = setTimeout(() => setConfirmClose(false), 6000);
      return;
    }
    if (closeArmRef.current) clearTimeout(closeArmRef.current);
    setConfirmClose(false);
    try {
      const res = await fetch(`/api/committee/sittings/${s.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: notesRef.current, close: true }),
      });
      const d = (await res.json()) as CommitteeData | { error: string };
      if (!res.ok || "error" in d) throw new Error("failed");
      setData(d);
      onToast("SITTING SEALED — THE MINUTES ARE EVIDENCE NOW");
    } catch {
      onToast("THE SEAL FAILED — THE SITTING STAYS OPEN");
    }
  };

  const copyLink = async () => {
    if (!deskSitting) return;
    try {
      await navigator.clipboard.writeText(deskSitting.joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
      onToast("ROOM LINK COPIED — SHARE IT ONLY WITH THE REGISTER");
    } catch {
      onToast("COPY REFUSED BY THE BROWSER — SELECT THE ADDRESS BY HAND");
    }
  };

  const downloadMinutes = () => {
    if (!deskSitting) return;
    downloadText(`quorum-${deskSitting.room}-minutes.md`, minutesMarkdown(deskSitting));
    onToast("MINUTES DOWNLOADED — MARKDOWN, READY FOR THE FILE");
  };

  const addMember = async () => {
    if (memberBusy) return;
    const name = memberDraft.name.trim();
    if (name.length < 2) {
      setMemberErr("A full name is required — the register admits named humans, not seats.");
      return;
    }
    setMemberBusy(true);
    setMemberErr(null);
    try {
      const res = await fetch("/api/committee/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, role: memberDraft.role.trim() || undefined, isChair: memberDraft.isChair }),
      });
      const d = (await res.json()) as CommitteeData | { error: string };
      if (!res.ok || "error" in d) throw new Error("error" in d ? d.error : "failed");
      setData(d);
      setMemberOpen(false);
      setMemberDraft({ name: "", role: "", isChair: false });
      onToast("MEMBER REGISTERED — THE DOOR LIST READS THE REGISTER");
    } catch (err) {
      setMemberErr(
        err instanceof Error && err.message !== "failed"
          ? err.message
          : "THE MEMBER COULD NOT BE REGISTERED — RETRY"
      );
    } finally {
      setMemberBusy(false);
    }
  };

  const setMemberFlag = async (id: string, patch: { status?: "PRESENT" | "EXCUSED"; isChair?: boolean; office?: string }) => {
    try {
      const res = await fetch(`/api/committee/members/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = (await res.json()) as CommitteeData | { error: string };
      if (!res.ok || "error" in d) throw new Error("failed");
      setData(d);
      onToast(
        patch.office
          ? "OFFICE SET — THE STATUTORY GATES READ IT AT SIGNATURE TIME"
          : patch.status === "EXCUSED"
            ? "MARKED EXCUSED — THE QUORUM ACCOUNTING FOLLOWS"
            : patch.status === "PRESENT"
              ? "BACK ON THE ROLL — MARKED PRESENT"
              : "THE CHAIR SEAT MOVES"
      );
    } catch {
      onToast("THE ROSTER UPDATE FAILED — RETRY");
    }
  };

  const removeMember = async (id: string) => {
    if (armRemove !== id) {
      setArmRemove(id);
      setTimeout(() => setArmRemove((cur) => (cur === id ? null : cur)), 6000);
      return;
    }
    setArmRemove(null);
    try {
      const res = await fetch(`/api/committee/members/${id}`, { method: "DELETE" });
      const d = (await res.json()) as CommitteeData | { error: string };
      if (!res.ok || "error" in d) throw new Error("failed");
      setData(d);
      onToast("MEMBER REMOVED FROM THE REGISTER");
    } catch {
      onToast("THE REMOVAL FAILED — RETRY");
    }
  };

  /* Schedule a meeting with the committee, the workspace, or named outside
     players. The room is minted server-side; the returned state is the whole
     diary, so the desk re-renders from the record rather than guessing. */
  const scheduleMeeting = async (draft: MeetingDraft) => {
    if (meetBusy) return;
    setMeetBusy(true);
    setMeetErr(null);
    try {
      const res = await fetch("/api/committee/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const d = (await res.json()) as
        | (CommitteeData & { scheduled?: ScheduledMeeting; scheduledCount?: number })
        | { error: string };
      if (!res.ok || "error" in d) throw new Error("error" in d ? d.error : "failed");
      setData(d);
      setMeetOpen(false);
      const when = new Date(draft.startsAt)
        .toLocaleString("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
        .toUpperCase();
      const count = d.scheduledCount ?? 1;
      onToast(
        count > 1
          ? `${count} WEEKLY MEETINGS SCHEDULED — FIRST ${when} · EVERY ROOM IS MINTED`
          : `MEETING SCHEDULED — ${when} · THE ROOM IS MINTED`
      );
    } catch (err) {
      setMeetErr(
        err instanceof Error && err.message !== "failed"
          ? err.message
          : "THE MEETING COULD NOT BE SCHEDULED — RETRY"
      );
    } finally {
      setMeetBusy(false);
    }
  };

  const cancelMeeting = async (id: string) => {
    if (meetCancelBusy) return;
    setMeetCancelBusy(id);
    try {
      const res = await fetch(`/api/committee/meetings/${id}`, { method: "DELETE" });
      const d = (await res.json()) as CommitteeData | { error: string };
      if (!res.ok || "error" in d) throw new Error("failed");
      setData(d);
      onToast("MEETING CANCELLED — THE DIARY AND THE CALENDAR DROP IT");
    } catch {
      onToast("THE CANCELLATION FAILED — RETRY");
    } finally {
      setMeetCancelBusy(null);
    }
  };

  /* Roll-call order: the chair opens, the gavel sits second, then the rest.
     Excused members close the roll. Everything here comes from /api/committee —
     stored members plus the signed-in officer; nothing is hardcoded. */
  const roll: { initials: string; name: string; role: string; you?: boolean; excused?: boolean; id?: string; office?: string }[] = [];
  if (data) {
    /* The gavel is rendered once, from the session — never also as a roster
       row with the same name. */
    const youKey = data.you ? rosterNameKey(data.you.name) : null;
    const presentMembers = data.members.filter(
      (m) => m.status === "PRESENT" && !(youKey && rosterNameKey(m.name) === youKey)
    );
    const excusedMembers = data.members.filter(
      (m) => m.status === "EXCUSED" && !(youKey && rosterNameKey(m.name) === youKey)
    );
    const chair = presentMembers.find((m) => m.isChair);
    const rest = presentMembers.filter((m) => !m.isChair);
    if (chair) roll.push({ initials: initialsOf(chair.name), name: chair.name, role: chair.role, id: chair.id, ...(chair.office ? { office: chair.office } : {}) });
    if (data.you)
      roll.push({
        initials: initialsOf(data.you.name),
        name: `${data.you.name} — you`,
        role: "PROCUREMENT OFFICER · HOLDS THE GAVEL",
        you: true,
      });
    rest.forEach((m) => roll.push({ initials: initialsOf(m.name), name: m.name, role: m.role, id: m.id, ...(m.office ? { office: m.office } : {}) }));
    excusedMembers.forEach((m) =>
      roll.push({ initials: initialsOf(m.name), name: m.name, role: m.role, excused: true, id: m.id, ...(m.office ? { office: m.office } : {}) })
    );
  }
  const youSeatIndex = roll.findIndex((m) => m.you); /* the gavel's square on the quorum grid */

  return (
    <ViewShell
      fig="12"
      title="Committee"
      sub={
        data
          ? `${capWord(countWord(data.seats))} seats, ${countWord(data.present)} present — the quorum the law asks for before an award counts. The agent attends every sitting; it holds no seat and no gavel.`
          : "The roll-call is being read from the committee record — the seats, the presence, and the quorum the law asks for before an award counts."
      }
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setMeetErr(null);
              setMeetOpen(true);
            }}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-ink-950 px-4 font-code text-[9px] font-bold tracking-[0.18em] text-white transition-colors hover:bg-brand-600"
          >
            <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
            SCHEDULE MEETING
          </button>
          {canManageRegister && (
            <button
              type="button"
              onClick={() => {
                setMemberErr(null);
                setMemberOpen(true);
              }}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 font-code text-[9px] font-bold tracking-[0.18em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950"
            >
              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
              REGISTER A MEMBER
            </button>
          )}
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:gap-6">
        <div
          id="committee-pane-roll"
          role="tabpanel"
          aria-labelledby="committee-tab-roll"
          className={cn("min-w-0", tab !== "roll" && "hidden")}
        >
          {loadErr ? (
            <div className="rounded-[10px] border border-dashed border-ink-200 p-8 text-center">
              <p className="font-code text-[10px] font-bold tracking-[0.22em] text-ink-500">
                COMMITTEE ROLL UNAVAILABLE
              </p>
              <p className="mt-2 font-code text-[8px] tracking-[0.18em] text-ink-400">
                THE RECORD COULD NOT BE READ — NOTHING IS SHOWN RATHER THAN GUESSED
              </p>
              <button
                type="button"
                onClick={load}
                className="mt-4 inline-flex h-9 items-center rounded-xl border border-ink-200 bg-white px-4 font-code text-[9px] font-bold tracking-[0.18em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950"
              >
                RE-READ THE ROLL
              </button>
            </div>
          ) : !data ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3" aria-busy="true" aria-label="Reading the committee roll">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-[104px] animate-pulse rounded-[10px] border border-ink-100 bg-ink-50/60" />
              ))}
            </div>
          ) : (
            <>
            {/* Convening strip — the quorum's live state, on the default tab.
                Summon is idempotent: an open sitting lands on the desk, never
                minted twice. */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 rounded-[12px] panel px-5 py-4 sm:mb-6">
              <div className="min-w-0">
                <p className="font-code text-[9px] font-bold tracking-[0.22em] text-ink-950">
                  CONVENING — {roll.length} OF {data.seats} PRESENT
                </p>
                <p className="mt-1 text-[12.5px] leading-snug text-ink-500">
                  {data.open > 0
                    ? `${data.open} seat${data.open === 1 ? " still stands" : "s still stand"} open — the summons goes out, the roll fills.`
                    : "Quorum is present — the sitting can proceed."}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5" aria-hidden="true">
                  {Array.from({ length: data.seats }).map((_, i) => (
                    <span
                      key={i}
                      title={i < roll.length ? "Seat taken" : "Seat open"}
                      className={cn(
                        "h-2.5 w-2.5 rounded-[3px]",
                        i < roll.length
                          ? i === 0
                            ? "bg-brand-500"
                            : "bg-ink-950"
                          : "border border-dashed border-ink-300"
                      )}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void summon()}
                  disabled={summoning}
                  className="inline-flex h-10 shrink-0 items-center rounded-xl bg-ink-950 px-4 font-code text-[9px] font-bold tracking-[0.18em] text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {summoning ? "SUMMONING…" : "SUMMON THE SITTING"}
                </button>
              </div>
            </div>
            <ScheduledMeetingsPanel
              meetings={data.meetings}
              onSchedule={() => {
                setMeetErr(null);
                setMeetOpen(true);
              }}
              onCancel={(id) => void cancelMeeting(id)}
              cancelBusy={meetCancelBusy}
              onToast={onToast}
            />
            <div data-tour="committee-roll" className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3 2xl:grid-cols-4">
              {roll.map((m, i) => (
                <motion.div
                  key={m.name}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.05 * i, ease: EASE }}
                  className={cn(
                    "rounded-[10px] border bg-white p-4 shadow-[0_1px_2px_rgba(11,12,15,0.04)]",
                    m.you ? "border-brand-300 ring-2 ring-brand-600/15" : m.excused ? "border-ink-100 bg-ink-50/50" : "border-ink-100"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "grid h-10 w-10 shrink-0 place-items-center rounded-full font-code text-[10px] font-bold text-white",
                        m.you ? "bg-brand-600" : "bg-ink-950"
                      )}
                      aria-hidden="true"
                    >
                      {m.initials}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-semibold text-ink-950">{m.name}</p>
                      <p className="mt-0.5 font-code text-[7px] tracking-[0.18em] text-ink-400">{m.role}</p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-code text-[8px] font-bold tracking-[0.16em]",
                      m.you
                        ? "bg-brand-600 text-white"
                        : m.excused
                          ? "border border-ink-200 bg-white text-ink-500"
                          : "bg-ink-50 text-ink-700"
                    )}
                  >
                    {m.you ? (
                      <>
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-white" aria-hidden="true" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" />
                        </span>
                        YOU · GAVEL
                      </>
                    ) : m.excused ? (
                      "EXCUSED"
                    ) : (
                      "PRESENT"
                    )}
                  </span>
                  {canManageRegister && !m.you && m.id && (
                    <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-2 border-t border-ink-100 pt-2.5">
                      <select
                        value={m.office ?? ""}
                        onChange={(e) => void setMemberFlag(m.id!, { office: e.target.value || undefined })}
                        aria-label={`Office of ${m.name}`}
                        className="h-7 min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-1.5 font-code text-[7.5px] font-bold tracking-[0.12em] text-ink-600"
                      >
                        <option value="">OFFICE…</option>
                        {MEMBER_OFFICES.map((o) => (
                          <option key={o} value={o}>
                            {MEMBER_OFFICE_LABELS[o]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void setMemberFlag(m.id!, { status: m.excused ? "PRESENT" : "EXCUSED" })}
                        className="whitespace-nowrap font-code text-[7px] font-bold tracking-[0.16em] text-ink-500 transition-colors hover:text-ink-950"
                      >
                        {m.excused ? "RETURN TO THE ROLL" : "EXCUSE"}
                      </button>
                      <span className="h-3 w-px bg-ink-100" aria-hidden="true" />
                      <button
                        type="button"
                        onClick={() => void removeMember(m.id!)}
                        className={cn(
                          "whitespace-nowrap font-code text-[7px] font-bold tracking-[0.16em] transition-colors",
                          armRemove === m.id ? "text-brand-600" : "text-ink-500 hover:text-brand-600"
                        )}
                      >
                        {armRemove === m.id ? "TAP AGAIN — REMOVE" : "REMOVE"}
                      </button>
                    </div>
                  )}
                </motion.div>
              ))}
              {Array.from({ length: data.open }).map((_, i) => (
                <motion.div
                  key={`open-${i}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5, delay: 0.3 + 0.05 * i, ease: EASE }}
                  className="grid place-items-center rounded-[10px] border border-dashed border-ink-200 p-4 text-center"
                >
                  <div>
                    {/* Numbered voids — each open seat knows its place at the
                        table; the gavel tick in the strip is seat one. */}
                    <span
                      className="mx-auto grid h-9 w-9 place-items-center rounded-full border border-dashed border-ink-300 font-code text-[10px] font-bold text-ink-400"
                      aria-hidden="true"
                    >
                      {roll.length + i + 1}
                    </span>
                    <p className="mt-2.5 font-code text-[8px] font-semibold tracking-[0.22em] text-ink-400">SEAT OPEN</p>
                    <p className="mt-1 font-code text-[7px] tracking-[0.18em] text-ink-400">AWAITS THE QUORUM CALL</p>
                  </div>
                </motion.div>
              ))}
            </div>
            </>
          )}
        </div>

        <div
          id="committee-pane-quorum"
          role="tabpanel"
          aria-labelledby="committee-tab-quorum"
          className={cn("grid content-start gap-4 sm:gap-6", tab === "quorum" && "max-w-xl", tab !== "quorum" && "hidden")}
        >
          <div data-tour="committee-quorum" className="relative overflow-hidden rounded-[12px] border border-ink-950 bg-night p-5 text-white shadow-[0_22px_55px_rgba(11,12,15,0.3)]">
            <div className="bg-grid-dark pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
            <div className="relative">
              <div className="flex items-center justify-between gap-4">
                <h3 className="font-display text-[15px] font-black tracking-[-0.01em]">Quorum</h3>
                <div className="grid grid-cols-3 gap-1" aria-hidden="true">
                  {data
                    ? Array.from({ length: data.seats }).map((_, i) => (
                        <span
                          key={i}
                          className={cn(
                            "h-2 w-2 rounded-[2px]",
                            i === youSeatIndex
                              ? "bg-brand-500"
                              : i < data.present
                                ? "bg-white"
                                : "border border-white/25"
                          )}
                        />
                      ))
                    : Array.from({ length: 9 }).map((_, i) => (
                        <span key={i} className="h-2 w-2 rounded-[2px] border border-white/25" />
                      ))}
                </div>
              </div>
              <p className="mt-4 font-display text-[40px] font-black leading-none tracking-[-0.02em]">
                {data ? data.present : "—"}
                <span className="text-brand-400">/</span>
                {data ? data.seats : "—"}
              </p>
              <p className="mt-3 text-[12.5px] leading-relaxed text-ink-300">
                The minimum of members a committee needs before an award becomes lawful — the mark on the door is that
                threshold, drawn.
              </p>
              <p className="mt-4 font-code text-[8px] tracking-[0.18em] text-ink-400">
                {data
                  ? `PRESENT TODAY ${data.present} · OPEN ${data.open} · A SITTING REQUIRES ${data.required}`
                  : "READING THE COMMITTEE RECORD…"}
              </p>
            </div>
          </div>
          <GavelProtocolCard />
          <button
            type="button"
            data-tour="committee-summon"
            onClick={summon}
            disabled={!data || summoning}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-ink-200 bg-white px-4 font-code text-[9px] font-bold tracking-[0.18em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {summoning ? "ISSUING SUMMONS…" : "SUMMON THE SITTING"}
          </button>
          {data?.lastSummonsAt && (
            <p className="text-center font-code text-[8px] tracking-[0.18em] text-ink-400">
              LAST SUMMONS {summonsClock(data.lastSummonsAt)} · RECORDED IN THE COMMITTEE REGISTER
            </p>
          )}
        </div>
      </div>

      {/* ── The sitting room — every summons mints a fresh Jitsi room (open
             source; no accounts, nothing installed), the committee register
             becomes the door list, and the minutes are written from this
             desk straight into the record. ──────────────────────────────── */}
      <div
        id="committee-pane-desk"
        role="tabpanel"
        aria-labelledby="committee-tab-desk"
        className={cn(tab !== "desk" && "hidden")}
      >
      <div id="mc-sitting-desk" ref={deskRef} className="mt-4 scroll-mt-24 sm:mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2.5 font-code text-[9px] font-bold uppercase tracking-[0.26em] text-ink-500">
            <span className="inline-block h-[2px] w-6 bg-brand-600" aria-hidden="true" />
            The sitting room
          </p>
          <span className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1.5 font-code text-[7.5px] font-bold tracking-[0.18em] text-ink-500">
            <Video className="h-3 w-3 text-brand-600" aria-hidden="true" />
            OPEN-SOURCE VIDEO · JITSI MEET
          </span>
        </div>

        {data && !deskSitting && (
          <div className="mt-3 rounded-[10px] border border-dashed border-ink-200 bg-white/60 p-6 text-center sm:p-10">
            <p className="font-code text-[9px] font-bold tracking-[0.24em] text-ink-500">NO SITTING HAS BEEN SUMMONED</p>
            <p className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed text-ink-500">
              A summons mints the room — a fresh, unlisted Jitsi address that no other meeting has ever used — and
              opens the minutes on this desk. The door list is written from the committee register and nothing else:
              only registered names are admitted, and every admission is recorded against the sitting.
            </p>
            <div className="mx-auto mt-5 flex max-w-md flex-col gap-2 sm:flex-row">
              <input
                value={agenda}
                onChange={(e) => setAgenda(e.target.value)}
                placeholder="Agenda — optional, e.g. 'Award decision: GRZ/2026/041'"
                className="h-10 min-w-0 flex-1 rounded-xl border border-ink-200 bg-white px-3.5 text-[12.5px] text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-ink-950"
                aria-label="Optional agenda for the sitting"
              />
              <button
                type="button"
                onClick={() => void summon()}
                disabled={summoning}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 font-code text-[9px] font-bold tracking-[0.18em] text-white shadow-[0_10px_26px_rgba(217,38,22,0.28)] transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Video className="h-3.5 w-3.5" aria-hidden="true" />
                {summoning ? "MINTING THE ROOM…" : "SUMMON & MINT THE ROOM"}
              </button>
            </div>
            <p className="mt-3 font-code text-[7.5px] tracking-[0.18em] text-ink-400">
              THE OFFICER HOLDS THE GAVEL AND IS ADMITTED AT THE SUMMONS · THE MINUTES OPEN WITH THE ROOM
            </p>
          </div>
        )}

        {data && deskSitting && (
          <>
            {!openSitting ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[12px] panel px-4 py-3">
                <p className="font-code text-[8px] font-bold tracking-[0.18em] text-ink-500">
                  NO SITTING IS OPEN — THE DESK SHOWS A SEALED RECORD
                </p>
                <div className="flex min-w-0 items-center gap-2">
                  <input
                    value={agenda}
                    onChange={(e) => setAgenda(e.target.value)}
                    placeholder="Agenda (optional)"
                    className="h-9 w-48 min-w-0 rounded-lg border border-ink-200 bg-white px-3 text-[12px] text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-ink-950"
                    aria-label="Optional agenda for the next sitting"
                  />
                  <button
                    type="button"
                    onClick={() => void summon()}
                    disabled={summoning}
                    className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-brand-600 px-4 font-code text-[8px] font-bold tracking-[0.18em] text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
                  >
                    <Video className="h-3.5 w-3.5" aria-hidden="true" />
                    {summoning ? "MINTING…" : "SUMMON A NEW SITTING"}
                  </button>
                </div>
              </div>
            ) : deskSitting.id !== openSitting.id ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[12px] panel px-4 py-3">
                <p className="font-code text-[8px] font-bold tracking-[0.18em] text-ink-500">
                  READING HISTORY — A SITTING IS OPEN
                </p>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="font-code text-[8px] font-bold tracking-[0.18em] text-brand-600 transition-colors hover:text-brand-700"
                >
                  BACK TO THE OPEN SITTING →
                </button>
              </div>
            ) : null}

            <div className="mt-3 grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              {/* Left — the room and the minutes */}
              <div className="grid min-w-0 content-start gap-4 sm:gap-6">
                <div className="relative overflow-hidden rounded-[12px] border border-ink-950 bg-night p-5 text-white shadow-[0_22px_55px_rgba(11,12,15,0.3)] sm:p-6">
                  <div className="bg-grid-dark pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
                  <div className="relative">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-code text-[8px] font-semibold tracking-[0.24em] text-ink-400">
                        {deskSitting.status === "OPEN" ? "THE ROOM IS OPEN" : "THE ROOM IS RETIRED"}
                      </p>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-code text-[7.5px] font-bold tracking-[0.16em]",
                          deskSitting.status === "OPEN" ? "bg-brand-600 text-white" : "border border-white/20 text-ink-300"
                        )}
                      >
                        {deskSitting.status === "OPEN"
                          ? `LIVE · SUMMONED ${summonsClock(deskSitting.summonedAt)}`
                          : `SEALED ${deskSitting.closedAt ? summonsClock(deskSitting.closedAt) : ""}`}
                      </span>
                    </div>
                    <h3 className="mt-3 font-display text-[24px] font-black leading-tight tracking-[-0.02em] sm:text-[28px]">
                      {deskSitting.status === "OPEN" ? (
                        <>
                          The floor is open<span className="text-brand-500">.</span>
                        </>
                      ) : (
                        <>
                          The record is sealed<span className="text-brand-500">.</span>
                        </>
                      )}
                    </h3>
                    <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-ink-300">
                      {deskSitting.status === "OPEN"
                        ? "Open the room in a second tab — keep this desk on screen. The minutes write into the record as the meeting talks, and the door below admits only names the register knows."
                        : "The room's address is kept in the record and never reused. The minutes are evidence; the door list is final."}
                    </p>
                    <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5">
                      <Lock className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate font-code text-[10px] tracking-[0.06em] text-ink-200" title={deskSitting.joinUrl}>
                        {deskSitting.joinUrl}
                      </span>
                    </div>
                    {deskSitting.agenda && (
                      <p className="mt-3 font-code text-[8px] tracking-[0.16em] text-ink-400">
                        AGENDA — {deskSitting.agenda.toUpperCase()}
                      </p>
                    )}
                    <div className="mt-4 flex flex-wrap items-center gap-2.5">
                      {deskSitting.status === "OPEN" ? (
                        <a
                          href={deskSitting.joinUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-600 px-5 text-[13px] font-semibold text-white shadow-[0_10px_26px_rgba(217,38,22,0.3)] transition-colors hover:bg-brand-700"
                        >
                          <Video className="h-4 w-4" aria-hidden="true" />
                          Open the room — Jitsi
                          <ArrowUpRight className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
                        </a>
                      ) : (
                        <span className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/15 px-5 text-[12px] font-semibold text-ink-300">
                          <Lock className="h-4 w-4" aria-hidden="true" />
                          Room retired — the record keeps its address
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => void copyLink()}
                        className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/20 px-4 text-[12px] font-semibold text-white transition-colors hover:bg-white/10"
                      >
                        {copied ? <Check className="h-4 w-4 text-brand-400" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                        {copied ? "Copied" : "Copy the link"}
                      </button>
                    </div>
                    <p className="mt-3.5 font-code text-[7.5px] leading-[2] tracking-[0.16em] text-ink-400">
                      JITSI MEET · FREE & OPEN SOURCE (APACHE-2.0) · NO ACCOUNT, NO INSTALL · MINTED FOR THIS SITTING ONLY
                      {deskSitting.status === "OPEN" && <> · SUMMONED BY {deskSitting.summonedBy.toUpperCase()}</>}
                    </p>
                  </div>
                </div>

                <div className="overflow-hidden rounded-[12px] panel shadow-[0_1px_2px_rgba(11,12,15,0.04)]">
                  <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
                    <div>
                      <h3 className="font-display text-[15px] font-black tracking-[-0.01em] text-ink-950">The minutes — captured here</h3>
                      <p className="mt-0.5 font-code text-[7.5px] tracking-[0.18em] text-ink-400">
                        WRITTEN FROM THE DESK · EVERY SAVE LANDS IN THE RECORD
                      </p>
                    </div>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-code text-[7.5px] font-bold tracking-[0.16em]",
                        notesState === "error"
                          ? "border border-brand-200 bg-brand-50 text-brand-700"
                          : notesState === "idle" && notesSavedAt
                            ? "bg-ink-50 text-ink-600"
                            : notesState === "idle"
                              ? "border border-ink-200 bg-white text-ink-500"
                              : "border border-ink-200 bg-white text-ink-500"
                      )}
                    >
                      {deskSitting.status !== "OPEN"
                        ? "SEALED — THE MINUTES STAND"
                        : notesState === "saving"
                          ? "SAVING…"
                          : notesState === "dirty"
                            ? "UNSAVED — TYPING…"
                            : notesState === "error"
                              ? "NOT SAVED — PRESS SAVE"
                              : notesSavedAt
                                ? `SAVED ${summonsClock(notesSavedAt)} · AUTO`
                                : "NOTHING WRITTEN YET"}
                    </span>
                  </header>
                  <div className="p-5">
                    <textarea
                      value={notesDraft}
                      onChange={(e) => {
                        setNotesDraft(e.target.value);
                        notesRef.current = e.target.value;
                        setNotesState("dirty");
                      }}
                      readOnly={deskSitting.status !== "OPEN"}
                      placeholder={
                        deskSitting.status === "OPEN"
                          ? "Type the minutes as the room talks — the motion, the mover, the numbers cited, who hesitated. Autosaves to the sitting record."
                          : "Sealed — the minutes above are the final text."
                      }
                      className={cn(
                        "min-h-[240px] w-full resize-y rounded-xl border border-ink-200 bg-paper px-4 py-3 text-[13.5px] leading-relaxed text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-ink-950 focus:ring-2 focus:ring-ink-950/10",
                        deskSitting.status !== "OPEN" && "cursor-not-allowed bg-ink-50/60 text-ink-600"
                      )}
                      aria-label="The minutes of the sitting"
                    />
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <p className="font-code text-[7.5px] tracking-[0.18em] text-ink-400">
                        {notesDraft.trim().length > 0 ? `${notesDraft.trim().length.toLocaleString()} CHARS · ` : ""}
                        {deskSitting.notesUpdatedAt
                          ? `LAST WRITTEN ${summonsClock(deskSitting.notesUpdatedAt)} BY ${(deskSitting.notesUpdatedBy ?? "—").toUpperCase()}`
                          : "NOTHING WRITTEN YET"}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {deskSitting.status === "OPEN" && (notesState === "dirty" || notesState === "error") && (
                          <button
                            type="button"
                            onClick={() => void flushNotes()}
                            className="inline-flex h-9 items-center gap-2 rounded-lg border border-ink-200 bg-white px-3.5 font-code text-[8px] font-bold tracking-[0.16em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950"
                          >
                            SAVE NOW
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={downloadMinutes}
                          className="inline-flex h-9 items-center gap-2 rounded-lg border border-ink-200 bg-white px-3.5 font-code text-[8px] font-bold tracking-[0.16em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950"
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                          DOWNLOAD .MD
                        </button>
                        {deskSitting.status === "OPEN" && (
                          <button
                            type="button"
                            onClick={() => void closeSitting()}
                            className={cn(
                              "inline-flex h-9 items-center gap-2 rounded-lg px-3.5 font-code text-[8px] font-bold tracking-[0.16em] transition-colors",
                              confirmClose
                                ? "bg-brand-600 text-white hover:bg-brand-700"
                                : "border border-ink-200 bg-white text-ink-600 hover:border-ink-950 hover:text-ink-950"
                            )}
                          >
                            <Stamp className="h-3.5 w-3.5" aria-hidden="true" />
                            {confirmClose ? "TAP AGAIN — SEAL THE SITTING" : "SEAL & CLOSE"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right — the door */}
              <aside className="min-w-0">
                <div className="overflow-hidden rounded-[12px] panel shadow-[0_1px_2px_rgba(11,12,15,0.04)]">
                  <header className="border-b border-ink-100 px-5 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-display text-[15px] font-black tracking-[-0.01em] text-ink-950">The door</h3>
                      <span className="font-code text-[8px] font-bold tracking-[0.18em] text-ink-500">
                        {deskSitting.attendance.filter((a) => a.admitted).length}/{deskSitting.attendance.length} ADMITTED
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">
                      The door list is the committee register, read into this sitting. No registered name, no entry —
                      and every admission is recorded.
                    </p>
                  </header>
                  <ul className="divide-y divide-ink-100">
                    {deskSitting.attendance.map((a) => (
                      <li key={a.memberId} className="flex items-center gap-3 px-4 py-3">
                        <span
                          className={cn(
                            "grid h-9 w-9 shrink-0 place-items-center rounded-full font-code text-[9px] font-bold text-white",
                            a.expected === "OFFICER" ? "bg-brand-600" : "bg-ink-950"
                          )}
                          aria-hidden="true"
                        >
                          {initialsOf(a.name)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-semibold text-ink-950">{a.name}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 font-code text-[7px] tracking-[0.16em] text-ink-400">
                            <span className="truncate">{a.expected === "OFFICER" ? "PROCUREMENT OFFICER" : a.role}</span>
                            {a.expected === "EXCUSED" && (
                              <span className="rounded-full border border-ink-200 px-1.5 py-0.5">EXCUSED</span>
                            )}
                            {a.admitted && a.admittedAt && deskSitting.status === "OPEN" && (
                              <span>· IN {summonsClock(a.admittedAt)}</span>
                            )}
                          </p>
                        </div>
                        {deskSitting.status === "OPEN" ? (
                          <button
                            type="button"
                            onClick={() => void admit(a.memberId, !a.admitted)}
                            disabled={admitBusy === a.memberId}
                            className={cn(
                              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 font-code text-[7.5px] font-bold tracking-[0.16em] transition-colors disabled:cursor-wait",
                              a.admitted
                                ? "bg-ink-950 text-white hover:bg-ink-800"
                                : "border border-ink-200 bg-white text-ink-500 hover:border-ink-950 hover:text-ink-950"
                            )}
                          >
                            {a.admitted ? <Check className="h-3 w-3" aria-hidden="true" /> : <Plus className="h-3 w-3" aria-hidden="true" />}
                            {a.admitted ? "ADMITTED" : "ADMIT"}
                          </button>
                        ) : (
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-2.5 py-1 font-code text-[7.5px] font-bold tracking-[0.16em]",
                              a.admitted ? "bg-ink-50 text-ink-700" : "border border-ink-200 text-ink-500"
                            )}
                          >
                            {a.admitted ? "ADMITTED" : "ABSENT"}
                          </span>
                        )}
                      </li>
                    ))}
                    {deskSitting.attendance.length === 0 && (
                      <li className="px-5 py-6 text-center font-code text-[8px] tracking-[0.18em] text-ink-400">
                        THE REGISTER IS EMPTY — REGISTER THE MEMBERS AND THEY APPEAR AT THE DOOR
                      </li>
                    )}
                  </ul>
                  <footer className="border-t border-ink-100 bg-paper/70 px-5 py-3">
                    <p className="font-code text-[7.5px] leading-[2] tracking-[0.16em] text-ink-400">
                      A JITSI ROOM CANNOT VERIFY IDENTITIES BY ITSELF — THIS DOOR IS THE VERIFICATION. ADMIT ONLY
                      REGISTERED NAMES; ANY STRANGER IN THE ROOM IS NOT OF THIS COMMITTEE.
                    </p>
                  </footer>
                </div>
              </aside>
            </div>

            {data.sittings.length > 1 && (
              <div className="mt-4 overflow-hidden rounded-[12px] panel sm:mt-5">
                <header className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-3.5">
                  <h3 className="font-code text-[9px] font-bold tracking-[0.22em] text-ink-500">THE SITTING REGISTER</h3>
                  <span className="font-code text-[7.5px] tracking-[0.18em] text-ink-400">{data.sittings.length} MOST RECENT</span>
                </header>
                <ul className="divide-y divide-ink-100">
                  {data.sittings.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => {
                          if (notesState === "dirty" || notesState === "error") void flushNotes();
                          setSelectedId(s.id);
                        }}
                        className={cn(
                          "flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left transition-colors hover:bg-paper",
                          deskSitting.id === s.id && "bg-paper"
                        )}
                      >
                        <span className="font-code text-[8px] font-bold tracking-[0.16em] text-ink-400">
                          {dayOf(s.summonedAt).toUpperCase()}
                        </span>
                        <span className="text-[12.5px] font-semibold text-ink-950">{s.title}</span>
                        <span className="font-code text-[7.5px] tracking-[0.16em] text-ink-400">
                          {s.attendance.filter((a) => a.admitted).length} ADMITTED · {s.notes.trim().length.toLocaleString()} CHARS
                        </span>
                        <span
                          className={cn(
                            "ml-auto shrink-0 rounded-full px-2.5 py-1 font-code text-[7.5px] font-bold tracking-[0.16em]",
                            s.status === "OPEN" ? "bg-brand-600 text-white" : "border border-ink-200 text-ink-500"
                          )}
                        >
                          {s.status === "OPEN" ? "OPEN" : "SEALED"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
      </div>

      {/* Schedule-a-meeting dialog — the owner names the day and the players */}
      <AnimatePresence>
        {meetOpen && (
          <ScheduleMeetingDialog
            members={data?.members ?? []}
            busy={meetBusy}
            error={meetErr}
            onClose={() => {
              if (!meetBusy) setMeetOpen(false);
            }}
            onSubmit={(draft) => void scheduleMeeting(draft)}
          />
        )}
      </AnimatePresence>

      {/* Register-a-member dialog — the register is what opens the door */}
      <AnimatePresence>
        {memberOpen && (
          <motion.div
            key="member-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[70] grid place-items-center bg-night/70 p-4 backdrop-blur-sm"
            onClick={() => {
              if (!memberBusy) setMemberOpen(false);
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Add a committee member"
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.28, ease: EASE }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg rounded-[12px] panel panel-lift p-5 sm:p-7"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-code text-[8px] font-semibold tracking-[0.24em] text-ink-400">THE COMMITTEE REGISTER</p>
                  <h3 className="mt-1 font-display text-[20px] font-black tracking-[-0.015em] text-ink-950">
                    Register a member<span className="text-brand-600">.</span>
                  </h3>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-500">
                    Only names on this register are admitted to a sitting&apos;s room — and only PRESENT members count
                    toward quorum. Register the humans; the door does the rest.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!memberBusy) setMemberOpen(false);
                  }}
                  aria-label="Close without saving"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-paper hover:text-ink-900"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="mt-5 grid grid-cols-1 gap-3">
                <label className="block">
                  <span className="font-code text-[7.5px] font-bold tracking-[0.18em] text-ink-400">FULL NAME</span>
                  <input
                    value={memberDraft.name}
                    onChange={(e) => setMemberDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="e.g. Mwansa Chileshe"
                    className="mt-1.5 h-10 w-full rounded-xl border border-ink-200 bg-white px-3.5 text-[13px] text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-ink-950"
                  />
                </label>
                <label className="block">
                  <span className="font-code text-[7.5px] font-bold tracking-[0.18em] text-ink-400">ROLE ON THE COMMITTEE</span>
                  <input
                    value={memberDraft.role}
                    onChange={(e) => setMemberDraft((d) => ({ ...d, role: e.target.value }))}
                    placeholder="e.g. DIRECTOR OF PROCUREMENT · FINANCE"
                    className="mt-1.5 h-10 w-full rounded-xl border border-ink-200 bg-white px-3.5 text-[13px] text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-ink-950"
                  />
                </label>
                <label className="flex items-center gap-2.5 rounded-xl border border-ink-100 bg-paper/60 px-3.5 py-3">
                  <input
                    type="checkbox"
                    checked={memberDraft.isChair}
                    onChange={(e) => setMemberDraft((d) => ({ ...d, isChair: e.target.checked }))}
                    className="h-4 w-4 accent-brand-600"
                  />
                  <span className="text-[12.5px] text-ink-600">Sits as chair — opens the roll at every sitting</span>
                </label>
              </div>
              {memberErr && (
                <p role="alert" className="mt-4 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-brand-800">
                  {memberErr}
                </p>
              )}
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className="font-code text-[7.5px] tracking-[0.16em] text-ink-400">IT IS A WRITE — THE ROSTER CHANGES FOR REAL</p>
                <button
                  type="button"
                  onClick={() => void addMember()}
                  disabled={memberBusy}
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-600 px-5 text-[13px] font-semibold text-white shadow-[0_10px_26px_rgba(217,38,22,0.28)] transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  {memberBusy ? "Writing to the register…" : "Add to the register"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ViewShell>
  );
}

/* ── Team members — real workspace access: invite codes, claims, revocation ── */

type TeamInvite = {
  id: string;
  code: string | null;
  email: string | null;
  role: string;
  status: "PENDING" | "CLAIMED" | "REVOKED";
  inviterName: string;
  claimedByEmail: string | null;
  createdAt: string;
  expiresInDays: number;
};

type TeamData = {
  members: {
    id: string;
    name: string;
    email: string;
    organization: string | null;
    role: WorkspaceRole;
    status: "ACTIVE" | "SUSPENDED";
    joined: string;
    currentAccount: boolean;
  }[];
  invites: TeamInvite[];
  canManage: boolean;
  actorRole: WorkspaceRole;
};

function TeamMembersSection({
  user,
  onToast,
  onOpenOversight,
}: {
  user: AuthUser | null;
  onToast: (m: string) => void;
  onOpenOversight: () => void;
}) {
  const [data, setData] = useState<TeamData | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AssignableRole>("OFFICER");
  const [busy, setBusy] = useState(false);
  const [freshCode, setFreshCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    let alive = true;
    fetch("/api/team")
      .then((r) => r.json())
      .then((d: TeamData | { error: string }) => {
        if (!alive) return;
        if ("error" in d) setLoadErr(true);
        else {
          setData(d);
          setLoadErr(false);
        }
      })
      .catch(() => {
        if (alive) setLoadErr(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => load(), [load]);

  const invite = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim() || undefined, role: inviteRole }),
      });
      const d = (await res.json()) as { invite?: { code: string }; error?: string };
      if (!res.ok || !d.invite) throw new Error(d.error ?? "failed");
      setFreshCode(d.invite.code);
      setCopied(false);
      setInviteEmail("");
      onToast(`INVITE CREATED — ${d.invite.code}`);
      load();
    } catch (err) {
      onToast(`INVITE FAILED — ${(err as Error).message.toUpperCase()}`);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (inviteId: string) => {
    try {
      const res = await fetch(`/api/team?inviteId=${encodeURIComponent(inviteId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("failed");
      onToast("INVITE REVOKED");
      load();
    } catch {
      onToast("REVOKE FAILED");
    }
  };

  const copyCode = async () => {
    if (!freshCode) return;
    try {
      await navigator.clipboard.writeText(freshCode);
      setCopied(true);
      onToast("CODE COPIED — PASTE IT INTO REGISTRATION");
    } catch {
      onToast("COPY FAILED — SELECT THE CODE MANUALLY");
    }
  };

  const cardClass = "rounded-[12px] panel p-5 shadow-[0_1px_2px_rgba(11,12,15,0.04)]";
  const labelClass = "font-code text-[8px] font-semibold tracking-[0.22em] text-ink-400";
  const titleClass = "mt-1.5 font-display text-[15px] font-black tracking-[-0.01em] text-ink-950";

  return (
    <section className={`${cardClass} lg:col-span-2`} aria-labelledby="settings-team-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={labelClass}>WORKSPACE ACCESS</p>
          <h3 id="settings-team-heading" className={titleClass}>Team Members</h3>
          <p className="mt-1 text-[12.5px] text-ink-500">
            Workspace authority, separate from the committee roster. Role changes and organization suspension live in
            the oversight console.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-paper px-3 py-1.5 font-code text-[8px] font-bold tracking-[0.14em] text-ink-500">
            <Users className="h-3 w-3" aria-hidden="true" />
            {data ? `${data.members.length} MEMBER${data.members.length === 1 ? "" : "S"}` : "INVITATIONS"}
          </span>
          {canDo(user?.role, "view_oversight") && (
            <button
              type="button"
              onClick={onOpenOversight}
              className="inline-flex items-center gap-1.5 rounded-full border border-ink-950 bg-ink-950 px-3 py-1.5 font-code text-[8px] font-bold tracking-[0.14em] text-white transition-colors hover:bg-ink-800"
            >
              <Scale className="h-3 w-3" aria-hidden="true" />
              OPEN OVERSIGHT
            </button>
          )}
        </div>
      </div>

      {/* Members */}
      <ul className="mt-5">
        {loadErr && (
          <li className="rounded-xl border border-ink-100 bg-paper/60 px-4 py-3.5 text-[12.5px] text-ink-500">
            Team data is unavailable right now — check that you are signed in.
          </li>
        )}
        {data?.members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-100 bg-paper/60 px-4 py-3.5">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 font-code text-[10px] font-bold text-white"
              aria-hidden="true"
            >
              {initialsOf(m.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-ink-950">{m.name}</p>
              <p className="truncate font-code text-[8px] tracking-[0.12em] text-ink-500">{m.email.toUpperCase()}</p>
            </div>
            <span className="rounded-full border border-ink-200 bg-white px-2.5 py-1 font-code text-[7.5px] font-bold tracking-[0.14em] text-ink-600">
              {ROLE_LABELS[m.role].toUpperCase()}
            </span>
            {m.status === "SUSPENDED" && (
              <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 font-code text-[7.5px] font-bold tracking-[0.14em] text-red-700">
                SUSPENDED
              </span>
            )}
            {m.currentAccount && (
              <span className="rounded-full border border-ink-100 bg-paper px-2.5 py-1 font-code text-[7.5px] font-bold tracking-[0.14em] text-ink-400">
                YOU
              </span>
            )}
          </li>
        ))}
      </ul>

      {/* Invite composer — only the roles that may write people access */}
      {user && data?.canManage && (
        <div className="mt-5 rounded-xl border border-ink-100 bg-paper/60 p-4">
          <p className="font-code text-[8px] font-semibold tracking-[0.22em] text-ink-400">INVITE A TEAMMATE</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@authority.go.ke (optional note)"
              aria-label="Colleague email (optional)"
              className="h-10 min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-3 text-[13px] text-ink-950 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-400"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as AssignableRole)}
              aria-label="Workspace role"
              className="h-10 rounded-lg border border-ink-200 bg-white px-3 font-code text-[9px] font-bold tracking-[0.14em] text-ink-700 outline-none"
            >
              {(data.actorRole === "OWNER" ? ASSIGNABLE_ROLES : ASSIGNABLE_ROLES.filter((role) => role !== "ADMIN")).map(
                (role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role].toUpperCase()}
                  </option>
                ),
              )}
            </select>
            <button
              type="button"
              onClick={invite}
              disabled={busy}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink-950 px-4 font-code text-[9px] font-bold tracking-[0.16em] text-white transition-colors hover:bg-ink-800 disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {busy ? "CREATING…" : "CREATE INVITE"}
            </button>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-400">
            No email provider is configured — Quorum gives you a code instead. Share it with your teammate; they
            paste it during registration (it expires in 14 days).
          </p>
          {freshCode && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5">
              <span className="font-code text-[13px] font-bold tracking-[0.18em] text-brand-800" aria-live="polite">{freshCode}</span>
              <button
                type="button"
                onClick={copyCode}
                className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-white px-3 py-1 font-code text-[8px] font-bold tracking-[0.14em] text-brand-800 transition-colors hover:bg-brand-100"
              >
                <Copy className="h-3 w-3" aria-hidden="true" />
                {copied ? "COPIED" : "COPY CODE"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Pending invites — shared codes, whoever from accounts */}
      {data && data.invites.length > 0 && (
        <div className="mt-4">
          <p className="font-code text-[8px] font-semibold tracking-[0.22em] text-ink-400">PENDING INVITATIONS</p>
          <ul className="mt-2">
            {data.invites.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-100 bg-paper/60 px-4 py-3">
                <span className="font-code text-[11px] font-bold tracking-[0.16em] text-ink-950">{inv.code ?? "———"}</span>
                <span className="rounded-full border border-ink-100 bg-white px-2 py-0.5 font-code text-[7.5px] font-bold tracking-[0.12em] text-ink-500">
                  {inv.role}
                </span>
                {inv.email && <span className="truncate text-[11.5px] text-ink-400">for {inv.email}</span>}
                <span className="truncate text-[10px] text-ink-400">
                  {inv.status === "CLAIMED"
                    ? `claimed by ${inv.claimedByEmail ?? "a member"}`
                    : inv.status === "REVOKED"
                      ? "revoked"
                      : `expires in ${inv.expiresInDays} day${inv.expiresInDays === 1 ? "" : "s"}`}
                </span>
                {inv.status === "PENDING" && (
                  <button
                    type="button"
                    onClick={() => revoke(inv.id)}
                    className="ml-auto rounded-full border border-ink-200 px-2.5 py-1 font-code text-[7.5px] font-bold tracking-[0.14em] text-ink-500 transition-colors hover:border-brand-200 hover:text-brand-800"
                  >
                    REVOKE
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ── Rules & guards ──────────────────────────────────────────────────────── */

function GuardPills<T extends string>({
  value,
  options,
  onChange,
  groupLabel,
  disabled = false,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  groupLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={groupLabel}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          aria-pressed={value === o}
          disabled={disabled}
          className={cn(
            "h-8 rounded-full border px-3.5 font-code text-[8.5px] font-bold tracking-[0.14em] transition-all",
            value === o
              ? "border-ink-950 bg-ink-950 text-white"
              : "border-ink-200 bg-white text-ink-500 hover:border-ink-400",
            disabled && "cursor-not-allowed opacity-55 hover:border-ink-200"
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function SettingsView({
  user,
  agent,
  onSignOut,
  onOpenOversight,
  onToast,
}: {
  user: AuthUser | null;
  agent: AgentStatus;
  onSignOut: () => void;
  onOpenOversight: () => void;
  onToast: (m: string) => void;
}) {
  const mode = agentModeOf(agent);
  const health = agent.health;
  const connection: { label: string; value: string }[] = [
    { label: "Status", value: mode === "online" ? "ONLINE" : mode === "offline" ? "OFFLINE" : "LINKING" },
    { label: "Service", value: health ? `${health.service} · v${health.version}` : "—" },
    {
      label: "Filesystem MCP",
      value: health ? `${health.fsMcp.status.toUpperCase()} · ${health.fsMcp.tools.length} TOOLS` : "—",
    },
    { label: "Agent graphs", value: health ? String(health.graphs.length) : "—" },
    { label: "Evaluations recorded", value: health ? health.counts.runs.toLocaleString("en-US") : "—" },
    { label: "Tool calls logged", value: health ? health.counts.toolCalls.toLocaleString("en-US") : "—" },
  ];

  const cardClass = "rounded-[12px] panel p-5 shadow-[0_1px_2px_rgba(11,12,15,0.04)]";
  const labelClass = "font-code text-[8px] font-semibold tracking-[0.22em] text-ink-400";
  const titleClass = "mt-1.5 font-display text-[15px] font-black tracking-[-0.01em] text-ink-950";

  return (
    <ViewShell
      fig="14"
      title="Settings"
      sub="Your account, the agent connection and this session. Identity comes from sign-in and agent values are read live from the sidecar, so neither is edited here."
    >
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
        <div data-tour="settings-account" className={cardClass}>
          <p className={labelClass}>ACCOUNT</p>
          <h3 className={titleClass}>Signed-in officer</h3>
          <div className="mt-5 flex items-center gap-4">
            <span
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-600 font-code text-[12px] font-bold text-white"
              aria-hidden="true"
            >
              {initialsOf(user?.name ?? "Quorum")}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-ink-950">{user?.name ?? "Guest officer"}</p>
              <p className="truncate font-code text-[9px] tracking-[0.14em] text-ink-500">
                {(user?.email ?? "NOT SIGNED IN").toUpperCase()}
              </p>
            </div>
          </div>
        </div>

        <div data-tour="settings-signout" className={cardClass}>
          <p className={labelClass}>SESSION</p>
          <h3 className={titleClass}>Sign out of this workspace</h3>
          <p className="mt-1 text-[12.5px] text-ink-500">
            Ends this browser session. Runs and the audit trail stay on the sidecar.
          </p>
          <button
            type="button"
            onClick={onSignOut}
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-4 py-2 font-code text-[9px] font-bold tracking-[0.16em] text-brand-800 transition-colors hover:bg-brand-100"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            SIGN OUT
          </button>
        </div>

        {canDo(user?.role, "view_oversight") && (
          <TeamMembersSection user={user} onToast={onToast} onOpenOversight={onOpenOversight} />
        )}

        <div data-tour="settings-agent" className={`${cardClass} lg:col-span-2`}>
          <p className={labelClass}>AGENT CONNECTION</p>
          <h3 className={titleClass}>Agent service</h3>
          <p className="mt-1 text-[12.5px] text-ink-500">Live status of the agent service — the part that reads the files, runs the review and logs every step.</p>
          <dl className="mt-5 grid grid-cols-1 divide-y divide-ink-100 sm:grid-cols-2 sm:divide-y-0">
            {connection.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4 border-ink-100 py-3 sm:border-b sm:pr-4">
                <dt className="font-code text-[9px] tracking-[0.16em] text-ink-500">{row.label.toUpperCase()}</dt>
                <dd className="text-right font-code text-[10px] font-bold tracking-[0.08em] text-ink-950">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </ViewShell>
  );
}

/* ── Walkthrough: a guided tour of every section, in the order a tender moves ── */

type WalkthroughChapter = {
  /* A chapter opens a section — or, with `href`, its own URL entirely. */
  section?: SectionId;
  href?: string;
  title: string;
  summary: string;
  steps: string[];
  tip: string;
  /* Chapter two opens the New evaluation wizard instead of a section. */
  launch?: boolean;
  /* The guided tour: each step spotlights one real control on the page this
     chapter names — targets are [data-tour] keys, so the page itself can be
     grepped for exactly what the walkthrough talks about. Chapters that open
     their own URL (the handbook) run their tour on the page they leave to. */
  tour?: TourStep[];
};

const WALKTHROUGH: WalkthroughChapter[] = [
  {
    section: "mc-overview",
    title: "Start with the overview",
    summary: "Your command deck. Every live run, every open approval and the agent's latest moves on one screen.",
    steps: [
      "Start with New evaluation — name the tender and stage its pack; the register below fills in as the agent reads.",
      "Check the counters for evaluations in progress and approvals waiting on a named officer.",
      "Begin each session here to see what needs your signature first.",
    ],
    tip: "If nothing is waiting, the committee has nothing to decide, and the agent has nothing to hand over.",
    tour: [
      {
        target: "ov-new-run",
        title: "Brief the agent",
        body: "Every review starts here. Name the tender and stage its pack — the agent reads it, and the register fills in with every claim cited.",
      },
      {
        target: "ov-stats",
        title: "Four counters, read live",
        body: "Runs in progress, issues found, citation coverage and approvals waiting. The last turns brand-coloured the moment the committee is on the clock.",
      },
      {
        target: "gate-queue",
        title: "What needs your signature first",
        body: "A finished run lands here as a gate. Nothing moves past it without a named officer.",
      },
    ],
  },
  {
    section: "mc-runs",
    title: "Launch an evaluation",
    summary: "A run is one tender reviewed end to end. The wizard takes three steps and never starts until you confirm the scope.",
    steps: [
      "Details: enter the tender reference and the published title exactly as it appears, then pick the source format (OCDS, PDF pack or email bag).",
      "Documents: drop up to 12 files. Each one moves from RECEIVED to PARSING to INDEXED before you can continue. Real uploads also mirror to cloud storage, or stay in the local vault.",
      "Scope: choose which checks the review runs. Page-level citations stay on for every finding.",
      "Launch: the evaluation is queued and you land on Evaluations, where it goes live.",
    ],
    tip: "Use the step rail to go back and correct details at any point before launch.",
    tour: [
      {
        target: "wiz-rail",
        action: "open-wizard",
        title: "Three steps, shown before you commit",
        body: "01 details · 02 documents · 03 scope. The rail stays visible so you always know what is left.",
      },
      {
        target: "wiz-body",
        title: "Details the audit trail will cite",
        body: "The tender reference and its published title. Leave the reference blank and Quorum continues the register's sequence — the form says so when it does.",
      },
      {
        target: "wiz-next",
        placement: "top",
        title: "The wizard refuses to guess",
        body: "Continue advances only when the step is complete. On scope, this same button queues the evaluation — and it goes live straight away.",
      },
    ],
    launch: true,
  },
  {
    section: "mc-runs",
    title: "Follow the evaluations",
    summary: "Every tender the agent is working on, with its status and what it has found so far.",
    steps: [
      "RUNNING: the agent is still working through the checks.",
      "GATE: the evaluation has finished and is waiting for a committee decision.",
      "COMPLETE: the evaluation has been filed, returned or has failed.",
      "Search and filter the list, or open an evaluation's notes.",
    ],
    tip: "An evaluation in GATE is waiting on people, not on the agent.",
    tour: [
      {
        target: "run-register",
        title: "Every evaluation, at a glance",
        body: "Newest first: the tender, its bids, issues found and the share of findings that carry a citation. Search narrows by reference, title or buyer.",
      },
      {
        target: "run-filters",
        title: "Filter to what needs you",
        body: "IN PROGRESS · NEEDS APPROVAL · COMPLETED. An evaluation in NEEDS APPROVAL is waiting on people, not on the agent.",
      },
      {
        target: "run-rows",
        title: "Expand any row",
        body: "The top findings and the evaluation's audit trail open in place — every figure traces to a line in the tool log.",
      },
    ],
  },
  {
    section: "mc-gates",
    title: "Sign or return approvals",
    summary: "The human gate. Each pending decision shows the supplier, the value and how many findings were flagged.",
    steps: [
      "Review the flagged findings for the bid in question.",
      "Sign to award the tender, or return it for clarification.",
      "Only committee members on the roster can sign. The system refuses any other signature.",
    ],
    tip: "The agent prepares the file and never awards. Every decision is recorded under the name of the officer who signed.",
    tour: [
      {
        target: "gate-queue",
        title: "The human gate",
        body: "Each card is one file the agent finished and halted: the proposed supplier, the contract value and the flags behind it.",
      },
      {
        target: "gate-actions",
        title: "Award or return — by name",
        body: "Award signs the decision under your name; Return sends it back with a task. Only roster names can sign — the system refuses anyone else.",
      },
      {
        target: "gate-ledger",
        title: "Decisions land here",
        body: "Every sign or return is appended with the name and the time — and mirrored into the award history.",
      },
    ],
  },
  {
    section: "mc-activity",
    title: "Watch live activity",
    summary: "A running feed of what the agent is doing, in order, as it does it.",
    steps: [
      "Each event shows the step, the tool it called and the time.",
      "Use the feed to trace how a finding was reached before you rely on it.",
    ],
    tip: "Leave this open while an evaluation is in progress to see it move in real time.",
    tour: [
      {
        target: "agent-feed",
        title: "The work, streaming",
        body: "What the agent read, which tool it called and what it flagged, in the order it happened — without leaving this screen.",
      },
      {
        target: "agent-feed-stream",
        title: "Every line is a durable entry",
        body: "The feed reads the same activity log the agent writes to disk. Leave it open during an evaluation and watch the file build.",
      },
    ],
  },
  {
    section: "mc-findings",
    title: "Review findings",
    summary: "Every issue raised across all evaluations, grouped by class and tied to its source.",
    steps: [
      "Classes: DOCUMENT, COMPLIANCE, REGISTRY, PRICING, ARITHMETIC, DISCLOSURE, LOGISTICS and SECURITY.",
      "Each finding carries a page, clause or registry citation.",
      "A finding with no citation is marked unsourced and should not be relied on.",
      "Open a finding's run to see it in context.",
    ],
    tip: "Unsourced findings are the first thing to check before a gate is signed.",
    tour: [
      {
        target: "findings-filters",
        title: "Classes and states, filtered",
        body: "Filter by OPEN, CLEARED or RE-CHECK. The counters above name every finding and how many remain open — 0 UNSOURCED is the one that must never move.",
      },
      {
        target: "findings-rows",
        title: "Read the source before the sentence",
        body: "Each row carries its class, its state and the page, clause or registry ID it came from. Open a row for the evaluation behind it.",
      },
    ],
  },
  {
    section: "mc-reports",
    title: "Read report packs",
    summary: "A pack per evaluation, ready to hand to the committee: the findings, their sources and the verdict.",
    steps: [
      "Open a run's pack to read the full set of findings.",
      "The verdict shows whether the evaluation was awarded or returned.",
    ],
    tip: "Packs are the document the committee reads at the sitting.",
    tour: [
      {
        target: "reports-intro",
        title: "The committee pack",
        body: "Every sealed report for the sitting, bound into one cited file sharing a single audit hash — the document the committee reads.",
      },
      {
        target: "reports-list",
        title: "One pack per finished evaluation",
        body: "Findings, citations, the sha-256 tag and the verdict. A pack seals on signature — before that it previews only.",
      },
      {
        target: "report-download",
        title: "Export when sealed",
        body: "Download unlocks the moment the gate signs. Until then the button previews what the sealed pack will carry.",
      },
    ],
  },
  {
    section: "mc-sources",
    title: "Check data sources",
    summary: "Every African dataset the OCP Data Registry lists — who publishes it, what it covers, when it was last pulled, and a dated connection record for each.",
    steps: [
      "See the registries the agent can read, country by country — coverage span, formats and the latest retrieval date.",
      "Expand a country to check a dataset's licence, counts and the publisher's own portal before leaning on it in a run.",
      "Connect the portals: the agent opens each published file, reads its first OCDS release as proof, and checks the publisher's own portal — every result is dated and saved.",
    ],
    tip: "A dataset the publisher stopped updating carries the registry's own flag — a gap downstream is never a silent pass.",
    tour: [
      {
        target: "sources-standards",
        title: "What every finding stands on",
        body: "OCDS 1.1, the MCP tool surface, LLM drafting and page citations — the four standards the review pipeline holds itself to.",
      },
      {
        target: "sources-portals",
        title: "The registries it reads",
        body: "Every African dataset on the Open Contracting Partnership's registry — one row per country. Expand one for licences, coverage, counts and the publisher's own portal. Each dataset keeps a real connection record: the first OCDS release the sidecar read from the published file, and whether the publisher's portal answered. Re-check any time — a failed check is shown, never hidden.",
      },
      {
        target: "sources-request-btn",
        title: "Missing a source? File it",
        body: "A request lands in the register with a name and a timestamp, so the gap is recorded where the next run can see it.",
      },
    ],
  },
  {
    section: "mc-ledger",
    title: "Consult the award history",
    summary: "The ledger of every AWARDED and RETURNED decision, with who signed and when.",
    steps: [
      "Each row names the tender, the decision, the signer and the time.",
      "Entries are appended, never edited.",
    ],
    tip: "Use this for audit questions: it is the record of who decided what.",
    tour: [
      {
        target: "ledger-stats",
        title: "The gavel's arithmetic",
        body: "Decisions logged, awarded, returned and awaiting — the ledger's four totals, read live.",
      },
      {
        target: "ledger-rows",
        title: "Who decided what, and when",
        body: "Each row names the tender, the decision, the officer who signed and the time. Entries are appended, never edited.",
      },
    ],
  },
  {
    section: "mc-committee",
    title: "Sit on the committee",
    summary: "The roster in roll-call order: the chair, the members present and any excused.",
    steps: [
      "Summon a sitting to call the roll.",
      "When quorum is present, the sitting can proceed to decisions.",
    ],
    tip: "Quorum is checked before any gate can be signed in a sitting.",
    tour: [
      {
        target: "committee-roll",
        tab: "roll",
        title: "The roll, in reading order",
        body: "The chair opens, the gavel seat follows, then the members — excused seats close the roll. Every card is a stored record, not a hardcoded name.",
      },
      {
        target: "committee-quorum",
        tab: "quorum",
        title: "The mark on the door",
        body: "Seats present against seats required. Quorum is the threshold an award must clear before the sitting can decide.",
      },
      {
        target: "committee-summon",
        tab: "quorum",
        title: "Summon the sitting",
        body: "A summons mints a fresh Jitsi room, opens the minutes and admits only names on this register. One sitting is open at a time.",
      },
    ],
  },
  {
    section: "mc-calendar",
    title: "Read the committee calendar",
    summary: "Every date the desk answers to — statutory clocks, committee sittings and gate signatures — on one grid.",
    steps: [
      "Statutory clocks come from each tender's own cycle record: closing, ALB response, standstill end, milestones, complaint responses.",
      "A sitting lands on the day it was summoned; while the room is open it reads live.",
      "Select any day for its agenda, or jump the grid straight to a clock from the rail.",
    ],
    tip: "An overdue clock stays on the grid in red — the record writes the dates, and this page never moves one.",
    tour: [
      {
        target: "cal-month",
        title: "The month, on the record",
        body: "One cell per day, one chip per item: statutory clocks, sittings, files at the gate and signatures. Today is ringed; overdue dates stay red.",
      },
      {
        target: "cal-agenda",
        title: "One day, read in full",
        body: "Select a day and its agenda opens beside the grid — every clock with its countdown, every sitting with its door record, every decision with the name that signed it.",
      },
      {
        target: "cal-clocks",
        title: "The next clocks",
        body: "The open statutory dates, soonest first. Select one and the month turns to the day it falls on. Export the month to .ics and it lands in any diary.",
      },
    ],
  },
  {
    section: "mc-stack",
    title: "Inspect tools and models",
    summary: "The sidecar's tools, the agent graphs and the LLM endpoint behind them.",
    steps: [
      "Each graph runs its checks and stops at the human gate.",
      "The tool log records every call the agent makes.",
    ],
    tip: "If something looks wrong, the tool log shows exactly what the agent did and in what order.",
    tour: [
      {
        target: "stack-tools",
        title: "Our own MCP server — five tools",
        body: "Each tool is tagged READ, WRITES or IRREVERSIBLE. The irreversible one — filing — can only ever raise a gate for a human.",
      },
      {
        target: "stack-graphs",
        title: "Run the graph, live",
        body: "Fire the review graph and watch the nodes work: read over the filesystem MCP, requirements pinned, findings flagged, a gate raised.",
      },
      {
        target: "stack-log",
        title: "The tool log",
        body: "Every call, append-only, JSONL on disk. If something looks wrong, this shows exactly what the agent did and in what order.",
      },
    ],
  },
  {
    section: "mc-rules",
    title: "Set rules and safeguards",
    summary: "The thresholds the agent applies: price variance and the document checklist.",
    steps: [
      "Price variance: flag any bid priced above the framework median by 15%, 25% or 40%.",
      "Document checklist: standard or strict, before a run may complete.",
      "Every change is written to the audit trail.",
    ],
    tip: "The standing rule holds regardless of settings: the committee signs, and the agent never does.",
    tour: [
      {
        target: "rules-guards",
        title: "Three tunable guards",
        body: "Price variance, the document checklist and the registry cross-check. Change a pill and the sidecar stores it the moment you click.",
      },
      {
        target: "rules-locked",
        title: "One guard is not a setting",
        body: "Page-level citations on every claim — locked by design, not offered as a toggle.",
      },
      {
        target: "rules-audit",
        title: "Your name, on every change",
        body: "The last-change line and the trail behind it: who, when, before and after. READ THE TRAIL jumps to the full record.",
      },
    ],
  },
  {
    section: "mc-settings",
    title: "Manage your account",
    summary: "Your signed-in identity, the agent connection and this session.",
    steps: [
      "Account shows the officer signed in. Identity comes from sign-in.",
      "Agent connection shows whether the sidecar is online and how many runs it has recorded.",
      "Sign out ends this browser session. Runs and the audit trail stay on the sidecar.",
    ],
    tip: "If the sidecar shows offline, decisions cannot be recorded until it is back.",
    tour: [
      {
        target: "settings-account",
        title: "The name that signs",
        body: "Identity comes from sign-in — the officer shown here is the name every decision records.",
      },
      {
        target: "settings-agent",
        title: "The agent connection, live",
        body: "Sidecar status, filesystem tools, runs recorded and calls logged — read straight from quorum-mcp.",
      },
      {
        target: "settings-signout",
        title: "Ending the session",
        body: "Sign out closes this browser session. Runs, gates and the audit trail stay on the sidecar.",
      },
    ],
  },
  {
    section: "mc-suppliers",
    title: "Keep the supplier list",
    summary: "The platform's roll of named bidders — every firm your entity deals with, with the registration detail a compliant bid must carry.",
    steps: [
      "Open Suppliers from the sidebar, then fill the Add Supplier intake on the right: name, registration number, ZRA tax detail and the sector regulator where one applies.",
      "The table shows every supplier with their tax clearance state, categories and audit trail of who added them.",
      "Edit a firm when its papers change; suspend or blacklist when it should not be considered.",
    ],
    tip: "A supplier carrying an expired ZRA tax clearance is the classic non-responsiveness — keep the register current before a run reads it.",
    tour: [
      {
        target: "suppliers-add",
        title: "Add a supplier",
        body: "The intake opens as a modal; pick a firm from the ZPPA roll and the record fills itself — or type a new one by hand.",
      },
      {
        target: "suppliers-roll",
        title: "The roll, full width",
        body: "Every firm with its registration, tax-clearance state, categories, and who added it — and when.",
      },
      {
        target: "suppliers-filters",
        title: "Filter by standing",
        body: "Active, suspended, blacklisted. A firm carrying an expired tax clearance is the classic non-responsiveness — keep the register current before a run reads it.",
      },
    ],
  },
  {
    href: "/docs",
    title: "Read the documentation",
    summary: "The full handbook, at its own address: the review pipeline, every rule the agent applies, the gate protocol and Zambia's procurement law.",
    steps: [
      "Open Documentation from the sidebar — it leaves the workspace for its own page.",
      "Chapters run in reading order, from what Quorum is to the glossary; search jumps straight to a rule, a method or a field.",
      "The Zambia chapter carries the lawful procurement methods, live from the agent's own method register.",
    ],
    tip: "When a finding surprises you, its rule code is documented there with the exact trigger and the committee's move.",
  },
];

const SECTION_ICON = Object.fromEntries(
  NAV_GROUPS.flatMap((g) => g.items.filter((i) => !i.href).map((i) => [i.id, i.icon] as const))
) as Record<SectionId, LucideIcon>;

function WalkthroughView({
  onOpen,
  onNewRun,
  onTour,
  done,
}: {
  onOpen: (id: SectionId) => void;
  onNewRun: () => void;
  onTour: (chapter: number) => void;
  done: number[];
}) {
  return (
    <ViewShell
      fig="15"
      title="Walkthrough"
      sub="A tour of every part of Quorum, in the order a tender moves through it. Start a chapter and the screen dims, the control is spotlit, and Quorum walks you through it — what the screen does, what you decide there, and where to go next."
      action={
        <button
          type="button"
          onClick={onNewRun}
          className="group inline-flex h-11 items-center gap-2 rounded-xl bg-brand-600 px-5 text-[13.5px] font-semibold text-white shadow-[0_10px_26px_rgba(217,38,22,0.3)] transition-all hover:-translate-y-0.5 hover:bg-brand-700"
        >
          Launch a run
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
        </button>
      }
    >
      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3" aria-label="Chapters">
        {WALKTHROUGH.map((ch, i) => {
          const Icon = ch.section ? SECTION_ICON[ch.section] : Library;
          return (
            <li key={`${ch.section ?? ch.href}-${i}`}>
              <button
                type="button"
                onClick={() => onTour(i)}
                aria-label={`Start the guided walkthrough — ${ch.title}`}
                className="group flex w-full items-center gap-3 rounded-xl border border-ink-100 bg-white px-4 py-3 text-left transition-colors hover:border-brand-500/60"
              >
                <span className="font-code text-[9px] font-bold tracking-[0.14em] text-brand-700">{String(i + 1).padStart(2, "0")}</span>
                <Icon className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-900">{ch.title}</span>
                {done.includes(i) ? (
                  <CircleCheck className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-label="Chapter toured" />
                ) : (
                  <Play className="h-3.5 w-3.5 shrink-0 text-ink-400 transition-colors group-hover:text-brand-600" aria-hidden="true" />
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-6 space-y-4 sm:mt-8 sm:space-y-6">
        {WALKTHROUGH.map((ch, i) => {
          const Icon = ch.section ? SECTION_ICON[ch.section] : Library;
          const no = String(i + 1).padStart(2, "0");
          return (
            <article
              key={`${ch.section ?? ch.href}-${i}`}
              id={`wt-${i + 1}`}
              className="scroll-mt-24 rounded-[12px] panel p-5 shadow-[0_1px_2px_rgba(11,12,15,0.04)] sm:p-7"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ink-950 text-white" aria-hidden="true">
                    <Icon className="h-4.5 w-4.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-code text-[8.5px] font-bold tracking-[0.22em] text-brand-700">
                      CHAPTER {no}
                      {done.includes(i) && (
                        <span className="inline-flex items-center gap-1 text-ink-400">
                          <CircleCheck className="h-3 w-3 text-brand-600" aria-hidden="true" />
                          TOURED
                        </span>
                      )}
                    </p>
                    <h3 className="mt-1 font-display text-[18px] font-black tracking-[-0.01em] text-ink-950 sm:text-[20px]">{ch.title}</h3>
                    <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-600">{ch.summary}</p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onTour(i)}
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-600 px-4 font-code text-[9px] font-bold tracking-[0.12em] text-white shadow-[0_8px_20px_rgba(217,38,22,0.24)] transition-all hover:-translate-y-0.5 hover:bg-brand-700"
                  >
                    <Play className="h-3 w-3" aria-hidden="true" />
                    START GUIDED TOUR
                  </button>
                  {ch.href ? (
                    <a
                      href={ch.href}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-200 px-3.5 font-code text-[9px] font-bold tracking-[0.12em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950"
                    >
                      OPEN DOCUMENTATION
                      <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => (ch.launch ? onNewRun() : ch.section && onOpen(ch.section))}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-200 px-3.5 font-code text-[9px] font-bold tracking-[0.12em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950"
                    >
                      {ch.launch
                        ? "LAUNCH AN EVALUATION"
                        : ch.section
                          ? `OPEN ${SECTION_LABEL[ch.section].toUpperCase()}`
                          : "OPEN"}
                      <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>

              <ol className="mt-5 space-y-2.5 border-t border-ink-100 pt-5">
                {ch.steps.map((step, s) => (
                  <li key={s} className="flex gap-3 text-[13px] leading-relaxed text-ink-700">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-ink-200 font-code text-[8px] font-bold text-ink-500">
                      {s + 1}
                    </span>
                    <span className="min-w-0">{step}</span>
                  </li>
                ))}
              </ol>

              <p className="mt-5 rounded-xl bg-paper px-4 py-3 text-[12.5px] leading-relaxed text-ink-600">
                <span className="mr-2 font-code text-[8.5px] font-bold tracking-[0.16em] text-brand-700">TIP</span>
                {ch.tip}
              </p>
            </article>
          );
        })}
      </div>
    </ViewShell>
  );
}

/* ── Supplier register — the platform's named bidders ──────────────────────
   The roll of firms the entity deals with, held on the quorum-mcp sidecar
   and written through with the same audit discipline as everything else:
   add, edit, suspend and remove are tool calls in the log, never silent. */

type SupplierRow = {
  id: string;
  name: string;
  registrationNo: string;
  taxPin?: string;
  taxClearanceNo?: string;
  taxClearanceExpiry?: string;
  regulator?: string;
  regulatorNo?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  categories: string[];
  status: "ACTIVE" | "SUSPENDED" | "BLACKLISTED";
  addedBy: string;
  createdAt: string;
  updatedAt?: string;
};

type SupplierStatus = SupplierRow["status"];

/* What a firm can be registered for — the categories a Zambian procurement
   file actually names. */
const SUPPLIER_CATEGORIES = [
  "Construction works",
  "Engineering services",
  "Medical supplies",
  "ICT equipment & services",
  "Transport & logistics",
  "Agriculture & agro-processing",
  "Consultancy services",
  "Office supplies & stationery",
  "Energy & electrification",
  "Water & sanitation",
  "Security services",
  "Cleaning & facilities",
] as const;

/* The sector regulators Zambian bidders register with, by category. */
const SUPPLIER_REGULATORS = ["NCC", "NHCC", "ERB", "ZPPA", "ZEMA", "Other"] as const;

const SUPPLIER_INPUT =
  "w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-[13px] text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-950 focus:ring-2 focus:ring-ink-950/10";

type SupplierDraft = {
  name: string;
  registrationNo: string;
  taxPin: string;
  taxClearanceNo: string;
  taxClearanceExpiry: string;
  regulator: string;
  regulatorNo: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  categories: string[];
};

const SUPPLIER_INTAKE_STEPS: {
  key: keyof SupplierDraft;
  section: string;
  prompt: string;
  hint?: string;
  placeholder?: string;
}[] = [
  { key: "name", section: "IDENTITY", prompt: "What is the supplier's registered name?", placeholder: "e.g. Kafubu Engineering Works Ltd" },
  { key: "registrationNo", section: "IDENTITY", prompt: "What is their registration number?", hint: "PACRA / Registrar of Societies number.", placeholder: "e.g. 120200012345" },
  { key: "taxPin", section: "COMPLIANCE", prompt: "What is their ZRA tax PIN?", placeholder: "e.g. 1000000000" },
  { key: "taxClearanceNo", section: "COMPLIANCE", prompt: "Do they have a tax clearance certificate?", placeholder: "Certificate number" },
  { key: "taxClearanceExpiry", section: "COMPLIANCE", prompt: "When does the tax clearance expire?", hint: "An expired certificate makes a bid non-responsive." },
  { key: "regulator", section: "COMPLIANCE", prompt: "Does their sector require a regulator?", hint: "Choose the regulator where the category requires registration." },
  { key: "regulatorNo", section: "COMPLIANCE", prompt: "What is their regulator registration number?", placeholder: "e.g. NCC/RS/2019/1187" },
  { key: "contactName", section: "CONTACT", prompt: "Who is the main contact?", placeholder: "Who signs for the firm" },
  { key: "email", section: "CONTACT", prompt: "What is their email address?", placeholder: "bids@supplier.co.zm" },
  { key: "phone", section: "CONTACT", prompt: "What is their phone number?", placeholder: "+260 …" },
  { key: "address", section: "CONTACT", prompt: "Where is the supplier based?", placeholder: "Plot, street, city" },
  { key: "categories", section: "CATEGORIES", prompt: "What does this supplier provide?", hint: "Select all that apply." },
];

const EMPTY_SUPPLIER_DRAFT: SupplierDraft = {
  name: "",
  registrationNo: "",
  taxPin: "",
  taxClearanceNo: "",
  taxClearanceExpiry: "",
  regulator: "",
  regulatorNo: "",
  contactName: "",
  email: "",
  phone: "",
  address: "",
  categories: [],
};

function draftFromSupplier(s: SupplierRow): SupplierDraft {
  return {
    name: s.name,
    registrationNo: s.registrationNo,
    taxPin: s.taxPin ?? "",
    taxClearanceNo: s.taxClearanceNo ?? "",
    taxClearanceExpiry: s.taxClearanceExpiry ?? "",
    regulator: s.regulator ?? "",
    regulatorNo: s.regulatorNo ?? "",
    contactName: s.contactName ?? "",
    email: s.email ?? "",
    phone: s.phone ?? "",
    address: s.address ?? "",
    categories: [...s.categories],
  };
}

function shortDateOf(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d
        .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        .toUpperCase();
}

/* A tax clearance certificate's standing today: valid, expiring soon, lapsed. */
function clearanceStanding(expiry?: string): { label: string; tone: string } | null {
  if (!expiry) return null;
  const t = new Date(`${expiry}T00:00:00`).getTime();
  if (Number.isNaN(t)) return null;
  const days = Math.ceil((t - Date.now()) / 86_400_000);
  if (days < 0) return { label: "CLEARANCE EXPIRED", tone: "border-brand-200 bg-brand-50 text-brand-800" };
  if (days <= 60)
    return { label: days === 0 ? "EXPIRES TODAY" : `EXPIRES IN ${days}D`, tone: "border-ink-200 bg-ink-100 text-ink-700" };
  return null;
}

function SupplierStatusChip({ status }: { status: SupplierStatus }) {
  const tone =
    status === "ACTIVE"
      ? "border-brand-200 bg-brand-50 text-brand-800"
      : status === "BLACKLISTED"
        ? "border-ink-950 bg-ink-950 text-white"
        : "border-ink-200 bg-white text-ink-600";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-code text-[8.5px] font-bold tracking-[0.16em]",
        tone,
      )}
    >
      {status === "ACTIVE" && <CircleCheck className="h-2.5 w-2.5" aria-hidden="true" />}
      {status}
    </span>
  );
}

function SupplierRowAction({
  children,
  onClick,
  tone = "default",
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: "default" | "confirm" | "danger";
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "rounded-md px-2 py-1 font-code text-[8px] font-bold tracking-[0.12em] transition-colors",
        tone === "confirm" ? "bg-brand-600 text-white hover:bg-brand-700" : "",
        tone === "danger" ? "text-brand-700 hover:bg-brand-50" : "",
        tone === "default" ? "text-ink-500 hover:bg-paper hover:text-ink-900" : "",
      )}
    >
      {children}
    </button>
  );
}

/* Polls the agent service's supplier store — the platform's single source of
   truth for named bidders. Nothing is invented on the client. */
function useSuppliers() {
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [reachable, setReachable] = useState<boolean | null>(null);

  const pull = useCallback(async () => {
    try {
      const res = await fetch("/api/suppliers?XTransformPort=3031");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { suppliers?: SupplierRow[] };
      setSuppliers(d.suppliers ?? []);
      setReachable(true);
    } catch {
      setReachable(false);
    }
  }, []);

  useEffect(() => {
    void pull();
    const id = setInterval(() => void pull(), 6000);
    return () => clearInterval(id);
  }, [pull]);

  return { suppliers, reachable, reload: pull };
}

function SupplierField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block font-code text-[8px] font-semibold tracking-[0.2em] text-ink-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10.5px] leading-snug text-ink-400">{hint}</span>}
    </label>
  );
}

/* The registration dossier — the same fields on the intake card and in the
   edit dialog, because an edit is just the dossier, re-read. */
function SupplierFormFields({
  idPrefix,
  draft,
  onChange,
}: {
  idPrefix: string;
  draft: SupplierDraft;
  onChange: (d: SupplierDraft) => void;
}) {
  const set = <K extends keyof SupplierDraft>(k: K, v: SupplierDraft[K]) => onChange({ ...draft, [k]: v });
  const toggleCategory = (c: string) =>
    set(
      "categories",
      draft.categories.includes(c) ? draft.categories.filter((x) => x !== c) : [...draft.categories, c],
    );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SupplierField label="SUPPLIER NAME">
          <input
            id={`${idPrefix}-name`}
            className={SUPPLIER_INPUT}
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Kafubu Engineering Works Ltd"
            autoComplete="organization"
          />
        </SupplierField>
        <SupplierField label="REGISTRATION NUMBER" hint="PACRA / Registrar of Societies number.">
          <input
            className={SUPPLIER_INPUT}
            value={draft.registrationNo}
            onChange={(e) => set("registrationNo", e.target.value)}
            placeholder="e.g. 120200012345"
          />
        </SupplierField>
        <SupplierField label="ZRA TAX PIN">
          <input
            className={SUPPLIER_INPUT}
            value={draft.taxPin}
            onChange={(e) => set("taxPin", e.target.value)}
            placeholder="e.g. 1000000000"
            inputMode="numeric"
          />
        </SupplierField>
        <SupplierField label="ZRA TAX CLEARANCE NO">
          <input
            className={SUPPLIER_INPUT}
            value={draft.taxClearanceNo}
            onChange={(e) => set("taxClearanceNo", e.target.value)}
            placeholder="Certificate number"
          />
        </SupplierField>
        <SupplierField label="TAX CLEARANCE EXPIRY" hint="An expired certificate makes a bid non-responsive.">
          <input
            type="date"
            className={SUPPLIER_INPUT}
            value={draft.taxClearanceExpiry}
            onChange={(e) => set("taxClearanceExpiry", e.target.value)}
          />
        </SupplierField>
        <SupplierField label="SECTOR REGULATOR" hint="Where the category requires registration.">
          <select
            className={SUPPLIER_INPUT}
            value={draft.regulator}
            onChange={(e) => set("regulator", e.target.value)}
          >
            <option value="">— none required —</option>
            {SUPPLIER_REGULATORS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </SupplierField>
        <SupplierField label="REGULATOR REGISTRATION NO">
          <input
            className={SUPPLIER_INPUT}
            value={draft.regulatorNo}
            onChange={(e) => set("regulatorNo", e.target.value)}
            placeholder="e.g. NCC/RS/2019/1187"
          />
        </SupplierField>
        <SupplierField label="CONTACT NAME">
          <input
            className={SUPPLIER_INPUT}
            value={draft.contactName}
            onChange={(e) => set("contactName", e.target.value)}
            placeholder="Who signs for the firm"
            autoComplete="name"
          />
        </SupplierField>
        <SupplierField label="EMAIL">
          <input
            type="email"
            className={SUPPLIER_INPUT}
            value={draft.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="bids@supplier.co.zm"
            autoComplete="email"
          />
        </SupplierField>
        <SupplierField label="PHONE">
          <input
            type="tel"
            className={SUPPLIER_INPUT}
            value={draft.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="+260 …"
            autoComplete="tel"
          />
        </SupplierField>
        <div className="sm:col-span-2">
          <SupplierField label="ADDRESS">
            <input
              className={SUPPLIER_INPUT}
              value={draft.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="Plot, street, city"
            />
          </SupplierField>
        </div>
      </div>

      <div>
        <p className="mb-2 font-code text-[8px] font-semibold tracking-[0.2em] text-ink-400">SUPPLY CATEGORIES</p>
        <div className="flex flex-wrap gap-1.5">
          {SUPPLIER_CATEGORIES.map((c) => {
            const on = draft.categories.includes(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => toggleCategory(c)}
                className={cn(
                  "rounded-full border px-3 py-1.5 font-code text-[8.5px] font-semibold tracking-[0.1em] transition-colors",
                  on
                    ? "border-ink-950 bg-ink-950 text-white"
                    : "border-ink-200 bg-white text-ink-500 hover:border-ink-400 hover:text-ink-800",
                )}
              >
                {c.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* Sidecar refusals arrive as {"error": …} — surface them verbatim when present. */
async function sidecarError(res: Response, fallback: string) {
  try {
    const d = (await res.json()) as { error?: string };
    if (d.error) return d.error.charAt(0).toUpperCase() + d.error.slice(1);
  } catch {
    /* non-JSON body — fall through */
  }
  return fallback;
}

/* ── The ZPPA roll — the published e-GP record, read in at intake ──────────
   The Zambia e-GP record (ZPPA, published through the Open Contracting
   Partnership) lists tens of thousands of firms with their PACRA numbers.
   The sidecar ships a derived roll of the most awarded among them; picking
   one fills the intake from what the record already knows — it never invents
   a field, and every field stays the officer's to correct. */

type ZppaRollEntry = {
  name: string;
  regNo: string;
  address?: string;
  phone?: string;
  tenders: number;
  awards: number;
  valueZMW?: number;
  since?: number;
  categories: string[];
  latest?: { kind: "award" | "tender"; title: string; buyer: string; date: string };
};

type ZppaSource = {
  authority: string;
  via: string;
  license: string;
  retrieved: string;
  coverage: string;
  note: string;
};

const PLURAL = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function AddSupplierModal({
  open,
  firstName,
  existing,
  onClose,
  onRegistered,
}: {
  open: boolean;
  firstName: string;
  existing: SupplierRow[];
  onClose: () => void;
  onRegistered: (name: string) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<SupplierDraft>(EMPTY_SUPPLIER_DRAFT);
  const [activeStep, setActiveStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [roll, setRoll] = useState<{ source: ZppaSource; entries: ZppaRollEntry[] } | null>(null);
  const [rollLoading, setRollLoading] = useState(false);
  const [rollFailed, setRollFailed] = useState(false);
  const [rollOpen, setRollOpen] = useState(false);
  const [rollQuery, setRollQuery] = useState("");
  const [picked, setPicked] = useState<ZppaRollEntry | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);
  const existingRef = useRef(existing);
  existingRef.current = existing;

  /* A fresh intake every time the modal opens — never mid-edit. */
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true;
      setDraft(EMPTY_SUPPLIER_DRAFT);
      setActiveStep(0);
      setError("");
      setPicked(null);
      setRollQuery("");
      setBusy(false);
      setRollOpen(false);
    } else if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
    }
  }, [open]);

  /* The roll is read off the sidecar the first time the modal opens. */
  const loadRoll = useCallback(() => {
    setRollLoading(true);
    setRollFailed(false);
    fetch("/api/zppa-roll?XTransformPort=3031")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ source?: ZppaSource; roll?: ZppaRollEntry[] }>;
      })
      .then((d) => {
        if (!d.roll || !d.source) throw new Error("empty payload");
        setRoll({ source: d.source, entries: d.roll });
      })
      .catch(() => setRollFailed(true))
      .finally(() => setRollLoading(false));
  }, []);

  useEffect(() => {
    if (open && !roll && !rollLoading && !rollFailed) loadRoll();
  }, [open, roll, rollLoading, rollFailed, loadRoll]);

  /* Focus the single field on the active intake screen. */
  useEffect(() => {
    if (!open) return;
    const current = SUPPLIER_INTAKE_STEPS[activeStep];
    const t = setTimeout(() => {
      document.getElementById(`add-${current.key}`)?.focus();
    }, 90);
    return () => clearTimeout(t);
  }, [open, activeStep]);

  /* Escape closes — nothing closes while a write is in flight. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  /* Tab stays inside the dialog. */
  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const nodes = Array.from(
      cardRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !cardRef.current?.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const alreadyOn = (e: ZppaRollEntry) => {
    const reg = e.regNo.replace(/\D/g, "");
    return existing.some(
      (s) =>
        (reg !== "" && s.registrationNo.replace(/\D/g, "") === reg) ||
        s.name.trim().toUpperCase() === e.name.trim().toUpperCase(),
    );
  };

  const applyRoll = (e: ZppaRollEntry) => {
    setDraft((d) => ({
      ...d,
      name: e.name,
      registrationNo: e.regNo,
      address: d.address.trim() ? d.address : e.address ?? "",
      phone: d.phone.trim() ? d.phone : e.phone ?? "",
      categories: Array.from(new Set([...d.categories, ...e.categories])),
    }));
    setPicked(e);
    setRollOpen(false);
    cardRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const register = async () => {
    if (!draft.name.trim() || !draft.registrationNo.trim()) {
      setError("A supplier needs at least a name and a registration number.");
      setActiveStep(draft.name.trim() ? 1 : 0);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/suppliers?XTransformPort=3031", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...draft, addedBy: firstName || "unknown" }),
      });
      if (!res.ok) {
        setError(await sidecarError(res, `The register refused the entry (HTTP ${res.status}).`));
        return;
      }
      const name = draft.name.trim();
      await onRegistered(name);
      onClose();
    } catch {
      setError("The sidecar is offline — suppliers cannot be written right now.");
    } finally {
      setBusy(false);
    }
  };

  const q = rollQuery.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!roll) return [];
    const base = q ? roll.entries.filter((e) => `${e.name} ${e.regNo}`.toLowerCase().includes(q)) : roll.entries;
    return base.slice(0, 40);
  }, [roll, q]);
  const currentStep = SUPPLIER_INTAKE_STEPS[activeStep];
  const updateDraft = <K extends keyof SupplierDraft>(key: K, value: SupplierDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const advanceStep = () => {
    if (currentStep.key === "name" && !draft.name.trim()) {
      setError("Enter the supplier's registered name to continue.");
      return;
    }
    if (currentStep.key === "registrationNo" && !draft.registrationNo.trim()) {
      setError("Enter a registration number to continue.");
      return;
    }
    setError("");
    setActiveStep((step) => Math.min(step + 1, SUPPLIER_INTAKE_STEPS.length - 1));
  };
  const goBack = () => {
    setError("");
    setActiveStep((step) => Math.max(step - 1, 0));
  };
  const handleStepKeyDown = (e: ReactKeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      advanceStep();
    }
  };
  const renderStepField = () => {
    if (currentStep.key === "categories") {
      return (
        <div
          id="add-categories"
          tabIndex={-1}
          className="flex flex-wrap gap-2 outline-none"
          aria-label="Supplier categories"
        >
          {SUPPLIER_CATEGORIES.map((category) => {
            const selected = draft.categories.includes(category);
            return (
              <button
                key={category}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  updateDraft(
                    "categories",
                    selected
                      ? draft.categories.filter((item) => item !== category)
                      : [...draft.categories, category],
                  )
                }
                className={cn(
                  "rounded-full border px-3.5 py-2 font-code text-[9px] font-semibold tracking-[0.1em] transition-colors",
                  selected
                    ? "border-ink-950 bg-ink-950 text-white"
                    : "border-ink-200 bg-white text-ink-500 hover:border-ink-400 hover:text-ink-800",
                )}
              >
                {category.toUpperCase()}
              </button>
            );
          })}
        </div>
      );
    }

    if (currentStep.key === "regulator") {
      return (
        <select
          id="add-regulator"
          className={SUPPLIER_INPUT}
          value={draft.regulator}
          onChange={(e) => updateDraft("regulator", e.target.value)}
          onKeyDown={handleStepKeyDown}
        >
          <option value="">— none required —</option>
          {SUPPLIER_REGULATORS.map((regulator) => (
            <option key={regulator} value={regulator}>{regulator}</option>
          ))}
        </select>
      );
    }

    const type = currentStep.key === "taxClearanceExpiry"
      ? "date"
      : currentStep.key === "email"
        ? "email"
        : currentStep.key === "phone"
          ? "tel"
          : "text";
    const inputMode = currentStep.key === "taxPin" ? "numeric" : undefined;
    const autoComplete =
      currentStep.key === "name" ? "organization"
        : currentStep.key === "contactName" ? "name"
          : currentStep.key === "email" ? "email"
            : currentStep.key === "phone" ? "tel"
              : undefined;

    return (
      <input
        id={`add-${currentStep.key}`}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        className={`${SUPPLIER_INPUT} py-3.5 text-[15px] sm:py-4 sm:text-base`}
        value={draft[currentStep.key]}
        onChange={(e) => updateDraft(currentStep.key, e.target.value)}
        onKeyDown={handleStepKeyDown}
        placeholder={currentStep.placeholder}
        aria-label={currentStep.prompt}
      />
    );
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="supplier-add"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[70] grid place-items-center bg-night/70 p-4 backdrop-blur-sm"
          onClick={() => {
            if (!busy) onClose();
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-supplier-title"
        >
          <motion.div
            ref={cardRef}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.28, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={trapTab}
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[12px] panel panel-lift p-5 sm:p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-code text-[8px] font-semibold tracking-[0.24em] text-ink-400">INTAKE</p>
                <h3 id="add-supplier-title" className="mt-1 font-display text-[22px] font-black tracking-[-0.015em] text-ink-950">
                  Add supplier
                </h3>
                <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-ink-500">
                  One detail at a time. Only the supplier name and registration number are required.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!busy) onClose();
                }}
                aria-label="Close without adding"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-paper hover:text-ink-900"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-6" aria-label="Supplier intake progress">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="font-code text-[8px] font-bold tracking-[0.18em] text-brand-700">
                  {currentStep.section}
                </span>
                <span className="font-code text-[8px] tracking-[0.14em] text-ink-400">
                  {String(activeStep + 1).padStart(2, "0")} / {String(SUPPLIER_INTAKE_STEPS.length).padStart(2, "0")}
                </span>
              </div>
              <div
                className="flex gap-1"
                role="progressbar"
                aria-label="Supplier intake progress"
                aria-valuemin={1}
                aria-valuemax={SUPPLIER_INTAKE_STEPS.length}
                aria-valuenow={activeStep + 1}
              >
                {SUPPLIER_INTAKE_STEPS.map((step, index) => (
                  <span
                    key={step.key}
                    className={cn(
                      "h-1 flex-1 rounded-full transition-colors",
                      index <= activeStep ? "bg-brand-600" : "bg-ink-100",
                    )}
                  />
                ))}
              </div>
            </div>

            {/* The published ZPPA record, offered as a head start */}
            {activeStep === 0 && (
            <div className="mt-5 rounded-[10px] border border-ink-100 bg-paper/70">
              <button
                type="button"
                onClick={() => setRollOpen((v) => !v)}
                aria-expanded={rollOpen}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink-950 text-white">
                  <Library className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-code text-[9px] font-bold tracking-[0.18em] text-ink-900">
                    PICK FROM THE ZPPA RECORD
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-500">
                    {roll
                      ? `${roll.entries.length} firms ranked by awards on the published e-GP record — name, PACRA number, address and contact fill the form.`
                      : "The published Zambia e-GP record, read in at intake."}
                  </span>
                </span>
                <ChevronDown
                  className={cn("h-4 w-4 shrink-0 text-ink-400 transition-transform", rollOpen && "rotate-180")}
                  aria-hidden="true"
                />
              </button>

              {rollOpen && (
                <div className="border-t border-ink-100 px-4 pb-3.5 pt-3">
                  {rollLoading && (
                    <p className="py-4 text-center font-code text-[8.5px] tracking-[0.18em] text-ink-400">
                      READING THE RECORD…
                    </p>
                  )}

                  {rollFailed && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-200 bg-white px-3.5 py-3">
                      <p className="text-[12px] leading-relaxed text-ink-500">
                        The record could not be reached — the form still works; write the firm in by hand.
                      </p>
                      <button
                        type="button"
                        onClick={loadRoll}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 font-code text-[8px] font-bold tracking-[0.16em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950"
                      >
                        <RefreshCw className="h-3 w-3" aria-hidden="true" />
                        RETRY
                      </button>
                    </div>
                  )}

                  {roll && (
                    <>
                      <label className="relative block">
                        <Search
                          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400"
                          aria-hidden="true"
                        />
                        <input
                          type="search"
                          value={rollQuery}
                          onChange={(e) => setRollQuery(e.target.value)}
                          placeholder="Search by firm or PACRA number…"
                          aria-label="Search the ZPPA record"
                          className="h-9 w-full rounded-xl border border-ink-200 bg-white pl-9 pr-3 text-[12.5px] text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-950 focus:ring-2 focus:ring-ink-950/10"
                        />
                      </label>

                      <ul className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-ink-100 bg-white">
                        {shown.map((e) => {
                          const on = alreadyOn(e);
                          return (
                            <li key={e.regNo} className="border-b border-ink-100 last:border-b-0">
                              <button
                                type="button"
                                disabled={on}
                                onClick={() => applyRoll(e)}
                                className={cn(
                                  "flex w-full items-start justify-between gap-3 px-3.5 py-2.5 text-left transition-colors",
                                  on ? "cursor-default opacity-60" : "hover:bg-paper",
                                )}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-[12.5px] font-semibold text-ink-900">{e.name}</span>
                                  <span className="mt-0.5 block font-code text-[8px] tracking-[0.14em] text-ink-400">
                                    PACRA {e.regNo} · {PLURAL(e.awards, "AWARD", "AWARDS")} · {PLURAL(e.tenders, "TENDER", "TENDERS")}
                                    {e.since ? ` · ON RECORD SINCE ${e.since}` : ""}
                                  </span>
                                </span>
                                {on ? (
                                  <span className="mt-0.5 inline-flex shrink-0 rounded-full border border-ink-200 bg-paper px-2 py-0.5 font-code text-[7.5px] font-bold tracking-[0.12em] text-ink-500">
                                    ALREADY ON FILE
                                  </span>
                                ) : (
                                  <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 font-code text-[7.5px] font-bold tracking-[0.12em] text-brand-700">
                                    USE
                                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                                  </span>
                                )}
                              </button>
                            </li>
                          );
                        })}
                        {shown.length === 0 && (
                          <li className="px-3.5 py-4 text-center text-[12px] text-ink-400">
                            No firm on the roll matches — write it in by hand.
                          </li>
                        )}
                      </ul>

                      <p className="mt-2 font-code text-[7.5px] leading-[1.9] tracking-[0.14em] text-ink-400">
                        SOURCE — {roll.source.authority.toUpperCase()} · VIA OPEN CONTRACTING PARTNERSHIP ·{" "}
                        {roll.source.license}
                        <br />
                        RECORD COVERAGE {roll.source.coverage} · RETRIEVED {roll.source.retrieved}
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
            )}

            {/* What the record already knew — still every field the officer's */}
            {picked && (
              <div className="mt-4 rounded-xl border border-ink-100 border-l-2 border-l-brand-600 bg-paper px-4 py-3">
                <p className="font-code text-[8.5px] font-bold tracking-[0.16em] text-ink-900">
                  FILLED FROM THE ZPPA RECORD
                </p>
                <p className="mt-1 font-code text-[8px] tracking-[0.14em] text-ink-600">
                  {PLURAL(picked.awards, "AWARD", "AWARDS")} · {PLURAL(picked.tenders, "TENDER", "TENDERS")}
                  {picked.valueZMW ? ` · ZMW ${picked.valueZMW.toLocaleString("en-GB")} WON` : ""}
                  {picked.since ? ` · ON RECORD SINCE ${picked.since}` : ""}
                </p>
                {picked.latest && (
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-600">
                    LAST {picked.latest.kind === "award" ? "AWARD" : "BID"} — {picked.latest.title} → {picked.latest.buyer} ·{" "}
                    {shortDateOf(picked.latest.date)}
                  </p>
                )}
                <p className="mt-1.5 font-code text-[7.5px] leading-[1.9] tracking-[0.14em] text-ink-400">
                  EVERY FIELD IS STILL YOURS TO CORRECT — THE RECORD SUGGESTS, THE OFFICER CONFIRMS.
                </p>
              </div>
            )}

            <AnimatePresence mode="wait" initial={false}>
            <motion.section
              key={currentStep.key}
              initial={{ opacity: 0, x: 18 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -18 }}
              transition={{ duration: 0.18, ease: EASE }}
              aria-live="polite"
              className="mt-7 min-h-[190px]"
            >
              <p className="font-code text-[8px] font-semibold tracking-[0.2em] text-ink-400">
                {currentStep.section} · QUESTION {String(activeStep + 1).padStart(2, "0")}
              </p>
              <h4 className="mt-2 font-display text-[21px] font-black tracking-[-0.02em] text-ink-950 sm:text-[25px]">
                {currentStep.prompt}
                {(currentStep.key === "name" || currentStep.key === "registrationNo") && (
                  <span className="ml-1 text-brand-600" aria-label="required">*</span>
                )}
              </h4>
              {currentStep.hint && (
                <p className="mt-1.5 text-[12px] leading-relaxed text-ink-500">{currentStep.hint}</p>
              )}
              <div className="mt-6 max-w-2xl">
                {renderStepField()}
              </div>
            </motion.section>
            </AnimatePresence>

            {error && (
              <p
                role="alert"
                className="mt-4 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-brand-800"
              >
                {error}
              </p>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-5">
            <p className="max-w-[220px] font-code text-[7.5px] leading-[2] tracking-[0.16em] text-ink-400 sm:max-w-none">
              WRITTEN VIA quorum-mcp · {(firstName || "unknown").toUpperCase()} IS THE RECORDED ACTOR
            </p>
            <div className="ml-auto flex items-center gap-2">
              {activeStep > 0 && (
                <button
                  type="button"
                  onClick={goBack}
                  disabled={busy}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 font-code text-[9px] font-bold tracking-[0.14em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950 disabled:opacity-60"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  BACK
                </button>
              )}
              {activeStep < SUPPLIER_INTAKE_STEPS.length - 1 ? (
                <>
                  {currentStep.key !== "name" && currentStep.key !== "registrationNo" && (
                    <button
                      type="button"
                      onClick={advanceStep}
                      disabled={busy}
                      className="inline-flex h-10 items-center rounded-xl px-3 font-code text-[8px] font-bold tracking-[0.12em] text-ink-500 transition-colors hover:text-ink-950 disabled:opacity-60"
                    >
                      SKIP
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={advanceStep}
                    disabled={busy}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-600 px-5 font-code text-[9px] font-bold tracking-[0.14em] text-white shadow-[0_10px_26px_rgba(217,38,22,0.28)] transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    CONTINUE
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void register()}
                  disabled={busy}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-600 px-5 text-[13px] font-semibold text-white shadow-[0_10px_26px_rgba(217,38,22,0.28)] transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  {busy ? "Writing to the register…" : "Add supplier"}
                </button>
              )}
            </div>
            </div>

          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SuppliersView({ firstName, onToast }: { firstName: string; onToast: (m: string) => void }) {
  const { suppliers, reachable, reload } = useSuppliers();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | SupplierStatus>("ALL");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierRow | null>(null);
  const [editDraft, setEditDraft] = useState<SupplierDraft>(EMPTY_SUPPLIER_DRAFT);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      suppliers.filter((s) => {
        if (statusFilter !== "ALL" && s.status !== statusFilter) return false;
        if (!q) return true;
        return [
          s.name,
          s.registrationNo,
          s.taxPin,
          s.taxClearanceNo,
          s.regulator,
          s.regulatorNo,
          s.email,
          s.phone,
          s.contactName,
          s.categories.join(" "),
        ]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      }),
    [suppliers, statusFilter, q],
  );

  const counts = useMemo(
    () => ({
      total: suppliers.length,
      active: suppliers.filter((s) => s.status === "ACTIVE").length,
      suspended: suppliers.filter((s) => s.status === "SUSPENDED").length,
      blacklisted: suppliers.filter((s) => s.status === "BLACKLISTED").length,
    }),
    [suppliers],
  );

  /* Escape closes the edit dialog; nothing closes while a write is in flight. */
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editBusy) setEditing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, editBusy]);

  /* The intake is a modal over the roll — opened from the header or the
     empty state; focus returns to whatever opened it when it closes. */
  const openAdd = () => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAddOpen(true);
  };

  const closeAdd = () => {
    setAddOpen(false);
    requestAnimationFrame(() => openerRef.current?.focus());
  };

  const openEdit = (s: SupplierRow) => {
    setEditing(s);
    setEditDraft(draftFromSupplier(s));
    setEditError("");
    setConfirmDelete(null);
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (!editDraft.name.trim() || !editDraft.registrationNo.trim()) {
      setEditError("A supplier needs at least a name and a registration number.");
      return;
    }
    setEditBusy(true);
    setEditError("");
    try {
      const res = await fetch(`/api/suppliers/${editing.id}?XTransformPort=3031`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...editDraft, actor: firstName || "unknown" }),
      });
      if (!res.ok) {
        setEditError(await sidecarError(res, `The register refused the change (HTTP ${res.status}).`));
        return;
      }
      const name = editDraft.name.trim();
      setEditing(null);
      await reload();
      onToast(`REGISTER UPDATED — ${name.toUpperCase()} · CHANGES WRITTEN TO THE AUDIT TRAIL`);
    } catch {
      setEditError("The sidecar is offline — the change was not written.");
    } finally {
      setEditBusy(false);
    }
  };

  const changeStatus = async (s: SupplierRow, status: SupplierStatus) => {
    try {
      const res = await fetch(`/api/suppliers/${s.id}?XTransformPort=3031`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, actor: firstName || "unknown" }),
      });
      if (!res.ok) {
        onToast((await sidecarError(res, "CHANGE NOT WRITTEN")).toUpperCase());
        return;
      }
      await reload();
      onToast(
        status === "ACTIVE"
          ? `SUPPLIER REINSTATED — ${s.name.toUpperCase()}`
          : `SUPPLIER ${status} — ${s.name.toUpperCase()}`,
      );
    } catch {
      onToast("CHANGE NOT WRITTEN — quorum-mcp NOT RESPONDING");
    }
  };

  const removeSupplier = async (s: SupplierRow) => {
    try {
      const res = await fetch(`/api/suppliers/${s.id}?XTransformPort=3031`, {
        method: "DELETE",
        headers: { "x-quorum-actor": firstName || "unknown" },
      });
      if (!res.ok) {
        onToast((await sidecarError(res, "REMOVAL NOT WRITTEN")).toUpperCase());
        return;
      }
      setConfirmDelete(null);
      await reload();
      onToast(`SUPPLIER REMOVED — ${s.name.toUpperCase()} · REMOVAL LOGGED`);
    } catch {
      onToast("REMOVAL NOT WRITTEN — quorum-mcp NOT RESPONDING");
    }
  };

  const statusTabs: { id: "ALL" | SupplierStatus; label: string; n: number }[] = [
    { id: "ALL", label: "ALL", n: counts.total },
    { id: "ACTIVE", label: "ACTIVE", n: counts.active },
    { id: "SUSPENDED", label: "SUSPENDED", n: counts.suspended },
    { id: "BLACKLISTED", label: "BLACKLISTED", n: counts.blacklisted },
  ];

  return (
    <ViewShell
      fig="16"
      title="Suppliers"
      sub="Every bidder the platform knows — held with the registration detail Zambia's regime asks a bidder to carry: PACRA number, ZRA tax clearance, sector registration. The agent reads this roll when it checks a bid; you keep it true. New entries can start straight off the published ZPPA e-GP record."
      action={
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1.5 font-code text-[8px] font-semibold tracking-[0.18em] text-ink-600">
            <span className="relative flex h-1.5 w-1.5">
              {reachable === true && (
                <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" aria-hidden="true" />
              )}
              <span
                className={cn(
                  "relative inline-flex h-1.5 w-1.5 rounded-full",
                  reachable === true && "bg-brand-600",
                  reachable === false && "bg-ink-400",
                  reachable === null && "animate-pulse bg-ink-300",
                )}
                aria-hidden="true"
              />
            </span>
            {reachable === null ? "LINKING" : reachable ? "REGISTER LINKED" : "REGISTER OFFLINE"}
          </span>
          <button
            type="button"
            data-tour="suppliers-add"
            onClick={openAdd}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-600 px-4 font-code text-[9px] font-bold tracking-[0.18em] text-white shadow-[0_10px_26px_rgba(217,38,22,0.28)] transition-colors hover:bg-brand-700"
          >
            <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
            REGISTER A SUPPLIER
          </button>
        </div>
      }
    >
      <div className="space-y-4 sm:space-y-6">
        {/* The roll — given the full width of the workspace so every column shows */}
        <div className="min-w-0">
          <div data-tour="suppliers-roll" className="overflow-hidden rounded-[12px] panel shadow-[0_1px_2px_rgba(11,12,15,0.04)]">
            <header className="border-b border-ink-100 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-[17px] font-black tracking-[-0.01em] text-ink-950">On the list</h2>
                  <p className="mt-0.5 font-code text-[8.5px] tracking-[0.2em] text-ink-400">
                    {counts.total} SUPPLIER{counts.total === 1 ? "" : "S"} · {filtered.length} SHOWN
                  </p>
                </div>
                <label className="relative block">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Name, TIN, registration…"
                    aria-label="Search suppliers"
                    className="h-9 w-52 rounded-full border border-ink-200 bg-paper pl-9 pr-3 text-[12.5px] text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-950 focus:ring-2 focus:ring-ink-950/10"
                  />
                </label>
              </div>
              <div data-tour="suppliers-filters" className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by status">
                {statusTabs.map((t) => {
                  const on = statusFilter === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setStatusFilter(t.id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-code text-[8px] font-bold tracking-[0.14em] transition-colors",
                        on
                          ? "border-ink-950 bg-ink-950 text-white"
                          : "border-ink-200 bg-white text-ink-500 hover:border-ink-400 hover:text-ink-800",
                      )}
                    >
                      {t.label}
                      <span className={cn("tabular", on ? "text-brand-400" : "text-ink-400")}>{t.n}</span>
                    </button>
                  );
                })}
              </div>
            </header>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] border-collapse text-left" aria-label="Supplier register">
                <thead>
                  <tr className="border-b border-ink-100 bg-paper">
                    {["SUPPLIER", "ZRA TAX", "SECTOR REGISTRATION", "CONTACT", "STATUS", "ACTIONS"].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className={cn(
                          "px-5 py-3 font-code text-[8px] font-bold tracking-[0.18em] text-ink-500",
                          h === "ACTIONS" && "text-right",
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => {
                    const standing = clearanceStanding(s.taxClearanceExpiry);
                    return (
                      <tr key={s.id} className="border-b border-ink-100 last:border-b-0 hover:bg-paper/60">
                        <td className="px-5 py-4 align-top">
                          <p className="text-[13.5px] font-semibold leading-snug text-ink-950">{s.name}</p>
                          <p className="mt-1 font-code text-[8.5px] tracking-[0.14em] text-ink-400">
                            REG {s.registrationNo}
                          </p>
                          <p className="mt-1 font-code text-[7.5px] tracking-[0.14em] text-ink-400">
                            ADDED BY {(s.addedBy || "—").toUpperCase()} · {shortDateOf(s.createdAt)}
                          </p>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <p className="font-code text-[9px] tracking-[0.12em] text-ink-600">
                            PIN {s.taxPin || "—"}
                          </p>
                          <p className="mt-1 font-code text-[9px] tracking-[0.12em] text-ink-600">
                            TC {s.taxClearanceNo || "—"}
                          </p>
                          {s.taxClearanceExpiry && (
                            <p className="mt-1 font-code text-[8px] tracking-[0.12em] text-ink-400">
                              EXP {shortDateOf(s.taxClearanceExpiry)}
                            </p>
                          )}
                          {standing && (
                            <span
                              className={cn(
                                "mt-1.5 inline-flex rounded-full border px-2 py-0.5 font-code text-[7.5px] font-bold tracking-[0.12em]",
                                standing.tone,
                              )}
                            >
                              {standing.label}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4 align-top">
                          <p className="font-code text-[9px] tracking-[0.12em] text-ink-600">
                            {s.regulator ? `${s.regulator} · ${s.regulatorNo || "—"}` : "NOT REQUIRED"}
                          </p>
                          {s.categories.length > 0 && (
                            <div className="mt-1.5 flex max-w-[220px] flex-wrap gap-1">
                              {s.categories.map((c) => (
                                <span
                                  key={c}
                                  className="rounded-full border border-ink-200 bg-white px-2 py-0.5 font-code text-[7.5px] tracking-[0.08em] text-ink-500"
                                >
                                  {c.toUpperCase()}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-4 align-top">
                          <p className="text-[12px] font-medium text-ink-800">{s.contactName || "—"}</p>
                          <p className="mt-1 text-[11px] text-ink-500">{s.email || "—"}</p>
                          <p className="mt-0.5 font-code text-[9px] tracking-[0.08em] text-ink-500">{s.phone || "—"}</p>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <SupplierStatusChip status={s.status} />
                        </td>
                        <td className="px-5 py-4 align-top">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEdit(s)}
                              title={`Edit ${s.name}`}
                              aria-label={`Edit ${s.name}`}
                              className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-paper hover:text-ink-900"
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            {s.status === "ACTIVE" ? (
                              <SupplierRowAction onClick={() => void changeStatus(s, "SUSPENDED")} title="Suspend pending resolution">
                                SUSPEND
                              </SupplierRowAction>
                            ) : (
                              <SupplierRowAction onClick={() => void changeStatus(s, "ACTIVE")} title="Return to active">
                                {s.status === "BLACKLISTED" ? "REINSTATE" : "REACTIVATE"}
                              </SupplierRowAction>
                            )}
                            {s.status !== "BLACKLISTED" && (
                              <SupplierRowAction tone="danger" onClick={() => void changeStatus(s, "BLACKLISTED")} title="Exclude this firm">
                                BLACKLIST
                              </SupplierRowAction>
                            )}
                            {confirmDelete === s.id ? (
                              <>
                                <SupplierRowAction tone="confirm" onClick={() => void removeSupplier(s)} title="Confirm removal">
                                  CONFIRM
                                </SupplierRowAction>
                                <SupplierRowAction onClick={() => setConfirmDelete(null)} title="Keep this supplier">
                                  CANCEL
                                </SupplierRowAction>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDelete(s.id)}
                                title={`Remove ${s.name}`}
                                aria-label={`Remove ${s.name}`}
                                className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-brand-50 hover:text-brand-700"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center">
                        <p className="font-display text-[15px] font-black tracking-[-0.01em] text-ink-900">
                          {suppliers.length === 0 ? "No suppliers on the register yet" : "Nothing matches this filter"}
                        </p>
                        <p className="mx-auto mt-2 max-w-md text-[12.5px] leading-relaxed text-ink-500">
                          {suppliers.length === 0
                            ? "Register the firms your entity deals with — or pull one straight off the published ZPPA record; the intake fills itself. The agent reads this roll when it checks bids."
                            : "Clear the search or switch the status filter to see the rest of the roll."}
                        </p>
                        {suppliers.length === 0 && (
                          <button
                            type="button"
                            onClick={openAdd}
                            className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 font-code text-[8.5px] font-bold tracking-[0.16em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950"
                          >
                            <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                            ADD THE FIRST SUPPLIER
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <p className="mt-3 font-code text-[8px] tracking-[0.18em] text-ink-400">
            EVERY ADD, EDIT, SUSPENSION AND REMOVAL IS APPENDED TO THE AUDIT TRAIL — THE REGISTER IS NEVER SILENT.
          </p>
        </div>

      </div>

      <AddSupplierModal
        open={addOpen}
        firstName={firstName}
        existing={suppliers}
        onClose={closeAdd}
        onRegistered={async (name) => {
          await reload();
          onToast(`SUPPLIER REGISTERED — ${name.toUpperCase()} ADDED TO THE PLATFORM REGISTER`);
        }}
      />

      {/* Edit dialog — the dossier, re-read and corrected */}
      <AnimatePresence>
        {editing && (
          <motion.div
            key="supplier-edit"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[70] grid place-items-center bg-night/70 p-4 backdrop-blur-sm"
            onClick={() => {
              if (!editBusy) setEditing(null);
            }}
            role="dialog"
            aria-modal="true"
            aria-label={`Edit ${editing.name}`}
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.28, ease: EASE }}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-[12px] panel panel-lift p-5 sm:p-7"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-code text-[8px] font-semibold tracking-[0.24em] text-ink-400">EDIT SUPPLIER</p>
                  <h3 className="mt-1 truncate font-display text-[20px] font-black tracking-[-0.015em] text-ink-950">
                    {editing.name}
                  </h3>
                  <p className="mt-1 font-code text-[8.5px] tracking-[0.16em] text-ink-400">
                    REG {editing.registrationNo} · ADDED {shortDateOf(editing.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!editBusy) setEditing(null);
                  }}
                  aria-label="Close without saving"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-paper hover:text-ink-900"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="mt-5">
                <SupplierFormFields idPrefix="edit" draft={editDraft} onChange={setEditDraft} />
              </div>

              {editError && (
                <p role="alert" className="mt-4 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-brand-800">
                  {editError}
                </p>
              )}

              <div className="mt-6 flex flex-wrap items-center justify-end gap-2.5 border-t border-ink-100 pt-5">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  disabled={editBusy}
                  className="inline-flex h-10 items-center rounded-xl border border-ink-200 bg-white px-5 font-code text-[9px] font-bold tracking-[0.16em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950 disabled:opacity-60"
                >
                  CANCEL
                </button>
                <button
                  type="button"
                  onClick={() => void saveEdit()}
                  disabled={editBusy}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-600 px-5 text-[13px] font-semibold text-white shadow-[0_10px_26px_rgba(217,38,22,0.28)] transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {editBusy ? "Writing…" : "Save changes"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ViewShell>
  );
}

/* The guards as the side-car keeps them — server truth, named changes. */
type GuardSettings = {
  priceVariancePct: 15 | 25 | 40;
  checklist: "STANDARD" | "STRICT";
  registryCrossCheck: boolean;
  dualApprovalThreshold: number;
  scoreDivergencePoints: number;
  fxStalenessDays: number;
  updatedAt: string | null;
  updatedBy: string | null;
};

const GUARD_DEFAULTS: GuardSettings = {
  priceVariancePct: 25,
  checklist: "STANDARD",
  registryCrossCheck: true,
  dualApprovalThreshold: 0,
  scoreDivergencePoints: 25,
  fxStalenessDays: 30,
  updatedAt: null,
  updatedBy: null,
};

const varianceLabelOf = (pct: 15 | 25 | 40) => `${pct}%` as "15%" | "25%" | "40%";
const checklistLabelOf = (c: GuardSettings["checklist"]) => (c === "STRICT" ? ("STRICT · 16/16" as const) : ("STANDARD · 12/16" as const));

function RulesView({
  firstName,
  onToast,
  onOpenActivity,
}: {
  firstName: string;
  onToast: (m: string) => void;
  onOpenActivity: () => void;
}) {
  const [guards, setGuards] = useState<GuardSettings | null>(null);
  const [thresholdDraft, setThresholdDraft] = useState("");
  const [divergenceDraft, setDivergenceDraft] = useState("");
  const [stalenessDraft, setStalenessDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [register, setRegister] = useState<{ total: number; flagged: number } | null>(null);

  /* The page reads server truth — on mount and whenever it regains focus. The
     guards are one application-wide record, so a change made in another tab or
     by another officer is picked up here instead of leaving a stale pill. */
  const loadSeq = useRef(0);
  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    setLoadFailed(false);
    fetch("/api/guards?XTransformPort=3031")
      .then((r) => {
        if (!r.ok) throw new Error(`guards service returned ${r.status}`);
        return r.json();
      })
      .then((d: { guards?: GuardSettings }) => {
        if (seq === loadSeq.current && d.guards) setGuards(d.guards);
      })
      .catch(() => {
        if (seq === loadSeq.current) setLoadFailed(true);
      });
  }, []);
  useEffect(() => {
    load();
    const onFocus = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      /* Reads still in flight after unmount must not land on a dead page. */
      loadSeq.current += 1;
    };
  }, [load]);

  /* The register the cross-check reads — shown live beside guard 03. */
  useEffect(() => {
    let alive = true;
    fetch("/api/suppliers?XTransformPort=3031")
      .then((r) => r.json())
      .then((d: { suppliers?: { status?: string }[] }) => {
        if (!alive) return;
        const list = d.suppliers ?? [];
        setRegister({
          total: list.length,
          flagged: list.filter((s) => s.status === "SUSPENDED" || s.status === "BLACKLISTED").length,
        });
      })
      .catch(() => {
        /* register unreadable — the guard line simply stays quiet */
      });
    return () => {
      alive = false;
    };
  }, []);

  const shown = guards ?? GUARD_DEFAULTS;
  const actor = firstName.trim() || "unknown officer";
  const locked = !guards || saving;

  /* Optimistic: the pill moves at once; a refusal puts it back and says so. */
  const setGuard = async (
    patch: Partial<
      Pick<
        GuardSettings,
        "priceVariancePct" | "checklist" | "registryCrossCheck" | "dualApprovalThreshold" | "scoreDivergencePoints" | "fxStalenessDays"
      >
    >,
    label: string
  ) => {
    if (!guards || saving) return;
    const prior = guards;
    setSaving(true);
    setGuards({ ...guards, ...patch });
    try {
      const res = await fetch("/api/guards?XTransformPort=3031", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-quorum-actor": actor },
        body: JSON.stringify({ ...patch, actor }),
      });
      const d = (await res.json()) as { guards?: GuardSettings; error?: string };
      if (!res.ok || !d.guards) throw new Error(d.error ?? `refused (${res.status})`);
      setGuards(d.guards);
      onToast(`GUARD UPDATED — ${label} · LOGGED AS ${String(d.guards.updatedBy ?? actor).toUpperCase()}`);
    } catch (err) {
      setGuards(prior);
      onToast(`GUARD UPDATE REFUSED — ${err instanceof Error ? err.message.toUpperCase() : "NO ANSWER FROM THE SIDE-CAR"}`);
    } finally {
      setSaving(false);
    }
  };

  const cards: { no: string; title: string; desc: string; control: ReactNode }[] = [
    {
      no: "01",
      title: "Price variance flag",
      desc: "Flag any bid priced above the framework median by more than —",
      control: (
        <GuardPills
          value={varianceLabelOf(shown.priceVariancePct)}
          options={["15%", "25%", "40%"] as const}
          onChange={(v) => void setGuard({ priceVariancePct: Number(v.slice(0, -1)) as 15 | 25 | 40 }, `PRICE VARIANCE NOW ${v}`)}
          groupLabel="Price variance threshold"
          disabled={locked}
        />
      ),
    },
    {
      no: "02",
      title: "Document checklist",
      desc: "Minimum documents present before a run may complete —",
      control: (
        <GuardPills
          value={checklistLabelOf(shown.checklist)}
          options={["STANDARD · 12/16", "STRICT · 16/16"] as const}
          onChange={(v) => void setGuard({ checklist: v === "STRICT · 16/16" ? "STRICT" : "STANDARD" }, `CHECKLIST MODE ${v}`)}
          groupLabel="Document checklist mode"
          disabled={locked}
        />
      ),
    },
    {
      no: "03",
      title: "Dual approval",
      desc: "Two different officers must sign a gate at or above this value. 0 disables the rule —",
      control: (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min="0"
            step="1000"
            inputMode="numeric"
            value={thresholdDraft || (shown.dualApprovalThreshold ? String(shown.dualApprovalThreshold) : "")}
            onChange={(e) => setThresholdDraft(e.target.value)}
            placeholder="0 = off"
            aria-label="Dual approval threshold"
            className="h-9 w-40 rounded-lg border border-ink-200 bg-white px-3 font-code text-[11px] tabular text-ink-900 outline-none transition-colors focus:border-brand-600 dark:border-white/15 dark:bg-white/[0.04] dark:text-ink-100"
          />
          <button
            type="button"
            disabled={locked || !thresholdDraft}
            onClick={() => {
              const next = Number(thresholdDraft);
              if (!Number.isFinite(next) || next < 0) return;
              void setGuard({ dualApprovalThreshold: next }, `DUAL APPROVAL AT ${next.toLocaleString()}`);
              setThresholdDraft("");
            }}
            className="h-9 rounded-lg bg-ink-950 px-3.5 font-code text-[8px] font-bold tracking-[0.16em] text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            SET
          </button>
          <span className="font-code text-[8px] tracking-[0.12em] text-ink-400">
            ACTIVE — {shown.dualApprovalThreshold ? shown.dualApprovalThreshold.toLocaleString() : "OFF"}
          </span>
        </div>
      ),
    },
    {
      no: "04",
      title: "Registry cross-check",
      desc: "Match every bidder against the open registry before a finding is raised —",
      control: (
        <>
          <GuardPills
            value={shown.registryCrossCheck ? "ON" : "OFF"}
            options={["ON", "OFF"] as const}
            onChange={(v) => void setGuard({ registryCrossCheck: v === "ON" }, `REGISTRY CROSS-CHECK ${v}`)}
            groupLabel="Registry cross-check"
            disabled={locked}
          />
          <p className="mt-3 font-code text-[7.5px] tracking-[0.16em] text-ink-400">
            {register
              ? `REGISTER — ${register.total} REGISTERED · ${register.flagged} SUSPENDED OR BLACKLISTED`
              : "REGISTER — NOT REACHED YET"}
          </p>
        </>
      ),
    },
    {
      no: "05",
      title: "Evaluator divergence",
      desc: "A spread this wide between evaluator sheets must be reconciled in the consensus minute before certification —",
      control: (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min="1"
            max="100"
            step="1"
            inputMode="numeric"
            value={divergenceDraft || String(shown.scoreDivergencePoints)}
            onChange={(e) => setDivergenceDraft(e.target.value)}
            aria-label="Evaluator divergence threshold in score points"
            className="h-9 w-24 rounded-lg border border-ink-200 bg-white px-3 font-code text-[11px] tabular text-ink-900 outline-none transition-colors focus:border-brand-600 dark:border-white/15 dark:bg-white/[0.04] dark:text-ink-100"
          />
          <span className="font-code text-[8px] tracking-[0.12em] text-ink-400">POINTS</span>
          <button
            type="button"
            disabled={locked || !divergenceDraft}
            onClick={() => {
              const next = Number(divergenceDraft);
              if (!Number.isFinite(next) || next <= 0 || next > 100) return;
              void setGuard({ scoreDivergencePoints: next }, `EVALUATOR DIVERGENCE AT ${next} POINTS`);
              setDivergenceDraft("");
            }}
            className="h-9 rounded-lg bg-ink-950 px-3.5 font-code text-[8px] font-bold tracking-[0.16em] text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            SET
          </button>
          <span className="font-code text-[8px] tracking-[0.12em] text-ink-400">
            ACTIVE — {shown.scoreDivergencePoints} POINTS
          </span>
        </div>
      ),
    },
    {
      no: "06",
      title: "FX quote staleness",
      desc: "A quote older than this window cannot carry the evaluated-price basis —",
      control: (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min="1"
            max="365"
            step="1"
            inputMode="numeric"
            value={stalenessDraft || String(shown.fxStalenessDays)}
            onChange={(e) => setStalenessDraft(e.target.value)}
            aria-label="FX quote staleness window in days"
            className="h-9 w-24 rounded-lg border border-ink-200 bg-white px-3 font-code text-[11px] tabular text-ink-900 outline-none transition-colors focus:border-brand-600 dark:border-white/15 dark:bg-white/[0.04] dark:text-ink-100"
          />
          <span className="font-code text-[8px] tracking-[0.12em] text-ink-400">DAYS</span>
          <button
            type="button"
            disabled={locked || !stalenessDraft}
            onClick={() => {
              const next = Number(stalenessDraft);
              if (!Number.isFinite(next) || next < 1 || next > 365) return;
              void setGuard({ fxStalenessDays: next }, `FX QUOTES STALE AFTER ${next} DAYS`);
              setStalenessDraft("");
            }}
            className="h-9 rounded-lg bg-ink-950 px-3.5 font-code text-[8px] font-bold tracking-[0.16em] text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            SET
          </button>
          <span className="font-code text-[8px] tracking-[0.12em] text-ink-400">
            ACTIVE — {shown.fxStalenessDays} DAYS
          </span>
        </div>
      ),
    },
  ];

  return (
    <ViewShell
      fig="13"
      title="Rules & Safeguards"
      sub="The thresholds the agent must obey inside a run. Three clauses are carved; the guards below are tunable — and every change is written to the audit trail with your name on it."
    >
      {/* Full-width: guards flow edge-to-edge in a two-column grid,
          with the standing-rule rail as a full-width row beneath. */}
      {!guards && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-ink-100 bg-white px-4 py-3 sm:mb-6">
          <span
            className={cn("h-1.5 w-1.5 rounded-full", loadFailed ? "bg-red-500" : "animate-pulse bg-amber-400")}
            aria-hidden="true"
          />
          <p className="font-code text-[8px] font-semibold tracking-[0.22em] text-ink-500">
            {loadFailed ? "GUARD SERVICE UNREACHABLE — SETTINGS NOT LOADED" : "SYNCING GUARDS WITH THE SIDE-CAR…"}
          </p>
          {loadFailed && (
            <button
              type="button"
              onClick={() => load()}
              className="ml-auto font-code text-[8px] font-bold tracking-[0.18em] text-brand-700 transition-colors hover:text-brand-800"
            >
              RETRY
            </button>
          )}
        </div>
      )}
      <div data-tour="rules-guards" className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
        {cards.map((g, i) => (
          <motion.div
            key={g.no}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 * i, ease: EASE }}
            className="rounded-[12px] panel p-5 shadow-[0_1px_2px_rgba(11,12,15,0.04)]"
          >
            <p className="font-code text-[8px] font-semibold tracking-[0.22em] text-ink-400">GUARD {g.no}</p>
            <h3 className="mt-1.5 font-display text-[15px] font-black tracking-[-0.01em] text-ink-950">{g.title}</h3>
            <p className="mt-1 text-[12.5px] text-ink-500">{g.desc}</p>
            <div className="mt-4">{g.control}</div>
          </motion.div>
        ))}
        <motion.div
          data-tour="rules-locked"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2, ease: EASE }}
          className="rounded-[12px] panel p-5 shadow-[0_1px_2px_rgba(11,12,15,0.04)]"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-code text-[8px] font-semibold tracking-[0.22em] text-ink-400">GUARD 05</p>
              <h3 className="mt-1.5 font-display text-[15px] font-black tracking-[-0.01em] text-ink-950">Citation policy</h3>
              <p className="mt-1 max-w-md text-[12.5px] text-ink-500">
                Page-level citations on every claim. Zero unsourced tolerated — not a setting, a design constraint.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 font-code text-[8px] font-bold tracking-[0.16em] text-brand-800">
              <Lock className="h-3 w-3" aria-hidden="true" />
              LOCKED BY DESIGN
            </span>
          </div>
        </motion.div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:mt-6 sm:gap-6 lg:grid-cols-2">
        <StandingRuleCard />
        <div data-tour="rules-audit" className="flex items-start gap-3 rounded-[10px] border border-ink-100 bg-sand p-5">
          <ShieldCheck className="h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-code text-[7.5px] leading-[1.9] tracking-[0.14em] text-ink-600">
              EVERY GUARD CHANGE IS LOGGED — NAME, TIMESTAMP, BEFORE &amp; AFTER VALUES.
            </p>
            <p className="mt-2 font-code text-[7.5px] leading-[1.9] tracking-[0.14em] text-brand-800">
              {shown.updatedAt
                ? `LAST CHANGE — ${stampOf(shown.updatedAt)} · BY ${String(shown.updatedBy ?? "unknown").toUpperCase()}`
                : "NO GUARD CHANGES YET — THE CARVED SETTINGS STAND."}
            </p>
            <button
              type="button"
              onClick={onOpenActivity}
              className="mt-2 inline-flex items-center gap-1.5 font-code text-[7.5px] font-bold tracking-[0.18em] text-ink-500 transition-colors hover:text-ink-950"
            >
              READ THE TRAIL
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <DeploymentSettings onToast={onToast} />
    </ViewShell>
  );
}

/* ── Dedicated COMMAND views ─────────────────────────────────────────────── */

function RunsView({
  runs,
  query,
  onQuery,
  filter,
  onFilter,
  onToast,
  onNewRun,
  notes,
  canDeleteDocuments = false,
}: {
  runs: McRun[];
  query: string;
  onQuery: (v: string) => void;
  filter: RunFilter;
  onFilter: (f: RunFilter) => void;
  onToast: (m: string) => void;
  onNewRun: () => void;
  notes: Record<string, string[]>;
  canDeleteDocuments?: boolean;
}) {
  const queued = runs.filter((r) => r.status === "queued").length;
  const reading = runs.filter((r) => r.status === "running").length;
  const atGate = runs.filter((r) => r.status === "gate").length;
  const decided = runs.filter((r) => r.status === "complete").length;
  const findings = runs.reduce((sum, r) => sum + r.findings, 0);
  const sourced = runs.reduce((sum, r) => sum + r.citations, 0);
  const coverage = findings > 0 ? Math.round((sourced / findings) * 100) : null;
  const live = reading + atGate;

  return (
    <ViewShell
      fig="05"
      title="Evaluations"
      sub="Every file the agent has opened — live, queued, at a gate or decided. Expand an evaluation for its top findings and its audit trail."
      action={
        <DeskStatus tone={live > 0 ? "live" : runs.length > 0 ? "clear" : "idle"}>
          {live > 0
            ? `${reading} reading · ${atGate} at a gate`
            : runs.length > 0
              ? "Agent idle"
              : "Desk empty"}
        </DeskStatus>
      }
      summary={
        <StageStrip
          label="Review pipeline"
          meta={
            runs.length > 0
              ? `${runs.length} FILE${runs.length === 1 ? "" : "S"} ON THE DESK${coverage !== null ? ` · ${coverage}% SOURCED` : ""}`
              : "NO FILES OPENED"
          }
          items={[
            { key: "queued", label: "Queued", count: queued, caption: "WAITING FOR THE AGENT" },
            { key: "reading", label: "Reading", count: reading, caption: "AGENT IN THE FILES", tone: reading ? "brand" : "idle" },
            { key: "gate", label: "At a gate", count: atGate, caption: "A HUMAN MUST DECIDE", tone: atGate ? "brand" : "idle" },
            { key: "decided", label: "Decided", count: decided, caption: "SIGNED AND FILED", tone: decided ? "emerald" : "idle" },
          ]}
        />
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:gap-6">
        <div className="grid content-start gap-4 sm:grid-cols-2 sm:gap-6">
          <NewRunCard onNewRun={onNewRun} />
          <StandingRuleCard />
        </div>
        <div className="min-w-0">
          <RunRegister
            runs={runs}
            query={query}
            onQuery={onQuery}
            filter={filter}
            onFilter={onFilter}
            onToast={onToast}
            notes={notes}
            canDeleteDocuments={canDeleteDocuments}
          />
        </div>
      </div>
    </ViewShell>
  );
}

function GatesView({
  queue,
  ledger,
  quorum,
  onSign,
  onReturn,
  onGoCommittee,
}: {
  queue: GateItem[];
  ledger: LedgerRow[];
  quorum: CommitteeData | null;
  onSign: (g: GateItem) => void;
  onReturn: (g: GateItem) => void;
  onGoCommittee: () => void;
}) {
  const officeOrder = ["PROCUREMENT_UNIT", "EVALUATION_COMMITTEE", "ACCOUNTING_OFFICER", "OVERSIGHT"] as const;
  const officeRole: Record<string, string> = {
    PROCUREMENT_UNIT: "COMPETITIVE PROCESS",
    EVALUATION_COMMITTEE: "SCORES AND CERTIFIES",
    ACCOUNTING_OFFICER: "SIGNS THE AWARD",
    OVERSIGHT: "AUDIT AND ASSURANCE",
  };
  const unassigned = queue.filter((g) => !g.requiredOffice).length;
  /* One term for the whole section: the queue, its ledger and the authority
     strip all read this query. */
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const offices = officeOrder.filter((o) =>
    `${MEMBER_OFFICE_LABELS[o]} ${officeRole[o]}`.toLowerCase().includes(needle),
  );

  return (
    <ViewShell
      fig="06"
      title="Approvals"
      sub="The stop only a human can pass. The agent assembles the file and halts; the committee reads the cited flags and decides — by name, on the record."
      action={
        <DeskStatus tone={queue.length > 0 ? "live" : "clear"}>
          {queue.length > 0 ? `${queue.length} waiting on a signature` : "All clear"}
        </DeskStatus>
      }
      summary={
        <StageStrip
          label="Decision authority"
          search={
            <label className="relative block w-52">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search approvals…"
                aria-label="Search approvals by tender, office or supplier"
                className="focus-brand h-7 w-full rounded-md border border-ink-200/80 bg-[#fffdfb] pl-7 pr-2.5 font-code text-[9px] font-semibold tracking-[0.06em] text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-950 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-white dark:placeholder:text-ink-500 dark:focus:border-white/35"
              />
            </label>
          }
          meta={
            <>
              {queue.length} WAITING · {ledger.length} ON THE RECORD
              {unassigned > 0 ? ` · ${unassigned} UNASSIGNED` : ""}
              {needle ? ` · ${offices.length} OF ${officeOrder.length} OFFICES` : ""}
            </>
          }
          items={offices.map((office) => {
            const count = queue.filter((g) => g.requiredOffice === office).length;
            return {
              key: office,
              label: MEMBER_OFFICE_LABELS[office],
              count,
              caption: officeRole[office],
              tone: count > 0 ? ("brand" as const) : ("idle" as const),
            };
          })}
        />
      }
    >
      <div className="grid content-start gap-4 sm:gap-6">
        <div className="min-w-0">
          <GateQueue
            queue={queue}
            ledger={ledger}
            quorum={quorum}
            onSign={onSign}
            onReturn={onReturn}
            onOpenRoll={onGoCommittee}
            query={q}
            onQuery={setQ}
          />
        </div>
        <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
          <GavelProtocolCard />
          <button
            type="button"
            onClick={onGoCommittee}
            className="group relative overflow-hidden rounded-[12px] border border-ink-950 bg-night p-5 text-left text-white shadow-[0_22px_55px_rgba(11,12,15,0.3)] transition-transform hover:-translate-y-0.5"
          >
            <div className="bg-grid-dark pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
            <div className="relative">
              <h3 className="font-display text-[15px] font-black tracking-[-0.01em]">Who signs? The committee.</h3>
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-300">
                Five of nine seats present before an award counts. Meet the roster and the quorum rule.
              </p>
              <span className="mt-4 inline-flex items-center gap-1.5 font-code text-[8.5px] font-bold tracking-[0.2em] text-brand-400">
                OPEN THE ROSTER
                <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
              </span>
            </div>
          </button>
        </div>
      </div>
    </ViewShell>
  );
}

function FeedView() {
  return (
    <ViewShell
      fig="07"
      title="Live Activity"
      sub="The work, streaming. Ingest, checklist, registry, flags, citations — watch a run the way the committee will read it: line by line, every claim sourced."
    >
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <AgentFeed />
        </div>
        <div className="grid content-start gap-4 sm:gap-6">
          <PortalSync />
          <div className="relative overflow-hidden rounded-[12px] border border-ink-950 bg-night p-5 text-white shadow-[0_22px_55px_rgba(11,12,15,0.3)]">
            <div className="bg-grid-dark pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
            <div className="relative">
              <h3 className="font-display text-[15px] font-black tracking-[-0.01em]">Citation policy</h3>
              <p className="mt-3 font-code text-[9px] leading-[2] tracking-[0.16em] text-ink-300">
                IF THE AGENT CANNOT CITE IT,
                <br />
                IT CANNOT SAY IT.
                <br />
                <span className="text-brand-400">PAGE, CLAUSE OR REGISTRY ID — EVERY TIME.</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </ViewShell>
  );
}

/* ── The screen ──────────────────────────────────────────────────────────── */

export function Dashboard({
  user,
  onSignOut,
  onToast,
  onExit,
}: {
  user: AuthUser | null;
  onSignOut: () => void;
  onToast: (message: string) => void;
  onExit: () => void;
}) {
  const mission = useMissionData();
  const { runs, queue, ledger, verdicts, findings, notes: notesMap, committee, refresh, reachable } = mission;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RunFilter>("all");
  const [active, setActive] = useState<SectionId>("mc-overview");
  const [navOpen, setNavOpen] = useState(false);
  /* Desktop sidebar: the whole rail collapses, and the choice is remembered. */
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("quorum.navCollapsed") === "1";
    } catch {
      return false;
    }
  });
  const setNavCollapsedPersisted = useCallback((collapsed: boolean) => {
    setNavCollapsed(collapsed);
    try {
      window.localStorage.setItem("quorum.navCollapsed", collapsed ? "1" : "0");
    } catch {
      /* private mode — the choice simply won't survive reloads */
    }
  }, []);
  const [modalOpen, setModalOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  /* The guided walkthrough: which chapter and step is spotlit right now, and
     which chapters this officer has already toured in this session. */
  const [tour, setTour] = useState<{ ch: number; step: number } | null>(null);
  const [toured, setToured] = useState<number[]>([]);

  /* Live agent health — the pill and sidebar render what the stack reports. */
  const agent = useAgentStatus();
  const agentMode = agentModeOf(agent);

  /* Clock + date */
  useEffect(() => {
    const first = requestAnimationFrame(() => setNow(new Date()));
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => {
      cancelAnimationFrame(first);
      clearInterval(id);
    };
  }, []);

  /* Body scroll lock for the mobile drawer */
  useEffect(() => {
    document.body.style.overflow = navOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [navOpen]);

  /* Deep links from notifications and email: /#mc-gates opens Approvals. */
  useEffect(() => {
    const apply = () => {
      const id = window.location.hash.replace(/^#/, "");
      if (
        NAV_GROUPS.some((g) => g.items.some((i) => i.id === id && !i.href)) &&
        canOpenSection(user, id as SectionId)
      ) {
        setActive(id as SectionId);
      }
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [user]);

  /* ⌘K / Ctrl+K opens the command line from anywhere in the workspace. The
     launch wizard owns the desk while it is open, so the chord is inert then. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      if (modalOpen) return;
      setPaletteOpen((prev) => !prev);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  const firstName = firstNameOf(user);
  const hour = now?.getHours() ?? 10;
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const activeRuns = runs.filter((r) => r.status === "running" || r.status === "queued").length;
  const findingsTotal = runs
    .filter((r) => r.status === "gate" || r.status === "complete")
    .reduce((sum, r) => sum + r.findings, 0);
  const citedTotal = runs
    .filter((r) => r.status === "gate" || r.status === "complete")
    .reduce((sum, r) => sum + r.citations, 0);
  const citationPct = findingsTotal > 0 ? Math.round((citedTotal / findingsTotal) * 100) : 100;
  /* Real, not asserted: claims with no source behind them. */
  const unsourcedTotal = runs.reduce((sum, r) => sum + (r.unsourced ?? 0), 0);

  const findingRows = useMemo(() => buildFindingRows(findings, runs, verdicts), [findings, runs, verdicts]);
  const openFindings = findingRows.filter((r) => r.status === "OPEN").length;

  const switchTo = (id: SectionId) => {
    if (!canOpenSection(user, id)) {
      onToast("YOUR WORKSPACE ROLE DOES NOT OPEN THAT SECTION");
      return;
    }
    setNavOpen(false);
    setActive(id);
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  };

  /* One launch door for every button and tour action — a read-only role never
     reaches the wizard, even when a chapter points at it. */
  const openNewRun = () => {
    if (!canDo(user?.role, "run_reviews")) {
      onToast("YOUR WORKSPACE ROLE CANNOT LAUNCH AN EVALUATION");
      return;
    }
    setModalOpen(true);
  };

  /* The palette's contents: two actions, then every section of the desk in the
     same order as the rail, carrying the same live counts as the sidebar. */
  const paletteGroups: PaletteGroup[] = [
    {
      label: "Actions",
      entries: [
        ...(canDo(user?.role, "run_reviews")
          ? [
              {
                id: "new-evaluation",
                label: "New evaluation",
                icon: Plus,
                hint: "LAUNCH",
                keywords: "start run tender review upload",
                run: openNewRun,
              },
            ]
          : []),
        {
          id: "back-to-site",
          label: "Back to site",
          icon: ArrowLeft,
          hint: "LEAVE",
          keywords: "home landing exit",
          run: onExit,
        },
      ],
    },
    ...navGroupsFor(user).map((group) => ({
      label: group.group,
      entries: group.items.map((item) => ({
        id: item.id,
        label: item.label,
        icon: item.icon,
        badge:
          item.badge === "runs"
            ? runs.length
            : item.badge === "gates"
              ? queue.length
              : item.badge === "findings"
                ? openFindings
                : undefined,
        hint: item.href ? "OPENS PAGE" : undefined,
        current: !item.href && active === item.id,
        keywords: item.id.replace(/-/g, " "),
        run: () => {
          if (item.href) window.location.href = item.href;
          else switchTo(item.id as SectionId);
        },
      })),
    })),
  ];

  const launchRun = async (ref: string, title: string, format: string, docs: number, checks: number) => {
    let res: Response;
    try {
      res = await fetch("/api/runs?XTransformPort=3031", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenderId: ref }),
      });
    } catch {
      throw new Error("The run service is unavailable. Check your connection and try again.");
    }
    if (!res.ok) throw new Error(`The run service could not start this review (HTTP ${res.status}). Check the tender reference and try again.`);
    setModalOpen(false);
    /* Guide the officer to the register — the run goes live in front of them. */
    setActive("mc-runs");
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    onToast(`RUN QUEUED — ${title.toUpperCase()} · ${format.toUpperCase()} · ${docs} DOC${docs === 1 ? "" : "S"} · ${checks} CHECK${checks === 1 ? "" : "S"}`);
    void refresh();
  };

  /* Records the committee's decision on the sidecar; the UI follows what it returns.
     An award decision can carry the officer's freeform signature — the ink is
     posted alongside the step-up seal and kept on the receipt. */
  const decideGate = async (g: GateItem, decision: "APPROVE" | "REJECT", ink?: AwardHandSignature) => {
    /* The signature comes first. A cancelled or refused step-up means the
       gate never reaches the sidecar. */
    const stepUp = await requestStepUp(g.id);
    if (!stepUp) {
      onToast("GATE NOT SIGNED — STEP-UP CANCELLED");
      return false;
    }
    try {
      const signer = user?.name.trim() ?? "";
      const res = await fetch(`/api/gates/${g.id}/decision?XTransformPort=3031`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-quorum-stepup": stepUp },
        body: JSON.stringify({
          decision,
          approver: signer,
          signedInAs: signer,
          note: decision === "APPROVE" ? "Signed by the committee" : "Returned for clarification",
          ...(ink
            ? { handSignature: { image: ink.image, signedAt: ink.signedAt, strokes: ink.strokes } }
            : {}),
        }),
      });
      if (!res.ok) {
        /* The sidecar says why it refused (e.g. not on the committee roster). */
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        onToast(data.error ? data.error.toUpperCase() : "DECISION NOT RECORDED");
        return false;
      }
    } catch {
      onToast("DECISION NOT RECORDED — quorum-mcp NOT RESPONDING");
      return false;
    }
    void refresh();
    return true;
  };

  const signGate = async (g: GateItem) => {
    /* The wet-ink ceremony comes first: the authorised officer appends their
       freeform signature to the instrument, then re-authenticates, and only
       then does the sidecar execute. A cancelled signature ends the flow. */
    const ink = await requestAwardSignature({
      gateId: g.id,
      tender: g.tender,
      title: g.title,
      tool: g.tool,
      toolLabel: GATE_TOOL_LABEL[g.tool] ?? g.tool,
      supplier: g.supplier,
      factLabel: g.factLabel,
      factText: g.factText,
      valueMissing: g.valueMissing,
      flags: g.flags,
      ...(g.requiredOffice ? { officeLabel: OFFICE_SHORT[g.requiredOffice] ?? g.requiredOffice } : {}),
      signerName: user?.name.trim() ?? "",
      signerRoleLabel: user?.role ? ROLE_LABELS[user.role] : "",
    });
    if (!ink) {
      onToast("AWARD NOT SIGNED — SIGNATURE CANCELLED");
      return;
    }
    if (!(await decideGate(g, "APPROVE", ink))) return;
    onToast(`GATE SIGNED — ${g.tender} AWARDED · WET-INK SIGNATURE + SEAL LOGGED`);
  };

  const returnGate = async (g: GateItem) => {
    if (!(await decideGate(g, "REJECT"))) return;
    onToast(`${g.tender} RETURNED — AGENT TASKED WITH CLARIFICATION`);
  };

  /* ── The guided walkthrough ─────────────────────────────────────────────
     A chapter points at a section (or its own URL) and carries an ordered
     list of [data-tour] targets; <TourLayer> finds, scrolls to and
     spotlights each one. Steps that need the wizard open say so with an
     action, executed the moment the step becomes current. */
  const tourChapter = tour ? WALKTHROUGH[tour.ch] : undefined;
  const tourSteps = tourChapter?.tour;

  /* Move the tour to a step, running its action if it carries one — a step
     that needs the wizard open says so, and this opens it as we arrive. */
  const goTourStep = (i: number) => {
    if (!tour) return;
    const s = WALKTHROUGH[tour.ch]?.tour?.[i];
    if (s?.action === "open-wizard") openNewRun();
    if (s?.tab) window.dispatchEvent(new CustomEvent("mc-committee-tab", { detail: s.tab }));
    setTour({ ...tour, step: i });
  };

  const startTour = (ch: number) => {
    const chapter = WALKTHROUGH[ch];
    if (!chapter) return;
    /* The handbook lives at its own address — send the tour there instead. */
    if (chapter.href) {
      window.location.href = `${chapter.href}?tour=1`;
      return;
    }
    if (!chapter.tour?.length) return;
    if (chapter.section && !canOpenSection(user, chapter.section)) {
      onToast("YOUR WORKSPACE ROLE DOES NOT OPEN THIS CHAPTER");
      return;
    }
    setModalOpen(false);
    if (chapter.section) {
      setNavOpen(false);
      setActive(chapter.section);
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    }
    if (chapter.tour[0]?.action === "open-wizard") openNewRun();
    /* A step that lives in the rail needs the rail on screen — bring it back
       for the tour without touching the officer's saved preference. */
    if (chapter.tour.some((s) => s.target.startsWith("nav-"))) setNavCollapsed(false);
    setTour({ ch, step: 0 });
  };

  const markToured = (ch: number) =>
    setToured((prev) => (prev.includes(ch) ? prev : [...prev, ch]));

  const finishTour = () => {
    if (!tour) return;
    markToured(tour.ch);
    onToast(`WALKTHROUGH COMPLETE — CHAPTER ${String(tour.ch + 1).padStart(2, "0")} OF ${WALKTHROUGH.length}`);
    setTour(null);
  };

  const nextTourChapter = () => {
    if (!tour) return;
    const next = tour.ch + 1;
    markToured(tour.ch);
    setTour(null);
    if (next < WALKTHROUGH.length) requestAnimationFrame(() => startTour(next));
  };

  const renderView = () => {
    if (!canOpenSection(user, active)) {
      return (
        <ViewShell
          fig="—"
          title="Restricted"
          sub={`Your workspace role${user?.role ? ` (${ROLE_LABELS[user.role]})` : ""} does not open this section. The server enforces the same boundary on every write.`}
        >
          <button
            type="button"
            onClick={() => switchTo("mc-overview")}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-ink-950 px-4 font-code text-[9px] font-bold tracking-[0.16em] text-white transition-colors hover:bg-ink-800"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            BACK TO OVERVIEW
          </button>
        </ViewShell>
      );
    }
    switch (active) {
      case "mc-runs":
        return (
          <RunsView
            runs={runs}
            query={query}
            onQuery={setQuery}
            filter={filter}
            onFilter={setFilter}
            onToast={onToast}
            onNewRun={openNewRun}
            notes={notesMap}
            canDeleteDocuments={canDo(user?.role, "run_reviews")}
          />
        );
      case "mc-gates":
        return (
          <GatesView
            queue={queue}
            ledger={ledger}
            quorum={committee}
            onSign={signGate}
            onReturn={returnGate}
            onGoCommittee={() => switchTo("mc-committee")}
          />
        );
      case "mc-activity":
        return <FeedView />;
      case "mc-cycle":
        return (
          <CycleView
            user={user}
            onToast={onToast}
            canDeleteDocuments={canDo(user?.role, "run_reviews")}
          />
        );
      case "mc-findings":
        return <FindingsView rows={findingRows} onOpenRun={() => switchTo("mc-runs")} />;
      case "mc-reports":
        return (
          <ReportPacksView
            runs={runs}
            verdicts={verdicts}
            findings={findings}
            onToast={onToast}
            onOpenApprovals={() => switchTo("mc-gates")}
          />
        );
      case "mc-sources":
        return <SourcesView onToast={onToast} firstName={firstName} />;
      case "mc-ledger":
        return <AwardLedgerView ledger={ledger} awaiting={queue.length} />;
      case "mc-committee":
        return <CommitteeView user={user} onToast={onToast} />;
      case "mc-calendar":
        return <CalendarView onToast={onToast} onGoCommittee={() => switchTo("mc-committee")} />;
      case "mc-rules":
        return <RulesView firstName={firstName} onToast={onToast} onOpenActivity={() => switchTo("mc-activity")} />;
      case "mc-stack":
        return <StackConsole onToast={onToast} />;
      case "mc-oversight":
        return <OversightView actor={user} onToast={onToast} onOpenAudit={() => switchTo("mc-audit")} />;
      case "mc-audit":
        return <AuditView onToast={onToast} />;
      case "mc-settings":
        return (
          <SettingsView
            user={user}
            agent={agent}
            onSignOut={onSignOut}
            onOpenOversight={() => switchTo("mc-oversight")}
            onToast={onToast}
          />
        );
      case "mc-walkthrough":
        return (
          <WalkthroughView
            onOpen={switchTo}
            onNewRun={openNewRun}
            onTour={startTour}
            done={toured}
          />
        );
      case "mc-suppliers":
        return <SuppliersView firstName={firstName} onToast={onToast} />;
      case "mc-integrations":
        return <IntegrationsView />;
      default:
        return null;
    }
  };

  return (
    <div className="desk-canvas min-h-screen font-body text-ink-900 antialiased">
      <a
        href="#mc-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[90] focus:rounded-lg focus:bg-ink-950 focus:px-4 focus:py-2 focus:text-[13px] focus:font-semibold focus:text-white"
      >
        Skip to workspace
      </a>

      {/* Desktop sidebar — present on every section; collapses entirely on request */}
      <AnimatePresence>
        {!navCollapsed && (
          <motion.aside
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ duration: 0.32, ease: EASE }}
            className="fixed inset-y-0 left-0 z-40 hidden w-[264px] flex-col border-r border-white/[0.08] bg-night shadow-[24px_0_60px_-40px_rgba(0,0,0,0.9)] lg:flex"
            aria-label="Workspace sidebar"
          >
            <div className="bg-grid-dark pointer-events-none absolute inset-0 opacity-50" aria-hidden="true" />
            <button
              type="button"
              onClick={() => setNavCollapsedPersisted(true)}
              aria-label="Collapse sidebar"
              title="Collapse the sidebar"
              className="absolute right-3 top-6 z-10 grid h-8 w-8 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-white/10 hover:text-white"
            >
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="relative flex h-full flex-col">
              <SidebarContent
                active={active}
                user={user}
                counts={{ runs: runs.length, gates: queue.length, findings: openFindings }}
                agent={agent}
                onNavigate={switchTo}
                onSignOut={onSignOut}
                onExit={onExit}
              />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-white/[0.07] bg-night px-4 py-3 lg:hidden">
        <QuorumLogo variant="light" />
        <div className="flex items-center gap-2.5">
          {/* Reports the sidecar's real state — never a hardcoded "online" */}
          <AgentStatusBadge mode={agentMode} className="hidden sm:inline-flex" />
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open workspace menu"
            aria-expanded={navOpen}
            className="focus-brand grid h-10 w-10 place-items-center rounded-full border border-white/15 text-white transition-colors hover:border-brand-500"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      <AnimatePresence>
        {navOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[60] bg-night/70 backdrop-blur-sm lg:hidden"
              onClick={() => setNavOpen(false)}
              aria-hidden="true"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.32, ease: EASE }}
              className="fixed inset-y-0 left-0 z-[61] w-[290px] bg-night lg:hidden"
              aria-label="Workspace menu"
            >
              <div className="bg-grid-dark pointer-events-none absolute inset-0 opacity-50" aria-hidden="true" />
              <div className="relative flex h-full flex-col">
                <button
                  type="button"
                  onClick={() => setNavOpen(false)}
                  aria-label="Close menu"
                  className="absolute right-3 top-4 grid h-9 w-9 place-items-center rounded-lg text-ink-300 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-4.5 w-4.5" aria-hidden="true" />
                </button>
                <SidebarContent
                  active={active}
                  user={user}
                  counts={{ runs: runs.length, gates: queue.length, findings: openFindings }}
                  agent={agent}
                  onNavigate={switchTo}
                  onSignOut={onSignOut}
                  onExit={onExit}
                />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main column — shifts with the sidebar */}
      <div
        className={cn(
          "desk-sheet transition-[padding] duration-300 ease-out",
          navCollapsed ? "lg:pl-0" : "lg:pl-[264px]"
        )}
      >
        {/* Sticky utility bar — the desk's instrument strip */}
        <div className="sticky top-0 z-30 border-b border-ink-200/70 bg-paper/80 backdrop-blur-xl supports-[backdrop-filter]:bg-paper/65 dark:border-white/[0.08]">
          <div className="mx-auto flex h-[58px] w-full max-w-[1500px] items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
            {/* Location zone — shrink-0: the page name is the anchor of the bar
                and never truncates; the search field absorbs pressure instead. */}
            <div className="flex shrink-0 items-center gap-3">
              {navCollapsed && (
                <button
                  type="button"
                  onClick={() => setNavCollapsedPersisted(false)}
                  aria-label="Expand sidebar"
                  title="Expand the sidebar"
                  className="focus-brand hidden h-10 w-10 shrink-0 place-items-center rounded-full border border-ink-200/80 bg-white text-ink-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 lg:grid dark:border-white/10 dark:bg-white/[0.04]"
                >
                  <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              {/* The breadcrumb is pure navigation: where I am. System state
                  lives in the status cluster on the right — one pulsing dot
                  per screen, not two. */}
              <nav aria-label="Workspace location" className="flex min-w-0 items-center gap-2.5">
                <span className="hidden shrink-0 font-code text-[8px] font-semibold uppercase tracking-[0.24em] text-ink-400 sm:inline">
                  Workspace
                </span>
                <span className="hidden shrink-0 text-[11px] text-ink-300 sm:inline dark:text-ink-600" aria-hidden="true">
                  /
                </span>
                <span
                  aria-current="page"
                  className="min-w-0 truncate text-[13.5px] font-semibold tracking-[-0.01em] text-ink-950 dark:text-white"
                >
                  {SECTION_LABEL[active] ?? "Overview"}
                </span>
              </nav>
            </div>
            {/* Hairline between the location zone and the tool zone — the bar
                reads as three instruments, not one crowded strip. */}
            <span
              aria-hidden="true"
              className="hidden h-5 w-px shrink-0 bg-ink-200/80 sm:block dark:bg-white/[0.09]"
            />
            <div className="flex min-w-0 flex-1 items-center gap-1 sm:gap-1.5">
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-label="Jump to a workspace section"
                aria-keyshortcuts="Meta+K Control+K"
                title="Jump to… (⌘K)"
                className="focus-brand inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-ink-200/80 bg-white/60 px-2.5 text-ink-500 shadow-[0_1px_2px_rgba(11,12,15,0.03)] transition-colors hover:border-ink-300 hover:text-ink-900 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-ink-400 dark:hover:border-white/20 dark:hover:text-white"
              >
                <CommandIcon className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden font-code text-[8px] font-bold tracking-[0.16em] xl:inline">JUMP TO</span>
                <kbd
                  aria-hidden="true"
                  className="hidden rounded-[4px] border border-ink-200/80 bg-white px-1 py-[1px] font-code text-[8px] font-bold leading-none text-ink-500 lg:inline dark:border-white/10 dark:bg-white/[0.06] dark:text-ink-400"
                >
                  ⌘K
                </kbd>
              </button>
              {/* The field flexes with the bar: full share of the tool zone,
                  capped at its resting width — focus no longer reflows the
                  status cluster because the width never jumps. */}
              <div className="relative hidden min-w-0 w-full max-w-[13rem] sm:block">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search evaluations…"
                  aria-label="Search evaluations by reference, title or buyer"
                  className="focus-brand h-9 w-full rounded-lg border border-ink-200/80 bg-[#fffdfb] pl-9 pr-3.5 text-[12.5px] text-ink-900 shadow-[inset_0_1px_1px_rgba(11,12,15,0.03)] outline-none transition-[border-color,background-color] duration-300 placeholder:text-ink-400 focus:border-ink-950 focus:ring-[3px] focus:ring-ink-950/[0.07] dark:border-white/[0.1] dark:bg-white/[0.04] dark:focus:border-white/35 dark:focus:ring-white/[0.06]"
                />
              </div>
            </div>
            {/* Status + application controls — the system's side of the bar.
                Every child is shrink-0: the cluster compresses by hiding,
                never by wrapping or squashing a pill. */}
            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2 lg:gap-2.5">
              <p
                className="hidden shrink-0 items-center gap-2 whitespace-nowrap type-micro text-ink-500 2xl:flex"
                aria-label="Local time"
              >
                <LiveClock />
                <span className="text-ink-300">·</span> Local
              </p>
              <AgentStatusBadge mode={agentMode} className="hidden lg:inline-flex" />
              <NotificationBell
                onNavigate={(section) => switchTo(section as SectionId)}
                onToast={onToast}
              />
            </div>
          </div>
        </div>

        <main
          id="mc-main"
          className="mx-auto w-full max-w-[1500px] px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pt-7"
        >
          <AnimatePresence mode="wait" initial={false}>
            {active === "mc-overview" ? (
              <motion.div key="mc-board" exit={{ opacity: 0, transition: { duration: 0.15 } }}>
          {/* Sidecar-down banner — the one place the overview must speak up */}
          {reachable === false && (
            <div
              data-tour="ov-sidecar-down"
              role="status"
              className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-brand-500/30 bg-brand-500/[0.07] px-4 py-3"
            >
              <span className="inline-flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-brand-600" aria-hidden="true" />
              <p className="text-[12.5px] font-medium text-brand-900">
                The agent service (quorum-mcp sidecar) is not answering — the numbers below may be stale.
              </p>
              <p className="font-code text-[8.5px] tracking-[0.14em] text-brand-700">
                CHECK TOOLS &amp; MODELS FOR THE LIVE STATUS
              </p>
            </div>
          )}
          {/* Greeting */}
          <section id="mc-overview" aria-labelledby="mc-greeting" className="scroll-mt-20">
            <div className="flex flex-wrap items-end justify-between gap-5">
              <div className="min-w-0">
                <SpecBar index="04" label="Workspace" meta="Overview · live from quorum-mcp" />
                <h1
                  id="mc-greeting"
                  className="type-display mt-6 text-[34px] text-ink-950 sm:text-[44px]"
                >
                  {greeting},{" "}
                  <span className="font-editorial text-[1.04em] font-normal tracking-normal text-brand-600 dark:text-brand-400">
                    {firstName}
                  </span>
                  <span className="text-brand-600 dark:text-brand-400">.</span>
                </h1>
              </div>
              <div className="flex flex-col items-start gap-3.5 sm:items-end">
                <p className="type-micro text-ink-400">{now ? dateLine(now) : "—"}</p>
                <button
                  type="button"
                  data-tour="ov-new-run"
                  onClick={openNewRun}
                  className="focus-brand group relative inline-flex h-12 items-center gap-2.5 overflow-hidden rounded-full bg-brand-600 pl-5 pr-4 text-[14px] font-semibold text-white shadow-[0_1px_0_rgba(255,255,255,0.18)_inset,0_16px_34px_-16px_rgba(217,38,22,0.9)] transition-colors hover:bg-brand-700"
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                  />
                  <Plus className="relative h-4 w-4" aria-hidden="true" />
                  <span className="relative">New evaluation</span>
                </button>
              </div>
            </div>

            {/* Stats — a hairline-divided editorial band, not floating cards */}
            <div
              data-tour="ov-stats"
              className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-ink-200/70 bg-ink-200/60 shadow-[0_1px_2px_rgba(11,12,15,0.04),0_18px_40px_-24px_rgba(11,12,15,0.26)] xl:grid-cols-4 dark:border-white/10 dark:bg-white/10 dark:shadow-[0_1px_0_rgba(255,255,255,0.05)_inset,0_22px_55px_-30px_rgba(0,0,0,0.8)]"
            >
              <StatCard
                index="01"
                label="Evaluations in progress"
                value={activeRuns}
                sub={activeRuns > 0 ? "AGENT IS READING A TENDER" : "AGENT IS IDLE — START AN EVALUATION"}
                delay={0.05}
              />
              <StatCard
                index="02"
                label="Issues found"
                value={findingsTotal}
                sub={unsourcedTotal > 0 ? `${unsourcedTotal} STILL AWAIT A SOURCE` : "EACH ONE LINKED TO A SOURCE"}
                delay={0.12}
              />
              <StatCard
                index="03"
                label="Sources confirmed"
                value={citationPct}
                suffix="%"
                sub={`${unsourcedTotal} CLAIM${unsourcedTotal === 1 ? "" : "S"} WITHOUT A SOURCE`}
                delay={0.19}
              />
              <StatCard
                index="04"
                label="Approvals waiting"
                value={queue.length}
                sub={queue.length > 0 ? "THE COMMITTEE NEEDS TO DECIDE" : "NO DECISIONS NEEDED"}
                featured
                pulse={queue.length > 0}
                delay={0.26}
              />
            </div>
          </section>

          {/* Runs + gates */}
          <div className="mt-6 grid grid-cols-1 gap-4 sm:gap-6">
            <RunRegister
              runs={runs}
              query={query}
              onQuery={setQuery}
              filter={filter}
              onFilter={setFilter}
              onToast={onToast}
              notes={notesMap}
              canDeleteDocuments={canDo(user?.role, "run_reviews")}
            />
            <GateQueue
              queue={queue}
              ledger={ledger}
              quorum={committee}
              onSign={signGate}
              onReturn={returnGate}
              onOpenRoll={canDo(user?.role, "manage_meetings") ? () => switchTo("mc-committee") : undefined}
              canSign={canDo(user?.role, "sign_gates")}
            />
          </div>

          {/* Feed + portals */}
          <div className="mt-6 grid grid-cols-1 gap-4 sm:gap-6">
            <div id="mc-activity" className="min-w-0 scroll-mt-24">
              <AgentFeed />
            </div>
            <div className="grid grid-cols-1 content-start gap-4 sm:gap-6 md:grid-cols-2">
              <PortalSync />
              <StandingRuleCard />
            </div>
          </div>

          {/* Bottom strip */}
          <p className="mt-12 border-t border-ink-200/70 pt-5 text-center type-micro text-ink-400 dark:border-white/10">
            Quorum · workspace · session {initialsOf(user?.name ?? "Q")} · audit-grade logs · no trackers
          </p>
              </motion.div>
            ) : (
              <motion.div
                key={active}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                transition={{ duration: 0.4, ease: EASE }}
              >
                {renderView()}
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      <WorkspacePalette open={paletteOpen} onOpenChange={setPaletteOpen} groups={paletteGroups} />

      <NewRunModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onLaunch={launchRun}
        pastRefs={runs.map((r) => r.id)}
        canDeleteDocs={canDo(user?.role, "run_reviews")}
      />

      {/* One step-up host for every gate card in the workspace. */}
      <StepUpHost />
      <AwardSignatureHost />

      {/* The guided walkthrough — a spotlight layer over the real pages. */}
      {tour && tourChapter && tourSteps?.length ? (
        <TourLayer
          chapterNo={tour.ch + 1}
          chapterTotal={WALKTHROUGH.length}
          chapterTitle={tourChapter.title}
          steps={tourSteps}
          index={Math.min(tour.step, tourSteps.length - 1)}
          onIndex={goTourStep}
          onClose={() => setTour(null)}
          onFinish={finishTour}
          onNextChapter={tour.ch + 1 < WALKTHROUGH.length ? nextTourChapter : undefined}
        />
      ) : null}
    </div>
  );
}
