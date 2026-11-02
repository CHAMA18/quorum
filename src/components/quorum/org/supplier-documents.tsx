"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  CloudUpload,
  Eye,
  FileText,
  Loader2,
  ScanSearch,
  X,
} from "lucide-react";
import { getFirebaseIdToken } from "@/lib/firebase";
import { MAX_SUPPLIER_BID_FILE_BYTES } from "@/lib/supplier-bid-document-limits";
import {
  ALL_REQUIRED_DOCUMENTS,
  REQUIRED_DOCUMENT_GROUPS,
} from "@/lib/required-bid-documents";
import { cn } from "@/lib/utils";
import { fmtDate } from "./supplier-data";
import { SupplierDocumentInspector } from "./supplier-document-inspector";

/**
 * The organization's standing bid-document set.
 *
 * Shared by the Overview (under "Profile details to complete") and the
 * Documents section, so both read one catalogue and one upload path. Each file
 * is pre-uploaded once against the organization — the same catalogue officers
 * tick against individual notices.
 */

export type ProfileDocument = {
  requirement: string;
  key: string;
  filename: string;
  bytes: number;
  contentType: string;
  sha256: string;
  uploadedAt: string;
};

export function SupplierDocumentsSection({
  className,
  onBrowse,
}: {
  className?: string;
  onBrowse?: () => void;
}) {
  const [documents, setDocuments] = useState<ProfileDocument[] | null>(null);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [documentNotices, setDocumentNotices] = useState<Record<string, string>>({});
  const [busyDocument, setBusyDocument] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState<{ document: ProfileDocument; autoScan: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const token = await getFirebaseIdToken();
        if (!token) {
          if (!active) return;
          setDocuments([]);
          setDocumentsError("Reconnect this supplier account to Firebase to pre-upload bid documents.");
          return;
        }
        const res = await fetch("/api/org/documents", {
          cache: "no-store",
          headers: { authorization: `Bearer ${token}` },
        });
        const data = (await res.json().catch(() => ({}))) as {
          documents?: ProfileDocument[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? "Your bid documents could not be loaded.");
        if (!active) return;
        setDocuments(Array.isArray(data.documents) ? data.documents : []);
        setDocumentsError(null);
      } catch (loadError) {
        if (!active) return;
        setDocuments([]);
        setDocumentsError(
          loadError instanceof Error ? loadError.message : "Your bid documents could not be loaded.",
        );
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const documentByRequirement = useMemo(
    () => new Map((documents ?? []).map((document) => [document.requirement, document])),
    [documents],
  );

  const closeInspector = useCallback(() => setInspecting(null), []);

  const uploadDocument = async (requirement: string, file: File) => {
    if (busyDocument) return;
    if (file.size === 0) {
      setDocumentNotices((previous) => ({
        ...previous,
        [requirement]: `${file.name} is empty. Choose a file with content.`,
      }));
      return;
    }
    if (file.size > MAX_SUPPLIER_BID_FILE_BYTES) {
      setDocumentNotices((previous) => ({
        ...previous,
        [requirement]: `${file.name} is larger than the 10 MB per-file limit.`,
      }));
      return;
    }
    setBusyDocument(requirement);
    setDocumentNotices((previous) => ({ ...previous, [requirement]: "" }));
    try {
      const token = await getFirebaseIdToken();
      if (!token) throw new Error("Reconnect this supplier account to Firebase, then try again.");
      const form = new FormData();
      form.append("file", file);
      form.append("requirement", requirement);
      const res = await fetch("/api/org/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as {
        document?: ProfileDocument;
        error?: string;
      };
      if (!res.ok || !data.document) throw new Error(data.error ?? `${file.name} could not be uploaded.`);
      const saved = data.document;
      setDocuments((previous) => [
        ...(previous ?? []).filter((row) => row.requirement !== saved.requirement),
        saved,
      ]);
      setDocumentsError(null);
    } catch (uploadError) {
      setDocumentNotices((previous) => ({
        ...previous,
        [requirement]:
          uploadError instanceof Error ? uploadError.message : `${file.name} could not be uploaded.`,
      }));
    } finally {
      setBusyDocument(null);
    }
  };

  const removeDocument = async (document: ProfileDocument) => {
    if (busyDocument) return;
    setBusyDocument(document.key);
    setDocumentNotices((previous) => ({ ...previous, [document.requirement]: "" }));
    try {
      const token = await getFirebaseIdToken();
      if (!token) throw new Error("Reconnect this supplier account to Firebase, then try again.");
      const res = await fetch("/api/org/documents", {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ key: document.key }),
      });
      const data = (await res.json().catch(() => ({}))) as { deleted?: boolean; error?: string };
      if (!res.ok || !data.deleted) throw new Error(data.error ?? "The document could not be removed.");
      setDocuments((previous) => (previous ?? []).filter((row) => row.key !== document.key));
    } catch (removeError) {
      setDocumentNotices((previous) => ({
        ...previous,
        [document.requirement]:
          removeError instanceof Error ? removeError.message : "The document could not be removed.",
      }));
    } finally {
      setBusyDocument(null);
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border border-ink-200/70 bg-white/50 p-3 dark:border-white/10 dark:bg-white/[0.02]",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-[12.5px] font-semibold text-ink-900 dark:text-white">
            Bid documents to upload overall
          </h4>
          <p className="mt-0.5 max-w-[72ch] text-[11.5px] leading-relaxed text-ink-600 dark:text-ink-300">
            Upload each document once here — it is held against your organization for every opportunity.
            When you apply, the notice still asks you to attach the set it requires. Open any file on record
            to preview it, or scan it with Meta AI to check what it is, who it names and when it lapses.
          </p>
        </div>
        <span className="rounded-full border border-ink-200/80 px-2.5 py-1 font-code text-[10px] tracking-[0.06em] text-ink-600 tabular dark:border-white/10 dark:text-ink-300">
          {documents === null ? "READING…" : `${documents.length} OF ${ALL_REQUIRED_DOCUMENTS.length} ON RECORD`}
        </span>
      </div>

      {documentsError ? (
        <p role="status" className="mt-2 flex items-start gap-1.5 text-[11.5px] text-ink-600 dark:text-ink-300">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" aria-hidden="true" />
          {documentsError}
        </p>
      ) : null}

      <div className="mt-3 space-y-2.5">
        {REQUIRED_DOCUMENT_GROUPS.map((group, groupIndex) => {
          const onRecord = group.documents.filter((document) => documentByRequirement.has(document)).length;
          const complete = onRecord === group.documents.length;
          return (
            <section
              key={group.label}
              aria-labelledby={`document-group-${groupIndex}`}
            className="@container min-w-0 overflow-hidden rounded-lg border border-ink-200/80 bg-white/70 dark:border-white/10 dark:bg-white/[0.025]"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-ink-200/70 px-3 py-2.5 dark:border-white/10">
              <p
                id={`document-group-${groupIndex}`}
                className="font-code text-[10px] font-bold tracking-[0.1em] text-ink-500 dark:text-ink-300"
              >
                {group.label}
              </p>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className="hidden h-1 w-14 overflow-hidden rounded-full bg-ink-200/70 sm:block dark:bg-white/10"
                  aria-hidden="true"
                >
                  <span
                    className={cn(
                      "block h-full rounded-full transition-[width] duration-500",
                      complete ? "bg-emerald-500" : "bg-brand-500",
                    )}
                    style={{ width: `${Math.round((onRecord / group.documents.length) * 100)}%` }}
                  />
                </span>
                <span
                  className={cn(
                    "font-code text-[10px] tabular tracking-[0.04em]",
                    complete ? "text-emerald-700 dark:text-emerald-300" : "text-ink-500 dark:text-ink-400",
                  )}
                >
                  {onRecord} OF {group.documents.length}
                  {complete ? " · COMPLETE" : ""}
                </span>
              </span>
            </div>
            <ul className="grid gap-x-2 gap-y-0.5 px-2 py-2 @3xl:grid-cols-2">
                {group.documents.map((document) => {
                  const uploaded = documentByRequirement.get(document);
                  const busy = busyDocument === document;
                  const removing = uploaded ? busyDocument === uploaded.key : false;
                  const notice = documentNotices[document];
                  return (
                    <li
                    key={document}
                    className="min-w-0 rounded-md px-2 py-2 transition-colors hover:bg-ink-950/[0.03] focus-within:bg-ink-950/[0.03] dark:hover:bg-white/[0.035] dark:focus-within:bg-white/[0.035]"
                  >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-start gap-1.5">
                          {uploaded ? (
                            <CircleCheck
                              className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400"
                              aria-hidden="true"
                            />
                          ) : (
                            <FileText className="mt-0.5 h-3 w-3 shrink-0 text-ink-400" aria-hidden="true" />
                          )}
                          <div className="min-w-0">
                            <p className="text-[12px] leading-snug text-ink-700 dark:text-ink-200">{document}</p>
                            {uploaded ? (
                              <p
                                className="mt-0.5 truncate text-[10.5px] text-emerald-700 dark:text-emerald-300"
                                title={`${uploaded.filename} · ${fmtDate(uploaded.uploadedAt)}`}
                              >
                                {uploaded.filename}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {uploaded ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setInspecting({ document: { ...uploaded }, autoScan: false })}
                              aria-label={`Preview ${document}`}
                              title="Preview this document"
                              className="focus-brand grid h-8 w-8 place-items-center rounded-md border border-ink-200/80 text-ink-600 transition-colors hover:border-brand-400 hover:text-brand-700 dark:border-white/10 dark:text-ink-300 dark:hover:border-brand-500/40 dark:hover:text-brand-300"
                            >
                              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setInspecting({ document: { ...uploaded }, autoScan: true })}
                              aria-label={`Scan ${document} with Meta AI`}
                              title="Scan with Meta AI"
                              className="focus-brand grid h-8 w-8 place-items-center rounded-md border border-ink-200/80 text-ink-600 transition-colors hover:border-brand-400 hover:text-brand-700 dark:border-white/10 dark:text-ink-300 dark:hover:border-brand-500/40 dark:hover:text-brand-300"
                            >
                              <ScanSearch className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </>
                        ) : null}
                        <label className="focus-brand inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md border border-ink-200/80 px-1.5 text-[10.5px] font-semibold text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700 dark:border-white/10 dark:text-ink-200 dark:hover:border-brand-500/40 dark:hover:text-brand-300">
                            {busy ? (
                              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                            ) : (
                              <CloudUpload className="h-3 w-3" aria-hidden="true" />
                            )}
                            <span>{busy ? "Uploading" : uploaded ? "Replace" : "Upload"}</span>
                            <input
                              type="file"
                              className="sr-only"
                              accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg,.webp"
                              aria-label={`Upload ${document}`}
                              disabled={busyDocument !== null}
                              onChange={(event) => {
                                const file = event.currentTarget.files?.[0];
                                event.currentTarget.value = "";
                                if (file) void uploadDocument(document, file);
                              }}
                            />
                          </label>
                          {uploaded ? (
                            <button
                              type="button"
                              onClick={() => void removeDocument(uploaded)}
                              disabled={busyDocument !== null}
                              aria-label={`Remove ${document}`}
                              className="focus-brand grid h-8 w-8 place-items-center rounded-md border border-ink-200/80 text-ink-500 transition-colors hover:border-brand-400 hover:text-brand-700 disabled:cursor-not-allowed dark:border-white/10 dark:text-ink-300 dark:hover:border-brand-500/40 dark:hover:text-brand-300"
                            >
                              {removing ? (
                                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                              ) : (
                                <X className="h-3 w-3" aria-hidden="true" />
                              )}
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {notice ? (
                        <p role="alert" className="mt-1 text-[10.5px] text-brand-700 dark:text-brand-300">
                          {notice}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-ink-500 dark:text-ink-400">
        <CloudUpload className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>To attach these on a notice: Opportunities → pick a tender → Apply to this tender → Upload document.</span>
        {onBrowse ? (
          <button
            type="button"
            onClick={onBrowse}
            className="focus-brand inline-flex items-center gap-1 rounded font-semibold text-brand-700 transition-colors hover:text-brand-600 dark:text-brand-300 dark:hover:text-brand-200"
          >
            Open opportunities
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : null}
      </p>

      <SupplierDocumentInspector
        doc={inspecting?.document ?? null}
        autoScan={inspecting?.autoScan ?? false}
        onClose={closeInspector}
      />
    </div>
  );
}
