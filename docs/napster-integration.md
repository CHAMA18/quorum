# Napster Omniagent integration

*Status: diagnostics, readiness probe and live text sessions. Updated 2026-11-12.*

## 1. What the Napster API is

The Napster developer platform is an **AI-agent service** ("Omniagent"), not a
music catalogue. A project contains:

- **companions** — an agent's identity, persona, voice and avatar;
- **agents** — a deployable combination of companion, knowledge, tools and voice;
- **knowledge bases, FAQs and functions** — what the agent knows and can call;
- **sessions and recordings** — conversation history across channels.

Authentication is a project-scoped key sent in the `X-Api-Key` header. The
official base URL is `https://companion-api.napster.com`.

Quorum now has two Napster surfaces:

1. **Diagnostics** — verify the key, list companions, and probe whether the key
   can actually start a text session.
2. **Speak to Barry** — a server-minted, text-only Napster WebSocket session
   shown in the Support tab.

The Napster channel is **conversational only**. It receives no Quorum tender,
approval, supplier, deadline, audit or committee data, and it cannot change a
Quorum record. The separate **Message Barry** path remains the Quorum desk
agent: it reads live records and can stage a signed action for explicit human
confirmation.

## 2. What was added

| File | Purpose |
|---|---|
| `src/lib/napster.ts` | Server-only client: fixed HTTPS base URL, `X-Api-Key`, timeout, typed errors, HTTPS-only asset URLs, companion mapping, text-session creation, connection cleanup. |
| `src/lib/napster.test.ts` | Unit tests for auth header, mapping, pagination clamp, error mapping, key non-disclosure, unsafe-id rejection, non-JSON and network failures, session creation, agent preference, inactive-subscription mapping, missing target and readiness cleanup. |
| `src/app/api/integrations/napster/route.ts` | `GET` — owner/admin diagnostics. `POST` — create and immediately end a text session to prove the key can start conversations. |
| `src/app/api/napster/session/route.ts` | Authenticated `POST` that mints a short-lived text session and returns only its WebSocket URL. |
| `src/components/quorum/use-napster-barry.ts` | Browser WebSocket client: opens the session, sends messages, streams `message_received` text, handles session errors and cleanup. |
| `src/components/quorum/muse-assistant.tsx` | **Speak to Barry** card, live Napster state, status banner, fallback to the Quorum desk agent. |
| `.env.example` | Documents `NAPSTER_API_KEY`, `NAPSTER_TIMEOUT_MS`, `NAPSTER_AGENT_ID`, `NAPSTER_COMPANION_ID` and `NAPSTER_VOICE_ID`. |

Deliberately **not** included: companion/agent creation from Quorum, knowledge
upload, tool registration, recording access, or a Napster browser SDK.

## 3. Configuration

Add to `.env.local` (never commit it; the file is gitignored):

```bash
NAPSTER_API_KEY=your-project-scoped-key
NAPSTER_TIMEOUT_MS=10000

# Preferred: an existing Omniagent in this project.
# NAPSTER_AGENT_ID=agent_...

# Fallback: a companion-backed per-session text connection.
NAPSTER_COMPANION_ID=companion_...

# Napster still requires a voice id when creating a session, even in text mode.
NAPSTER_VOICE_ID=alloy
```

Rules:

- The key is **server-only**. Never prefix it with `NEXT_PUBLIC_`, never return
  it from an API, and never put it in client code.
- The browser receives only a **short-lived session URL**. That URL contains a
  session token, not the project key; treat it as a bearer secret and do not
  log it.
- The base URL is fixed in code to `https://companion-api.napster.com`; there
  is no environment override, so a misconfiguration cannot redirect the key to
  another host.
- Rotate the key in the Napster dashboard if it is exposed. A key pasted into a
  chat, ticket or screenshot should be treated as compromised.
- Session creation needs an **active Napster subscription** for the key's
  project. Read access to companions does not imply session access.

### Agent vs companion

`createTextSession` uses `NAPSTER_AGENT_ID` when it is set:

```
POST /public/agents/{agentId}/connections
{ "channelType": "websocket", "modality": "text", "initialSpeech": "..." }
```

Otherwise it uses the per-session endpoint with the configured companion:

```
POST /public/ws-connections
{
  "companionId": "...",
  "modality": "text",
  "providerConfig": {
    "voiceId": "alloy",
    "settings": { "instructions": "...", "temperature": 0.3 }
  },
  "initialSpeech": "..."
}
```

The per-session path is how the current project runs while it has no Omniagent.
The instructions still make the agent speak as Barry; the companion supplies
the underlying identity and voice, which is not displayed in text mode.

