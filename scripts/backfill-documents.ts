/**
 * backfill-documents.ts — one-time registration of the existing sample packs
 * into the Phase-4 document register. The packs predate the register; their
 * fingerprints belong on the record too. Safe to re-run: same content → no
 * new version; changed content → an honest version line.
 *
 * Run with the sidecar STOPPED (single-writer rule), then restart it.
 */

import { createHash } from "crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import type { DocumentRecord } from "../mini-services/quorum-mcp/store";

const TENDERS = join(import.meta.dir, "../mini-services/quorum-mcp/data/tenders");
const STATE = join(import.meta.dir, "../mini-services/quorum-mcp/data/state.json");

const state = JSON.parse(readFileSync(STATE, "utf8")) as { documents?: DocumentRecord[] };
const docs = state.documents ?? (state.documents = []);
const sha32 = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 32);

let registered = 0;
let versionedCount = 0;

for (const tender of readdirSync(TENDERS)) {
  const dir = join(TENDERS, tender);
  if (!statSync(dir).isDirectory()) continue;
  for (const file of readdirSync(dir)) {
    const full = join(dir, file);
    if (!statSync(full).isFile()) continue;
    let content: string;
    try {
      content = readFileSync(full, "utf8");
    } catch {
      continue; /* binary or unreadable — the register holds text packs */
    }
    const key = `tenders/${tender}/${file}`;
    const sha = sha32(content);
    const prior = docs.filter((d) => d.key === key).sort((a, b) => b.version - a.version)[0];
    const versioned = !!prior && prior.sha256 !== sha;
    if (prior && !versioned) continue;

    const now = new Date().toISOString();
    docs.unshift({
      id: `doc_${Math.random().toString(36).slice(2, 10)}`,
      tenderId: tender,
      key,
      title: file,
      kind: file.startsWith("01-") ? "NOTICE" : file.includes("-bid-") ? "BID" : file.endsWith(".json") ? "OCDS" : "OTHER",
      sha256: sha,
      version: versioned ? prior.version + 1 : 1,
      ...(versioned ? { previousSha: prior.sha256 } : {}),
      bytes: Buffer.byteLength(content),
      channel: "sample_pack",
      importer: "quorum-ops (backfill)",
      capturedAt: now,
      provenance: { originSystem: "sidecar sample pack", note: "registered retroactively when the document register was introduced" },
      retention: { schedule: file.startsWith("01-") ? "Solicitation record — confirm against the operational records schedule" : "Bid record — confirm against the operational records schedule", years: 7, disposeAfter: new Date(Date.now() + 7 * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10), status: "ACTIVE" },
      custody: [{ at: now, actor: "quorum-ops (backfill)", action: versioned ? "VERSIONED" : "REGISTERED", detail: `sha256:${sha} · backfill of the pre-register corpus` }],
    });
    registered += 1;
    if (versioned) versionedCount += 1;
  }
}

writeFileSync(STATE, JSON.stringify(state, null, 2));
console.log(`[backfill] registered ${registered} document(s) (${versionedCount} as new versions) — register now holds ${docs.length} rows.`);
