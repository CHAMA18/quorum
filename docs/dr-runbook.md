# Disaster recovery and operations runbook

*Status: in force as the operating procedure for the quorum deployment (single-host,
JSON-file store + sidecar + Next.js app + Cloudflare edge).*

---

## 1. What state exists and where it lives

| Store | Path | Written by | Failure mode |
| --- | --- | --- | --- |
| Sidecar state (gates, runs, cycle, suppliers, exceptions, documents, governance) | `mini-services/quorum-mcp/data/state.json` | sidecar (atomic temp+rename, debounced 120 ms) | corruption quarantined on boot — renamed `state.corrupt-*.json`, never deleted |
| Audit spine (append-only) | `mini-services/quorum-mcp/data/tool-log.jsonl` | sidecar (append per action) | torn last line dropped with chain intact; health flagged on `/api/health` |
| Gate signing key (Ed25519) | `mini-services/quorum-mcp/data/gate-signing-key.pem` (mode 0600) | receipts.ts on first use | receipts unverifiable if lost — **back it up; never regenerate casually** |
| Submissions / receipts | `data/submissions/SUB-*.json` | filing graph | sealed bundles; regenerate nothing |
| Portal handshakes / overrides | `data/portal-links.json`, `data/portal-state.json` | connect pass / committee toggles | re-runnable |
| Web workspace store (users, sessions, committee register, sittings, notifications, oversight events) | `db/quorum-store.json` | Next app (atomic temp+rename per mutation) | single-file; backup with the rest |
| Tender documents (objects) | R2 bucket `quorum-tenders` via `quorum-edge` | edge gate | listing + etags survive; hashes re-checkable against the document register |

## 2. Backup procedure

Scheduled (cron recommended) or manual:

```bash
bun scripts/backup-store.ts            # → backups/quorum-backup-<ts>/ + manifest
```

The script copies `state.json`, `tool-log.jsonl`, `gate-signing-key.pem`, `submissions/`,
`portal-links.json`, `portal-state.json`, `db/quorum-store.json`, and the eval outputs into
a timestamped directory, then writes a **manifest with a SHA-256 per file and an overall
manifest hash**. Keep at least the last 30 daily backups plus 12 monthly; the manifest is
what an auditor checks first.

Verify a backup without restoring it:

```bash
bun scripts/backup-store.ts --verify backups/quorum-backup-<ts>
```

## 3. Restore procedure

1. Stop the sidecar and the Next app (in that order).
2. Copy the backup directory's contents back to their original paths
   (`state.json` → `mini-services/quorum-mcp/data/`, `quorum-store.json` → `db/`, …).
3. Start the sidecar; read its boot line: `audit N calls restored`. If `state.json` is
   quarantined on boot, **stop** — investigate the quarantine file before writing anything.
4. Verify the spine: `curl -s localhost:3031/api/log/verify` → `{"ok":true,...}`.
5. Verify receipts sample: `GET /api/gates` → every `signatureValid` must be `true`.
6. Start the Next app; sign in; check the Governance and Readiness screens — the readiness
   gate recomputes every criterion from the restored state and is the fastest full-body scan.
7. Spot-check a document: `GET /api/documents/:id/verify`.

RPO target: ≤ 24 h (daily backup). RTO target: ≤ 30 min (the store is small; the restore
is file copies plus verification). Test the restore quarterly into a scratch directory and
record it as a governance event.

## 4. Incident response

- **Audit health flags** (`/api/health` → `auditSpine`): `logWriteFailing` (disk full /
  permissions), `stateSaveFailing` (writes failing — memory-only until resolved),
  `stateCorrupt` (quarantined state). Any flag = investigate immediately; the platform
  keeps serving but says so everywhere.
- **Chain broken** (`/api/log/verify` → `ok:false`): freeze mutations, quarantine nothing
  manually, take a byte-for-byte copy of `tool-log.jsonl`, and reconcile the broken point
  against the document register and gate receipts before any repair.
- **Receipt invalid**: a gate whose `signatureValid` is false means its payload was altered
  post-signature — treat as a security incident, not a bug.
- **Sidecar down**: the web app's `/api/mcp-ensure` and `/api/agent-status` self-heal by
  spawning it; if it crash-loops, read `dev.log`/`server.log` and the quarantined-state
  message before restarting.

## 5. Environment separation and key hygiene

- Dev secrets (`quorum-dev-attest-secret`, step-up fallbacks) are **refused in production**
  by the sidecar and the step-up issuer — a production boot without real `GATE_SECRET` /
  `STEP_UP_SECRET` fails loudly rather than signing with a known key.
- Keys in play: `GATE_SECRET` (gateway HMAC), `STEP_UP_SECRET` (step-up tokens),
  `NOTIFY_SECRET` (webhook HMAC), `EDGE_SHARED_SECRET` (edge gate), Ed25519 signing key.
  Rotation: rotate HMAC secrets on a schedule (they authenticate, not encrypt — rotation
  is safe across a restart); the Ed25519 key rotates only with a documented key-handover
  because historical receipts verify against its embedded public key.
- Environments: local (dev secrets fine) → staging (real secrets, test data dir) →
  production (real secrets, monitored backups). The eval/bench lab never writes live state
  (`QUORUM_DATA_DIR` sandbox; bench restores the spine byte-for-byte).
- Change management: every mutation is a logged tool call; configuration changes (guards,
  bands, portals, MFA policy) name their actor. Releases: `bun run build` produces the
  standalone bundle; the change log is the git history plus the governance event log.
