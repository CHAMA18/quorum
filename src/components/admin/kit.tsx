"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, Copy, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The control room's instrument kit.
 *
 * Small, shared pieces of the admin console: panels, status chips, readouts,
 * the signal chart and the one modal shape. Everything is token-driven so the
 * console inherits Quorum's light and dark lamps without a second palette.
 */

/* ── Formatting ─────────────────────────────────────────────────────────── */

export function fmtStamp(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDay(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtClock(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtAgo(value: string | null | undefined, now: number): string {
  if (!value) return "—";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function fmtNum(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-GB");
}

export function shortHash(value: string | null | undefined, length = 10): string {
  if (!value) return "—";
  return value.length <= length ? value : `${value.slice(0, length)}…`;
}

export function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "Q"
  );
}

export function hostOf(url: string | null | undefined): string {
  if (!url) return "—";
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] || url;
  }
}

export function minutesSince(value: string | null | undefined, now: number): number {
  if (!value) return 0;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.round((now - then) / 60_000));
}

export function bytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** exp).toFixed(exp === 0 ? 0 : 1)} ${units[exp]}`;
}

/* ── Tone ───────────────────────────────────────────────────────────────── */

export type Tone = "neutral" | "brand" | "emerald" | "amber" | "sky" | "red" | "violet";

export const TONE: Record<Tone, string> = {
  neutral:
    "border-ink-200 bg-ink-50 text-ink-600 dark:border-white/12 dark:bg-white/[0.05] dark:text-ink-300",
  brand:
    "border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-500/35 dark:bg-brand-500/10 dark:text-brand-300",
  emerald:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  amber:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
  sky: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300",
  red: "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
  violet:
    "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300",
};

export const DOT: Record<Tone, string> = {
  neutral: "bg-ink-400",
  brand: "bg-brand-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  sky: "bg-sky-500",
  red: "bg-red-500",
  violet: "bg-violet-500",
};

export function Dot({ tone = "neutral", pulse = false }: { tone?: Tone; pulse?: boolean }) {
  return (
    <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
      {pulse && (
        <span className={cn("absolute inline-flex h-full w-full animate-ping-slow rounded-full opacity-70", DOT[tone])} />
      )}
      <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", DOT[tone])} />
    </span>
  );
}

export function Chip({
  tone = "neutral",
  children,
  className,
  dot = false,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-code text-[8px] font-bold uppercase tracking-[0.16em]",
        TONE[tone],
        className,
      )}
    >
      {dot && <Dot tone={tone} />}
      {children}
    </span>
  );
}

/* ── Surfaces ───────────────────────────────────────────────────────────── */

export function Panel({
  children,
  className,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return <Tag className={cn("panel overflow-hidden rounded-2xl", className)}>{children}</Tag>;
}

export function PanelHead({
  eyebrow,
  title,
  description,
  action,
  icon,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4 dark:border-white/8",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p className="font-code text-[8px] font-semibold uppercase tracking-[0.24em] text-ink-400">
            {eyebrow}
          </p>
        )}
        <h2 className="mt-1 flex items-center gap-2 font-display text-[16.5px] font-black tracking-[-0.02em] text-ink-950">
          {icon}
          {title}
        </h2>
        {description && (
          <p className="mt-1 max-w-[62ch] text-[11.5px] leading-relaxed text-ink-500">{description}</p>
        )}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

export function SectionHead({
  index,
  eyebrow,
  title,
  lede,
  actions,
  aside,
}: {
  index: string;
  eyebrow: string;
  title: ReactNode;
  lede: ReactNode;
  actions?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <span className="font-code text-[9px] font-bold tracking-[0.2em] text-brand-600">{index}</span>
          <span className="h-px w-8 bg-brand-600/40" aria-hidden="true" />
          <span className="font-code text-[8.5px] font-semibold uppercase tracking-[0.24em] text-ink-400">
            {eyebrow}
          </span>
        </div>
        <h1 className="type-display mt-3 text-[30px] text-ink-950 sm:text-[38px]">{title}</h1>
        <p className="type-lede mt-3 max-w-[68ch] text-[13.5px] text-ink-600">{lede}</p>
      </div>
      {(actions || aside) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {aside}
          {actions}
        </div>
      )}
    </div>
  );
}

/* ── Controls ───────────────────────────────────────────────────────────── */

export const inputCls =
  "h-9 rounded-lg border border-ink-200 bg-white px-3 text-[12.5px] text-ink-950 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-500 dark:border-white/12 dark:bg-white/[0.04] dark:text-ink-900 dark:placeholder:text-ink-500 dark:focus:border-white/30";

export const selectCls =
  "h-9 rounded-lg border border-ink-200 bg-white px-2.5 font-code text-[9px] font-bold uppercase tracking-[0.12em] text-ink-700 outline-none transition-colors focus:border-ink-500 dark:border-white/12 dark:bg-white/[0.04] dark:text-ink-300 dark:focus:border-white/30";

export function Button({
  children,
  onClick,
  variant = "outline",
  size = "md",
  disabled,
  title,
  type = "button",
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "outline" | "solid" | "brand" | "danger" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
  className?: string;
}) {
  const variants: Record<NonNullable<typeof variant>, string> = {
    outline:
      "border border-ink-200 bg-white text-ink-700 hover:border-ink-400 hover:text-ink-950 dark:border-white/12 dark:bg-white/[0.04] dark:text-ink-300 dark:hover:border-white/25 dark:hover:text-white",
    solid:
      "border border-ink-950 bg-ink-950 text-white hover:bg-ink-800 dark:border-white/15 dark:bg-white dark:text-ink-950 dark:hover:bg-ink-100",
    brand:
      "border border-brand-700 bg-brand-600 text-white hover:bg-brand-700 dark:border-brand-500/50 dark:bg-brand-600 dark:hover:bg-brand-700",
    danger:
      "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20",
    ghost:
      "border border-transparent text-ink-500 hover:bg-ink-50 hover:text-ink-950 dark:text-ink-400 dark:hover:bg-white/[0.06] dark:hover:text-white",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "focus-brand inline-flex items-center justify-center gap-1.5 rounded-lg font-code font-bold uppercase tracking-[0.14em] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "h-7 px-2.5 text-[8px]" : "h-9 px-3.5 text-[9px]",
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={`${copied ? "Copied" : label}: ${value}`}
      className={cn(
        "focus-brand inline-flex h-6 items-center gap-1 rounded-md border border-ink-200 bg-white px-1.5 font-code text-[7.5px] font-bold uppercase tracking-[0.12em] text-ink-500 transition-colors hover:border-ink-400 hover:text-ink-950 dark:border-white/12 dark:bg-white/[0.04] dark:text-ink-400 dark:hover:border-white/25 dark:hover:text-white",
        className,
      )}
    >
      {copied ? <Check className="h-2.5 w-2.5 text-emerald-600" aria-hidden="true" /> : <Copy className="h-2.5 w-2.5" aria-hidden="true" />}
      {copied ? "COPIED" : label.toUpperCase()}
    </button>
  );
}

/* ── Metrics ────────────────────────────────────────────────────────────── */

export function Metric({
  label,
  value,
  note,
  tone = "neutral",
  icon,
  footer,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="panel group relative overflow-hidden rounded-2xl px-4 py-4">
      <span className={cn("absolute inset-x-0 top-0 h-px bg-gradient-to-r", {
        neutral: "from-transparent via-ink-300/60 to-transparent",
        brand: "from-transparent via-brand-500/70 to-transparent",
        emerald: "from-transparent via-emerald-500/70 to-transparent",
        amber: "from-transparent via-amber-500/70 to-transparent",
        sky: "from-transparent via-sky-500/70 to-transparent",
        red: "from-transparent via-red-500/70 to-transparent",
        violet: "from-transparent via-violet-500/70 to-transparent",
      }[tone])} aria-hidden="true" />
      <div className="flex items-start justify-between gap-2">
        <p className="font-code text-[7.5px] font-bold uppercase tracking-[0.22em] text-ink-400">{label}</p>
        {icon && <span className="text-ink-300">{icon}</span>}
      </div>
      <p className="type-num mt-2.5 text-[34px] text-ink-950">{value}</p>
      {note && <div className="mt-1.5 text-[10.5px] leading-relaxed text-ink-500">{note}</div>}
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  );
}

export function Readout({
  label,
  value,
  tone = "neutral",
  pulse = false,
  detail,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  pulse?: boolean;
  detail?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-ink-200/80 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
      <Dot tone={tone} pulse={pulse} />
      <div className="min-w-0">
        <p className="font-code text-[7px] font-bold uppercase tracking-[0.2em] text-ink-400">{label}</p>
        <p className="truncate font-code text-[10px] font-bold tracking-[0.06em] text-ink-900">{value}</p>
        {detail && <p className="truncate text-[9.5px] text-ink-400">{detail}</p>}
      </div>
    </div>
  );
}

/* ── Charts ─────────────────────────────────────────────────────────────── */

export type DayPoint = { key: string; label: string; read: number; write: number; gate: number; error: number };

export function DayBars({ points }: { points: DayPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.read + p.write + p.gate + p.error));
  const total = points.reduce((sum, p) => sum + p.read + p.write + p.gate + p.error, 0);
  return (
    <div>
      <div className="flex items-end gap-1.5 sm:gap-2" style={{ height: 140 }} role="img" aria-label={`${total} recorded calls over the last ${points.length} days`}>
        {points.map((point) => {
          const rows = [
            { key: "gate", value: point.gate, color: "bg-brand-600" },
            { key: "write", value: point.write, color: "bg-amber-500" },
            { key: "error", value: point.error, color: "bg-red-500" },
            { key: "read", value: point.read, color: "bg-sky-500/70" },
          ];
          return (
            <div key={point.key} className="group relative flex h-full flex-1 flex-col justify-end gap-[2px]">
              {rows.map((row) =>
                row.value > 0 ? (
                  <div
                    key={row.key}
                    className={cn("w-full rounded-[2px] transition-opacity group-hover:opacity-100", row.color)}
                    style={{ height: `${Math.max(2, (row.value / max) * 100)}%` }}
                  />
                ) : null,
              )}
              {total === 0 && <div className="h-[2px] w-full rounded bg-ink-200 dark:bg-white/10" />}
              <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-[124px] -translate-x-1/2 rounded-lg border border-ink-200 bg-white px-2.5 py-2 shadow-xl group-hover:block dark:border-white/15 dark:bg-ink-950">
                <p className="font-code text-[7.5px] font-bold uppercase tracking-[0.16em] text-ink-400">{point.label}</p>
                <p className="mt-1 font-code text-[9px] text-ink-900">{point.read + point.write + point.gate + point.error} calls</p>
                <p className="text-[9px] text-ink-500">
                  {point.read} read · {point.write} write
                </p>
                {(point.gate > 0 || point.error > 0) && (
                  <p className="text-[9px] text-brand-700">
                    {point.gate} gate · {point.error} error
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between font-code text-[7.5px] font-semibold uppercase tracking-[0.14em] text-ink-400">
        <span>{points[points.length - 1]?.label ?? ""}</span>
        <span>{points[Math.floor(points.length / 2)]?.label ?? ""}</span>
        <span>{points[0]?.label ?? ""}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 font-code text-[7.5px] font-semibold uppercase tracking-[0.14em] text-ink-500">
        <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-3 rounded-sm bg-sky-500/70" /> reads</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-3 rounded-sm bg-amber-500" /> writes</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-3 rounded-sm bg-brand-600" /> gates</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-3 rounded-sm bg-red-500" /> errors</span>
      </div>
    </div>
  );
}

export function Ring({
  value,
  max,
  size = 92,
  tone = "emerald",
  label,
  sub,
}: {
  value: number;
  max: number;
  size?: number;
  tone?: Tone;
  label: string;
  sub?: string;
}) {
  const pct = max <= 0 ? 0 : Math.min(1, value / max);
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const stroke = {
    neutral: "text-ink-400",
    brand: "text-brand-600",
    emerald: "text-emerald-500",
    amber: "text-amber-500",
    sky: "text-sky-500",
    red: "text-red-500",
    violet: "text-violet-500",
  }[tone];
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 92 92" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="46" cy="46" r={radius} fill="none" strokeWidth="6" className="stroke-ink-100 dark:stroke-white/10" />
        <circle
          cx="46"
          cy="46"
          r={radius}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${circumference * pct} ${circumference}`}
          className={stroke}
        />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <p className="type-num text-[22px] text-ink-950">{label}</p>
        {sub && <p className="mt-0.5 font-code text-[7px] font-bold uppercase tracking-[0.16em] text-ink-400">{sub}</p>}
      </div>
    </div>
  );
}

