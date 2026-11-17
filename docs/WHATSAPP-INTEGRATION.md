# WhatsApp integration

Gate and deadline alerts over the WhatsApp Business Cloud API. Alerts carry
a **deep link to the desk** — a decision is made by signing in, never by
replying to a message. That is the integration contract; it does not change
with credentials.

## What is built

| Layer | Where | Behaviour |
| --- | --- | --- |
| Sender | `src/lib/whatsapp.ts` + `src/lib/notifications.ts` | Proactive alerts are **template messages** (`quorum_alert`, body params: headline, summary, desk link). Free-form text is only used inside an open 24-hour window (replies), because Meta rejects business-initiated free-form sends outside one. |
| Webhook | `src/app/api/whatsapp/webhook/route.ts` | GET handshake (`hub.verify_token`), POST with `X-Hub-Signature-256` HMAC verification when `WHATSAPP_APP_SECRET` is set. |
| Inbound intents | same route | `STOP` → opt out, `START` → opt back in, `HELP`/anything else → desk link. Unknown numbers are acknowledged and ignored. Inbound can never approve, reject or sign. |
| Receipts | delivery log (`src/lib/db.ts`) | The provider message id (wamid) is stored on the send row; `sent`/`delivered`/`read`/`failed` statuses from the webhook are appended to that row. |
| Officer opt-in | notification bell + `PATCH /api/notifications/whatsapp` | Each officer sets their own number (E.164) and toggles WhatsApp in the bell footer. |
| Honest status | `whatsappStatus()` | `configured` / `templateConfigured` / `webhookConfigured` + the exact missing variables. The bell and API pages show `NO TEMPLATE` rather than a false `LIVE` when the template is missing. |

## Going live (one-time Meta setup)

1. **Meta app** — create an app at developers.facebook.com, add the
   **WhatsApp** product, and add a phone number (a dedicated business
   number; test numbers work for testing).
2. **Credentials** — copy the **permanent access token** and the
   **Phone number ID** from WhatsApp → API Setup.
3. **Template** — in WhatsApp → Templates create `quorum_alert`
   (Utility category, language `en`) with body text containing three
   parameters, e.g.:

   > `Quorum · {{1}}. {{2}} Open the desk to review: {{3}} Reply STOP to opt out.`

   Wait for Meta approval (usually minutes). Set `WHATSAPP_TEMPLATE_NAME`
   to the approved name.
4. **Webhook** — set `WHATSAPP_VERIFY_TOKEN` (any long random string) and
   `WHATSAPP_APP_SECRET` (the app secret), deploy, then in WhatsApp →
   Configuration subscribe the callback URL
   `https://<deployment>/api/whatsapp/webhook` with
   `hub.verify_token` = your verify token and fields `messages`.
5. **Environment** — set all six variables (see `.env.example`), restart.
   Verify: `GET /api/notifications/whatsapp` (signed in) should report
   `templateConfigured: true, webhookConfigured: true`.
6. **Test** — set your number in the notification bell, trigger a gate
   alert, and confirm the delivery log shows `SENT` with a wamid, then
   `delivered`/`read` appended by the webhook. Reply `STOP` and confirm
   the bell toggle switches off; reply `START` to return.

## Failure behaviour

- Nothing configured → every WhatsApp send is **SKIPPED with the reason in
  the delivery log**; the in-app inbox and email are unaffected.
- Connected without a template → proactive alerts cannot send (Meta would
  reject them); the UI says `NO TEMPLATE` and sends are still logged.
- Wrong webhook signature → `403` before any state change.
- Provider error/timeout (8 s) → `FAILED` with the provider message in
  the log. Notifications never break the action they announce.
