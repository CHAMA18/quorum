"use client";

/**
 * MuseAssistant — the text chat bubble for the desk screens.
 *
 * One floating button, bottom right, over the workspace, the docs and the
 * org portal — never the public landing page or the auth door. Press it and
 * you get a text chat panel:
 *
 *   · thinking — the sentence goes to /api/muse/chat, where the desk agent
 *     runs an agentic loop: reads (runs, approvals, deadlines, the committee
 *     register, one tender's record) execute at once, and a review assignment
 *     comes back as an HMAC-signed proposal card. A full LLM brain answers
 *     whenever Meta Muse is configured, with
 *     a deterministic local brain otherwise — the panel never shows a setup notice.
 *   · acting   — a proposal card waits for the signed-in user. The server
 *     checks their role and confirmation before it assigns a review. Final
 *     procurement decisions remain in the human Approvals workflow.
 *
 * The agent can do permitted preparatory work, but it never holds the gavel.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import { Ban, Check, ChevronRight, CircleHelp, MessageSquare, Send, ShieldAlert, X } from "lucide-react";
import type { Proposal } from "@/lib/muse-actions";
import { cn } from "@/lib/utils";
import { nextRovingTabIndex } from "@/lib/a11y";

const EASE = [0.22, 1, 0.36, 1] as const;

type ProposalState = "pending" | "confirmed" | "declined" | "executed" | "failed";
type Turn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  proposal?: Proposal;
  proposalState?: ProposalState;
};
type BarrySupportRequest = {
  id: string;
  subject: string;
  message: string;
  status: "OPEN" | "RESPONDED" | "CLOSED";
  response: string | null;
  respondedBy: string | null;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const SUGGESTIONS = [
  "What is waiting at the gate?",
  "Is quorum present?",
  "Explain the evidence on a pending gate",
  "What can you investigate for me?",
];

type AssistantSection = "chat" | "support";

/* ── The bubble ───────────────────────────────────────────────────────────── */

let turnSeq = 0;
const nextId = () => `t${++turnSeq}`;

