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

function keyPair(): KeyPair {
  if (cached) return cached;
  let privatePem = process.env.GATE_SIGNING_KEY?.trim() ?? "";
  if (!privatePem) {
    if (existsSync(KEY_FILE)) {
      privatePem = readFileSync(KEY_FILE, "utf8");
    } else {
      const pair = generateKeyPairSync("ed25519");
      privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      writeFileSync(KEY_FILE, privatePem, { mode: 0o600 });
      try {
        chmodSync(KEY_FILE, 0o600);
      } catch {
        /* best effort on filesystems without POSIX modes */
      }
    }
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
