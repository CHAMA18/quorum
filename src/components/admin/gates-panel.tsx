"use client";

import { useMemo, useState } from "react";
import {
  BadgeCheck,
  ExternalLink,
  Fingerprint,
  Gavel,
  Loader2,
  LockKeyhole,
  Search,
  ShieldAlert,
  Stamp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdminGate } from "@/lib/admin-types";
import {
  Button,
  Chip,
  CopyButton,
  Dot,
  Empty,
  fmtAgo,
  fmtNum,
  fmtStamp,
  inputCls,
  Panel,
  PanelHead,
  SectionHead,
  shortHash,
} from "@/components/admin/kit";
import { StatusChip } from "@/components/admin/console";
import type { PanelProps } from "@/components/admin/types";

const FILTERS: { id: AdminGate["status"] | "ALL"; label: string }[] = [
  { id: "ALL", label: "ALL" },
  { id: "PENDING", label: "PENDING" },
  { id: "AWAITING_SECOND", label: "AWAITING 2ND" },
  { id: "EXECUTED", label: "EXECUTED" },
  { id: "REJECTED", label: "REJECTED" },
];

type VerifyResult =
  | { kind: "ok"; signatureValid: boolean; reason: string | null; approver: string | null; status: string }
  | { kind: "none" }
  | { kind: "error"; message: string };

