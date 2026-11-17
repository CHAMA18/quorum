/**
 * Wati WhatsApp Business API (v3) — the Quorum sender adapter.
 *
 * Wati is the *sending* provider: it carries Quorum's alerts to phone
 * numbers over the WhatsApp Business number connected in the Wati
 * account. The Meta adapter in lib/whatsapp stays as the fallback, and
 * the webhook (inbound STOP/START/HELP + delivery receipts) keeps its
 * Meta shape until the Wati webhook branch lands (docs/WHATSAPP-WATI.md).
 *
 * Wati v3 contract (docs.wati.io, "Send Template Messages - V3"):
 *
 *   POST {WATI_API_BASE}/api/ext/v3/messageTemplates/send
 *   Authorization: Bearer {WATI_API_TOKEN}
 *   { template_name, broadcast_name, channel_number?,
 *     recipients: [{ phone_number, local_message_id, custom_params }] }
 *
 * `custom_params` are *named* (Wati parameter names, not Meta placeholder
 * positions) — the names are read from the approved template's own
 * definition. Until a `quorum_alert` template is approved in the Wati
 * account, sends return FAILED with Wati's error (never a fake SENT) and
 * the notification status route reports exactly what is missing.
 *
 * A 200 here means *accepted*, not delivered — delivery is confirmed by
 * Wati's sentMessageDELIVERED webhook, the same shape the Meta adapter's
 * status parser already normalises.
 *
 * Nothing here talks to the network. `buildWatiPayload` and
 * `parseWatiSendResponse` are pure so the exact request — and the exact
 * reading of Wati's reply — is unit-testable (lib/whatsapp-wati.test.ts).
 * `sendWhatsApp` in notifications.ts owns the fetch and the delivery log.
 */

import { normalizeWhatsAppNumber } from "./whatsapp";

export interface WatiConfig {
  /** Wati API token (Connector → API → Create API Token). Server-only. */
  token: string;
  /** API host, e.g. "https://live-mt-server.wati.io" (no tenant id on v3). */
  baseUrl: string;
  /** Approved template name, e.g. "quorum_alert". */
  templateName: string;
  /** Optional sender number (digits, country code, no +). Blank = default channel. */
  channelNumber: string;
  /** broadcast_name prefix — Wati groups one send under one broadcast. */
  broadcastPrefix: string;
}

const env = (key: string) => process.env[key]?.trim() ?? "";

export function watiConfigFromEnv(): WatiConfig {
  return {
    token: env("WATI_API_TOKEN"),
    baseUrl: env("WATI_API_BASE") || "https://live-mt-server.wati.io",
    templateName: env("WATI_TEMPLATE_NAME") || "quorum_alert",
    channelNumber: normalizeWhatsAppNumber(env("WATI_CHANNEL_NUMBER") || "") || "",
    broadcastPrefix: env("WATI_BROADCAST_PREFIX") || "quorum-alert",
  };
}

/** Sending needs the token + an approved template name. The name alone
 *  does not guarantee the template exists in Wati — that check happens
 *  at send time (Wati rejects an unknown name) and is reported honestly. */
export function isWatiConfigured(cfg: WatiConfig): boolean {
  return Boolean(cfg.token && cfg.templateName);
}

/** What the Integrations / API pages report — honest about which layer
 *  is missing instead of a single LIVE/OFF that hides a broken template. */
export function watiStatus(cfg: WatiConfig = watiConfigFromEnv()) {
  return {
    configured: isWatiConfigured(cfg),
    missing: [
      ...(!cfg.token ? ["WATI_API_TOKEN"] : []),
      ...(!cfg.templateName ? ["WATI_TEMPLATE_NAME (approved alert template name)"] : []),
    ],
  };
}

export const WATI_SEND_URL = (cfg: WatiConfig) =>
  `${cfg.baseUrl.replace(/\/+$/, "")}/api/ext/v3/messageTemplates/send`;

export interface WatiAlert {
  headline: string;
  summary: string;
  url: string;
}

const truncate = (text: string, max: number) =>
  text.replace(/\s+/g, " ").trim().slice(0, max) || "—";

/**
 * Build the Wati v3 send payload for one recipient.
 *
 * broadcast_name is a reference label (one broadcast per alert event);
 * local_message_id is the idempotency key Wati echoes back in the send
 * response and webhook. custom_params are the named template values —
 * the names (headline/summary/url) must match the approved template's
 * custom_params, which are set at template-creation time in the Wati
 * dashboard (see docs/WHATSAPP-WATI.md for the exact template copy).
 */
export function buildWatiPayload(
  cfg: WatiConfig,
  to: string,
  alert: WatiAlert,
  localMessageId: string,
): Record<string, unknown> {
  const recipient = normalizeWhatsAppNumber(to);
  return {
    template_name: cfg.templateName,
    broadcast_name: `${cfg.broadcastPrefix}-${localMessageId}`.slice(0, 64),
    ...(cfg.channelNumber ? { channel_number: cfg.channelNumber } : {}),
    recipients: [
      {
        phone_number: recipient,
        local_message_id: localMessageId,
        custom_params: [
          { name: "headline", value: truncate(alert.headline, 60) },
          { name: "summary", value: truncate(alert.summary, 200) },
          { name: "url", value: truncate(alert.url, 500) },
        ],
      },
    ],
  };
}

export interface WatiSendResult {
  ok: boolean;
  /** Wati's localMessageId for the send — stored as the delivery's
   *  provider message id, ready to match the DELIVERED webhook. */
  messageId?: string;
  error?: string;
}

/**
 * Totally read Wati's send response. The v3 shape is
 * `{ result, error, templateName, receivers: [{ localMessageId, waId,
 * isValidWhatsAppNumber, errors }] }`; anything else — including a 200
 * with `result: false` — is a failure, never a SENT.
 */
export function parseWatiSendResponse(data: unknown): WatiSendResult {
  const d = (data ?? {}) as {
    result?: unknown;
    error?: unknown;
    receivers?: unknown;
  };
  if (d.result !== true) {
    return { ok: false, error: typeof d.error === "string" ? d.error : "Wati did not accept the send" };
  }
  const receivers = Array.isArray(d.receivers) ? d.receivers : [];
  const first = receivers[0] as {
    localMessageId?: unknown;
    isValidWhatsAppNumber?: unknown;
    errors?: unknown;
  } | undefined;
  if (!first) return { ok: false, error: "Wati accepted the send but returned no receiver" };
  if (first.isValidWhatsAppNumber === false) {
    return { ok: false, error: "Wati: the number is not a valid WhatsApp number" };
  }
  const errors = Array.isArray(first.errors) ? first.errors.filter(Boolean) : [];
  if (errors.length > 0) {
    return { ok: false, error: `Wati: ${errors.map(String).join("; ")}` };
  }
  return {
    ok: true,
    ...(typeof first.localMessageId === "string" && first.localMessageId
      ? { messageId: first.localMessageId }
      : {}),
  };
}
