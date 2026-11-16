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
| `quorum_web_store` (PostgreSQL) | Accounts, sessions, roster, settings, one-time links | Mutable |
| `db/quorum-store.json` | Boot cache of the row above (and the whole store when `DATABASE_URL` is unset) | Derived |

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

## PostgreSQL

The web app keeps its workspace document in the `quorum_web_store` row and
refuses to replace a newer revision with an older one. The local
`db/quorum-store.json` is a boot cache: the process reads it synchronously, then
adopts the database's revision when it is newer. On paths that mint a session or
a one-time link the route awaits the write before answering. Two web processes
are still unsupported — they would race the same row — so keep one instance.

`bun scripts/migrate-store-to-postgres.ts` imports an existing file store once;
running it again is a no-op while the database holds a newer revision.
`GET /api/health` reports `store.persistence`, the last saved revision, any
queued write and the database round-trip.

## Alerting

A deployment that breaks silently is a deployment nobody fixed. Two layers,
because they fail differently.

**What the platform tells you.** Render notifies by email (and Slack, if
connected) on these events, each of which covers a crash loop:

| Event | Why it matters here |
| --- | --- |
| A build or deploy fails | The Pages export failing on a `force-dynamic` route crashed `quorum-static` on every deploy |
| A running service becomes unhealthy | The instance is failing its `healthCheckPath` (`/api/health`) and is being restarted |
| Render suspends a service that keeps failing to start over 24 hours | The loop did not fix itself |
| Permanent disk usage passes 80% | The sidecar writes the audit log to that disk |
| A cron job run fails | The watchdog below |

Set the level to **Only failure notifications** at Account Settings →
Notifications, and override per service on its Settings page if a noisy service
drowns out the important one. This is a dashboard toggle, not a file in this
repo — check it is on for `quorum-api` and `quorum-static` after any account
change.

**What the platform cannot see.** `/api/health` answers 200 when the process is
up, the sidecar is healthy and the database is *reachable* — but a store write
can still be failing (`store.lastError`) or queueing behind a stuck flush
(`store.pendingRevisions`). A 200 that lies is not covered by a health check,
and a static site has no health check at all. `scripts/health-watch.ts` covers
both, from outside the service, so it survives the outage it is watching for:

```
bun scripts/health-watch.ts                 # exit 0 healthy, 1 unhealthy, 2 usage
bun scripts/health-watch.ts --json           # machine-readable report
HEALTH_ALERT_WEBHOOK=https://hooks.slack.com/... bun scripts/health-watch.ts
```

It probes `/api/health` (status **and** payload: `ok`, `sidecar`, database
reachability, `store.lastError`, the queued-write backlog, the disk floor) plus
the static site's `/`, retries a cold instance before believing it, and records
outage state in `.health-watch-state.json` so a sustained outage alerts once and
then hourly rather than on every run, and recovery alerts once.

Two channels deliver it, both optional and independent:

| Variable | Delivers |
| --- | --- |
| `HEALTH_ALERT_WEBHOOK` | One JSON `POST` — Slack, Discord or Google Chat accept it as-is |
| `HEALTH_ALERT_EMAIL_TO` | Email through `RESEND_API_KEY` + `RESEND_FROM`, the account the app already sends with |

**The database expiry.** The free Render Postgres expires on a fixed date, and
nothing in the app can see it, so pass it in: `DATABASE_EXPIRES_AT=2026-12-16`.
Inside `HEALTH_EXPIRY_WARN_DAYS` (default 14) the run warns — once a day, on the
same channels — while still exiting 0, because the API is healthy today. The
report prints the warning on every run; only the notification is daily.

**Exit code is the alert channel.** Schedule it where a non-zero exit already
notifies, and no extra account is needed:

- *Render cron job* (Docker runtime, same image as `quorum-api`,
  `bun scripts/health-watch.ts`, schedule e.g. `*/15 * * * *`). A failed run
  raises the cron-failure notification above. Cron jobs bill per run, so a
  15-minute cadence is the cheap end of useful.
- *Any uptime monitor*: `https://quorum-api-tgw2.onrender.com/api/health`,
  expect HTTP 200 — but prefer a checks-based monitor that asserts
  `"ok":true` in the body, since the status alone misses the degraded case.

GitHub Actions is **not** an option on this account: jobs fail to start with
"your account is locked due to a billing issue", so a scheduled workflow here
would be a silent no-op. Do not add one.

**Drill it.** An alert path that has never fired is not evidence. Run

```
bun scripts/health-watch.ts --api http://127.0.0.1:9 --no-static --attempts 1
```

It must print `FAIL`, name the connection error and exit 1. If it exits 0, the
watchdog is blind and the schedule above is worthless.

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
