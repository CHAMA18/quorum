import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { getSetting, setSetting } from "@/lib/db";
import { parsePrefs, prefsKey } from "@/lib/notification-prefs";

const BodySchema = z.object({ email: z.boolean(), whatsapp: z.boolean() });

/** GET/POST /api/notifications/preferences — per-user outbound channel toggles. */
export async function GET(request: NextRequest) {
  const user = await getUserFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  return NextResponse.json({ prefs: parsePrefs(getSetting(prefsKey(user.id))) });
}

export async function POST(request: NextRequest) {
  const user = await getUserFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid preferences." }, { status: 422 });
  setSetting(prefsKey(user.id), JSON.stringify(parsed.data));
  return NextResponse.json({ prefs: parsed.data });
}
