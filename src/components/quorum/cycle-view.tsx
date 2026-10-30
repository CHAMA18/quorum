"use client";

/**
 * CycleView — the tender cycle, every phase from solicitation to closure.
 *
 * Wave 1-3 of the procurement-cycle build, one desk view: pipeline (G17),
 * deadlines (G16), bid opening (G3/G8), COI + evaluation matrix + MED
 * (G1/G2/G4), ALB (G9), award report + notice + standstill + debriefs
 * (G6/G7), contract pack + register (G12/G13), complaints (G14) and the
 * analytics/procurement-file read-side (G15/G5).
 *
 * Every action here calls the quorum-mcp sidecar through the gateway —
 * the same cores the MCP tools call — and irreversible steps always land
 * in the Approvals queue for a named human with the right office.
 *
 * The shell is a live instrument: the cycle rail derives the tender's real
 * stage from its record and lets the officer jump between phases, the
 * vitals strip reads the desk's numbers, and the tab bar carries context
 * badges. Both themes are first-class — every raw colour carries a dark
 * variant, tokens do the rest.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  Download,
  FileSignature,
  Flag,
  Loader2,
  Play,
  Plus,
  Scale,
  Search,
  Stamp,
  Upload,
  Workflow,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StoredDocsBrowser } from "@/components/quorum/stored-docs-browser";

const SVC = "?XTransformPort=3031";
const EASE = [0.22, 1, 0.36, 1] as const;

const OFFICES = ["PROCUREMENT_UNIT", "EVALUATION_COMMITTEE", "ACCOUNTING_OFFICER", "OVERSIGHT"] as const;
const CURRENCIES = ["ZMW", "KES", "USD", "RWF"] as const;
const OFFICE_LABELS: Record<string, string> = {
  PROCUREMENT_UNIT: "Procurement unit",
  EVALUATION_COMMITTEE: "Evaluation committee",
  ACCOUNTING_OFFICER: "Accounting officer",
  OVERSIGHT: "Oversight / audit",
};
const OFFICE_BLURBS: Record<string, string> = {
  PROCUREMENT_UNIT: "Runs the pack and keeps the file.",
  EVALUATION_COMMITTEE: "Scores the bids and certifies the matrix.",
  ACCOUNTING_OFFICER: "Signs the award and the contract.",
  OVERSIGHT: "Reads the record; never writes it.",
};

type OpeningRow = { id: string; bidder: string; receivedAt: string; late: boolean; priceRead?: string };
type PortalAppRow = {
  id: string;
  tenderId: string;
  orgName: string;
  amount: number;
  currency?: string;
  receivedAt: string;
  status: string;
};
type OpeningDto = {
  id: string;
  closingDate?: string;
  rows: OpeningRow[];
  minutesMd: string;
  certifiedAt?: string;
  certifiedBy?: string;
  sha?: string;
  gateId?: string;
};
type MatrixDto = {
  id: string;
  status: "DRAFT" | "CERTIFIED";
  criteria: { id: string; title: string; weight: number }[];
  technicalWeightPct: number;
  bids: {
    bidder: string;
    late: boolean;
    responsiveness: string;
    reasons: string[];
    technicalScores: { criterionId: string; score: number; note?: string }[];
    technicalTotal: number;
    financial?: { amount: number; currency?: string; formulaScore?: number };
    total?: number;
    verdict: string;
  }[];
  med?: { recordedAt: string; attendees: string[]; notes?: string };
  certifiedBy?: string;
};
type CycleDto = {
  tenderId: string;
  closingDate?: string;
  opening?: OpeningDto;
  coi: { id: string; member: string; declaration: string; conflicts?: string; declaredAt: string }[];
  matrix?: MatrixDto;
  alb: { id: string; bidder: string; responseDueAt: string; resolution?: { outcome: string; note: string } }[];
  awardReport?: { sha: string; recommendation?: string; signedAt?: string; signedBy?: string };
  awardNotice?: { portal: string; publishedAt?: string };
  standstill?: { startsAt: string; endsAt: string; days: number; status: string };
  debriefs: { id: string; bidder: string; status: string }[];
  contract?: {
    supplier: string;
    value: number;
    currency?: string;
    completedAt?: string;
    milestones: { id: string; title: string; dueDate?: string; status: string }[];
    variations: { id: string; description: string; pctOfContract: number; status: string; valueDelta: number }[];
    payments: { id: string; description: string; amount: number; certifiedAt?: string }[];
  };
  complaints: { id: string; complainant: string; subject: string; status: string; duringStandstill: boolean; receivedAt: string }[];
  clarifications: { id: string; question: string; askedBy: string; answer?: string }[];
  addenda: { id: string; number: number; summary: string; extendsClosingTo?: string; closingExtensionRequired?: boolean }[];
};
type PipelineDto = {
  id: string;
  ref: string;
  title: string;
  office?: string;
  budgetEstimate?: number;
  currency?: string;
  expectedPublication?: string;
  status: string;
  linkedTenderId?: string;
};
type DeadlineDto = { tenderId: string; kind: string; dueAt: string; ref?: string; overdue?: boolean };
type MemberDto = { name: string; office?: string; status: string };
type TenderExtractionField<T> = { value: T | null; confidence: number; evidence: string | null };
type TenderExtraction = {
  title: TenderExtractionField<string>;
  responsibleOffice: TenderExtractionField<(typeof OFFICES)[number]>;
  publicationDate: TenderExtractionField<string>;
  budgetEstimate: TenderExtractionField<number>;
  currency: TenderExtractionField<(typeof CURRENCIES)[number]>;
  warnings: string[];
};
type NoticeAnalysisState = {
  status: "idle" | "analyzing" | "ready" | "error";
  fileName?: string;
  model?: string;
  extractionNote?: string;
  error?: string;
  fields?: TenderExtraction;
  conflicts: string[];
};

/* A cycle row is written by several cores over time; a partially-written row
   can omit any of its nested collections. Normalize once at ingest so every
   tab reads real arrays instead of a maybe. */
function normalizeCycle(raw: CycleDto): CycleDto {
  const opening = raw.opening
    ? { ...raw.opening, rows: Array.isArray(raw.opening.rows) ? raw.opening.rows : [] }
    : undefined;
  const matrix = raw.matrix
    ? {
        ...raw.matrix,
        criteria: Array.isArray(raw.matrix.criteria) ? raw.matrix.criteria : [],
        bids: (Array.isArray(raw.matrix.bids) ? raw.matrix.bids : []).map((bid) => ({
          ...bid,
          reasons: Array.isArray(bid.reasons) ? bid.reasons : [],
          technicalScores: Array.isArray(bid.technicalScores) ? bid.technicalScores : [],
        })),
        ...(raw.matrix.med
          ? {
              med: {
                ...raw.matrix.med,
                attendees: Array.isArray(raw.matrix.med.attendees) ? raw.matrix.med.attendees : [],
              },
            }
          : {}),
      }
    : undefined;
  const contract = raw.contract
    ? {
        ...raw.contract,
        milestones: Array.isArray(raw.contract.milestones) ? raw.contract.milestones : [],
        variations: Array.isArray(raw.contract.variations) ? raw.contract.variations : [],
        payments: Array.isArray(raw.contract.payments) ? raw.contract.payments : [],
      }
    : undefined;

  return {
    ...raw,
    coi: Array.isArray(raw.coi) ? raw.coi : [],
    alb: Array.isArray(raw.alb) ? raw.alb : [],
    debriefs: Array.isArray(raw.debriefs) ? raw.debriefs : [],
    complaints: Array.isArray(raw.complaints) ? raw.complaints : [],
    clarifications: Array.isArray(raw.clarifications) ? raw.clarifications : [],
    addenda: Array.isArray(raw.addenda) ? raw.addenda : [],
    ...(opening ? { opening } : {}),
    ...(matrix ? { matrix } : {}),
    ...(contract ? { contract } : {}),
  };
}

type CycleTab = "pipeline" | "deadlines" | "opening" | "evaluation" | "award" | "contract" | "complaints" | "analytics";

const TABS: { id: CycleTab; label: string }[] = [
  { id: "pipeline", label: "Pipeline" },
  { id: "deadlines", label: "Deadlines" },
  { id: "opening", label: "Opening" },
  { id: "evaluation", label: "Evaluation" },
  { id: "award", label: "Award" },
  { id: "contract", label: "Contract" },
  { id: "complaints", label: "Complaints" },
  { id: "analytics", label: "Analytics" },
];

/* ── formatting helpers ─────────────────────────────────────────────────────── */

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtDateTime = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const fmtMoney = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);

