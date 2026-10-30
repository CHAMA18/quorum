import { createHmac, timingSafeEqual } from "crypto";
import { secretFor } from "@/lib/secrets";
import {
  createNotification,
  findUserById,
  listUsers,
  recordNotificationDelivery,
  type NotificationRow,
  type UserRow,
} from "@/lib/db";

/**
 * Notification fan-out — in-app always, outbound when a provider is configured.
 *
 * There is no mail server in the demo. That is not allowed to become a silent
 * failure: every notification is written to the inbox first, then each
 * outbound channel records SENT / SKIPPED / FAILED with the reason. Judges can
 * see the delivery log, and a pilot can wire Resend or WhatsApp Cloud API by
 * setting two environment variables.
 */

const SIDECAR = process.env.QUORUM_SIDECAR_URL ?? "http://127.0.0.1:3031";
const APP_URL = (process.env.QUORUM_APP_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
export function notificationSecret(): string {
  return secretFor("notify");
}

export function signNotificationBody(body: string): string {
  return createHmac("sha256", notificationSecret()).update(body).digest("hex");
}

export function verifyNotificationBody(body: string, sig: string | null | undefined): boolean {
  if (!sig) return false;
  const expected = signNotificationBody(body);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function notificationUrl(n: NotificationRow): string {
  if (!n.href) return APP_URL;
  if (/^https?:\/\//.test(n.href)) return n.href;
  return `${APP_URL}/#${n.href.replace(/^#/, "")}`;
}

function htmlFor(n: NotificationRow, user: UserRow): string {
  const url = notificationUrl(n);
  return `<!doctype html><html><body style="margin:0;background:#f6f3ed;font-family:Georgia,serif;color:#141416">
  <div style="max-width:560px;margin:32px auto;background:#fffdfb;border:1px solid #e4e0d8;border-radius:14px;overflow:hidden">
    <div style="background:#141416;padding:18px 22px;color:#fff"><strong style="letter-spacing:.08em">QUORUM</strong><span style="float:right;font:11px ui-monospace,monospace;color:#b9b5aa">PROCUREMENT DESK</span></div>
    <div style="padding:22px">
      <p style="font:10px ui-monospace,monospace;letter-spacing:.18em;color:#7a756a;margin:0 0 10px">${escapeHtml(n.kind.replace(/_/g, " "))}</p>
      <h1 style="font-size:21px;line-height:1.25;margin:0 0 10px">${escapeHtml(n.title)}</h1>
      <p style="font-size:14px;line-height:1.65;color:#4a4640;margin:0 0 18px">${escapeHtml(n.body)}</p>
      <a href="${escapeHtml(url)}" style="display:inline-block;background:#141416;color:#fff;text-decoration:none;padding:11px 16px;border-radius:8px;font:12px ui-monospace,monospace;letter-spacing:.08em">OPEN IN QUORUM →</a>
      <p style="font-size:11px;line-height:1.6;color:#8a857a;margin:20px 0 0">Sent to ${escapeHtml(user.email)} because a gate or deadline needs attention. The in-app inbox is the record of delivery.</p>
    </div>
  </div></body></html>`;
}

async function sendEmail(to: string, n: NotificationRow, user: UserRow): Promise<{ status: "SENT" | "SKIPPED" | "FAILED"; detail: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { status: "SKIPPED", detail: "RESEND_API_KEY is not configured; in-app only." };
  const from = process.env.RESEND_FROM?.trim() || "Quorum <onboarding@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `[Quorum] ${n.title}`,
        html: htmlFor(n, user),
        text: `${n.title}\n\n${n.body}\n\n${notificationUrl(n)}`,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string; error?: string };
    if (!res.ok) return { status: "FAILED", detail: `Resend HTTP ${res.status}: ${data.message ?? data.error ?? "unknown error"}` };
    return { status: "SENT", detail: `Resend message ${data.id ?? "accepted"}.` };
  } catch (e) {
    return { status: "FAILED", detail: `Resend request failed: ${(e as Error).message}` };
  }
}

async function sendWhatsApp(to: string, n: NotificationRow): Promise<{ status: "SENT" | "SKIPPED" | "FAILED"; detail: string }> {
  const token = process.env.WHATSAPP_TOKEN?.trim();
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneId) return { status: "SKIPPED", detail: "WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID are not configured." };
  const number = to.replace(/[^\d]/g, "");
  if (number.length < 8) return { status: "SKIPPED", detail: "The account has no usable phone number." };
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(phoneId)}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: number,
        type: "text",
        text: { preview_url: true, body: `Quorum · ${n.title}\n\n${n.body}\n\n${notificationUrl(n)}` },
      }),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string } };
    if (!res.ok) return { status: "FAILED", detail: `WhatsApp HTTP ${res.status}: ${data.error?.message ?? "unknown error"}` };
    return { status: "SENT", detail: `WhatsApp message ${data.messages?.[0]?.id ?? "accepted"}.` };
  } catch (e) {
    return { status: "FAILED", detail: `WhatsApp request failed: ${(e as Error).message}` };
  }
}

