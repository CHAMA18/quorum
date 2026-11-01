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
  parked: { dot: "amber", label: "PARKED", text: "text-amber-700 dark:text-amber-300" },
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
        eyebrow="Audit spine"
        title={
          <>
            Every act, in order, <span className="text-brand-600">sealed to the one before it.</span>
          </>
        }
        lede={
          <>
            Append-only by construction: each row carries the hash of its own payload chained to the previous row, so
            editing an old line breaks the tail. The verifier re-walks the file and names the exact row where it snaps.
          </>
        }
        actions={
          <>
            <Button size="sm" onClick={exportJsonl}>
              <Download className="h-3 w-3" aria-hidden="true" /> EXPORT SHOWN
            </Button>
            <Button size="sm" onClick={() => refresh()}>
              <RotateCw className="h-3 w-3" aria-hidden="true" /> RE-READ CHAIN
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
            <p className="font-code text-[7px] font-bold uppercase tracking-[0.2em] text-ink-500">CHAIN STATE</p>
          </div>
          <p
            className={cn(
              "mt-1.5 font-display text-[20px] font-black leading-tight",
              chainOk ? "text-emerald-800 dark:text-emerald-200" : "text-red-800 dark:text-red-200",
            )}
          >
            {chainOk ? "INTACT" : verify || ledger ? "BROKEN" : "UNREAD"}
          </p>
          <p className="mt-0.5 text-[9.5px] text-ink-500">
            {chainOk
              ? `${fmtNum(verify?.checked ?? ledger?.checked ?? entries.length)} rows re-walked, every link holds`
              : verify?.brokenAt != null
                ? `first break at row ${verify.brokenAt}`
                : ledger?.brokenAt != null
                  ? `ledger break at row ${ledger.brokenAt}`
                  : "the verifier did not answer — treat as unproven"}
          </p>
        </div>
        {[
          {
            label: "Rows in window",
            value: entries.length,
            note: data.desk.online ? "read from the sidecar log" : "sidecar unreachable — window is empty",
          },
          {
            label: "Refused attempts",
            value: refused,
            note: `${parked} more parked at a gate`,
          },
          {
            label: "Rows matching",
            value: filtered.length,
            note: `of ${fmtNum(data.desk.audit.allTotal)} recorded calls on this desk`,
          },
        ].map((stat) => (
          <div key={stat.label} className="panel rounded-2xl px-4 py-3.5">
            <p className="font-code text-[7px] font-bold uppercase tracking-[0.2em] text-ink-400">{stat.label}</p>
            <p className="mt-1.5 type-num text-[24px] text-ink-950">{fmtNum(stat.value)}</p>
            <p className="mt-0.5 text-[9.5px] text-ink-400">{stat.note}</p>
          </div>
        ))}
      </div>

      {verify && verify.restarts.length > 0 && (
        <div className="rounded-xl border border-ink-200 bg-paper-2/60 px-4 py-3 text-[10.5px] leading-relaxed text-ink-500 dark:border-white/10 dark:bg-white/[0.02]">
          <span className="font-code text-[7.5px] font-bold uppercase tracking-[0.2em] text-ink-500">EPOCHS</span>{" "}
          The log holds {verify.segments} sealed segment{verify.segments === 1 ? "" : "s"} across {verify.restarts.length}{" "}
          restart{verify.restarts.length === 1 ? "" : "s"}. Each restart re-anchors the chain explicitly, so continuity is
          declared rather than assumed.
        </div>
      )}

      <Panel>
        <PanelHead
          eyebrow="The ledger"
          title="Append-only tool log"
          description="Newest first. Open a row to read what the agent asked for, what the boundary returned, and the hash that binds it."
          action={
            <div className="flex items-center gap-1.5">
              <Chip tone="neutral">head {shortHash(ledger?.head ?? entries[0]?.self ?? null, 10)}</Chip>
              <Chip tone={chainOk ? "emerald" : "red"} dot>
                {chainOk ? "SEALED" : "UNPROVEN"}
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
              placeholder="Find by tool, actor, run, kind or hash…"
              aria-label="Search the audit log"
              className={cn(inputCls, "w-full pl-8")}
            />
          </div>
          <button
            type="button"
            onClick={() => setOkOnly((value) => !value)}
            aria-pressed={okOnly}
            className={cn(
              "focus-brand rounded-full border px-2.5 py-1 font-code text-[7.5px] font-bold uppercase tracking-[0.12em] transition-colors",
              okOnly
                ? "border-ink-950 bg-ink-950 text-white dark:border-white dark:bg-white dark:text-ink-950"
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
                ? "The sidecar returned no log window. The console shows nothing rather than inventing a record."
                : "Clear the search or widen the window. Network filtering never touches the ledger itself."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-b border-ink-100 dark:border-white/8">
                  {["SEQ", "TOOL", "ACTOR", "RUN", "STATE", "ROW HASH", "AT"].map((head) => (
                    <th
                      key={head}
                      scope="col"
                      className="px-4 py-2 font-code text-[7px] font-bold uppercase tracking-[0.18em] text-ink-400 first:pl-5 last:pr-5"
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
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-5 py-3 dark:border-white/8">
          <p className="text-[9.5px] text-ink-400">
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
            <p className="font-code text-[7.5px] font-bold uppercase tracking-[0.2em] text-ink-500">WHAT A REFUSAL MEANS</p>
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink-500">
            A refused row is the boundary doing its job: an agent asked for a tool outside its scope, a path outside the
            workspace, or an approval it may not give. The attempt is logged so the boundary can be audited, not merely
            trusted.
          </p>
        </div>
        <div className="rounded-2xl border border-ink-200/80 bg-paper-2/60 px-5 py-4 dark:border-white/10 dark:bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <Link2 className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
            <p className="font-code text-[7.5px] font-bold uppercase tracking-[0.2em] text-ink-500">HOW THE SEAL WORKS</p>
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink-500">
            Each row stores the SHA-256 of its own payload chained to the previous row&apos;s hash. Verification recomputes
            the whole file. Change one character in row 12 and rows 12 through the tail all fail — which is how a ledger
            earns the name.
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
        onClick={onToggle}
        className={cn(
          "cursor-pointer border-b border-ink-100/80 transition-colors last:border-0 dark:border-white/6",
          open ? "bg-paper-2/70 dark:bg-white/[0.04]" : "hover:bg-paper-2/50 dark:hover:bg-white/[0.025]",
        )}
      >
        <td className="py-2 pl-5 pr-4 font-code text-[9px] tabular-nums text-ink-400">
          <span className="inline-flex items-center gap-1">
            <Chevron className="h-3 w-3 shrink-0" aria-hidden="true" />
            {entry.seq}
          </span>
        </td>
        <td className="px-4 py-2">
          <span className="font-code text-[9.5px] font-semibold tracking-[0.03em] text-ink-800">{entry.tool}</span>
          <span className="ml-1.5 font-code text-[7px] uppercase tracking-[0.12em] text-ink-400">{entry.kind}</span>
        </td>
        <td className="max-w-[150px] truncate px-4 py-2 text-[10px] text-ink-500">{entry.actor}</td>
        <td className="px-4 py-2 font-code text-[9px] text-ink-400">{entry.runId ? entry.runId : "—"}</td>
        <td className="px-4 py-2">
          <span className="inline-flex items-center gap-1.5">
            <Dot tone={tone.dot} />
            <span className={cn("font-code text-[7.5px] font-bold uppercase tracking-[0.12em]", tone.text)}>
              {tone.label}
            </span>
          </span>
        </td>
        <td className="px-4 py-2 font-code text-[8.5px] tracking-[0.04em] text-ink-400">{shortHash(entry.self, 10)}</td>
        <td className="py-2 pl-4 pr-5 font-code text-[9px] tabular-nums text-ink-400">{fmtStamp(entry.ts)}</td>
      </tr>
      {open && (
        <tr className="border-b border-ink-100 dark:border-white/8">
          <td colSpan={7} className="bg-paper-2/40 px-5 py-4 dark:bg-white/[0.015]">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-code text-[7px] font-bold uppercase tracking-[0.2em] text-ink-400">INPUTS</p>
                  <CopyButton value={entry.inputs} label="inputs" />
                </div>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-ink-200/70 bg-white/70 p-2.5 font-code text-[9px] leading-relaxed text-ink-600 dark:border-white/10 dark:bg-black/20 dark:text-ink-300">
                  {entry.inputs || "—"}
                </pre>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-code text-[7px] font-bold uppercase tracking-[0.2em] text-ink-400">OUTPUTS</p>
                  <CopyButton value={entry.outputs} label="outputs" />
                </div>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-ink-200/70 bg-white/70 p-2.5 font-code text-[9px] leading-relaxed text-ink-600 dark:border-white/10 dark:bg-black/20 dark:text-ink-300">
                  {entry.outputs || "—"}
                </pre>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-ink-200/70 pt-2.5 dark:border-white/10">
              <span className="font-code text-[7px] font-bold uppercase tracking-[0.18em] text-ink-400">PREV</span>
              <span className="font-code text-[8.5px] text-ink-600">{shortHash(entry.prev, 16)}</span>
              <span className="font-code text-[7px] font-bold uppercase tracking-[0.18em] text-ink-400">SELF</span>
              <span className="font-code text-[8.5px] text-ink-600">{shortHash(entry.self, 16)}</span>
              <CopyButton value={entry.self ?? ""} label="row hash" />
              <span className="ml-auto font-code text-[8px] text-ink-400">
                id {entry.id} · {entry.server} · {entry.durationMs} ms
              </span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
