"use client";

import { useReducedMotion } from "@/lib/use-reduced-motion";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  CircleAlert,
  CircleCheck,
  Download,
  FileText,
  Loader2,
  ScanSearch,
  Sparkles,
  X,
} from "lucide-react";
import { trapTabFocus } from "@/lib/a11y";
import { cn } from "@/lib/utils";
import type { MetaProfileDocumentScan } from "@/lib/meta-bid-document-assist";
import {
  loadProfileDocumentPreview,
  saveProfileDocument,
  scanProfileDocument,
} from "@/lib/supplier-document-preview";

const EASE = [0.22, 1, 0.36, 1] as const;

/** The formats supported by the optional document review route. */
const SCANNABLE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

export type InspectableProfileDocument = {
  requirement: string;
  key: string;
  filename: string;
  bytes: number;
  contentType: string;
  uploadedAt: string;
  sha256: string;
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function documentKind(contentType: string, filename: string): string {
  const extension = filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1).toUpperCase() : "";
  if (extension) return extension;
  const tail = contentType.split("/").pop() ?? "FILE";
  return tail.toUpperCase();
}

type ScanState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; review: MetaProfileDocumentScan }
  | { status: "error"; error: string };

/**
 * The document inspector — one surface for reading a standing bid document.
 *
 * Left: the stored bytes, rendered by the browser (PDF and images inline, other
 * formats offered as a download). Right: the Meta Model API scan, run on demand
 * and shown as evidence — never as an eligibility or authenticity decision.
 *
 * State is held against the document key rather than reset by an effect:
 * opening a different file simply has no result of its own yet, and the
 * auto-scan (the row's scan button) starts from the effect that mounts with it.
 */
