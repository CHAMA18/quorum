/**
 * rotate-log.ts — one-time remediation for a seamed audit chain.
 *
 * The live tool-log.jsonl carried historical seams (the chain restarted at
 * genesis mid-file — the residue of an earlier interrupted spine restore).
 * This script performs the DR-runbook rotation:
 *
 *   1. byte-for-byte archive of tool-log.jsonl → tool-log.archived-<ts>.jsonl
 *   2. a fresh chain whose FIRST entry documents the rotation, naming the
 *      archive and its overall SHA-256 — so the seam is itself on the record
 *   3. seq continuity preserved from state.json (the sidecar's counter)
 *
 * Run with the sidecar STOPPED (single-writer rule).
 */

import { createHash } from "crypto";
import { copyFileSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

const DATA = join(import.meta.dir, "../mini-services/quorum-mcp/data");
const LOG = join(DATA, "tool-log.jsonl");

const raw = readFileSync(LOG, "utf8");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const archive = join(DATA, `tool-log.archived-${stamp}.jsonl`);

copyFileSync(LOG, archive);
const archiveSha = createHash("sha256").update(raw).digest("hex");

/* Fresh chain: sidecar's loadState will read this one line back; its prev is
   genesis and its self is computed the same way appendLog does (the store's
   hashOfEntry: every field except `self`). */
const state = JSON.parse(readFileSync(join(DATA, "state.json"), "utf8")) as { seq?: number };
const seq = state.seq ?? 0;

const entry = {
  seq,
  id: `tl_${String(seq).padStart(5, "0")}_rotation`,
  ts: new Date().toISOString(),
  actor: "quorum-ops",
  server: "quorum-mcp",
  tool: "log_rotation",
  kind: "IRREVERSIBLE",
  inputs: { reason: "historical chain seam — reconciled per docs/dr-runbook.md" },
  outputs: {
    archivedTo: `tool-log.archived-${stamp}.jsonl`,
    archivedSha256: archiveSha,
    archivedLines: raw.split("\n").filter((l) => l.trim()).length,
    note: "Prior segment preserved byte-for-byte. The live chain restarts here; nothing was destroyed.",
  },
  status: "OK",
  durationMs: 0,
  prev: "genesis",
};
const { self: _omit, ...rest } = entry as { self?: string };
const self = createHash("sha256").update(JSON.stringify(rest)).digest("hex").slice(0, 16);
writeFileSync(LOG, JSON.stringify({ ...entry, self }) + "\n");

console.log(`[rotation] archive: ${archive}`);
console.log(`[rotation] archive sha256: ${archiveSha.slice(0, 16)}… (${raw.split("\n").filter((l) => l.trim()).length} lines preserved)`);
console.log(`[rotation] fresh chain started at seq ${seq} — the rotation itself is the first entry.`);