/** Whole days from now until the iso instant (negative = past). */
function daysUntil(iso?: string): number | undefined {
  if (!iso) return undefined;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

/** Compact relative label: "in 103 d" · "in 3 d" · "2 d overdue". */
function relDays(iso?: string): string {
  const n = daysUntil(iso);
  if (n === undefined) return "—";
  if (n > 1) return `in ${n} d`;
  if (n === 1) return "tomorrow";
  if (n === 0) return "today";
  return `${-n} d overdue`;
}

/* ── the cycle rail: seven stages, derived from the tender's own record ─────── */

type StageState = "done" | "current" | "todo";
type Stage = {
  key: string;
  label: string;
  tab: CycleTab;
  state: StageState;
  caption?: string;
  /* True when the desk has reached this stage but an irreversible step is
     parked at a named human's gate (or the standstill clock is running).
     Derived strictly from the record — never from a feeling. */
  held?: boolean;
};

function deriveStages(c: CycleDto | null): { stages: Stage[]; doneCount: number; currentIndex: number } {
  const raw: { key: string; label: string; tab: CycleTab; done: boolean; caption: string; held?: boolean }[] = [
    {
      key: "solicitation",
      label: "Solicitation",
      tab: "pipeline",
      done: !!c?.opening,
      caption: c?.closingDate ? `closes ${fmtDate(c.closingDate)}` : "pack on the desk",
    },
    {
      key: "opening",
      label: "Opening",
      tab: "opening",
      done: !!c?.opening?.certifiedAt,
      held: !!c?.opening && !c.opening.certifiedAt,
      caption: c?.opening?.certifiedAt ? "register certified" : c?.opening ? "awaiting certification gate" : "public bid opening",
    },
    {
      key: "evaluation",
      label: "Evaluation",
      tab: "evaluation",
      done: !!c?.matrix?.certifiedBy,
      held: !!c?.matrix && !c.matrix.certifiedBy,
      caption: c?.matrix?.certifiedBy ? "matrix certified" : c?.matrix ? "matrix in draft — at the gate" : "matrix · MED · COI",
    },
    {
      key: "award",
      label: "Award",
      tab: "award",
      done: !!c?.awardReport?.signedAt,
      held: !!c?.awardReport && !c.awardReport.signedAt,
      caption: c?.awardReport?.signedAt ? "report signed" : c?.awardReport ? "awaiting the gavel" : "report at the gate",
    },
    {
      key: "standstill",
      label: "Standstill",
      tab: "award",
      done: !!c?.standstill && c.standstill.status !== "ACTIVE",
      held: c?.standstill?.status === "ACTIVE",
      caption: c?.standstill?.status === "ACTIVE" ? `ends ${fmtDate(c.standstill.endsAt)}` : c?.standstill ? "lifted — clear" : "10 wd on publication",
    },
    {
      key: "contract",
      label: "Contract",
      tab: "contract",
      done: !!c?.contract?.completedAt,
      caption: c?.contract?.completedAt ? "acceptance recorded" : c?.contract ? "active — milestones" : "pack · variations",
    },
    {
      key: "closure",
      label: "Closure",
      tab: "analytics",
      done: !!c?.contract?.completedAt,
      caption: c?.contract?.completedAt ? "cycle closed" : "final acceptance",
    },
  ];
  const stages: Stage[] = raw.map((s) => ({
    key: s.key,
    label: s.label,
    tab: s.tab,
    caption: s.caption,
    state: "todo" as StageState,
    ...(s.held ? { held: true } : {}),
  }));
  let currentIndex = raw.findIndex((s) => !s.done);
  if (currentIndex === -1) currentIndex = raw.length - 1;
  stages[currentIndex] = { ...stages[currentIndex], state: "current" };
  for (let i = 0; i < currentIndex; i++) stages[i] = { ...stages[i], state: "done" };
  if (raw.every((s) => s.done)) stages[stages.length - 1] = { ...stages[stages.length - 1], state: "done" };
  const doneCount = raw.filter((s) => s.done).length;
  return { stages, doneCount, currentIndex };
}

/* ── primitives ─────────────────────────────────────────────────────────────── */

function Chip({ tone, children }: { tone: "ok" | "warn" | "muted" | "brand"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-[3px] font-code text-[8px] font-bold tracking-[0.14em]",
        tone === "ok" &&
          "bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:text-emerald-300 dark:ring-emerald-400/25",
        tone === "warn" &&
          "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-600/20 dark:bg-brand-500/12 dark:text-brand-300 dark:ring-brand-400/30",
        /* Inverted in both themes. Avoid `dark:bg-white`: the global dark card
           remap would swallow it and leave dark text on a dark chip. */
        tone === "brand" && "bg-ink-950 text-white dark:bg-[#f1f2f4] dark:text-[#0b0c0f]",
        tone === "muted" &&
          "bg-ink-100/80 text-ink-600 ring-1 ring-inset ring-ink-200/60 dark:bg-white/[0.06] dark:text-ink-400 dark:ring-white/10",
      )}
    >
      {children}
    </span>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="eyebrow text-[9px]">{label}</span>
        {hint ? (
          <span className="truncate font-code text-[8.5px] tracking-[0.1em] text-ink-400">{hint}</span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

/* One field vocabulary for the whole desk. Avoid `bg-white`: the dark theme
   remaps that utility, which would flatten the recessed field into the panel.
   The inset shadow + hover border are what make a control feel physical. */
const inputCls =
  "h-10 w-full min-w-0 rounded-xl border border-ink-200/90 bg-[#fffdfb] px-3 text-[12.5px] text-ink-900 shadow-[inset_0_1px_1px_rgba(11,12,15,0.03)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-400 hover:border-ink-300 focus:border-ink-950 focus:ring-[3px] focus:ring-ink-950/[0.08] dark:border-white/[0.13] dark:bg-[#0b0d12] dark:text-ink-900 dark:placeholder:text-ink-500 dark:hover:border-white/25 dark:focus:border-white/40 dark:focus:ring-white/[0.07] dark:[color-scheme:dark]";

/* Plan-a-tender surfaces — one step taller than the shared field, because
   these are the first thing an officer fills in on a quiet morning. */
const planInput =
  "h-11 w-full min-w-0 rounded-xl border border-ink-200/90 bg-[#fffdfb] px-3 text-[13px] text-ink-900 shadow-[inset_0_1px_1px_rgba(11,12,15,0.03)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-400 hover:border-ink-300 focus:border-ink-950 focus:ring-[3px] focus:ring-ink-950/[0.08] dark:border-white/[0.13] dark:bg-[#0b0d12] dark:text-ink-900 dark:placeholder:text-ink-500 dark:hover:border-white/25 dark:focus:border-white/40 dark:focus:ring-white/[0.07] dark:[color-scheme:dark]";

function Btn({
  onClick,
  children,
  variant = "primary",
  disabled,
  className,
}: {
  onClick: () => void;
  children: ReactNode;
  variant?: "primary" | "ghost";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3.5 text-[12px] font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffdfb] active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-40 dark:focus-visible:ring-offset-[#0b0d12]",
        variant === "primary" &&
          "bg-brand-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_22px_-14px_rgba(217,38,22,0.9)] hover:bg-brand-500",
        variant === "ghost" &&
          "border border-ink-200/90 bg-[#fffdfb] text-ink-700 shadow-[0_1px_2px_rgba(11,12,15,0.03)] hover:border-ink-400 hover:text-ink-950 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-ink-300 dark:hover:border-white/25 dark:hover:bg-white/[0.07] dark:hover:text-white",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Card({
  title,
  sub,
  right,
  children,
  teaser,
  workflow = false,
  busy = false,
  actionLabel = "Open workflow",
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  teaser?: string;
  workflow?: boolean;
  busy?: boolean;
  actionLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const dialogId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
  }, [busy]);

  /* A workflow that finishes its own write closes itself — the busy flag is
     already settled by the time the write reports success. */
  const closeNow = useCallback(() => setOpen(false), []);

  /* Hand focus back to the trigger only after a dialog that had been open. */
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!workflow || !open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => dialogRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key !== "Tab") return;
      const nodes = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [workflow, open, close]);

  if (workflow) {
    return (
      <>
        <section className="panel flex min-w-0 flex-col overflow-hidden rounded-[12px]">
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-4 pt-[18px]">
            <div className="min-w-0">
              <h3 className="font-display text-[15px] font-bold tracking-[-0.015em] text-ink-950">{title}</h3>
              {sub ? <p className="mt-1.5 max-w-[52ch] font-code text-[9px] leading-[1.6] tracking-[0.12em] text-ink-500 dark:text-ink-400">{sub}</p> : null}
            </div>
            {right ? <div className="shrink-0">{right}</div> : null}
          </div>
          <div className="flex flex-1 items-end justify-between gap-4 border-t border-ink-100/80 px-5 py-4 dark:border-white/[0.055]">
            <p className="max-w-[46ch] text-[11.5px] leading-relaxed text-ink-500 dark:text-ink-400">
              {teaser ?? "Open the guided workflow to review details and complete this action."}
            </p>
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setOpen(true)}
              disabled={busy}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-ink-950 px-3.5 text-[11px] font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-ink-950 dark:hover:bg-brand-400"
            >
              {actionLabel}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </section>
        {typeof document !== "undefined"
          ? createPortal(
              <AnimatePresence>
                {open ? (
                  <motion.div
                    key={`cycle-workflow-${dialogId}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-[90] grid place-items-center bg-night/70 p-3 backdrop-blur-sm sm:p-5"
                    onMouseDown={(event) => {
                      if (event.target === event.currentTarget) close();
                    }}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={`cycle-workflow-${dialogId}`}
                  >
                    <motion.div
                      ref={dialogRef}
                      tabIndex={-1}
                      initial={{ opacity: 0, y: 18, scale: 0.985 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 12, scale: 0.99 }}
                      transition={{ duration: 0.28, ease: EASE }}
                      className="panel panel-lift flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-[12px] outline-none"
                    >
                      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-ink-100 px-5 py-4 dark:border-white/[0.06] sm:px-7 sm:py-5">
                        <div className="min-w-0">
                          <p className="font-code text-[8.5px] font-bold tracking-[0.2em] text-brand-700 dark:text-brand-300">TENDER CYCLE · GUIDED WORKFLOW</p>
                          <h3 id={`cycle-workflow-${dialogId}`} className="mt-1 font-display text-[20px] font-black tracking-[-0.02em] text-ink-950 dark:text-white sm:text-[22px]">{title}</h3>
                          {sub ? <p className="mt-1.5 max-w-[65ch] text-[11.5px] leading-relaxed text-ink-500 dark:text-ink-400">{sub}</p> : null}
                        </div>
                        <button
                          type="button"
                          onClick={close}
                          disabled={busy}
                          aria-label={`Close ${title} workflow`}
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/[0.06] dark:hover:text-white"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </header>
                      <div
                        data-cycle-workflow-body
                        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-7 sm:py-5"
                      >
                        {typeof children === "function" ? children(closeNow) : children}
                      </div>
                    </motion.div>
                  </motion.div>
                ) : null}
              </AnimatePresence>,
              document.body,
            )
          : null}
      </>
    );
  }

  return (
    <section className="panel flex min-w-0 flex-col overflow-hidden rounded-[12px]">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-4 pt-[18px]">
        <div className="min-w-0">
          <h3 className="font-display text-[15px] font-bold tracking-[-0.015em] text-ink-950">{title}</h3>
          {sub ? (
            <p className="mt-1.5 max-w-[52ch] font-code text-[9px] leading-[1.6] tracking-[0.12em] text-ink-500 dark:text-ink-400">
              {sub}
            </p>
          ) : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      <div className="flex-1 border-t border-ink-100/80 px-5 pb-5 pt-4 dark:border-white/[0.055]">
        {typeof children === "function" ? null : children}
      </div>
    </section>
  );
}

/** Close on outside click — shared by the picker and the link menu. */
function useOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [ref, onOutside, active]);
}

/* ── CycleRail — the live stage tracker ─────────────────────────────────────── */

function StageLegend() {
  const items = [
    { label: "Complete", dot: "bg-emerald-500" },
    { label: "Current", dot: "bg-brand-500" },
    { label: "At a gate", dot: "bg-brand-500/25 ring-2 ring-inset ring-brand-500/70" },
    { label: "Upcoming", dot: "bg-ink-200 dark:bg-white/20" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 font-code text-[7.5px] font-bold tracking-[0.16em] text-ink-400">
          <span className={cn("h-1.5 w-1.5 rounded-full", i.dot)} aria-hidden="true" />
          {i.label.toUpperCase()}
        </span>
      ))}
    </div>
  );
}

function CycleRail({ cycle }: { cycle: CycleDto | null }) {
  const { stages, doneCount, currentIndex } = useMemo(() => deriveStages(cycle), [cycle]);
  const pct = Math.round((doneCount / stages.length) * 100);
  const current = stages[currentIndex];

  return (
    <div className="px-5 pb-4 pt-4" role="navigation" aria-label="Cycle stages">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 eyebrow">
          <span className="text-ink-400 dark:text-ink-500">Cycle</span>
          {cycle ? (
            <>
              <span className="text-ink-800 dark:text-ink-700">
                Stage {String(currentIndex + 1).padStart(2, "0")} / {String(stages.length).padStart(2, "0")}
              </span>
              <span className="h-1 w-1 rounded-full bg-brand-500" aria-hidden="true" />
              <span className="text-brand-600 dark:text-brand-400">{current.label}</span>
            </>
          ) : (
            <span>Solicitation → closure</span>
          )}
        </p>
        <div className="flex items-center gap-2.5" aria-live="polite">
          <span className="h-[3px] w-16 overflow-hidden rounded-full bg-ink-100 dark:bg-white/10" aria-hidden="true">
            <motion.span
              className="block h-full rounded-full bg-brand-500"
              initial={false}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.6, ease: EASE }}
            />
          </span>
          {/* The measure the officer actually asks: how many of the seven are
              behind the desk — spelled out, never a bare percentage. */}
          <span className="tabular font-code text-[8.5px] font-bold tracking-[0.14em] text-ink-500">
            {doneCount} OF {stages.length} STAGES COMPLETE
            <span className="mx-1.5 text-ink-300 dark:text-ink-600">·</span>
            {pct}%
          </span>
        </div>
      </div>

      <div className="-mx-1 mt-3.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ol className="grid min-w-[660px] grid-cols-7 gap-1.5 sm:gap-2">
        {stages.map((s, i) => {
          /* With no cycle record there is no current stage — the rail stays
             neutral rather than claiming a stage the desk has not reached. */
          const done = cycle ? s.state === "done" : false;
          const isCurrent = cycle ? s.state === "current" : false;
          const atGate = cycle ? isCurrent && !!s.held : false;
          return (
            <li key={s.key} className="min-w-0">
              <button
                type="button"
                onClick={() => document.getElementById(`cycle-tab-${s.tab}`)?.click()}
                aria-current={isCurrent ? "step" : undefined}
                aria-label={`${s.label} — ${done ? "complete" : atGate ? "waiting at a human gate" : isCurrent ? "current stage" : "upcoming"}. Open the ${s.tab} tab.`}
                title={`${s.label} — ${s.caption ?? ""} (opens the ${s.tab} tab)`}
                className="group block w-full min-w-0 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-4 focus-visible:ring-offset-[#fffdfb] dark:focus-visible:ring-offset-[#111318]"
              >
                {/* The meter: one segment per stage, so progress is read at a glance. */}
                <span
                  className={cn(
                    "relative block h-[3px] w-full overflow-hidden rounded-full transition-colors",
                    done && "bg-emerald-500/85",
                    isCurrent && !atGate && "bg-brand-500/20",
                    atGate && "bg-brand-500/20",
                    !done && !isCurrent && "bg-ink-100 group-hover:bg-ink-200 dark:bg-white/[0.09] dark:group-hover:bg-white/[0.16]",
                  )}
                  aria-hidden="true"
                >
                  {isCurrent ? (
                    <motion.span
                      className={cn(
                        "absolute inset-y-0 left-0 rounded-full bg-brand-500",
                        atGate ? "animate-pulse shadow-[0_0_12px_rgba(232,56,42,0.75)]" : "shadow-[0_0_12px_rgba(232,56,42,0.55)]",
                      )}
                      initial={false}
                      animate={{ width: "100%" }}
                      transition={{ duration: 0.6, ease: EASE }}
                    />
                  ) : null}
                </span>
                <span className="mt-2 flex min-w-0 items-center gap-1.5">
                  <span
                    className={cn(
                      "grid h-[17px] w-[17px] shrink-0 place-items-center rounded-full border font-code text-[7.5px] font-black tabular transition-colors",
                      done && "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/35 dark:text-emerald-300",
                      isCurrent && !atGate && "animate-gate-breathe border-brand-600 bg-brand-600 text-white",
                      /* Held at a gate: the gavel belongs to a human — the
                         ring says so without claiming completion. */
                      atGate && "border-brand-600/70 bg-brand-500/[0.12] text-brand-700 ring-2 ring-brand-500/25 dark:border-brand-400/70 dark:text-brand-300",
                      !done && !isCurrent && "border-ink-200 text-ink-400 group-hover:border-ink-300 group-hover:text-ink-600 dark:border-white/[0.12] dark:text-ink-500 dark:group-hover:border-white/25",
                    )}
                    aria-hidden="true"
                  >
                    {done ? <Check className="h-2.5 w-2.5" /> : String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={cn(
                      "truncate font-code text-[7.5px] font-bold tracking-[0.1em] transition-colors",
                      isCurrent && "text-brand-700 dark:text-brand-300",
                      !isCurrent && "text-ink-500 group-hover:text-ink-900 dark:text-ink-400 dark:group-hover:text-ink-200",
                    )}
                  >
                    {s.label.toUpperCase()}
                  </span>
                </span>
                <span
                  className={cn(
                    "mt-1 block truncate text-[9.5px] leading-tight transition-colors",
                    atGate && "font-semibold text-brand-700 dark:text-brand-300",
                    !atGate && (isCurrent ? "text-ink-600 dark:text-ink-500" : "text-ink-400 dark:text-ink-400"),
                  )}
                  title={s.caption}
                >
                  {s.caption}
                </span>
                {/* A stage parked at a human gate is the one state an officer
                    scans for — name it, don't make them read the caption. */}
                {atGate ? (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-brand-500/[0.09] px-1.5 py-[2px] font-code text-[7px] font-black tracking-[0.12em] text-brand-700 dark:bg-brand-500/[0.14] dark:text-brand-300">
                    <span className="h-1 w-1 animate-pulse rounded-full bg-brand-500" aria-hidden="true" />
                    AT GATE
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
        </ol>
      </div>
    </div>
  );
}

/* ── TenderPicker — the tender selector as a first-class control ────────────── */

function ProgressRing({ pct, size = 42 }: { pct: number; size?: number }) {
  const stroke = 2.5;
  const r = (size - stroke * 2) / 2;
  const c = 2 * Math.PI * r;
  const value = Math.max(0, Math.min(100, pct));
  return (
    <span
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-ink-200/80 dark:stroke-white/[0.12]"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * value) / 100}
          className={cn(
            "transition-[stroke-dashoffset] duration-700 ease-out",
            value === 100 ? "stroke-emerald-500" : "stroke-brand-500",
          )}
        />
      </svg>
      <span className="relative flex items-baseline gap-px font-code text-[10px] font-bold tabular leading-none text-ink-800 dark:text-ink-200">
        {value}
        <span className="text-[6.5px] font-semibold text-ink-400">%</span>
      </span>
    </span>
  );
}

function TenderPicker({
  tenders,
  value: currentRef,
  cycles,
  onSelect,
  onToast,
}: {
  tenders: { ref: string; title: string }[];
  value: string;
  cycles: CycleDto[];
  onSelect: (ref: string) => void;
  onToast: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState(false);
  /* Carousel direction — last travel of the deck, so the slide animation
     always agrees with the control that caused it. */
  const [dir, setDir] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragX = useRef<number | null>(null);
  const swiped = useRef(false);
  useOutside(boxRef, () => setOpen(false), open);

  const count = tenders.length;
  const many = count > 1;
  const at = Math.max(0, tenders.findIndex((t) => t.ref === currentRef));

  /* The deck wraps: an officer flipping right from the last dossier lands
     back on the first — the desk is a ring, not a dead end. */
  const step = (delta: number) => {
    if (!many) return;
    const next = (at + delta + count) % count;
    setDir(delta);
    onSelect(tenders[next].ref);
  };
  const goTo = (i: number) => {
    if (!many || i === at || !tenders[i]) return;
    setDir(i > at ? 1 : -1);
    onSelect(tenders[i].ref);
  };

  const current = tenders.find((t) => t.ref === currentRef);
  const currentCycle = cycles.find((x) => x.tenderId === currentRef) ?? null;
  const progressOf = (r: string) => {
    const c = cycles.find((x) => x.tenderId === r);
    if (!c) return { pct: 0, stage: "Not started" };
    const { doneCount, currentIndex, stages } = deriveStages(c);
    return { pct: Math.round((doneCount / 7) * 100), stage: stages[currentIndex]?.label ?? "Not started" };
  };
  const query = q.trim().toLowerCase();
  const filtered = query
    ? tenders.filter((t) => `${t.ref} ${t.title}`.toLowerCase().includes(query))
    : tenders;

  const pick = (r: string) => {
    onSelect(r);
    setOpen(false);
    setQ("");
  };

  /* Opening the panel is a state transition, not an effect: reset the query and
     park the cursor on the current tender as part of the click itself. */
  const toggle = () => {
    if (!open) {
      setQ("");
      setActive(Math.max(0, tenders.findIndex((t) => t.ref === currentRef)));
    }
    setOpen(!open);
  };

  const handleToggleClick = () => {
    /* A horizontal swipe ends with a synthesized click — swallow that one
       so flipping the deck never also opens the dropdown. */
    if (swiped.current) {
      swiped.current = false;
      return;
    }
    toggle();
  };

  const p = progressOf(currentRef);

  /* The dossier's own status line — spoken from the record, never invented:
     closed cycles say so; open ones name the stage the desk is standing at. */
  const cycleClosed = !!currentCycle?.contract?.completedAt;
  const dossierStatus = !currentCycle
    ? { label: "NOT STARTED", tone: "muted" as const }
    : cycleClosed
      ? { label: "CYCLE CLOSED", tone: "ok" as const }
      : { label: `STAGE ${String(deriveStages(currentCycle).currentIndex + 1).padStart(2, "0")} · ${p.stage.toUpperCase()}`, tone: "brand" as const };

  const copyRef = async () => {
    if (!currentRef) return;
    try {
      await navigator.clipboard.writeText(currentRef);
      setCopied(true);
      onToast(`REFERENCE ${currentRef} COPIED`);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Clipboard permission denied — the reference is selectable text anyway. */
      onToast("COPY BLOCKED BY THE BROWSER — SELECT THE REFERENCE MANUALLY");
    }
  };

  return (
    <div
      ref={boxRef}
      role="group"
      aria-roledescription="carousel"
      aria-label="Working dossiers on the desk"
      className="relative w-full"
      onKeyDown={(e) => {
        /* The deck answers ← → when the dropdown is closed; when it is open
           those keys belong to the caret in the search field. */
        if (!open && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          e.preventDefault();
          step(e.key === "ArrowRight" ? 1 : -1);
          return;
        }
        if (!open) return;
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive((a) => Math.min(a + 1, filtered.length - 1));
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((a) => Math.max(a - 1, 0));
        }
        if (e.key === "Enter") {
          e.preventDefault();
          pick(filtered[active]?.ref ?? currentRef);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setOpen(false);
        }
      }}
    >
      {/* The dossier surface: two controls, one visual instrument. The
          picker button owns the reading; the copy button stands beside it,
          never inside it — a button inside a button is a lie to the DOM. */}
      <div
        className={cn(
          "panel-inset group flex w-full flex-wrap items-center gap-x-2.5 gap-y-2.5 rounded-[10px] px-3 py-3 transition-[border-color,background-color] duration-200 sm:flex-nowrap sm:gap-3.5 sm:px-3.5",
          "hover:border-ink-300 dark:hover:border-white/20",
          "focus-within:border-ink-950 focus-within:ring-4 focus-within:ring-ink-950/[0.06] dark:focus-within:border-white/40 dark:focus-within:ring-white/[0.05]",
          open && "border-ink-950 ring-4 ring-ink-950/[0.06] dark:border-white/40 dark:ring-white/[0.05]",
        )}
        onPointerDown={(e) => {
          swiped.current = false;
          dragX.current = e.clientX;
        }}
        onPointerUp={(e) => {
          const startX = dragX.current;
          dragX.current = null;
          if (startX === null || open) return;
          const dx = e.clientX - startX;
          if (Math.abs(dx) >= 44) {
            swiped.current = true;
            step(dx < 0 ? 1 : -1);
          }
        }}
        onPointerCancel={() => {
          dragX.current = null;
        }}
        style={{ touchAction: "pan-y" }}
      >
        <button
          type="button"
          onClick={handleToggleClick}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Tender: ${current ? `${current.ref} — ${current.title}` : "select a tender"}. Open the dossier picker.`}
          className="min-w-0 w-full rounded-[8px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 sm:w-auto sm:flex-1"
        >
          {/* One dossier = one slide. The key is the tender reference, so
              flipping the deck slides the card in the direction travelled. */}
          <motion.span
            key={currentRef || "empty"}
            initial={{ opacity: 0, x: dir * 14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="flex min-w-0 items-center gap-3.5"
          >
            <ProgressRing pct={p.pct} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 eyebrow text-[8px] tracking-[0.24em]">
                <span className="text-ink-400 dark:text-ink-500">Working dossier</span>
                <Chip tone={dossierStatus.tone}>{dossierStatus.label}</Chip>
              </span>
              <span className="mt-1.5 flex min-w-0 items-baseline gap-2.5">
                <span className="shrink-0 font-code text-[12.5px] font-bold tracking-[0.08em] text-ink-950 dark:text-white">
                  {current ? current.ref : "—"}
                </span>
                <span className="truncate text-[12px] leading-tight text-ink-500">
                  {current?.title ?? "No tender staged on the desk yet"}
                </span>
              </span>
              {/* One honest meta line, only from the record: the closing date
                  when the cycle has one. Without a record the right-hand count
                  already says what the desk holds — say it once, not twice. */}
              {currentCycle?.closingDate ? (
                <span className="mt-1 flex min-w-0 items-center gap-x-2.5 gap-y-0.5 flex-wrap font-code text-[7.5px] font-bold tracking-[0.14em] text-ink-400">
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock className="h-2.5 w-2.5" aria-hidden="true" />
                    CLOSES {fmtDate(currentCycle.closingDate).toUpperCase()} · {relDays(currentCycle.closingDate).toUpperCase()}
                  </span>
                </span>
              ) : null}
            </span>
          </motion.span>
        </button>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {current ? (
            <button
              type="button"
              onClick={() => void copyRef()}
              aria-label={`Copy tender reference ${current.ref}`}
              title={`Copy ${current.ref}`}
              className="focus-brand grid h-7 w-7 place-items-center rounded-lg border border-ink-200/70 text-ink-400 transition-colors hover:border-ink-400 hover:text-ink-900 dark:border-white/10 dark:text-ink-500 dark:hover:border-white/25 dark:hover:text-white"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
          ) : null}
          {many ? (
            <span className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label={`Previous dossier (${tenders[(at - 1 + count) % count]?.ref ?? ""})`}
                title="Previous tender"
                className="focus-brand grid h-7 w-7 place-items-center rounded-lg border border-ink-200/70 text-ink-500 transition-colors hover:border-ink-400 hover:bg-ink-950/[0.03] hover:text-ink-900 active:scale-95 dark:border-white/10 dark:text-ink-400 dark:hover:border-white/25 dark:hover:bg-white/[0.05] dark:hover:text-white"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <span className="w-[46px] text-center font-code text-[9px] font-bold tabular tracking-[0.06em] text-ink-500 dark:text-ink-400">
                {String(at + 1).padStart(2, "0")}/{String(count).padStart(2, "0")}
              </span>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label={`Next dossier (${tenders[(at + 1) % count]?.ref ?? ""})`}
                title="Next tender"
                className="focus-brand grid h-7 w-7 place-items-center rounded-lg border border-ink-200/70 text-ink-500 transition-colors hover:border-ink-400 hover:bg-ink-950/[0.03] hover:text-ink-900 active:scale-95 dark:border-white/10 dark:text-ink-400 dark:hover:border-white/25 dark:hover:bg-white/[0.05] dark:hover:text-white"
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </span>
          ) : null}
          <span className="hidden font-code text-[8px] font-bold tracking-[0.16em] text-ink-400 lg:block">
            {tenders.length} ON DESK
          </span>
          <button
            type="button"
            onClick={toggle}
            aria-hidden="true"
            tabIndex={-1}
            className="hidden h-7 w-7 place-items-center rounded-lg border border-ink-200/70 text-ink-500 transition-colors group-hover:border-ink-300 group-hover:text-ink-900 sm:grid dark:border-white/10 dark:group-hover:border-white/25 dark:group-hover:text-white"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", open && "rotate-180")} aria-hidden="true" />
          </button>
        </span>
      </div>

      {/* Position dots — a direct jump for every dossier on the desk. Kept
          to twelve; past that the stepper and the searchable picker are the
          honest instruments. */}
      {many && count <= 12 ? (
        <div className="mt-2 hidden items-center justify-center gap-1.5 sm:flex">
          {tenders.map((t, i) => (
            <button
              key={t.ref}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Dossier ${i + 1} of ${count}: ${t.ref}`}
              aria-current={i === at ? "true" : undefined}
              title={`${t.ref} — ${t.title}`}
              className={cn(
                "focus-brand h-1.5 rounded-full transition-all duration-200",
                i === at
                  ? "w-4 bg-brand-500 dark:bg-brand-400"
                  : "w-1.5 bg-ink-200 hover:bg-ink-300 dark:bg-white/[0.14] dark:hover:bg-white/[0.28]",
              )}
            />
          ))}
        </div>
      ) : null}

      {/* The one announcement a screen reader needs: which dossier the desk
          is showing now. The visual slide animation is silent by design. */}
      <span className="sr-only" aria-live="polite">
        {count
          ? `Dossier ${at + 1} of ${count}: ${current ? `${current.ref} — ${current.title}` : "none selected"}`
          : "No tenders on the desk"}
      </span>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.985 }}
            transition={{ duration: 0.18, ease: EASE }}
            className="panel panel-lift absolute left-0 right-0 z-40 mt-2 overflow-hidden rounded-[10px]"
          >
            <div className="flex items-center justify-between gap-3 border-b border-ink-100/80 px-4 py-2.5 dark:border-white/[0.06]">
              <p className="eyebrow text-[8px]">Tenders on the desk</p>
              <span className="font-code text-[8px] font-bold tabular tracking-[0.12em] text-ink-400">
                {filtered.length} / {tenders.length}
              </span>
            </div>
            <div className="p-2.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" aria-hidden="true" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setActive(0);
                  }}
                  placeholder="Find by reference or title…"
                  aria-label="Find a tender"
                  className="h-9 w-full rounded-lg border border-ink-200/80 bg-transparent pl-9 pr-3 text-[12px] text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-400 dark:border-white/10 dark:text-ink-900 dark:focus:border-white/30"
                />
              </div>
            </div>
            <ul role="listbox" aria-label="Tenders" className="max-h-[320px] overflow-y-auto px-1.5 pb-2">
              {filtered.map((t, i) => {
                const row = progressOf(t.ref);
                const selected = t.ref === currentRef;
                return (
                  <li key={t.ref}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(t.ref)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors",
                        i === active && "bg-ink-950/[0.045] dark:bg-white/[0.055]",
                        selected && "bg-brand-50/70 dark:bg-brand-500/[0.08]",
                      )}
                    >
                      <span className="flex shrink-0 items-end gap-[2px]" aria-hidden="true">
                        {Array.from({ length: 7 }).map((_, n) => (
                          <span
                            key={n}
                            className={cn(
                              "w-[3px] rounded-full transition-colors",
                              n < Math.round((row.pct / 100) * 7)
                                ? row.pct === 100
                                  ? "bg-emerald-500"
                                  : "bg-brand-500"
                                : "bg-ink-200 dark:bg-white/[0.12]",
                              n === Math.round((row.pct / 100) * 7) - 1 ? "h-3.5" : "h-2",
                            )}
                          />
                        ))}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-code text-[10.5px] font-bold tracking-[0.06em] text-ink-900">
                          {t.ref}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-ink-500">{t.title}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5">
                        <span className={cn("tabular font-code text-[9px] font-bold", row.pct === 100 ? "text-emerald-600 dark:text-emerald-400" : "text-ink-600")}>
                          {row.pct}%
                        </span>
                        <span className="max-w-[92px] truncate font-code text-[7.5px] tracking-[0.1em] text-ink-400">
                          {row.stage}
                        </span>
                      </span>
                      {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden="true" /> : null}
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 ? (
                <li className="px-3 py-8 text-center">
                  <p className="text-[12px] text-ink-500">
                    {tenders.length === 0 ? "No tenders staged yet." : "No tender matches that search."}
                  </p>
                  {tenders.length === 0 ? (
                    <p className="mt-1 font-code text-[8px] tracking-[0.14em] text-ink-400">
                      START IN THE PIPELINE BELOW
                    </p>
                  ) : null}
                </li>
              ) : null}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ── VitalStrip — the tender's numbers at a glance ──────────────────────────── */

function Vital({
  label,
  value,
  meta,
  accent,
}: {
  label: string;
  value: ReactNode;
  meta: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0 px-5 py-3.5">
      <p className="eyebrow whitespace-nowrap text-[8px] tracking-[0.2em]">{label}</p>
      <p
        className={cn(
          "mt-2 truncate font-display text-[17px] font-bold leading-none tracking-[-0.02em] tabular",
          accent ? "text-brand-600 dark:text-brand-400" : "text-ink-950",
        )}
      >
        {value}
      </p>
      <p className="mt-1.5 truncate font-code text-[8px] tracking-[0.12em] text-ink-400">{meta}</p>
    </div>
  );
}

/**
 * The vitals strip is always present — a blank band is worse than an honest
 * em-dash. Each cell states a number the officer would otherwise have to
 * hunt for, and the line under it says what the number means.
 */
function VitalStrip({ cycle }: { cycle: CycleDto | null }) {
  /* Before the first record exists, five cells of em-dashes would read as a
     broken instrument. One quiet sentence says the same thing honestly. */
  if (!cycle) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-ink-100/80 px-5 py-3.5 dark:border-white/[0.055]">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-dashed border-ink-300 text-ink-400 dark:border-white/20 dark:text-ink-500">
          <Workflow className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <p className="text-[12px] leading-relaxed text-ink-500">
          <span className="font-semibold text-ink-800">No cycle record yet.</span> Stage this tender below —
          opening, evaluation, award and contract each keep their own file from the first entry.
        </p>
        <span className="ml-auto hidden font-code text-[8px] font-bold tracking-[0.16em] text-ink-400 sm:block">
          7 STAGES · ONE CONTINUOUS FILE
        </span>
      </div>
    );
  }

  const bids = cycle?.opening?.rows ?? [];
  const late = bids.filter((b) => b.late).length;
  const scored = cycle?.matrix?.bids ?? [];
  const responsive = scored.filter((b) => b.responsiveness === "RESPONSIVE").length;
  const leading = scored.reduce<number | null>(
    (best, b) => (b.total !== undefined && (best === null || b.total > best) ? b.total : best),
    null,
  );

  const standstillActive = cycle?.standstill?.status === "ACTIVE";
  const contract = cycle?.contract;

  const cells: { label: string; value: ReactNode; meta: ReactNode; accent?: boolean }[] = [
    {
      label: "Closing",
      value: cycle?.closingDate ? fmtDate(cycle.closingDate) : "—",
      meta: cycle?.closingDate ? relDays(cycle.closingDate).toUpperCase() : "NOT YET ON RECORD",
    },
    {
      label: "Bids opened",
      value: bids.length ? bids.length : "—",
      meta: bids.length ? (late ? `${late} LATE · REJECTED UNOPENED` : "ALL ADMITTED") : "AWAITING THE OPENING",
      accent: late > 0,
    },
    {
      label: "Responsive",
      value: scored.length ? `${responsive}/${scored.length}` : "—",
      meta: leading !== null ? `LEADING TOTAL ${leading}` : "NO MATRIX CERTIFIED",
    },
    {
      label: "Standstill",
      value: cycle?.standstill ? (standstillActive ? "Active" : "Lifted") : "—",
      meta: cycle?.standstill ? `ENDS ${fmtDate(cycle.standstill.endsAt).toUpperCase()} · ${cycle.standstill.days} WD` : "NOT REACHED",
      accent: standstillActive,
    },
    {
      label: "Contract",
      value: contract ? `${contract.currency ?? ""} ${fmtMoney(contract.value)}`.trim() : "—",
      meta: contract ? (contract.completedAt ? "ACCEPTED · CYCLE CLOSED" : "ACTIVE · MILESTONES OPEN") : "NOT YET AWARDED",
    },
  ];

  return (
    <div
      className="grid grid-cols-2 gap-px border-t border-ink-100/80 bg-ink-100/70 sm:grid-cols-3 lg:grid-cols-5 dark:border-white/[0.055] dark:bg-white/[0.07]"
      aria-label="Tender vitals"
    >
      {cells.map((c) => (
        <div
          key={c.label}
          className="min-w-0 bg-[#fffefa] last:col-span-2 sm:last:col-span-2 lg:last:col-span-1 dark:bg-[#12141a] lg:bg-transparent dark:lg:bg-transparent"
        >
          <Vital label={c.label} value={c.value} meta={c.meta} accent={c.accent} />
        </div>
      ))}
    </div>
  );
}

/* ── tender comparison ─────────────────────────────────────────────────────── */

interface CompareRow {
  ref: string;
  title: string;
  closing?: string;
  stageLabel: string;
  stageCaption: string;
  pct: number;
  bids: number;
  portalBids: number;
  value?: number;
  currency?: string;
  valueKind: "contract" | "estimate" | null;
  complaints: number;
  alb: number;
}

/* One comparison row, read from the tender's own cycle record — every figure
   is stored, none inferred. Missing data renders as a dash, never as zero. */
function compareRowOf(
  ref: string,
  title: string,
  cycles: CycleDto[],
  pipeline: PipelineDto[],
  applications: PortalAppRow[],
): CompareRow {
  const cycle = cycles.find((c) => c.tenderId === ref) ?? null;
  const { stages, doneCount, currentIndex } = deriveStages(cycle);
  const stage = stages[currentIndex];
  const plan = pipeline.find((p) => p.linkedTenderId === ref || p.ref === ref);
  const contractValue = cycle?.contract?.value;
  return {
    ref,
    title,
    ...(cycle?.closingDate ? { closing: cycle.closingDate } : {}),
    stageLabel: stage?.label ?? "Not started",
    stageCaption: stage?.caption ?? "No record yet",
    pct: Math.round((doneCount / stages.length) * 100),
    bids: cycle?.opening?.rows.length ?? cycle?.matrix?.bids.length ?? 0,
    portalBids: applications.filter((a) => a.tenderId === ref).length,
    ...(contractValue !== undefined
      ? { value: contractValue, currency: cycle?.contract?.currency, valueKind: "contract" as const }
      : plan?.budgetEstimate !== undefined
        ? { value: plan.budgetEstimate, currency: plan.currency, valueKind: "estimate" as const }
        : { valueKind: null }),
    complaints: cycle?.complaints.filter((c) => c.status === "OPEN").length ?? 0,
    alb: cycle?.alb.length ?? 0,
  };
}

function TenderCompare({
  tenders,
  cycles,
  pipeline,
  applications,
  current,
  onSelect,
}: {
  tenders: { ref: string; title: string }[];
  cycles: CycleDto[];
  pipeline: PipelineDto[];
  applications: PortalAppRow[];
  current: string;
  onSelect: (ref: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const dialogId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const prior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prior;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const start = () => {
    const others = tenders.filter((t) => t.ref !== current).map((t) => t.ref);
    setPicked([current, ...others].filter(Boolean).slice(0, 3));
    setOpen(true);
  };

  const toggle = (r: string) =>
    setPicked((list) =>
      list.includes(r) ? list.filter((x) => x !== r) : list.length >= 4 ? list : [...list, r],
    );

  const rows = picked
    .map((r) => {
      const t = tenders.find((x) => x.ref === r);
      return t ? compareRowOf(t.ref, t.title, cycles, pipeline, applications) : null;
    })
    .filter((r): r is CompareRow => r !== null);

  /* The earliest closing among the picked tenders — the fact a comparison is
     usually opened for. */
  let earliest: string | undefined;
  for (const r of rows) {
    if (!r.closing) continue;
    if (!earliest || new Date(r.closing).getTime() < new Date(earliest).getTime()) earliest = r.closing;
  }

  const facts: { label: string; value: (r: CompareRow) => ReactNode }[] = [
    {
      label: "Closes",
      value: (r) => (
        <>
          <p className="text-[11.5px] font-semibold text-ink-800 dark:text-ink-100">{fmtDate(r.closing)}</p>
          <p
            className={cn(
              "mt-0.5 font-code text-[7.5px] font-bold tracking-[0.14em]",
              r.closing && (daysUntil(r.closing) ?? 0) < 0 ? "text-brand-700 dark:text-brand-300" : "text-ink-400",
            )}
          >
            {r.closing ? relDays(r.closing).toUpperCase() : "NO DATE ON RECORD"}
          </p>
        </>
      ),
    },
    {
      label: "Stage",
      value: (r) => (
        <>
          <p className="text-[11.5px] font-semibold text-ink-800 dark:text-ink-100">{r.stageLabel}</p>
          <span className="mt-1.5 block h-[2px] w-full overflow-hidden rounded-full bg-ink-100 dark:bg-white/[0.08]">
            <span className="block h-full rounded-full bg-brand-500" style={{ width: `${r.pct}%` }} />
          </span>
          <p className="mt-1 font-code text-[7px] tracking-[0.12em] text-ink-400">
            {r.pct}% COMPLETE · {r.stageCaption.toUpperCase()}
          </p>
        </>
      ),
    },
    {
      label: "Bids read",
      value: (r) => (
        <>
          <p className="font-display text-[20px] font-bold leading-none text-ink-950 tabular dark:text-white">{r.bids}</p>
          <p className="mt-1 font-code text-[7px] tracking-[0.12em] text-ink-400">
            {r.bids === 1 ? "BID ON THE REGISTER" : "BIDS ON THE REGISTER"}
          </p>
        </>
      ),
    },
    {
      label: "Portal bids",
      value: (r) => (
        <>
          <p className="font-display text-[20px] font-bold leading-none text-ink-950 tabular dark:text-white">{r.portalBids}</p>
          <p className="mt-1 font-code text-[7px] tracking-[0.12em] text-ink-400">RECEIVED FROM SUPPLIERS</p>
        </>
      ),
    },
    {
      label: "Value",
      value: (r) =>
        r.value !== undefined ? (
          <>
            <p className="font-code text-[11px] font-bold tracking-[0.04em] text-ink-900 tabular dark:text-ink-100">
              {r.currency ? `${r.currency} ` : ""}
              {fmtMoney(r.value)}
            </p>
            <p className="mt-1 font-code text-[7px] tracking-[0.12em] text-ink-400">
              {r.valueKind === "contract" ? "CONTRACT ON RECORD" : "BUDGET ESTIMATE"}
            </p>
          </>
        ) : (
          <p className="text-[11.5px] text-ink-400">—</p>
        ),
    },
    {
      label: "Risk flags",
      value: (r) => (
        <>
          <p className="text-[11.5px] font-semibold text-ink-800 dark:text-ink-100">
            {r.complaints} {r.complaints === 1 ? "open complaint" : "open complaints"}
          </p>
          <p className="mt-0.5 font-code text-[7.5px] tracking-[0.12em] text-ink-400">
            {r.alb} ALB {r.alb === 1 ? "DOSSIER" : "DOSSIERS"}
          </p>
        </>
      ),
    },
  ];

  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={tenders.length < 2}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${dialogId}-dialog`}
        title={tenders.length < 2 ? "Stage at least two tenders to compare them" : "Compare the tenders on the desk"}
        className="focus-brand inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[10px] border border-ink-200/80 bg-[#fffdfb] px-4 font-code text-[8.5px] font-bold tracking-[0.16em] text-ink-800 shadow-[0_1px_2px_rgba(11,12,15,0.04)] transition-colors hover:border-brand-400 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-ink-200 dark:hover:border-brand-500/50 dark:hover:text-brand-300 sm:h-auto sm:self-stretch"
      >
        <Scale className="h-3.5 w-3.5" aria-hidden="true" />
        COMPARE
        <span className="rounded-full bg-ink-950 px-1.5 py-0.5 text-[7px] font-bold tracking-[0.1em] text-white dark:bg-white dark:text-ink-950">
          {tenders.length}
        </span>
      </button>

      {typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <motion.div
                  key={`compare-${dialogId}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="fixed inset-0 z-[90] grid place-items-center bg-night/70 p-3 backdrop-blur-sm sm:p-5"
                  onMouseDown={(event) => {
                    if (event.target === event.currentTarget) setOpen(false);
                  }}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby={`${dialogId}-title`}
                >
                  <motion.div
                    initial={{ opacity: 0, y: 18, scale: 0.985 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 12, scale: 0.99 }}
                    transition={{ duration: 0.28, ease: EASE }}
                    className="panel panel-lift flex max-h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-[12px]"
                  >
                    <header className="flex shrink-0 items-start justify-between gap-4 border-b border-ink-100 px-5 py-4 dark:border-white/[0.06] sm:px-7 sm:py-5">
                      <div className="min-w-0">
                        <p className="font-code text-[8.5px] font-bold tracking-[0.2em] text-brand-700 dark:text-brand-300">
                          TENDER CYCLE · COMPARISON
                        </p>
                        <h3
                          id={`${dialogId}-title`}
                          className="mt-1 font-display text-[20px] font-black tracking-[-0.02em] text-ink-950 dark:text-white sm:text-[22px]"
                        >
                          Compare bidding tenders
                        </h3>
                        <p className="mt-1.5 max-w-[70ch] text-[11.5px] leading-relaxed text-ink-500 dark:text-ink-400">
                          Closing, stage, bids and value side by side — read live from each tender&apos;s own cycle record. Pick up to four.
                        </p>
                      </div>
                      <button
                        ref={closeRef}
                        type="button"
                        onClick={() => setOpen(false)}
                        aria-label="Close tender comparison"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900 dark:hover:bg-white/[0.06] dark:hover:text-white"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </header>

                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                      {/* The desk's whole register, one tap each — the selection
                          IS the comparison. */}
                      <div className="border-b border-ink-100/80 px-5 py-3 dark:border-white/[0.06] sm:px-7">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {tenders.map((t) => {
                            const on = picked.includes(t.ref);
                            const full = !on && picked.length >= 4;
                            return (
                              <button
                                key={t.ref}
                                type="button"
                                onClick={() => toggle(t.ref)}
                                aria-pressed={on}
                                disabled={full}
                                title={t.title}
                                className={cn(
                                  "focus-brand inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-code text-[8px] font-bold tracking-[0.1em] transition-colors",
                                  on
                                    ? "border-ink-950 bg-ink-950 text-white dark:border-white dark:bg-white dark:text-ink-950"
                                    : "border-ink-200 bg-white text-ink-500 hover:border-ink-400 hover:text-ink-900 dark:border-white/[0.12] dark:bg-white/[0.03] dark:text-ink-400 dark:hover:border-white/30 dark:hover:text-white",
                                  full && "cursor-not-allowed opacity-35",
                                )}
                              >
                                <span
                                  className={cn("h-1 w-1 rounded-full", on ? "bg-emerald-400" : "bg-ink-300 dark:bg-white/25")}
                                  aria-hidden="true"
                                />
                                {t.ref}
                              </button>
                            );
                          })}
                          <span className="ml-auto font-code text-[7.5px] font-bold tracking-[0.16em] text-ink-400">
                            {picked.length} OF 4 SELECTED
                          </span>
                        </div>
                      </div>

                      {rows.length === 0 ? (
                        <p className="px-5 py-12 text-center text-[12.5px] text-ink-500 sm:px-7">
                          Pick at least one tender to compare.
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[560px] border-collapse text-left">
                            <thead>
                              <tr className="border-b border-ink-100 dark:border-white/[0.07]">
                                <th
                                  scope="col"
                                  className="sticky left-0 z-10 w-[128px] bg-[#fffdfb] px-4 py-3 font-code text-[7.5px] font-bold tracking-[0.2em] text-ink-400 dark:bg-[#12141a]"
                                >
                                  TENDER
                                </th>
                                {rows.map((r) => (
                                  <th
                                    key={r.ref}
                                    scope="col"
                                    className="min-w-[176px] border-l border-ink-100/70 px-3 py-3 align-top dark:border-white/[0.055]"
                                  >
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="font-code text-[9.5px] font-bold tracking-[0.08em] text-ink-950 dark:text-white">
                                        {r.ref}
                                      </span>
                                      {r.ref === current ? (
                                        <span className="rounded-full bg-ink-950 px-1.5 py-0.5 font-code text-[6.5px] font-bold tracking-[0.14em] text-white dark:bg-white dark:text-ink-950">
                                          ON DESK
                                        </span>
                                      ) : null}
                                      {rows.length > 1 && earliest === r.closing ? (
                                        <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 font-code text-[6.5px] font-bold tracking-[0.12em] text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                                          CLOSES FIRST
                                        </span>
                                      ) : null}
                                    </div>
                                    <p className="mt-1 line-clamp-2 text-[10.5px] font-medium leading-snug text-ink-500 dark:text-ink-400">
                                      {r.title}
                                    </p>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {facts.map((fact) => (
                                <tr
                                  key={fact.label}
                                  className="border-b border-ink-100/60 last:border-0 dark:border-white/[0.045]"
                                >
                                  <th
                                    scope="row"
                                    className="sticky left-0 z-10 bg-[#fffdfb] px-4 py-3.5 align-top font-code text-[7.5px] font-bold tracking-[0.18em] text-ink-400 dark:bg-[#12141a]"
                                  >
                                    {fact.label.toUpperCase()}
                                  </th>
                                  {rows.map((r) => (
                                    <td
                                      key={r.ref}
                                      className="border-l border-ink-100/70 px-3 py-3.5 align-top dark:border-white/[0.055]"
                                    >
                                      {fact.value(r)}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                              <tr>
                                <td className="sticky left-0 z-10 bg-[#fffdfb] px-4 py-3 dark:bg-[#12141a]" />
                                {rows.map((r) => (
                                  <td
                                    key={r.ref}
                                    className="border-l border-ink-100/70 px-3 py-3 dark:border-white/[0.055]"
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        onSelect(r.ref);
                                        setOpen(false);
                                      }}
                                      className="focus-brand inline-flex items-center gap-1 font-code text-[7.5px] font-bold tracking-[0.16em] text-brand-700 transition-colors hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200"
                                    >
                                      OPEN DOSSIER
                                      <ArrowRight className="h-2.5 w-2.5" aria-hidden="true" />
                                    </button>
                                  </td>
                                ))}
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-5 py-3.5 dark:border-white/[0.06] sm:px-7">
                      <p className="max-w-[60ch] text-[10.5px] leading-relaxed text-ink-400">
                        Every figure is stored on the tender&apos;s cycle record — closing date, opening register, portal
                        applications, contract value. Nothing here is inferred.
                      </p>
                      <button
                        type="button"
                        onClick={() => setOpen(false)}
                        className="inline-flex h-8 items-center rounded-lg border border-ink-200/80 px-3 font-code text-[8px] font-bold tracking-[0.16em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950 dark:border-white/[0.12] dark:text-ink-300 dark:hover:border-white/30 dark:hover:text-white"
                      >
                        CLOSE
                      </button>
                    </footer>
                  </motion.div>
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}

/* ── the desk ───────────────────────────────────────────────────────────────── */

export function CycleView({
  onToast,
  canDeleteDocuments = false,
}: {
  user?: unknown;
  onToast: (m: string) => void;
  canDeleteDocuments?: boolean;
}) {
  const [tenders, setTenders] = useState<{ ref: string; title: string }[]>([]);
  const [ref, setRef] = useState("");
  const [tab, setTab] = useState<CycleTab>("pipeline");
  const [cycles, setCycles] = useState<CycleDto[]>([]);
  const [pipeline, setPipeline] = useState<PipelineDto[]>([]);
  const [deadlines, setDeadlines] = useState<DeadlineDto[]>([]);
  const [analytics, setAnalytics] = useState<Record<string, number | string> | null>(null);
  const [members, setMembers] = useState<MemberDto[]>([]);
  const [busy, setBusy] = useState(false);
  /* Draft inputs, one record shared across the tab forms. */
  const [d, setD] = useState<Record<string, string>>({});
  const [noticeAnalysis, setNoticeAnalysis] = useState<NoticeAnalysisState>({ status: "idle", conflicts: [] });
  const [noticeFile, setNoticeFile] = useState<File | null>(null);
  const [pendingUploadRef, setPendingUploadRef] = useState("");
  const [noticeUploadMessage, setNoticeUploadMessage] = useState("");
  const [metaConsent, setMetaConsent] = useState(false);
  const [openRows, setOpenRows] = useState<{ bidder: string; receivedAt: string; priceRead: string }[]>([
    { bidder: "", receivedAt: "", priceRead: "" },
  ]);
  /* Applications filed from the supplier portal — read-only context for the
     opening: the officer still records the register, but sees who bid
     electronically and for how much. */
  const [portalApps, setPortalApps] = useState<PortalAppRow[]>([]);
  /* The register owns the reference: this is the next system-issued number,
     refreshed when the publication year or currency changes. */
  const [autoRef, setAutoRef] = useState("");
  const [refLoading, setRefLoading] = useState(true);
  const set = (k: string, v: string) => {
    setD((p) => ({ ...p, [k]: v }));
    /* Editing a field IS the officer's call on a notice conflict. */
    setNoticeAnalysis((current) =>
      current.conflicts.includes(k)
        ? { ...current, conflicts: current.conflicts.filter((conflict) => conflict !== k) }
        : current,
    );
  };

  const analyzeTenderNotice = async (file: File, consentConfirmed = metaConsent) => {
    if (!consentConfirmed) {
      setNoticeAnalysis({
        status: "error",
        fileName: file.name,
        error: "Confirm the Meta AI data notice before analyzing this document.",
        conflicts: [],
      });
      return;
    }

    setNoticeAnalysis({ status: "analyzing", fileName: file.name, conflicts: [] });
    const form = new FormData();
    form.append("file", file);
    form.append("metaConsent", "true");
    try {
      const response = await fetch("/api/cycle/parse-tender", { method: "POST", body: form });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        model?: string;
        extractionNote?: string;
        fields?: TenderExtraction;
      };
      if (!response.ok || !result.fields) {
        setNoticeAnalysis({
          status: "error",
          fileName: file.name,
          extractionNote: result.extractionNote,
          error: result.error ?? `Document analysis failed (HTTP ${response.status}).`,
          conflicts: [],
        });
        return;
      }

      const extracted = result.fields;
      const candidates: { key: string; label: string; value: string | null }[] = [
        { key: "pipeTitle", label: "Tender title", value: extracted.title.value },
        { key: "pipeOffice", label: "Responsible office", value: extracted.responsibleOffice.value },
        { key: "pipePub", label: "Publication date", value: extracted.publicationDate.value },
        { key: "pipeEst", label: "Budget estimate", value: extracted.budgetEstimate.value === null ? null : String(extracted.budgetEstimate.value) },
        { key: "pipeCur", label: "Currency", value: extracted.currency.value },
      ].filter((field) => field.key !== "pipePub" || !field.value || /^\d{4}-\d{2}-\d{2}$/.test(field.value));

      const conflicts: string[] = [];
      const next = { ...d };
      for (const candidate of candidates) {
        if (!candidate.value) continue;
        const existing = d[candidate.key]?.trim();
        if (existing && existing.toLocaleLowerCase() !== candidate.value.toLocaleLowerCase()) {
          conflicts.push(candidate.key);
          continue;
        }
        next[candidate.key] = candidate.value;
      }
      setD(next);
      setNoticeAnalysis({
        status: "ready",
        fileName: file.name,
        model: result.model,
        extractionNote: result.extractionNote,
        fields: extracted,
        conflicts,
      });
    } catch (error) {
      setNoticeAnalysis({
        status: "error",
        fileName: file.name,
        error: error instanceof Error ? error.message : "The document analysis service could not be reached.",
        conflicts: [],
      });
    }
  };

  const cycle = useMemo(() => cycles.find((c) => c.tenderId === ref) ?? null, [cycles, ref]);

  const pull = useCallback(async () => {
    try {
      const [t, c, dl, an, cm, rn, ap] = await Promise.all([
        fetch(`/api/sample-tenders${SVC}`).then((x) => x.json()),
        fetch(`/api/cycle${SVC}`).then((x) => x.json()),
        fetch(`/api/cycle/deadlines${SVC}`).then((x) => x.json()),
        fetch(`/api/cycle/analytics${SVC}`).then((x) => x.json()),
        fetch("/api/committee").then((x) => x.json()),
        fetch(`/api/runs${SVC}`).then((x) => x.json()),
        fetch(`/api/applications${SVC}`).then((x) => x.json()),
      ]);
      const samples = (t.samples ?? []) as { ref: string; title?: string }[];
      const cycleRows = ((c.cycles ?? []) as CycleDto[]).map(normalizeCycle);
      /* Live tenders the desk has seen (runs + cycles) join the curated packs —
         a manually staged probe tender is as real to the cycle as a sample. */
      const seen = new Set<string>();
      const list: { ref: string; title: string }[] = [];
      const push = (ref: string, title?: string) => {
        if (!ref || seen.has(ref)) return;
        seen.add(ref);
        list.push({ ref, title: title || ref });
      };
      for (const s of samples) push(s.ref, s.title || s.ref);
      for (const cyc of cycleRows) push(cyc.tenderId);
      for (const r of (rn.runs ?? []) as { tenderId: string }[]) push(r.tenderId);
      setTenders(list);
      setCycles(cycleRows);
      setPipeline((c.pipeline ?? []) as PipelineDto[]);
      setDeadlines(
        ((dl.deadlines ?? []) as DeadlineDto[])
          .map((d) => ({ ...d, kind: d.kind || "DEADLINE" }))
          .filter((d) => typeof d.dueAt === "string" && !Number.isNaN(new Date(d.dueAt).getTime()))
      );
      setAnalytics(an ?? null);
      setMembers(((cm.members ?? []) as MemberDto[]).filter((m) => m.status === "PRESENT"));
      setPortalApps(((ap.applications ?? []) as PortalAppRow[]).filter((a) => a.status === "RECEIVED"));
      setRef((cur) => cur || list[0]?.ref || "");
    } catch {
      /* the desk renders what it last had; the poll retries */
    }
  }, []);

  useEffect(() => {
    void pull();
    const id = setInterval(() => void pull(), 5000);
    return () => clearInterval(id);
  }, [pull]);

  const refreshNextRef = useCallback(async () => {
    setRefLoading(true);
    try {
      const q = new URLSearchParams();
      if (d.pipePub) q.set("publication", d.pipePub);
      if (d.pipeCur) q.set("currency", d.pipeCur);
      const query = q.toString();
      const res = await fetch(`/api/pipeline/next-ref${query ? `?${query}&` : "?"}XTransformPort=3031`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { ref?: string };
      if (res.ok && data.ref) setAutoRef(data.ref);
    } catch {
      /* Backend still issues the reference on save; the field says so. */
    } finally {
      setRefLoading(false);
    }
  }, [d.pipePub, d.pipeCur]);

  useEffect(() => {
    void refreshNextRef();
  }, [refreshNextRef, pipeline.length, cycles.length, tenders.length]);

  const act = async (path: string, body: unknown, okMsg: string): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await fetch(`${path}${SVC}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        onToast((data.error ?? `THE CYCLE SERVICE REFUSED (HTTP ${res.status})`).toUpperCase());
        return false;
      }
      onToast(okMsg.toUpperCase());
      await pull();
      return true;
    } catch {
      onToast("THE CYCLE SERVICE DID NOT ANSWER — quorum-mcp UNREACHABLE");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const createPipelineEntry = async (): Promise<boolean> => {
    setBusy(true);
    setNoticeUploadMessage("");
    let createdRef = pendingUploadRef;
    try {
      if (!createdRef) {
        const response = await fetch(`/api/pipeline${SVC}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: d.pipeTitle,
            office: d.pipeOffice || undefined,
            budgetEstimate: Number(d.pipeEst) || undefined,
            currency: d.pipeCur || undefined,
            expectedPublication: d.pipePub || undefined,
          }),
        });
        const result = (await response.json().catch(() => ({}))) as {
          error?: string;
          entry?: { ref?: string };
        };
        if (!response.ok) {
          onToast((result.error ?? `THE CYCLE SERVICE REFUSED (HTTP ${response.status})`).toUpperCase());
          return false;
        }
        if (!result.entry?.ref) {
          onToast("THE PIPELINE SERVICE CREATED NO USABLE TENDER REFERENCE — REFRESH THE PIPELINE BEFORE RETRYING");
          await pull();
          return false;
        }
        createdRef = result.entry.ref;
        setPendingUploadRef(createdRef);
      }

      const uploadWarnings: string[] = [];
      if (noticeFile) {
        const form = new FormData();
        form.append("file", noticeFile);
        const uploadResponse = await fetch(`/api/tenders/${encodeURIComponent(createdRef)}/docs`, {
          method: "POST",
          body: form,
        });
        const upload = (await uploadResponse.json().catch(() => ({}))) as {
          error?: string;
          key?: string;
          staged?: boolean;
          audited?: boolean;
          reason?: string;
          note?: string;
          auditReason?: string;
        };
        if (!uploadResponse.ok || !upload.key) {
          const message = upload.error ?? `The notice could not be attached (HTTP ${uploadResponse.status}).`;
          setNoticeUploadMessage(`Tender ${createdRef} is already in the pipeline. ${message} Retry here to attach the notice without creating a duplicate.`);
          onToast(`TENDER ${createdRef} CREATED · NOTICE UPLOAD FAILED — RETRY TO ATTACH`);
          await pull();
          return false;
        }
        if (!upload.staged) {
          uploadWarnings.push(`stored, but not staged for review${upload.reason || upload.note ? `: ${upload.reason ?? upload.note}` : ""}`);
        }
        if (!upload.audited) {
          uploadWarnings.push(`stored, but audit recording failed${upload.auditReason ? `: ${upload.auditReason}` : ""}`);
        }
      }

      setPendingUploadRef("");
      setNoticeFile(null);
      setNoticeUploadMessage("");
      setNoticeAnalysis({ status: "idle", conflicts: [] });
      setMetaConsent(false);
      setD((current) => ({ ...current, pipeTitle: "", pipeEst: "", pipePub: "" }));
      onToast(
        noticeFile
          ? uploadWarnings.length
            ? `TENDER ${createdRef} CREATED · NOTICE ${uploadWarnings.join(" · ")}`.toUpperCase()
            : `TENDER ${createdRef} CREATED · NOTICE STORED AND AUDITED`.toUpperCase()
          : `TENDER ${createdRef} ADDED TO THE PIPELINE`,
      );
      await pull();
      void refreshNextRef();
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The service could not be reached.";
      if (createdRef && noticeFile) {
        setPendingUploadRef(createdRef);
        setNoticeUploadMessage(`Tender ${createdRef} is already in the pipeline. ${reason} Retry here to attach the notice without creating a duplicate.`);
        onToast(`TENDER ${createdRef} CREATED · NOTICE UPLOAD FAILED — RETRY TO ATTACH`);
        await pull();
      } else {
        onToast(`THE PIPELINE SERVICE DID NOT ANSWER — ${reason}`.toUpperCase());
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  const refreshCycle = () => void pull();

  /* ── Tab: pipeline (G17) ─────────────────────────────────────────────────── */

  const planned = pipeline.filter((p) => p.status !== "LINKED");
  const estimates = pipeline.filter((p) => p.budgetEstimate);
  const sameCur = estimates.length && estimates.every((p) => (p.currency ?? "") === (estimates[0].currency ?? ""));
  const combined = sameCur ? estimates.reduce((s, p) => s + (p.budgetEstimate ?? 0), 0) : 0;
  const PipelineTab = (
    <div className="grid gap-4 xl:gap-5">
      <Card
        title="Plan a tender"
        sub="ONE DETAIL AT A TIME — ONLY A TITLE IS REQUIRED"
        workflow
        busy={busy}
        actionLabel="Create a tender"
        teaser="Start from the notice or type the title — one question at a time. The reference is issued on save."
        right={pendingUploadRef ? <Chip tone="warn">NOTICE PENDING · {pendingUploadRef}</Chip> : undefined}
      >
        {(close) => (
          <PlanTenderIntake
            d={d}
            set={set}
            autoRef={autoRef}
            refLoading={refLoading}
            busy={busy}
            noticeFile={noticeFile}
            onPickNotice={(file) => {
              setNoticeFile(file);
              setNoticeUploadMessage("");
              void analyzeTenderNotice(file);
            }}
            noticeAnalysis={noticeAnalysis}
            noticeUploadMessage={noticeUploadMessage}
            metaConsent={metaConsent}
            onMetaConsent={(value) => {
              setMetaConsent(value);
              if (value && noticeFile && noticeAnalysis.status === "error") {
                void analyzeTenderNotice(noticeFile, true);
              }
            }}
            pendingUploadRef={pendingUploadRef}
            onApplyExtracted={(key, value) => set(key, value)}
            onCreate={createPipelineEntry}
            onCreated={close}
          />
        )}
      </Card>

      <Card
        title="Pipeline"
        workflow
        busy={busy}
        actionLabel="Manage pipeline"
        teaser="Every pack staged before advertisement — link one to a live tender when it lands."
        sub={
          pipeline.length
            ? `${pipeline.length} ENTR${pipeline.length === 1 ? "Y" : "IES"}${combined ? ` · ${estimates[0].currency ?? ""} ${fmtMoney(combined)} COMBINED` : ""}`
            : "NO ENTRIES YET"
        }
        right={
          pipeline.length === 0 ? undefined : planned.length ? (
            <Chip tone="warn">{planned.length} UNLINKED</Chip>
          ) : (
            <Chip tone="ok">ALL LINKED</Chip>
          )
        }
      >
        {pipeline.length === 0 ? (
          <div className="flex flex-col items-center rounded-[10px] border border-dashed border-ink-200 px-5 py-10 text-center dark:border-white/[0.12]">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-ink-100/70 text-ink-400 dark:bg-white/[0.05]">
              <Workflow className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="mt-3.5 text-[13px] font-semibold text-ink-800">Nothing planned yet</p>
            <p className="mt-1.5 max-w-[36ch] text-[11.5px] leading-relaxed text-ink-400">
              Stage the pack above. It waits here until the tender is advertised and the cycle begins.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {pipeline.map((p) => (
              <PipelineRow
                key={p.id}
                p={p}
                tenders={tenders}
                busy={busy}
                onLink={(tenderId) => act(`/api/pipeline/${p.id}/link`, { tenderId }, "PIPELINE ENTRY LINKED")}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );

  /* ── Tab: deadlines (G16) ────────────────────────────────────────────────── */

  const sorted = [...deadlines].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const overdueList = sorted.filter((x) => x.overdue);
  const weekList = sorted.filter((x) => !x.overdue && (daysUntil(x.dueAt) ?? 99) <= 7);
  const laterList = sorted.filter((x) => !x.overdue && (daysUntil(x.dueAt) ?? 99) > 7);

  const DeadlinesTab = (
    <Card
      title="Upcoming deadlines"
      sub="CLOSINGS · ALB RESPONSES · STANDSTILLS · MILESTONES · COMPLAINTS — DERIVED, NEVER STORED TWICE"
      right={
        deadlines.length ? (
          <span className="font-code text-[8.5px] font-bold tracking-[0.14em] text-ink-500">
            {deadlines.length} LIVE{overdueList.length ? <span className="text-brand-600 dark:text-brand-300"> · {overdueList.length} OVERDUE</span> : null}
          </span>
        ) : null
      }
    >
      {deadlines.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-200 px-4 py-8 text-center">
          <CalendarClock className="mx-auto h-5 w-5 text-ink-400" aria-hidden="true" />
          <p className="mt-2 text-[12.5px] text-ink-500">No live deadlines on the desk.</p>
          <p className="mt-1 text-[11px] text-ink-400">Closings, standstill ends and milestones surface here the moment the cycle creates them.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {[
            { label: "OVERDUE", list: overdueList, tone: "brand" as const },
            { label: "NEXT 7 DAYS", list: weekList, tone: null },
            { label: "COMING UP", list: laterList, tone: null },
          ]
            .filter((b) => b.list.length)
            .map((bucket) => (
              <section key={bucket.label}>
                <p className={cn("mb-1.5 font-code text-[8px] font-bold tracking-[0.2em]", bucket.tone === "brand" ? "text-brand-600 dark:text-brand-300" : "text-ink-400")}>
                  {bucket.label} — {bucket.list.length}
                </p>
                <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100 bg-paper">
                  {bucket.list.map((x, i) => (
                    <li key={`${x.tenderId}-${x.kind}-${i}`} className="flex items-center gap-3 px-3 py-2.5">
                      <span className={cn("h-8 w-1 shrink-0 rounded-full", x.overdue ? "bg-brand-500" : "bg-ink-200")} aria-hidden="true" />
                      <span className={cn("shrink-0", x.overdue ? "text-brand-600 dark:text-brand-300" : "text-ink-400")}>
                        <DeadlineIcon kind={x.kind} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-semibold text-ink-900">{x.tenderId}</p>
                        <p className="truncate font-code text-[8.5px] tracking-[0.1em] text-ink-400">
                          {x.kind.replace(/_/g, " ")}{x.ref ? ` — ${x.ref}` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={cn("font-code text-[10px] font-bold tracking-[0.06em]", x.overdue ? "text-brand-700 dark:text-brand-300" : "text-ink-700")}>
                          {relDays(x.dueAt).toUpperCase()}
                        </p>
                        <p className="font-code text-[8px] tracking-[0.08em] text-ink-400">{fmtDateTime(x.dueAt)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </Card>
  );

  /* ── Tab: opening (G3/G8) ────────────────────────────────────────────────── */
  const setClosing = () =>
    act(`/api/tenders/${ref}/closing`, { closingDate: d.closing, actor: "officer" }, "CLOSING DATE ON RECORD").then((ok) => ok && refreshCycle());

  const recordOpening = () =>
    act(
      `/api/tenders/${ref}/opening`,
      {
        bids: openRows
          .filter((r) => r.bidder.trim() && r.receivedAt)
          .map((r) => ({ bidder: r.bidder, receivedAt: new Date(r.receivedAt).toISOString(), priceRead: r.priceRead || undefined })),
      },
      "OPENING REGISTER RECORDED — CERTIFICATION GATE RAISED",
    ).then((ok) => ok && refreshCycle());

  const OpeningTab = (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Closing date on record" sub="THE OFFICER'S ENTRY WINS; THE NOTICE'S DATE IS THE FALLBACK" workflow busy={busy} actionLabel="Set closing date">
        <div className="flex items-end gap-2">
          <Field label="CLOSING DATE">
            <input className={inputCls} type="date" value={d.closing ?? ""} onChange={(e) => set("closing", e.target.value)} />
          </Field>
          <Btn onClick={setClosing} disabled={busy || !d.closing}>
            <Check className="h-3.5 w-3.5" aria-hidden="true" /> Set
          </Btn>
        </div>
        <p className="mt-2 font-code text-[9px] tracking-[0.12em] text-ink-500">
          ON RECORD: {cycle?.closingDate ? fmtDateTime(cycle.closingDate) : "NOT SET"}
        </p>
      </Card>

      <Card title="Record the public bid opening" sub="LATE BIDS ARE REJECTED UNOPENED — THE REGISTER GOES TO THE PROCUREMENT UNIT'S GATE" workflow busy={busy} actionLabel="Record bid opening">
        {cycle?.opening?.certifiedAt ? (
          <div className="space-y-2">
            <Chip tone="ok">REGISTER CERTIFIED {cycle.opening.certifiedBy ? `BY ${cycle.opening.certifiedBy.toUpperCase()}` : ""}</Chip>
            <div className="overflow-hidden rounded-lg border border-ink-100">
              <table className="w-full text-[12px]">
                <tbody>
                  {cycle.opening.rows.map((r) => (
                    <tr key={r.id ?? r.bidder} className="border-b border-ink-100 last:border-0">
                      <td className="px-2.5 py-1.5 font-semibold text-ink-900">{r.bidder}</td>
                      <td className="px-2.5 py-1.5 text-ink-500">{fmtDateTime(r.receivedAt)}</td>
                      <td className="px-2.5 py-1.5 text-right">
                        {r.late ? <span className="font-bold text-brand-700 dark:text-brand-300">LATE</span> : <span className="text-emerald-700 dark:text-emerald-300">admitted</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {cycle.opening.sha ? <p className="font-code text-[8px] tracking-[0.14em] text-ink-400">SHA-256 {cycle.opening.sha}</p> : null}
          </div>
        ) : (
          <div className="space-y-3">
            {openRows.map((row, i) => (
              <div key={i} className="grid grid-cols-[1.4fr_1.2fr_1fr] gap-2">
                <input
                  className={inputCls}
                  placeholder="Bidder"
                  value={row.bidder}
                  onChange={(e) => setOpenRows((p) => p.map((r, j) => (j === i ? { ...r, bidder: e.target.value } : r)))}
                />
                <input
                  className={inputCls}
                  type="datetime-local"
                  value={row.receivedAt}
                  onChange={(e) => setOpenRows((p) => p.map((r, j) => (j === i ? { ...r, receivedAt: e.target.value } : r)))}
                />
                <input
                  className={inputCls}
                  placeholder="Price read"
                  value={row.priceRead}
                  onChange={(e) => setOpenRows((p) => p.map((r, j) => (j === i ? { ...r, priceRead: e.target.value } : r)))}
                />
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Btn variant="ghost" onClick={() => setOpenRows((p) => [...p, { bidder: "", receivedAt: "", priceRead: "" }])}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Row
              </Btn>
              <Btn onClick={recordOpening} disabled={busy || !ref}>
                <Stamp className="h-3.5 w-3.5" aria-hidden="true" /> Record opening
              </Btn>
            </div>
            {cycle?.opening && !cycle.opening.certifiedAt ? (
              <p className="font-code text-[9px] tracking-[0.12em] text-brand-700 dark:text-brand-300">
                REGISTER {cycle.opening.id.toUpperCase()} AWAITING CERTIFICATION — GATE {cycle.opening.gateId?.toUpperCase()}
              </p>
            ) : null}
          </div>
        )}
      </Card>

      <Card
        title="Applications from the supplier portal"
        sub="FILED ELECTRONICALLY AT /ORG — ATTESTED org:<name> · LATE AND DUPLICATE BIDS ALREADY REFUSED AT FILING"
      >
        {(() => {
          const apps = portalApps.filter((a) => a.tenderId === ref);
          if (apps.length === 0) {
            return (
              <p className="font-code text-[9.5px] leading-relaxed tracking-[0.1em] text-ink-400">
                NO ELECTRONIC APPLICATIONS ON RECORD FOR THIS TENDER — ORGANIZATIONS FILE FROM THE SUPPLIER PORTAL AT /ORG
              </p>
            );
          }
          return (
            <div className="space-y-2">
              <Chip tone="ok">{apps.length} ELECTRONIC {apps.length === 1 ? "APPLICATION" : "APPLICATIONS"} ON RECORD</Chip>
              <div className="overflow-hidden rounded-lg border border-ink-100">
                <table className="w-full text-[12px]">
                  <tbody>
                    {apps.map((a) => (
                      <tr key={a.id} className="border-b border-ink-100 last:border-0">
                        <td className="px-2.5 py-1.5 font-semibold text-ink-900">{a.orgName}</td>
                        <td className="px-2.5 py-1.5 text-ink-500">
                          {a.currency ? `${a.currency} ` : ""}
                          {a.amount.toLocaleString()}
                        </td>
                        <td className="px-2.5 py-1.5 text-ink-500">{fmtDateTime(a.receivedAt)}</td>
                        <td className="px-2.5 py-1.5 text-right font-code text-[9px] tracking-[0.1em] text-ink-400">{a.id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="font-code text-[8.5px] tracking-[0.12em] text-ink-400">
                THE OPENING REGISTER REMAINS THE OFFICER'S ACT — THESE ROWS ARE CONTEXT, NOT ENTRIES
              </p>
            </div>
          );
        })()}
      </Card>
    </div>
  );

  /* ── Tab: evaluation (G1/G2/G4 + G9) ─────────────────────────────────────── */

  const declareCoi = (member: string, declaration: "NO_CONFLICT" | "CONFLICT_DECLARED") =>
    act(`/api/tenders/${ref}/coi`, { member, declaration, conflicts: declaration === "CONFLICT_DECLARED" ? d[`coi-${member}`] : undefined }, "CONFLICT DECLARATION RECORDED").then((ok) => ok && refreshCycle());

  const buildMatrix = () =>
    act(
      `/api/tenders/${ref}/matrix`,
      {
        criteria: [
          { title: d.c1Title, weight: Number(d.c1W) },
          { title: d.c2Title, weight: Number(d.c2W) },
          { title: d.c3Title, weight: Number(d.c3W) },
        ].filter((c) => c.title && Number.isFinite(c.weight)),
        technicalWeightPct: Number(d.techW) || undefined,
      },
      "EVALUATION MATRIX BUILT — SCORES DRAFT",
    ).then((ok) => ok && refreshCycle());

  const saveScores = (bidder: string) =>
    act(
      `/api/tenders/${ref}/matrix/scores`,
      {
        bidder,
        scores: (cycle?.matrix?.criteria ?? []).map((c) => ({ criterionId: c.id, score: Number(d[`s-${bidder}-${c.id}`] ?? "0") })),
      },
      `SCORES SAVED — ${bidder.toUpperCase()}`,
    ).then((ok) => ok && refreshCycle());

  const recordMed = () => {
    const adjustments: Record<string, number> = {};
    for (const line of (d.medAdj ?? "").split("\n")) {
      const m = line.match(/^(.+?)\s*\|\s*(C-\d+)\s*=\s*([\d.]+)$/);
      if (m) adjustments[`${m[1].trim()}|${m[2]}`] = Number(m[3]);
    }
    return act(
      `/api/tenders/${ref}/matrix/med`,
      { attendees: (d.medAttendees ?? "").split(",").map((s) => s.trim()).filter(Boolean), adjustments, notes: d.medNotes || undefined },
      "MED SESSION RECORDED",
    ).then((ok) => ok && refreshCycle());
  };

  const certifyMatrix = () =>
    act(`/api/tenders/${ref}/matrix/certify`, {}, "CERTIFICATION GATE RAISED — EVALUATION COMMITTEE SIGNS").then((ok) => ok && refreshCycle());

  /* Same rule the sidecar enforces on signing: every PRESENT member must have a COI record. */
  const outstandingCoi = cycle
    ? members.filter((m) => !cycle.coi.some((x) => x.member.toLowerCase() === m.name.toLowerCase()))
    : [];

  const EvaluationTab = cycle ? (
    <div className="grid gap-4">
      <Card title="Conflict-of-interest declarations" sub="EVERY PRESENT MEMBER DECLARES BEFORE THE MATRIX IS CERTIFIED — THE GATE ENFORCES IT" workflow busy={busy} actionLabel="Manage declarations">
        <ul className="grid gap-2 sm:grid-cols-2">
          {members.map((m) => {
            const decl = cycle.coi.find((x) => x.member.toLowerCase() === m.name.toLowerCase());
            return (
              <li key={m.name} className="rounded-xl border border-ink-100 bg-paper px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-ink-900">{m.name}</p>
                    <p className="font-code text-[8px] tracking-[0.14em] text-ink-400">{m.office ? OFFICE_LABELS[m.office] : "OFFICE NOT SET"}</p>
                  </div>
                  {decl ? (
                    decl.declaration === "NO_CONFLICT" ? <Chip tone="ok">NO CONFLICT</Chip> : <Chip tone="warn">CONFLICT DECLARED</Chip>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <Btn variant="ghost" onClick={() => declareCoi(m.name, "NO_CONFLICT")} disabled={busy}>
                        None
                      </Btn>
                      <Btn variant="ghost" onClick={() => declareCoi(m.name, "CONFLICT_DECLARED")} disabled={busy}>
                        <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" /> Declare
                      </Btn>
                    </div>
                  )}
                </div>
                {decl && decl.declaration === "CONFLICT_DECLARED" && !decl.conflicts ? (
                  <input
                    className={cn(inputCls, "mt-2")}
                    placeholder="State the conflict"
                    value={d[`coi-${m.name}`] ?? ""}
                    onChange={(e) => set(`coi-${m.name}`, e.target.value)}
                    onBlur={() => declareCoi(m.name, "CONFLICT_DECLARED")}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      {cycle.matrix ? (
        <Card title={`Evaluation matrix ${cycle.matrix.id}`} sub={`${cycle.matrix.status} · TECHNICAL ${cycle.matrix.technicalWeightPct}/FINANCIAL ${100 - cycle.matrix.technicalWeightPct}${cycle.matrix.certifiedBy ? ` · CERTIFIED BY ${cycle.matrix.certifiedBy.toUpperCase()}` : ""}`} workflow busy={busy} actionLabel="Open evaluation matrix">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[12px]">
              <thead>
                <tr className="border-b border-ink-100 text-left font-code text-[8px] tracking-[0.14em] text-ink-400">
                  <th className="py-2 pr-2">BIDDER</th>
                  {cycle.matrix.criteria.map((c) => (
                    <th key={c.id} className="py-2 pr-2">
                      {c.title.toUpperCase()} · {c.weight}%
                    </th>
                  ))}
                  <th className="py-2 pr-2">TECH</th>
                  <th className="py-2 pr-2">FIN</th>
                  <th className="py-2 pr-2">TOTAL</th>
                  <th className="py-2 pr-2">RESPONSIVE</th>
                  <th className="py-2 pr-2">VERDICT</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {cycle.matrix.bids.map((b) => (
                  <tr key={b.bidder} className="border-b border-ink-100 last:border-0 align-top">
                    <td className="py-2 pr-2 font-semibold text-ink-900">
                      {b.bidder}
                      {b.late ? <Chip tone="warn">LATE</Chip> : null}
                      {b.reasons.length ? <p className="mt-1 max-w-[220px] text-[10.5px] leading-snug text-ink-400">{b.reasons[0]}</p> : null}
                    </td>
                    {cycle.matrix!.criteria.map((c) => {
                      const s = b.technicalScores.find((x) => x.criterionId === c.id);
                      return (
                        <td key={c.id} className="py-2 pr-2">
                          <input
                            className="h-8 w-16 rounded-lg border border-ink-200 px-2 text-[12px] disabled:border-transparent disabled:bg-transparent disabled:text-ink-700"
                            type="number" min={0} max={100}
                            disabled={cycle.matrix!.status === "CERTIFIED"}
                            value={d[`s-${b.bidder}-${c.id}`] ?? String(s?.score ?? 0)}
                            onChange={(e) => set(`s-${b.bidder}-${c.id}`, e.target.value)}
                          />
                        </td>
                      );
                    })}
                    <td className="py-2 pr-2 font-bold text-ink-900">{b.technicalTotal}</td>
                    <td className="py-2 pr-2">{b.financial?.formulaScore ?? "—"}</td>
                    <td className="py-2 pr-2 font-bold text-ink-950">{b.total ?? "—"}</td>
                    <td className="py-2 pr-2 font-code text-[8px] tracking-[0.1em]">
                      {b.responsiveness === "RESPONSIVE" ? <span className="text-emerald-700 dark:text-emerald-300">YES</span> : <span className="text-brand-700 dark:text-brand-300">{b.responsiveness.replace(/_/g, " ")}</span>}
                    </td>
                    <td className="py-2 pr-2">{b.verdict === "RECOMMENDED" ? <Chip tone="ok">RECOMMENDED</Chip> : b.verdict === "DISQUALIFIED" ? <Chip tone="warn">DISQUALIFIED</Chip> : <Chip tone="muted">NOT RECOMMENDED</Chip>}</td>
                    <td className="py-2">
                      {cycle.matrix!.status === "DRAFT" ? (
                        <Btn variant="ghost" onClick={() => saveScores(b.bidder)} disabled={busy}>
                          Save
                        </Btn>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cycle.matrix.status === "DRAFT" ? (
            <div className="mt-3 grid gap-3 border-t border-ink-100 pt-3 lg:grid-cols-2">
              <div className="space-y-2">
                <Field label="MED ATTENDEES (COMMA-SEPARATED)">
                  <input className={inputCls} value={d.medAttendees ?? ""} onChange={(e) => set("medAttendees", e.target.value)} placeholder={members.map((m) => m.name).join(", ")} />
                </Field>
                <Field label="ADJUSTMENTS — ONE PER LINE: BIDDER | C-01 = 85">
                  <textarea className={cn(inputCls, "h-16 py-2")} value={d.medAdj ?? ""} onChange={(e) => set("medAdj", e.target.value)} />
                </Field>
                <Btn variant="ghost" onClick={recordMed} disabled={busy}>
                  <FileSignature className="h-3.5 w-3.5" aria-hidden="true" /> Record MED session
                </Btn>
              </div>
              <div className="flex flex-col items-start gap-2">
                {outstandingCoi.length ? (
                  <p className="text-[12px] text-ink-600">
                    <span className="font-semibold text-ink-900">Conflict-of-interest declarations outstanding:</span>{" "}
                    {outstandingCoi.map((m) => m.name).join(", ")}
                  </p>
                ) : null}
                <Btn onClick={certifyMatrix} disabled={busy || outstandingCoi.length > 0}>
                  <Stamp className="h-3.5 w-3.5" aria-hidden="true" /> Certify the matrix (gate)
                </Btn>
              </div>
            </div>
          ) : null}
        </Card>
      ) : (
        <Card title="Build the evaluation matrix" sub="CRITERIA WEIGHTS MUST SUM TO 100 — THE VALIDATOR REFUSES ANYTHING ELSE" workflow busy={busy} actionLabel="Set evaluation criteria">
          <div className="grid gap-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="grid grid-cols-[2fr_1fr] gap-2">
                <input className={inputCls} placeholder={`Criterion ${n}`} value={d[`c${n}Title`] ?? ""} onChange={(e) => set(`c${n}Title`, e.target.value)} />
                <input className={inputCls} type="number" min={1} max={100} placeholder="Weight %" value={d[`c${n}W`] ?? ""} onChange={(e) => set(`c${n}W`, e.target.value)} />
              </div>
            ))}
            <div className="grid grid-cols-[2fr_1fr] gap-2">
              <Field label="TECHNICAL WEIGHT % (REST GOES TO THE FINANCIAL FORMULA)">
                <input className={inputCls} type="number" min={0} max={100} placeholder="80" value={d.techW ?? ""} onChange={(e) => set("techW", e.target.value)} />
              </Field>
              <div className="flex items-end">
                <Btn onClick={buildMatrix} disabled={busy || !ref}>
                  <Play className="h-3.5 w-3.5" aria-hidden="true" /> Build
                </Btn>
              </div>
            </div>
          </div>
        </Card>
      )}

      {cycle.alb.length ? (
        <Card title="Abnormally low bids" sub={`JUSTIFICATION CLOCK — ${5} WORKING DAYS PER DOSSIER`}>
          <ul className="space-y-2">
            {cycle.alb.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-ink-100 bg-paper px-3 py-2.5">
                <div>
                  <p className="text-[13px] font-semibold text-ink-900">{a.bidder}</p>
                  <p className="font-code text-[8.5px] tracking-[0.12em] text-ink-400">RESPONSE DUE {fmtDate(a.responseDueAt)} · {relDays(a.responseDueAt).toUpperCase()}</p>
                </div>
                {a.resolution ? <Chip tone="ok">{a.resolution.outcome}</Chip> : <Chip tone="warn">OPEN</Chip>}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  ) : null;

  /* ── Tab: award (G6/G7) ──────────────────────────────────────────────────── */

  const draftAwardReport = () => act(`/api/tenders/${ref}/award-report`, {}, "AWARD REPORT DRAFTED — ACCOUNTING OFFICER GATE RAISED").then((ok) => ok && refreshCycle());
  const publishNotice = () => act(`/api/tenders/${ref}/award-notice/publish`, {}, "NOTICE PUBLICATION GATE RAISED — STANDSTILL FOLLOWS").then((ok) => ok && refreshCycle());
  const draftDebrief = (bidder: string) => act(`/api/tenders/${ref}/debrief`, { bidder }, "DEBRIEF DRAFTED").then((ok) => ok && refreshCycle());
  const issueDebrief = (id: string) => act(`/api/tenders/${ref}/debrief/${id}/issue`, {}, "ISSUING GATE RAISED").then((ok) => ok && refreshCycle());

  const AwardTab = cycle ? (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Award recommendation report" sub="THE STATUTORY REPORT — FINDINGS, MATRIX, RECOMMENDATION, SIGNATURES" workflow busy={busy} actionLabel="Manage award report">
        {cycle.awardReport ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {cycle.awardReport.signedAt ? <Chip tone="ok">SIGNED BY {cycle.awardReport.signedBy?.toUpperCase()}</Chip> : <Chip tone="brand">AWAITING SIGNATURE GATE</Chip>}
              {cycle.awardReport.recommendation ? <Chip tone="muted">{cycle.awardReport.recommendation.toUpperCase()}</Chip> : null}
            </div>
            <p className="font-code text-[8px] tracking-[0.14em] text-ink-400">SHA-256 {cycle.awardReport.sha}</p>
          </div>
        ) : (
          <Btn onClick={draftAwardReport} disabled={busy || !ref}>
            <FileSignature className="h-3.5 w-3.5" aria-hidden="true" /> Draft the award report
          </Btn>
        )}
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-400">
          The report composes from the certified matrix and the run's findings. The accounting officer signs at the gate; publication follows.
        </p>
      </Card>

      <Card title="Notice of award + standstill" sub={`PUBLICATION (SIMULATED PORTAL) STARTS THE ${10}-WORKING-DAY STANDSTILL`} workflow busy={busy} actionLabel="Manage notice">
        {cycle.standstill ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={cycle.standstill.status === "ACTIVE" ? "brand" : "muted"}>STANDSTILL {cycle.standstill.status}</Chip>
              <span className="font-code text-[9px] tracking-[0.12em] text-ink-500">
                ENDS {fmtDate(cycle.standstill.endsAt)} ({cycle.standstill.days} WD)
              </span>
            </div>
            {cycle.awardNotice?.publishedAt ? <p className="font-code text-[8.5px] tracking-[0.12em] text-ink-400">PUBLISHED {fmtDate(cycle.awardNotice.publishedAt)} · {cycle.awardNotice.portal}</p> : null}
            {cycle.standstill.status === "ACTIVE" ? (
              <Btn variant="ghost" onClick={() => act(`/api/tenders/${ref}/standstill/lift`, { actor: "officer" }, "STANDSTILL LIFTED").then((ok) => ok && refreshCycle())} disabled={busy}>
                <Check className="h-3.5 w-3.5" aria-hidden="true" /> Lift the standstill (window closed, no complaint upheld)
              </Btn>
            ) : null}
          </div>
        ) : cycle.awardNotice ? (
          <div className="space-y-2">
            <Chip tone="brand">NOTICE DRAFTED — PUBLICATION GATE PENDING</Chip>
          </div>
        ) : (
          <Btn onClick={publishNotice} disabled={busy || !ref || !cycle.awardReport?.signedAt}>
            <Stamp className="h-3.5 w-3.5" aria-hidden="true" /> Publish the notice of award
          </Btn>
        )}
        {!cycle.awardReport?.signedAt ? <p className="mt-3 text-[11.5px] text-ink-400">The publication gate opens when the award report is signed.</p> : null}
      </Card>

      <Card title="Debrief letters" sub="QUALITATIVE DEBRIEFS FOR EVERY UNSUCCESSFUL BIDDER — DRAFTED FROM THEIR OWN RECORD" workflow busy={busy} actionLabel="Manage debriefs">
        {cycle.debriefs.length === 0 ? (
          <div className="space-y-2">
            <p className="text-[11.5px] text-ink-400">Draft from the matrix's unsuccessful bidders:</p>
            <div className="flex flex-wrap gap-2">
              {(cycle.matrix?.bids ?? [])
                .filter((b) => b.verdict !== "RECOMMENDED")
                .map((b) => (
                  <Btn key={b.bidder} variant="ghost" onClick={() => draftDebrief(b.bidder)} disabled={busy}>
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {b.bidder}
                  </Btn>
                ))}
            </div>
          </div>
        ) : (
          <ul className="space-y-2">
            {cycle.debriefs.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 rounded-xl border border-ink-100 bg-paper px-3 py-2.5">
                <span className="text-[13px] font-semibold text-ink-900">{l.bidder}</span>
                {l.status === "ISSUED" ? <Chip tone="ok">ISSUED</Chip> : <Btn variant="ghost" onClick={() => issueDebrief(l.id)} disabled={busy}>Issue (gate)</Btn>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Clarifications & addenda" sub="EVERY ANSWER GOES TO EVERY BIDDER — AN ADDENDUM INSIDE 7 DAYS MUST MOVE THE CLOSING" workflow busy={busy} actionLabel="Manage clarifications">
        <ul className="space-y-1.5">
          {cycle.clarifications.slice(0, 4).map((c) => (
            <li key={c.id} className="rounded-lg bg-paper px-2.5 py-2 text-[12px]">
              <span className="font-semibold text-ink-800">{c.askedBy}:</span> <span className="text-ink-600">{c.question}</span>
              {c.answer ? <span className="block text-emerald-800 dark:text-emerald-300">A: {c.answer}</span> : (
                <div className="mt-1 flex gap-1.5">
                  <input className={inputCls} placeholder="Answer on behalf of the buyer" value={d[`ans-${c.id}`] ?? ""} onChange={(e) => set(`ans-${c.id}`, e.target.value)} />
                  <Btn variant="ghost" onClick={() => act(`/api/tenders/${ref}/clarifications/${c.id}/answer`, { answer: d[`ans-${c.id}`] }, "ANSWER RECORDED").then((ok) => ok && refreshCycle())} disabled={busy || !d[`ans-${c.id}`]}>
                    Post
                  </Btn>
                </div>
              )}
            </li>
          ))}
          {cycle.clarifications.length === 0 ? <li className="py-4 text-center text-[12px] text-ink-400">No clarifications logged.</li> : null}
        </ul>
        <div className="mt-3 flex gap-1.5">
          <input className={inputCls} placeholder="Addendum summary" value={d.addSummary ?? ""} onChange={(e) => set("addSummary", e.target.value)} />
          <input className={cn(inputCls, "w-36")} placeholder="Extend closing to" value={d.addExt ?? ""} onChange={(e) => set("addExt", e.target.value)} />
          <Btn variant="ghost" onClick={() => act(`/api/tenders/${ref}/addenda`, { summary: d.addSummary, extendsClosingTo: d.addExt || undefined }, "ADDENDUM ISSUED").then((ok) => ok && refreshCycle())} disabled={busy || !d.addSummary}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </Btn>
        </div>
        {cycle.addenda.length ? (
          <ul className="mt-2 space-y-1">
            {cycle.addenda.map((a) => (
              <li key={a.id} className="text-[11.5px] text-ink-500">
                Addendum {a.number}: {a.summary} {a.closingExtensionRequired ? <Chip tone="warn">CLOSING EXTENSION REQUIRED</Chip> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  ) : null;

  /* ── Tab: contract (G12/G13) ─────────────────────────────────────────────── */

  const preparePack = () => act(`/api/tenders/${ref}/contract/pack`, {}, "CONTRACT PACK PREPARED — ACCOUNTING OFFICER GATE RAISED").then((ok) => ok && refreshCycle());
  const addMilestone = () =>
    act(`/api/tenders/${ref}/contract/milestones`, { title: d.milTitle, dueDate: d.milDue || undefined }, "MILESTONE ADDED").then(
      (ok) => ok && (setD((p) => ({ ...p, milTitle: "", milDue: "" })), refreshCycle()),
    );
  const addVariation = () =>
    act(`/api/tenders/${ref}/contract/variations`, { description: d.varDesc, valueDelta: Number(d.varDelta) }, "VARIATION LOGGED").then(
      (ok) => ok && (setD((p) => ({ ...p, varDesc: "", varDelta: "" })), refreshCycle()),
    );
  const addPayment = () =>
    act(`/api/tenders/${ref}/contract/payments`, { description: d.payDesc, amount: Number(d.payAmount) }, "PAYMENT CERTIFICATION GATE RAISED").then(
      (ok) => ok && (setD((p) => ({ ...p, payDesc: "", payAmount: "" })), refreshCycle()),
    );

  const ContractTab = cycle ? (
    cycle.contract ? (
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Contract — ${cycle.contract.supplier}`} sub={`${cycle.contract.currency ?? ""} ${fmtMoney(cycle.contract.value)}${cycle.contract.completedAt ? " · COMPLETED" : " · ACTIVE"}`} workflow busy={busy} actionLabel="Manage contract">
          <ul className="space-y-1.5 text-[12.5px] text-ink-600">
            <li>Variation authority: below {10}% of contract value; at or above it, the accounting officer's gate.</li>
            <li>Payments certify at a named gate before they leave the desk.</li>
          </ul>
          {!cycle.contract.completedAt ? (
            <div className="mt-3">
              <Btn variant="ghost" onClick={() => act(`/api/tenders/${ref}/contract/complete`, { note: d.completeNote }, "COMPLETION GATE RAISED").then((ok) => ok && refreshCycle())} disabled={busy}>
                <Check className="h-3.5 w-3.5" aria-hidden="true" /> Record final acceptance (gate)
              </Btn>
            </div>
          ) : null}
        </Card>

        <Card title="Milestones" sub={`${cycle.contract.milestones.length} ON THE SCHEDULE`} workflow busy={busy} actionLabel="Manage milestones">
          <ul className="space-y-1.5">
            {cycle.contract.milestones.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 rounded-lg bg-paper px-2.5 py-2 text-[12.5px]">
                <span className="text-ink-800">
                  {m.title}
                  {m.dueDate ? <span className="text-ink-400"> · due {fmtDate(m.dueDate)} · {relDays(m.dueDate).toUpperCase()}</span> : null}
                </span>
                {m.status === "DONE" ? (
                  <Chip tone="ok">DONE</Chip>
                ) : (
                  <Btn variant="ghost" onClick={() => act(`/api/tenders/${ref}/contract/milestones/${m.id}/done`, {}, "MILESTONE DONE").then((ok) => ok && refreshCycle())} disabled={busy}>
                    Mark done
                  </Btn>
                )}
              </li>
            ))}
            {cycle.contract.milestones.length === 0 ? <li className="py-3 text-center text-[12px] text-ink-400">No milestones yet.</li> : null}
          </ul>
          <div className="mt-3 grid grid-cols-[2fr_1fr_auto] gap-1.5">
            <input className={inputCls} placeholder="Milestone" value={d.milTitle ?? ""} onChange={(e) => set("milTitle", e.target.value)} />
            <input className={inputCls} type="date" value={d.milDue ?? ""} onChange={(e) => set("milDue", e.target.value)} />
            <Btn variant="ghost" onClick={addMilestone} disabled={busy || !d.milTitle}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </Btn>
          </div>
        </Card>

        <Card title="Variations" sub={`THE GATE BITES AT ${10}%+ OF CONTRACT VALUE`} workflow busy={busy} actionLabel="Manage variations">
          <ul className="space-y-1.5">
            {cycle.contract.variations.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 rounded-lg bg-paper px-2.5 py-2 text-[12.5px]">
                <span className="min-w-0 truncate text-ink-800">
                  {v.description} <span className="text-ink-400">· {v.pctOfContract}% · {v.valueDelta > 0 ? "+" : ""}{fmtMoney(v.valueDelta)}</span>
                </span>
                {v.status === "APPROVED" ? <Chip tone="ok">APPROVED</Chip> : v.status === "REJECTED" ? <Chip tone="muted">REJECTED</Chip> : <Chip tone="warn">AT GATE</Chip>}
              </li>
            ))}
            {cycle.contract.variations.length === 0 ? <li className="py-3 text-center text-[12px] text-ink-400">No variations.</li> : null}
          </ul>
          <div className="mt-3 grid grid-cols-[2fr_1fr_auto] gap-1.5">
            <input className={inputCls} placeholder="Variation description" value={d.varDesc ?? ""} onChange={(e) => set("varDesc", e.target.value)} />
            <input className={inputCls} type="number" placeholder="± value" value={d.varDelta ?? ""} onChange={(e) => set("varDelta", e.target.value)} />
            <Btn variant="ghost" onClick={addVariation} disabled={busy || !d.varDesc || !d.varDelta}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </Btn>
          </div>
        </Card>

        <Card title="Payments" sub="CERTIFY BEFORE IT LEAVES THE DESK" workflow busy={busy} actionLabel="Manage payments">
          <ul className="space-y-1.5">
            {cycle.contract.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-paper px-2.5 py-2 text-[12.5px]">
                <span className="min-w-0 truncate text-ink-800">
                  {p.description} <span className="text-ink-400">· {fmtMoney(p.amount)}</span>
                </span>
                {p.certifiedAt ? <Chip tone="ok">CERTIFIED</Chip> : <Chip tone="warn">AT GATE</Chip>}
              </li>
            ))}
            {cycle.contract.payments.length === 0 ? <li className="py-3 text-center text-[12px] text-ink-400">No payments raised.</li> : null}
          </ul>
          <div className="mt-3 grid grid-cols-[2fr_1fr_auto] gap-1.5">
            <input className={inputCls} placeholder="Payment description" value={d.payDesc ?? ""} onChange={(e) => set("payDesc", e.target.value)} />
            <input className={inputCls} type="number" placeholder="Amount" value={d.payAmount ?? ""} onChange={(e) => set("payAmount", e.target.value)} />
            <Btn variant="ghost" onClick={addPayment} disabled={busy || !d.payDesc || !d.payAmount}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </Btn>
          </div>
        </Card>
      </div>
    ) : (
      <Card title="Prepare the contract pack" sub="OPENS AFTER THE AWARD REPORT IS SIGNED AND THE STANDSTILL HAS LAPSED" workflow busy={busy} actionLabel="Prepare contract pack">
        <Btn onClick={preparePack} disabled={busy || !ref || !cycle.awardReport?.signedAt}>
          <FileSignature className="h-3.5 w-3.5" aria-hidden="true" /> Prepare the contract pack
        </Btn>
        {!cycle.awardReport?.signedAt ? <p className="mt-3 text-[11.5px] text-ink-400">The award report must be signed first.</p> : null}
      </Card>
    )
  ) : null;

  /* ── Tab: complaints (G14) ───────────────────────────────────────────────── */

  const ComplaintsTab = cycle ? (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Log a complaint" sub="STANDSTILL-WINDOW COMPLAINTS ARE MARKED AS SUCH" workflow busy={busy} actionLabel="Log a complaint">
        <div className="grid gap-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={inputCls} placeholder="Complainant" value={d.cmpWho ?? ""} onChange={(e) => set("cmpWho", e.target.value)} />
            <input className={inputCls} placeholder="Subject" value={d.cmpWhat ?? ""} onChange={(e) => set("cmpWhat", e.target.value)} />
          </div>
          <textarea className={cn(inputCls, "h-20 py-2")} placeholder="Grounds" value={d.cmpBody ?? ""} onChange={(e) => set("cmpBody", e.target.value)} />
          <Btn
            onClick={() =>
              act(`/api/tenders/${ref}/complaints`, { complainant: d.cmpWho, subject: d.cmpWhat, body: d.cmpBody }, "COMPLAINT LOGGED").then(
                (ok) => ok && (setD((p) => ({ ...p, cmpWho: "", cmpWhat: "", cmpBody: "" })), refreshCycle()),
              )
            }
            disabled={busy || !d.cmpWho || !d.cmpWhat}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Log complaint
          </Btn>
        </div>
      </Card>

      <Card title="Complaints on this tender" sub="RESPONSES ARE DRAFTED, SIGNED AT A GATE, THEN ISSUE" workflow busy={busy} actionLabel="Manage complaint responses">
        {cycle.complaints.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-200 px-4 py-8 text-center">
            <Scale className="mx-auto h-5 w-5 text-ink-400" aria-hidden="true" />
            <p className="mt-2 text-[12.5px] text-ink-500">None on record.</p>
            <p className="mt-1 text-[11px] text-ink-400">Bidder complaints land here — standstill-window ones are flagged for priority.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {cycle.complaints.map((c) => (
              <li key={c.id} className="rounded-xl border border-ink-100 bg-paper px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-ink-900">{c.complainant}</p>
                    <p className="truncate text-[11.5px] text-ink-500">{c.subject}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {c.duringStandstill ? <Chip tone="brand">STANDSTILL</Chip> : null}
                    {c.status === "ANSWERED" ? <Chip tone="ok">ANSWERED</Chip> : <Chip tone="warn">OPEN · 14 WD</Chip>}
                  </div>
                </div>
                {c.status === "OPEN" ? (
                  <div className="mt-2 flex gap-1.5">
                    <input className={inputCls} placeholder="Response draft" value={d[`cresp-${c.id}`] ?? ""} onChange={(e) => set(`cresp-${c.id}`, e.target.value)} />
                    <Btn
                      variant="ghost"
                      onClick={() =>
                        act(`/api/tenders/${ref}/complaints/${c.id}/respond`, { response: d[`cresp-${c.id}`] }, "RESPONSE GATE RAISED").then((ok) => ok && refreshCycle())
                      }
                      disabled={busy || !d[`cresp-${c.id}`]}
                    >
                      Respond (gate)
                    </Btn>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  ) : null;

  /* ── Tab: analytics + procurement file (G15/G5) ──────────────────────────── */

  /* Whole numbers stay whole; the one ratio on the desk gets one decimal. */
  const fmtNum = (v: number | string) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(1);
  };

  /* Where every dossier on the desk actually stands — each cycle record is
     read for the stage it has reached and counted once. Derived from the
     records on every poll, never stored, never asserted. Zero stays zero. */
  const stageLabels = useMemo(() => deriveStages(null).stages.map((s) => s.label), []);
  const stageDist = useMemo(() => {
    const buckets = Array.from({ length: 7 }, () => 0);
    for (const c of cycles) {
      const { currentIndex } = deriveStages(c);
      buckets[Math.min(Math.max(currentIndex, 0), 6)] += 1;
    }
    return buckets;
  }, [cycles]);
  const stageDistMax = Math.max(...stageDist, 1);

  const AnalyticsTab = (
    <div className="grid gap-4">
      <Card
        title="Desk analytics"
        sub="READ-SIDE ONLY — COMPUTED FROM THE APPEND-ONLY LOGS, ZERO NEW INSTRUMENTATION"
        right={
          analytics ? (
            <span className="font-code text-[8px] font-bold tracking-[0.14em] text-ink-400">
              {fmtNum(analytics.tendersInCycle ?? 0)} TENDER{Number(analytics.tendersInCycle ?? 0) === 1 ? "" : "S"} IN CYCLE
            </span>
          ) : null
        }
      >
        {!analytics ? (
          /* No record yet — an honest instrument reads blank, not zero. */
          <div className="flex flex-col items-center rounded-[10px] border border-dashed border-ink-200 px-5 py-10 text-center dark:border-white/[0.12]">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-ink-100/70 text-ink-400 dark:bg-white/[0.05]">
              <Workflow className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="mt-3.5 text-[13px] font-semibold text-ink-800">Analytics arrive with the first cycle record</p>
            <p className="mt-1.5 max-w-[44ch] text-[11.5px] leading-relaxed text-ink-400">
              Every number here is computed from the append-only log the moment the desk starts moving — nothing is
              estimated ahead of the record.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {/* Headline numbers — the four an oversight meeting opens with. */}
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-ink-100 bg-ink-100/70 sm:grid-cols-4 dark:border-white/[0.07] dark:bg-white/[0.07]">
              {(
                [
                  { k: "tendersInCycle", label: "Tenders in cycle", hint: "RECORDS OPEN ON THE DESK" },
                  { k: "bidsOpened", label: "Bids opened", hint: "REGISTERED AT PUBLIC OPENING" },
                  { k: "certifiedMatrices", label: "Matrices certified", hint: "EVALUATION SIGNED AT A GATE" },
                  { k: "contractsClosed", label: "Contracts closed", hint: "ACCEPTANCE RECORDED", accent: true },
                ] as { k: string; label: string; hint?: string; accent?: boolean }[]
              ).map((m) => (
                <div key={m.k} className="bg-[#fffefa] px-4 py-3.5 dark:bg-[#12141a]">
                  <dt className="eyebrow text-[8px] tracking-[0.2em]">{m.label}</dt>
                  <dd
                    className={cn(
                      "mt-2 font-display text-[26px] font-black leading-none tracking-[-0.02em] tabular",
                      m.accent ? "text-brand-600 dark:text-brand-400" : "text-ink-950 dark:text-white",
                    )}
                  >
                    {fmtNum(analytics[m.k] ?? 0)}
                  </dd>
                  <p className="mt-1.5 font-code text-[7.5px] tracking-[0.12em] text-ink-400">{m.hint}</p>
                </div>
              ))}
            </dl>

            {/* Where the desk stands — one column per stage, one count per
                dossier record. The bar carries no decoration: height is the
                count, zero is empty, and the number above it is the truth. */}
            {cycles.length ? (
              <div className="rounded-[10px] border border-ink-100 px-4 pb-3 pt-3.5 dark:border-white/[0.07]">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="eyebrow text-[8px] tracking-[0.2em]">Where the desk stands</p>
                  <span className="font-code text-[8px] font-bold tracking-[0.14em] text-ink-400">
                    {cycles.length} CYCLE {cycles.length === 1 ? "RECORD" : "RECORDS"} ON FILE
                  </span>
                </div>
                <div
                  className="mt-3 grid grid-cols-7 gap-1.5 sm:gap-2"
                  role="img"
                  aria-label={
                    `Tenders by current stage: ` +
                    stageLabels.map((l, i) => `${l} ${stageDist[i]}`).join(", ")
                  }
                >
                  {stageDist.map((n, i) => (
                    <div
                      key={stageLabels[i]}
                      className="flex min-w-0 flex-col items-center"
                      title={`${n} tender${n === 1 ? "" : "s"} at ${stageLabels[i]}`}
                    >
                      <span
                        className={cn(
                          "font-display text-[15px] font-black leading-none tabular tracking-[-0.02em]",
                          n > 0 ? "text-ink-950 dark:text-white" : "text-ink-300 dark:text-ink-600",
                        )}
                      >
                        {n}
                      </span>
                      <span
                        className="mt-1.5 flex h-12 w-full items-end justify-center border-b border-ink-100 dark:border-white/[0.08]"
                        aria-hidden="true"
                      >
                        <span
                          className={cn(
                            "w-full max-w-[26px] rounded-t-[3px] transition-[height] duration-500",
                            n > 0 ? "bg-brand-500/85 dark:bg-brand-400/80" : "bg-transparent",
                          )}
                          style={{ height: n > 0 ? `${Math.max((n / stageDistMax) * 100, 10)}%` : "0%" }}
                        />
                      </span>
                      <span className="mt-1.5 w-full truncate text-center font-code text-[6.5px] font-bold tracking-[0.08em] text-ink-400">
                        {stageLabels[i].toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-2.5 font-code text-[7.5px] tracking-[0.14em] text-ink-400">
                  COUNTED AT THE STAGE EACH RECORD HAS REACHED — CLOSED CYCLES SIT AT CLOSURE
                </p>
              </div>
            ) : null}

            {/* Watchlist — the exceptions that need a human, each with the
                tab that resolves it. Zero stays zero; nothing is invented. */}
            {(() => {
              const watches: { count: number; label: string; tab: CycleTab; tabLabel: string }[] = [
                { count: Number(analytics.lateBids ?? 0), label: "late bids rejected unopened", tab: "opening", tabLabel: "OPENING" },
                { count: Number(analytics.albOpen ?? 0), label: "abnormally-low-bid queries open", tab: "evaluation", tabLabel: "EVALUATION" },
                { count: Number(analytics.openComplaints ?? 0), label: "complaints awaiting a response", tab: "complaints", tabLabel: "COMPLAINTS" },
                { count: Number(analytics.standstillsActive ?? 0), label: "standstill clocks running", tab: "award", tabLabel: "AWARD" },
              ];
              const raised = watches.filter((w) => w.count > 0);
              return (
                <div
                  className={cn(
                    "rounded-[10px] border px-4 py-3.5",
                    raised.length
                      ? "border-brand-500/30 bg-brand-500/[0.05] dark:border-brand-400/30 dark:bg-brand-500/[0.07]"
                      : "border-emerald-500/25 bg-emerald-500/[0.05] dark:border-emerald-400/25",
                  )}
                >
                  <p className={cn("eyebrow text-[8px] tracking-[0.2em]", raised.length ? "text-brand-700 dark:text-brand-300" : "text-emerald-700 dark:text-emerald-300")}>
                    {raised.length ? "NEEDS ATTENTION" : "ALL CLEAR"}
                  </p>
                  {raised.length ? (
                    <ul className="mt-2.5 space-y-1.5">
                      {raised.map((w) => (
                        <li key={w.label} className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <span className="inline-grid h-4.5 min-w-4.5 place-items-center rounded-full bg-brand-600 px-1 font-code text-[8.5px] font-black tabular text-white dark:bg-brand-500">
                            {w.count}
                          </span>
                          <span className="text-[12px] font-medium text-ink-800 dark:text-ink-100">{w.label}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setTab(w.tab);
                              document.getElementById(`cycle-tab-${w.tab}`)?.focus();
                            }}
                            className="focus-brand inline-flex items-center gap-1 rounded font-code text-[8px] font-bold tracking-[0.14em] text-brand-700 underline decoration-brand-500/40 underline-offset-4 transition-colors hover:decoration-brand-500 dark:text-brand-300"
                          >
                            OPEN {w.tabLabel}
                            <ArrowRight className="h-2.5 w-2.5" aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1.5 text-[12px] text-ink-600 dark:text-ink-300">
                      No late bids, no open queries, no unanswered complaints, no running standstills — the desk is clean.
                    </p>
                  )}
                </div>
              );
            })()}

            {/* The rest of the record — compact, tabular, honest. */}
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-ink-100 bg-ink-100/70 sm:grid-cols-3 xl:grid-cols-5 dark:border-white/[0.07] dark:bg-white/[0.07]">
              {(
                [
                  { k: "onTimeBids", label: "On-time bids" },
                  { k: "complaints", label: "Complaints logged" },
                  { k: "findingsTotal", label: "Findings raised" },
                  { k: "findingsPerTender", label: "Findings / tender" },
                  { k: "contractsActive", label: "Contracts active" },
                ] as { k: string; label: string }[]
              ).map((m) => (
                <div key={m.k} className="bg-[#fffefa] px-3.5 py-3 dark:bg-[#12141a]">
                  <dt className="eyebrow text-[7.5px] tracking-[0.18em]">{m.label}</dt>
                  <dd className="mt-1.5 font-display text-[19px] font-bold leading-none tracking-[-0.02em] tabular text-ink-900 dark:text-white">
                    {fmtNum(analytics[m.k] ?? 0)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </Card>
      <Card
        title="Stored tender documents"
        sub={ref ? `${ref} · STORAGE, STAGING AND AUDIT STATUS` : "SELECT A TENDER TO BROWSE ITS DOCUMENTS"}
        workflow
        busy={busy}
        actionLabel="Manage stored documents"
      >
        <StoredDocsBrowser
          tenderRef={ref}
          canDelete={canDeleteDocuments}
          title="STORED TENDER DOCUMENTS"
        />
      </Card>
      <Card title="Consolidated procurement file" sub="ONE BUNDLE FOR THE AUDITORS — EVERY ARTIFACT, HASH AND SIGNATURE, WITH THE LOG-CHAIN VERDICT">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-100 bg-paper px-4 py-3.5">
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-ink-900">{ref || "Select a tender"}</p>
            <p className="text-[11px] text-ink-400">Composes live from the append-only log — the auditors' single entry point.</p>
          </div>
          <a
            href={`/api/procurement-file/${encodeURIComponent(ref)}${SVC}`}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-[12.5px] font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-950/20 active:scale-[0.98]",
              ref ? "bg-brand-600 text-white shadow-sm hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-400" : "pointer-events-none bg-ink-100 text-ink-400",
            )}
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> Open the procurement file
          </a>
        </div>
      </Card>
    </div>
  );

  /* ── Shell ───────────────────────────────────────────────────────────────── */

  /* Tab context badges — the numbers that matter, on the tabs themselves. */
  const tabBadge = (id: CycleTab): ReactNode => {
    switch (id) {
      case "pipeline":
        return planned.length ? <Badge>{planned.length}</Badge> : null;
      case "deadlines":
        return overdueList.length ? <Badge tone="alert">{overdueList.length}</Badge> : null;
      case "opening":
        return cycle?.opening?.certifiedAt ? <Dot tone="ok" /> : cycle?.opening ? <Dot tone="alert" /> : null;
      case "evaluation":
        return cycle?.matrix ? <Dot tone={cycle.matrix.certifiedBy ? "ok" : "alert"} /> : null;
      case "award":
        return cycle?.awardReport?.signedAt ? <Dot tone="ok" /> : null;
      case "contract":
        return cycle?.contract ? <Dot tone={cycle.contract.completedAt ? "ok" : "alert"} /> : null;
      case "complaints": {
        const open = cycle?.complaints.filter((c) => c.status === "OPEN").length ?? 0;
        return open ? <Badge tone="alert">{open}</Badge> : null;
      }
      default:
        return null;
    }
  };

  return (
    <section id="mc-cycle" aria-labelledby="mc-cycle-h" className="scroll-mt-24">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
        className="panel relative flex h-full flex-col overflow-hidden rounded-[12px]"
      >
        {/* One wash of signal colour at the top edge — the desk's own light. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-28 left-0 right-0 h-56 bg-[radial-gradient(420px_180px_at_18%_100%,rgba(232,56,42,0.08),transparent_70%)] dark:bg-[radial-gradient(440px_190px_at_18%_100%,rgba(232,56,42,0.16),transparent_72%)]"
        />

        <header className="relative px-5 pb-4 pt-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 eyebrow">
                <Workflow className="h-3 w-3 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                Command / Cycle control
              </p>
              <h2
                id="mc-cycle-h"
                className="mt-2.5 font-display text-[27px] font-black leading-none tracking-[-0.032em] text-ink-950"
              >
                Tender Cycle<span className="text-brand-600 dark:text-brand-400">.</span>
              </h2>
              <p className="mt-2 max-w-[62ch] text-[12.5px] leading-relaxed text-ink-500">
                One desk, the whole cycle — every irreversible step stops at a named human gate.
              </p>
            </div>
            <div className="hidden shrink-0 items-center pt-0.5 sm:flex">
              <StageLegend />
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-stretch">
            <div className="min-w-0 flex-1">
              <TenderPicker tenders={tenders} value={ref} cycles={cycles} onSelect={setRef} onToast={onToast} />
            </div>
            <TenderCompare
              tenders={tenders}
              cycles={cycles}
              pipeline={pipeline}
              applications={portalApps}
              current={ref}
              onSelect={setRef}
            />
          </div>
        </header>

        <div className="border-t border-ink-100/80 dark:border-white/[0.055]">
          <CycleRail cycle={cycle} />
        </div>

        <VitalStrip cycle={cycle} />

        <nav
          className="relative flex gap-0.5 overflow-x-auto border-y border-ink-100/80 px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden dark:border-white/[0.06]"
          role="tablist"
          aria-label="Cycle phases"
          onKeyDown={(e) => {
            if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
            e.preventDefault();
            const i = TABS.findIndex((t) => t.id === tab);
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? TABS.length - 1
                  : (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
            const id = TABS[next].id;
            setTab(id);
            document.getElementById(`cycle-tab-${id}`)?.focus();
          }}
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`cycle-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls="cycle-panel"
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              className={cn(
                "relative -mb-px flex items-center gap-1.5 whitespace-nowrap px-3 py-3 font-code text-[9px] font-bold tracking-[0.15em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffdfb] dark:focus-visible:ring-offset-[#111318]",
                tab === t.id
                  ? "text-ink-950 dark:text-white"
                  : "text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100",
              )}
            >
              {t.label.toUpperCase()}
              {tabBadge(t.id)}
              {tab === t.id ? (
                <motion.span
                  layoutId="cycle-tab-underline"
                  className="absolute inset-x-2.5 -bottom-px h-[2px] rounded-full bg-brand-500 dark:bg-brand-400"
                  transition={{ duration: 0.25, ease: EASE }}
                  aria-hidden="true"
                />
              ) : null}
            </button>
          ))}
        </nav>

        <div
          id="cycle-panel"
          role="tabpanel"
          aria-labelledby={`cycle-tab-${tab}`}
          tabIndex={0}
          className="relative flex-1 bg-[#f8f7f3] px-4 py-4 outline-none sm:px-5 sm:py-5 dark:bg-[#090b0f]"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: EASE }}
            >
              {tab === "pipeline" ? PipelineTab : null}
              {tab === "deadlines" ? DeadlinesTab : null}
              {tab === "opening" ? OpeningTab : null}
              {tab === "evaluation" ? EvaluationTab : null}
              {tab === "award" ? AwardTab : null}
              {tab === "contract" ? ContractTab : null}
              {tab === "complaints" ? ComplaintsTab : null}
              {tab === "analytics" ? AnalyticsTab : null}
              {tab !== "pipeline" && tab !== "deadlines" && !cycle ? (
                /* No cycle record — the one empty state that asks for a hand.
                   The action is real: it opens the pipeline tab where the pack
                   is actually staged. No decorative buttons. */
                <div className="panel flex flex-col items-center rounded-[12px] px-6 py-12 text-center">
                  <span className="grid h-12 w-12 place-items-center rounded-full border border-dashed border-ink-300 text-ink-400 dark:border-white/[0.18]">
                    <Workflow className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <p className="mt-4 text-[14px] font-semibold text-ink-800">
                    {ref ? "No tender cycle has been initiated" : "No tender selected"}
                  </p>
                  <p className="mt-2 max-w-[48ch] text-[12.5px] leading-relaxed text-ink-500">
                    {ref
                      ? "This dossier has no cycle record — the pack has not been staged or advertised yet. Plan it in the pipeline below; from the first entry, opening, evaluation, award and contract each keep their own file."
                      : "Pick a tender from the working dossier above, or plan a new pack in the pipeline. Its stage, vitals and file appear here the moment the record exists."}
                  </p>
                  <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setTab("pipeline");
                        document.getElementById("cycle-tab-pipeline")?.focus();
                      }}
                      className="focus-brand inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-[12.5px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_22px_-14px_rgba(217,38,22,0.9)] transition-[background-color,transform] duration-150 hover:bg-brand-500 active:scale-[0.985]"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      {ref ? "Stage the tender pack" : "Plan a tender in the pipeline"}
                    </button>
                    {tenders.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          const next = tenders.find((t) => cycles.some((c) => c.tenderId === t.ref))?.ref ?? tenders[0]?.ref;
                          if (next) setRef(next);
                        }}
                        className="focus-brand inline-flex h-10 items-center gap-2 rounded-lg border border-ink-200/90 bg-[#fffdfb] px-4 text-[12.5px] font-semibold text-ink-700 transition-colors hover:border-ink-400 hover:text-ink-950 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-ink-300 dark:hover:border-white/25 dark:hover:text-white"
                      >
                        <Search className="h-3.5 w-3.5" aria-hidden="true" />
                        Show a tender with a record
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-4 font-code text-[8px] font-bold tracking-[0.16em] text-ink-400">
                    7 STAGES · EVERY IRREVERSIBLE STEP STOPS AT A NAMED HUMAN
                  </p>
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </section>
  );
}

/* ── Plan a tender — one question at a time ──────────────────────────────────
   The same intake shape as the supplier register: a section, a progress meter,
   one question, one control. The notice is an optional first step; every
   answer after it can be skipped and revisited from the review. */

type PlanStepKey = "notice" | "title" | "office" | "publication" | "budget" | "review";

const PLAN_STEPS: {
  key: PlanStepKey;
  section: string;
  prompt: string;
  hint: string;
  required?: boolean;
}[] = [
  {
    key: "notice",
    section: "HEAD START",
    prompt: "Start from the tender notice?",
    hint: "Optional. Choose the notice and Quorum reads it, then fills the answers for you to check. Nothing is filed yet.",
  },
  {
    key: "title",
    section: "THE PACK",
    prompt: "What is this tender called?",
    hint: "The title the market will see. This is the only required answer.",
    required: true,
  },
  {
    key: "office",
    section: "ACCOUNTABILITY",
    prompt: "Which office owns this pack?",
    hint: "The desk accountable for the record — skip if it is not settled yet.",
  },
  {
    key: "publication",
    section: "TIMING",
    prompt: "When do you expect to publish?",
    hint: "Optional. The date you expect the pack to reach the market — it shows on the pipeline entry.",
  },
  {
    key: "budget",
    section: "BUDGET",
    prompt: "What is the budget estimate?",
    hint: "Optional. Leave it blank until the figure is settled.",
  },
  {
    key: "review",
    section: "REVIEW",
    prompt: "Ready to stage this tender?",
    hint: "Check the answers. The reference is issued only when you create the record.",
  },
];

type NoticeField = {
  key: string;
  label: string;
  value: string | null;
  applyValue?: string | null;
  confidence: number;
  evidence: string | null;
};

type PlanTenderIntakeProps = {
  d: Record<string, string>;
  set: (key: string, value: string) => void;
  autoRef: string;
  refLoading: boolean;
  busy: boolean;
  noticeFile: File | null;
  onPickNotice: (file: File) => void;
  noticeAnalysis: NoticeAnalysisState;
  noticeUploadMessage: string;
  metaConsent: boolean;
  onMetaConsent: (value: boolean) => void;
  pendingUploadRef: string;
  onApplyExtracted: (key: string, value: string) => void;
  onCreate: () => Promise<boolean>;
  onCreated: () => void;
};

function PlanTenderIntake({
  d,
  set,
  autoRef,
  refLoading,
  busy,
  noticeFile,
  onPickNotice,
  noticeAnalysis,
  noticeUploadMessage,
  metaConsent,
  onMetaConsent,
  pendingUploadRef,
  onApplyExtracted,
  onCreate,
  onCreated,
}: PlanTenderIntakeProps) {
  /* A failed notice upload lands directly on the retry — the record already
     exists, so the review is the only useful next screen. */
  const [step, setStep] = useState(() => (pendingUploadRef ? PLAN_STEPS.length - 1 : 0));
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const current = PLAN_STEPS[step];
  const last = PLAN_STEPS.length - 1;
  const title = (d.pipeTitle ?? "").trim();
  const analyzing = noticeAnalysis.status === "analyzing";
  const extracted = noticeAnalysis.fields;

  const extractedFields: NoticeField[] = extracted
    ? [
        { key: "pipeTitle", label: "Tender title", value: extracted.title.value, confidence: extracted.title.confidence, evidence: extracted.title.evidence },
        { key: "pipeOffice", label: "Responsible office", value: extracted.responsibleOffice.value ? OFFICE_LABELS[extracted.responsibleOffice.value] : null, applyValue: extracted.responsibleOffice.value, confidence: extracted.responsibleOffice.confidence, evidence: extracted.responsibleOffice.evidence },
        { key: "pipePub", label: "Publication date", value: extracted.publicationDate.value, confidence: extracted.publicationDate.confidence, evidence: extracted.publicationDate.evidence },
        { key: "pipeEst", label: "Budget estimate", value: extracted.budgetEstimate.value === null ? null : fmtMoney(extracted.budgetEstimate.value), applyValue: extracted.budgetEstimate.value === null ? null : String(extracted.budgetEstimate.value), confidence: extracted.budgetEstimate.confidence, evidence: extracted.budgetEstimate.evidence },
        { key: "pipeCur", label: "Currency", value: extracted.currency.value, confidence: extracted.currency.confidence, evidence: extracted.currency.evidence },
      ]
    : [];

  const notes = extracted ? extracted.warnings.length + (noticeAnalysis.extractionNote ? 1 : 0) : 0;
  const titleFromNotice = !!extracted?.title.value && extracted.title.value === d.pipeTitle;
  const budget = d.pipeEst && Number.isFinite(Number(d.pipeEst)) ? Number(d.pipeEst) : null;

  /* Each answer is the screen's whole focus: move the eye to the top of the
     question, then put the caret in the one control that answers it. */
  useEffect(() => {
    /* Wait out the 180ms step transition — the next question owns focus. */
    const timer = window.setTimeout(() => {
      const body = rootRef.current?.closest<HTMLElement>("[data-cycle-workflow-body]");
      body?.scrollTo?.({ top: 0, behavior: "smooth" });
      rootRef.current?.querySelector<HTMLElement>("[data-plan-focus]")?.focus({ preventScroll: true });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [step]);

  const go = (next: number) => {
    setError("");
    setStep(Math.max(0, Math.min(next, last)));
  };

  const advance = () => {
    if (current.key === "title" && !title) {
      setError("Give the tender a title to continue.");
      return;
    }
    setError("");
    setStep((s) => Math.min(s + 1, last));
  };

  const submit = async () => {
    if (!title) {
      setError("Give the tender a title before staging it.");
      setStep(1);
      return;
    }
    setError("");
    const created = await onCreate();
    if (created) onCreated();
  };

  const onFieldKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    advance();
  };

  const rows: { label: string; value: string; step: number | null }[] = [
    { label: "Title", value: title || "—", step: 1 },
    { label: "Office", value: d.pipeOffice ? OFFICE_LABELS[d.pipeOffice] ?? d.pipeOffice : "Not set", step: 2 },
    { label: "Publication", value: d.pipePub ? fmtDate(d.pipePub) : "Not set", step: 3 },
    { label: "Budget", value: budget !== null ? `${d.pipeCur || "No currency"} ${fmtMoney(budget)}` : "Not set", step: 4 },
    { label: "Notice", value: noticeFile ? noticeFile.name : "None attached", step: 0 },
    { label: "Reference", value: refLoading ? "Issuing…" : autoRef || "Issued on save", step: null },
  ];

  const renderStep = () => {
    if (current.key === "notice") {
      return (
        <div className="space-y-3">
          <div className="rounded-[10px] border border-ink-100 bg-paper/60 p-4 dark:border-white/[0.07] dark:bg-white/[0.02]">
            <label className="flex cursor-pointer items-start gap-2.5 text-[11.5px] leading-relaxed text-ink-600 dark:text-ink-300">
              <input
                type="checkbox"
                checked={metaConsent}
                onChange={(event) => onMetaConsent(event.target.checked)}
                data-plan-focus=""
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#d92616]"
              />
              <span>
                I authorize the notice&apos;s extracted text to be sent to Meta AI for analysis. The original file is not
                sent by this step.
              </span>
            </label>

            <label
              className={cn(
                "mt-3 inline-flex min-h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-ink-200 bg-white px-3 text-[12px] font-semibold text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700 dark:border-white/15 dark:bg-white/[0.04] dark:text-ink-200 dark:hover:border-brand-400",
                analyzing && "pointer-events-none opacity-60",
              )}
            >
              {analyzing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="h-4 w-4" aria-hidden="true" />
              )}
              {analyzing ? "Reading the notice…" : noticeFile ? "Choose a different notice" : "Choose notice document"}
              <input
                type="file"
                accept=".pdf,.docx,.xlsx,.txt,.md,.csv,.eml"
                className="sr-only"
                disabled={analyzing}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) onPickNotice(file);
                }}
              />
            </label>

            {noticeFile && !noticeUploadMessage ? (
              <p
                role="status"
                className="mt-2 rounded-lg border border-ink-200/70 bg-white/70 px-3 py-2 text-[10.5px] leading-relaxed text-ink-600 dark:border-white/10 dark:bg-black/10 dark:text-ink-300"
              >
                <span className="font-semibold">{noticeFile.name}</span> attaches when you create the record.
              </p>
            ) : null}
            {noticeUploadMessage ? (
              <p
                role="alert"
                className="mt-2 flex items-start gap-2 rounded-lg border border-brand-300/70 bg-brand-50 px-3 py-2 text-[11px] leading-relaxed text-brand-800 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-200"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{noticeUploadMessage}</span>
              </p>
            ) : null}
            {noticeAnalysis.error ? (
              <div
                role="alert"
                className="mt-2 flex items-start gap-2 rounded-lg border border-brand-300/70 bg-brand-50 px-3 py-2 text-[11px] leading-relaxed text-brand-800 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-200"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  {noticeAnalysis.error}
                  {noticeAnalysis.extractionNote ? ` ${noticeAnalysis.extractionNote}` : ""}
                </span>
                {noticeFile && metaConsent ? (
                  <button
                    type="button"
                    onClick={() => onPickNotice(noticeFile)}
                    className="shrink-0 rounded-md border border-brand-300/70 bg-white/70 px-2 py-1 font-code text-[7.5px] font-bold tracking-[0.1em] transition-colors hover:bg-white dark:border-brand-500/30 dark:bg-transparent dark:hover:bg-brand-500/10"
                  >
                    RETRY READ
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {noticeAnalysis.status === "ready" && extracted ? (
            <div
              aria-live="polite"
              className="rounded-[10px] border border-ink-100 bg-white p-3.5 dark:border-white/[0.07] dark:bg-white/[0.025]"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-code text-[8px] font-bold tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
                    READ FROM THE NOTICE · {noticeAnalysis.model ?? "META MODEL"}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-500 dark:text-ink-400">
                    Added to empty answers. Check each one as you go — every value is still yours to change.
                  </p>
                </div>
                {noticeAnalysis.conflicts.length ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-1 font-code text-[7.5px] font-bold tracking-[0.1em] text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                    <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                    {noticeAnalysis.conflicts.length} TO CHECK
                  </span>
                ) : null}
              </div>

              <ul className="mt-3 divide-y divide-ink-100 dark:divide-white/[0.06]">
                {extractedFields.map((field) => {
                  const conflict = noticeAnalysis.conflicts.includes(field.key);
                  const lowConfidence = field.value !== null && field.confidence < 0.75;
                  return (
                    <li key={field.key} className="flex flex-wrap items-start gap-2 py-2 first:pt-0 last:pb-0">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] font-semibold text-ink-800 dark:text-ink-100">{field.label}</span>
                          <span
                            className={cn(
                              "font-code text-[7px] font-bold tracking-[0.1em]",
                              conflict || lowConfidence || field.value === null
                                ? "text-brand-700 dark:text-brand-300"
                                : "text-emerald-700 dark:text-emerald-300",
                            )}
                          >
                            {field.value === null
                              ? "NOT FOUND"
                              : conflict
                                ? "NEEDS YOUR CALL"
                                : lowConfidence
                                  ? "CHECK"
                                  : "ADDED"}
                          </span>
                        </div>
                        <p className="mt-0.5 break-words text-[11px] text-ink-600 dark:text-ink-300">
                          {field.value ?? "No unambiguous value in the document."}
                          {conflict && d[field.key] ? (
                            <span className="text-brand-700 dark:text-brand-300"> · currently “{d[field.key]}”</span>
                          ) : null}
                        </p>
                        {(conflict || lowConfidence) && field.evidence ? (
                          <p className="mt-0.5 line-clamp-2 text-[9.5px] italic leading-relaxed text-ink-400">
                            “{field.evidence}”
                          </p>
                        ) : null}
                      </div>
                      {conflict && field.value ? (
                        <button
                          type="button"
                          onClick={() => onApplyExtracted(field.key, field.applyValue ?? field.value ?? "")}
                          className="shrink-0 rounded-md border border-brand-200 px-2 py-1 font-code text-[7.5px] font-bold tracking-[0.08em] text-brand-700 hover:bg-brand-50 dark:border-brand-500/20 dark:text-brand-300 dark:hover:bg-brand-500/10"
                        >
                          USE NOTICE
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              {notes ? (
                <details className="mt-3 rounded-lg border border-brand-200/70 bg-brand-50/60 dark:border-brand-500/15 dark:bg-brand-500/[0.06]">
                  <summary className="cursor-pointer list-none px-3 py-2 font-code text-[8px] font-bold tracking-[0.14em] text-brand-700 dark:text-brand-300">
                    REVIEW NOTES · {notes}
                  </summary>
                  <ul className="space-y-1 border-t border-brand-200/60 px-3 py-2 text-[10px] leading-relaxed text-ink-600 dark:border-brand-500/15 dark:text-ink-300">
                    {noticeAnalysis.extractionNote ? <li>{noticeAnalysis.extractionNote}</li> : null}
                    {extracted.warnings.map((warning, index) => (
                      <li key={`${index}-${warning}`}>{warning}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    }

    if (current.key === "title") {
      return (
        <div className="max-w-2xl">
          <input
            id="plan-title"
            data-plan-focus=""
            className={`${planInput} py-3.5 text-[15px] sm:py-4 sm:text-base`}
            value={d.pipeTitle ?? ""}
            onChange={(event) => set("pipeTitle", event.target.value)}
            onKeyDown={onFieldKeyDown}
            placeholder="e.g. Supply & delivery of MRI scanners (1.5T)"
            autoComplete="off"
            aria-required="true"
            aria-label="Tender title"
          />
          <p className="mt-2 flex items-start gap-1.5 font-code text-[8px] leading-[1.9] tracking-[0.14em] text-ink-400">
            <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
            {titleFromNotice
              ? "FILLED FROM THE NOTICE — EDIT IT IF THE NOTICE SAYS OTHERWISE."
              : "THIS IS THE TITLE THE MARKET WILL SEE."}
          </p>
        </div>
      );
    }

    if (current.key === "office") {
      return (
        <div className="max-w-2xl">
          <div role="radiogroup" aria-label={current.prompt} className="grid gap-2 sm:grid-cols-2">
            {OFFICES.map((office, index) => {
              const on = d.pipeOffice === office;
              return (
                <button
                  key={office}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  data-plan-focus={on || (!d.pipeOffice && index === 0) ? "" : undefined}
                  onClick={() => {
                    set("pipeOffice", on ? "" : office);
                    setError("");
                  }}
                  className={cn(
                    "rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45",
                    on
                      ? "border-ink-950 bg-ink-950 text-white dark:border-brand-400 dark:bg-brand-500/[0.14] dark:text-brand-200"
                      : "border-ink-200 bg-white text-ink-900 hover:border-ink-400 dark:border-white/[0.1] dark:bg-white/[0.025] dark:text-ink-100 dark:hover:border-white/25",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[12.5px] font-semibold">{OFFICE_LABELS[office]}</span>
                    {on ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
                  </span>
                  <span
                    className={cn(
                      "mt-1 block text-[10.5px] leading-relaxed",
                      on ? "text-white/70 dark:text-brand-200/70" : "text-ink-400",
                    )}
                  >
                    {OFFICE_BLURBS[office]}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 font-code text-[8px] leading-[1.9] tracking-[0.14em] text-ink-400">
            CLICK THE CHOSEN OFFICE AGAIN TO CLEAR IT.
          </p>
        </div>
      );
    }

    if (current.key === "publication") {
      return (
        <div className="max-w-md">
          <input
            id="plan-publication"
            data-plan-focus=""
            type="date"
            className={planInput}
            value={d.pipePub ?? ""}
            onChange={(event) => set("pipePub", event.target.value)}
            onKeyDown={onFieldKeyDown}
            aria-label="Expected publication date"
          />
          <p className="mt-2 font-code text-[8px] leading-[1.9] tracking-[0.14em] text-ink-400">
            {d.pipePub
              ? `${fmtDate(d.pipePub).toUpperCase()} · ${relDays(d.pipePub).toUpperCase()}`
              : "OPTIONAL — THE PACK CAN BE STAGED WITHOUT A DATE."}
          </p>
        </div>
      );
    }

    if (current.key === "budget") {
      return (
        <div className="max-w-md">
          <div className="flex h-11 items-stretch overflow-hidden rounded-xl border border-ink-200/90 bg-[#fffdfb] shadow-[inset_0_1px_1px_rgba(11,12,15,0.03)] transition-[border-color,box-shadow] duration-150 focus-within:border-ink-950 focus-within:ring-[3px] focus-within:ring-ink-950/[0.08] hover:border-ink-300 dark:border-white/[0.13] dark:bg-[#0b0d12] dark:focus-within:border-white/40 dark:focus-within:ring-white/[0.07] dark:hover:border-white/25">
            <div className="relative shrink-0">
              <select
                aria-label="Currency"
                data-plan-focus={d.pipeCur ? undefined : ""}
                value={d.pipeCur ?? ""}
                onChange={(event) => set("pipeCur", event.target.value)}
                className="h-full cursor-pointer appearance-none bg-ink-50/70 pl-3 pr-6 font-code text-[10px] font-bold tracking-[0.1em] text-ink-600 outline-none dark:bg-white/[0.05] dark:text-ink-300 dark:[color-scheme:dark]"
              >
                <option value="">—</option>
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-400"
                aria-hidden="true"
              />
            </div>
            <span className="w-px shrink-0 bg-ink-200/80 dark:bg-white/10" aria-hidden="true" />
            <input
              className="h-full min-w-0 flex-1 bg-transparent px-3 font-code text-[13px] tabular text-ink-900 outline-none placeholder:text-ink-400 dark:text-ink-900"
              type="number"
              min={0}
              inputMode="decimal"
              data-plan-focus={d.pipeCur ? "" : undefined}
              value={d.pipeEst ?? ""}
              onChange={(event) => set("pipeEst", event.target.value)}
              onKeyDown={onFieldKeyDown}
              placeholder="25 000 000"
              aria-label="Budget estimate"
            />
          </div>
          <p className="mt-2 font-code text-[8px] leading-[1.9] tracking-[0.14em] text-ink-400">
            {budget !== null ? `RECORDED AS ${d.pipeCur || "NO CURRENCY"} ${fmtMoney(budget)}` : "OPTIONAL — THE FIGURE CAN BE ADDED LATER."}
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {pendingUploadRef ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-brand-300/70 bg-brand-50 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-brand-800 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-200"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              Tender {pendingUploadRef} is already in the pipeline. The notice did not attach — retry below to add it
              without creating a duplicate.
            </span>
          </p>
        ) : null}

        <dl className="divide-y divide-ink-100 overflow-hidden rounded-[10px] border border-ink-100 dark:divide-white/[0.06] dark:border-white/[0.07]">
          {rows.map((row) => (
            <div key={row.label} className="flex items-start gap-3 px-3.5 py-2.5">
              <dt className="w-[104px] shrink-0 font-code text-[8px] font-bold tracking-[0.14em] text-ink-400">
                {row.label.toUpperCase()}
              </dt>
              <dd className="min-w-0 flex-1 break-words text-[12px] font-medium leading-relaxed text-ink-900 dark:text-ink-100">
                {row.value}
              </dd>
              {row.step !== null ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => go(row.step as number)}
                  className="shrink-0 rounded-md px-1.5 py-0.5 font-code text-[8px] font-bold tracking-[0.12em] text-brand-700 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-brand-300 dark:hover:bg-brand-500/10"
                >
                  EDIT
                </button>
              ) : null}
            </div>
          ))}
        </dl>

        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-400">
          <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
          Planning is free. The entry links to a live tender when its pack lands — the cycle rail then takes over the
          record.
        </p>
      </div>
    );
  };

  return (
    <div ref={rootRef}>
      <div aria-label="Tender intake progress">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="font-code text-[8px] font-bold tracking-[0.18em] text-brand-700 dark:text-brand-300">
            {current.section}
          </span>
          <span className="font-code text-[8px] tracking-[0.14em] text-ink-400">
            {String(step + 1).padStart(2, "0")} / {String(PLAN_STEPS.length).padStart(2, "0")}
          </span>
        </div>
        <div
          className="flex gap-1"
          role="progressbar"
          aria-label="Tender intake progress"
          aria-valuemin={1}
          aria-valuemax={PLAN_STEPS.length}
          aria-valuenow={step + 1}
        >
          {PLAN_STEPS.map((planStep, index) => (
            <span
              key={planStep.key}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                index <= step ? "bg-brand-600 dark:bg-brand-400" : "bg-ink-100 dark:bg-white/10",
              )}
            />
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.section
          key={current.key}
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -18 }}
          transition={{ duration: 0.18, ease: EASE }}
          aria-live="polite"
          className="mt-6 min-h-[210px]"
        >
          <p className="font-code text-[8px] font-semibold tracking-[0.2em] text-ink-400">
            {current.section} · QUESTION {String(step + 1).padStart(2, "0")}
          </p>
          <h4
            tabIndex={-1}
            data-plan-focus={current.key === "review" ? "" : undefined}
            className="mt-2 font-display text-[21px] font-black tracking-[-0.02em] text-ink-950 outline-none dark:text-white sm:text-[25px]"
          >
            {current.prompt}
            {current.required ? (
              <span className="ml-1 text-brand-600 dark:text-brand-400" aria-label="required">
                *
              </span>
            ) : null}
          </h4>
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-500 dark:text-ink-400">{current.hint}</p>
          <div className="mt-5">{renderStep()}</div>
        </motion.section>
      </AnimatePresence>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-brand-800 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-200"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-5 dark:border-white/[0.06]">
        <p className="max-w-[230px] font-code text-[7.5px] leading-[2] tracking-[0.16em] text-ink-400 sm:max-w-none">
          {refLoading ? "ISSUING THE REFERENCE…" : autoRef ? `NEXT REFERENCE ${autoRef}` : "THE REFERENCE IS ISSUED ON SAVE"}
        </p>
        <div className="ml-auto flex items-center gap-2">
          {step > 0 ? (
            <button
              type="button"
              onClick={() => go(step - 1)}
              disabled={busy}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 font-code text-[9px] font-bold tracking-[0.14em] text-ink-600 transition-colors hover:border-ink-950 hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-ink-300 dark:hover:border-white/30 dark:hover:text-white"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              BACK
            </button>
          ) : null}

          {step < last && !current.required ? (
            <button
              type="button"
              onClick={advance}
              disabled={busy}
              className="inline-flex h-10 items-center rounded-xl px-3 font-code text-[8px] font-bold tracking-[0.12em] text-ink-500 transition-colors hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-60 dark:text-ink-400 dark:hover:text-white"
            >
              SKIP
            </button>
          ) : null}

          {step < last ? (
            <button
              type="button"
              onClick={advance}
              disabled={busy}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-600 px-5 font-code text-[9px] font-bold tracking-[0.14em] text-white shadow-[0_10px_26px_rgba(217,38,22,0.28)] transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              CONTINUE
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || analyzing}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-600 px-5 font-code text-[9px] font-bold tracking-[0.14em] text-white shadow-[0_10px_26px_rgba(217,38,22,0.28)] transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : pendingUploadRef ? (
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {busy
                ? "SAVING TENDER…"
                : analyzing
                  ? "READING THE NOTICE…"
                  : pendingUploadRef
                    ? `RETRY NOTICE UPLOAD · ${pendingUploadRef}`
                    : noticeFile
                      ? "CREATE TENDER + ATTACH NOTICE"
                      : "CREATE TENDER"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── small shared pieces defined once, used by the tabs ────────────────────── */

function Badge({ children, tone }: { children: ReactNode; tone?: "alert" }) {
  return (
    <span
      className={cn(
        "inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 font-code text-[7.5px] font-black leading-none",
        tone === "alert" ? "bg-brand-500 text-white dark:bg-brand-400 dark:text-ink-50" : "bg-ink-200 text-ink-700 dark:bg-ink-300 dark:text-ink-50",
      )}
    >
      {children}
    </span>
  );
}

function Dot({ tone }: { tone: "ok" | "alert" }) {
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        tone === "ok" ? "bg-emerald-500" : "bg-brand-500 dark:bg-brand-400",
      )}
      aria-hidden="true"
    />
  );
}

function DeadlineIcon({ kind }: { kind: string }) {
  const k = kind.toUpperCase();
  if (k.includes("MILESTONE")) return <Flag className="h-4 w-4" aria-hidden="true" />;
  if (k.includes("STANDSTILL")) return <Stamp className="h-4 w-4" aria-hidden="true" />;
  if (k.includes("ALB")) return <CircleAlert className="h-4 w-4" aria-hidden="true" />;
  if (k.includes("COMPLAINT")) return <Scale className="h-4 w-4" aria-hidden="true" />;
  return <CalendarClock className="h-4 w-4" aria-hidden="true" />;
}

function PipelineRow({
  p,
  tenders,
  onLink,
  busy,
}: {
  p: PipelineDto;
  tenders: { ref: string; title: string }[];
  onLink: (tenderId: string) => Promise<boolean>;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dialogId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const linked = p.status === "LINKED";
  const pubRel = relDays(p.expectedPublication);
  const pubSoon = (daysUntil(p.expectedPublication) ?? 999) <= 30;
  const close = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => dialogRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) close();
      if (event.key !== "Tab") return;
      const nodes = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [busy, close, open]);

  return (
    <li
      className="group panel-inset relative overflow-hidden rounded-xl px-3.5 py-3 transition-colors duration-150 hover:border-ink-300/80 dark:hover:border-white/[0.14]"
    >
      <span
        className={cn(
          "absolute inset-y-2.5 left-0 w-[2px] rounded-full transition-colors",
          linked ? "bg-emerald-500/70" : pubSoon ? "bg-brand-500/80" : "bg-transparent",
        )}
        aria-hidden="true"
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-code text-[8.5px] font-bold tracking-[0.14em] text-ink-400">{p.ref}</span>
            {!linked && p.expectedPublication ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-1.5 py-[2px] font-code text-[7px] font-bold tracking-[0.1em]",
                  pubSoon
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                    : "bg-ink-100/70 text-ink-500 dark:bg-white/[0.05] dark:text-ink-400",
                )}
              >
                <CalendarClock className="h-2.5 w-2.5" aria-hidden="true" /> {pubRel.toUpperCase()}
              </span>
            ) : null}
            {linked ? <Chip tone="ok">LINKED</Chip> : null}
          </div>
          <p className="mt-1.5 truncate text-[13px] font-semibold leading-tight text-ink-900">{p.title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-code text-[8px] tracking-[0.1em] text-ink-400">
            {p.office ? <span className="text-ink-500">{OFFICE_LABELS[p.office] ?? p.office}</span> : null}
            {p.expectedPublication ? <span>PUB {fmtDate(p.expectedPublication)}</span> : null}
            {p.budgetEstimate ? (
              <span className="tabular font-semibold text-ink-600">
                {p.currency ?? ""} {fmtMoney(p.budgetEstimate)}
              </span>
            ) : null}
            {linked && p.linkedTenderId ? (
              <span className="text-emerald-600 dark:text-emerald-400">{p.linkedTenderId}</span>
            ) : null}
          </div>
        </div>
        {!linked ? (
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={`link-dialog-${dialogId}`}
            disabled={busy}
            aria-label={`Link ${p.ref} to a live tender`}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-ink-200/90 bg-[#fffdfb] px-2.5 font-code text-[9px] font-bold tracking-[0.1em] text-ink-600 shadow-[0_1px_2px_rgba(11,12,15,0.03)] transition-colors hover:border-ink-950 hover:text-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-ink-300 dark:hover:border-white/30 dark:hover:text-white"
          >
            LINK <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence initial={false}>
              {open && !linked ? (
                <motion.div
                  key={`cycle-link-${dialogId}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[90] grid place-items-center bg-night/70 p-3 backdrop-blur-sm sm:p-5"
                  onMouseDown={(event) => {
                    if (event.target === event.currentTarget && !busy) close();
                  }}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby={`link-dialog-${dialogId}`}
                >
                  <motion.div
                    ref={dialogRef}
                    tabIndex={-1}
                    initial={{ opacity: 0, y: 18, scale: 0.985 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 12, scale: 0.99 }}
                    transition={{ duration: 0.28, ease: EASE }}
                    className="panel panel-lift flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-[12px] outline-none"
                  >
                    <header className="flex shrink-0 items-start justify-between gap-4 border-b border-ink-100 px-5 py-4 dark:border-white/[0.06] sm:px-7 sm:py-5">
                      <div className="min-w-0">
                        <p className="font-code text-[8.5px] font-bold tracking-[0.2em] text-brand-700 dark:text-brand-300">TENDER CYCLE · PIPELINE</p>
                        <h3 id={`link-dialog-${dialogId}`} className="mt-1 font-display text-[20px] font-black tracking-[-0.02em] text-ink-950 dark:text-white sm:text-[22px]">Link {p.ref} to a live tender</h3>
                        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-500 dark:text-ink-400">{p.title}</p>
                      </div>
                      <button
                        type="button"
                        onClick={close}
                        disabled={busy}
                        aria-label={`Close link workflow for ${p.ref}`}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/[0.06] dark:hover:text-white"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </header>
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-7 sm:py-5">
                      <p className="mb-3 eyebrow text-[8px] tracking-[0.2em]">Choose the live tender record</p>
                      {tenders.length ? (
                        <ul role="listbox" aria-label={`Link ${p.ref} to a live tender`} className="space-y-2">
                          {tenders.map((t) => (
                            <li key={t.ref}>
                              <button
                                type="button"
                                role="option"
                                aria-selected={false}
                                disabled={busy}
                                onClick={() => {
                                  void onLink(t.ref).then((ok) => {
                                    if (ok) close();
                                  });
                                }}
                                className="flex w-full items-center gap-3 rounded-xl border border-ink-200/80 bg-white px-3.5 py-3 text-left transition-colors hover:border-brand-400 hover:bg-brand-50/40 disabled:cursor-wait disabled:opacity-60 dark:border-white/[0.1] dark:bg-white/[0.025] dark:hover:border-brand-400 dark:hover:bg-brand-500/[0.06]"
                              >
                                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink-100/70 text-ink-500 dark:bg-white/[0.06]">
                                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block font-code text-[9px] font-bold tracking-[0.08em] text-ink-900 dark:text-white">{t.ref}</span>
                                  <span className="mt-0.5 block truncate text-[11px] text-ink-500 dark:text-ink-400">{t.title}</span>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="rounded-xl border border-dashed border-ink-200 px-4 py-8 text-center text-[12px] text-ink-500 dark:border-white/[0.12] dark:text-ink-400">
                          No live tenders are available to link yet.
                        </p>
                      )}
                    </div>
                  </motion.div>
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </li>
  );
}
