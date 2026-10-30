/**
 * The decision ledger.
 *
 * The snapshot holds the working record; this holds the acts. Every approve or
 * return is one append-only line naming the gate, the officer, the decision it
 * produced and the Ed25519 receipt that seals it. Lines are hash-chained among
 * themselves, so the ledger can be verified without trusting the snapshot, and
 * nothing in the platform ever updates or deletes a line.
 */

import { appendFileSync, readFileSync } from "node:fs";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { secretFor } from "./secrets";

export interface DecisionRecord {
  seq: number;
  id: string;
  at: string;
  gateId: string;
  tenderId: string;
  workspaceId: string;
  actor: string;
  decision: "APPROVE" | "REJECT";
  gateStatus: string;
  signatureKeyId: string | null;
  payloadHash: string | null;
  prevHash: string;
  hash: string;
}

export interface DecisionInput {
  gateId: string;
  tenderId: string;
  workspaceId: string;
  actor: string;
  decision: "APPROVE" | "REJECT";
  gateStatus: string;
  signatureKeyId?: string | null;
  payloadHash?: string | null;
}

function canonical(record: Omit<DecisionRecord, "hash">): string {
  return [
    record.seq,
    record.id,
    record.at,
    record.gateId,
    record.tenderId,
    record.workspaceId,
    record.actor,
    record.decision,
    record.gateStatus,
    record.signatureKeyId ?? "",
    record.payloadHash ?? "",
    record.prevHash,
  ].join("|");
}

export function hashDecision(record: Omit<DecisionRecord, "hash">): string {
  return createHash("sha256").update(canonical(record)).digest("hex");
}

export function readLedger(path: string): DecisionRecord[] {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as DecisionRecord);
  } catch {
    return [];
  }
}

/** Append one decision. The caller has already verified and signed it. */
export function appendDecision(path: string, input: DecisionInput): DecisionRecord {
  const rows = readLedger(path);
  const prev = rows.length ? rows[rows.length - 1].hash : "genesis";
  const base: Omit<DecisionRecord, "hash"> = {
    seq: rows.length + 1,
    id: `dec_${randomUUID().slice(0, 12)}`,
    at: new Date().toISOString(),
    gateId: input.gateId,
    tenderId: input.tenderId,
    workspaceId: input.workspaceId,
    actor: input.actor,
    decision: input.decision,
    gateStatus: input.gateStatus,
    signatureKeyId: input.signatureKeyId ?? null,
    payloadHash: input.payloadHash ?? null,
    prevHash: prev,
  };
  const record: DecisionRecord = { ...base, hash: hashDecision(base) };
  appendFileSync(path, JSON.stringify(record) + "\n");
  return record;
}

export function verifyLedger(rows: DecisionRecord[]): {
  ok: boolean;
  brokenAt: number | null;
  checked: number;
  lines: number;
  head: string;
} {
  let expected = "genesis";
  for (let i = 0; i < rows.length; i++) {
    const { hash, ...rest } = rows[i];
    if (rest.prevHash !== expected || hashDecision(rest) !== hash) {
      return { ok: false, brokenAt: i, checked: i + 1, lines: rows.length, head: rows[rows.length - 1]?.hash ?? "" };
    }
    expected = hash;
  }
  return { ok: true, brokenAt: null, checked: rows.length, lines: rows.length, head: rows[rows.length - 1]?.hash ?? "" };
}

/**
 * Mirror a decision into Postgres when one is configured. The table is
 * insert-only by construction: this function issues an INSERT and nothing else.
 * A failure here never loses the line — the JSONL ledger was written first.
 */
export async function mirrorDecision(handle: unknown, record: DecisionRecord): Promise<boolean> {
  if (!handle) return false;
  try {
    const sql = handle as {
      (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
    };
    await sql`INSERT INTO quorum_decisions
      (id, gate_id, tender_id, workspace_id, actor, decision, gate_status, decided_at,
       signature_key_id, payload_hash, prev_hash, hash)
      VALUES (${record.id}, ${record.gateId}, ${record.tenderId}, ${record.workspaceId},
              ${record.actor}, ${record.decision}, ${record.gateStatus}, ${record.at},
              ${record.signatureKeyId}, ${record.payloadHash}, ${record.prevHash}, ${record.hash})
      ON CONFLICT (id) DO NOTHING`;
    return true;
  } catch {
    return false;
  }
}

/** The ledger's head, sealed — used by the daily anchor. */
export function sealLedgerHead(head: string, lines: number, at: string): string {
  return createHmac("sha256", secretFor("audit")).update(`${head}|${lines}|${at}`).digest("hex");
}
