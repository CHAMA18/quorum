"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Link2,
  RotateCw,
  Search,
  ShieldQuestion,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HorizontalScrollRegion } from "@/components/quorum/horizontal-scroll-region";
import type { AdminAuditEntry } from "@/lib/admin-types";
import {
  Button,
  Chip,
  CopyButton,
  Dot,
  Empty,
  fmtNum,
  fmtStamp,
  inputCls,
  Panel,
  PanelHead,
  SectionHead,
  selectCls,
  shortHash,
} from "@/components/admin/kit";
import type { PanelProps } from "@/components/admin/types";

const WINDOWS = [
  { label: "LAST 50", limit: 50 },
  { label: "LAST 200", limit: 200 },
  { label: "LAST 500", limit: 500 },
];

type EntryState = "ok" | "refused" | "parked" | "error";

/** The sidecar logs refusals as ERROR with `outputs.refused`; read the shape,
 *  not just the status, so a refusal is never filed as a plain failure. */
function stateOf(entry: AdminAuditEntry): EntryState {
  const status = entry.status.toUpperCase();
  if (status === "PENDING_GATE" || status === "GATED") return "parked";
  if (status === "OK") return "ok";
  if (/"refused"\s*:/.test(entry.outputs)) return "refused";
  return status === "ERROR" ? "error" : "ok";
}

const STATE_TONE: Record<EntryState, { dot: "emerald" | "amber" | "red" | "neutral"; label: string; text: string }> = {
  ok: { dot: "emerald", label: "OK", text: "text-emerald-700 dark:text-emerald-400" },
  parked: { dot: "amber", label: "AWAITING APPROVAL", text: "text-amber-700 dark:text-amber-300" },
  refused: { dot: "red", label: "REFUSED", text: "text-red-700 dark:text-red-400" },
  error: { dot: "red", label: "ERROR", text: "text-red-700 dark:text-red-400" },
};

