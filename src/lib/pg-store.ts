/**
 * The workspace document in Postgres.
 *
 * Quorum's web state is one document: users, sessions, the committee roster,
 * invites, organizations, notification inboxes and oversight events. It is
 * written whole, so it is stored whole — one `jsonb` row carrying a monotonic
 * revision. That keeps the store's synchronous read API (every route already
 * calls it) while making Postgres the system of record.
 *
 * Writes are serialised through one queue: a burst of mutations collapses to
 * the newest document, and an older revision can never overwrite a newer one
 * (`WHERE revision < EXCLUDED.revision`). Route handlers that must not lose a
 * write — sign-in, registration, a gate-side session — await `flushStore()`.
 *
 * If `DATABASE_URL` is absent nothing here runs: the file store stays
 * authoritative, which is what unit tests and an offline demo use.
 */

import { ensureWebSchema, pgQuery, postgresConfigured, STORE_ROW_ID } from "@/lib/pg";

export interface StoreDocument {
  body: unknown;
  revision: number;
}

let pending: StoreDocument | null = null;
let chain: Promise<void> = Promise.resolve();
let lastError: string | null = null;
let lastSavedRevision = 0;
let lastSavedAt: string | null = null;

export function storePersistenceLabel(): "postgres" | "file" {
  return postgresConfigured() ? "postgres" : "file";
}

/** Read the authoritative document, if the database has one yet. */
export async function readStoreDocument(): Promise<StoreDocument | null> {
  if (!postgresConfigured()) return null;
  await ensureWebSchema();
  const rows = await pgQuery<{ body: unknown; revision: string | number }>(
    `SELECT body, revision FROM quorum_web_store WHERE id = $1`,
    [STORE_ROW_ID],
  );
  const row = rows[0];
  if (!row) return null;
  return { body: row.body, revision: Number(row.revision) || 0 };
}

/** Write one revision. Returns false when the database already holds a newer one. */
export async function writeStoreDocument(body: unknown, revision: number): Promise<boolean> {
  if (!postgresConfigured()) return false;
  await ensureWebSchema();
  const rows = await pgQuery<{ revision: string | number }>(
    `INSERT INTO quorum_web_store (id, body, revision, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (id) DO UPDATE
       SET body = EXCLUDED.body, revision = EXCLUDED.revision, updated_at = NOW()
       WHERE quorum_web_store.revision < EXCLUDED.revision
     RETURNING revision`,
    [STORE_ROW_ID, JSON.stringify(body), revision],
  );
  return rows.length > 0;
}

async function drain(): Promise<void> {
  if (!postgresConfigured()) return;
  while (pending) {
    const next = pending;
    pending = null;
    try {
      const applied = await writeStoreDocument(next.body, next.revision);
      if (applied) {
        lastSavedRevision = next.revision;
        lastSavedAt = new Date().toISOString();
      }
      lastError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "store write failed";
      lastError = message.slice(0, 300);
      console.error("[postgres] store write failed", lastError);
      /* Keep the newest document so the next flush retries it. */
      if (pending === null) {
        pending = next;
      } else {
        const queued: StoreDocument = pending;
        if (queued.revision < next.revision) pending = next;
      }
      return;
    }
  }
}

function schedule(): Promise<void> {
  chain = chain.then(drain, drain);
  return chain;
}

/**
 * Persist this revision in the background. Never throws: the caller has already
 * mutated memory and answered the user; `storeHealth()` reports the backlog.
 */
export function queueStoreWrite(body: unknown, revision: number): void {
  if (!postgresConfigured()) return;
  pending = { body, revision };
  void schedule();
}

/** Await the queue — used on paths where a lost write would break the session. */
export async function flushStoreWrites(): Promise<void> {
  if (!postgresConfigured()) return;
  await schedule();
  if (pending) {
    await schedule();
    if (pending) throw new Error(lastError ?? "The workspace record could not be saved to Postgres.");
  }
}

export function storeWriteStatus(): {
  persistence: "postgres" | "file";
  pendingRevisions: number;
  lastSavedRevision: number;
  lastSavedAt: string | null;
  lastError: string | null;
} {
  return {
    persistence: storePersistenceLabel(),
    pendingRevisions: pending ? 1 : 0,
    lastSavedRevision,
    lastSavedAt,
    lastError,
  };
}
