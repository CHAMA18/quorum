"use client";

import { useEffect, useMemo, useState } from "react";
import { Database, Download, RefreshCw, Search, Trash2 } from "lucide-react";
import {
  deleteStoredTenderDocument,
  listStoredTenderDocuments,
  signedTenderDownloadUrl,
  type StoredTenderDocument,
} from "@/lib/tender-upload";
import { cn } from "@/lib/utils";

/**
 * Every R2 object stored under one tender's prefix — not only the files staged
 * in this browser session. Listing needs `read_documents`; each download mints
 * a fresh five-minute signed URL on click, so no stale link sits in the page.
 * Deleting is operator-only (`run_revisions` roles) and is enforced again by
 * the route; the UI simply does not offer the control to readers.
 */

type SortKey = "newest" | "oldest" | "largest" | "smallest" | "name";

const SORTS: { id: SortKey; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "largest", label: "Largest" },
  { id: "smallest", label: "Smallest" },
  { id: "name", label: "Name" },
];

function bytesLabel(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function stampLabel(iso?: string): string {
  if (!iso) return "UPLOAD TIME UNKNOWN";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "UPLOAD TIME UNKNOWN";
  return d
    .toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .toUpperCase();
}

export function StoredDocsBrowser({
  tenderRef,
  canDelete = false,
  title = "IN OBJECT STORAGE",
}: {
  tenderRef: string;
  canDelete?: boolean;
  title?: string;
}) {
  const ref = tenderRef.trim();
  const [objects, setObjects] = useState<StoredTenderDocument[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");

  useEffect(() => {
    if (!ref) return;
    let live = true;
    void listStoredTenderDocuments(ref).then((result) => {
      if (!live) return;
      if ("error" in result) {
        setError(result.error);
        setObjects([]);
        setTotalBytes(0);
        setTruncated(false);
      } else {
        setObjects(result.objects);
        setTotalBytes(result.totalBytes);
        setTruncated(result.truncated);
      }
      setSettled(true);
    });
    return () => {
      live = false;
    };
  }, [ref, nonce]);

  const loading = !settled && !error;

  const refresh = () => {
    setError("");
    setActionError("");
    setNotice("");
    setConfirmKey(null);
    setSettled(false);
    setNonce((n) => n + 1);
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? objects.filter(
          (doc) =>
            doc.filename.toLowerCase().includes(needle) ||
            doc.key.toLowerCase().includes(needle) ||
            doc.contentType.toLowerCase().includes(needle),
        )
      : objects;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case "oldest":
          return (a.uploaded ?? "").localeCompare(b.uploaded ?? "") || a.filename.localeCompare(b.filename);
        case "largest":
          return b.bytes - a.bytes || a.filename.localeCompare(b.filename);
        case "smallest":
          return a.bytes - b.bytes || a.filename.localeCompare(b.filename);
        case "name":
          return a.filename.localeCompare(b.filename);
        default:
          return (b.uploaded ?? "").localeCompare(a.uploaded ?? "") || a.filename.localeCompare(b.filename);
      }
    });
    return sorted;
  }, [objects, query, sort]);

  const download = async (doc: StoredTenderDocument) => {
    setActionError("");
    setNotice("");
    setBusyKey(doc.key);
    const url = await signedTenderDownloadUrl(ref, doc.key);
    setBusyKey(null);
    if (!url) {
      setActionError(`A signed link for ${doc.filename} could not be minted.`);
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = doc.filename;
    anchor.rel = "noopener";
    anchor.click();
  };

  const remove = async (doc: StoredTenderDocument) => {
    setActionError("");
    setNotice("");
    setDeletingKey(doc.key);
    const result = await deleteStoredTenderDocument(ref, doc.key);
    setDeletingKey(null);
    setConfirmKey(null);
    if ("error" in result) {
      setActionError(result.error);
      return;
    }
    setObjects((cur) => cur.filter((object) => object.key !== doc.key));
    setTotalBytes((cur) => Math.max(0, cur - doc.bytes));
    setNotice(
      result.audited
        ? `REMOVED ${doc.filename} · AUDIT #${result.audit?.seq ?? "—"}`
        : `REMOVED ${doc.filename} · AUDIT NOT RECORDED${result.auditReason ? ` — ${result.auditReason}` : ""}`,
    );
  };

  if (!ref) return null;

  const summary = loading && objects.length === 0
    ? "READING R2…"
    : error
      ? "STORAGE UNREACHABLE"
      : query.trim()
        ? `${visible.length} OF ${objects.length} OBJECT${objects.length === 1 ? "" : "S"} MATCH`
        : `${objects.length} OBJECT${objects.length === 1 ? "" : "S"} · ${bytesLabel(totalBytes)}${truncated ? " · FIRST PAGE" : ""}`;

  return (
    <div className="rounded-[10px] border border-ink-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="font-code text-[9px] font-semibold tracking-[0.18em] text-ink-500">{title}</p>
          <p className="mt-0.5 truncate font-code text-[7.5px] tracking-[0.1em] text-ink-400" aria-live="polite">
            {summary}
          </p>
        </div>
        <button
          type="button"
          aria-label="Refresh stored documents"
          title="Read the tender's prefix in R2 again"
          onClick={refresh}
          disabled={loading}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-800 disabled:opacity-40"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} aria-hidden="true" />
        </button>
      </div>

      {!error && objects.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-3.5 py-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search stored documents</span>
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-400" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="SEARCH FILENAME OR TYPE"
              className="h-7 w-full rounded-md border border-ink-200 bg-paper/60 pl-7 pr-2 font-code text-[8px] tracking-[0.1em] text-ink-800 outline-none placeholder:text-ink-400 focus:border-ink-400"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="font-code text-[7px] tracking-[0.12em] text-ink-400">SORT</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-7 rounded-md border border-ink-200 bg-paper/60 px-1.5 font-code text-[8px] tracking-[0.08em] text-ink-700 outline-none focus:border-ink-400"
            >
              {SORTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {error ? (
        <p role="alert" className="px-3.5 py-3 text-[11.5px] leading-relaxed text-brand-800">
          {error}
        </p>
      ) : objects.length === 0 ? (
        <p className="px-3.5 py-3 text-[11.5px] leading-relaxed text-ink-400">
          {loading
            ? "Reading every object stored for this reference…"
            : "No objects stored for this reference yet. Uploads made anywhere in this workspace appear here."}
        </p>
      ) : visible.length === 0 ? (
        <p className="px-3.5 py-3 text-[11.5px] leading-relaxed text-ink-400">
          No stored object matches “{query.trim()}”.
        </p>
      ) : (
        <ul className="max-h-64 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-ink-200 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1">
          {visible.map((doc) => (
            <li key={doc.key} className="border-t border-ink-100 px-3.5 py-2.5 first:border-t-0">
              <div className="flex items-center gap-2.5">
                <Database className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-ink-800">{doc.filename}</span>
                  <span className="mt-0.5 block truncate font-code text-[7.5px] tracking-[0.08em] text-ink-400">
                    {bytesLabel(doc.bytes)} · {stampLabel(doc.uploaded)} · {doc.contentType}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Download ${doc.filename}`}
                  disabled={busyKey === doc.key}
                  onClick={() => void download(doc)}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-400 transition-colors hover:bg-brand-50 hover:text-brand-700 disabled:opacity-40"
                >
                  <Download className={cn("h-3.5 w-3.5", busyKey === doc.key && "animate-pulse")} aria-hidden="true" />
                </button>
                {canDelete && confirmKey !== doc.key && (
                  <button
                    type="button"
                    aria-label={`Remove ${doc.filename} from storage`}
                    disabled={deletingKey === doc.key}
                    onClick={() => {
                      setConfirmKey(doc.key);
                      setActionError("");
                      setNotice("");
                    }}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-400 transition-colors hover:bg-brand-50 hover:text-brand-700 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
              {canDelete && confirmKey === doc.key && (
                <div className="mt-2 flex flex-wrap items-center justify-end gap-2 rounded-lg bg-brand-50/70 px-2.5 py-2">
                  <p className="mr-auto text-[11px] font-medium text-brand-900">Remove this object from R2?</p>
                  <button
                    type="button"
                    onClick={() => setConfirmKey(null)}
                    disabled={deletingKey === doc.key}
                    className="h-6 rounded-md border border-ink-200 bg-white px-2 font-code text-[7.5px] font-bold tracking-[0.12em] text-ink-600 hover:border-ink-400 disabled:opacity-40"
                  >
                    CANCEL
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(doc)}
                    disabled={deletingKey === doc.key}
                    className="h-6 rounded-md bg-brand-600 px-2 font-code text-[7.5px] font-bold tracking-[0.12em] text-white hover:bg-brand-700 disabled:opacity-40"
                  >
                    {deletingKey === doc.key ? "REMOVING…" : "REMOVE"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {truncated && (
        <p className="border-t border-ink-100 px-3.5 py-2 font-code text-[7.5px] tracking-[0.12em] text-ink-400">
          SHOWING THE FIRST {objects.length} OBJECTS
        </p>
      )}
      {notice && (
        <p role="status" className="border-t border-ink-100 px-3.5 py-2 font-code text-[7.5px] tracking-[0.1em] text-ink-500">
          {notice}
        </p>
      )}
      {actionError && (
        <p role="alert" className="border-t border-ink-100 px-3.5 py-2 text-[11px] text-brand-800">
          {actionError}
        </p>
      )}
    </div>
  );
}
