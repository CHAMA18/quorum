# WhatsApp via Wati — integration note

**What this is:** Wati is the outbound WhatsApp *sending* provider for
Quorum alerts. Gate-waiting, deadline, decision and approval-request
alerts are delivered as the approved `quorum_alert` business-initiated
template over the WhatsApp Business number connected in the Wati
account → `POST /api/ext/v3/messageTemplates/send`
(`src/lib/whatsapp-wati.ts`). When `WATI_API_TOKEN` +
`WATI_TEMPLATE_NAME` are set, that is the sender; the Meta Graph
adapter (`src/lib/whatsapp.ts`) stays as the fallback. Inbound STOP /
START / HELP handling and delivery receipts keep the Meta webhook shape
(`/api/whatsapp/webhook`) until a Wati webhook branch lands.

**Approvals never happen over WhatsApp.** It only ever carries an
alert + desk deep link.

## Setup (one-time, ~5 minutes + approval wait)

1. **Create the API token** in Wati: Connector → API → Create API
   Token, scope `messagetemplatev3:write`. Server-only — never to the
   browser.
2. **Create the template** in Wati: Message Templates → New →
   Utility → English, name it `quorum_alert`, and set the body:
   ```
   Quorum alert: {{headline}}

   {{summary}}

   {{url}}

   Reply STOP to opt out.
   ```
   Add custom parameters named `headline`, `summary`, `url`, and the
   footer `Decisions are made on the Quorum desk — WhatsApp only
   carries a link.` Submit for Meta approval. Quorum only sends once
   Wati reports approved; until then sends return FAILED with Wati's
   error and the delivery log says why — never a fake SENT.
3. **Configure the deployment:**
   ```
   WATI_API_TOKEN=…
   WATI_API_BASE=https://live-mt-server.wati.io   (default)
   WATI_TEMPLATE_NAME=quorum_alert                 (default)
   WATI_CHANNEL_NUMBER=                            (optional — sender number, digits only)
   WATI_BROADCAST_PREFIX=quorum-alert              (default)
   ```
4. **Verify:** sign in, set your phone in the notification bell
   (WhatsApp field) and opt in. The next alert reaches the phone as
   the `quorum_alert` template; the delivery log and
   `GET /api/notifications/whatsapp → wati.configured` confirm it.
   Delivery is confirmed by Wati's `sentMessageDELIVERED` webhook,
   matching the stored `providerMessageId` (`quorum-<notification id>`).

## WhatsApp's own rule (unchanged from the Meta adapter)

Templates initiate conversations; free-form text is only for replies
inside an open 24-hour window. That is why the Wati path sends the
template and never improvises around a failure.
