# EC2 redeploy — expose the Muse routes on the live origin

The live URL is served by the `quorum-edge` Worker in front of the EC2 origin.
The Worker is current, but the Next build on EC2 predates the desk assistant:
`/api/muse/chat`, `/api/muse/speak` and `/api/muse/transcribe` return
`404 {"error":"not found"}` through the edge, while `/api/muse/speak` returns
audio on a local dev server.

`scripts/redeploy-ec2.sh` rebuilds the standalone app on the host, verifies
that all three routes are in the build, restarts the services and probes them.
It keeps the previous build as `.next.prev` and restores it if the build, the
start or the probes fail.

## 1. Make sure the code is on EC2

`src/app/api/muse/speak/route.ts` is currently untracked in git, so a plain
`git pull` will not bring it. Either commit/push the working tree first, or
sync the source directories:

```bash
rsync -az --info=progress2 \
  --exclude 'mini-services/quorum-mcp/data' \
  src mini-services scripts public \
  package.json bun.lock next.config.ts tsconfig.json \
  postcss.config.mjs tailwind.config.ts components.json eslint.config.mjs bunfig.toml \
  ubuntu@ec2-15-240-7-70.af-south-1.compute.amazonaws.com:~/quorum/
```

Do not sync `.env.local`, `db/` or `mini-services/quorum-mcp/data/` — those are
the live environment and state. Adjust the host, user and path to the actual
checkout.

## 2. Run the redeploy on the host

```bash
ssh ubuntu@ec2-15-240-7-70.af-south-1.compute.amazonaws.com
cd ~/quorum
systemctl cat quorum-web | grep -E 'WorkingDirectory|ExecStart'
bash scripts/redeploy-ec2.sh
```

Defaults: `WEB_SERVICE=quorum-web`, `MCP_SERVICE=quorum-mcp`, port `3000`.
`APP_DIR` must be the checkout the unit runs from. Override if the units or
path differ:

The tender upload route reads `QUORUM_EDGE_URL` and `QUORUM_EDGE_SECRET` from
the web service environment. Without them the route fails closed with 503 and
the wizard keeps the file in the local vault; set them in the EC2 `.env.local`
before this redeploy.

```bash
APP_DIR=/srv/quorum WEB_SERVICE=quorum-web bash scripts/redeploy-ec2.sh
```

The script stops `quorum-web` (the site is down while it builds — a few
minutes on the `t4g.small`), builds, checks
`.next/standalone/.next/server/app/api/muse/{chat,speak,transcribe}/route.js`,
starts the service, restarts `quorum-mcp` when that unit exists, and waits up
to 90 s for `http://127.0.0.1:3000/`.

Expected tail:

```text
== Redeploy complete
  build:    <build id>
  service:  quorum-web
  routes:   /api/muse/{chat,speak,transcribe} are served
```

If anything fails it restores `.next.prev`, starts the old build and exits
non-zero. `KEEP_PREV=0` discards the previous build; the default keeps it.

## 3. Verify from outside

Through the Worker, a **422** (or 400/503) means the route exists; **404**
means the old build is still serving.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'content-type: application/json' --data '{}' \
  https://quorum-edge.chungu424.workers.dev/api/muse/speak
```

Expect `422` for `speak`, `422` for `chat`, `400` for `transcribe`, and `200`
for `/`. Then open the live URL and use the assistant's mic.

## Rollback

The script prints the rollback command on success. Manually:

```bash
cd ~/quorum
rm -rf .next && mv .next.prev .next
sudo systemctl restart quorum-web
```
