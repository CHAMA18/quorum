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

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, FileText, Loader2, ScanSearch, X } from "lucide-react";
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
          <p key={key++} className={cn("mt-1 font-code font-bold tracking-[0.06em] text-ink-950", level === 2 ? "text-[11px]" : "text-[10px]")}>
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
          <div key={key++} className="mt-1 overflow-x-auto rounded-lg border border-ink-200">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-paper">
                  {head.map((c, ci) => (
                    <th key={ci} className="border-b border-ink-200 px-2.5 py-1.5 font-code text-[8px] font-bold tracking-[0.12em] text-ink-500">
                      {renderInline(c, `th${ci}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((r, ri) => (
                  <tr key={ri} className="odd:bg-paper/40">
                    {r.map((c, ci) => (
                      <td key={ci} className="border-b border-ink-100 px-2.5 py-1.5 text-[11px] text-ink-800">
                        {renderInline(c, `td${ri}-${ci}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
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
            <li key={ii} className="flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-700">
              {it.required ? (
                <span className="mt-0.5 shrink-0 rounded bg-brand-600 px-1 py-px font-code text-[6.5px] font-bold tracking-[0.1em] text-white">
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
      <p key={key++} className="mt-1 text-[11.5px] leading-[1.7] text-ink-700">
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
}: {
  sample: TenderPackRow | null;
  onClose: () => void;
  /** Stage the pack being previewed (closes the viewer). */
  onStage: (s: TenderPackRow) => void;
}) {
  const open = !!sample;
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

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
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/sample-tenders/${encodeURIComponent(ref)}/docs/${encodeURIComponent(file)}?XTransformPort=3031`,
      );
      if (!res.ok) throw new Error(`sidecar ${res.status}`);
      const data = (await res.json()) as { doc?: { name: string; text: string } };
      if (!data.doc?.text) throw new Error("empty");
      setText(data.doc.text);
    } catch {
      setText(null);
      setError("THIS DOCUMENT COULD NOT BE READ — THE AGENT STACK MAY BE OFFLINE. RETRY OR PICK ANOTHER FILE.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sample && selected) {
      setText(null);
      fetchDoc(sample.ref, selected);
    }
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
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[85] grid place-items-center bg-night/70 p-3 backdrop-blur-sm sm:p-4"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tender-pack-preview-title"
        >
          <motion.div
            ref={cardRef}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.28, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={trapTab}
            className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-[0_30px_80px_rgba(11,12,15,0.35)]"
          >
            {/* ── header ── */}
            <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4 sm:px-7 sm:py-5">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-code text-[8px] font-semibold tracking-[0.24em] text-ink-400">
                  <ScanSearch className="h-3 w-3 text-brand-600" aria-hidden="true" />
                  TENDER PACK PREVIEW · READ-ONLY
                </p>
                <h3
                  id="tender-pack-preview-title"
                  className="mt-1 flex flex-wrap items-center gap-2 font-display text-[20px] font-black tracking-[-0.015em] text-ink-950 sm:text-[22px]"
                >
                  <span className="font-code text-[12px] font-bold tracking-[0.08em]">{sample.ref}</span>
                  <span className="rounded-full bg-ink-950 px-2 py-0.5 font-code text-[7px] font-bold tracking-[0.14em] text-white">
                    {sample.sector}
                  </span>
                </h3>
                <p className="mt-0.5 truncate text-[12.5px] font-medium text-ink-800">{sample.title}</p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label="Close the tender pack preview"
                className="rounded-lg border border-ink-100 p-1.5 text-ink-400 transition-colors hover:border-ink-300 hover:text-ink-800"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* ── metadata strip ── */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 border-b border-ink-100 bg-paper/60 px-5 py-3 sm:grid-cols-4 sm:px-7">
              {[
                ["BUYER", sample.buyer],
                ["CEILING", sample.budget],
                ["FORMAT", `${sample.format} · ${sample.bids} BIDS`],
                ["DOCUMENTS", `${sample.files.length} FILES`],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <p className="font-code text-[7.5px] font-bold tracking-[0.18em] text-ink-400">{k}</p>
                  <p className="mt-0.5 truncate text-[11.5px] font-medium text-ink-800" title={v}>
                    {v}
                  </p>
                </div>
              ))}
              <p className="col-span-2 text-[11.5px] leading-relaxed text-ink-500 sm:col-span-4">{sample.challenges}</p>
            </div>

            {/* ── body: document list + reader ── */}
            <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[240px_1fr]">
              {/* document list */}
              <nav
                aria-label="Documents in this pack"
                className="max-h-40 shrink-0 overflow-y-auto border-b border-ink-100 bg-paper/40 p-2 md:max-h-none md:border-b-0 md:border-r"
              >
                {sample.files.map((file, i) => {
                  const meta = docLabel(file);
                  const active = file === selected;
                  return (
                    <button
                      key={file}
                      type="button"
                      onClick={() => setSelected(file)}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "mb-1 flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                        active ? "bg-ink-950 text-white" : "hover:bg-ink-100/70",
                      )}
                    >
                      <FileText className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", active ? "text-brand-400" : "text-ink-400")} aria-hidden="true" />
                      <span className="min-w-0">
                        <span className={cn("block font-code text-[7.5px] font-bold tracking-[0.16em]", active ? "text-brand-300" : "text-ink-400")}>
                          {String(i + 1).padStart(2, "0")} · {meta.kind}
                        </span>
                        <span className={cn("mt-0.5 block truncate text-[11.5px] font-medium", active ? "text-white" : "text-ink-800")}>
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
                  <p className="truncate font-code text-[8px] font-bold tracking-[0.16em] text-ink-500">
                    {selected ? selected.toUpperCase() : "NO DOCUMENT SELECTED"}
                  </p>
                  <p className="shrink-0 font-code text-[7.5px] tracking-[0.14em] text-ink-400" aria-live="polite">
                    {loading ? "READING…" : text ? `${totalChars.toLocaleString()} CHARS · FULL TEXT` : ""}
                  </p>
                </div>
                <div className="min-h-[280px] flex-1 overflow-y-auto px-4 py-4 sm:px-6" tabIndex={0} aria-label="Document full text">
                  {loading && (
                    <div className="flex h-full items-center justify-center gap-2.5 text-ink-400">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      <span className="font-code text-[9px] tracking-[0.18em]">READING THE PACK…</span>
                    </div>
                  )}
                  {!loading && error && (
                    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                      <p className="max-w-sm font-code text-[9px] leading-relaxed tracking-[0.14em] text-brand-700">{error}</p>
                      {sample && selected && (
                        <button
                          type="button"
                          onClick={() => fetchDoc(sample.ref, selected)}
                          className="rounded-lg border border-ink-200 px-3.5 py-1.5 font-code text-[8px] font-bold tracking-[0.16em] text-ink-700 transition-colors hover:border-ink-400"
                        >
                          RETRY
                        </button>
                      )}
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
              <p className="flex items-center gap-2 text-[11px] leading-snug text-ink-500">
                <BookOpen className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden="true" />
                The agent reads exactly these files over MCP — the review runs the pack’s own bytes, nothing synthetic.
              </p>
              <button
                type="button"
                onClick={() => onStage(sample)}
                className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 font-code text-[8px] font-bold tracking-[0.16em] text-white transition-all hover:bg-brand-700"
              >
                STAGE THIS PACK &amp; RUN
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
