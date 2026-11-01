# Quorum edge worker

`quorum-edge` is the Cloudflare Worker in front of the Quorum app origin. The
current production origin is `https://quorum-api-tgw2.onrender.com`; Wrangler's
`ORIGIN_URL` must match the live Render service before deploying the Worker.

## What it does

- **HTTPS front door** for the Quorum app. Every request is proxied to
  `ORIGIN_URL`; cookies, redirects, static assets and streaming bodies are
  preserved. The public landing is served separately at
  `quorum-solutions.com`; this Worker is the app/R2/TTS edge.
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

The Bun sidecar, JSON/Postgres state and filesystem MCP server remain separate
from this edge Worker. The Worker is a proxy; it does not host the Next.js app
or make a missing app route available. Deploy web app source changes to the
origin in `ORIGIN_URL`, and deploy sidecar changes through the sidecar's own
deployment process.

## Live

```text
https://quorum-edge.chungu424.workers.dev/__edge/health   # edge is up
https://quorum-edge.chungu424.workers.dev                 # app proxy — depends on ORIGIN_URL
```

The root URL is only a working demo when `ORIGIN_URL` points at a live origin.
`wrangler.toml` targets the Render app origin; redeploy the Worker after
changing it (`bash scripts/deploy-edge.sh`). The Worker only proxies API paths:
the Next.js app route must also be present in the Render deployment.

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
