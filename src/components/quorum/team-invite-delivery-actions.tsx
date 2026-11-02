"use client";

import { useState, type FormEvent } from "react";

type InviteDeliveryRow = {
  id: string;
  email: string | null;
  status: "PENDING" | "CLAIMED" | "REVOKED";
  emailDeliveryStatus: "SENT" | "SKIPPED" | "FAILED" | null;
  emailDeliveryDetail: string | null;
  emailDeliveryAttemptedAt: string | null;
};

export function TeamInviteDeliveryActions({
  invite,
  canManage,
  disabled = false,
  onToast,
  onUpdated,
}: {
  invite: InviteDeliveryRow;
  canManage: boolean;
  disabled?: boolean;
  onToast: (message: string) => void;
  onUpdated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  if (!canManage || invite.status !== "PENDING") return null;

  const submit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (busy || disabled) return;
    setBusy(true);
    try {
      const hasRecipient = Boolean(invite.email);
      const response = await fetch("/api/team", {
        method: hasRecipient ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hasRecipient ? { inviteId: invite.id } : { inviteId: invite.id, email: email.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        delivery?: { status: "SENT" | "SKIPPED" | "FAILED"; detail: string };
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Invitation email request failed.");
      const delivery = payload.delivery;
      if (delivery?.status === "SENT") {
        onToast(`INVITATION EMAIL ACCEPTED BY RESEND — ${invite.email ?? email.trim()}`);
      } else {
        onToast(`${delivery?.status === "FAILED" ? "EMAIL SEND FAILED" : "EMAIL NOT SENT"} — ${delivery?.detail ?? "Check the invitation status and try again."}`);
      }
      setEmail("");
      onUpdated();
    } catch (error) {
      onToast(`INVITATION EMAIL FAILED — ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const deliveryStatus = invite.emailDeliveryStatus;
  const statusLabel = deliveryStatus === "SENT"
    ? "ACCEPTED BY RESEND"
    : deliveryStatus === "FAILED"
      ? "SEND FAILED"
      : "NOT SENT";
  const statusTone = deliveryStatus === "SENT"
    ? "text-emerald-700"
    : deliveryStatus === "FAILED"
      ? "text-brand-800"
      : "text-amber-700";

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <span className={`font-code text-[10px] font-bold tracking-[0.06em] ${statusTone}`}>
        {statusLabel}
      </span>
      {deliveryStatus !== "SENT" && invite.emailDeliveryDetail && (
        <span className="min-w-0 flex-1 text-[10.5px] leading-relaxed text-ink-500">
          {invite.emailDeliveryDetail}
        </span>
      )}
      {invite.email ? (
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || disabled}
          className="focus-brand inline-flex min-h-11 items-center rounded-lg border border-ink-200 bg-white px-3 py-2 font-code text-[10px] font-bold tracking-[0.06em] text-ink-700 transition-colors hover:border-ink-400 hover:text-ink-950 disabled:cursor-wait disabled:opacity-50 dark:border-white/15 dark:bg-[#0b0d12] dark:text-ink-200"
        >
          {busy ? "SENDING…" : deliveryStatus === "FAILED" ? "RETRY EMAIL" : deliveryStatus === "SENT" ? "RESEND EMAIL" : "SEND EMAIL"}
        </button>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="flex min-w-[240px] flex-1 flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`invite-recipient-${invite.id}`}>Recipient email for this invite</label>
          <input
            id={`invite-recipient-${invite.id}`}
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Recipient email"
            disabled={busy || disabled}
            className="focus-brand h-11 min-w-[170px] flex-1 rounded-lg border border-ink-200 bg-white px-3 text-[13px] text-ink-900 outline-none placeholder:text-ink-400 focus:border-ink-400 disabled:opacity-50 dark:border-white/15 dark:bg-[#0b0d12] dark:text-white dark:placeholder:text-ink-500"
          />
          <button
            type="submit"
            disabled={busy || disabled || !email.trim()}
            className="focus-brand inline-flex min-h-11 items-center rounded-lg border border-ink-200 bg-white px-3 py-2 font-code text-[10px] font-bold tracking-[0.06em] text-ink-700 transition-colors hover:border-ink-400 hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-[#0b0d12] dark:text-ink-200"
          >
            {busy ? "SENDING…" : "ADD EMAIL & SEND"}
          </button>
        </form>
      )}
    </div>
  );
}
