"use client";

/**
 * TenderPackPreview — read the ENTIRE tender pack before staging it.
 *
 * Sample packs are real documents shipped with the stack; the agent reads
 * exactly these files over MCP during a review. This viewer serves the same
 * bytes to the human — the pack's metadata card plus every document in full
 * (notice, bids, awards), fetched read-only from the quorum-mcp sidecar via
 * the same-origin gateway (XTransformPort=3031).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BookOpen, FileText, Loader2, ScanSearch, X } from "lucide-react";
import { HorizontalScrollRegion } from "@/components/quorum/horizontal-scroll-region";
import { trapTabFocus } from "@/lib/a11y";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;

export interface TenderPackRow {
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
}

/** Human label for a pack file — 01-… is the notice, 0N-bid-x is a bid, rest speak for themselves. */
function docLabel(file: string): { kind: string; name: string } {
  const stem = file.replace(/\.md$/i, "");
  const bid = stem.match(/^0\d-bid-(.+)$/i);
  if (bid) return { kind: "BID", name: bid[1].replace(/[-_]+/g, " ").toUpperCase() };
  if (/^01-/.test(stem)) return { kind: "TENDER NOTICE", name: stem.replace(/^01-/, "").replace(/[-_]+/g, " ").toUpperCase() };
  if (/^0\d-award/i.test(stem)) return { kind: "AWARD", name: stem.replace(/^0\d-/, "").replace(/[-_]+/g, " ").toUpperCase() };
  return { kind: "DOCUMENT", name: stem.replace(/[-_]+/g, " ").toUpperCase() };
}

/* ── minimal, dependency-free markdown rendering ────────────────────────────
   The packs use a small, consistent dialect: #/##/### headings, **bold**,
   "- " bullets, "- [REQUIRED]" checklist items and | pipe tables. Rendered
   with the desk's own tokens so a human reads the same evidence the agent
   parses — no reformatting pipeline in between. */

function renderInline(text: string, keyBase: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) => {
    if (chunk.startsWith("**") && chunk.endsWith("**") && chunk.length > 4) {
      return (
        <strong key={`${keyBase}-b${i}`} className="font-semibold text-ink-950">
          {chunk.slice(2, -2)}
        </strong>
      );
    }
    return <span key={`${keyBase}-s${i}`}>{chunk}</span>;
  });
}

function DocMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    /* headings */
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const content = renderInline(heading[2], `h${key}`);
      blocks.push(
        level === 1 ? (
          <h4 key={key++} className="mt-1 font-display text-[16px] font-black tracking-[-0.01em] text-ink-950">
            {content}
          </h4>
        ) : (
          <p key={key++} className={cn("mt-1 font-code font-bold tracking-[0.06em] text-ink-950", level === 2 ? "text-[12px]" : "text-[11px]")}>
            {content}
          </p>
        ),
      );
      i += 1;
      continue;
    }

    /* pipe tables */
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) rows.push(cells);
        i += 1;
      }
      if (rows.length > 0) {
        const [head, ...body] = rows;
        blocks.push(
          <HorizontalScrollRegion key={key++} label="Tender pack document table" className="mt-1 rounded-lg border border-ink-200">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-paper">
                  {head.map((c, ci) => (
                    <th key={ci} className="border-b border-ink-200 px-2.5 py-2 font-code text-[10px] font-bold tracking-[0.1em] text-ink-500">
                      {renderInline(c, `th${ci}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((r, ri) => (
                  <tr key={ri} className="odd:bg-paper/40">
                    {r.map((c, ci) => (
                      <td key={ci} className="border-b border-ink-100 px-2.5 py-2 text-[12.5px] leading-relaxed text-ink-800">
                        {renderInline(c, `td${ri}-${ci}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </HorizontalScrollRegion>,
        );
      }
      continue;
    }

    /* list blocks — bullets and [REQUIRED] checklist items */
    if (/^\s*-\s+/.test(line)) {
      const items: { text: string; required: boolean }[] = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        const raw = lines[i].replace(/^\s*-\s+/, "");
        const required = /^\[REQUIRED\]/i.test(raw.trim());
        items.push({ text: required ? raw.trim().replace(/^\[REQUIRED\]\s*/i, "") : raw, required });
        i += 1;
      }
      blocks.push(
        <ul key={key++} className="mt-1 space-y-1">
          {items.map((it, ii) => (
            <li key={ii} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-700">
              {it.required ? (
                <span className="mt-0.5 shrink-0 rounded bg-brand-600 px-1.5 py-0.5 font-code text-[10px] font-bold tracking-[0.06em] text-white">
                  REQUIRED
                </span>
              ) : (
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-300" aria-hidden="true" />
              )}
              <span className="min-w-0">{renderInline(it.text, `li${ii}`)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    /* paragraph */
    blocks.push(
      <p key={key++} className="mt-1 text-[12.5px] leading-[1.7] text-ink-700">
        {renderInline(line, `p${key}`)}
      </p>,
    );
    i += 1;
  }

  return <div className="space-y-2.5">{blocks}</div>;
}

export function TenderPackPreview({
  sample,
  onClose,
  onStage,
  onReturnFocusFallback,
}: {
  sample: TenderPackRow | null;
  onClose: () => void;
  /** Stage the pack being previewed (closes the viewer). */
  onStage: (s: TenderPackRow) => void;
  /** Used if the preview trigger is removed while staging the pack. */
  onReturnFocusFallback?: () => void;
}) {
  const open = !!sample;
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const docRequestRef = useRef(0);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const fallbackFocusRef = useRef(onReturnFocusFallback);
  const reduceMotion = useReducedMotion();
  fallbackFocusRef.current = onReturnFocusFallback;

  /* Return to the preview trigger after the sheet finishes closing. */
  useEffect(() => {
    if (open) {
      if (!wasOpenRef.current) {
        const active = document.activeElement;
        returnFocusRef.current = active instanceof HTMLElement ? active : null;
      }
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    const timer = window.setTimeout(() => {
      if (target?.isConnected) target.focus();
      else fallbackFocusRef.current?.();
    }, reduceMotion ? 0 : 220);
    return () => window.clearTimeout(timer);
  }, [open, reduceMotion]);

  /* Reset the reader whenever a different pack opens; default to the notice. */
  useEffect(() => {
    if (sample) {
      setSelected(sample.files[0] ?? null);
      setText(null);
      setError(null);
      /* focus the close button so keyboard users land inside the sheet */
      requestAnimationFrame(() => closeRef.current?.focus());
    }
  }, [sample]);

  const fetchDoc = useCallback(async (ref: string, file: string) => {
    const requestId = ++docRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/sample-tenders/${encodeURIComponent(ref)}/docs/${encodeURIComponent(file)}?XTransformPort=3031`,
      );
      if (!res.ok) throw new Error(`sidecar ${res.status}`);
      const data = (await res.json()) as { doc?: { name: string; text: string } };
      if (!data.doc?.text) throw new Error("empty");
      if (requestId !== docRequestRef.current) return;
      setText(data.doc.text);
    } catch {
      if (requestId !== docRequestRef.current) return;
      setText(null);
      setError("THIS DOCUMENT COULD NOT BE READ — THE AGENT STACK MAY BE OFFLINE. RETRY OR PICK ANOTHER FILE.");
    } finally {
      if (requestId === docRequestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!sample || !selected) {
      docRequestRef.current += 1;
      setLoading(false);
      return;
    }
    setText(null);
    fetchDoc(sample.ref, selected);
    return () => {
      docRequestRef.current += 1;
    };
  }, [sample, selected, fetchDoc]);

  /* Escape closes — consistent with the desk's other sheets. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const totalChars = useMemo(() => (text ? text.length : 0), [text]);

  /* Portalled to document.body: the New Run sheet animates scale, and a
     fixed-position descendant of a transformed ancestor would be trapped
     inside it. The portal keeps the overlay truly viewport-fixed. */
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {sample && (
        <motion.div
          key="tender-pack-preview"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.2 }}
          className="fixed inset-0 z-[85] grid place-items-center bg-night/70 p-3 backdrop-blur-sm sm:p-4"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tender-pack-preview-title"
        >
          <motion.div
            ref={cardRef}
            initial={reduceMotion ? false : { opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.28, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(event) => trapTabFocus(event, cardRef.current)}
            className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-[12px] panel shadow-[0_30px_80px_rgba(11,12,15,0.35)]"
          >
            {/* ── header ── */}
            <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4 sm:px-7 sm:py-5">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-code text-[10px] font-semibold tracking-[0.16em] text-ink-400">
                  <ScanSearch className="h-3 w-3 text-brand-600" aria-hidden="true" />
                  TENDER PACK PREVIEW · READ-ONLY
                </p>
                <h3
                  id="tender-pack-preview-title"
                  className="mt-1 flex flex-wrap items-center gap-2 font-display text-[20px] font-black tracking-[-0.015em] text-ink-950 sm:text-[22px]"
                >
                  <span className="font-code text-[10px] font-bold tracking-[0.12em] text-ink-500">BUILT-IN SAMPLE PACK</span>
                  <span className="rounded-full bg-ink-950 px-2 py-1 font-code text-[10px] font-bold tracking-[0.1em] text-white">
                    {sample.sector}
                  </span>
                </h3>
                <p className="mt-0.5 truncate text-[13px] font-medium text-ink-800">{sample.title}</p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label="Close the tender pack preview"
                className="focus-brand grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-ink-100 text-ink-500 transition-colors hover:border-ink-300 hover:text-ink-800"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* ── metadata strip ── */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 border-b border-ink-100 bg-paper/60 px-5 py-3 sm:grid-cols-4 sm:px-7">
              {[
                ["BUYER", sample.buyer],
                ["CEILING", sample.budget],
                ["FORMAT", `${sample.format} · ${sample.bids} BIDDERS`],
                ["DOCUMENTS", `${sample.files.length} FILES`],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <p className="font-code text-[10px] font-bold tracking-[0.12em] text-ink-400">{k}</p>
                  <p className="mt-0.5 truncate text-[12.5px] font-medium text-ink-800" title={v}>
                    {v}
                  </p>
                </div>
              ))}
              <p className="col-span-2 text-[12px] leading-relaxed text-ink-500 sm:col-span-4">{sample.challenges}</p>
            </div>

            {/* ── body: document list + reader ── */}
            <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[240px_1fr]">
              {/* document list */}
              <nav
                aria-label="Documents in this pack"
                className="max-h-32 shrink-0 overflow-y-auto border-b border-ink-100 bg-paper/40 p-2 sm:max-h-40 md:max-h-none md:border-b-0 md:border-r"
              >
                {sample.files.length === 0 ? (
                  <p className="px-2 py-3 text-[12px] leading-relaxed text-ink-500">No files are attached to this sample pack.</p>
                ) : sample.files.map((file, i) => {
                  const meta = docLabel(file);
                  const active = file === selected;
                  return (
                    <button
                      key={file}
                      type="button"
                      onClick={() => setSelected(file)}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "focus-brand mb-1 flex min-h-11 w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors",
                        active ? "bg-ink-950 text-white" : "hover:bg-ink-100/70",
                      )}
                    >
                      <FileText className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", active ? "text-brand-400" : "text-ink-400")} aria-hidden="true" />
                      <span className="min-w-0">
                        <span className={cn("block font-code text-[10px] font-bold tracking-[0.1em]", active ? "text-brand-300" : "text-ink-400")}>
                          {String(i + 1).padStart(2, "0")} · {meta.kind}
                        </span>
                        <span className={cn("mt-0.5 block truncate text-[12px] font-medium", active ? "text-white" : "text-ink-800")}>
                          {meta.name}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </nav>

              {/* reader pane */}
              <div className="flex min-h-0 flex-col">
                <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-2 sm:px-6">
                  <p className="truncate font-code text-[10px] font-bold tracking-[0.1em] text-ink-500">
                    {selected ? selected.toUpperCase() : "NO DOCUMENT SELECTED"}
                  </p>
                  <p className="shrink-0 font-code text-[10px] tracking-[0.08em] text-ink-400" aria-live="polite">
                    {loading ? "READING…" : text ? `${totalChars.toLocaleString()} CHARS · FULL TEXT` : ""}
                  </p>
                </div>
                <div className="min-h-[120px] flex-1 overflow-y-auto px-4 py-4 sm:min-h-[280px] sm:px-6" tabIndex={0} aria-label="Document full text">
                  {loading && (
                    <div className="flex h-full items-center justify-center gap-2.5 text-ink-400">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      <span className="font-code text-[10px] tracking-[0.12em]">READING THE PACK…</span>
                    </div>
                  )}
                  {!loading && error && (
                    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                      <p className="max-w-sm font-code text-[11px] leading-relaxed tracking-[0.06em] text-brand-700">{error}</p>
                      {sample && selected && (
                        <button
                          type="button"
                          onClick={() => fetchDoc(sample.ref, selected)}
                          className="focus-brand inline-flex min-h-11 items-center rounded-lg border border-ink-200 px-4 font-code text-[10px] font-bold tracking-[0.06em] text-ink-700 transition-colors hover:border-ink-400"
                        >
                          RETRY
                        </button>
                      )}
                    </div>
                  )}
                  {!loading && !error && !selected && (
                    <div className="flex h-full min-h-28 items-center justify-center px-4 text-center">
                      <p className="max-w-sm text-[12.5px] leading-relaxed text-ink-500">This sample pack has no documents to preview.</p>
                    </div>
                  )}
                  {!loading && !error && text !== null && (
                    /* Faithful reader: the pack's own markdown, rendered with the
                       desk's tokens — checklists, price tables and SHALL clauses
                       read exactly as the agent parses them. */
                    <DocMarkdown text={text} />
                  )}
                </div>
              </div>
            </div>

            {/* ── footer ── */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 bg-paper/60 px-5 py-3 sm:px-7">
              <p className="flex items-center gap-2 text-[12px] leading-snug text-ink-500">
                <BookOpen className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden="true" />
                {sample.files.length === 0
                  ? "This sample has no source files, so it cannot be staged for a review."
                  : "The agent reads exactly these files over MCP — the review runs the pack’s own bytes, nothing synthetic."}
              </p>
              <button
                type="button"
                onClick={() => onStage(sample)}
                disabled={sample.files.length === 0}
                className="focus-brand inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-4 font-code text-[10px] font-bold tracking-[0.1em] text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {sample.files.length === 0 ? "NO FILES TO STAGE" : "STAGE THIS PACK"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
