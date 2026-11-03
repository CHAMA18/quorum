import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveDataDir } from "./paths";

export interface EgpSubmission {
  idempotencyKey: string;
  gateId: string;
  tenderId: string;
  bundleHash: string;
  approvedBy: string;
  approvedAt: string;
}

export interface EgpReceipt {
  submissionId: string;
  hash: string;
  portal: string;
  status: "SIMULATED" | "SUBMITTED";
  simulated: boolean;
  idempotencyKey: string;
  recordedAt: string;
}

/** A portal transport must make retries safe and state its simulation status. */
export interface EgpSubmissionAdapter {
  readonly name: string;
  readonly mode: "SIMULATED" | "LIVE";
  submit(input: EgpSubmission): Promise<EgpReceipt>;
}

function safeKey(key: string): string {
  if (!key || key.length > 200) throw new Error("e-GP idempotency key is missing or too long");
  return createHash("sha256").update(key).digest("hex");
}

/**
 * The only adapter currently shipped. It records a local simulation receipt;
 * it makes no network call and never claims that a national portal received it.
 */
export class SimulatedEgpAdapter implements EgpSubmissionAdapter {
  readonly name = "local-e-gp-simulation";
  readonly mode = "SIMULATED" as const;
  private readonly submissionsDir: string;
  private readonly inFlight = new Map<string, Promise<EgpReceipt>>();

  constructor(submissionsDir = path.join(resolveDataDir(), "submissions")) {
    this.submissionsDir = submissionsDir;
  }

  async submit(input: EgpSubmission): Promise<EgpReceipt> {
    const keyHash = safeKey(input.idempotencyKey);
    const active = this.inFlight.get(keyHash);
    if (active) return active;
    const pending = this.submitOnce(input, keyHash);
    this.inFlight.set(keyHash, pending);
    try {
      return await pending;
    } finally {
      this.inFlight.delete(keyHash);
    }
  }

  private async submitOnce(input: EgpSubmission, keyHash: string): Promise<EgpReceipt> {
    const submissionId = `SIM-${keyHash.slice(0, 16).toUpperCase()}`;
    const file = path.join(this.submissionsDir, `${submissionId}.json`);
    const expected = {
      gateId: input.gateId,
      tenderId: input.tenderId,
      hash: input.bundleHash,
      approvedBy: input.approvedBy,
      approvedAt: input.approvedAt,
      idempotencyKey: input.idempotencyKey,
    };

    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, "utf8")) as { submission?: typeof expected; receipt?: EgpReceipt };
      if (JSON.stringify(saved.submission) !== JSON.stringify(expected) || !saved.receipt) {
        throw new Error("e-GP simulation idempotency key was already used for a different submission");
      }
      return saved.receipt;
    }

    const receipt: EgpReceipt = {
      submissionId,
      hash: input.bundleHash,
      portal: "e-GP sandbox (simulation only)",
      status: "SIMULATED",
      simulated: true,
      idempotencyKey: input.idempotencyKey,
      recordedAt: new Date().toISOString(),
    };
    mkdirSync(this.submissionsDir, { recursive: true });
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify({ submission: expected, receipt }, null, 2), { flag: "wx" });
    try {
      renameSync(temp, file);
    } catch (error) {
      /* Another attempt may have won the same idempotency key between the
         existence check and rename. Return its receipt if it matches. */
      if (!existsSync(file)) throw error;
      try { unlinkSync(temp); } catch { /* best-effort temp cleanup */ }
      const saved = JSON.parse(readFileSync(file, "utf8")) as { submission?: typeof expected; receipt?: EgpReceipt };
      if (JSON.stringify(saved.submission) !== JSON.stringify(expected) || !saved.receipt) throw error;
      return saved.receipt;
    }
    return receipt;
  }
}

export function createEgpAdapter(): EgpSubmissionAdapter {
  const configured = process.env.QUORUM_EGP_ADAPTER?.trim().toLowerCase();
  if (configured && configured !== "simulated") {
    throw new Error(`Unsupported QUORUM_EGP_ADAPTER "${configured}". No live e-GP adapter is installed; use "simulated".`);
  }
  return new SimulatedEgpAdapter();
}