/* ── States ─────────────────────────────────────────────────────────────── */

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid place-items-center px-5 py-12 text-center">
      <div className="grid h-9 w-9 place-items-center rounded-full border border-ink-200 bg-ink-50 dark:border-white/10 dark:bg-white/[0.04]">
        <span className="h-1.5 w-1.5 rounded-full bg-ink-300" aria-hidden="true" />
      </div>
      <p className="mt-3 font-display text-[14px] font-black text-ink-950">{title}</p>
      <p className="mt-1 max-w-[44ch] text-[11.5px] leading-relaxed text-ink-500">{body}</p>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-ink-100 dark:bg-white/[0.06]", className)} />;
}

/* ── Modal ──────────────────────────────────────────────────────────────── */

export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[140] grid place-items-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink-950/60 backdrop-blur-[3px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className={cn("panel panel-lift relative w-full overflow-hidden rounded-2xl", width)}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4 dark:border-white/8">
          <div>
            {eyebrow && (
              <p className="font-code text-[8px] font-bold uppercase tracking-[0.22em] text-brand-600">{eyebrow}</p>
            )}
            <h2 id={`${id}-title`} className="mt-1 font-display text-[17px] font-black tracking-[-0.02em] text-ink-950">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="focus-brand grid h-7 w-7 place-items-center rounded-lg border border-ink-200 text-ink-500 transition-colors hover:border-ink-400 hover:text-ink-950 dark:border-white/12 dark:hover:border-white/25 dark:hover:text-white"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-100 px-5 py-3.5 dark:border-white/8">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Field group ────────────────────────────────────────────────────────── */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-code text-[8px] font-bold uppercase tracking-[0.2em] text-ink-400">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-[10px] leading-relaxed text-ink-400">{hint}</span>}
    </label>
  );
}
