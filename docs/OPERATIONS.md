# Running Quorum's record

This is the operational contract for the part of Quorum that matters in an
audit: the audit log, the decision ledger, the snapshot, and the keys that seal
them. Everything else can be rebuilt from the code; this cannot.

## What is on disk

| File | What it is | Can it change? |
| --- | --- | --- |
| `mini-services/quorum-mcp/data/tool-log.jsonl` | Every tool call, hash-chained | Append only |
| `mini-services/quorum-mcp/data/log-segments.jsonl` | Signed epochs: one per segment of the log | Append only |
| `mini-services/quorum-mcp/data/decisions.jsonl` | Every gate decision, hash-chained | Append only |
| `mini-services/quorum-mcp/data/log-anchors.jsonl` | Daily sealed heads of both chains | Append only |
| `mini-services/quorum-mcp/data/state.json` | Working record: gates, runs, cycle, suppliers | Mutable |
| `db/quorum-store.json` | Accounts, sessions, roster, settings | Mutable |

`GET /api/log/verify` verifies the whole log against its epochs. `GET
/api/health` reports whether a write is failing, whether a snapshot write was
**refused** because the persisted record held decisions this process did not,
and how many decided gates are unsigned.

## One writer

Only one process may write the record. With `DATABASE_URL` set the sidecar takes
`pg_advisory_lock`; without it, `data/.writer.lock` holds the PID. A second
process exits with code 78 and names the live owner. Never run two sidecars
against the same directory — the snapshot guard refuses to overwrite a newer
record, but the lock is what prevents the situation.

## Secrets

Set these in the process environment; each one may be rotated alone, and any
purpose without its own key falls back to `GATE_SECRET`.

| Purpose | Variable | Guards |
| --- | --- | --- |
| Gateway attestation | `ATTEST_SECRET` | Sidecar refuses unattested mutations |
| Step-up tokens | `STEP_UP_SECRET` | Gate decisions, replay ledger |
| Download links | `QUORUM_DOWNLOAD_SECRET` | Signed, expiring tender links |
| Notifications | `NOTIFY_SECRET` | Internal event callbacks |
| Audit epochs and anchors | `AUDIT_SECRET` | Segment register, head anchors |
| Assistant actions | `MUSE_ACTION_SECRET` | Staged proposals |

In production a missing key is a hard refusal, not a dev default. The same
applies to `GATE_SECRET` itself.

## Backups

```
0 * * * *  cd /srv/quorum && ./scripts/backup-record.sh >> /var/log/quorum-backup.log 2>&1
17 6 * * * cd /srv/quorum && bun scripts/anchor-audit-head.ts >> /var/log/quorum-anchor.log 2>&1
```

- **RPO: one hour** — the last snapshot plus the append-only log and ledger,
  which are written synchronously and lose nothing.
- **RTO: fifteen minutes** — stop the service, restore, verify, start.

Keep `QUORUM_BACKUP_DIR` on a different volume from the record. Publish anchors
to a store the application cannot write (`AUDIT_ANCHOR_URL`); a local anchor
detects editing, an external one detects replacement.

## The monthly restore drill

Do this on a copy, and record the date and the result:

1. `./scripts/backup-record.sh`
2. Stop `quorum-mcp`.
3. `./scripts/restore-record.sh <the newest archive> --yes`
4. `bun scripts/repair-audit-register.ts --check` → must print that the record
   verifies across its epochs.
5. `curl -s localhost:3031/api/log/verify` → `"ok": true`.
6. Start the service; confirm `/api/health` reports no failing writes and
   `snapshotOverwriteRefused: false`.

A drill that has not been run is not evidence. Note the date, the RTO achieved
and anything that differed from this page.

## Drill record

| Date (UTC) | Scope | Backup | Measured | Result |
| --- | --- | --- | --- | --- |
| 2026-10-29 17:32 UTC | Local copy of the live record; the live sidecar was left running | `quorum-record-20261029T173212Z.tar.gz` (104 KB, checksum ok) | 0.78 s restore + chain check; boot check clean | **PASS** — the copy was damaged first (state truncated, a fake line appended, the register and web store deleted). Restore replaced all four files byte-for-byte, removed the fake line, and the copy verified 1,246 log lines across 3 epochs with 11 gates and 11 runs. Boot check: no failing-write flags, `snapshotOverwriteRefused: false`, `auditRegisterAdded: 0` |

Archive SHA-256: `a535d9420d8d1ae557552e90815039e30218856fa9a1dd98f386f89059355fd0`.

This drill restored a copy, not the production host. The service-stop and
`curl /api/log/verify` steps were replaced by an in-process boot check against
the copy, so the production RTO is still unmeasured; the local restore itself
took under one second.

## When verification fails

1. Do not delete the log, and do not edit it by hand.
2. Run `bun scripts/repair-audit-register.ts --check` to see whether the break
   is an unsealed restart or a genuine break inside a segment.
3. If it is an unsealed restart, `bun scripts/repair-audit-register.ts` seals
   the missing epochs and keeps the previous register beside the new one.
4. If it is a break inside a segment, treat the record as compromised: preserve
   the file, compare the last anchor with the current head, and investigate.
   New decisions are refused until verification passes.

## Probe records

`bun scripts/purge-probe-records.ts` reports probe and end-to-end rows;
`--apply` archives them to `data/archive/` and removes them from the working
snapshot. The audit log and the decision ledger are never rewritten — the acts
stay on the record even when the working rows are housekeeping.

## Acceptance before a real tender

- `GET /api/log/verify` returns `ok: true` over the full record.
- `auditSpine.unsignedExecuted` is `0`.
- No anonymous read of gates, runs, suppliers, applications or the log.
- A completed restore drill with the dates recorded above.
- A member who declared a conflict is refused at the gate.
- An exported audit package verifies outside the application.
