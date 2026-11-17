# Hosting Kira

Kira is Quorum's open-weight model: Llama 3.2 3B behind an OpenAI-compatible
`/chat/completions` endpoint. The app never calls a vendor SDK — it posts the
same request body to whatever `KIRA_BASE_URL` names, so the same code works
against a hosted edge, a private inference server, or a laptop.

Two placements are supported. Both are open weights, and both are verified by
the same command.

## 1. Hosted: the quorum-edge Worker on Workers AI (live)

The Worker in `workers/quorum-edge` serves Kira itself. It binds Workers AI as
`env.AI`, fixes the model id so a caller cannot spend the binding on an
arbitrary model, and answers in the OpenAI chat-completions shape.

| | |
| --- | --- |
| Endpoint | `https://quorum-edge.chungu424.workers.dev/v1` |
| Model id | `@cf/meta/llama-3.2-3b-instruct` |
| Auth | `Authorization: Bearer <EDGE_SHARED_SECRET>`, or `x-quorum-edge-key` |
| Health | `GET /__edge/health` → `aiBound: true` |
| Residency | `MODEL_RESIDENCY=HOSTED` or `HYBRID` (Cloudflare is a hosted network) |
| Limits | plain text only: no streaming, no tool calls, no `tool` role; ≤ 100 messages, ≤ 120,000 characters, 4,096 output tokens |
| Good for | the Tender Builder, redline and summary drafting — single-turn text in, text out |
| Not good for | the desk agent's tool loop, which sends `tool` messages; that path needs a tool-capable Kira endpoint and otherwise falls back to the deterministic answer |

Current status (verified 2026-11-16): **reachable and answering**, ~0.7s warm,
valid JSON on the Tender Builder prompt.

### Point the deployed app at it

The Render web service reads the model configuration from its environment. Set
these on the `quorum-api` service (Render → Environment), then redeploy:

```text
KIRA_BASE_URL=https://quorum-edge.chungu424.workers.dev/v1
KIRA_MODEL=@cf/meta/llama-3.2-3b-instruct
KIRA_API_KEY=<the same value as EDGE_SHARED_SECRET>
MODEL_RESIDENCY=HYBRID
```

`KIRA_API_KEY` is the Worker secret `EDGE_SHARED_SECRET` (see
`scripts/deploy-edge.sh`). It is a bearer token for this deployment's own edge,
not a vendor key, so it does not expire on a billing cycle; rotate it by
re-running `wrangler secret put EDGE_SHARED_SECRET` and updating Render.

Without these variables the deployed app still works — it drafts with the
deterministic composer and labels the result `Local composer` — but it is not
using a model.

### Redeploying the edge

```bash
bash scripts/deploy-edge.sh
```

The script installs both Worker secrets and runs `wrangler deploy`. It exits 0
now: `wrangler.toml` no longer declares a route for `quorum-solutions.com`,
which is not a zone on this account. That route used to upload the Worker and
then fail the release with `zone does not exist`, so a good deploy looked
broken.

### Why the hosted route returned 502 until 2026-11-16

`kiraChat` read only the legacy Workers AI shape, `{ response: "text" }`. Meta's
current Llama build answers like OpenAI —
`{ choices: [{ message: { content } }] }` — so the text extractor found nothing
and the Worker returned `502 Kira returned no text` while the model itself was
answering in about a second. The route now accepts both shapes, content-part
arrays, and passes Workers AI's token usage through to the caller. The unit
tests cover all three, because the old suite only exercised the legacy shape
and so could not catch it.

## 2. In-region: your own inference server

Any OpenAI-compatible server works. With Ollama on a private host:

```bash
OLLAMA_HOST=0.0.0.0:11434 ollama serve   # keep it on a private network
ollama pull llama3.2:3b
```

```text
KIRA_BASE_URL=http://kira.internal:11434/v1
KIRA_MODEL=llama3.2:3b
KIRA_API_KEY=
MODEL_RESIDENCY=IN_REGION
```

`MODEL_RESIDENCY=IN_REGION` refuses any endpoint that is not localhost or a
private address, which is the point of hosting the weights yourself. Size for
the model, not the token count: a 3B at Q4_K_M is a 2 GB download and wants
roughly 4 GB of RAM; a 7B wants about 8 GB. CPU inference is fine for drafting
(a cold 3B turn on a laptop took ~19s, warm turns ~2–4s); a 7B holds JSON
better if you can afford it.

Do not expose an unauthenticated inference port to the internet. Put it behind
the app's own network or an authenticating proxy.

## Verifying a host

```bash
npm run kira:check
```

It reads `.env.local` (or the shell), prints the endpoint, model, whether a
bearer is set, and the residency policy, then sends the same JSON-seeking
request the Tender Builder sends. Exit codes: `0` reachable and answering,
`1` unreachable or answering badly, `2` no endpoint configured.

To check the hosted edge without changing your local default:

```bash
set -a; . ./.env.local; set +a
KIRA_BASE_URL=https://quorum-edge.chungu424.workers.dev/v1 \
KIRA_MODEL=@cf/meta/llama-3.2-3b-instruct \
KIRA_API_KEY="$QUORUM_EDGE_SECRET" \
npx bun scripts/kira-check.ts
```

A healthy run ends with `REACHABLE — <n>ms, valid JSON` and echoes the reply.

## When the host is down

Nothing in the workspace stops working:

- **Tender Builder** composes the brief deterministically, returns a usable
  draft, and labels it `Local composer` instead of the model id. The officer's
  budget, closing date, buyer and title are read from their own words, so those
  survive a total model outage.
- **Desk agent and review drafting** fall back to the deterministic template
  and say so in the record (`source: "template"`).

The builder's API retries once, allows 90 seconds for a cold model load, and
falls back on any non-JSON or empty answer. A host that is merely slow costs a
few seconds; a host that is gone costs nothing.