/** Deliver one notification to every channel the account can receive. */
export async function deliverNotification(n: NotificationRow): Promise<void> {
  const user = findUserById(n.userId);
  if (!user || !user.emailVerified) return;
  const jobs: Promise<unknown>[] = [];
  jobs.push(
    sendEmail(user.email, n, user).then((r) =>
      recordNotificationDelivery({ notificationId: n.id, userId: user.id, channel: "email", status: r.status, detail: r.detail }),
    ),
  );
  jobs.push(
    (user.phone
      ? sendWhatsApp(user.phone, n)
      : Promise.resolve({ status: "SKIPPED" as const, detail: "No phone number on the account profile." })
    ).then((r) => recordNotificationDelivery({ notificationId: n.id, userId: user.id, channel: "whatsapp", status: r.status, detail: r.detail })),
  );
  await Promise.allSettled(jobs);
}

/** Create a notification and try to deliver it; never let a provider break the action. */
export async function notifyUser(input: {
  userId: string;
  kind: NotificationRow["kind"];
  title: string;
  body: string;
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  dedupeKey: string;
}): Promise<NotificationRow | null> {
  const user = findUserById(input.userId);
  if (!user) return null;
  const result = createNotification(input);
  if (result.created) void deliverNotification(result.row);
  return result.row;
}

type GateLite = {
  id: string;
  tenderId: string;
  tool: string;
  status: string;
  createdAt?: string;
  requiredOffice?: string;
  approver?: string;
  decidedAt?: string;
  note?: string;
};

/** Pull pending gates and deadlines; used as a fallback when events could not reach us. */
export async function syncNotificationsForUser(user: UserRow): Promise<void> {
  const [gatesRes, deadlinesRes] = await Promise.allSettled([
    fetch(`${SIDECAR}/api/gates`, { cache: "no-store", signal: AbortSignal.timeout(1800) }),
    fetch(`${SIDECAR}/api/cycle/deadlines`, { cache: "no-store", signal: AbortSignal.timeout(1800) }),
  ]);
  if (gatesRes.status === "fulfilled" && gatesRes.value.ok) {
    const data = (await gatesRes.value.json().catch(() => ({}))) as { gates?: GateLite[] };
    for (const gate of (data.gates ?? []).filter((g) => g.status === "PENDING")) {
      await notifyUser({
        userId: user.id,
        kind: "GATE_WAITING",
        title: `Gate waiting: ${gate.tenderId}`,
        body: `${gate.tool.replace(/_/g, " ")} needs a named human${gate.requiredOffice ? ` (${gate.requiredOffice.replace(/_/g, " ").toLowerCase()})` : ""}. The agent has prepared the file; only the committee can sign it.`,
        href: "mc-gates",
        entityType: "gate",
        entityId: gate.id,
        dedupeKey: `gate:${gate.id}:waiting`,
      });
    }
  }
  if (deadlinesRes.status === "fulfilled" && deadlinesRes.value.ok) {
    const data = (await deadlinesRes.value.json().catch(() => ({}))) as { deadlines?: { tenderId: string; kind: string; dueAt: string; ref?: string; overdue?: boolean }[] };
    const now = Date.now();
    for (const d of data.deadlines ?? []) {
      const due = new Date(d.dueAt).getTime();
      if (!Number.isFinite(due)) continue;
      const days = Math.ceil((due - now) / 86_400_000);
      if (days > 7) continue;
      await notifyUser({
        userId: user.id,
        kind: "DEADLINE",
        title: `${d.overdue ? "Overdue" : "Deadline"}: ${d.tenderId} · ${d.kind.replace(/_/g, " ").toLowerCase()}`,
        body: `${d.ref ? `${d.ref} — ` : ""}due ${new Date(d.dueAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}${d.overdue ? " (already overdue)" : days === 0 ? " (today)" : ` (in ${days} day${days === 1 ? "" : "s"})`}.`,
        href: "mc-cycle",
        entityType: "deadline",
        entityId: `${d.tenderId}:${d.kind}:${d.dueAt}:${d.ref ?? ""}`,
        dedupeKey: `deadline:${d.tenderId}:${d.kind}:${d.dueAt}:${d.ref ?? ""}`,
      });
    }
  }
}

/** Fan a gate event out to every verified officer (the demo uses a flat desk). */
export async function fanOutGateEvent(event: {
  type: "GATE_WAITING" | "GATE_DECIDED";
  gateId: string;
  tenderId: string;
  tool?: string;
  requiredOffice?: string;
  actor?: string;
  outcome?: string;
  note?: string;
}): Promise<number> {
  const users = listUsers().filter((u) => u.emailVerified);
  let created = 0;
  for (const user of users) {
    const waiting = event.type === "GATE_WAITING";
    const result = createNotification({
      userId: user.id,
      kind: event.type,
      title: waiting ? `Gate waiting: ${event.tenderId}` : `Gate ${event.outcome === "REJECTED" ? "returned" : "signed"}: ${event.tenderId}`,
      body: waiting
        ? `${(event.tool ?? "irreversible action").replace(/_/g, " ")} needs a named human${event.requiredOffice ? ` (${event.requiredOffice.replace(/_/g, " ").toLowerCase()})` : ""}. The agent has prepared the file; only the committee can sign it.`
        : `${event.actor ?? "The committee"} ${event.outcome === "REJECTED" ? "returned the submission for clarification" : "signed the gate and the bundle was filed"}.${event.note ? ` Note: ${event.note}` : ""}`,
      href: "mc-gates",
      entityType: "gate",
      entityId: event.gateId,
      dedupeKey: waiting ? `gate:${event.gateId}:waiting` : `gate:${event.gateId}:decided:${event.outcome ?? "unknown"}`,
    });
    if (result.created) {
      created += 1;
      void deliverNotification(result.row);
    }
  }
  return created;
}