export function MuseAssistant({ name }: { name?: string }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<AssistantSection>("chat");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [supportRequests, setSupportRequests] = useState<BarrySupportRequest[]>([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportSending, setSupportSending] = useState(false);
  const [supportSubject, setSupportSubject] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportError, setSupportError] = useState<string | null>(null);
  const [supportNotice, setSupportNotice] = useState<string | null>(null);

  const assistantSections: AssistantSection[] = ["chat", "support"];
  const handleAssistantTabKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const next = nextRovingTabIndex(event.key, assistantSections.indexOf(section), assistantSections.length);
    if (next === null) return;
    event.preventDefault();
    const nextSection = assistantSections[next];
    setSection(nextSection);
    requestAnimationFrame(() => document.getElementById(`barry-tab-${nextSection}`)?.focus());
  };

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const supportLoadSequenceRef = useRef(0);
  const supportMutationVersionRef = useRef(0);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: reduce ? "auto" : "smooth",
    });
  }, [turns, busy, open, reduce]);

  useEffect(() => {
    if (open) {
      if (!wasOpenRef.current) {
        const active = document.activeElement;
        returnFocusRef.current = active instanceof HTMLElement ? active : launcherRef.current;
      }
      wasOpenRef.current = true;
      const timer = window.setTimeout(() => inputRef.current?.focus(), reduce ? 0 : 220);
      return () => window.clearTimeout(timer);
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    const target = returnFocusRef.current;
    if (!target) return;
    const timer = window.setTimeout(() => {
      if (target.isConnected) target.focus();
      if (returnFocusRef.current === target) returnFocusRef.current = null;
    }, reduce ? 0 : 280);
    return () => window.clearTimeout(timer);
  }, [open, reduce]);

  const shut = useCallback(() => setOpen(false), []);

  /* Esc closes the panel. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") shut();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, shut]);

  const loadSupportRequests = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++supportLoadSequenceRef.current;
    const mutationVersion = supportMutationVersionRef.current;
    setSupportLoading(true);
    try {
      const res = await fetch("/api/support/requests", { cache: "no-store", signal });
      const body = (await res.json().catch(() => ({}))) as { requests?: BarrySupportRequest[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Your support requests could not be loaded.");
      if (sequence === supportLoadSequenceRef.current && mutationVersion === supportMutationVersionRef.current) {
        setSupportRequests(Array.isArray(body.requests) ? body.requests : []);
        setSupportError(null);
      }
    } catch (error) {
      if (signal?.aborted) return;
      if (sequence === supportLoadSequenceRef.current && mutationVersion === supportMutationVersionRef.current) {
        setSupportError((error as Error).message || "Your support requests could not be loaded.");
      }
    } finally {
      if (!signal?.aborted && sequence === supportLoadSequenceRef.current) setSupportLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || section !== "support") return;
    const controller = new AbortController();
    void loadSupportRequests(controller.signal);
    const timer = window.setInterval(() => void loadSupportRequests(), 30_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [open, section, loadSupportRequests]);

  const sendSupportRequest = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (supportSending) return;
    setSupportSending(true);
    setSupportError(null);
    setSupportNotice(null);
    try {
      const res = await fetch("/api/support/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: supportSubject.trim(), message: supportMessage.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { request?: BarrySupportRequest; error?: string };
      if (!res.ok || !body.request) throw new Error(body.error ?? "Your support request could not be sent.");
      supportMutationVersionRef.current += 1;
      setSupportSubject("");
      setSupportMessage("");
      setSupportRequests((current) => [body.request!, ...current.filter((request) => request.id !== body.request!.id)]);
      setSupportNotice("Request sent. A workspace admin will reply here.");
    } catch (error) {
      setSupportError((error as Error).message || "Your support request could not be sent.");
    } finally {
      setSupportSending(false);
    }
  }, [supportMessage, supportSending, supportSubject]);

  /* ── Asking ─────────────────────────────────────────────────────────────── */

  const ask = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setDraft("");
      const mine: Turn = { id: nextId(), role: "user", text };
      const history = turns.slice(-6).map((t) => ({ role: t.role, content: t.text }));
      setTurns((prev) => [...prev, mine]);
      setBusy(true);
      try {
        const res = await fetch("/api/muse/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: text,
            history,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          reply?: string;
          proposal?: Proposal;
          error?: string;
        };
        const reply = (data.reply ?? data.error ?? "I could not answer that just now.").trim();
        setTurns((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            text: reply,
            ...(data.proposal ? { proposal: data.proposal, proposalState: "pending" as const } : {}),
          },
        ]);
      } catch {
        const note =
          "The assistant service is not answering right now. Nothing on the desk changed — try again in a moment.";
        setTurns((prev) => [...prev, { id: nextId(), role: "assistant", text: note }]);
      } finally {
        setBusy(false);
      }
    },
    [busy, turns]
  );

  /* ── Acting: consent first, always ───────────────────────────────────── */

  const patchTurn = useCallback((id: string, patch: Partial<Turn>) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const say = useCallback((text: string) => {
    setTurns((prev) => [...prev, { id: nextId(), role: "assistant", text }]);
  }, []);

  const confirmProposal = useCallback(
    async (turnId: string, proposal: Proposal) => {
      if (confirmingId) return;
      setConfirmingId(turnId);
      patchTurn(turnId, { proposalState: "confirmed" });
      try {
        /* The server resolves identity and permissions from the signed-in session. */
        const me = await fetch("/api/auth/me")
          .then((r) => r.json())
          .catch(() => null);
        if (!me?.user) {
          patchTurn(turnId, { proposalState: "pending" });
          say("Sign in to Quorum first. The server checks your workspace role before it starts an assigned review.");
          return;
        }

        const res = await fetch("/api/muse/execute", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ proposal, consent: true }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          executed?: boolean;
          headline?: string;
          detail?: string[];
          tool?: string;
          error?: string;
        };
        if (res.ok && data.executed) {
          patchTurn(turnId, { proposalState: "executed" });
          setTurns((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "assistant",
              text: data.headline ?? "Done.",
            },
          ]);
        } else {
          patchTurn(turnId, { proposalState: "failed" });
          say(`${data.error ?? "The desk refused the action."} Nothing changed.`);
        }
      } catch {
        patchTurn(turnId, { proposalState: "failed" });
        say("The execution service did not answer — nothing changed. Try confirming again in a moment.");
      } finally {
        setConfirmingId(null);
      }
    },
    [confirmingId, patchTurn, say]
  );

  const declineProposal = useCallback(
    (turnId: string) => {
      patchTurn(turnId, { proposalState: "declined" });
      say("Declined. The proposal is void — nothing on the desk moved, and the audit trail stays exactly as it was.");
    },
    [patchTurn, say]
  );

  /* ── Render ─────────────────────────────────────────────────────────────── */

  return (
    <>
      {/* The launcher — always reachable, never in the way of the page's own controls */}
      <motion.button
        ref={launcherRef}
        type="button"
        onClick={() => {
          if (open) {
            shut();
          } else {
            setSection("chat");
            setOpen(true);
          }
        }}
        aria-label={open ? "Close the desk assistant" : "Open the desk assistant"}
        aria-expanded={open}
        title={open ? "Close Barry" : "Ask Barry"}
        className="focus-brand group fixed bottom-5 right-5 z-[75] grid h-14 w-14 place-items-center rounded-full bg-brand-600 p-0 text-white shadow-[0_1px_0_rgba(255,255,255,0.18)_inset,0_18px_40px_-16px_rgba(217,38,22,0.85)] transition-colors hover:bg-brand-700 sm:bottom-7 sm:right-7"
        whileHover={reduce ? undefined : { y: -2 }}
        whileTap={reduce ? undefined : { scale: 0.97 }}
      >
        <Image
          src="/logo.svg"
          width={38}
          height={38}
          alt=""
          aria-hidden="true"
          unoptimized
          className="h-[38px] w-[38px] rounded-[9px] transition-transform group-hover:scale-105"
        />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="muse-panel"
            initial={reduce ? false : { opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            transition={reduce ? { duration: 0 } : { duration: 0.26, ease: EASE }}
            role="dialog"
            aria-label="Barry — Quorum AI assistant"
            className="muse-assistant fixed bottom-[88px] right-3 z-[76] flex h-[min(680px,calc(100dvh-112px))] w-[min(400px,calc(100vw-24px))] flex-col overflow-hidden rounded-[24px] border border-black/[0.06] bg-white text-[#202124] shadow-[0_24px_80px_-20px_rgba(24,39,75,0.28)] dark:border-white/10 dark:bg-[#0c0d10] dark:text-ink-900 sm:right-7"
          >
            <header className="relative flex shrink-0 items-center justify-between gap-3 bg-brand-700 px-5 py-4 text-white dark:bg-brand-600">
              <div className="flex min-w-0 items-center gap-3">
                <Image
                  src="/logo.svg"
                  width={44}
                  height={44}
                  alt=""
                  aria-hidden="true"
                  unoptimized
                  className="h-11 w-11 shrink-0 rounded-[14px] border border-white/20 shadow-sm"
                />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold tracking-[-0.01em]">Quorum</p>
                  <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-white/75">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" aria-hidden="true" />
                    Barry is here to help
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={shut}
                  aria-label="Close the assistant"
                  className="focus-brand grid h-11 w-11 place-items-center rounded-full text-white/90 transition-colors hover:bg-white/15 hover:text-white"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </header>

            <div
              ref={scrollerRef}
              className="relative min-h-0 flex-1 overflow-y-auto bg-[#f7f8fa] px-4 py-5 [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar]:w-1 dark:bg-[#0c0d10]"
              aria-live="polite"
            >
              {section === "chat" ? (
                <div id="barry-panel-chat" role="tabpanel" aria-labelledby="barry-tab-chat" className="space-y-5">
                  {turns.length === 0 && (
                    <div className="space-y-5">
                      <div className="flex items-start gap-2.5">
                        <Image
                          src="/logo.svg"
                          width={32}
                          height={32}
                          alt=""
                          aria-hidden="true"
                          unoptimized
                          className="mt-5 h-8 w-8 shrink-0 rounded-[10px] shadow-sm"
                        />
                        <div className="min-w-0">
                          <p className="mb-1.5 text-[11px] font-medium text-[#73777f] dark:text-ink-500">Barry · Quorum</p>
                          <div className="rounded-2xl rounded-tl-md border border-[#e8e9ec] bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(20,25,35,0.04)] dark:border-white/10 dark:bg-[#14161b]">
                            <p className="text-[14px] font-semibold leading-snug text-[#25272b] dark:text-white">
                              Hi{name ? ` ${name.split(" ")[0]}` : " there"}! How can I help?
                            </p>
                            <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#62666e] dark:text-ink-600">
                              Ask me about tenders, approvals, your committee, or the workspace.
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="pl-[42px]">
                        <p className="mb-2 text-[11px] font-medium text-[#858991] dark:text-ink-500">A few things you can ask</p>
                        <div className="space-y-2">
                          {SUGGESTIONS.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => void ask(s)}
                              className="focus-brand group flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-[#e6e8eb] bg-white px-3.5 py-3 text-left text-[12px] font-medium text-[#363a40] shadow-[0_1px_2px_rgba(20,25,35,0.03)] transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:border-white/10 dark:bg-[#14161b] dark:text-ink-700 dark:hover:border-brand-500/40 dark:hover:bg-white/[0.06]"
                            >
                              <span>{s}</span>
                              <ChevronRight className="h-4 w-4 shrink-0 text-[#9a9ea5] transition-transform group-hover:translate-x-0.5 group-hover:text-brand-700 dark:text-ink-500 dark:group-hover:text-brand-300" aria-hidden="true" />
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {turns.map((t) => (
                    <div key={t.id} className={cn("flex items-end gap-2", t.role === "user" ? "justify-end" : "justify-start")}>
                      {t.role === "assistant" && (
                        <Image
                          src="/logo.svg"
                          width={28}
                          height={28}
                          alt=""
                          aria-hidden="true"
                          unoptimized
                          className="mb-1 h-7 w-7 shrink-0 rounded-[9px] shadow-sm"
                        />
                      )}
                      <div className={cn("flex max-w-[86%] min-w-0 flex-col", t.role === "user" ? "items-end" : "items-start")}>
                        {t.role === "assistant" && <p className="mb-1.5 ml-1 text-[10.5px] font-medium text-[#73777f] dark:text-ink-500">Barry</p>}
                        <div
                          className={cn(
                            "max-w-full rounded-2xl px-3.5 py-3 shadow-[0_1px_2px_rgba(20,25,35,0.05)]",
                            t.role === "user"
                              ? "rounded-br-md bg-brand-700 text-white"
                              : "rounded-bl-md border border-[#e8e9ec] bg-white text-[#292c31] dark:border-white/10 dark:bg-[#14161b] dark:text-ink-800"
                          )}
                        >
                          <p className="whitespace-pre-wrap text-[13px] leading-[1.55]">{t.text}</p>

                          {/* Staged actions remain explicit and consent-gated. */}
                          {t.proposal && (
                            <div className="mt-3 overflow-hidden rounded-xl border border-brand-200 bg-[#fffafa] dark:border-brand-500/30 dark:bg-[#1a1517]">
                              <div className="flex items-start justify-between gap-2 border-b border-brand-100 bg-brand-50 px-3 py-2 dark:border-brand-500/20 dark:bg-brand-500/10">
                                <span className="flex items-center gap-1.5 text-[10px] font-semibold leading-snug text-brand-900">
                                  <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  Review assignment · confirmation required
                                </span>
                                <span className="inline-flex min-h-6 shrink-0 items-center rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[#6b4650] dark:bg-white/10 dark:text-brand-300">
                                  Agent task
                                </span>
                              </div>
                              <div className="p-3">
                                <p className="text-[12px] font-semibold leading-snug text-[#292c31] dark:text-white">{t.proposal.label}</p>
                                <p className="mt-1.5 text-[11px] leading-relaxed text-[#62666e] dark:text-ink-600">
                                  Quorum will analyze the tender and prepare cited findings. An authorized human keeps every final decision.
                                </p>
                                <div className="mt-2 space-y-1">
                                  {t.proposal.summary.map((row) => (
                                    <p key={row.key} className="text-[10px] leading-relaxed text-[#62666e] dark:text-ink-600">
                                      <span className="font-medium text-[#454950] dark:text-ink-700">{row.key}</span>: {row.value}
                                    </p>
                                  ))}
                                </div>
                                {t.proposalState === "pending" && (
                                  <div className="mt-3 flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => void confirmProposal(t.id, t.proposal!)}
                                      disabled={!!confirmingId}
                                      className="focus-brand min-h-11 flex-1 rounded-full bg-brand-700 px-3 text-[12px] font-semibold text-white transition-colors hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      {confirmingId === t.id ? "Assigning…" : "Assign review"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => declineProposal(t.id)}
                                      disabled={!!confirmingId}
                                      className="focus-brand min-h-11 rounded-full border border-[#d9dbe0] bg-white px-3 text-[12px] font-medium text-[#50545b] transition-colors hover:bg-[#f5f6f8] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-white/[0.04] dark:text-ink-700 dark:hover:bg-white/[0.08]"
                                    >
                                      Decline
                                    </button>
                                  </div>
                                )}
                                {t.proposalState === "confirmed" && <p className="mt-2 text-[11px] font-medium text-brand-800">Confirmed · running…</p>}
                                {t.proposalState === "executed" && <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-emerald-700"><Check className="h-3.5 w-3.5" aria-hidden="true" />Completed · receipt added</p>}
                                {t.proposalState === "declined" && <p className="mt-2 text-[11px] text-[#686c74] dark:text-ink-500">Declined · nothing changed</p>}
                                {t.proposalState === "failed" && <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-brand-800"><ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />Action could not be completed</p>}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

              {busy && (
                <div className="flex items-end gap-2">
                  <Image src="/logo.svg" width={28} height={28} alt="" aria-hidden="true" unoptimized className="h-7 w-7 rounded-[9px] shadow-sm" />
                  <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-[#e8e9ec] bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(20,25,35,0.05)] dark:border-white/10">
                    {[0, 1, 2].map((i) => (
                      <motion.span
                        key={i}
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full bg-brand-600"
                        animate={reduce ? undefined : { opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
                        transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
                      />
                    ))}
                    <span className="ml-1 text-[11px] text-[#747881] dark:text-ink-500">Barry is typing</span>
                  </div>
                </div>
              )}

                </div>
              ) : null}
              {section === "support" ? (
                <section id="barry-panel-support" role="tabpanel" aria-labelledby="barry-tab-support" className="space-y-3.5">
                  <div className="rounded-[20px] bg-brand-700 p-5 text-white shadow-[0_8px_22px_rgba(130,25,20,0.16)] dark:bg-brand-600">
                    <p className="text-[11px] font-medium text-white/70">Quorum support</p>
                    <h3 className="mt-1 text-[21px] font-semibold tracking-[-0.02em]">How can we help?</h3>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-white/80">
                      Find a quick answer or start a conversation with Barry.
                    </p>
                  </div>
                  <a
                    href="/docs"
                    className="group flex items-center gap-3 rounded-2xl border border-[#e6e8eb] bg-white p-4 shadow-[0_1px_2px_rgba(20,25,35,0.04)] transition-colors hover:border-brand-300 dark:border-white/10 dark:bg-[#14161b] dark:hover:border-brand-500/40"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#f3f4f6] text-[#555b64] dark:bg-white/[0.06] dark:text-ink-600">
                      <CircleHelp className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-semibold text-[#30343a] dark:text-ink-800">Browse the Quorum guide</span>
                      <span className="mt-0.5 block text-[11px] text-[#777c84] dark:text-ink-500">Setup, tenders, approvals and more</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[#9a9ea5] transition-transform group-hover:translate-x-0.5 group-hover:text-brand-700 dark:text-ink-500 dark:group-hover:text-brand-300" aria-hidden="true" />
                  </a>
                  <button
                    type="button"
                    onClick={() => setSection("chat")}
                    className="group flex w-full items-center gap-3 rounded-2xl border border-[#e6e8eb] bg-white p-4 text-left shadow-[0_1px_2px_rgba(20,25,35,0.04)] transition-colors hover:border-brand-300 dark:border-white/10 dark:bg-[#14161b] dark:hover:border-brand-500/40"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300">
                      <MessageSquare className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-semibold text-[#30343a] dark:text-ink-800">Message Barry</span>
                      <span className="mt-0.5 block text-[11px] text-[#777c84] dark:text-ink-500">Ask about work in your Quorum workspace</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[#9a9ea5] transition-transform group-hover:translate-x-0.5 group-hover:text-brand-700 dark:text-ink-500 dark:group-hover:text-brand-300" aria-hidden="true" />
                  </button>
                  <form
                    onSubmit={(event) => void sendSupportRequest(event)}
                    className="space-y-3 rounded-2xl border border-[#e6e8eb] bg-white p-4 shadow-[0_1px_2px_rgba(20,25,35,0.04)] dark:border-white/10 dark:bg-[#14161b]"
                  >
                    <div>
                      <h4 className="text-[12px] font-semibold text-[#30343a] dark:text-ink-800">Send a manual support request</h4>
                      <p className="mt-1 text-[11px] leading-relaxed text-[#777c84] dark:text-ink-500">
                        A workspace admin will reply in this Support tab.
                      </p>
                    </div>
                    <label className="block space-y-1.5">
                        <span className="text-[11px] font-semibold text-[#50545b] dark:text-ink-600">Subject</span>
                      <input
                        value={supportSubject}
                        onChange={(event) => setSupportSubject(event.target.value)}
                        required
                        minLength={4}
                        maxLength={120}
                        placeholder="What do you need help with?"
                        className="focus-brand h-11 w-full rounded-xl border border-[#e6e8eb] bg-[#f7f8fa] px-3 text-[14px] text-[#26292e] outline-none transition-colors placeholder:text-ink-400 focus:border-brand-400 focus:bg-white dark:border-white/10 dark:bg-[#0c0d10] dark:text-ink-800 dark:placeholder:text-ink-500 dark:focus:bg-[#14161b]"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-[11px] font-semibold text-[#50545b] dark:text-ink-600">Message</span>
                      <textarea
                        value={supportMessage}
                        onChange={(event) => setSupportMessage(event.target.value)}
                        required
                        minLength={12}
                        maxLength={2000}
                        rows={4}
                        placeholder="Describe what happened and what you need…"
                        className="focus-brand w-full resize-y rounded-xl border border-[#e6e8eb] bg-[#f7f8fa] px-3 py-2.5 text-[14px] leading-relaxed text-[#26292e] outline-none transition-colors placeholder:text-ink-400 focus:border-brand-400 focus:bg-white dark:border-white/10 dark:bg-[#0c0d10] dark:text-ink-800 dark:placeholder:text-ink-500 dark:focus:bg-[#14161b]"
                      />
                    </label>
                    {supportError ? <p role="alert" className="text-[11px] leading-relaxed text-red-700 dark:text-red-300">{supportError}</p> : null}
                    {supportNotice ? <p role="status" className="text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-300">{supportNotice}</p> : null}
                    <button
                      type="submit"
                      disabled={supportSending || supportSubject.trim().length < 4 || supportMessage.trim().length < 12}
                      className="focus-brand inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-brand-700 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Send className="h-3.5 w-3.5" aria-hidden="true" />
                      {supportSending ? "Sending request…" : "Send support request"}
                    </button>
                  </form>

                  <section aria-label="Your support requests" className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2 px-1">
                      <h4 className="text-[11px] font-semibold text-[#30343a] dark:text-ink-800">Your requests</h4>
                      <button
                        type="button"
                        onClick={() => void loadSupportRequests()}
                        disabled={supportLoading}
                        className="focus-brand inline-flex min-h-11 items-center rounded-lg px-2 text-[12px] font-semibold text-brand-800 hover:underline disabled:opacity-50 dark:text-brand-300"
                      >
                        {supportLoading ? "Refreshing…" : "Refresh"}
                      </button>
                    </div>
                    {supportRequests.length ? supportRequests.map((request) => (
                      <article key={request.id} className="rounded-2xl border border-[#e6e8eb] bg-white p-4 shadow-[0_1px_2px_rgba(20,25,35,0.04)] dark:border-white/10 dark:bg-[#14161b]">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h5 className="break-words text-[12px] font-semibold text-[#30343a] dark:text-ink-800">{request.subject}</h5>
                            <p className="mt-1 text-[10px] text-[#737983] dark:text-ink-400">
                              {new Date(request.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                            </p>
                          </div>
                          <span className={cn(
                            "inline-flex min-h-6 shrink-0 items-center rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em]",
                            request.status === "OPEN"
                              ? "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200"
                              : request.status === "RESPONDED"
                                ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200"
                                : "bg-[#f3f4f6] text-[#686c74] dark:bg-white/[0.06] dark:text-ink-500",
                          )}>{request.status === "OPEN" ? "Waiting" : request.status === "RESPONDED" ? "Replied" : "Closed"}</span>
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-[11px] leading-relaxed text-[#62666e] dark:text-ink-600">{request.message}</p>
                        {request.response ? (
                          <div className="mt-3 rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-3 py-2.5 dark:border-emerald-500/20 dark:bg-emerald-500/[0.05]">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-800 dark:text-emerald-300">
                              Reply from {request.respondedBy ?? "Quorum Support"}
                            </p>
                            <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed text-[#454950] dark:text-ink-700">{request.response}</p>
                          </div>
                        ) : null}
                      </article>
                    )) : supportLoading ? (
                      <p className="rounded-xl border border-dashed border-[#dfe1e5] px-3 py-4 text-center text-[11px] text-[#777c84] dark:border-white/10 dark:text-ink-500">Loading your requests…</p>
                    ) : supportError ? (
                      <p className="rounded-xl border border-dashed border-[#dfe1e5] px-3 py-4 text-center text-[11px] text-[#777c84] dark:border-white/10 dark:text-ink-500">Sign in to see replies and manage your support requests.</p>
                    ) : (
                      <p className="rounded-xl border border-dashed border-[#dfe1e5] px-3 py-4 text-center text-[11px] text-[#777c84] dark:border-white/10 dark:text-ink-500">No requests yet. Send one above and replies will appear here.</p>
                    )}
                  </section>
                  <p className="px-1 pt-1 text-[11px] leading-relaxed text-[#777c84] dark:text-ink-500">
                    Barry can prepare actions for review. You always approve them before anything changes.
                  </p>
                </section>
              ) : null}
            </div>

            {/* Composer */}
            {section === "chat" ? <div className="relative border-t border-[#eceef0] bg-white px-3.5 py-3 dark:border-white/10">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(draft);
                }}
                className="flex items-center gap-2"
              >
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Write a message…"
                  disabled={busy}
                  maxLength={2000}
                  className="h-11 min-w-0 flex-1 rounded-full border border-[#e6e8eb] bg-[#f7f8fa] px-4 text-base text-[#26292e] outline-none transition-colors placeholder:text-ink-400 focus:border-brand-400 focus:bg-white disabled:opacity-60 dark:border-white/10 dark:bg-[#0c0d10] dark:text-ink-800 dark:placeholder:text-ink-500 dark:focus:border-brand-400 dark:focus:bg-[#14161b] sm:text-[13px]"
                />
                <button
                  type="submit"
                  disabled={busy || !draft.trim()}
                  aria-label="Send the question"
                  className="focus-brand grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-700 text-white shadow-sm transition-colors hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                </button>
              </form>
            </div> : null}

            <nav role="tablist" aria-label="Chat and support" onKeyDown={handleAssistantTabKeyDown} className="grid shrink-0 grid-cols-2 border-t border-[#eceef0] bg-white px-5 py-1.5 dark:border-white/10">
              {([
                { id: "chat", label: "Chat", Icon: MessageSquare },
                { id: "support", label: "Support", Icon: CircleHelp },
              ] as const).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`barry-tab-${id}`}
                  aria-selected={section === id}
                  aria-controls={section === id ? `barry-panel-${id}` : undefined}
                  tabIndex={section === id ? 0 : -1}
                  onClick={() => setSection(id)}
                  className={cn(
                    "focus-brand flex h-[52px] flex-col items-center justify-center gap-1 rounded-xl text-[12px] font-medium transition-colors",
                    section === id ? "text-brand-800" : "text-[#898e96] hover:bg-[#f7f8fa] hover:text-[#464a51] dark:text-ink-500 dark:hover:bg-white/[0.06] dark:hover:text-ink-700",
                  )}
                >
                  <Icon className={cn("h-[18px] w-[18px]", section === id && "fill-brand-100")} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>

    </>
  );
}
