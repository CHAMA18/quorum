/**
 * Slack app — the Quorum adapter.
 *
 * One shape, and it is different from WhatsApp's: Slack delivery here is a
 * *shared team channel*, not a DM. Every gate/deadline event is posted once
 * to the configured alert channel (`chat.postMessage`) with a deep link to
 * the desk. Because the destination is shared, the dedupe key is the event
 * (kind + entity + title), not the recipient — one event, one channel
 * post, no matter how many officers it was fanned out to.
 *
 * Inbound (Events API + the `/quorum` slash command) can do exactly two
 * things: mute/unmute the shared channel (`stop` / `start`) and answer with
 * the desk link (`help`). A Slack user id is not a Quorum account, so an
 * inbound Slack message cannot be authenticated as an officer — which is
 * precisely why it can never approve, reject or sign anything. That is the
 * integration contract in docs/SLACK-INTEGRATION.md.
 *
 * Nothing here talks to the network. `buildSlackPayload`, signature
 * verification, event/command parsing and intent classification are pure so
 * the exact request Slack receives is unit-testable. `sendSlack` in
 * notifications.ts owns the fetch, the timeout and the delivery log.
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";

export interface SlackConfig {
  /** Bot user OAuth token (xoxb-…). Needs chat:write + the channel scope. */
  botToken: string;
  /** Destination channel id (C…) or name. The bot must be a member. */
  alertChannel: string;
  /** Signing secret from the Slack app — verifies Events API + slash posts. */
  signingSecret: string;
}

const env = (key: string) => process.env[key]?.trim() ?? "";