export function AuditPanel({ data, query, setQuery, refresh }: PanelProps) {
  const [limit, setLimit] = useState(200);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [okOnly, setOkOnly] = useState(false);

  const entries = data.desk.audit.entries;
  const verify = data.desk.verify;
  const ledger = data.desk.ledger;
  const chainOk = verify?.ok === true && (ledger ? ledger.ok : true);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (okOnly && stateOf(entry) !== "ok") return false;
      if (!needle) return true;
      return `${entry.id} ${entry.tool} ${entry.actor} ${entry.kind} ${entry.runId ?? ""} ${entry.status} ${entry.self ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [entries, query, okOnly]);

  const shown = filtered.slice(0, limit);
  const refused = entries.filter((entry) => stateOf(entry) === "refused").length;
  const parked = entries.filter((entry) => stateOf(entry) === "parked").length;

  const exportJsonl = () => {
    const body = filtered.map((entry) => JSON.stringify(entry)).join("\n");
    const blob = new Blob([body], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `quorum-audit-${new Date().toISOString().slice(0, 10)}.jsonl`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <SectionHead
        index="06"
        eyebrow="Audit history"
        title={
          <>
            A record of actions, <span className="text-brand-600">with integrity checks.</span>
          </>
        }
        lede={
          <>
            Every action is saved with a verification code linked to the action before it. The system checks the full
            history and identifies the first entry if any saved information has changed.
          </>
        }
        actions={
          <>
            <Button size="sm" onClick={exportJsonl}>
              <Download className="h-3 w-3" aria-hidden="true" /> EXPORT SHOWN
            </Button>
            <Button size="sm" onClick={() => refresh()}>
              <RotateCw className="h-3 w-3" aria-hidden="true" /> REFRESH HISTORY
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div
          className={cn(
            "rounded-2xl border px-4 py-3.5",
            chainOk
              ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/25 dark:bg-emerald-500/10"
              : "border-red-200 bg-red-50/70 dark:border-red-500/30 dark:bg-red-500/10",
          )}
        >
          <div className="flex items-center gap-1.5">
            <Dot tone={chainOk ? "emerald" : "red"} pulse={!chainOk} />
            <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">History integrity</p>
          </div>
          <p
            className={cn(
              "mt-1.5 font-display text-[20px] font-black leading-tight",
              chainOk ? "text-emerald-800 dark:text-emerald-200" : "text-red-800 dark:text-red-200",
            )}
          >
            {chainOk ? "VERIFIED" : verify || ledger ? "CHECK FAILED" : "NOT CHECKED"}
          </p>
          <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-600">
            {chainOk
              ? `${fmtNum(verify?.checked ?? ledger?.checked ?? entries.length)} entries checked; all match`
              : verify?.brokenAt != null
                ? `First mismatch at entry ${verify.brokenAt}`
                : ledger?.brokenAt != null
                  ? `First mismatch at entry ${ledger.brokenAt}`
                  : "Could not check the history. Treat it as unverified."}
          </p>
        </div>
        {[
          {
            label: "Actions shown",
            value: entries.length,
            note: data.desk.online ? "from the saved activity history" : "Activity history is unavailable",
          },
          {
            label: "Blocked actions",
            value: refused,
            note: `${parked} more awaiting approval`,
          },
          {
            label: "Matching actions",
            value: filtered.length,
            note: `of ${fmtNum(data.desk.audit.allTotal)} recorded actions`,
          },
        ].map((stat) => (
          <div key={stat.label} className="panel rounded-2xl px-4 py-3.5">
            <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">{stat.label}</p>
            <p className="mt-1.5 type-num text-[24px] text-ink-950">{fmtNum(stat.value)}</p>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-600">{stat.note}</p>
          </div>
        ))}
      </div>

      {verify && verify.restarts.length > 0 && (
        <div className="rounded-xl border border-ink-200 bg-paper-2/60 px-4 py-3 text-[10.5px] leading-relaxed text-ink-500 dark:border-white/10 dark:bg-white/[0.02]">
          <span className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Service restarts</span>{" "}
          The history contains {verify.segments} verified section{verify.segments === 1 ? "" : "s"} across {verify.restarts.length}{" "}
          restart{verify.restarts.length === 1 ? "" : "s"}. Each section is checked separately so gaps are visible.
        </div>
      )}

      <Panel>
        <PanelHead
          eyebrow="Saved activity"
          title="Administrative audit history"
          description="Newest first. Open an entry to review the action, system response and verification code."
          action={
            <div className="flex items-center gap-1.5">
              <Chip tone="neutral">latest code {shortHash(ledger?.head ?? entries[0]?.self ?? null, 10)}</Chip>
              <Chip tone={chainOk ? "emerald" : "red"} dot>
                {chainOk ? "VERIFIED" : "CHECK FAILED"}
              </Chip>
            </div>
          }
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-5 py-3 dark:border-white/8">
          <div className="relative min-w-[220px] flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400"
              aria-hidden="true"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find by action, person, tender review or verification code…"
              aria-label="Search the audit log"
              className={cn(inputCls, "w-full pl-8")}
            />
          </div>
          <button
            type="button"
            onClick={() => setOkOnly((value) => !value)}
            aria-pressed={okOnly}
            className={cn(
              "focus-brand inline-flex min-h-11 items-center rounded-lg border px-3 py-2 font-code text-[10px] font-bold uppercase tracking-[0.06em] transition-colors",
              okOnly
                ? "border-ink-950 bg-ink-950 text-white dark:border-white dark:bg-white dark:text-[#0b0c0f]"
                : "border-ink-200 bg-white text-ink-500 hover:border-ink-400 dark:border-white/12 dark:bg-transparent dark:text-ink-400",
            )}
          >
            ONLY CLEAN ROWS
          </button>
          <select
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
            aria-label="Rows to show"
            className={selectCls}
          >
            {WINDOWS.map((item) => (
              <option key={item.limit} value={item.limit}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        {shown.length === 0 ? (
          <Empty
            title="No row matches"
            body={
              entries.length === 0
                ? "Activity history is unavailable. No entries are shown until the service responds."
                : "Clear the search or show more entries. Filtering does not change saved history."
            }
          />
        ) : (
          <HorizontalScrollRegion label="Admin audit log table">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-b border-ink-100 dark:border-white/8">
                  {["NO.", "ACTION", "PERSON", "TENDER REVIEW", "RESULT", "VERIFY CODE", "DATE"].map((head) => (
                    <th
                      key={head}
                      scope="col"
                      className="px-4 py-3 font-code text-[10px] font-bold uppercase tracking-[0.08em] text-ink-600 first:pl-5 last:pr-5"
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((entry) => (
                  <AuditRow
                    key={entry.id || `${entry.seq}`}
                    entry={entry}
                    open={expanded === entry.id}
                    onToggle={() => setExpanded((current) => (current === entry.id ? null : entry.id))}
                  />
                ))}
              </tbody>
            </table>
          </HorizontalScrollRegion>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-5 py-3 dark:border-white/8">
          <p className="text-[10.5px] leading-relaxed text-ink-600">
            Showing {fmtNum(shown.length)} of {fmtNum(filtered.length)} matching rows. Newer rows are read first; older
            rows stay on disk.
          </p>
          {filtered.length > limit && (
            <Button size="sm" onClick={() => setLimit((value) => Math.min(500, value + 100))}>
              LOAD MORE
            </Button>
          )}
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-ink-200/80 bg-paper-2/60 px-5 py-4 dark:border-white/10 dark:bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <ShieldQuestion className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
            <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">What a refusal means</p>
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink-500">
            A blocked action occurs when a person or service attempts something outside its assigned permissions. The
            attempt is recorded so administrators can review why access was denied.
          </p>
        </div>
        <div className="rounded-2xl border border-ink-200/80 bg-paper-2/60 px-5 py-4 dark:border-white/10 dark:bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <Link2 className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
            <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">How the seal works</p>
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink-500">
            Each entry has a verification code linked to the one before it. The system checks the entire history and
            flags any entry that no longer matches its saved version.
          </p>
        </div>
      </div>
    </div>
  );
}

function AuditRow({
  entry,
  open,
  onToggle,
}: {
  entry: AdminAuditEntry;
  open: boolean;
  onToggle: () => void;
}) {
  const state = stateOf(entry);
  const tone = STATE_TONE[state];
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <>
      <tr
        className={cn(
          "border-b border-ink-100/80 transition-colors last:border-0 dark:border-white/6",
          open ? "bg-paper-2/70 dark:bg-white/[0.04]" : "hover:bg-paper-2/50 dark:hover:bg-white/[0.025]",
        )}
      >
        <td className="py-1 pl-4 pr-2 font-code text-[10px] tabular-nums text-ink-600">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} audit entry ${entry.seq}`}
            className="focus-brand inline-flex min-h-11 min-w-11 items-center gap-1 rounded-md px-1"
          >
            <Chevron className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {entry.seq}
          </button>
        </td>
        <td className="px-4 py-2">
          <span className="font-code text-[10px] font-semibold tracking-[0.02em] text-ink-900">{entry.tool}</span>
          <span className="ml-1.5 font-code text-[10px] uppercase tracking-[0.05em] text-ink-600">{entry.kind}</span>
        </td>
        <td className="max-w-[150px] truncate px-4 py-2 text-[10px] text-ink-500">{entry.actor}</td>
        <td className="px-4 py-2 font-code text-[10px] text-ink-600">{entry.runId ? entry.runId : "—"}</td>
        <td className="px-4 py-2">
          <span className="inline-flex items-center gap-1.5">
            <Dot tone={tone.dot} />
            <span className={cn("font-code text-[10px] font-bold uppercase tracking-[0.05em]", tone.text)}>
              {tone.label}
            </span>
          </span>
        </td>
        <td className="px-4 py-2 font-code text-[10px] tracking-[0.02em] text-ink-600">{shortHash(entry.self, 10)}</td>
        <td className="py-2 pl-4 pr-5 font-code text-[10px] tabular-nums text-ink-600">{fmtStamp(entry.ts)}</td>
      </tr>
      {open && (
        <tr className="border-b border-ink-100 dark:border-white/8">
          <td colSpan={7} className="bg-paper-2/40 px-5 py-4 dark:bg-white/[0.015]">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Inputs</p>
                  <CopyButton value={entry.inputs} label="inputs" />
                </div>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-ink-200/70 bg-white/70 p-2.5 font-code text-[10px] leading-relaxed text-ink-700 dark:border-white/10 dark:bg-black/20 dark:text-ink-200">
                  {entry.inputs || "—"}
                </pre>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Outputs</p>
                  <CopyButton value={entry.outputs} label="outputs" />
                </div>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-ink-200/70 bg-white/70 p-2.5 font-code text-[10px] leading-relaxed text-ink-700 dark:border-white/10 dark:bg-black/20 dark:text-ink-200">
                  {entry.outputs || "—"}
                </pre>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-ink-200/70 pt-2.5 dark:border-white/10">
              <span className="font-code text-[10px] font-bold uppercase tracking-[0.08em] text-ink-600">Previous</span>
              <span className="font-code text-[10px] text-ink-700">{shortHash(entry.prev, 16)}</span>
              <span className="font-code text-[10px] font-bold uppercase tracking-[0.08em] text-ink-600">Current</span>
              <span className="font-code text-[10px] text-ink-700">{shortHash(entry.self, 16)}</span>
              <CopyButton value={entry.self ?? ""} label="verification code" />
              <span className="ml-auto text-[10px] text-ink-600">
                id {entry.id} · {entry.server} · {entry.durationMs} ms
              </span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
