import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { getSetting, setSetting, setUserPhone } from "@/lib/db";
import { parsePrefs, prefsKey } from "@/lib/notification-prefs";
import { normalizeWhatsAppNumber, whatsappStatus } from "@/lib/whatsapp";
import { watiStatus } from "@/lib/whatsapp-wati";

/**
 * GET /api/notifications/whatsapp — the signed-in officer's WhatsApp state:
 * whether the workspace can send at all, whether proactive template alerts
 * are ready, and the number alerts would go to.
 *
 * PATCH — { phone?, whatsapp? }: set the delivery number (E.164, stored
 * as typed and normalised at send time) and/or the opt-in. Clearing the
 * phone ("") removes it; WhatsApp delivery then reports SKIPPED with the
 * reason instead of failing.
 */
export async function GET(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  const prefs = parsePrefs(getSetting(prefsKey(user.id)));
  return NextResponse.json({
    status: whatsappStatus(),
    wati: watiStatus(),
    phone: user.phone ?? "",
    optedIn: prefs.whatsapp,
    ready: Boolean(
      (whatsappStatus().templateConfigured || watiStatus().configured) && user.phone && prefs.whatsapp,
    ),
  });
}

const BodySchema = z.object({
  phone: z.string().max(32).optional(),
  whatsapp: z.boolean().optional(),
});

export async function PATCH(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send phone and/or whatsapp." }, { status: 422 });

  const { phone, whatsapp } = parsed.data;
  let savedPhone = user.phone ?? "";
  if (phone !== undefined) {
    const trimmed = phone.trim();
    if (trimmed && !normalizeWhatsAppNumber(trimmed)) {
      return NextResponse.json(
        { error: "Enter a phone number with its country code, e.g. +254 712 345 678." },
        { status: 422 },
      );
    }
    const updated = setUserPhone(user.id, trimmed);
    savedPhone = updated?.phone ?? "";
  }
  if (whatsapp !== undefined) {
    const prefs = parsePrefs(getSetting(prefsKey(user.id)));
    setSetting(prefsKey(user.id), JSON.stringify({ ...prefs, whatsapp }));
  }

  const prefs = parsePrefs(getSetting(prefsKey(user.id)));
  return NextResponse.json({
    ok: true,
    phone: savedPhone,
    optedIn: prefs.whatsapp,
    status: whatsappStatus(),
    wati: watiStatus(),
  });
}
