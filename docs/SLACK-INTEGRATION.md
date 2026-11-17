# Slack integration

Gate and deadline alerts posted once per event to a shared Slack channel,
with a deep link to the desk. A decision is made by signing in, never in
Slack — there are deliberately **no approve/reject buttons** in the
messages, because a Slack user id is not a Quorum account and cannot be
authenticated as an officer. That is the integration contract; it does not
change with credentials.

## What is built

| Layer | Where | Behaviour |
| --- | --- | --- |
| Sender | `src/lib/slack.ts` + `src/lib/notifications.ts` | `chat.postMessage` with a plain-text fallback + blocks (headline, summary, one “Open in Quorum” URL button). Message text is mrkdwn-escaped before interpolation. |
| Dedupe | `slackDedupeKey` + settings claim | The destination is shared, so the key is the *event* (kind + entity + title), not the recipient. A gate fanned out to five officers posts once; later deliveries log `SKIPPED — already posted`. The claim is written before the fetch so concurrent deliveries cannot race; a failed send releases it for retry. |
| Events API | `src/app/api/slack/events/route.ts` | v0 signature verification (signing secret + 5-minute freshness, `403` before any state change), `url_verification` challenge answered in plain text. Human messages in the alert channel: `stop` → mute, `start` → unmute, `help`/anything → threaded desk-link reply. Bot posts (our own alerts included) and other channels are acked and ignored — no reply loops. |
| Slash command | `src/app/api/slack/commands/route.ts` | `/quorum stop|start|help` — same signature verification, ephemeral replies only the caller sees. |
| Officer opt-in | notification bell + `PATCH /api/notifications/slack` | Per-officer toggle: “my events may be posted to the team channel”. Plus a one-click **SEND TEST** post recorded in the delivery log. |
| Honest status | `slackStatus()` | `configured` / `eventsConfigured` + the exact missing variables. Without the signing secret, posting still works but `stop`/`start` cannot be received — the bell says so. |

`stop` mutes the *shared channel* (workspace setting `slack:muted`), not
one officer — that is the only honest meaning of opt-out for a shared
destination. In-app inbox and the other channels are unaffected.

## Going live (one-time Slack setup)

1. **Slack app** — create an app at api.slack.com/apps (From scratch),
   pick the workspace. Under **OAuth & Permissions** add the bot token
   scopes `chat:write` and `channels:history` (history is needed to see
   `stop`/`start` messages in the channel; if the channel is private,
   `groups:history`). Reinstall the app and copy the **Bot User OAuth
   Token** (`xoxb-…`).
2. **Channel** — create the private alert channel (e.g. `#quorum-alerts`)
   and invite the bot (`/invite @Quorum` in that channel). Copy the
   channel ID (right-click → Copy link → the `C…` id).
3. **Events API** — under **Event Subscriptions**, enable events and set
   the Request URL to `https://<deployment>/api/slack/events`. Slack
   verifies it via the `url_verification` challenge. Subscribe to bot
   events: `message.channels` (and `message.groups` for a private
   channel) and `app_mention`.
4. **Slash command** — under **Slash Commands**, create `/quorum` with
   Request URL `https://<deployment>/api/slack/commands` and a short
   description (“Quorum alerts: stop / start / help”).
5. **Signing secret** — copy **Signing Secret** from Basic Information.
6. **Environment** — set the three variables (see `.env.example`),
   restart. Verify: `GET /api/notifications/slack` (signed in) should
   report `configured: true, eventsConfigured: true`.
7. **Test** — open the bell → **SEND TEST** and confirm the post in the
   channel and a `SENT` row in the delivery log. Type `stop` in the
   channel: the bell should show `MUTED` and further alerts log
   `SKIPPED`. Type `start` to resume.

## Failure behaviour

- Nothing configured → every Slack send is **SKIPPED with the reason in
  the delivery log**; in-app, email and WhatsApp are unaffected.
- Connected without the signing secret → alerts post, but `stop`/`start`
  and `/quorum` cannot be verified and are not received; the UI says so.
- Wrong signature or stale timestamp → `403` before any state change.
- Provider error/timeout (8 s) → `FAILED` with Slack's error in the log;
  the dedupe claim is released, so the next delivery retry can post.
