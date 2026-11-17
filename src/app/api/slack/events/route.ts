import { NextResponse, type NextRequest } from "next/server";
import { getSetting, setSetting } from "@/lib/db";
import {
  SLACK_MUTED_KEY,
  SLACK_POST_MESSAGE_URL,
  SLACK_REPLIES,
  buildSlackThreadReply,
  classifySlackText,
  parseSlackEvent,
  slackConfigFromEnv,
  slackUrlVerificationChallenge,
  verifySlackSignature,
} from "@/lib/slack";

/**
 * POST /api/slack/events — Slack Events API.
 *
 * Every request must carry a valid v0 signature (signing secret + fresh
 * timestamp) or it is rejected before any state changes. The
 * url_verification challenge is answered in plain text, as Slack requires.
 *
 * What an event can do: a human message in the alert channel containing
 * `stop` / `start` mutes/unmutes the shared channel, and gets a threaded
 * reply. Bot posts (including our own alerts), messages in other channels
 * and everything else are acknowledged and ignored. Nothing here can
 * approve, reject or sign — a Slack user id is not a Quorum account.
 */
async function replyInThread(channel: string, threadTs: string, body: string): Promise<void> {
  const cfg = slackConfigFromEnv();
  if (!cfg.botToken || !channel) return;
  await fetch(SLACK_POST_MESSAGE_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.botToken}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(buildSlackThreadReply({ ...cfg, alertChannel: channel }, threadTs, body)),
    signal: AbortSignal.timeout(8000),
  }).catch(() => undefined);
}

export async function POST(req: NextRequest) {
  const cfg = slackConfigFromEnv();
  const raw = await req.text();
  const ok = verifySlackSignature(
    raw,
    req.headers.get("x-slack-signature"),
    req.headers.get("x-slack-request-timestamp"),
    cfg.signingSecret,
  );
  if (!ok) return NextResponse.json({ error: "Invalid Slack signature." }, { status: 403 });

  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const challenge = slackUrlVerificationChallenge(payload);
  if (challenge) {
    return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }

  const event = parseSlackEvent(payload);
  if (!event) return NextResponse.json({ ok: true, received: 0 });

  /* Only human messages in the configured alert channel are actionable.
     Bot posts (our own alerts included) must never trigger a reply loop. */
  if (event.isBot || event.type !== "message") return NextResponse.json({ ok: true, received: 1 });
  if (cfg.alertChannel && event.channel !== cfg.alertChannel) return NextResponse.json({ ok: true, received: 1 });

  const intent = classifySlackText(event.text);
  const threadTs = event.threadTs ?? "";
  if (intent === "mute" || intent === "unmute") {
    setSetting(SLACK_MUTED_KEY, intent === "mute" ? "1" : "");
    await replyInThread(event.channel, threadTs, SLACK_REPLIES[intent]);
  } else if (intent === "help") {
    await replyInThread(event.channel, threadTs, SLACK_REPLIES.help);
  } else if (event.text.trim()) {
    const appUrl = (process.env.QUORUM_APP_URL ?? "").replace(/\/$/, "");
    await replyInThread(
      event.channel,
      threadTs,
      `Quorum: I can only post alerts — decisions happen on the desk.${appUrl ? ` Open ${appUrl}` : ""} Reply stop to mute this channel.`,
    );
  }

  return NextResponse.json({ ok: true, received: 1 });
}
