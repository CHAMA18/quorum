import { NextResponse, type NextRequest } from "next/server";
import { getSetting, setSetting } from "@/lib/db";
import {
  SLACK_MUTED_KEY,
  SLACK_REPLIES,
  classifySlackText,
  parseSlackSlashCommand,
  slackConfigFromEnv,
  verifySlackSignature,
} from "@/lib/slack";

/**
 * POST /api/slack/commands — the `/quorum` slash command.
 *
 * Slack posts slash commands as form-encoded bodies with the same v0
 * signature as the Events API; unsigned requests are rejected. Anyone in
 * the workspace can run it, so it can only (a) mute/unmute the shared
 * alert channel and (b) return the desk link — an ephemeral reply only
 * the caller sees. A Slack user id is not a Quorum account, so nothing
 * here can approve, reject or sign anything.
 */
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

  const cmd = parseSlackSlashCommand(raw);
  if (!cmd) return NextResponse.json({ error: "Unknown slash command." }, { status: 400 });

  const intent = classifySlackText(cmd.text);
  const appUrl = (process.env.QUORUM_APP_URL ?? "").replace(/\/$/, "");
  const muted = getSetting(SLACK_MUTED_KEY) === "1";

  if (intent === "mute" || intent === "unmute") {
    setSetting(SLACK_MUTED_KEY, intent === "mute" ? "1" : "");
    return NextResponse.json({ response_type: "ephemeral", text: SLACK_REPLIES[intent] });
  }
  if (intent === "help") {
    return NextResponse.json({ response_type: "ephemeral", text: SLACK_REPLIES.help });
  }
  return NextResponse.json({
    response_type: "ephemeral",
    text: `Quorum alerts for this workspace are currently ${muted ? "muted" : "on"}. Type /quorum stop to mute, /quorum start to resume, or /quorum help.${appUrl ? ` Desk: ${appUrl}` : ""}`,
  });
}
