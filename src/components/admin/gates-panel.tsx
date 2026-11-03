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
import { systemReferenceLabel } from "@/lib/system-reference";
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
  { id: "PENDING", label: "AWAITING APPROVAL" },
  { id: "AWAITING_SECOND", label: "AWAITING SECOND APPROVAL" },
  { id: "EXECUTED", label: "APPROVED" },
  { id: "REJECTED", label: "RETURNED" },
];

const APPROVAL_ACTION_LABELS: Record<string, string> = {
  file_gate_submission: "File review package",
  record_bid_opening: "Record bid opening",
  certify_evaluation: "Approve evaluation results",
  resolve_alb: "Resolve low-bid review",
  sign_award_report: "Approve award recommendation",
  publish_award_notice: "Publish award notice",
  issue_debrief: "Issue debrief letter",
  sign_contract_pack: "Approve contract documents",
  approve_variation: "Approve contract change",
  certify_payment: "Approve payment",
  record_contract_completion: "Close contract record",
  respond_complaint: "Respond to complaint",
  publish_notice: "Publish tender notice",
};

function approvalStatusLabel(status: string): string {
  if (status === "PENDING") return "Awaiting approval";
  if (status === "AWAITING_SECOND") return "Awaiting second approval";
  if (status === "EXECUTED") return "Approved";
  if (status === "REJECTED") return "Returned";
  return status.replace(/_/g, " ").toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

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
      return `${gate.id} ${gate.runId} ${gate.systemReference ?? ""} ${gate.tool} ${gate.approver ?? ""} ${gate.requiredOffice ?? ""}`
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
        notify(`No verification code exists for ${gate.id} yet. No approval has been signed.`, "info");
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
        eyebrow="Approvals"
        title={
          <>
            Approval requests
          </>
        }
        lede={
          <>
            Actions that cannot be reversed wait here for an authorized officer. Approval requires an assigned
            approver, the required committee attendance, a fresh identity check and, for some decisions, a second
            approver. This console shows the status but cannot approve on anyone's behalf.
          </>
        }
        actions={
          <a
            href="/#/dashboard"
            className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-lg bg-ink-950 px-4 py-2 font-code text-[10px] font-bold uppercase tracking-[0.08em] text-white transition-colors hover:bg-ink-800 dark:bg-white dark:text-[#0b0c0f] dark:hover:bg-[#e9eaec]"
          >
            <Gavel className="h-3.5 w-3.5" aria-hidden="true" />
            OPEN THE WORKSPACE
          </a>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Awaiting approval", value: fmtNum(pending.length), tone: pending.length ? "amber" : "emerald", note: "the related tender review is paused" },
          { label: "Approved", value: fmtNum(executed), tone: "emerald", note: "signed and saved with a receipt" },
          { label: "Returned", value: fmtNum(rejected), tone: "neutral", note: "rejection sends the file back" },
          {
            label: "Signatures verified",
            value: `${fmtNum(signed)}/${fmtNum(decided)}`,
            tone: decided > 0 && signed === decided ? "emerald" : decided > 0 ? "red" : "neutral",
            note: decided === 0 ? "nothing signed yet" : signed === decided ? "every decision verifies" : "a decision does not verify",
          },
        ].map((stat) => (
          <div key={stat.label} className="panel rounded-2xl px-4 py-3.5">
            <div className="flex items-center gap-1.5">
              <Dot tone={stat.tone as "amber" | "emerald" | "neutral"} pulse={stat.tone === "amber" && pending.length > 0} />
              <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">{stat.label}</p>
            </div>
            <p className="mt-1.5 type-num text-[24px] text-ink-950">{stat.value}</p>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-600">{stat.note}</p>
          </div>
        ))}
      </div>

      {pending.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3.5 dark:border-amber-500/30 dark:bg-amber-500/10">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
          <div>
            <p className="text-[12px] font-semibold text-amber-900 dark:text-amber-200">
              {pending.length} action{pending.length === 1 ? " is" : "s are"} waiting for approval. The related tender review is paused.
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800/90 dark:text-amber-200/80">
              Nothing is submitted until an authorized officer signs. Work resumes after the approval is recorded.
            </p>
          </div>
        </div>
      )}

      <Panel>
        <PanelHead
          eyebrow="Pending decisions"
          title="Approval requests"
          description="Review the requested action, approver, identity check and verification receipt. Signatures are checked against the approval service; this console cannot create one."
          action={<Chip tone="neutral">{fmtNum(filtered.length)} shown</Chip>}
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-5 py-3 dark:border-white/8">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find by request, tender, approver or office…"
              aria-label="Search approval requests"
              className={cn(inputCls, "w-full pl-8")}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by approval status">
            {FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setStatus(filter.id)}
                aria-pressed={status === filter.id}
                className={cn(
                  "focus-brand inline-flex min-h-11 items-center rounded-lg border px-3 py-2 font-code text-[10px] font-bold uppercase tracking-[0.06em] transition-colors",
                  status === filter.id
                    ? "border-ink-950 bg-ink-950 text-white dark:border-white dark:bg-white dark:text-[#0b0c0f]"
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
            title="No approval requests found"
            body={
              gates.length === 0
                ? "There are no pending approval requests. Requests appear when a tender review requires an authorized decision."
                : "Clear the search or choose a different status. This view does not make decisions."
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
                          {systemReferenceLabel(gate.systemReference, "TENDER REFERENCE PENDING")}
                        </p>
                        <StatusChip status={gate.status} label={approvalStatusLabel(gate.status)} />
                        {gate.requiredOffice && (
                          <Chip tone="violet">{gate.requiredOffice.replace(/_/g, " ")}</Chip>
                        )}
                        {gate.evidential ? (
                          <Chip tone="emerald" dot>Evidence recorded</Chip>
                        ) : gate.status === "EXECUTED" ? (
                          <Chip tone="amber" dot>Legacy decision</Chip>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-[10.5px] text-ink-600">
                        Approval request {gate.id} · {APPROVAL_ACTION_LABELS[gate.tool] ?? gate.tool.replace(/_/g, " ")} · tender review {gate.runId}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <CopyButton value={gate.id} label="approval request ID" />
                      <Button size="sm" onClick={() => navigate("work", gate.runId)}>
                        OPEN REVIEW →
                      </Button>
                    </div>
                  </div>

                  <dl className="mt-3 grid gap-x-4 gap-y-2.5 border-t border-ink-100 pt-3 sm:grid-cols-2 lg:grid-cols-4 dark:border-white/8">
                    <div>
                      <dt className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Raised</dt>
                      <dd className="mt-0.5 text-[11px] text-ink-800">{fmtStamp(gate.createdAt)}</dd>
                      <dd className="text-[10.5px] text-ink-600">{fmtAgo(gate.createdAt, now)}</dd>
                    </div>
                    <div>
                      <dt className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Decided</dt>
                      <dd className="mt-0.5 text-[11px] text-ink-800">{gate.decidedAt ? fmtStamp(gate.decidedAt) : "Not decided"}</dd>
                      <dd className="text-[10.5px] text-ink-600">{gate.decidedAt ? fmtAgo(gate.decidedAt, now) : "awaiting approval"}</dd>
                    </div>
                    <div>
                      <dt className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Named signer</dt>
                      <dd className="mt-0.5 truncate text-[11px] text-ink-800">{gate.approver ?? "—"}</dd>
                      <dd className="truncate text-[10.5px] text-ink-600">
                        {gate.secondApprover
                          ? `Second approver: ${gate.secondApprover.by}`
                          : gate.firstApproval
                            ? `First approval: ${gate.firstApproval.by} · awaiting second approver`
                            : "Approver eligibility is checked before signing"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Signature</dt>
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
                      <dd className="truncate text-[10.5px] text-ink-600">
                        {gate.stepUp
                          ? `identity check · ${gate.stepUp.method} · ${gate.stepUp.by}`
                          : gate.status === "EXECUTED"
                            ? "no additional identity check recorded"
                            : "additional identity check required at approval"}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-ink-200/80 bg-paper-2/50 px-3 py-2 dark:border-white/10 dark:bg-white/[0.02]">
                    <LockKeyhole className="h-3 w-3 shrink-0 text-ink-400" aria-hidden="true" />
                    <span className="font-code text-[10px] font-bold uppercase tracking-[0.08em] text-ink-600">Verification code</span>
                    {gate.receiptHash ? (
                      <>
                        <span className="font-code text-[10px] tracking-[0.02em] text-ink-800">{shortHash(gate.receiptHash, 18)}</span>
                        <CopyButton value={gate.receiptHash} label="verification code" />
                      </>
                    ) : (
                      <span className="text-[10px] text-ink-400">No code yet — no approval has been signed.</span>
                    )}
                    <div className="ml-auto flex flex-wrap items-center gap-1.5">
                      <Button size="sm" onClick={() => void verify(gate)} disabled={verifying !== null}>
                        {verifying === gate.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                        ) : (
                          <BadgeCheck className="h-3 w-3" aria-hidden="true" />
                        )}
                        CHECK SIGNATURE
                      </Button>
                      <a
                        href="/#/dashboard"
                        className="focus-brand inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 font-code text-[10px] font-bold uppercase tracking-[0.06em] text-ink-700 transition-colors hover:border-ink-400 hover:text-ink-950 dark:border-white/12 dark:bg-white/[0.04] dark:text-ink-200 dark:hover:border-white/25 dark:hover:text-white"
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
                        <p>No receipt exists yet. It is created when an authorized officer approves the request.</p>
                      ) : result.signatureValid ? (
                        <p>
                          The saved digital signature is valid. Signed by <strong>{result.approver ?? "—"}</strong>;
                          status: {approvalStatusLabel(result.status)}.
                        </p>
                      ) : (
                        <p>
                          The receipt did <strong>not</strong> verify{result.reason ? `: ${result.reason}` : "."} Treat
                          this decision as unverified until the issue is explained.
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
            <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Why approval may be blocked</p>
          </div>
          <ul className="mt-2 space-y-1.5 text-[10.5px] leading-relaxed text-ink-500">
            <li><strong className="text-ink-700">422</strong> — the approver's name is missing. Every decision must be signed by a named person.</li>
            <li><strong className="text-ink-700">403</strong> — the approver is not on the current roster or does not hold the required office.</li>
            <li><strong className="text-ink-700">409</strong> — fewer committee members are present than required.</li>
            <li><strong className="text-ink-700">403</strong> — the identity check has expired, was already used or belongs to another document.</li>
            <li><strong className="text-ink-700">503</strong> — the roster is unavailable. Approval stays blocked until it can be checked.</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-ink-200/80 bg-paper-2/60 px-5 py-4 dark:border-white/10 dark:bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <Gavel className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
            <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Why approvals happen in the workspace</p>
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
