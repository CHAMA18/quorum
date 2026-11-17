/**
 * WhatsApp Business Cloud API — the Quorum adapter.
 *
 * Two message shapes, and the difference matters:
 *
 *   · TEMPLATE messages are the only way to start a conversation. Every
 *     proactive alert (gate waiting, deadline, decision recorded) goes out
 *     as the approved `quorum_alert` template with the headline, a short
 *     summary and the desk deep link as body parameters. Meta rejects a
 *     business-initiated free-form message outside a 24-hour window, so
 *     sending free-form text for gate alerts — what the first adapter did —
 *     fails in production even though it looks right in code.
 *   · FREE-FORM text is used only inside that window: replies to an
 *     inbound STOP / START / HELP. The inbound message itself opens the
 *     window, so the reply always lands.
 *
 * Nothing here talks to the network. `buildWhatsAppPayload` is pure so the
 * exact request Meta receives is unit-testable, and the webhook helpers
 * (signature verification, event parsing, opt-in/out classification) are
 * pure for the same reason. `sendWhatsApp` in notifications.ts owns the
 * fetch, the timeout and the delivery log.
 *
 * Approvals never happen over WhatsApp. An inbound message can opt a
 * number out, opt it back in, or get a link to the desk — it cannot
 * approve, reject or sign anything. That is the integration contract in
 * docs/WHATSAPP-INTEGRATION.md.
 */

import { createHmac, timingSafeEqual } from "crypto";

export interface WhatsAppConfig {
  /** Permanent access token for the WhatsApp-enabled Meta app. */
  token: string;
  /** The sender phone-number ID (not the phone number itself). */
  phoneNumberId: string;
  /** Approved template name for proactive alerts, e.g. "quorum_alert". */
  templateName: string;
  /** Template language, e.g. "en" or "en_KE". Defaults to "en". */
  languageCode: string;
  /** Webhook verify token — must match the one set in the Meta dashboard. */
  verifyToken: string;
  /** Meta app secret, used to verify X-Hub-Signature-256 on webhook POSTs. */
  appSecret: string;
}

const env = (key: string) => process.env[key]?.trim() ?? "";

export function whatsappConfigFromEnv(): WhatsAppConfig {
  return {
    token: env("WHATSAPP_TOKEN"),
    phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID"),
    templateName: env("WHATSAPP_TEMPLATE_NAME"),
    languageCode: env("WHATSAPP_TEMPLATE_LANGUAGE") || "en",
    verifyToken: env("WHATSAPP_VERIFY_TOKEN"),
    appSecret: env("WHATSAPP_APP_SECRET"),
  };
}

/** Sending needs the token + sender number ID. A template is what makes
 *  proactive sends actually deliver; without one we can only reply inside
 *  an open 24-hour window. */
export function isWhatsAppConfigured(cfg: WhatsAppConfig): boolean {
  return Boolean(cfg.token && cfg.phoneNumberId);
}

export function isWhatsAppTemplateConfigured(cfg: WhatsAppConfig): boolean {
  return isWhatsAppConfigured(cfg) && Boolean(cfg.templateName);
}

export function isWhatsAppWebhookConfigured(cfg: WhatsAppConfig): boolean {
  return Boolean(cfg.verifyToken);
}

/** What the Integrations / API pages report — honest about which layer is
 *  missing instead of a single LIVE/OFF that hides a broken template. */
export function whatsappStatus(cfg: WhatsAppConfig = whatsappConfigFromEnv()) {
  return {
    configured: isWhatsAppConfigured(cfg),
    templateConfigured: isWhatsAppTemplateConfigured(cfg),
    webhookConfigured: isWhatsAppWebhookConfigured(cfg),
    missing: [
      ...(!cfg.token ? ["WHATSAPP_TOKEN"] : []),
      ...(!cfg.phoneNumberId ? ["WHATSAPP_PHONE_NUMBER_ID"] : []),
      ...(isWhatsAppConfigured(cfg) && !cfg.templateName ? ["WHATSAPP_TEMPLATE_NAME (proactive alerts need an approved template)"] : []),
      ...(!cfg.verifyToken ? ["WHATSAPP_VERIFY_TOKEN (webhook verification)"] : []),
    ],
  };
}

/** E.164 digits only — WhatsApp wants the number without +, spaces or
 *  dashes. Returns "" when there is nothing usable to send to. */
export function normalizeWhatsAppNumber(raw: string | undefined | null): string {
  const digits = (raw ?? "").replace(/[^\d]/g, "");
  return digits.length >= 7 && digits.length <= 15 ? digits : "";
}

export interface WhatsAppAlert {
  headline: string;
  summary: string;
  url: string;
}

/**
 * Build the Graph API message payload.
 *
 * With an approved template: a template message whose body parameters are
 * [headline, summary, url] — the template text itself (approved by Meta)
 * carries the "reply STOP to opt out" footer, so it cannot be forgotten
 * here. Without one: free-form text, which only delivers inside an open
 * 24-hour customer-service window (i.e. as a reply, never as an alert).
 */
