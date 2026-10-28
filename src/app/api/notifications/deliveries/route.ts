import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { countUnreadNotifications, listNotificationDeliveries } from "@/lib/db";

/** GET /api/notifications/deliveries — the signed-in officer's channel log. */
export async function GET(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  const rows = listNotificationDeliveries(200).filter((d) => d.userId === user.id);
  return NextResponse.json({
    deliveries: rows,
    unread: countUnreadNotifications(user.id),
    providers: {
      email: Boolean(process.env.RESEND_API_KEY?.trim()),
      whatsapp: Boolean(process.env.WHATSAPP_TOKEN?.trim() && process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()),
    },
  });
}
