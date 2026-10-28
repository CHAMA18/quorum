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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  CalendarClock,
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  FileSignature,
  Flag,
  Play,
  Plus,
  Scale,
  Search,
  Stamp,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StoredDocsBrowser } from "@/components/quorum/stored-docs-browser";

const SVC = "?XTransformPort=3031";
const EASE = [0.22, 1, 0.36, 1] as const;

const OFFICES = ["PROCUREMENT_UNIT", "EVALUATION_COMMITTEE", "ACCOUNTING_OFFICER", "OVERSIGHT"] as const;
const OFFICE_LABELS: Record<string, string> = {
  PROCUREMENT_UNIT: "Procurement unit",
  EVALUATION_COMMITTEE: "Evaluation committee",
  ACCOUNTING_OFFICER: "Accounting officer",
  OVERSIGHT: "Oversight / audit",
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
};

function deriveStages(c: CycleDto | null): { stages: Stage[]; doneCount: number; currentIndex: number } {
  const raw: { key: string; label: string; tab: CycleTab; done: boolean; caption: string }[] = [
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
      caption: c?.opening?.certifiedAt ? "register certified" : c?.opening ? "awaiting certification gate" : "public bid opening",
    },
    {
      key: "evaluation",
      label: "Evaluation",
      tab: "evaluation",
      done: !!c?.matrix?.certifiedBy,
      caption: c?.matrix?.certifiedBy ? "matrix certified" : c?.matrix ? "matrix in draft" : "matrix · MED · COI",
    },
    {
      key: "award",
      label: "Award",
      tab: "award",
      done: !!c?.awardReport?.signedAt,
      caption: c?.awardReport?.signedAt ? "report signed" : c?.awardReport ? "awaiting the gavel" : "report at the gate",
    },
    {
      key: "standstill",
      label: "Standstill",
      tab: "award",
      done: !!c?.standstill && c.standstill.status !== "ACTIVE",
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
  const stages: Stage[] = raw.map((s) => ({ key: s.key, label: s.label, tab: s.tab, caption: s.caption, state: "todo" as StageState }));
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

function PlanField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
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

function Card({ title, sub, right, children }: { title: string; sub?: string; right?: ReactNode; children: ReactNode }) {
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
      <div className="flex-1 border-t border-ink-100/80 px-5 pb-5 pt-4 dark:border-white/[0.055]">{children}</div>
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
    { label: "Ahead", dot: "bg-ink-200 dark:bg-white/20" },
  ];
  return (
    <div className="flex items-center gap-3.5">
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
          <span className="h-[3px] w-14 overflow-hidden rounded-full bg-ink-100 dark:bg-white/10" aria-hidden="true">
            <motion.span
              className="block h-full rounded-full bg-brand-500"
              initial={false}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.6, ease: EASE }}
            />
          </span>
          <span className="tabular font-code text-[8.5px] font-bold tracking-[0.14em] text-ink-500">
            {pct}% complete
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
          return (
            <li key={s.key} className="min-w-0">
              <button
                type="button"
                onClick={() => document.getElementById(`cycle-tab-${s.tab}`)?.click()}
                aria-current={isCurrent ? "step" : undefined}
                aria-label={`${s.label} — ${done ? "complete" : isCurrent ? "current stage" : "upcoming"}. Open the ${s.tab} tab.`}
                className="group block w-full min-w-0 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-4 focus-visible:ring-offset-[#fffdfb] dark:focus-visible:ring-offset-[#111318]"
              >
                {/* The meter: one segment per stage, so progress is read at a glance. */}
                <span
                  className={cn(
                    "relative block h-[3px] w-full overflow-hidden rounded-full transition-colors",
                    done && "bg-emerald-500/85",
                    isCurrent && "bg-brand-500/20",
                    !done && !isCurrent && "bg-ink-100 group-hover:bg-ink-200 dark:bg-white/[0.09] dark:group-hover:bg-white/[0.16]",
                  )}
                  aria-hidden="true"
                >
                  {isCurrent ? (
                    <motion.span
                      className="absolute inset-y-0 left-0 rounded-full bg-brand-500 shadow-[0_0_12px_rgba(232,56,42,0.55)]"
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
                      isCurrent && "animate-gate-breathe border-brand-600 bg-brand-600 text-white",
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
                    isCurrent ? "text-ink-600 dark:text-ink-500" : "text-ink-400 dark:text-ink-400",
                  )}
                  title={s.caption}
                >
                  {s.caption}
                </span>
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
}: {
  tenders: { ref: string; title: string }[];
  value: string;
  cycles: CycleDto[];
  onSelect: (ref: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  useOutside(boxRef, () => setOpen(false), open);

  const current = tenders.find((t) => t.ref === currentRef);
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

  const p = progressOf(currentRef);

  return (
    <div
      ref={boxRef}
      className="relative w-full"
      onKeyDown={(e) => {
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
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Tender: ${current ? `${current.ref} — ${current.title}` : "select a tender"}`}
        className={cn(
          "panel-inset group flex w-full items-center gap-3.5 rounded-[10px] px-3.5 py-3 text-left transition-[border-color,background-color] duration-200",
          "hover:border-ink-300 dark:hover:border-white/20",
          open && "border-ink-950 ring-4 ring-ink-950/[0.06] dark:border-white/40 dark:ring-white/[0.05]",
        )}
      >
        <ProgressRing pct={p.pct} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 eyebrow text-[8px] tracking-[0.24em]">
            Working dossier
            {current ? (
              <span className="hidden items-center gap-1 rounded-full bg-ink-950/[0.055] px-1.5 py-0.5 text-[7px] tracking-[0.12em] text-ink-500 sm:inline-flex dark:bg-white/[0.07] dark:text-ink-400">
                {p.stage}
              </span>
            ) : null}
          </span>
          <span className="mt-1.5 flex min-w-0 items-baseline gap-2.5">
            <span className="shrink-0 font-code text-[11.5px] font-bold tracking-[0.08em] text-ink-950">
              {current ? current.ref : "—"}
            </span>
            <span className="truncate text-[12px] leading-tight text-ink-500">
              {current?.title ?? "No tender staged on the desk yet"}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="hidden font-code text-[8px] font-bold tracking-[0.16em] text-ink-400 sm:block">
            {tenders.length} ON DESK
          </span>
          <span className="grid h-7 w-7 place-items-center rounded-lg border border-ink-200/70 text-ink-500 transition-colors group-hover:border-ink-300 group-hover:text-ink-900 dark:border-white/10 dark:group-hover:border-white/25 dark:group-hover:text-white">
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", open && "rotate-180")} aria-hidden="true" />
          </span>
        </span>
      </button>

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
  /* When the desk last heard from quorum-mcp — shown in the header, so the
     officer can tell a stale screen from a live one at a glance. */
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  /* Draft inputs, one record shared across the tab forms. */
  const [d, setD] = useState<Record<string, string>>({});
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
  const set = (k: string, v: string) => setD((p) => ({ ...p, [k]: v }));

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
      setSyncedAt(new Date());
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

  const refreshCycle = () => void pull();

  /* ── Tab: pipeline (G17) ─────────────────────────────────────────────────── */

  const planned = pipeline.filter((p) => p.status !== "LINKED");
  const estimates = pipeline.filter((p) => p.budgetEstimate);
  const sameCur = estimates.length && estimates.every((p) => (p.currency ?? "") === (estimates[0].currency ?? ""));
  const combined = sameCur ? estimates.reduce((s, p) => s + (p.budgetEstimate ?? 0), 0) : 0;
  const CURRENCIES = ["ZMW", "KES", "USD", "RWF"];

  const PipelineTab = (
    <div className="grid gap-4 xl:gap-5">
      <Card title="Plan a tender" sub="PRE-STAGES THE DESK — A PACK BEFORE ADVERTISEMENT">
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <PlanField label="Reference" hint="SYSTEM-GENERATED">
              <div className="relative">
                <input
                  className={cn(planInput, "cursor-default bg-ink-50/60 pr-16 font-code tracking-[0.06em] text-ink-700 dark:bg-white/[0.025] dark:text-ink-300")}
                  value={refLoading ? "Issuing…" : autoRef || "Issued on save"}
                  readOnly
                  aria-readonly="true"
                  autoComplete="off"
                  spellCheck={false}
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-full border border-ink-200/70 bg-white/80 px-1.5 py-0.5 font-code text-[7px] font-bold tracking-[0.14em] text-ink-400 dark:border-white/10 dark:bg-white/[0.05] dark:text-ink-400">
                  <span className="h-1 w-1 rounded-full bg-brand-500" aria-hidden="true" /> AUTO
                </span>
              </div>
            </PlanField>
            <PlanField label="Publication">
              <input
                className={planInput}
                type="date"
                value={d.pipePub ?? ""}
                onChange={(e) => set("pipePub", e.target.value)}
              />
            </PlanField>
          </div>

          <PlanField label="Title" hint="WHAT THE MARKET WILL SEE">
            <input
              className={planInput}
              value={d.pipeTitle ?? ""}
              onChange={(e) => set("pipeTitle", e.target.value)}
              placeholder="Supply of iodised salt — provincial depots"
              autoComplete="off"
            />
          </PlanField>

          <div className="grid gap-4 sm:grid-cols-2">
            <PlanField label="Responsible office">
              <div className="relative">
                <select
                  className={cn(planInput, "cursor-pointer appearance-none pr-9")}
                  value={d.pipeOffice ?? ""}
                  onChange={(e) => set("pipeOffice", e.target.value)}
                >
                  <option value="">Select an office</option>
                  {OFFICES.map((o) => (
                    <option key={o} value={o}>
                      {OFFICE_LABELS[o]}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
                  aria-hidden="true"
                />
              </div>
            </PlanField>

            {/* Currency and amount are one value, so they share one field. */}
            <PlanField label="Budget estimate" hint="OPTIONAL">
              <div className="flex h-11 items-stretch overflow-hidden rounded-xl border border-ink-200/90 bg-[#fffdfb] shadow-[inset_0_1px_1px_rgba(11,12,15,0.03)] transition-[border-color,box-shadow] duration-150 focus-within:border-ink-950 focus-within:ring-[3px] focus-within:ring-ink-950/[0.08] hover:border-ink-300 dark:border-white/[0.13] dark:bg-[#0b0d12] dark:focus-within:border-white/40 dark:focus-within:ring-white/[0.07] dark:hover:border-white/25">
                <div className="relative shrink-0">
                  <select
                    aria-label="Currency"
                    value={d.pipeCur ?? ""}
                    onChange={(e) => set("pipeCur", e.target.value)}
                    className="h-full cursor-pointer appearance-none bg-ink-50/70 pl-3 pr-6 font-code text-[10px] font-bold tracking-[0.1em] text-ink-600 outline-none dark:bg-white/[0.05] dark:text-ink-300 dark:[color-scheme:dark]"
                  >
                    <option value="">—</option>
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
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
                  value={d.pipeEst ?? ""}
                  onChange={(e) => set("pipeEst", e.target.value)}
                  placeholder="25 000 000"
                  aria-label="Budget estimate"
                />
              </div>
            </PlanField>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-ink-100/80 bg-ink-50/50 px-3 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.025]">
            <span className="eyebrow text-[7.5px] tracking-[0.2em]">Budget on the record</span>
            <span className="truncate font-code text-[11px] font-bold tabular tracking-[0.06em] text-ink-800">
              {d.pipeEst && Number.isFinite(Number(d.pipeEst))
                ? `${d.pipeCur || "—"} ${fmtMoney(Number(d.pipeEst))}`
                : "—"}
            </span>
          </div>

          <button
            type="button"
            disabled={busy || !d.pipeTitle}
            onClick={() =>
              act(
                "/api/pipeline",
                {
                  title: d.pipeTitle,
                  office: d.pipeOffice || undefined,
                  budgetEstimate: Number(d.pipeEst) || undefined,
                  currency: d.pipeCur || undefined,
                  expectedPublication: d.pipePub || undefined,
                },
                "PIPELINE ENTRY ADDED",
              ).then((ok) => {
                if (!ok) return;
                setD((p) => ({ ...p, pipeTitle: "", pipeEst: "", pipePub: "" }));
                void refreshNextRef();
              })
            }
            className="group relative mt-0.5 inline-flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-brand-600 text-[13.5px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_14px_30px_-16px_rgba(217,38,22,0.85)] transition-[background-color,box-shadow,transform] duration-200 hover:bg-brand-500 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_18px_36px_-16px_rgba(217,38,22,0.95)] active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffdfb] disabled:cursor-not-allowed disabled:bg-ink-100 disabled:text-ink-400 disabled:shadow-none disabled:active:scale-100 dark:focus-visible:ring-offset-[#111318] dark:disabled:bg-white/[0.06] dark:disabled:text-ink-500"
          >
            <Plus className="relative h-4 w-4" aria-hidden="true" />
            <span className="relative">Add to pipeline</span>
            <ArrowRight
              className="relative h-4 w-4 transition-transform duration-200 group-hover:translate-x-1"
              aria-hidden="true"
            />
          </button>

          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-400">
            <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
            Planning is free. The entry links to a live tender when its pack lands — the cycle rail then takes
            over the record.
          </p>
        </div>
      </Card>

      <Card
        title="Pipeline"
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
      <Card title="Closing date on record" sub="THE OFFICER'S ENTRY WINS; THE NOTICE'S DATE IS THE FALLBACK">
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

      <Card title="Record the public bid opening" sub="LATE BIDS ARE REJECTED UNOPENED — THE REGISTER GOES TO THE PROCUREMENT UNIT'S GATE">
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
      <Card title="Conflict-of-interest declarations" sub="EVERY PRESENT MEMBER DECLARES BEFORE THE MATRIX IS CERTIFIED — THE GATE ENFORCES IT">
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
        <Card title={`Evaluation matrix ${cycle.matrix.id}`} sub={`${cycle.matrix.status} · TECHNICAL ${cycle.matrix.technicalWeightPct}/FINANCIAL ${100 - cycle.matrix.technicalWeightPct}${cycle.matrix.certifiedBy ? ` · CERTIFIED BY ${cycle.matrix.certifiedBy.toUpperCase()}` : ""}`}>
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
        <Card title="Build the evaluation matrix" sub="CRITERIA WEIGHTS MUST SUM TO 100 — THE VALIDATOR REFUSES ANYTHING ELSE">
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
      <Card title="Award recommendation report" sub="THE STATUTORY REPORT — FINDINGS, MATRIX, RECOMMENDATION, SIGNATURES">
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

      <Card title="Notice of award + standstill" sub={`PUBLICATION (SIMULATED PORTAL) STARTS THE ${10}-WORKING-DAY STANDSTILL`}>
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

      <Card title="Debrief letters" sub="QUALITATIVE DEBRIEFS FOR EVERY UNSUCCESSFUL BIDDER — DRAFTED FROM THEIR OWN RECORD">
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

      <Card title="Clarifications & addenda" sub="EVERY ANSWER GOES TO EVERY BIDDER — AN ADDENDUM INSIDE 7 DAYS MUST MOVE THE CLOSING">
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
        <Card title={`Contract — ${cycle.contract.supplier}`} sub={`${cycle.contract.currency ?? ""} ${fmtMoney(cycle.contract.value)}${cycle.contract.completedAt ? " · COMPLETED" : " · ACTIVE"}`}>
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

        <Card title="Milestones" sub={`${cycle.contract.milestones.length} ON THE SCHEDULE`}>
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

        <Card title="Variations" sub={`THE GATE BITES AT ${10}%+ OF CONTRACT VALUE`}>
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

        <Card title="Payments" sub="CERTIFY BEFORE IT LEAVES THE DESK">
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
      <Card title="Prepare the contract pack" sub="OPENS AFTER THE AWARD REPORT IS SIGNED AND THE STANDSTILL HAS LAPSED">
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
      <Card title="Log a complaint" sub="STANDSTILL-WINDOW COMPLAINTS ARE MARKED AS SUCH">
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

      <Card title="Complaints on this tender" sub="RESPONSES ARE DRAFTED, SIGNED AT A GATE, THEN ISSUE">
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

  const ANALYTICS_LABELS: Record<string, string> = {
    tendersStaged: "Tenders staged",
    packsFlagged: "Packs flagged",
    findingsRaised: "Findings raised",
    gatesRaised: "Gates raised",
    gatesExecuted: "Gates executed",
    procurementFiles: "Procurement files",
    runs: "Runs",
    toolCalls: "Tool calls",
  };
  const prettyKey = (k: string) => ANALYTICS_LABELS[k] ?? k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

  const AnalyticsTab = (
    <div className="grid gap-4">
      <Card title="Desk analytics" sub="READ-SIDE ONLY — COMPUTED FROM THE APPEND-ONLY LOGS, ZERO NEW INSTRUMENTATION">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {analytics
            ? Object.entries(analytics).map(([k, v]) => (
                <div key={k} className="rounded-xl border border-ink-100 bg-paper px-3 py-3 transition-shadow hover:shadow-md hover:shadow-ink-950/5">
                  <p className="font-display text-[22px] font-black leading-tight text-ink-950 tabular">{String(v)}</p>
                  <p className="mt-1 font-code text-[7.5px] tracking-[0.16em] text-ink-400">{prettyKey(k).toUpperCase()}</p>
                </div>
              ))
            : null}
        </div>
      </Card>
      <StoredDocsBrowser
        tenderRef={ref}
        canDelete={canDeleteDocuments}
        title="STORED TENDER DOCUMENTS"
      />
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
        className="panel relative flex h-full flex-col overflow-hidden rounded-[16px]"
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
                Tender cycle<span className="text-brand-600 dark:text-brand-400">.</span>
              </h2>
              <p className="mt-2 max-w-[62ch] text-[12.5px] leading-relaxed text-ink-500">
                One desk, the whole cycle — every irreversible step stops at a named human gate.
              </p>
            </div>
            <div className="hidden shrink-0 items-center pt-0.5 sm:flex">
              <StageLegend />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-4">
            <div className="min-w-0 flex-1 xl:max-w-[760px]">
              <TenderPicker tenders={tenders} value={ref} cycles={cycles} onSelect={setRef} />
            </div>
            <div className="ml-auto hidden shrink-0 items-center gap-2.5 xl:flex" aria-live="polite">
              <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-emerald-500" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              <span className="font-code text-[8px] font-bold tracking-[0.16em] text-ink-400">
                {syncedAt
                  ? `SYNCED ${syncedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · 5s POLL`
                  : "CONNECTING TO THE DESK"}
              </span>
            </div>
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
                <div className="panel flex flex-col items-center rounded-[12px] px-6 py-12 text-center">
                  <span className="grid h-11 w-11 place-items-center rounded-full border border-dashed border-ink-300 text-ink-400 dark:border-white/[0.18]">
                    <Workflow className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <p className="mt-3.5 text-[13.5px] font-semibold text-ink-800">
                    {ref ? "No cycle record for this tender yet" : "No tender selected"}
                  </p>
                  <p className="mt-1.5 max-w-[44ch] text-[12px] leading-relaxed text-ink-500">
                    {ref
                      ? "Plan the pack in the pipeline — the opening, evaluation and award tabs open as the desk records each step."
                      : "Pick a tender above. Its stage, its vitals and its file appear here."}
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
  busy,
  onLink,
}: {
  p: PipelineDto;
  tenders: { ref: string; title: string }[];
  busy: boolean;
  onLink: (tenderId: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLLIElement>(null);
  useOutside(boxRef, () => setOpen(false), open);
  const linked = p.status === "LINKED";
  const pubRel = relDays(p.expectedPublication);
  const pubSoon = (daysUntil(p.expectedPublication) ?? 999) <= 30;

  return (
    <li
      ref={boxRef}
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
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={`link-menu-${p.id}`}
            aria-label={`Link ${p.ref} to a live tender`}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-ink-200/90 bg-[#fffdfb] px-2.5 font-code text-[9px] font-bold tracking-[0.1em] text-ink-600 shadow-[0_1px_2px_rgba(11,12,15,0.03)] transition-colors hover:border-ink-950 hover:text-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-ink-300 dark:hover:border-white/30 dark:hover:text-white"
          >
            LINK <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {/* The picker expands in place — never a floating layer that the card
          could clip, and never a click that lands outside its own row. */}
      <AnimatePresence initial={false}>
        {open && !linked ? (
          <motion.div
            id={`link-menu-${p.id}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="mt-3 border-t border-ink-100/90 pt-2.5 dark:border-white/[0.07]">
              <p className="px-1 pb-1.5 eyebrow text-[7.5px] tracking-[0.2em]">Link to a live tender</p>
              <ul role="listbox" aria-label={`Link ${p.ref} to a live tender`} className="max-h-44 space-y-px overflow-y-auto pr-0.5">
                {tenders.map((t) => (
                  <li key={t.ref}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => {
                        setOpen(false);
                        void onLink(t.ref);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-ink-950/[0.04] dark:hover:bg-white/[0.06]"
                    >
                      <span className="font-code text-[9.5px] font-bold tracking-[0.04em] text-ink-900">{t.ref}</span>
                      <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink-500">{t.title}</span>
                    </button>
                  </li>
                ))}
                {tenders.length === 0 ? (
                  <li className="px-2 py-3 text-center text-[11px] text-ink-400">No tenders to link yet.</li>
                ) : null}
              </ul>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </li>
  );
}
