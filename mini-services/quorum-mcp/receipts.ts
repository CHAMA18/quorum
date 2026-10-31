import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolveDataDir } from "./paths";
import type { Gate, GateSignature } from "./store";

/**
 * Ed25519 decision receipts.
 *
 * The hash-chained tool log proves nothing was silently rewritten *inside the
 * sidecar*. A receipt signature proves something stronger to a third party:
 * this exact gate — these inputs, this approver, this time, this outcome — was
 * signed by the key that owns the desk. The public key travels with the
 * signature, so an auditor can verify a downloaded receipt offline.
 *
 * The private key is generated on first use in the data directory (0600) or
 * supplied as GATE_SIGNING_KEY (PEM). It is never sent to the browser.
 */

const DATA = resolveDataDir();
const KEY_FILE = `${DATA}gate-signing-key.pem`;

type KeyPair = { privateKey: ReturnType<typeof createPrivateKey>; publicKeyPem: string; keyId: string };
let cached: KeyPair | null = null;

/* ── Key custody — a receipt is only as trustworthy as the key that signs it ─
   The gate key used to be auto-generated, unmanaged, on first boot in every
   environment: lose the data directory and every past gate receipt becomes
   unverifiable, with nobody holding a copy. The decision is now explicit
   and testable:
     · GATE_SIGNING_KEY wins (KMS or injected secret) — the operator's key.
     · A key file at data/gate-signing-key.pem continues the previous key —
       rotations install a file, they never silently regenerate.
     · A missing key in production is a REFUSAL: provisioned custody or no
       signing. An unmanaged key is how a receipt loses its evidentiality.
     · Development generates and keeps a key file — the sandbox stays usable;
       the file is marked so operations know it is not production custody. */
export type KeyCustodyAction =
  | { action: "ENV_KEY" }
  | { action: "FILE_KEY" }
  | { action: "GENERATE_DEV" }
  | { action: "REFUSE"; reason: string };

export function keyCustodyDecision(env: { NODE_ENV?: string; GATE_SIGNING_KEY?: string }, keyFileExists: boolean): KeyCustodyAction {
  if (env.GATE_SIGNING_KEY?.trim()) return { action: "ENV_KEY" };
  if (keyFileExists) return { action: "FILE_KEY" };
  if (env.NODE_ENV === "production") {
    return {
      action: "REFUSE",
      reason:
        "Key custody: refusing to generate an UNMANAGED signing key in production. Provision GATE_SIGNING_KEY (from KMS or secret injection), or install the existing key file at data/gate-signing-key.pem — a key nobody but the process holds cannot survive the machine, and gate receipts signed by it become unverifiable after loss.",
    };
  }
  return { action: "GENERATE_DEV" };
}

/** Which custody the live process resolved — surfaced on /api/health. */
export function signingKeyStatus(): { source: "env" | "file" | "managed-dev" | "unmanaged-dev"; keyId: string } {
  const key = keyPair();
  const source = process.env.GATE_SIGNING_KEY?.trim()
    ? "env"
    : existsSync(KEY_FILE)
      ? "file"
      : process.env.NODE_ENV === "production"
        ? "env"
        : "managed-dev";
  return { source, keyId: key.keyId };
}

function keyPair(): KeyPair {
  if (cached) return cached;
  const decision = keyCustodyDecision(
    { NODE_ENV: process.env.NODE_ENV, GATE_SIGNING_KEY: process.env.GATE_SIGNING_KEY },
    existsSync(KEY_FILE),
  );
  let privatePem: string;
  if (decision.action === "ENV_KEY") privatePem = process.env.GATE_SIGNING_KEY!.trim();
  else if (decision.action === "FILE_KEY") privatePem = readFileSync(KEY_FILE, "utf8");
  else if (decision.action === "GENERATE_DEV") {
    const pair = generateKeyPairSync("ed25519");
    privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    writeFileSync(KEY_FILE, privatePem, { mode: 0o600 });
    try {
      chmodSync(KEY_FILE, 0o600);
    } catch {
      /* best effort on filesystems without POSIX modes */
    }
    console.warn("[key-custody] generated a development gate key at", KEY_FILE, "— it is not production custody. Provision GATE_SIGNING_KEY and per the runbook in docs/KEY_CONTROL_RUNBOOK.md.");
  } else {
    throw new Error(decision.reason);
  }
  const privateKey = createPrivateKey(privatePem);
  const publicKeyPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  const keyId = createHash("sha256").update(publicKeyPem).digest("hex").slice(0, 16);
  cached = { privateKey, publicKeyPem, keyId };
  return cached;
}

export function canonicalGatePayload(gate: Gate): Record<string, unknown> {
  return {
    v: 1,
    gateId: gate.id,
    runId: gate.runId,
    tenderId: gate.tenderId,
    tool: gate.tool,
    status: gate.status,
    approver: gate.approver ?? null,
    note: gate.note ?? null,
    decidedAt: gate.decidedAt ?? null,
    executedAt: gate.executedAt ?? null,
    inputsHash: createHash("sha256").update(JSON.stringify(gate.inputs)).digest("hex"),
    receipt: gate.receipt ?? null,
    stepUp: gate.stepUp ?? null,
  };
}

export function signGate(gate: Gate): GateSignature {
  const key = keyPair();
  const payload = JSON.stringify(canonicalGatePayload(gate));
  const value = sign(null, Buffer.from(payload), key.privateKey).toString("base64");
  return {
    algorithm: "ed25519",
    keyId: key.keyId,
    publicKeyPem: key.publicKeyPem,
    payloadHash: createHash("sha256").update(payload).digest("hex"),
    value,
    signedAt: new Date().toISOString(),
  };
}

export function verifyGateSignature(gate: Gate): { ok: boolean; reason?: string } {
  const sig = gate.signature;
  if (!sig) return { ok: false, reason: "This gate has no receipt signature." };
  if (sig.algorithm !== "ed25519") return { ok: false, reason: `Unsupported signature algorithm: ${sig.algorithm}.` };
  const payload = JSON.stringify(canonicalGatePayload(gate));
  const hash = createHash("sha256").update(payload).digest("hex");
  if (hash !== sig.payloadHash) return { ok: false, reason: "The gate record changed after it was signed — the payload hash no longer matches." };
  try {
    const publicKey = createPublicKey(sig.publicKeyPem);
    const ok = verify(null, Buffer.from(payload), publicKey, Buffer.from(sig.value, "base64"));
    return ok ? { ok: true } : { ok: false, reason: "The Ed25519 signature does not verify against the embedded public key." };
  } catch {
    return { ok: false, reason: "The embedded public key or signature is malformed." };
  }
}
