"use client";

import { useReducedMotion } from "@/lib/use-reduced-motion";

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Braces,
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
  FileCheck2,
  FileText,
  FileUp,
  Files,
  Gavel,
  Gauge,
  HardDrive,
  Landmark,
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
import { TeamInviteDeliveryActions } from "@/components/quorum/team-invite-delivery-actions";
import { CalendarView } from "@/components/quorum/calendar-view";
import { IntegrationsView } from "@/components/quorum/integrations-view";
import { ApiView } from "@/components/quorum/api-view";
import { CYCLE_PAGE_PAGES, CycleView, type CyclePageTab } from "@/components/quorum/cycle-view";
import { GovernanceView } from "@/components/quorum/governance-view";
import { ComplianceView } from "@/components/quorum/compliance-view";
import { ReadinessView } from "@/components/quorum/readiness-view";
import { SpecBar } from "@/components/quorum/reveal";
import { QuorumLogo } from "@/components/quorum/logo";
import { NotificationBell } from "@/components/quorum/notification-bell";
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
  CAPABILITY_DETAILS,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
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
import { HorizontalScrollRegion } from "@/components/quorum/horizontal-scroll-region";
import { preferredScrollBehavior, trapTabFocus } from "@/lib/a11y";
import { systemReferenceLabel } from "@/lib/system-reference";
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
  /* Internal source tender key. Keep it for lookups; use `reference` in UI. */
  id: string;
  /* Stable system-issued reference shown to officers; `id` stays the tender
     key used for document, finding and cycle lookups. */
  reference?: string;
  /* Backend run identity (`run_…`) — unique even when the same tender is
     reviewed twice. React keys use this; `id` stays the human-facing ref. */
  uid?: string;
  /* 1-based attempt number for this tender (review 2 of 3, …). */
  attempt?: number;
  title: string;
  buyer: string;
  /* Bid documents staged for the run — not the same fact as `bidders` below. */
  bids: number | null;
  /* Distinct firms on the pack. This is what the register column reports. */
  bidders: number | null;
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
  reference?: string;
  status: "RUNNING" | "AWAITING_GATE" | "REJECTED" | "FILED" | "FAILED";
  startedAt: string;
  findings: { id: string; rule: string; item: string; citation: string }[];
  gateId?: string;
  seal?: string | null;
  sealedBy?: string | null;
  /* Set once the review plan is decided: bid documents staged for the run, and
     the distinct firms they belong to (absent on plans persisted before it was). */
  plan?: { pack?: { bids?: number; bidders?: number } } | null;
};

type BackendGate = {
  id: string;
  tenderId: string;
  systemReference?: string;
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
  file_gate_submission: "File approval package",
  record_bid_opening: "Bid opening register",
  certify_evaluation: "Evaluation matrix",
  resolve_alb: "Low bid review",
  sign_award_report: "Award report",
  publish_award_notice: "Notice of award",
  issue_debrief: "Debrief letter",
  sign_contract_pack: "Contract documents",
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
        if (s?.ref) map[s.ref] = { title: s.title || "Tender record", buyer: s.buyer ?? "" };
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
          reference: r.reference,
          uid: r.id,
          attempt: attemptOf.get(r.id),
          title: known?.title ?? "Tender review",
          buyer: known?.buyer ?? "",
          bids: r.plan?.pack?.bids ?? null,
          /* Plans persisted before bidders were recorded fall back to the bid
             count, which was one document per bidder in every pack of that era. */
          bidders: r.plan?.pack?.bidders ?? r.plan?.pack?.bids ?? null,
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
            tender: systemReferenceLabel(g.systemReference),
            title: registry[g.tenderId]?.title ?? "Tender record",
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
          tender: systemReferenceLabel(g.systemReference),
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
  | "mc-findings"
  | "mc-reports"
  | "mc-sources"
  | "mc-ledger"
  | "mc-committee"
  | "mc-governance"
  | "mc-compliance"
  | "mc-readiness"
  | "mc-oversight"
  | "mc-calendar"
  | "mc-suppliers"
  | "mc-integrations"
  | "mc-api"
  | "mc-rules"
  | "mc-stack"
  | "mc-audit"
  | "mc-settings"
  | "mc-walkthrough";

type NavBadge = "runs" | "gates" | "findings";

type NavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: NavBadge;
  href?: string;
  subpages?: readonly { id: CyclePageTab; label: string; group?: string }[];
};

