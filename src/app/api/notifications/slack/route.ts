import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { getSetting, setSetting } from "@/lib/db";
import { parsePrefs, prefsKey } from "@/lib/notification-prefs";
import { sendSlackTest } from "@/lib/notifications";
import { SLACK_MUTED_KEY, slackStatus } from "@/lib/slack";

/**
 * GET /api/notifications/slack — the signed-in officer's Slack state:
 * whether the workspace can post at all, whether the Events API / slash
 * command is wired, and whether the shared channel is muted.
 *
 * PATCH — { slack } toggles whether this officer's events may also go to
 * the shared team channel. Slack posts once per event (not once per
 * person), so this is "my events may be posted to the team channel".
 *
 * POST — { test: true } posts a test alert to the configured channel so
 * the setup can be verified from the bell in one click. The test is
 * recorded in the delivery log like any send.
 */
export async function GET(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  const prefs = parsePrefs(getSetting(prefsKey(user.id)));
  const status = slackStatus();
  return NextResponse.json({
    status,
    muted: getSetting(SLACK_MUTED_KEY) === "1",
    optedIn: prefs.slack,
    ready: Boolean(status.configured && prefs.slack),
  });
}

const PatchSchema = z.object({ slack: z.boolean() });

export async function PATCH(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send slack: true|false." }, { status: 422 });
  const prefs = parsePrefs(getSetting(prefsKey(user.id)));
  setSetting(prefsKey(user.id), JSON.stringify({ ...prefs, slack: parsed.data.slack }));
  return NextResponse.json({ ok: true, optedIn: parsed.data.slack, status: slackStatus() });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.test !== true) return NextResponse.json({ error: "Send { test: true }." }, { status: 422 });
  const result = await sendSlackTest(user);
  return NextResponse.json({ ok: result.status === "SENT", ...result, status: slackStatus() });
}
