/**
 * backup-store.ts — Phase 7: backup, restore-readiness and verification for
 * Quorum's file-backed state.
 *
 * Backup:   bun scripts/backup-store.ts
 * Verify:   bun scripts/backup-store.ts --verify backups/quorum-backup-<ts>
 *
 * What is backed up (each file hashed into a manifest):
 *   - sidecar state.json            (gates, runs, cycle, exceptions, documents, governance)
 *   - tool-log.jsonl                (the append-only audit spine)
 *   - gate-signing-key.pem          (Ed25519 — receipts verify against it; never regenerate casually)
 *   - submissions/                  (sealed filing receipts)
 *   - portal-links.json, portal-state.json
 *   - db/quorum-store.json          (the web workspace store)
 *   - data/eval/*.json              (the honest quality record)
 *
 * The manifest carries a SHA-256 per file plus an overall hash, so a backup
 * can be checked without restoring it — and a restore can be checked after.
 */

import { createHash } from "crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(import.meta.dir, "..");
const SIDECAR_DATA = join(ROOT, "mini-services/quorum-mcp/data");
const WEB_STORE_DIR = join(ROOT, "db");
const BACKUPS_DIR = join(ROOT, "backups");

const BACKUP_ITEMS: Array<{ src: string; dest: string; optional?: boolean }> = [
  { src: join(SIDECAR_DATA, "state.json"), dest: "state.json" },
  { src: join(SIDECAR_DATA, "tool-log.jsonl"), dest: "tool-log.jsonl" },
  /* The key may live in env (GATE_SIGNING_KEY) instead of disk — optional, but
     when it exists it is the single most important file in the backup. */
  { src: join(SIDECAR_DATA, "gate-signing-key.pem"), dest: "gate-signing-key.pem", optional: true },
  { src: join(SIDECAR_DATA, "portal-links.json"), dest: "portal-links.json", optional: true },
  { src: join(SIDECAR_DATA, "portal-state.json"), dest: "portal-state.json", optional: true },
  { src: join(SIDECAR_DATA, "submissions"), dest: "submissions", optional: true },
  { src: join(SIDECAR_DATA, "eval"), dest: "eval", optional: true },
  { src: join(SIDECAR_DATA, "tenders"), dest: "tenders", optional: true },
  { src: join(WEB_STORE_DIR, "quorum-store.json"), dest: "quorum-store.json" },
];

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function collectFiles(base: string, prefix = ""): string[] {
  if (!existsSync(base)) return [];
  const st = statSync(base);
  if (!st.isDirectory()) return [prefix];
  const out: string[] = [];
  for (const entry of readdirSync(base)) {
    out.push(...collectFiles(join(base, entry), prefix ? `${prefix}/${entry}` : entry));
  }
  return out;
}

function buildManifest(dir: string): { files: { path: string; sha256: string; bytes: number }[]; overall: string; createdAt: string } {
  const files = collectFiles(dir)
    .filter((p) => p !== "manifest.json")
    .sort()
    .map((p) => {
      const full = join(dir, p);
      return { path: p, sha256: sha256File(full), bytes: statSync(full).size };
    });
  const overall = createHash("sha256").update(files.map((f) => `${f.path}:${f.sha256}`).join("\n")).digest("hex");
  return { files, overall, createdAt: new Date().toISOString() };
}

const args = process.argv.slice(2);

if (args[0] === "--verify") {
  const target = resolve(args[1] ?? "");
  const manifestPath = join(target, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`[backup] no manifest at ${manifestPath}`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ReturnType<typeof buildManifest>;
  let failures = 0;
  for (const file of manifest.files) {
    const full = join(target, file.path);
    if (!existsSync(full)) {
      console.error(`  MISSING ${file.path}`);
      failures += 1;
      continue;
    }
    const sha = sha256File(full);
    if (sha !== file.sha256) {
      console.error(`  HASH MISMATCH ${file.path} — manifest ${file.sha256}, file ${sha}`);
      failures += 1;
    }
  }
  const recomputed = createHash("sha256").update(manifest.files.map((f) => `${f.path}:${f.sha256}`).join("\n")).digest("hex");
  if (recomputed !== manifest.overall) {
    console.error(`  MANIFEST HASH MISMATCH — the manifest itself was altered`);
    failures += 1;
  }
  if (failures > 0) {
    console.error(`[backup] VERIFY FAILED — ${failures} problem(s) in ${target}`);
    process.exit(1);
  }
  console.log(`[backup] VERIFY OK — ${manifest.files.length} file(s) match the manifest (${manifest.overall.slice(0, 16)}…), created ${manifest.createdAt}`);
  process.exit(0);
}

/* ── Backup ──────────────────────────────────────────────────────────────── */
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dest = join(BACKUPS_DIR, `quorum-backup-${stamp}`);
mkdirSync(dest, { recursive: true });

const copied: string[] = [];
const skipped: string[] = [];
for (const item of BACKUP_ITEMS) {
  if (!existsSync(item.src)) {
    if (item.optional) {
      skipped.push(item.dest);
      continue;
    }
    console.error(`[backup] REQUIRED item missing: ${item.src} — aborting rather than writing a partial backup`);
    rmSync(dest, { recursive: true, force: true });
    process.exit(1);
  }
  cpSync(item.src, join(dest, item.dest), { recursive: true });
  copied.push(item.dest);
}

const manifest = buildManifest(dest);
writeFileSync(join(dest, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`[backup] wrote ${dest}`);
console.log(`[backup] copied: ${copied.join(", ")}${skipped.length ? ` · skipped (absent): ${skipped.join(", ")}` : ""}`);
console.log(`[backup] manifest: ${manifest.files.length} file(s), overall ${manifest.overall.slice(0, 16)}…`);
console.log(`[backup] check it any time: bun scripts/backup-store.ts --verify ${dest}`);
