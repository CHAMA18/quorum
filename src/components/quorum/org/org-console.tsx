"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  CircleAlert,
  CircleCheck,
  Clock,
  FileSignature,
  FileText,
  LayoutGrid,
  Loader2,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCw,
  ScrollText,
  Search,
  Stamp,
  UserRound,
  X,
} from "lucide-react";
import { QuorumLogo } from "@/components/quorum/logo";
import { DeploymentBanner } from "@/components/quorum/deployment-banner";
import { SearchSelect, type SelectOption } from "@/components/quorum/org/search-select";
import { COUNTRIES, SUGGESTED_COUNTRIES, findCountry, type Country } from "@/lib/countries";
import { LEGAL_FORMS, LEGAL_FORM_GROUPS, LEGAL_FORM_OTHER } from "@/lib/legal-forms";
import type { PublicOrg } from "@/lib/org-auth";
import { cn } from "@/lib/utils";
import { ThemeModeRow } from "@/components/quorum/theme-toggle";
import { ApplicationTable } from "./application-table";
import { ContractAcceptance } from "./contract-acceptance";
import { SupplierOverview } from "./supplier-overview";
import { completeness, fmtDate, money, type Application, type OrgContract, type Tender } from "./supplier-data";

/**
 * The organization console — the supplier's desk. Five surfaces: Overview
 * (what the desk sees), Profile (the legal identity, editable), Opportunities
 * (the open tenders, with apply), Applications (what this organization has
 * on the record) and Contracts (the signed packs it may accept). Every
 * application it files is attested org:<name> and lands in the same audit
 * spine the officers read.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

type Tab = "overview" | "profile" | "opportunities" | "applications" | "contracts";

const inputCls =
  "h-11 w-full rounded-xl border border-ink-200 bg-white px-3.5 text-[14px] text-ink-950 outline-none transition-all placeholder:text-ink-300 focus:border-ink-950 focus:ring-4 focus:ring-ink-950/10 dark:border-white/10 dark:bg-night-2 dark:text-white dark:placeholder:text-ink-500";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="font-code text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-500 dark:text-ink-500">{label}</span>
      {children}
      {hint ? <span className="block text-[11.5px] text-ink-400 dark:text-ink-500">{hint}</span> : null}
    </label>
  );
}

/* ── Sidebar (desktop rail + mobile drawer) ─────────────────────────────── */

type ConsoleTab = { id: Tab; label: string; icon: typeof LayoutGrid; badge?: number };

