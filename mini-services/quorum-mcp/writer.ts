/**
 * One writer, or none.
 *
 * Two sidecar processes sharing a data directory silently overwrite each
 * other's snapshots — an executed, signed gate can vanish from the live record
 * because the other process last wrote the file. Nothing in the JSON store can
 * detect that after the fact, so the guard has to be taken before the first
 * write: a Postgres advisory lock when a database is configured, otherwise a
 * PID lock file that is refused while its owner is still alive.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

export interface WriterLock {
  ok: boolean;
  mode: "json" | "postgres";
  reason?: string;
  release: () => void;
}

interface LockFile {
  pid: number;
  startedAt: string;
  host: string;
  note?: string;
}

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    /* EPERM means the process exists but belongs to someone else. */
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

const DECISIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS quorum_decisions (
    id TEXT PRIMARY KEY,
    gate_id TEXT NOT NULL,
    tender_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    decision TEXT NOT NULL,
    gate_status TEXT NOT NULL,
    decided_at TIMESTAMPTZ NOT NULL,
    signature_key_id TEXT,
    payload_hash TEXT,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;

let postgresSql: unknown = null;

/** The handle the decisions ledger inserts through, when Postgres is in use. */
export function postgresHandle(): unknown {
  return postgresSql;
}

export async function acquireWriterLock(lockPath: string): Promise<WriterLock> {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (databaseUrl) {
    try {
      const { SQL } = (await import("bun")) as unknown as {
        SQL: new (url: string) => {
          (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
          unsafe: (query: string) => Promise<unknown>;
          close: () => Promise<void>;
        };
      };
      const sql = new SQL(databaseUrl);
      const rows = await sql`SELECT pg_try_advisory_lock(hashtext('quorum-mcp-writer')) AS held`;
      const held = rows[0]?.held === true;
      if (!held) {
        await sql.close();
        return {
          ok: false,
          mode: "postgres",
          reason:
            "Another quorum-mcp process already holds the writer lock on this database. Only one writer may own the record; stop the other process and restart.",
          release: () => undefined,
        };
      }
      await sql.unsafe(DECISIONS_TABLE);
      postgresSql = sql;
      return {
        ok: true,
        mode: "postgres",
        release: () => {
          void sql`SELECT pg_advisory_unlock(hashtext('quorum-mcp-writer'))`.finally(() => sql.close());
        },
      };
    } catch (err) {
      return {
        ok: false,
        mode: "postgres",
        reason: `The writer lock could not be taken on the configured database: ${(err as Error).message}`,
        release: () => undefined,
      };
    }
  }

  const note = "JSON store — the lock file is the only guard against a second writer.";
  let existing: LockFile | null = null;
  if (existsSync(lockPath)) {
    try {
      existing = JSON.parse(readFileSync(lockPath, "utf8")) as LockFile;
    } catch {
      existing = null;
    }
  }

  if (existing && existing.pid !== process.pid && alive(existing.pid)) {
    return {
      ok: false,
      mode: "json",
      reason: `Another quorum-mcp process (pid ${existing.pid}, started ${existing.startedAt}) already owns this record directory. Only one writer may own it; stop that process and restart.`,
      release: () => undefined,
    };
  }

  const lock: LockFile = { pid: process.pid, startedAt: new Date().toISOString(), host: "local", note };
  writeFileSync(lockPath, JSON.stringify(lock, null, 2));

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      const current = JSON.parse(readFileSync(lockPath, "utf8")) as LockFile;
      if (current.pid === process.pid) unlinkSync(lockPath);
    } catch {
      /* the lock is already gone — nothing to release */
    }
  };
  process.once("exit", release);
  process.once("SIGINT", () => {
    release();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    release();
    process.exit(143);
  });

  return { ok: true, mode: "json", release };
}