export function SupplierDocumentInspector({
  doc,
  autoScan = false,
  onClose,
  loadPreview = loadProfileDocumentPreview,
  requestScan = scanProfileDocument,
  saveCopy = saveProfileDocument,
}: {
  doc: InspectableProfileDocument | null;
  autoScan?: boolean;
  onClose: () => void;
  loadPreview?: (key: string) => Promise<Blob>;
  requestScan?: (key: string) => Promise<MetaProfileDocumentScan>;
  saveCopy?: (key: string, filename: string) => Promise<void>;
}) {
  const reduceMotion = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<{ key: string; url: string | null; error: string | null } | null>(null);
  const [scanningKey, setScanningKey] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<{ key: string; review: MetaProfileDocumentScan } | null>(null);
  const [scanFailure, setScanFailure] = useState<{ key: string; error: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailure, setSaveFailure] = useState<{ key: string; message: string } | null>(null);

  const docKey = doc?.key ?? null;
  const scannable = doc ? SCANNABLE_TYPES.has(doc.contentType) : false;

  /* One fetch per open: the blob URL is revoked when that file is closed, so a
     large PDF is never held twice. */
  useEffect(() => {
    if (!docKey) return;
    const loadKey = docKey;
    let active = true;
    let created: string | null = null;
    void (async () => {
      try {
        const blob = await loadPreview(loadKey);
        const url = URL.createObjectURL(blob);
        created = url;
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        setPreview({ key: loadKey, url, error: null });
      } catch (error) {
        if (!active) return;
        setPreview({
          key: loadKey,
          url: null,
          error: error instanceof Error ? error.message : "This document could not be opened.",
        });
      }
    })();
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [docKey, loadPreview]);

  const previewReady = Boolean(docKey) && preview?.key === docKey;
  const previewLoading = Boolean(docKey) && !previewReady;
  const previewUrl = previewReady ? preview!.url : null;
  const previewError = previewReady ? preview!.error : null;

  /* The auto-scan starts here and touches state only after the model answers;
     a manual scan sets "running" from its click handler instead. */
  useEffect(() => {
    if (!doc || !autoScan || !scannable) return;
    const scanKey = doc.key;
    let active = true;
    void (async () => {
      try {
        const review = await requestScan(scanKey);
        if (!active) return;
        setScanResult({ key: scanKey, review });
      } catch (error) {
        if (!active) return;
        setScanFailure({
          key: scanKey,
          error: error instanceof Error ? error.message : "The document review could not be completed.",
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [doc, autoScan, scannable, requestScan]);

  const runScan = useCallback(async () => {
    if (!doc || !scannable) return;
    const scanKey = doc.key;
    setScanningKey(scanKey);
    setScanFailure(null);
    setScanResult(null);
    try {
      const review = await requestScan(scanKey);
      setScanResult({ key: scanKey, review });
    } catch (error) {
      setScanFailure({
        key: scanKey,
        error: error instanceof Error ? error.message : "The document review could not be completed.",
      });
    } finally {
      setScanningKey((current) => (current === scanKey ? null : current));
    }
  }, [doc, requestScan, scannable]);

  const scan: ScanState = !doc
    ? { status: "idle" }
    : scanResult?.key === doc.key
      ? { status: "done", review: scanResult.review }
      : scanFailure?.key === doc.key
        ? { status: "error", error: scanFailure.error }
        : scanningKey === doc.key || (autoScan && scannable)
          ? { status: "running" }
          : { status: "idle" };
  const saveError = doc && saveFailure?.key === doc.key ? saveFailure.message : null;

  useEffect(() => {
    if (!doc) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(frame);
    };
  }, [doc, onClose]);

  const save = async () => {
    if (!doc || saving) return;
    const saveKey = doc.key;
    setSaving(true);
    setSaveFailure(null);
    try {
      await saveCopy(saveKey, doc.filename);
    } catch (error) {
      setSaveFailure({
        key: saveKey,
        message: error instanceof Error ? error.message : "This document could not be downloaded.",
      });
    } finally {
      setSaving(false);
    }
  };

  const isPdf = doc?.contentType === "application/pdf";
  const isImage = Boolean(doc?.contentType.startsWith("image/"));
  const chrome = useMemo(
    () => ({
      dialog: "fixed inset-0 z-[85] flex items-stretch justify-center bg-night/70 backdrop-blur-sm sm:items-center sm:p-4",
      card: "panel flex h-[100dvh] w-full max-w-6xl flex-col overflow-hidden sm:h-[min(88dvh,880px)] sm:rounded-[14px]",
    }),
    [],
  );

  if (typeof document === "undefined" || typeof window === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {doc ? (
        <motion.div
          key="supplier-document-inspector"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.2 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby="supplier-document-inspector-title"
          className={chrome.dialog}
        >
          <motion.div
            ref={cardRef}
            initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 10 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.26, ease: EASE }}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => trapTabFocus(event, cardRef.current)}
            className={chrome.card}
          >
            <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-4 py-3.5 sm:px-5 dark:border-white/10">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 font-code text-[10px] font-semibold tracking-[0.14em] text-ink-400">
                  <ScanSearch className="h-3 w-3 text-brand-600 dark:text-brand-300" aria-hidden="true" />
                  DOCUMENT INSPECTOR · CLOUDFLARE R2
                </p>
                <h3
                  id="supplier-document-inspector-title"
                  className="mt-1 truncate text-[15px] font-semibold tracking-[-0.01em] text-ink-950 dark:text-white"
                  title={doc.requirement}
                >
                  {doc.requirement}
                </h3>
                <p className="mt-0.5 truncate text-[12px] text-ink-600 dark:text-ink-300" title={doc.filename}>
                  {doc.filename}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-code text-[10px] tracking-[0.04em] text-ink-500 dark:text-ink-400">
                  <span className="rounded border border-ink-200/80 px-1.5 py-0.5 dark:border-white/10">
                    {documentKind(doc.contentType, doc.filename)}
                  </span>
                  <span>{formatBytes(doc.bytes)}</span>
                  <span className="text-ink-300 dark:text-ink-600">·</span>
                  <span>UPLOADED {fmtDate(doc.uploadedAt).toUpperCase()}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  className="focus-brand inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-ink-200/80 px-2.5 text-[11.5px] font-semibold text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:text-ink-200 dark:hover:border-brand-500/40 dark:hover:text-brand-300"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span className="hidden sm:inline">Download</span>
                </button>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={onClose}
                  aria-label={`Close the preview of ${doc.filename}`}
                  className="focus-brand grid h-9 w-9 place-items-center rounded-lg border border-ink-200/80 text-ink-500 transition-colors hover:border-ink-300 hover:text-ink-800 dark:border-white/10 dark:text-ink-300 dark:hover:border-white/20 dark:hover:text-white"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            {saveError ? (
              <p
                role="alert"
                className="border-b border-ink-100 px-4 py-2 text-[11.5px] text-brand-700 sm:px-5 dark:border-white/10 dark:text-brand-300"
              >
                {saveError}
              </p>
            ) : null}

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_368px] lg:overflow-hidden">
              <div className="relative flex min-h-[46dvh] items-center justify-center overflow-hidden bg-paper-2/50 p-3 lg:min-h-0 dark:bg-night/40">
                {previewLoading ? (
                  <p className="flex items-center gap-2 font-code text-[10.5px] tracking-[0.08em] text-ink-500 dark:text-ink-300">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    OPENING THE STORED FILE…
                  </p>
                ) : previewError ? (
                  <div className="max-w-sm text-center">
                    <CircleAlert className="mx-auto h-5 w-5 text-brand-500" aria-hidden="true" />
                    <p role="alert" className="mt-2 text-[12px] leading-relaxed text-ink-700 dark:text-ink-200">
                      {previewError}
                    </p>
                    <button
                      type="button"
                      onClick={() => void save()}
                      className="focus-brand mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-ink-200/80 px-3 text-[11.5px] font-semibold text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700 dark:border-white/10 dark:text-ink-200"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      Download instead
                    </button>
                  </div>
                ) : previewUrl && isPdf ? (
                  <iframe
                    src={previewUrl}
                    title={`Preview of ${doc.filename}`}
                    className="h-full min-h-[42dvh] w-full rounded-lg border border-ink-200/70 bg-white dark:border-white/10"
                  />
                ) : previewUrl && isImage ? (
                  <img
                    src={previewUrl}
                    alt={`Preview of ${doc.filename}`}
                    className="max-h-full max-w-full rounded-lg border border-ink-200/70 bg-white object-contain dark:border-white/10"
                  />
                ) : (
                  <div className="max-w-sm text-center">
                    <FileText className="mx-auto h-6 w-6 text-ink-400" aria-hidden="true" />
                    <p className="mt-2 text-[13px] font-semibold text-ink-900 dark:text-ink-100">
                      Browsers cannot render this format
                    </p>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-ink-600 dark:text-ink-300">
                      The file is stored intact in Cloudflare R2. Download it to open in Word or Excel — the scan panel
                      cannot read it either.
                    </p>
                    <button
                      type="button"
                      onClick={() => void save()}
                      className="focus-brand mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-ink-200/80 px-3 text-[11.5px] font-semibold text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700 dark:border-white/10 dark:text-ink-200"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      Download the file
                    </button>
                  </div>
                )}
              </div>

              <aside
                aria-label="AI-assisted document check"
                className="min-h-0 overflow-y-auto border-t border-ink-100 p-4 lg:border-l lg:border-t-0 dark:border-white/10"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-code text-[10px] font-semibold tracking-[0.12em] text-ink-500 dark:text-ink-300">
                    OPTIONAL AI DOCUMENT CHECK
                  </p>
                  {scan.status === "done" ? (
                    <span className="rounded-full border border-ink-200/80 px-2 py-0.5 font-code text-[9.5px] tracking-[0.06em] text-ink-500 dark:border-white/10 dark:text-ink-300">
                      {scan.review.model.toUpperCase()}
                    </span>
                  ) : null}
                </div>

                {scan.status === "done" ? (
                  <ScanReview review={scan.review} onRescan={() => void runScan()} />
                ) : scan.status === "running" ? (
                  <div className="mt-3 rounded-lg border border-ink-200/70 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.02]">
                    <p className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-900 dark:text-ink-100">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600 dark:text-brand-300" aria-hidden="true" />
                      Reading the document…
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-600 dark:text-ink-300">
                      The file is sent inline to Meta for this request only. Meta does not retain it, and no
                      eligibility decision is made from this check.
                    </p>
                  </div>
                ) : (
                  <div className="mt-3">
                    <p className="text-[12px] leading-relaxed text-ink-700 dark:text-ink-200">
                      Request an AI-assisted check to identify the document, named entity, dates and items that may
                      need attention. Review the original file before relying on any result.
                    </p>
                    {!scannable ? (
                      <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-2.5 py-2 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
                        The document review supports PDF, PNG, JPEG and WebP files. This format can be previewed by downloading it,
                        but it cannot be scanned.
                      </p>
                    ) : null}
                    {scan.status === "error" ? (
                      <p
                        role="alert"
                        className="mt-2 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-brand-700 dark:text-brand-300"
                      >
                        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {scan.error}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void runScan()}
                      disabled={!scannable}
                      className="focus-brand mt-3 inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 text-[12px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-500 dark:disabled:bg-white/10 dark:disabled:text-ink-400"
                    >
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      {scan.status === "error" ? "Try the check again" : "Review with AI"}
                    </button>
                    <p className="mt-2 font-code text-[10px] leading-relaxed tracking-[0.02em] text-ink-400">
                      SENT INLINE · STORE: FALSE · NO ELIGIBILITY EFFECT
                    </p>
                  </div>
                )}
              </aside>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function ScanReview({ review, onRescan }: { review: MetaProfileDocumentScan; onRescan: () => void }) {
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-1.5">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-code text-[9.5px] font-semibold tracking-[0.06em]",
            review.readable
              ? "border-emerald-600/30 bg-emerald-600/[0.06] text-emerald-700 dark:border-emerald-300/30 dark:text-emerald-300"
              : "border-amber-500/30 bg-amber-500/[0.06] text-amber-800 dark:text-amber-200",
          )}
        >
          {review.readable ? (
            <CircleCheck className="h-3 w-3" aria-hidden="true" />
          ) : (
            <CircleAlert className="h-3 w-3" aria-hidden="true" />
          )}
          {review.readable ? "READABLE" : "NOT LEGIBLE"}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-code text-[9.5px] font-semibold tracking-[0.06em]",
            review.requirementMatch
              ? "border-emerald-600/30 bg-emerald-600/[0.06] text-emerald-700 dark:border-emerald-300/30 dark:text-emerald-300"
              : "border-amber-500/30 bg-amber-500/[0.06] text-amber-800 dark:text-amber-200",
          )}
        >
          {review.requirementMatch ? "MATCHES THIS ITEM" : "MAY NOT MATCH"}
        </span>
      </div>

      {review.documentType ? (
        <p className="mt-2 text-[13px] font-semibold leading-snug text-ink-950 dark:text-white">{review.documentType}</p>
      ) : null}
      {review.summary ? (
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-700 dark:text-ink-200">{review.summary}</p>
      ) : null}

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
        {[
          ["NAMED ORGANISATION", review.organizationNamed || "—"],
          ["DOCUMENT NO.", review.documentNumber || "—"],
          ["ISSUED", review.issuedDate || "—"],
          ["LAPSES", review.expiryDate || "—"],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="font-code text-[9.5px] font-semibold tracking-[0.08em] text-ink-400">{label}</dt>
            <dd className="mt-0.5 break-words text-[11.5px] text-ink-800 dark:text-ink-100" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {review.cautions.length ? (
        <ul className="mt-3 space-y-1.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.05] px-2.5 py-2">
          {review.cautions.map((caution) => (
            <li
              key={caution}
              className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-900 dark:text-amber-100"
            >
              <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="min-w-0">{caution}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-3 border-t border-ink-100 pt-2.5 text-[10.5px] leading-relaxed text-ink-500 dark:border-white/10 dark:text-ink-400">
        {review.note}
      </p>

      <button
        type="button"
        onClick={onRescan}
        className="focus-brand mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-ink-200/80 px-2.5 text-[11px] font-semibold text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700 dark:border-white/10 dark:text-ink-200 dark:hover:border-brand-500/40 dark:hover:text-brand-300"
      >
        <Sparkles className="h-3 w-3" aria-hidden="true" />
        Scan again
      </button>
    </div>
  );
}
