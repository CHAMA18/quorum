/**
 * The sealed bid vault.
 *
 * A supplier's price is the one fact in a tender that must not exist in
 * readable form before the public opening. The portal therefore stores an
 * AES-256-GCM envelope: a per-envelope salt and key derived from the
 * purpose-scoped vault secret, a commitment to the exact payload, and a
 * receipt signed with the same key. The amount is never written to state,
 * never returned by the application API and never visible to the desk until
 * the opening register is revealed.
 *
 * Threat model: the state file, a database row or an exported bundle may leak.
 * Without BID_VAULT_SECRET (or GATE_SECRET) the ciphertext is inert. A tampered
 * envelope fails authentication rather than yielding a wrong price.
 */

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { secretFor } from "./secrets";
import type { BidReceipt, OpeningReconciliation, SealedBidEnvelope, SupplierApplication } from "./store";

const ALGORITHM = "AES-256-GCM" as const;
const VERSION = 1 as const;
const KEY_BYTES = 32;

export interface BidPayload {
  amount: number;
  currency?: string;
  coverNote?: string;
}

export interface SealBidInput extends BidPayload {
  tenderId: string;
  orgId: string;
  orgName: string;
  receivedAt?: string;
}

function vaultKey(): string {
  return secretFor("bidvault");
}

function deriveKey(saltHex: string): Buffer {
  return scryptSync(vaultKey(), Buffer.from(saltHex, "hex"), KEY_BYTES, { N: 16384, r: 8, p: 1 });
}

/** The commitment binds the exact payload plus its tender and bidder. */
export function bidCommitment(input: {
  tenderId: string;
  orgId: string;
  orgName: string;
  amount: number;
  currency?: string;
  coverNote?: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        tenderId: input.tenderId,
        orgId: input.orgId,
        orgName: input.orgName,
        amount: input.amount,
        currency: input.currency ?? null,
        coverNote: input.coverNote ?? null,
      }),
    )
    .digest("hex");
}

function receiptSignature(receipt: Omit<BidReceipt, "signature">): string {
  return createHmac("sha256", vaultKey())
    .update(
      [
        receipt.id,
        receipt.tenderId,
        receipt.orgId,
        receipt.orgName,
        receipt.commitment,
        receipt.receivedAt,
        receipt.algorithm,
      ].join("|"),
    )
    .digest("hex");
}

export function verifyBidReceipt(receipt: BidReceipt): boolean {
  const expected = receiptSignature(receipt);
  const a = Buffer.from(expected);
  const b = Buffer.from(receipt.signature ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Seal a filing. The returned envelope is all the store ever receives. */
export function sealBid(input: SealBidInput): SealedBidEnvelope {
  const receivedAt = input.receivedAt ?? new Date().toISOString();
  const commitment = bidCommitment(input);
  const salt = randomBytes(16).toString("hex");
  const iv = randomBytes(12);
  const key = deriveKey(salt);
  const payload: BidPayload = {
    amount: input.amount,
    ...(input.currency ? { currency: input.currency } : {}),
    ...(input.coverNote ? { coverNote: input.coverNote } : {}),
  };
  /* The lowercase GCM alias selects Node's authenticated-cipher overload,
     which carries setAAD/getAuthTag; the envelope still names the standard. */
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${VERSION}|${input.tenderId}|${input.orgId}|${commitment}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]).toString("base64");
  const tag = cipher.getAuthTag().toString("base64");

  const unsigned: Omit<BidReceipt, "signature"> = {
    id: `rcpt_${randomUUID().slice(0, 12)}`,
    tenderId: input.tenderId,
    orgId: input.orgId,
    orgName: input.orgName,
    commitment,
    receivedAt,
    algorithm: ALGORITHM,
  };
  const receipt: BidReceipt = { ...unsigned, signature: receiptSignature(unsigned) };

  return {
    version: VERSION,
    algorithm: ALGORITHM,
    envelopeId: `env_${randomUUID().slice(0, 12)}`,
    salt,
    iv: iv.toString("base64"),
    tag,
    ciphertext,
    commitment,
    sealedAt: receivedAt,
    receipt,
  };
}

