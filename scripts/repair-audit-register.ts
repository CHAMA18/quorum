#!/usr/bin/env bun
/**
 * Repair the audit segment register.
 *
 * The log is never edited. What this command does is seal the restart points
 * that were never recorded: it splits the file into its segments, verifies each
 * one internally, and writes a signed epoch record for every segment the
 * register does not cover yet. A restart then reads as an attributed epoch
 * instead of an unexplained break, and the original register is kept beside the
 * new one.
 *
 *   bun scripts/repair-audit-register.ts           # seal what is missing
 *   bun scripts/repair-audit-register.ts --check   # report only, change nothing
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolveDataDir } from "../mini-services/quorum-mcp/paths";
import {
  reconcileRegister,
  splitSegments,
  verifyChain,
  type ChainEntry,
  type SegmentRecord,
} from "../mini-services/quorum-mcp/audit-chain";
import { secretFor } from "../mini-services/quorum-mcp/secrets";

const data = resolveDataDir();
const logPath = `${data}tool-log.jsonl`;
const registerPath = `${data}log-segments.jsonl`;
const checkOnly = process.argv.includes("--check");

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

if (!existsSync(logPath)) {
  console.log(`No audit log at ${logPath} — there is nothing to repair.`);
  process.exit(0);
}

const secret = secretFor("audit");
const entries = readJsonl<ChainEntry>(logPath);
const register = readJsonl<SegmentRecord>(registerPath);
const before = verifyChain(entries, register, secret);
const segments = splitSegments(entries);

console.log(`Audit log: ${entries.length} line(s), ${segments.length} segment(s).`);
console.log(`Register: ${register.length} epoch(s).`);
if (before.restarts.length) {
  for (const restart of before.restarts) {
    console.log(`  · chain restarted at line ${restart.line} (seq ${restart.seq}, ${restart.at})`);
  }
}

if (before.ok) {
  console.log("The record already verifies across its epochs — nothing to repair.");
  process.exit(0);
}

if (checkOnly) {
  console.log(`Dry run only. ${before.registerReason ?? `the chain breaks at line ${(before.brokenAt ?? 0) + 1}`}.`);
  process.exit(1);
}

const { register: next, added } = reconcileRegister(entries, register, secret, "repair-cli");
if (!added.length) {
  console.log(`No epoch can be sealed: ${before.registerReason ?? "the log does not chain internally."}`);
  process.exit(1);
}

/* Keep the register exactly as it was before this repair. */
if (existsSync(registerPath)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(`${registerPath}.previous-${stamp}`, readFileSync(registerPath));
}
writeFileSync(registerPath, next.map((record) => JSON.stringify(record)).join("\n") + "\n");

const after = verifyChain(entries, next, secret);
console.log(`Sealed ${added.length} epoch(s): ${added.map((record) => record.n).join(", ")}.`);
if (after.ok) {
  console.log(
    `The record verifies: ${after.lines} line(s) across ${after.segments} epoch(s). A restart is now proof of a restart, not a break.`,
  );
  process.exit(0);
}
console.log(`The register was sealed but the record still does not verify: ${after.registerReason ?? `break at line ${(after.brokenAt ?? 0) + 1}`}.`);
console.log("Do not delete anything — keep the file and investigate the break.");
process.exit(1);
