import { NextResponse, type NextRequest } from "next/server";
import {
  appendDeliveryStatus,
  findDeliveryByProviderMessageId,
  findUserByPhone,
  getSetting,
  setSetting,
} from "@/lib/db";
import { parsePrefs, prefsKey } from "@/lib/notification-prefs";
import {
  GRAPH_MESSAGES_URL,
  WHATSAPP_REPLIES,
  buildWhatsAppPayload,
  classifyWhatsAppText,
  parseWhatsAppWebhook,
  verifyWhatsAppSignature,
  whatsappConfigFromEnv,
} from "@/lib/whatsapp";
import {
  WATI_TEXT_URL,
  buildWatiTextPayload,
  parseWatiWebhook,
  watiConfigFromEnv,
} from "@/lib/whatsapp-wati";

/**
 * POST /api/whatsapp/webhook — Meta delivers inbound messages and delivery
 * statuses here in Graph shape; Wati delivers them in Wati `eventType`
 * shape (message / sentMessageDELIVERED_v2 / templateMessageFailed / …).
 * The branch is chosen by payload shape, so one URL serves both senders.
 * GET completes the Meta subscription handshake (Wati never calls GET).
 *
 * Security: when WHATSAPP_APP_SECRET is set, every Meta POST must carry a
 * valid X-Hub-Signature-256 (HMAC of the raw body) or it is rejected
 * before any state changes. Wati callbacks carry no signature; they are
 * validated by shape only (a `message` event with a real waId and text).
 * Unknown numbers are acknowledged and ignored — the webhook never
 * reveals which numbers hold accounts.
 *
 * What an inbound message can do: opt that number out (STOP), back in
 * (START), or get the desk link (HELP / anything else). It cannot approve,
 * reject or sign anything — a reply is always just a link.
 */
export async function GET(req: NextRequest) {
  const cfg = whatsappConfigFromEnv();
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");
  if (mode === "subscribe" && cfg.verifyToken && token === cfg.verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return NextResponse.json({ error: "WhatsApp webhook verification failed." }, { status: 403 });
}

async function replyText(to: string, body: string): Promise<void> {
  const cfg = whatsappConfigFromEnv();
  if (!cfg.token || !cfg.phoneNumberId || !to) return;
  await fetch(GRAPH_MESSAGES_URL(cfg.phoneNumberId), {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body },
    }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => undefined);
}

/** Reply through Wati's session endpoint (legal inside the 24h window —
 *  the contact just wrote to us). Best-effort by design: the pref change
 *  already happened locally, and a 403 (token without conversations
 *  scope) must never fail the webhook delivery. */
/** Handle one Wati callback. Returns the ack Wati expects. */
async function handleWati(payload: unknown): Promise<NextResponse> {
  const { messages, statuses } = parseWatiWebhook(payload);

  /* Delivery / read receipts: match the localMessageId we stored at send
   * time (fallback: the wamid), and append the status to the send record. */
  for (const s of statuses) {
    const row = findDeliveryByProviderMessageId(s.id) ?? (s.wamid ? findDeliveryByProviderMessageId(s.wamid) : null);
    if (row) appendDeliveryStatus(row.id, s.status, s.error);
  }

  for (const m of messages) {
    if (!m.from) continue;
    const user = findUserByPhone(m.from);
    if (!user) continue; /* unknown number — ack, never leak */
    const intent = classifyWhatsAppText(m.text);
    if (intent === "opt_out" || intent === "opt_in") {
      const prefs = parsePrefs(getSetting(prefsKey(user.id)));
      setSetting(prefsKey(user.id), JSON.stringify({ ...prefs, whatsapp: intent === "opt_in" }));
      await replyTextWati(m.from, WHATSAPP_REPLIES[intent]);
    } else if (intent === "help") {
      await replyTextWati(m.from, WHATSAPP_REPLIES.help);
    } else if (m.text.trim()) {
      /* A human typing at the desk number gets the desk link — never an
         action, and never a silent drop. */
      const appUrl = (process.env.QUORUM_APP_URL ?? "").replace(/\/$/, "");
      await replyTextWati(
        m.from,
        `Quorum: I can only send alerts — decisions happen on the desk.${appUrl ? ` Open ${appUrl}` : ""} Reply STOP to opt out.`,
      );
    }
  }

  return NextResponse.json({ ok: true, received: messages.length + statuses.length });
}

async function replyTextWati(to: string, body: string): Promise<void> {
  const cfg = watiConfigFromEnv();
  if (!cfg.token || !to) return;
  await fetch(WATI_TEXT_URL(cfg), {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
    body: JSON.stringify(buildWatiTextPayload(to, body)),
    signal: AbortSignal.timeout(8000),
  }).catch(() => undefined);
}

export async function POST(req: NextRequest) {
  const cfg = whatsappConfigFromEnv();
  const raw = await req.text();

  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  /* Wati branch: a single `eventType` field is the Wati shape. Ack every
   * event Wati sends (it retries non-200s up to 144 times), even ones
   * neither of us tracks. */
  if (payload !== null && typeof payload === "object" && typeof (payload as { eventType?: unknown }).eventType === "string") {
    return handleWati(payload);
  }

  if (cfg.appSecret) {
    const ok = verifyWhatsAppSignature(raw, req.headers.get("x-hub-signature-256"), cfg.appSecret);
    if (!ok) return NextResponse.json({ error: "Invalid WhatsApp signature." }, { status: 403 });
  }

  const { messages, statuses } = parseWhatsAppWebhook(payload);

  /* Delivery / read receipts: match the wamid back to the send record. */
  for (const s of statuses) {
    const row = findDeliveryByProviderMessageId(s.id);
    if (row) appendDeliveryStatus(row.id, s.status, s.error);
  }

  for (const m of messages) {
    if (!m.from) continue;
    const user = findUserByPhone(m.from);
    if (!user) continue; /* unknown number — ack, never leak */
    const intent = classifyWhatsAppText(m.text);
    if (intent === "opt_out" || intent === "opt_in") {
      const prefs = parsePrefs(getSetting(prefsKey(user.id)));
      setSetting(prefsKey(user.id), JSON.stringify({ ...prefs, whatsapp: intent === "opt_in" }));
      await replyText(m.from, WHATSAPP_REPLIES[intent]);
    } else if (intent === "help") {
      await replyText(m.from, WHATSAPP_REPLIES.help);
    } else if (m.text.trim()) {
      /* A human typing at the desk number gets the desk link — never an
         action, and never a silent drop. */
      const appUrl = (process.env.QUORUM_APP_URL ?? "").replace(/\/$/, "");
      await replyText(
        m.from,
        `Quorum: I can only send alerts — decisions happen on the desk.${appUrl ? ` Open ${appUrl}` : ""} Reply STOP to opt out.`,
      );
    }
  }

  return NextResponse.json({ ok: true, received: messages.length + statuses.length });
}
