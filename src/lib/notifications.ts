import { deadlineDedupeSuffix, deadlineLevel } from "@/lib/deadline-escalation";
import { renderEmailHtml, renderEmailText, type EmailModel } from "@/lib/email-template";
import { channelAllowed, parsePrefs, prefsKey } from "@/lib/notification-prefs";
import { sidecarOrigin } from "@/lib/sidecar-origin";
import { createHmac, timingSafeEqual } from "crypto";
import {
  GRAPH_MESSAGES_URL,
  buildWhatsAppPayload,
  isWhatsAppConfigured,
  normalizeWhatsAppNumber,
  whatsappConfigFromEnv,
} from "@/lib/whatsapp";
import {
  SLACK_MUTED_KEY,
  SLACK_POST_MESSAGE_URL,
  buildSlackPayload,
  isSlackConfigured,
  slackConfigFromEnv,
  slackDedupeKey,
} from "@/lib/slack";
import { secretFor } from "@/lib/secrets";
import {
  createNotification,
  findUserById,
  getSetting,
  setSetting,
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

const SIDECAR = sidecarOrigin();
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

function notificationUrl(n: NotificationRow): string {
  if (!n.href) return APP_URL;
  if (/^https?:\/\//.test(n.href)) return n.href;
  return `${APP_URL}/#${n.href.replace(/^#/, "")}`;
}

const KIND_KICKER: Record<NotificationRow["kind"], string> = {
  GATE_WAITING: "Approval needed",
  GATE_DECIDED: "Decision recorded",
  DEADLINE: "Deadline",
  RUN_FAILED: "Needs attention",
  STEP_UP: "Confirm it is you",
  INVITE: "Invitation",
  SYSTEM: "Quorum update",
};

/** Plain-words headline for stored and new notifications alike. */
export function plainTitle(title: string): string {
  return title
    .replace(/^Gate waiting:/i, "Approval needed:")
    .replace(/^Gate signed:/i, "Approved:")
    .replace(/^Gate returned:/i, "Sent back:");
}

/** Build the subject, HTML and plain-text forms of one notification email. */
export function notificationEmail(n: NotificationRow, user: UserRow): { subject: string; html: string; text: string } {
  const url = notificationUrl(n);
  const waiting = n.kind === "GATE_WAITING";
  const decided = n.kind === "GATE_DECIDED";
  const returned = decided && /returned|sent back/i.test(n.title);
  const overdue = n.kind === "DEADLINE" && /^overdue|escalated/i.test(n.title);
  const tone = decided && !returned ? "signed" : waiting || overdue || n.kind === "RUN_FAILED" ? "urgent" : n.kind === "SYSTEM" ? "info" : "action";
  const status = waiting
    ? "Waiting for approval"
    : returned
      ? "Sent back for more information"
      : decided
        ? "Approved and saved"
        : overdue
          ? "Overdue — act now"
          : n.kind.replace(/_/g, " ").toLowerCase();
  const headline = plainTitle(n.title);
  const reference = headline.includes(": ") ? headline.slice(headline.indexOf(": ") + 2) : (n.entityId ?? "");
  const sentAt = new Date(n.createdAt);
  const intro = waiting
    ? "A decision is ready for review. Please open Quorum to see the details and decide what happens next."
    : decided && !returned
      ? "A decision has been recorded. Open Quorum to review the details."
      : returned
        ? "This was sent back for more information. Open Quorum to see what is needed and what happens next."
        : n.body;
  const model: EmailModel = {
    preheader: waiting
      ? "A decision is ready for review in Quorum."
      : decided
        ? returned ? "A decision was sent back for further review." : "A decision has been recorded in Quorum."
        : n.body,
    kicker: KIND_KICKER[n.kind],
    headline,
    intro,
    tone,
    facts: [
      ...(reference ? [{ label: "Reference", value: reference }] : []),
      { label: "Status", value: status },
      ...(Number.isFinite(sentAt.getTime())
        ? [{ label: "Recorded", value: sentAt.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) }]
        : []),
    ],
    ctaLabel: "Open in Quorum",
    ctaUrl: url,
    ctaNote: waiting ? "The designated approver makes the final decision." : undefined,
    footerNote:
      "You received this update because you are a member of this workspace. You can find it again in your Quorum inbox.",
    recipient: user.email,
    appUrl: APP_URL,
  };
  return { subject: `[Quorum] ${headline}`, html: renderEmailHtml(model), text: renderEmailText(model) };
}

async function sendEmail(to: string, n: NotificationRow, user: UserRow): Promise<{ status: "SENT" | "SKIPPED" | "FAILED"; detail: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { status: "SKIPPED", detail: "RESEND_API_KEY is not configured; in-app only." };
  const from = process.env.RESEND_FROM?.trim() || "Quorum <onboarding@resend.dev>";
  const mail = notificationEmail(n, user);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
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

/** Send one alert over WhatsApp. Proactive alerts go out as the approved
 *  template (see lib/whatsapp) — free-form text is only legal inside an
 *  open 24-hour window, so a business-initiated free-form send is a
 *  guaranteed failure outside a reply. Unconfigured stays SKIPPED and
 *  logged, never silent. */
async function sendWhatsApp(
  to: string,
  n: NotificationRow,
): Promise<{ status: "SENT" | "SKIPPED" | "FAILED"; detail: string; providerMessageId?: string }> {
  const cfg = whatsappConfigFromEnv();
  if (!isWhatsAppConfigured(cfg)) {
    return { status: "SKIPPED", detail: "WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID are not configured." };
  }
  const number = normalizeWhatsAppNumber(to);
  if (!number) return { status: "SKIPPED", detail: "The account has no usable phone number." };
  const payload = buildWhatsAppPayload(cfg, number, {
    headline: plainTitle(n.title),
    summary: n.body,
    url: notificationUrl(n),
  });
  const viaTemplate = payload.type === "template";
  try {
    const res = await fetch(GRAPH_MESSAGES_URL(cfg.phoneNumberId), {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string } };
    if (!res.ok) return { status: "FAILED", detail: `WhatsApp HTTP ${res.status}: ${data.error?.message ?? "unknown error"}` };
    const wamid = data.messages?.[0]?.id;
    return {
      status: "SENT",
      detail: `WhatsApp ${viaTemplate ? `template ${cfg.templateName}` : "free-form (24h window)"} message ${wamid ?? "accepted"}.`,
      ...(wamid ? { providerMessageId: wamid } : {}),
    };
  } catch (e) {
    return { status: "FAILED", detail: `WhatsApp request failed: ${(e as Error).message}` };
  }
}

/** Post one alert to the shared Slack channel. The channel is a team
 *  destination, not a DM: the dedupe key is the event, so a gate fanned
 *  out to every officer posts once. The claim is written synchronously
 *  before the fetch, so concurrent per-user deliveries cannot race into
 *  duplicate posts; a failed send releases the claim for a later retry.
 *  Channel-level mute (`stop` in Slack) suppresses everything. */
async function sendSlack(
  n: NotificationRow,
): Promise<{ status: "SENT" | "SKIPPED" | "FAILED"; detail: string; providerMessageId?: string }> {
  const cfg = slackConfigFromEnv();
  if (!isSlackConfigured(cfg)) {
    return { status: "SKIPPED", detail: "SLACK_BOT_TOKEN / SLACK_ALERT_CHANNEL_ID are not configured." };
  }
  if (getSetting(SLACK_MUTED_KEY) === "1") {
    return { status: "SKIPPED", detail: "Slack alerts are muted in the channel (a member replied stop)." };
  }
  const dedupe = slackDedupeKey({ kind: n.kind, entityType: n.entityType, entityId: n.entityId, title: n.title });
  const prior = getSetting(dedupe);
  if (prior) {
    return { status: "SKIPPED", detail: `Already posted to the Slack channel for this event (${prior}).` };
  }
  setSetting(dedupe, "pending");
  const claim = dedupe;
  try {
    const res = await fetch(SLACK_POST_MESSAGE_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.botToken}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(buildSlackPayload(cfg, { headline: plainTitle(n.title), summary: n.body, url: notificationUrl(n) })),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; ts?: string; error?: string };
    if (!res.ok || data.ok === false) {
      setSetting(claim, "");
      return { status: "FAILED", detail: `Slack HTTP ${res.status}: ${data.error ?? "unknown error"}` };
    }
    setSetting(claim, data.ts ?? "posted");
    return { status: "SENT", detail: `Slack message ${data.ts ?? "posted"} to ${cfg.alertChannel}.`, ...(data.ts ? { providerMessageId: data.ts } : {}) };
  } catch (e) {
    setSetting(claim, "");
    return { status: "FAILED", detail: `Slack request failed: ${(e as Error).message}` };
  }
}

/** Post a test alert to the configured channel — the one-click check in
 *  the notification bell. Recorded in the delivery log like any send. */
export async function sendSlackTest(user: UserRow): Promise<{ status: "SENT" | "SKIPPED" | "FAILED"; detail: string }> {
  const probe: NotificationRow = {
    id: `test_${Date.now()}`,
    userId: user.id,
    kind: "SYSTEM",
    title: "Quorum · Slack test alert",
    body: "This is a test post from the Quorum notification bell. Real gate and deadline alerts look like this. Reply stop in this channel to mute them.",
    href: "mc-gates",
    entityType: null,
    entityId: null,
    dedupeKey: `slack:test:${Date.now()}`,
    readAt: null,
    createdAt: new Date(),
  };
  const cfg = slackConfigFromEnv();
  if (isSlackConfigured(cfg) && getSetting(SLACK_MUTED_KEY) === "1") {
    return { status: "SKIPPED", detail: "Slack alerts are muted in the channel (a member replied stop). Unmute with start first." };
  }
  const r = await sendSlack(probe);
  recordNotificationDelivery({ notificationId: probe.id, userId: user.id, channel: "slack", status: r.status, detail: r.detail, providerMessageId: r.providerMessageId });
  return r;
}

/** Deliver one notification to every channel the account can receive and has not muted. */
export async function deliverNotification(n: NotificationRow): Promise<void> {
  const user = findUserById(n.userId);
  if (!user || !user.emailVerified) return;
  const prefs = parsePrefs(getSetting(prefsKey(user.id)));
  const jobs: Promise<unknown>[] = [];
  jobs.push(
    (channelAllowed(prefs, "email")
      ? sendEmail(user.email, n, user)
      : Promise.resolve({ status: "SKIPPED" as const, detail: "Email is off in your notification preferences." })
    ).then((r) => recordNotificationDelivery({ notificationId: n.id, userId: user.id, channel: "email", status: r.status, detail: r.detail })),
  );
  jobs.push(
    (!channelAllowed(prefs, "whatsapp")
      ? Promise.resolve({ status: "SKIPPED" as const, detail: "WhatsApp is off in your notification preferences." })
      : user.phone
        ? sendWhatsApp(user.phone, n)
        : Promise.resolve({ status: "SKIPPED" as const, detail: "No phone number on the account profile." })
    ).then((r) => recordNotificationDelivery({ notificationId: n.id, userId: user.id, channel: "whatsapp", status: r.status, detail: r.detail, providerMessageId: "providerMessageId" in r ? r.providerMessageId : undefined })),
  );
  jobs.push(
    (channelAllowed(prefs, "slack")
      ? sendSlack(n)
      : Promise.resolve({ status: "SKIPPED" as const, detail: "Slack is off in your notification preferences." })
    ).then((r) => recordNotificationDelivery({ notificationId: n.id, userId: user.id, channel: "slack", status: r.status, detail: r.detail, providerMessageId: "providerMessageId" in r ? r.providerMessageId : undefined })),
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
    fetch(`${SIDECAR}/api/gates`, {
      cache: "no-store",
      headers: { "x-quorum-workspace": user.workspaceId },
      signal: AbortSignal.timeout(1800),
    }),
    fetch(`${SIDECAR}/api/cycle/deadlines`, {
      cache: "no-store",
      headers: { "x-quorum-workspace": user.workspaceId },
      signal: AbortSignal.timeout(1800),
    }),
  ]);
  if (gatesRes.status === "fulfilled" && gatesRes.value.ok) {
    const data = (await gatesRes.value.json().catch(() => ({}))) as { gates?: GateLite[] };
    for (const gate of (data.gates ?? []).filter((g) => g.status === "PENDING")) {
      await notifyUser({
        userId: user.id,
        kind: "GATE_WAITING",
        title: `Approval needed: ${gate.tenderId}`,
        body: `This cannot go ahead until the named approver${gate.requiredOffice ? ` (${gate.requiredOffice.replace(/_/g, " ").toLowerCase()})` : ""} has checked and approved it. Everything they need is ready in Quorum.`,
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
      const level = deadlineLevel(d.dueAt, new Date(now));
      if (level === "none") continue;
      const escalated = level === "escalated";
      await notifyUser({
        userId: user.id,
        kind: "DEADLINE",
        title: `${escalated ? "ESCALATED — Overdue" : d.overdue ? "Overdue" : "Deadline"}: ${d.tenderId} · ${d.kind.replace(/_/g, " ").toLowerCase()}`,
        body: `${d.ref ? `${d.ref} — ` : ""}due ${new Date(d.dueAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}${d.overdue ? " (already overdue)" : days === 0 ? " (today)" : ` (in ${days} day${days === 1 ? "" : "s"})`}.${escalated ? " Escalated: this deadline is more than a day overdue and needs a named owner today." : ""}`,
        href: "mc-cycle",
        entityType: "deadline",
        entityId: `${d.tenderId}:${d.kind}:${d.dueAt}:${d.ref ?? ""}`,
        dedupeKey: `deadline:${d.tenderId}:${d.kind}:${d.dueAt}:${d.ref ?? ""}${deadlineDedupeSuffix(level, new Date(now))}`,
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
  const users = listUsers().filter((u) => u.emailVerified && u.status === "ACTIVE");
  let created = 0;
  for (const user of users) {
    const waiting = event.type === "GATE_WAITING";
    const result = createNotification({
      userId: user.id,
      kind: event.type,
      title: waiting ? `Approval needed: ${event.tenderId}` : `${event.outcome === "REJECTED" ? "Sent back" : "Approved"}: ${event.tenderId}`,
      body: waiting
        ? `This cannot go ahead until the named approver${event.requiredOffice ? ` (${event.requiredOffice.replace(/_/g, " ").toLowerCase()})` : ""} has checked and approved it. Everything they need is ready in Quorum.`
        : `${event.actor ?? "The approver"} ${event.outcome === "REJECTED" ? "sent this back for more information" : "approved this, and the signed copy is saved"}.${event.note ? ` Note: ${event.note}` : ""}`,
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