At the time of writing, creating an Omniagent returned
`409 AgentLimitExceeded`, and per-session creation returned
`403 InactiveSubscription`. The code path is complete, but a live session
cannot start until the project's Napster subscription is active. The
readiness probe below reports that state.

## 4. Routes

### `GET /api/integrations/napster`

Owner/admin diagnostics. Returns public companion metadata and whether a
session target is configured.

| Condition | Status | Body |
|---|---|---|
| No Quorum session | 401 | `{ error }` |
| Role cannot `manage_rules` | 403 | `{ error }` |
| More than 30 checks/minute | 429 | `{ error }` |
| `NAPSTER_API_KEY` missing | 503 | `{ configured: false, connected: false, sessionConfigured, error }` |
| Napster 401/403/404/5xx/network | 502 | `{ configured: true, connected: false, sessionConfigured, error, code, upstreamDetail? }` |
| Napster 429 | 429 | same, plus `retryAfter` |
| Success | 200 | `{ configured: true, connected: true, sessionConfigured, checkedAt, baseUrl, access: "read-only", companions }` |

The response never contains the API key or upstream request headers.

### `POST /api/integrations/napster` — session readiness

Creates a text session and immediately calls
`DELETE /public/connections/{connectionId}`. No client connects, so no
conversation starts and no agent speaks. This is the only honest test of
whether the key can start conversations; listing companions cannot prove it.

| Condition | Status | Body |
|---|---|---|
| Not signed in / not an admin | 401 / 403 | `{ error }` |
| More than 3 probes/minute, or the key is mid-connection | 429 | `{ error }` |
| Missing key | 503 | `{ ready: false, code: "not_configured", ... }` |
| No agent/companion target | 200 | `{ ready: false, code: "not_configured", sessionConfigured: false, ... }` |
| Napster refuses the session | 200 | `{ ready: false, code, error, upstreamDetail?, retryAfter? }` |
| Session created and ended | 200 | `{ ready: true, cleanedUp: true, checkedAt }` |

A `ready: false` with `code: "inactive_subscription"` means the key is valid
for reads but the project cannot start conversations. Fix billing/plan in
Napster; rotating the key will not help.

### `POST /api/napster/session`

Signed-in staff only. Mints one text session and returns:

```json
{
  "session": {
    "url": "wss://...",
    "connectionId": "conn_...",
    "expiresAt": "2026-11-12T15:00:00Z",
    "modality": "text",
    "agentId": null,
    "companionId": "companion_..."
  },
  "transport": "napster",
  "fallback": "muse"
}
```

Rate limits: 6 sessions/minute per user and one upstream connection request
every 1.5 seconds across the deployment, because Napster limits connection
creation to roughly one request per second per key. The URL is returned with
`cache-control: no-store` and `referrer-policy: no-referrer`. Failure responses
include `fallback: "muse"` so the client can continue in Quorum chat.

## 5. The Speak to Barry flow

1. The officer opens **Support → Speak to Barry**.
2. The client calls `POST /api/napster/session`.
3. The server creates a text-only session and decodes the returned base64 token
   to get its WebSocket URL. Only the URL leaves the server.
4. The browser opens the socket. Napster sends the agent's opening line, guided
   by `initialSpeech`.
5. A typed message is sent as:
   ```json
   { "type": "send_message", "data": { "role": "user", "text": "...", "trigger_response": true, "delay": false } }
   ```
6. Assistant text arrives as `message_received` events with
   `data.message.action` of `delta` (append) or `completed` (replace). The panel
   renders it in the same Barry bubble.
7. The status banner shows **Live on Napster** and offers **Use Quorum chat**.
   Switching closes the Napster socket.
8. If session creation or the WebSocket fails, the panel shows the reason and
   falls back to Quorum's desk agent. The fallback message is explicit; the
   officer is never left with a silent empty chat.

Napster's agent has **no Quorum tools**. It cannot read the desk, stage a
review, approve, reject, award, sign or change a record. If asked for live data
or an action, its instructions direct the officer to **Message Barry**.

## 6. Verify it

### Direct against Napster

```bash
curl -sS "https://companion-api.napster.com/public/companions?pageSize=5" \
  -H "X-Api-Key: $NAPSTER_API_KEY" \
  -H "Accept: application/json" | head -c 800
```

### Diagnostics

```bash
curl -sS -b "quorum_session=<your-session>" \
  "http://127.0.0.1:3000/api/integrations/napster" | head -c 1200

curl -sS -X POST -b "quorum_session=<your-session>" \
  "http://127.0.0.1:3000/api/integrations/napster" | head -c 1200
```

### Unit tests

```bash
bun test src/lib/napster.test.ts
```

