"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, Hash, Loader2, Mail, MessageCircle, ShieldAlert, Stamp, TimerReset, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  entityType: string | null;
  entityId: string | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
};

type Delivery = {
  id: string;
  channel: "email" | "whatsapp" | "slack";
  status: "SENT" | "SKIPPED" | "FAILED";
  detail: string;
  createdAt: string;
};

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return iso;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function iconFor(kind: string) {
  if (kind === "GATE_WAITING") return Stamp;
  if (kind === "GATE_DECIDED") return CheckCheck;
  if (kind === "DEADLINE") return TimerReset;
  if (kind === "STEP_UP") return ShieldAlert;
  return Bell;
}

/**
 * The desk's attention bell.
 *
 * It polls a server-side inbox that reconciles sidecar gates/deadlines, so it
 * works without a mail provider and without a websocket. Clicking a gate
 * notification routes straight to Approvals; the delivery log shows exactly
 * what left the building (and what did not, with the reason).
 */
export function NotificationBell({
  onNavigate,
  onToast,
}: {
  onNavigate: (section: string) => void;
  onToast: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [markAllBusy, setMarkAllBusy] = useState(false);
  const [inboxError, setInboxError] = useState("");
  const [actionError, setActionError] = useState("");
  const [channels, setChannels] = useState({ email: false, whatsapp: false, whatsappTemplate: false, whatsappWebhook: false, slack: false, slackEvents: false });
  const [prefs, setPrefs] = useState({ email: true, whatsapp: true, slack: true });
  const [waPhone, setWaPhone] = useState("");
  const [waSaving, setWaSaving] = useState(false);
  const [waNote, setWaNote] = useState("");
  const [slackMuted, setSlackMuted] = useState(false);
  const [slackTesting, setSlackTesting] = useState(false);
  const [slackNote, setSlackNote] = useState("");

  useEffect(() => {
    if (!open) return;
    void fetch("/api/notifications/preferences", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.prefs) setPrefs({ email: d.prefs.email !== false, whatsapp: d.prefs.whatsapp !== false, slack: d.prefs.slack !== false }); })
      .catch(() => undefined);
    void fetch("/api/notifications/whatsapp", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (typeof d?.phone === "string") setWaPhone(d.phone);
        if (d?.status) setChannels((c) => ({ ...c, whatsapp: d.status.configured === true, whatsappTemplate: d.status.templateConfigured === true, whatsappWebhook: d.status.webhookConfigured === true }));
      })
      .catch(() => undefined);
    void fetch("/api/notifications/slack", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.status) setChannels((c) => ({ ...c, slack: d.status.configured === true, slackEvents: d.status.eventsConfigured === true }));
        if (typeof d?.muted === "boolean") setSlackMuted(d.muted);
      })
      .catch(() => undefined);
  }, [open ]);

  const saveSlackTest = () => {
    setSlackTesting(true);
    setSlackNote("");
    void fetch("/api/notifications/slack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ test: true }) })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(d?.detail ?? d?.error ?? "Could not post the test.");
        setSlackNote(d?.detail ?? "Test posted to the Slack channel.");
        void refreshLog();
      })
      .catch((e) => setSlackNote(e instanceof Error ? e.message : "Could not post the test."))
      .finally(() => setSlackTesting(false));
  };
  const savePref = (key: "email" | "whatsapp" | "slack", value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    void fetch("/api/notifications/preferences", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next) }).catch(() => undefined);
  };
  const saveWaPhone = () => {
    setWaSaving(true);
    setWaNote("");
    void fetch("/api/notifications/whatsapp", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: waPhone }) })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(d?.error ?? "Could not save the number.");
        setWaNote("Saved — WhatsApp alerts will go to this number.");
      })
      .catch((e) => setWaNote(e instanceof Error ? e.message : "Could not save the number."))
      .finally(() => setWaSaving(false));
  };
  const [showLog, setShowLog] = useState(false);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState("");
  const root = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const pull = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/notifications?limit=30", { cache: "no-store" });
      if (!res.ok) throw new Error("Notification request failed.");
      const data = (await res.json()) as {
        notifications?: Notification[];
        unread?: number;
        channels?: { email?: boolean; whatsapp?: boolean; whatsappTemplate?: boolean; whatsappWebhook?: boolean; slack?: boolean; slackEvents?: boolean };
      };
      setItems(data.notifications ?? []);
      setUnread(data.unread ?? 0);
      if (data.channels) setChannels({ email: data.channels.email === true, whatsapp: data.channels.whatsapp === true, whatsappTemplate: data.channels.whatsappTemplate === true, whatsappWebhook: data.channels.whatsappWebhook === true, slack: data.channels.slack === true, slackEvents: data.channels.slackEvents === true });
      setInboxError("");
    } catch {
      setInboxError("The inbox could not refresh. Retry to check for new notifications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void pull(true);
    const id = window.setInterval(() => void pull(), 25_000);
    return () => window.clearInterval(id);
  }, [pull]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => dialogHeadingRef.current?.focus());
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markRead = async (id: string) => {
    setActionError("");
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Read update failed.");
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true, readAt: new Date().toISOString() } : n)));
      setUnread((n) => Math.max(0, n - 1));
    } catch {
      setActionError("This notification could not be marked as read. Try again.");
      onToast("NOTIFICATION COULD NOT BE MARKED READ · TRY AGAIN");
    }
  };

  const markAll = async () => {
    if (markAllBusy) return;
    setMarkAllBusy(true);
    setActionError("");
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) throw new Error("Read update failed.");
      const readAt = new Date().toISOString();
      setItems((prev) => prev.map((n) => ({ ...n, read: true, readAt })));
      setUnread(0);
      onToast("INBOX CLEARED — EVERY NOTIFICATION MARKED READ");
    } catch {
      setActionError("Notifications could not be marked as read. Try again.");
    } finally {
      setMarkAllBusy(false);
    }
  };

  const refreshLog = async () => {
    setLogLoading(true);
    setLogError("");
    try {
      const res = await fetch("/api/notifications/deliveries", { cache: "no-store" });
      if (!res.ok) throw new Error("Delivery log request failed.");
      const data = (await res.json()) as { deliveries?: Delivery[] };
      setDeliveries(data.deliveries ?? []);
    } catch {
      setLogError("The delivery log could not be loaded.");
    } finally {
      setLogLoading(false);
    }
  };

  const openItem = (n: Notification) => {
    if (!n.read) void markRead(n.id);
    if (n.href?.startsWith("mc-")) {
      setOpen(false);
      onNavigate(n.href);
    } else if (n.href?.startsWith("http")) {
      window.location.href = n.href;
    }
  };

  const loadLog = () => {
    if (showLog) {
      setShowLog(false);
      return;
    }
    setShowLog(true);
    void refreshLog();
  };

  return (
    <div ref={root} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void pull();
        }}
        aria-label={unread > 0 ? `${unread} unread notifications` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? "notifications-dialog" : undefined}
        title="Notifications"
        className="focus-brand relative grid h-11 w-11 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-ink-950/[0.045] hover:text-ink-900 dark:text-ink-400 dark:hover:bg-white/[0.06] dark:hover:text-white"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unread > 0 ? (
          <span className="absolute right-1 top-1 grid min-h-[15px] min-w-[15px] place-items-center rounded-full bg-brand-600 px-1 font-code text-[10px] font-bold leading-none text-white ring-2 ring-paper dark:ring-night">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {unread > 0 ? `${unread} unread notification${unread === 1 ? "" : "s"}` : ""}
      </span>

      {open ? (
        <div
          id="notifications-dialog"
          role="dialog"
          aria-labelledby="notifications-title"
          tabIndex={-1}
          className="absolute right-0 top-[calc(100%+8px)] z-[70] w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-xl border border-ink-200 bg-[#fffdfb] shadow-[0_20px_60px_-18px_rgba(11,12,15,0.35)]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
            <div>
              <h2 ref={dialogHeadingRef} id="notifications-title" tabIndex={-1} className="text-[12.5px] font-semibold text-ink-950">
                Attention
              </h2>
              <p className="mt-0.5 font-code text-[10px] font-bold tracking-[0.1em] text-ink-500">
                {unread > 0 ? `${unread} UNREAD` : "CLEAR"} · GATES & DEADLINES
              </p>
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 ? (
                <button type="button" onClick={() => void markAll()} disabled={markAllBusy} className="focus-brand inline-flex min-h-11 items-center gap-1 rounded-md px-2 font-code text-[10px] font-bold tracking-[0.08em] text-ink-600 hover:bg-ink-950/[0.05] hover:text-ink-900 disabled:cursor-wait disabled:opacity-60">
                  {markAllBusy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <CheckCheck className="h-3 w-3" aria-hidden="true" />}
                  {markAllBusy ? "SAVING…" : "READ ALL"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  window.requestAnimationFrame(() => triggerRef.current?.focus());
                }}
                aria-label="Close notifications"
                className="focus-brand grid h-11 w-11 place-items-center rounded-full text-ink-400 hover:bg-ink-950/[0.05] hover:text-ink-800"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          {inboxError ? (
            <div role="alert" className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-[11px] text-amber-900">
              <span>{items.length ? "Showing the last inbox; new notifications could not be checked." : inboxError}</span>
              <button type="button" onClick={() => void pull(true)} disabled={loading} className="focus-brand inline-flex min-h-11 shrink-0 items-center rounded-md px-2 font-semibold underline underline-offset-2 disabled:opacity-50">
                Retry
              </button>
            </div>
          ) : null}
          {actionError ? (
            <p role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-[11px] leading-relaxed text-amber-900">
              {actionError}
            </p>
          ) : null}

          <div className="max-h-[380px] overflow-y-auto">
            {loading && items.length === 0 ? (
              <div role="status" className="flex items-center justify-center gap-2 px-4 py-8 font-code text-[10px] font-bold tracking-[0.1em] text-ink-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> CHECKING THE DESK…
              </div>
            ) : inboxError && items.length === 0 ? (
              <div className="px-5 py-9 text-center">
                <Bell className="mx-auto h-5 w-5 text-ink-300" aria-hidden="true" />
                <p className="mt-2 text-[12px] font-medium text-ink-700">Notifications are unavailable.</p>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-500">Retry to check gate decisions and deadline warnings.</p>
              </div>
            ) : items.length === 0 ? (
              <div role="status" className="px-5 py-9 text-center">
                <Bell className="mx-auto h-5 w-5 text-ink-300" aria-hidden="true" />
                <p className="mt-2 text-[12px] font-medium text-ink-700">Nothing needs you right now.</p>
                <p className="mt-1 text-[11px] text-ink-500">Gate decisions and deadline warnings land here.</p>
              </div>
            ) : (
              <ul className="divide-y divide-ink-100">
                {items.map((n) => {
                  const Icon = iconFor(n.kind);
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => openItem(n)}
                        className={cn(
                          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-paper/70",
                          !n.read && "bg-brand-50/40",
                        )}
                      >
                        <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full", !n.read ? "bg-brand-100 text-brand-700" : "bg-ink-100 text-ink-500")}>
                          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start justify-between gap-2">
                            <span className={cn("text-[12.5px] leading-snug", !n.read ? "font-semibold text-ink-950" : "font-medium text-ink-800")}>{n.title}</span>
                            <span className="shrink-0 pt-0.5 font-code text-[10px] tracking-[0.02em] text-ink-500">{ago(n.createdAt)}</span>
                          </span>
                          <span className="mt-0.5 line-clamp-3 block text-[11.5px] leading-relaxed text-ink-500">{n.body}</span>
                        </span>
                        {!n.read ? <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" aria-label="Unread" /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-ink-100 bg-paper/40 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3 font-code text-[10px] font-bold tracking-[0.05em] text-ink-500">
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3 w-3" aria-hidden="true" /> EMAIL {channels.email ? "LIVE" : "OFF"}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MessageCircle className="h-3 w-3" aria-hidden="true" /> WHATSAPP {channels.whatsappTemplate ? "LIVE" : channels.whatsapp ? "NO TEMPLATE" : "OFF"}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Hash className="h-3 w-3" aria-hidden="true" /> SLACK {channels.slack ? (slackMuted ? "MUTED" : "LIVE") : "OFF"}
                </span>
              </div>
              <button type="button" onClick={loadLog} className="focus-brand inline-flex min-h-11 items-center rounded-md px-2 font-code text-[10px] font-bold tracking-[0.05em] text-brand-700 hover:underline">
                {showLog ? "HIDE LOG" : "DELIVERY LOG"}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-ink-600">
              <span className="font-code text-[9px] font-bold tracking-[0.06em] text-ink-400">NOTIFY ME BY</span>
              <label className="inline-flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={prefs.email} onChange={(e) => savePref("email", e.target.checked)} className="h-3.5 w-3.5 accent-[#b52b22]" /> Email
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={prefs.whatsapp} onChange={(e) => savePref("whatsapp", e.target.checked)} className="h-3.5 w-3.5 accent-[#b52b22]" /> WhatsApp
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={prefs.slack} onChange={(e) => savePref("slack", e.target.checked)} className="h-3.5 w-3.5 accent-[#b52b22]" /> Slack
              </label>
            </div>
            {prefs.slack ? (
              <div className="mt-2 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-code text-[9px] font-bold tracking-[0.06em] text-ink-400">TEAM CHANNEL</span>
                  <button type="button" onClick={saveSlackTest} disabled={slackTesting || !channels.slack} className="focus-brand min-h-9 rounded-md bg-ink-950 px-3 font-code text-[10px] font-bold tracking-[0.05em] text-white disabled:opacity-50">{slackTesting ? "POSTING…" : "SEND TEST"}</button>
                </div>
                <p role="status" className="text-[11px] leading-relaxed text-ink-500">
                  {slackNote || (!channels.slack ? "Slack is not configured on this workspace yet — alerts stay in-app and are logged as skipped." : slackMuted ? "Slack alerts are muted in the channel. Type start in Slack (or /quorum start) to resume." : !channels.slackEvents ? "Slack can post alerts. Muting with stop / the /quorum command needs the Events API configured (SLACK_SIGNING_SECRET)." : "Slack posts once per event to the shared channel. Reply stop there to mute, start to resume. Approvals always happen on the desk.")}
                </p>
              </div>
            ) : null}
            {prefs.whatsapp ? (
              <div className="mt-2 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="wa-phone" className="font-code text-[9px] font-bold tracking-[0.06em] text-ink-400">WHATSAPP NUMBER</label>
                  <input id="wa-phone" type="tel" autoComplete="tel" value={waPhone} onChange={(e) => setWaPhone(e.target.value)} placeholder="+254 712 345 678" className="min-h-9 w-44 rounded-md border border-ink-200 bg-white px-2 text-[12px] text-ink-900" />
                  <button type="button" onClick={saveWaPhone} disabled={waSaving} className="focus-brand min-h-9 rounded-md bg-ink-950 px-3 font-code text-[10px] font-bold tracking-[0.05em] text-white disabled:opacity-50">{waSaving ? "SAVING…" : "SAVE"}</button>
                </div>
                <p role="status" className="text-[11px] leading-relaxed text-ink-500">
                  {waNote || (!channels.whatsapp ? "WhatsApp is not configured on this workspace yet — alerts stay in-app and are logged as skipped." : !channels.whatsappTemplate ? "WhatsApp is connected but has no approved alert template — proactive alerts cannot be sent yet." : !channels.whatsappWebhook ? "Alerts are live. STOP / START replies need the webhook configured (WHATSAPP_VERIFY_TOKEN)." : "Alerts are live. Reply STOP to opt out, START to return. Approvals always happen on the desk.")}
                </p>
              </div>
            ) : null}
            {showLog ? (
              <div className="mt-2 max-h-[150px] space-y-1 overflow-y-auto rounded-md border border-ink-200 bg-white p-2">
                {logLoading ? (
                  <p role="status" className="font-code text-[10px] text-ink-500">READING DELIVERY LOG…</p>
                ) : logError ? (
                  <div role="alert" className="flex items-center justify-between gap-2 text-[10px] text-amber-900">
                    <span>{logError}</span>
                    <button type="button" onClick={() => void refreshLog()} className="focus-brand min-h-11 shrink-0 rounded px-2 font-semibold underline underline-offset-2">Retry</button>
                  </div>
                ) : deliveries.length === 0 ? (
                  <p role="status" className="font-code text-[10px] text-ink-500">NO DELIVERIES RECORDED YET.</p>
                ) : (
                  deliveries.slice(0, 12).map((d) => (
                    <p key={d.id} className="font-code text-[10px] leading-relaxed text-ink-700">
                      <span className={cn("font-bold", d.status === "SENT" ? "text-emerald-700" : d.status === "FAILED" ? "text-red-700" : "text-amber-700")}>{d.status}</span>{" "}
                      {d.channel.toUpperCase()} · {d.detail}
                    </p>
                  ))
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