function ConsoleSidebar({
  orgName,
  orgStatus,
  registrationNo,
  tabs,
  active,
  onNavigate,
  onSignOut,
  collapsed = false,
  onToggleCollapse,
}: {
  orgName: string;
  orgStatus: string;
  registrationNo: string;
  tabs: ConsoleTab[];
  active: Tab;
  onNavigate: (t: Tab) => void;
  onSignOut: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const live = orgStatus === "ACTIVE";
  return (
    <div className={cn("relative flex h-full flex-col overflow-hidden py-5", collapsed ? "px-2" : "px-3")}>
      <div aria-hidden="true" className="bg-grid-light pointer-events-none absolute inset-0 opacity-30 dark:opacity-40" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 h-44 w-56 -translate-x-1/2 rounded-full bg-brand-500/[0.06] blur-3xl dark:bg-brand-500/[0.10]"
      />
      <div className={cn("relative mb-3 flex items-center", collapsed ? "justify-center" : "justify-between px-3")}>
        {!collapsed ? (
          <p className="flex items-center gap-2.5 type-micro text-ink-400 dark:text-ink-600">
            Console
            <span aria-hidden="true" className="h-px w-8 bg-ink-200 dark:bg-white/12" />
          </p>
        ) : null}
        {onToggleCollapse ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="focus-brand grid h-8 w-8 place-items-center rounded-full text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900 dark:text-ink-500 dark:hover:bg-white/10 dark:hover:text-white"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden="true" /> : <PanelLeftClose className="h-4 w-4" aria-hidden="true" />}
          </button>
        ) : null}
      </div>
      <nav aria-label="Supplier console sections" className="relative min-h-0 flex-1 overflow-y-auto">
        <ul className="space-y-1">
          {tabs.map((t) => {
            const isActive = active === t.id;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onNavigate(t.id)}
                  aria-current={isActive ? "page" : undefined}
                  title={collapsed ? t.label : undefined}
                  aria-label={collapsed ? `${t.label}${t.badge ? `, ${t.badge}` : ""}` : undefined}
                  className={cn(
                    "focus-brand group relative flex w-full items-center rounded-xl py-2.5 text-left transition-colors duration-200",
                    collapsed ? "justify-center px-2" : "gap-3 px-3",
                    isActive
                      ? "bg-ink-950/[0.06] text-ink-950 ring-1 ring-inset ring-ink-950/[0.06] dark:bg-white/[0.07] dark:text-white dark:ring-white/10"
                      : "text-ink-600 hover:bg-ink-100/70 hover:text-ink-950 dark:text-ink-400 dark:hover:bg-white/[0.04] dark:hover:text-ink-100",
                  )}
                >
                  {isActive ? (
                    <motion.span
                      layoutId="org-nav-rail"
                      className="absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-brand-500 shadow-[0_0_12px_rgba(232,56,42,0.5)]"
                      aria-hidden="true"
                    />
                  ) : null}
                  <t.icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-colors",
                      isActive
                        ? "text-brand-600 dark:text-brand-400"
                        : "text-ink-400 group-hover:text-ink-600 dark:text-ink-500 dark:group-hover:text-ink-300",
                    )}
                    aria-hidden="true"
                  />
                  <span className={cn("text-[12.5px] font-semibold tracking-[-0.005em]", collapsed ? "sr-only" : "flex-1")}>
                    {t.label}
                  </span>
                  {t.badge !== undefined && t.badge > 0 ? (
                    <span
                      className={cn(
                        "grid h-5 min-w-5 place-items-center rounded-full px-1.5 font-code text-[9px] font-bold tabular",
                        collapsed
                          ? "absolute right-1 top-1 h-4 min-w-4 border border-paper bg-brand-600 px-1 text-[8px] text-white dark:border-night"
                          : "bg-ink-200/60 text-ink-700 ring-1 ring-inset ring-ink-950/[0.04] dark:bg-white/[0.08] dark:text-ink-300 dark:ring-white/10",
                      )}
                    >
                      {t.badge}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="relative mt-4 space-y-2 border-t border-ink-200/70 pt-3.5 dark:border-white/10">
        <div
          title={collapsed ? `${orgStatus} · org:${orgName} · REG ${registrationNo}` : undefined}
          className={cn(
            "rounded-[10px] border border-ink-200/70 bg-paper-2/50 px-3 py-3 dark:border-white/10 dark:bg-white/[0.03]",
            collapsed && "flex justify-center",
          )}
        >
          <p className={cn("flex items-center gap-2 type-micro text-ink-700 dark:text-ink-300", collapsed && "justify-center")}>
            <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
              {live ? (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
              ) : null}
              <span
                className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", live ? "bg-emerald-500" : "bg-amber-500")}
              />
            </span>
            {!collapsed ? orgStatus : <span className="sr-only">{orgStatus}</span>}
          </p>
          {!collapsed ? (
            <dl className="mt-2.5 space-y-1">
              <div className="flex items-baseline gap-2">
                <dt className="type-micro shrink-0 text-ink-400">Attested as</dt>
                <dd
                  title={`org:${orgName}`}
                  className="min-w-0 flex-1 truncate text-right font-code text-[9px] text-ink-600 dark:text-ink-400"
                >
                  org:{orgName}
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="type-micro shrink-0 text-ink-400">Reg</dt>
                <dd className="min-w-0 flex-1 truncate text-right font-code text-[9px] text-ink-600 tabular dark:text-ink-400">
                  {registrationNo}
                </dd>
              </div>
            </dl>
          ) : null}
        </div>

        <ThemeModeRow collapsed={collapsed} />

        <Link
          href="/"
          aria-label={collapsed ? "Officer desk" : undefined}
          title={collapsed ? "Officer desk" : undefined}
          className={cn(
            "focus-brand flex w-full items-center rounded-xl py-2.5 transition-colors hover:bg-ink-100/70 hover:text-ink-950 dark:text-ink-400 dark:hover:bg-white/[0.04] dark:hover:text-white",
            collapsed ? "justify-center px-2" : "justify-between gap-2 px-3",
          )}
        >
          {!collapsed ? (
            <span className="type-micro text-ink-500">Officer desk</span>
          ) : (
            <span className="sr-only">Officer desk</span>
          )}
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
        <button
          type="button"
          onClick={onSignOut}
          aria-label={collapsed ? "Sign out" : undefined}
          title={collapsed ? "Sign out" : undefined}
          className={cn(
            "focus-brand flex w-full items-center rounded-xl py-2.5 transition-colors hover:bg-ink-100/70 hover:text-ink-950 dark:text-ink-400 dark:hover:bg-white/[0.04] dark:hover:text-white",
            collapsed ? "justify-center px-2" : "gap-2.5 px-3",
          )}
        >
          <LogOut className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
          {!collapsed ? <span className="type-micro text-ink-500">Sign out</span> : null}
        </button>
      </div>
    </div>
  );
}

/* ── Search palette ──────────────────────────────────────────────────────── */

const QUICK_LINKS: { id: Tab; label: string; hint: string; icon: typeof LayoutGrid }[] = [
  { id: "opportunities", label: "Opportunities", hint: "The open tender board", icon: ScrollText },
  { id: "applications", label: "Applications", hint: "Everything you have filed", icon: FileText },
  { id: "contracts", label: "Contracts", hint: "Signed packs and acceptance", icon: FileSignature },
  { id: "profile", label: "Profile", hint: "The identity the desk verifies", icon: Building2 },
];

function SearchPalette({
  tenders,
  applications,
  onClose,
  onBrowseTender,
  onTab,
}: {
  tenders: Tender[] | null;
  applications: Application[] | null;
  onClose: () => void;
  onBrowseTender: (t: Tender) => void;
  onTab: (tab: Tab) => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();

  const tenderHits = (tenders ?? [])
    .filter((t) => !needle || `${t.ref} ${t.title} ${t.buyer} ${t.sector}`.toLowerCase().includes(needle))
    .slice(0, 4);
  const appHits = (applications ?? [])
    .filter((a) => !needle || `${a.id} ${a.tenderId} ${a.status} ${a.orgName}`.toLowerCase().includes(needle))
    .slice(0, 4);
  const nothing = needle.length > 0 && tenderHits.length === 0 && appHits.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] bg-ink-950/55 p-4 backdrop-blur-sm"
    >
      <button type="button" aria-label="Close search" onClick={onClose} className="absolute inset-0 h-full w-full cursor-default" />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Search the supplier portal"
        initial={{ opacity: 0, y: -8, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.985 }}
        transition={{ duration: 0.2, ease: EASE }}
        className="relative mx-auto mt-[9vh] w-full max-w-xl overflow-hidden rounded-[12px] border border-ink-200/70 bg-white dark:border-white/10 shadow-[0_40px_100px_rgba(0,0,0,0.45)] dark:border-white/10 dark:bg-night-2"
      >
        <div className="flex items-center gap-2.5 border-b border-ink-100 px-4 dark:border-white/10">
          <Search className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tender refs, buyers, applications…"
            aria-label="Search tenders and applications"
            className="h-12 w-full bg-transparent text-[13.5px] text-ink-950 outline-none placeholder:text-ink-400 dark:text-white"
          />
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded border border-ink-200 px-1.5 py-0.5 font-code text-[9px] font-semibold tracking-[0.08em] text-ink-500 transition-colors hover:text-ink-900 dark:border-white/15 dark:hover:text-white"
          >
            ESC
          </button>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2">
          {needle.length === 0 ? (
            <div className="space-y-0.5">
              <p className="px-2 pb-1 pt-1.5 font-code text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-400">
                Jump to
              </p>
              {QUICK_LINKS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    onTab(l.id);
                    onClose();
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-ink-50 dark:hover:bg-white/[0.05]"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-md border border-ink-100 bg-sand/70 text-ink-500 dark:border-white/10 dark:bg-white/[0.04]">
                    <l.icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-ink-900 dark:text-ink-800">{l.label}</span>
                    <span className="block text-[11px] text-ink-400">{l.hint}</span>
                  </span>
                  <ArrowRight className="ml-auto h-3.5 w-3.5 text-ink-300" aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : nothing ? (
            <p className="px-2 py-8 text-center text-[12.5px] text-ink-500">
              Nothing matches “{q.trim()}”. Search a tender reference, a buyer, or an application id.
            </p>
          ) : (
            <div className="space-y-3">
              {tenderHits.length > 0 ? (
                <div>
                  <p className="px-2 pb-1 font-code text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-400">
                    Tenders
                  </p>
                  {tenderHits.map((t) => (
                    <button
                      key={t.ref}
                      type="button"
                      onClick={() => {
                        onBrowseTender(t);
                        onClose();
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-ink-50 dark:hover:bg-white/[0.05]"
                    >
                      <span className="font-code text-[10px] font-semibold text-brand-700 dark:text-brand-300">{t.ref}</span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-800 dark:text-ink-800">{t.title}</span>
                      <span className="shrink-0 font-code text-[9px] uppercase tracking-[0.1em] text-ink-400">
                        {t.status}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              {appHits.length > 0 ? (
                <div>
                  <p className="px-2 pb-1 font-code text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-400">
                    Applications
                  </p>
                  {appHits.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        onTab("applications");
                        onClose();
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-ink-50 dark:hover:bg-white/[0.05]"
                    >
                      <span className="font-code text-[10px] font-semibold text-ink-600 dark:text-ink-600">{a.tenderId}</span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-800 dark:text-ink-800">
                        {a.sealed ? "Sealed — price withheld until opening" : money(a.amount ?? 0, a.currency)}
                      </span>
                      <span className="shrink-0 font-code text-[9px] uppercase tracking-[0.1em] text-ink-400">{a.status}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ── Apply dialog ──────────────────────────────────────────────────────────── */

function ApplyDialog({
  tender,
  onClose,
  onFiled,
}: {
  tender: Tender;
  onClose: () => void;
  onFiled: (a: Application) => void;
}) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(tender.currency || "");
  const [coverNote, setCoverNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filed, setFiled] = useState<Application | null>(null);

  const submit = async () => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Enter the bid amount — a positive number.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenderRef: tender.ref, amount: amt, currency: currency.trim() || undefined, coverNote: coverNote.trim() || undefined }),
      });
      const j = (await res.json().catch(() => ({}))) as { application?: Application; error?: string };
      if (!res.ok || !j.application) {
        setError(j.error ?? "The application could not be filed.");
        return;
      }
      setFiled(j.application);
      onFiled(j.application);
    } catch {
      setError("The portal is unreachable — try again shortly.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-ink-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Apply to ${tender.ref}`}>
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.26, ease: EASE }}
        className="w-full max-w-[520px] overflow-hidden rounded-[12px] border border-ink-200/70 bg-white dark:border-white/10 shadow-[0_36px_90px_rgba(0,0,0,0.4)] dark:border-white/10 dark:bg-night-2"
      >
        {filed ? (
          <div className="space-y-4 p-7 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full border-2 border-brand-600/60 bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-300">
              <CircleCheck className="h-7 w-7" aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-[18px] font-bold text-ink-950 dark:text-white">Application on the record</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-500 dark:text-ink-500">
                Filed as <span className="font-code text-[12px] font-semibold text-brand-700 dark:text-brand-300">app · {filed.id}</span> and appended
                to the procurement audit log for {tender.ref}. The price is sealed in an encrypted envelope; the desk sees it only when it certifies the opening.
              </p>
              {filed.receiptId ? (
                <p className="font-code text-[9px] tracking-[0.12em] text-ink-400">RECEIPT {filed.receiptId}</p>
              ) : null}
            </div>
            <button type="button" onClick={onClose} className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-ink-950 text-[14px] font-semibold text-white transition-all hover:bg-brand-600">
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="border-b border-ink-100 px-6 py-4 dark:border-white/10">
              <p className="font-code text-[9.5px] font-semibold tracking-[0.18em] text-brand-700 dark:text-brand-400">FILE AN APPLICATION</p>
              <h3 className="mt-1 text-[15.5px] font-bold leading-snug text-ink-950 dark:text-white">{tender.title}</h3>
              <p className="mt-1 font-code text-[10px] tracking-[0.12em] text-ink-400">
                {tender.ref} · {tender.buyer} · {tender.closingKnown ? `closes ${fmtDate(tender.closingDate)}` : "closing date not stated on the notice"}
              </p>
            </div>
            <div className="space-y-3.5 p-6">
              <div className="grid gap-3.5 sm:grid-cols-[1.4fr_1fr]">
                <Field label="Bid amount">
                  <input className={inputCls} type="number" min="1" step="any" placeholder="e.g. 7500000" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
                <Field label="Currency">
                  <input className={inputCls} placeholder={tender.currency || "ZMW"} value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={8} />
                </Field>
              </div>
              <Field label="Cover note (optional)" hint="What the desk should know about this bid — 1200 characters at most.">
                <textarea
                  className={cn(inputCls, "h-24 resize-none py-2.5")}
                  placeholder="Delivery period, references, anything the notice asks to be told."
                  value={coverNote}
                  onChange={(e) => setCoverNote(e.target.value)}
                  maxLength={1200}
                />
              </Field>
              {error ? (
                <div className="flex items-start gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-[13px] text-brand-800 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-200">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {error}
                </div>
              ) : null}
              <p className="rounded-xl border border-ink-100 bg-sand px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-600 dark:border-white/10 dark:bg-night dark:text-ink-500">
                Filing is a real act: the application is refused after the closing date, refused if this organization
                already has one on record for {tender.ref}, and your identity is attested by the portal — never typed in.
              </p>
              <div className="flex items-center justify-between gap-3 pt-1">
                <button type="button" onClick={onClose} className="inline-flex h-11 items-center gap-1.5 rounded-xl px-4 text-[13.5px] font-semibold text-ink-600 transition-colors hover:bg-ink-50 dark:text-ink-600 dark:hover:bg-white/5">
                  Cancel
                </button>
                <button type="button" onClick={submit} disabled={busy} className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink-950 px-5 text-[13.5px] font-semibold text-white shadow-[0_8px_20px_rgba(11,12,15,0.18)] transition-all hover:bg-brand-600 disabled:opacity-60">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Stamp className="h-4 w-4" aria-hidden="true" />}
                  File application
                </button>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

/* ── Profile editor ──────────────────────────────────────────────────────── */

const CATEGORY_SUGGESTIONS = [
  "Medical supplies", "Laboratory equipment", "Solar energy", "Water & boreholes",
  "ICT & software", "Furniture", "Construction", "Transport & logistics",
];

/* The same dropdown registers as the registration wizard — the profile
   editor and the door speak one language. */
const toCountryOption = (c: Country, group: string): SelectOption => ({
  value: c.name,
  hint: `${c.code} · ${c.dial}`,
  group,
  keywords: `${c.code} ${c.dial} ${c.keywords ?? ""}`,
});

const COUNTRY_OPTIONS: SelectOption[] = [
  ...SUGGESTED_COUNTRIES.flatMap((n) => {
    const c = COUNTRIES.find((x) => x.name === n);
    return c ? [toCountryOption(c, "Commonly used here")] : [];
  }),
  ...COUNTRIES.filter((c) => !(SUGGESTED_COUNTRIES as readonly string[]).includes(c.name)).map((c) =>
    toCountryOption(c, "All countries"),
  ),
];

const LEGAL_FORM_OPTIONS: SelectOption[] = [
  ...LEGAL_FORM_GROUPS.flatMap((g) => g.options.map((v) => ({ value: v, group: g.group }))),
  { value: LEGAL_FORM_OTHER, group: "Other" },
];

function ProfileEditor({ org, onSaved, focusField }: { org: PublicOrg; onSaved: (o: PublicOrg) => void; focusField: string | null }) {
  const [form, setForm] = useState({
    name: org.name,
    country: org.country,
    legalForm: org.legalForm ?? "",
    taxPin: org.taxPin ?? "",
    taxClearanceNo: org.taxClearanceNo ?? "",
    taxClearanceExpiry: org.taxClearanceExpiry ?? "",
    regulator: org.regulator ?? "",
    regulatorNo: org.regulatorNo ?? "",
    contactName: org.contactName ?? "",
    phone: org.phone ?? "",
    address: org.address ?? "",
    website: org.website ?? "",
    description: org.description ?? "",
    categories: org.categories,
  });
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState("");
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  /* A listed legal form selects directly; a value saved outside the list
     (or "Other") opens the specify field. */
  const [legalFormChoice, setLegalFormChoice] = useState(() =>
    org.legalForm ? (LEGAL_FORMS.includes(org.legalForm) ? org.legalForm : LEGAL_FORM_OTHER) : "",
  );

  const set = (k: keyof typeof form, v: string | string[]) => {
    setForm((p) => ({ ...p, [k]: v }));
    setStatus("idle");
  };

  const addCategory = (raw: string) => {
    const v = raw.trim().slice(0, 80);
    if (!v || form.categories.includes(v) || form.categories.length >= 12) return;
    set("categories", [...form.categories, v]);
  };

  const setLegalForm = (choice: string) => {
    setLegalFormChoice(choice);
    set("legalForm", choice === LEGAL_FORM_OTHER || choice === "" ? "" : choice);
  };

  /* Same country-driven intuition as the door: dial code for the phone field. */
  const selectedCountry = form.country ? findCountry(form.country) : undefined;
  const phonePlaceholder = selectedCountry ? `${selectedCountry.dial} …` : "+ country code …";

  useEffect(() => {
    if (!focusField) return;
    const fallbackId =
      focusField === "country"
        ? "profile-country"
        : focusField === "legal form"
          ? "profile-legal-form"
          : null;
    const target = fieldRefs.current[focusField] ?? (fallbackId ? document.getElementById(fallbackId) : null);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
  }, [focusField]);

  const save = async () => {
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch("/api/org/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = (await res.json().catch(() => ({}))) as { org?: PublicOrg; error?: string };
      if (!res.ok || !j.org) {
        setError(j.error ?? "The profile could not be saved.");
        setStatus("error");
        return;
      }
      onSaved(j.org);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2500);
    } catch {
      setError("The portal is unreachable — try again shortly.");
      setStatus("error");
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-[12px] border border-ink-200/70 bg-white dark:border-white/10 p-5 shadow-[0_1px_2px_rgba(11,12,15,0.04)] sm:p-6 dark:border-white/[0.07] dark:bg-night-2/80">
        <div className="mb-5 flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-700 dark:text-brand-300">
            <Building2 className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-display text-[14px] font-extrabold tracking-[-0.01em] text-ink-950 dark:text-white">Registered entity</h2>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">The name and jurisdiction used on every application.</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Legal name">
            <input ref={(node) => { fieldRefs.current["legal name"] = node; }} className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Country of registration">
            <SearchSelect
              value={form.country}
              onChange={(v) => set("country", v)}
              options={COUNTRY_OPTIONS}
              placeholder="Select the country…"
              searchPlaceholder={`Search ${COUNTRIES.length} countries…`}
              emptyText="No country matches — try the ISO code or dial digits."
              id="profile-country"
              label="Country of registration"
            />
          </Field>
        </div>
      </section>

      <section className="rounded-[10px] border border-ink-100 bg-ink-50/70 p-5 sm:p-6 dark:border-white/[0.07] dark:bg-white/[0.025]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-ink-500" aria-hidden="true" />
              <h2 className="font-display text-[14px] font-extrabold tracking-[-0.01em] text-ink-950 dark:text-white">Legal identity</h2>
            </div>
            <p className="mt-1 text-[12px] text-ink-500">Your account identifiers are fixed and cannot be edited here.</p>
          </div>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-ink-200 bg-white px-2.5 py-1 font-code text-[9px] font-semibold tracking-[0.1em] text-ink-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-400">
            <FileText className="h-3 w-3" aria-hidden="true" /> FIXED
          </span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[10px] border border-ink-200/70 bg-white dark:border-white/10 px-4 py-3 dark:border-white/[0.06] dark:bg-night-2">
            <p className="font-code text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-500">Registration number</p>
            <p ref={(node) => { fieldRefs.current["registration no"] = node; }} tabIndex={-1} className="mt-1.5 break-all font-code text-[13px] font-semibold text-ink-950 outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:text-white">{org.registrationNo}</p>
          </div>
          <div className="rounded-[10px] border border-ink-200/70 bg-white dark:border-white/10 px-4 py-3 dark:border-white/[0.06] dark:bg-night-2">
            <p className="font-code text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-500">Login email</p>
            <p className="mt-1.5 break-all text-[13px] font-semibold text-ink-950 dark:text-white">{org.email}</p>
          </div>
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-500">
          These details anchor your organization&apos;s identity across the procurement record. Contact the desk if either must change.
        </p>
      </section>

      <section className="rounded-[12px] border border-ink-200/70 bg-white dark:border-white/10 p-5 shadow-[0_1px_2px_rgba(11,12,15,0.04)] sm:p-6 dark:border-white/[0.07] dark:bg-night-2/80">
        <div className="mb-5 flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-700 dark:text-brand-300">
            <CircleCheck className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-display text-[14px] font-extrabold tracking-[-0.01em] text-ink-950 dark:text-white">Statutory record</h2>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">The credentials the procurement desk uses to verify your organization.</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tax PIN">
            <input ref={(node) => { fieldRefs.current["tax PIN"] = node; }} className={inputCls} value={form.taxPin} onChange={(e) => set("taxPin", e.target.value)} />
          </Field>
          <Field label="Tax clearance number">
            <input ref={(node) => { fieldRefs.current["tax clearance"] = node; }} className={inputCls} value={form.taxClearanceNo} onChange={(e) => set("taxClearanceNo", e.target.value)} />
          </Field>
          <Field label="Tax clearance expiry">
            <input ref={(node) => { fieldRefs.current["clearance expiry"] = node; }} className={inputCls} type="date" value={form.taxClearanceExpiry} onChange={(e) => set("taxClearanceExpiry", e.target.value)} />
          </Field>
          <Field label="Legal form">
            <SearchSelect
              value={legalFormChoice}
              onChange={setLegalForm}
              options={LEGAL_FORM_OPTIONS}
              placeholder="Select the legal form…"
              searchPlaceholder="Search legal forms…"
              emptyText="No legal form matches — choose Other (not listed)."
              clearable
              id="profile-legal-form"
              label="Legal form"
            />
            {legalFormChoice === LEGAL_FORM_OTHER ? (
              <input
                ref={(node) => { fieldRefs.current["legal form"] = node; }}
                className={cn(inputCls, "mt-2")}
                placeholder="Describe the legal form"
                value={form.legalForm}
                maxLength={80}
                onChange={(e) => set("legalForm", e.target.value)}
              />
            ) : null}
          </Field>
          <Field label="Sector regulator">
            <input ref={(node) => { fieldRefs.current["sector regulator"] = node; }} className={inputCls} placeholder="NCC · NHCC · ERB · ZPPA…" value={form.regulator} onChange={(e) => set("regulator", e.target.value)} />
          </Field>
          <Field label="Regulator registration no">
            <input className={inputCls} value={form.regulatorNo} onChange={(e) => set("regulatorNo", e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="rounded-[12px] border border-ink-200/70 bg-white dark:border-white/10 p-5 shadow-[0_1px_2px_rgba(11,12,15,0.04)] sm:p-6 dark:border-white/[0.07] dark:bg-night-2/80">
        <div className="mb-5 flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-700 dark:text-brand-300">
            <UserRound className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-display text-[14px] font-extrabold tracking-[-0.01em] text-ink-950 dark:text-white">Contact &amp; presence</h2>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">How the desk can reach your team and understand what you supply.</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact person">
            <input ref={(node) => { fieldRefs.current["contact person"] = node; }} className={inputCls} value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
          </Field>
          <Field label="Phone">
            <input ref={(node) => { fieldRefs.current.phone = node; }} className={inputCls} placeholder={phonePlaceholder} value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Address">
            <input ref={(node) => { fieldRefs.current.address = node; }} className={inputCls} value={form.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Field label="Website">
            <input className={inputCls} value={form.website} onChange={(e) => set("website", e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="What the organization supplies">
              <textarea
                ref={(node) => { fieldRefs.current.description = node; }}
                className={cn(inputCls, "h-24 resize-none py-2.5")}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                maxLength={1200}
              />
            </Field>
          </div>
        </div>
      </section>

      <section className="rounded-[12px] border border-ink-200/70 bg-white dark:border-white/10 p-5 shadow-[0_1px_2px_rgba(11,12,15,0.04)] sm:p-6 dark:border-white/[0.07] dark:bg-night-2/80">
        <div className="mb-5 flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-700 dark:text-brand-300">
            <LayoutGrid className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-display text-[14px] font-extrabold tracking-[-0.01em] text-ink-950 dark:text-white">Supply categories</h2>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">Help the desk match your capabilities to relevant opportunities.</p>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              ref={(node) => { fieldRefs.current.categories = node; }}
              className={inputCls}
              placeholder="Type a category and press Enter"
              value={categoryDraft}
              onChange={(e) => setCategoryDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCategory(categoryDraft);
                  setCategoryDraft("");
                }
              }}
            />
            <button
              type="button"
              onClick={() => {
                addCategory(categoryDraft);
                setCategoryDraft("");
              }}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-ink-200 text-ink-600 transition-colors hover:border-brand-600 hover:text-brand-700 dark:border-white/10"
              aria-label="Add category"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {form.categories.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {form.categories.map((c) => (
                <span key={c} className="inline-flex items-center gap-1 rounded-full bg-ink-950 px-2.5 py-1 text-[12px] font-medium text-white dark:bg-white dark:text-night">
                  {c}
                  <button type="button" onClick={() => set("categories", form.categories.filter((x) => x !== c))} aria-label={`Remove ${c}`}>
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_SUGGESTIONS.filter((s) => !form.categories.includes(s)).map((s) => (
              <button key={s} type="button" onClick={() => addCategory(s)} className="rounded-full border border-dashed border-ink-300 px-2.5 py-1 text-[11.5px] text-ink-500 transition-colors hover:border-brand-600 hover:text-brand-700 dark:border-white/15 dark:text-ink-500">
                + {s}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error ? (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-[13px] text-brand-800 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-200">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      ) : null}

      <div className="sticky bottom-3 z-20 flex flex-col gap-3 rounded-[10px] border border-ink-200/80 bg-paper/95 p-3 shadow-[0_12px_36px_rgba(11,12,15,0.12)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between sm:px-4 dark:border-white/10 dark:bg-night/90 dark:shadow-[0_12px_36px_rgba(0,0,0,0.35)]">
        <div className="min-h-9">
          <p className="text-[12px] font-semibold text-ink-800 dark:text-ink-200">Keep your supplier record current</p>
          <AnimatePresence mode="wait">
            {status === "saved" ? (
              <motion.p key="saved" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} role="status" className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" /> Profile saved and register updated.
              </motion.p>
            ) : (
              <motion.p key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-0.5 text-[11px] text-ink-500">
                Changes are reflected in the register after saving.
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        <button type="button" onClick={save} disabled={status === "saving"} aria-busy={status === "saving"} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(217,38,22,0.22)] transition-all hover:bg-brand-700 hover:shadow-[0_10px_26px_rgba(217,38,22,0.3)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/25 disabled:cursor-wait disabled:opacity-70">
          {status === "saving" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : status === "saved" ? <CircleCheck className="h-4 w-4" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
          {status === "saving" ? "Saving profile…" : status === "saved" ? "Saved" : "Save profile"}
        </button>
      </div>
    </div>
  );
}

/* ── The console ─────────────────────────────────────────────────────────── */

export function OrgConsole({ initialOrg }: { initialOrg: PublicOrg }) {
  const router = useRouter();
  const [org, setOrg] = useState<PublicOrg>(initialOrg);
  const [tab, setTab] = useState<Tab>("overview");
  const [profileFocus, setProfileFocus] = useState<string | null>(null);
  const [tenders, setTenders] = useState<Tender[] | null>(null);
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [applicationsError, setApplicationsError] = useState<string | null>(null);
  const [contracts, setContracts] = useState<OrgContract[] | null>(null);
  const [contractsError, setContractsError] = useState<string | null>(null);
  const [tenderError, setTenderError] = useState<string | null>(null);
  const [applying, setApplying] = useState<Tender | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [spotlight, setSpotlight] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const loadTenders = useCallback(async () => {
    try {
      const res = await fetch("/api/org/tenders", { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as { tenders?: Tender[]; error?: string };
      if (!res.ok) {
        setTenderError(j.error ?? "The opportunities board is not reachable.");
        return;
      }
      setTenderError(null);
      setTenders(j.tenders ?? []);
    } catch {
      setTenderError("The opportunities board is not reachable.");
    }
  }, []);

  const loadApplications = useCallback(async () => {
    try {
      const res = await fetch("/api/org/applications", { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as { applications?: Application[]; error?: string };
      if (!res.ok) {
        setApplicationsError(j.error ?? "Applications are not reachable right now.");
        return;
      }
      setApplicationsError(null);
      setApplications(j.applications ?? []);
    } catch {
      /* keep the last snapshot; the next poll retries */
      setApplicationsError("Applications are not reachable right now.");
    }
  }, []);

  const loadContracts = useCallback(async () => {
    try {
      const res = await fetch("/api/org/contracts", { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as { contracts?: OrgContract[]; error?: string };
      if (!res.ok) {
        setContractsError(j.error ?? "Contracts are not reachable right now.");
        return;
      }
      setContractsError(null);
      setContracts(j.contracts ?? []);
    } catch {
      setContractsError("Contracts are not reachable right now.");
    }
  }, []);

  useEffect(() => {
    /* Deferred kick (never setState synchronously inside an effect) plus the
       same 5s poll the officer desk runs — both surfaces stay live. Contracts
       are heavier to compute (one sidecar read per application), so they poll
       on their own slower clock. */
    const kick = () => {
      void loadTenders();
      void loadApplications();
    };
    const t = setTimeout(kick, 0);
    const id = setInterval(kick, 5000);
    const ct = setTimeout(() => void loadContracts(), 0);
    const cid = setInterval(() => void loadContracts(), 30_000);
    return () => {
      clearTimeout(t);
      clearInterval(id);
      clearTimeout(ct);
      clearInterval(cid);
    };
  }, [loadTenders, loadApplications, loadContracts]);

  useEffect(() => {
    if (tab !== "contracts") return;
    /* Deferred like the initial kick: the fetch sets state when it answers,
       not synchronously inside the effect. */
    const t = setTimeout(() => void loadContracts(), 0);
    return () => clearTimeout(t);
  }, [tab, loadContracts]);

  useEffect(() => {
    /* Never leave the Applications tab on an endless skeleton: if the first
       answer hasn't arrived after 12s, say so and keep retrying on the poll. */
    if (applications !== null) return;
    const t = setTimeout(() => {
      setApplicationsError((prev) => prev ?? "Applications are taking too long to load.");
    }, 12_000);
    return () => clearTimeout(t);
  }, [applications]);

  useEffect(() => {
    /* ⌘K / Ctrl-K opens the palette anywhere on the console; Escape closes it. */
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
        setNavOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* Body scroll lock while the mobile drawer is open. */
  useEffect(() => {
    document.body.style.overflow = navOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [navOpen]);

  const signOut = async () => {
    await fetch("/api/org/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/org");
    router.refresh();
  };

  const appliedTenderIds = useMemo(() => new Set((applications ?? []).map((a) => a.tenderId)), [applications]);
  const openTenders = useMemo(() => (tenders ?? []).filter((t) => t.status === "OPEN"), [tenders]);
  const profile = useMemo(() => completeness(org), [org]);

  const viewTender = useCallback((ref: string) => {
    setProfileFocus(null);
    setTab("opportunities");
    setSpotlight(ref);
    setTimeout(() => {
      document.getElementById(`tender-${ref}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 90);
    setTimeout(() => setSpotlight((cur) => (cur === ref ? null : cur)), 3200);
  }, []);

  const openProfileField = (field: string) => {
    setProfileFocus(field);
    setTab("profile");
    setNavOpen(false);
  };

  const awaitingAcceptance = (contracts ?? []).filter(
    (row) => row.contract.status === "DRAFT" && !row.contract.supplierAcceptedAt,
  ).length;

  const TABS: { id: Tab; label: string; icon: typeof LayoutGrid; badge?: number }[] = [
    { id: "overview", label: "Overview", icon: LayoutGrid },
    { id: "profile", label: "Profile", icon: Building2, badge: profile.missing.length > 0 ? profile.missing.length : undefined },
    { id: "opportunities", label: "Opportunities", icon: ScrollText, badge: openTenders.length || undefined },
    { id: "applications", label: "Applications", icon: FileText, badge: applications?.length || undefined },
    { id: "contracts", label: "Contracts", icon: FileSignature, badge: awaitingAcceptance || undefined },
  ];

  const onFiled = (a: Application) => {
    setApplications((p) => [a, ...(p ?? [])]);
    setFlash(`Application ${a.id} is on the record for ${a.tenderId}.`);
    setTimeout(() => setFlash(null), 5000);
    void loadTenders();
  };

  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-x-clip bg-paper dark:bg-night">
      {/* ambient light — two soft signal washes, decorative only */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-48 left-1/2 h-[440px] w-[760px] -translate-x-1/2 rounded-full bg-brand-500/[0.04] blur-[120px] dark:bg-brand-500/[0.09]" />
        <div className="absolute -right-44 top-1/3 h-[380px] w-[380px] rounded-full bg-brand-500/[0.03] blur-[110px] dark:bg-brand-500/[0.05]" />
      </div>

      {/* header */}
      <header className="sticky top-0 z-40 border-b border-ink-100/80 bg-paper/85 backdrop-blur-xl dark:border-white/[0.06] dark:bg-night/80">
        <div className="mx-auto flex h-16 w-full max-w-[1560px] items-center justify-between gap-3 px-4 sm:h-[76px] sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label="Open console menu"
              aria-expanded={navOpen}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-ink-100 text-ink-600 transition-colors hover:text-ink-900 lg:hidden dark:border-white/[0.08] dark:text-ink-600 dark:hover:text-white"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </button>
            <Link href="/" aria-label="Quorum home" className="shrink-0 rounded-xl transition-opacity hover:opacity-85">
              <span className="hidden dark:inline-flex">
                <QuorumLogo variant="light" tagline={false} />
              </span>
              <span className="dark:hidden">
                <QuorumLogo tagline={false} />
              </span>
            </Link>
            <span className="hidden h-9 w-px bg-ink-200/80 sm:block dark:bg-white/10" />
            <div className="hidden min-w-0 sm:block">
              <p className="type-micro text-brand-700 dark:text-brand-400">Supplier portal</p>
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-[13.5px] font-semibold tracking-[-0.01em] text-ink-950 dark:text-white">
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    org.status === "ACTIVE" ? "bg-emerald-500" : "bg-amber-500",
                  )}
                  aria-hidden="true"
                />
                {org.name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="focus-brand hidden h-10 items-center gap-2.5 rounded-full border border-ink-200/80 bg-white/70 px-3.5 text-left text-[12.5px] text-ink-500 transition-colors hover:border-ink-300 hover:text-ink-900 md:flex dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-400 dark:hover:border-white/20 dark:hover:text-white"
            >
              <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Search tenders, applications…</span>
              <kbd className="ml-4 rounded-md border border-ink-200/80 bg-paper-2/70 px-1.5 py-0.5 font-code text-[9px] font-semibold tracking-[0.08em] text-ink-500 dark:border-white/10 dark:bg-white/[0.06] dark:text-ink-400">
                ⌘K
              </kbd>
            </button>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Search the portal"
              className="grid h-9 w-9 place-items-center rounded-lg border border-ink-100 text-ink-500 transition-colors hover:text-ink-900 md:hidden dark:border-white/[0.08] dark:hover:text-white"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
            </button>

            <Link
              href="/"
              className="hidden h-9 items-center gap-1 rounded-lg border border-ink-100 bg-white px-3 text-[12px] font-semibold text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-700 sm:inline-flex md:hidden dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-700 dark:hover:border-brand-500/40 dark:hover:text-brand-300"
            >
              Officer desk
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </Link>

            <button
              type="button"
              onClick={signOut}
              title="Sign out of this session"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-100 px-2.5 text-[12px] font-semibold text-ink-600 transition-colors hover:border-ink-200 hover:text-ink-900 lg:hidden dark:border-white/10 dark:text-ink-600 dark:hover:border-white/20 dark:hover:text-white sm:px-3"
            >
              <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      {/* App shell: a dark section rail on desktop, the same rail in a drawer on mobile */}
      <div className="mx-auto flex w-full max-w-[1560px] flex-1 items-stretch">
        <aside
          aria-label="Supplier console navigation"
          className={cn(
            "sticky top-[76px] hidden h-[calc(100vh-76px)] shrink-0 self-start border-r border-ink-200 bg-paper transition-[width] duration-300 ease-out lg:block dark:border-white/[0.06] dark:bg-night",
            sidebarCollapsed ? "w-[76px]" : "w-[248px]",
          )}
        >
          <ConsoleSidebar
            orgName={org.name}
            orgStatus={org.status}
            registrationNo={org.registrationNo}
            tabs={TABS}
            active={tab}
            onNavigate={(next) => {
              setProfileFocus(null);
              setTab(next);
            }}
            onSignOut={signOut}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed((current) => !current)}
          />
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <DeploymentBanner />
          <AnimatePresence>
            {flash ? (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mb-5 flex w-full items-center gap-2 rounded-xl border border-ink-950 bg-ink-950 px-4 py-2.5 text-[13px] font-semibold text-white dark:border-white dark:bg-white dark:text-night"
              >
                <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" /> {flash}
              </motion.div>
            ) : null}
          </AnimatePresence>

          <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: EASE }}
          >
            {tab === "overview" ? (
              <SupplierOverview
                orgName={org.name}
                orgCreatedAt={org.createdAt}
                profile={profile}
                tenders={tenders}
                applications={applications}
                tendersError={tenderError}
                applicationsError={applicationsError}
                onTab={(next) => {
                  setProfileFocus(null);
                  setTab(next);
                }}
                onMissingField={openProfileField}
                onBrowse={() => setTab("opportunities")}
                onViewTender={viewTender}
                onRetry={() => {
                  void loadTenders();
                  void loadApplications();
                  void loadContracts();
                }}
              />
            ) : null}

            {tab === "profile" ? (
              <div className="mx-auto max-w-5xl space-y-6">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                  <div className="max-w-2xl">
                    <p className="font-code text-[9px] font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-400">
                      The register&apos;s view
                    </p>
                    <h1 className="type-display mt-2 text-[26px] text-ink-950 dark:text-white sm:text-[30px]">
                      Organization profile
                    </h1>
                    <p className="mt-2 max-w-[64ch] text-[13px] leading-relaxed text-ink-500 sm:text-[13.5px]">
                      Keep your organization&apos;s record accurate. The procurement desk uses these details to verify your identity and match you with relevant opportunities.
                    </p>
                  </div>
                  <div className="w-full shrink-0 rounded-[12px] border border-ink-200/70 bg-white dark:border-white/10 p-4 shadow-[0_1px_2px_rgba(11,12,15,0.04)] sm:w-[230px] dark:border-white/[0.07] dark:bg-night-2/80">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-code text-[9px] font-semibold uppercase tracking-[0.15em] text-ink-500">Record health</span>
                      <span className="font-code text-[10px] font-bold tabular text-ink-700 dark:text-ink-200">{profile.filled}/{profile.total}</span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label="Profile completeness"
                      aria-valuemin={0}
                      aria-valuemax={profile.total}
                      aria-valuenow={profile.filled}
                      className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100 dark:bg-white/10"
                    >
                      <div
                        className="h-full rounded-full bg-brand-500 transition-[width] duration-500"
                        style={{ width: `${Math.round((profile.filled / profile.total) * 100)}%` }}
                      />
                    </div>
                    <p className="mt-2 text-[11px] text-ink-500">{profile.missing.length === 0 ? "All verification details are on file." : `${profile.missing.length} ${profile.missing.length === 1 ? "detail" : "details"} still to complete`}</p>
                  </div>
                </div>
                <ProfileEditor
                  org={org}
                  focusField={profileFocus}
                  onSaved={(o) => {
                    setOrg(o);
                    router.refresh();
                  }}
                />
              </div>
            ) : null}

            {tab === "opportunities" ? (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="font-code text-[9px] font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-400">
                      The board
                    </p>
                    <h1 className="type-display mt-2 flex items-center gap-2.5 text-[22px] text-ink-950 dark:text-white">
                      Opportunities
                      {tenders !== null ? (
                        <span className="rounded-full border border-ink-100 bg-sand/80 px-2 py-0.5 font-code text-[9.5px] font-semibold text-ink-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-600">
                          {openTenders.length} open
                        </span>
                      ) : null}
                    </h1>
                    <p className="mt-1.5 max-w-[66ch] text-[13px] leading-relaxed text-ink-500">
                      Every tender pack staged on the procurement desk. Closing dates are read from the cycle record first
                      and the notice second — a bid is refused the moment the date passes.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadTenders()}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-lg border border-ink-100 bg-white px-3 text-[12px] font-semibold text-ink-600 transition-colors hover:border-ink-200 hover:text-ink-900 sm:self-auto dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-600 dark:hover:border-white/20 dark:hover:text-white"
                  >
                    <RotateCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh
                  </button>
                </div>

                {tenderError ? (
                  <div className="flex items-start gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-[13px] text-brand-800 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-200">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {tenderError}
                  </div>
                ) : null}

                {tenders === null ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="h-[196px] animate-pulse rounded-[10px] border border-ink-100 bg-ink-50/60 dark:border-white/[0.07] dark:bg-white/[0.03]"
                      />
                    ))}
                  </div>
                ) : tenders.length === 0 ? (
                  <div className="rounded-[10px] border border-dashed border-ink-200 px-6 py-16 text-center dark:border-white/15">
                    <p className="text-[14px] font-semibold text-ink-700 dark:text-ink-700">
                      No tender packs are staged on the desk yet
                    </p>
                    <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-400">
                      Opportunities appear here the moment the procurement desk stages a tender pack. Nothing is invented
                      to fill this board — the empty state is the honest state.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {tenders.map((t) => {
                      const applied = appliedTenderIds.has(t.ref);
                      const closed = t.status === "CLOSED";
                      return (
                        <div
                          key={t.ref}
                          id={`tender-${t.ref}`}
                          className={cn(
                            "flex scroll-mt-40 flex-col rounded-[10px] border bg-white p-5 transition-all duration-300 dark:bg-night-2/80",
                            spotlight === t.ref
                              ? "border-brand-500 shadow-[0_0_0_3px_rgba(232,56,42,0.14)] dark:border-brand-500/60"
                              : "border-ink-100 hover:border-ink-200 dark:border-white/[0.07] dark:hover:border-white/15",
                            closed && "opacity-70",
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-code text-[9.5px] font-semibold tracking-[0.16em] text-brand-700 dark:text-brand-400">
                                {t.ref}
                              </p>
                              <h3 className="mt-1 text-[14.5px] font-bold leading-snug text-ink-950 dark:text-white">
                                {t.title}
                              </h3>
                              <p className="mt-1 truncate text-[12.5px] text-ink-500">{t.buyer}</p>
                            </div>
                            <span
                              className={cn(
                                "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 font-code text-[9px] font-bold tracking-[0.14em]",
                                closed
                                  ? "border-ink-200 text-ink-500 dark:border-white/10 dark:text-ink-500"
                                  : "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                              )}
                            >
                              <span
                                className={cn("h-1.5 w-1.5 rounded-full", closed ? "bg-ink-300" : "bg-emerald-500")}
                                aria-hidden="true"
                              />
                              {closed ? "CLOSED" : "OPEN"}
                            </span>
                          </div>

                          <div className="mt-3.5 space-y-1.5 text-[12.5px]">
                            <p className="flex items-center gap-2 text-ink-600 dark:text-ink-600">
                              <Clock className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden="true" />
                              {t.closingKnown ? (
                                <>
                                  Closes{" "}
                                  <strong className="font-semibold text-ink-900 dark:text-ink-800">
                                    {fmtDate(t.closingDate)}
                                  </strong>
                                  {t.status === "OPEN" && t.daysLeft !== undefined ? (
                                    <span className="text-ink-400">
                                      · {t.daysLeft} {t.daysLeft === 1 ? "day" : "days"} left
                                    </span>
                                  ) : null}
                                </>
                              ) : (
                                <span className="italic text-ink-400">closing date not stated on the notice</span>
                              )}
                            </p>
                            <p className="flex items-center gap-2 text-ink-600 dark:text-ink-600">
                              <FileText className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden="true" />
                              {t.budget} · {t.format}
                            </p>
                            <p className="flex items-center gap-2 text-ink-600 dark:text-ink-600">
                              <Building2 className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden="true" />
                              {t.sector} · {t.applications} {t.applications === 1 ? "application" : "applications"} on
                              record
                            </p>
                          </div>

                          <div className="mt-auto pt-4">
                            {applied ? (
                              <div className="flex h-10 items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300">
                                <CircleCheck className="h-4 w-4" aria-hidden="true" /> Application on record
                              </div>
                            ) : closed ? (
                              <div className="flex h-10 items-center justify-center rounded-xl border border-ink-100 text-[12px] font-semibold text-ink-400 dark:border-white/10">
                                Closed — late applications are refused
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setApplying(t)}
                                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-brand-500 text-[13px] font-semibold text-white shadow-[0_10px_24px_-12px_rgba(232,56,42,0.9)] transition-colors hover:bg-brand-600"
                              >
                                <Stamp className="h-3.5 w-3.5" aria-hidden="true" /> Apply to this tender
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}

            {tab === "contracts" ? (
              <ContractAcceptance contracts={contracts} error={contractsError} onRefresh={loadContracts} />
            ) : null}

            {tab === "applications" ? (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="font-code text-[9px] font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-400">
                      The record
                    </p>
                    <h1 className="type-display mt-2 flex items-center gap-2.5 text-[22px] text-ink-950 dark:text-white">
                      Applications
                      {applications !== null ? (
                        <span className="rounded-full border border-ink-100 bg-sand/80 px-2 py-0.5 font-code text-[9.5px] font-semibold text-ink-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-600">
                          {applications.length} filed
                        </span>
                      ) : null}
                    </h1>
                    <p className="mt-1.5 max-w-[66ch] text-[13px] leading-relaxed text-ink-500">
                      Every bid this organization has filed, attested as{" "}
                      <span className="font-code text-[11.5px] text-brand-700 dark:text-brand-400">org:{org.name}</span>{" "}
                      with the desk&apos;s receipt time. A receipt can be exported per row.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTab("opportunities")}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-lg bg-brand-500 px-3.5 text-[12px] font-semibold text-white shadow-[0_10px_24px_-12px_rgba(232,56,42,0.9)] transition-colors hover:bg-brand-600 sm:self-auto"
                  >
                    <Stamp className="h-3.5 w-3.5" aria-hidden="true" /> New submission
                  </button>
                </div>

                {applicationsError ? (
                  <div className="flex flex-col items-start gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-[13px] text-brand-800 sm:flex-row sm:items-center sm:justify-between dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-200">
                    <span className="flex items-start gap-2">
                      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>
                        {applicationsError} The list retries every few seconds.
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void loadApplications()}
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-brand-300 px-2.5 text-[11.5px] font-semibold transition-colors hover:bg-brand-500/10 dark:border-brand-500/40"
                    >
                      <RotateCw className="h-3 w-3" aria-hidden="true" /> Retry now
                    </button>
                  </div>
                ) : null}

                <section className="overflow-hidden rounded-[12px] panel dark:border-white/[0.07] dark:bg-night-2/80">
                  <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-3.5 dark:border-white/[0.06]">
                    <p className="font-code text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-400">
                      Filing times in UTC · newest first
                    </p>
                    <button
                      type="button"
                      onClick={() => void loadApplications()}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-semibold text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900 dark:hover:bg-white/[0.06] dark:hover:text-white"
                    >
                      <RotateCw className="h-3 w-3" aria-hidden="true" /> Refresh
                    </button>
                  </div>
                  {applications === null ? (
                    <div className="space-y-3 px-5 py-6" aria-hidden="true">
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="flex items-center gap-4">
                          <div className="h-3 w-24 animate-pulse rounded bg-ink-100 dark:bg-white/[0.06]" />
                          <div className="h-3 flex-1 animate-pulse rounded bg-ink-100/80 dark:bg-white/[0.04]" />
                          <div className="h-3 w-20 animate-pulse rounded bg-ink-100 dark:bg-white/[0.06]" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <ApplicationTable
                      applications={applications}
                      tenders={tenders ?? []}
                      onViewTender={viewTender}
                      onBrowse={() => setTab("opportunities")}
                      onChanged={() => {
                        void loadApplications();
                        void loadTenders();
                      }}
                      filterable
                      orgName={org.name}
                    />
                  )}
                </section>
              </div>
            ) : null}
          </motion.div>
        </AnimatePresence>
        </main>
      </div>

      <footer className="border-t border-ink-100/80 bg-paper/60 py-6 dark:border-white/[0.06] dark:bg-night/60">
        <div className="mx-auto flex w-full max-w-[1560px] flex-col items-start justify-between gap-3 px-4 font-code text-[10px] text-ink-500 sm:flex-row sm:items-center sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold tracking-[0.16em] text-ink-600 dark:text-ink-600">QUORUM TENDER ENGINE</span>
            <span className="text-ink-300 dark:text-ink-400">|</span>
            <span>
              Applications attested as <span className="text-ink-700 dark:text-ink-700">org:{org.name}</span> · filing
              times in UTC
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" /> Portal online
            </span>
            <Link href="/" className="transition-colors hover:text-ink-900 dark:hover:text-white">
              Officer desk ↗
            </Link>
          </div>
        </div>
      </footer>

      {/* Mobile drawer — the same rail, off-canvas */}
      <AnimatePresence>
        {navOpen ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[60] bg-ink-950/60 backdrop-blur-sm lg:hidden"
              onClick={() => setNavOpen(false)}
              aria-hidden="true"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.3, ease: EASE }}
              className="fixed inset-y-0 left-0 z-[61] flex w-[286px] flex-col border-r border-ink-200 bg-paper lg:hidden dark:border-white/10 dark:bg-night"
              aria-label="Supplier console menu"
            >
              <div className="flex items-center justify-between px-4 pb-2 pt-4">
                <Link href="/" aria-label="Quorum home" className="rounded-xl" onClick={() => setNavOpen(false)}>
                  <span className="hidden dark:inline-flex">
                    <QuorumLogo variant="light" tagline={false} />
                  </span>
                  <span className="dark:hidden">
                    <QuorumLogo tagline={false} />
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => setNavOpen(false)}
                  aria-label="Close console menu"
                  className="grid h-9 w-9 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900 dark:text-ink-400 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <ConsoleSidebar
                  orgName={org.name}
                  orgStatus={org.status}
                  registrationNo={org.registrationNo}
                  tabs={TABS}
                  active={tab}
                  onNavigate={(next) => {
                    setProfileFocus(null);
                    setTab(next);
                    setNavOpen(false);
                  }}
                  onSignOut={signOut}
                />
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {paletteOpen ? (
          <SearchPalette
            tenders={tenders}
            applications={applications}
            onClose={() => setPaletteOpen(false)}
            onBrowseTender={(t) => viewTender(t.ref)}
            onTab={(next) => setTab(next)}
          />
        ) : null}
      </AnimatePresence>

      {applying ? <ApplyDialog tender={applying} onClose={() => setApplying(null)} onFiled={onFiled} /> : null}
    </div>
  );
}