export function slackConfigFromEnv(): SlackConfig {
  return {
    botToken: env("SLACK_BOT_TOKEN"),
    alertChannel: env("SLACK_ALERT_CHANNEL_ID").replace(/^#/, ""),
    signingSecret: env("SLACK_SIGNING_SECRET"),
  };
}

/** Sending needs the bot token + a destination channel. */
export function isSlackConfigured(cfg: SlackConfig): boolean {
  return Boolean(cfg.botToken && cfg.alertChannel);
}

export function isSlackEventsConfigured(cfg: SlackConfig): boolean {
  return Boolean(cfg.signingSecret);
}

/** What the Integrations / API pages report — honest about which layer is
 *  missing instead of a single LIVE/OFF that hides a broken webhook. */
export function slackStatus(cfg: SlackConfig = slackConfigFromEnv()) {
  return {
    configured: isSlackConfigured(cfg),
    eventsConfigured: isSlackEventsConfigured(cfg),
    missing: [
      ...(!cfg.botToken ? ["SLACK_BOT_TOKEN"] : []),
      ...(!cfg.alertChannel ? ["SLACK_ALERT_CHANNEL_ID"] : []),
      ...(!cfg.signingSecret ? ["SLACK_SIGNING_SECRET (Events API + slash command verification)"] : []),
    ],
  };
}

export const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

/** Slack mrkdwn reserves &, < and > — unescaped user text can break the
 *  message or forge a link, so every interpolated field goes through this. */
export function escapeSlackMrkdwn(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface SlackAlert {
  headline: string;
  summary: string;
  url: string;
}

/**
 * Build the chat.postMessage payload: a plain-text fallback plus blocks
 * (bold headline, summary, and a single URL button to the desk). There is
 * deliberately no approve/reject action button — Slack actions would need
 * an authenticated officer on the other end, and Slack cannot provide one.
 */
export function buildSlackPayload(cfg: SlackConfig, alert: SlackAlert): Record<string, unknown> {
  const headline = escapeSlackMrkdwn(alert.headline.replace(/\s+/g, " ").trim().slice(0, 120) || "Quorum alert");
  const summary = escapeSlackMrkdwn(alert.summary.replace(/\s+/g, " ").trim().slice(0, 300));
  const url = alert.url.slice(0, 500);
  const text = `Quorum · ${alert.headline}\n${alert.summary}\n${alert.url}\nReply "stop" in this channel to mute Quorum alerts.`;
  return {
    channel: cfg.alertChannel,
    text: text.slice(0, 4000),
    unfurl_links: false,
    unfurl_media: false,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*${headline}*\n${summary}` } },
      {
        type: "actions",
        elements: [
          ...(url
            ? [{ type: "button", text: { type: "plain_text", text: "Open in Quorum" }, url, action_id: "open_desk" }]
            : []),
        ],
      },
      { type: "context", elements: [{ type: "mrkdwn", text: "Decisions happen on the desk — Slack only carries the link. Reply `stop` to mute." }] },
    ],
  };
}

/** Reply-in-thread payload for Events API intents (stop/start/help). */
export function buildSlackThreadReply(cfg: SlackConfig, threadTs: string, body: string): Record<string, unknown> {
  return { channel: cfg.alertChannel, thread_ts: threadTs, text: body.slice(0, 4000), unfurl_links: false };
}

/* ── Request verification (Events API + slash commands) ─────────────────── */

/** Slack's v0 signature: `v0=<hex hmac-sha256 of "v0:{timestamp}:{raw body}">`
 *  keyed with the app's signing secret. The timestamp must be fresh
 *  (Slack allows 5 minutes) or the request is replayable. The comparison
 *  runs on the raw bytes Slack signed. */
export function verifySlackSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  timestampHeader: string | null | undefined,
  signingSecret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!signatureHeader || !timestampHeader || !signingSecret) return false;
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > 300) return false;
  const expected = "v0=" + createHmac("sha256", signingSecret).update(`v0:${timestampHeader}:${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ── Events API parsing ──────────────────────────────────────────────────── */

export interface SlackEventMessage {
  type: string;
  text: string;
  channel: string;
  user?: string;
  threadTs?: string;
  /** True for bot/app posts — our own alerts included. Never acted on. */
  isBot: boolean;
}

/** Tolerant walk of an Events API envelope. Returns null for anything that
 *  is not an event_callback we can act on (url_verification is handled
 *  separately via its `challenge` field). */
export function parseSlackEvent(payload: unknown): SlackEventMessage | null {
  const env = payload as { type?: unknown; event?: Record<string, unknown> } | null;
  if (!env || env.type !== "event_callback" || !env.event) return null;
  const event = env.event;
  const rawType = typeof event.type === "string" ? event.type : "";
  const subtype = typeof event.subtype === "string" ? event.subtype : "";
  const isBot =
    subtype === "bot_message" ||
    typeof event.bot_id === "string" ||
    typeof event.app_id === "string" ||
    event.channel_type === "im";
  return {
    type: rawType,
    text: typeof event.text === "string" ? event.text : "",
    channel: typeof event.channel === "string" ? event.channel : "",
    ...(typeof event.user === "string" ? { user: event.user } : {}),
    ...(typeof event.thread_ts === "string" ? { threadTs: event.thread_ts } : {}),
    isBot,
  };
}

export function slackUrlVerificationChallenge(payload: unknown): string | null {
  const env = payload as { type?: unknown; challenge?: unknown } | null;
  if (!env || env.type !== "url_verification") return null;
  return typeof env.challenge === "string" && env.challenge ? env.challenge : null;
}

/* ── Slash command parsing ───────────────────────────────────────────────── */

export interface SlackSlashCommand {
  command: string;
  text: string;
  userId: string;
  channelId: string;
  responseUrl: string;
}

/** Slash commands arrive as application/x-www-form-urlencoded. */
export function parseSlackSlashCommand(formBody: string): SlackSlashCommand | null {
  const params = new URLSearchParams(formBody);
  const command = params.get("command") ?? "";
  if (!command.startsWith("/")) return null;
  return {
    command,
    text: params.get("text") ?? "",
    userId: params.get("user_id") ?? "",
    channelId: params.get("channel_id") ?? "",
    responseUrl: params.get("response_url") ?? "",
  };
}

/* ── Inbound intent ──────────────────────────────────────────────────────── */

export type SlackIntent = "mute" | "unmute" | "help" | "other";

/** `stop` / `start` mute the shared channel; `help` (and anything else a
 *  human types at the bot) gets the desk link. Never an action. */
export function classifySlackText(text: string): SlackIntent {
  const t = text.trim().toLowerCase().replace(/^[.!?]+|[.!?]+$/g, "").trim();
  if (["stop", "stopall", "mute", "unsubscribe", "quit", "opt out", "opt-out", "pause"].includes(t)) return "mute";
  if (["start", "unstop", "unmute", "subscribe", "opt in", "opt-in", "resume", "yes"].includes(t)) return "unmute";
  if (t === "help" || t.startsWith("help ") || t.startsWith("help?")) return "help";
  return "other";
}

export const SLACK_REPLIES: Record<Exclude<SlackIntent, "other">, string> = {
  mute: "Quorum: alerts are muted in this channel. Type `start` to turn them back on. Your Quorum inbox is unaffected.",
  unmute: "Quorum: alerts are on in this channel. Decisions still happen on the desk — Slack only carries the link.",
  help: "Quorum desk: sign in and open the alert to review and decide. Slack cannot approve, reject or sign anything.",
};

/* ── Shared-channel dedupe ───────────────────────────────────────────────── */

/** One event = one channel post. The key covers the event identity, not the
 *  recipient, so a gate fanned out to five officers posts once. */
export function slackDedupeKey(input: { kind: string; entityType?: string | null; entityId?: string | null; title: string }): string {
  const raw = [input.kind, input.entityType ?? "", input.entityId ?? "", input.title].join("|");
  return "slack-sent:" + createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

export const SLACK_MUTED_KEY = "slack:muted";
