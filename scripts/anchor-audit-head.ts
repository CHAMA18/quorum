#!/usr/bin/env bun
/**
 * Anchor the record's head.
 *
 * Verification proves the log is internally consistent *right now*. It cannot
 * prove that an older copy was not replaced wholesale. An anchor fixes the head
 * hash, the line count and the decision-ledger head at a moment in time, sealed
 * under the audit key; run it daily (cron), keep the anchors somewhere the app
 * cannot write, and a rewritten history is detectable by comparison.
 *
 *   bun scripts/anchor-audit-head.ts
 *   AUDIT_ANCHOR_URL=https://oversight.example/anchors bun scripts/anchor-audit-head.ts
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { resolveDataDir } from "../mini-services/quorum-mcp/paths";
import { verifyChain, type ChainEntry, type SegmentRecord } from "../mini-services/quorum-mcp/audit-chain";
import { readLedger, verifyLedger } from "../mini-services/quorum-mcp/decisions-ledger";
import { secretFor } from "../mini-services/quorum-mcp/secrets";

const data = resolveDataDir();

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

const secret = secretFor("audit");
const entries = readJsonl<ChainEntry>(`${data}tool-log.jsonl`);
const register = readJsonl<SegmentRecord>(`${data}log-segments.jsonl`);
const verdict = verifyChain(entries, register, secret);

if (!verdict.ok) {
  console.error(
    `Refusing to anchor a record that does not verify: ${verdict.registerReason ?? `the chain breaks at line ${(verdict.brokenAt ?? 0) + 1}`}.`,
  );
  process.exit(1);
}

const ledger = readLedger(`${data}decisions.jsonl`);
const ledgerVerdict = verifyLedger(ledger);
if (!ledgerVerdict.ok) {
  console.error(`Refusing to anchor: the decision ledger breaks at line ${(ledgerVerdict.brokenAt ?? 0) + 1}.`);
  process.exit(1);
}

const at = new Date().toISOString();
const head = entries.length ? entries[entries.length - 1].self ?? "" : "";
const body = {
  at,
  lines: entries.length,
  head,
  epochs: verdict.segments,
  ledgerHead: ledgerVerdict.head,
  ledgerLines: ledgerVerdict.lines,
};
const anchor = {
  ...body,
  sig: createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex"),
};

appendFileSync(`${data}log-anchors.jsonl`, JSON.stringify(anchor) + "\n");
console.log(
  `Anchored ${anchor.lines} log line(s) across ${anchor.epochs} epoch(s) at ${anchor.at} — head ${anchor.head || "(empty)"}.`,
);

const remote = process.env.AUDIT_ANCHOR_URL?.trim();
if (!remote) {
  console.log("No AUDIT_ANCHOR_URL set — the anchor is stored locally only. Point it at a store this app cannot write for independent proof.");
  process.exit(0);
}

try {
  const res = await fetch(remote, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(anchor),
  });
  if (!res.ok) throw new Error(`anchor endpoint answered ${res.status}`);
  console.log(`Anchor published to ${remote}.`);
} catch (err) {
  console.error(`The anchor was stored locally but could not be published: ${(err as Error).message}`);
  process.exit(1);
}
