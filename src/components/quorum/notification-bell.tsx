"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, Loader2, Mail, MessageCircle, ShieldAlert, Stamp, TimerReset, X } from "lucide-react";
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
  channel: "email" | "whatsapp";
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
  const [channels, setChannels] = useState({ email: false, whatsapp: false });
  const [showLog, setShowLog] = useState(false);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

  const pull = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=30", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        notifications?: Notification[];
        unread?: number;
        channels?: { email?: boolean; whatsapp?: boolean };
      };
      setItems(data.notifications ?? []);
      setUnread(data.unread ?? 0);
      if (data.channels) setChannels({ email: data.channels.email === true, whatsapp: data.channels.whatsapp === true });
    } catch {
      /* keep the last inbox */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void pull();
    const id = window.setInterval(() => void pull(), 25_000);
    return () => window.clearInterval(id);
  }, [pull]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markRead = async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true, readAt: new Date().toISOString() } : n)));
    setUnread((n) => Math.max(0, n - 1));
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => null);
  };

  const markAll = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true, readAt: new Date().toISOString() })));
    setUnread(0);
    const res = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => null);
    if (res?.ok) onToast("INBOX CLEARED — EVERY NOTIFICATION MARKED READ");
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

  const loadLog = async () => {
    setShowLog((v) => !v);
    if (showLog || logLoading) return;
    setLogLoading(true);
    try {
      const res = await fetch("/api/notifications/deliveries", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { deliveries?: Delivery[] };
        setDeliveries(data.deliveries ?? []);
      }
    } finally {
      setLogLoading(false);
    }
  };

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void pull();
        }}
        aria-label={unread > 0 ? `${unread} unread notifications` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Notifications"
        className="focus-brand relative grid h-9 w-9 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-ink-950/[0.045] hover:text-ink-900 dark:text-ink-400 dark:hover:bg-white/[0.06] dark:hover:text-white"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unread > 0 ? (
          <span className="absolute right-1 top-1 grid min-h-[15px] min-w-[15px] place-items-center rounded-full bg-brand-600 px-1 font-code text-[7.5px] font-bold leading-none text-white ring-2 ring-paper dark:ring-night">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-[calc(100%+8px)] z-[70] w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-xl border border-ink-200 bg-[#fffdfb] shadow-[0_20px_60px_-18px_rgba(11,12,15,0.35)]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
            <div>
              <p className="text-[12.5px] font-semibold text-ink-950">Attention</p>
              <p className="mt-0.5 font-code text-[7.5px] font-bold tracking-[0.16em] text-ink-400">
                {unread > 0 ? `${unread} UNREAD` : "CLEAR"} · GATES & DEADLINES
              </p>
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 ? (
                <button type="button" onClick={() => void markAll()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-code text-[7px] font-bold tracking-[0.12em] text-ink-500 hover:bg-ink-950/[0.05] hover:text-ink-900">
                  <CheckCheck className="h-3 w-3" aria-hidden="true" /> READ ALL
                </button>
              ) : null}
              <button type="button" onClick={() => setOpen(false)} aria-label="Close notifications" className="grid h-7 w-7 place-items-center rounded-full text-ink-400 hover:bg-ink-950/[0.05] hover:text-ink-800">
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="max-h-[380px] overflow-y-auto">
            {loading && items.length === 0 ? (
              <div className="flex items-center justify-center gap-2 px-4 py-8 font-code text-[8px] font-bold tracking-[0.16em] text-ink-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> CHECKING THE DESK…
              </div>
            ) : items.length === 0 ? (
              <div className="px-5 py-9 text-center">
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
                            <span className={cn("text-[12px] leading-snug", !n.read ? "font-semibold text-ink-950" : "font-medium text-ink-800")}>{n.title}</span>
                            <span className="shrink-0 pt-0.5 font-code text-[7px] tracking-[0.06em] text-ink-400">{ago(n.createdAt)}</span>
                          </span>
                          <span className="mt-0.5 line-clamp-3 block text-[11px] leading-relaxed text-ink-500">{n.body}</span>
                        </span>
                        {!n.read ? <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" aria-label="Unread" /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-ink-100 bg-paper/40 px-4 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3 font-code text-[7px] font-bold tracking-[0.12em] text-ink-400">
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3 w-3" aria-hidden="true" /> EMAIL {channels.email ? "LIVE" : "OFF"}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MessageCircle className="h-3 w-3" aria-hidden="true" /> WHATSAPP {channels.whatsapp ? "LIVE" : "OFF"}
                </span>
              </div>
              <button type="button" onClick={() => void loadLog()} className="font-code text-[7px] font-bold tracking-[0.12em] text-brand-700 hover:underline">
                {showLog ? "HIDE LOG" : "DELIVERY LOG"}
              </button>
            </div>
            {showLog ? (
              <div className="mt-2 max-h-[150px] space-y-1 overflow-y-auto rounded-md border border-ink-200 bg-white p-2">
                {logLoading ? (
                  <p className="font-code text-[7.5px] text-ink-400">READING DELIVERY LOG…</p>
                ) : deliveries.length === 0 ? (
                  <p className="font-code text-[7.5px] text-ink-400">NO DELIVERIES RECORDED YET.</p>
                ) : (
                  deliveries.slice(0, 12).map((d) => (
                    <p key={d.id} className="font-code text-[7.5px] leading-relaxed text-ink-600">
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
