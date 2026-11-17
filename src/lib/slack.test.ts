import { describe, expect, test } from "bun:test";
import { createHmac } from "crypto";
import {
  buildSlackPayload,
  buildSlackThreadReply,
  classifySlackText,
  escapeSlackMrkdwn,
  isSlackConfigured,
  isSlackEventsConfigured,
  parseSlackEvent,
  parseSlackSlashCommand,
  slackConfigFromEnv,
  slackDedupeKey,
  slackStatus,
  slackUrlVerificationChallenge,
  verifySlackSignature,
  type SlackConfig,
} from "./slack";

const cfg = (over: Partial<SlackConfig> = {}): SlackConfig => ({
  botToken: "xoxb-test",
  alertChannel: "C12345678",
  signingSecret: "secret",
  ...over,
});

const alert = { headline: "Approval needed: KE-MOH-2026-117", summary: "A decision is ready for review.", url: "https://quorum.example/#mc-gates" };

function sign(body: string, ts: string, secret = "secret"): string {
  return "v0=" + createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex");
}

describe("config gates", () => {
  test("configured means bot token + channel; events need the signing secret", () => {
    expect(isSlackConfigured(cfg())).toBe(true);
    expect(isSlackConfigured(cfg({ botToken: "" }))).toBe(false);
    expect(isSlackConfigured(cfg({ alertChannel: "" }))).toBe(false);
    expect(isSlackEventsConfigured(cfg())).toBe(true);
    expect(isSlackEventsConfigured(cfg({ signingSecret: "" }))).toBe(false);
  });

  test("status names the missing pieces", () => {
    const s = slackStatus(cfg({ botToken: "", signingSecret: "" }));
    expect(s.configured).toBe(false);
    expect(s.missing).toContain("SLACK_BOT_TOKEN");
    expect(s.missing).toContain("SLACK_SIGNING_SECRET (Events API + slash command verification)");
  });

  test("channel id strips a leading #", () => {
    expect(cfg({ alertChannel: "#quorum-alerts" }).alertChannel).toBe("#quorum-alerts");
    const fromEnv = slackConfigFromEnv();
    expect(typeof fromEnv.alertChannel).toBe("string");
  });
});

describe("payload building", () => {
  test("posts to the channel with text fallback, blocks and one desk button", () => {
    const p = buildSlackPayload(cfg(), alert) as {
      channel: string;
      text: string;
      unfurl_links: boolean;
      blocks: { type: string; text?: { text: string }; elements?: { type: string; url?: string; action_id?: string }[] }[];
    };
    expect(p.channel).toBe("C12345678");
    expect(p.text).toContain(alert.headline);
    expect(p.text).toContain(alert.url);
    expect(p.unfurl_links).toBe(false);
    const button = p.blocks[1].elements?.[0];
    expect(button?.type).toBe("button");
    expect(button?.url).toBe(alert.url);
    expect(button?.action_id).toBe("open_desk");
    /* No approval action anywhere in the payload. */
    expect(JSON.stringify(p)).not.toMatch(/approve|reject|sign/i);
  });

  test("mrkdwn is escaped so user text cannot forge links or break formatting", () => {
    expect(escapeSlackMrkdwn("a & b <c>")).toBe("a &amp; b &lt;c&gt;");
    const p = buildSlackPayload(cfg(), { headline: "<https://evil.example|click>", summary: "x", url: alert.url }) as {
      blocks: { text?: { text: string } }[];
    };
    expect(p.blocks[0].text?.text).toContain("&lt;https://evil.example|click&gt;");
  });

  test("headline and summary are bounded", () => {
    const p = buildSlackPayload(cfg(), { headline: "h".repeat(500), summary: "s".repeat(900), url: alert.url }) as {
      blocks: { text?: { text: string } }[];
    };
    expect(p.blocks[0].text?.text?.length).toBeLessThan(500);
  });

  test("thread reply carries channel + thread ts", () => {
    const p = buildSlackThreadReply(cfg(), "1700.1", "muted") as { channel: string; thread_ts: string; text: string };
    expect(p.channel).toBe("C12345678");
    expect(p.thread_ts).toBe("1700.1");
    expect(p.text).toBe("muted");
  });
});

