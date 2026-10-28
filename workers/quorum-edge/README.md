# Quorum edge worker

`quorum-edge` is the Cloudflare Worker in front of the Quorum EC2 origin.

## What it does

- **HTTPS front door** for the EC2 app while the custom domain has no public
  DNS/TLS record. Every request is proxied to `ORIGIN_URL`; cookies, redirects,
  static assets and streaming bodies are preserved.
- **R2 upload gate** at `/__edge/upload` and `/__edge/object`. Both require
  `x-quorum-edge-key`; the browser never receives that secret. If R2 is not
  enabled or the `TENDERS` binding is absent, the worker answers `503` rather
  than pretending an upload succeeded. `/__edge/object` advertises
  `Accept-Ranges: bytes` and honours a single `Range` (with `If-Range`): the
  reply is `206` with `Content-Range` and only the requested bytes, or `416`
  with the total size when the range falls outside the object. Multi-range and
  malformed headers get the full `200` document. `/__edge/list` reads a
  tender's prefix (paged by R2 cursor, metadata included) so the app can
  browse every stored object without exposing the bucket; `/__edge/delete`
  removes one key for the operator-only app route (idempotent).
- **Real voice** at `/__edge/tts`: Deepgram Aura-2 through the Workers AI
  binding, with MeloTTS as a server-side fallback. Requires the same
  `x-quorum-edge-key`; `/api/muse/speak` calls it server-to-server.
- **Health** at `/__edge/health`.

The Bun sidecar, JSON/SQLite state and filesystem MCP server stay on EC2.
Workers are not a replacement for that persistent process. The Worker always
proxies whatever build is running on EC2; redeploy the web/sidecar to pick up
source changes (see [`docs/EC2_REDEPLOY.md`](../../docs/EC2_REDEPLOY.md)).

## Live

```text
https://quorum-edge.chungu424.workers.dev
https://quorum-edge.chungu424.workers.dev/__edge/health
```

## Test

`bun run test:edge` sources `.env.local` and runs `r2-gate.test.ts` against the
deployed Worker and the real `quorum-tenders` bucket: health, missing/wrong
secret (401), missing/unsafe key (422), method refusal (405), POST/PUT upload,
an exact-byte download roundtrip, a 404, closed/open/suffix byte ranges
(`206`), an unsatisfiable range (`416`), malformed/multi-range fallback and
`If-Range` revalidation, plus prefix listing, cursor paging and idempotent
key deletion.
`http-range.test.ts` and `worker.test.ts` cover the parser and gate offline. It also runs the app's
`/api/tenders/:ref/docs` upload-route test (session + role gate, type refusal,
live store). Without the edge credentials both suites skip, so CI needs no
production secrets. The gate roundtrip overwrites one small object under the
reserved `__e2e/` prefix; the route test deletes its own object when the
Cloudflare token is present.

## Deploy

```bash
set -a; . ../../.env.local; set +a
cd workers/quorum-edge
npx wrangler deploy
```

Required in `.env.local` (never committed):

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
QUORUM_EDGE_SECRET
```

`EDGE_SHARED_SECRET` is installed as a Worker secret, not a `[vars]` entry:

```bash
printf '%s' "$QUORUM_EDGE_SECRET" | npx wrangler secret put EDGE_SHARED_SECRET
```

## R2

Provisioned on 2026-10-28: bucket `quorum-tenders` exists and is bound as
`TENDERS` in `wrangler.toml`; `/__edge/health` reports `r2Bound: true`.

For a fresh account, R2 must be enabled once in the Cloudflare dashboard
before a bucket can be created. After that:

```bash
npx wrangler r2 bucket create quorum-tenders
```

Then add the binding to `wrangler.toml` and redeploy:

```toml
[[r2_buckets]]
binding = "TENDERS"
bucket_name = "quorum-tenders"
```

The S3-compatible credentials in `.env.local` are for server-side clients;
the Worker uses the `TENDERS` binding instead.
