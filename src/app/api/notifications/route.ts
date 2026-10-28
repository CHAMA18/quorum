import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/db";
import { syncNotificationsForUser } from "@/lib/notifications";

/**
 * GET /api/notifications — the signed-in officer's inbox.
 *
 * The sidecar emits gate events to /api/internal/notifications/event, but a
 * polling read also reconciles gates and deadlines directly. That makes the
 * inbox work even when the web app was offline when the event happened.
 */
export async function GET(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });

  await syncNotificationsForUser(user).catch(() => null);

  const unreadOnly = req.nextUrl.searchParams.get("unread") === "1";
  const take = Number(req.nextUrl.searchParams.get("limit") ?? 40);
  const notifications = listNotifications(user.id, { unreadOnly, take: Number.isFinite(take) ? take : 40 });
  return NextResponse.json({
    notifications: notifications.map((n) => ({ ...n, read: n.readAt !== null })),
    unread: countUnreadNotifications(user.id),
    channels: {
      email: Boolean(process.env.RESEND_API_KEY?.trim()),
      whatsapp: Boolean(process.env.WHATSAPP_TOKEN?.trim() && process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()),
    },
  });
}

/** PATCH /api/notifications — { id } marks one read; { all: true } marks all. */
export async function PATCH(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.all === true) {
    const changed = markAllNotificationsRead(user.id);
    return NextResponse.json({ ok: true, changed, unread: 0 });
  }
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id or all is required." }, { status: 422 });
  const row = markNotificationRead(user.id, id);
  if (!row) return NextResponse.json({ error: "Notification not found." }, { status: 404 });
  return NextResponse.json({ ok: true, notification: { ...row, read: true }, unread: countUnreadNotifications(user.id) });
}
