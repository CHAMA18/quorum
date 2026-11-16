import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveDataDir } from "./paths";

export interface LocalRecordInput {
  idempotencyKey: string;
  gateId: string;
  tenderId: string;
  bundleHash: string;
  approvedBy: string;
  approvedAt: string;
}

export interface LocalRecordReceipt {
  submissionId: string;
  hash: string;
  portal: string;
  status: "SIMULATED" | "SUBMITTED";
  simulated: boolean;
  idempotencyKey: string;
  recordedAt: string;
}

/** Local approval records preserve retry safety and never imply external submission. */
export interface LocalRecordAdapter {
  readonly name: string;
  readonly mode: "SIMULATED" | "LIVE";
  submit(input: LocalRecordInput): Promise<LocalRecordReceipt>;
}

function safeKey(key: string): string {
  if (!key || key.length > 200) throw new Error("record idempotency key is missing or too long");
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Records a local approval receipt;
 * it makes no network call and never claims that a national portal received it.
 */
export class LocalApprovalAdapter implements LocalRecordAdapter {
  readonly name = "local-approval-record";
  readonly mode = "SIMULATED" as const;
  private readonly submissionsDir: string;
  private readonly inFlight = new Map<string, Promise<LocalRecordReceipt>>();

  constructor(submissionsDir = path.join(resolveDataDir(), "submissions")) {
    this.submissionsDir = submissionsDir;
  }

  async submit(input: LocalRecordInput): Promise<LocalRecordReceipt> {
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

  private async submitOnce(input: LocalRecordInput, keyHash: string): Promise<LocalRecordReceipt> {
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
      const saved = JSON.parse(readFileSync(file, "utf8")) as { submission?: typeof expected; receipt?: LocalRecordReceipt };
      if (JSON.stringify(saved.submission) !== JSON.stringify(expected) || !saved.receipt) {
        throw new Error("local record idempotency key was already used for a different submission");
      }
      return saved.receipt;
    }

    const receipt: LocalRecordReceipt = {
      submissionId,
      hash: input.bundleHash,
      portal: "Local approval record — no external submission",
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
      const saved = JSON.parse(readFileSync(file, "utf8")) as { submission?: typeof expected; receipt?: LocalRecordReceipt };
      if (JSON.stringify(saved.submission) !== JSON.stringify(expected) || !saved.receipt) throw error;
      return saved.receipt;
    }
    return receipt;
  }
}

export function createLocalApprovalAdapter(): LocalRecordAdapter {
  return new LocalApprovalAdapter();
}