/** Decrypt an envelope. A tampered ciphertext or receipt throws. */
export function revealBid(envelope: SealedBidEnvelope): BidPayload {
  if (envelope.version !== VERSION || envelope.algorithm !== ALGORITHM) {
    throw new Error("Unsupported sealed-bid envelope version or algorithm.");
  }
  if (!verifyBidReceipt(envelope.receipt)) {
    throw new Error("The sealed-bid receipt signature does not verify — the envelope was altered.");
  }
  const key = deriveKey(envelope.salt);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAAD(
    Buffer.from(`${VERSION}|${envelope.receipt.tenderId}|${envelope.receipt.orgId}|${envelope.commitment}`),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  let text: string;
  try {
    text = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("The sealed-bid envelope failed authentication — decryption refused.");
  }
  const payload = JSON.parse(text) as BidPayload;
  const expected = bidCommitment({
    tenderId: envelope.receipt.tenderId,
    orgId: envelope.receipt.orgId,
    orgName: envelope.receipt.orgName,
    amount: payload.amount,
    currency: payload.currency,
    coverNote: payload.coverNote,
  });
  if (expected !== envelope.commitment) {
    throw new Error("The revealed payload does not match the commitment on the receipt.");
  }
  return payload;
}

/** Money as the opening register reads it aloud. */
export function formatPriceRead(payload: BidPayload): string {
  const amount = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(payload.amount);
  return payload.currency ? `${payload.currency} ${amount}` : amount;
}

export type ReconcileApplication = Pick<
  SupplierApplication,
  "id" | "tenderId" | "orgName" | "actor" | "amount" | "status" | "sealed" | "receiptId" | "version" | "supersedesId"
>;

/**
 * Reconcile the portal record against the register. Every received sealed
 * envelope must appear exactly once; a withdrawn or superseded filing must
 * not. Manual rows are allowed for paper bids, but a portal bid that is
 * missing from the register is an opening-integrity failure, not a footnote.
 */
export function reconcileOpening(
  applications: ReconcileApplication[],
  rows: { bidder: string; applicationId?: string; receiptId?: string }[],
): OpeningReconciliation {
  const received = applications.filter((a) => a.status === "RECEIVED");
  const sealed = received.filter((a) => !!a.sealed);
  const withdrawn = applications.filter((a) => a.status === "WITHDRAWN").length;
  const amended = applications.filter((a) => a.status === "AMENDED").length;
  const registerReceipts = new Set(rows.map((r) => r.receiptId).filter(Boolean) as string[]);
  const missingFromRegister = sealed
    .filter((a) => !a.receiptId || !registerReceipts.has(a.receiptId))
    .map((a) => `${a.orgName} (${a.id})`);
  const portalReceipts = new Set(sealed.map((a) => a.receiptId).filter(Boolean) as string[]);
  const extraInRegister = rows
    .filter((r) => r.receiptId && !portalReceipts.has(r.receiptId))
    .map((r) => r.bidder);
  const matches = missingFromRegister.length === 0 && extraInRegister.length === 0;
  return {
    sealed: sealed.length,
    manual: rows.filter((r) => !r.receiptId).length,
    derived: rows.filter((r) => !!r.receiptId).length,
    withdrawn,
    amended,
    missingFromRegister,
    extraInRegister,
    matches,
    note: matches
      ? `${sealed.length} sealed envelope${sealed.length === 1 ? "" : "s"} reconciled to the register.`
      : `Reconciliation failed: ${missingFromRegister.length} sealed envelope(s) missing, ${extraInRegister.length} register row(s) without a portal receipt.`,
  };
}

/** A desk-safe application view: no price before the certified opening. */
export function redactApplication<T extends { sealed?: SealedBidEnvelope; amount?: number; currency?: string; coverNote?: string }>(
  application: T,
): Omit<T, "sealed" | "amount" | "currency" | "coverNote"> & { sealed: boolean; receiptId?: string } {
  const { sealed, amount: _amount, currency: _currency, coverNote: _coverNote, ...rest } = application;
  const receiptId = sealed?.receipt.id;
  return { ...rest, sealed: !!sealed, ...(receiptId ? { receiptId } : {}) } as Omit<T, "sealed" | "amount" | "currency" | "coverNote"> & {
    sealed: boolean;
    receiptId?: string;
  };
}