The tests mock `fetch`; they do not spend Napster credits or open sockets. They
assert that the key is sent only in `X-Api-Key`, that pagination is clamped,
that a 401/429 is mapped without echoing the key, that unsafe asset URLs are
dropped, that an invalid id never reaches the network, that a companion or agent
session is created with `modality: "text"`, that an inactive subscription has a
clear code, and that the readiness probe deletes the session it created.

## 7. Error handling

| Code | Meaning | Action |
|---|---|---|
| `not_configured` | Missing key, or no agent/companion target | Set `NAPSTER_API_KEY` and `NAPSTER_AGENT_ID` or `NAPSTER_COMPANION_ID` |
| `inactive_subscription` | 403 — project has no active subscription | Activate billing/plan in Napster; retry the probe |
| `agent_limit` | 409 — organisation agent limit reached | Use a companion session, or free an agent slot |
| `unauthorized` | 401 — key missing/expired/invalid | Rotate or regenerate the key |
| `forbidden` | 403 — key cannot use this project or channel | Check project scope and session permissions |
| `not_found` | 404 — companion/agent/project not found | Check the configured id |
| `rate_limited` | 429 | Honour `Retry-After`; reduce session creation |
| `upstream` | 5xx or unexpected status | Retry later; check Napster status |
| `network` | DNS/TLS/timeout | Check egress and `NAPSTER_TIMEOUT_MS` |
| `bad_response` | 200 with non-JSON, malformed body, or an unusable token | Check the upstream response; do not retry blindly |
| `invalid_request` | Unsafe id, or a missing voice id | Use ids from the list endpoint and a valid `NAPSTER_VOICE_ID` |

The client never throws for an upstream failure and never logs the key or the
session URL. Error text is bounded to 240 characters.

## 8. Data boundary and privacy

- **No Quorum desk records leave Quorum in this channel.** The only outbound
  session request contains a companion/agent id, a voice id, Barry's
  instructions and an opening instruction. It contains no tender, bidder,
  supplier, document, gate, deadline, session or user record.
- **Napster records the conversation.** The text session and transcript live in
  Napster's project. Officers should not paste confidential documents or
  personal data into the Napster channel; the UI says it is conversational and
  points to Message Barry for desk work.
- **No API key in the browser.** The browser receives only the short-lived
  session URL. The URL is a bearer secret; it is not logged and is returned
  with no-store headers.
- **No Napster content enters the audit chain.** The session does not write a
  Quorum record. A transcript is not imported.
- **No browser SDK.** The client uses the browser's native WebSocket, so no
  third-party script bundle is added to the page.
- **Consent and residency still apply.** Before adding desk context or an
  action tool to Napster, complete the privacy review: Napster is a separate
  processor, conversations may be recorded, and procurement discussions may
  contain personal data.

## 9. Why Napster does not take Quorum actions

The Napster channel is a separate agent with no authenticated access to the
Quorum sidecar and no signed-proposal tools. Wiring those in would require a
public, per-user tool endpoint and a new privacy review. Until then:

- **Speak to Barry** = Napster conversation, no desk data, no writes.
- **Message Barry** = Quorum desk agent, live reads, one consent-gated
  `launch_review` action, and a signed confirmation card.

That separation is deliberate: the conversational channel cannot become a
back door around the human gate.

## 10. Removing the integration

1. Delete `src/lib/napster.ts`, `src/lib/napster.test.ts`,
   `src/components/quorum/use-napster-barry.ts`,
   `src/app/api/napster/` and `src/app/api/integrations/napster/`.
2. Remove `src/lib/napster.test.ts` from the `test` script in `package.json`.
3. Remove the `useNapsterBarry` import and Napster state from
   `src/components/quorum/muse-assistant.tsx`.
4. Remove `NAPSTER_API_KEY`, `NAPSTER_TIMEOUT_MS`, `NAPSTER_AGENT_ID`,
   `NAPSTER_COMPANION_ID` and `NAPSTER_VOICE_ID` from the environment and
   `.env.example`.
5. Revoke the key in the Napster dashboard.

## 11. References

- Overview: <https://developers.napster.com/docs>
- Authentication: <https://developers.napster.com/docs/introduction/authentication>
- Quickstart: <https://developers.napster.com/docs/introduction/quickstart>
- WebSockets and text sessions: <https://developers.napster.com/docs/deploying-your-omniagent/channels/websockets>
- Client commands: <https://developers.napster.com/docs/deploying-your-omniagent/messaging/client-commands>
- Server events: <https://developers.napster.com/docs/deploying-your-omniagent/messaging/server-events>
- Sessions: <https://developers.napster.com/docs/monitoring-your-omniagent/sessions>
- Agents: <https://developers.napster.com/docs/api-reference/agents/post>
- Companions API: <https://developers.napster.com/docs/api-reference/companions/get>