export function buildWhatsAppPayload(
  cfg: WhatsAppConfig,
  to: string,
  alert: WhatsAppAlert,
): Record<string, unknown> {
  const recipient = normalizeWhatsAppNumber(to);
  if (isWhatsAppTemplateConfigured(cfg)) {
    const param = (text: string, max: number) => ({ type: "text" as const, text: text.replace(/\s+/g, " ").trim().slice(0, max) || "—" });
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "template",
      template: {
        name: cfg.templateName,
        language: { code: cfg.languageCode },
        components: [
          { type: "body", parameters: [param(alert.headline, 60), param(alert.summary, 200), param(alert.url, 500)] },
        ],
      },
    };
  }
  const body = `Quorum · ${alert.headline}\n\n${alert.summary}\n\n${alert.url}\n\nReply STOP to opt out.`;
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipient,
    type: "text",
    text: { preview_url: true, body: body.slice(0, 4096) },
  };
}

export const GRAPH_MESSAGES_URL = (phoneNumberId: string) =>
  `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`;

/* ── Webhook security ──────────────────────────────────────────────────── */

/** Verify X-Hub-Signature-256: `sha256=<hex hmac of the raw body>`.
 *  The comparison runs on the raw bytes Meta signed — re-serialising the
 *  JSON first would break every signature. */
export function verifyWhatsAppSignature(rawBody: string, header: string | null | undefined, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const provided = header.startsWith("sha256=") ? header.slice(7) : header;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(provided.toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ── Webhook parsing ───────────────────────────────────────────────────── */

export interface WhatsAppInboundMessage {
  /** Provider message id (wamid). */
  id: string;
  /** Sender in E.164 digits. */
  from: string;
  text: string;
}

export interface WhatsAppStatusEvent {
  /** Provider message id of a message we sent. */
  id: string;
  status: "sent" | "delivered" | "read" | "failed" | string;
  error?: string;
}

/** Tolerant walk of the webhook envelope — Meta adds fields over time, and
 *  an unknown field must never break the whole batch. */
export function parseWhatsAppWebhook(payload: unknown): {
  messages: WhatsAppInboundMessage[];
  statuses: WhatsAppStatusEvent[];
} {
  const messages: WhatsAppInboundMessage[] = [];
  const statuses: WhatsAppStatusEvent[] = [];
  const entry = (payload as { entry?: unknown } | null)?.entry;
  if (!Array.isArray(entry)) return { messages, statuses };
  for (const item of entry) {
    const changes = (item as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as { value?: Record<string, unknown> })?.value ?? {};
      const inbound = Array.isArray(value.messages) ? value.messages : [];
      for (const m of inbound) {
        const msg = m as { id?: unknown; from?: unknown; text?: { body?: unknown } };
        messages.push({
          id: typeof msg.id === "string" ? msg.id : "",
          from: normalizeWhatsAppNumber(typeof msg.from === "string" ? msg.from : ""),
          text: typeof msg.text?.body === "string" ? msg.text.body : "",
        });
      }
      const outbound = Array.isArray(value.statuses) ? value.statuses : [];
      for (const s of outbound) {
        const st = s as { id?: unknown; status?: unknown; errors?: { title?: unknown }[] };
        statuses.push({
          id: typeof st.id === "string" ? st.id : "",
          status: typeof st.status === "string" ? st.status : "",
          ...(Array.isArray(st.errors) && typeof st.errors[0]?.title === "string" ? { error: st.errors[0].title } : {}),
        });
      }
    }
  }
  return { messages, statuses };
}

/* ── Inbound intent ────────────────────────────────────────────────────── */

export type WhatsAppIntent = "opt_out" | "opt_in" | "help" | "other";

/** STOP/START are the conventional opt-out words; WhatsApp also delivers
 *  template opt-out button taps as the same text. Anything else is a
 *  human typing at the desk number — they get the desk link, never an
 *  action. */
export function classifyWhatsAppText(text: string): WhatsAppIntent {
  const t = text.trim().toUpperCase();
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "QUIT", "OPT OUT", "OPT-OUT"].includes(t)) return "opt_out";
  if (["START", "UNSTOP", "SUBSCRIBE", "OPT IN", "OPT-IN", "YES"].includes(t)) return "opt_in";
  if (t === "HELP" || t.startsWith("HELP ") || t.startsWith("HELP?")) return "help";
  return "other";
}

export const WHATSAPP_REPLIES: Record<Exclude<WhatsAppIntent, "other">, string> = {
  opt_out: "Quorum: WhatsApp alerts are off for this number. Your in-app inbox is unaffected. Reply START to turn them back on.",
  opt_in: "Quorum: WhatsApp alerts are on for this number. Decisions are made on the desk — WhatsApp only ever carries a link.",
  help: "Quorum desk: open the link in your alert to review and decide. WhatsApp cannot approve, reject or sign anything.",
};
