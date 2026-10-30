import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
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
  const tmp = `${jobFile}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(jobs, null, 2));
  renameSync(tmp, jobFile);
}

export async function enqueueDurableJob(job: DurableJob): Promise<void> {
  const sql = await sqlClient();
  if (sql) {
    await sql`INSERT INTO quorum_jobs (id, kind, payload, status, attempts, run_at, last_error) VALUES (${job.id}, ${job.kind}, ${JSON.stringify(job.payload)}::jsonb, ${job.status}, ${job.attempts}, ${job.runAt}, ${job.lastError ?? null}) ON CONFLICT (id) DO NOTHING`;
    return;
  }
  const jobs = await readJsonJobs();
  if (!jobs.some((item) => item.id === job.id)) await writeJsonJobs([...jobs, job]);
}

export async function claimDueJobs(limit = 20): Promise<DurableJob[]> {
  const sql = await sqlClient();
  if (!sql) {
    const jobs = await readJsonJobs();
    const now = Date.now();
    const due = jobs.filter((job) => (job.status === "PENDING" || job.status === "FAILED") && Date.parse(job.runAt) <= now)
      .sort((a, b) => a.runAt.localeCompare(b.runAt)).slice(0, Math.max(1, Math.min(limit, 100)));
    const ids = new Set(due.map((job) => job.id));
    for (const job of jobs) if (ids.has(job.id)) { job.status = "RUNNING"; job.attempts += 1; }
    await writeJsonJobs(jobs);
    return due.map((job) => ({ ...job, status: "RUNNING", attempts: job.attempts + 1 }));
  }
  const rows = await sql.begin(async (tx) => {
    const due = await tx`SELECT id, kind, payload, status, attempts, run_at, last_error FROM quorum_jobs WHERE status IN ('PENDING','FAILED') AND run_at <= NOW() ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT ${Math.max(1, Math.min(limit, 100))}` as Record<string, unknown>[];
    for (const row of due) await tx`UPDATE quorum_jobs SET status = 'RUNNING', attempts = attempts + 1, updated_at = NOW() WHERE id = ${String(row.id)}`;
    return due;
  });
  return rows.map((row) => ({
    id: String(row.id), kind: String(row.kind), payload: row.payload as Record<string, unknown>, status: "RUNNING",
    attempts: Number(row.attempts) + 1, runAt: new Date(String(row.run_at)).toISOString(),
    ...(row.last_error ? { lastError: String(row.last_error) } : {}),
  }));
}

export async function finishDurableJob(id: string, error?: string): Promise<void> {
  const sql = await sqlClient();
  const status = error ? "FAILED" : "DONE";
  if (!sql) {
    const jobs = await readJsonJobs();
    const job = jobs.find((item) => item.id === id);
    if (job) {
      job.status = status;
      job.lastError = error?.slice(0, 500);
      job.runAt = error ? new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** Math.min(job.attempts, 7))).toISOString() : new Date().toISOString();
      await writeJsonJobs(jobs);
    }
    return;
  }
  const nextRunAt = new Date(Date.now() + 30_000).toISOString();
  await sql`UPDATE quorum_jobs SET status = ${status}, last_error = ${error?.slice(0, 500) ?? null}, run_at = ${error ? nextRunAt : new Date().toISOString()}, updated_at = NOW() WHERE id = ${id}`;
}

export async function retryStaleRunningJobs(staleAfterMs = 60_000): Promise<number> {
  const sql = await sqlClient();
  if (!sql) {
    const jobs = await readJsonJobs();
    const staleBefore = Date.now() - Math.max(10_000, staleAfterMs);
    let recovered = 0;
    for (const job of jobs) if (job.status === "RUNNING" && Date.parse(job.runAt) < staleBefore) {
      job.status = "FAILED"; job.runAt = new Date().toISOString(); job.lastError ??= "worker lease expired"; recovered += 1;
    }
    if (recovered) await writeJsonJobs(jobs);
    return recovered;
  }
  const retryAt = new Date().toISOString();
  const rows = await sql`UPDATE quorum_jobs SET status = 'FAILED', run_at = ${retryAt}, last_error = COALESCE(last_error, 'worker lease expired'), updated_at = NOW() WHERE status = 'RUNNING' AND updated_at < NOW() - (${Math.max(10_000, staleAfterMs)} * INTERVAL '1 millisecond') RETURNING id` as { id: string }[];
  return rows.length;
}

export async function listDurableJobs(limit = 100): Promise<DurableJob[]> {
  const sql = await sqlClient();
  if (!sql) return (await readJsonJobs()).sort((a, b) => b.runAt.localeCompare(a.runAt)).slice(0, Math.max(1, Math.min(limit, 500)));
  const rows = await sql`SELECT id, kind, payload, status, attempts, run_at, last_error FROM quorum_jobs ORDER BY updated_at DESC LIMIT ${Math.max(1, Math.min(limit, 500))}` as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id), kind: String(row.kind), payload: row.payload as Record<string, unknown>,
    status: String(row.status) as DurableJob["status"], attempts: Number(row.attempts),
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
