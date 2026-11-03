import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolveDataDir } from "./paths";

const snapshotPath = path.join(resolveDataDir(), "state.json");
const SNAPSHOT_KEY = "quorum-state-v1";
const jobFile = path.join(resolveDataDir(), "jobs.json");
let sqlPromise: Promise<import("bun").SQL | null> | null = null;

export interface DurableJob {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  attempts: number;
  maxAttempts?: number;
  runAt: string;
  lastError?: string;
}

async function sqlClient() {
  if (!process.env.DATABASE_URL?.trim()) return null;
  if (!sqlPromise) sqlPromise = import("bun").then(({ SQL }) => new SQL(process.env.DATABASE_URL!));
  return sqlPromise;
}

export async function initializePersistence(): Promise<"json" | "postgres"> {
  const sql = await sqlClient();
  if (!sql) return "json";
  await sql`CREATE TABLE IF NOT EXISTS quorum_snapshots (id TEXT PRIMARY KEY, body JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS quorum_jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload JSONB NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, run_at TIMESTAMPTZ NOT NULL, last_error TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`ALTER TABLE quorum_jobs ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5`;
  return "postgres";
}

export async function readJsonSnapshot(): Promise<unknown | null> {
  if (!existsSync(snapshotPath)) return null;
  try { return JSON.parse(await Bun.file(snapshotPath).text()); } catch { return null; }
}

export async function readSnapshot(): Promise<unknown | null> {
  const sql = await sqlClient();
  if (sql) {
    const rows = await sql`SELECT body FROM quorum_snapshots WHERE id = ${SNAPSHOT_KEY}` as { body: unknown }[];
    return rows[0]?.body ?? null;
  }
  return readJsonSnapshot();
}

export function persistenceStatus(): "json" | "postgres" {
  return process.env.DATABASE_URL?.trim() ? "postgres" : "json";
}

export async function writeSnapshot(snapshot: unknown): Promise<void> {
  const sql = await sqlClient();
  if (sql) {
    await sql`INSERT INTO quorum_snapshots (id, body, updated_at) VALUES (${SNAPSHOT_KEY}, ${JSON.stringify(snapshot)}::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, updated_at = NOW()`;
    return;
  }
  mkdirSync(path.dirname(snapshotPath), { recursive: true });
  const tmp = `${snapshotPath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
  renameSync(tmp, snapshotPath);
}

async function readJsonJobs(): Promise<DurableJob[]> {
  if (!existsSync(jobFile)) return [];
  try { return JSON.parse(await Bun.file(jobFile).text()) as DurableJob[]; } catch { return []; }
}

async function writeJsonJobs(jobs: DurableJob[]): Promise<void> {
  mkdirSync(path.dirname(jobFile), { recursive: true });
  const tmp = `${jobFile}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(jobs, null, 2));
  renameSync(tmp, jobFile);
}

let jsonJobsChain: Promise<void> = Promise.resolve();
async function mutateJsonJobs<T>(mutate: (jobs: DurableJob[]) => Promise<{ value: T; write: boolean }> | { value: T; write: boolean }): Promise<T> {
  const previous = jsonJobsChain;
  let release!: () => void;
  jsonJobsChain = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const jobs = await readJsonJobs();
    const result = await mutate(jobs);
    if (result.write) await writeJsonJobs(jobs);
    return result.value;
  } finally {
    release();
  }
}

export function claimJsonDueJobs(jobs: DurableJob[], now = Date.now(), limit = 20): DurableJob[] {
  const due = jobs.filter((job) => (job.status === "PENDING" || job.status === "FAILED") && job.attempts < (job.maxAttempts ?? 5) && Date.parse(job.runAt) <= now)
    .sort((a, b) => a.runAt.localeCompare(b.runAt)).slice(0, Math.max(1, Math.min(limit, 100)));
  for (const job of due) {
    job.status = "RUNNING";
    job.attempts += 1;
    job.maxAttempts ??= 5;
  }
  return due.map((job) => ({ ...job, status: "RUNNING" }));
}

export function finishJsonJob(jobs: DurableJob[], id: string, error: string | undefined, now = Date.now()): void {
  const job = jobs.find((item) => item.id === id);
  if (!job) return;
  job.status = error ? "FAILED" : "DONE";
  job.lastError = error?.slice(0, 500);
  job.runAt = new Date(error ? now + Math.min(3_600_000, 30_000 * 2 ** Math.min(job.attempts, 7)) : now).toISOString();
}

export function retryStaleJsonJobs(jobs: DurableJob[], staleAfterMs = 60_000, now = Date.now()): number {
  const staleBefore = now - Math.max(10_000, staleAfterMs);
  let recovered = 0;
  for (const job of jobs) if (job.status === "RUNNING" && Date.parse(job.runAt) < staleBefore) {
    job.status = "FAILED";
    job.runAt = new Date(now).toISOString();
    job.lastError ??= "worker lease expired";
    recovered += 1;
  }
  return recovered;
}

export async function enqueueDurableJob(job: DurableJob): Promise<void> {
  const maxAttempts = Math.max(1, Math.min(job.maxAttempts ?? 5, 20));
  const sql = await sqlClient();
  if (sql) {
    await sql`INSERT INTO quorum_jobs (id, kind, payload, status, attempts, max_attempts, run_at, last_error) VALUES (${job.id}, ${job.kind}, ${JSON.stringify(job.payload)}::jsonb, ${job.status}, ${job.attempts}, ${maxAttempts}, ${job.runAt}, ${job.lastError ?? null}) ON CONFLICT (id) DO NOTHING`;
    return;
  }
  await mutateJsonJobs((jobs) => {
    if (jobs.some((item) => item.id === job.id)) return { value: undefined, write: false };
    jobs.push({ ...job, maxAttempts });
    return { value: undefined, write: true };
  });
}

export async function claimDueJobs(limit = 20): Promise<DurableJob[]> {
  const sql = await sqlClient();
  if (!sql) {
    return mutateJsonJobs((jobs) => {
      const due = claimJsonDueJobs(jobs, Date.now(), limit);
      return { value: due, write: due.length > 0 };
    });
  }
  const rows = await sql.begin(async (tx) => {
    const due = await tx`SELECT id, kind, payload, status, attempts, max_attempts, run_at, last_error FROM quorum_jobs WHERE status IN ('PENDING','FAILED') AND attempts < max_attempts AND run_at <= NOW() ORDER BY run_at LIMIT ${Math.max(1, Math.min(limit, 100))} FOR UPDATE SKIP LOCKED` as Record<string, unknown>[];
    for (const row of due) await tx`UPDATE quorum_jobs SET status = 'RUNNING', attempts = attempts + 1, updated_at = NOW() WHERE id = ${String(row.id)}`;
    return due;
  });
  return rows.map((row) => ({
    id: String(row.id), kind: String(row.kind), payload: row.payload as Record<string, unknown>, status: "RUNNING",
    attempts: Number(row.attempts) + 1, maxAttempts: Number(row.max_attempts ?? 5), runAt: new Date(String(row.run_at)).toISOString(),
    ...(row.last_error ? { lastError: String(row.last_error) } : {}),
  }));
}

export async function finishDurableJob(id: string, error?: string): Promise<void> {
  const sql = await sqlClient();
  const status = error ? "FAILED" : "DONE";
  if (!sql) {
    await mutateJsonJobs((jobs) => {
      finishJsonJob(jobs, id, error);
      return { value: undefined, write: jobs.some((item) => item.id === id) };
    });
    return;
  }
  await sql`UPDATE quorum_jobs SET status = ${status}, last_error = ${error?.slice(0, 500) ?? null}, run_at = CASE WHEN ${Boolean(error)} THEN NOW() + LEAST(3600000, 30000 * POWER(2, LEAST(attempts, 7))) * INTERVAL '1 millisecond' ELSE NOW() END, updated_at = NOW() WHERE id = ${id}`;
}

export async function heartbeatDurableJob(id: string): Promise<void> {
  const sql = await sqlClient();
  if (!sql) {
    await mutateJsonJobs((jobs) => {
      const job = jobs.find((item) => item.id === id && item.status === "RUNNING");
      if (job) job.runAt = new Date().toISOString();
      return { value: undefined, write: Boolean(job) };
    });
    return;
  }
  await sql`UPDATE quorum_jobs SET updated_at = NOW() WHERE id = ${id} AND status = 'RUNNING'`;
}

/** Requeue a completed queue item when its persisted workflow record is still RUNNING. */
export async function requeueDurableJob(id: string): Promise<boolean> {
  const sql = await sqlClient();
  if (!sql) {
    return mutateJsonJobs((jobs) => {
      const job = jobs.find((item) => item.id === id);
      if (!job || job.status === "PENDING" || job.status === "RUNNING" || job.attempts >= (job.maxAttempts ?? 5)) return { value: false, write: false };
      job.status = "PENDING";
      job.runAt = new Date().toISOString();
      job.lastError = "workflow record was still RUNNING after restart";
      return { value: true, write: true };
    });
  }
  const rows = await sql`UPDATE quorum_jobs SET status = 'PENDING', run_at = NOW(), last_error = 'workflow record was still RUNNING after restart', updated_at = NOW() WHERE id = ${id} AND status IN ('DONE','FAILED') AND attempts < max_attempts RETURNING id` as { id: string }[];
  return rows.length > 0;
}

export async function retryStaleRunningJobs(staleAfterMs = 60_000): Promise<number> {
  const sql = await sqlClient();
  if (!sql) {
    return mutateJsonJobs((jobs) => {
      const recovered = retryStaleJsonJobs(jobs, staleAfterMs);
      return { value: recovered, write: recovered > 0 };
    });
  }
  const retryAt = new Date().toISOString();
  const rows = await sql`UPDATE quorum_jobs SET status = 'FAILED', run_at = ${retryAt}, last_error = COALESCE(last_error, 'worker lease expired'), updated_at = NOW() WHERE status = 'RUNNING' AND updated_at < NOW() - (${Math.max(10_000, staleAfterMs)} * INTERVAL '1 millisecond') RETURNING id` as { id: string }[];
  return rows.length;
}

export async function listDurableJobs(limit = 100): Promise<DurableJob[]> {
  const sql = await sqlClient();
  if (!sql) return (await readJsonJobs()).sort((a, b) => b.runAt.localeCompare(a.runAt)).slice(0, Math.max(1, Math.min(limit, 500))).map((job) => ({ ...job, maxAttempts: job.maxAttempts ?? 5 }));
  const rows = await sql`SELECT id, kind, payload, status, attempts, max_attempts, run_at, last_error FROM quorum_jobs ORDER BY updated_at DESC LIMIT ${Math.max(1, Math.min(limit, 500))}` as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id), kind: String(row.kind), payload: row.payload as Record<string, unknown>,
    status: String(row.status) as DurableJob["status"], attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts ?? 5),
    runAt: new Date(String(row.run_at)).toISOString(),
    ...(row.last_error ? { lastError: String(row.last_error) } : {}),
  }));
}

export async function migrateJsonSnapshotToPostgres(): Promise<{ migrated: boolean; reason?: string }> {
  const sql = await sqlClient();
  if (!sql) return { migrated: false, reason: "DATABASE_URL is not configured" };
  const rows = await sql`SELECT body FROM quorum_snapshots WHERE id = ${SNAPSHOT_KEY}` as { body: unknown }[];
  if (rows.length) return { migrated: false, reason: "Postgres snapshot already exists; refusing to overwrite it" };
  if (!existsSync(snapshotPath)) return { migrated: false, reason: "state.json is absent" };
  const snapshot = JSON.parse(await Bun.file(snapshotPath).text());
  await writeSnapshot(snapshot);
  return { migrated: true };
}
