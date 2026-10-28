import { NextResponse, type NextRequest } from "next/server";
import { fanOutGateEvent, verifyNotificationBody } from "@/lib/notifications";

/**
 * POST /api/internal/notifications/event — the sidecar's event door.
 *
 * Authenticated by an HMAC over the raw body (NOTIFY_SECRET or GATE_SECRET),
 * not by a session: the sidecar has no cookie. The route only accepts the two
 * gate events, so it cannot be used to write arbitrary inbox items.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyNotificationBody(raw, req.headers.get("x-quorum-notify"))) {
    return NextResponse.json({ error: "Invalid notification signature." }, { status: 401 });
  }
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const type = event.type;
  if (type !== "GATE_WAITING" && type !== "GATE_DECIDED") {
    return NextResponse.json({ error: "Unsupported event type." }, { status: 422 });
  }
  const gateId = typeof event.gateId === "string" ? event.gateId : "";
  const tenderId = typeof event.tenderId === "string" ? event.tenderId : "";
  if (!gateId || !tenderId) return NextResponse.json({ error: "gateId and tenderId are required." }, { status: 422 });

  const created = await fanOutGateEvent({
    type,
    gateId,
    tenderId,
    tool: typeof event.tool === "string" ? event.tool : undefined,
    requiredOffice: typeof event.requiredOffice === "string" ? event.requiredOffice : undefined,
    actor: typeof event.actor === "string" ? event.actor : undefined,
    outcome: typeof event.outcome === "string" ? event.outcome : undefined,
    note: typeof event.note === "string" ? event.note : undefined,
  });
  return NextResponse.json({ ok: true, created });
}
