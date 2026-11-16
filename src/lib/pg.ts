/**
 * Postgres — the workspace's system of record.
 *
 * Quorum no longer calls a hosted identity provider. Accounts, sessions,
 * organization logins, invite claims and the workspace record itself live in
 * this database. The web server talks to it through one pooled client; every
 * statement is parameterised.
 *
 * Configuration is deliberate and boring:
 *  - `DATABASE_URL` turns persistence on. Without it the app runs on the local
 *    file store (development, unit tests, an offline demo) and says so in
 *    `/api/health` instead of pretending a database is attached.
 *  - `DATABASE_SSL=require` (or `sslmode=require` in the URL) negotiates TLS,
 *    which hosted providers need.
 *  - If the database is unreachable the pool fails fast rather than hanging a
 *    request; callers surface the failure instead of silently dropping a write.
 */

import { Pool, type PoolClient } from "pg";

const WEB_DB_KEY = "quorum_web_store";

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

export function databaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url ? url : null;
}

export function postgresConfigured(): boolean {
  return databaseUrl() !== null;
}

function sslOption(): false | { rejectUnauthorized: boolean } {
  const url = databaseUrl() ?? "";
  const mode = (process.env.DATABASE_SSL ?? "").trim().toLowerCase();
  const wantsTls = mode === "require" || mode === "true" || /[?&]sslmode=(require|verify-ca|verify-full)/i.test(url);
  if (!wantsTls) return false;
  return { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true" };
}

export function poolOrNull(): Pool | null {
  const url = databaseUrl();
  if (!url) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: Number(process.env.DATABASE_POOL_MAX ?? 8),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 5_000),
      allowExitOnIdle: true,
      ssl: sslOption(),
    });
    /* An idle client error must not crash the server. */
    pool.on("error", (error) => {
      console.error("[postgres] idle client error", error.message);
    });
  }
  return pool;
}

export async function pgQuery<T extends Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = poolOrNull();
  if (!client) throw new Error("DATABASE_URL is not configured.");
  const result = await client.query(text, values);
  return result.rows as T[];
}

/** One transaction, rolled back on any thrown statement. */
export async function pgTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const target = poolOrNull();
  if (!target) throw new Error("DATABASE_URL is not configured.");
  const client = await target.connect();
  try {
    await client.query("BEGIN");
    const value = await run(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Create the schema Quorum owns. Idempotent and safe to run on every boot:
 * each statement is `IF NOT EXISTS`, so a rolling restart never alters a table
 * that already exists.
 */
export async function ensureWebSchema(): Promise<void> {
  if (!postgresConfigured()) return;
  if (!schemaReady) {
    schemaReady = (async () => {
      await pgQuery(
        `CREATE TABLE IF NOT EXISTS ${WEB_DB_KEY} (
           id TEXT PRIMARY KEY,
           body JSONB NOT NULL,
           revision BIGINT NOT NULL DEFAULT 0,
           updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
         )`,
      );
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

/** Readiness: the database answers and owns its schema. */
export async function postgresHealth(): Promise<{
  configured: boolean;
  reachable: boolean;
  latencyMs: number | null;
  error: string | null;
}> {
  if (!postgresConfigured()) return { configured: false, reachable: false, latencyMs: null, error: null };
  const startedAt = Date.now();
  try {
    await pgQuery("SELECT 1 AS ok");
    return { configured: true, reachable: true, latencyMs: Date.now() - startedAt, error: null };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      latencyMs: null,
      error: error instanceof Error ? error.message.slice(0, 300) : "database unreachable",
    };
  }
}

export const STORE_ROW_ID = "default";