export function GatesPanel({ data, query, setQuery, now, navigate, notify }: PanelProps) {
  const [status, setStatus] = useState<AdminGate["status"] | "ALL">("ALL");
  const [verified, setVerified] = useState<Record<string, VerifyResult>>({});
  const [verifying, setVerifying] = useState<string | null>(null);

  const gates = data.desk.gates;
  const pending = gates.filter((gate) => gate.status === "PENDING" || gate.status === "AWAITING_SECOND");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return gates.filter((gate) => {
      if (status !== "ALL" && gate.status !== status) return false;
      if (!needle) return true;
      return `${gate.id} ${gate.runId} ${gate.tenderId} ${gate.tool} ${gate.approver ?? ""} ${gate.requiredOffice ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [gates, query, status]);

  const verify = async (gate: AdminGate) => {
    setVerifying(gate.id);
    try {
      const res = await fetch(`/api/gates/${encodeURIComponent(gate.id)}/verify?XTransformPort=3031`, {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        signatureValid?: boolean;
        reason?: string | null;
        approver?: string | null;
        status?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? "The verifier refused the request.");
      /* An undecided gate has nothing to verify yet. Saying "failed" here
         would read as tampering when it is simply an empty seal. */
      if (!body.signatureValid && !gate.decidedAt) {
        setVerified((prev) => ({ ...prev, [gate.id]: { kind: "none" } }));
        notify(`${gate.id} carries no receipt yet — nothing has been signed.`, "info");
        return;
      }
      setVerified((prev) => ({
        ...prev,
        [gate.id]: {
          kind: "ok",
          signatureValid: body.signatureValid === true,
          reason: body.reason ?? null,
          approver: body.approver ?? null,
          status: body.status ?? gate.status,
        },
      }));
      notify(
        body.signatureValid
          ? `Signature verified for ${gate.id} — the receipt is intact.`
          : `Signature did NOT verify for ${gate.id}. Read the reason on the card.`,
        body.signatureValid ? "ok" : "error",
      );
    } catch (err) {
      setVerified((prev) => ({
        ...prev,
        [gate.id]: { kind: "error", message: (err as Error).message },
      }));
      notify((err as Error).message, "error");
    } finally {
      setVerifying(null);
    }
  };

  const executed = gates.filter((gate) => gate.status === "EXECUTED").length;
  const rejected = gates.filter((gate) => gate.status === "REJECTED").length;
  const decided = gates.filter((gate) => gate.decidedAt !== null).length;
  const signed = gates.filter((gate) => gate.signatureValid).length;

  return (
    <div className="space-y-6">
      <SectionHead
        index="05"
        eyebrow="Human gates"
        title={
          <>
            The signature <span className="text-brand-600">the machine cannot press.</span>
          </>
        }
        lede={
          <>
            Every irreversible act parks here and waits. Release needs a named approver on the roster, the quorum
            present, a fresh step-up, and — above a threshold — a second signature. The console can read every one of
            those facts. It cannot supply them.
          </>
        }
        actions={
          <a
            href="/#/dashboard"
            className="focus-brand inline-flex h-9 items-center gap-2 rounded-lg bg-ink-950 px-3.5 font-code text-[9px] font-bold uppercase tracking-[0.16em] text-white transition-colors hover:bg-ink-800 dark:bg-white dark:text-ink-950 dark:hover:bg-ink-200"
          >
            <Gavel className="h-3.5 w-3.5" aria-hidden="true" />
            SIGN IN THE WORKSPACE
          </a>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Waiting on a human", value: fmtNum(pending.length), tone: pending.length ? "amber" : "emerald", note: "the graph is parked, not proceeding" },
          { label: "Executed", value: fmtNum(executed), tone: "emerald", note: "sealed, filed and receipted" },
          { label: "Returned", value: fmtNum(rejected), tone: "neutral", note: "rejection sends the file back" },
          {
            label: "Seals verified",
            value: `${fmtNum(signed)}/${fmtNum(decided)}`,
            tone: decided > 0 && signed === decided ? "emerald" : decided > 0 ? "red" : "neutral",
            note: decided === 0 ? "nothing signed yet" : signed === decided ? "every decision verifies" : "a decision does not verify",
          },
        ].map((stat) => (
          <div key={stat.label} className="panel rounded-2xl px-4 py-3.5">
            <div className="flex items-center gap-1.5">
              <Dot tone={stat.tone as "amber" | "emerald" | "neutral"} pulse={stat.tone === "amber" && pending.length > 0} />
              <p className="font-code text-[7px] font-bold uppercase tracking-[0.2em] text-ink-400">{stat.label}</p>
            </div>
            <p className="mt-1.5 type-num text-[24px] text-ink-950">{stat.value}</p>
            <p className="mt-0.5 text-[9.5px] text-ink-400">{stat.note}</p>
          </div>
        ))}
      </div>

      {pending.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3.5 dark:border-amber-500/30 dark:bg-amber-500/10">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
          <div>
            <p className="text-[12px] font-semibold text-amber-900 dark:text-amber-200">
              {pending.length} irreversible act{pending.length === 1 ? "" : "s"} is waiting. The run graph has stopped at the gate.
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800/90 dark:text-amber-200/80">
              Nothing is filed until a named human signs. The edge from this gate to filing does not exist in the graph.
            </p>
          </div>
        </div>
      )}

      <Panel>
        <PanelHead
          eyebrow="The queue"
          title="Gate register"
          description="Read the decision, the signer, the step-up and the seal. Verification runs against the sidecar — this console never mints a signature."
          action={<Chip tone="neutral">{fmtNum(filtered.length)} shown</Chip>}
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-5 py-3 dark:border-white/8">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find by gate, run, tender, approver or office…"
              aria-label="Search gates"
              className={cn(inputCls, "w-full pl-8")}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by gate status">
            {FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setStatus(filter.id)}
                aria-pressed={status === filter.id}
                className={cn(
                  "focus-brand rounded-full border px-2 py-1 font-code text-[7.5px] font-bold uppercase tracking-[0.12em] transition-colors",
                  status === filter.id
                    ? "border-ink-950 bg-ink-950 text-white dark:border-white dark:bg-white dark:text-ink-950"
                    : "border-ink-200 bg-white text-ink-500 hover:border-ink-400 dark:border-white/12 dark:bg-transparent dark:text-ink-400",
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <Empty
            title="No gate matches"
            body={
              gates.length === 0
                ? "No gate has been raised on this desk. Gates appear when a review finishes and asks for the award."
                : "Clear the search or change the status filter. Nothing has been decided by this view."
            }
          />
        ) : (
          <ul className="divide-y divide-ink-100 dark:divide-white/8">
            {filtered.map((gate) => {
              const result = verified[gate.id];
              return (
                <li key={gate.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Stamp className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
                        <p className="truncate font-display text-[14px] font-black tracking-[-0.01em] text-ink-950">
                          {gate.tenderId}
                        </p>
                        <StatusChip status={gate.status} />
                        {gate.requiredOffice && (
                          <Chip tone="violet">{gate.requiredOffice.replace(/_/g, " ")}</Chip>
                        )}
                        {gate.evidential ? (
                          <Chip tone="emerald" dot>Evidential</Chip>
                        ) : gate.status === "EXECUTED" ? (
                          <Chip tone="amber" dot>Legacy decision</Chip>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate font-code text-[8px] tracking-[0.08em] text-ink-400">
                        {gate.id} · {gate.tool.replace(/_/g, " ")} · run {gate.runId}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <CopyButton value={gate.id} label="gate id" />
                      <Button size="sm" onClick={() => navigate("work", gate.runId)}>
                        RUN →
                      </Button>
                    </div>
                  </div>

                  <dl className="mt-3 grid gap-x-4 gap-y-2.5 border-t border-ink-100 pt-3 sm:grid-cols-2 lg:grid-cols-4 dark:border-white/8">
                    <div>
                      <dt className="font-code text-[7px] font-bold uppercase tracking-[0.2em] text-ink-400">RAISED</dt>
                      <dd className="mt-0.5 text-[11px] text-ink-800">{fmtStamp(gate.createdAt)}</dd>
                      <dd className="text-[9.5px] text-ink-400">{fmtAgo(gate.createdAt, now)}</dd>
                    </div>
                    <div>
                      <dt className="font-code text-[7px] font-bold uppercase tracking-[0.2em] text-ink-400">DECIDED</dt>
                      <dd className="mt-0.5 text-[11px] text-ink-800">{gate.decidedAt ? fmtStamp(gate.decidedAt) : "Not decided"}</dd>
                      <dd className="text-[9.5px] text-ink-400">{gate.decidedAt ? fmtAgo(gate.decidedAt, now) : "the gate is open"}</dd>
                    </div>
                    <div>
                      <dt className="font-code text-[7px] font-bold uppercase tracking-[0.2em] text-ink-400">NAMED SIGNER</dt>
                      <dd className="mt-0.5 truncate text-[11px] text-ink-800">{gate.approver ?? "—"}</dd>
                      <dd className="truncate text-[9.5px] text-ink-400">
                        {gate.secondApprover
                          ? `second: ${gate.secondApprover.by}`
                          : gate.firstApproval
                            ? `first: ${gate.firstApproval.by} · awaiting second`
                            : "roster checked on release"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-code text-[7px] font-bold uppercase tracking-[0.2em] text-ink-400">SIGNATURE</dt>
                      <dd className="mt-0.5 flex flex-wrap items-center gap-1">
                        <Chip tone={gate.signatureValid ? "emerald" : gate.decidedAt ? "amber" : "neutral"} dot>
                          {gate.signatureValid ? "VALID" : gate.decidedAt ? "UNVERIFIED" : "NOT YET"}
                        </Chip>
                        {result?.kind === "ok" && (
                          <Chip tone={result.signatureValid ? "emerald" : "red"}>
                            {result.signatureValid ? "JUST VERIFIED" : "VERIFY FAILED"}
                          </Chip>
                        )}
                      </dd>
                      <dd className="truncate text-[9.5px] text-ink-400">
                        {gate.stepUp
                          ? `step-up · ${gate.stepUp.method} · ${gate.stepUp.by}`
                          : gate.status === "EXECUTED"
                            ? "no step-up recorded (legacy)"
                            : "step-up required at signing"}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-ink-200/80 bg-paper-2/50 px-3 py-2 dark:border-white/10 dark:bg-white/[0.02]">
                    <LockKeyhole className="h-3 w-3 shrink-0 text-ink-400" aria-hidden="true" />
                    <span className="font-code text-[7px] font-bold uppercase tracking-[0.18em] text-ink-400">RECEIPT</span>
                    {gate.receiptHash ? (
                      <>
                        <span className="font-code text-[9px] tracking-[0.06em] text-ink-700">{shortHash(gate.receiptHash, 18)}</span>
                        <CopyButton value={gate.receiptHash} label="hash" />
                      </>
                    ) : (
                      <span className="text-[10px] text-ink-400">none — nothing sealed yet</span>
                    )}
                    <div className="ml-auto flex flex-wrap items-center gap-1.5">
                      <Button size="sm" onClick={() => void verify(gate)} disabled={verifying !== null}>
                        {verifying === gate.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                        ) : (
                          <BadgeCheck className="h-3 w-3" aria-hidden="true" />
                        )}
                        VERIFY
                      </Button>
                      <a
                        href="/#/dashboard"
                        className="focus-brand inline-flex h-7 items-center gap-1 rounded-lg border border-ink-200 bg-white px-2 font-code text-[7.5px] font-bold uppercase tracking-[0.12em] text-ink-500 transition-colors hover:border-ink-400 hover:text-ink-950 dark:border-white/12 dark:bg-white/[0.04] dark:text-ink-400 dark:hover:border-white/25 dark:hover:text-white"
                      >
                        <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" /> WORKSPACE
                      </a>
                    </div>
                  </div>

                  {result && (
                    <div
                      className={cn(
                        "mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-[10.5px] leading-relaxed",
                        result.kind === "none"
                          ? "border-ink-200 bg-paper-2/60 text-ink-600 dark:border-white/10 dark:bg-white/[0.02] dark:text-ink-300"
                          : result.kind === "error" || !result.signatureValid
                            ? "border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"
                            : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200",
                      )}
                    >
                      {result.kind === "error" ? (
                        <p>The verifier could not answer: {result.message}</p>
                      ) : result.kind === "none" ? (
                        <p>No receipt exists yet. Verification begins the moment a named human signs this gate.</p>
                      ) : result.signatureValid ? (
                        <p>
                          The Ed25519 receipt verifies offline. Signed by <strong>{result.approver ?? "—"}</strong>,
                          status {result.status}.
                        </p>
                      ) : (
                        <p>
                          The receipt did <strong>not</strong> verify{result.reason ? `: ${result.reason}` : "."} Treat
                          this decision as evidence-defective until explained.
                        </p>
                      )}
                    </div>
                  )}

                  {gate.note && (
                    <p className="mt-2 border-l-2 border-ink-200 pl-2.5 text-[10.5px] italic leading-relaxed text-ink-500 dark:border-white/15">
                      “{gate.note}”
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-ink-200/80 bg-paper-2/60 px-5 py-4 dark:border-white/10 dark:bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <Fingerprint className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
            <p className="font-code text-[7.5px] font-bold uppercase tracking-[0.2em] text-ink-500">THE FIVE REFUSALS</p>
          </div>
          <ul className="mt-2 space-y-1.5 text-[10.5px] leading-relaxed text-ink-500">
            <li><strong className="text-ink-700">422</strong> — no approver name. A gate is never signed anonymously.</li>
            <li><strong className="text-ink-700">403</strong> — the name is not on the present roster, or the office is wrong.</li>
            <li><strong className="text-ink-700">409</strong> — fewer present members than the quorum requires.</li>
            <li><strong className="text-ink-700">403</strong> — the step-up token is stale, reused or bound to a different document.</li>
            <li><strong className="text-ink-700">503</strong> — the roster cannot be read. The gate fails closed.</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-ink-200/80 bg-paper-2/60 px-5 py-4 dark:border-white/10 dark:bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <Gavel className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
            <p className="font-code text-[7.5px] font-bold uppercase tracking-[0.2em] text-ink-500">WHY THIS CONSOLE DOES NOT SIGN</p>
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink-500">
            A signature is a person taking responsibility, not an administrator changing state. Offering it here would
            collapse preparation and approval into one role — exactly the separation the product exists to protect.
            Verify here; sign there.
          </p>
        </div>
      </div>
    </div>
  );
}