const NAV_GROUPS: {
  group: string;
  /* An item with `href` opens its own URL — a real page, not a section. */
  items: NavItem[];
}[] = [
  {
    group: "Workspace",
    items: [
      { id: "mc-overview", label: "Overview", icon: Gauge },
      { id: "mc-runs", label: "Tender Reviews", icon: Terminal, badge: "runs" },
      { id: "mc-gates", label: "Approvals", icon: Stamp, badge: "gates" },
      { id: "mc-cycle", label: "Tender Workflow", icon: Workflow, subpages: CYCLE_PAGE_PAGES },
    ],
  },
  {
    group: "Review Records",
    items: [
      { id: "mc-findings", label: "Review Findings", icon: ListChecks, badge: "findings" },
      { id: "mc-reports", label: "Reports", icon: Files },
      { id: "mc-sources", label: "Source Records", icon: Database },
    ],
  },
  {
    group: "Administration",
    items: [
      { id: "mc-governance", label: "Roles & Approvals", icon: Landmark },
      { id: "mc-compliance", label: "Compliance Checks", icon: FileCheck2 },
      { id: "mc-readiness", label: "Workspace Readiness", icon: Stamp },
    ],
  },
  {
    group: "Committee",
    items: [
      { id: "mc-ledger", label: "Award History", icon: Gavel },
      { id: "mc-committee", label: "Committee", icon: Users },
      { id: "mc-calendar", label: "Calendar", icon: CalendarDays },
    ],
  },
  {
    group: "Suppliers",
    items: [
      { id: "mc-suppliers", label: "Suppliers", icon: Building2 },
    ],
  },
  {
    group: "System & Integrations",
    items: [
      { id: "mc-stack", label: "System Status", icon: Terminal },
      { id: "mc-integrations", label: "Integrations", icon: Cable },
      { id: "mc-api", label: "API Access", icon: Braces },
    ],
  },
  {
    group: "Records & Settings",
    items: [
      { id: "mc-oversight", label: "Independent Review", icon: Scale },
      { id: "mc-audit", label: "Activity Log", icon: ScrollText },
      { id: "mc-rules", label: "Rules & Controls", icon: ShieldCheck },
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
  "mc-findings": "run_reviews",
  "mc-reports": "run_reviews",
  "mc-sources": "manage_sources",
  "mc-committee": "manage_meetings",
  "mc-calendar": "manage_meetings",
  "mc-suppliers": "manage_suppliers",
  "mc-rules": "manage_rules",
  "mc-oversight": "view_oversight",
  "mc-governance": "view_oversight",
  "mc-readiness": "view_oversight",
  "mc-audit": "read_audit",
  /* Compliance is readable by every desk role — the committee reads the rule
     set before they certify; auditors read it for oversight. Mutations are
     re-checked per route. */
  "mc-compliance": "read_audit",
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

function AgentStatusBadge({ mode, className, darkSurface = false }: { mode: AgentMode; className?: string; darkSurface?: boolean }) {
  const label =
    mode === "online" ? "Review service · online" : mode === "offline" ? "Review service · offline" : "Review service · connecting";
  return (
    <span
      role="status"
      aria-label={`Review service status: ${mode}`}
      className={cn(
        /* shrink-0 + nowrap: the pill is a status instrument, never a widget
           that yields its width — squeezed, it used to wrap onto two lines. */
        "inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 type-micro",
        mode === "online" &&
          (darkSurface
            ? "border-brand-500/35 bg-brand-500/[0.08] text-brand-300"
            : "border-brand-500/30 bg-brand-500/[0.06] text-brand-700 dark:border-brand-500/35 dark:text-brand-300"),
        mode === "offline" &&
          (darkSurface
            ? "border-white/10 bg-white/[0.04] text-ink-300"
            : "border-ink-200 bg-white text-ink-400 dark:border-white/10 dark:bg-white/[0.04]"),
        mode === "linking" &&
          (darkSurface
            ? "border-white/10 bg-white/[0.04] text-ink-300"
            : "border-ink-200 bg-white text-ink-500 dark:border-white/10 dark:bg-white/[0.04]"),
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

/* ── Small pieces ────────────────────────────────────────────────────────── */

/* One chip vocabulary for every run state — same height, same tracking, same
   signal colour meaning as the rest of the product. */
function StatusChip({ status }: { status: RunStatus }) {
  const base =
    "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 font-code text-[10px] font-bold tracking-[0.1em] tabular dark:border-0";
  if (status === "running")
    return (
      <span
        className={cn(
          base,
          "border-brand-500/30 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
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
          "border-ink-200 bg-white text-ink-500 dark:bg-white/[0.04]"
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
          "border-brand-500/40 text-brand-700 transition-colors hover:bg-brand-50 dark:bg-brand-500/10 dark:text-brand-300 dark:hover:bg-brand-500/15"
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
        "border-ink-950 bg-ink-950 text-white dark:bg-white/10"
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
  value: number | null;
  suffix?: string;
  sub: string;
  /* Optional: only rendered when real trend data exists — never a constant
     standing in for data the system does not have. */
  spark?: number[];
  featured?: boolean;
  pulse?: boolean;
  delay: number;
}) {
  const n = useCountUp(value ?? 0);
  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay, ease: EASE }}
      className={cn(
        /* Light mode keeps the editorial band. Dark mode separates the cells
           with tonal surfaces and soft elevation instead of visible rules. */
        "relative h-full overflow-hidden p-5 transition-colors duration-300 dark:rounded-[12px] dark:shadow-[0_14px_34px_-26px_rgba(0,0,0,0.92)] lg:p-6",
        featured
          ? "bg-paper text-ink-950 dark:bg-[#141318] dark:text-white"
          : "bg-paper hover:bg-white dark:bg-[#111318] dark:hover:bg-[#171a20]"
      )}
    >
      {featured && (
        <>
          <div className="pointer-events-none absolute inset-0 hidden bg-[radial-gradient(circle_at_92%_4%,rgba(217,38,22,0.11),transparent_48%)] dark:block" aria-hidden="true" />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-600/70 to-transparent dark:hidden"
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
          {value === null ? "—" : n}
          {suffix && value !== null && (
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
   New records use the neutral system sequence. An identifier printed in a
   source document remains part of that source document; it never replaces
   the reference assigned to a new Quorum record. */

interface RefSeed {
  prefix: string;
  year: number;
  seq: number;
}

/** Parse a Quorum-issued reference: QRM-2026-014. */
function parseRefSeed(raw: string): RefSeed | null {
  const m = raw.trim().toUpperCase().match(/^(QRM)-(\d{4})-(\d{1,6})$/);
  if (!m) return null;
  return { prefix: m[1], year: Number(m[2]), seq: Number(m[3]) };
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

/** A fresh neutral system reference when there is no sequence to continue. */
function freshRef(now = new Date()): string {
  return formatRefSeed({ prefix: "QRM", year: now.getFullYear(), seq: 1 });
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
      <span role="status" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ink-950 px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.06em] text-white">
        <CircleCheck className="h-2.5 w-2.5" aria-hidden="true" />
        READY
      </span>
    );
  if (status === "PARSING")
    return (
      <span role="status" className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.06em] text-brand-700">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" aria-hidden="true" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-600" aria-hidden="true" />
        </span>
        READING
      </span>
    );
  return (
    <span role="status" className="inline-flex shrink-0 items-center rounded-full border border-ink-200 px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.06em] text-ink-600">
      ADDED
    </span>
  );
}

/* Show whether a document is in cloud storage or the local vault. */
function StorageChip({ storage }: { storage: NonNullable<StagedDoc["storage"]> }) {
  if (storage === "SYNCING")
    return (
      <span role="status" aria-label="Saving to cloud storage" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.06em] text-brand-700">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" aria-hidden="true" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-600" aria-hidden="true" />
        </span>
        SAVING
      </span>
    );
  if (storage === "CLOUD")
    return (
      <span role="status" aria-label="Saved to cloud storage" className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ink-200 bg-white px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.06em] text-ink-600">
        <CloudUpload className="h-2.5 w-2.5" aria-hidden="true" />
        CLOUD SAVED
      </span>
    );
  return (
    <span role="status" aria-label="Saved in the local vault" className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ink-200 bg-white px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.06em] text-ink-600">
      <HardDrive className="h-2.5 w-2.5" aria-hidden="true" />
      LOCAL VAULT
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
  onLaunch: (ref: string, title: string, format: string, docs: number, checks: number, sourceRef?: string) => void;
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
  const [sampleSourceRef, setSampleSourceRef] = useState("");
  /* Where the current ref/title draft came from — shown inline, cleared the
     moment the officer edits (then it's theirs, not a suggestion). */
  const [refSource, setRefSource] = useState<"" | "assigned" | "sample">("");
  const [titleSource, setTitleSource] = useState<"" | "document" | "sample">("");
  const titleTouchedRef = useRef(false);
  const refInputRef = useRef<HTMLInputElement>(null);
  const refIssueRef = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
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
    if (!open) {
      refIssueRef.current += 1;
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (target?.isConnected) requestAnimationFrame(() => target.focus());
      return;
    }
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? active : null;
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
      setSampleSourceRef("");
      titleTouchedRef.current = false;
      /* Autofill the reference the instant the modal opens — the register's
         system sequence is the source of truth; local history is a fallback. */
      const refs = pastRefsRef.current;
      const next = nextRefFrom(refs);
      setRef(next ?? freshRef());
      setRefSource("assigned");
      const requestId = ++refIssueRef.current;
      void fetch("/api/pipeline/next-ref?XTransformPort=3031", { cache: "no-store" })
        .then((response) => response.json())
        .then((data: { ref?: string }) => {
          const seed = data.ref ? parseRefSeed(data.ref) : null;
          if (requestId !== refIssueRef.current || !seed) return;
          setRef(formatRefSeed(seed));
          setRefSource("assigned");
        })
        .catch(() => {
          /* Keep the local QRM fallback if the register cannot be reached. */
        });
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
      if (e.key !== "Escape" || launching) return;
      const focusedModal = document.activeElement?.closest('[role="dialog"][aria-modal="true"]');
      /* A nested modal is the top sheet; let it consume Escape first. */
      if (focusedModal && focusedModal !== dialogRef.current) return;
      onClose();
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

  /* Source identifiers stay with their documents. New Quorum records keep
     the system-issued reference shown above the staged pack. */
  const adoptFromDocs = (names: string[]) => {
    if (!titleTouchedRef.current) {
      const draft = draftTitleFrom(names);
      if (draft) {
        setTitle(draft);
        setTitleSource("document");
      }
    }
  };

  /* Keep the Quorum ID in the reference field; the source key stays internal
     so the review can still read the bundled fixture documents. */
  const stageSample = (s: SampleTenderRow) => {
    setSampleSourceRef(s.ref);
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
       vault — never an error. Store it under the system-issued tender ID. */
    const uploadRef = sampleSourceRef.trim() || ref.trim() || "UNREFERENCED";
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
          : "Saved in this browser — cloud storage is unavailable";
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

  const trapDialogTab = (e: ReactKeyboardEvent<HTMLDivElement>) => trapTabFocus(e, dialogRef.current);

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
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-evaluation-title"
            tabIndex={-1}
            initial={{ opacity: 0, y: 26, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.98 }}
            transition={{ duration: 0.32, ease: EASE }}
            className="max-h-[min(92dvh,900px)] w-full max-w-3xl overflow-y-auto rounded-[12px] panel panel-lift p-5 sm:rounded-[16px] sm:p-8 lg:p-10"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={trapDialogTab}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-2.5 font-code text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-600">
                  <span className="inline-block h-[2px] w-6 bg-brand-600" aria-hidden="true" />
                  DOCUMENT REVIEW
                </p>
                <h2 id="new-evaluation-title" className="mt-3 font-display text-[28px] font-black tracking-[-0.035em] text-ink-950 sm:text-[36px]">
                  Start a document review<span className="text-brand-600">.</span>
                </h2>
                <p className="mt-1.5 max-w-lg text-[12.5px] leading-relaxed text-ink-500 sm:text-[13px]">
                  Stage source documents and choose which checks to run. For bidder scoring and recommendations, use Tender workflow → Bid evaluation.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!launching) onClose();
                }}
                disabled={launching}
                aria-label="Close"
                className="focus-brand grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-ink-200 text-ink-500 transition-colors hover:border-ink-400 hover:bg-ink-50 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-50 sm:h-12 sm:w-12"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* Step rail — 01 details · 02 documents · 03 scope */}
            <div data-tour="wiz-rail" className="mt-6 rounded-[10px] border border-ink-100 bg-paper/70 px-3 py-3 sm:mt-7 sm:px-5 sm:py-4">
              <ol className="flex items-center gap-2 sm:gap-3" aria-label="Document review setup, three steps">
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
                        "flex min-h-11 min-w-0 items-center gap-1.5 font-code text-[10px] font-bold tracking-[0.04em] transition-colors sm:gap-2 sm:text-[10.5px] sm:tracking-[0.06em]",
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
                            "grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[10px]",
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
                    setDetailsError("A system reference and the published tender title are needed to continue.");
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
                  await onLaunch(ref.trim(), title.trim(), format, docs.length, checksOn, sampleSourceRef || undefined);
                } catch (error) {
                  setLaunchError(error instanceof Error ? error.message : "This tender review could not be started. Please try again.");
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
                        <p className="font-code text-[10px] font-bold tracking-[0.12em] text-brand-700">01 / TENDER DETAILS</p>
                        <p className="mt-1 text-[12px] leading-relaxed text-ink-600">Identify the procurement record the committee and audit trail will refer to.</p>
                      </div>
                      <div>
                        <label htmlFor="nr-ref" className="mb-1.5 block font-code text-[10.5px] font-semibold tracking-[0.12em] text-ink-600">
                          TENDER REFERENCE <span className="text-brand-600" aria-hidden="true">*</span>
                        </label>
                        <input
                          id="nr-ref"
                          ref={refInputRef}
                          type="text"
                          value={ref}
                          readOnly
                          aria-readonly="true"
                          placeholder="e.g. QRM-2026-014"
                          autoComplete="off"
                          aria-required="true"
                          aria-invalid={Boolean(detailsError && !ref.trim())}
                          className="h-12 w-full rounded-xl border border-ink-200 bg-white px-4 font-code text-base tracking-[0.04em] text-ink-900 outline-none transition-all placeholder:font-sans placeholder:tracking-normal placeholder:text-ink-400 read-only:cursor-default read-only:focus:ring-0 read-only:focus:ring-offset-0 sm:h-[52px] sm:text-[13px]"
                        />
                        {refSource !== "" && !detailsError && (
                          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] leading-relaxed text-ink-600" aria-live="polite">
                            <CircleCheck className="h-2.5 w-2.5 text-brand-600" aria-hidden="true" />
                            {refSource === "assigned" && "ASSIGNED BY QUORUM — SYSTEM REFERENCE · LOCKED"}
                            {refSource === "sample" && "SAMPLE PACK SELECTED — QUORUM SYSTEM REFERENCE RETAINED · LOCKED"}
                          </p>
                        )}
                      </div>
                      <div>
                        <label htmlFor="nr-title" className="mb-1.5 block font-code text-[10.5px] font-semibold tracking-[0.12em] text-ink-600">
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
                          className="h-12 w-full rounded-xl border border-ink-200 bg-white px-4 text-base text-ink-900 outline-none transition-all placeholder:text-ink-400 focus:border-ink-950 focus:ring-2 focus:ring-ink-950/10 sm:h-[52px] sm:text-[13.5px]"
                        />
                        {titleSource === "sample" && (
                          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] leading-relaxed text-ink-600" aria-live="polite">
                            <CircleCheck className="h-2.5 w-2.5 text-brand-600" aria-hidden="true" />
                            SAMPLE PACK TITLE — LOADED · EDIT FREELY
                          </p>
                        )}
                        {titleSource === "document" && (
                          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] leading-relaxed text-ink-600" aria-live="polite">
                            <CircleCheck className="h-2.5 w-2.5 text-brand-600" aria-hidden="true" />
                            DRAFTED FROM THE STAGED PACK — REPLACE WITH THE PUBLISHED TITLE
                          </p>
                        )}
                      </div>
                      <div>
                        <div className="mb-2 flex items-end justify-between gap-3">
                          <div>
                            <p className="font-code text-[10.5px] font-semibold tracking-[0.12em] text-ink-600">SOURCE FORMAT</p>
                            <p className="mt-1 text-[11.5px] text-ink-400">Choose how the tender information is provided.</p>
                          </div>
                          <span className="font-code text-[10px] font-semibold tracking-[0.08em] text-ink-500">REQUIRED</span>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3" role="group" aria-label="Source format">
                          {[
                            { id: "OCDS", label: "Open Contracting Data (OCDS)" },
                            { id: "PDF PACK", label: "Tender document pack" },
                            { id: "EMAIL BAG", label: "Email files" },
                          ].map(({ id, label }) => (
                            <button
                              key={id}
                              type="button"
                              onClick={() => setFormat(id)}
                              aria-pressed={format === id}
                              className={cn(
                                "flex min-h-12 items-center justify-center gap-2 rounded-xl border px-3 font-code text-[10.5px] font-bold tracking-[0.08em] transition-all sm:min-h-[54px] sm:text-[11px] sm:tracking-[0.1em]",
                                format === id
                                  ? "border-ink-950 bg-ink-950 text-white shadow-[0_6px_16px_rgba(11,12,15,0.14)]"
                                  : "border-ink-200 bg-white text-ink-500 hover:border-ink-400 hover:bg-paper"
                              )}
                            >
                              {format === id && <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                              {label}
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
                            <span className="font-code text-[10.5px] font-bold tracking-[0.12em] text-ink-900">SAMPLE TENDER</span>
                          </span>
                          <span className="flex items-center gap-2 font-code text-[10px] tracking-[0.08em] text-ink-500">
                            {samples.length > 0 && `${samples.length} PACKS`}
                            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-300", samplesOpen && "rotate-180")} aria-hidden="true" />
                          </span>
                        </button>
                        <p className="mt-1.5 text-[11.5px] text-ink-400">
                          Example tender packs are available for a practice review. Each pack is clearly identified before you start.
                        </p>
                        {samplesOpen && (
                          <div className="mt-2.5 space-y-2 rounded-xl border border-ink-100 bg-paper/60 p-2.5" role="list" aria-label="Sample tenders">
                            {samples.length === 0 && (
                              <p className="px-2 py-3 text-center text-[11px] leading-relaxed text-ink-600">
                                Example packs could not be loaded. Please try again shortly.
                              </p>
                            )}
                            {samples.map((s) => (
                              <div
                                key={s.ref}
                                role="listitem"
                                className="block w-full rounded-lg border border-ink-100 bg-white px-3.5 py-3 transition-all hover:border-brand-400 hover:shadow-[0_2px_10px_rgba(217,38,22,0.07)]"
                              >
                                <span className="flex flex-wrap items-center gap-2">
                                  <span className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-600">PRACTICE EXAMPLE</span>
                                  <span className="rounded-full bg-ink-950 px-2 py-0.5 font-code text-[10px] font-bold tracking-[0.04em] text-white">{s.sector}</span>
                                  <span className="ml-auto font-code text-[10px] tracking-normal text-ink-600">{s.budget} · {s.bids} BIDDERS</span>
                                </span>
                                <span className="mt-1 block truncate text-[12.5px] font-medium text-ink-800">{s.title}</span>
                                <span className="mt-1 block text-[11.5px] leading-relaxed text-ink-500">{s.challenges}</span>
                                <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-2">
                                  <button
                                    type="button"
                                    onClick={() => setPreviewSample(s)}
                                    aria-label={`Preview the full contents of ${s.title}`}
                                    className="focus-brand inline-flex min-h-11 items-center gap-1.5 rounded-md border border-ink-200 px-3 py-2 font-code text-[10px] font-bold tracking-[0.06em] text-ink-700 transition-colors hover:border-ink-500 hover:bg-ink-50"
                                  >
                                    <Eye className="h-3 w-3" aria-hidden="true" />
                                    PREVIEW EXAMPLE
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      stageSample(s);
                                      requestAnimationFrame(() => refInputRef.current?.focus());
                                    }}
                                    className="focus-brand inline-flex min-h-11 items-center gap-1.5 rounded-md border border-brand-200 px-3 py-2 font-code text-[10px] font-bold tracking-[0.06em] text-brand-700 transition-colors hover:border-brand-400 hover:bg-brand-50"
                                  >
                                    <Plus className="h-2.5 w-2.5" aria-hidden="true" />
                                    USE THIS EXAMPLE
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
                        onReturnFocusFallback={() => refInputRef.current?.focus()}
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
                        <p className="font-code text-[10px] font-bold tracking-[0.12em] text-brand-700">02 / TENDER DOCUMENTS</p>
                        <p className="mt-1 text-[12px] leading-relaxed text-ink-600">Add the tender notice and bids. We’ll check each file before the review begins.</p>
                      </div>
                      <div>
                        <div className="flex items-baseline justify-between gap-3">
                          <p id="nr-files-label" className="font-code text-[10.5px] font-semibold tracking-[0.12em] text-ink-600">TENDER DOCUMENTS</p>
                          <p className="font-code text-[10px] tracking-[0.06em] text-ink-600" aria-live="polite">
                            {docs.length === 0
                              ? "NO DOCUMENTS ADDED"
                              : `READY ${indexed} OF ${docs.length}${cloudSynced > 0 ? ` · ${cloudSynced} SAVED TO CLOUD` : ""}`}
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
                          role="group"
                          aria-labelledby="nr-files-label"
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
                            aria-hidden="true"
                            tabIndex={-1}
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
                          <p id="nr-files-help" className="mt-2 text-[11px] leading-relaxed text-ink-600">
                            NOTICES · BIDS · PRICING SHEETS · EMAILS · OPEN CONTRACTING DATA — UP TO 12 FILES
                          </p>
                          <p id="nr-files-storage" className="mt-1.5 text-[11px] leading-relaxed text-ink-600">
                            FILES ARE SAVED TO CLOUD STORAGE WHEN AVAILABLE · UP TO 10 MB EACH
                          </p>
                          <button
                            type="button"
                            aria-label="Browse tender source files"
                            aria-describedby="nr-files-help nr-files-storage"
                            onClick={() => fileInputRef.current?.click()}
                            className="focus-brand mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-ink-950 px-4 font-code text-[10.5px] font-bold tracking-[0.08em] text-white transition-colors hover:bg-brand-600"
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
                                    <span className="mt-0.5 block truncate text-[11px] leading-relaxed text-ink-600">{d.note}</span>
                                  )}
                                </span>
                                <span className="shrink-0 font-code text-[10px] tracking-normal text-ink-600">{d.size}</span>
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
                                    className="focus-brand grid h-11 w-11 shrink-0 place-items-center rounded-md text-ink-400 transition-colors hover:bg-brand-50 hover:text-brand-700"
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
                                  className="focus-brand grid h-11 w-11 shrink-0 place-items-center rounded-md text-ink-400 transition-colors hover:bg-brand-50 hover:text-brand-700"
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
                        <p className="font-code text-[10px] font-bold tracking-[0.12em] text-brand-700">03 / REVIEW SCOPE</p>
                        <p className="mt-1 text-[12px] leading-relaxed text-ink-600">Choose which checks to include. Every finding will include its page or source reference.</p>
                      </div>
                      <div>
                        <p className="font-code text-[10.5px] font-semibold tracking-[0.12em] text-ink-600">SCOPE OF REVIEW</p>
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
                          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-600">
                            EVERY CLAIM CARRIES A PAGE, CLAUSE OR REGISTRY ID. NO EXCEPTIONS.
                          </p>
                        </div>
                      </div>
                      <p className="rounded-xl bg-paper px-4 py-3 text-center text-[12px] font-semibold leading-relaxed text-ink-800">
                        {docs.length} DOCUMENT{docs.length === 1 ? "" : "S"}
                        {cloudSynced > 0 ? ` · ${cloudSynced} IN CLOUD STORAGE` : ""} · {checksOn} CHECK{checksOn === 1 ? "" : "S"} · ABOUT {estMinutes} MIN
                      </p>
                      {checksOn === 0 && (
                        <p role="status" className="text-center text-[11.5px] text-brand-700">Select at least one check to start the review.</p>
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
                  {step === 2 && (launching ? "Starting your review…" : "Start review")}
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
                <p role="status" className="mt-2.5 text-center text-[11.5px] font-medium leading-relaxed text-brand-800">
                  STAGE AT LEAST ONE DOCUMENT — DROP A FILE TO CONTINUE
                </p>
              )}
              {step === 1 && docs.length > 0 && !canLeaveDocs && (
                <p role="status" className="mt-2.5 text-center text-[11.5px] font-medium leading-relaxed text-brand-800">
                  WAIT FOR EVERY DOCUMENT TO FINISH INDEXING BEFORE CONTINUING
                </p>
              )}
              <p className="mt-4 text-center text-[11.5px] leading-relaxed text-ink-600">
                Quorum organizes the review. The committee retains authority over the award.
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
  activeCyclePage,
  user,
  counts,
  agent,
  onNavigate,
  onNavigateCyclePage,
  onSignOut,
  onExit,
}: {
  active: SectionId;
  activeCyclePage: CyclePageTab;
  user: AuthUser | null;
  counts: { runs: number; gates: number; findings: number };
  agent: AgentStatus;
  onNavigate: (id: SectionId) => void;
  onNavigateCyclePage: (page: CyclePageTab) => void;
  onSignOut: () => void;
  onExit: () => void;
}) {
  const cycleSubpagesId = `mc-cycle-subpages-${useId().replace(/:/g, "")}`;
  return (
    <div className="flex h-full flex-col">
      <div className="relative flex items-center overflow-hidden px-5 pb-5 pt-6">
        <button
          type="button"
          onClick={onExit}
          aria-label="Quorum home"
          title="Return to the landing page"
          className="focus-brand relative z-10 inline-flex rounded-xl border-0 bg-transparent p-0 text-left"
        >
          <QuorumLogo variant="light" />
        </button>
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
              <span className="font-code text-[11px] font-semibold tracking-[0.14em] text-ink-400">
                {group.group}
              </span>
              <span className="h-px flex-1 bg-white/[0.055]" aria-hidden="true" />
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = active === item.id;
                const badge = item.badge ? counts[item.badge] : null;
                /* Bound once so the nested render callbacks keep the narrowing. */
                const subpages = item.subpages;
                const itemClass = cn(
                  "focus-brand group relative flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-[background-color,color] duration-200",
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
                          className="h-4 w-4 shrink-0 text-ink-400 transition-colors group-hover:text-ink-200"
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
                        aria-current={isActive ? (item.subpages?.length ? "location" : "page") : undefined}
                        aria-expanded={item.subpages?.length ? isActive : undefined}
                        aria-controls={item.subpages?.length ? cycleSubpagesId : undefined}
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
                            "h-4 w-4 shrink-0 transition-colors",
                            isActive ? "text-brand-400" : "text-ink-400 group-hover:text-ink-200"
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
                              "grid h-5 min-w-5 place-items-center rounded-full px-1.5 font-code text-[10px] font-bold tabular",
                              item.id === "mc-gates"
                                ? "bg-brand-600 text-white shadow-[0_0_12px_rgba(232,56,42,0.45)]"
                                : "bg-white/[0.09] text-ink-200 ring-1 ring-inset ring-white/10"
                            )}
                          >
                            {badge}
                          </span>
                        )}
                        {item.subpages?.length ? (
                          <ChevronDown
                            className={cn("h-3.5 w-3.5 shrink-0 text-ink-500 transition-transform duration-200", isActive && "rotate-180 text-ink-300")}
                            aria-hidden="true"
                          />
                        ) : null}
                      </button>
                    )}
                    {!item.href && subpages?.length ? (
                      <ul
                        id={cycleSubpagesId}
                        className={cn("ml-[18px] mt-1.5 space-y-1 border-l border-white/[0.14] pl-2.5", !isActive && "hidden")}
                        aria-label="Tender Cycle pages"
                      >
                        {subpages.map((page, pageIndex) => {
                          const pageActive = activeCyclePage === page.id;
                          const pageOrdinal = page.group
                            ? subpages.slice(0, pageIndex).filter((candidate) => candidate.group === page.group).length + 1
                            : pageIndex + 1;
                          const groupStartsHere = page.group && subpages[pageIndex - 1]?.group !== page.group;
                          return (
                            <li key={page.id}>
                              {groupStartsHere ? (
                                <p className="flex items-center gap-2 px-2 pb-1.5 pt-3 font-code text-[11px] font-bold tracking-[0.08em] text-ink-300">
                                  <span>{page.group}</span>
                                  <span className="h-px flex-1 bg-white/[0.1]" aria-hidden="true" />
                                </p>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => onNavigateCyclePage(page.id)}
                                aria-current={pageActive ? "page" : undefined}
                                className={cn(
                                  "focus-brand group relative flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-[background-color,color,box-shadow] duration-200",
                                  pageActive
                                    ? "bg-gradient-to-r from-brand-500/[0.18] to-brand-500/[0.07] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ring-1 ring-inset ring-brand-400/20"
                                    : "text-ink-300 hover:bg-white/[0.055] hover:text-white",
                                )}
                              >
                                {pageActive ? (
                                  <span
                                    className="absolute -left-[11px] top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-brand-400 shadow-[0_0_10px_rgba(240,107,92,0.65)]"
                                    aria-hidden="true"
                                  />
                                ) : null}
                                <span
                                  className={cn(
                                  "w-6 shrink-0 font-code text-[10px] font-bold tabular",
                                  pageActive ? "text-brand-300" : "text-ink-300 group-hover:text-white",
                                  )}
                                  aria-hidden="true"
                                >
                                  {String(pageOrdinal).padStart(2, "0")}
                                </span>
                                <span className="truncate text-[12.5px] font-medium tracking-[-0.01em]">{page.label}</span>
                                {pageActive ? <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400 shadow-[0_0_8px_rgba(240,107,92,0.6)]" aria-hidden="true" /> : null}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/[0.07] px-3 pb-5 pt-4">
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
            <span className="block truncate font-code text-[10px] leading-snug tracking-[0.06em] text-ink-400">
              {user?.role ? `${ROLE_LABELS[user.role]} · ${user.email}` : "Not Signed In"}
            </span>
          </span>
          <button
            type="button"
            onClick={onSignOut}
            aria-label="Sign out"
            title="Sign out"
            className="focus-brand grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          onClick={onExit}
          className="focus-brand mt-1 flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-2 font-code text-[11px] font-semibold tracking-[0.1em] text-ink-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          Back To Site
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

  /* One tender, one bidder set: five reviews of the same pack are five runs but
     still three bidders — so the header total is taken per tender, never per run. */
  const biddersByTender = new Map<string, number>();
  for (const r of filtered) {
    if (r.bidders === null) continue;
    biddersByTender.set(r.id, Math.max(biddersByTender.get(r.id) ?? 0, r.bidders));
  }
  const totalBidders = [...biddersByTender.values()].reduce((n, v) => n + v, 0);

  return (
    <section id="mc-runs" aria-labelledby="mc-runs-h" className="scroll-mt-24">
      <motion.div
        data-tour="run-register"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15, ease: EASE }}
        className="overflow-hidden rounded-[12px] panel dark:border-0 dark:shadow-[0_24px_60px_-42px_rgba(0,0,0,0.96)]"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200/70 px-5 py-4 dark:border-b-0">
          <div>
            <h2 id="mc-runs-h" className="type-title text-ink-950">
              Recent tender reviews
              <span className="ml-2 inline-flex translate-y-[-1px] items-center rounded-full border border-ink-200/70 bg-paper-2/80 px-2 py-1 align-middle font-code text-[10px] font-bold tracking-[0.06em] text-ink-500 dark:border-0 dark:bg-white/[0.06] dark:text-ink-300">
                {totalBidders} BIDDERS
              </span>
            </h2>
            <p className="mt-1 type-micro text-ink-400">
              {runDateLabel(dateWindow)} · {filtered.length} of {runs.length} reviews
            </p>
          </div>
          <div
            data-tour="run-filters"
            role="group"
            aria-label="Filter tender reviews"
            className="grid grid-cols-2 gap-1 rounded-2xl border border-ink-200/70 bg-paper-2/70 p-1 dark:border-0 dark:bg-white/[0.045] sm:flex sm:rounded-full"
          >
            {RUN_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onFilter(f.id)}
                aria-pressed={filter === f.id}
                className={cn(
                  "focus-brand relative inline-flex h-11 items-center justify-center whitespace-nowrap rounded-full px-3 font-code text-[10px] font-bold tracking-[0.08em] transition-colors duration-200",
                  filter === f.id
                    ? "text-white"
                    : "text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white"
                )}
              >
                {filter === f.id && (
                  <motion.span
                    layoutId="run-filter-ink"
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full bg-ink-950 dark:bg-white/[0.11]"
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
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-200/70 px-5 py-3 dark:border-b-0">
          <label className="relative block w-full min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400 dark:text-[#a8adb7]"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Search by reference, title or buyer…"
              aria-label="Search tender reviews by reference, title or buyer"
              className="focus-brand h-11 w-full rounded-lg border border-ink-200/80 bg-[#fffdfb] pl-9 pr-3.5 text-[12.5px] text-ink-900 shadow-[inset_0_1px_1px_rgba(11,12,15,0.03)] outline-none transition-[border-color,background-color] duration-300 placeholder:text-ink-400 focus:border-ink-950 focus:ring-[3px] focus:ring-ink-950/[0.07] dark:border-0 dark:bg-white/[0.035] dark:shadow-[inset_0_1px_3px_rgba(0,0,0,0.42)] dark:focus:bg-white/[0.055] dark:focus:ring-white/[0.09]"
            />
          </label>
          <label className="relative inline-flex h-11 shrink-0 items-center">
            <span className="sr-only">Filter evaluations by date</span>
            <select
              value={dateWindow}
              onChange={(e) => setDateWindow(e.target.value as RunDateWindow)}
              aria-label="Filter tender reviews by date"
              className="focus-brand h-11 appearance-none rounded-lg border border-ink-200/80 bg-[#fffdfb] pl-3 pr-8 font-code text-[10px] font-bold tracking-[0.08em] text-ink-600 outline-none transition-colors focus:border-ink-950 focus:ring-[3px] focus:ring-ink-950/[0.07] dark:border-0 dark:bg-white/[0.035] dark:text-ink-300 dark:focus:bg-white/[0.055] dark:focus:ring-white/[0.09]"
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
              aria-label="Clear tender review search"
              className="focus-brand inline-flex h-11 items-center rounded-md px-2.5 font-code text-[10px] font-bold tracking-[0.08em] text-ink-500 transition-colors hover:text-ink-950"
            >
              CLEAR
            </button>
          )}
          <span
            aria-live="polite"
            className="ml-auto shrink-0 font-code text-[10px] font-bold tracking-[0.08em] text-ink-400 tabular"
          >
            {filtered.length} OF {runs.length} RESULTS
          </span>
        </div>

        {/* Table */}
        <HorizontalScrollRegion
          label="Recent tender reviews table"
          hint="Swipe or scroll the table to see bidder, status and time columns."
          hintClassName="sm:hidden"
          data-tour="run-rows"
        >
          <table className="w-full min-w-[720px] border-collapse text-left">
            <caption className="sr-only">Recent tender reviews with their findings, bidder count, status, time and expandable details</caption>
            <thead>
              <tr className="border-b border-ink-200/70 bg-paper-2/70 dark:border-b-0 dark:bg-white/[0.025]">
                {["Tender", "Issues", "No. of bidders", "Status", "Time", "Details"].map((h, i) => (
                  <th
                    key={i}
                    scope="col"
                    className={cn(
                      "px-4 py-3 type-micro font-semibold text-ink-400",
                      i === 0 && "pl-5 text-left",
                      i === 1 && "w-[104px] text-center",
                      i === 2 && "w-[168px] whitespace-nowrap text-center",
                      i === 3 && "w-[186px] text-center",
                      i === 4 && "w-[92px] text-center",
                      i === 5 && "w-[88px] text-center"
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((run) => {
                const runKey = run.uid ?? run.id;
                const detailsId = `evaluation-details-${encodeURIComponent(runKey)}`;
                const isOpen = expanded === runKey;
                const notesFor = notes[run.id] ?? [];
                return (
                  <Fragment key={runKey}>
                    <tr
                      className={cn(
                        "cursor-pointer border-b border-ink-100/70 transition-colors last:border-b-0 hover:bg-paper-2/60 dark:border-b-0 dark:bg-white/[0.012] dark:hover:bg-white/[0.035]",
                        isOpen && "bg-paper-2/50 dark:bg-white/[0.05]"
                      )}
                      onClick={() => setExpanded(!isOpen ? runKey : null)}
                    >
                      <td className="min-w-[260px] py-3.5 pl-5 pr-4 align-top">
                        <p className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-950">
                          {run.reference ?? run.id}
                          {run.attempt && run.attempt > 1 ? (
                              <span className="ml-2 rounded bg-ink-100 px-1.5 py-1 text-[10px] tracking-[0.04em] text-ink-500">
                              REVIEW {run.attempt}
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 max-w-[440px] whitespace-normal break-words text-[12.5px] font-medium leading-snug text-ink-600">{run.title}</p>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {run.findings > 0 ? (
                          <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-brand-700 tabular">
                            <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                            {run.findings}
                          </span>
                        ) : (
                          <span className="text-[13px] text-ink-400 tabular">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-center text-[13px] font-semibold text-ink-800 tabular">
                        {run.bidders !== null ? run.bidders : <span className="text-ink-400">—</span>}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <StatusChip status={run.status} />
                      </td>
                      <td className="px-4 py-3.5 text-center font-code text-[10px] tracking-[0.08em] text-ink-500 tabular">
                        {run.startedAt}
                      </td>
                      <td className="pr-4 text-center">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-controls={isOpen ? detailsId : undefined}
                          aria-label={`${isOpen ? "Hide" : "Show"} details for ${run.reference ?? run.id}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setExpanded(!isOpen ? runKey : null);
                          }}
                          className="focus-brand inline-flex h-11 w-11 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900 dark:text-ink-400 dark:hover:bg-white/[0.07] dark:hover:text-white"
                        >
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 transition-transform duration-300",
                              isOpen && "rotate-180"
                            )}
                            aria-hidden="true"
                          />
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr id={detailsId} className="border-b border-ink-100 bg-paper dark:border-b-0 dark:bg-transparent">
                        <td colSpan={6} className="px-5 py-4">
                          <div className="rounded-xl border border-ink-100 bg-white p-4 dark:border-0 dark:bg-white/[0.025]">
                            {run.status === "running" || run.status === "queued" ? (
                              <p className="text-[13px] leading-relaxed text-ink-600">
                                <span className="font-semibold text-ink-900">
                                  Review in progress — checking the documents you added.
                                </span>{" "}
                                Findings will appear when the review is complete, each with its page or source reference.
                                An authorized officer must approve any award.
                              </p>
                            ) : (
                              <>
                                <p className="font-code text-[10px] font-semibold tracking-[0.04em] text-ink-600">
                                  TOP ISSUES · {run.findings} FOUND · {run.citations} WITH SOURCES · {run.unsourced} WITHOUT A SOURCE
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
                                      +{run.findings - notesFor.length} MORE IN THE REVIEW REPORT
                                    </li>
                                  )}
                                </ul>
                              </>
                            )}
                            {/* A pack ingested at launch follows the run everywhere */}
                            {typeof run.docs === "number" && (
                              <p className="mt-3 font-code text-[10px] tracking-[0.04em] text-ink-600">
                                REVIEW DOCUMENTS · {run.docs} READY
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
                                    onToast("THIS REVIEW REPORT IS UNAVAILABLE — PLEASE REFRESH THE LIST");
                                    return;
                                  }
                                  onToast(
                                    `DOWNLOADING REVIEW REPORT — ${run.reference ?? run.id}`
                                  );
                                  fetch(`/api/runs/${encodeURIComponent(run.uid)}/report?XTransformPort=3031`)
                                    .then(async (res) => {
                                      if (!res.ok) throw new Error(`HTTP ${res.status}`);
                                      const blob = await res.blob();
                                      const m = (res.headers.get("content-disposition") ?? "").match(/filename="?([^";]+)"?/);
                                      const url = URL.createObjectURL(blob);
                                      const a = document.createElement("a");
                                      a.href = url;
                                      a.download = m?.[1] ?? `quorum-report-${run.reference ?? run.id}-${run.uid}.md`;
                                      document.body.appendChild(a);
                                      a.click();
                                      a.remove();
                                      URL.revokeObjectURL(url);
                                      onToast(`REPORT DOWNLOADED — ${run.reference ?? run.id}`);
                                    })
                                    .catch(() => onToast("REPORT COULD NOT BE DOWNLOADED — REVIEW SERVICE UNAVAILABLE"));
                                }}
                                className="focus-brand inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-ink-950 px-3 font-code text-[10px] font-bold tracking-[0.08em] text-white transition-colors hover:bg-brand-600"
                              >
                                <Download className="h-3 w-3" aria-hidden="true" />
                                DOWNLOAD REVIEW REPORT
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const log = `quorum audit — ${run.reference ?? run.id} — ${run.findings} findings · ${run.citations} citations · ${sealText(run)}`;
                                  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(log).catch(() => undefined);
                                  onToast("AUDIT TRAIL COPIED TO CLIPBOARD");
                                }}
                                className="focus-brand inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-ink-200 px-3 font-code text-[10px] font-bold tracking-[0.08em] text-ink-600 transition-colors hover:border-ink-400 hover:text-ink-900"
                              >
                                <Copy className="h-3 w-3" aria-hidden="true" />
                                COPY AUDIT TRAIL
                              </button>
                              <span className="ml-auto font-code text-[10px] tracking-[0.05em] text-ink-600">
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
                        ? `NO REVIEWS MATCH “${query.trim().toUpperCase()}”`
                        : `NO REVIEWS IN ${runDateLabel(dateWindow)}`}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        onQuery("");
                        onFilter("all");
                        setDateWindow("all");
                      }}
                      className="mt-3 inline-flex h-11 items-center rounded-lg border border-ink-200 px-3.5 text-[12px] font-semibold text-ink-600 transition-colors hover:border-ink-400"
                    >
                      Clear search, filters & dates
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </HorizontalScrollRegion>
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
      role="region"
      aria-label="Committee attendance requirement"
      className={cn(
        "border-b px-5 py-4",
        met
          ? "border-ink-200/70 bg-paper/60 dark:border-white/10"
          : "border-brand-500/25 bg-brand-500/[0.035]"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-code text-[10px] font-bold tracking-[0.1em] text-ink-600">
          <Users className="h-3 w-3" aria-hidden="true" />
          REQUIRED ATTENDANCE
        </p>
        <span
          className={cn(
            "tabular rounded-full border px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.06em]",
            met
              ? "border-ink-950 bg-ink-950 text-white dark:border-white/20"
              : "border-brand-500/40 bg-white text-brand-700 dark:bg-brand-950/30 dark:text-brand-300"
          )}
        >
          {presentCount} OF {quorum.required} REQUIRED
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {Array.from({ length: seats }).map((_, i) => (
          <span
            key={i}
            aria-hidden="true"
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
            "ml-2 font-code text-[10px] font-bold tracking-[0.06em]",
            met ? "text-ink-950 dark:text-white" : "text-brand-700 dark:text-brand-300"
          )}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {met ? "REQUIREMENT MET" : `${short} MORE NEEDED`}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-[12px] leading-relaxed text-ink-600 dark:text-ink-300">
          {met
            ? "Required attendance is met. The committee can record its decision."
            : "Required attendance has not been met. Decisions remain unavailable until enough committee members are present."}
        </p>
        {onOpenRoll && (
          <button
            type="button"
            onClick={onOpenRoll}
            className="focus-brand inline-flex min-h-11 items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 py-2 font-code text-[10px] font-bold tracking-[0.06em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950 dark:border-white/15 dark:bg-transparent dark:text-ink-300 dark:hover:border-white/40 dark:hover:text-white"
          >
            OPEN THE ROLL
            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
      </div>

      <details className="mt-2.5">
        <summary className="focus-brand inline-flex min-h-11 cursor-pointer items-center rounded-md px-1 font-code text-[10px] font-bold tracking-[0.06em] text-ink-600 transition-colors hover:text-ink-900 dark:text-ink-300 dark:hover:text-white">
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
                  "shrink-0 font-code text-[10px] font-bold tracking-[0.06em]",
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
            <li className="text-[11px] leading-relaxed text-ink-600 dark:text-ink-400">No members are on the roll.</li>
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
              "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 font-code text-[10px] font-bold tracking-[0.04em] tabular",
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
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400 dark:text-[#a8adb7]"
              aria-hidden="true"
            />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by reference, title, supplier or office…"
              aria-label="Search approvals by reference, title, supplier or office"
              className="focus-brand h-11 w-full rounded-lg border border-ink-200/80 bg-[#fffdfb] pl-9 pr-3.5 text-base text-ink-900 shadow-[inset_0_1px_1px_rgba(11,12,15,0.03)] outline-none transition-[border-color,background-color] duration-300 placeholder:text-ink-400 focus:border-ink-950 focus:ring-[3px] focus:ring-ink-950/[0.07] dark:border-white/[0.1] dark:bg-white/[0.04] dark:focus:border-white/35 dark:focus:ring-white/[0.06]"
            />
          </label>
          {needle && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="focus-brand inline-flex min-h-11 items-center rounded-md px-3 font-code text-[10px] font-bold tracking-[0.06em] text-ink-700 transition-colors hover:text-ink-950"
            >
              CLEAR
            </button>
          )}
          <span
            aria-live="polite"
            className="ml-auto shrink-0 font-code text-[10px] font-bold tracking-[0.06em] text-ink-600 tabular"
          >
              {visible.length} OF {queue.length} APPROVALS
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
                <p className="mb-3 rounded-md border border-amber-400/40 bg-amber-400/[0.1] px-2.5 py-1.5 font-code text-[10px] font-bold leading-relaxed tracking-[0.06em] text-amber-900 dark:text-amber-200">
                    SECOND APPROVAL REQUIRED — STARTED BY {String(g.firstApprover ?? "AN OFFICER").toUpperCase()}
                    {g.firstApprovalAt ? ` ${g.firstApprovalAt.toUpperCase()}` : ""}. A DIFFERENT OFFICER MUST APPROVE IT.
                  </p>
                ) : null}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-code text-[10px] font-bold tracking-[0.06em] text-ink-950">{g.tender}</p>
                    <p className="mt-0.5 truncate text-[13.5px] font-semibold text-ink-800">{g.title}</p>
                    <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-ink-950 px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.04em] text-white">
                      <Stamp className="h-2.5 w-2.5" aria-hidden="true" />
                      {GATE_TOOL_LABEL[g.tool] ?? g.tool}
                      {g.requiredOffice ? ` · ${OFFICE_SHORT[g.requiredOffice] ?? g.requiredOffice}` : ""}
                    </p>
                  </div>
                  {g.flags > 0 && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-2 py-1 font-code text-[10px] font-bold tracking-[0.04em] text-brand-800">
                      <CircleAlert className="h-2.5 w-2.5" aria-hidden="true" />
                      {g.flags} {g.flags === 1 ? "ISSUE" : "ISSUES"}
                    </span>
                  )}
                </div>
                <dl className="mt-3.5 grid grid-cols-2 gap-2 border-t border-ink-200/70 pt-3.5 font-code text-[10px] tracking-[0.04em] text-ink-700 dark:border-white/10 dark:text-ink-300">
                  <div>
                    <dt className="text-ink-600 dark:text-ink-300">SUPPLIER</dt>
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
                  <p className="mt-3.5 rounded-md bg-brand-50 px-2.5 py-1.5 font-code text-[10px] font-bold leading-relaxed tracking-[0.06em] text-brand-900 dark:bg-brand-950/40 dark:text-brand-200">
                    REQUIRED ATTENDANCE NOT MET — {short} MORE MEMBER{short === 1 ? "" : "S"} NEEDED BEFORE A DECISION
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
                        ? `Required attendance not met — ${presentCount} of ${quorum?.required ?? 0} members present. Update attendance in Committee before approving.`
                          : g.valueMissing
                          ? "Enter the contract value before approving the award."
                          : undefined
                    }
                    className="focus-brand inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-brand-600 text-[12.5px] font-bold tracking-[0.02em] text-white shadow-[0_1px_0_rgba(255,255,255,0.18)_inset,0_12px_26px_-14px_rgba(217,38,22,0.9)] transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Stamp className="h-3.5 w-3.5" aria-hidden="true" />
                    {g.status === "AWAITING_SECOND" ? "Record second approval" : "Approve award"}
                  </button>
                  {g.status !== "AWAITING_SECOND" ? (
                    <button
                      type="button"
                      onClick={() => act(g, "RETURNED")}
                      disabled={blocked}
                      title={
                        blocked
                          ? `Required attendance not met — ${presentCount} of ${quorum?.required ?? 0} members present. Update attendance in Committee before deciding.`
                          : undefined
                      }
                      className="focus-brand inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-ink-200/80 text-[12.5px] font-semibold text-ink-700 transition-colors hover:border-ink-400 hover:bg-white hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/12 dark:hover:bg-white/[0.04]"
                    >
                      Return with notes
                    </button>
                  ) : null}
                </div>
                ) : (
                  <p className="mt-4 rounded-md border border-ink-200 bg-paper px-2.5 py-2 font-code text-[10px] font-bold leading-relaxed tracking-[0.04em] text-ink-700 dark:border-white/15 dark:bg-white/[0.03] dark:text-ink-300">
                    VIEW ONLY — YOUR ROLE DOES NOT ALLOW YOU TO APPROVE THIS DECISION
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
                No approval is awaiting action. You can continue with reviews already in progress.
              </p>
            </motion.div>
          )}

          {queue.length > 0 && visible.length === 0 && (
            <p className="rounded-xl border border-dashed border-ink-200 px-4 py-10 text-center font-code text-[10px] font-bold tracking-[0.06em] text-ink-600 dark:border-white/10 dark:text-ink-300">
              NO APPROVAL MATCHES “{q.trim().toUpperCase()}”
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
                  className="flex items-center justify-between gap-2 font-code text-[10px] tracking-[0.04em]"
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
                    title="Open the decision record and signature details"
                    className="focus-brand group inline-flex min-h-11 min-w-0 items-center gap-1.5 rounded px-1 text-left transition-colors hover:text-ink-950"
                  >
                    <span className="font-bold text-ink-800 group-hover:text-ink-950">{row.tender}</span>
                    {row.hand && <PenLine className="h-2.5 w-2.5 shrink-0 text-brand-600" aria-hidden="true" />}
                  </button>
                  <span className={cn("font-bold", row.action === "AWARDED" ? "text-ink-950" : "text-brand-600")}>
                    {row.action === "AWARDED" ? "Award approved" : "Returned for revision"}
                  </span>
                  <span className="ml-auto text-ink-400">
                    {row.by} · {row.at}
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
            {visibleLedger.length === 0 && (
              <li className="font-code text-[10px] tracking-[0.04em] text-ink-600 dark:text-ink-300">
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

/* A portal control can be mixed at country level, so expose checkbox state
   while keeping a compact switch track inside a full touch-sized hit area. */
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
      role="checkbox"
      aria-checked={mixed ? "mixed" : on}
      aria-disabled={busy || undefined}
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
        "relative inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full align-middle",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 focus-visible:ring-offset-2 focus-visible:ring-offset-paper dark:focus-visible:ring-offset-night",
        busy && "cursor-wait opacity-60",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-5 w-9 items-center rounded-full border transition-colors duration-200",
          mixed ? "border-ink-950 bg-white" : on ? "border-ink-950 bg-ink-950" : "border-ink-300 bg-white",
        )}
      >
        <span
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
    "focus-brand inline-flex min-h-11 items-center gap-1 rounded-md border border-ink-200 px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.04em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950";
  return (
    <li className="border-t border-ink-100 px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-code text-[10px] font-bold tracking-[0.06em] text-ink-950">{d.publisher}</span>
            <span
              className={cn(
                "rounded-full px-2 py-1 font-code text-[10px] font-bold tracking-[0.02em] text-white",
                d.stale ? "bg-brand-600" : "bg-ink-950"
              )}
            >
              {d.stale ? "NO LONGER UPDATED" : "UPDATING"}
            </span>
            {!enabled && (
              <span className="rounded-full bg-ink-500 px-2 py-1 font-code text-[10px] font-bold tracking-[0.02em] text-white">
                OFF
              </span>
            )}
          </div>
          {override && (
            <p className="mt-1 font-code text-[10px] leading-relaxed tracking-[0.04em] text-ink-600 dark:text-ink-300">
              {enabled ? "IN USE" : "NOT USED IN REVIEWS"} — SET BY {override.by.toUpperCase() || "UNKNOWN"} · {codeStamp(override.at).toUpperCase()}
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
        <p className="mt-1 font-code text-[10px] leading-relaxed tracking-[0.04em] text-ink-600 dark:text-ink-300">
          RECORD {d.coverageFrom} → {d.coverageTo}
          {d.updateFrequency ? ` · ${d.updateFrequency.toUpperCase()}` : ""}
          {" · "}RETRIEVED {d.lastRetrieved || "NOT STATED"}
          {d.retrievedNote ? ` (${d.retrievedNote})` : ""}
          {d.ocidPrefix ? ` · ${d.ocidPrefix}` : ""}
        </p>
        <p className="mt-1 font-code text-[10px] leading-relaxed tracking-[0.04em] text-ink-600 dark:text-ink-300">
          {!d.license
            ? "LICENCE — NOT STATED ON THE REGISTRY"
            : licenceIsUrl
              ? "LICENCE — PUBLISHER'S OWN TERMS"
              : `LICENCE — ${d.license.toUpperCase()}`}
          {files ? ` · ${files.toUpperCase()}` : ""}
        </p>
        {counts.length > 0 && (
          <p className="mt-1 font-code text-[10px] leading-relaxed tracking-[0.04em] text-ink-700 dark:text-ink-300">
            {counts.map(([k, n]) => `${k} ${n.toLocaleString("en-US")}`).join(" · ")}
          </p>
        )}
        <p className="mt-1 font-code text-[10px] leading-relaxed tracking-[0.04em] text-ink-700 dark:text-ink-300">
          {link ? (
            link.registry.ok ? (
              <>
                <span className="font-bold text-ink-950">LINKED</span>
                <span className="text-ink-600 dark:text-ink-300">
                  {" "}
                  {codeStamp(link.checkedAt)} · REGISTRY HTTP {link.registry.status} ·{" "}
                  {Math.max(1, Math.round(link.registry.bytes / 1024))} KB READ · FIRST DATASET RELEASE{" "}
                  {link.registry.ocid} ·{" "}
                </span>
                {link.portal.ok ? (
                <span className="text-ink-600 dark:text-ink-300">PORTAL HTTP {link.portal.status}</span>
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
            <span className="text-ink-600 dark:text-ink-300">NOT YET CONNECTED — USE THE CONNECT BUTTON AT THE TOP OF THIS CARD</span>
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
      <p className="px-5 py-6 font-code text-[10px] tracking-[0.06em] text-ink-600 dark:text-ink-300">{emptyNote}</p>
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
                className="focus-brand flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-3 text-left transition-colors hover:bg-sand/50"
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
                    <span className="rounded border border-ink-200 px-1.5 py-1 font-code text-[10px] tracking-[0.02em] text-ink-600 dark:border-white/15 dark:text-ink-300">
                      {c.iso}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-1 font-code text-[10px] font-bold tracking-[0.02em] text-white",
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
                      <span className="rounded-full bg-ink-500 px-2 py-1 font-code text-[10px] font-bold tracking-[0.02em] text-white">
                        {offInCountry === rows.length ? "ALL OFF" : `${offInCountry} OFF`}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block font-code text-[10px] leading-relaxed tracking-[0.04em] text-ink-600 dark:text-ink-300">
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
        "inline-flex h-8 items-center gap-2 rounded-full border px-3 font-code text-[10px] font-bold tracking-[0.06em]",
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
            <div className="font-code text-[10px] font-bold tracking-[0.06em] text-ink-600 tabular">{meta}</div>
          ) : null}
        </div>
      </div>
      {items.length === 0 ? (
        <p className="border-t border-ink-100/80 px-5 py-5 text-[11px] leading-relaxed text-ink-600 dark:border-white/[0.06] dark:text-ink-400">
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
                <span className="font-code text-[10px] font-bold tracking-[0.04em] text-ink-500 tabular">
                  {share}%
                </span>
              </div>
              <p className="eyebrow mt-2">{item.label.toUpperCase()}</p>
              <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-ink-600 dark:text-ink-400">{item.caption}</p>
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
        <h3 className="type-title">Award decision authority</h3>
        <p className="mt-3 font-code text-[10px] leading-[1.7] tracking-[0.08em] text-ink-400">
          QUORUM ORGANIZES THE REVIEW.
          <br />
          IT DOES NOT AWARD THE TENDER.
          <br />
          <span className="text-brand-400">THE COMMITTEE MAKES THE AWARD DECISION.</span>
        </p>
        <a
          href="/docs#docs-safeguards"
          className="focus-brand mt-4 inline-flex min-h-11 items-center gap-1.5 font-code text-[10px] font-bold tracking-[0.06em] text-ink-300 transition-colors hover:text-white"
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
        <h3 className="font-display text-[15px] font-black tracking-[-0.01em]">Run document checks</h3>
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-300">
          Check tender documents against selected requirements. Bidder scoring and AI recommendations are in Tender workflow → Bid evaluation.
        </p>
        <button
          type="button"
          onClick={onNewRun}
          className="focus-brand mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-brand-600 px-4 font-code text-[10px] font-bold tracking-[0.04em] text-white transition-colors hover:bg-brand-700"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          RUN DOCUMENT CHECKS
        </button>
      </div>
    </div>
  );
}

function GavelProtocolCard() {
  return (
    <div className="rounded-[12px] panel p-5 shadow-[0_1px_2px_rgba(11,12,15,0.04)]">
        <h3 className="font-display text-[15px] font-black tracking-[-0.01em] text-ink-950">Committee approval process</h3>
      <ol className="mt-4 space-y-3">
        {[
          "REVIEW FINDINGS ARE READY FOR APPROVAL",
          "THE COMMITTEE REVIEWS THE EVIDENCE",
          "THE AUTHORISED COMMITTEE RECORDS ITS DECISION",
          "THE AUDIT HISTORY PRESERVES THE RECORD",
        ].map((step, i) => (
          <li key={step} className="flex gap-3 font-code text-[10px] tracking-[0.04em] text-ink-700">
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
      <span className="inline-flex min-h-6 items-center rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.04em] text-brand-900">
        OPEN
      </span>
    );
  if (status === "RE-CHECK")
    return (
      <span className="inline-flex min-h-6 items-center gap-1.5 rounded-full bg-brand-600 px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.04em] text-white">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-white" aria-hidden="true" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" />
        </span>
        RE-CHECK
      </span>
    );
  return (
    <span className="inline-flex min-h-6 items-center gap-1 rounded-full bg-ink-950 px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.04em] text-white">
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
      sub="Review issues are grouped by category and linked to the page or source behind them. Committee members can record how each issue was handled."
    >
      <div className="grid grid-cols-1 gap-4 sm:gap-6">
        <div className="min-w-0">
          <div className="overflow-hidden rounded-[12px] panel shadow-[0_1px_2px_rgba(11,12,15,0.04)]">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
              <div>
                <h2 className="font-display text-[17px] font-black tracking-[-0.01em] text-ink-950">All findings</h2>
                <p className="mt-1 font-code text-[10px] tracking-[0.04em] text-ink-600">
                  {rows.length} ISSUES · {open} OPEN · {rows.filter((x) => !x.src).length} WITHOUT A SOURCE
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
                      "min-h-11 rounded-full border px-3 font-code text-[10px] font-bold tracking-[0.06em] transition-all",
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
            <HorizontalScrollRegion
              label="Findings table"
              hint="Swipe or scroll the table to see source and run details."
              hintClassName="sm:hidden"
              data-tour="findings-rows"
              className="max-h-[520px] overflow-y-auto [scrollbar-width:thin]"
            >
              <table className="w-full min-w-[620px] border-collapse text-left">
                <caption className="sr-only">Findings — every flag with its class, status and source</caption>
                <thead className="sticky top-0 z-10 bg-paper/95 backdrop-blur">
                  <tr className="border-b border-ink-100">
                    {["FINDING", "CLASS", "STATUS", "SOURCE", "RUN"].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className="px-4 py-2.5 font-code text-[10px] font-semibold tracking-[0.1em] text-ink-500 first:pl-5 first:pr-4 last:pr-5"
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
                        <span className="inline-flex min-h-6 items-center rounded-md border border-ink-200 bg-white px-2 py-1 font-code text-[10px] font-bold tracking-[0.06em] text-ink-700">
                          {row.cls}
                        </span>
                      </td>
                      <td className="px-4">
                        <FindingStatusChip status={row.status} />
                      </td>
                      <td className="px-4 font-code text-[10px] tracking-[0.04em] text-ink-600">{row.src}</td>
                      <td className="py-3.5 pr-5 font-code text-[10px] font-bold tracking-[0.04em] text-ink-950">{row.run}</td>
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
            </HorizontalScrollRegion>
          </div>
        </div>
        <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
          <div className="relative overflow-hidden rounded-[12px] border border-ink-950 bg-night p-5 text-white shadow-[0_22px_55px_rgba(11,12,15,0.3)]">
            <div className="bg-grid-dark pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
            <div className="relative">
              <h3 className="font-display text-[15px] font-black tracking-[-0.01em]">The invariant</h3>
              <p className="mt-3 font-code text-[10px] leading-[1.7] tracking-[0.08em] text-ink-400">
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
                    <span className="w-[96px] shrink-0 font-code text-[10px] font-bold tracking-[0.06em] text-ink-700">{cls}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                      <span
                        className="block h-full rounded-full bg-brand-500"
                        style={{ width: `${rows.length > 0 ? (n / rows.length) * 100 : 0}%` }}
                      />
                    </span>
                    <span className="w-6 text-right font-code text-[10px] font-bold text-ink-800 tabular">{n}</span>
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
  return run.seal ? "APPROVAL RECORDED — FINAL REPORT" : "DRAFT REPORT — AWAITING APPROVAL";
}

/* The sealed pack leaves the desk as a real file — the evidence, portable.
   Every number on it is real: the size is this file's own byte length, the
   seal is the sidecar's receipt hash. Nothing is estimated. */
function packMarkdown(run: McRun, findings: SeedFinding[], verdict: "AWARDED" | "RETURNED" | null): string {
  const lines = [
    `# Quorum — tender review report · ${run.reference ?? run.id}`,
    "",
    `- Review reference: ${run.reference ?? run.id}`,
    `- Approval status: ${verdict === "AWARDED" ? "Award approved" : verdict === "RETURNED" ? "Returned for revision" : "Awaiting committee approval"}`,
    `- Findings: ${run.findings} · With sources: ${run.citations} · Without a source: ${run.unsourced}`,
    `- Record integrity code: ${run.seal ?? "Available after approval"}${run.sealedBy ? ` · approved by ${run.sealedBy}` : ""}`,
    "",
    "## Findings and sources",
    ...(findings.length
      ? findings.map((f) => `- [${f.cls}] ${f.note}${f.src ? ` — ${f.src}` : " — NO SOURCE ON FILE"}`)
      : ["- All findings are listed in this report."]),
    "",
    "## Audit trail",
    "- Every finding above cites the page, clause or registry ID it was read from.",
    `- Decision: ${verdict === "AWARDED" ? "Award approved" : verdict === "RETURNED" ? "Returned for revision" : "Awaiting committee approval"}`,
  ];
  const base = lines.join("\n");
  const kb = (new TextEncoder().encode(base).length / 1024).toFixed(1);
  lines.push("", `- Report size: ${kb} KB · check the record integrity code in the Activity log.`);
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
  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => trapTabFocus(e, cardRef.current);

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
                <p className="font-code text-[10px] font-semibold tracking-[0.18em] text-ink-400">REPORT PACK · DRAFT PREVIEW</p>
                <h3 id="pack-preview-title" className="mt-1 font-display text-[22px] font-black tracking-[-0.015em] text-ink-950">
                  Committee pack — draft
                </h3>
                <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-ink-500">
                  The packet is ready for review. It will be submitted only after an authorized officer approves it; this preview shows what the committee will receive.
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label="Close the preview"
                className="focus-brand grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-paper hover:text-ink-900"
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
                    <p className="font-code text-[10px] font-bold tracking-[0.16em] text-ink-950">
                      QUORUM · PROCUREMENT REVIEW
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.08em] text-ink-600">
                    <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                    DRAFT REPORT · AWAITING APPROVAL
                  </span>
                </div>

                <p className="mt-4 font-code text-[10px] tracking-[0.14em] text-ink-400">TENDER</p>
                <p className="mt-1 font-display text-[24px] font-black tracking-[-0.02em] text-ink-950">{run.reference ?? run.id}</p>
                <p className="mt-1 font-code text-[10px] tracking-[0.08em] text-ink-500">
                  REVIEW STARTED {run.startedAt} · PREPARED FOR THE COMMITTEE
                </p>

                <dl className="mt-5 grid grid-cols-2 gap-3 border-y border-ink-950/10 py-3.5 sm:grid-cols-4">
                  {[
                    { k: "FINDINGS", v: String(run.findings), tone: "text-ink-950" },
                    { k: "WITH SOURCES", v: String(run.citations), tone: "text-ink-950" },
                    { k: "WITHOUT SOURCE", v: String(run.unsourced), tone: "text-brand-700" },
                    { k: "RECORD CODE", v: run.seal ? `${run.seal.slice(0, 10)}…` : "AFTER APPROVAL", tone: "text-ink-950" },
                  ].map((cell) => (
                    <div key={cell.k}>
                      <dt className="font-code text-[10px] tracking-[0.1em] text-ink-500">{cell.k}</dt>
                      <dd className={cn("mt-1 text-[14px] font-bold tabular", cell.tone)}>{cell.v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 font-code text-[10px] leading-relaxed tracking-[0.06em] text-ink-500">
                  {sealText(run).toUpperCase()}
                  {run.sealedBy ? ` · BY ${run.sealedBy.toUpperCase()}` : ""}
                </p>

                <p className="mt-5 font-code text-[10px] font-bold tracking-[0.14em] text-ink-950">INCLUDED IN THIS REPORT</p>
                <ul className="mt-2.5 space-y-2">
                  {[
                    {
                      n: "01",
                      t: `${run.findings} findings`,
                      d: "grouped by category and linked to the page or source behind each issue.",
                    },
                    {
                      n: "02",
                      t: `${run.citations} citations`,
                      d: "the supporting evidence for this review.",
                    },
                    {
                      n: "03",
                      t: run.seal ? `Record integrity code · ${run.seal}` : "Record integrity code · available after approval",
                      d: "a unique code that helps confirm the report has not changed.",
                    },
                    {
                      n: "04",
                      t: "Decision sheet",
                      d: "the committee's decision and the name of the approving officer.",
                    },
                  ].map((item) => (
                    <li key={item.n} className="flex items-baseline gap-2.5">
                      <span className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-500">{item.n}</span>
                      <span className="min-w-0">
                        <span className="text-[12.5px] font-semibold text-ink-900">{item.t}</span>
                        <span className="text-[12px] text-ink-500"> — {item.d}</span>
                      </span>
                    </li>
                  ))}
                </ul>

                <p className="mt-5 font-code text-[10px] font-bold tracking-[0.14em] text-ink-950">
                  FINDINGS IN THIS REPORT
                </p>
                <ul className="mt-2.5 space-y-2.5">
                  {shown.map((f, i) => (
                    <li key={`${f.run}-${i}`} className="flex gap-2.5">
                      <span className="mt-px inline-flex h-fit shrink-0 rounded-md border border-ink-200 bg-white px-2 py-1 font-code text-[10px] font-bold tracking-[0.06em] text-ink-600">
                        {f.cls}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12px] leading-snug text-ink-800">{f.note}</span>
                        <span className="mt-1 block break-words font-code text-[10px] leading-relaxed tracking-[0.04em] text-ink-500">
                          {f.src || "NO SOURCE ON FILE"}
                        </span>
                      </span>
                    </li>
                  ))}
                  {rows.length === 0 && (
                    <li className="font-code text-[10px] tracking-[0.08em] text-ink-500">
                      FINDING DETAILS WILL APPEAR WHEN THE REVIEW IS COMPLETE
                    </li>
                  )}
                </ul>
                {rows.length > shown.length && (
                  <p className="mt-2.5 font-code text-[10px] tracking-[0.08em] text-ink-500">
                    + {rows.length - shown.length} MORE FINDINGS IN THIS REPORT
                  </p>
                )}

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-100 bg-white px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink-950 text-white">
                      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="font-code text-[10px] font-bold tracking-[0.1em] text-ink-950">REPORT NOT FINAL</p>
                      <p className="mt-0.5 text-[11.5px] leading-snug text-ink-500">
                        Download is available after the committee records its decision.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled
                    className="inline-flex min-h-11 cursor-not-allowed items-center gap-1.5 rounded-lg border border-ink-100 px-3 font-code text-[10px] font-bold tracking-[0.06em] text-ink-500"
                  >
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    AVAILABLE AFTER APPROVAL
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-sm text-[11.5px] leading-relaxed text-ink-400">
                The committee’s decision appears here after it is recorded.
              </p>
              <div className="flex items-center gap-2">
                {run.status === "gate" && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenApprovals();
                    }}
                    className="focus-brand inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-ink-200 px-3.5 font-code text-[10.5px] font-bold tracking-[0.06em] text-ink-800 transition-colors hover:border-ink-950 hover:text-ink-950"
                  >
                    GO TO APPROVALS
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="focus-brand inline-flex min-h-11 items-center rounded-xl bg-ink-950 px-4 font-code text-[10.5px] font-bold tracking-[0.06em] text-white transition-colors hover:bg-brand-600"
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
          onToast("SIGN IN TO PREPARE REPORTS");
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { queuedAt: string; by?: string };
        setBinding(j);
        onToast(`REPORT PREPARATION STARTED — ${new Date(j.queuedAt).toLocaleTimeString()}`);
      })
      .catch(() => onToast("COULD NOT PREPARE REPORTS — REVIEW SERVICE UNAVAILABLE"));
  };

  return (
    <>
    <ViewShell
      fig="09"
      title="Reports"
      sub="View one report for each tender review. Reports include the findings, source references and the committee’s recorded decision."
    >
      <div data-tour="reports-intro" className="relative overflow-hidden rounded-[12px] border border-ink-950 bg-night p-5 text-white shadow-[0_22px_55px_rgba(11,12,15,0.3)] sm:p-6">
        <div className="bg-grid-dark pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="font-display text-[15px] font-black tracking-[-0.01em]">Reports for committee review</h3>
            <p className="mt-2 max-w-md text-[12.5px] leading-relaxed text-ink-300">
              Bring the findings and source references together so committee members can review the tender and make an informed decision.
            </p>
          </div>
          <button
            type="button"
            onClick={queueBinding}
            className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 font-code text-[10px] font-bold tracking-[0.06em] text-white transition-colors hover:bg-brand-700"
          >
            <Files className="h-3.5 w-3.5" aria-hidden="true" />
              PREPARE REPORTS
          </button>
        </div>
        {binding && (
          <p className="relative mt-3 border-t border-white/10 pt-2.5 font-code text-[10px] leading-relaxed tracking-[0.04em] text-ink-300">
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
              ? "AWARD APPROVED"
              : v === "RETURNED"
                ? "RETURNED FOR REVISION"
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
                <p className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-950">{run.reference ?? run.id}</p>
                {assembling ? (
                  <span className="inline-flex min-h-6 items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.06em] text-brand-800">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500" aria-hidden="true" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-600" aria-hidden="true" />
                    </span>
                    AWAITING APPROVAL
                  </span>
                ) : (
                  <span className="inline-flex min-h-6 items-center gap-1 rounded-full bg-ink-950 px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.06em] text-white">
                    <CircleCheck className="h-2.5 w-2.5" aria-hidden="true" />
                    FINAL REPORT
                  </span>
                )}
              </div>
              <p className="mt-1.5 truncate text-[13.5px] font-semibold text-ink-700">{run.title}</p>
              <dl className="mt-4 grid grid-cols-3 gap-2 border-y border-ink-100 py-3 font-code text-[10px] tracking-[0.05em]">
                <div>
                  <dt className="text-ink-500">FINDINGS</dt>
                  <dd className="mt-1 text-[13px] font-bold text-ink-950 tabular">{run.findings}</dd>
                </div>
                <div>
                  <dt className="text-ink-500">WITH SOURCES</dt>
                  <dd className="mt-1 text-[13px] font-bold text-ink-950 tabular">{run.citations}</dd>
                </div>
                <div>
                  <dt className="text-ink-500">WITHOUT SOURCE</dt>
                  <dd className="mt-1 text-[13px] font-bold text-brand-700 tabular">{run.unsourced}</dd>
                </div>
              </dl>
              <p className="mt-3 font-code text-[10px] leading-relaxed tracking-[0.04em] text-ink-600">
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
                    className="focus-brand inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-ink-200 px-3 font-code text-[10.5px] font-bold tracking-[0.06em] text-ink-700 transition-colors hover:border-ink-400 hover:text-ink-900"
                  >
                    <Eye className="h-3 w-3" aria-hidden="true" />
                    PREVIEW REPORT
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      downloadText(
                        `quorum-${(run.reference ?? run.id).replace(/[^\w-]+/g, "-")}-report.md`,
                        packMarkdown(run, packFindings, v ?? null),
                      );
                      onToast(`REPORT DOWNLOADED — ${run.reference ?? run.id}`);
                    }}
                    className="focus-brand inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink-950 px-3 font-code text-[10.5px] font-bold tracking-[0.06em] text-white transition-colors hover:bg-brand-600"
                  >
                    <Download className="h-3 w-3" aria-hidden="true" />
                    DOWNLOAD REPORT
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (navigator.clipboard?.writeText)
                      navigator.clipboard.writeText(`quorum audit — ${run.reference ?? run.id} — ${sealText(run)}`).catch(() => undefined);
                    onToast("AUDIT TRAIL COPIED TO CLIPBOARD");
                  }}
                  aria-label={`Copy audit trail for ${run.reference ?? run.id}`}
                  className="focus-brand grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-ink-200 text-ink-600 transition-colors hover:border-ink-400 hover:text-ink-950"
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
          <p className="mt-0.5 font-code text-[10px] tracking-[0.08em] text-ink-600">
            {requests.filter((r) => r.status === "PENDING").length} PENDING · {requests.length} FILED
          </p>
        </div>
      </header>
      <ul>
        {requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-ink-100 px-5 py-3.5 last:border-b-0">
            <span className="min-w-0 w-full sm:w-auto sm:flex-1">
              <span className="block truncate font-code text-[10px] font-bold tracking-[0.12em] text-ink-950">{r.name}</span>
              <span className="mt-0.5 block font-code text-[10px] tracking-[0.05em] text-ink-600">
                {r.kind} · BY {r.requestedBy.toUpperCase()} · {clockOf(r.createdAt).toUpperCase()}
              </span>
            </span>
            {r.note && <span className="min-w-0 flex-1 truncate text-[12px] text-ink-500 sm:max-w-[320px] sm:flex-none">{r.note}</span>}
            <span
              className={cn(
                "inline-flex min-h-6 shrink-0 items-center rounded-full px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.06em]",
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
  const standards = ["Open Contracting Data Standard", "Official procurement sources", "Page and source references", "Human approval required"];
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
  const reqDialogRef = useRef<HTMLDivElement | null>(null);
  const reqReturnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (reqOpen) {
      const active = document.activeElement;
      reqReturnFocusRef.current = active instanceof HTMLElement ? active : null;
      requestAnimationFrame(() => reqNameRef.current?.focus());
      return;
    }
    const target = reqReturnFocusRef.current;
    reqReturnFocusRef.current = null;
    if (target?.isConnected) requestAnimationFrame(() => target.focus());
  }, [reqOpen]);

  useEffect(() => {
    if (!reqOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || reqBusy) return;
      const focusedModal = document.activeElement?.closest('[role="dialog"][aria-modal="true"]');
      if (focusedModal && focusedModal !== reqDialogRef.current) return;
      setReqOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reqOpen, reqBusy]);

  const trapReqTab = (event: ReactKeyboardEvent<HTMLDivElement>) => trapTabFocus(event, reqDialogRef.current);

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
        onToast(single ? "SOURCE CHECK COMPLETE — RESULT SAVED" : "SOURCE CHECKS COMPLETE — RESULTS SAVED");
      } catch {
        onToast("SOURCE CHECK COULD NOT COMPLETE — PLEASE TRY AGAIN");
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
      onToast("OPEN CONTRACTING DATA REGISTRY UPDATED");
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
      title="Source records"
      sub="Check tender details against official procurement data and supplier registers. Each finding links to the source used in its review."
      action={
        <button
          type="button"
          data-tour="sources-request-btn"
          onClick={() => setReqOpen(true)}
          className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 font-code text-[10px] font-bold tracking-[0.06em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950"
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
            <p className="font-code text-[10px] font-bold tracking-[0.1em] text-ink-900">{s}</p>
            <p className="mt-1.5 font-code text-[10px] tracking-[0.06em] text-ink-500">REVIEW FOUNDATION {String(i + 1).padStart(2, "0")}</p>
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
                <p className="mt-0.5 font-code text-[10px] tracking-[0.08em] text-ink-600">
                  {registry
                    ? `${registry.countries.length} COUNTRIES · ${registry.datasets.length} DATASETS · ${linkedCount}/${registry.datasets.length} LINKED · ${
                        registry.datasets.filter((d) => d.stale).length
                      } NO LONGER UPDATED${disabledCount > 0 ? ` · ${disabledCount} SWITCHED OFF` : ""}`
                    : registryFailed
                      ? "THE REGISTRY SNAPSHOT COULD NOT BE READ"
                      : "READING THE OPEN CONTRACTING DATA REGISTRY…"}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1.5 font-code text-[10px] font-semibold tracking-[0.05em] text-ink-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-ink-950" aria-hidden="true" />
                  OPEN CONTRACTING DATA REGISTRY{registry ? ` · ${codeDate(registry.source.retrieved)}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => void refreshNow()}
                  disabled={refreshing || Boolean(refresh?.running)}
                  className="focus-brand inline-flex min-h-11 items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 font-code text-[10.5px] font-bold tracking-[0.06em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Refresh the Open Contracting Data Registry — source pages are checked again and the latest record is saved"
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
                  className="focus-brand inline-flex min-h-11 items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 font-code text-[10.5px] font-bold tracking-[0.06em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-50"
                  title={
                    disabledCount === datasets.length
                      ? "Every portal is switched off — turn one on and the connection pass can run again"
                      : "Open each published dataset, read its first tender record, and check the publisher's website. Results are dated and saved; disabled sources are skipped."
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
                <p className="min-w-0 flex-1 font-code text-[10px] leading-relaxed tracking-[0.04em] text-ink-600">
                  The Open Contracting data list is temporarily unavailable. Try again shortly.
                </p>
                <button
                  type="button"
                  onClick={reloadRegistry}
                  className="focus-brand inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-ink-200 px-3 font-code text-[10.5px] font-bold tracking-[0.06em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950"
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
              <p className="font-code text-[10px] leading-relaxed tracking-[0.04em] text-ink-600">
                SOURCE: OPEN CONTRACTING DATA REGISTRY ·{" "}
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
                  ? `SOURCE CHECKS · ${linkedCount}/${registry.datasets.length} DATASETS OPENED · ${portalUpCount}/${registry.datasets.length} PUBLISHER WEBSITES REPLIED${disabledCount > 0 ? ` · ${disabledCount} DISABLED AND SKIPPED` : ""} · LAST CHECK ${
                      registry.links.updatedAt ? codeStamp(registry.links.updatedAt) : "NOT YET"
                    }`
                  : "SOURCE CHECKS · QUORUM OPENS EACH DATASET AND CHECKS ITS PUBLISHER WEBSITE."}
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
                <p className="mt-0.5 font-code text-[10px] tracking-[0.08em] text-ink-600">
                  {registry
                    ? `${globalCountries.length} COUNTRIES · ${globalDatasets.length} DATASETS · ${globalLinkedCount}/${globalDatasets.length} LINKED · ${
                        globalDatasets.filter((d) => d.stale).length
                      } NO LONGER UPDATED${globalDisabledCount > 0 ? ` · ${globalDisabledCount} SWITCHED OFF` : ""}`
                    : registryFailed
                      ? "THE GLOBAL SNAPSHOT COULD NOT BE READ"
                      : "READING THE OPEN CONTRACTING DATA REGISTRY…"}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1.5 font-code text-[10px] font-semibold tracking-[0.05em] text-ink-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-ink-950" aria-hidden="true" />
                  NON-AFRICAN{global ? ` · ${codeDate(global.source.retrieved)}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => void connectDatasets(globalDatasets.filter((d) => enabledOf(d.publicationId)).map((d) => d.publicationId))}
                  disabled={!registry || connecting || rechecking !== null || globalDisabledCount === globalDatasets.length}
                  className="focus-brand inline-flex min-h-11 items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 font-code text-[10.5px] font-bold tracking-[0.06em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-50"
                  title={
                    globalDisabledCount === globalDatasets.length
                      ? "Every global portal is switched off — turn one on and the connection pass can run again"
                      : "Open each published dataset, read its first tender record, and check the publisher's website. Results are dated and saved."
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
                <p className="min-w-0 flex-1 font-code text-[10px] leading-relaxed tracking-[0.04em] text-ink-600">
                  The global procurement data list is temporarily unavailable. Try again shortly.
                </p>
                <button
                  type="button"
                  onClick={reloadRegistry}
                  className="focus-brand inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-ink-200 px-3 font-code text-[10.5px] font-bold tracking-[0.06em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950"
                >
                  <RefreshCw className="h-3 w-3" aria-hidden="true" />
                  RETRY
                </button>
              </div>
            ) : !registry ? (
              <p className="px-5 py-6 font-code text-[10px] tracking-[0.04em] text-ink-600">READING THE OPEN CONTRACTING DATA REGISTRY…</p>
            ) : globalDatasets.length === 0 ? (
              <p className="px-5 py-6 font-code text-[10px] tracking-[0.04em] text-ink-600">NO GLOBAL SNAPSHOT IS PRESENT — REFRESH THE REGISTRY</p>
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
                      className="focus-brand h-11 w-full rounded-xl border border-ink-200 bg-white pl-9 pr-3 text-[14px] text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-950 focus:ring-2 focus:ring-ink-950/10"
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
              <p className="font-code text-[10px] leading-relaxed tracking-[0.04em] text-ink-600">
                SAME OPEN CONTRACTING DATA REGISTRY ·{" "}
                {global ? `${global.source.scope.toUpperCase()} · RETRIEVED ${codeDate(global.source.retrieved)}` : "SOURCE: OPEN CONTRACTING DATA REGISTRY"}
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
              <p className="font-code text-[10px] leading-relaxed tracking-[0.04em] text-ink-600">
              VERIFIABLE AUDIT RECORDS · ON-PREMISES DEPLOYMENT · NO TRACKERS
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
              ref={reqDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="req-source-title"
              tabIndex={-1}
              initial={{ opacity: 0, y: 22, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.28, ease: EASE }}
              className="w-full max-w-lg rounded-[12px] panel panel-lift p-6 sm:p-8"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={trapReqTab}
            >
              <p className="flex items-center gap-2.5 font-code text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
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
                  <label htmlFor="req-name" className="mb-1.5 block font-code text-[10px] font-semibold tracking-[0.06em] text-ink-600">
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
                  <fieldset className="min-w-0 border-0 p-0">
                    <legend className="mb-1.5 block font-code text-[10px] font-semibold tracking-[0.06em] text-ink-600">
                      KIND
                    </legend>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {["NATIONAL PORTAL", "REGISTRY", "DATA SOURCE"].map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setReqKind(k)}
                          aria-pressed={reqKind === k}
                          className={cn(
                            "focus-brand flex min-h-11 items-center justify-center rounded-xl border px-2 font-code text-[10px] font-bold tracking-[0.04em] transition-all",
                            reqKind === k
                              ? "border-ink-950 bg-ink-950 text-white"
                              : "border-ink-200 bg-white text-ink-700 hover:border-ink-400"
                          )}
                        >
                          {k}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                </div>
                <div>
                  <label htmlFor="req-note" className="mb-1.5 block font-code text-[10px] font-semibold tracking-[0.06em] text-ink-600">
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
                    className="focus-brand inline-flex min-h-11 items-center rounded-xl border border-ink-200 px-4 font-code text-[10px] font-bold tracking-[0.06em] text-ink-700 transition-colors hover:border-ink-900 hover:text-ink-950"
                  >
                    CANCEL
                  </button>
                  <button
                    type="submit"
                    disabled={reqBusy}
                    className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-xl bg-ink-950 px-5 font-code text-[10px] font-bold tracking-[0.06em] text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
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
      title="Award history"
      sub="See each award or return decision, who made it and when. Open a decision to review its supporting record."
    >
      <div className="grid grid-cols-1 gap-4 sm:gap-6">
        <div className="min-w-0 space-y-4 sm:space-y-6">
          <div data-tour="ledger-stats" className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            {[
              { label: "DECISIONS LOGGED", value: ledger.length },
              { label: "AWARDED", value: awarded },
              { label: "RETURNED", value: returned },
              { label: "AWAITING APPROVAL", value: awaiting },
            ].map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.05 * i, ease: EASE }}
                className="rounded-[12px] panel p-4 shadow-[0_1px_2px_rgba(11,12,15,0.04)]"
              >
                <p className="font-code text-[10px] font-semibold tracking-[0.08em] text-ink-600">{s.label}</p>
                <p className="mt-2 font-display text-[28px] font-black leading-none tracking-[-0.02em] tabular">{s.value}</p>
              </motion.div>
            ))}
          </div>

          <div data-tour="ledger-rows" className="overflow-hidden rounded-[12px] panel shadow-[0_1px_2px_rgba(11,12,15,0.04)]">
            <HorizontalScrollRegion label="Award history table">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <caption className="sr-only">Award history — recorded award and return decisions</caption>
                <thead>
                  <tr className="border-b border-ink-100 bg-paper/60">
                    {["TENDER", "DECISION", "SIGNED BY", "LOGGED", "INK"].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className="px-4 py-2.5 font-code text-[10px] font-semibold tracking-[0.1em] text-ink-500 first:pl-5 first:pr-4 last:pr-5"
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
                      title="Open the decision record and signature details"
                      className="cursor-pointer border-b border-ink-100 transition-colors last:border-b-0 hover:bg-paper"
                    >
                      <td className="py-3.5 pl-5 pr-4 font-code text-[10px] font-bold tracking-[0.08em] text-ink-950">
                        {row.tender}
                      </td>
                      <td className="px-4">
                        <span
                          className={cn(
                            "inline-flex min-h-6 items-center gap-1 rounded-full px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.06em]",
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
                          {row.action === "AWARDED" ? "Awarded" : "Returned for revision"}
                        </span>
                      </td>
                      <td className="px-4 text-[13px] font-semibold text-ink-700">{row.by}</td>
                      <td className="py-3.5 pr-4 font-code text-[10px] tracking-[0.04em] text-ink-600">{row.at}</td>
                      <td className="py-3.5 pr-5">
                        {row.hand ? (
                          <span className="inline-flex min-h-6 items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 font-code text-[10px] font-bold tracking-[0.06em] text-brand-800">
                            <PenLine className="h-2.5 w-2.5" aria-hidden="true" />
                            APPENDED
                          </span>
                        ) : (
                        <span className="font-code text-[10px] tracking-[0.04em] text-ink-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {ledger.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-10 text-center font-code text-[10px] tracking-[0.18em] text-ink-400">
                        No decisions recorded yet. Award and return decisions will appear here.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </HorizontalScrollRegion>
          </div>
        </div>

        <div className="grid content-start gap-4 sm:gap-6 lg:grid-cols-2">
          <div className="relative overflow-hidden rounded-[12px] border border-ink-950 bg-night p-5 text-white shadow-[0_22px_55px_rgba(11,12,15,0.3)]">
            <div className="bg-grid-dark pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
            <div className="relative">
              <h3 className="font-display text-[15px] font-black tracking-[-0.01em]">People make the award decision</h3>
              <p className="mt-3 font-code text-[10px] leading-[1.7] tracking-[0.08em] text-ink-400">
                EVERY DECISION HAS A NAME
                <br />
                AND A DATE.
                <br />
                <span className="text-brand-400">AUTOMATED CHECKS SUPPORT THE REVIEW. AUTHORISED OFFICIALS DECIDE.</span>
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
      : `- Status: CLOSED${s.closedAt ? ` at ${dayOf(s.closedAt)}, ${summonsClock(s.closedAt)}` : ""}`,
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
    "## Meeting minutes — Quorum procurement workspace",
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
  const reduceMotion = useReducedMotion();
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
  const [memberDraft, setMemberDraft] = useState({ name: "", email: "", role: "", isChair: false });
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
  const memberDialogRef = useRef<HTMLDivElement | null>(null);
  const memberNameRef = useRef<HTMLInputElement | null>(null);
  const memberReturnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (memberOpen) {
      const active = document.activeElement;
      memberReturnFocusRef.current = active instanceof HTMLElement ? active : null;
      requestAnimationFrame(() => memberNameRef.current?.focus());
      return;
    }
    const target = memberReturnFocusRef.current;
    memberReturnFocusRef.current = null;
    if (target?.isConnected) requestAnimationFrame(() => target.focus());
  }, [memberOpen]);

  useEffect(() => {
    if (!memberOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || memberBusy) return;
      const focusedModal = document.activeElement?.closest('[role="dialog"][aria-modal="true"]');
      if (focusedModal && focusedModal !== memberDialogRef.current) return;
      setMemberOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [memberOpen, memberBusy]);

  const trapMemberTab = (event: ReactKeyboardEvent<HTMLDivElement>) => trapTabFocus(event, memberDialogRef.current);

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
            ? "MEETING STARTED — REQUIRED ATTENDANCE MET"
            : `MEETING STARTED — ${d.open} MEMBER${d.open === 1 ? "" : "S"} STILL NEEDED FOR REQUIRED ATTENDANCE`
          : "A COMMITTEE MEETING IS ALREADY OPEN"
      );
      if (d.minted) {
        setTab("desk");
        window.setTimeout(() => {
          document.getElementById("committee-pane-desk")?.focus({ preventScroll: true });
          deskRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
        }, 180);
      }
    } catch {
      onToast("COULD NOT START THE COMMITTEE MEETING — PLEASE TRY AGAIN");
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
      onToast(admitted ? "MEMBER ADDED TO ATTENDANCE" : "MEMBER REMOVED FROM ATTENDANCE");
    } catch {
      onToast("COULD NOT UPDATE ATTENDANCE — PLEASE TRY AGAIN");
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
      onToast("MEETING CLOSED — MINUTES SAVED");
    } catch {
      onToast("COULD NOT CLOSE THE MEETING — PLEASE TRY AGAIN");
    }
  };

  const copyLink = async () => {
    if (!deskSitting) return;
    try {
      await navigator.clipboard.writeText(deskSitting.joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
      onToast("MEETING LINK COPIED — SHARE IT WITH INVITED MEMBERS");
    } catch {
      onToast("COPY REFUSED BY THE BROWSER — SELECT THE ADDRESS BY HAND");
    }
  };

  const downloadMinutes = () => {
    if (!deskSitting) return;
    downloadText(`quorum-${deskSitting.room}-minutes.md`, minutesMarkdown(deskSitting));
      onToast("MEETING MINUTES DOWNLOADED");
  };

  const addMember = async () => {
    if (memberBusy) return;
    const name = memberDraft.name.trim();
    if (name.length < 2) {
      setMemberErr("Enter the committee member’s full name.");
      return;
    }
    setMemberBusy(true);
    setMemberErr(null);
    try {
      const res = await fetch("/api/committee/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email: memberDraft.email.trim(), role: memberDraft.role.trim() || undefined, isChair: memberDraft.isChair }),
      });
      const d = (await res.json()) as CommitteeData | { error: string };
      if (!res.ok || "error" in d) throw new Error("error" in d ? d.error : "failed");
      setData(d);
      setMemberOpen(false);
      setMemberDraft({ name: "", email: "", role: "", isChair: false });
      onToast("COMMITTEE MEMBER ADDED");
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
          ? "ROLE UPDATED"
          : patch.status === "EXCUSED"
            ? "MEMBER MARKED AS EXCUSED"
            : patch.status === "PRESENT"
              ? "MEMBER MARKED AS PRESENT"
              : "COMMITTEE CHAIR UPDATED"
      );
    } catch {
      onToast("COULD NOT UPDATE THE COMMITTEE LIST — PLEASE TRY AGAIN");
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
      onToast("COMMITTEE MEMBER REMOVED");
    } catch {
      onToast("COULD NOT REMOVE THE MEMBER — PLEASE TRY AGAIN");
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
        role: "PROCUREMENT OFFICER",
        you: true,
      });
    rest.forEach((m) => roll.push({ initials: initialsOf(m.name), name: m.name, role: m.role, id: m.id, ...(m.office ? { office: m.office } : {}) }));
    excusedMembers.forEach((m) =>
      roll.push({ initials: initialsOf(m.name), name: m.name, role: m.role, excused: true, id: m.id, ...(m.office ? { office: m.office } : {}) })
    );
  }
  const youSeatIndex = roll.findIndex((m) => m.you); /* the gavel's square on the quorum grid */
  const vacantSeatCount = data ? Math.max(0, data.seats - roll.length) : 0;
  const attendanceNeeded = data ? Math.max(0, data.required - data.present) : 0;
  const committeeTabs: { id: CommitteeTab; label: string; mobileLabel: string; icon: LucideIcon }[] = [
    { id: "roll", label: "Members", mobileLabel: "Members", icon: Users },
    { id: "quorum", label: "Attendance", mobileLabel: "Attendance", icon: Scale },
    { id: "desk", label: "Meeting room", mobileLabel: "Meeting", icon: FileText },
  ];
  const handleCommitteeTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = committeeTabs.findIndex((item) => item.id === tab);
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % committeeTabs.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + committeeTabs.length) % committeeTabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = committeeTabs.length - 1;
    else return;
    event.preventDefault();
    const nextTab = committeeTabs[next].id;
    setTab(nextTab);
    requestAnimationFrame(() => document.getElementById(`committee-tab-${nextTab}`)?.focus());
  };

  return (
    <ViewShell
      fig="12"
      title="Committee"
      sub={
        data
          ? `${capWord(countWord(data.seats))} committee members, ${countWord(data.present)} present. At least ${data.required} members must attend before an award can be approved.`
          : "Loading committee members, attendance and meeting details."
      }
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setMeetErr(null);
              setMeetOpen(true);
            }}
            className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-xl bg-ink-950 px-4 font-code text-[10px] font-bold tracking-[0.12em] text-white transition-colors hover:bg-brand-600"
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
              className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 font-code text-[10px] font-bold tracking-[0.12em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950"
            >
              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
              ADD COMMITTEE MEMBER
            </button>
          )}
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:gap-6">
        <div
          role="tablist"
          aria-label="Committee views"
          onKeyDown={handleCommitteeTabKeyDown}
          className="flex w-full gap-1 overflow-x-auto rounded-xl border border-ink-200/70 bg-ink-50/80 p-1 dark:border-white/10 dark:bg-white/[0.035] sm:w-fit"
        >
          {committeeTabs.map(({ id, label, mobileLabel, icon: Icon }) => {
            const selected = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`committee-tab-${id}`}
                aria-selected={selected}
                aria-controls={`committee-pane-${id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(id)}
                className={cn(
                  "focus-brand inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-2.5 text-[12px] font-semibold transition-colors sm:flex-none sm:px-4 sm:text-[13px]",
                  selected
                    ? "bg-white text-ink-950 shadow-[0_1px_3px_rgba(11,12,15,0.12)] dark:bg-white/[0.1] dark:text-white dark:shadow-none dark:ring-1 dark:ring-inset dark:ring-white/[0.14]"
                    : "text-ink-600 hover:bg-white/70 hover:text-ink-950 dark:text-ink-400 dark:hover:bg-white/[0.05] dark:hover:text-white"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="sm:hidden">{mobileLabel}</span>
                <span className="hidden sm:inline">{label}</span>
                {id === "desk" && data?.sitting?.status === "OPEN" ? (
                  <>
                    <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-hidden="true" />
                    <span className="sr-only">Open sitting</span>
                  </>
                ) : null}
              </button>
            );
          })}
        </div>
        <div
          id="committee-pane-roll"
          role="tabpanel"
          aria-labelledby="committee-tab-roll"
          tabIndex={tab === "roll" ? 0 : -1}
          className={cn("min-w-0", tab !== "roll" && "hidden")}
        >
          {loadErr ? (
            <div className="rounded-[10px] border border-dashed border-ink-200 p-8 text-center">
              <p className="font-code text-[10px] font-bold tracking-[0.22em] text-ink-500">
                COMMITTEE ROLL UNAVAILABLE
              </p>
              <p className="mt-2 font-code text-[10px] leading-relaxed tracking-[0.08em] text-ink-500">
                THE RECORD COULD NOT BE READ — NOTHING IS SHOWN RATHER THAN GUESSED
              </p>
              <button
                type="button"
                onClick={load}
                className="focus-brand mt-4 inline-flex min-h-11 items-center rounded-xl border border-ink-200 bg-white px-4 font-code text-[10px] font-bold tracking-[0.12em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950"
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
                <p className="font-code text-[10.5px] font-bold tracking-[0.16em] text-ink-950">
                  ATTENDANCE — {data.present} OF {data.seats} MEMBERS PRESENT
                </p>
                <p className="mt-1 text-[14px] leading-snug text-ink-600">
                  {attendanceNeeded > 0 && data.open === 0
                    ? `The required attendance of ${data.required} is higher than the ${data.seats} committee members. Update the committee settings.`
                    : attendanceNeeded > 0
                      ? `${attendanceNeeded} more member${attendanceNeeded === 1 ? " is" : "s are"} needed before the committee can make decisions.`
                      : data.open > 0
                        ? `Required attendance met with ${data.present} members present; ${data.open} place${data.open === 1 ? " remains" : "s remain"} open.`
                        : "Required attendance met — all committee members are present."}
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
                        i < data.present
                          ? i === youSeatIndex
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
                  className="focus-brand inline-flex min-h-11 shrink-0 items-center rounded-xl bg-ink-950 px-4 font-code text-[10px] font-bold tracking-[0.12em] text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {summoning ? "STARTING MEETING…" : "START MEETING"}
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
                  initial={reduceMotion ? false : { opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.5, delay: reduceMotion ? 0 : 0.05 * i, ease: EASE }}
                  className={cn(
                    "rounded-[12px] border bg-white p-4 shadow-[0_1px_2px_rgba(11,12,15,0.04)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-18px_rgba(11,12,15,0.3)] motion-reduce:transform-none motion-reduce:transition-none",
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
                      <p className="mt-1 text-[11px] font-medium leading-snug text-ink-600">{m.role}</p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "mt-3 inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.08em]",
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
                    <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-2 border-t border-ink-100 pt-3">
                      <select
                        value={m.office ?? ""}
                        onChange={(e) => void setMemberFlag(m.id!, { office: e.target.value || undefined })}
                        aria-label={`Office of ${m.name}`}
                        className="focus-brand h-11 min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-2 font-code text-[10px] font-bold tracking-[0.04em] text-ink-700"
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
                        className="focus-brand inline-flex min-h-11 items-center rounded-md px-1 whitespace-nowrap font-code text-[10px] font-bold tracking-[0.06em] text-ink-600 transition-colors hover:text-ink-950"
                      >
                        {m.excused ? "RETURN TO THE ROLL" : "EXCUSE"}
                      </button>
                      <span className="h-3 w-px bg-ink-100" aria-hidden="true" />
                      <button
                        type="button"
                        onClick={() => void removeMember(m.id!)}
                        className={cn(
                          "focus-brand inline-flex min-h-11 items-center rounded-md px-1 whitespace-nowrap font-code text-[10px] font-bold tracking-[0.06em] transition-colors",
                          armRemove === m.id ? "text-brand-600" : "text-ink-500 hover:text-brand-600"
                        )}
                      >
                        {armRemove === m.id ? "TAP AGAIN — REMOVE" : "REMOVE"}
                      </button>
                    </div>
                  )}
                </motion.div>
              ))}
              {Array.from({ length: vacantSeatCount }).map((_, i) => (
                <motion.div
                  key={`open-${i}`}
                  initial={reduceMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: reduceMotion ? 0 : 0.5, delay: reduceMotion ? 0 : 0.3 + 0.05 * i, ease: EASE }}
                  role="group"
                  aria-label={`Seat ${roll.length + i + 1}, unassigned`}
                  className="grid min-h-24 place-items-center rounded-[12px] border border-dashed border-ink-200 bg-ink-50/70 p-3 text-center transition-colors hover:border-ink-300 hover:bg-ink-50 motion-reduce:transition-none dark:ring-1 dark:ring-inset dark:ring-white/10"
                >
                  <div>
                    {/* Only genuinely unassigned seats appear as vacancies;
                        excused members still occupy their numbered seat. */}
                    <span
                      className="mx-auto grid h-9 w-9 place-items-center rounded-full border border-dashed border-ink-300 font-code text-[11px] font-bold text-ink-500"
                      aria-hidden="true"
                    >
                      {roll.length + i + 1}
                    </span>
                    <p className="mt-2 font-code text-[10px] font-bold tracking-[0.12em] text-ink-600">UNASSIGNED SEAT</p>
                    {canManageRegister ? (
                      <button
                        type="button"
                        onClick={() => {
                          setMemberErr(null);
                          setMemberOpen(true);
                        }}
                        className="focus-brand mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 text-[11px] font-semibold text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-700"
                      >
                        <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                        Register member
                      </button>
                    ) : (
                      <p className="mt-1 text-[11px] text-ink-500">No member is assigned here.</p>
                    )}
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
          tabIndex={tab === "quorum" ? 0 : -1}
          className={cn("grid content-start gap-4 sm:gap-6", tab === "quorum" && "max-w-xl", tab !== "quorum" && "hidden")}
        >
          <div data-tour="committee-quorum" className="relative overflow-hidden rounded-[12px] border border-ink-950 bg-night p-5 text-white shadow-[0_22px_55px_rgba(11,12,15,0.3)]">
            <div className="bg-grid-dark pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
            <div className="relative">
              <div className="flex items-center justify-between gap-4">
                <h3 className="font-display text-[15px] font-black tracking-[-0.01em]">Required attendance</h3>
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
                At least {data?.required ?? "—"} members must attend before the committee can make an award decision.
              </p>
              <p className="mt-4 font-code text-[10px] tracking-[0.1em] text-ink-300">
                {data
                  ? `PRESENT ${data.present} · PLACES OPEN ${data.open} · REQUIRED ${data.required}`
                  : "LOADING COMMITTEE DETAILS…"}
              </p>
            </div>
          </div>
          <GavelProtocolCard />
          <button
            type="button"
            data-tour="committee-summon"
            onClick={summon}
            disabled={!data || summoning}
            className="focus-brand inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-ink-200 bg-white px-4 font-code text-[10px] font-bold tracking-[0.12em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {summoning ? "STARTING MEETING…" : "START MEETING"}
          </button>
          {data?.lastSummonsAt && (
            <p className="text-center font-code text-[10px] tracking-[0.1em] text-ink-500">
              LAST MEETING STARTED {summonsClock(data.lastSummonsAt)}
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
        tabIndex={tab === "desk" ? 0 : -1}
        className={cn(tab !== "desk" && "hidden")}
      >
      <div id="mc-sitting-desk" ref={deskRef} className="mt-4 scroll-mt-24 sm:mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2.5 font-code text-[10px] font-bold uppercase tracking-[0.14em] text-ink-500">
            <span className="inline-block h-[2px] w-6 bg-brand-600" aria-hidden="true" />
            Committee meeting room
          </p>
          <span className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1.5 font-code text-[10px] font-bold tracking-[0.06em] text-ink-500">
            <Video className="h-3 w-3 text-brand-600" aria-hidden="true" />
            VIDEO MEETING ROOM
          </span>
        </div>

        {data && !deskSitting && (
          <div className="mt-3 rounded-[10px] border border-dashed border-ink-200 bg-white/60 p-6 text-center sm:p-10">
            <p className="font-code text-[10px] font-bold tracking-[0.14em] text-ink-500">NO MEETING HAS STARTED</p>
            <p className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed text-ink-500">
              Start a meeting to create a private video link and open its minutes here. Only committee members can join,
              and attendance is recorded with the meeting.
            </p>
            <div className="mx-auto mt-5 flex max-w-md flex-col gap-2 sm:flex-row">
              <input
                value={agenda}
                onChange={(e) => setAgenda(e.target.value)}
                placeholder="Agenda — optional, e.g. 'Award decision: GRZ/2026/041'"
                className="h-11 min-w-0 flex-1 rounded-xl border border-ink-200 bg-white px-3.5 text-[14px] text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-ink-950"
                aria-label="Optional committee meeting agenda"
              />
              <button
                type="button"
                onClick={() => void summon()}
                disabled={summoning}
                className="focus-brand inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 font-code text-[10px] font-bold tracking-[0.06em] text-white shadow-[0_10px_26px_rgba(217,38,22,0.28)] transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Video className="h-3.5 w-3.5" aria-hidden="true" />
                {summoning ? "CREATING MEETING…" : "START MEETING"}
              </button>
            </div>
            <p className="mt-3 font-code text-[10px] leading-relaxed tracking-[0.06em] text-ink-500">
              The meeting link and minutes open together. Attendance is recorded with the meeting.
            </p>
          </div>
        )}

        {data && deskSitting && (
          <>
            {!openSitting ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[12px] panel px-4 py-3">
                <p className="font-code text-[10px] font-bold tracking-[0.04em] text-ink-700">
                  NO MEETING IS OPEN — VIEWING A PREVIOUS MEETING RECORD
                </p>
                <div className="flex min-w-0 items-center gap-2">
                  <input
                    value={agenda}
                    onChange={(e) => setAgenda(e.target.value)}
                    placeholder="Agenda (optional)"
                    className="focus-brand h-11 w-48 min-w-0 rounded-lg border border-ink-200 bg-white px-3 text-[14px] text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-ink-950"
                    aria-label="Optional agenda for the next committee meeting"
                  />
                  <button
                    type="button"
                    onClick={() => void summon()}
                    disabled={summoning}
                    className="focus-brand inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg bg-brand-600 px-4 font-code text-[10px] font-bold tracking-[0.04em] text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
                  >
                    <Video className="h-3.5 w-3.5" aria-hidden="true" />
                    {summoning ? "CREATING MEETING…" : "START NEW MEETING"}
                  </button>
                </div>
              </div>
            ) : deskSitting.id !== openSitting.id ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[12px] panel px-4 py-3">
                <p className="font-code text-[10px] font-bold tracking-[0.06em] text-ink-600">
                  VIEWING A PREVIOUS MEETING — ANOTHER MEETING IS OPEN
                </p>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="focus-brand inline-flex min-h-11 items-center font-code text-[10px] font-bold tracking-[0.06em] text-brand-700 transition-colors hover:text-brand-800"
                >
                  RETURN TO THE OPEN MEETING →
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
                      <p className="font-code text-[10px] font-semibold tracking-[0.1em] text-ink-300">
                        {deskSitting.status === "OPEN" ? "THE ROOM IS OPEN" : "THE ROOM IS RETIRED"}
                      </p>
                      <span
                        className={cn(
                          "inline-flex min-h-6 items-center gap-1.5 rounded-full px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.06em]",
                          deskSitting.status === "OPEN" ? "bg-brand-600 text-white" : "border border-white/20 text-ink-300"
                        )}
                      >
                        {deskSitting.status === "OPEN"
                          ? `LIVE · SUMMONED ${summonsClock(deskSitting.summonedAt)}`
                          : `CLOSED ${deskSitting.closedAt ? summonsClock(deskSitting.closedAt) : ""}`}
                      </span>
                    </div>
                    <h3 className="mt-3 font-display text-[24px] font-black leading-tight tracking-[-0.02em] sm:text-[28px]">
                      {deskSitting.status === "OPEN" ? (
                        <>
                          The floor is open<span className="text-brand-500">.</span>
                        </>
                      ) : (
                        <>
                          The meeting is closed<span className="text-brand-500">.</span>
                        </>
                      )}
                    </h3>
                    <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-ink-300">
                      {deskSitting.status === "OPEN"
                        ? "Open the meeting in a new tab and keep this page open. Meeting notes are saved to the record, and only committee members listed below can be admitted."
                        : "This meeting link cannot be reused. The saved notes and attendance list are part of the final record."}
                    </p>
                    <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5">
                      <Lock className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate font-code text-[10px] tracking-[0.06em] text-ink-200" title={deskSitting.joinUrl}>
                        {deskSitting.joinUrl}
                      </span>
                    </div>
                    {deskSitting.agenda && (
                      <p className="mt-3 font-code text-[10px] tracking-[0.04em] text-ink-300">
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
                          Join the meeting
                          <ArrowUpRight className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
                        </a>
                      ) : (
                        <span className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/15 px-5 text-[12px] font-semibold text-ink-300">
                          <Lock className="h-4 w-4" aria-hidden="true" />
                          Meeting closed — the saved record remains available
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
                    <p className="mt-3.5 font-code text-[10px] leading-relaxed tracking-[0.06em] text-ink-500">
                      VIDEO MEETING · NO ACCOUNT OR INSTALLATION REQUIRED · UNIQUE LINK FOR THIS MEETING
                      {deskSitting.status === "OPEN" && <> · STARTED BY {deskSitting.summonedBy.toUpperCase()}</>}
                    </p>
                  </div>
                </div>

                <div className="overflow-hidden rounded-[12px] panel shadow-[0_1px_2px_rgba(11,12,15,0.04)]">
                  <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
                    <div>
                      <h3 className="font-display text-[15px] font-black tracking-[-0.01em] text-ink-950">Meeting notes</h3>
                      <p className="mt-0.5 font-code text-[10px] tracking-[0.06em] text-ink-500">
                        SAVED WITH THE MEETING RECORD
                      </p>
                    </div>
                    <span
                      className={cn(
                        "inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 py-1.5 font-code text-[10px] font-bold tracking-[0.06em]",
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
                        ? "SAVED — MEETING COMPLETE"
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
                          ? "Record the decisions, who proposed them, key figures, and any outstanding questions. Notes save automatically to this meeting record."
                          : "This meeting is closed. The notes above are final."
                      }
                      className={cn(
                        "min-h-[240px] w-full resize-y rounded-xl border border-ink-200 bg-paper px-4 py-3 text-[13.5px] leading-relaxed text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-ink-950 focus:ring-2 focus:ring-ink-950/10",
                        deskSitting.status !== "OPEN" && "cursor-not-allowed bg-ink-50/60 text-ink-600"
                      )}
                      aria-label="Meeting notes"
                    />
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="font-code text-[10px] leading-relaxed tracking-[0.04em] text-ink-600">
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
                            className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink-200 bg-white px-3.5 font-code text-[10px] font-bold tracking-[0.04em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950"
                          >
                            SAVE NOW
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={downloadMinutes}
                          className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink-200 bg-white px-3.5 font-code text-[10px] font-bold tracking-[0.04em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950"
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                          DOWNLOAD .MD
                        </button>
                        {deskSitting.status === "OPEN" && (
                          <button
                            type="button"
                            onClick={() => void closeSitting()}
                            className={cn(
                              "focus-brand inline-flex min-h-11 items-center gap-2 rounded-lg px-3.5 font-code text-[10px] font-bold tracking-[0.04em] transition-colors",
                              confirmClose
                                ? "bg-brand-600 text-white hover:bg-brand-700"
                                : "border border-ink-200 bg-white text-ink-600 hover:border-ink-950 hover:text-ink-950"
                            )}
                          >
                            <Stamp className="h-3.5 w-3.5" aria-hidden="true" />
                            {confirmClose ? "TAP AGAIN TO CLOSE THE MEETING" : "CLOSE MEETING"}
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
                      <h3 className="font-display text-[15px] font-black tracking-[-0.01em] text-ink-950">Attendance</h3>
                      <span className="font-code text-[10px] font-bold tracking-[0.04em] text-ink-700">
                        {deskSitting.attendance.filter((a) => a.admitted).length}/{deskSitting.attendance.length} PRESENT
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">
                      Only listed committee members can join. Attendance changes are recorded with the meeting.
                    </p>
                  </header>
                  <ul className="divide-y divide-ink-100">
                    {deskSitting.attendance.map((a) => (
                      <li key={a.memberId} className="flex items-center gap-3 px-4 py-3">
                        <span
                          className={cn(
                            "grid h-9 w-9 shrink-0 place-items-center rounded-full font-code text-[10px] font-bold text-white",
                            a.expected === "OFFICER" ? "bg-brand-600" : "bg-ink-950"
                          )}
                          aria-hidden="true"
                        >
                          {initialsOf(a.name)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-semibold text-ink-950">{a.name}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 font-code text-[10px] tracking-[0.04em] text-ink-600">
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
                              "focus-brand inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 font-code text-[10px] font-bold tracking-[0.06em] transition-colors disabled:cursor-wait",
                              a.admitted
                                ? "bg-ink-950 text-white hover:bg-ink-800"
                                : "border border-ink-200 bg-white text-ink-500 hover:border-ink-950 hover:text-ink-950"
                            )}
                          >
                            {a.admitted ? <Check className="h-3 w-3" aria-hidden="true" /> : <Plus className="h-3 w-3" aria-hidden="true" />}
                            {a.admitted ? "PRESENT" : "MARK PRESENT"}
                          </button>
                        ) : (
                          <span
                            className={cn(
                              "inline-flex min-h-6 shrink-0 items-center rounded-full px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.06em]",
                              a.admitted ? "bg-ink-50 text-ink-700" : "border border-ink-200 text-ink-500"
                            )}
                          >
                            {a.admitted ? "PRESENT" : "ABSENT"}
                          </span>
                        )}
                      </li>
                    ))}
                    {deskSitting.attendance.length === 0 && (
                      <li className="px-5 py-6 text-center font-code text-[10px] tracking-[0.04em] text-ink-600">
                        No committee members are listed. Add members before starting a meeting.
                      </li>
                    )}
                  </ul>
                  <footer className="border-t border-ink-100 bg-paper/70 px-5 py-3">
                    <p className="font-code text-[10px] leading-relaxed tracking-[0.04em] text-ink-600">
                      The video meeting does not verify identities. Confirm each attendee against the committee list before marking them present.
                    </p>
                  </footer>
                </div>
              </aside>
            </div>

            {data.sittings.length > 1 && (
              <div className="mt-4 overflow-hidden rounded-[12px] panel sm:mt-5">
                <header className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-3.5">
                  <h3 className="font-code text-[10px] font-bold tracking-[0.08em] text-ink-600">THE SITTING REGISTER</h3>
                  <span className="font-code text-[10px] tracking-[0.04em] text-ink-600">{data.sittings.length} MOST RECENT</span>
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
                        <span className="font-code text-[10px] font-bold tracking-[0.06em] text-ink-600">
                          {dayOf(s.summonedAt).toUpperCase()}
                        </span>
                        <span className="text-[12.5px] font-semibold text-ink-950">{s.title}</span>
                        <span className="font-code text-[10px] tracking-[0.04em] text-ink-600">
                          {s.attendance.filter((a) => a.admitted).length} ADMITTED · {s.notes.trim().length.toLocaleString()} CHARS
                        </span>
                        <span
                          className={cn(
                            "ml-auto inline-flex min-h-6 shrink-0 items-center rounded-full px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.06em]",
                            s.status === "OPEN" ? "bg-brand-600 text-white" : "border border-ink-200 text-ink-500"
                          )}
                        >
                          {s.status === "OPEN" ? "OPEN" : "CLOSED"}
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
          >
            <motion.div
              ref={memberDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="committee-member-dialog-title"
              tabIndex={-1}
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.28, ease: EASE }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={trapMemberTab}
              className="w-full max-w-lg rounded-[12px] panel panel-lift p-5 sm:p-7"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-code text-[10px] font-semibold tracking-[0.12em] text-ink-600">The committee register</p>
                  <h3 id="committee-member-dialog-title" className="mt-1 font-display text-[20px] font-black tracking-[-0.015em] text-ink-950">
                    Register a member<span className="text-brand-600">.</span>
                  </h3>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-500">
                    Only listed committee members can join a meeting. The required number of members must be present
                    before the committee can approve a decision.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!memberBusy) setMemberOpen(false);
                  }}
                  aria-label="Close without saving"
                  className="focus-brand grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-paper hover:text-ink-900"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="mt-5 grid grid-cols-1 gap-3">
                <label className="block">
                  <span className="font-code text-[10px] font-bold tracking-[0.1em] text-ink-700">Full name</span>
                  <input
                    ref={memberNameRef}
                    value={memberDraft.name}
                    onChange={(e) => setMemberDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="e.g. Mwansa Chileshe"
                    className="focus-brand mt-1.5 h-11 w-full rounded-xl border border-ink-200 bg-white px-3.5 text-[13px] text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-ink-950 dark:border-white/15 dark:bg-[#0b0d12] dark:text-white dark:placeholder:text-ink-500"
                  />
                </label>
                <label className="block">
                  <span className="font-code text-[10px] font-bold tracking-[0.1em] text-ink-700">Active workspace account email</span>
                  <input
                    type="email"
                    value={memberDraft.email}
                    onChange={(e) => setMemberDraft((d) => ({ ...d, email: e.target.value }))}
                    placeholder="member@organisation.gov.zm"
                    className="focus-brand mt-1.5 h-11 w-full rounded-xl border border-ink-200 bg-white px-3.5 text-[13px] text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-ink-950 dark:border-white/15 dark:bg-[#0b0d12] dark:text-white dark:placeholder:text-ink-500"
                  />
                  <span className="mt-1 block text-[11.5px] leading-relaxed text-ink-600">This connects their account to the committee member record used for declarations and tender reviews.</span>
                </label>
                <label className="block">
                  <span className="font-code text-[10px] font-bold tracking-[0.1em] text-ink-700">Role on the committee</span>
                  <input
                    value={memberDraft.role}
                    onChange={(e) => setMemberDraft((d) => ({ ...d, role: e.target.value }))}
                    placeholder="e.g. DIRECTOR OF PROCUREMENT · FINANCE"
                    className="focus-brand mt-1.5 h-11 w-full rounded-xl border border-ink-200 bg-white px-3.5 text-[13px] text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-ink-950 dark:border-white/15 dark:bg-[#0b0d12] dark:text-white dark:placeholder:text-ink-500"
                  />
                </label>
                <label className="flex items-center gap-2.5 rounded-xl border border-ink-100 bg-paper/60 px-3.5 py-3">
                  <input
                    type="checkbox"
                    checked={memberDraft.isChair}
                    onChange={(e) => setMemberDraft((d) => ({ ...d, isChair: e.target.checked }))}
                    className="h-4 w-4 accent-brand-600"
                  />
                  <span className="text-[12.5px] text-ink-600">Committee chair — can start each meeting</span>
                </label>
              </div>
              {memberErr && (
                <p role="alert" className="mt-4 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-brand-800">
                  {memberErr}
                </p>
              )}
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[11px] leading-relaxed text-ink-600">Adding a member updates the committee register.</p>
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
  emailDeliveryStatus: "SENT" | "SKIPPED" | "FAILED" | null;
  emailDeliveryDetail: string | null;
  emailDeliveryAttemptedAt: string | null;
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
  emailDeliveryConfigured: boolean;
};

const WORKSPACE_ROLE_ORDER: WorkspaceRole[] = ["OWNER", "ADMIN", "OFFICER", "COMMITTEE", "AUDITOR"];

function WorkspaceRoleMatrix() {
  return (
    <section className="overflow-hidden rounded-xl border border-ink-100 bg-paper/60" aria-labelledby="workspace-role-matrix-heading">
      <div className="border-b border-ink-100 px-4 py-3">
        <p className="font-code text-[10px] font-semibold tracking-[0.08em] text-ink-600">ACCESS BY ROLE</p>
        <h4 id="workspace-role-matrix-heading" className="mt-1 text-[13px] font-bold text-ink-950">Workspace permission matrix</h4>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
          These permissions are enforced for each signed-in account. Approvals also require the assigned office,
          committee attendance and any additional identity check.
        </p>
      </div>
      <HorizontalScrollRegion label="Workspace role capability matrix">
        <table className="w-full min-w-[980px] border-collapse text-left">
          <thead>
            <tr className="border-b border-ink-100 bg-paper/80">
              <th scope="col" className="sticky left-0 z-10 min-w-[280px] bg-paper px-4 py-3 font-code text-[10px] font-bold tracking-[0.06em] text-ink-600">CAPABILITY</th>
              {WORKSPACE_ROLE_ORDER.map((role) => (
                <th key={role} scope="col" className="min-w-[120px] px-3 py-3 text-center">
                  <span className="block font-code text-[10px] font-bold tracking-[0.06em] text-ink-800">{ROLE_LABELS[role].toUpperCase()}</span>
                  <span className="mt-1 block max-w-[155px] text-[10px] font-normal leading-snug text-ink-600">{ROLE_DESCRIPTIONS[role]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITY_DETAILS.map((capability) => (
              <tr key={capability.key} className="border-b border-ink-100 last:border-0">
                <th scope="row" className="sticky left-0 z-10 bg-paper px-4 py-2.5 align-top">
                  <span className="block text-[10.5px] font-semibold text-ink-800">{capability.label}</span>
                  <span className="mt-1 block max-w-[340px] text-[10.5px] font-normal leading-snug text-ink-500">{capability.description}</span>
                </th>
                {WORKSPACE_ROLE_ORDER.map((role) => {
                  const granted = canDo(role, capability.key);
                  return (
                    <td key={role} className="px-3 py-2.5 text-center">
                      <span
                        aria-label={`${ROLE_LABELS[role]} ${granted ? "can" : "cannot"} ${capability.label}`}
                        className={cn(
                          "inline-grid h-5 min-w-5 place-items-center rounded-full border px-1 font-code text-[10px] font-bold",
                          granted
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/[0.08] dark:text-emerald-300"
                            : "border-ink-100 bg-paper text-ink-300 dark:border-white/8 dark:bg-white/[0.02] dark:text-ink-500",
                        )}
                      >
                        {granted ? "✓" : "—"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </HorizontalScrollRegion>
    </section>
  );
}

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
  const [freshDelivery, setFreshDelivery] = useState<{ status: "SENT" | "SKIPPED" | "FAILED"; detail: string } | null>(null);
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
      const d = (await res.json()) as {
        invite?: { code: string; email: string | null };
        delivery?: { status: "SENT" | "SKIPPED" | "FAILED"; detail: string };
        error?: string;
      };
      if (!res.ok || !d.invite) throw new Error(d.error ?? "failed");
      setFreshCode(d.invite.code);
      setFreshDelivery(d.delivery ?? { status: "SKIPPED", detail: "Invite created; share the code directly." });
      setCopied(false);
      setInviteEmail("");
      onToast(d.delivery?.status === "SENT"
        ? `INVITATION EMAIL ACCEPTED BY RESEND — ${d.invite.email}`
        : `INVITE CREATED · ${d.delivery?.detail ?? d.invite.code}`);
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
  const labelClass = "font-code text-[10px] font-semibold tracking-[0.12em] text-ink-600";
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
            <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-ink-200 bg-paper px-3 py-1.5 font-code text-[10px] font-bold tracking-[0.08em] text-ink-600">
            <Users className="h-3 w-3" aria-hidden="true" />
            {data ? `${data.members.length} MEMBER${data.members.length === 1 ? "" : "S"}` : "INVITATIONS"}
          </span>
          {canDo(user?.role, "view_oversight") && (
            <button
              type="button"
              onClick={onOpenOversight}
              className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink-950 bg-ink-950 px-4 py-2 font-code text-[10.5px] font-bold tracking-[0.08em] text-white transition-colors hover:bg-ink-800"
            >
              <Scale className="h-3 w-3" aria-hidden="true" />
              OPEN OVERSIGHT
            </button>
          )}
          {canDo(user?.role, "view_oversight") && (
            /* The control room is a page of its own, not a workspace tab: it
               aggregates the whole desk and must stay outside the worker's
               daily flow. */
            <a
              href="/admin"
              className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink-200 bg-paper px-4 py-2 font-code text-[10.5px] font-bold tracking-[0.08em] text-ink-700 transition-colors hover:border-ink-400 hover:text-ink-950"
            >
              <Gauge className="h-3 w-3" aria-hidden="true" />
              ADMINISTRATION
            </a>
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
              <p className="truncate text-[11px] text-ink-600">{m.email}</p>
            </div>
            <span className="rounded-full border border-ink-200 bg-white px-2.5 py-1.5 font-code text-[10px] font-bold tracking-[0.06em] text-ink-700">
              {ROLE_LABELS[m.role].toUpperCase()}
            </span>
            {m.status === "SUSPENDED" && (
              <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1.5 font-code text-[10px] font-bold tracking-[0.06em] text-red-800">
                SUSPENDED
              </span>
            )}
            {m.currentAccount && (
              <span className="rounded-full border border-ink-100 bg-paper px-2.5 py-1.5 font-code text-[10px] font-bold tracking-[0.06em] text-ink-600">
                YOU
              </span>
            )}
          </li>
        ))}
      </ul>

      {/* Invite composer — only the roles that may write people access */}
      {user && data?.canManage && (
        <div className="mt-5 rounded-xl border border-ink-100 bg-paper/60 p-4">
          <p className="font-code text-[10px] font-semibold tracking-[0.12em] text-ink-600">Invite a teammate</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@authority.go.ke"
              aria-label="Colleague email"
              className="focus-brand h-11 min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-3 text-[13px] text-ink-950 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-400 dark:border-white/15 dark:bg-[#0b0d12] dark:text-white dark:placeholder:text-ink-500"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as AssignableRole)}
              aria-label="Workspace role"
              className="focus-brand h-11 rounded-lg border border-ink-200 bg-white px-3 font-code text-[10px] font-bold tracking-[0.06em] text-ink-700 outline-none dark:border-white/15 dark:bg-[#0b0d12] dark:text-ink-200"
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
              className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-lg bg-ink-950 px-4 py-2 font-code text-[10.5px] font-bold tracking-[0.08em] text-white transition-colors hover:bg-ink-800 disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {busy ? "CREATING…" : "CREATE INVITE"}
            </button>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-400">
            {data.emailDeliveryConfigured
              ? "Enter a work email to send the invitation through Resend. The recipient link opens registration with the code filled in; the code can also be shared manually."
              : "Email delivery is not configured on this deployment. Quorum will create a shareable code; enter an email when Resend is configured to send the invite directly."}
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
            {ROLE_DESCRIPTIONS[inviteRole]}{" "}
            {data.actorRole === "ADMIN" ? "Admins may grant Officer, Committee or Auditor access, but cannot grant Admin." : ""}
          </p>
          {freshCode && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5">
              <span className="font-code text-[13px] font-bold tracking-[0.18em] text-brand-800" aria-live="polite">{freshCode}</span>
              {freshDelivery && <span role="status" className={cn("text-[11px]", freshDelivery.status === "SENT" ? "text-emerald-800" : freshDelivery.status === "FAILED" ? "text-brand-800" : "text-ink-500")}>{freshDelivery.detail}</span>}
              <button
                type="button"
                onClick={copyCode}
                className="focus-brand ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-3 py-2 font-code text-[10px] font-bold tracking-[0.06em] text-brand-800 transition-colors hover:bg-brand-100"
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
          <p className="font-code text-[10px] font-semibold tracking-[0.12em] text-ink-600">Pending invitations</p>
          <ul className="mt-2">
            {data.invites.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-100 bg-paper/60 px-4 py-3">
                <span className="font-code text-[11px] font-bold tracking-[0.16em] text-ink-950">{inv.code ?? "———"}</span>
            <span className="rounded-full border border-ink-100 bg-white px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.04em] text-ink-700">
                  {inv.role}
                </span>
                {inv.email && <span className="truncate text-[11.5px] text-ink-400">for {inv.email}</span>}
                <span className="truncate text-[11px] text-ink-600">
                  {inv.status === "CLAIMED"
                    ? `claimed by ${inv.claimedByEmail ?? "a member"}`
                    : inv.status === "REVOKED"
                      ? "revoked"
                      : `expires in ${inv.expiresInDays} day${inv.expiresInDays === 1 ? "" : "s"}`}
                </span>
                {inv.status === "PENDING" && (
                  <TeamInviteDeliveryActions
                    invite={inv}
                    canManage={data.canManage}
                    onToast={onToast}
                    onUpdated={() => { void load(); }}
                  />
                )}
                {inv.status === "PENDING" && (
                  <button
                    type="button"
                    onClick={() => revoke(inv.id)}
                    className="focus-brand ml-auto inline-flex min-h-11 items-center rounded-lg border border-ink-200 px-3 py-2 font-code text-[10px] font-bold tracking-[0.06em] text-ink-600 transition-colors hover:border-brand-200 hover:text-brand-800"
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
            "focus-brand inline-flex min-h-11 items-center rounded-full border px-3.5 font-code text-[10px] font-bold tracking-[0.04em] transition-all",
            value === o
              ? "border-ink-950 bg-ink-950 text-white"
              : "border-ink-200 bg-white text-ink-700 hover:border-ink-400",
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
    { label: "Review service version", value: health ? `Version ${health.version}` : "—" },
    {
      label: "Document access",
      value: health ? (health.fsMcp.status === "connected" ? "AVAILABLE" : "UNAVAILABLE") : "—",
    },
    { label: "Review workflows", value: health ? String(health.graphs.length) : "—" },
    { label: "Tender reviews recorded", value: health ? health.counts.runs.toLocaleString("en-US") : "—" },
    { label: "Recorded service actions", value: health ? health.counts.toolCalls.toLocaleString("en-US") : "—" },
  ];

  const cardClass = "rounded-[12px] panel p-5 shadow-[0_1px_2px_rgba(11,12,15,0.04)]";
  const labelClass = "font-code text-[10px] font-semibold tracking-[0.08em] text-ink-600";
  const titleClass = "mt-1.5 font-display text-[15px] font-black tracking-[-0.01em] text-ink-950";

  return (
    <ViewShell
      fig="14"
      title="Settings"
      sub="Your account, review service connection and current session. Identity is verified at sign-in; service status is read from the workspace."
    >
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
        <div data-tour="settings-account" className={cardClass}>
          <p className={labelClass}>ACCOUNT</p>
          <h3 className={titleClass}>Signed-in account</h3>
          <div className="mt-5 flex items-center gap-4">
            <span
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-600 font-code text-[12px] font-bold text-white"
              aria-hidden="true"
            >
              {initialsOf(user?.name ?? "Quorum")}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-ink-950">{user?.name ?? "Guest officer"}</p>
              <p className="truncate font-code text-[10px] tracking-[0.06em] text-ink-600">
                {(user?.email ?? "NOT SIGNED IN").toUpperCase()}
              </p>
              {user?.role ? (
                <span className="mt-2 inline-flex min-h-6 items-center rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.06em] text-brand-800 dark:border-brand-400/25 dark:bg-brand-400/[0.08] dark:text-brand-300">
                  {ROLE_LABELS[user.role].toUpperCase()}
                </span>
              ) : null}
            </div>
          </div>
          {user?.role ? <p className="mt-4 text-[11.5px] leading-relaxed text-ink-500">{ROLE_DESCRIPTIONS[user.role]}</p> : null}
        </div>

        <div data-tour="settings-signout" className={cardClass}>
          <p className={labelClass}>SESSION</p>
          <h3 className={titleClass}>Sign out of this workspace</h3>
          <p className="mt-1 text-[12.5px] text-ink-500">
            Your tender reviews and activity history remain available in this workspace.
          </p>
          <button
            type="button"
            onClick={onSignOut}
            className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-4 font-code text-[10px] font-bold tracking-[0.08em] text-brand-800 transition-colors hover:bg-brand-100"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            SIGN OUT
          </button>
        </div>

        {canDo(user?.role, "view_oversight") && (
          <TeamMembersSection user={user} onToast={onToast} onOpenOversight={onOpenOversight} />
        )}

        <div className="lg:col-span-2">
          <WorkspaceRoleMatrix />
        </div>

        <div data-tour="settings-agent" className={`${cardClass} lg:col-span-2`}>
          <p className={labelClass}>REVIEW SERVICE</p>
          <h3 className={titleClass}>Review service status</h3>
          <p className="mt-1 text-[12.5px] text-ink-500">Service health, review availability and recorded activity for this workspace.</p>
          <dl className="mt-5 grid grid-cols-1 divide-y divide-ink-100 sm:grid-cols-2 sm:divide-y-0">
            {connection.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4 border-ink-100 py-3 sm:border-b sm:pr-4">
                <dt className="font-code text-[10px] tracking-[0.08em] text-ink-600">{row.label.toUpperCase()}</dt>
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
    summary: "Workspace overview with current review activity, pending approvals and actions for your team.",
    steps: [
      "Open Bid evaluation to choose a recorded tender and review bidder submissions against its published matrix.",
      "Check how many tender reviews are in progress and how many approvals are waiting.",
      "Begin here to see what the team should work on next.",
    ],
    tip: "If no approvals are pending, no committee action is required.",
    tour: [
      {
        target: "ov-bid-evaluation",
        title: "Open Bid evaluation",
        body: "Choose a tender, review the published criteria and bidder submissions, and generate an advisory recommendation with source citations.",
      },
      {
        target: "ov-stats",
        title: "Workspace summary",
        body: "See tender reviews in progress, issues found, source coverage and approvals waiting for a committee decision.",
      },
      {
        target: "gate-queue",
        title: "What needs approval",
        body: "A completed tender review appears here when an authorized officer needs to approve or return it.",
      },
    ],
  },
  {
    section: "mc-runs",
      title: "Start a document review",
      summary: "Run document checks against selected requirements. Bid scoring and recommendations are in Tender workflow → Bid evaluation.",
    steps: [
      "Tender details: Quorum assigns a reference. Add the published title and choose how the tender information is provided.",
      "Documents: add up to 12 files. Quorum checks each file before you continue. Files are saved to cloud storage when available, or kept in the local vault.",
      "Review checks: choose what to check. Each finding includes a page or source reference.",
      "Start review: the tender appears in Tender reviews with its current status.",
    ],
    tip: "Use the step rail to go back and correct details at any point before launch.",
    tour: [
      {
        target: "wiz-rail",
        action: "open-wizard",
        title: "Three simple setup steps",
        body: "Add tender details, provide documents, and choose the checks to run. The progress bar shows where you are.",
      },
      {
        target: "wiz-body",
        title: "Tender details",
        body: "Quorum assigns a reference for the tender. Add its title exactly as published so the review can be matched to the official notice.",
      },
      {
        target: "wiz-next",
        placement: "top",
        title: "Check before you start",
        body: "Complete each step before continuing. On the final step, select Start review to begin the checks.",
      },
    ],
    launch: true,
  },
  {
    section: "mc-runs",
    title: "Follow tender reviews",
    summary: "Tender reviews, their current status and recorded findings.",
    steps: [
      "In progress: automated checks are running.",
      "Needs approval: an authorized committee member must review the findings.",
      "Complete: the tender review record is ready.",
      "Search and filter the list, or open a review to see its findings.",
    ],
    tip: "A review marked NEEDS APPROVAL requires an authorised committee member.",
    tour: [
      {
        target: "run-register",
        title: "All tender reviews",
        body: "See the tender, number of bids, issues found and the share of findings with a source. Search by reference, title or buyer.",
      },
      {
        target: "run-filters",
        title: "Filter to what needs you",
        body: "Filter reviews by progress, approval status or completion. Needs approval means an authorized officer must decide what happens next.",
      },
      {
        target: "run-rows",
        title: "Expand any row",
        body: "Open a review to see its main findings, sources and decision history.",
      },
    ],
  },
  {
    section: "mc-gates",
    title: "Review pending approvals",
    summary: "Each approval shows the supplier, contract value and findings to review before you decide.",
    steps: [
      "Review the flagged findings for the bid in question.",
      "Approve the award or return the review with a request for clarification.",
      "Only authorized committee members can record a decision.",
    ],
    tip: "Quorum supports the review; the authorised committee makes the award decision. Each decision is recorded under the signer’s name.",
    tour: [
      {
        target: "gate-queue",
        title: "Approvals awaiting a decision",
        body: "Each card shows a completed tender review, the supplier, contract value and findings that need attention.",
      },
      {
        target: "gate-actions",
        title: "Award or return — by name",
        body: "Approve the award or return it with a note explaining what needs to change. Your decision is recorded under your name.",
      },
      {
        target: "gate-ledger",
        title: "Decisions land here",
        body: "Every approval or return is recorded with the decision maker and date, then added to Award history.",
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
      "Open a tender review to see each finding in context.",
    ],
    tip: "Check that each finding has a source before approving an award.",
    tour: [
      {
        target: "findings-filters",
        title: "Filter by category and status",
        body: "Filter findings by their category, open status or requested recheck. The counters show the total and how many still need attention.",
      },
      {
        target: "findings-rows",
        title: "Read the source before the sentence",
        body: "Each row shows its category, status and page or source reference. Open a row to see the tender review it came from.",
      },
    ],
  },
  {
    section: "mc-reports",
    title: "Review tender reports",
    summary: "One report for each tender review, with findings, sources and the recorded decision.",
    steps: [
      "Open a report to read all findings and source references.",
      "The decision shows whether the tender was awarded or returned for revision.",
    ],
    tip: "Reports give the committee the findings and sources it needs to make a decision.",
    tour: [
      {
        target: "reports-intro",
        title: "Tender review reports",
        body: "Reports bring findings and their sources together for the committee to review.",
      },
      {
        target: "reports-list",
        title: "One report for each completed review",
        body: "Each report includes findings, source references and the recorded decision. Reports are available after approval.",
      },
      {
        target: "report-download",
        title: "Download the report",
        body: "Download a report after an authorized officer records a decision.",
      },
    ],
  },
  {
    section: "mc-sources",
    title: "Check data sources",
    summary: "Public procurement datasets, their publishers, coverage, retrieval dates and connection status.",
    steps: [
      "Review available datasets by country, including coverage, supported formats and latest retrieval date.",
      "Open a country to check a dataset's licence, coverage and publisher before using it in a tender review.",
      "Check a source connection to confirm that the published record is available. Each result includes its check date.",
    ],
    tip: "Check the publisher's latest update before relying on a dataset. Missing or outdated data is shown clearly.",
    tour: [
      {
        target: "sources-standards",
        title: "Sources behind each finding",
        body: "Quorum uses published procurement data, document checks and source references so reviewers can see what each finding is based on.",
      },
      {
        target: "sources-portals",
        title: "The registries it reads",
        body: "Browse public procurement datasets by country. Open a record to check its licence, coverage, update date and publisher. Connection checks show whether the published data is available.",
      },
      {
        target: "sources-request-btn",
        title: "Request a data source",
        body: "Record a missing source so workspace administrators can review the request.",
      },
    ],
  },
  {
    section: "mc-ledger",
    title: "Review award history",
    summary: "Award and return decisions, with the decision maker and date.",
    steps: [
      "Each row names the tender, the decision, the signer and the time.",
      "Entries are appended, never edited.",
    ],
    tip: "Use this for audit questions: it is the record of who decided what.",
    tour: [
      {
        target: "ledger-stats",
        title: "Decision summary",
        body: "See how many decisions were recorded, approved, returned or are awaiting approval.",
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
    title: "Manage committee meetings",
    summary: "View committee members, attendance and scheduled meetings.",
    steps: [
      "Schedule a committee meeting and record who will attend.",
      "The required number of members must be present before the committee can make decisions.",
    ],
    tip: "Required attendance is checked before committee members can approve an award.",
    tour: [
      {
        target: "committee-roll",
        tab: "roll",
        title: "Committee members",
        body: "See the chair, other committee members and anyone excused from the meeting.",
      },
      {
        target: "committee-quorum",
        tab: "quorum",
        title: "Required attendance",
        body: "See how many members are present and how many must attend before the committee can decide.",
      },
      {
        target: "committee-summon",
        tab: "quorum",
        title: "Schedule a meeting",
        body: "Create a meeting link, start meeting minutes and invite the committee members listed here.",
      },
    ],
  },
  {
    section: "mc-calendar",
    title: "Committee calendar",
    summary: "See procurement deadlines, committee meetings and approval dates in one place.",
    steps: [
      "Deadlines come from each tender's record, including closing dates, responses to low-bid concerns, award review periods and complaint responses.",
      "Scheduled committee meetings appear on the calendar and update while they are open.",
      "Select a day to see its schedule, or choose an upcoming deadline to open that date.",
    ],
    tip: "Overdue deadlines stay visible in red. Update the tender record to change a deadline.",
    tour: [
      {
        target: "cal-month",
        title: "Your month at a glance",
        body: "See deadlines, committee meetings and decisions by date. Today is highlighted and overdue dates appear in red.",
      },
      {
        target: "cal-agenda",
        title: "One day, read in full",
        body: "Select a day to see its deadlines, scheduled meetings and recorded decisions.",
      },
      {
        target: "cal-clocks",
        title: "Upcoming deadlines",
        body: "See upcoming dates in order, select one to open it on the calendar, or download a calendar file to add dates to your calendar app.",
      },
    ],
  },
  {
    section: "mc-stack",
    title: "Check system status",
    summary: "See whether the services and data connections used for tender reviews are available.",
    steps: [
      "Tender reviews depend on the review service and its document connections.",
      "The activity log records actions and approval requests for later review.",
    ],
    tip: "If something looks wrong, review the activity log to see what happened and when.",
    tour: [
      {
        target: "stack-tools",
        title: "Review service connections",
        body: "Check which services are available. Filing and award decisions still require an authorized officer.",
      },
      {
        target: "stack-graphs",
        title: "Review service activity",
        body: "See the actions taken during a tender review, the findings recorded and any approval still needed.",
      },
      {
        target: "stack-log",
        title: "Recorded activity",
        body: "Review a time-ordered history of actions and decisions. Use it to follow what happened during a tender review.",
      },
    ],
  },
  {
    section: "mc-rules",
    title: "Manage review rules",
    summary: "Set thresholds for automated price checks and document requirements.",
    steps: [
      "Price variance: flag any bid priced above the framework median by 15%, 25% or 40%.",
      "Document checklist: choose standard or strict requirements for a tender review.",
      "Every change is written to the audit trail.",
    ],
    tip: "Automated checks can support an award review, but authorized committee members make the decision.",
    tour: [
      {
        target: "rules-guards",
        title: "Review checks you can update",
        body: "Set the price threshold, document checklist and supplier register check. Changes are saved as soon as you select them.",
      },
      {
        target: "rules-locked",
        title: "Source references stay on",
        body: "Every finding must include a page or source reference. This requirement cannot be turned off.",
      },
      {
        target: "rules-audit",
        title: "Your name, on every change",
        body: "See who changed a rule, when it changed and what the previous value was. Open the activity log for the full history.",
      },
    ],
  },
  {
    section: "mc-settings",
    title: "Manage your account",
    summary: "Your account details, tender review service status and current sign-in session.",
    steps: [
      "Account shows which officer is signed in.",
      "Review service status shows whether new tender reviews can be started and how many have been recorded.",
      "Sign out ends this browser session. Tender reviews and activity history remain saved in the workspace.",
    ],
    tip: "If the review service is offline, decisions cannot be recorded until it is available again.",
    tour: [
      {
        target: "settings-account",
        title: "Your account",
        body: "The officer shown here is the name attached to decisions you record.",
      },
      {
        target: "settings-agent",
        title: "Review service status",
        body: "View service availability and the review activity reported for this workspace.",
      },
      {
        target: "settings-signout",
        title: "Ending the session",
        body: "Sign out ends this browser session. Tender reviews, approvals and activity history stay saved in the workspace.",
      },
    ],
  },
  {
    section: "mc-suppliers",
    title: "Manage suppliers",
    summary: "Keep supplier registrations, tax clearances and business categories up to date for tender reviews.",
    steps: [
      "Open Suppliers and add the business name, registration number, ZRA tax details and any required sector licence.",
      "The list shows each supplier's tax clearance status, business categories and who added the record.",
      "Update supplier details when documents change. Suspend or exclude suppliers when required.",
    ],
    tip: "Check that tax clearance is current before a supplier is considered for an award.",
    tour: [
      {
        target: "suppliers-add",
        title: "Add a supplier",
        body: "Choose a supplier from the public procurement list to fill in its details, or enter the information manually.",
      },
      {
        target: "suppliers-roll",
        title: "Supplier list",
        body: "See each supplier's registration, tax clearance, business categories and record history.",
      },
      {
        target: "suppliers-filters",
        title: "Filter by status",
        body: "Find active, suspended or excluded suppliers. Check tax clearance before considering a supplier for an award.",
      },
    ],
  },
  {
    href: "/docs",
    title: "Read the documentation",
    summary: "Learn how tender reviews work, what each check means, how committee approvals are recorded and which procurement rules apply in Zambia.",
    steps: [
      "Open Documentation from the sidebar — it leaves the workspace for its own page.",
      "Browse the handbook from the product overview to the glossary, or search for a rule, method or field.",
      "The Zambia chapter lists the procurement methods currently available in Quorum.",
    ],
    tip: "If a finding is unclear, look up its rule in the handbook to see what it checks and how the committee can respond.",
  },
];

const SECTION_ICON = Object.fromEntries(
  NAV_GROUPS.flatMap((g) => g.items.filter((i) => !i.href).map((i) => [i.id, i.icon] as const))
) as Record<SectionId, LucideIcon>;

function WalkthroughView({
  onOpen,
  onNewRun,
  onOpenEvaluation,
  onTour,
  done,
}: {
  onOpen: (id: SectionId) => void;
  onNewRun: () => void;
  onOpenEvaluation: () => void;
  onTour: (chapter: number) => void;
  done: number[];
}) {
  return (
    <ViewShell
      fig="15"
      title="Guided tour"
      sub="Explore Quorum in the order a tender review moves through the workspace. Each step explains what the screen shows, what decisions belong to you and where to go next."
      action={
        <button
          type="button"
          onClick={onOpenEvaluation}
          className="group inline-flex h-11 items-center gap-2 rounded-xl bg-brand-600 px-5 text-[13.5px] font-semibold text-white shadow-[0_10px_26px_rgba(217,38,22,0.3)] transition-all hover:-translate-y-0.5 hover:bg-brand-700"
        >
          Open Bid evaluation
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
                <span className="font-code text-[10px] font-bold tracking-[0.08em] text-brand-700">{String(i + 1).padStart(2, "0")}</span>
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
                    <p className="flex items-center gap-2 font-code text-[10px] font-bold tracking-[0.08em] text-brand-700">
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
                    className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 font-code text-[10px] font-bold tracking-[0.04em] text-white shadow-[0_8px_20px_rgba(217,38,22,0.24)] transition-all hover:-translate-y-0.5 hover:bg-brand-700"
                  >
                    <Play className="h-3 w-3" aria-hidden="true" />
                    START GUIDED TOUR
                  </button>
                  {ch.href ? (
                    <a
                      href={ch.href}
                      className="focus-brand inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-ink-200 px-3.5 font-code text-[10px] font-bold tracking-[0.04em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950"
                    >
                      OPEN DOCUMENTATION
                      <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => (ch.launch ? onNewRun() : ch.section && onOpen(ch.section))}
                      className="focus-brand inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-ink-200 px-3.5 font-code text-[10px] font-bold tracking-[0.04em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950"
                    >
                      {ch.launch
                        ? "START A DOCUMENT REVIEW"
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
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-ink-200 font-code text-[10px] font-bold text-ink-600">
                      {s + 1}
                    </span>
                    <span className="min-w-0">{step}</span>
                  </li>
                ))}
              </ol>

              <p className="mt-5 rounded-xl bg-paper px-4 py-3 text-[12.5px] leading-relaxed text-ink-600">
                <span className="mr-2 font-code text-[10px] font-bold tracking-[0.06em] text-brand-800">TIP</span>
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
        "inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2.5 py-1 font-code text-[10px] font-bold tracking-[0.06em]",
        tone,
      )}
    >
      {status === "ACTIVE" && <CircleCheck className="h-2.5 w-2.5" aria-hidden="true" />}
      {status === "BLACKLISTED" ? "EXCLUDED" : status}
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
        "focus-brand inline-flex min-h-11 items-center justify-center rounded-md px-3 py-1 font-code text-[10px] font-bold tracking-[0.06em] transition-colors",
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
      <span className="mb-1.5 block font-code text-[10px] font-semibold tracking-[0.08em] text-ink-600">{label}</span>
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
        <p className="mb-2 font-code text-[10px] font-semibold tracking-[0.08em] text-ink-600">SUPPLY CATEGORIES</p>
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
                  "focus-brand inline-flex min-h-11 items-center rounded-full border px-3 py-1.5 font-code text-[10px] font-semibold tracking-[0.04em] transition-colors",
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
  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => trapTabFocus(e, cardRef.current);

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
    cardRef.current?.scrollTo({ top: 0, behavior: preferredScrollBehavior() });
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
      setError("Supplier records are temporarily unavailable. Please try again shortly.");
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
                  "min-h-11 rounded-full border px-3.5 font-code text-[10px] font-semibold tracking-[0.05em] transition-colors",
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
                <p className="font-code text-[10px] font-semibold tracking-[0.06em] text-ink-600">INTAKE</p>
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
                className="focus-brand grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-paper hover:text-ink-900"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-6" aria-label="Supplier intake progress">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="font-code text-[10px] font-bold tracking-[0.04em] text-brand-800">
                  {currentStep.section}
                </span>
                <span className="font-code text-[10px] tracking-[0.04em] text-ink-600">
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
                className="focus-brand flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink-950 text-white">
                  <Library className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-code text-[10px] font-bold tracking-[0.04em] text-ink-900">
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
                    <p className="py-4 text-center font-code text-[10px] tracking-[0.04em] text-ink-600">
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
                        className="focus-brand inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 font-code text-[10.5px] font-bold tracking-[0.06em] text-ink-800 transition-colors hover:border-ink-950 hover:text-ink-950"
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
                          className="focus-brand h-11 w-full rounded-xl border border-ink-200 bg-white pl-9 pr-3 text-[14px] text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-950 focus:ring-2 focus:ring-ink-950/10"
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
                                  "focus-brand flex min-h-11 w-full items-start justify-between gap-3 px-3.5 py-2.5 text-left transition-colors",
                                  on ? "cursor-default opacity-60" : "hover:bg-paper",
                                )}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-[12.5px] font-semibold text-ink-900">{e.name}</span>
                                  <span className="mt-1 block font-code text-[10px] leading-relaxed tracking-[0.04em] text-ink-600">
                                    PACRA {e.regNo} · {PLURAL(e.awards, "AWARD", "AWARDS")} · {PLURAL(e.tenders, "TENDER", "TENDERS")}
                                    {e.since ? ` · ON RECORD SINCE ${e.since}` : ""}
                                  </span>
                                </span>
                                {on ? (
                                  <span className="mt-0.5 inline-flex min-h-7 shrink-0 items-center rounded-full border border-ink-200 bg-paper px-2.5 py-0.5 font-code text-[10px] font-bold tracking-[0.03em] text-ink-700">
                                    ALREADY ON FILE
                                  </span>
                                ) : (
                                  <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 font-code text-[10px] font-bold tracking-[0.04em] text-brand-800">
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

                      <p className="mt-2 font-code text-[10px] leading-relaxed tracking-[0.04em] text-ink-600">
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
                <p className="font-code text-[10px] font-bold tracking-[0.04em] text-ink-900">
                  FILLED FROM THE ZPPA RECORD
                </p>
                <p className="mt-1 font-code text-[10px] tracking-[0.04em] text-ink-700">
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
                <p className="mt-1.5 font-code text-[10px] leading-relaxed tracking-[0.04em] text-ink-600">
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
              <p className="font-code text-[10px] font-semibold tracking-[0.04em] text-ink-600">
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
            <p className="max-w-[220px] font-code text-[10px] leading-relaxed tracking-[0.04em] text-ink-600 sm:max-w-none">
              SUBMITTED BY {(firstName || "unknown").toUpperCase()} · SAVED TO THE REVIEW RECORD
            </p>
            <div className="ml-auto flex items-center gap-2">
              {activeStep > 0 && (
                <button
                  type="button"
                  onClick={goBack}
                  disabled={busy}
                    className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 font-code text-[10.5px] font-bold tracking-[0.06em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950 disabled:opacity-60"
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
                      className="focus-brand inline-flex min-h-11 items-center rounded-xl px-3 font-code text-[10.5px] font-bold tracking-[0.06em] text-ink-600 transition-colors hover:text-ink-950 disabled:opacity-60"
                    >
                      SKIP
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={advanceStep}
                    disabled={busy}
                    className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-5 font-code text-[10.5px] font-bold tracking-[0.06em] text-white shadow-[0_10px_26px_rgba(217,38,22,0.28)] transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
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
                  className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-5 text-[13px] font-semibold text-white shadow-[0_10px_26px_rgba(217,38,22,0.28)] transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
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
  const editDialogRef = useRef<HTMLDivElement | null>(null);
  const editCloseRef = useRef<HTMLButtonElement | null>(null);
  const editOpenerRef = useRef<HTMLElement | null>(null);

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
      if (e.key !== "Escape" || editBusy) return;
      const focusedModal = document.activeElement?.closest('[role="dialog"][aria-modal="true"]');
      if (focusedModal && focusedModal !== editDialogRef.current) return;
      setEditing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, editBusy]);

  useEffect(() => {
    if (editing) {
      const active = document.activeElement;
      editOpenerRef.current = active instanceof HTMLElement ? active : null;
      requestAnimationFrame(() => editCloseRef.current?.focus());
      return;
    }
    const target = editOpenerRef.current;
    editOpenerRef.current = null;
    if (target?.isConnected) requestAnimationFrame(() => target.focus());
  }, [editing]);

  const trapEditTab = (event: ReactKeyboardEvent<HTMLDivElement>) => trapTabFocus(event, editDialogRef.current);

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
      setEditError("Supplier records are temporarily unavailable. Your change was not saved.");
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
        onToast((await sidecarError(res, "Supplier change was not saved. Please try again.")).toUpperCase());
        return;
      }
      await reload();
      onToast(
        status === "ACTIVE"
          ? `SUPPLIER REINSTATED — ${s.name.toUpperCase()}`
          : `SUPPLIER ${status} — ${s.name.toUpperCase()}`,
      );
    } catch {
      onToast("SUPPLIER CHANGE WAS NOT SAVED — PLEASE TRY AGAIN");
    }
  };

  const removeSupplier = async (s: SupplierRow) => {
    try {
      const res = await fetch(`/api/suppliers/${s.id}?XTransformPort=3031`, {
        method: "DELETE",
        headers: { "x-quorum-actor": firstName || "unknown" },
      });
      if (!res.ok) {
        onToast((await sidecarError(res, "Supplier record was not removed. Please try again.")).toUpperCase());
        return;
      }
      setConfirmDelete(null);
      await reload();
      onToast(`SUPPLIER REMOVED — ${s.name.toUpperCase()} · REMOVAL LOGGED`);
    } catch {
      onToast("SUPPLIER RECORD WAS NOT REMOVED — PLEASE TRY AGAIN");
    }
  };

  const statusTabs: { id: "ALL" | SupplierStatus; label: string; n: number }[] = [
    { id: "ALL", label: "ALL", n: counts.total },
    { id: "ACTIVE", label: "ACTIVE", n: counts.active },
    { id: "SUSPENDED", label: "SUSPENDED", n: counts.suspended },
    { id: "BLACKLISTED", label: "EXCLUDED", n: counts.blacklisted },
  ];

  return (
    <ViewShell
      fig="16"
      title="Suppliers"
      sub="Maintain supplier records, including PACRA registration, ZRA tax clearance and sector registration. Reviewers can compare bidder details against this register. New entries can be added from a published ZPPA e-GP record."
      action={
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1.5 font-code text-[10px] font-semibold tracking-[0.04em] text-ink-700">
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
            className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 font-code text-[10px] font-bold tracking-[0.04em] text-white shadow-[0_10px_26px_rgba(217,38,22,0.28)] transition-colors hover:bg-brand-700"
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
                  <p className="mt-1 font-code text-[10px] tracking-[0.04em] text-ink-600">
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
                    className="focus-brand h-11 w-52 rounded-full border border-ink-200 bg-paper pl-9 pr-3 text-[14px] text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-950 focus:ring-2 focus:ring-ink-950/10"
                  />
                </label>
              </div>
              <div data-tour="suppliers-filters" className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter suppliers by status">
                {statusTabs.map((t) => {
                  const on = statusFilter === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setStatusFilter(t.id)}
                      className={cn(
                        "focus-brand inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 font-code text-[10px] font-bold tracking-[0.04em] transition-colors",
                        on
                          ? "border-ink-950 bg-ink-950 text-white"
                          : "border-ink-200 bg-white text-ink-700 hover:border-ink-400 hover:text-ink-900",
                      )}
                    >
                      {t.label}
                      <span className={cn("tabular", on ? "text-brand-400" : "text-ink-400")}>{t.n}</span>
                    </button>
                  );
                })}
              </div>
            </header>

            <HorizontalScrollRegion label="Supplier register table">
              <table className="w-full min-w-[880px] border-collapse text-left" aria-label="Supplier register">
                <thead>
                  <tr className="border-b border-ink-100 bg-paper">
                    {["SUPPLIER", "ZRA TAX", "SECTOR REGISTRATION", "CONTACT", "STATUS", "ACTIONS"].map((h) => (
                        <th
                        key={h}
                        scope="col"
                        className={cn(
                          "px-5 py-3 font-code text-[10px] font-bold tracking-[0.04em] text-ink-700",
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
                          <p className="mt-1 font-code text-[10px] tracking-[0.04em] text-ink-600">
                            REG {s.registrationNo}
                          </p>
                          <p className="mt-1 font-code text-[10px] tracking-[0.04em] text-ink-600">
                            ADDED BY {(s.addedBy || "—").toUpperCase()} · {shortDateOf(s.createdAt)}
                          </p>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <p className="font-code text-[10px] tracking-[0.06em] text-ink-600">
                            PIN {s.taxPin || "—"}
                          </p>
                          <p className="mt-1 font-code text-[10px] tracking-[0.06em] text-ink-600">
                            TC {s.taxClearanceNo || "—"}
                          </p>
                          {s.taxClearanceExpiry && (
                            <p className="mt-1 font-code text-[10px] tracking-[0.04em] text-ink-600">
                              EXP {shortDateOf(s.taxClearanceExpiry)}
                            </p>
                          )}
                          {standing && (
                            <span
                              className={cn(
                                "mt-1.5 inline-flex min-h-7 items-center rounded-full border px-2.5 py-0.5 font-code text-[10px] font-bold tracking-[0.03em]",
                                standing.tone,
                              )}
                            >
                              {standing.label}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4 align-top">
                          <p className="font-code text-[10px] tracking-[0.06em] text-ink-600">
                            {s.regulator ? `${s.regulator} · ${s.regulatorNo || "—"}` : "NOT REQUIRED"}
                          </p>
                          {s.categories.length > 0 && (
                            <div className="mt-1.5 flex max-w-[220px] flex-wrap gap-1">
                              {s.categories.map((c) => (
                                <span
                                  key={c}
                                  className="rounded-full border border-ink-200 bg-white px-2 py-0.5 font-code text-[10px] tracking-[0.02em] text-ink-700"
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
                          <p className="mt-0.5 font-code text-[10px] tracking-[0.04em] text-ink-600">{s.phone || "—"}</p>
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
                              className="focus-brand grid h-11 w-11 place-items-center rounded-lg text-ink-600 transition-colors hover:bg-paper hover:text-ink-950"
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
                                className="focus-brand grid h-11 w-11 place-items-center rounded-lg text-ink-600 transition-colors hover:bg-brand-50 hover:text-brand-800"
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
                            ? "Register the firms your entity works with, or add a supplier from a published ZPPA record. Supplier details are available to authorised reviewers."
                            : "Clear the search or switch the status filter to see the rest of the roll."}
                        </p>
                        {suppliers.length === 0 && (
                          <button
                            type="button"
                            onClick={openAdd}
                            className="focus-brand mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 font-code text-[10px] font-bold tracking-[0.04em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950"
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
            </HorizontalScrollRegion>
          </div>

          <p className="mt-3 font-code text-[10px] tracking-[0.04em] text-ink-600">
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
          >
            <motion.div
              ref={editDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="supplier-edit-title"
              tabIndex={-1}
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.28, ease: EASE }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={trapEditTab}
              className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-[12px] panel panel-lift p-5 sm:p-7"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-code text-[10px] font-semibold tracking-[0.08em] text-ink-600">EDIT SUPPLIER</p>
                  <h3 id="supplier-edit-title" className="mt-1 truncate font-display text-[20px] font-black tracking-[-0.015em] text-ink-950">
                    {editing.name}
                  </h3>
                  <p className="mt-1 font-code text-[10px] tracking-[0.04em] text-ink-600">
                    REG {editing.registrationNo} · ADDED {shortDateOf(editing.createdAt)}
                  </p>
                </div>
                <button
                  ref={editCloseRef}
                  type="button"
                  onClick={() => {
                    if (!editBusy) setEditing(null);
                  }}
                  aria-label="Close without saving"
                  className="focus-brand grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-paper hover:text-ink-900"
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
                  className="focus-brand inline-flex min-h-11 items-center rounded-xl border border-ink-200 bg-white px-5 font-code text-[10px] font-bold tracking-[0.06em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950 disabled:opacity-60"
                >
                  CANCEL
                </button>
                <button
                  type="button"
                  onClick={() => void saveEdit()}
                  disabled={editBusy}
                  className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-5 text-[13px] font-semibold text-white shadow-[0_10px_26px_rgba(217,38,22,0.28)] transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
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
  onOpenAudit,
}: {
  firstName: string;
  onToast: (m: string) => void;
  onOpenAudit: () => void;
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
      desc: "Minimum documents required before a tender review can be completed —",
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
      desc: "Two different officers must approve decisions at or above this value. Set to 0 to turn off the second approval —",
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
            className="focus-brand h-11 w-40 rounded-lg border border-ink-200 bg-white px-3 font-code text-[12px] tabular text-ink-900 outline-none transition-colors focus:border-brand-600 dark:border-white/15 dark:bg-white/[0.04] dark:text-ink-100"
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
            className="focus-brand inline-flex min-h-11 items-center rounded-lg bg-ink-950 px-3.5 font-code text-[10px] font-bold tracking-[0.04em] text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            SET
          </button>
          <span className="font-code text-[10px] tracking-[0.04em] text-ink-600">
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
          <p className="mt-3 font-code text-[10px] tracking-[0.04em] text-ink-600">
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
            className="focus-brand h-11 w-24 rounded-lg border border-ink-200 bg-white px-3 font-code text-[12px] tabular text-ink-900 outline-none transition-colors focus:border-brand-600 dark:border-white/15 dark:bg-white/[0.04] dark:text-ink-100"
          />
          <span className="font-code text-[10px] tracking-[0.04em] text-ink-600">POINTS</span>
          <button
            type="button"
            disabled={locked || !divergenceDraft}
            onClick={() => {
              const next = Number(divergenceDraft);
              if (!Number.isFinite(next) || next <= 0 || next > 100) return;
              void setGuard({ scoreDivergencePoints: next }, `EVALUATOR DIVERGENCE AT ${next} POINTS`);
              setDivergenceDraft("");
            }}
            className="focus-brand inline-flex min-h-11 items-center rounded-lg bg-ink-950 px-3.5 font-code text-[10px] font-bold tracking-[0.04em] text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            SET
          </button>
          <span className="font-code text-[10px] tracking-[0.04em] text-ink-600">
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
            className="focus-brand h-11 w-24 rounded-lg border border-ink-200 bg-white px-3 font-code text-[12px] tabular text-ink-900 outline-none transition-colors focus:border-brand-600 dark:border-white/15 dark:bg-white/[0.04] dark:text-ink-100"
          />
          <span className="font-code text-[10px] tracking-[0.04em] text-ink-600">DAYS</span>
          <button
            type="button"
            disabled={locked || !stalenessDraft}
            onClick={() => {
              const next = Number(stalenessDraft);
              if (!Number.isFinite(next) || next < 1 || next > 365) return;
              void setGuard({ fxStalenessDays: next }, `FX QUOTES STALE AFTER ${next} DAYS`);
              setStalenessDraft("");
            }}
            className="focus-brand inline-flex min-h-11 items-center rounded-lg bg-ink-950 px-3.5 font-code text-[10px] font-bold tracking-[0.04em] text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            SET
          </button>
          <span className="font-code text-[10px] tracking-[0.04em] text-ink-600">
            ACTIVE — {shown.fxStalenessDays} DAYS
          </span>
        </div>
      ),
    },
  ];

  return (
    <ViewShell
      fig="13"
      title="Rules & controls"
      sub="Set the thresholds and document checks used during a review. Quorum records each permitted change with the person who made it."
    >
      {/* Full-width: guards flow edge-to-edge in a two-column grid,
          with the standing-rule rail as a full-width row beneath. */}
      {!guards && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-ink-100 bg-white px-4 py-3 sm:mb-6">
          <span
            className={cn("h-1.5 w-1.5 rounded-full", loadFailed ? "bg-red-500" : "animate-pulse bg-amber-400")}
            aria-hidden="true"
          />
          <p className="font-code text-[10px] font-semibold tracking-[0.06em] text-ink-600">
            {loadFailed ? "GUARD SERVICE UNREACHABLE — SETTINGS NOT LOADED" : "SYNCING GUARDS WITH THE SIDE-CAR…"}
          </p>
          {loadFailed && (
            <button
              type="button"
              onClick={() => load()}
              className="focus-brand ml-auto inline-flex min-h-11 items-center rounded px-2 font-code text-[10px] font-bold tracking-[0.04em] text-brand-800 transition-colors hover:text-brand-900"
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
            <p className="font-code text-[10px] font-semibold tracking-[0.06em] text-ink-600">GUARD {g.no}</p>
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
              <p className="font-code text-[10px] font-semibold tracking-[0.06em] text-ink-600">GUARD 05</p>
              <h3 className="mt-1.5 font-display text-[15px] font-black tracking-[-0.01em] text-ink-950">Citation policy</h3>
              <p className="mt-1 max-w-md text-[12.5px] text-ink-500">
                Page-level citations on every claim. Zero unsourced tolerated — not a setting, a design constraint.
              </p>
            </div>
            <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 font-code text-[10px] font-bold tracking-[0.04em] text-brand-900">
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
            <p className="font-code text-[10px] leading-relaxed tracking-[0.04em] text-ink-700">
              EVERY GUARD CHANGE IS LOGGED — NAME, TIMESTAMP, BEFORE &amp; AFTER VALUES.
            </p>
            <p className="mt-2 font-code text-[10px] leading-relaxed tracking-[0.04em] text-brand-900">
              {shown.updatedAt
                ? `LAST CHANGE — ${stampOf(shown.updatedAt)} · BY ${String(shown.updatedBy ?? "unknown").toUpperCase()}`
                : "NO GUARD CHANGES YET — THE CARVED SETTINGS STAND."}
            </p>
            <button
              type="button"
              onClick={onOpenAudit}
              className="focus-brand mt-2 inline-flex min-h-11 items-center gap-1.5 rounded px-2 font-code text-[10px] font-bold tracking-[0.04em] text-ink-700 transition-colors hover:text-ink-950"
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
      title="Tender reviews"
      sub="Browse tender reviews by status. Open a review to inspect its findings, supporting evidence and audit history."
      action={
        <DeskStatus tone={live > 0 ? "live" : runs.length > 0 ? "clear" : "idle"}>
          {live > 0
            ? `${reading} in progress · ${atGate} awaiting approval`
            : queued > 0
              ? `${queued} waiting to start`
              : runs.length > 0
                ? "No active reviews"
                : "No reviews yet"}
        </DeskStatus>
      }
      summary={
        <StageStrip
          label="Review status"
          meta={
            runs.length > 0
              ? `${runs.length} TENDER REVIEW${runs.length === 1 ? "" : "S"} RECORDED${coverage !== null ? ` · ${coverage}% OF FINDINGS HAVE SOURCES` : ""}`
              : "NO TENDER REVIEWS YET"
          }
          items={[
            { key: "queued", label: "Waiting", count: queued, caption: "NOT STARTED" },
            { key: "reading", label: "In progress", count: reading, caption: "CHECKS RUNNING", tone: reading ? "brand" : "idle" },
            { key: "gate", label: "Awaiting approval", count: atGate, caption: "DECISION NEEDED", tone: atGate ? "brand" : "idle" },
            { key: "decided", label: "Complete", count: decided, caption: "DECISION RECORDED", tone: decided ? "emerald" : "idle" },
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
      sub="Tender reviews awaiting a committee decision. Members can inspect the findings and sources, then record their decision under their own name."
      action={
        <DeskStatus tone={queue.length > 0 ? "live" : "clear"}>
          {queue.length > 0 ? `${queue.length} waiting on a signature` : "All clear"}
        </DeskStatus>
      }
      summary={
        <StageStrip
          label="Decision authority"
          search={
            <label className="relative block w-full min-w-0 max-w-[13rem]">
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
                className="focus-brand h-11 w-full rounded-md border border-ink-200/80 bg-[#fffdfb] pl-7 pr-2.5 text-base text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-950 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-white dark:placeholder:text-ink-500 dark:focus:border-white/35"
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
                At least five of the nine committee members must be present before an award can be approved.
              </p>
              <span className="mt-4 inline-flex min-h-11 items-center gap-1.5 font-code text-[10px] font-bold tracking-[0.06em] text-brand-300">
                VIEW COMMITTEE MEMBERS
                <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
              </span>
            </div>
          </button>
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
  const [activeCyclePage, setActiveCyclePage] = useState<CyclePageTab>("solicitation");
  const [navOpen, setNavOpen] = useState(false);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
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

  /* The mobile drawer behaves like a modal navigation surface: contain focus,
     close on Escape or desktop resize, and return focus to its trigger. */
  useEffect(() => {
    if (!navOpen) return;
    const drawer = mobileMenuRef.current;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const selector = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const focusableItems = () =>
      Array.from(drawer?.querySelectorAll<HTMLElement>(selector) ?? []).filter(
        (element) => !element.closest("[hidden], .hidden, [aria-hidden='true']"),
      );

    document.body.style.overflow = "hidden";
    focusableItems()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setNavOpen(false);
        return;
      }
      if (event.key !== "Tab" || !drawer) return;
      const items = focusableItems();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        drawer.focus();
      } else if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    const onDesktop = () => {
      if (desktop.matches) setNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    desktop.addEventListener("change", onDesktop);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      desktop.removeEventListener("change", onDesktop);
      if (desktop.matches) {
        requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('button[aria-label="Jump to a workspace section"]')?.focus());
      } else if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
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

  const activeRuns = runs.filter((r) => r.status === "running").length;
  const findingsTotal = runs
    .filter((r) => r.status === "gate" || r.status === "complete")
    .reduce((sum, r) => sum + r.findings, 0);
  const citedTotal = runs
    .filter((r) => r.status === "gate" || r.status === "complete")
    .reduce((sum, r) => sum + r.citations, 0);
  const citationPct = findingsTotal > 0 ? Math.round((citedTotal / findingsTotal) * 100) : null;
  /* Count unsourced findings in the same finished review set as the KPI above. */
  const unsourcedTotal = runs
    .filter((r) => r.status === "gate" || r.status === "complete")
    .reduce((sum, r) => sum + (r.unsourced ?? 0), 0);

  const findingRows = useMemo(() => buildFindingRows(findings, runs, verdicts), [findings, runs, verdicts]);
  const openFindings = findingRows.filter((r) => r.status === "OPEN").length;

  const switchTo = (id: SectionId) => {
    if (!canOpenSection(user, id)) {
      onToast("YOUR WORKSPACE ROLE DOES NOT OPEN THAT SECTION");
      return;
    }
    setNavOpen(false);
    setActive(id);
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" }));
  };

  const switchToCyclePage = (page: CyclePageTab) => {
    setActiveCyclePage(page);
    switchTo("mc-cycle");
  };

  /* Document checks remain a separate, permissioned workflow from bidder
     scoring in Tender workflow → Bid evaluation. */
  const openNewRun = () => {
    if (!canDo(user?.role, "run_reviews")) {
      onToast("YOUR WORKSPACE ROLE CANNOT START A DOCUMENT REVIEW");
      return;
    }
    setModalOpen(true);
  };
  const openBidEvaluation = () => switchToCyclePage("evaluation");

  /* The palette's contents: two actions, then every section of the desk in the
     same order as the rail, carrying the same live counts as the sidebar. */
  const paletteGroups: PaletteGroup[] = [
    {
      label: "Actions",
      entries: [
        ...(canOpenSection(user, "mc-cycle")
          ? [{
              id: "open-bid-evaluation",
              label: "Open Bid evaluation",
              icon: Scale,
              hint: "TENDER WORKFLOW",
              keywords: "bid evaluation bidder Meta AI tender workflow",
              run: openBidEvaluation,
            }]
          : []),
        ...(canDo(user?.role, "run_reviews")
          ? [
              {
                id: "new-document-review",
                label: "Start a document review",
                icon: Plus,
                hint: "DOCUMENT CHECKS",
                keywords: "start run document review upload",
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

  const launchRun = async (ref: string, title: string, format: string, docs: number, checks: number, sourceRef?: string) => {
    let res: Response;
    try {
      res = await fetch("/api/runs?XTransformPort=3031", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenderId: sourceRef || ref, reference: ref }),
      });
    } catch {
      throw new Error("The review service is unavailable. Check your connection and try again.");
    }
    if (!res.ok) throw new Error(`The review service could not start this review (HTTP ${res.status}). Check the tender reference and try again.`);
    setModalOpen(false);
    /* Guide the officer to the register — the review status updates there. */
    setActive("mc-runs");
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" }));
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
      onToast("APPROVAL NOT RECORDED — ADDITIONAL SIGN-IN WAS CANCELLED");
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
        onToast(data.error ? data.error.toUpperCase() : "DECISION NOT RECORDED — CHECK YOUR PERMISSIONS AND TRY AGAIN");
        return false;
      }
    } catch {
      onToast("DECISION NOT RECORDED — THE REVIEW SERVICE IS UNAVAILABLE");
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
    onToast(`APPROVAL RECORDED — ${g.tender} AWARDED · SIGNATURE SAVED`);
  };

  const returnGate = async (g: GateItem) => {
    if (!(await decideGate(g, "REJECT"))) return;
    onToast(`${g.tender} RETURNED FOR CLARIFICATION`);
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
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" }));
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
          title="Access unavailable"
          sub={`Your account${user?.role ? ` (${ROLE_LABELS[user.role]})` : ""} does not have access to this section. Contact a workspace administrator if you need access.`}
        >
          <button
            type="button"
            onClick={() => switchTo("mc-overview")}
            className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-xl bg-ink-950 px-4 font-code text-[10px] font-bold tracking-[0.06em] text-white transition-colors hover:bg-ink-800"
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
      case "mc-cycle":
        return (
          <CycleView
            user={user}
            onToast={onToast}
            canDeleteDocuments={canDo(user?.role, "run_reviews")}
            canReviewBids={canDo(user?.role, "read_documents")}
            selectedPage={activeCyclePage}
            onPageChange={setActiveCyclePage}
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
        return <RulesView firstName={firstName} onToast={onToast} onOpenAudit={() => switchTo("mc-audit")} />;
      case "mc-stack":
        return <StackConsole onToast={onToast} />;
      case "mc-oversight":
        return <OversightView actor={user} onToast={onToast} />;
      case "mc-governance":
        return <GovernanceView user={user} onToast={onToast} />;
      case "mc-compliance":
        return <ComplianceView user={user} onToast={onToast} />;
      case "mc-readiness":
        return <ReadinessView user={user} onToast={onToast} />;
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
            onOpenEvaluation={openBidEvaluation}
            onTour={startTour}
            done={toured}
          />
        );
      case "mc-suppliers":
        return <SuppliersView firstName={firstName} onToast={onToast} />;
      case "mc-integrations":
        return <IntegrationsView />;
      case "mc-api":
        return <ApiView />;
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
            initial={reduceMotion ? false : { x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.32, ease: EASE }}
            className="fixed inset-y-0 left-0 z-40 hidden w-[264px] flex-col border-r border-white/[0.08] bg-ink-950 bg-grid-sidebar shadow-[24px_0_60px_-40px_rgba(0,0,0,0.9)] lg:flex"
            aria-label="Workspace sidebar"
            aria-hidden={navOpen || undefined}
            inert={navOpen}
          >
            <button
              type="button"
              onClick={() => setNavCollapsedPersisted(true)}
              aria-label="Collapse sidebar"
              title="Collapse the sidebar"
              className="focus-brand absolute right-3 top-5 z-10 grid h-11 w-11 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="relative flex h-full flex-col">
              <SidebarContent
                active={active}
                activeCyclePage={activeCyclePage}
                user={user}
                counts={{ runs: runs.length, gates: queue.length, findings: openFindings }}
                agent={agent}
                onNavigate={switchTo}
                onNavigateCyclePage={switchToCyclePage}
                onSignOut={onSignOut}
                onExit={onExit}
              />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Mobile top bar */}
      <header
        className="mobile-safe-header sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-white/[0.07] bg-night lg:hidden"
        aria-hidden={navOpen || undefined}
        inert={navOpen}
      >
        <button
          type="button"
          onClick={onExit}
          aria-label="Quorum home"
          title="Return to the landing page"
          className="focus-brand inline-flex shrink-0 rounded-xl border-0 bg-transparent p-0 text-left"
        >
          <QuorumLogo variant="light" />
        </button>
        <div className="flex items-center gap-2.5">
          {/* Reports the sidecar's real state — never a hardcoded "online" */}
          <AgentStatusBadge mode={agentMode} className="hidden sm:inline-flex" darkSurface />
          <button
            ref={mobileMenuTriggerRef}
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open workspace menu"
            aria-expanded={navOpen}
            aria-controls={navOpen ? "workspace-mobile-drawer" : undefined}
            className="focus-brand grid h-11 w-11 place-items-center rounded-full border border-white/15 text-white transition-colors hover:border-brand-500"
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
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.2 }}
              className="fixed inset-0 z-[60] bg-night/70 backdrop-blur-sm lg:hidden"
              onClick={() => setNavOpen(false)}
              aria-hidden="true"
            />
            <motion.aside
              ref={mobileMenuRef}
              id="workspace-mobile-drawer"
              role="dialog"
              aria-modal="true"
              tabIndex={-1}
              initial={reduceMotion ? false : { x: "-100%" }}
              animate={{ x: 0 }}
              exit={reduceMotion ? { x: 0 } : { x: "-100%" }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.32, ease: EASE }}
              className="mobile-safe-drawer fixed inset-y-0 left-0 z-[61] bg-ink-950 bg-grid-sidebar lg:hidden"
              aria-label="Workspace navigation"
            >
              <div className="relative flex h-full flex-col">
                <button
                  type="button"
                  onClick={() => setNavOpen(false)}
                  aria-label="Close menu"
                  className="focus-brand absolute right-3 top-4 grid h-11 w-11 place-items-center rounded-lg text-ink-200 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-4.5 w-4.5" aria-hidden="true" />
                </button>
                <SidebarContent
                  active={active}
                  activeCyclePage={activeCyclePage}
                  user={user}
                  counts={{ runs: runs.length, gates: queue.length, findings: openFindings }}
                  agent={agent}
                  onNavigate={switchTo}
                  onNavigateCyclePage={switchToCyclePage}
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
        aria-hidden={navOpen || undefined}
        inert={navOpen}
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
                  className="focus-brand hidden h-11 w-11 shrink-0 place-items-center rounded-full border border-ink-200/80 bg-white text-ink-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 lg:grid dark:border-white/10 dark:bg-white/[0.04]"
                >
                  <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              {/* The breadcrumb is pure navigation: where I am. System state
                  lives in the status cluster on the right — one pulsing dot
                  per screen, not two. */}
              <nav aria-label="Workspace location" className="flex min-w-0 items-center gap-2.5">
                <span className="hidden shrink-0 font-code text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500 sm:inline">
                  Workspace
                </span>
                <span className="hidden shrink-0 text-[11px] text-ink-300 sm:inline dark:text-ink-600" aria-hidden="true">
                  /
                </span>
                <span
                  aria-current="page"
                  aria-live="polite"
                  aria-atomic="true"
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
                className="focus-brand inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border border-ink-200/80 bg-white/60 px-2.5 text-ink-500 shadow-[0_1px_2px_rgba(11,12,15,0.03)] transition-colors hover:border-ink-300 hover:text-ink-900 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-ink-400 dark:hover:border-white/20 dark:hover:text-white"
              >
                <CommandIcon className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="font-code text-[10px] font-bold tracking-[0.06em] sm:hidden">JUMP TO</span>
                <span className="hidden font-code text-[10px] font-bold tracking-[0.06em] xl:inline">JUMP TO</span>
                <kbd
                  aria-hidden="true"
                  className="hidden rounded-[4px] border border-ink-200/80 bg-white px-1 py-[2px] font-code text-[10px] font-bold leading-none text-ink-500 lg:inline dark:border-white/10 dark:bg-white/[0.06] dark:text-ink-400"
                >
                  ⌘K
                </kbd>
              </button>
              {/* The field flexes with the bar: full share of the tool zone,
                  capped at its resting width — focus no longer reflows the
                  status cluster because the width never jumps. */}
              <div className="relative hidden min-w-0 w-full max-w-[13rem] sm:block">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400 dark:text-[#a8adb7]"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search evaluations…"
                  aria-label="Search evaluations by reference, title or buyer"
                  className="focus-brand h-11 w-full rounded-lg border border-ink-200/80 bg-[#fffdfb] pl-9 pr-3.5 text-base text-ink-900 shadow-[inset_0_1px_1px_rgba(11,12,15,0.03)] outline-none transition-[border-color,background-color] duration-300 placeholder:text-ink-400 focus:border-ink-950 focus:ring-[3px] focus:ring-ink-950/[0.07] dark:border-white/[0.1] dark:bg-white/[0.04] dark:focus:border-white/35 dark:focus:ring-white/[0.06]"
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
          tabIndex={-1}
          className={cn(
            "mx-auto w-full px-4 pb-24 pt-6 outline-none sm:px-6 lg:px-8 lg:pt-7",
            active === "mc-stack" ? "max-w-none" : "max-w-[1500px]"
          )}
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
                The review service is not responding. Some workspace information may be out of date.
              </p>
              <p className="font-code text-[10px] tracking-[0.04em] text-brand-800">
                VIEW SERVICE STATUS IN SETTINGS
              </p>
            </div>
          )}
          {/* Greeting */}
          <section id="mc-overview" aria-labelledby="mc-greeting" className="scroll-mt-20">
            <div className="flex flex-wrap items-end justify-between gap-5">
              <div className="min-w-0">
                <h1
                  id="mc-greeting"
                  className="type-display text-[34px] text-ink-950 sm:text-[44px]"
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
                  data-tour="ov-bid-evaluation"
                  onClick={openBidEvaluation}
                  className="focus-brand group relative inline-flex h-12 items-center gap-2.5 overflow-hidden rounded-full bg-brand-600 pl-5 pr-4 text-[14px] font-semibold text-white shadow-[0_1px_0_rgba(255,255,255,0.18)_inset,0_16px_34px_-16px_rgba(217,38,22,0.9)] transition-colors hover:bg-brand-700"
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                  />
                  <Scale className="relative h-4 w-4" aria-hidden="true" />
                  <span className="relative">Open Bid evaluation</span>
                </button>
              </div>
            </div>

            {/* Stats — the editorial band in light mode, quiet surfaced cards in dark mode */}
            <div
              data-tour="ov-stats"
              className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-ink-200/70 bg-ink-200/60 shadow-[0_1px_2px_rgba(11,12,15,0.04),0_18px_40px_-24px_rgba(11,12,15,0.26)] dark:gap-3 dark:overflow-visible dark:border-0 dark:bg-transparent dark:shadow-none xl:grid-cols-4"
            >
              <StatCard
                index="01"
                label="Reviews in progress"
                value={activeRuns}
                sub={activeRuns > 0 ? "REVIEW IN PROGRESS" : "NO REVIEWS IN PROGRESS"}
                delay={0.05}
              />
              <StatCard
                index="02"
                label="Issues found"
                value={findingsTotal}
                sub={
                  findingsTotal === 0
                    ? "AVAILABLE AFTER A REVIEW"
                    : unsourcedTotal > 0
                      ? `${unsourcedTotal} STILL AWAIT A SOURCE`
                      : "ALL FINDINGS LINKED TO SOURCES"
                }
                delay={0.12}
              />
              <StatCard
                index="03"
                label="Citation coverage"
                value={citationPct}
                suffix="%"
                sub={
                  findingsTotal === 0
                    ? "AVAILABLE AFTER FINDINGS ARE RECORDED"
                    : unsourcedTotal > 0
                      ? `${unsourcedTotal} FINDING${unsourcedTotal === 1 ? "" : "S"} WITHOUT A SOURCE`
                      : "ALL FINDINGS LINKED TO SOURCES"
                }
                delay={0.19}
              />
              <StatCard
                index="04"
                label="Approvals awaiting action"
                value={queue.length}
                sub={queue.length > 0 ? "AUTHORISATION IS REQUIRED" : "NO APPROVALS PENDING"}
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

          {/* Bottom strip */}
          <p className="mt-12 border-t border-ink-200/70 pt-5 text-center type-micro text-ink-400 dark:border-white/10">
            Quorum · workspace · session {initialsOf(user?.name ?? "Q")} · verifiable audit history · no trackers
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
        pastRefs={runs.map((r) => r.reference ?? r.id)}
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