describe("signature verification", () => {
  const body = '{"type":"url_verification","challenge":"abc"}';
  const ts = "1700000000";
  const now = 1700000100;

  test("accepts a valid, fresh signature", () => {
    expect(verifySlackSignature(body, sign(body, ts), ts, "secret", now)).toBe(true);
  });

  test("rejects tampered body, wrong secret, stale timestamp and missing headers", () => {
    expect(verifySlackSignature(body + " ", sign(body, ts), ts, "secret", now)).toBe(false);
    expect(verifySlackSignature(body, sign(body, ts, "other"), ts, "secret", now)).toBe(false);
    expect(verifySlackSignature(body, sign(body, ts), ts, "secret", now + 301)).toBe(false);
    expect(verifySlackSignature(body, null, ts, "secret", now)).toBe(false);
    expect(verifySlackSignature(body, sign(body, ts), "not-a-number", "secret", now)).toBe(false);
    expect(verifySlackSignature(body, sign(body, ts), ts, "", now)).toBe(false);
  });
});

describe("events parsing", () => {
  test("extracts a human channel message", () => {
    const payload = { type: "event_callback", event: { type: "message", text: "stop", channel: "C12345678", user: "U1", thread_ts: "1700.1" } };
    expect(parseSlackEvent(payload)).toEqual({ type: "message", text: "stop", channel: "C12345678", user: "U1", threadTs: "1700.1", isBot: false });
  });

  test("bot posts are flagged so the route never replies to its own alerts", () => {
    const payload = { type: "event_callback", event: { type: "message", subtype: "bot_message", text: "Quorum · …", channel: "C12345678" } };
    expect(parseSlackEvent(payload)?.isBot).toBe(true);
  });

  test("non-event envelopes and url_verification are handled separately", () => {
    expect(parseSlackEvent(null)).toBeNull();
    expect(parseSlackEvent({ type: "url_verification", challenge: "xyz" })).toBeNull();
    expect(slackUrlVerificationChallenge({ type: "url_verification", challenge: "xyz" })).toBe("xyz");
    expect(slackUrlVerificationChallenge({ type: "event_callback" })).toBeNull();
  });
});

describe("slash command parsing", () => {
  test("parses form-encoded slash commands", () => {
    const body = new URLSearchParams({ command: "/quorum", text: "stop", user_id: "U1", channel_id: "C1", response_url: "https://hooks.slack.com/commands/1" }).toString();
    expect(parseSlackSlashCommand(body)).toEqual({ command: "/quorum", text: "stop", userId: "U1", channelId: "C1", responseUrl: "https://hooks.slack.com/commands/1" });
  });

  test("rejects non-slash payloads", () => {
    expect(parseSlackSlashCommand("foo=bar")).toBeNull();
  });
});

describe("inbound intent", () => {
  test("stop/start/help classify; approvals never do", () => {
    expect(classifySlackText("stop")).toBe("mute");
    expect(classifySlackText(" STOP ")).toBe("mute");
    expect(classifySlackText("mute")).toBe("mute");
    expect(classifySlackText("start")).toBe("unmute");
    expect(classifySlackText("help")).toBe("help");
    expect(classifySlackText("approve gate_1")).toBe("other");
    expect(classifySlackText("yes approve")).toBe("other");
    expect(classifySlackText("")).toBe("other");
  });
});

describe("dedupe", () => {
  test("one event = one key regardless of recipient; different events differ", () => {
    const a = slackDedupeKey({ kind: "GATE_WAITING", entityType: "gate", entityId: "g1", title: "Approval needed: T1" });
    const b = slackDedupeKey({ kind: "GATE_WAITING", entityType: "gate", entityId: "g1", title: "Approval needed: T1" });
    const c = slackDedupeKey({ kind: "GATE_DECIDED", entityType: "gate", entityId: "g1", title: "Approved: T1" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith("slack-sent:")).toBe(true);
  });
});
