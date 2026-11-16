/**
 * Move the workspace record from the local JSON file into PostgreSQL.
 *
 *   DATABASE_URL=postgres://… bun scripts/migrate-store-to-postgres.ts
 *
 * The store is one document, so the migration is one row: it reads
 * `db/quorum-store.json` (or `QUORUM_STORE_PATH`), keeps its revision, and
 * writes it as `quorum_web_store.revision + 1` only when the database does not
 * already hold a newer revision. Nothing is deleted: the file stays as the
 * offline cache, and the web app treats Postgres as the system of record as
 * soon as `DATABASE_URL` is set.
 *
 * Exit codes: 0 migrated or already current · 1 configuration/validation error.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ensureWebSchema, postgresConfigured } from "../src/lib/pg";
import { readStoreDocument, writeStoreDocument } from "../src/lib/pg-store";

const FILE = process.env.QUORUM_STORE_PATH?.trim()
  ? path.resolve(process.env.QUORUM_STORE_PATH)
  : path.resolve("db", "quorum-store.json");

function fail(message: string): never {
  console.error(`FAIL — ${message}`);
  process.exit(1);
}

if (!postgresConfigured()) fail("DATABASE_URL is not set. Point it at the target database.");

let raw: Record<string, unknown>;
if (!existsSync(FILE)) fail(`No store file at ${FILE}. Nothing to migrate.`);
try {
  raw = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, unknown>;
} catch {
  fail(`${FILE} is not valid JSON.`);
}
if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(`${FILE} does not contain a store document.`);

await ensureWebSchema();
const remote = await readStoreDocument();
const localRevision = typeof raw.revision === "number" && Number.isFinite(raw.revision) ? raw.revision : 0;

const count = (key: string) => (Array.isArray(raw[key]) ? (raw[key] as unknown[]).length : 0);
const summary = [
  `${count("users")} users`,
  `${count("organizations")} organizations`,
  `${count("sessions")} officer sessions`,
  `${count("orgSessions")} supplier sessions`,
  `${count("committeeMembers")} committee members`,
  `${count("invites")} invites`,
  `${count("notifications")} notifications`,
].join(" · ");

if (remote && remote.revision >= localRevision) {
  console.log(
    `ALREADY CURRENT — Postgres holds revision ${remote.revision}; ${FILE} is at ${localRevision}. Nothing written.`,
  );
  console.log(`Records: ${summary}`);
  process.exit(0);
}

const revision = Math.max(localRevision, remote?.revision ?? 0) + 1;
const written = await writeStoreDocument(raw, revision);
if (!written) fail("The database refused the write; a newer revision is already stored.");

console.log(`MIGRATED — wrote revision ${revision} to quorum_web_store.`);
console.log(`Records: ${summary}`);
console.log(`Source file: ${FILE} (kept as the offline cache)`);
